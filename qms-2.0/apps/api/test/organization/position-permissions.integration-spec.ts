import 'reflect-metadata';
import { jest } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../../src/app.module.js';
import { PrismaService } from '../../src/database/prisma.service.js';
import { GlobalExceptionFilter } from '../../src/common/contracts/global-exception.filter.js';
import { SessionService } from '../../src/modules/identity/session.service.js';
import { OrganizationService } from '../../src/modules/organization/organization.service.js';
import { AuditLogService } from '../../src/modules/audit-log/audit-log.service.js';
import { AdminRoleService } from '../../src/modules/authorization/admin-role.service.js';
import { ADMIN_PERMISSIONS } from '../../src/modules/authorization/permission-catalog.js';
import { SUPPLIER_PORTAL_PERMISSIONS } from '../../src/modules/authorization/supplier-account-authorization.js';
import { effectiveRoleGrants } from '../../src/common/security/effective-role-grants.js';

const connection = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL) : undefined;
if (!connection || process.env.QMS_DISPOSABLE_TEST_DB !== 'true'
  || !['postgres:', 'postgresql:'].includes(connection.protocol)
  || !['localhost', '127.0.0.1', '[::1]'].includes(connection.hostname)
  || connection.port === '55440' || connection.search || connection.hash) {
  throw new Error('Position governance requires explicitly disposable loopback PostgreSQL; preview 55440 is forbidden.');
}
jest.setTimeout(120_000);

describe('canonical position permissions with real PostgreSQL and HTTP', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let sessions: SessionService;
  const orgIds: string[] = [];
  const globalRoles: string[] = [];
  const legacyPermissionIds: string[] = [];
  const csrf = randomUUID();
  const allCodes = [...new Set([...ADMIN_PERMISSIONS, ...SUPPLIER_PORTAL_PERMISSIONS, 'organization:read', 'workbench:read'])];

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
      await prisma.auditEvent.deleteMany({ where });
      await prisma.adminMutation.deleteMany({ where });
      await prisma.userPosition.deleteMany({ where });
      await prisma.positionRole.deleteMany({ where });
      await prisma.position.deleteMany({ where });
      await prisma.department.deleteMany({ where });
      await prisma.user.deleteMany({ where });
      await prisma.organization.deleteMany({ where: { id: { in: orgIds } } });
      await prisma.role.deleteMany({ where: { id: { in: globalRoles } } });
      await prisma.permission.deleteMany({ where: { id: { in: legacyPermissionIds } } });
    } finally { await app?.close(); }
  });

  async function organization(type: 'INTERNAL' | 'SUPPLIER' = 'INTERNAL') {
    const org = await prisma.organization.create({ data: { code: randomUUID(), name: 'Position governance', type } });
    orgIds.push(org.id);
    return org;
  }
  async function role(organizationId: string | null, codes: string[]) {
    const permissions = await Promise.all(codes.map((code) => prisma.permission.upsert({ where: { code }, create: { code, name: code }, update: {} })));
    const value = await prisma.role.create({ data: { organizationId, code: randomUUID(), name: 'Governance role', permissions: { create: permissions.map(({ id }) => ({ permissionId: id })) } } });
    if (!organizationId) globalRoles.push(value.id);
    return value;
  }
  async function person(organizationId: string, accountType: 'INTERNAL' | 'SUPPLIER' = 'INTERNAL') {
    return prisma.user.create({ data: { organizationId, username: randomUUID(), accountType, passwordHash: 'test-only' } });
  }
  async function login(userId: string, reauthenticated = true) {
    const token = await sessions.create(userId, prisma, { mfaVerified: true, reauthenticated });
    return { token, cookie: `qms_session=${token}; qms_csrf=${csrf}`, sessionId: (await sessions.resolve(token))!.id };
  }
  async function fixture(adminCodes = allCodes, type: 'INTERNAL' | 'SUPPLIER' = 'INTERNAL') {
    const org = await organization(type);
    const adminHome = type === 'SUPPLIER' ? await organization() : org;
    const admin = await person(adminHome.id);
    const adminRole = await role(org.id, adminCodes);
    await prisma.userRole.create({ data: { organizationId: org.id, userId: admin.id, roleId: adminRole.id } });
    const auth = await login(admin.id);
    const user = await person(org.id, type);
    const department = await prisma.department.create({ data: { organizationId: org.id, code: randomUUID(), name: 'Department' } });
    const position = await prisma.position.create({ data: { organizationId: org.id, departmentId: department.id, code: randomUUID(), name: 'Position' } });
    const grant = await role(org.id, type === 'SUPPLIER' ? ['notification:read'] : ['workbench:read']);
    await prisma.userPosition.create({ data: { organizationId: org.id, userId: user.id, positionId: position.id, startedAt: new Date(Date.now() - 60_000) } });
    const actor = { id: admin.id, organizationId: adminHome.id, scopeOrganizationId: org.id, accountType: 'INTERNAL' as const, sessionId: auth.sessionId };
    return { org, admin, adminRole, auth, user, department, position, grant, actor, path: `/api/v1/organizations/${org.id}` };
  }
  type Fixture = Awaited<ReturnType<typeof fixture>>;
  const send = (f: Fixture, method: 'put' | 'patch' | 'post', path: string, body: object, key = randomUUID(), cookie = f.auth.cookie) =>
    request(app.getHttpServer())[method](`${f.path}${path}`).set('Cookie', cookie).set('x-csrf-token', csrf).set('Idempotency-Key', key).send(body);
  const configure = (f: Fixture, roleIds = [f.grant.id], expectedRoleVersion = 1, key = randomUUID()) => send(f, 'put', `/positions/${f.position.id}/roles`, { roleIds, expectedRoleVersion }, key);
  const seedMapping = (f: Fixture) => prisma.positionRole.create({ data: { organizationId: f.org.id, positionId: f.position.id, roleId: f.grant.id } });
  const permissions = async (f: Fixture) => (await effectiveRoleGrants(prisma, f.user.id, f.org.id)).flatMap(({ role }) => role.permissions.map(({ permission }) => permission.code));

  const own = (f: Fixture) => `/positions/${f.position.id}/permissions`;
  const body = (codes = ['workbench:read'], version = 1, expected: string[] = [], mfaRequired = false, expectedMfaRequired = false) => ({ permissionCodes: codes, expectedPermissionCodes: expected, mfaRequired, expectedMfaRequired, expectedRoleVersion: version });
  const read = (f: Fixture) => request(app.getHttpServer()).get(`${f.path}${own(f)}`).set('Cookie', f.auth.cookie);
  async function canonical(f: Fixture, positionId = f.position.id) {
    const rows = await prisma.$queryRaw<{ role_id: string }[]>`SELECT role_id FROM position_roles WHERE position_id = ${positionId}::uuid AND is_canonical`;
    expect(rows).toHaveLength(1);
    return prisma.role.findUniqueOrThrow({ where: { id: rows[0]!.role_id }, include: { permissions: { include: { permission: true } } } });
  }

  it('keeps legacy GET read-only and explicit PUT initializes only submitted own permissions', async () => {
    const f = await fixture();
    await seedMapping(f);
    const before = await read(f).expect(200);
    expect(before.body).toMatchObject({ positionId: f.position.id, roleVersion: 1, permissionCodes: [], mfaRequired: false, legacyRoles: [expect.objectContaining({ id: f.grant.id })], effectiveAssigneeCount: 1, selfSessionRevoked: false });
    expect(await prisma.positionRole.count({ where: { positionId: f.position.id } })).toBe(1);
    const old = await login(f.user.id);
    const reset = await prisma.passwordReset.create({ data: { userId: f.user.id, codeHash: 'b'.repeat(64), expiresAt: new Date(Date.now() + 60_000) } });
    const saved = await send(f, 'put', own(f), body(['notification:read'], 1, [], true)).expect(200);
    expect(saved.body).toMatchObject({ roleVersion: 2, permissionCodes: ['notification:read'], mfaRequired: true, legacyRoles: [expect.objectContaining({ id: f.grant.id })], selfSessionRevoked: false });
    const role = await canonical(f);
    expect(role.permissions.map(({ permission }) => permission.code)).toEqual(['notification:read']);
    expect((await permissions(f)).sort()).toEqual(['notification:read', 'workbench:read']);
    expect(await sessions.resolve(old.token)).toBeNull();
    expect((await prisma.passwordReset.findUniqueOrThrow({ where: { id: reset.id } })).consumedAt).not.toBeNull();
    expect(await prisma.userRole.count({ where: { userId: f.user.id } })).toBe(0);
  });

  it.each([150, 151, 200])('creates and renames a %s-codepoint internal position with one stable canonical role', async (length) => {
    const f = await fixture();
    const name = '岗'.repeat(length - 1) + '😀';
    const created = await send(f, 'post', '/positions', { departmentId: f.department.id, code: randomUUID(), name }).expect(201);
    expect(created.body.name).toBe(name);
    const role = await canonical(f, created.body.id);
    expect(role.name).toBe([...name].slice(0, 150).join(''));
    expect(role.code).toMatch(/^POS_[0-9a-f-]{36}$/);
    const renamed = '新'.repeat(length - 1) + '😀';
    await send(f, 'patch', `/positions/${created.body.id}`, { expectedVersion: 1, name: renamed }).expect(200);
    const changed = await canonical(f, created.body.id);
    expect(changed).toMatchObject({ id: role.id, code: role.code, name: [...renamed].slice(0, 150).join('') });
    expect((await prisma.position.findUniqueOrThrow({ where: { id: created.body.id } })).name).toBe(renamed);
    expect(await prisma.positionRole.count({ where: { positionId: created.body.id } })).toBe(1);
  });

  it('does not change supplier creation and does not initialize supplier canonical permissions', async () => {
    const f = await fixture(allCodes, 'SUPPLIER');
    const created = await send(f, 'post', '/positions', { departmentId: f.department.id, code: randomUUID(), name: 'Supplier position' }).expect(201);
    expect(await prisma.positionRole.count({ where: { positionId: created.body.id } })).toBe(0);
    await send(f, 'put', own(f), body()).expect(403);
  });

  it.each(['account:roles:read', 'account:roles:update', 'account:roles:assign', 'organization:structure:manage'])('requires %s before any initialization', async (missing) => {
    const f = await fixture(allCodes.filter((code) => code !== missing));
    await send(f, 'put', own(f), body()).expect(403);
    expect(await prisma.positionRole.count({ where: { positionId: f.position.id } })).toBe(0);
  });

  it('validates permission directory, grant ceiling, baselines, stale role versions and strict DTOs', async () => {
    const f = await fixture(allCodes.filter((code) => code !== 'audit:export'));
    await send(f, 'put', own(f), body(['unknown:permission'])).expect(400);
    await send(f, 'put', own(f), body(['audit:export'])).expect(403);
    await send(f, 'put', own(f), body([], 1, ['workbench:read'])).expect(409);
    await send(f, 'put', own(f), body([], 1, [], false, true)).expect(409);
    await send(f, 'put', own(f), { ...body(), roleId: randomUUID() }).expect(400);
    await send(f, 'put', own(f), { ...body(), mfaRequired: null }).expect(400);
    await send(f, 'put', own(f), body([], 2147483648)).expect(400);
    const key = randomUUID();
    const first = await send(f, 'put', own(f), body(), key).expect(200);
    expect((await send(f, 'put', own(f), body(), key).expect(200)).body).toEqual(first.body);
    await send(f, 'put', own(f), body([], 1), key).expect(409);
    await send(f, 'put', own(f), body([], 1)).expect(409);
    await send(f, 'put', own(f), body([], 2, ['workbench:read'])).expect(200);
    expect((await canonical(f)).permissions).toEqual([]);
    expect(await prisma.auditEvent.count({ where: { resourceId: f.position.id, action: 'POSITION_PERMISSIONS_CHANGED', outcome: 'SUCCESS' } })).toBe(2);
  });

  it('rejects canonical roles on old role writes and both old mapping bypass directions, including existing replay keys', async () => {
    const f = await fixture();
    const oldKey = randomUUID();
    await app.get(OrganizationService).replacePositionRoles(f.actor, f.org.id, f.position.id, { roleIds: [f.grant.id], expectedRoleVersion: 1 }, randomUUID(), oldKey);
    const roles = app.get(AdminRoleService);
    const updateKey = randomUUID();
    await roles.update(f.actor, f.grant.id, { name: 'Before ownership' }, randomUUID(), updateKey);
    await send(f, 'put', own(f), body([], 2)).expect(200);
    const role = await canonical(f);
    const denied = { status: 403, response: { code: 'FEATURE_PERMISSION_DENIED' } };
    await expect(roles.update(f.actor, role.id, { name: 'Bypass' }, randomUUID(), randomUUID())).rejects.toMatchObject(denied);
    await expect(roles.remove(f.actor, role.id, randomUUID(), randomUUID())).rejects.toMatchObject(denied);
    await expect(roles.copy(f.actor, role.id, { code: randomUUID(), name: 'Bypass' }, randomUUID(), randomUUID())).rejects.toMatchObject(denied);
    await expect(roles.assign(f.actor, f.user.id, { roleIds: [role.id] }, randomUUID(), randomUUID())).rejects.toMatchObject(denied);
    await configure(f, [f.grant.id], 1, oldKey).expect(403);
    const other = await prisma.position.create({ data: { organizationId: f.org.id, departmentId: f.department.id, code: randomUUID(), name: 'Other' } });
    await send(f, 'put', `/positions/${other.id}/roles`, { roleIds: [role.id], expectedRoleVersion: 1 }).expect(403);
    // A role can become canonical after a successful legacy write; the old receipt must not bypass ownership.
    await prisma.positionRole.deleteMany({ where: { positionId: f.position.id, roleId: f.grant.id } });
    await prisma.$executeRaw`INSERT INTO position_roles (organization_id, position_id, role_id, is_canonical) VALUES (${f.org.id}::uuid, ${other.id}::uuid, ${f.grant.id}::uuid, true)`;
    await expect(roles.update(f.actor, f.grant.id, { name: 'Before ownership' }, randomUUID(), updateKey)).rejects.toMatchObject(denied);
  });

  it('enforces both partial unique indexes and same-organization foreign keys in PostgreSQL', async () => {
    const f = await fixture();
    await send(f, 'put', own(f), body([])).expect(200);
    const role = await canonical(f);
    const other = await prisma.position.create({ data: { organizationId: f.org.id, departmentId: f.department.id, code: randomUUID(), name: 'Other' } });
    await expect(prisma.$executeRaw`INSERT INTO position_roles (organization_id, position_id, role_id, is_canonical) VALUES (${f.org.id}::uuid, ${other.id}::uuid, ${role.id}::uuid, true)`).rejects.toBeDefined();
    await expect(prisma.$executeRaw`INSERT INTO position_roles (organization_id, position_id, role_id, is_canonical) VALUES (${f.org.id}::uuid, ${f.position.id}::uuid, ${f.grant.id}::uuid, true)`).rejects.toBeDefined();
    const foreign = await fixture();
    await expect(prisma.$executeRaw`INSERT INTO position_roles (organization_id, position_id, role_id, is_canonical) VALUES (${f.org.id}::uuid, ${other.id}::uuid, ${foreign.grant.id}::uuid, true)`).rejects.toBeDefined();
    await prisma.positionRole.create({ data: { organizationId: f.org.id, positionId: f.position.id, roleId: f.grant.id } });
  });

  it('rolls back own initialization, versions and invalidation if the success audit fails', async () => {
    const f = await fixture();
    const original = app.get(AuditLogService).record.bind(app.get(AuditLogService));
    const spy = jest.spyOn(app.get(AuditLogService), 'record').mockImplementation(async (event, tx) => {
      if (event.action === 'POSITION_PERMISSIONS_CHANGED') throw new Error('audit unavailable');
      return original(event, tx);
    });
    try { await send(f, 'put', own(f), body()).expect(500); } finally { spy.mockRestore(); }
    expect(await prisma.positionRole.count({ where: { positionId: f.position.id } })).toBe(0);
    expect((await prisma.position.findUniqueOrThrow({ where: { id: f.position.id } })).roleVersion).toBe(1);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: f.user.id } })).securityVersion).toBe(1);
    expect(await prisma.role.count({ where: { organizationId: f.org.id, code: { startsWith: 'POS_' } } })).toBe(0);
  });

  it('prevents self-lock and reports committed self-session invalidation without losing retained legacy permissions', async () => {
    const f = await fixture();
    await send(f, 'put', own(f), body(allCodes)).expect(200);
    await prisma.userPosition.create({ data: { organizationId: f.org.id, userId: f.admin.id, positionId: f.position.id, startedAt: new Date(Date.now() - 60_000) } });
    await prisma.userRole.deleteMany({ where: { userId: f.admin.id } });
    const result = await send(f, 'put', own(f), body([], 2, allCodes)).expect(409);
    expect(result.body.code).toBe('ADMIN_SELF_LOCK_FORBIDDEN');
    expect((await read(f).expect(200)).body.roleVersion).toBe(2);
    const saved = await send(f, 'put', own(f), body(allCodes, 2, allCodes, true)).expect(200);
    expect(saved.body.selfSessionRevoked).toBe(true);
    expect(await sessions.resolve(f.auth.token)).toBeNull();
  });
});
