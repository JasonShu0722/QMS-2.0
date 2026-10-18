import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { assertAdminAccess, type AdminActor } from '../../common/security/admin-mutation.service.js';
import { AuditLogService } from './audit-log.service.js';
import { AuditPageDto, AuditQueryDto } from './audit-query.dto.js';
import { auditActionLabel, auditActorSummary, auditEventReadSelect } from './audit-event-read-model.js';

@Injectable()
export class AuditQueryService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditLogService) {}

  async list(actor: AdminActor, query: AuditQueryDto): Promise<AuditPageDto> {
    const organizationId = query.organizationId ?? actor.organizationId;
    const pageSize = query.pageSize ?? 25;
    const from = query.from ? new Date(query.from) : undefined;
    const to = query.to ? new Date(query.to) : undefined;
    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100 || (from && !Number.isFinite(from.getTime())) || (to && !Number.isFinite(to.getTime())) || (from && to && from > to)) throw new BadRequestException();
    const cursor = this.cursor(query.cursor);
    return this.prisma.$transaction(async (transaction) => {
      await assertAdminAccess(transaction, actor, organizationId, 'audit:read');
      const where: Prisma.AuditEventWhereInput = {
        organizationId, actorUserId: query.actorUserId, action: query.action, resourceType: query.resourceType,
        resourceId: query.resourceId, outcome: query.outcome,
        ...(from || to ? { createdAt: { gte: from, lte: to } } : {}),
      };
      const [total, rows] = await Promise.all([
        transaction.auditEvent.count({ where }),
        transaction.auditEvent.findMany({ where: { AND: [where, ...(cursor ? [{ OR: [{ createdAt: { lt: cursor.createdAt } }, { createdAt: cursor.createdAt, id: { lt: cursor.id } }] }] : [])] }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: pageSize + 1, select: { ...auditEventReadSelect, metadata: true } }),
      ]);
      const more = rows.length > pageSize;
      const visible = rows.slice(0, pageSize);
      const last = visible.at(-1);
      return {
        total,
        items: visible.map((entry) => ({ id: entry.id, organizationId: entry.organizationId!, actorUserId: entry.actorUserId, action: entry.action, actionLabel: auditActionLabel(entry.action), actorSummary: auditActorSummary(entry), resourceType: entry.resourceType, resourceId: entry.resourceId, outcome: entry.outcome, traceId: entry.traceId, createdAt: entry.createdAt.toISOString(), metadata: this.audit.safeMetadata(entry.metadata && typeof entry.metadata === 'object' && !Array.isArray(entry.metadata) ? entry.metadata as Prisma.InputJsonObject : {}) })),
        nextCursor: more && last ? Buffer.from(JSON.stringify([last.createdAt.toISOString(), last.id])).toString('base64url') : null,
      };
    }, { isolationLevel: 'RepeatableRead' });
  }

  private cursor(value?: string): { createdAt: Date; id: string } | undefined {
    if (value === undefined) return undefined;
    try {
      if (!/^[A-Za-z0-9_-]{1,256}$/.test(value)) throw new Error();
      const decoded: unknown = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
      if (!Array.isArray(decoded) || decoded.length !== 2 || typeof decoded[0] !== 'string' || typeof decoded[1] !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(decoded[1])) throw new Error();
      const createdAt = new Date(decoded[0]);
      if (!Number.isFinite(createdAt.getTime()) || createdAt.toISOString() !== decoded[0]) throw new Error();
      return { createdAt, id: decoded[1] };
    } catch { throw new BadRequestException(); }
  }
}
