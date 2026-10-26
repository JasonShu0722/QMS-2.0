import { BadRequestException, HttpException, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../database/prisma.service.js';
import { assertAdminAccess, type AdminActor, type AdminTransaction } from '../../common/security/admin-mutation.service.js';
import { assertActiveAuthentication, assertRecentAuthentication } from '../../common/security/session-security.js';
import { encryptSecret, decryptSecret } from '../../common/security/security-keyring.js';
import { AuditLogService } from './audit-log.service.js';
import { AuditExportContentDto, AuditExportDto, AuditExportRequestDto } from './audit-export.dto.js';
import { auditActionFilter, auditActionLabel, auditActorSummary, auditEventReadSelect } from './audit-event-read-model.js';

function csvCell(value: string | null) {
  const normalized = value ?? '';
  const safe = /^[\s\u0000-\u001f]*[=+@-]/.test(normalized) || /^[\t\r\n]/.test(normalized) ? `'${normalized}` : normalized;
  return `"${safe.replaceAll('"', '""')}"`;
}

@Injectable()
export class AuditExportService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditLogService) {}

  async create(actor: AdminActor, query: AuditExportRequestDto, traceId: string): Promise<AuditExportDto> {
    const organizationId = query.organizationId ?? actor.organizationId;
    const from = query.from ? new Date(query.from) : undefined;
    const to = query.to ? new Date(query.to) : undefined;
    if ((from && !Number.isFinite(from.getTime())) || (to && !Number.isFinite(to.getTime())) || (from && to && from > to)) throw new BadRequestException();
    return this.controlled(actor, traceId, async (transaction) => {
      await assertRecentAuthentication(transaction, actor);
      await assertAdminAccess(transaction, actor, organizationId, ['audit:read', 'audit:export']);
      const rows = await transaction.auditEvent.findMany({ where: { organizationId, actorUserId: query.actorUserId, ...auditActionFilter(query.action), resourceType: query.resourceType, resourceId: query.resourceId, outcome: query.outcome, ...(from || to ? { createdAt: { gte: from, lte: to } } : {}) }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 5001, select: auditEventReadSelect });
      if (rows.length > 5000) throw new HttpException({ code: 'EXPORT_TOO_LARGE', message: '请缩小导出筛选范围，最多 5000 条' }, 422);
      const settings = await transaction.platformSettings.findUnique({ where: { organizationId }, select: { exportRetentionMinutes: true } });
      const id = randomUUID();
      const expiresAt = new Date(Date.now() + (settings?.exportRetentionMinutes ?? 1440) * 60000);
      const csv = '\uFEFF' + [['id', 'createdAt', 'actorUserId', 'action', 'resourceType', 'resourceId', 'outcome', 'traceId', 'actionLabel', 'accountType', 'username', 'organizationName'].map(csvCell).join(','), ...rows.map((row) => {
        const summary = auditActorSummary(row);
        return [row.id, row.createdAt.toISOString(), row.actorUserId, row.action, row.resourceType, row.resourceId, row.outcome, row.traceId, auditActionLabel(row.action), summary?.accountType ?? null, summary?.username ?? null, summary?.organizationName ?? null].map(csvCell).join(',');
      })].join('\r\n');
      await transaction.exportArtifact.create({ data: { id, organizationId, createdById: actor.id, expiresAt, rowCount: rows.length, ciphertext: encryptSecret(csv, `export:${id}:${organizationId}:${actor.id}`) } });
      await this.audit.record({ organizationId, actorUserId: actor.id, action: 'AUDIT_EXPORT_CREATED', resourceType: 'ExportArtifact', resourceId: id, outcome: 'SUCCESS', traceId }, transaction);
      return { id, expiresAt: expiresAt.toISOString(), rowCount: rows.length, downloadPath: `/api/v1/admin/audit-exports/${id}?organizationId=${organizationId}` };
    });
  }

  async download(actor: AdminActor, organizationId: string, id: string, traceId: string): Promise<AuditExportContentDto> {
    return this.controlled(actor, traceId, async (transaction) => {
      await assertActiveAuthentication(transaction, actor);
      await assertAdminAccess(transaction, actor, organizationId, ['audit:read', 'audit:export']);
      const artifact = await transaction.exportArtifact.findFirst({ where: { id, organizationId, createdById: actor.id } });
      if (!artifact) throw new HttpException({ code: 'EXPORT_NOT_FOUND', message: '导出记录不存在' }, 404);
      if (artifact.expiresAt.getTime() <= Date.now() || !artifact.ciphertext) throw new HttpException({ code: 'EXPORT_EXPIRED', message: '导出已过期，请重新生成' }, 410);
      const content = decryptSecret(artifact.ciphertext, `export:${id}:${organizationId}:${actor.id}`);
      await this.audit.record({ organizationId, actorUserId: actor.id, action: 'AUDIT_EXPORT_DOWNLOADED', resourceType: 'ExportArtifact', resourceId: id, outcome: 'SUCCESS', traceId }, transaction);
      return { filename: `qms-audit-${id}.csv`, contentType: 'text/csv;charset=utf-8', content };
    });
  }

  async purgeExpired() {
    return this.prisma.$executeRaw`UPDATE export_artifacts SET ciphertext = NULL WHERE id IN (SELECT id FROM export_artifacts WHERE expires_at <= NOW() AND ciphertext IS NOT NULL ORDER BY expires_at LIMIT 100 FOR UPDATE SKIP LOCKED)`;
  }

  private async controlled<Result>(actor: AdminActor, traceId: string, work: (transaction: AdminTransaction) => Promise<Result>): Promise<Result> {
    try { return await this.prisma.$transaction(work, { isolationLevel: 'RepeatableRead' }); }
    catch (error) {
      if (error instanceof HttpException) await this.audit.record({ organizationId: actor.organizationId, actorUserId: actor.id, action: 'AUDIT_EXPORT_DENIED', resourceType: 'ExportArtifact', outcome: 'DENIED', traceId, metadata: { reasonCode: (error.getResponse() as { code?: string }).code } });
      throw error;
    }
  }
}
