import { BadRequestException, HttpException, Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../database/prisma.service.js';
import { adminError, assertAdminAccess, type AdminActor } from '../../common/security/admin-mutation.service.js';
import { AuditLogService } from '../audit-log/audit-log.service.js';
import { assertRecentAuthentication } from '../../common/security/session-security.js';
import { OutboxAttemptPageDto, OutboxFailureDto, OutboxFailurePageDto, OutboxFailureQueryDto, OutboxRetryDto } from './outbox-administration.dto.js';

const ownedEvents = (organizationId: string) => Prisma.sql`
  FROM outbox_events event
  WHERE (
    (event.aggregate_type = 'FileObject' AND event.event_type = 'FILE_SCAN_REQUESTED'
      AND EXISTS (
        SELECT 1 FROM file_objects file
        WHERE file.id::text = event.aggregate_id AND file.organization_id = ${organizationId}::uuid
          AND file.status = 'QUARANTINED' AND file.scan_status IN ('PENDING', 'ERROR') AND file.object_version_id IS NOT NULL
          AND file.resource_type IS NOT NULL AND file.resource_id IS NOT NULL AND file.resource_version > 0
          AND event.payload->>'schemaVersion' = '1' AND event.payload->>'organizationId' = file.organization_id::text
          AND event.payload->>'fileId' = file.id::text AND event.payload->>'fileVersion' = file.version::text
          AND event.event_key = 'file-scan:' || file.id::text || ':' || file.version::text
      ))
    OR
    (event.aggregate_type = 'WorkflowInstance'
      AND event.event_type IN ('WORKFLOW_STARTED', 'WORKFLOW_ACTION_COMPLETED')
      AND EXISTS (
        SELECT 1 FROM workflow_instances instance
        JOIN workflow_mutations mutation ON mutation.instance_id = instance.id
        JOIN workflow_nodes node ON node.id::text = event.payload->>'currentNodeId'
          AND node.organization_id = instance.organization_id AND node.workflow_version_id = instance.workflow_version_id
        JOIN problem_indexes problem ON problem.id = instance.problem_index_id AND problem.organization_id = instance.organization_id
        WHERE instance.id::text = event.aggregate_id AND instance.organization_id = ${organizationId}::uuid
          AND event.payload->>'schemaVersion' = '1'
          AND event.payload->>'organizationId' = instance.organization_id::text
          AND event.payload->>'instanceId' = instance.id::text
          AND event.payload->>'workflowVersionId' = instance.workflow_version_id::text
          AND event.payload->>'problemIndexId' = problem.id::text
          AND event.payload->>'instanceVersion' = mutation.instance_version::text
          AND event.event_key = 'workflow:' || instance.id::text || ':' || mutation.instance_version::text
          AND mutation.organization_id = instance.organization_id
          AND mutation.workflow_version_id = instance.workflow_version_id
          AND mutation.action = event.payload->>'action'
          AND mutation.node_id::text = COALESCE(event.payload->>'previousNodeId', event.payload->>'currentNodeId')
          AND mutation.response->>'instanceId' = instance.id::text
          AND mutation.response->>'workflowVersionId' = instance.workflow_version_id::text
          AND mutation.response->>'version' = mutation.instance_version::text
          AND mutation.response->>'currentNodeId' = event.payload->>'currentNodeId'
          AND mutation.response->>'status' = event.payload->>'status'
          AND ((event.event_type = 'WORKFLOW_STARTED' AND mutation.action = 'START' AND mutation.instance_version = 1 AND event.payload->'previousNodeId' = 'null'::jsonb)
            OR (event.event_type = 'WORKFLOW_ACTION_COMPLETED' AND mutation.action <> 'START' AND mutation.instance_version > 1 AND event.payload->>'previousNodeId' IS NOT NULL))
      ))
    OR (event.aggregate_type = 'WorkflowTask'
      AND event.event_type IN ('WORKFLOW_TASK_REMINDER', 'WORKFLOW_TASK_OVERDUE', 'WORKFLOW_TASK_ESCALATION')
      AND EXISTS (
        SELECT 1 FROM workflow_tasks task
        JOIN workflow_instances instance ON instance.id = task.workflow_instance_id AND instance.organization_id = task.organization_id AND instance.workflow_version_id = task.workflow_version_id
        JOIN workflow_mutations mutation ON mutation.instance_id = instance.id AND mutation.instance_version = task.entry_instance_version
          AND mutation.organization_id = task.organization_id AND mutation.workflow_version_id = task.workflow_version_id
        JOIN workflow_nodes node ON node.id = task.workflow_node_id AND node.organization_id = task.organization_id AND node.workflow_version_id = task.workflow_version_id
        JOIN problem_indexes problem ON problem.id = instance.problem_index_id AND problem.organization_id = task.organization_id
        WHERE task.id::text = event.aggregate_id AND task.organization_id = ${organizationId}::uuid
          AND mutation.response->>'instanceId' = instance.id::text AND mutation.response->>'workflowVersionId' = task.workflow_version_id::text
          AND mutation.response->>'version' = task.entry_instance_version::text AND mutation.response->>'currentNodeId' = task.workflow_node_id::text
          AND mutation.response->>'status' = 'RUNNING'
          AND event.payload->>'schemaVersion' = '1'
          AND event.payload->>'organizationId' = task.organization_id::text
          AND event.payload->>'taskId' = task.id::text
          AND event.payload->>'instanceId' = task.workflow_instance_id::text
          AND event.payload->>'workflowVersionId' = task.workflow_version_id::text
          AND event.payload->>'nodeId' = task.workflow_node_id::text
          AND event.payload->>'entryInstanceVersion' = task.entry_instance_version::text
          AND event.payload->>'problemIndexId' = problem.id::text
          AND ((event.event_type = 'WORKFLOW_TASK_OVERDUE' AND event.event_key = 'workflow-task:' || task.id::text || ':overdue')
            OR (event.event_type = 'WORKFLOW_TASK_ESCALATION' AND node.config ? 'escalation' AND event.event_key = 'workflow-task:' || task.id::text || ':escalation')
            OR (event.event_type = 'WORKFLOW_TASK_REMINDER' AND EXISTS (
              SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(node.config->'reminders') = 'array' THEN node.config->'reminders' ELSE '[]'::jsonb END) reminder
              WHERE event.event_key = 'workflow-task:' || task.id::text || ':reminder:' || (reminder->>'offsetMinutes')
            )))
      ))
  )`;

@Injectable()
export class OutboxAdministrationService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditLogService) {}

  async list(actor: AdminActor, query: OutboxFailureQueryDto): Promise<OutboxFailurePageDto> {
    const organizationId = query.organizationId ?? actor.organizationId;
    const pageSize = query.pageSize ?? 25;
    const offset = query.offset ?? 0;
    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100 || !Number.isInteger(offset) || offset < 0 || offset > 10000) throw new BadRequestException();
    return this.prisma.$transaction(async (transaction) => {
      await assertAdminAccess(transaction, actor, organizationId, 'outbox:read');
      const scope = ownedEvents(organizationId);
      const [counts, rows] = await Promise.all([
        transaction.$queryRaw<{ total: bigint }[]>(Prisma.sql`SELECT count(*) AS total ${scope} AND event.status = 'FAILED'`),
        transaction.$queryRaw<(Omit<OutboxFailureDto, 'createdAt' | 'availableAt' | 'reasonCode' | 'lastFailureAt'> & { createdAt: Date; availableAt: Date; lastFailureAt: Date | null })[]>(Prisma.sql`
          SELECT event.id, event.event_type AS "eventType", event.aggregate_type AS "aggregateType", event.aggregate_id AS "aggregateId", event.attempts,
          event.created_at AS "createdAt", event.available_at AS "availableAt",
          COALESCE((SELECT attempt.reason_code FROM outbox_delivery_attempts attempt WHERE attempt.outbox_event_id = event.id AND attempt.outcome = 'FAILED' ORDER BY attempt.occurred_at DESC, attempt.id DESC LIMIT 1), 'OUTBOX_HANDLER_ERROR') AS "failureReasonCode",
          (SELECT attempt.occurred_at FROM outbox_delivery_attempts attempt WHERE attempt.outbox_event_id = event.id AND attempt.outcome = 'FAILED' ORDER BY attempt.occurred_at DESC, attempt.id DESC LIMIT 1) AS "lastFailureAt"
          ${scope} AND event.status = 'FAILED' ORDER BY event.created_at DESC, event.id DESC LIMIT ${pageSize} OFFSET ${offset}`),
      ]);
      return { total: Number(counts[0]!.total), items: rows.map((row) => ({ ...row, createdAt: new Date(row.createdAt).toISOString(), availableAt: new Date(row.availableAt).toISOString(), lastFailureAt: row.lastFailureAt ? new Date(row.lastFailureAt).toISOString() : undefined, reasonCode: 'OUTBOX_DELIVERY_FAILED' as const })) };
    }, { isolationLevel: 'RepeatableRead' });
  }

  async attempts(actor: AdminActor, id: string, organizationId: string): Promise<OutboxAttemptPageDto> {
    return this.prisma.$transaction(async (transaction) => {
      await assertAdminAccess(transaction, actor, organizationId, 'outbox:read');
      const event = await transaction.$queryRaw<{ id: string }[]>(Prisma.sql`SELECT event.id ${ownedEvents(organizationId)} AND event.id = ${id}::uuid`);
      if (!event.length) adminError('OUTBOX_EVENT_NOT_FOUND', 404);
      const rows = await transaction.$queryRaw<Array<{ id: string; attemptNumber: number; outcome: 'FAILED' | 'PROCESSED' | 'DEFERRED' | 'RETRY_REQUESTED'; reasonCode: string | null; occurredAt: Date; retryAt: Date | null }>>(Prisma.sql`
        SELECT id, attempt_number AS "attemptNumber", outcome, reason_code AS "reasonCode", occurred_at AS "occurredAt", retry_at AS "retryAt"
        FROM outbox_delivery_attempts WHERE outbox_event_id = ${id}::uuid ORDER BY occurred_at DESC, id DESC`);
      return { items: rows.map((row) => ({ id: row.id, attemptNumber: row.attemptNumber, outcome: row.outcome as OutboxAttemptPageDto['items'][number]['outcome'], reasonCode: row.reasonCode ?? undefined, occurredAt: new Date(row.occurredAt).toISOString(), retryAt: row.retryAt ? new Date(row.retryAt).toISOString() : undefined })) };
    }, { isolationLevel: 'RepeatableRead' });
  }

  async retry(actor: AdminActor, id: string, organizationId: string, traceId: string): Promise<OutboxRetryDto> {
    try {
      return await this.prisma.$transaction(async (transaction) => {
        await assertAdminAccess(transaction, actor, organizationId, 'outbox:retry');
        const exists = await transaction.$queryRaw<{ id: string }[]>(Prisma.sql`SELECT event.id ${ownedEvents(organizationId)} AND event.id = ${id}::uuid`);
        if (!exists.length) adminError('OUTBOX_EVENT_NOT_FOUND', 404);
        await transaction.$queryRaw`SELECT id FROM outbox_events WHERE id = ${id}::uuid FOR UPDATE`;
        await assertAdminAccess(transaction, actor, organizationId, 'outbox:retry');
        const current = await transaction.$queryRaw<{ status: string; attempts: number }[]>(Prisma.sql`SELECT event.status, event.attempts ${ownedEvents(organizationId)} AND event.id = ${id}::uuid`);
        if (!current.length) adminError('OUTBOX_EVENT_NOT_FOUND', 404);
        if (current[0]!.status !== 'FAILED') adminError('CONCURRENCY_CONFLICT', 409);
        await assertRecentAuthentication(transaction, actor);
        const retryAt = new Date();
        const attemptNumber = current[0]!.attempts;
        await transaction.outboxEvent.update({ where: { id }, data: { status: 'PENDING', attempts: 0, availableAt: retryAt, lastError: null, processingAt: null, processedAt: null } });
        await transaction.outboxDeliveryAttempt.create({ data: { outboxEventId: id, attemptNumber: attemptNumber + 1, outcome: 'RETRY_REQUESTED', reasonCode: 'OUTBOX_ADMIN_RETRY', occurredAt: retryAt, retryAt } });
        await this.audit.record({ actorUserId: actor.id, organizationId, action: 'OUTBOX_RETRY_REQUESTED', resourceType: 'OutboxEvent', resourceId: id, outcome: 'SUCCESS', traceId }, transaction);
        return { id, status: 'PENDING' };
      }, { isolationLevel: 'ReadCommitted' });
    } catch (error) {
      if (error instanceof HttpException && [403, 404, 409].includes(error.getStatus())) await this.audit.record({ actorUserId: actor.id, organizationId: actor.organizationId, action: 'ACTION_REJECTED', resourceType: 'OutboxEvent', outcome: 'DENIED', traceId, metadata: { permissionCode: 'outbox:retry', reasonCode: (error.getResponse() as { code?: string }).code } });
      throw error;
    }
  }
}
