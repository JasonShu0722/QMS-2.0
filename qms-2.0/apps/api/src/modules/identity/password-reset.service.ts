import { Injectable } from '@nestjs/common';
import { createHash, timingSafeEqual } from 'node:crypto';
import { PrismaService } from '../../database/prisma.service.js';
import { adminError, type AdminTransaction } from '../../common/security/admin-mutation.service.js';
import { PasswordService } from './password.service.js';
import { AuditLogService } from '../audit-log/audit-log.service.js';
import type { CompletePasswordResetDto } from './dto/admin-user.dto.js';
import { isSecurityConcurrencyConflict } from '../../common/security/session-security.js';
import { replacePassword } from './password-credentials.js';

@Injectable()
export class PasswordResetService {
  constructor(private readonly prisma: PrismaService, private readonly passwords: PasswordService, private readonly audit: AuditLogService) {}

  async issue(transaction: AdminTransaction, userId: string, temporaryCode: string) {
    const now = new Date();
    await transaction.passwordReset.updateMany({ where: { userId, consumedAt: null }, data: { consumedAt: now } });
    const reset = await transaction.passwordReset.create({ data: { userId, codeHash: this.hash(temporaryCode), expiresAt: new Date(now.getTime() + 30 * 60_000) }, select: { id: true, expiresAt: true } });
    return { resetId: reset.id, expiresAt: reset.expiresAt.toISOString() };
  }

  async complete(dto: CompletePasswordResetDto, traceId: string): Promise<void> {
    try {
      await this.prisma.$transaction(async (transaction) => {
        const preliminary = await transaction.passwordReset.findUnique({ where: { id: dto.resetId }, select: { userId: true } });
        if (!preliminary) adminError('AUTH_PASSWORD_RESET_INVALID', 400);
        await transaction.$queryRaw`SELECT id FROM users WHERE id = ${preliminary.userId}::uuid FOR UPDATE`;
        const reset = await transaction.passwordReset.findUnique({ where: { id: dto.resetId }, include: { user: { select: { status: true, organizationId: true } } } });
        const now = new Date();
        if (!reset || reset.consumedAt || reset.expiresAt <= now || reset.user.status !== 'ACTIVE' || !timingSafeEqual(Buffer.from(reset.codeHash), Buffer.from(this.hash(dto.temporaryCode)))) adminError('AUTH_PASSWORD_RESET_INVALID', 400);
        const passwordHash = await this.passwords.hash(dto.newPassword);
        const consumed = await transaction.passwordReset.updateMany({ where: { id: reset.id, consumedAt: null, expiresAt: { gt: new Date() } }, data: { consumedAt: new Date() } });
        if (consumed.count !== 1) adminError('AUTH_PASSWORD_RESET_INVALID', 400);
        await replacePassword(transaction, reset.userId, passwordHash);
        await transaction.session.updateMany({ where: { userId: reset.userId, revokedAt: null }, data: { revokedAt: new Date() } });
        await this.audit.record({ actorUserId: reset.userId, organizationId: reset.user.organizationId, action: 'PASSWORD_RESET', resourceType: 'User', resourceId: reset.userId, outcome: 'SUCCESS', traceId }, transaction);
      }, { isolationLevel: 'Serializable' });
    } catch (error) {
      if (isSecurityConcurrencyConflict(error)) adminError('AUTH_PASSWORD_RESET_INVALID', 400);
      throw error;
    }
  }

  private hash(value: string) { return createHash('sha256').update(value).digest('hex'); }
}
