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
    return { organizationId: organization.id, cookie: `qms_session=${token}; qms_csrf=${csrf}` };
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
    const colleague = await identity(['configuration:read', 'configuration:manage'], admin.organizationId);
    const published = (await post(colleague, `/${created.id}/publish`, { expectedVersion: 1 }).expect(201)).body;
    expect(published).toMatchObject({ version: 2, publishedVersion: 1 });
    expect((await get(colleague, `/${created.id}/revisions/1`).expect(200)).body.configuration).toMatchObject(input);
    await post(colleague, `/${created.id}/publish`, { expectedVersion: 1 }).expect(409);
  });
  it('denies missing authentication, ordinary accounts, read-only writes, CSRF bypass and unsafe body extensions', async () => {
    await request(app.getHttpServer()).get(path).expect(401);
    const ordinary = await identity([]); await get(ordinary).expect(403); await post(ordinary, '', {}).expect(403);
    const manager = await identity(['configuration:read', 'configuration:manage']), input = await settings(manager);
    const reader = await identity(['configuration:read'], manager.organizationId);
    await get(reader).expect(200); await post(reader, '', input).expect(403);
    await request(app.getHttpServer()).post(path).query({ organizationId: manager.organizationId }).set('Cookie', manager.cookie).set('Idempotency-Key', randomUUID()).send(input).expect(403);
    await request(app.getHttpServer()).post(path).query({ organizationId: manager.organizationId }).set('Cookie', manager.cookie).set('x-csrf-token', csrf).send(input).expect(400);
    for (const change of [{ apiKey: 'unexpected' }, { domain: 'FUTURE' }, { output: { mode: 'TEXT', field: 'x', target: 'quantity' } }, { variables: [{ variable: 'fact', label: '现象', path: 'private.raw' }] }]) await post(manager, '', { ...input, ...change }).expect(400);
    const other = await identity(['configuration:read', 'configuration:manage']);
    await request(app.getHttpServer()).get(path).query({ organizationId: manager.organizationId }).set('Cookie', other.cookie).expect(403);
  });
});
