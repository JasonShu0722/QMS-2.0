import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { Test } from '@nestjs/testing';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { jest } from '@jest/globals';
import request from 'supertest';
import { Client } from 'pg';
import { AppModule } from '../../src/app.module.js';
import { PrismaService } from '../../src/database/prisma.service.js';
import { SessionService } from '../../src/modules/identity/session.service.js';
import { AuditLogService } from '../../src/modules/audit-log/audit-log.service.js';
import { GlobalExceptionFilter } from '../../src/common/contracts/global-exception.filter.js';
import { isDisposableLoopbackPostgres } from '../disposable-postgres.js';
import { configureHttpBodyParser } from '../../src/http-body-parser.js';

if (!isDisposableLoopbackPostgres(process.env.DATABASE_URL) || process.env.QMS_DISPOSABLE_TEST_DB !== 'true') throw new Error('Integration deletion requires disposable PostgreSQL.');

const base = '/api/v1/admin/integrations';
const path = `${base}/endpoints`;
const permissions = ['integration:read', 'integration:manage', 'integration:credentials:manage', 'integration:receipts:read', 'integration:payload:read'];

describe('integration endpoint deletion through real HTTP and PostgreSQL', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let sessions: SessionService;
  const organizations: string[] = [];
  beforeAll(async () => {
    app = (await Test.createTestingModule({ imports: [AppModule] }).compile()).createNestApplication<NestExpressApplication>({ bodyParser: false });
    configureHttpBodyParser(app as NestExpressApplication);
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init(); prisma = app.get(PrismaService); sessions = app.get(SessionService);
    for (const code of permissions) await prisma.permission.upsert({ where: { code }, create: { code, name: code }, update: {} });
  });
  afterAll(async () => {
    if (prisma) {
      const where = { organizationId: { in: organizations } };
      await prisma.integrationRequestAttempt.deleteMany({ where }); await prisma.integrationReceipt.deleteMany({ where });
      await prisma.$executeRaw`DELETE FROM integration_rate_windows WHERE endpoint_id IN (SELECT id FROM integration_endpoints WHERE organization_id=ANY(${organizations}::uuid[]))`;
      await prisma.integrationScopeCapacity.deleteMany({ where }); await prisma.integrationCredential.deleteMany({ where });
      await prisma.integrationEndpoint.deleteMany({ where }); await prisma.auditEvent.deleteMany({ where }); await prisma.adminMutation.deleteMany({ where });
      await prisma.userRole.deleteMany({ where }); await prisma.user.deleteMany({ where }); await prisma.role.deleteMany({ where });
      await prisma.organization.deleteMany({ where: { id: { in: organizations } } });
    }
    await app?.close();
  });
  async function fixture(codes = permissions, accountType: 'INTERNAL' | 'SUPPLIER' = 'INTERNAL') {
    const organization = await prisma.organization.create({ data: { code: randomUUID(), name: 'Endpoint deletion fixture', type: accountType } }); organizations.push(organization.id);
    const user = await prisma.user.create({ data: { organizationId: organization.id, username: randomUUID(), passwordHash: 'unused-fixture-hash', accountType } });
    if (codes.length) {
      const granted = await prisma.permission.findMany({ where: { code: { in: codes } } });
      const role = await prisma.role.create({ data: { organizationId: organization.id, code: randomUUID(), name: 'Deletion fixture', permissions: { create: granted.map(({ id }) => ({ permissionId: id })) } } });
      await prisma.userRole.create({ data: { organizationId: organization.id, userId: user.id, roleId: role.id } });
    }
    const token = await sessions.create(user.id, prisma, { mfaVerified: true });
    await prisma.session.updateMany({ where: { userId: user.id }, data: { reauthenticatedAt: new Date() } });
    const endpoint = await prisma.integrationEndpoint.create({ data: { organizationId: organization.id, code: `DELETE:${randomUUID()}`, name: 'Delete receiver', sourceCode: 'ERP', sourceName: 'Company ERP' } });
    return { organization, user, endpoint, cookie: `qms_session=${token}; qms_csrf=fixture` };
  }
  const remove = (cookie: string, endpointId: string, expectedVersion = 1, key = randomUUID()) => request(app.getHttpServer()).delete(`${path}/${endpointId}`).set('Cookie', cookie).set('x-csrf-token', 'fixture').set('Idempotency-Key', key).send({ expectedVersion });
  const write = (cookie: string, suffix: string, body: object, key = randomUUID()) => request(app.getHttpServer()).post(`${path}/${suffix}`).set('Cookie', cookie).set('x-csrf-token', 'fixture').set('Idempotency-Key', key).send(body);
  const patch = (cookie: string, endpointId: string, body: object) => request(app.getHttpServer()).patch(`${path}/${endpointId}`).set('Cookie', cookie).set('x-csrf-token', 'fixture').set('Idempotency-Key', randomUUID()).send(body);
  const send = (code: string, token: string, key = randomUUID()) => request(app.getHttpServer()).post(`/api/v1/integrations/inbound/${encodeURIComponent(code)}/messages`).set('Authorization', `Bearer ${token}`).set('Idempotency-Key', key).set('Content-Type', 'application/json').send('[{"value":1}]');
  async function credential(item: Awaited<ReturnType<typeof fixture>>, name = 'Delete credential') {
    return (await write(item.cookie, `${item.endpoint.id}/credentials`, { name }).expect(201)).body as { id: string; secret: string };
  }
  async function waitForBlock(blockerPid: number) {
    const deadline = Date.now() + 3000;
    while (Date.now() < deadline) {
      const [row] = await prisma.$queryRaw<{ waiting: boolean }[]>`SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND ${blockerPid}=ANY(pg_blocking_pids(pid))) AS waiting`;
      if (row?.waiting) return;
      await delay(10);
    }
    throw new Error('Request did not reach the real resource row lock.');
  }

  it('deletes an endpoint with HTTP 204', async () => {
    const item = await fixture();
    const response = await remove(item.cookie, item.endpoint.id).expect(204);
    expect(response.text).toBe('');
  });
  it('checks the first version and makes same-key and natural retries harmless', async () => {
    const item = await fixture(), key = randomUUID();
    await remove(item.cookie, item.endpoint.id, 2).expect(409);
    await remove(item.cookie, item.endpoint.id, 1, key).expect(204);
    await remove(item.cookie, item.endpoint.id, 1, key).expect(204);
    await remove(item.cookie, item.endpoint.id, 1).expect(204);
    const [row] = await prisma.$queryRaw<{ status: string; version: number; deletedAt: Date }[]>`SELECT status,version,deleted_at AS "deletedAt" FROM integration_endpoints WHERE id=${item.endpoint.id}::uuid`;
    expect(row).toMatchObject({ status: 'DISABLED', version: 2, deletedAt: expect.any(Date) });
    const audit = await prisma.auditEvent.findMany({ where: { resourceId: item.endpoint.id, action: 'INTEGRATION_ENDPOINT_DELETED' } });
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ resourceType: 'IntegrationEndpoint', outcome: 'SUCCESS', metadata: { endpointId: item.endpoint.id, resourceVersion: 2, status: 'DISABLED' } });
    expect(Object.keys(audit[0]!.metadata as object).sort()).toEqual(['endpointId', 'resourceVersion', 'status']);
    await remove(item.cookie, item.endpoint.id, 2, key).expect(409);
  });
  it('requires session, management permission, CSRF, recent authentication and matching scope', async () => {
    const item = await fixture();
    await request(app.getHttpServer()).delete(`${path}/${item.endpoint.id}`).set('Cookie', 'qms_csrf=fixture').set('x-csrf-token', 'fixture').send({ expectedVersion: 1 }).expect(401);
    for (const candidate of [await fixture([]), await fixture(['integration:read']), await fixture(permissions, 'SUPPLIER')]) await remove(candidate.cookie, candidate.endpoint.id).expect(403);
    await request(app.getHttpServer()).delete(`${path}/${item.endpoint.id}`).set('Cookie', item.cookie).set('Idempotency-Key', randomUUID()).send({ expectedVersion: 1 }).expect(403);
    const other = await fixture(); await remove(other.cookie, item.endpoint.id).expect(404);
    await prisma.session.updateMany({ where: { userId: item.user.id }, data: { reauthenticatedAt: new Date(Date.now() - 600000) } });
    expect((await remove(item.cookie, item.endpoint.id).expect(403)).body.code).toBe('AUTH_REAUTHENTICATION_REQUIRED');
  });
  it.each([{}, { expectedVersion: 0 }, { expectedVersion: 1.5 }, { expectedVersion: '1' }, { expectedVersion: 1, extra: true }])('validates the delete body %j', async body => {
    const item = await fixture();
    await request(app.getHttpServer()).delete(`${path}/${item.endpoint.id}`).set('Cookie', item.cookie).set('x-csrf-token', 'fixture').set('Idempotency-Key', randomUUID()).send(body).expect(400);
  });
  it('revokes every credential, hides all management entrances and preserves queryable history', async () => {
    const item = await fixture(), first = await credential(item), second = await credential(item, 'Second credential');
    await patch(item.cookie, item.endpoint.id, { expectedVersion: 1, status: 'ENABLED' }).expect(200);
    const received = await send(item.endpoint.code, first.secret).expect(200);
    await remove(item.cookie, item.endpoint.id, 2).expect(204);
    expect(await prisma.integrationCredential.count({ where: { endpointId: item.endpoint.id, revokedAt: null } })).toBe(0);
    expect(await prisma.integrationCredential.count({ where: { endpointId: item.endpoint.id } })).toBe(2);
    const list = await request(app.getHttpServer()).get(path).set('Cookie', item.cookie).expect(200);
    expect(list.body).toMatchObject({ total: 0, items: [] });
    for (const suffix of ['', '/credentials', '/connection']) await request(app.getHttpServer()).get(`${path}/${item.endpoint.id}${suffix}`).set('Cookie', item.cookie).expect(404);
    await patch(item.cookie, item.endpoint.id, { expectedVersion: 3, name: 'Resurrect' }).expect(404);
    await write(item.cookie, `${item.endpoint.id}/credentials`, { name: 'Resurrect' }).expect(404);
    await write(item.cookie, `${item.endpoint.id}/credentials/${second.id}/revoke`, {}).expect(404);
    expect(received.body).toBe(true);
    const receivedId = (await prisma.integrationReceipt.findFirstOrThrow({ where: { endpointId: item.endpoint.id }, orderBy: { receivedAt: 'desc' } })).id;
    const receipts = await request(app.getHttpServer()).get(`${base}/receipts`).query({ sourceCode: 'ERP' }).set('Cookie', item.cookie).expect(200);
    expect(receipts.body.items.map((row: { id: string }) => row.id)).toContain(receivedId);
    await request(app.getHttpServer()).get(`${base}/receipts/${receivedId}`).set('Cookie', item.cookie).expect(200);
    await request(app.getHttpServer()).get(`${base}/receipts/${receivedId}/payload`).set('Cookie', item.cookie).expect(200);
    const attempts = await request(app.getHttpServer()).get(`${base}/attempts`).query({ sourceCode: 'ERP' }).set('Cookie', item.cookie).expect(200);
    expect(attempts.body.items.some((row: { endpointId: string }) => row.endpointId === item.endpoint.id)).toBe(true);
    await send(item.endpoint.code, first.secret).expect(401); await send(item.endpoint.id, first.secret).expect(401);
    const recreated = await request(app.getHttpServer()).post(path).set('Cookie', item.cookie).set('x-csrf-token', 'fixture').set('Idempotency-Key', randomUUID()).send({ code: item.endpoint.code, name: 'Replacement', sourceCode: 'ERP', sourceName: 'Company ERP' }).expect(201);
    expect(recreated.body.id).not.toBe(item.endpoint.id);
    await send(item.endpoint.code, first.secret).expect(401);
  });
  it('rolls back deletion and all credential revocations when its required audit fails', async () => {
    const item = await fixture(); await credential(item); await credential(item, 'Second credential');
    const audit = app.get(AuditLogService), original = audit.record.bind(audit), key = randomUUID();
    const injected = jest.spyOn(audit, 'record').mockImplementation(async (input, transaction) => {
      if (input.action === 'INTEGRATION_ENDPOINT_DELETED') throw new Error('injected delete audit failure');
      return original(input, transaction);
    });
    try { await remove(item.cookie, item.endpoint.id, 1, key).expect(500); } finally { injected.mockRestore(); }
    expect(await prisma.integrationCredential.count({ where: { endpointId: item.endpoint.id, revokedAt: null } })).toBe(2);
    expect(await prisma.adminMutation.count({ where: { actorUserId: item.user.id, key } })).toBe(0);
    expect((await request(app.getHttpServer()).get(`${path}/${item.endpoint.id}`).set('Cookie', item.cookie).expect(200)).body).toMatchObject({ version: 1, status: 'DRAFT' });
    await remove(item.cookie, item.endpoint.id, 1, key).expect(204);
  });
  it.each([false, true])('rechecks authentication after the final credential lock, including replay=%s', async replay => {
    const item = await fixture(), issued = await credential(item), key = randomUUID();
    if (replay) await remove(item.cookie, item.endpoint.id, 1, key).expect(204);
    const blocker = new Client({ connectionString: process.env.DATABASE_URL }); await blocker.connect();
    const blockerPid = (await blocker.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0]!.pid;
    let pending: Promise<request.Response> | undefined;
    try {
      await blocker.query('BEGIN'); await blocker.query('SELECT id FROM integration_credentials WHERE id=$1 FOR UPDATE', [issued.id]);
      await prisma.session.updateMany({ where: { userId: item.user.id }, data: { reauthenticatedAt: new Date(Date.now() - 300000 + 1500) } });
      pending = remove(item.cookie, item.endpoint.id, 1, key).then(response => response);
      await waitForBlock(blockerPid); await blocker.query('SELECT pg_sleep(1.6)'); await blocker.query('COMMIT');
      const response = await pending; expect(response.status).toBe(403); expect(response.body.code).toBe('AUTH_REAUTHENTICATION_REQUIRED');
      expect(await prisma.adminMutation.count({ where: { actorUserId: item.user.id, key } })).toBe(replay ? 1 : 0);
    } finally { await blocker.query('ROLLBACK'); await blocker.end(); await pending; }
  });
  it('rechecks current permission before replaying a successful deletion', async () => {
    const item = await fixture(), key = randomUUID(); await remove(item.cookie, item.endpoint.id, 1, key).expect(204);
    await prisma.userRole.deleteMany({ where: { userId: item.user.id } });
    await remove(item.cookie, item.endpoint.id, 1, key).expect(403);
  });
  it('refuses a machine request that authenticated before waiting for a committed deletion', async () => {
    const item = await fixture(), issued = await credential(item);
    await patch(item.cookie, item.endpoint.id, { expectedVersion: 1, status: 'ENABLED' }).expect(200);
    const blocker = new Client({ connectionString: process.env.DATABASE_URL }); await blocker.connect();
    const blockerPid = (await blocker.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0]!.pid;
    let pendingDelete: Promise<request.Response> | undefined, pendingReceive: Promise<request.Response> | undefined;
    try {
      await blocker.query('BEGIN'); await blocker.query('SELECT id FROM organizations WHERE id=$1 FOR UPDATE', [item.organization.id]);
      pendingDelete = remove(item.cookie, item.endpoint.id, 2).then(response => response); await waitForBlock(blockerPid);
      pendingReceive = send(item.endpoint.code, issued.secret).then(response => response);
      const deadline = Date.now() + 3000;
      let waiting = 0;
      while (Date.now() < deadline && waiting < 2) {
        const [row] = await prisma.$queryRaw<{ count: number }[]>`WITH RECURSIVE blocked(pid) AS (
          SELECT ${blockerPid}::int UNION SELECT activity.pid FROM pg_stat_activity activity JOIN blocked parent ON parent.pid=ANY(pg_blocking_pids(activity.pid)) WHERE activity.datname=current_database()
        ) SELECT count(*)::int AS count FROM blocked WHERE pid<>${blockerPid}`;
        waiting = row!.count; if (waiting < 2) await delay(10);
      }
      expect(waiting).toBe(2); await blocker.query('COMMIT'); expect((await pendingDelete).status).toBe(204);
      expect((await pendingReceive).status).toBe(401);
      expect(await prisma.integrationReceipt.count({ where: { endpointId: item.endpoint.id } })).toBe(0);
    } finally { await blocker.query('ROLLBACK'); await blocker.end(); await pendingDelete; await pendingReceive; }
  });
});
