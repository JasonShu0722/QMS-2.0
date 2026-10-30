import { BadRequestException, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { isUUID } from 'class-validator';
import { PrismaService } from '../../database/prisma.service.js';
import { adminError, assertAdminAccess, type AdminActor } from '../../common/security/admin-mutation.service.js';
import { hasPlatformAdministrator } from '../../common/security/platform-administrator.js';

export const SERVICE_RECEIPT_RETENTION_MS = 7 * 86400000;
export const PDF_RECEIPT_DOMAINS = ['process-quality', 'customer-quality', 'new-product-quality', 'supplier-quality'] as const;
export type OperationStatus = 'STARTED' | 'SUCCEEDED' | 'FAILED' | 'STOPPED';
type Counts = { processed: number; failed: number; retried: number };

@Injectable()
export class ServiceOperationReceiptService {
  constructor(private readonly prisma: PrismaService) {}

  async recordWorker(producerId: string, status: OperationStatus, startedAt: Date, counts?: Counts): Promise<boolean> {
    return this.record(`worker:${producerId}`, 'UNSCOPED', 'WORKER', null, producerId, status, startedAt, counts);
  }

  async recordPdf(organizationId: string, domainCode: string, executionId: string, status: OperationStatus, startedAt: Date): Promise<boolean> {
    if (!isUUID(organizationId) || !(PDF_RECEIPT_DOMAINS as readonly string[]).includes(domainCode)) throw new BadRequestException('Invalid operation observation.');
    return this.record(`pdf:${organizationId.toLowerCase()}:${domainCode}`, organizationId.toLowerCase(), 'PDF', domainCode, executionId, status, startedAt);
  }

  private async record(identityKey: string, scopeKey: string, operation: 'WORKER' | 'PDF', domainCode: string | null, producerId: string, status: OperationStatus, startedAt: Date, counts?: Counts): Promise<boolean> {
    if (!isUUID(producerId) || !['STARTED', 'SUCCEEDED', 'FAILED', 'STOPPED'].includes(status) || !(startedAt instanceof Date) || !Number.isFinite(startedAt.getTime())
      || counts && Object.values(counts).some(value => !Number.isInteger(value) || value < 0 || value > 1000000)) throw new BadRequestException('Invalid operation observation.');
    const now = new Date();
    const completedAt = status === 'STARTED' ? null : now;
    const durationMs = completedAt ? Math.min(86400000, Math.max(0, now.getTime() - startedAt.getTime())) : null;
    const reasonCode = status === 'FAILED' ? operation === 'PDF' ? 'PDF_RENDER_FAILED' : 'WORKER_EXECUTION_FAILED' : null;
    try {
      await this.prisma.$transaction(async tx => {
        await tx.$executeRaw`SET LOCAL statement_timeout = '500ms'`;
        await tx.$executeRaw`
        INSERT INTO service_operation_receipts
          (id, identity_key, scope_key, operation, domain_code, producer_id, status, started_at, completed_at, observed_at, duration_ms, processed, retried, failed, reason_code)
        VALUES (${randomUUID()}::uuid, ${identityKey}, ${scopeKey}, ${operation}, ${domainCode}, ${producerId}::uuid, ${status}, ${startedAt}, ${completedAt}, ${now}, ${durationMs}, ${counts?.processed ?? null}, ${counts?.retried ?? null}, ${counts?.failed ?? null}, ${reasonCode})
        ON CONFLICT (identity_key) DO UPDATE SET
          scope_key = EXCLUDED.scope_key, operation = EXCLUDED.operation, domain_code = EXCLUDED.domain_code,
          producer_id = EXCLUDED.producer_id, status = EXCLUDED.status, started_at = EXCLUDED.started_at,
          completed_at = EXCLUDED.completed_at, observed_at = EXCLUDED.observed_at, duration_ms = EXCLUDED.duration_ms,
          processed = EXCLUDED.processed, retried = EXCLUDED.retried, failed = EXCLUDED.failed, reason_code = EXCLUDED.reason_code
        WHERE (EXCLUDED.operation = 'WORKER' AND service_operation_receipts.observed_at <= EXCLUDED.observed_at)
          OR (EXCLUDED.operation = 'PDF' AND (service_operation_receipts.started_at < EXCLUDED.started_at
            OR (service_operation_receipts.started_at = EXCLUDED.started_at AND ((service_operation_receipts.producer_id = EXCLUDED.producer_id
              AND (service_operation_receipts.status = 'STARTED' OR EXCLUDED.status <> 'STARTED'))
              OR service_operation_receipts.producer_id::text < EXCLUDED.producer_id::text))))`;
      }, { maxWait: 250, timeout: 1000 });
      return true;
    } catch { return false; }
  }

  async read(actor: AdminActor, organizationId: string, platform: boolean) {
    if (actor.accountType !== 'INTERNAL') adminError('FEATURE_PERMISSION_DENIED', 403);
    return this.prisma.$transaction(async tx => {
      await assertAdminAccess(tx, actor, organizationId, 'console:services:read');
      if (platform && !await hasPlatformAdministrator(tx, actor.id)) adminError('ORGANIZATION_SCOPE_DENIED', 403);
      const cutoff = new Date(Date.now() - SERVICE_RECEIPT_RETENTION_MS);
      const select = { operation: true, domainCode: true, status: true, startedAt: true, completedAt: true, observedAt: true, durationMs: true, processed: true, retried: true, failed: true, reasonCode: true } as const;
      const pdf = await tx.serviceOperationReceipt.findMany({ where: { observedAt: { gte: cutoff }, operation: 'PDF', scopeKey: organizationId },
        orderBy: [{ observedAt: 'desc' }, { id: 'asc' }], take: 4, select });
      const worker = platform ? await tx.serviceOperationReceipt.findMany({ where: { observedAt: { gte: cutoff }, operation: 'WORKER', scopeKey: 'UNSCOPED' },
        orderBy: [{ observedAt: 'desc' }, { id: 'asc' }], take: 1, select }) : [];
      return [...pdf, ...worker];
    });
  }

  async purgeExpired(now = new Date()): Promise<number> {
    if (!Number.isFinite(now.getTime())) throw new BadRequestException('Invalid retention clock.');
    const cutoff = new Date(now.getTime() - SERVICE_RECEIPT_RETENTION_MS);
    return this.prisma.$executeRaw`WITH expired AS MATERIALIZED (
      SELECT id FROM service_operation_receipts WHERE observed_at < ${cutoff} ORDER BY observed_at, id LIMIT 1000 FOR UPDATE SKIP LOCKED
    ) DELETE FROM service_operation_receipts receipt USING expired WHERE receipt.id = expired.id`;
  }
}
