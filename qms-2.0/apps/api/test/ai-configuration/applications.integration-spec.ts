import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { PrismaService } from '../../src/database/prisma.service.js';
import { AdminMutationService } from '../../src/common/security/admin-mutation.service.js';
import { AuditLogService } from '../../src/modules/audit-log/audit-log.service.js';
import { AiConnectionService } from '../../src/modules/ai-configuration/ai-connection.service.js';
import { AiApplicationService } from '../../src/modules/ai-configuration/ai-application.service.js';
import { isDisposableLoopbackPostgres } from '../disposable-postgres.js';

if (process.env.QMS_DISPOSABLE_TEST_DB !== 'true' || !isDisposableLoopbackPostgres(process.env.DATABASE_URL)) throw new Error('Application tests require disposable PostgreSQL');
describe('central prompt applications with PostgreSQL and actual model requests', () => {
  const prisma = new PrismaService(), audit = new AuditLogService(prisma), mutations = new AdminMutationService(prisma, audit);
  const connections = new AiConnectionService(prisma, mutations, audit);
  const applications = new AiApplicationService(prisma, mutations, connections, audit);
  let server: Server, baseUrl: string, payload: string, release: (() => void) | undefined, started: (() => void) | undefined;
  const originalNodeEnv = process.env.NODE_ENV;
  beforeAll(async () => {
    process.env.NODE_ENV = 'test'; await prisma.$connect();
    server = createServer((request, response) => {
      let body = ''; request.on('data', chunk => { body += String(chunk); });
      request.on('end', () => { payload = body; const finish = () => response.end(JSON.stringify({ choices: [{ message: { content: '已整理的现场事实' } }] }));
        if (started) { release = finish; started(); } else finish(); });
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
  });
  afterAll(async () => { server?.closeAllConnections(); await new Promise<void>(resolve => server?.close(() => resolve())); await prisma.$disconnect();
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = originalNodeEnv; });
  async function fixture(codes = ['ai:applications:read', 'ai:applications:manage', 'ai:applications:publish', 'ai:applications:test', 'ai:connections:manage', 'ai:credentials:manage', 'audit:read', 'ingestion:read', 'process-quality:defects:read']) {
    const organization = await prisma.organization.create({ data: { code: randomUUID(), name: 'Application disposable scope', type: 'INTERNAL' } });
    const user = await prisma.user.create({ data: { organizationId: organization.id, username: randomUUID(), passwordHash: 'test-only', accountType: 'INTERNAL' } });
    const session = await prisma.session.create({ data: { userId: user.id, tokenHash: randomUUID(), expiresAt: new Date(Date.now() + 3600000), reauthenticatedAt: new Date(), mfaVerifiedAt: new Date() } });
    const role = await prisma.role.create({ data: { organizationId: organization.id, code: randomUUID(), name: 'Application grants' } });
    for (const code of codes) { const permission = await prisma.permission.upsert({ where: { code }, create: { code, name: code }, update: {} }); await prisma.rolePermission.create({ data: { roleId: role.id, permissionId: permission.id } }); }
    await prisma.userRole.create({ data: { organizationId: organization.id, userId: user.id, roleId: role.id } });
    const actor = { id: user.id, organizationId: organization.id, accountType: 'INTERNAL' as const, sessionId: session.id };
    return { actor, organizationId: organization.id, role, session };
  }
  async function setup() {
    const scope = await fixture();
    const connection = await connections.create(scope.actor, scope.organizationId, { name: '样本渠道', baseUrl, models: ['sample-model'], defaultModel: 'sample-model', enabled: true, apiKey: 'disposable-application-key' }, randomUUID(), randomUUID());
    const input = { name: '现场事实', domain: 'PROCESS_QUALITY' as const, scene: 'PROCESS_DEFECT_DESCRIPTION' as const, enabled: true,
      variables: [{ variable: 'fact', label: '现象' }], connectionId: connection.id, model: 'sample-model', prompt: '整理{{fact}}',
      output: { mode: 'TEXT' as const, field: 'description', target: 'description' as const }, fallback: 'DIRECT' as const };
    return { ...scope, connection, input };
  }
  it('creates paginated drafts and publishes immutable revisions with CAS and explicit binding', async () => {
    const scope = await setup();
    const draft = await applications.create(scope.actor, scope.organizationId, scope.input, randomUUID(), randomUUID());
    expect(draft).toMatchObject({ version: 1, publishedVersion: null });
    expect(await applications.list(scope.actor, scope.organizationId, { page: 1, limit: 1 })).toMatchObject({ total: 1, page: 1, limit: 1, items: [{ id: draft.id }] });
    await expect(prisma.$transaction(tx => applications.resolveBinding(tx, scope.actor, { applicationId: draft.id, publishedVersion: 1, inputFields: [{ path: 'fact', variable: 'fact' }] }))).rejects.toMatchObject({ status: 404 });
    const published = await applications.publish(scope.actor, scope.organizationId, draft.id, { expectedVersion: 1 }, randomUUID(), randomUUID());
    expect(published).toMatchObject({ version: 2, publishedVersion: 1 });
    await expect(applications.update(scope.actor, scope.organizationId, draft.id, { ...scope.input, expectedVersion: 1 }, randomUUID(), randomUUID())).rejects.toMatchObject({ status: 409 });
    const revised = await applications.update(scope.actor, scope.organizationId, draft.id, { ...scope.input, prompt: '新版{{fact}}', expectedVersion: 2 }, randomUUID(), randomUUID());
    const latest = await applications.publish(scope.actor, scope.organizationId, draft.id, { expectedVersion: revised.version }, randomUUID(), randomUUID());
    expect(latest.publishedVersion).toBe(2);
    const original = await applications.readRevision(scope.actor, scope.organizationId, draft.id, 1);
    expect(original.configuration.prompt).toBe('整理{{fact}}');
    const bound = await prisma.$transaction(tx => applications.resolveBinding(tx, scope.actor, { applicationId: draft.id, publishedVersion: 1, inputFields: [{ path: 'ims.symptom', variable: 'fact' }] }));
    expect(bound.aiDescription).toMatchObject({ prompt: '整理{{fact}}', inputFields: [{ path: 'ims.symptom', variable: 'fact', label: '现象' }] });
    await expect(prisma.$executeRaw`UPDATE ai_prompt_application_revisions SET configuration='{}'::jsonb WHERE application_id=${draft.id}::uuid`).rejects.toThrow();
  });
  it('does not infer application publication or sample testing from draft maintenance', async () => {
    const scope = await setup();
    const draft = await applications.create(scope.actor, scope.organizationId, scope.input, randomUUID(), randomUUID());
    await prisma.rolePermission.deleteMany({ where: { roleId: scope.role.id, permission: { code: { in: ['ai:applications:publish', 'ai:applications:test'] } } } });
    await expect(applications.publish(scope.actor, scope.organizationId, draft.id, { expectedVersion: 1 }, randomUUID(), randomUUID())).rejects.toMatchObject({ status: 403 });
    await expect(applications.test(scope.actor, scope.organizationId, draft.id, { expectedVersion: 1, samples: [{ variable: 'fact', value: '现场' }] }, randomUUID(), randomUUID())).rejects.toMatchObject({ status: 403 });
    expect(await applications.update(scope.actor, scope.organizationId, draft.id, { ...scope.input, expectedVersion: 1, name: '仅维护草稿' }, randomUUID(), randomUUID())).toMatchObject({ version: 2 });
  });
  it('rechecks grants on replay, denies foreign scope, and allows effective platform administrators', async () => {
    const scope = await setup(), key = randomUUID();
    const draft = await applications.create(scope.actor, scope.organizationId, scope.input, randomUUID(), key);
    expect(await applications.create(scope.actor, scope.organizationId, scope.input, randomUUID(), key)).toEqual(draft);
    await prisma.rolePermission.deleteMany({ where: { roleId: scope.role.id } });
    await expect(applications.create(scope.actor, scope.organizationId, scope.input, randomUUID(), key)).rejects.toMatchObject({ status: 403 });
    const foreign = await fixture();
    await expect(applications.read(foreign.actor, scope.organizationId, draft.id)).rejects.toMatchObject({ status: 403 });
    const ordinary = await fixture([]);
    await expect(applications.list(ordinary.actor, ordinary.organizationId, {})).rejects.toMatchObject({ status: 403 });
    const admin = await fixture(['platform:admin']);
    const channel = await connections.create(admin.actor, admin.organizationId, { name: '管理员渠道', baseUrl, models: ['sample-model'], defaultModel: 'sample-model', enabled: true, apiKey: 'disposable-admin-application-key' }, randomUUID(), randomUUID());
    expect(await applications.create(admin.actor, admin.organizationId, { ...scope.input, connectionId: channel.id }, randomUUID(), randomUUID())).toMatchObject({ organizationId: admin.organizationId });
  });
  it('rejects cross-organization channels and allows draft creation after step-up expires', async () => {
    const scope = await setup(), foreign = await fixture();
    await expect(applications.create(foreign.actor, foreign.organizationId, scope.input, randomUUID(), randomUUID())).rejects.toMatchObject({ response: { code: 'AI_CONNECTION_NOT_FOUND' } });
    await prisma.session.update({ where: { id: scope.session.id }, data: { reauthenticatedAt: new Date(Date.now() - 3600000), mfaVerifiedAt: new Date(Date.now() - 3600000) } });
    await expect(applications.create(scope.actor, scope.organizationId, scope.input, randomUUID(), randomUUID())).resolves.toMatchObject({ id: expect.any(String) });
  });
  it('runs only explicit samples outside transactions without persisting sample or response plaintext in mutation receipts', async () => {
    const scope = await setup();
    const draft = await applications.create(scope.actor, scope.organizationId, scope.input, randomUUID(), randomUUID());
    const input = { expectedVersion: 1, samples: [{ variable: 'fact', value: '受控样本敏感事实' }] }, key = randomUUID();
    const traceId = randomUUID();
    expect(await applications.test(scope.actor, scope.organizationId, draft.id, input, traceId, key)).toMatchObject({ status: 'SUCCESS', text: '已整理的现场事实' });
    expect(payload).toContain('受控样本敏感事实'); expect(payload).not.toContain('disposable-application-key');
    const receipts = await prisma.adminMutation.findMany({ where: { organizationId: scope.organizationId } });
    const events = await prisma.auditEvent.findMany({ where: { organizationId: scope.organizationId } });
    for (const value of [receipts, events]) { expect(JSON.stringify(value)).not.toContain('受控样本敏感事实'); expect(JSON.stringify(value)).not.toContain('已整理的现场事实'); }
    expect(await applications.test(scope.actor, scope.organizationId, draft.id, input, randomUUID(), key)).toMatchObject({ status: 'SUCCESS' });
    const next = await connections.create(scope.actor, scope.organizationId, { name: '新渠道', baseUrl, models: ['next-model'], defaultModel: 'next-model', enabled: true, apiKey: 'disposable-next-application-key' }, randomUUID(), randomUUID());
    await applications.update(scope.actor, scope.organizationId, draft.id, { ...scope.input, expectedVersion: 1, connectionId: next.id, model: 'next-model', output: { ...scope.input.output, mode: 'JSON' } }, randomUUID(), randomUUID());
    expect(await applications.test(scope.actor, scope.organizationId, draft.id, { ...input, expectedVersion: 2 }, randomUUID(), randomUUID())).toMatchObject({ status: 'FAILED' });
    const original = { connectionId: scope.connection.id, connectionVersion: scope.connection.version, model: 'sample-model', outputMode: 'TEXT' };
    expect(events.find(event => event.action === 'AI_APPLICATION_TESTED' && event.traceId === traceId)?.metadata).toEqual({ resourceVersion: 1, reasonCode: 'AI_APPLICATION_OK', ...original });
    expect(receipts.find(receipt => receipt.key === key)?.response).toEqual({ value: { applicationId: draft.id, version: 1, connectionVersion: scope.connection.version } });
    const history = await applications.listInvocations(scope.actor, scope.organizationId, draft.id, {});
    expect(history.items.find(record => record.traceId === traceId)).toMatchObject({ status: 'SUCCESS', applicationVersion: 1, ...original });
    expect(history.items.find(record => record.status === 'FAILED')).toMatchObject({ applicationVersion: 2, connectionId: next.id, connectionVersion: next.version, model: 'next-model', outputMode: 'JSON' });
  });
  it('rechecks application CAS and actor access after an in-flight model request', async () => {
    const scope = await setup();
    const draft = await applications.create(scope.actor, scope.organizationId, scope.input, randomUUID(), randomUUID());
    const waiting = new Promise<void>(resolve => { started = resolve; });
    const result = applications.test(scope.actor, scope.organizationId, draft.id, { expectedVersion: 1, samples: [{ variable: 'fact', value: '现场' }] }, randomUUID(), randomUUID());
    await waiting;
    await applications.update(scope.actor, scope.organizationId, draft.id, { ...scope.input, enabled: false, expectedVersion: 1 }, randomUUID(), randomUUID());
    started = undefined; release!();
    await expect(result).rejects.toMatchObject({ status: 409 });
  });
  it('imports legacy inline settings once and keeps path mapping local to its binding', async () => {
    const scope = await setup();
    const ai = { connectionId: scope.connection.id, model: scope.input.model, prompt: scope.input.prompt,
      inputFields: [{ path: 'ims.fact', variable: 'fact', label: '现象：\n\t' }], output: scope.input.output };
    const first = await prisma.$transaction(tx => applications.importLegacy(tx, scope.actor, '原规则', ai));
    const replay = await prisma.$transaction(tx => applications.importLegacy(tx, scope.actor, '原规则', ai));
    expect(replay.binding).toEqual(first.binding);
    expect(first.aiDescription).toMatchObject(ai);
    const application = await applications.read(scope.actor, scope.organizationId, first.binding.applicationId);
    const published = await applications.publish(scope.actor, scope.organizationId, application.id, { expectedVersion: application.version }, randomUUID(), randomUUID());
    const rebound = await prisma.$transaction(tx => applications.resolveBinding(tx, scope.actor, { ...first.binding, publishedVersion: published.publishedVersion! }));
    expect(rebound.aiDescription.inputFields).toEqual(ai.inputFields);
    expect((await applications.list(scope.actor, scope.organizationId, {})).total).toBe(1);
  });
});
