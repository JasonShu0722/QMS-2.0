import { jest } from '@jest/globals';
import { HttpException } from '@nestjs/common';
import { IdentityService } from '../../src/modules/identity/identity.service.js';

describe('account center service', () => {
  const prisma = {
    user: {
      findUnique: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    passwordReset: { updateMany: jest.fn() },
    $transaction: jest.fn(),
  };
  const passwords = {
    verify: jest.fn(),
    hash: jest.fn(),
    verifyUnknown: jest.fn(),
  };
  const sessions = {
    listForUser: jest.fn(),
    revokeSession: jest.fn(),
    revokeOtherSessions: jest.fn(),
  };
  const limits = { key: jest.fn(), recordSuccess: jest.fn(), recordFailure: jest.fn() };
  const audit = { record: jest.fn() };

  const service = new IdentityService(
    prisma as never,
    passwords as never,
    sessions as never,
    limits as never,
    audit as never,
  );

  beforeEach(() => jest.clearAllMocks());

  it('returns a safe profile without the password hash', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'user-1', username: 'alice', email: 'alice@example.test', accountType: 'INTERNAL',
      status: 'ACTIVE', mfaEnabled: false, organizationId: 'org-1',
      organization: { code: 'internal', name: 'Internal' },
    });

    await expect(service.profile('user-1')).resolves.toEqual({
      id: 'user-1', username: 'alice', email: 'alice@example.test', accountType: 'INTERNAL',
      status: 'ACTIVE', mfaEnabled: false, organization: { id: 'org-1', code: 'internal', name: 'Internal' },
    });
    expect(JSON.stringify(await service.profile('user-1'))).not.toMatch(/passwordHash/i);
  });

  it('rejects a wrong current password before changing credentials', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'user-1', passwordHash: 'encoded', organizationId: 'org-1' });
    passwords.verify.mockResolvedValue(false);

    await expect(service.changePassword({
      userId: 'user-1', currentSessionId: 'session-1', currentPassword: 'wrong', newPassword: 'new-password-123', traceId: 'trace-1',
    })).rejects.toMatchObject({ response: { code: 'AUTH_CURRENT_PASSWORD_INVALID' } });
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('changes the password and revokes other sessions atomically', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'user-1', passwordHash: 'encoded', organizationId: 'org-1' });
    passwords.verify.mockResolvedValue(true);
    passwords.hash.mockResolvedValue('new-encoded');
    prisma.$transaction.mockImplementation(async (work: (transaction: unknown) => Promise<unknown>) => work({
      user: { updateMany: prisma.user.updateMany },
      passwordReset: prisma.passwordReset,
    }));

    prisma.user.updateMany.mockResolvedValue({ count: 1 });
    await service.changePassword({
      userId: 'user-1', currentSessionId: 'session-1', currentPassword: 'old-password', newPassword: 'new-password-123', traceId: 'trace-1',
    });

    expect(prisma.user.updateMany).toHaveBeenCalledWith({ where: { id: 'user-1', passwordHash: 'encoded', status: 'ACTIVE' }, data: { passwordHash: 'new-encoded' } });
    expect(sessions.revokeOtherSessions).toHaveBeenCalledWith('user-1', 'session-1', 'trace-1', expect.anything());
  });

  it('rejects a missing profile with the controlled contract error', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    await expect(service.profile('missing')).rejects.toBeInstanceOf(HttpException);
  });

  it('updates profile and audit through the same transaction', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'user-1', organization: { id: 'org-1', code: 'internal', name: 'Internal' } });
    prisma.user.update.mockResolvedValue({ id: 'user-1', organization: { id: 'org-1', code: 'internal', name: 'Internal' } });
    prisma.$transaction.mockImplementation(async (work: (transaction: unknown) => Promise<unknown>) => work(prisma));
    await service.updateProfile('user-1', { email: 'new@example.test' }, 'trace-1');
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'PROFILE_UPDATED' }), prisma);
  });

  it('rejects password verification superseded by another password change', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'user-1', passwordHash: 'encoded', organizationId: 'org-1' });
    passwords.verify.mockResolvedValue(true);
    passwords.hash.mockResolvedValue('new-encoded');
    prisma.user.updateMany.mockResolvedValue({ count: 0 });
    prisma.$transaction.mockImplementation(async (work: (transaction: unknown) => Promise<unknown>) => work(prisma));
    await expect(service.changePassword({ userId: 'user-1', currentSessionId: 'session-1', currentPassword: 'old-password', newPassword: 'new-password-123', traceId: 'trace-1' })).rejects.toMatchObject({ response: { code: 'CONCURRENCY_CONFLICT' } });
    expect(sessions.revokeOtherSessions).not.toHaveBeenCalled();
  });
});
