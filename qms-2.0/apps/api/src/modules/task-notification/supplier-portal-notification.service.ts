import { Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../database/prisma.service.js';
import { assertActiveAuthentication } from '../../common/security/session-security.js';
import { AuditLogService } from '../audit-log/audit-log.service.js';
import { assertWorkflowFeature, type WorkflowActor } from '../workflow/workflow-access-policy.js';
import { workflowError } from '../workflow/workflow-runtime-policy.js';
import { inboxPage } from './task.service.js';
import { supplierPortalNotificationScope } from './supplier-portal-notification.js';
import type { SupplierPortalNotificationDto, SupplierPortalNotificationPageDto, SupplierPortalNotificationQueryDto } from './supplier-portal-notification.dto.js';

const fields = Prisma.sql`portal_notice.id, supplier_problem.id AS "problemId", task.id AS "taskId", problem.report_number AS "reportNumber",
  node.name AS "nodeName", portal_notice.kind, portal_notice.subject, portal_notice.body, portal_notice.version,
  portal_notice.read_at AS "readAt", portal_notice.created_at AS "createdAt"`;

@Injectable()
export class SupplierPortalNotificationService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditLogService) {}

  private async access(transaction: Prisma.TransactionClient, actor: WorkflowActor) {
    if (actor.accountType !== 'SUPPLIER') workflowError('ORGANIZATION_SCOPE_DENIED', 403);
    await assertActiveAuthentication(transaction, actor);
    await assertWorkflowFeature(transaction, actor, actor.organizationId, 'notification:read');
    await assertWorkflowFeature(transaction, actor, actor.organizationId, 'supplier-quality:responses:read');
  }

  async list(actor: WorkflowActor, query: SupplierPortalNotificationQueryDto): Promise<SupplierPortalNotificationPageDto> {
    const { pageSize, offset } = inboxPage(query);
    return this.prisma.$transaction(async (transaction) => {
      await this.access(transaction, actor);
      const [page] = await transaction.$queryRaw<SupplierPortalNotificationPageDto[]>(Prisma.sql`
        WITH eligible AS MATERIALIZED (SELECT ${fields} ${supplierPortalNotificationScope(actor.id, actor.organizationId)}),
        selected AS (SELECT * FROM eligible ORDER BY "createdAt" DESC, id DESC LIMIT ${pageSize} OFFSET ${offset})
        SELECT (SELECT count(*)::int FROM eligible) AS total,
          COALESCE((SELECT jsonb_agg(selected ORDER BY "createdAt" DESC, id DESC) FROM selected), '[]'::jsonb) AS items`);
      return page!;
    }, { isolationLevel: 'ReadCommitted' });
  }

  async read(actor: WorkflowActor, id: string, expectedVersion: number, traceId: string): Promise<SupplierPortalNotificationDto> {
    if (!Number.isInteger(expectedVersion) || expectedVersion < 1) workflowError('CONCURRENCY_CONFLICT', 409);
    return this.prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`SELECT id FROM supplier_portal_notifications WHERE id = ${id}::uuid FOR UPDATE`;
      await this.access(transaction, actor);
      const [current] = await transaction.$queryRaw<{ version: number; readAt: Date | null }[]>(Prisma.sql`
        SELECT portal_notice.version, portal_notice.read_at AS "readAt" ${supplierPortalNotificationScope(actor.id, actor.organizationId)} AND portal_notice.id = ${id}::uuid`);
      if (!current) workflowError('NOTIFICATION_NOT_FOUND', 404);
      if (current.version !== expectedVersion) workflowError('CONCURRENCY_CONFLICT', 409);
      if (!current.readAt) {
        await transaction.supplierPortalNotification.update({ where: { id }, data: { readAt: new Date(), version: { increment: 1 } } });
        await this.audit.record({ organizationId: actor.organizationId, actorUserId: actor.id, action: 'SUPPLIER_NOTIFICATION_READ',
          resourceType: 'SupplierPortalNotification', resourceId: id, outcome: 'SUCCESS', traceId, metadata: { resourceVersion: expectedVersion + 1 } }, transaction);
      }
      const [result] = await transaction.$queryRaw<{ item: SupplierPortalNotificationDto }[]>(Prisma.sql`
        SELECT to_jsonb(result) AS item FROM (SELECT ${fields} ${supplierPortalNotificationScope(actor.id, actor.organizationId)} AND portal_notice.id = ${id}::uuid) result`);
      return result!.item;
    }, { isolationLevel: 'ReadCommitted' });
  }
}
