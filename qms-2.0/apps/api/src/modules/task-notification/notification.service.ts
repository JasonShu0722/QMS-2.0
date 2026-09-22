import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../database/prisma.service.js';
import { assertActiveAuthentication } from '../../common/security/session-security.js';
import { AuditLogService } from '../audit-log/audit-log.service.js';
import { assertWorkflowFeature, featurePredicate, workflowAccessPredicate, type WorkflowActor } from '../workflow/workflow-access-policy.js';
import { workflowError } from '../workflow/workflow-runtime-policy.js';
import { inboxPage } from './task.service.js';
import { NotificationDto, NotificationPageDto, NotificationQueryDto } from './task-inbox.dto.js';

function notificationScope(actor: WorkflowActor, organizationId: string): Prisma.Sql {
  const user = Prisma.sql`${actor.id}::uuid`;
  const organization = Prisma.sql`notification.organization_id`;
  return Prisma.sql`FROM notifications notification
    JOIN workflow_tasks task ON task.id = notification.workflow_task_id AND task.organization_id = notification.organization_id
    JOIN workflow_instances instance ON instance.id = task.workflow_instance_id AND instance.organization_id = task.organization_id AND instance.workflow_version_id = task.workflow_version_id
    JOIN problem_indexes problem ON problem.id = instance.problem_index_id AND problem.organization_id = task.organization_id
    JOIN workflow_nodes node ON node.id = task.workflow_node_id AND node.organization_id = task.organization_id AND node.workflow_version_id = task.workflow_version_id
    WHERE notification.organization_id = ${organizationId}::uuid AND notification.recipient_user_id = ${actor.id}::uuid
      AND notification.organization_id = ${actor.organizationId}::uuid AND notification.channel = 'IN_APP' AND notification.status = 'DELIVERED'
      AND ${featurePredicate(user, organization, Prisma.sql`'notification:read'`)}
      AND ((notification.kind IN ('TASK_ASSIGNED', 'TASK_REMINDER') AND ${workflowAccessPredicate(user, organization, Prisma.sql`node.config->'assignment'`)})
        OR (notification.kind = 'TASK_ESCALATED' AND ${workflowAccessPredicate(user, organization, Prisma.sql`node.config->'escalation'`, 'problem-index:read')}))`;
}

const notificationFields = Prisma.sql`notification.id, notification.organization_id AS "organizationId", problem.id AS "problemId", notification.version, task.id AS "taskId", instance.id AS "instanceId", task.workflow_version_id AS "fixedVersion",
  node.id AS "nodeId", node.name AS "nodeName", notification.kind, notification.subject, notification.body, notification.status,
  notification.read_at AS "readAt", notification.created_at AS "createdAt"`;

@Injectable()
export class NotificationService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditLogService) {}

  async list(actor: WorkflowActor, query: NotificationQueryDto): Promise<NotificationPageDto> {
    const organizationId = query.organizationId ?? actor.organizationId;
    const { pageSize, offset } = inboxPage(query);
    return this.prisma.$transaction(async (tx) => {
      await assertActiveAuthentication(tx, actor);
      await assertWorkflowFeature(tx, actor, organizationId, 'notification:read');
      const status = query.status === 'READ' ? Prisma.sql`AND notification.read_at IS NOT NULL` : query.status === 'UNREAD' ? Prisma.sql`AND notification.read_at IS NULL` : Prisma.empty;
      const [page] = await tx.$queryRaw<NotificationPageDto[]>(Prisma.sql`
        WITH eligible AS MATERIALIZED (SELECT ${notificationFields} ${notificationScope(actor, organizationId)} ${status}),
        selected AS (SELECT * FROM eligible ORDER BY "createdAt" DESC, id DESC LIMIT ${pageSize} OFFSET ${offset})
        SELECT (SELECT count(*)::int FROM eligible) AS total, COALESCE((SELECT jsonb_agg(selected ORDER BY "createdAt" DESC, id DESC) FROM selected), '[]'::jsonb) AS items`);
      return page!;
    }, { isolationLevel: 'ReadCommitted' });
  }

  async read(actor: WorkflowActor, id: string, organizationId: string, expectedVersion: number, traceId: string): Promise<NotificationDto> {
    if (!Number.isInteger(expectedVersion) || expectedVersion < 1) throw new BadRequestException();
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM notifications WHERE id = ${id}::uuid AND organization_id = ${organizationId}::uuid FOR UPDATE`;
      await assertActiveAuthentication(tx, actor);
      await assertWorkflowFeature(tx, actor, organizationId, 'notification:read');
      const [current] = await tx.$queryRaw<{ version: number; readAt: Date | null }[]>(Prisma.sql`SELECT notification.version, notification.read_at AS "readAt" ${notificationScope(actor, organizationId)} AND notification.id = ${id}::uuid`);
      if (!current) workflowError('NOTIFICATION_NOT_FOUND', 404);
      if (current.version !== expectedVersion) workflowError('CONCURRENCY_CONFLICT', 409);
      if (!current.readAt) {
        await tx.notification.update({ where: { id }, data: { readAt: new Date(), version: { increment: 1 }, updatedById: actor.id } });
        await this.audit.record({ organizationId, actorUserId: actor.id, action: 'NOTIFICATION_READ', resourceType: 'Notification', resourceId: id, outcome: 'SUCCESS', traceId, metadata: { resourceVersion: current.version + 1 } }, tx);
      }
      const [result] = await tx.$queryRaw<{ item: NotificationDto }[]>(Prisma.sql`SELECT to_jsonb(result) AS item FROM (SELECT ${notificationFields} ${notificationScope(actor, organizationId)} AND notification.id = ${id}::uuid) result`);
      return result!.item;
    }, { isolationLevel: 'ReadCommitted' });
  }
}
