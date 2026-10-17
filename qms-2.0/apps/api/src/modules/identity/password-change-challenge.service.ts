import { Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import type { User } from '../../generated/prisma/client.js';
import { PrismaService } from '../../database/prisma.service.js';
import { digest, securityError } from '../../common/security/session-security.js';
import type { AdminTransaction } from '../../common/security/admin-mutation.service.js';
import { PasswordService } from './password.service.js';
import { SessionService } from './session.service.js';
import { MfaService } from './mfa.service.js';
import { AuditLogService } from '../audit-log/audit-log.service.js';
import { replacePassword } from './password-credentials.js';
import type { LoginResponseDto } from './dto/login.dto.js';

export const PASSWORD_CHANGE_COOKIE = 'qms_password_change';

@Injectable()
export class PasswordChangeChallengeService {
  constructor(private readonly prisma: PrismaService, private readonly passwords: PasswordService, private readonly sessions: SessionService, private readonly mfa: MfaService, private readonly audit: AuditLogService) {}

  async create(user: User, transaction: AdminTransaction) {
    const token = randomBytes(32).toString('base64url');
    await transaction.passwordChangeChallenge.create({ data: { userId: user.id, organizationId: user.organizationId, credentialVersion: user.credentialVersion, tokenHash: digest(token), expiresAt: new Date(Date.now() + 300_000) } });
    return token;
  }

  private async authenticate(transaction: AdminTransaction, token: string | undefined) {
    if (!token) securityError('AUTH_PASSWORD_CHANGE_INVALID');
    const preliminary = await transaction.passwordChangeChallenge.findUnique({ where: { tokenHash: digest(token) } });
    if (!preliminary) securityError('AUTH_PASSWORD_CHANGE_INVALID');
    await transaction.$queryRaw`SELECT id FROM users WHERE id = ${preliminary.userId}::uuid FOR UPDATE`;
    const user = await transaction.user.findUnique({ where: { id: preliminary.userId }, include: { temporaryPassword: true } });
    if (!user) securityError('AUTH_PASSWORD_CHANGE_INVALID');
    await transaction.$queryRaw`SELECT id FROM organizations WHERE id = ${user.organizationId}::uuid FOR SHARE`;
    const organization = await transaction.organization.findUnique({ where: { id: user.organizationId } });
    const challenge = await transaction.passwordChangeChallenge.findUniqueOrThrow({ where: { id: preliminary.id } });
    if (challenge.consumedAt || challenge.expiresAt.getTime() <= Date.now() || challenge.credentialVersion !== user.credentialVersion || challenge.organizationId !== user.organizationId || !user.mustChangePassword || user.status !== 'ACTIVE' || organization?.status !== 'ACTIVE' || !user.temporaryPassword || user.temporaryPassword.credentialVersion !== user.credentialVersion || user.temporaryPassword.expiresAt.getTime() <= Date.now()) securityError('AUTH_PASSWORD_CHANGE_INVALID');
    return user;
  }

  async status(token: string | undefined): Promise<LoginResponseDto> {
    return this.prisma.$transaction(async (transaction) => {
      const user = await this.authenticate(transaction, token);
      return { accountType: user.accountType, securityState: 'PASSWORD_CHANGE_REQUIRED', landingPath: '/change-password' };
    });
  }

  async complete(token: string | undefined, newPassword: string, traceId: string): Promise<{ response: LoginResponseDto; sessionToken?: string; challengeToken?: string }> {
    return this.prisma.$transaction(async (transaction) => {
      const user = await this.authenticate(transaction, token);
      if (await this.passwords.verify(user.passwordHash, newPassword)) securityError('AUTH_PASSWORD_POLICY_INVALID', 400);
      const current = await replacePassword(transaction, user.id, await this.passwords.hash(newPassword));
      await transaction.session.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } });
      await this.audit.record({ actorUserId: user.id, organizationId: user.organizationId, action: 'PASSWORD_CHANGED', resourceType: 'User', resourceId: user.id, outcome: 'SUCCESS', traceId }, transaction);
      const challenge = await this.mfa.createChallenge(current, transaction);
      if (challenge) return { challengeToken: challenge.token, response: { accountType: user.accountType, securityState: challenge.enrollment ? 'MFA_ENROLLMENT_REQUIRED' : 'MFA_REQUIRED', landingPath: '/mfa' } };
      return { sessionToken: await this.sessions.create(user.id, transaction, { reauthenticated: true }), response: { accountType: user.accountType, securityState: 'AUTHENTICATED', landingPath: user.accountType === 'INTERNAL' ? '/app/workbench' : '/supplier/inbox' } };
    }, { timeout: 15000 });
  }

  async cancel(token: string | undefined) {
    if (!token) return;
    const challenge = await this.prisma.passwordChangeChallenge.findUnique({ where: { tokenHash: digest(token) } });
    if (!challenge) return;
    await this.prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`SELECT id FROM users WHERE id = ${challenge.userId}::uuid FOR UPDATE`;
      await transaction.passwordChangeChallenge.updateMany({ where: { id: challenge.id, consumedAt: null }, data: { consumedAt: new Date() } });
    });
  }
}
