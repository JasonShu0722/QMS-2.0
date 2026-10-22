import 'reflect-metadata';
import { jest } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { BadRequestException, HttpException, ValidationPipe, type INestApplication } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import request from 'supertest';
import { AppModule } from '../../src/app.module.js';
import { PrismaService } from '../../src/database/prisma.service.js';
import { GlobalExceptionFilter } from '../../src/common/contracts/global-exception.filter.js';
import { SessionService } from '../../src/modules/identity/session.service.js';
import { OrganizationService } from '../../src/modules/organization/organization.service.js';
import { ReplacePositionRolesDto, ReplaceUserPositionsDto } from '../../src/modules/organization/organization.dto.js';
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

describe('trusted legacy position governance with real PostgreSQL; HTTP reads and guards remain separate', () => {
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
  // These are trusted recovery/domain calls, not an HTTP adapter or a bypass available to clients.
  function trustedServiceCall(work: () => Promise<unknown>) {
    const result = Promise.resolve().then(work).then((body) => ({ status: 200, body: body as Record<string, unknown> })).catch((error: unknown) => {
      if (!(error instanceof HttpException)) throw error;
      const body = error.getResponse();
      return { status: error.getStatus(), body: typeof body === 'string' ? { message: body } : body as Record<string, unknown> };
    });
    return Object.assign(result, { expect: async (status: number) => {
      const response = await result;
      expect(response.status).toBe(status);
      return response;
    } });
  }
  function validated<T extends object>(type: new () => T, body: object): T {
    const dto = plainToInstance(type, body);
    const errors = validateSync(dto, { whitelist: true, forbidNonWhitelisted: true });
    if (errors.length) throw new BadRequestException(errors);
    return dto;
  }
  const trustedConfigure = (f: Fixture, roleIds = [f.grant.id], expectedRoleVersion = 1, key = randomUUID(), positionId = f.position.id) => trustedServiceCall(() =>
    app.get(OrganizationService).replacePositionRoles({ ...f.actor, sessionId: f.auth.sessionId }, f.org.id, positionId, validated(ReplacePositionRolesDto, { roleIds, expectedRoleVersion }), randomUUID(), key));
  const trustedAppointments = (f: Fixture, userId: string, body: object, key = randomUUID()) => trustedServiceCall(() =>
    app.get(OrganizationService).replaceUserPositions({ ...f.actor, sessionId: f.auth.sessionId }, f.org.id, userId, validated(ReplaceUserPositionsDto, body), randomUUID(), key));
  const seedMapping = (f: Fixture) => prisma.positionRole.create({ data: { organizationId: f.org.id, positionId: f.position.id, roleId: f.grant.id } });
  const permissions = async (f: Fixture) => (await effectiveRoleGrants(prisma, f.user.id, f.org.id)).flatMap(({ role }) => role.permissions.map(({ permission }) => permission.code));

  it('exposes real configuration and current distinct effective assignees, applies a save to existing staff and expires old sessions/resets', async () => {
    const f = await fixture();
    const old = await login(f.user.id);
    const reset = await prisma.passwordReset.create({ data: { userId: f.user.id, codeHash: 'a'.repeat(64), expiresAt: new Date(Date.now() + 60_000) } });
    const path = `${f.path}/positions/${f.position.id}/roles`;
    const before = await request(app.getHttpServer()).get(path).set('Cookie', f.auth.cookie).expect(200);
    expect(before.body).toMatchObject({ positionId: f.position.id, roleVersion: 1, roles: [], effectiveAssigneeCount: 1 });
    const saved = await trustedConfigure(f).expect(200);
    expect(saved.body).toMatchObject({ positionId: f.position.id, roleVersion: 2, roles: [expect.objectContaining({ id: f.grant.id, permissions: [expect.objectContaining({ code: 'workbench:read' })] })], effectiveAssigneeCount: 1, selfSessionRevoked: false });
    expect(await permissions(f)).toEqual(['workbench:read']);
    expect(await sessions.resolve(old.token)).toBeNull();
    expect((await prisma.passwordReset.findUniqueOrThrow({ where: { id: reset.id } })).consumedAt).not.toBeNull();
    expect(await prisma.userRole.count({ where: { userId: f.user.id } })).toBe(0);
    expect(await sessions.resolve((await login(f.user.id)).token)).not.toBeNull();
  });

  it.each(['account:roles:read', 'organization:structure:read'])('requires %s as part of the GET combination', async (missing) => {
    const f = await fixture(allCodes.filter((code) => code !== missing));
    await request(app.getHttpServer()).get(`${f.path}/positions/${f.position.id}/roles`).set('Cookie', f.auth.cookie).expect(403);
  });
  it.each(['account:roles:read', 'account:roles:assign', 'organization:structure:manage'])('requires %s for mapping writes without partial state', async (missing) => {
    const f = await fixture(allCodes.filter((code) => code !== missing));
    await trustedConfigure(f).expect(403);
    expect(await prisma.positionRole.count({ where: { positionId: f.position.id } })).toBe(0);
    expect((await prisma.position.findUniqueOrThrow({ where: { id: f.position.id } })).roleVersion).toBe(1);
  });

  it('enforces CSRF, full sessions, recent authentication, idempotency keys and strict DTO validation', async () => {
    const f = await fixture();
    const url = `${f.path}/positions/${f.position.id}/roles`;
    const body = { roleIds: [f.grant.id], expectedRoleVersion: 1 };
    await request(app.getHttpServer()).get(url).expect(401);
    await request(app.getHttpServer()).put(url).set('Cookie', f.auth.cookie).send(body).expect(403);
    await request(app.getHttpServer()).put(url).set('Cookie', f.auth.cookie).set('x-csrf-token', csrf).send(body).expect(400);
    await send(f, 'put', `/positions/${f.position.id}/roles`, body, randomUUID(), (await login(f.admin.id, false)).cookie).expect(403);
    await send(f, 'put', `/positions/${f.position.id}/roles`, { ...body, name: 'Cannot edit role definitions' }).expect(400);
    await send(f, 'put', `/users/${f.user.id}/positions`, { positionIds: [], expectedPositionIds: [f.position.id] }).expect(400);
    await send(f, 'put', `/positions/${f.position.id}/roles`, body).expect(403);
  });

  it('uses independent role CAS, replays identical payload once and rejects changed payload or a stale version', async () => {
    const f = await fixture();
    const key = randomUUID();
    const first = await trustedConfigure(f, [f.grant.id], 1, key).expect(200);
    expect((await trustedConfigure(f, [f.grant.id], 1, key).expect(200)).body).toEqual(first.body);
    await trustedConfigure(f, [], 1, key).expect(409);
    await trustedConfigure(f, [], 1).expect(409);
    expect(await prisma.auditEvent.count({ where: { action: 'POSITION_ROLES_CHANGED', resourceId: f.position.id, outcome: 'SUCCESS' } })).toBe(1);
    expect((await prisma.position.findUniqueOrThrow({ where: { id: f.position.id } })).version).toBe(1);
    const races = await Promise.all([trustedConfigure(f, [], 2), trustedConfigure(f, [], 2)]);
    expect(races.map(({ status }) => status).sort()).toEqual([200, 409]);
  });

  it('rejects a role-version overflow at the HTTP boundary without invoking an overflowing Prisma Int', async () => {
    const f = await fixture();
    await send(f, 'put', `/positions/${f.position.id}/roles`, { roleIds: [f.grant.id], expectedRoleVersion: 2147483648 }).expect(400);
    expect((await prisma.position.findUniqueOrThrow({ where: { id: f.position.id } })).roleVersion).toBe(1);
    expect(await prisma.positionRole.count({ where: { positionId: f.position.id } })).toBe(0);
  });

  it('rejects a role-version increment at the database Int ceiling without a 500 or mapping change', async () => {
    const f = await fixture();
    await prisma.position.update({ where: { id: f.position.id }, data: { roleVersion: 2147483647 } });
    await trustedConfigure(f, [f.grant.id], 2147483647).expect(409);
    expect((await prisma.position.findUniqueOrThrow({ where: { id: f.position.id } })).roleVersion).toBe(2147483647);
    expect(await prisma.positionRole.count({ where: { positionId: f.position.id } })).toBe(0);
  });

  it.each(['global', 'foreign', 'missing', 'ceiling', 'old-ceiling'] as const)('rejects %s roles including removal of an excessive old source', async (kind) => {
    const f = await fixture(allCodes.filter((code) => code !== 'audit:export'));
    const invalid = kind === 'missing' ? { id: randomUUID() } : await role(kind === 'global' ? null : kind === 'foreign' ? (await organization()).id : f.org.id, ['audit:export']);
    if (kind === 'old-ceiling') await prisma.positionRole.create({ data: { organizationId: f.org.id, positionId: f.position.id, roleId: invalid.id } });
    const result = await trustedConfigure(f, kind === 'old-ceiling' ? [] : [invalid.id]);
    expect([403, 404]).toContain(result.status);
    expect((await prisma.position.findUniqueOrThrow({ where: { id: f.position.id } })).roleVersion).toBe(1);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: f.user.id } })).securityVersion).toBe(f.user.securityVersion);
  });

  it('bounds supplier position roles to portal permissions while preserving internal cross-organization caretaker grants', async () => {
    const f = await fixture(allCodes, 'SUPPLIER');
    const bad = await role(f.org.id, ['account:users:reset']);
    await trustedConfigure(f, [bad.id]).expect(403);
    await trustedConfigure(f).expect(200);
    expect(await permissions(f)).toEqual(['notification:read']);
    expect(await prisma.userRole.count({ where: { userId: f.admin.id, organizationId: f.org.id } })).toBe(1);
  });

  it('rejects foreign organization scope for complete sessions and never reveals another organizations position', async () => {
    const f = await fixture();
    const foreign = await fixture();
    await request(app.getHttpServer()).get(`${foreign.path}/positions/${foreign.position.id}/roles`).set('Cookie', f.auth.cookie).expect(403);
    await request(app.getHttpServer()).get(`${f.path}/positions/${foreign.position.id}/roles`).set('Cookie', f.auth.cookie).expect(404);
    await trustedConfigure(f, [f.grant.id], 1, randomUUID(), foreign.position.id).expect(404);
  });

  async function legacyPermission(f: Fixture) {
    const permission = await prisma.permission.create({ data: { code: `legacy:position:${randomUUID()}`, name: 'Legacy permission outside the active catalog' } });
    legacyPermissionIds.push(permission.id);
    await prisma.rolePermission.createMany({ data: [f.adminRole.id, f.grant.id].map((roleId) => ({ roleId, permissionId: permission.id })) });
    return permission;
  }

  it.each(['mapping', 'appointment', 'position-enable', 'department-enable', 'position-move'] as const)('rejects unknown permissions on the %s grant path even when the actor holds them', async (kind) => {
    const f = await fixture();
    await legacyPermission(f);
    if (kind !== 'mapping') await seedMapping(f);
    if (kind === 'appointment') await prisma.userPosition.updateMany({ where: { userId: f.user.id }, data: { endedAt: new Date() } });
    if (kind === 'position-enable') await prisma.position.update({ where: { id: f.position.id }, data: { status: 'DISABLED' } });
    if (kind === 'department-enable' || kind === 'position-move') await prisma.department.update({ where: { id: f.department.id }, data: { status: 'DISABLED' } });
    let response;
    if (kind === 'mapping') {
      await expect(app.get(AdminRoleService).assign(f.actor, f.user.id, { roleIds: [f.grant.id] }, randomUUID(), randomUUID())).rejects.toMatchObject({ status: 400, response: { code: 'ADMIN_PERMISSION_NOT_FOUND' } });
      response = await trustedConfigure(f).expect(400);
    } else if (kind === 'appointment') {
      response = await trustedAppointments(f, f.user.id, { positionIds: [f.position.id], expectedPositionIds: [] }).expect(400);
    } else if (kind === 'position-move') {
      const other = await prisma.department.create({ data: { organizationId: f.org.id, code: randomUUID(), name: 'Active move target' } });
      response = await send(f, 'patch', `/positions/${f.position.id}`, { expectedVersion: 1, departmentId: other.id }).expect(400);
    } else {
      response = await send(f, 'patch', kind === 'position-enable' ? `/positions/${f.position.id}` : `/departments/${f.department.id}`, { expectedVersion: 1, status: 'ACTIVE' }).expect(400);
    }
    expect(response.body.code).toBe('ADMIN_PERMISSION_NOT_FOUND');
    expect((await prisma.position.findUniqueOrThrow({ where: { id: f.position.id } })).roleVersion).toBe(1);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: f.user.id } })).securityVersion).toBe(f.user.securityVersion);
  });

  it.each(['mapping', 'disabled-mapping', 'appointment', 'position', 'department'] as const)('allows removing legacy unknown permissions through %s without demanding new grantability', async (kind) => {
    const f = await fixture();
    await legacyPermission(f);
    await seedMapping(f);
    if (kind === 'disabled-mapping') await prisma.position.update({ where: { id: f.position.id }, data: { status: 'DISABLED' } });
    if (kind === 'mapping' || kind === 'disabled-mapping') {
      await trustedConfigure(f, []).expect(200);
      expect(await prisma.positionRole.count({ where: { positionId: f.position.id } })).toBe(0);
    } else if (kind === 'appointment') {
      await trustedAppointments(f, f.user.id, { positionIds: [], expectedPositionIds: [f.position.id] }).expect(200);
    } else {
      await send(f, 'patch', kind === 'position' ? `/positions/${f.position.id}` : `/departments/${f.department.id}`, { expectedVersion: 1, status: 'DISABLED' }).expect(200);
    }
    expect(await permissions(f)).toEqual([]);
  });

  it('preserves direct and other position sources as each mapping is removed', async () => {
    const f = await fixture();
    await seedMapping(f);
    const q = await prisma.position.create({ data: { organizationId: f.org.id, departmentId: f.department.id, code: randomUUID(), name: 'Other source' } });
    await prisma.positionRole.create({ data: { organizationId: f.org.id, positionId: q.id, roleId: f.grant.id } });
    await prisma.userPosition.create({ data: { organizationId: f.org.id, userId: f.user.id, positionId: q.id } });
    await prisma.userRole.create({ data: { organizationId: f.org.id, userId: f.user.id, roleId: f.grant.id } });
    await trustedConfigure(f, []).expect(200);
    expect((await effectiveRoleGrants(prisma, f.user.id, f.org.id))[0].sources).toHaveLength(2);
    await trustedConfigure(f, [], 1, randomUUID(), q.id).expect(200);
    expect((await effectiveRoleGrants(prisma, f.user.id, f.org.id))[0].sources).toEqual([{ kind: 'DIRECT' }]);
    await app.get(AdminRoleService).assign(f.actor, f.user.id, { roleIds: [] }, randomUUID(), randomUUID());
    expect(await permissions(f)).toEqual([]);
  });

  it('ends all currently effective duplicate rows including future endings and compares unique expected positions', async () => {
    const f = await fixture();
    await seedMapping(f);
    await prisma.userPosition.create({ data: { organizationId: f.org.id, userId: f.user.id, positionId: f.position.id, startedAt: new Date(Date.now() - 60_000), endedAt: new Date(Date.now() + 86_400_000) } });
    const old = await login(f.user.id);
    await trustedAppointments(f, f.user.id, { positionIds: [], expectedPositionIds: [f.position.id] }).expect(200);
    expect(await permissions(f)).toEqual([]);
    expect(await sessions.resolve(old.token)).toBeNull();
    const history = await prisma.userPosition.findMany({ where: { userId: f.user.id } });
    expect(history).toHaveLength(2);
    expect(history.every(({ endedAt }) => endedAt && endedAt.getTime() <= Date.now())).toBe(true);
    await trustedAppointments(f, f.user.id, { positionIds: [f.position.id], expectedPositionIds: [] }).expect(200);
    expect(await permissions(f)).toEqual(['workbench:read']);
    expect(await prisma.userPosition.count({ where: { userId: f.user.id } })).toBe(3);
  });

  it.each(['add', 'remove', 'position-disable', 'position-enable', 'position-move', 'department-disable', 'department-enable'] as const)('protects %s from structure/assignment-only authority', async (kind) => {
    const f = await fixture(['organization:read', 'organization:structure:read', 'organization:structure:manage', 'organization:positions:assign']);
    await seedMapping(f);
    if (kind === 'add') await prisma.userPosition.updateMany({ where: { userId: f.user.id }, data: { endedAt: new Date() } });
    if (kind === 'position-enable') await prisma.position.update({ where: { id: f.position.id }, data: { status: 'DISABLED' } });
    if (kind === 'department-enable') await prisma.department.update({ where: { id: f.department.id }, data: { status: 'DISABLED' } });
    if (kind === 'add' || kind === 'remove') {
      await trustedAppointments(f, f.user.id, { positionIds: kind === 'add' ? [f.position.id] : [], expectedPositionIds: kind === 'add' ? [] : [f.position.id] }).expect(403);
    } else if (kind.startsWith('position')) {
      const other = await prisma.department.create({ data: { organizationId: f.org.id, code: randomUUID(), name: 'Move target' } });
      await send(f, 'patch', `/positions/${f.position.id}`, { expectedVersion: 1, ...(kind === 'position-move' ? { departmentId: other.id } : { status: kind === 'position-enable' ? 'ACTIVE' : 'DISABLED' }) }).expect(403);
    } else {
      await send(f, 'patch', `/departments/${f.department.id}`, { expectedVersion: 1, status: kind === 'department-enable' ? 'ACTIVE' : 'DISABLED' }).expect(403);
    }
    expect((await prisma.user.findUniqueOrThrow({ where: { id: f.user.id } })).securityVersion).toBe(f.user.securityVersion);
  });

  it.each(['add', 'remove', 'position', 'department'] as const)('enforces the role ceiling for %s even with the complete permission combination', async (kind) => {
    const f = await fixture(allCodes.filter((code) => code !== 'audit:export'));
    const excessive = await role(f.org.id, ['audit:export']);
    await prisma.positionRole.create({ data: { organizationId: f.org.id, positionId: f.position.id, roleId: excessive.id } });
    if (kind === 'add') await prisma.userPosition.updateMany({ where: { userId: f.user.id }, data: { endedAt: new Date() } });
    if (kind === 'add' || kind === 'remove') {
      await trustedAppointments(f, f.user.id, { positionIds: kind === 'add' ? [f.position.id] : [], expectedPositionIds: kind === 'add' ? [] : [f.position.id] }).expect(403);
    } else {
      await send(f, 'patch', kind === 'position' ? `/positions/${f.position.id}` : `/departments/${f.department.id}`, { expectedVersion: 1, status: 'DISABLED' }).expect(403);
    }
    expect((await prisma.user.findUniqueOrThrow({ where: { id: f.user.id } })).securityVersion).toBe(f.user.securityVersion);
  });

  it('keeps empty-role ordinary appointments and structure maintenance free of role-management requirements', async () => {
    const f = await fixture(['organization:read', 'organization:structure:read', 'organization:structure:manage', 'organization:positions:assign']);
    await trustedAppointments(f, f.user.id, { positionIds: [], expectedPositionIds: [f.position.id] }).expect(200);
    await trustedAppointments(f, f.user.id, { positionIds: [f.position.id], expectedPositionIds: [] }).expect(200);
    await send(f, 'patch', `/positions/${f.position.id}`, { expectedVersion: 1, status: 'DISABLED' }).expect(200);
    await send(f, 'patch', `/departments/${f.department.id}`, { expectedVersion: 1, status: 'DISABLED' }).expect(200);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: f.user.id } })).securityVersion).toBe(f.user.securityVersion);
  });

  it('revokes and restores effective grants on position/department status and permits disabled mapping cleanup', async () => {
    const f = await fixture();
    await seedMapping(f);
    let old = await login(f.user.id);
    await send(f, 'patch', `/positions/${f.position.id}`, { expectedVersion: 1, status: 'DISABLED' }).expect(200);
    expect(await permissions(f)).toEqual([]);
    expect(await sessions.resolve(old.token)).toBeNull();
    await trustedConfigure(f, []).expect(200);
    await trustedConfigure(f, [f.grant.id], 2).expect(200);
    expect(await permissions(f)).toEqual([]);
    await send(f, 'patch', `/positions/${f.position.id}`, { expectedVersion: 2, status: 'ACTIVE' }).expect(200);
    expect(await permissions(f)).toEqual(['workbench:read']);
    old = await login(f.user.id);
    await send(f, 'patch', `/departments/${f.department.id}`, { expectedVersion: 1, status: 'DISABLED' }).expect(200);
    expect(await permissions(f)).toEqual([]);
    expect(await sessions.resolve(old.token)).toBeNull();
    await send(f, 'patch', `/departments/${f.department.id}`, { expectedVersion: 2, status: 'ACTIVE' }).expect(200);
    expect(await permissions(f)).toEqual(['workbench:read']);
  });

  it('restores grants by moving an active position out of a disabled immediate department', async () => {
    const f = await fixture();
    await seedMapping(f);
    await prisma.department.update({ where: { id: f.department.id }, data: { status: 'DISABLED' } });
    const other = await prisma.department.create({ data: { organizationId: f.org.id, code: randomUUID(), name: 'Active target' } });
    const old = await login(f.user.id);
    await send(f, 'patch', `/positions/${f.position.id}`, { expectedVersion: 1, departmentId: other.id }).expect(200);
    expect(await permissions(f)).toEqual(['workbench:read']);
    expect(await sessions.resolve(old.token)).toBeNull();
    expect(await prisma.userRole.count({ where: { userId: f.user.id } })).toBe(0);
  });

  it('does not invalidate sessions for identical role sets or pure position and department name changes', async () => {
    const f = await fixture();
    await seedMapping(f);
    const old = await login(f.user.id);
    await trustedConfigure(f).expect(200);
    await send(f, 'patch', `/positions/${f.position.id}`, { expectedVersion: 1, name: 'Renamed position' }).expect(200);
    await send(f, 'patch', `/departments/${f.department.id}`, { expectedVersion: 1, name: 'Renamed department' }).expect(200);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: f.user.id } })).securityVersion).toBe(f.user.securityVersion);
    expect(await sessions.resolve(old.token)).not.toBeNull();
  });

  it('uses only the immediate department, leaves future/historical appointments ineffective and counts users once', async () => {
    const f = await fixture();
    const parent = await prisma.department.create({ data: { organizationId: f.org.id, code: randomUUID(), name: 'Parent' } });
    await prisma.department.update({ where: { id: f.department.id }, data: { parentId: parent.id } });
    await seedMapping(f);
    await send(f, 'patch', `/departments/${parent.id}`, { expectedVersion: 1, status: 'DISABLED' }).expect(200);
    expect(await permissions(f)).toEqual(['workbench:read']);
    await prisma.userPosition.create({ data: { organizationId: f.org.id, userId: f.user.id, positionId: f.position.id, endedAt: new Date(Date.now() + 60_000) } });
    const future = await person(f.org.id);
    await prisma.userPosition.create({ data: { organizationId: f.org.id, userId: future.id, positionId: f.position.id, startedAt: new Date(Date.now() + 60_000) } });
    const response = await request(app.getHttpServer()).get(`${f.path}/positions/${f.position.id}/roles`).set('Cookie', f.auth.cookie).expect(200);
    expect(response.body.effectiveAssigneeCount).toBe(1);
    await trustedConfigure(f, []).expect(200);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: future.id } })).securityVersion).toBe(future.securityVersion);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: f.user.id } })).securityVersion).toBe(f.user.securityVersion + 1);
  });

  it('rolls back mappings, CAS, invalidation, resets, idempotency and success audit when audit persistence fails', async () => {
    const f = await fixture();
    const old = await login(f.user.id);
    const key = randomUUID();
    const reset = await prisma.passwordReset.create({ data: { userId: f.user.id, codeHash: 'b'.repeat(64), expiresAt: new Date(Date.now() + 60_000) } });
    const spy = jest.spyOn(app.get(AuditLogService), 'record').mockRejectedValueOnce(new Error('test audit unavailable'));
    try { await expect(trustedConfigure(f, [f.grant.id], 1, key)).rejects.toThrow('test audit unavailable'); } finally { spy.mockRestore(); }
    expect(await prisma.positionRole.count({ where: { positionId: f.position.id } })).toBe(0);
    expect((await prisma.position.findUniqueOrThrow({ where: { id: f.position.id } })).roleVersion).toBe(1);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: f.user.id } })).securityVersion).toBe(f.user.securityVersion);
    expect((await prisma.passwordReset.findUniqueOrThrow({ where: { id: reset.id } })).consumedAt).toBeNull();
    expect(await sessions.resolve(old.token)).not.toBeNull();
    expect(await prisma.adminMutation.count({ where: { actorUserId: f.admin.id, key } })).toBe(0);
    expect(await prisma.auditEvent.count({ where: { resourceId: f.position.id, action: 'POSITION_ROLES_CHANGED' } })).toBe(0);
  });

  it('returns committed self invalidation then rejects the old session, retaining complete other sources for self-lock checks', async () => {
    const f = await fixture();
    await prisma.userPosition.create({ data: { organizationId: f.org.id, userId: f.admin.id, positionId: f.position.id } });
    const result = await trustedConfigure(f).expect(200);
    expect(result.body.selfSessionRevoked).toBe(true);
    expect(await sessions.resolve(f.auth.token)).toBeNull();
    await request(app.getHttpServer()).get(`${f.path}/positions`).set('Cookie', f.auth.cookie).expect(401);
    f.auth = await login(f.admin.id);
    await trustedConfigure(f, [], 2).expect(200);
    const fresh = await fixture();
    await prisma.userPosition.create({ data: { organizationId: fresh.org.id, userId: fresh.admin.id, positionId: fresh.position.id } });
    await prisma.positionRole.create({ data: { organizationId: fresh.org.id, positionId: fresh.position.id, roleId: fresh.adminRole.id } });
    await prisma.userRole.deleteMany({ where: { userId: fresh.admin.id } });
    await trustedConfigure(fresh, []).expect(409);
    expect(await prisma.positionRole.count({ where: { positionId: fresh.position.id } })).toBe(1);
    expect(await sessions.resolve(fresh.auth.token)).not.toBeNull();
  });

  it.each(['appointment', 'position', 'department'] as const)('rolls back self-lock through %s using inherited administrator permissions', async (kind) => {
    const f = await fixture();
    await prisma.userPosition.create({ data: { organizationId: f.org.id, userId: f.admin.id, positionId: f.position.id } });
    await prisma.positionRole.create({ data: { organizationId: f.org.id, positionId: f.position.id, roleId: f.adminRole.id } });
    await prisma.userRole.deleteMany({ where: { userId: f.admin.id } });
    const response = kind === 'appointment'
      ? await trustedAppointments(f, f.admin.id, { positionIds: [], expectedPositionIds: [f.position.id] }).expect(409)
      : await send(f, 'patch', kind === 'position' ? `/positions/${f.position.id}` : `/departments/${f.department.id}`, { expectedVersion: 1, status: 'DISABLED' }).expect(409);
    expect(response.body.code).toBe('ADMIN_SELF_LOCK_FORBIDDEN');
    expect((await prisma.user.findUniqueOrThrow({ where: { id: f.admin.id } })).securityVersion).toBe(f.admin.securityVersion);
    expect(await sessions.resolve(f.auth.token)).not.toBeNull();
  });

  it('updates 1000 assignees in a normal transaction with one invalidation per user regardless of duplicate sources', async () => {
    const f = await fixture();
    const ids = Array.from({ length: 1000 }, () => randomUUID());
    await prisma.user.createMany({ data: ids.map((id) => ({ id, organizationId: f.org.id, username: randomUUID(), accountType: 'INTERNAL' as const, passwordHash: 'test-only' })) });
    await prisma.userPosition.createMany({ data: ids.flatMap((userId) => [
      { organizationId: f.org.id, userId, positionId: f.position.id, startedAt: new Date(Date.now() - 60_000), endedAt: null },
      { organizationId: f.org.id, userId, positionId: f.position.id, startedAt: new Date(Date.now() - 60_000), endedAt: new Date(Date.now() + 86_400_000) },
    ]) });
    await prisma.passwordReset.createMany({ data: ids.map((userId) => ({ userId, codeHash: 'c'.repeat(64), expiresAt: new Date(Date.now() + 60_000) })) });
    const service = app.get(OrganizationService);
    const original = service.replacePositionRoles.bind(service);
    const failures: unknown[] = [];
    const timings: { name: string; milliseconds: number }[] = [];
    const timed = service as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>;
    const timingSpies = ['lockOrganization', 'lockPositions', 'lockPositionAssignees', 'lockUsers', 'refreshPositionAccess', 'effectivePositionUsers'].map((name) => {
      const work = timed[name]!.bind(service);
      return jest.spyOn(timed, name).mockImplementation(async (...args) => {
        const start = performance.now();
        try { return await work(...args); }
        finally { timings.push({ name, milliseconds: Math.round(performance.now() - start) }); }
      });
    });
    const errors = jest.spyOn(service, 'replacePositionRoles').mockImplementation(async (...args) => {
      try { return await original(...args); }
      catch (error) {
        failures.push({ name: (error as Error).name, code: (error as { code?: string }).code, detail: (error as { meta?: { error?: string } }).meta?.error ?? String((error as Error).message).slice(-500) });
        throw error;
      }
    });
    let response;
    try {
      response = await trustedConfigure(f);
      if (response.status !== 200) failures.push({ timings });
      expect({ status: response.status, failures }).toEqual({ status: 200, failures: [] });
    } finally { errors.mockRestore(); for (const spy of timingSpies) spy.mockRestore(); }
    expect(response.body.effectiveAssigneeCount).toBe(1001);
    expect(await prisma.user.count({ where: { id: { in: ids }, securityVersion: 2 } })).toBe(1000);
    expect(await prisma.passwordReset.count({ where: { userId: { in: ids }, consumedAt: { not: null } } })).toBe(1000);
  });

  it('rejects a sensitive request that passed Guard before waiting on revocation', async () => {
    const f = await fixture();
    const sensitive = await role(f.org.id, ['organization:read', 'organization:structure:manage']);
    await prisma.positionRole.create({ data: { organizationId: f.org.id, positionId: f.position.id, roleId: sensitive.id } });
    const victim = await login(f.user.id);
    let acquired!: () => void;
    let release!: () => void;
    const ready = new Promise<void>((resolve) => { acquired = resolve; });
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const audit = app.get(AuditLogService);
    const original = audit.record.bind(audit);
    const spy = jest.spyOn(audit, 'record').mockImplementation(async (event, tx) => {
      if (event.action === 'POSITION_ROLES_CHANGED') { acquired(); await gate; }
      return original(event, tx);
    });
    const revocation = trustedConfigure(f, []).then((result) => result);
    await Promise.race([ready, revocation.then((result) => { throw new Error(`Revocation did not reach transactional audit: ${result.status}`); })]);
    const code = randomUUID();
    const write = send(f, 'post', '/departments', { code, name: 'Must not be written' }, randomUUID(), victim.cookie).then((result) => result);
    try {
      let waiting = false;
      for (let i = 0; i < 100 && !waiting; i += 1) {
        const state = await prisma.$queryRaw<{ waiting: boolean }[]>`SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE 'SELECT id FROM users%') AS waiting`;
        waiting = state[0].waiting;
        if (!waiting) await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(waiting).toBe(true);
    } finally { release(); spy.mockRestore(); }
    expect((await revocation).status).toBe(200);
    expect([401, 409]).toContain((await write).status);
    expect(await prisma.department.count({ where: { organizationId: f.org.id, code } })).toBe(0);
  });

  it.each(['role', 'position', 'assignee', 'role-self'] as const)('rechecks a real expiring grant after waiting on the %s resource lock and before any authorization write', async (lockedResource) => {
    const f = await fixture(allCodes.filter((code) => code !== 'workbench:read'));
    if (lockedResource === 'role-self') await prisma.userPosition.create({ data: { organizationId: f.org.id, userId: f.admin.id, positionId: f.position.id } });
    const temporaryRole = await role(f.org.id, ['workbench:read']);
    const temporaryPosition = await prisma.position.create({ data: { organizationId: f.org.id, departmentId: f.department.id, code: randomUUID(), name: 'Expiring authority' } });
    await prisma.positionRole.create({ data: { organizationId: f.org.id, positionId: temporaryPosition.id, roleId: temporaryRole.id } });
    const endsAt = new Date(Date.now() + 1800);
    await prisma.userPosition.create({ data: { organizationId: f.org.id, userId: f.admin.id, positionId: temporaryPosition.id, startedAt: new Date(Date.now() - 60_000), endedAt: endsAt } });
    let locked!: () => void;
    let release!: () => void;
    const acquired = new Promise<void>((resolve) => { locked = resolve; });
    const released = new Promise<void>((resolve) => { release = resolve; });
    const blocker = prisma.$transaction(async (tx) => {
      if (lockedResource === 'role' || lockedResource === 'role-self') await tx.$queryRaw`SELECT id FROM roles WHERE id = ${f.grant.id}::uuid FOR UPDATE`;
      else if (lockedResource === 'position') await tx.$queryRaw`SELECT id FROM positions WHERE id = ${f.position.id}::uuid FOR UPDATE`;
      else await tx.$queryRaw`SELECT id FROM users WHERE id = ${f.user.id}::uuid FOR UPDATE`;
      locked();
      await released;
    });
    await acquired;
    const key = randomUUID();
    const pending = trustedConfigure(f, [f.grant.id], 1, key).then((result) => result);
    try {
      let waiting = false;
      for (let attempt = 0; attempt < 100 && !waiting; attempt += 1) {
        const activity = await prisma.$queryRaw<{ waiting: boolean }[]>`SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND (query LIKE 'SELECT id FROM roles%' OR query LIKE 'SELECT id FROM positions%' OR query LIKE 'SELECT id FROM users%' OR query LIKE 'UPDATE%positions%')) AS waiting`;
        waiting = activity[0].waiting;
        if (!waiting) await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(waiting).toBe(true);
      await new Promise((resolve) => setTimeout(resolve, Math.max(0, endsAt.getTime() - Date.now()) + 30));
      expect((await effectiveRoleGrants(prisma, f.admin.id, f.org.id)).flatMap(({ role }) => role.permissions.map(({ permission }) => permission.code))).not.toContain('workbench:read');
    } finally { release(); }
    await blocker;
    const response = await pending;
    expect(response.status).toBe(403);
    expect(response.body.code).toBe('FEATURE_PERMISSION_DENIED');
    expect(await prisma.positionRole.count({ where: { positionId: f.position.id } })).toBe(0);
    expect((await prisma.position.findUniqueOrThrow({ where: { id: f.position.id } })).roleVersion).toBe(1);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: f.user.id } })).securityVersion).toBe(f.user.securityVersion);
    expect(await prisma.adminMutation.count({ where: { actorUserId: f.admin.id, key } })).toBe(0);
    expect(await prisma.auditEvent.count({ where: { resourceId: f.position.id, action: 'POSITION_ROLES_CHANGED', outcome: 'SUCCESS' } })).toBe(0);
  });

  it('controls concurrent role deletion/configuration without 500 or half-written mappings', async () => {
    const f = await fixture();
    const other = await person(f.org.id);
    await prisma.userRole.create({ data: { organizationId: f.org.id, userId: other.id, roleId: f.adminRole.id } });
    const otherAuth = await login(other.id);
    const result = await Promise.allSettled([
      trustedConfigure(f).then(({ status }) => status),
      app.get(AdminRoleService).remove({ ...f.actor, id: other.id, sessionId: otherAuth.sessionId }, f.grant.id, randomUUID(), randomUUID()),
    ]);
    for (const entry of result) {
      if (entry.status === 'fulfilled' && typeof entry.value === 'number') expect([200, 404, 409]).toContain(entry.value);
      if (entry.status === 'rejected') expect([404, 409]).toContain((entry.reason as { status: number }).status);
    }
    const mappings = await prisma.positionRole.findMany({ where: { positionId: f.position.id } });
    const version = (await prisma.position.findUniqueOrThrow({ where: { id: f.position.id } })).roleVersion;
    expect(version).toBe(mappings.length ? 2 : 1);
    if (mappings.length) expect(await prisma.role.findUnique({ where: { id: f.grant.id } })).not.toBeNull();
  });
});
