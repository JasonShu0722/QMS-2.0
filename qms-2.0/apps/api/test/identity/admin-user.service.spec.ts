import { jest } from '@jest/globals';
import { HttpException } from '@nestjs/common';
import { AdminMutationService } from '../../src/common/security/admin-mutation.service.js';
import { PasswordResetService } from '../../src/modules/identity/password-reset.service.js';
import { AdminUserService } from '../../src/modules/identity/admin-user.service.js';

describe('admin user lifecycle service', () => {
  const prisma = {
    user: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    organization: { findUnique: jest.fn() },
    userRole: { findMany: jest.fn(), deleteMany: jest.fn() },
    adminMutation: { findUnique: jest.fn(), create: jest.fn() },
    passwordReset: { updateMany: jest.fn(), create: jest.fn() },
    session: { updateMany: jest.fn(), findFirst: jest.fn() },
    problemIndex: { count: jest.fn() },
    workflowTask: { count: jest.fn() },
    notification: { count: jest.fn() },
    userPosition: { count: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
    $transaction: jest.fn(),
    $queryRaw: jest.fn(),
  };
  const passwords = { hash: jest.fn() };
  const audit = { record: jest.fn() };
  const service = new AdminUserService(prisma as never, passwords as never, audit as never, new AdminMutationService(prisma as never, audit as never), new PasswordResetService(prisma as never, passwords as never, audit as never), {} as never);
  const actor = { id: 'admin-1', sessionId: 'session-admin', organizationId: 'org-a', accountType: 'INTERNAL' as const };

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.session.findFirst.mockResolvedValue({ id: actor.sessionId, mfaVerifiedAt: new Date(), reauthenticatedAt: new Date() });
    prisma.user.findUnique.mockResolvedValue({ ...actor, status: 'ACTIVE', organization: { status: 'ACTIVE' } });
    prisma.adminMutation.findUnique.mockResolvedValue(null);
    prisma.userRole.findMany.mockImplementation(async (args: { where: { userId: string } }) => args.where.userId === actor.id ? [{ organizationId: actor.organizationId, role: { permissions: ['account:users:read', 'account:users:create', 'account:users:update', 'account:users:status', 'account:users:transfer', 'account:users:reset'].map((code) => ({ permission: { code } })) } }] : []);
    prisma.$transaction.mockImplementation(async (work: (tx: typeof prisma) => Promise<unknown>) => work(prisma));
    prisma.organization.findUnique.mockResolvedValue({ id: 'org-a', type: 'INTERNAL', code: 'A', name: 'Org A', status: 'ACTIVE' });
    passwords.hash.mockResolvedValue('hashed-password');
    prisma.problemIndex.count.mockResolvedValue(0);
    prisma.workflowTask.count.mockResolvedValue(0);
    prisma.notification.count.mockResolvedValue(0);
    prisma.userPosition.count.mockResolvedValue(0);
  });

  it('lists only users inside the server-authorized organization scope', async () => {
    prisma.user.findMany.mockResolvedValue([]);
    await service.list(actor, { organizationId: 'org-a' });
    expect(prisma.user.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { organizationId: 'org-a' } }));
  });

  it('rejects a supplier actor from creating a user in another organization', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'supplier-1', organizationId: 'supplier-a', accountType: 'SUPPLIER', status: 'ACTIVE', organization: { status: 'ACTIVE' } });
    await expect(service.create(
      { id: 'supplier-1', sessionId: 'session-supplier', organizationId: 'supplier-a', accountType: 'SUPPLIER' },
      { organizationId: 'supplier-b', username: 'bob', accountType: 'SUPPLIER', initialPassword: 'password-1234' },
      'trace-1', 'test-key-1',
    )).rejects.toMatchObject({ response: { code: 'ORGANIZATION_SCOPE_DENIED' } });
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it('creates a user with a password hash and audit in one transaction', async () => {
    prisma.user.create.mockResolvedValue({ id: 'user-2', organizationId: 'org-a', username: 'bob', email: null, accountType: 'INTERNAL', status: 'ACTIVE', mfaEnabled: false, organization: { id: 'org-a', code: 'A', name: 'Org A' } });
    const result = await service.create(actor, { organizationId: 'org-a', username: 'bob', accountType: 'INTERNAL', initialPassword: 'password-1234' }, 'trace-1', 'test-key-1');
    expect(result).toMatchObject({ id: 'user-2', username: 'bob' });
    expect(prisma.user.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ passwordHash: 'hashed-password' }) }));
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'USER_CREATED', resourceId: 'user-2' }), prisma);
  });

  it('updates status and organization within the authorized scope', async () => {
    prisma.user.findFirst.mockResolvedValue({ id: 'user-2', organizationId: 'org-a', username: 'bob', accountType: 'INTERNAL' });
    prisma.user.update.mockResolvedValue({ id: 'user-2', organizationId: 'org-a', username: 'bob', email: 'b@example.test', accountType: 'INTERNAL', status: 'DISABLED', mfaEnabled: false, organization: { id: 'org-a', code: 'A', name: 'Org A' } });
    const result = await service.update(actor, 'user-2', { status: 'DISABLED', email: 'b@example.test' }, 'org-a', 'trace-1', 'test-key-1');
    expect(result.status).toBe('DISABLED');
    expect(prisma.session.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: 'user-2', revokedAt: null } }));
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'USER_UPDATED' }), prisma);
  });

  it('does not allow an administrator to disable their own account', async () => {
    prisma.user.findFirst.mockResolvedValue({ ...actor });
    await expect(service.update(actor, actor.id, { status: 'DISABLED' }, 'org-a', 'trace-1', 'test-key-1'))
      .rejects.toMatchObject({ response: { code: 'ADMIN_SELF_DISABLE_FORBIDDEN' } });
  });

  it('issues a hashed one-time reset without changing the password or sessions', async () => {
    prisma.user.findFirst.mockResolvedValue({ id: 'user-2', organizationId: 'org-a', username: 'bob' });
    prisma.passwordReset.create.mockResolvedValue({ id: 'reset-id', expiresAt: new Date() });
    const result = await service.resetPassword(actor, 'user-2', 'temporary-code-at-least-32-characters', 'org-a', 'trace-1', 'test-key-1');
    expect(result).toHaveProperty('resetId', 'reset-id');
    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(prisma.session.updateMany).not.toHaveBeenCalled();
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'PASSWORD_RESET_ISSUED', resourceId: 'user-2' }), prisma);
  });

  it('returns a controlled not-found error for another organization', async () => {
    prisma.user.findFirst.mockResolvedValue(null);
    await expect(service.detail(actor, 'user-b', 'org-a')).rejects.toBeInstanceOf(HttpException);
  });

  it('maps a reference created during an organization transfer to an audited conflict', async () => {
    prisma.userRole.findMany.mockImplementation(async (args: { where: { userId: string } }) => args.where.userId === actor.id ? [{ organizationId: actor.organizationId, role: { permissions: [{ permission: { code: 'account:users:transfer' } }] } }] : []);
    prisma.user.findFirst.mockResolvedValue({ id: 'user-2', organizationId: 'org-a', accountType: 'INTERNAL' });
    prisma.user.update.mockRejectedValueOnce({ code: 'P2003' });
    await expect(service.update(actor, 'user-2', { organizationId: 'org-b' }, 'org-a', 'trace-transfer', 'transfer-key'))
      .rejects.toMatchObject({ status: 409, response: { code: 'ADMIN_USER_ORGANIZATION_IN_USE' } });
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'ACTION_REJECTED', traceId: 'trace-transfer', metadata: expect.objectContaining({ reasonCode: 'ADMIN_USER_ORGANIZATION_IN_USE' }) }));
  });

  it('preserves ended appointment history when an administrator attempts a user transfer', async () => {
    prisma.user.findFirst.mockResolvedValue({ id: 'user-2', organizationId: 'org-a', accountType: 'INTERNAL' });
    prisma.userPosition.count.mockResolvedValue(1);
    await expect(service.update(actor, 'user-2', { organizationId: 'org-b' }, 'org-a', 'trace-history', 'history-key'))
      .rejects.toMatchObject({ status: 409, response: { code: 'ADMIN_USER_ORGANIZATION_IN_USE' } });
    expect(prisma.user.update).not.toHaveBeenCalled();
  });
});
