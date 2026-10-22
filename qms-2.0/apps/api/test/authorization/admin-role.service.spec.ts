import { jest } from '@jest/globals';
import { AdminMutationService } from '../../src/common/security/admin-mutation.service.js';
import { AdminRoleService } from '../../src/modules/authorization/admin-role.service.js';

describe('administrator role management', () => {
  const prisma = {
    userPosition: { findMany: jest.fn().mockResolvedValue([]) },
    role: { findMany: jest.fn(), findFirst: jest.fn(), create: jest.fn(), update: jest.fn(), delete: jest.fn() },
    permission: { findMany: jest.fn() },
    positionRole: { count: jest.fn() },
    rolePermission: { deleteMany: jest.fn(), createMany: jest.fn() },
    userRole: { findMany: jest.fn(), count: jest.fn(), deleteMany: jest.fn(), createMany: jest.fn() },
    user: { findMany: jest.fn(), findFirst: jest.fn(), findUnique: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
    session: { findFirst: jest.fn() },
    organization: { findUnique: jest.fn() },
    adminMutation: { findUnique: jest.fn(), create: jest.fn() },
    passwordReset: { updateMany: jest.fn() },
    $transaction: jest.fn(),
    $queryRaw: jest.fn(),
  };
  const audit = { record: jest.fn() };
  const service = new AdminRoleService(prisma as never, audit as never, new AdminMutationService(prisma as never, audit as never));
  const actor = { id: 'admin', sessionId: 'session-admin', organizationId: 'org-a', scopeOrganizationId: 'org-a', accountType: 'INTERNAL' as const };
  const permissionCodes = ['account:roles:read', 'account:roles:create', 'account:roles:update', 'account:roles:delete', 'account:roles:assign', 'account:users:create', 'account:users:update', 'account:users:status', 'account:users:transfer', 'account:users:reset', 'workbench:read'];
  const assignments = [{ organizationId: 'org-a', role: { id: 'fixture-role', organizationId: 'org-a', permissions: permissionCodes.map((code) => ({ permission: { code } })) } }];
  const role = { id: 'role-a', organizationId: 'org-a', code: 'QUALITY', name: 'Quality', mfaRequired: false, permissions: [] };

  beforeEach(() => {
    jest.resetAllMocks();
    prisma.userPosition.findMany.mockResolvedValue([]);
    prisma.positionRole.count.mockResolvedValue(0);
    prisma.user.findMany.mockResolvedValue([]);
    prisma.session.findFirst.mockResolvedValue({ id: actor.sessionId, mfaVerifiedAt: new Date(), reauthenticatedAt: new Date() });
    prisma.$transaction.mockImplementation(async (work: (tx: typeof prisma) => Promise<unknown>) => work(prisma));
    prisma.user.findUnique.mockResolvedValue({ ...actor, status: 'ACTIVE', organization: { status: 'ACTIVE' } });
    prisma.organization.findUnique.mockResolvedValue({ status: 'ACTIVE' });
    prisma.adminMutation.findUnique.mockResolvedValue(null);
    prisma.userRole.findMany.mockResolvedValue(assignments);
    prisma.userRole.count.mockResolvedValue(0);
    prisma.role.findFirst.mockResolvedValue(role);
    prisma.role.findMany.mockResolvedValue([role]);
    prisma.role.create.mockResolvedValue(role);
    prisma.role.update.mockResolvedValue(role);
    prisma.permission.findMany.mockResolvedValue([{ id: 'permission-a', code: 'workbench:read', name: 'Workbench' }]);
    prisma.user.findFirst.mockResolvedValue({ id: 'target-user', organizationId: 'org-a' });
  });

  it('returns the read-only permission directory sorted by code', async () => {
    expect(await service.permissions(actor)).toEqual([{ id: 'permission-a', code: 'workbench:read', name: 'Workbench' }]);
    expect(prisma.permission.findMany).toHaveBeenCalledWith({ select: { id: true, code: true, name: true }, orderBy: { code: 'asc' } });
  });

  it.each(['update', 'remove', 'copy', 'assign'] as const)('refuses canonical role %s before an old successful idempotency replay', async (operation) => {
    prisma.positionRole.count.mockResolvedValue(1);
    prisma.adminMutation.findUnique.mockResolvedValue({ action: 'OLD_SUCCESS', response: { value: { leaked: true } } });
    const change = operation === 'update' ? service.update(actor, role.id, { name: 'Bypass' }, 'trace', 'canonical-key')
      : operation === 'remove' ? service.remove(actor, role.id, 'trace', 'canonical-key')
        : operation === 'copy' ? service.copy(actor, role.id, { code: 'COPY', name: 'Copy' }, 'trace', 'canonical-key')
          : service.assign(actor, 'target-user', { roleIds: [role.id] }, 'trace', 'canonical-key');
    await expect(change).rejects.toMatchObject({ status: 403, response: { code: 'FEATURE_PERMISSION_DENIED' } });
    expect(prisma.adminMutation.findUnique).not.toHaveBeenCalled();
    expect(prisma.positionRole.count).toHaveBeenCalledWith({ where: { isCanonical: true, roleId: { in: [role.id] } } });
  });

  it('requires the read MFA baseline and rejects stale policy changes before mutation', async () => {
    await expect(service.update(actor, role.id, { mfaRequired: true }, 'trace', 'test-key-mfa')).rejects.toMatchObject({ status: 400 });
    await expect(service.update(actor, role.id, { mfaRequired: false, expectedMfaRequired: true }, 'trace', 'test-key-mfa')).rejects.toMatchObject({ response: { code: 'CONCURRENCY_CONFLICT' } });
    expect(prisma.role.update).not.toHaveBeenCalled();
    await service.update(actor, role.id, { mfaRequired: true, expectedMfaRequired: false }, 'trace', 'test-key-mfa');
    expect(prisma.role.update).toHaveBeenCalledWith(expect.objectContaining({ data: { mfaRequired: true } }));
    expect(prisma.user.updateMany).toHaveBeenCalledWith({ where: { id: { in: [] } }, data: { securityVersion: { increment: 1 } } });
  });

  it('refuses to remove a previously assigned global role', async () => {
    prisma.userRole.findMany.mockResolvedValueOnce(assignments).mockResolvedValueOnce(assignments).mockResolvedValueOnce([{ organizationId: 'org-a', role: { id: 'fixture-role', organizationId: 'org-a', ...role, organizationId: null } }]);
    await expect(service.assign(actor, 'target-user', { roleIds: [] }, 'trace', 'test-key-1'))
      .rejects.toMatchObject({ response: { code: 'ADMIN_GLOBAL_ROLE_IMMUTABLE' } });
    expect(prisma.userRole.deleteMany).not.toHaveBeenCalled();
  });

  it('records a rejected escalation outside the rolled-back transaction', async () => {
    prisma.permission.findMany.mockResolvedValue([{ id: 'secret', code: 'organization:read', name: 'Secret' }]);
    await expect(service.create(actor, { organizationId: 'org-a', code: 'QUALITY', name: 'Quality', permissionCodes: ['organization:read'] }, 'trace', 'test-key-1')).rejects.toBeDefined();
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'ACTION_REJECTED', outcome: 'DENIED' }));
  });

  it('lists and reads roles only inside the server-authorized organization', async () => {
    await service.list(actor);
    await service.detail(actor, 'role-a');
    expect(prisma.role.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { organizationId: 'org-a', positions: { none: { isCanonical: true } } } }));
    expect(prisma.role.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'role-a', organizationId: 'org-a' } }));
  });

  it('rejects a supplier actor from accessing another organization', async () => {
    prisma.user.findUnique.mockResolvedValue({ ...actor, status: 'ACTIVE', accountType: 'SUPPLIER', organization: { status: 'ACTIVE' } });
    await expect(service.list({ ...actor, accountType: 'SUPPLIER', scopeOrganizationId: 'org-b' }))
      .rejects.toMatchObject({ response: { code: 'ORGANIZATION_SCOPE_DENIED' } });
    expect(prisma.role.findMany).not.toHaveBeenCalled();
  });

  it('creates a role with existing permissions and audit in a serializable transaction', async () => {
    await service.create(actor, { organizationId: 'org-a', code: 'QUALITY', name: 'Quality', permissionCodes: ['workbench:read'] }, 'trace', 'test-key-1');
    expect(prisma.role.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ organizationId: 'org-a', code: 'QUALITY', permissions: { create: [{ permissionId: 'permission-a' }] } }) }));
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: 'Serializable' });
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'ROLE_CREATED', resourceId: 'role-a' }), prisma);
  });

  it('rejects permissions missing from the stable directory', async () => {
    prisma.permission.findMany.mockResolvedValue([]);
    await expect(service.create(actor, { organizationId: 'org-a', code: 'QUALITY', name: 'Quality', permissionCodes: ['unknown:grant'] }, 'trace', 'test-key-1'))
      .rejects.toMatchObject({ response: { code: 'ADMIN_PERMISSION_NOT_FOUND' } });
    expect(prisma.role.create).not.toHaveBeenCalled();
  });

  it('prevents granting a permission the acting administrator does not hold', async () => {
    prisma.permission.findMany.mockResolvedValue([{ id: 'secret', code: 'organization:read', name: 'Secret' }]);
    await expect(service.create(actor, { organizationId: 'org-a', code: 'QUALITY', name: 'Quality', permissionCodes: ['organization:read'] }, 'trace', 'test-key-1'))
      .rejects.toMatchObject({ response: { code: 'FEATURE_PERMISSION_DENIED' } });
    expect(prisma.role.create).not.toHaveBeenCalled();
  });

  it('replaces role permissions and records the change transactionally', async () => {
    await service.update(actor, 'role-a', { name: 'Changed', permissionCodes: ['workbench:read'], expectedPermissionCodes: [] }, 'trace', 'test-key-1');
    expect(prisma.rolePermission.deleteMany).toHaveBeenCalledWith({ where: { roleId: 'role-a' } });
    expect(prisma.rolePermission.createMany).toHaveBeenCalledWith({ data: [{ roleId: 'role-a', permissionId: 'permission-a' }] });
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'ROLE_UPDATED' }), prisma);
  });

  it('rejects a role update that removes the acting administrator management permission', async () => {
    prisma.userRole.findMany.mockResolvedValueOnce(assignments).mockResolvedValueOnce(assignments).mockResolvedValueOnce([]);
    await expect(service.update(actor, 'role-a', { permissionCodes: [], expectedPermissionCodes: [] }, 'trace', 'test-key-1'))
      .rejects.toMatchObject({ response: { code: 'ADMIN_SELF_LOCK_FORBIDDEN' } });
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'ACTION_REJECTED' }));
  });

  it('deletes only unassigned roles with audit', async () => {
    await service.remove(actor, 'role-a', 'trace', 'test-key-1');
    expect(prisma.role.delete).toHaveBeenCalledWith({ where: { id: 'role-a' } });
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'ROLE_DELETED' }), prisma);
    prisma.userRole.count.mockResolvedValue(1);
    await expect(service.remove(actor, 'role-a', 'trace', 'test-key-1')).rejects.toMatchObject({ response: { code: 'ADMIN_ROLE_IN_USE' } });
  });

  it('does not expose or modify a global or cross-organization role', async () => {
    prisma.role.findFirst.mockResolvedValue(null);
    await expect(service.update(actor, 'global-role', { name: 'Changed' }, 'trace', 'test-key-1'))
      .rejects.toMatchObject({ response: { code: 'ADMIN_ROLE_NOT_FOUND' } });
    expect(prisma.role.update).not.toHaveBeenCalled();
  });

  it('replaces assignments only with roles belonging to the target user organization', async () => {
    await service.assign(actor, 'target-user', { roleIds: ['role-a'] }, 'trace', 'test-key-1');
    expect(prisma.userRole.deleteMany).toHaveBeenCalledWith({ where: { userId: 'target-user', organizationId: 'org-a' } });
    expect(prisma.userRole.createMany).toHaveBeenCalledWith({ data: [{ userId: 'target-user', roleId: 'role-a', organizationId: 'org-a' }] });
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'USER_ROLES_CHANGED' }), prisma);
  });

  it('rejects a global or other-organization role assignment', async () => {
    prisma.role.findMany.mockResolvedValue([]);
    await expect(service.assign(actor, 'target-user', { roleIds: ['global-role'] }, 'trace', 'test-key-1'))
      .rejects.toMatchObject({ response: { code: 'ADMIN_ROLE_NOT_FOUND' } });
    expect(prisma.userRole.deleteMany).not.toHaveBeenCalled();
  });

  it('rejects a target user in another organization', async () => {
    prisma.user.findFirst.mockResolvedValue(null);
    await expect(service.assign(actor, 'other-user', { roleIds: [] }, 'trace', 'test-key-1'))
      .rejects.toMatchObject({ response: { code: 'ADMIN_USER_NOT_FOUND' } });
  });

  it('rolls back assignment changes that would lock out the acting administrator', async () => {
    prisma.userRole.findMany.mockResolvedValueOnce(assignments).mockResolvedValueOnce(assignments).mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    await expect(service.assign(actor, actor.id, { roleIds: [] }, 'trace', 'test-key-1'))
      .rejects.toMatchObject({ response: { code: 'ADMIN_SELF_LOCK_FORBIDDEN' } });
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'ACTION_REJECTED' }));
  });

  it('reads a user permission matrix in the selected organization', async () => {
    prisma.userRole.findMany.mockResolvedValueOnce(assignments).mockResolvedValueOnce([{ organizationId: 'org-a', role: { id: 'fixture-role', organizationId: 'org-a', ...role, permissions: [{ permission: { id: 'permission-a', code: 'workbench:read', name: 'Workbench' } }] } }]);
    expect(await service.assignments(actor, 'target-user')).toMatchObject({ userId: 'target-user', organizationId: 'org-a', permissions: ['workbench:read'] });
  });

  it('maps concurrent and duplicate writes to controlled conflicts', async () => {
    prisma.$transaction.mockRejectedValueOnce({ code: 'P2034' }).mockRejectedValueOnce({ code: 'P2002' });
    await expect(service.remove(actor, 'role-a', 'trace', 'test-key-1')).rejects.toMatchObject({ response: { code: 'CONCURRENCY_CONFLICT' }, status: 409 });
    await expect(service.create(actor, { organizationId: 'org-a', code: 'QUALITY', name: 'Quality', permissionCodes: [] }, 'trace', 'test-key-1'))
      .rejects.toMatchObject({ response: { code: 'ADMIN_ROLE_DUPLICATE' }, status: 409 });
  });

  it('copies an existing organization role as a template with the same controlled permissions', async () => {
    prisma.role.findFirst.mockResolvedValue({ ...role, permissions: [{ permission: { id: 'permission-a', code: 'workbench:read', name: 'Workbench' } }] });
    await service.copy(actor, 'role-a', { code: 'QUALITY_COPY', name: 'Copy' }, 'trace', 'test-key-1');
    expect(prisma.role.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ code: 'QUALITY_COPY', permissions: { create: [{ permissionId: 'permission-a' }] } }) }));
  });

  it('uses target organization permissions for both management and delegation', async () => {
    prisma.userRole.findMany.mockResolvedValue([]);
    await expect(service.create({ ...actor, scopeOrganizationId: 'org-b' }, { organizationId: 'org-b', code: 'QUALITY', name: 'Quality', permissionCodes: [] }, 'trace', 'test-key-1'))
      .rejects.toMatchObject({ response: { code: 'FEATURE_PERMISSION_DENIED' } });
    expect(prisma.userRole.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: actor.id, organizationId: 'org-b' } }));
    expect(prisma.role.create).not.toHaveBeenCalled();
  });

  it('preserves administrator read access required to reach management pages', async () => {
    prisma.userRole.findMany.mockResolvedValueOnce(assignments).mockResolvedValueOnce(assignments).mockResolvedValueOnce([{ organizationId: 'org-a', role: { id: 'fixture-role', organizationId: 'org-a', permissions: ['account:roles:create', 'account:roles:update', 'account:roles:delete', 'account:roles:assign', 'account:users:create', 'account:users:update', 'account:users:status', 'account:users:transfer', 'account:users:reset'].map((code) => ({ permission: { code } })) } }]);
    await expect(service.update(actor, 'role-a', { permissionCodes: [], expectedPermissionCodes: [] }, 'trace', 'test-key-1'))
      .rejects.toMatchObject({ response: { code: 'ADMIN_SELF_LOCK_FORBIDDEN' } });
  });

  it('does not let a lower-privilege administrator strip existing higher-privilege roles', async () => {
    prisma.userRole.findMany.mockResolvedValueOnce(assignments).mockResolvedValueOnce([{ organizationId: 'org-a', role: { id: 'fixture-role', organizationId: 'org-a', permissions: [{ permission: { code: 'organization:read' } }] } }]);
    await expect(service.assign(actor, 'target-user', { roleIds: [] }, 'trace', 'test-key-1'))
      .rejects.toMatchObject({ response: { code: 'FEATURE_PERMISSION_DENIED' } });
    expect(prisma.userRole.deleteMany).not.toHaveBeenCalled();
  });
});
