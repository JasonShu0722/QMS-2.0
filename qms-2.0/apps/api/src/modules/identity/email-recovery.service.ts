import { HttpException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';
import { assertRecentAuthentication, digest, isSecurityConcurrencyConflict, securityError } from '../../common/security/session-security.js';
import { encryptSecret } from '../../common/security/security-keyring.js';
import { AuditLogService } from '../audit-log/audit-log.service.js';
import { PasswordService } from './password.service.js';
import { RecoveryMailService, type RecoveryPurpose } from './recovery-mail.service.js';
import type { PasswordRecoveryDto } from './dto/email-recovery.dto.js';

@Injectable()
export class EmailRecoveryService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditLogService, private readonly passwords: PasswordService, private readonly mail: RecoveryMailService) {}

  private assertConfigured() {
    this.mail.configuration();
    encryptSecret('configuration-check', 'recovery-mail:configuration-check');
  }

  async requestVerification(sessionToken: string | undefined, traceId: string) {
    return this.controlled(traceId, 'EMAIL_VERIFICATION_REQUESTED', async () => {
      this.assertConfigured();
      if (!sessionToken) securityError('AUTH_SESSION_REQUIRED');
      await this.prisma.$transaction(async (transaction) => {
        const session = await transaction.session.findUnique({ where: { tokenHash: digest(sessionToken) } });
        if (!session) securityError('AUTH_SESSION_REQUIRED');
        const { user } = await assertRecentAuthentication(transaction, { id: session.userId, sessionId: session.id });
        if (!user.email) securityError('AUTH_EMAIL_REQUIRED', 400);
        await this.mail.enqueue(transaction, user, 'VERIFY_EMAIL');
        await this.audit.record({ actorUserId: user.id, organizationId: user.organizationId, action: 'EMAIL_VERIFICATION_REQUESTED', resourceType: 'User', resourceId: user.id, outcome: 'SUCCESS', traceId }, transaction);
      });
    });
  }

  async requestRecovery(dto: PasswordRecoveryDto, traceId: string) {
    return this.controlled(traceId, 'PASSWORD_RECOVERY_REQUESTED', async () => {
      this.assertConfigured();
      await this.prisma.$transaction(async (transaction) => {
        const identifier = dto.identifier.trim();
        const candidates = await transaction.user.findMany({ where: { ...(identifier.includes('@') ? { email: { equals: identifier, mode: 'insensitive' } } : { username: { equals: identifier, mode: 'insensitive' } }), ...(dto.organizationCode ? { organization: { code: { equals: dto.organizationCode.trim(), mode: 'insensitive' } } } : {}) }, take: 2 });
        if (candidates.length === 1) {
          const candidate = candidates[0]!;
          await transaction.$queryRaw`SELECT id FROM users WHERE id = ${candidate.id}::uuid FOR UPDATE`;
          await transaction.$queryRaw`SELECT id FROM organizations WHERE id = ${candidate.organizationId}::uuid FOR SHARE`;
          const user = await transaction.user.findUnique({ where: { id: candidate.id }, include: { organization: true } });
          if (user && user.organizationId === candidate.organizationId && user.email === candidate.email && user.username === candidate.username && user.status === 'ACTIVE' && user.organization.status === 'ACTIVE' && user.emailVerifiedAt && user.email) await this.mail.enqueue(transaction, user, 'PASSWORD_RECOVERY');
        }
        await this.audit.record({ action: 'PASSWORD_RECOVERY_REQUESTED', resourceType: 'Authentication', outcome: 'SUCCESS', traceId }, transaction);
      });
    });
  }

  async complete(token: string, purpose: RecoveryPurpose, traceId: string, newPassword?: string) {
    return this.controlled(traceId, purpose === 'VERIFY_EMAIL' ? 'EMAIL_VERIFIED' : 'PASSWORD_RECOVERED', async () => {
      await this.prisma.$transaction(async (transaction) => {
        const preliminary = await transaction.emailVerification.findUnique({ where: { tokenHash: digest(token) } });
        if (!preliminary) securityError('AUTH_RECOVERY_INVALID', 400);
        await transaction.$queryRaw`SELECT id FROM users WHERE id = ${preliminary.userId}::uuid FOR UPDATE`;
        const verification = await transaction.emailVerification.findUnique({ where: { id: preliminary.id }, include: { user: true } });
        if (!verification) securityError('AUTH_RECOVERY_INVALID', 400);
        const user = verification.user;
        await transaction.$queryRaw`SELECT id FROM organizations WHERE id = ${user.organizationId}::uuid FOR SHARE`;
        const organization = await transaction.organization.findUnique({ where: { id: user.organizationId } });
        const now = new Date();
        if (verification.purpose !== purpose || verification.consumedAt || verification.expiresAt <= now || user.email !== verification.email || user.securityVersion !== verification.securityVersion || user.status !== 'ACTIVE' || organization?.status !== 'ACTIVE' || (purpose === 'PASSWORD_RECOVERY' && !user.emailVerifiedAt)) securityError('AUTH_RECOVERY_INVALID', 400);
        if (purpose === 'VERIFY_EMAIL') {
          await transaction.user.update({ where: { id: user.id }, data: { emailVerifiedAt: now } });
          await transaction.emailVerification.updateMany({ where: { userId: user.id, purpose, consumedAt: null }, data: { consumedAt: now } });
        } else {
          if (!newPassword || newPassword.length < 12 || newPassword.length > 128) securityError('AUTH_PASSWORD_POLICY_INVALID', 400);
          const passwordHash = await this.passwords.hash(newPassword);
          const consumed = await transaction.emailVerification.updateMany({ where: { id: verification.id, consumedAt: null, expiresAt: { gt: new Date() } }, data: { consumedAt: new Date() } });
          if (consumed.count !== 1) securityError('AUTH_RECOVERY_INVALID', 400);
          await transaction.user.update({ where: { id: user.id }, data: { passwordHash, securityVersion: { increment: 1 } } });
          await transaction.session.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: now } });
          await transaction.mfaChallenge.updateMany({ where: { userId: user.id, consumedAt: null }, data: { consumedAt: now } });
          await transaction.passwordReset.updateMany({ where: { userId: user.id, consumedAt: null }, data: { consumedAt: now } });
          await transaction.emailVerification.updateMany({ where: { userId: user.id, consumedAt: null }, data: { consumedAt: now } });
        }
        await this.audit.record({ actorUserId: user.id, organizationId: user.organizationId, action: purpose === 'VERIFY_EMAIL' ? 'EMAIL_VERIFIED' : 'PASSWORD_RECOVERED', resourceType: 'User', resourceId: user.id, outcome: 'SUCCESS', traceId }, transaction);
      }, { timeout: 15000 });
    });
  }

  private async controlled(traceId: string, action: string, operation: () => Promise<void>) {
    try { return await operation(); }
    catch (error) {
      const code = error instanceof HttpException ? (error.getResponse() as { code?: string }).code ?? 'AUTH_RECOVERY_UNAVAILABLE' : isSecurityConcurrencyConflict(error) ? 'AUTH_RECOVERY_INVALID' : 'AUTH_RECOVERY_UNAVAILABLE';
      await this.audit.record({ action, resourceType: 'Authentication', outcome: 'DENIED', traceId, metadata: { reasonCode: code } });
      if (error instanceof HttpException) throw error;
      securityError(code, code === 'AUTH_RECOVERY_INVALID' ? 400 : 503);
    }
  }
}
