import type { AdminTransaction } from '../../common/security/admin-mutation.service.js';

export async function replacePassword(transaction: AdminTransaction, userId: string, passwordHash: string, mustChangePassword = false) {
  const user = await transaction.user.update({ where: { id: userId }, data: {
    passwordHash, mustChangePassword, credentialVersion: { increment: 1 }, securityVersion: { increment: 1 },
  } });
  const now = new Date();
  await transaction.userTemporaryPassword.deleteMany({ where: { userId } });
  await transaction.passwordChangeChallenge.updateMany({ where: { userId, consumedAt: null }, data: { consumedAt: now } });
  await transaction.passwordReset.updateMany({ where: { userId, consumedAt: null }, data: { consumedAt: now } });
  await transaction.mfaChallenge.updateMany({ where: { userId, consumedAt: null }, data: { consumedAt: now } });
  await transaction.emailVerification.updateMany({ where: { userId, consumedAt: null }, data: { consumedAt: now } });
  return user;
}
