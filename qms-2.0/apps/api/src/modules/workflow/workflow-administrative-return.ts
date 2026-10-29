import { BadRequestException } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { isUUID } from 'class-validator';
import type { Prisma, WorkflowNode, WorkflowTransition } from '../../generated/prisma/client.js';
import { hasPlatformAdministrator } from '../../common/security/platform-administrator.js';
import type { AuditLogService } from '../audit-log/audit-log.service.js';
import type { ProblemIndexService } from '../problem-index/problem-index.service.js';
import { parseDeadlinePolicy } from './workflow-deadline-extension.policy.js';
import { canonical, jsonObject, matchesCondition, workflowError } from './workflow-runtime-policy.js';

export type WorkflowAdministrativeReturnInput = {
  orgId: string; problemId: string; actorUserId: string; reason: string;
  expectedInstanceId: string; expectedInstanceVersion: number;
};

export function administrativeReturnTarget(transitions: (WorkflowTransition & { toNode: WorkflowNode })[],
  facts: Record<string, unknown>): WorkflowNode {
  const matching = transitions.filter(edge => edge.action === 'RETURN' && matchesCondition(edge.condition, facts));
  if (matching.length !== 1) workflowError('WORKFLOW_TRANSITION_AMBIGUOUS', 409);
  const target = matching[0]!.toNode, config = jsonObject(target.config);
  const controlled = facts.domainCode === 'supplier-quality'
    ? jsonObject(config.supplierEightD).schemaVersion === 1
    : ['process-quality', 'customer-quality', 'new-product-quality'].includes(String(facts.domainCode))
      && !!parseDeadlinePolicy(config.processEightD);
  if (target.type !== 'ACTION' || config.isStart !== true || !controlled || Object.hasOwn(config, 'closureReview')) {
    workflowError('WORKFLOW_ACTION_INVALID', 409);
  }
  return target;
}

// Trusted deletion transaction already owns authorization locks; re-read its cancelled round, never synthesize a business actor.
export async function administrativeReturn(tx: Prisma.TransactionClient, input: WorkflowAdministrativeReturnInput,
  problems: ProblemIndexService, audit: AuditLogService): Promise<number> {
  if (!input || [input.orgId, input.problemId, input.actorUserId, input.expectedInstanceId].some(id => typeof id !== 'string' || !isUUID(id))
    || !Number.isSafeInteger(input.expectedInstanceVersion) || input.expectedInstanceVersion < 1 || input.expectedInstanceVersion >= 2147483647
    || !/^ADMINISTRATIVE_(USER|DEPARTMENT|ORGANIZATION)_DELETED$/.test(input.reason)) throw new BadRequestException();
  if (!await hasPlatformAdministrator(tx, input.actorUserId)) workflowError('WORKFLOW_NODE_FORBIDDEN', 403);
  const problem = await problems.lockForWorkflow(tx, input.orgId, input.problemId);
  await tx.$queryRaw`SELECT id FROM workflow_instances WHERE organization_id = ${input.orgId}::uuid
    AND id = ${input.expectedInstanceId}::uuid AND problem_index_id = ${input.problemId}::uuid FOR UPDATE`;
  const instance = await tx.workflowInstance.findFirst({ where: { id: input.expectedInstanceId, organizationId: input.orgId },
    include: { currentNode: true, workflowVersion: true } });
  if (!instance || problem.workflowInstanceId !== instance.id || instance.problemIndexId !== problem.id
    || instance.version !== input.expectedInstanceVersion) workflowError('CONCURRENCY_CONFLICT', 409);
  const node = instance.currentNode, gate = jsonObject(jsonObject(node?.config).closureReview);
  if (problem.closedAt || ['CLOSED', 'ARCHIVED'].includes(problem.status) || instance.status !== 'RUNNING'
    || instance.workflowVersion.status !== 'PUBLISHED' || instance.workflowVersion.organizationId !== input.orgId
    || !node || node.organizationId !== input.orgId || node.workflowVersionId !== instance.workflowVersionId
    || gate.schemaVersion !== 1 || gate.domainCode !== problem.domainCode
    || gate.policy !== (problem.domainCode === 'supplier-quality' ? 'SUPPLIER' : 'INTERNAL')) workflowError('WORKFLOW_ACTION_INVALID', 409);
  const [round] = await tx.$queryRaw<{ id: string; status: string; instanceId: string; nodeId: string; workflowVersionId: string; context: Prisma.JsonValue }[]>`
    SELECT id, status, instance_id AS "instanceId", node_id AS "nodeId", workflow_version_id AS "workflowVersionId", context
    FROM workflow_closure_rounds WHERE organization_id = ${input.orgId}::uuid AND problem_id = ${input.problemId}::uuid
    ORDER BY round_number DESC LIMIT 1 FOR UPDATE`;
  const context = jsonObject(round?.context);
  if (!round || round.status !== 'CANCELLED' || round.instanceId !== instance.id || round.nodeId !== node.id
    || round.workflowVersionId !== instance.workflowVersionId || context.instanceVersion !== instance.version
    || context.organizationId !== input.orgId || context.problemId !== input.problemId || context.instanceId !== instance.id
    || context.currentNodeId !== node.id || context.workflowVersionId !== instance.workflowVersionId
    || context.endedBy !== input.actorUserId || context.endReason !== input.reason) workflowError('CONCURRENCY_CONFLICT', 409);
  const transitions = await tx.workflowTransition.findMany({ where: { organizationId: input.orgId,
    workflowVersionId: instance.workflowVersionId, fromNodeId: node.id, action: 'RETURN' }, include: { toNode: true } });
  const target = administrativeReturnTarget(transitions, problem);
  if (target.organizationId !== input.orgId || target.workflowVersionId !== instance.workflowVersionId) workflowError('WORKFLOW_ACTION_INVALID', 409);
  if (!await hasPlatformAdministrator(tx, input.actorUserId)) workflowError('WORKFLOW_NODE_FORBIDDEN', 403);
  const changed = await tx.workflowInstance.updateMany({ where: { id: instance.id, organizationId: input.orgId,
    version: input.expectedInstanceVersion, status: 'RUNNING', currentNodeId: node.id },
  data: { currentNodeId: target.id, version: { increment: 1 }, taskProjectionVersion: instance.version + 1, updatedById: input.actorUserId } });
  if (changed.count !== 1) workflowError('CONCURRENCY_CONFLICT', 409);
  // Controlled workflows have domain tasks; finish the silent generic projection without leaving a version gap for later events.
  await tx.workflowTask.updateMany({ where: { organizationId: input.orgId, workflowInstanceId: instance.id,
    status: { in: ['PENDING', 'IN_PROGRESS', 'OVERDUE'] } }, data: { status: 'COMPLETED', completedAt: new Date(), version: { increment: 1 } } });
  const problemVersion = await problems.applyWorkflowState(tx, { organizationId: input.orgId, id: problem.id,
    expectedVersion: problem.version, expectedInstanceId: instance.id, instanceId: instance.id, status: 'IN_PROGRESS', actorUserId: input.actorUserId });
  // The existing DB action CHECK is closed; namespace this administrative receipt instead of introducing a schema change.
  const version = instance.version + 1, action = 'RETURN';
  await tx.workflowMutation.create({ data: { organizationId: input.orgId, actorUserId: input.actorUserId,
    key: `admin-return:${round.id}:${instance.version}`, requestDigest: createHash('sha256').update(canonical(input)).digest('hex'),
    instanceId: instance.id, instanceVersion: version, workflowVersionId: instance.workflowVersionId, nodeId: node.id, action,
    response: { instanceId: instance.id, currentNodeId: target.id, workflowVersionId: instance.workflowVersionId,
      version, problemVersion, status: 'RUNNING', administrative: true, reason: input.reason, cancelledRoundId: round.id } } });
  await audit.record({ organizationId: input.orgId, actorUserId: input.actorUserId, action: 'WORKFLOW_ADMINISTRATIVELY_RETURNED',
    resourceType: 'WorkflowInstance', resourceId: instance.id, outcome: 'SUCCESS', traceId: randomUUID(),
    metadata: { reasonCode: input.reason, resourceVersion: version, eventKey: `admin-return:${round.id}:${instance.version}` } }, tx);
  // Round cancellation events retire old duties; ordinary RETURN would create an unwanted handling ping.
  return version;
}
