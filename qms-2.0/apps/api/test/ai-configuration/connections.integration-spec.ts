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
  let received: Array<{ authorization?: string; body: unknown }> = [];
  const originalNode = process.env.NODE_ENV;
  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    await prisma.$connect();
    server = createServer((request, response) => {
      let body = '';
      request.on('data', chunk => { body += String(chunk); });
      request.on('end', () => {
        received.push({ authorization: request.headers.authorization, body: JSON.parse(body) });
        if (request.url?.startsWith('/failure')) { response.statusCode = 401; response.end(secret); return; }
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

  async function fixture(codes = ['configuration:read', 'configuration:manage'], organizationId?: string) {
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
  it('stores only encrypted credentials while create/list/replay/admin-mutation/audit remain secret-free', async () => {
    const fixtureValue = await fixture();
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
});
