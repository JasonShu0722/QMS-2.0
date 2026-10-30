import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';
import { adminError, assertAdminAccess, type AdminActor } from '../../common/security/admin-mutation.service.js';
import { RecoveryMailService } from './recovery-mail.service.js';

@Injectable()
export class MailOperationsReadService {
  constructor(private readonly prisma: PrismaService, private readonly mail: RecoveryMailService) {}
  async read(actor: AdminActor, organizationId: string) {
    if (actor.accountType !== 'INTERNAL') adminError('FEATURE_PERMISSION_DENIED', 403);
    let configured = false;
    try { this.mail.configuration(); configured = true; } catch { /* Configuration alone never proves delivery. */ }
    return this.prisma.$transaction(async tx => {
      await assertAdminAccess(tx, actor, organizationId, 'console:services:read');
      const scope = { verification: { user: { organizationId } } };
      const [pending, processing, failed, succeeded, latest] = await Promise.all([
        tx.recoveryDelivery.count({ where: { ...scope, status: 'PENDING' } }),
        tx.recoveryDelivery.count({ where: { ...scope, status: 'PROCESSING' } }),
        tx.recoveryDelivery.count({ where: { ...scope, status: 'FAILED' } }),
        tx.recoveryDelivery.count({ where: { ...scope, status: 'SENT' } }),
        tx.recoveryDelivery.findFirst({ where: { ...scope, status: 'SENT', sentAt: { not: null } }, orderBy: [{ sentAt: 'desc' }, { id: 'asc' }], select: { sentAt: true } }),
      ]);
      return { configured, counts: { pending, processing, failed, succeeded }, latest: latest?.sentAt ? { observedAt: latest.sentAt.toISOString(), status: 'SUCCEEDED' as const } : null };
    });
  }
}
