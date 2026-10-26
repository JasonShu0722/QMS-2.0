import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../src/database/prisma.service.js';
import { AuditLogService } from '../../src/modules/audit-log/audit-log.service.js';
import { AdminMutationService } from '../../src/common/security/admin-mutation.service.js';
import { effectiveRoleGrants } from '../../src/common/security/effective-role-grants.js';
import { AdminUserService } from '../../src/modules/identity/admin-user.service.js';
import { PasswordService } from '../../src/modules/identity/password.service.js';
import { PasswordHasherService } from '../../src/common/security/password-hasher.service.js';
import { PasswordResetService } from '../../src/modules/identity/password-reset.service.js';
import { TemporaryPasswordService } from '../../src/modules/identity/temporary-password.service.js';
import { SessionService } from '../../src/modules/identity/session.service.js';
import { PositionOnboardingService } from '../../src/modules/organization/position-onboarding.service.js';
import { OrganizationService } from '../../src/modules/organization/organization.service.js';

const connection = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL) : undefined;
if (!connection || process.env.QMS_DISPOSABLE_TEST_DB !== 'true'
  || !['postgres:', 'postgresql:'].includes(connection.protocol)
  || !['localhost', '127.0.0.1', '[::1]'].includes(connection.hostname)
  || connection.port === '55440' || connection.search || connection.hash) {
  throw new Error('Source governance requires disposable loopback PostgreSQL, never preview 55440.');
}

describe('REQ0030 real authorization sources versus runtime projections', () => {
  const prisma = new PrismaService();
  const audit = new AuditLogService(prisma);
  const passwords = new PasswordService(new PasswordHasherService());
  const sessions = new SessionService(prisma, audit);
  const mutations = new AdminMutationService(prisma, audit);
  const onboarding = new PositionOnboardingService(prisma, audit);
  const users = new AdminUserService(prisma, passwords, audit, mutations, new PasswordResetService(prisma, passwords, audit), new TemporaryPasswordService(prisma, passwords), onboarding);
  const organizations = new OrganizationService(prisma, mutations, audit, onboarding);
  const organizationIds: string[] = [];
  let f: Awaited<ReturnType<typeof fixture>>;

  beforeAll(async () => { await prisma.$connect(); });
  beforeEach(async () => { f = await fixture(); });
  afterEach(async () => {
    const where = { organizationId: { in: organizationIds } };
    await prisma.auditEvent.deleteMany({ where });
    await prisma.adminMutation.deleteMany({ where });
    await prisma.userPosition.deleteMany({ where });
    await prisma.positionRole.deleteMany({ where });
    await prisma.position.deleteMany({ where });
    await prisma.department.deleteMany({ where });
    await prisma.user.deleteMany({ where });
    await prisma.role.deleteMany({ where });
    await prisma.organization.deleteMany({ where: { id: { in: organizationIds.splice(0) } } });
  });
  afterAll(async () => { await prisma.$disconnect(); });

  async function organization(status: 'ACTIVE' | 'DISABLED' = 'ACTIVE') {
    const org = await prisma.organization.create({ data: { code: randomUUID(), name: 'Source governance fixture', type: 'INTERNAL', status } });
    organizationIds.push(org.id);
    return org;
  }
  async function person(organizationId: string) {
    return prisma.user.create({ data: { organizationId, username: randomUUID(), accountType: 'INTERNAL', passwordHash: 'not-a-login-fixture' } });
  }
  async function role(organizationId: string, codes: string[]) {
    const permissions = await prisma.permission.findMany({ where: { code: { in: codes } } });
    expect(permissions).toHaveLength(codes.length);
    return prisma.role.create({ data: { organizationId, code: randomUUID(), name: 'Source role', permissions: { create: permissions.map(({ id }) => ({ permissionId: id })) } } });
  }
  async function actor(user: Awaited<ReturnType<typeof person>>) {
    const token = await sessions.create(user.id, prisma, { mfaVerified: true, reauthenticated: true });
    const session = await sessions.resolve(token);
    return { id: user.id, organizationId: user.organizationId, accountType: 'INTERNAL' as const, sessionId: session!.id };
  }
  async function fixture() {
    const home = await organization();
    const admin = await person(home.id);
    const target = await person(home.id);
    const marker = await role(home.id, ['platform:admin']);
    await prisma.userRole.create({ data: { organizationId: home.id, userId: admin.id, roleId: marker.id } });
    const department = await prisma.department.create({ data: { organizationId: home.id, code: randomUUID(), name: 'Source department' } });
    const position = await prisma.position.create({ data: { organizationId: home.id, departmentId: department.id, code: randomUUID(), name: 'Marker position' } });
    await prisma.positionRole.create({ data: { organizationId: home.id, positionId: position.id, roleId: marker.id } });
    return { home, admin, target, marker, position, actor: await actor(admin) };
  }
  async function appoint() {
    return prisma.userPosition.create({ data: { organizationId: f.home.id, userId: f.target.id, positionId: f.position.id, startedAt: new Date(Date.now() - 60_000) } });
  }
  async function targetState() {
    return {
      user: await prisma.user.findUniqueOrThrow({ where: { id: f.target.id } }),
      sessions: await prisma.session.findMany({ where: { userId: f.target.id }, orderBy: { id: 'asc' } }),
      success: await prisma.auditEvent.count({ where: { resourceId: f.target.id, outcome: 'SUCCESS' } }),
    };
  }
  const preview = (positionIds: string[], targetUserId: string | undefined = f.target.id) => onboarding.preview(f.actor, f.home.id, { positionIds, targetUserId });
  const codes = async () => [...new Set((await effectiveRoleGrants(prisma, f.target.id, f.home.id)).flatMap(grant => grant.role.permissions.map(({ permission }) => permission.code)))].sort();

  it.each(['DIRECT', 'POSITION'] as const)('rejects ordinary status administrators reactivating a DISABLED %s marker holder without changing user/version/session/success audit', async source => {
    if (source === 'DIRECT') await prisma.userRole.create({ data: { organizationId: f.home.id, userId: f.target.id, roleId: f.marker.id } });
    else await appoint();
    await sessions.create(f.target.id, prisma, { mfaVerified: true, reauthenticated: true });
    await prisma.user.update({ where: { id: f.target.id }, data: { status: 'DISABLED' } });
    const ordinary = await person(f.home.id);
    const ordinaryRole = await role(f.home.id, ['account:users:status']);
    await prisma.userRole.create({ data: { organizationId: f.home.id, userId: ordinary.id, roleId: ordinaryRole.id } });
    const ordinaryActor = await actor(ordinary);
    const before = await targetState();
    const operation = users.update(ordinaryActor, f.target.id, { status: 'ACTIVE' }, f.home.id, randomUUID(), randomUUID());
    const result = await operation.then(() => ({ allowed: true }), error => ({ allowed: false, error }));
    expect(await targetState()).toEqual(before);
    expect(result).toMatchObject({ allowed: false, error: { status: 403, response: { code: 'FEATURE_PERMISSION_DENIED' } } });
  });

  it.each(['disable', 'reset'] as const)('lets a platform administrator %s another marker holder despite an unrelated DISABLED virtual organization', async action => {
    await appoint();
    const targetActor = await actor(f.target);
    await organization('DISABLED');
    const before = await targetState();
    if (action === 'disable') await users.update(f.actor, f.target.id, { status: 'DISABLED' }, f.home.id, randomUUID(), randomUUID());
    else await users.resetTemporaryPassword(f.actor, f.target.id, 'REQ0030-temporary-password', f.home.id, randomUUID(), randomUUID());
    const after = await targetState();
    expect(after.user.securityVersion).toBe(before.user.securityVersion + 1);
    expect(after.sessions.find(({ id }) => id === targetActor.sessionId)!.revokedAt).not.toBeNull();
    expect(after.success).toBeGreaterThan(before.success);
    expect(await prisma.userPosition.count({ where: { userId: f.target.id } })).toBe(1);
  });

  it('projects a retained marker position after candidate appointments and preserves a no-op version/session', async () => {
    await appoint();
    const targetActor = await actor(f.target);
    const before = await targetState();
    const result = await preview([f.position.id]);
    expect(result.effectivePermissionCodes).toEqual(await codes());
    expect(result.effectivePermissionCodes).toContain('account:users:status');
    await organizations.replaceUserPositions(f.actor, f.home.id, f.target.id, { positionIds: [f.position.id], expectedPositionIds: [f.position.id], authorizationBaseline: result.authorizationBaseline }, randomUUID(), randomUUID());
    const after = await targetState();
    expect(after.user.securityVersion).toBe(before.user.securityVersion);
    expect(after.sessions.find(({ id }) => id === targetActor.sessionId)!.revokedAt).toBeNull();
    expect((await preview([])).effectivePermissionCodes).toEqual([]);
  });

  it('retains a cross-organization DIRECT marker at its real organization with readable platform scope', async () => {
    const remote = await organization();
    const marker = await role(remote.id, ['platform:admin']);
    await prisma.userRole.create({ data: { organizationId: remote.id, userId: f.target.id, roleId: marker.id } });
    const result = await preview([]);
    expect(result.effectivePermissionCodes).toEqual(await codes());
    expect(result.retainedSources).toEqual([expect.objectContaining({ roleId: marker.id, organizationId: remote.id, platformScope: { kind: 'PLATFORM_ADMINISTRATOR', sourceOrganizationIds: [remote.id], targetOrganizationId: f.home.id, coverage: 'INTERNAL_PLATFORM' } })]);
    expect(await prisma.userRole.count({ where: { userId: f.target.id, organizationId: f.home.id } })).toBe(0);
  });

  it('projects initial appointments without a target user and still enforces the ordinary actor ceiling', async () => {
    const initial = await onboarding.preview(f.actor, f.home.id, { positionIds: [f.position.id] });
    const administratorCodes = [...new Set((await effectiveRoleGrants(prisma, f.admin.id, f.home.id)).flatMap(grant => grant.role.permissions.map(({ permission }) => permission.code)))].sort();
    expect(initial.effectivePermissionCodes).toEqual(administratorCodes);
    const limited = await person(f.home.id);
    const limitedRole = await role(f.home.id, ['organization:structure:read', 'organization:positions:assign', 'account:roles:read', 'account:roles:assign']);
    await prisma.userRole.create({ data: { organizationId: f.home.id, userId: limited.id, roleId: limitedRole.id } });
    await expect(onboarding.preview(await actor(limited), f.home.id, { positionIds: [f.position.id] })).rejects.toMatchObject({ status: 403, response: { code: 'POSITION_GRANT_CEILING_DENIED' } });
    const ordinary = await role(f.home.id, ['notification:read']);
    await prisma.positionRole.deleteMany({ where: { positionId: f.position.id } });
    await prisma.positionRole.create({ data: { organizationId: f.home.id, positionId: f.position.id, roleId: ordinary.id } });
    const result = await onboarding.preview(f.actor, f.home.id, { positionIds: [f.position.id] });
    expect(result.effectivePermissionCodes).toEqual(['notification:read']);
    expect(result.retainedSources).toBeUndefined();
    const created = await prisma.$transaction(tx => onboarding.createWithInitialPositions(tx, f.actor, f.home.id, { positionIds: [f.position.id], authorizationBaseline: result.authorizationBaseline }, randomUUID(), () => tx.user.create({ data: { organizationId: f.home.id, username: randomUUID(), accountType: 'INTERNAL', passwordHash: 'not-a-login-fixture' } })));
    expect(await prisma.userPosition.count({ where: { userId: created.id } })).toBe(1);
  });

  it('rejects stale candidate permission baselines without changing appointments or sessions', async () => {
    await appoint();
    const result = await preview([]);
    const before = await targetState();
    await prisma.role.update({ where: { id: f.marker.id }, data: { mfaRequired: true } });
    await expect(organizations.replaceUserPositions(f.actor, f.home.id, f.target.id, { positionIds: [], expectedPositionIds: [f.position.id], authorizationBaseline: result.authorizationBaseline }, randomUUID(), randomUUID())).rejects.toMatchObject({ status: 409, response: { code: 'CONCURRENCY_CONFLICT' } });
    expect(await targetState()).toEqual(before);
    expect(await prisma.userPosition.count({ where: { userId: f.target.id, endedAt: null } })).toBe(1);
  });
});
