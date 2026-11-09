import 'reflect-metadata';
import { createHash, randomUUID } from 'node:crypto';
import { jest } from '@jest/globals';
import { Test } from '@nestjs/testing';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Client } from 'pg';
import request from 'supertest';
import { AppModule } from '../../src/app.module.js';
import { GlobalExceptionFilter } from '../../src/common/contracts/global-exception.filter.js';
import { PrismaService } from '../../src/database/prisma.service.js';
import { AuditLogService } from '../../src/modules/audit-log/audit-log.service.js';
import { SessionService } from '../../src/modules/identity/session.service.js';
import { isDisposableLoopbackPostgres } from '../disposable-postgres.js';

if (!isDisposableLoopbackPostgres(process.env.DATABASE_URL) || process.env.QMS_DISPOSABLE_TEST_DB !== 'true') throw new Error('Integration connection tests require disposable PostgreSQL.');

const path = '/api/v1/admin/integrations/endpoints';
const permissions = ['integration:manage', 'integration:credentials:manage'];
const action = 'INTEGRATION_CONNECTION_READ';

describe('Audited integration connection reads with real sessions and PostgreSQL', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let sessions: SessionService;
  const organizationIds: string[] = [];

  beforeAll(async () => {
    app = (await Test.createTestingModule({ imports: [AppModule] }).compile()).createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init();
    prisma = app.get(PrismaService); sessions = app.get(SessionService);
    for (const code of permissions) await prisma.permission.upsert({ where: { code }, update: {}, create: { code, name: code } });
  });
  afterAll(async () => {
    if (prisma && organizationIds.length) {
      const where = { organizationId: { in: organizationIds } };
      await prisma.integrationCredential.deleteMany({ where });
      await prisma.integrationEndpoint.deleteMany({ where });
      await prisma.auditEvent.deleteMany({ where });
      await prisma.adminMutation.deleteMany({ where });
      await prisma.userRole.deleteMany({ where });
      await prisma.user.deleteMany({ where });
      await prisma.role.deleteMany({ where });
      await prisma.organization.deleteMany({ where: { id: { in: organizationIds } } });
    }
    await app?.close();
  });

  async function fixture() {
    const organization = await prisma.organization.create({ data: { code: randomUUID(), name: 'Connection fixture', type: 'INTERNAL' } });
    organizationIds.push(organization.id);
    const user = await prisma.user.create({ data: { organizationId: organization.id, username: randomUUID(), accountType: 'INTERNAL', passwordHash: 'unused-test-hash' } });
    const granted = await prisma.permission.findMany({ where: { code: { in: permissions } } });
    const role = await prisma.role.create({ data: { organizationId: organization.id, code: randomUUID(), name: 'Connection manager', permissions: { create: granted.map(({ id }) => ({ permissionId: id })) } } });
    await prisma.userRole.create({ data: { organizationId: organization.id, userId: user.id, roleId: role.id } });
    const token = await sessions.create(user.id, prisma, { mfaVerified: true });
    await prisma.session.updateMany({ where: { userId: user.id }, data: { reauthenticatedAt: new Date() } });
    const endpoint = await prisma.integrationEndpoint.create({ data: { organizationId: organization.id, code: 'ERP:receive', name: 'ERP receiver', sourceCode: 'ERP', sourceName: 'Company ERP' } });
    return { organization, user, role, endpoint, cookie: `qms_session=${token}; qms_csrf=fixture` };
  }
  type Fixture = Awaited<ReturnType<typeof fixture>>;
  const create = (item: Fixture, name = 'ERP credential', validityDays: number | null = 1, key = randomUUID()) => request(app.getHttpServer())
    .post(`${path}/${item.endpoint.id}/credentials`).set('Cookie', item.cookie).set('x-csrf-token', 'fixture').set('Idempotency-Key', key)
    .send({ name, validityDays });
  const connection = (item: Fixture, credentialId?: string) => request(app.getHttpServer()).get(`${path}/${item.endpoint.id}/connection`)
    .query({ organizationId: item.organization.id, ...(credentialId ? { credentialId } : {}) }).set('Cookie', item.cookie);

  it('repeats the actual authorization after a lost creation response and audits every read', async () => {
    const item = await fixture(), key = randomUUID();
    const created = await create(item, 'Permanent ERP', null, key).expect(201);
    const replay = await create(item, 'Permanent ERP', null, key).expect(201);
    expect(replay.body.id).toBe(created.body.id); expect(replay.body.secret).toBeUndefined();
    await prisma.session.updateMany({ where: { userId: item.user.id }, data: { reauthenticatedAt: null } });
    for (const credentialId of [undefined, created.body.id as string]) {
      const read = await connection(item, credentialId).expect(200);
      expect(read.headers['cache-control']).toBe('no-store');
      expect(read.body).toMatchObject({ endpoint: { id: item.endpoint.id, code: item.endpoint.code }, credentialId: created.body.id, credentialName: 'Permanent ERP', expiresAt: null });
      expect(read.body.authorization === `Bearer ${created.body.secret}`).toBe(true);
    }
    const audits = await prisma.auditEvent.findMany({ where: { organizationId: item.organization.id, action } });
    expect(audits).toHaveLength(2);
    for (const audit of audits) {
      expect(audit.metadata).toEqual({ endpointId: item.endpoint.id, credentialId: created.body.id });
      expect(audit.actorUserId).toBe(item.user.id);
    }
    expect(JSON.stringify(audits).includes(created.body.secret)).toBe(false);
    expect(await prisma.adminMutation.count({ where: { organizationId: item.organization.id } })).toBe(1);
  });

  it('selects the latest eligible credential and never returns a revoked or expired credential', async () => {
    const item = await fixture();
    expect((await connection(item).expect(409)).body.code).toBe('INTEGRATION_CREDENTIAL_REQUIRED');
    const first = await create(item, 'First').expect(201);
    const second = await create(item, 'Second').expect(201);
    await prisma.integrationCredential.update({ where: { id: first.body.id }, data: { createdAt: new Date(Date.now() - 60000) } });
    expect((await connection(item).expect(200)).body.credentialId).toBe(second.body.id);
    expect((await connection(item, first.body.id).expect(200)).body.expiresAt).toBe(first.body.expiresAt);
    await request(app.getHttpServer()).post(`${path}/${item.endpoint.id}/credentials/${second.body.id}/revoke`).set('Cookie', item.cookie)
      .set('x-csrf-token', 'fixture').set('Idempotency-Key', randomUUID()).send({}).expect(201);
    expect((await connection(item, second.body.id).expect(409)).body.code).toBe('INTEGRATION_CREDENTIAL_REQUIRED');
    expect((await connection(item).expect(200)).body.credentialId).toBe(first.body.id);
    await prisma.integrationCredential.update({ where: { id: first.body.id }, data: { expiresAt: new Date(Date.now() - 60000) } });
    expect((await connection(item, first.body.id).expect(409)).body.code).toBe('INTEGRATION_CREDENTIAL_REQUIRED');
    expect((await connection(item).expect(409)).body.code).toBe('INTEGRATION_CREDENTIAL_REQUIRED');
  });

  it('reports a legacy credential as unavailable and skips it when a copyable one exists', async () => {
    const item = await fixture();
    const legacy = await prisma.integrationCredential.create({ data: {
      organizationId: item.organization.id, endpointId: item.endpoint.id, name: 'Legacy credential',
      secretHash: createHash('sha256').update(randomUUID()).digest('hex'), expiresAt: new Date(Date.now() + 86400000),
      createdAt: new Date(Date.now() + 60000),
    } });
    expect((await connection(item).expect(409)).body.code).toBe('INTEGRATION_CREDENTIAL_SECRET_UNAVAILABLE');
    expect((await connection(item, legacy.id).expect(409)).body.code).toBe('INTEGRATION_CREDENTIAL_SECRET_UNAVAILABLE');
    const created = await create(item).expect(201);
    expect((await connection(item).expect(200)).body.credentialId).toBe(created.body.id);
    expect((await connection(item, legacy.id).expect(409)).body.code).toBe('INTEGRATION_CREDENTIAL_SECRET_UNAVAILABLE');
  });

  it.each(permissions)('requires %s to copy authorization', async code => {
    const item = await fixture();
    await create(item).expect(201);
    const permission = await prisma.permission.findUniqueOrThrow({ where: { code } });
    await prisma.rolePermission.delete({ where: { roleId_permissionId: { roleId: item.role.id, permissionId: permission.id } } });
    await connection(item).expect(403);
  });

  it('isolates organizations and validates the optional credential selector', async () => {
    const owner = await fixture(), other = await fixture();
    const credential = await create(owner).expect(201);
    await connection({ ...owner, cookie: other.cookie }).expect(403);
    await connection({ ...other, endpoint: owner.endpoint }).expect(404);
    expect((await connection(other, credential.body.id).expect(409)).body.code).toBe('INTEGRATION_CREDENTIAL_REQUIRED');
    await connection(owner, 'not-a-uuid').expect(400);
  });

  it('does not disclose authorization when the audit write fails', async () => {
    const item = await fixture();
    const created = await create(item).expect(201);
    const service = app.get(AuditLogService), record = service.record.bind(service);
    const audit = jest.spyOn(service, 'record').mockImplementation(async (input, transaction) => {
      if (input.action === action) throw new Error('injected connection audit unavailable');
      return record(input, transaction);
    });
    try {
      const rejected = await connection(item).expect(500);
      expect(rejected.body.authorization).toBeUndefined();
      expect(JSON.stringify(rejected.body).includes(created.body.secret)).toBe(false);
      expect(await prisma.auditEvent.count({ where: { organizationId: item.organization.id, action } })).toBe(0);
    } finally { audit.mockRestore(); }
  });

  it.each([
    ['session expiry', 401, 'AUTH_SESSION_REQUIRED'],
    ['permission loss', 403, 'FEATURE_PERMISSION_DENIED'],
    ['credential expiry', 409, 'INTEGRATION_CREDENTIAL_REQUIRED'],
  ] as const)('rechecks %s after the final credential lock', async (change, status, code) => {
    const item = await fixture();
    const created = await create(item).expect(201);
    const credentialId = created.body.id as string;
    const blocker = new Client({ connectionString: process.env.DATABASE_URL });
    await blocker.connect();
    let pending: Promise<request.Response> | undefined;
    try {
      const blockerPid = (await blocker.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0]!.pid;
      if (change === 'credential expiry') {
        await prisma.$executeRaw`UPDATE integration_credentials SET expires_at = clock_timestamp() + INTERVAL '1.6 seconds' WHERE id = ${credentialId}::uuid`;
      }
      if (change === 'session expiry') {
        await prisma.session.updateMany({ where: { userId: item.user.id }, data: { expiresAt: new Date(Date.now() + 1600) } });
      }
      await blocker.query('BEGIN');
      await blocker.query('SELECT id FROM integration_credentials WHERE id=$1 FOR UPDATE', [credentialId]);
      pending = connection(item, credentialId).then(response => response);
      let waiting = false;
      for (let attempt = 0; attempt < 100 && !waiting; attempt++) {
        const [activity] = await prisma.$queryRaw<{ waiting: boolean }[]>`SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND ${blockerPid} = ANY(pg_blocking_pids(pid))) AS waiting`;
        waiting = activity?.waiting ?? false;
        if (!waiting) await new Promise(resolve => setTimeout(resolve, 10));
      }
      expect(waiting).toBe(true);
      if (change === 'permission loss') {
        const permission = await prisma.permission.findUniqueOrThrow({ where: { code: 'integration:manage' } });
        await prisma.rolePermission.delete({ where: { roleId_permissionId: { roleId: item.role.id, permissionId: permission.id } } });
      }
      if (change !== 'permission loss') await blocker.query('SELECT pg_sleep(1.7)');
      await blocker.query('COMMIT');
      const rejected = await pending;
      expect(rejected.status).toBe(status); expect(rejected.body.code).toBe(code);
      expect(rejected.body.authorization).toBeUndefined();
      expect(await prisma.auditEvent.count({ where: { organizationId: item.organization.id, action } })).toBe(0);
    } finally { await blocker.query('ROLLBACK'); await blocker.end(); await pending; }
  });
});
