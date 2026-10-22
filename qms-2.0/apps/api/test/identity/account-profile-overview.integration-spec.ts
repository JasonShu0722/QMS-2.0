import 'reflect-metadata';
import { jest } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../../src/app.module.js';
import { PrismaService } from '../../src/database/prisma.service.js';
import { SessionService } from '../../src/modules/identity/session.service.js';
import { AuditLogService } from '../../src/modules/audit-log/audit-log.service.js';
import { GlobalExceptionFilter } from '../../src/common/contracts/global-exception.filter.js';
import { AdminUserService } from '../../src/modules/identity/admin-user.service.js';
import type { AdminActor } from '../../src/common/security/admin-mutation.service.js';
import { Client } from 'pg';
import { setTimeout as delay } from 'node:timers/promises';

const connection = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL) : undefined;
if (!connection || process.env.QMS_DISPOSABLE_TEST_DB !== 'true'
  || !['postgres:', 'postgresql:'].includes(connection.protocol)
  || !['localhost', '127.0.0.1', '[::1]'].includes(connection.hostname)
  || connection.port === '55440' || connection.search || connection.hash) {
  throw new Error('Account profile tests require explicitly disposable loopback PostgreSQL; preview 55440 is forbidden.');
}

describe('account profile and own overview with real PostgreSQL and HTTP', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let sessions: SessionService;
  const orgIds: string[] = [];
  const permissionIds: string[] = [];
  const csrf = randomUUID();
  beforeAll(async () => {
    app = (await Test.createTestingModule({ imports: [AppModule] }).compile()).createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init();
    prisma = app.get(PrismaService);
    sessions = app.get(SessionService);
  });
  afterAll(async () => {
    try {
      const where = { organizationId: { in: orgIds } };
      await prisma.$executeRaw`DELETE FROM user_signatures WHERE organization_id = ANY(${orgIds}::uuid[])`;
      await prisma.auditEvent.deleteMany({ where });
      await prisma.adminMutation.deleteMany({ where });
      await prisma.userPosition.deleteMany({ where });
      await prisma.positionRole.deleteMany({ where });
      await prisma.position.deleteMany({ where });
      await prisma.department.deleteMany({ where });
      await prisma.user.deleteMany({ where });
      await prisma.organization.deleteMany({ where: { id: { in: orgIds } } });
      await prisma.permission.deleteMany({ where: { id: { in: permissionIds } } });
    } finally { await app?.close(); }
  });
  async function organization(type: 'INTERNAL' | 'SUPPLIER' = 'INTERNAL') {
    const org = await prisma.organization.create({ data: { code: randomUUID(), name: 'U3 organization', type } });
    orgIds.push(org.id);
    return org;
  }
  const person = (organizationId: string, accountType: 'INTERNAL' | 'SUPPLIER' = 'INTERNAL') => prisma.user.create({ data: { organizationId, username: randomUUID(), passwordHash: 'test-only', accountType } });
  async function grant(userId: string, organizationId: string, codes: string[]) {
    const permissions = [];
    for (const code of codes) {
      const existing = await prisma.permission.findUnique({ where: { code } });
      const permission = existing ?? await prisma.permission.create({ data: { code, name: code } });
      if (!existing) permissionIds.push(permission.id);
      permissions.push(permission);
    }
    const role = await prisma.role.create({ data: { organizationId, code: randomUUID(), name: 'U3 role', permissions: { create: permissions.map(({ id }) => ({ permissionId: id })) } } });
    await prisma.userRole.create({ data: { userId, organizationId, roleId: role.id } });
    return role;
  }
  async function login(userId: string, recent = true, mfaVerified = true) {
    const token = await sessions.create(userId, prisma, { reauthenticated: recent, mfaVerified });
    return `qms_session=${token}; qms_csrf=${csrf}`;
  }
  async function fixture(type: 'INTERNAL' | 'SUPPLIER' = 'INTERNAL') {
    const org = await organization(type);
    const user = await person(org.id, type);
    return { org, user, cookie: await login(user.id) };
  }
  const patch = (cookie: string, body: object, key = randomUUID(), path = '/api/v1/me') => request(app.getHttpServer()).patch(path).set('Cookie', cookie).set('x-csrf-token', csrf).set('Idempotency-Key', key).send(body);
  const get = (cookie: string, path = '/api/v1/me') => request(app.getHttpServer()).get(path).set('Cookie', cookie);

  it('projects old NULL fields and saves trimmed international/extension text with independent versions', async () => {
    const f = await fixture();
    expect((await get(f.cookie).expect(200)).body).toMatchObject({ fullName: null, phone: null, profileVersion: 1, emailVerifiedAt: null });
    expect((await patch(f.cookie, { fullName: '  Alice  ', phone: '  +44 (20) 1234 ext. 56  ', expectedProfileVersion: 1 }).expect(200)).body).toMatchObject({ fullName: 'Alice', phone: '+44 (20) 1234 ext. 56', profileVersion: 2, avatarVersion: 1 });
    const user = await prisma.user.findUniqueOrThrow({ where: { id: f.user.id } });
    expect(user.securityVersion).toBe(f.user.securityVersion);
    expect(user.avatarVersion).toBe(f.user.avatarVersion);
    await patch(f.cookie, { fullName: '   ', phone: '', expectedProfileVersion: 2 }).expect(200);
    expect((await get(f.cookie)).body).toMatchObject({ fullName: null, phone: null, profileVersion: 3 });
  });
  it('replays once, rejects changed payload and keeps receipts/audit free from profile values', async () => {
    const f = await fixture();
    const key = randomUUID();
    const body = { fullName: 'Private U3 name', phone: '+81 123 ext 99', expectedProfileVersion: 1 };
    const saved = await patch(f.cookie, body, key).expect(200);
    expect((await patch(f.cookie, body, key).expect(200)).body).toEqual(saved.body);
    await patch(f.cookie, { ...body, phone: 'different' }, key).expect(409);
    const receipt = await prisma.adminMutation.findFirstOrThrow({ where: { actorUserId: f.user.id, key } });
    expect(JSON.stringify(receipt)).not.toMatch(/Private U3 name|\+81 123 ext 99|fullName|phone/);
    expect(receipt.requestDigest).toMatch(/^[a-f0-9]{64}$/);
    const events = await prisma.auditEvent.findMany({ where: { actorUserId: f.user.id, action: 'PROFILE_UPDATED' } });
    expect(events).toHaveLength(1);
    expect(events[0]!.metadata).toEqual({ changedFields: 'fullName,phone', resourceVersion: 2 });
    expect(JSON.stringify(events)).not.toMatch(/Private U3 name|\+81 123 ext 99/);
    expect((await get(f.cookie)).body.profileVersion).toBe(2);
  });
  it('uses CAS for racing/stale saves and returns controlled 409 at the Int ceiling', async () => {
    const f = await fixture();
    const results = await Promise.all([patch(f.cookie, { phone: 'one', expectedProfileVersion: 1 }), patch(f.cookie, { phone: 'two', expectedProfileVersion: 1 })]);
    expect(results.map(({ status }) => status).sort()).toEqual([200, 409]);
    await patch(f.cookie, { fullName: 'stale', expectedProfileVersion: 1 }).expect(409);
    await prisma.$executeRaw`UPDATE users SET profile_version = 2147483647 WHERE id = ${f.user.id}::uuid`;
    await patch(f.cookie, { phone: 'ceiling', expectedProfileVersion: 2147483647 }).expect(409);
    expect((await get(f.cookie)).body.profileVersion).toBe(2147483647);
  });
  it('serializes identical keys, returns current projections after later changes and treats unchanged fields as a no-op', async () => {
    const f = await fixture();
    const key = randomUUID();
    const body = { phone: 'First extension', expectedProfileVersion: 1 };
    const responses = await Promise.all([patch(f.cookie, body, key), patch(f.cookie, body, key)]);
    expect(responses.map(({ status }) => status)).toEqual([200, 200]);
    await patch(f.cookie, { phone: 'First extension', expectedProfileVersion: 2 }).expect(200);
    expect((await get(f.cookie)).body.profileVersion).toBe(2);
    await patch(f.cookie, { phone: 'Later extension', expectedProfileVersion: 2 }).expect(200);
    expect((await patch(f.cookie, body, key).expect(200)).body).toMatchObject({ phone: 'Later extension', profileVersion: 3 });
    expect(await prisma.adminMutation.count({ where: { actorUserId: f.user.id, key } })).toBe(1);
    expect(await prisma.auditEvent.count({ where: { actorUserId: f.user.id, action: 'PROFILE_UPDATED' } })).toBe(3);
    const other = await fixture();
    await patch(other.cookie, { phone: 'Later extension', expectedProfileVersion: 1 }).expect(200);
    const deniedLogin = await request(app.getHttpServer()).post('/api/v1/auth/login').set('Cookie', `qms_csrf=${csrf}`).set('x-csrf-token', csrf).send({ identifier: 'Later extension', password: 'not-a-login-identity' }).expect(401);
    expect(deniedLogin.body.code).toBe('AUTH_INVALID_CREDENTIALS');
  });
  it.each([{ organizationId: randomUUID() }, { roles: [] }, { positions: [] }, { accountType: 'INTERNAL' }])('rejects personal privilege mutation %j', async (extra) => {
    const f = await fixture();
    await patch(f.cookie, { ...extra, expectedProfileVersion: 1 }).expect(400);
  });
  it.each([{}, { expectedProfileVersion: null }, { expectedProfileVersion: 0 }, { expectedProfileVersion: 2147483648 }, { expectedProfileVersion: 1.1 }, { expectedProfileVersion: '1' }, { phone: 'x'.repeat(41), expectedProfileVersion: 1 }, { fullName: 'x'.repeat(101), expectedProfileVersion: 1 }])('rejects invalid profile input %j', async (body) => {
    const f = await fixture();
    await patch(f.cookie, body).expect(400);
  });
  it('requires CSRF, idempotency and recent authentication', async () => {
    const f = await fixture();
    const body = { phone: '123', expectedProfileVersion: 1 };
    await request(app.getHttpServer()).patch('/api/v1/me').set('Cookie', f.cookie).send(body).expect(403);
    await request(app.getHttpServer()).patch('/api/v1/me').set('Cookie', f.cookie).set('x-csrf-token', csrf).send(body).expect(400);
    await patch(await login(f.user.id, false), body).expect(403);
  });
  it('rolls back profile and receipt if the real audit insert fails', async () => {
    const f = await fixture();
    const audit = app.get(AuditLogService);
    const original = audit.record.bind(audit);
    const spy = jest.spyOn(audit, 'record').mockImplementation((input, tx) => original(input.action === 'PROFILE_UPDATED' ? { ...input, actorUserId: randomUUID() } : input, tx));
    const key = randomUUID();
    try { await patch(f.cookie, { phone: 'rollback', expectedProfileVersion: 1 }, key).expect(500); }
    finally { spy.mockRestore(); }
    expect((await get(f.cookie)).body).toMatchObject({ phone: null, profileVersion: 1 });
    expect(await prisma.adminMutation.count({ where: { actorUserId: f.user.id, key } })).toBe(0);
  });
  it('uses the existing email trigger to clear verification and consume old credentials', async () => {
    const f = await fixture();
    await prisma.user.update({ where: { id: f.user.id }, data: { email: 'old@example.test' } });
    await prisma.user.update({ where: { id: f.user.id }, data: { emailVerifiedAt: new Date() } });
    const verification = await prisma.emailVerification.create({ data: { userId: f.user.id, purpose: 'VERIFY_EMAIL', email: 'old@example.test', tokenHash: randomUUID().replaceAll('-', '').repeat(2), securityVersion: 1, expiresAt: new Date(Date.now() + 60_000) } });
    expect((await patch(f.cookie, { email: ' New@Example.test ', expectedProfileVersion: 1 }).expect(200)).body).toMatchObject({ email: 'new@example.test', emailVerifiedAt: null, profileVersion: 2 });
    expect((await prisma.emailVerification.findUniqueOrThrow({ where: { id: verification.id } })).consumedAt).not.toBeNull();
  });
  it('checks every mixed admin permission, preserves pure status and shares profile CAS', async () => {
    const f = await fixture();
    const target = await person(f.org.id);
    await grant(f.user.id, f.org.id, ['account:users:status']);
    const cookie = await login(f.user.id);
    const path = `/api/v1/admin/users/${target.id}`;
    for (const profile of [{ fullName: 'No permission' }, { phone: 'No permission' }]) await patch(cookie, { ...profile, status: 'DISABLED', expectedProfileVersion: 1 }, randomUUID(), path).expect(403);
    expect((await patch(cookie, { status: 'DISABLED' }, randomUUID(), path).expect(200)).body).toMatchObject({ status: 'DISABLED', profileVersion: 1 });
    await grant(f.user.id, f.org.id, ['account:users:update']);
    const updatedCookie = await login(f.user.id);
    await patch(updatedCookie, { fullName: 'Name' }, randomUUID(), path).expect(400);
    const key = randomUUID();
    const body = { fullName: ' Name ', phone: ' ext. 10 ', expectedProfileVersion: 1, status: 'ACTIVE' };
    expect((await patch(updatedCookie, body, key, path).expect(200)).body).toMatchObject({ fullName: 'Name', phone: 'ext. 10', profileVersion: 2, emailVerifiedAt: null });
    await patch(updatedCookie, body, key, path).expect(200);
    await patch(updatedCookie, { ...body, phone: 'Different' }, key, path).expect(409);
    const receipt = await prisma.adminMutation.findFirstOrThrow({ where: { actorUserId: f.user.id, key } });
    expect(JSON.stringify(receipt.response)).not.toMatch(/Name|ext\. 10|fullName|phone/);
    await patch(await login(target.id), { fullName: 'stale', expectedProfileVersion: 1 }).expect(409);
    await prisma.$executeRaw`UPDATE users SET profile_version = 2147483647 WHERE id = ${target.id}::uuid`;
    await patch(updatedCookie, { phone: 'ceiling', expectedProfileVersion: 2147483647 }, randomUUID(), path).expect(409);
  });
  it('rolls back administrator profile fields, CAS version and receipt when audit insertion fails', async () => {
    const f = await fixture();
    const target = await person(f.org.id);
    await grant(f.user.id, f.org.id, ['account:users:update']);
    const cookie = await login(f.user.id);
    const audit = app.get(AuditLogService);
    const original = audit.record.bind(audit);
    const spy = jest.spyOn(audit, 'record').mockImplementation((input, tx) => original(input.action === 'USER_UPDATED' ? { ...input, actorUserId: randomUUID() } : input, tx));
    const key = randomUUID();
    try { await patch(cookie, { fullName: 'Rollback', phone: 'Rollback', expectedProfileVersion: 1 }, key, `/api/v1/admin/users/${target.id}`).expect(500); }
    finally { spy.mockRestore(); }
    expect(await prisma.user.findUniqueOrThrow({ where: { id: target.id }, select: { fullName: true, phone: true, profileVersion: true } })).toEqual({ fullName: null, phone: null, profileVersion: 1 });
    expect(await prisma.adminMutation.count({ where: { actorUserId: f.user.id, key } })).toBe(0);
  });
  it('rechecks expiring position authorization after waiting for the target lock before committing any profile state', async () => {
    const f = await fixture();
    const target = await person(f.org.id);
    const role = await grant(f.user.id, f.org.id, ['account:users:update']);
    await prisma.userRole.deleteMany({ where: { userId: f.user.id } });
    const department = await prisma.department.create({ data: { organizationId: f.org.id, code: randomUUID(), name: 'Temporary access' } });
    const position = await prisma.position.create({ data: { organizationId: f.org.id, departmentId: department.id, code: randomUUID(), name: 'Temporary editor' } });
    await prisma.positionRole.create({ data: { organizationId: f.org.id, positionId: position.id, roleId: role.id } });
    const expires = new Date(Date.now() + 1500);
    await prisma.userPosition.create({ data: { organizationId: f.org.id, userId: f.user.id, positionId: position.id, startedAt: new Date(Date.now() - 60_000), endedAt: expires } });
    const cookie = await login(f.user.id);
    const blocker = new Client({ connectionString: process.env.DATABASE_URL });
    await blocker.connect();
    const key = randomUUID();
    let pending: Promise<request.Response> | undefined;
    try {
      await blocker.query('BEGIN');
      const pid = Number((await blocker.query('SELECT pg_backend_pid() AS pid')).rows[0].pid);
      await blocker.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [target.id]);
      pending = patch(cookie, { phone: 'Must not commit', expectedProfileVersion: 1 }, key, `/api/v1/admin/users/${target.id}`).then((response) => response);
      let waiting = false;
      const deadline = Date.now() + 3000;
      while (!waiting && Date.now() < deadline) {
        const rows = await prisma.$queryRaw<{ waiting: boolean }[]>`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE ${pid}::int = ANY(pg_blocking_pids(pid))) AS waiting`;
        waiting = rows[0]!.waiting;
        if (!waiting) await delay(10);
      }
      expect(waiting).toBe(true);
      await delay(Math.max(0, expires.getTime() - Date.now() + 10));
      await blocker.query('COMMIT');
      expect((await pending).status).toBe(403);
      expect(await prisma.user.findUniqueOrThrow({ where: { id: target.id }, select: { phone: true, profileVersion: true } })).toEqual({ phone: null, profileVersion: 1 });
      expect(await prisma.adminMutation.count({ where: { actorUserId: f.user.id, key } })).toBe(0);
      expect(await prisma.auditEvent.count({ where: { actorUserId: f.user.id, action: 'USER_UPDATED' } })).toBe(0);
    } finally {
      await blocker.query('ROLLBACK');
      await pending;
      await blocker.end();
    }
  });
  it('requires transfer plus update and prevents foreign target access', async () => {
    const f = await fixture();
    const other = await organization();
    const target = await person(f.org.id);
    const foreign = await person(other.id);
    await grant(f.user.id, f.org.id, ['account:users:transfer']);
    await grant(f.user.id, other.id, ['account:users:transfer']);
    await patch(await login(f.user.id), { organizationId: other.id, phone: 'secret', expectedProfileVersion: 1 }, randomUUID(), `/api/v1/admin/users/${target.id}`).expect(403);
    await grant(f.user.id, f.org.id, ['account:users:update']);
    await patch(await login(f.user.id), { phone: 'foreign', expectedProfileVersion: 1 }, randomUUID(), `/api/v1/admin/users/${foreign.id}`).expect(404);
  });
  it.each(['create', 'update'] as const)('bounds the post-commit %s projection and replay after an independent target transfer', async (action) => {
    const f = await fixture();
    const other = await organization();
    await grant(f.user.id, f.org.id, ['account:users:create', 'account:users:update']);
    if (action === 'create') await grant(f.user.id, f.org.id, ['organization:structure:read', 'organization:positions:assign']);
    const cookie = await login(f.user.id);
    const target = await person(f.org.id);
    type Projection = { mutationProjection(actor: AdminActor, userId: string, organizationId: string, targetOrganizationId: string, permissions: string[]): Promise<unknown> };
    const service = app.get(AdminUserService) as unknown as Projection;
    const original = service.mutationProjection.bind(service);
    let transferredId = '';
    const spy = jest.spyOn(service, 'mutationProjection').mockImplementationOnce(async (...args) => {
      transferredId = args[1];
      // Simulate a trusted migration racing the response, including its organization-bound appointments.
      await prisma.userPosition.deleteMany({ where: { userId: transferredId } });
      await prisma.user.update({ where: { id: transferredId }, data: { organizationId: other.id } });
      return original(...args);
    });
    const key = randomUUID();
    let initialPositions = {};
    if (action === 'create') {
      const department = await prisma.department.create({ data: { organizationId: f.org.id, code: randomUUID(), name: 'Projection fixture' } });
      const position = await prisma.position.create({ data: { organizationId: f.org.id, departmentId: department.id, code: randomUUID(), name: 'Empty projection position' } });
      const response = await request(app.getHttpServer()).post(`/api/v1/organizations/${f.org.id}/position-authorization/preview`).set('Cookie', cookie).set('x-csrf-token', csrf).send({ positionIds: [position.id] }).expect(200);
      initialPositions = { positionIds: [position.id], authorizationBaseline: response.body.authorizationBaseline };
    }
    const body = action === 'create' ? { username: randomUUID(), accountType: 'INTERNAL', organizationId: f.org.id, initialPassword: 'test-password-123', fullName: 'Private name', phone: 'Private extension', ...initialPositions } : { phone: 'Private extension', expectedProfileVersion: 1 };
    const path = action === 'create' ? '/api/v1/admin/users' : `/api/v1/admin/users/${target.id}`;
    const send = () => request(app.getHttpServer())[action === 'create' ? 'post' : 'patch'](path).set('Cookie', cookie).set('x-csrf-token', csrf).set('Idempotency-Key', key).send(body);
    try { await send().expect(404); } finally { spy.mockRestore(); }
    expect(transferredId).not.toBe('');
    const replay = await send().expect(404);
    expect(JSON.stringify(replay.body)).not.toMatch(/Private extension|Private name/);
    expect(await prisma.adminMutation.count({ where: { actorUserId: f.user.id, key } })).toBe(1);
    const value = await prisma.user.findUniqueOrThrow({ where: { id: transferredId } });
    expect(value.organizationId).toBe(other.id);
    expect(value.profileVersion).toBe(action === 'create' ? 1 : 2);
  });
  it('returns a permitted transfer from the target scope and rechecks that scope on replay', async () => {
    const f = await fixture();
    const other = await organization();
    const target = await person(f.org.id);
    await grant(f.user.id, f.org.id, ['account:users:update', 'account:users:transfer']);
    const targetRole = await grant(f.user.id, other.id, ['account:users:transfer']);
    const cookie = await login(f.user.id);
    const path = `/api/v1/admin/users/${target.id}`;
    const key = randomUUID();
    const body = { organizationId: other.id, fullName: 'Transferred', expectedProfileVersion: 1 };
    expect((await patch(cookie, body, key, path).expect(200)).body).toMatchObject({ id: target.id, organizationId: other.id, fullName: 'Transferred', profileVersion: 2 });
    await patch(cookie, body, key, path).expect(200);
    await prisma.userRole.deleteMany({ where: { userId: f.user.id, roleId: targetRole.id } });
    await patch(await login(f.user.id), body, key, path).expect(403);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: target.id } })).profileVersion).toBe(2);
  });
  it('provides session home scope, effective assignments, merged named sources and unique permissions', async () => {
    const f = await fixture();
    const other = await organization();
    const role = await grant(f.user.id, f.org.id, ['notification:read']);
    await grant(f.user.id, other.id, ['account:roles:read']);
    const department = await prisma.department.create({ data: { organizationId: f.org.id, code: randomUUID(), name: 'Quality' } });
    const position = await prisma.position.create({ data: { organizationId: f.org.id, departmentId: department.id, code: randomUUID(), name: 'Engineer' } });
    const assignment = await prisma.userPosition.create({ data: { organizationId: f.org.id, userId: f.user.id, positionId: position.id, startedAt: new Date(Date.now() - 60_000) } });
    await prisma.positionRole.create({ data: { organizationId: f.org.id, positionId: position.id, roleId: role.id } });
    const cookie = await login(f.user.id);
    const overview = await get(cookie, '/api/v1/me/overview').expect(200);
    expect(overview.body).toMatchObject({ organizationId: f.org.id, assignments: [{ id: assignment.id, position: { id: position.id, name: 'Engineer' }, department: { name: 'Quality' }, endedAt: null }], effectiveRoles: [{ id: role.id, sources: [{ kind: 'DIRECT' }, { kind: 'POSITION', positionId: position.id, positionName: 'Engineer', assignmentId: assignment.id }] }], permissions: ['notification:read'] });
    expect(overview.body.assignments[0].startedAt).toBe(assignment.startedAt.toISOString());
    for (const query of [`userId=${randomUUID()}`, `organizationId=${other.id}`, `org=${other.id}`]) await get(cookie, `/api/v1/me/overview?${query}`).expect(400);
    await request(app.getHttpServer()).get('/api/v1/me/overview').expect(401);
  });
  it.each(['future', 'ended', 'position', 'department'] as const)('excludes ineffective %s assignments and roles', async (state) => {
    const f = await fixture();
    const role = await grant(f.user.id, f.org.id, ['notification:read']);
    await prisma.userRole.deleteMany({ where: { userId: f.user.id } });
    const department = await prisma.department.create({ data: { organizationId: f.org.id, code: randomUUID(), name: 'D', status: state === 'department' ? 'DISABLED' : 'ACTIVE' } });
    const position = await prisma.position.create({ data: { organizationId: f.org.id, departmentId: department.id, code: randomUUID(), name: 'P', status: state === 'position' ? 'DISABLED' : 'ACTIVE' } });
    await prisma.positionRole.create({ data: { organizationId: f.org.id, positionId: position.id, roleId: role.id } });
    await prisma.userPosition.create({ data: { organizationId: f.org.id, userId: f.user.id, positionId: position.id, startedAt: new Date(Date.now() + (state === 'future' ? 60_000 : -60_000)), endedAt: state === 'ended' ? new Date() : null } });
    expect((await get(f.cookie, '/api/v1/me/overview').expect(200)).body).toMatchObject({ assignments: [], effectiveRoles: [], permissions: [] });
  });
  it('rejects first-login and incomplete MFA sessions', async () => {
    const f = await fixture();
    await prisma.user.update({ where: { id: f.user.id }, data: { mustChangePassword: true } });
    for (const path of ['/api/v1/me', '/api/v1/me/overview']) await get(f.cookie, path).expect(401);
    await prisma.user.update({ where: { id: f.user.id }, data: { mustChangePassword: false, mfaRequirementOverride: true } });
    const cookie = await login(f.user.id, true, false);
    for (const path of ['/api/v1/me', '/api/v1/me/overview']) await get(cookie, path).expect(401);
    await patch(cookie, { phone: 'forbidden', expectedProfileVersion: 1 }).expect(401);
  });
  it('returns private signature summary, preserves register/revoke and denies unavailable users independently', async () => {
    const f = await fixture();
    await get(f.cookie, '/api/v1/e-signatures/mine/summary').expect(403);
    await patch(f.cookie, { phone: 'still works', expectedProfileVersion: 1 }).expect(200);
    await grant(f.user.id, f.org.id, ['e-signature:signatures:read', 'e-signature:signatures:write']);
    const cookie = await login(f.user.id);
    const created = await request(app.getHttpServer()).post('/api/v1/e-signatures').set('Cookie', cookie).set('x-csrf-token', csrf).set('Idempotency-Key', randomUUID()).send({ label: 'My signature', signatureData: 'private-signature-material' }).expect(201);
    const summary = await get(cookie, '/api/v1/e-signatures/mine/summary').expect(200);
    expect(summary.body).toEqual([{ id: created.body.id, label: 'My signature', status: 'ACTIVE', version: 1, createdAt: created.body.createdAt, revokedAt: null }]);
    expect(JSON.stringify(summary.body)).not.toMatch(/fingerprint|raw|expiresAt|private-signature-material/);
    const other = await fixture();
    await grant(other.user.id, other.org.id, ['e-signature:signatures:read']);
    expect((await get(await login(other.user.id), '/api/v1/e-signatures/mine/summary').expect(200)).body).toEqual([]);
    await get(cookie, `/api/v1/e-signatures/mine/summary?organizationId=${other.org.id}`).expect(400);
    await request(app.getHttpServer()).post(`/api/v1/e-signatures/${created.body.id}/revoke`).set('Cookie', cookie).set('x-csrf-token', csrf).set('Idempotency-Key', randomUUID()).send({ expectedVersion: 1 }).expect(201);
    expect((await get(cookie, '/api/v1/e-signatures/mine/summary')).body[0]).toMatchObject({ status: 'REVOKED', version: 2, revokedAt: expect.any(String) });
    const supplier = await fixture('SUPPLIER');
    await grant(supplier.user.id, supplier.org.id, ['e-signature:signatures:read']);
    await get(await login(supplier.user.id), '/api/v1/e-signatures/mine/summary').expect(403);
    await get(supplier.cookie).expect(200);
  });
});
