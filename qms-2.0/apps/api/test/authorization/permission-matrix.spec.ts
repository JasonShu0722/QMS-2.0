import { jest } from '@jest/globals';
import { AdminMutationService } from '../../src/common/security/admin-mutation.service.js';
import { AdminRoleService } from '../../src/modules/authorization/admin-role.service.js';
import { AdminUserService } from '../../src/modules/identity/admin-user.service.js';
import { ADMIN_PERMISSIONS } from '../../src/modules/authorization/permission-catalog.js';

describe('granular administration permissions', () => {
  const actor = { id: 'admin', sessionId: 'trusted-test-session', organizationId: 'org', accountType: 'INTERNAL' as const };
  const role = { id: 'role', organizationId: 'org', code: 'ROLE', name: 'Role', permissions: [] };
  let granted: string[];
  const prisma = {
    user: { findUnique: jest.fn(), findFirst: jest.fn(), create: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
    organization: { findUnique: jest.fn() },
    userRole: { findMany: jest.fn(), count: jest.fn(), deleteMany: jest.fn(), createMany: jest.fn() },
    role: { findFirst: jest.fn(), findMany: jest.fn(), create: jest.fn(), update: jest.fn(), delete: jest.fn() },
    permission: { findMany: jest.fn() },
    rolePermission: { deleteMany: jest.fn(), createMany: jest.fn() },
    passwordReset: { updateMany: jest.fn() },
    session: { updateMany: jest.fn(), findFirst: jest.fn() },
    adminMutation: { findUnique: jest.fn(), create: jest.fn() },
    $transaction: jest.fn(),
    $queryRaw: jest.fn(),
  };
  const audit = { record: jest.fn() };
  const passwords = { hash: jest.fn() };
  const resets = { issue: jest.fn() };
  const mutations = new AdminMutationService(prisma as never, audit as never);
  const users = new AdminUserService(prisma as never, passwords as never, audit as never, mutations, resets as never);
  const roles = new AdminRoleService(prisma as never, audit as never, mutations);
  beforeEach(() => {
    jest.resetAllMocks();
    prisma.session.findFirst.mockResolvedValue({ id: actor.sessionId, mfaVerifiedAt: new Date(), reauthenticatedAt: new Date() });
    granted = [];
    prisma.$transaction.mockImplementation(async (work: (transaction: typeof prisma) => Promise<unknown>) => work(prisma));
    prisma.user.findUnique.mockResolvedValue({ ...actor, status: 'ACTIVE', organization: { status: 'ACTIVE' } });
    prisma.user.findFirst.mockResolvedValue({ id: 'target', organizationId: 'org', accountType: 'INTERNAL' });
    prisma.user.update.mockResolvedValue({ id: 'target' });
    prisma.user.create.mockResolvedValue({ id: 'target' });
    prisma.organization.findUnique.mockResolvedValue({ type: 'INTERNAL', status: 'ACTIVE' });
    prisma.userRole.findMany.mockImplementation(async ({ where }: { where: { userId: string } }) => where.userId === actor.id ? [{ role: { permissions: granted.map((code) => ({ permission: { code } })) } }] : []);
    prisma.userRole.count.mockResolvedValue(0);
    prisma.role.findFirst.mockResolvedValue(role);
    prisma.role.findMany.mockResolvedValue([]);
    prisma.role.create.mockResolvedValue(role);
    prisma.role.update.mockResolvedValue(role);
    prisma.permission.findMany.mockResolvedValue([]);
    resets.issue.mockResolvedValue({ resetId: 'reset' });
  });

  const userActions = {
    create: () => users.create(actor, { organizationId: 'org', username: 'new', accountType: 'INTERNAL', initialPassword: 'password' }, 'trace', 'matrix-key'),
    update: () => users.update(actor, 'target', { email: 'new@example.test' }, 'org', 'trace', 'matrix-key'),
    status: () => users.update(actor, 'target', { status: 'DISABLED' }, 'org', 'trace', 'matrix-key'),
    transfer: () => users.update(actor, 'target', { accountType: 'INTERNAL' }, 'org', 'trace', 'matrix-key'),
    reset: () => users.resetPassword(actor, 'target', 'temporary', 'org', 'trace', 'matrix-key'),
  };
  it.each(Object.keys(userActions) as (keyof typeof userActions)[])('allows only the isolated user %s operation', async (operation) => {
    granted = [`account:users:${operation}`];
    await expect(userActions[operation]()).resolves.toBeDefined();
    for (const other of Object.keys(userActions) as (keyof typeof userActions)[]) {
      if (other !== operation) await expect(userActions[other]()).rejects.toMatchObject({ status: 403 });
    }
  });
  const roleActions = {
    create: () => roles.create(actor, { organizationId: 'org', code: 'NEW', name: 'New', permissionCodes: [] }, 'trace', 'matrix-key'),
    update: () => roles.update(actor, 'role', { name: 'New' }, 'trace', 'matrix-key'),
    delete: () => roles.remove(actor, 'role', 'trace', 'matrix-key'),
    assign: () => roles.assign(actor, 'target', { roleIds: [] }, 'trace', 'matrix-key'),
  };
  it.each(Object.keys(roleActions) as (keyof typeof roleActions)[])('allows only the isolated role %s operation', async (operation) => {
    granted = [`account:roles:${operation}`];
    await expect(roleActions[operation]()).resolves.not.toBeUndefined();
    for (const other of Object.keys(roleActions) as (keyof typeof roleActions)[]) {
      if (other !== operation) await expect(roleActions[other]()).rejects.toMatchObject({ status: 403 });
    }
  });
  it('requires every mixed PATCH permission before mutation and replay', async () => {
    granted = ['account:users:update'];
    const payload = { email: 'new@example.test', status: 'DISABLED' as const };
    await expect(users.update(actor, 'target', payload, 'org', 'trace', 'matrix-key')).rejects.toMatchObject({ status: 403 });
    expect(prisma.user.update).not.toHaveBeenCalled();
    prisma.adminMutation.findUnique.mockResolvedValue({ response: { value: { id: 'target' } } });
    await expect(users.update(actor, 'target', payload, 'org', 'trace', 'matrix-key')).rejects.toMatchObject({ status: 403 });
    expect(prisma.adminMutation.findUnique).not.toHaveBeenCalled();
  });
  it('rejects missing and stale permission baselines before mutation', async () => {
    granted = ['account:roles:manage', 'account:roles:update'];
    await expect(roles.update(actor, 'role', { permissionCodes: [] }, 'trace', 'matrix-key')).rejects.toMatchObject({ status: 400 });
    await expect(roles.update(actor, 'role', { permissionCodes: [], expectedPermissionCodes: ['workbench:read'] } as never, 'trace', 'matrix-key')).rejects.toMatchObject({ status: 409 });
    expect(prisma.rolePermission.deleteMany).not.toHaveBeenCalled();
  });
  it('rejects unknown permissions even when held and stored in the database', async () => {
    granted = ['account:roles:manage', 'account:roles:create', 'supplier:planned'];
    prisma.permission.findMany.mockResolvedValue([{ id: 'forged', code: 'supplier:planned' }]);
    await expect(roles.create(actor, { organizationId: 'org', code: 'NEW', name: 'New', permissionCodes: ['supplier:planned'] }, 'trace', 'matrix-key')).rejects.toMatchObject({ status: 400, response: { code: 'ADMIN_PERMISSION_NOT_FOUND' } });
    expect(prisma.role.create).not.toHaveBeenCalled();
  });

  it.each(ADMIN_PERMISSIONS)('preserves administrator self access to %s', async (permission) => {
    granted = [...ADMIN_PERMISSIONS];
    const assignments = (codes: string[]) => [{ role: { permissions: codes.map((code) => ({ permission: { code } })) } }];
    prisma.userRole.findMany.mockResolvedValueOnce(assignments(granted)).mockResolvedValueOnce(assignments(granted)).mockResolvedValueOnce(assignments(granted.filter((code) => code !== permission)));
    await expect(roles.update(actor, 'role', { permissionCodes: [], expectedPermissionCodes: [] }, 'trace', 'matrix-key')).rejects.toMatchObject({ status: 409, response: { code: 'ADMIN_SELF_LOCK_FORBIDDEN' } });
  });

  it('uses set equality for the baseline and leaves permissions alone on name-only edits', async () => {
    granted = ['account:roles:update', 'workbench:read', 'organization:read'];
    prisma.role.findFirst.mockResolvedValue({ ...role, permissions: ['workbench:read', 'organization:read'].map((code) => ({ permission: { code } })) });
    await roles.update(actor, 'role', { permissionCodes: [], expectedPermissionCodes: ['organization:read', 'workbench:read'] }, 'trace', 'matrix-key');
    expect(prisma.rolePermission.deleteMany).toHaveBeenCalledTimes(1);
    prisma.rolePermission.deleteMany.mockClear();
    await roles.update(actor, 'role', { name: 'Renamed' }, 'trace', 'another-key');
    expect(prisma.rolePermission.deleteMany).not.toHaveBeenCalled();
  });

  it('requires update for an empty user patch and never accepts retired manage', async () => {
    granted = ['account:users:manage'];
    await expect(users.update(actor, 'target', {}, 'org', 'trace', 'matrix-key')).rejects.toMatchObject({ status: 403 });
    granted = ['account:users:update'];
    await expect(users.update(actor, 'target', {}, 'org', 'trace', 'matrix-key')).resolves.toBeDefined();
  });

  it('only marks registered, stored and held permissions grantable', async () => {
    granted = ['account:roles:read', 'workbench:read', 'account:users:update'];
    prisma.permission.findMany.mockResolvedValue([{ code: 'workbench:read' }, { code: 'account:users:status' }, { code: 'forged:grant' }]);
    const catalog = await roles.catalog(actor);
    const operations = catalog.flatMap((group) => group.modules.flatMap((module) => module.operations));
    expect(operations.filter((operation) => operation.grantable).map((operation) => operation.code)).toEqual(['workbench:read']);
    expect(operations.find((operation) => operation.code === 'workbench:read')?.enforcement).toBe('reserved');
    expect(operations.some((operation) => operation.code === 'forged:grant')).toBe(false);
  });
});
