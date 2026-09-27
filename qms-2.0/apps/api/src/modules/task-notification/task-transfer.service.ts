import { Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../database/prisma.service.js';
import { AdminMutationService, adminError, type AdminActor } from '../../common/security/admin-mutation.service.js';
import { AuditLogService } from '../audit-log/audit-log.service.js';
import { canProcessWorkflowNode } from '../workflow/workflow-access-policy.js';
import { jsonObject, workflowError } from '../workflow/workflow-runtime-policy.js';
import type { TaskTransferDto, TaskTransferResultDto } from './task-inbox.dto.js';

const PERMISSION = 'task:transfer';

@Injectable()
export class TaskTransferService {
  constructor(private readonly prisma: PrismaService, private readonly mutations: AdminMutationService, private readonly audit: AuditLogService) {}

  async transfer(actor: AdminActor, organizationId: string, input: TaskTransferDto, traceId: string, key?: string): Promise<TaskTransferResultDto[]> {
    if (actor.accountType !== 'INTERNAL' || organizationId !== (actor.scopeOrganizationId ?? actor.organizationId)) adminError('ORGANIZATION_SCOPE_DENIED', 403);
    const ids = input.items.map((item) => item.id);
    if (new Set(ids).size !== ids.length) adminError('CONCURRENCY_CONFLICT', 409);
    return this.mutations.run({ actor, organizationId, key, traceId, action: 'TASKS_TRANSFERRED', payload: input, permission: PERMISSION }, async (tx) => {
      const target = await tx.user.findUnique({ where: { id: input.assigneeUserId }, select: { id: true, status: true, organizationId: true, accountType: true } });
      if (!target || target.status !== 'ACTIVE' || (target.accountType === 'SUPPLIER' && target.organizationId !== organizationId)) adminError('TASK_ASSIGNEE_NOT_ELIGIBLE', 409);
      const results: TaskTransferResultDto[] = [];
      for (const item of input.items) {
        const task = await tx.workflowTask.findFirst({ where: { id: item.id, organizationId }, include: { workflowNode: true } });
        if (!task || task.version !== item.expectedVersion) workflowError('CONCURRENCY_CONFLICT', 409);
        await tx.$queryRaw`SELECT id FROM workflow_tasks WHERE id = ${item.id}::uuid FOR UPDATE`;
        const current = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`SELECT task.id FROM workflow_tasks task JOIN workflow_instances instance ON instance.id = task.workflow_instance_id AND instance.organization_id = task.organization_id AND instance.workflow_version_id = task.workflow_version_id JOIN problem_indexes problem ON problem.id = instance.problem_index_id AND problem.organization_id = task.organization_id WHERE task.id = ${item.id}::uuid AND task.organization_id = ${organizationId}::uuid AND task.status IN ('PENDING', 'IN_PROGRESS', 'OVERDUE') AND instance.status = 'RUNNING' AND instance.current_node_id = task.workflow_node_id AND instance.version = task.entry_instance_version AND problem.archived_at IS NULL AND problem.status NOT IN ('CLOSED', 'ARCHIVED')`);
        if (!current.length) workflowError('TASK_NOT_FOUND', 404);
        if (!(await canProcessWorkflowNode(tx, input.assigneeUserId, organizationId, jsonObject(task.workflowNode.config).assignment))) adminError('TASK_ASSIGNEE_NOT_ELIGIBLE', 409);
        const status = task.dueAt && task.dueAt <= new Date() ? 'OVERDUE' : 'IN_PROGRESS';
        const updated = await tx.workflowTask.update({ where: { id: item.id }, data: { claimedByUserId: input.assigneeUserId, claimedAt: new Date(), status, version: { increment: 1 }, updatedById: actor.id } });
        await this.audit.record({ organizationId, actorUserId: actor.id, action: 'TASK_TRANSFERRED', resourceType: 'WorkflowTask', resourceId: item.id, outcome: 'SUCCESS', traceId, metadata: { assigneeUserId: input.assigneeUserId, resourceVersion: updated.version } }, tx);
        results.push({ id: updated.id, version: updated.version, assigneeUserId: input.assigneeUserId, status: updated.status });
      }
      return results;
    });
  }
}
