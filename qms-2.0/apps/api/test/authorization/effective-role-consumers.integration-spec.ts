import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { jest } from '@jest/globals';
import { PrismaService } from '../../src/database/prisma.service.js';
import { AdminMutationService, adminPermissions, type AdminActor } from '../../src/common/security/admin-mutation.service.js';
import { mfaPolicy } from '../../src/common/security/session-security.js';
import { AUTHENTICATED_SESSION, type AuthorizedRequest } from '../../src/common/guards/authenticated.guard.js';
import { AuditLogService } from '../../src/modules/audit-log/audit-log.service.js';
import { AdminRoleService } from '../../src/modules/authorization/admin-role.service.js';
import { AuthorizationService } from '../../src/modules/authorization/authorization.service.js';
import { ADMIN_PERMISSIONS } from '../../src/modules/authorization/permission-catalog.js';
import { assertSupplierAccountTarget, SUPPLIER_PORTAL_PERMISSIONS } from '../../src/modules/authorization/supplier-account-authorization.js';
import { AdminOrganizationController } from '../../src/modules/identity/admin-organization.controller.js';
import { AdminUserService } from '../../src/modules/identity/admin-user.service.js';
import { SessionService } from '../../src/modules/identity/session.service.js';
import { SupplierAccountIdentityService } from '../../src/modules/identity/supplier-account-identity.service.js';
import { OrganizationScopeService } from '../../src/modules/organization/organization-scope.service.js';
import { OrganizationService } from '../../src/modules/organization/organization.service.js';

const connection = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL) : undefined;
if (!connection || process.env.QMS_DISPOSABLE_TEST_DB !== 'true'
  || !['postgres:', 'postgresql:'].includes(connection.protocol)
  || !['localhost', '127.0.0.1', '[::1]'].includes(connection.hostname)
  || connection.port === '55440' || connection.search || connection.hash) {
  throw new Error('Effective-role consumers require explicitly disposable loopback PostgreSQL; preview 55440 is forbidden.');
}
jest.setTimeout(120_000);

describe('effective-role consumers with real PostgreSQL', () => {
  const prisma = new PrismaService();
  const audit = new AuditLogService(prisma);
  const mutations = new AdminMutationService(prisma, audit);
  const roles = new AdminRoleService(prisma, audit, mutations);
  const authorization = new AuthorizationService(prisma);
  const scopes = new OrganizationScopeService(prisma);
  const organizations = new OrganizationService(prisma, mutations, audit, undefined as never);
  const directory = new AdminOrganizationController(prisma);
  const sessions = new SessionService(prisma, audit);
  const users = new AdminUserService(prisma, undefined as never, audit, mutations, undefined as never, undefined as never, undefined as never);
  const organizationIds: string[] = [];
  const allCodes = [...new Set([...ADMIN_PERMISSIONS, ...SUPPLIER_PORTAL_PERMISSIONS, 'workbench:read', 'organization:read', 'organization:manage', 'organization:structure:read'])];

  beforeAll(async () => { await prisma.$connect(); });
  afterAll(async () => {
    const where = { organizationId: { in: organizationIds } };
    try {
      await prisma.auditEvent.deleteMany({ where });
      await prisma.adminMutation.deleteMany({ where });
      await prisma.userPosition.deleteMany({ where });
      await prisma.positionRole.deleteMany({ where });
      await prisma.position.deleteMany({ where });
      await prisma.department.deleteMany({ where });
      await prisma.user.deleteMany({ where });
      await prisma.organization.deleteMany({ where: { id: { in: organizationIds } } });
    } finally { await prisma.$disconnect(); }
  });

  async function organization(type: 'INTERNAL' | 'SUPPLIER' = 'INTERNAL') {
    const value = await prisma.organization.create({ data: { code: randomUUID(), name: 'U2-B consumers', type } });
    organizationIds.push(value.id);
    return value;
  }

  async function role(organizationId: string, codes: string[], mfaRequired = false) {
    const permissions = await Promise.all(codes.map((code) => prisma.permission.upsert({ where: { code }, create: { code, name: code }, update: {} })));
    return prisma.role.create({ data: { organizationId, code: randomUUID(), name: 'Consumer role', mfaRequired, permissions: { create: permissions.map(({ id }) => ({ permissionId: id })) } } });
  }

  async function person(organizationId: string, accountType: 'INTERNAL' | 'SUPPLIER' = 'INTERNAL') {
    return prisma.user.create({ data: { organizationId, username: randomUUID(), accountType, passwordHash: 'test-only' } });
  }

  async function position(organizationId: string, userId: string, roleId: string) {
    const department = await prisma.department.create({ data: { organizationId, code: randomUUID(), name: 'Consumers' } });
    const value = await prisma.position.create({ data: { organizationId, departmentId: department.id, code: randomUUID(), name: 'Consumers' } });
    await prisma.positionRole.create({ data: { organizationId, positionId: value.id, roleId } });
    const assignment = await prisma.userPosition.create({ data: { organizationId, userId, positionId: value.id, startedAt: new Date(Date.now() - 60_000) } });
    return { ...value, assignment, department };
  }

  async function fixture(codes = ['workbench:read'], type: 'INTERNAL' | 'SUPPLIER' = 'INTERNAL') {
    const home = await organization(type);
    const adminHome = type === 'SUPPLIER' ? await organization() : home;
    const admin = await person(adminHome.id);
    const adminRole = await role(home.id, allCodes);
    await prisma.userRole.create({ data: { organizationId: home.id, userId: admin.id, roleId: adminRole.id } });
    const token = await sessions.create(admin.id, prisma, { mfaVerified: true, reauthenticated: true });
    const session = (await sessions.resolve(token))!;
    const actor: AdminActor = { id: admin.id, sessionId: session.id, organizationId: adminHome.id, scopeOrganizationId: home.id, accountType: 'INTERNAL' };
    const user = await person(home.id, type);
    const grant = await role(home.id, codes);
    const p = await position(home.id, user.id, grant.id);
    return { home, admin, adminRole, actor, user, grant, p, session: { id: randomUUID(), user } };
  }

  it('authorizes position-only feature/context and transaction permissions, preserving workflow denial', async () => {
    const f = await fixture(['organization:read', 'workbench:read']);
    await expect(authorization.assertFeature(f.user.id, f.home.id, 'organization:read')).resolves.toBeUndefined();
    expect(await authorization.permissionsForContext(f.user.id, f.home.id)).toEqual(['organization:read', 'workbench:read']);
    expect(await prisma.$transaction((tx) => adminPermissions(tx, f.user.id, f.home.id))).toEqual(['organization:read', 'workbench:read']);
    await expect(authorization.assertAccess(f.session, { featurePermission: 'organization:read', workflowPermission: 'approval:advance' })).rejects.toMatchObject({ response: { code: 'WORKFLOW_PERMISSION_REQUIRED' } });
    await expect(authorization.assertFeature(f.user.id, f.home.id, 'account:users:create')).rejects.toMatchObject({ response: { code: 'FEATURE_PERMISSION_DENIED' } });
  });

  it('includes the position-only home in scope, organization tree and admin directory', async () => {
    const f = await fixture(['organization:read', 'organization:structure:read']);
    const actor = { ...f.actor, id: f.user.id };
    await expect(scopes.fromSession(f.session)).resolves.toBe(f.home.id);
    expect(await organizations.tree(actor, {})).toEqual([expect.objectContaining({ id: f.home.id })]);
    expect(await directory.list({ [AUTHENTICATED_SESSION]: f.session } as AuthorizedRequest)).toEqual([expect.objectContaining({ id: f.home.id, permissions: ['organization:read', 'organization:structure:read'] })]);
    await expect(scopes.fromSession(f.session, { requestedOrganizationId: randomUUID() })).rejects.toMatchObject({ response: { code: 'ORGANIZATION_SCOPE_DENIED' } });
  });

  it('keeps internal cross-organization direct caretaker scope and controlled disabled-organization reads', async () => {
    const f = await fixture(['organization:read']);
    const other = await organization('SUPPLIER');
    const caretaker = await role(other.id, ['organization:read', 'organization:manage', 'account:users:read']);
    await prisma.userRole.create({ data: { organizationId: other.id, userId: f.user.id, roleId: caretaker.id } });
    await prisma.organization.update({ where: { id: other.id }, data: { status: 'DISABLED' } });
    await expect(scopes.fromSession(f.session, { requestedOrganizationId: other.id })).resolves.toBe(other.id);
    await expect(authorization.assertFeature(f.user.id, other.id, 'organization:read')).resolves.toBeUndefined();
    expect(await organizations.tree({ ...f.actor, id: f.user.id }, {})).toEqual(expect.arrayContaining([expect.objectContaining({ id: other.id })]));
    expect(await directory.list({ [AUTHENTICATED_SESSION]: f.session } as AuthorizedRequest)).toEqual(expect.arrayContaining([expect.objectContaining({ id: other.id })]));
    await expect(authorization.assertFeature(f.user.id, other.id, 'account:users:read')).rejects.toMatchObject({ response: { code: 'ORGANIZATION_DISABLED' } });
    await prisma.rolePermission.deleteMany({ where: { roleId: caretaker.id, permission: { code: 'organization:manage' } } });
    await expect(authorization.assertFeature(f.user.id, other.id, 'organization:read')).rejects.toMatchObject({ response: { code: 'FEATURE_PERMISSION_DENIED' } });
    expect(await organizations.tree({ ...f.actor, id: f.user.id }, {})).not.toEqual(expect.arrayContaining([expect.objectContaining({ id: other.id })]));
  });

  it('keeps supplier scope/directory in its own enterprise even with invalid foreign direct data', async () => {
    const f = await fixture(['organization:read', 'organization:structure:read'], 'SUPPLIER');
    const other = await organization();
    const foreign = await role(other.id, ['organization:read']);
    await prisma.userRole.create({ data: { userId: f.user.id, organizationId: other.id, roleId: foreign.id } });
    await expect(scopes.fromSession(f.session)).resolves.toBe(f.home.id);
    await expect(scopes.fromSession(f.session, { requestedOrganizationId: other.id })).rejects.toMatchObject({ response: { code: 'ORGANIZATION_SCOPE_DENIED' } });
    expect(await directory.list({ [AUTHENTICATED_SESSION]: f.session } as AuthorizedRequest)).toEqual([expect.objectContaining({ id: f.home.id })]);
    expect(await organizations.tree({ ...f.actor, id: f.user.id, organizationId: f.home.id, accountType: 'SUPPLIER' }, {})).toEqual([expect.objectContaining({ id: f.home.id })]);
  });

  it('uses complete effective role facts for MFA/digest while preserving explicit account overrides', async () => {
    const f = await fixture(['account:roles:update']);
    const before = await prisma.$transaction((tx) => mfaPolicy(tx, f.user.id));
    expect(before).toMatchObject({ administrator: true, required: true, roleRequired: false });
    await prisma.user.update({ where: { id: f.user.id }, data: { mfaRequirementOverride: false } });
    await prisma.role.update({ where: { id: f.grant.id }, data: { mfaRequired: true } });
    const after = await prisma.$transaction((tx) => mfaPolicy(tx, f.user.id));
    expect(after).toMatchObject({ administrator: true, roleRequired: true, required: false });
    expect(after.digest).not.toBe(before.digest);
    await prisma.user.update({ where: { id: f.user.id }, data: { mfaRequirementOverride: null, mfaPreference: 'DISABLED' } });
    expect(await prisma.$transaction((tx) => mfaPolicy(tx, f.user.id))).toMatchObject({ required: false, roleRequired: true });
  });

  it('requires MFA for an inherited non-admin role and rejects an unverified session on the next request', async () => {
    const f = await fixture();
    const token = await sessions.create(f.user.id);
    expect(await sessions.resolve(token)).not.toBeNull();
    await prisma.role.update({ where: { id: f.grant.id }, data: { mfaRequired: true } });
    expect(await prisma.$transaction((tx) => mfaPolicy(tx, f.user.id))).toMatchObject({ administrator: false, roleRequired: true, required: true });
    expect(await sessions.resolve(token)).toBeNull();
  });

  it('applies the seven-day remembered-admin lifetime to a position-only administrator', async () => {
    const f = await fixture(['account:roles:update']);
    const issued = await sessions.createWithMetadata(f.user.id, prisma, { rememberMe: true, mfaVerified: true });
    const resolved = (await sessions.resolve(issued.sessionToken))!;
    expect(resolved).toMatchObject({ lifetimeType: 'REMEMBERED_ADMIN' });
    expect(issued.sessionExpiresAt.getTime() - Date.now()).toBeGreaterThan(7 * 86_400_000 - 10_000);
    expect(issued.sessionExpiresAt.getTime() - Date.now()).toBeLessThanOrEqual(7 * 86_400_000);
  });

  it('keeps direct roles separate and retains other sources after removing a direct or position source', async () => {
    const f = await fixture();
    const q = await position(f.home.id, f.user.id, f.grant.id);
    await prisma.userRole.create({ data: { organizationId: f.home.id, userId: f.user.id, roleId: f.grant.id } });
    expect(await roles.assignments(f.actor, f.user.id)).toMatchObject({ roles: [{ id: f.grant.id }], effectiveRoles: [{ id: f.grant.id, sources: expect.arrayContaining([{ kind: 'DIRECT' }, { kind: 'POSITION', positionId: f.p.id, assignmentId: f.p.assignment.id }, { kind: 'POSITION', positionId: q.id, assignmentId: q.assignment.id }]) }] });
    expect(await roles.assign(f.actor, f.user.id, { roleIds: [] }, 'u2-b', randomUUID())).toMatchObject({ roles: [], effectiveRoles: [{ id: f.grant.id, sources: expect.arrayContaining([{ kind: 'POSITION', positionId: q.id, assignmentId: q.assignment.id }]) }], permissions: ['workbench:read'] });
    expect(await prisma.userRole.count({ where: { userId: f.user.id } })).toBe(0);
    await prisma.userPosition.update({ where: { id: f.p.assignment.id }, data: { endedAt: new Date() } });
    expect(await authorization.permissionsForContext(f.user.id, f.home.id)).toEqual(['workbench:read']);
    await prisma.userPosition.update({ where: { id: q.assignment.id }, data: { endedAt: new Date() } });
    expect(await authorization.permissionsForContext(f.user.id, f.home.id)).toEqual([]);
  });

  it('does not falsely self-lock when direct admin access is removed but inherited access remains', async () => {
    const f = await fixture();
    await position(f.home.id, f.admin.id, f.adminRole.id);
    expect(await roles.assign(f.actor, f.admin.id, { roleIds: [] }, 'u2-b', randomUUID())).toMatchObject({ roles: [], effectiveRoles: [expect.objectContaining({ id: f.adminRole.id })] });
    expect(await prisma.userRole.count({ where: { userId: f.admin.id } })).toBe(0);
  });

  it('preserves an internal target caretaker direct role in another organization when replacing home roles', async () => {
    const f = await fixture();
    const supplier = await organization('SUPPLIER');
    const caretaker = await role(supplier.id, ['account:users:reset']);
    await prisma.userRole.create({ data: { userId: f.user.id, organizationId: supplier.id, roleId: caretaker.id } });
    expect(await roles.assign(f.actor, f.user.id, { roleIds: [] }, 'u2-b', randomUUID())).toMatchObject({ roles: [], permissions: ['workbench:read'] });
    expect(await authorization.permissionsForContext(f.user.id, supplier.id)).toEqual(['account:users:reset']);
    expect(await prisma.userRole.count({ where: { userId: f.user.id, organizationId: supplier.id, roleId: caretaker.id } })).toBe(1);
  });

  it('rolls back a role update that self-locks a position-only administrator', async () => {
    const f = await fixture(['account:roles:read', 'account:roles:update']);
    const token = await sessions.create(f.user.id, prisma, { mfaVerified: true, reauthenticated: true });
    const session = (await sessions.resolve(token))!;
    const actor = { ...f.actor, id: f.user.id, sessionId: session.id };
    await expect(roles.update(actor, f.grant.id, { permissionCodes: [], expectedPermissionCodes: ['account:roles:read', 'account:roles:update'] }, 'u2-b', randomUUID())).rejects.toMatchObject({ response: { code: 'ADMIN_SELF_LOCK_FORBIDDEN' } });
    expect(await authorization.permissionsForContext(f.user.id, f.home.id)).toEqual(['account:roles:read', 'account:roles:update']);
  });

  it('returns ADMIN_ROLE_IN_USE for a position reference even without direct users', async () => {
    const f = await fixture();
    await expect(roles.remove(f.actor, f.grant.id, 'u2-b', randomUUID())).rejects.toMatchObject({ response: { code: 'ADMIN_ROLE_IN_USE' }, status: 409 });
  });

  it.each(['permissions', 'mfa'] as const)('invalidates inherited user sessions and unconsumed resets on a role %s update', async (kind) => {
    const f = await fixture();
    const token = await sessions.create(f.user.id);
    const reset = await prisma.passwordReset.create({ data: { userId: f.user.id, codeHash: 'a'.repeat(64), expiresAt: new Date(Date.now() + 60_000) } });
    await roles.update(f.actor, f.grant.id, kind === 'permissions' ? { permissionCodes: [], expectedPermissionCodes: ['workbench:read'] } : { mfaRequired: true, expectedMfaRequired: false }, 'u2-b', randomUUID());
    expect(await prisma.user.findUniqueOrThrow({ where: { id: f.user.id } })).toMatchObject({ securityVersion: f.user.securityVersion + 1 });
    expect(await sessions.resolve(token)).toBeNull();
    expect((await prisma.passwordReset.findUniqueOrThrow({ where: { id: reset.id } })).consumedAt).not.toBeNull();
  });

  it('checks inherited target permissions before user administration', async () => {
    const f = await fixture(['organization:manage']);
    await prisma.rolePermission.deleteMany({ where: { roleId: f.adminRole.id, permission: { code: 'organization:manage' } } });
    await expect(prisma.$transaction((tx) => users.assertTarget(tx, f.actor, f.user.id, ['account:users:reset']))).rejects.toMatchObject({ response: { code: 'FEATURE_PERMISSION_DENIED' } });
  });

  it('checks inherited supplier target permissions against the portal whitelist', async () => {
    const f = await fixture(['account:users:reset'], 'SUPPLIER');
    await expect(prisma.$transaction((tx) => assertSupplierAccountTarget(tx, f.actor, f.home.id, f.user.id, 'account:users:reset'))).rejects.toMatchObject({ response: { code: 'FEATURE_PERMISSION_DENIED' } });
  });

  it('allows a safe inherited supplier portal target without removing internal caretaker grants', async () => {
    const f = await fixture(['notification:read'], 'SUPPLIER');
    await expect(prisma.$transaction((tx) => assertSupplierAccountTarget(tx, f.actor, f.home.id, f.user.id, 'account:users:reset'))).resolves.toMatchObject({ id: f.user.id });
    expect(await prisma.$transaction((tx) => adminPermissions(tx, f.admin.id, f.home.id))).toContain('account:users:reset');
    expect(await prisma.userRole.count({ where: { userId: f.admin.id, organizationId: f.home.id } })).toBe(1);
  });

  it.each(['DIRECT', 'POSITION', 'FOREIGN_DIRECT'] as const)('rejects supplier governance when a real %s marker source is hidden from runtime permissions', async kind => {
    const f = await fixture(['notification:read'], 'SUPPLIER');
    const sourceOrganizationId = kind === 'FOREIGN_DIRECT' ? f.actor.organizationId : f.home.id;
    const markerRole = await role(sourceOrganizationId, ['platform:admin']);
    if (kind === 'POSITION') await position(f.home.id, f.user.id, markerRole.id);
    else await prisma.userRole.create({ data: { userId: f.user.id, roleId: markerRole.id, organizationId: sourceOrganizationId } });
    const token = await sessions.create(f.user.id, prisma);
    const session = await sessions.resolve(token);
    expect(session).not.toBeNull();
    const before = await prisma.user.findUniqueOrThrow({ where: { id: f.user.id } });
    const beforeSession = await prisma.session.findUniqueOrThrow({ where: { id: session!.id } });
    const identities = new SupplierAccountIdentityService({} as never, {} as never, audit);
    await expect(prisma.$transaction(tx => identities.setStatus(tx, f.actor, f.home.id, f.user.id,
      { status: 'DISABLED', expectedSecurityVersion: before.securityVersion }, randomUUID())))
      .rejects.toMatchObject({ status: 403, response: { code: 'FEATURE_PERMISSION_DENIED' } });
    expect(await prisma.user.findUniqueOrThrow({ where: { id: f.user.id } })).toEqual(before);
    expect(await prisma.session.findUniqueOrThrow({ where: { id: session!.id } })).toEqual(beforeSession);
    expect(await prisma.auditEvent.count({ where: { organizationId: f.home.id, resourceId: f.user.id, action: 'USER_UPDATED', outcome: 'SUCCESS' } })).toBe(0);
  });

  it.each(['member', 'position'] as const)('rejects updating a supplier-%s-referenced role beyond portal permissions', async (reference) => {
    const f = await fixture(['notification:read'], 'SUPPLIER');
    if (reference === 'member') {
      await prisma.positionRole.deleteMany({ where: { roleId: f.grant.id } });
      await prisma.userRole.create({ data: { organizationId: f.home.id, userId: f.user.id, roleId: f.grant.id } });
    } else {
      await prisma.userPosition.deleteMany({ where: { userId: f.user.id } });
      await prisma.position.update({ where: { id: f.p.id }, data: { status: 'DISABLED' } });
    }
    await expect(roles.update(f.actor, f.grant.id, { permissionCodes: ['notification:read', 'account:users:reset'], expectedPermissionCodes: ['notification:read'] }, 'u2-b', randomUUID())).rejects.toMatchObject({ response: { code: 'FEATURE_PERMISSION_DENIED' } });
    expect(await prisma.rolePermission.count({ where: { roleId: f.grant.id } })).toBe(1);
  });

  it('permits supplier-boundary caretaker role updates when unused by supplier members or positions', async () => {
    const f = await fixture(['notification:read'], 'SUPPLIER');
    const caretaker = await role(f.home.id, ['account:users:read']);
    await prisma.userRole.create({ data: { userId: f.admin.id, organizationId: f.home.id, roleId: caretaker.id } });
    await expect(roles.update(f.actor, caretaker.id, { permissionCodes: ['account:users:read', 'account:users:reset'], expectedPermissionCodes: ['account:users:read'] }, 'u2-b', randomUUID())).resolves.toMatchObject({ id: caretaker.id });
  });

  it('rejects assigning governance roles to supplier personnel before writing direct assignments', async () => {
    const f = await fixture(['notification:read'], 'SUPPLIER');
    await expect(roles.assign(f.actor, f.user.id, { roleIds: [f.adminRole.id] }, 'u2-b', randomUUID())).rejects.toMatchObject({ response: { code: 'FEATURE_PERMISSION_DENIED' } });
    expect(await prisma.userRole.count({ where: { userId: f.user.id } })).toBe(0);
  });

  it('assigns safe supplier direct roles while returning inherited permissions and distinct sources', async () => {
    const f = await fixture(['notification:read'], 'SUPPLIER');
    const direct = await role(f.home.id, ['workflow:act']);
    expect(await roles.assign(f.actor, f.user.id, { roleIds: [direct.id] }, 'u2-b', randomUUID())).toMatchObject({
      roles: [{ id: direct.id }], permissions: ['notification:read', 'workflow:act'],
      effectiveRoles: expect.arrayContaining([
        expect.objectContaining({ id: direct.id, sources: [{ kind: 'DIRECT' }] }),
        expect.objectContaining({ id: f.grant.id, sources: [{ kind: 'POSITION', positionId: f.p.id, assignmentId: f.p.assignment.id }] }),
      ]),
    });
    const definition = await roles.detail(f.actor, f.grant.id);
    expect(definition).not.toHaveProperty('sources');
    expect(definition).not.toHaveProperty('effectiveRoles');
  });

  it.each(['mfa', 'permissions'] as const)('updates a role with 1000 mixed members within the default transaction deadline: %s', async (kind) => {
    const f = await fixture();
    const otherHome = await organization();
    const memberIds = [f.user.id, ...Array.from({ length: 999 }, () => randomUUID())];
    await prisma.user.createMany({ data: memberIds.slice(1).map((id, offset) => ({
      id, organizationId: (offset + 1) % 6 === 0 ? otherHome.id : f.home.id,
      username: id, passwordHash: 'test-only', accountType: 'INTERNAL' as const,
    })) });
    const directIds = memberIds.filter((_id, index) => index % 3 !== 1);
    await prisma.userRole.createMany({ data: directIds.map((userId) => ({ userId, organizationId: f.home.id, roleId: f.grant.id })) });
    const startedAt = new Date(Date.now() - 86_400_000);
    await prisma.userPosition.createMany({ data: memberIds.filter((_id, index) => index > 0 && index % 3 !== 0).map((userId) => ({ userId, organizationId: f.home.id, positionId: f.p.id, startedAt })) });
    const second = await position(f.home.id, f.user.id, f.grant.id);
    await prisma.userPosition.createMany({ data: memberIds.filter((_id, index) => index % 3 === 2).map((userId) => ({ userId, organizationId: f.home.id, positionId: second.id, startedAt })) });

    const excludedIds: string[] = [];
    for (const reason of ['ended', 'future', 'position', 'department', 'unmapped'] as const) {
      const user = await person(f.home.id);
      excludedIds.push(user.id);
      const assignment = await position(f.home.id, user.id, f.grant.id);
      if (reason === 'ended') await prisma.userPosition.update({ where: { id: assignment.assignment.id }, data: { endedAt: new Date(Date.now() - 1) } });
      if (reason === 'future') await prisma.userPosition.update({ where: { id: assignment.assignment.id }, data: { startedAt: new Date(Date.now() + 86_400_000) } });
      if (reason === 'position') await prisma.position.update({ where: { id: assignment.id }, data: { status: 'DISABLED' } });
      if (reason === 'department') await prisma.department.update({ where: { id: assignment.department.id }, data: { status: 'DISABLED' } });
      if (reason === 'unmapped') await prisma.positionRole.deleteMany({ where: { positionId: assignment.id } });
    }

    const allIds = [...memberIds, ...excludedIds];
    const expiresAt = new Date(Date.now() + 3_600_000);
    await prisma.session.createMany({ data: allIds.map((userId) => ({ userId, tokenHash: randomUUID(), expiresAt, securityVersion: 1 })) });
    await prisma.passwordReset.createMany({ data: allIds.map((userId) => ({ userId, codeHash: 'a'.repeat(64), expiresAt })) });
    const alreadyConsumedAt = new Date('2026-01-01T00:00:00.000Z');
    const consumed = await prisma.passwordReset.create({ data: { userId: f.user.id, codeHash: 'b'.repeat(64), expiresAt, consumedAt: alreadyConsumedAt } });
    const oldToken = await sessions.create(f.user.id);
    const dto = kind === 'mfa' ? { mfaRequired: true, expectedMfaRequired: false } : { permissionCodes: [], expectedPermissionCodes: ['workbench:read'] };
    const key = randomUUID();
    const started = performance.now();
    let result: Awaited<ReturnType<AdminRoleService['update']>>;
    try {
      result = await roles.update(f.actor, f.grant.id, dto, 'u2-b-scale', key);
      console.info(JSON.stringify({ check: 'role-update-scale', members: memberIds.length, kind, result: 'PASS', elapsedMs: Math.round(performance.now() - started) }));
    } catch (error) {
      console.info(JSON.stringify({ check: 'role-update-scale', members: memberIds.length, kind, result: 'FAIL', elapsedMs: Math.round(performance.now() - started), code: (error as { code?: string }).code }));
      throw error;
    }

    const memberWhere = { id: { in: memberIds } };
    expect(await prisma.user.count({ where: { ...memberWhere, securityVersion: 2 } })).toBe(1000);
    expect(await prisma.user.count({ where: { id: { in: excludedIds }, securityVersion: 1 } })).toBe(excludedIds.length);
    expect(await prisma.user.findUniqueOrThrow({ where: { id: f.admin.id } })).toMatchObject({ securityVersion: f.admin.securityVersion });
    const oldSessions = await prisma.session.findMany({ where: { userId: { in: allIds } }, select: { userId: true, securityVersion: true, user: { select: { securityVersion: true } } } });
    expect(oldSessions.filter(({ userId }) => memberIds.includes(userId)).every((session) => session.securityVersion + 1 === session.user.securityVersion)).toBe(true);
    expect(oldSessions.filter(({ userId }) => excludedIds.includes(userId)).every((session) => session.securityVersion === session.user.securityVersion)).toBe(true);
    expect(await sessions.resolve(oldToken)).toBeNull();
    expect(await prisma.passwordReset.count({ where: { userId: { in: memberIds }, consumedAt: { not: null } } })).toBe(1001);
    expect(await prisma.passwordReset.count({ where: { userId: { in: excludedIds }, consumedAt: null } })).toBe(excludedIds.length);
    expect((await prisma.passwordReset.findUniqueOrThrow({ where: { id: consumed.id } })).consumedAt).toEqual(alreadyConsumedAt);

    const resetSnapshot = await prisma.passwordReset.findMany({ where: { userId: { in: allIds } }, select: { id: true, consumedAt: true }, orderBy: { id: 'asc' } });
    const freshResetIds = memberIds.map(() => randomUUID());
    await prisma.passwordReset.createMany({ data: memberIds.map((userId, index) => ({ id: freshResetIds[index]!, userId, codeHash: 'c'.repeat(64), expiresAt })) });
    const freshToken = await sessions.create(f.user.id, prisma, { mfaVerified: true });
    const replayStarted = performance.now();
    expect(await roles.update(f.actor, f.grant.id, dto, 'u2-b-scale', key)).toEqual(result);
    console.info(JSON.stringify({ check: 'role-update-scale-replay', members: memberIds.length, kind, result: 'PASS', elapsedMs: Math.round(performance.now() - replayStarted) }));
    expect(await prisma.user.count({ where: { ...memberWhere, securityVersion: 2 } })).toBe(1000);
    expect(await prisma.user.count({ where: { id: { in: excludedIds }, securityVersion: 1 } })).toBe(excludedIds.length);
    expect(await prisma.passwordReset.findMany({ where: { id: { in: resetSnapshot.map(({ id }) => id) } }, select: { id: true, consumedAt: true }, orderBy: { id: 'asc' } })).toEqual(resetSnapshot);
    expect(await prisma.passwordReset.count({ where: { id: { in: freshResetIds }, consumedAt: null } })).toBe(1000);
    expect(await sessions.resolve(freshToken)).not.toBeNull();
    expect(await prisma.auditEvent.count({ where: { organizationId: f.home.id, resourceId: f.grant.id, action: 'ROLE_UPDATED' } })).toBe(1);
    expect(await prisma.adminMutation.count({ where: { actorUserId: f.actor.id, organizationId: f.home.id, key } })).toBe(1);
  });
});
