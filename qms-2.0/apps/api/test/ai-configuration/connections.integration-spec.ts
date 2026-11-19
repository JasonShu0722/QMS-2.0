import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { PrismaService } from '../../src/database/prisma.service.js';
import { AdminMutationService } from '../../src/common/security/admin-mutation.service.js';
import { decryptSecret } from '../../src/common/security/security-keyring.js';
import { AuditLogService } from '../../src/modules/audit-log/audit-log.service.js';
import { AiConnectionService } from '../../src/modules/ai-configuration/ai-connection.service.js';
import { isDisposableLoopbackPostgres } from '../disposable-postgres.js';

if (process.env.QMS_DISPOSABLE_TEST_DB !== 'true' || !isDisposableLoopbackPostgres(process.env.DATABASE_URL)) throw new Error('AI connection tests require disposable loopback PostgreSQL; preview 55440 forbidden');
if (!process.env.QMS_SECURITY_CURRENT_KEY_ID || !process.env.QMS_SECURITY_KEYRING) throw new Error('Disposable security keyring required');

describe('AI connections with real PostgreSQL and actual loopback requests', () => {
  const prisma = new PrismaService();
  const audit = new AuditLogService(prisma);
  const connections = new AiConnectionService(prisma, new AdminMutationService(prisma, audit), audit);
  const secret = 'only-disposable-test-secret';
  let server: Server;
  let baseUrl: string;
  let received: Array<{ path?: string; authorization?: string; anthropicKey?: string; googleKey?: string; body: unknown }> = [];
  const originalNode = process.env.NODE_ENV;
  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    await prisma.$connect();
    server = createServer((request, response) => {
      let body = '';
      request.on('data', chunk => { body += String(chunk); });
      request.on('end', () => {
        received.push({ path: request.url, authorization: request.headers.authorization, anthropicKey: request.headers['x-api-key'] as string | undefined, googleKey: request.headers['x-goog-api-key'] as string | undefined, body: JSON.parse(body) });
        if (request.url?.startsWith('/failure')) { response.statusCode = 401; response.end(secret); return; }
        if (request.url?.endsWith('/responses')) { response.end(JSON.stringify({ status: 'completed', output: [{ type: 'message', status: 'completed', role: 'assistant', content: [{ type: 'output_text', text: '协议真实传输。' }] }] })); return; }
        if (request.url?.endsWith('/messages')) { response.end(JSON.stringify({ type: 'message', role: 'assistant', stop_reason: 'end_turn', content: [{ type: 'text', text: '协议真实传输。' }] })); return; }
        if (request.url?.endsWith(':generateContent')) { response.end(JSON.stringify({ candidates: [{ finishReason: 'STOP', content: { role: 'model', parts: [{ text: '协议真实传输。' }] } }] })); return; }
        response.end(JSON.stringify({ choices: [{ message: { content: '已选字段中的焊点异常。' } }] }));
      });
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
  });
  afterAll(async () => {
    server?.closeAllConnections();
    await new Promise<void>(resolve => server?.close(() => resolve()));
    await prisma.$disconnect();
    if (originalNode === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = originalNode;
  });

  async function fixture(codes = ['ai:connections:read', 'ai:connections:manage', 'ai:credentials:manage', 'ai:connections:test'], organizationId?: string) {
    const organization = organizationId ? { id: organizationId } : await prisma.organization.create({ data: { code: randomUUID(), name: 'AI disposable scope', type: 'INTERNAL' } });
    const user = await prisma.user.create({ data: { organizationId: organization.id, username: randomUUID(), passwordHash: 'test-only', accountType: 'INTERNAL' } });
    const session = await prisma.session.create({ data: { userId: user.id, tokenHash: randomUUID(), expiresAt: new Date(Date.now() + 3600000), reauthenticatedAt: new Date(), mfaVerifiedAt: new Date() } });
    const role = await prisma.role.create({ data: { organizationId: organization.id, code: randomUUID(), name: 'AI test grants' } });
    for (const code of codes) {
      const permission = await prisma.permission.upsert({ where: { code }, create: { code, name: code }, update: {} });
      await prisma.rolePermission.create({ data: { roleId: role.id, permissionId: permission.id } });
    }
    await prisma.userRole.create({ data: { organizationId: organization.id, userId: user.id, roleId: role.id } });
    return { organizationId: organization.id, actor: { id: user.id, organizationId: organization.id, accountType: 'INTERNAL' as const, sessionId: session.id }, role };
  }
  const input = () => ({ name: '批准的服务', baseUrl, models: ['model-test', 'model-test-2'], defaultModel: 'model-test', enabled: true, apiKey: secret });
  const safe = (value: unknown) => {
    expect(JSON.stringify(value)).not.toContain(secret);
    for (const key of ['apiKey', 'ciphertext', 'secretCiphertext', 'keySuffix', 'authorization']) expect(JSON.stringify(value)).not.toMatch(new RegExp(`"${key}"`, 'i'));
  };
  it('separates channel settings, credentials and testing and rechecks credentials on replay', async () => {
    const owner = await fixture();
    const value = await connections.create(owner.actor, owner.organizationId, input(), randomUUID(), randomUUID());
    const manager = await fixture(['ai:connections:read', 'ai:connections:manage'], owner.organizationId);
    expect(await connections.list(manager.actor, owner.organizationId)).toHaveLength(1);
    await expect(connections.create(manager.actor, owner.organizationId, input(), randomUUID(), randomUUID())).rejects.toMatchObject({ status: 403 });
    await expect(connections.update(manager.actor, owner.organizationId, value.id, { ...input(), expectedVersion: 1 }, randomUUID(), randomUUID())).rejects.toMatchObject({ status: 403 });
    await expect(connections.clear(manager.actor, owner.organizationId, value.id, { expectedVersion: 1 }, randomUUID(), randomUUID())).rejects.toMatchObject({ status: 403 });
    await expect(connections.test(manager.actor, owner.organizationId, value.id, { expectedVersion: 1 }, randomUUID(), randomUUID())).rejects.toMatchObject({ status: 403 });
    expect(await connections.update(manager.actor, owner.organizationId, value.id, { ...input(), apiKey: '', expectedVersion: 1 }, randomUUID(), randomUUID())).toMatchObject({ version: 2 });
    const tester = await fixture(['ai:connections:test'], owner.organizationId);
    expect(await connections.test(tester.actor, owner.organizationId, value.id, { expectedVersion: 2 }, randomUUID(), randomUUID())).toMatchObject({ status: 'SUCCESS' });
    const credential = await fixture(['ai:credentials:manage'], owner.organizationId);
    expect(await connections.clear(credential.actor, owner.organizationId, value.id, { expectedVersion: 2 }, randomUUID(), randomUUID())).toMatchObject({ hasKey: false });
    const key = randomUUID();
    await connections.create(owner.actor, owner.organizationId, input(), randomUUID(), key);
    await prisma.rolePermission.deleteMany({ where: { roleId: owner.role.id, permission: { code: 'ai:credentials:manage' } } });
    await expect(connections.create(owner.actor, owner.organizationId, input(), randomUUID(), key)).rejects.toMatchObject({ status: 403 });
    const legacy = await fixture(['configuration:read', 'configuration:manage'], owner.organizationId);
    await expect(connections.list(legacy.actor, owner.organizationId)).rejects.toMatchObject({ status: 403 });
  });
  it('stores only encrypted credentials while create/list/replay/admin-mutation/audit remain secret-free', async () => {
    const fixtureValue = await fixture();
    await prisma.session.update({ where: { id: fixtureValue.actor.sessionId }, data: { reauthenticatedAt: null } });
    const key = randomUUID();
    const value = await connections.create(fixtureValue.actor, fixtureValue.organizationId, input(), randomUUID(), key);
    expect(value).toMatchObject({ hasKey: true, enabled: true, version: 1 });
    safe(value); safe(await connections.list(fixtureValue.actor, fixtureValue.organizationId));
    const colleague = await fixture(undefined, fixtureValue.organizationId);
    const administrator = await fixture(['platform:admin'], fixtureValue.organizationId);
    safe(await connections.list(colleague.actor, fixtureValue.organizationId));
    safe(await connections.list(administrator.actor, fixtureValue.organizationId));
    const replay = await connections.create(fixtureValue.actor, fixtureValue.organizationId, input(), randomUUID(), key);
    expect(replay).toEqual(value);
    const [stored] = await prisma.$queryRaw<Array<{ secret_ciphertext: string }>>`SELECT secret_ciphertext FROM ai_connections WHERE id=${value.id}::uuid`;
    expect(stored!.secret_ciphertext).not.toContain(secret);
    expect(decryptSecret(stored!.secret_ciphertext, `ai-connection:${fixtureValue.organizationId}:${value.id}:${new URL(baseUrl).origin}`)).toBe(secret);
    expect(() => decryptSecret(stored!.secret_ciphertext, `ai-connection:${randomUUID()}:${value.id}:${new URL(baseUrl).origin}`)).toThrow();
    const mutations = await prisma.adminMutation.findMany({ where: { organizationId: fixtureValue.organizationId } });
    const events = await prisma.auditEvent.findMany({ where: { organizationId: fixtureValue.organizationId } });
    safe(mutations); safe(events);
    expect(events).toEqual(expect.arrayContaining([expect.objectContaining({ actorUserId: fixtureValue.actor.id, resourceId: value.id, action: 'AI_CONNECTION_CREATED', metadata: expect.objectContaining({ resourceVersion: 1 }) })]));
  });
  it('keeps blank keys, binds address changes to a replacement, and clears atomically with disable and CAS', async () => {
    const fixtureValue = await fixture();
    const value = await connections.create(fixtureValue.actor, fixtureValue.organizationId, input(), randomUUID(), randomUUID());
    const keep = await connections.update(fixtureValue.actor, fixtureValue.organizationId, value.id, { ...input(), apiKey: '', expectedVersion: 1 }, randomUUID(), randomUUID());
    expect(keep).toMatchObject({ hasKey: true, version: 2 });
    await expect(connections.update(fixtureValue.actor, fixtureValue.organizationId, value.id, { ...input(), baseUrl: baseUrl.replace('/v1', '/other'), apiKey: '', expectedVersion: 2 }, randomUUID(), randomUUID())).rejects.toMatchObject({ response: expect.objectContaining({ code: 'AI_CONNECTION_INVALID' }) });
    const replacement = await connections.update(fixtureValue.actor, fixtureValue.organizationId, value.id, { ...input(), apiKey: 'second-disposable-key', expectedVersion: 2 }, randomUUID(), randomUUID());
    expect(replacement).toMatchObject({ hasKey: true, version: 3 });
    await expect(connections.clear(fixtureValue.actor, fixtureValue.organizationId, value.id, { expectedVersion: 2 }, randomUUID(), randomUUID())).rejects.toMatchObject({ response: expect.objectContaining({ code: 'AI_CONNECTION_VERSION_CONFLICT' }) });
    const cleared = await connections.clear(fixtureValue.actor, fixtureValue.organizationId, value.id, { expectedVersion: 3 }, randomUUID(), randomUUID());
    expect(cleared).toMatchObject({ hasKey: false, enabled: false, version: 4 });
    safe(cleared);
    await expect(connections.resolve(fixtureValue.organizationId, value.id)).rejects.toMatchObject({ response: expect.objectContaining({ code: 'AI_CONNECTION_UNAVAILABLE' }) });
  });
  it('permits the effective platform administrator while denying ordinary actors and foreign organizations', async () => {
    const admin = await fixture(['platform:admin']);
    const value = await connections.create(admin.actor, admin.organizationId, input(), randomUUID(), randomUUID());
    expect((await connections.list(admin.actor, admin.organizationId))[0]!.id).toBe(value.id);
    const ordinary = await fixture([]);
    await expect(connections.create(ordinary.actor, ordinary.organizationId, input(), randomUUID(), randomUUID())).rejects.toMatchObject({ status: 403 });
    await expect(connections.list(ordinary.actor, admin.organizationId)).rejects.toMatchObject({ status: 403 });
    const other = await fixture();
    await expect(connections.resolve(other.organizationId, value.id)).rejects.toMatchObject({ response: expect.objectContaining({ code: 'AI_CONNECTION_NOT_FOUND' }) });
    await prisma.organization.update({ where: { id: admin.organizationId }, data: { status: 'DISABLED' } });
    await expect(connections.resolve(admin.organizationId, value.id)).rejects.toMatchObject({ status: 403 });
    await expect(connections.list(admin.actor, admin.organizationId)).rejects.toMatchObject({ status: 403 });
  });
  it('tests using a fixed non-business prompt and generates only selected data without returning key material', async () => {
    const fixtureValue = await fixture();
    const value = await connections.create(fixtureValue.actor, fixtureValue.organizationId, input(), randomUUID(), randomUUID());
    const tested = await connections.test(fixtureValue.actor, fixtureValue.organizationId, value.id, { expectedVersion: 1 }, randomUUID(), randomUUID());
    expect(tested).toMatchObject({ status: 'SUCCESS', code: 'AI_CONNECTION_OK' }); safe(tested);
    expect(JSON.stringify(received.at(-1)!.body)).not.toContain('现场焊点');
    const result = await connections.generate(fixtureValue.organizationId, value.id, 1, { model: 'model-test-2', prompt: '只整理事实。', selectedData: [{ label: '现象', value: '现场焊点' }] });
    expect(result).toEqual({ text: '已选字段中的焊点异常。', connectionId: value.id, connectionVersion: 1, model: 'model-test-2' }); safe(result);
    expect(received.at(-1)!.authorization).toBe(`Bearer ${secret}`);
    const body = JSON.stringify(received.at(-1)!.body);
    expect(body).toContain('现场焊点'); expect(body).not.toContain(secret);
    await expect(connections.generate(fixtureValue.organizationId, value.id, 2, { model: 'model-test', prompt: '整理', selectedData: [{ label: '', value: '事实' }] })).rejects.toMatchObject({ response: expect.objectContaining({ code: 'AI_CONNECTION_VERSION_CONFLICT' }) });
    await expect(connections.generate(fixtureValue.organizationId, value.id, 1, { model: 'unapproved-model', prompt: '整理', selectedData: [{ label: '', value: '事实' }] })).rejects.toMatchObject({ response: expect.objectContaining({ code: 'AI_CONNECTION_INVALID' }) });
  });
  it('returns controlled failure status even when a vendor echoes its key in an error', async () => {
    const fixtureValue = await fixture();
    const value = await connections.create(fixtureValue.actor, fixtureValue.organizationId, { ...input(), baseUrl: baseUrl.replace('/v1', '/failure') }, randomUUID(), randomUUID());
    const tested = await connections.test(fixtureValue.actor, fixtureValue.organizationId, value.id, { expectedVersion: 1 }, randomUUID(), randomUUID());
    expect(tested).toMatchObject({ status: 'FAILED', code: 'AI_CONNECTION_REQUEST_FAILED' }); safe(tested);
  });
  it('requires the channel default to belong to its bounded model list', async () => {
    const fixtureValue = await fixture();
    await expect(connections.create(fixtureValue.actor, fixtureValue.organizationId, { ...input(), defaultModel: 'unknown' }, randomUUID(), randomUUID())).rejects.toMatchObject({ response: expect.objectContaining({ code: 'AI_CONNECTION_INVALID' }) });
  });
  it('defaults legacy rows and missing input to Chat Completions and includes protocol in all projections', async () => {
    const value = await fixture();
    const created = await connections.create(value.actor, value.organizationId, input(), randomUUID(), randomUUID());
    expect(created).toHaveProperty('protocol', 'OPENAI_CHAT_COMPLETIONS');
    expect(await connections.resolve(value.organizationId, created.id)).toHaveProperty('protocol', 'OPENAI_CHAT_COMPLETIONS');
    expect((await connections.list(value.actor, value.organizationId))[0]).toHaveProperty('protocol', 'OPENAI_CHAT_COMPLETIONS');
    const id = randomUUID();
    await prisma.$executeRaw`INSERT INTO ai_connections (id,organization_id,name,base_url,models,default_model,enabled) VALUES (${id}::uuid,${value.organizationId}::uuid,'legacy','https://model.example/v1',ARRAY['test-model'],'test-model',false)`;
    const [legacy] = await prisma.$queryRaw<Array<{ protocol: string }>>`SELECT protocol FROM ai_connections WHERE id=${id}::uuid`;
    expect(legacy!.protocol).toBe('OPENAI_CHAT_COMPLETIONS');
    for (const protocol of ['SYSTEM_ONE', null]) {
      await expect(prisma.$executeRaw`UPDATE ai_connections SET protocol=${protocol} WHERE id=${id}::uuid`).rejects.toThrow();
    }
    const [missing] = await prisma.$queryRaw<Array<{ total: number }>>`SELECT count(*)::int AS total FROM ai_connections WHERE protocol IS NULL`;
    expect(missing!.total).toBe(0);
  });
  it.each(['OPENAI_RESPONSES', 'ANTHROPIC_MESSAGES', 'GEMINI_GENERATE_CONTENT'] as const)('persists %s, binds protocol replacement to a key and generates via the stored adapter', async protocol => {
    const value = await fixture();
    const created = await connections.create(value.actor, value.organizationId, input(), randomUUID(), randomUUID());
    const blankUpdate = { ...input(), protocol, apiKey: '', expectedVersion: 1 };
    await expect(connections.update(value.actor, value.organizationId, created.id, blankUpdate, randomUUID(), randomUUID())).rejects.toMatchObject({ response: expect.objectContaining({ code: 'AI_CONNECTION_INVALID' }) });
    const update = { ...blankUpdate, apiKey: secret };
    const changed = await connections.update(value.actor, value.organizationId, created.id, update, randomUUID(), randomUUID());
    expect(changed).toHaveProperty('protocol', protocol);
    expect(await connections.resolve(value.organizationId, created.id)).toHaveProperty('protocol', protocol);
    const generated = await connections.generate(value.organizationId, created.id, 2, { model: 'model-test-2', prompt: '只整理事实。', selectedData: [{ label: '事实', value: '验证协议' }] });
    expect(generated.text).toBe('协议真实传输。');
    const request = received.at(-1)!;
    if (protocol === 'OPENAI_RESPONSES') expect(request).toMatchObject({ path: '/v1/responses', authorization: `Bearer ${secret}` });
    if (protocol === 'ANTHROPIC_MESSAGES') expect(request).toMatchObject({ path: '/v1/messages', anthropicKey: secret });
    if (protocol === 'GEMINI_GENERATE_CONTENT') expect(request).toMatchObject({ path: '/v1/models/model-test-2:generateContent', googleKey: secret });
    safe(generated);
    const events = await prisma.auditEvent.findMany({ where: { resourceId: created.id, action: 'AI_CONNECTION_UPDATED' } });
    expect(events[0]).toMatchObject({ metadata: expect.objectContaining({ protocol }) });
    const directInput = { ...input(), protocol };
    const direct = await connections.create(value.actor, value.organizationId, directInput, randomUUID(), randomUUID());
    expect(direct).toHaveProperty('protocol', protocol);
    expect((await connections.list(value.actor, value.organizationId)).find(row => row.id === direct.id)).toHaveProperty('protocol', protocol);
  });
});
