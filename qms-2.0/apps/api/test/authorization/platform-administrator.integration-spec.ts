import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { Client } from 'pg';
import { PrismaService } from '../../src/database/prisma.service.js';
import { Prisma } from '../../src/generated/prisma/client.js';
import { effectiveRoleGrants } from '../../src/common/security/effective-role-grants.js';
import { hasPlatformAdministrator } from '../../src/common/security/platform-administrator.js';
import { effectiveRoleMembershipSql } from '../../src/common/security/effective-role-membership.sql.js';
import { canProcessWorkflowNode, featurePredicate } from '../../src/modules/workflow/workflow-access-policy.js';
import { INTERNAL_PLATFORM_PERMISSION_CODES } from '../../src/modules/authorization/permission-catalog.js';
import { ADMIN_PERMISSIONS } from '../../src/modules/authorization/permission-catalog.js';
import { applyPlatformAdministrator, previewPlatformAdministrator } from '../../scripts/platform-administrator.js';
import { AuditLogService } from '../../src/modules/audit-log/audit-log.service.js';
import { SessionService } from '../../src/modules/identity/session.service.js';
import { AdminMutationService } from '../../src/common/security/admin-mutation.service.js';
import { assertAdminAccess } from '../../src/common/security/admin-mutation.service.js';
import { AdminRoleService } from '../../src/modules/authorization/admin-role.service.js';
import { OrganizationService } from '../../src/modules/organization/organization.service.js';
import { AuthorizationService } from '../../src/modules/authorization/authorization.service.js';
import { AccountOverviewService } from '../../src/modules/authorization/account-overview.service.js';

const connection = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL) : undefined;
if (!connection || process.env.QMS_DISPOSABLE_TEST_DB !== 'true'
  || !['postgres:', 'postgresql:'].includes(connection.protocol)
  || !['localhost', '127.0.0.1', '[::1]'].includes(connection.hostname)
  || connection.port === '55440' || connection.search || connection.hash) {
  throw new Error('REQ0030 administrator tests require an explicitly disposable loopback PostgreSQL database, never preview 55440.');
}

describe('REQ0030 explicit platform administrator on PostgreSQL', () => {
  const prisma = new PrismaService();
  const pg = new Client({ connectionString: process.env.DATABASE_URL });
  const audit = new AuditLogService(prisma);
  const sessions = new SessionService(prisma, audit);
  let f: Awaited<ReturnType<typeof fixture>>;

  beforeAll(async () => { await prisma.$connect(); await pg.connect(); });
  afterAll(async () => { await pg.end(); await prisma.$disconnect(); });
  beforeEach(async () => { f = await fixture(); });
  afterEach(async () => {
    const organizationId = { in: f.organizations };
    await prisma.auditEvent.deleteMany({ where: { organizationId } });
    await prisma.adminMutation.deleteMany({ where: { organizationId } });
    await prisma.session.deleteMany({ where: { user: { organizationId } } });
    await prisma.userRole.deleteMany({ where: { organizationId } });
    await prisma.positionRole.deleteMany({ where: { organizationId } });
    await prisma.userPosition.deleteMany({ where: { organizationId } });
    await prisma.position.deleteMany({ where: { organizationId } });
    await prisma.department.deleteMany({ where: { organizationId } });
    await prisma.user.deleteMany({ where: { organizationId } });
    await prisma.role.deleteMany({ where: { organizationId } });
    await prisma.organization.deleteMany({ where: { id: { in: f.organizations } } });
  });

  async function fixture() {
    const organizations: string[] = [];
    async function organization(type: 'INTERNAL' | 'SUPPLIER' = 'INTERNAL') {
      const result = await prisma.organization.create({ data: { code: randomUUID(), name: 'REQ0030 administrator fixture', type } });
      organizations.push(result.id); return result;
    }
    const home = await organization(); const target = await organization(); const supplier = await organization('SUPPLIER');
    const user = await prisma.user.create({ data: { organizationId: home.id, username: randomUUID(), passwordHash: 'not-a-login-fixture', accountType: 'INTERNAL' } });
    const marker = await prisma.permission.findUniqueOrThrow({ where: { code: 'platform:admin' } });
    const role = await prisma.role.create({ data: { organizationId: home.id, code: randomUUID(), name: 'Explicit platform role', permissions: { create: { permissionId: marker.id } } } });
    await prisma.userRole.create({ data: { userId: user.id, roleId: role.id, organizationId: home.id } });
    const department = await prisma.department.create({ data: { organizationId: home.id, code: randomUUID(), name: 'REQ0030 department' } });
    const position = await prisma.position.create({ data: { organizationId: home.id, departmentId: department.id, code: randomUUID(), name: 'REQ0030 position' } });
    await prisma.positionRole.create({ data: { organizationId: home.id, positionId: position.id, roleId: role.id } });
    const assignment = await prisma.userPosition.create({ data: { organizationId: home.id, userId: user.id, positionId: position.id, startedAt: new Date(Date.now() - 60_000) } });
    return { organizations, home, target, supplier, user, role, marker, department, position, assignment, organization };
  }

  async function ormCodes(targetId = f.target.id, tx: Prisma.TransactionClient = prisma) {
    return [...new Set((await effectiveRoleGrants(tx, f.user.id, targetId)).flatMap(grant => grant.role.permissions.map(({ permission }) => permission.code)))].sort();
  }
  async function feature(code: string, targetId = f.target.id, tx: Prisma.TransactionClient = prisma, userId = f.user.id) {
    const [row] = await tx.$queryRaw<{ allowed: boolean }[]>(Prisma.sql`SELECT ${featurePredicate(Prisma.sql`${userId}::uuid`, Prisma.sql`${targetId}::uuid`, Prisma.sql`${code}`)} AS allowed`);
    return row!.allowed;
  }
  const input = (action: 'grant' | 'revoke') => ({ action, userId: f.user.id, roleId: f.role.id, organizationId: f.home.id, source: 'DIRECT' as const });

  it('keeps ORM/SQL parity for the entire unified directory and future organizations without adding memberships', async () => {
    const registered = await prisma.permission.findMany({ where: { code: { in: INTERNAL_PLATFORM_PERMISSION_CODES } } });
    expect(await ormCodes()).toEqual(registered.map(p => p.code).sort());
    for (const permission of await prisma.permission.findMany()) {
      expect(await feature(permission.code)).toBe(INTERNAL_PLATFORM_PERMISSION_CODES.includes(permission.code));
    }
    for (const code of ['workbench:read', 'quality-data:metrics:read', 'supplier-quality:responses:write', 'not:registered']) expect(await feature(code)).toBe(false);
    const future = await f.organization();
    expect(await feature('workflow:act', future.id)).toBe(true);
    expect(await ormCodes(future.id)).toContain('workflow:act');
    expect(await prisma.userRole.count({ where: { userId: f.user.id } })).toBe(1);
    expect(await prisma.$queryRaw(effectiveRoleMembershipSql(Prisma.sql`${f.user.id}::uuid`, Prisma.sql`${f.target.id}::uuid`))).toEqual([]);
    const grants = await effectiveRoleGrants(prisma, f.user.id, f.target.id);
    expect(grants[0]!.sources).toEqual([{ kind: 'DIRECT' }, { kind: 'POSITION', positionId: f.position.id, assignmentId: f.assignment.id }]);
    expect(grants[0]!.platformScope).toMatchObject({ sourceOrganizationIds: [f.home.id], targetOrganizationId: f.target.id });
  });

  it('does not impersonate even its own source role across organizations, another role, or a different assignee', async () => {
    expect(await canProcessWorkflowNode(prisma, f.user.id, f.home.id, { roleCode: f.role.code })).toBe(true);
    expect(await canProcessWorkflowNode(prisma, f.user.id, f.target.id, { roleCode: f.role.code })).toBe(false);
    expect(await canProcessWorkflowNode(prisma, f.user.id, f.target.id, { roleCode: 'QUALITY_MANAGER' })).toBe(false);
    expect(await canProcessWorkflowNode(prisma, f.user.id, f.target.id, { assigneeUserId: randomUUID() })).toBe(false);
    expect(await canProcessWorkflowNode(prisma, f.user.id, f.target.id, { assigneeUserId: f.user.id, permission: 'workflow:act' })).toBe(true);
  });

  it('allows only organization governance/audit on a disabled internal target; no supplier target or disabled-target business use', async () => {
    await prisma.organization.update({ where: { id: f.target.id }, data: { status: 'DISABLED' } });
    expect(await ormCodes()).toEqual(['audit:export', 'audit:read', 'organization:manage', 'organization:read']);
    for (const code of ['organization:read', 'organization:manage']) expect(await feature(code)).toBe(true);
    expect(await feature('workflow:act')).toBe(false);
    expect(await canProcessWorkflowNode(prisma, f.user.id, f.target.id, { assigneeUserId: f.user.id })).toBe(false);
    expect(await ormCodes(f.supplier.id)).toEqual([]);
    expect(await feature('organization:manage', f.supplier.id)).toBe(false);
  });

  it('permits disabled-target audit investigation only for a real platform administrator, never ordinary audit grants or business writes', async () => {
    await prisma.organization.update({ where: { id: f.target.id }, data: { status: 'DISABLED' } });
    const authorization = new AuthorizationService(prisma);
    const actor = { id: f.user.id, organizationId: f.home.id, accountType: 'INTERNAL' as const, sessionId: randomUUID() };
    for (const code of ['audit:read', 'audit:export']) {
      await expect(authorization.assertFeature(f.user.id, f.target.id, code)).resolves.toBeUndefined();
      await expect(assertAdminAccess(prisma, actor, f.target.id, code)).resolves.toContain(code);
      expect(await feature(code)).toBe(true);
    }
    await expect(authorization.assertFeature(f.user.id, f.target.id, 'workflow:act')).rejects.toMatchObject({ status: 403 });
    await prisma.rolePermission.deleteMany({ where: { roleId: f.role.id } });
    const auditPermission = await prisma.permission.findUniqueOrThrow({ where: { code: 'audit:read' } });
    const ordinary = await prisma.role.create({ data: { organizationId: f.target.id, code: randomUUID(), name: 'Ordinary audit grant', permissions: { create: { permissionId: auditPermission.id } } } });
    await prisma.userRole.create({ data: { userId: f.user.id, organizationId: f.target.id, roleId: ordinary.id } });
    await expect(authorization.assertFeature(f.user.id, f.target.id, 'audit:read')).rejects.toMatchObject({ status: 403, response: { code: 'ORGANIZATION_DISABLED' } });
    await expect(assertAdminAccess(prisma, actor, f.target.id, 'audit:read')).rejects.toMatchObject({ status: 403, response: { code: 'ORGANIZATION_DISABLED' } });
  });

  it('does not elevate the historic five-permission role and preserves an explicit ordinary cross-internal grant', async () => {
    await prisma.rolePermission.deleteMany({ where: { roleId: f.role.id } });
    const permissions = await prisma.permission.findMany({ where: { code: { in: ['organization:read', 'organization:manage', 'account:users:read', 'account:roles:read', 'audit:export'] } } });
    await prisma.rolePermission.createMany({ data: permissions.map(p => ({ roleId: f.role.id, permissionId: p.id })) });
    expect(await hasPlatformAdministrator(prisma, f.user.id)).toBe(false);
    expect(await ormCodes()).toEqual([]);
    expect(await feature('workflow:act')).toBe(false);
    const permission = await prisma.permission.findUniqueOrThrow({ where: { code: 'workflow:act' } });
    const other = await prisma.role.create({ data: { organizationId: f.target.id, code: randomUUID(), name: 'Explicit cross-internal grant', permissions: { create: { permissionId: permission.id } } } });
    await prisma.userRole.create({ data: { userId: f.user.id, roleId: other.id, organizationId: f.target.id } });
    expect(await feature('workflow:act')).toBe(true);
    expect(await ormCodes()).toEqual(['workflow:act']);
  });

  it.each(['user', 'home', 'department', 'position', 'expired', 'future', 'mapping', 'marker'])('rechecks %s deactivation/revocation for position-only identity', async condition => {
    await prisma.userRole.deleteMany({ where: { userId: f.user.id } });
    expect(await hasPlatformAdministrator(prisma, f.user.id)).toBe(true);
    if (condition === 'user') await prisma.user.update({ where: { id: f.user.id }, data: { status: 'DISABLED' } });
    if (condition === 'home') await prisma.organization.update({ where: { id: f.home.id }, data: { status: 'DISABLED' } });
    if (condition === 'department') await prisma.department.update({ where: { id: f.department.id }, data: { status: 'DISABLED' } });
    if (condition === 'position') await prisma.position.update({ where: { id: f.position.id }, data: { status: 'DISABLED' } });
    if (condition === 'expired') await prisma.userPosition.update({ where: { id: f.assignment.id }, data: { endedAt: new Date() } });
    if (condition === 'future') await prisma.userPosition.update({ where: { id: f.assignment.id }, data: { startedAt: new Date(Date.now() + 60_000) } });
    if (condition === 'mapping') await prisma.positionRole.deleteMany({ where: { roleId: f.role.id } });
    if (condition === 'marker') await prisma.rolePermission.deleteMany({ where: { roleId: f.role.id } });
    expect(await hasPlatformAdministrator(prisma, f.user.id)).toBe(false);
    expect(await ormCodes()).toEqual([]);
    expect(await feature('workflow:act')).toBe(false);
  });

  it('preserves independent direct and appointment sources until the final withdrawal and transaction rollback', async () => {
    const rollback = new Error('rollback');
    await expect(prisma.$transaction(async tx => {
      await tx.userRole.deleteMany({ where: { userId: f.user.id } });
      expect(await feature('workflow:act', f.target.id, tx)).toBe(true);
      await tx.userPosition.update({ where: { id: f.assignment.id }, data: { endedAt: new Date() } });
      expect(await hasPlatformAdministrator(tx, f.user.id)).toBe(false);
      expect(await ormCodes(f.target.id, tx)).toEqual([]);
      expect(await feature('workflow:act', f.target.id, tx)).toBe(false);
      throw rollback;
    })).rejects.toBe(rollback);
    expect(await hasPlatformAdministrator(prisma, f.user.id)).toBe(true);
  });

  it('rejects malicious supplier marker sources and mismatched legacy direct role scopes', async () => {
    const supplier = await prisma.user.create({ data: { organizationId: f.supplier.id, username: randomUUID(), passwordHash: 'not-a-login-fixture', accountType: 'SUPPLIER' } });
    const role = await prisma.role.create({ data: { organizationId: f.supplier.id, code: randomUUID(), name: 'Invalid supplier marker', permissions: { create: { permissionId: f.marker.id } } } });
    await prisma.userRole.create({ data: { userId: supplier.id, organizationId: f.supplier.id, roleId: role.id } });
    expect(await hasPlatformAdministrator(prisma, supplier.id)).toBe(false);
    expect(await effectiveRoleGrants(prisma, supplier.id, f.target.id)).toEqual([]);
    expect(await feature('workflow:act', f.target.id, prisma, supplier.id)).toBe(false);
    await prisma.userRole.deleteMany({ where: { userId: f.user.id } });
    await prisma.userPosition.deleteMany({ where: { userId: f.user.id } });
    await prisma.userRole.create({ data: { userId: f.user.id, organizationId: f.target.id, roleId: f.role.id } });
    expect(await hasPlatformAdministrator(prisma, f.user.id)).toBe(false);
    expect(await feature('workflow:act')).toBe(false);
  });

  it('binds CLI preview/apply to exact source and live version, revokes sessions on grant and revoke, and rejects stale previews', async () => {
    await prisma.rolePermission.deleteMany({ where: { roleId: f.role.id } });
    const session = await prisma.session.create({ data: { userId: f.user.id, tokenHash: randomUUID(), expiresAt: new Date(Date.now() + 60_000), securityVersion: f.user.securityVersion } });
    const token = await sessions.create(f.user.id, prisma, { mfaVerified: true, reauthenticated: true });
    expect(await sessions.resolve(token)).not.toBeNull();
    const before = await prisma.auditEvent.count();
    const grant = await previewPlatformAdministrator(pg, input('grant'));
    expect(await prisma.auditEvent.count()).toBe(before);
    expect(await hasPlatformAdministrator(prisma, f.user.id)).toBe(false);
    await expect(applyPlatformAdministrator(pg, input('grant'), grant.expectedSecurityVersion + 1, grant.digest, 'REQ0030 disposable test approval')).rejects.toThrow('STALE_PREVIEW');
    const applied = await applyPlatformAdministrator(pg, input('grant'), grant.expectedSecurityVersion, grant.digest, 'REQ0030 disposable test approval');
    expect(applied.nextSecurityVersion).toBe(f.user.securityVersion + 1);
    expect((await prisma.session.findUniqueOrThrow({ where: { id: session.id } })).revokedAt).not.toBeNull();
    expect(await sessions.resolve(token)).toBeNull();
    expect(await hasPlatformAdministrator(prisma, f.user.id)).toBe(true);
    await expect(applyPlatformAdministrator(pg, input('grant'), grant.expectedSecurityVersion, grant.digest, 'REQ0030 disposable test approval')).rejects.toThrow('STALE_PREVIEW');
    const revoke = await previewPlatformAdministrator(pg, input('revoke'));
    const secondToken = await sessions.create(f.user.id, prisma, { mfaVerified: true, reauthenticated: true });
    expect(await sessions.resolve(secondToken)).not.toBeNull();
    await applyPlatformAdministrator(pg, input('revoke'), revoke.expectedSecurityVersion, revoke.digest, 'REQ0030 disposable test approval');
    expect(await sessions.resolve(secondToken)).toBeNull();
    expect(await hasPlatformAdministrator(prisma, f.user.id)).toBe(false);
    expect(await feature('workflow:act')).toBe(false);
    expect(await prisma.auditEvent.count()).toBe(before + 2);
    const event = await prisma.auditEvent.findFirstOrThrow({ where: { action: 'PLATFORM_ADMINISTRATOR_REVOKED', resourceId: f.role.id } });
    expect(event.actorUserId).toBeNull();
    expect(audit.safeMetadata(event.metadata as Record<string, string | number>)).toMatchObject({ targetUserId: f.user.id, permissionCode: 'platform:admin', previousResourceVersion: revoke.expectedSecurityVersion, resourceVersion: revoke.expectedSecurityVersion + 1, reasonCode: 'EXPLICIT_DIRECT_REVOKE' });
  });

  it('does not let an ordinary administrator select the marker through catalog/position all-select, with real session and rollback', async () => {
    await prisma.rolePermission.deleteMany({ where: { roleId: f.role.id } });
    const permissions = await prisma.permission.findMany({ where: { code: { in: [...ADMIN_PERMISSIONS, 'organization:read'] } } });
    await prisma.rolePermission.createMany({ data: permissions.map(permission => ({ roleId: f.role.id, permissionId: permission.id })) });
    const token = await sessions.create(f.user.id, prisma, { mfaVerified: true, reauthenticated: true });
    const current = await sessions.resolve(token);
    const actor = { id: f.user.id, organizationId: f.home.id, accountType: 'INTERNAL' as const, sessionId: current!.id };
    const mutations = new AdminMutationService(prisma, audit);
    const roles = new AdminRoleService(prisma, audit, mutations);
    const catalog = await roles.catalog(actor);
    expect(catalog.flatMap(group => group.modules.flatMap(module => module.operations)).find(operation => operation.code === 'platform:admin')?.grantable).toBe(false);
    const service = new OrganizationService(prisma, mutations, audit, {} as never);
    await expect(service.updatePositionPermissions(actor, f.home.id, f.position.id, { permissionCodes: ['platform:admin'], expectedPermissionCodes: [], expectedRoleVersion: 1, mfaRequired: false, expectedMfaRequired: false }, 'req0030-marker-ceiling', randomUUID())).rejects.toMatchObject({ status: 403, response: { code: 'FEATURE_PERMISSION_DENIED' } });
    expect(await hasPlatformAdministrator(prisma, f.user.id)).toBe(false);
    expect((await prisma.position.findUniqueOrThrow({ where: { id: f.position.id } })).roleVersion).toBe(1);
    expect(await sessions.resolve(token)).not.toBeNull();
  });

  it.each(['DIRECT', 'POSITION'] as const)('rejects a retained canonical permission draft after CLI %s grant/revoke ABA', async source => {
    await prisma.rolePermission.deleteMany({ where: { roleId: f.role.id } });
    await prisma.positionRole.updateMany({ where: { positionId: f.position.id, roleId: f.role.id }, data: { isCanonical: true } });
    const operator = await prisma.user.create({ data: { organizationId: f.home.id, username: randomUUID(), passwordHash: 'not-a-login-fixture', accountType: 'INTERNAL' } });
    const operatorRole = await prisma.role.create({ data: { organizationId: f.home.id, code: randomUUID(), name: 'Independent platform operator', permissions: { create: { permissionId: f.marker.id } } } });
    await prisma.userRole.create({ data: { userId: operator.id, organizationId: f.home.id, roleId: operatorRole.id } });
    const token = await sessions.create(operator.id, prisma, { mfaVerified: true, reauthenticated: true });
    const current = await sessions.resolve(token);
    expect(current).not.toBeNull();
    const actor = { id: operator.id, organizationId: f.home.id, accountType: 'INTERNAL' as const, sessionId: current!.id };
    const service = new OrganizationService(prisma, new AdminMutationService(prisma, audit), audit, {} as never);
    const baseline = await service.positionPermissions(actor, f.home.id, f.position.id);
    expect(baseline.permissionCodes).toEqual([]);
    const draft = { permissionCodes: ['platform:admin'], expectedPermissionCodes: baseline.permissionCodes, expectedRoleVersion: baseline.roleVersion, mfaRequired: baseline.mfaRequired, expectedMfaRequired: baseline.mfaRequired };
    for (const action of ['grant', 'revoke'] as const) {
      const change = { ...input(action), source, ...(source === 'POSITION' ? { assignmentId: f.assignment.id } : {}) };
      const plan = await previewPlatformAdministrator(pg, change);
      await applyPlatformAdministrator(pg, change, plan.expectedSecurityVersion, plan.digest, 'REQ0030 disposable ABA approval');
    }
    const afterRevoke = await service.positionPermissions(actor, f.home.id, f.position.id);
    expect(afterRevoke.permissionCodes).toEqual(baseline.permissionCodes);
    expect(afterRevoke.mfaRequired).toBe(baseline.mfaRequired);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: f.user.id } })).securityVersion).toBe(f.user.securityVersion + 2);
    expect(await sessions.resolve(token)).not.toBeNull();
    const auditWhere = { organizationId: f.home.id, resourceId: f.position.id, action: 'POSITION_PERMISSIONS_CHANGED', outcome: 'SUCCESS' as const };
    const beforeAudit = await prisma.auditEvent.count({ where: auditWhere });
    const outcome = await service.updatePositionPermissions(actor, f.home.id, f.position.id, draft, randomUUID(), randomUUID())
      .then(() => ({ status: 200, code: null }), error => ({ status: error.getStatus(), code: error.getResponse().code }));
    expect({ outcome, markerPresent: await hasPlatformAdministrator(prisma, f.user.id), successfulPositionAudits: await prisma.auditEvent.count({ where: auditWhere }) })
      .toEqual({ outcome: { status: 409, code: 'CONCURRENCY_CONFLICT' }, markerPresent: false, successfulPositionAudits: beforeAudit });
    expect(afterRevoke.roleVersion).toBe(baseline.roleVersion + 2);
    expect(await sessions.resolve(token)).not.toBeNull();
  });

  it.each(['grant', 'revoke'] as const)('keeps linked position versions and sessions unchanged for a CLI %s no-op even at INTMAX', async action => {
    if (action === 'revoke') await prisma.rolePermission.deleteMany({ where: { roleId: f.role.id } });
    await prisma.position.update({ where: { id: f.position.id }, data: { roleVersion: 2147483647 } });
    const position = await prisma.position.findUniqueOrThrow({ where: { id: f.position.id } });
    const user = await prisma.user.findUniqueOrThrow({ where: { id: f.user.id } });
    const token = await sessions.create(f.user.id, prisma, { mfaVerified: true, reauthenticated: true });
    const beforeAudit = await prisma.auditEvent.count({ where: { organizationId: f.home.id } });
    const plan = await previewPlatformAdministrator(pg, input(action));
    expect(plan.willChange).toBe(false);
    expect(await applyPlatformAdministrator(pg, input(action), plan.expectedSecurityVersion, plan.digest, 'REQ0030 disposable no-op approval')).toMatchObject({ applied: false, nextSecurityVersion: user.securityVersion });
    expect(await prisma.position.findUniqueOrThrow({ where: { id: f.position.id } })).toEqual(position);
    expect(await prisma.user.findUniqueOrThrow({ where: { id: f.user.id } })).toEqual(user);
    expect(await sessions.resolve(token)).not.toBeNull();
    expect(await prisma.auditEvent.count({ where: { organizationId: f.home.id } })).toBe(beforeAudit);
  });

  it.each(['grant', 'revoke'] as const)('rejects CLI %s atomically when any linked position is at INTMAX, but permits the final increment', async action => {
    if (action === 'grant') await prisma.rolePermission.deleteMany({ where: { roleId: f.role.id } });
    await prisma.positionRole.updateMany({ where: { positionId: f.position.id }, data: { isCanonical: true } });
    await prisma.position.update({ where: { id: f.position.id }, data: { roleVersion: 2147483646 } });
    const legacy = await prisma.position.create({ data: { organizationId: f.home.id, departmentId: f.department.id, code: randomUUID(), name: 'Linked legacy position', roleVersion: 2147483647 } });
    await prisma.positionRole.create({ data: { organizationId: f.home.id, positionId: legacy.id, roleId: f.role.id } });
    const token = await sessions.create(f.user.id, prisma, { mfaVerified: true, reauthenticated: true });
    const positions = await prisma.position.findMany({ where: { organizationId: f.home.id }, orderBy: { id: 'asc' } });
    const user = await prisma.user.findUniqueOrThrow({ where: { id: f.user.id } });
    const beforeAudit = await prisma.auditEvent.count({ where: { organizationId: f.home.id } });
    const plan = await previewPlatformAdministrator(pg, input(action));
    await expect(applyPlatformAdministrator(pg, input(action), plan.expectedSecurityVersion, plan.digest, 'REQ0030 disposable overflow approval')).rejects.toThrow('INVALID_ROLE_VERSION');
    expect(await prisma.position.findMany({ where: { organizationId: f.home.id }, orderBy: { id: 'asc' } })).toEqual(positions);
    expect(await prisma.user.findUniqueOrThrow({ where: { id: f.user.id } })).toEqual(user);
    expect(await hasPlatformAdministrator(prisma, f.user.id)).toBe(action === 'revoke');
    expect(await sessions.resolve(token)).not.toBeNull();
    expect(await prisma.auditEvent.count({ where: { organizationId: f.home.id } })).toBe(beforeAudit);
    await prisma.position.update({ where: { id: legacy.id }, data: { roleVersion: 2147483646 } });
    const fresh = await previewPlatformAdministrator(pg, input(action));
    await applyPlatformAdministrator(pg, input(action), fresh.expectedSecurityVersion, fresh.digest, 'REQ0030 disposable final increment approval');
    expect((await prisma.position.findMany({ where: { organizationId: f.home.id } })).map(position => position.roleVersion)).toEqual([2147483647, 2147483647]);
    expect(await hasPlatformAdministrator(prisma, f.user.id)).toBe(action === 'grant');
    expect(await sessions.resolve(token)).toBeNull();
  });

  it('rechecks appointment expiry after a real user-row lock wait using statement time, not transaction start', async () => {
    await prisma.userRole.deleteMany({ where: { userId: f.user.id } });
    await prisma.$executeRaw`UPDATE user_positions SET ended_at = statement_timestamp() + interval '2 seconds' WHERE id = ${f.assignment.id}::uuid`;
    await pg.query('BEGIN');
    try {
      await pg.query('SELECT id FROM users WHERE id = $1::uuid FOR UPDATE', [f.user.id]);
      await prisma.$transaction(async tx => {
        expect(await hasPlatformAdministrator(tx, f.user.id)).toBe(true);
        expect(await feature('workflow:act', f.target.id, tx)).toBe(true);
        const [backend] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
        const waiting = Promise.resolve(tx.$queryRaw`SELECT id FROM users WHERE id = ${f.user.id}::uuid FOR UPDATE`);
        let observed = false;
        for (let attempt = 0; attempt < 100; attempt++) {
          const { rows: [row] } = await pg.query('SELECT cardinality(pg_blocking_pids($1)) > 0 AS blocked', [backend!.pid]);
          if (row.blocked) { observed = true; break; }
          await new Promise(resolve => setTimeout(resolve, 10));
        }
        expect(observed).toBe(true);
        await pg.query('SELECT pg_sleep(2.1)');
        await pg.query('ROLLBACK');
        await waiting;
        expect(await hasPlatformAdministrator(tx, f.user.id)).toBe(false);
        expect(await ormCodes(f.target.id, tx)).toEqual([]);
        expect(await feature('workflow:act', f.target.id, tx)).toBe(false);
      }, { timeout: 15_000 });
    } finally { await pg.query('ROLLBACK'); }
  }, 20_000);

  it('rolls back CLI marker/version/session changes if the real audit insert fails', async () => {
    await prisma.rolePermission.deleteMany({ where: { roleId: f.role.id } });
    await prisma.positionRole.updateMany({ where: { positionId: f.position.id }, data: { isCanonical: true } });
    const token = await sessions.create(f.user.id, prisma, { mfaVerified: true, reauthenticated: true });
    const positions = await prisma.position.findMany({ where: { organizationId: f.home.id } });
    const user = await prisma.user.findUniqueOrThrow({ where: { id: f.user.id } });
    const role = await prisma.role.findUniqueOrThrow({ where: { id: f.role.id }, include: { permissions: true } });
    const sessionRows = await prisma.session.findMany({ where: { userId: f.user.id } });
    const beforeAudit = await prisma.auditEvent.count({ where: { organizationId: f.home.id } });
    const plan = await previewPlatformAdministrator(pg, input('grant'));
    await pg.query("CREATE FUNCTION req0030_admin_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action = 'PLATFORM_ADMINISTRATOR_GRANTED' THEN RAISE EXCEPTION 'REQ0030 audit rejection'; END IF; RETURN NEW; END $$");
    await pg.query('CREATE TRIGGER req0030_admin_audit_failure BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION req0030_admin_audit_failure()');
    try {
      await expect(applyPlatformAdministrator(pg, input('grant'), plan.expectedSecurityVersion, plan.digest, 'REQ0030 disposable test approval')).rejects.toThrow('REQ0030 audit rejection');
      expect(await hasPlatformAdministrator(prisma, f.user.id)).toBe(false);
      expect((await prisma.user.findUniqueOrThrow({ where: { id: f.user.id } })).securityVersion).toBe(plan.expectedSecurityVersion);
      expect(await prisma.position.findMany({ where: { organizationId: f.home.id } })).toEqual(positions);
      expect(await prisma.user.findUniqueOrThrow({ where: { id: f.user.id } })).toEqual(user);
      expect(await prisma.role.findUniqueOrThrow({ where: { id: f.role.id }, include: { permissions: true } })).toEqual(role);
      expect(await prisma.session.findMany({ where: { userId: f.user.id } })).toEqual(sessionRows);
      expect(await prisma.auditEvent.count({ where: { organizationId: f.home.id } })).toBe(beforeAudit);
      expect(await sessions.resolve(token)).not.toBeNull();
    } finally {
      await pg.query('DROP TRIGGER req0030_admin_audit_failure ON audit_events');
      await pg.query('DROP FUNCTION req0030_admin_audit_failure()');
    }
  });

  it('rejects a shared-role CLI bootstrap rather than silently granting additional users', async () => {
    const other = await prisma.user.create({ data: { organizationId: f.home.id, username: randomUUID(), passwordHash: 'not-a-login-fixture', accountType: 'INTERNAL' } });
    await prisma.userRole.create({ data: { userId: other.id, organizationId: f.home.id, roleId: f.role.id } });
    await expect(previewPlatformAdministrator(pg, input('grant'))).rejects.toThrow('DEDICATED_ROLE_REQUIRED');
  });

  it('runs the actual server CLI preview and approval/version-bound apply without usernames or implicit initialization', async () => {
    await prisma.rolePermission.deleteMany({ where: { roleId: f.role.id } });
    const args = ['--import', 'tsx', 'scripts/platform-administrator.ts', '--action', 'grant', '--user-id', f.user.id, '--role-id', f.role.id, '--organization-id', f.home.id, '--source', 'DIRECT'];
    const preview = spawnSync(process.execPath, args, { encoding: 'utf8', env: process.env });
    expect(preview.status).toBe(0);
    const plan = JSON.parse(preview.stdout);
    expect(plan).toMatchObject({ userId: f.user.id, roleId: f.role.id, source: 'DIRECT', willChange: true });
    expect(await hasPlatformAdministrator(prisma, f.user.id)).toBe(false);
    const applied = spawnSync(process.execPath, [...args, '--apply', '--expected-security-version', String(plan.expectedSecurityVersion), '--preview-sha256', plan.digest, '--approval-reference', 'REQ0030 disposable CLI process approval'], { encoding: 'utf8', env: process.env });
    expect(applied.status).toBe(0);
    expect(JSON.parse(applied.stdout).applied).toBe(true);
    expect(await hasPlatformAdministrator(prisma, f.user.id)).toBe(true);
    const stale = spawnSync(process.execPath, [...args, '--apply', '--expected-security-version', String(plan.expectedSecurityVersion), '--preview-sha256', plan.digest, '--approval-reference', 'REQ0030 disposable CLI process approval'], { encoding: 'utf8', env: process.env });
    expect(stale.status).toBe(1);
    expect(stale.stderr).toContain('STALE_PREVIEW');
  }, 20_000);

  it('protects a disabled platform administrator real sources from ordinary trusted role replacement', async () => {
    const ordinary = await prisma.user.create({ data: { organizationId: f.home.id, username: randomUUID(), passwordHash: 'test-only', accountType: 'INTERNAL' } });
    const permission = await prisma.permission.findUniqueOrThrow({ where: { code: 'account:roles:assign' } });
    const role = await prisma.role.create({ data: { organizationId: f.home.id, code: randomUUID(), name: 'Ordinary role operator', permissions: { create: { permissionId: permission.id } } } });
    await prisma.userRole.create({ data: { organizationId: f.home.id, userId: ordinary.id, roleId: role.id } });
    const token = await sessions.create(ordinary.id, prisma, { mfaVerified: true, reauthenticated: true });
    const current = await sessions.resolve(token);
    expect(current).not.toBeNull();
    await prisma.user.update({ where: { id: f.user.id }, data: { status: 'DISABLED' } });
    const before = await prisma.user.findUniqueOrThrow({ where: { id: f.user.id } });
    const grants = await prisma.userRole.findMany({ where: { userId: f.user.id }, orderBy: { roleId: 'asc' } });
    const roles = new AdminRoleService(prisma, audit, new AdminMutationService(prisma, audit));
    await expect(roles.assign({ id: ordinary.id, organizationId: f.home.id, accountType: 'INTERNAL', sessionId: current!.id }, f.user.id, { roleIds: [] }, randomUUID(), randomUUID()))
      .rejects.toMatchObject({ status: 403, response: { code: 'FEATURE_PERMISSION_DENIED' } });
    expect(await prisma.user.findUniqueOrThrow({ where: { id: f.user.id } })).toEqual(before);
    expect(await prisma.userRole.findMany({ where: { userId: f.user.id }, orderBy: { roleId: 'asc' } })).toEqual(grants);
    expect(await prisma.auditEvent.count({ where: { organizationId: f.home.id, action: 'USER_ROLES_CHANGED', resourceId: f.user.id } })).toBe(0);
  });

  it('exposes platform scope and real source provenance in both public account and role previews without inventing local direct membership', async () => {
    await prisma.userRole.deleteMany({ where: { userId: f.user.id } });
    await prisma.userPosition.deleteMany({ where: { userId: f.user.id } });
    const sourceRole = await prisma.role.create({ data: { organizationId: f.target.id, code: randomUUID(), name: 'Cross-source administrator', permissions: { create: { permissionId: f.marker.id } } } });
    await prisma.userRole.create({ data: { userId: f.user.id, roleId: sourceRole.id, organizationId: f.target.id } });
    const mutations = new AdminMutationService(prisma, audit);
    const organizations = new OrganizationService(prisma, mutations, audit, {} as never);
    const overview = await new AccountOverviewService(prisma, organizations, new AuthorizationService(prisma)).current({ id: f.user.id, organizationId: f.home.id, accountType: 'INTERNAL' });
    const roles = new AdminRoleService(prisma, audit, mutations);
    const preview = await roles.assignments({ id: f.user.id, organizationId: f.home.id, accountType: 'INTERNAL', sessionId: randomUUID() }, f.user.id);
    const expected = { kind: 'PLATFORM_ADMINISTRATOR', sourceOrganizationIds: [f.target.id], targetOrganizationId: f.home.id, coverage: 'INTERNAL_PLATFORM' };
    expect(overview.effectiveRoles[0]).toMatchObject({ id: sourceRole.id, platformScope: expected, sources: [{ kind: 'DIRECT' }] });
    expect(preview.effectiveRoles[0]).toMatchObject({ id: sourceRole.id, organizationId: f.target.id, platformScope: expected, sources: [{ kind: 'DIRECT' }] });
    expect(preview.roles).toEqual([]);
  });
});
