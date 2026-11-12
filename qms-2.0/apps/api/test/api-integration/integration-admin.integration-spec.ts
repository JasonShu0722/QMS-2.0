import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Client } from 'pg';
import { AppModule } from '../../src/app.module.js';
import { PrismaService } from '../../src/database/prisma.service.js';
import { SessionService } from '../../src/modules/identity/session.service.js';
import { GlobalExceptionFilter } from '../../src/common/contracts/global-exception.filter.js';
import { isDisposableLoopbackPostgres } from '../disposable-postgres.js';

if (!isDisposableLoopbackPostgres(process.env.DATABASE_URL) || process.env.QMS_DISPOSABLE_TEST_DB !== 'true') throw new Error('Integration administration requires disposable PostgreSQL.');

const path = '/api/v1/admin/integrations/endpoints';
const permissions = ['integration:read', 'integration:manage', 'integration:credentials:manage', 'integration:receipts:read'];

describe('API integration administration through real HTTP and PostgreSQL', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let sessions: SessionService;
  const organizations: string[] = [];
  beforeAll(async () => {
    app = (await Test.createTestingModule({ imports: [AppModule] }).compile()).createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init();
    prisma = app.get(PrismaService); sessions = app.get(SessionService);
    for (const code of [...permissions, 'platform:admin']) await prisma.permission.upsert({ where: { code }, create: { code, name: code }, update: {} });
  });
  afterAll(async () => {
    if (prisma && organizations.length) {
      await prisma.$executeRaw`DELETE FROM integration_credentials WHERE organization_id = ANY(${organizations}::uuid[])`;
      await prisma.$executeRaw`DELETE FROM integration_endpoints WHERE organization_id = ANY(${organizations}::uuid[])`;
      await prisma.$executeRaw`DELETE FROM integration_scope_capacities WHERE organization_id = ANY(${organizations}::uuid[])`;
      const where = { organizationId: { in: organizations } };
      await prisma.auditEvent.deleteMany({ where }); await prisma.adminMutation.deleteMany({ where });
      await prisma.userRole.deleteMany({ where }); await prisma.user.deleteMany({ where }); await prisma.role.deleteMany({ where });
      await prisma.organization.deleteMany({ where: { id: { in: organizations } } });
    }
    await app?.close();
  });
  async function fixture(codes = permissions, accountType: 'INTERNAL' | 'SUPPLIER' = 'INTERNAL') {
    const organization = await prisma.organization.create({ data: { code: randomUUID(), name: 'Integration administration fixture', type: accountType } });
    organizations.push(organization.id);
    const user = await prisma.user.create({ data: { organizationId: organization.id, username: randomUUID(), passwordHash: 'not-a-login-credential', accountType } });
    if (codes.length) {
      const granted = await prisma.permission.findMany({ where: { code: { in: codes } } });
      const role = await prisma.role.create({ data: { organizationId: organization.id, code: randomUUID(), name: 'Integration fixture', permissions: { create: granted.map(({ id }) => ({ permissionId: id })) } } });
      await prisma.userRole.create({ data: { organizationId: organization.id, userId: user.id, roleId: role.id } });
    }
    const token = await sessions.create(user.id, prisma, { mfaVerified: true });
    await prisma.session.updateMany({ where: { userId: user.id }, data: { reauthenticatedAt: new Date() } });
    return { organization, user, cookie: `qms_session=${token}; qms_csrf=fixture` };
  }
  const input = () => ({ code: `API:${randomUUID()}`, name: 'ERP incoming', sourceCode: 'ERP', sourceName: 'Company ERP' });
  const create = (cookie: string, body = input(), key = randomUUID()) => request(app.getHttpServer()).post(path).set('Cookie', cookie).set('x-csrf-token', 'fixture').set('Idempotency-Key', key).send(body);
  const update = (cookie: string, id: string, body: object) => request(app.getHttpServer()).patch(`${path}/${id}`).set('Cookie', cookie).set('x-csrf-token', 'fixture').set('Idempotency-Key', randomUUID()).send(body);

  it('requires a real session at the integration management endpoint', async () => {
    await request(app.getHttpServer()).get(path).expect(401);
  });
  it('has organization-owned endpoint and credential tables', async () => {
    expect(await prisma.$queryRaw`SELECT to_regclass('public.integration_endpoints')::text AS endpoints, to_regclass('public.integration_credentials')::text AS credentials`)
      .toEqual([{ endpoints: 'integration_endpoints', credentials: 'integration_credentials' }]);
  });
  it('has a configurable organization capacity with a ten GiB ceiling', async () => {
    expect(await prisma.$queryRaw`SELECT column_name FROM information_schema.columns WHERE table_name='integration_scope_capacities' AND column_name='capacity_bytes'`)
      .toEqual([{ column_name: 'capacity_bytes' }]);
    const fixtureValue = await fixture();
    const status = await request(app.getHttpServer()).get('/api/v1/admin/integrations/status').set('Cookie', fixtureValue.cookie).expect(200);
    expect(status.body.capacityBytes).toBe(1073741824);
    await request(app.getHttpServer()).patch('/api/v1/admin/integrations/status').set('Cookie', fixtureValue.cookie).set('x-csrf-token', 'fixture').set('Idempotency-Key', randomUUID())
      .send({ organizationId: fixtureValue.organization.id, capacityBytes: 10737418240 }).expect(200);
    expect((await request(app.getHttpServer()).get('/api/v1/admin/integrations/status').set('Cookie', fixtureValue.cookie).expect(200)).body.capacityBytes).toBe(10737418240);
  });
  it('creates a draft with bounded defaults and an enabled receipt switch', async () => {
    const fixtureValue = await fixture(); const body = input();
    const response = await create(fixtureValue.cookie, body).expect(201);
    expect(response.body).toMatchObject({ organizationId: fixtureValue.organization.id, ...body, status: 'DRAFT', version: 1, returnReceipt: true, maxBodyBytes: 1048576, ratePerMinute: 60, bodyRetentionDays: 7, capacityBytes: 268435456, usedBodyBytes: 0, allowedIps: [] });
    expect(response.body.publicUrl).toBe(`https://qms.example.test/api/v1/integrations/inbound/${encodeURIComponent(body.code)}/messages`);
    expect((await request(app.getHttpServer()).get(path).set('Cookie', fixtureValue.cookie).expect(200)).body).toMatchObject({ total: 1, page: 1, limit: 20, items: [expect.objectContaining({ id: response.body.id })] });
  });
  it('accepts a five GiB per-interface capacity ceiling', async () => {
    const fixtureValue = await fixture(); const response = await create(fixtureValue.cookie, { ...input(), capacityBytes: 5368709120 }).expect(201);
    expect(response.body.capacityBytes).toBe(5368709120);
    await create(fixtureValue.cookie, { ...input(), capacityBytes: 5368709121 }).expect(400);
  });
  it('replays creation without another endpoint and rejects a reused key with a different body', async () => {
    const fixtureValue = await fixture(); const body = input(); const key = randomUUID();
    const first = await create(fixtureValue.cookie, body, key).expect(201);
    expect((await create(fixtureValue.cookie, body, key).expect(201)).body).toEqual(first.body);
    await create(fixtureValue.cookie, { ...body, name: 'Changed' }, key).expect(409);
  });
  it('keeps endpoint codes unique within their organization', async () => {
    const fixtureValue = await fixture(); const body = input();
    await create(fixtureValue.cookie, body).expect(201); await create(fixtureValue.cookie, body).expect(409);
    const other = await fixture(); await create(other.cookie, body).expect(201);
  });
  it('does not grant integration management to ordinary unprivileged, read-only or supplier accounts', async () => {
    for (const fixtureValue of [await fixture([]), await fixture(['integration:read']), await fixture(permissions, 'SUPPLIER')]) await create(fixtureValue.cookie).expect(403);
  });
  it('provides console access and endpoint and credential management from the platform marker alone', async () => {
    const administrator = await fixture(['platform:admin']);
    const assigned = await prisma.userRole.findMany({ where: { userId: administrator.user.id }, include: { role: { include: { permissions: { include: { permission: true } } } } } });
    expect(assigned.flatMap(entry => entry.role.permissions.map(({ permission }) => permission.code))).toEqual(['platform:admin']);
    const capabilities = ['integration:read', 'integration:manage', 'integration:credentials:manage', 'integration:receipts:read', 'integration:payload:read'];
    const context = (await request(app.getHttpServer()).get('/api/v1/admin/console/context').set('Cookie', administrator.cookie).expect(200)).body;
    expect(context.hasPlatformAdministrator).toBe(true);
    expect(context.modules.find((item: { key: string }) => item.key === 'api-integrations')).toEqual({
      key: 'api-integrations', organizationId: administrator.organization.id, scope: 'TARGET', coverage: 'ORGANIZATION', permissions: [...capabilities].sort(),
    });
    const endpoint = (await create(administrator.cookie).expect(201)).body;
    await request(app.getHttpServer()).get(`${path}/${endpoint.id}`).set('Cookie', administrator.cookie).expect(200);
    const credentialPath = `${path}/${endpoint.id}/credentials`;
    const credential = (await request(app.getHttpServer()).post(credentialPath).set('Cookie', administrator.cookie).set('x-csrf-token', 'fixture').set('Idempotency-Key', randomUUID()).send({ name: 'Default administrator credential' }).expect(201)).body;
    const credentials = (await request(app.getHttpServer()).get(credentialPath).set('Cookie', administrator.cookie).expect(200)).body;
    expect(credentials.items).toEqual([expect.objectContaining({ id: credential.id })]);
    expect(credentials.items.every((item: object) => !Object.hasOwn(item, 'secret'))).toBe(true);
    await request(app.getHttpServer()).post(`${credentialPath}/${credential.id}/revoke`).set('Cookie', administrator.cookie).set('x-csrf-token', 'fixture').set('Idempotency-Key', randomUUID()).send({}).expect(201);
    await request(app.getHttpServer()).get('/api/v1/admin/integrations/receipts').set('Cookie', administrator.cookie).expect(200);
    const target = await fixture([]);
    const body = { ...input(), organizationId: target.organization.id };
    const targetEndpoint = (await create(administrator.cookie, body).expect(201)).body;
    expect(targetEndpoint.organizationId).toBe(target.organization.id);
    const supplier = await fixture([], 'SUPPLIER');
    await request(app.getHttpServer()).get('/api/v1/admin/console/context').query({ organizationId: supplier.organization.id }).set('Cookie', administrator.cookie).expect(403);
    await create(administrator.cookie, { ...input(), organizationId: supplier.organization.id } as typeof body).expect(403);
    await prisma.organization.update({ where: { id: target.organization.id }, data: { status: 'DISABLED' } });
    const disabledContext = (await request(app.getHttpServer()).get('/api/v1/admin/console/context').query({ organizationId: target.organization.id }).set('Cookie', administrator.cookie).expect(200)).body;
    expect(disabledContext.modules.some((item: { key: string }) => item.key === 'api-integrations')).toBe(false);
    await create(administrator.cookie, body).expect(403);
  });
  it('denies cross-organization reads and writes even with a valid resource identifier', async () => {
    const first = await fixture(); const second = await fixture();
    const endpoint = (await create(first.cookie).expect(201)).body;
    await request(app.getHttpServer()).get(`${path}/${endpoint.id}`).set('Cookie', second.cookie).expect(404);
    await request(app.getHttpServer()).get(path).query({ organizationId: first.organization.id }).set('Cookie', second.cookie).expect(403);
    await create(second.cookie, { ...input(), organizationId: first.organization.id } as ReturnType<typeof input>).expect(403);
    await update(second.cookie, endpoint.id, { expectedVersion: 1, name: 'Hijack' }).expect(404);
  });
  it('requires CSRF and recent authentication for management writes', async () => {
    const fixtureValue = await fixture();
    await request(app.getHttpServer()).post(path).set('Cookie', fixtureValue.cookie).set('Idempotency-Key', randomUUID()).send(input()).expect(403);
    await prisma.session.updateMany({ where: { userId: fixtureValue.user.id }, data: { reauthenticatedAt: new Date(Date.now() - 600000) } });
    expect((await create(fixtureValue.cookie).expect(403)).body.code).toBe('AUTH_REAUTHENTICATION_REQUIRED');
  });
  it.each([
    ['create endpoint', false], ['create endpoint', true],
    ['update endpoint', false], ['update endpoint', true],
    ['create credential', false], ['create credential', true],
    ['revoke credential', false], ['revoke credential', true],
  ] as const)('rechecks recent authentication after the final resource lock for %s (replay=%s)', async (operation, replay) => {
    const fixtureValue = await fixture(); const endpoint = (await create(fixtureValue.cookie).expect(201)).body;
    const key = randomUUID(), body = input();
    let credentialId: string | undefined;
    if (operation === 'revoke credential') {
      const credential = await request(app.getHttpServer()).post(`${path}/${endpoint.id}/credentials`).set('Cookie', fixtureValue.cookie).set('x-csrf-token', 'fixture').set('Idempotency-Key', randomUUID()).send({ name: 'Will remain controlled' }).expect(201);
      credentialId = credential.body.id;
    }
    const invoke = () => {
      const url = operation === 'create endpoint' ? path : operation === 'update endpoint' ? `${path}/${endpoint.id}` : operation === 'create credential' ? `${path}/${endpoint.id}/credentials` : `${path}/${endpoint.id}/credentials/${credentialId}/revoke`;
      const mutation = operation === 'update endpoint' ? request(app.getHttpServer()).patch(url) : request(app.getHttpServer()).post(url);
      return mutation.set('Cookie', fixtureValue.cookie).set('x-csrf-token', 'fixture').set('Idempotency-Key', key).send(operation === 'create endpoint' ? body : operation === 'update endpoint' ? { expectedVersion: 1, name: 'Waited configuration' } : operation === 'create credential' ? { name: 'Waited credential' } : {});
    };
    if (replay) await invoke().expect(operation === 'update endpoint' ? 200 : 201);
    const blocker = new Client({ connectionString: process.env.DATABASE_URL }); await blocker.connect();
    const blockerPid = (await blocker.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0]!.pid;
    let pending: Promise<request.Response> | undefined;
    try {
      await blocker.query('BEGIN');
      if (operation === 'create endpoint') await blocker.query('SELECT id FROM organizations WHERE id=$1 FOR SHARE', [fixtureValue.organization.id]);
      else if (operation === 'revoke credential') await blocker.query('SELECT id FROM integration_credentials WHERE id=$1 FOR UPDATE', [credentialId]);
      else await blocker.query('SELECT id FROM integration_endpoints WHERE id=$1 FOR UPDATE', [endpoint.id]);
      await prisma.session.updateMany({ where: { userId: fixtureValue.user.id }, data: { reauthenticatedAt: new Date(Date.now() - 300000 + 1500) } });
      pending = invoke().then(response => response);
      let waiting = false;
      for (let attempt = 0; attempt < 100 && !waiting; attempt++) {
        const [activity] = await prisma.$queryRaw<{ waiting: boolean }[]>`SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND ${blockerPid} = ANY(pg_blocking_pids(pid))) AS waiting`;
        waiting = activity?.waiting ?? false;
        if (!waiting) await new Promise(resolve => setTimeout(resolve, 10));
      }
      expect(waiting).toBe(true);
      await blocker.query('SELECT pg_sleep(1.6)'); await blocker.query('COMMIT');
      const response = await pending;
      expect(response.status).toBe(403); expect(response.body.code).toBe('AUTH_REAUTHENTICATION_REQUIRED');
      expect(response.body.secret).toBeUndefined();
      expect(await prisma.adminMutation.count({ where: { actorUserId: fixtureValue.user.id, key } })).toBe(replay ? 1 : 0);
    } finally { await blocker.query('ROLLBACK'); await blocker.end(); await pending; }
  });
  it('updates only mutable configuration and protects versions', async () => {
    const fixtureValue = await fixture(); const endpoint = (await create(fixtureValue.cookie).expect(201)).body;
    const changed = await update(fixtureValue.cookie, endpoint.id, { expectedVersion: 1, name: 'New label', returnReceipt: false, allowedIps: ['192.0.2.0/24', '2001:db8::/32'] }).expect(200);
    expect(changed.body).toMatchObject({ version: 2, name: 'New label', returnReceipt: false, allowedIps: ['192.0.2.0/24', '2001:db8::/32'] });
    await update(fixtureValue.cookie, endpoint.id, { expectedVersion: 1, returnReceipt: true }).expect(409);
    await update(fixtureValue.cookie, endpoint.id, { expectedVersion: 2, sourceCode: 'Changed' }).expect(400);
    await update(fixtureValue.cookie, endpoint.id, { expectedVersion: 2, code: 'Changed' }).expect(400);
  });
  it('does not enable an endpoint without an active credential', async () => {
    const fixtureValue = await fixture(); const endpoint = (await create(fixtureValue.cookie).expect(201)).body;
    await update(fixtureValue.cookie, endpoint.id, { expectedVersion: 1, status: 'ENABLED' }).expect(409);
    await request(app.getHttpServer()).post(`${path}/${endpoint.id}/credentials`).set('Cookie', fixtureValue.cookie).set('x-csrf-token', 'fixture').set('Idempotency-Key', randomUUID()).send({ name: 'Company ERP' }).expect(201);
    await update(fixtureValue.cookie, endpoint.id, { expectedVersion: 1, status: 'ENABLED' }).expect(200);
  });
  it('rechecks credential expiry against the database clock after waiting for the organization lock', async () => {
    const fixtureValue = await fixture(); const endpoint = (await create(fixtureValue.cookie).expect(201)).body;
    await request(app.getHttpServer()).post(`${path}/${endpoint.id}/credentials`).set('Cookie', fixtureValue.cookie).set('x-csrf-token', 'fixture').set('Idempotency-Key', randomUUID()).send({ name: 'Short remaining life' }).expect(201);
    const blocker = new Client({ connectionString: process.env.DATABASE_URL }); await blocker.connect();
    let pending: Promise<request.Response> | undefined;
    try {
      await blocker.query('BEGIN');
      await blocker.query('SELECT id FROM organizations WHERE id=$1 FOR UPDATE', [fixtureValue.organization.id]);
      await blocker.query("UPDATE integration_credentials SET expires_at=clock_timestamp()+interval '1 second' WHERE endpoint_id=$1", [endpoint.id]);
      pending = update(fixtureValue.cookie, endpoint.id, { expectedVersion: 1, status: 'ENABLED' }).then(response => response);
      let waiting = false;
      for (let attempt = 0; attempt < 100 && !waiting; attempt++) {
        const [activity] = await prisma.$queryRaw<{ waiting: boolean }[]>`SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%organizations%') AS waiting`;
        waiting = activity?.waiting ?? false;
        if (!waiting) await new Promise(resolve => setTimeout(resolve, 10));
      }
      expect(waiting).toBe(true);
      await blocker.query('SELECT pg_sleep(1.1)'); await blocker.query('COMMIT');
      expect((await pending).status).toBe(409);
    } finally { await blocker.query('ROLLBACK'); await blocker.end(); await pending; }
  });
  it('rejects unsupported IP ranges and out-of-bounds configuration', async () => {
    const fixtureValue = await fixture();
    for (const extra of [{ ratePerMinute: 301 }, { maxBodyBytes: 1048577 }, { bodyRetentionDays: 31 }, { allowedIps: ['192.0.2.1/33'] }, { allowedIps: ['hostname.invalid'] }]) await create(fixtureValue.cookie, { ...input(), ...extra }).expect(400);
  });
});
