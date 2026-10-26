import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../database/prisma.service.js';
import { assertActiveAuthentication } from '../../common/security/session-security.js';
import { AuditLogService } from '../audit-log/audit-log.service.js';
import { assertWorkflowFeature, canProcessWorkflowNode, featurePredicate, workflowAccessPredicate, type WorkflowActor } from '../workflow/workflow-access-policy.js';
import { isDomainControlledNode, isProcessEightDVersion, jsonObject, workflowError } from '../workflow/workflow-runtime-policy.js';
import { TaskDto, TaskPageDto, TaskQueryDto, TaskStatisticsDto } from './task-inbox.dto.js';

export function inboxPage(query: { pageSize?: number; offset?: number }) {
  const pageSize = query.pageSize ?? 25;
  const offset = query.offset ?? 0;
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100 || !Number.isInteger(offset) || offset < 0 || offset > 10000) throw new BadRequestException();
  return { pageSize, offset };
}

// Bind the fixed target organization to avoid repeated correlated role scans without weakening per-task authorization.
function taskScope(actor: WorkflowActor, organizationId: string, statuses: readonly string[] = ['PENDING', 'IN_PROGRESS', 'OVERDUE']): Prisma.Sql {
  const statusList = Prisma.join(statuses.map((status) => Prisma.sql`${status}`));
  return Prisma.sql`FROM workflow_tasks task
    JOIN workflow_instances instance ON instance.id = task.workflow_instance_id AND instance.organization_id = task.organization_id AND instance.workflow_version_id = task.workflow_version_id
    JOIN workflow_nodes node ON node.id = task.workflow_node_id AND node.organization_id = task.organization_id AND node.workflow_version_id = task.workflow_version_id
    JOIN problem_indexes problem ON problem.workflow_instance_id = instance.id AND problem.id = instance.problem_index_id AND problem.organization_id = task.organization_id
    WHERE task.organization_id = ${organizationId}::uuid AND task.status::text IN (${statusList})
      AND instance.status = 'RUNNING' AND instance.current_node_id = task.workflow_node_id AND instance.version = task.entry_instance_version
      AND problem.archived_at IS NULL AND problem.status NOT IN ('CLOSED', 'ARCHIVED')
      AND NOT (node.config ? 'closureReview' OR node.config ? 'processEightD')
      AND NOT EXISTS (SELECT 1 FROM workflow_nodes controlled
        WHERE controlled.organization_id = task.organization_id AND controlled.workflow_version_id = task.workflow_version_id
          AND controlled.config ? 'processEightD')
      AND ${workflowAccessPredicate(Prisma.sql`${actor.id}::uuid`, Prisma.sql`${organizationId}::uuid`, Prisma.sql`node.config->'assignment'`)}`;
}

function taskFields(actor: WorkflowActor, organizationId: string): Prisma.Sql {
  const canClaim = featurePredicate(Prisma.sql`${actor.id}::uuid`, Prisma.sql`${organizationId}::uuid`, Prisma.sql`'task:claim'`);
  const ownerEligible = workflowAccessPredicate(Prisma.sql`task.claimed_by_user_id`, Prisma.sql`${organizationId}::uuid`, Prisma.sql`node.config->'assignment'`);
  return Prisma.sql`task.id, task.version, task.workflow_instance_id AS "instanceId", task.workflow_version_id AS "fixedVersion",
    task.entry_instance_version AS "entryInstanceVersion", node.id AS "nodeId", node.name, node.type, problem.id AS "problemId", problem.report_number AS "reportNumber",
    task.due_at AS "dueAt", task.status, task.claimed_by_user_id AS "claimedByUserId", task.claimed_at AS "claimedAt",
    (task.claimed_by_user_id IS NULL OR task.claimed_by_user_id = ${actor.id}::uuid) AS "canAct",
    (${canClaim} AND (task.claimed_by_user_id IS NULL OR (task.claimed_by_user_id <> ${actor.id}::uuid AND NOT ${ownerEligible}))) AS "canClaim",
    (${canClaim} AND task.claimed_by_user_id = ${actor.id}::uuid) IS TRUE AS "canRelease",
    (${canClaim} AND task.status = 'FAILED') IS TRUE AS "canRetry"`;
}

@Injectable()
export class TaskService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditLogService) {}

  async list(actor: WorkflowActor, query: TaskQueryDto): Promise<TaskPageDto> {
    const organizationId = query.organizationId ?? actor.organizationId;
    const { pageSize, offset } = inboxPage(query);
    return this.prisma.$transaction(async (tx) => {
      await assertActiveAuthentication(tx, actor);
      await assertWorkflowFeature(tx, actor, organizationId, 'task:read');
      const statuses = query.status === 'FAILED' ? ['FAILED'] : ['PENDING', 'IN_PROGRESS', 'OVERDUE'];
      const status = query.status ? Prisma.sql`AND task.status::text = ${query.status}` : Prisma.empty;
      const claim = query.claim === 'MINE' ? Prisma.sql`AND task.claimed_by_user_id = ${actor.id}::uuid`
        : query.claim === 'OTHERS' ? Prisma.sql`AND task.claimed_by_user_id <> ${actor.id}::uuid`
          : query.claim === 'UNCLAIMED' ? Prisma.sql`AND task.claimed_by_user_id IS NULL` : Prisma.empty;
      const [page] = await tx.$queryRaw<TaskPageDto[]>(Prisma.sql`
        WITH eligible AS MATERIALIZED (SELECT ${taskFields(actor, organizationId)} ${taskScope(actor, organizationId, statuses)} ${status} ${claim}
          AND ${featurePredicate(Prisma.sql`${actor.id}::uuid`, Prisma.sql`${organizationId}::uuid`, Prisma.sql`'task:read'`)}),
        selected AS (SELECT * FROM eligible ORDER BY "dueAt" ASC NULLS LAST, id ASC LIMIT ${pageSize} OFFSET ${offset})
        SELECT (SELECT count(*)::int FROM eligible) AS total, COALESCE((SELECT jsonb_agg(selected ORDER BY "dueAt" ASC NULLS LAST, id ASC) FROM selected), '[]'::jsonb) AS items`);
      return page!;
    }, { isolationLevel: 'ReadCommitted' });
  }

  async statistics(actor: WorkflowActor, query: { organizationId?: string } = {}): Promise<TaskStatisticsDto> {
    const organizationId = query.organizationId ?? actor.organizationId;
    return this.prisma.$transaction(async (tx) => {
      await assertActiveAuthentication(tx, actor);
      await assertWorkflowFeature(tx, actor, organizationId, 'task:read');
      const [row] = await tx.$queryRaw<TaskStatisticsDto[]>(Prisma.sql`
        WITH eligible AS (
          SELECT task.status::text AS status, task.claimed_by_user_id AS "claimedByUserId", task.due_at AS "dueAt"
          ${taskScope(actor, organizationId)}
          AND ${featurePredicate(Prisma.sql`${actor.id}::uuid`, Prisma.sql`${organizationId}::uuid`, Prisma.sql`'task:read'`)}
        ), failed AS (
          SELECT task.id
          ${taskScope(actor, organizationId, ['FAILED'])}
          AND ${featurePredicate(Prisma.sql`${actor.id}::uuid`, Prisma.sql`${organizationId}::uuid`, Prisma.sql`'task:read'`)}
        )
        SELECT
          count(*)::int AS total,
          count(*) FILTER (WHERE status = 'PENDING')::int AS pending,
          count(*) FILTER (WHERE status = 'IN_PROGRESS')::int AS "inProgress",
          count(*) FILTER (WHERE status = 'OVERDUE' OR ("dueAt" IS NOT NULL AND "dueAt" < CURRENT_TIMESTAMP))::int AS overdue,
          count(*) FILTER (WHERE "claimedByUserId" IS NULL)::int AS unclaimed,
          count(*) FILTER (WHERE "claimedByUserId" = ${actor.id}::uuid)::int AS mine,
          count(*) FILTER (WHERE "dueAt" >= CURRENT_DATE AND "dueAt" < CURRENT_DATE + INTERVAL '1 day')::int AS "dueToday",
          count(*) FILTER (WHERE "dueAt" >= CURRENT_DATE AND "dueAt" < CURRENT_DATE + INTERVAL '7 days')::int AS "dueThisWeek",
          (SELECT count(*)::int FROM failed) AS failed
        FROM eligible`);
      return row ?? { total: 0, pending: 0, inProgress: 0, overdue: 0, unclaimed: 0, mine: 0, dueToday: 0, dueThisWeek: 0, failed: 0 };
    }, { isolationLevel: 'ReadCommitted' });
  }

  claim(actor: WorkflowActor, id: string, organizationId: string, expectedVersion: number, traceId: string): Promise<TaskDto> {
    return this.mutate(actor, id, organizationId, expectedVersion, traceId, false);
  }

  release(actor: WorkflowActor, id: string, organizationId: string, expectedVersion: number, traceId: string): Promise<TaskDto> {
    return this.mutate(actor, id, organizationId, expectedVersion, traceId, true);
  }

  async retry(actor: WorkflowActor, id: string, organizationId: string, expectedVersion: number, traceId: string): Promise<TaskDto> {
    if (!Number.isInteger(expectedVersion) || expectedVersion < 1) throw new BadRequestException();
    return this.prisma.$transaction(async (tx) => {
      const candidate = await tx.workflowTask.findFirst({ where: { id, organizationId } });
      if (!candidate) workflowError('TASK_NOT_FOUND', 404);
      await tx.$queryRaw`SELECT id FROM problem_indexes WHERE workflow_instance_id = ${candidate.workflowInstanceId}::uuid AND organization_id = ${organizationId}::uuid FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM workflow_instances WHERE id = ${candidate.workflowInstanceId}::uuid FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM workflow_tasks WHERE id = ${id}::uuid FOR UPDATE`;
      await assertActiveAuthentication(tx, actor);
      await assertWorkflowFeature(tx, actor, organizationId, 'task:claim');
      const task = await tx.workflowTask.findUniqueOrThrow({ where: { id }, include: { workflowNode: true } });
      if (isDomainControlledNode(task.workflowNode) || await isProcessEightDVersion(tx, organizationId, task.workflowVersionId)) workflowError('TASK_NOT_FOUND', 404);
      if (task.version !== expectedVersion) workflowError('CONCURRENCY_CONFLICT', 409);
      if (task.status !== 'FAILED') workflowError('TASK_RETRY_UNAVAILABLE', 409);
      const current = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`SELECT task.id ${taskScope(actor, organizationId, ['FAILED'])} AND task.id = ${id}::uuid`);
      if (!current.length) workflowError('TASK_NOT_FOUND', 404);
      const nextStatus = task.dueAt && task.dueAt <= new Date() ? 'OVERDUE' : 'PENDING';
      await tx.workflowTask.update({ where: { id }, data: { claimedByUserId: null, claimedAt: null, completedAt: null, status: nextStatus, version: { increment: 1 }, updatedById: actor.id } });
      await this.audit.record({ organizationId, actorUserId: actor.id, action: 'TASK_RETRIED', resourceType: 'WorkflowTask', resourceId: id, outcome: 'SUCCESS', traceId,
        metadata: { status: nextStatus, resourceVersion: task.version + 1 } }, tx);
      const [result] = await tx.$queryRaw<{ item: TaskDto }[]>(Prisma.sql`SELECT to_jsonb(result) AS item FROM (SELECT ${taskFields(actor, organizationId)} ${taskScope(actor, organizationId)} AND task.id = ${id}::uuid) result`);
      return result!.item;
    }, { isolationLevel: 'ReadCommitted' });
  }

  private async mutate(actor: WorkflowActor, id: string, organizationId: string, expectedVersion: number, traceId: string, release: boolean): Promise<TaskDto> {
    if (!Number.isInteger(expectedVersion) || expectedVersion < 1) throw new BadRequestException();
    return this.prisma.$transaction(async (tx) => {
      const candidate = await tx.workflowTask.findFirst({ where: { id, organizationId } });
      if (!candidate) workflowError('TASK_NOT_FOUND', 404);
      await tx.$queryRaw`SELECT id FROM problem_indexes WHERE workflow_instance_id = ${candidate.workflowInstanceId}::uuid AND organization_id = ${organizationId}::uuid FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM workflow_instances WHERE id = ${candidate.workflowInstanceId}::uuid FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM workflow_tasks WHERE id = ${id}::uuid FOR UPDATE`;
      await assertActiveAuthentication(tx, actor);
      await assertWorkflowFeature(tx, actor, organizationId, 'task:claim');
      const task = await tx.workflowTask.findUniqueOrThrow({ where: { id }, include: { workflowNode: true } });
      if (isDomainControlledNode(task.workflowNode) || await isProcessEightDVersion(tx, organizationId, task.workflowVersionId)) workflowError('TASK_NOT_FOUND', 404);
      if (task.version !== expectedVersion) workflowError('CONCURRENCY_CONFLICT', 409);
      const current = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`SELECT task.id ${taskScope(actor, organizationId)} AND task.id = ${id}::uuid`);
      if (!current.length) workflowError('TASK_NOT_FOUND', 404);
      const previousOwner = task.claimedByUserId;
      if (release) {
        if (!previousOwner) workflowError('TASK_NOT_CLAIMED', 409);
        if (previousOwner !== actor.id) workflowError('TASK_CLAIM_OWNER_REQUIRED', 403);
      } else if (previousOwner && (previousOwner === actor.id || await canProcessWorkflowNode(tx, previousOwner, organizationId, jsonObject(task.workflowNode.config).assignment))) {
        workflowError('TASK_ALREADY_CLAIMED', 409);
      }
      const now = new Date();
      const status = task.status === 'OVERDUE' || (task.dueAt && task.dueAt <= now) ? 'OVERDUE' : release ? 'PENDING' : 'IN_PROGRESS';
      await tx.workflowTask.update({ where: { id }, data: { claimedByUserId: release ? null : actor.id, claimedAt: release ? null : now, status, version: { increment: 1 }, updatedById: actor.id } });
      await this.audit.record({ organizationId, actorUserId: actor.id, action: release ? 'TASK_RELEASED' : previousOwner ? 'TASK_RECLAIMED' : 'TASK_CLAIMED', resourceType: 'WorkflowTask', resourceId: id, outcome: 'SUCCESS', traceId,
        metadata: { previousClaimedByUserId: previousOwner, claimedByUserId: release ? null : actor.id, resourceVersion: task.version + 1 } }, tx);
      const [result] = await tx.$queryRaw<{ item: TaskDto }[]>(Prisma.sql`SELECT to_jsonb(result) AS item FROM (SELECT ${taskFields(actor, organizationId)} ${taskScope(actor, organizationId)} AND task.id = ${id}::uuid) result`);
      return result!.item;
    }, { isolationLevel: 'ReadCommitted' });
  }
}
