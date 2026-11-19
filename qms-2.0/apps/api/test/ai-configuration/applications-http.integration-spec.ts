import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../../src/app.module.js';
import { GlobalExceptionFilter } from '../../src/common/contracts/global-exception.filter.js';
import { PrismaService } from '../../src/database/prisma.service.js';
import { SessionService } from '../../src/modules/identity/session.service.js';
import { isDisposableLoopbackPostgres } from '../disposable-postgres.js';

if (process.env.QMS_DISPOSABLE_TEST_DB !== 'true' || !isDisposableLoopbackPostgres(process.env.DATABASE_URL)) throw new Error('Application HTTP tests require disposable PostgreSQL');
describe('prompt application authenticated HTTP boundary', () => {
  let app: INestApplication, prisma: PrismaService;
  const path = '/api/v1/admin/ai-applications', csrf = randomUUID();
  beforeAll(async () => {
    app = (await Test.createTestingModule({ imports: [AppModule] }).compile()).createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new GlobalExceptionFilter()); await app.init(); prisma = app.get(PrismaService);
  }, 20000);
  afterAll(async () => { await app?.close(); });
  async function identity(codes: string[], organizationId?: string) {
    const organization = organizationId ? { id: organizationId } : await prisma.organization.create({ data: { code: randomUUID(), name: 'Application HTTP disposable', type: 'INTERNAL' } });
    const user = await prisma.user.create({ data: { organizationId: organization.id, username: randomUUID(), passwordHash: 'test-only', accountType: 'INTERNAL' } });
    const role = await prisma.role.create({ data: { organizationId: organization.id, code: randomUUID(), name: 'Application HTTP permissions' } });
    for (const code of codes) { const permission = await prisma.permission.upsert({ where: { code }, create: { code, name: code }, update: {} }); await prisma.rolePermission.create({ data: { roleId: role.id, permissionId: permission.id } }); }
    await prisma.userRole.create({ data: { organizationId: organization.id, userId: user.id, roleId: role.id } });
    const token = await app.get(SessionService).create(user.id, prisma, { reauthenticated: true, mfaVerified: true });
    return { organizationId: organization.id, userId: user.id, cookie: `qms_session=${token}; qms_csrf=${csrf}` };
  }
  type Identity = Awaited<ReturnType<typeof identity>>;
  const get = (actor: Identity, suffix = '') => request(app.getHttpServer()).get(`${path}${suffix}`).query({ organizationId: actor.organizationId }).set('Cookie', actor.cookie);
  const post = (actor: Identity, suffix: string, body: object, key = randomUUID()) => request(app.getHttpServer()).post(`${path}${suffix}`).query({ organizationId: actor.organizationId }).set('Cookie', actor.cookie).set('x-csrf-token', csrf).set('Idempotency-Key', key).send(body);
  async function settings(actor: Identity) {
    const channel = (await request(app.getHttpServer()).post('/api/v1/admin/ai-connections').query({ organizationId: actor.organizationId }).set('Cookie', actor.cookie).set('x-csrf-token', csrf).set('Idempotency-Key', randomUUID())
      .send({ name: 'HTTP应用渠道', baseUrl: 'https://model.example/v1', models: ['model-a'], defaultModel: 'model-a', enabled: true, apiKey: 'http-only-disposable-application-key' }).expect(201)).body;
    return { name: 'HTTP应用', domain: 'PROCESS_QUALITY', scene: 'PROCESS_DEFECT_DESCRIPTION', enabled: true, connectionId: channel.id, model: 'model-a',
      variables: [{ variable: 'fact', label: '现象' }], prompt: '整理{{fact}}', output: { mode: 'TEXT', field: 'description', target: 'description' }, fallback: 'DIRECT' };
  }
  it('exposes admin and delegated configuration routes with immutable revision reads and no-store', async () => {
    const admin = await identity(['platform:admin']), input = await settings(admin), key = randomUUID();
    const created = (await post(admin, '', input, key).expect(201)).body;
    expect((await post(admin, '', input, key).expect(201)).body).toEqual(created);
    const page = await get(admin).expect(200); expect(page.headers['cache-control']).toBe('no-store'); expect(page.body).toMatchObject({ total: 1, items: [{ id: created.id }] });
    const colleague = await identity(['ai:applications:read', 'ai:applications:manage', 'ai:applications:publish'], admin.organizationId);
    const published = (await post(colleague, `/${created.id}/publish`, { expectedVersion: 1 }).expect(201)).body;
    expect(published).toMatchObject({ version: 2, publishedVersion: 1 });
    expect((await get(colleague, `/${created.id}/revisions/1`).expect(200)).body.configuration).toMatchObject(input);
    await post(colleague, `/${created.id}/publish`, { expectedVersion: 1 }).expect(409);
  });
  it('denies missing authentication, ordinary accounts, read-only writes, CSRF bypass and unsafe body extensions', async () => {
    await request(app.getHttpServer()).get(path).expect(401);
    const ordinary = await identity([]); await get(ordinary).expect(403); await post(ordinary, '', {}).expect(403);
    const manager = await identity(['ai:applications:read', 'ai:applications:manage', 'ai:applications:publish', 'ai:applications:test', 'ai:connections:manage', 'ai:credentials:manage']), input = await settings(manager);
    const reader = await identity(['ai:applications:read'], manager.organizationId);
    await get(reader).expect(200); await post(reader, '', input).expect(403);
    await request(app.getHttpServer()).post(path).query({ organizationId: manager.organizationId }).set('Cookie', manager.cookie).set('Idempotency-Key', randomUUID()).send(input).expect(403);
    await request(app.getHttpServer()).post(path).query({ organizationId: manager.organizationId }).set('Cookie', manager.cookie).set('x-csrf-token', csrf).send(input).expect(400);
    for (const change of [{ apiKey: 'unexpected' }, { domain: 'FUTURE' }, { output: { mode: 'TEXT', field: 'x', target: 'quantity' } }, { variables: [{ variable: 'fact', label: '现象', path: 'private.raw' }] }]) await post(manager, '', { ...input, ...change }).expect(400);
    const other = await identity(['ai:applications:read', 'ai:applications:manage']);
    await request(app.getHttpServer()).get(path).query({ organizationId: manager.organizationId }).set('Cookie', other.cookie).expect(403);
  });
  it('pages safe trial audit and runtime task records for exactly one scoped application', async () => {
    const admin = await identity(['platform:admin']), other = await identity(['platform:admin']);
    const input = await settings(admin);
    const created = (await post(admin, '', input).expect(201)).body;
    const sibling = (await post(admin, '', { ...input, name: 'Sibling application' }).expect(201)).body;
    const foreign = (await post(other, '', await settings(other)).expect(201)).body;
    const suffix = `/${created.id}/invocations`, trialTrace = randomUUID();
    const permissions = ['ai:applications:read', 'audit:read', 'ingestion:read', 'process-quality:defects:read'];
    const reader = await identity(permissions, admin.organizationId);
    const directory = await request(app.getHttpServer()).get('/api/v1/admin/organizations').set('Cookie', admin.cookie).expect(200);
    expect(directory.body).toEqual(expect.arrayContaining([expect.objectContaining({ id: admin.organizationId, permissions: expect.arrayContaining(permissions) })]));
    const trial = await prisma.auditEvent.create({ data: { organizationId: admin.organizationId, action: 'AI_APPLICATION_TESTED', resourceType: 'AiApplication', resourceId: created.id, outcome: 'SUCCESS', traceId: trialTrace,
      metadata: { resourceVersion: 1, reasonCode: 'AI_APPLICATION_OK', prompt: 'private audit prompt', sample: 'private sample' }, createdAt: new Date('2026-11-19T00:00:00Z') } });
    await prisma.auditEvent.create({ data: { organizationId: admin.organizationId, action: 'AI_APPLICATION_TESTED', resourceType: 'AiApplication', resourceId: created.id.toUpperCase(), outcome: 'FAILURE', traceId: randomUUID(),
      metadata: { resourceVersion: 1, reasonCode: 'AI_CONNECTION_TIMEOUT' }, createdAt: new Date('2026-11-18T00:00:00Z') } });
    await prisma.auditEvent.create({ data: { organizationId: other.organizationId, action: 'AI_APPLICATION_TESTED', resourceType: 'AiApplication', resourceId: created.id, outcome: 'SUCCESS', traceId: randomUUID() } });
    const defect = await prisma.processDefect.create({ data: { organizationId: admin.organizationId, description: 'private defect body', createdById: admin.userId, updatedById: admin.userId } });
    const otherDefect = await prisma.processDefect.create({ data: { organizationId: other.organizationId, description: 'private foreign body', createdById: other.userId, updatedById: other.userId } });
    const task = randomUUID();
    for (const [id, application, target] of [[task, created.id, defect], [randomUUID(), sibling.id, defect], [randomUUID(), null, defect], [randomUUID(), created.id, otherDefect]]) {
      const output = id === task ? { mode: 'JSON', field: 'private output field', target: 'description' } : {};
      await prisma.$executeRaw`INSERT INTO integration_ai_description_tasks(id,organization_id,defect_id,rule_id,rule_version,connection_id,connection_version,input_digest,input_fields,prompt,model,output_configuration,actor_snapshot,expected_description,input_revision,status,attempts,result,error_code,application_id,application_version,updated_at)
        VALUES(${id}::uuid,${target.organizationId}::uuid,${target.id}::uuid,${randomUUID()}::uuid,1,${input.connectionId}::uuid,3,'digest','{}','private runtime prompt','runtime-model',${JSON.stringify(output)}::jsonb,'{}','private fallback',0,'FAILED',2,'private result','AI_CONNECTION_TIMEOUT',${application}::uuid,${application ? 4 : null}::integer,'2026-11-19T01:00:00Z')`;
    }
    const first = await get(admin, suffix).query({ page: 1, limit: 1 }).expect(200);
    expect(first.headers['cache-control']).toBe('no-store');
    expect(first.body).toEqual({ total: 3, page: 1, limit: 1, items: [{ id: task, organizationId: admin.organizationId, source: 'RUNTIME_TASK', applicationVersion: 4, connectionId: input.connectionId, connectionVersion: 3, model: 'runtime-model', outputMode: 'JSON', status: 'FAILED', attempts: 2, errorCode: 'AI_CONNECTION_TIMEOUT', recordedAt: '2026-11-19T01:00:00.000Z', taskId: task, traceId: null }] });
    expect((await get(reader, `/${sibling.id}/invocations`).expect(200)).body.items).toMatchObject([{ outputMode: null }]);
    const second = await get(reader, suffix).query({ page: 2, limit: 1 }).expect(200);
    expect(second.body).toEqual({ total: 3, page: 2, limit: 1, items: [{ id: trial.id, organizationId: admin.organizationId, source: 'APPLICATION_TEST', applicationVersion: 1, connectionId: null, connectionVersion: null, model: null, outputMode: null, status: 'SUCCESS', attempts: null, errorCode: null, recordedAt: '2026-11-19T00:00:00.000Z', taskId: null, traceId: trialTrace }] });
    await post(admin, `/${created.id}/publish`, { expectedVersion: 1 }).expect(201);
    expect((await get(reader, suffix).query({ page: 3, limit: 1 }).expect(200)).body.items).toMatchObject([{ source: 'APPLICATION_TEST', applicationVersion: 1, connectionId: null, model: null, status: 'FAILED', errorCode: 'AI_CONNECTION_TIMEOUT' }]);
    await get(reader, `/${foreign.id}/invocations`).expect(404);
    await get(reader, suffix).query({ limit: 101 }).expect(400);
    for (const missing of permissions) await get(await identity(permissions.filter(code => code !== missing), admin.organizationId), suffix).expect(403);
    const outOfScope = await identity(permissions, other.organizationId);
    await request(app.getHttpServer()).get(`${path}${suffix}`).query({ organizationId: admin.organizationId }).set('Cookie', outOfScope.cookie).expect(403);
    await prisma.session.updateMany({ where: { userId: reader.userId }, data: { reauthenticatedAt: null } });
    await get(reader, suffix).expect(200);
    await prisma.user.update({ where: { id: reader.userId }, data: { status: 'DISABLED' } });
    await get(reader, suffix).expect(401);
    await prisma.organization.update({ where: { id: admin.organizationId }, data: { status: 'DISABLED', configurationRequired: true } });
    await get(admin, suffix).expect(401);
    await request(app.getHttpServer()).get(`${path}${suffix}`).query({ organizationId: admin.organizationId }).set('Cookie', other.cookie).expect(403);
  }, 15000);
});
