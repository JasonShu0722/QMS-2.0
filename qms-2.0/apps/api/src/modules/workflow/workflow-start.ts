import type { Prisma, WorkflowNode } from '../../generated/prisma/client.js';
import type { AuditLogService } from '../audit-log/audit-log.service.js';
import type { OutboxService } from '../task-notification/outbox.service.js';
import type { ProblemIndexService } from '../problem-index/problem-index.service.js';
import type { StartWorkflowInstanceInput, WorkflowActionResult, WorkflowCommand } from './workflow-runtime.service.js';
import { isClosureReviewNode, isControlledEightDNode, jsonObject, workflowError } from './workflow-runtime-policy.js';

export interface WorkflowWriters { audit: AuditLogService; outbox: OutboxService; problems: ProblemIndexService }

export async function fixedWorkflowStart(tx: Prisma.TransactionClient, organizationId: string, definitionId: string, versionId: string, domainAccess = false) {
  const version = await tx.workflowVersion.findFirst({ where: { id: versionId, organizationId, workflowDefinitionId: definitionId, status: 'PUBLISHED' }, include: { nodes: true } });
  if (!version) workflowError('WORKFLOW_VERSION_NOT_FOUND', 404);
  if (!domainAccess && version.nodes.some(isControlledEightDNode)) workflowError('WORKFLOW_ACTION_INVALID', 409);
  const starts = version.nodes.filter((node) => jsonObject(node.config).isStart === true);
  if (starts.length !== 1 || starts[0]!.type === 'CLOSE' || isClosureReviewNode(starts[0]!)) workflowError('WORKFLOW_DRAFT_INVALID', 409);
  return { version, node: starts[0]! };
}

export function workflowProblemStatus(node: WorkflowNode, closing: boolean): 'IN_PROGRESS' | 'PENDING' | 'RESOLVED' | 'CLOSED' {
  if (closing) return 'CLOSED';
  if (node.type === 'CLOSE') return 'RESOLVED';
  return ['APPROVAL', 'VERIFICATION'].includes(node.type) ? 'PENDING' : 'IN_PROGRESS';
}

export async function createWorkflowStart(tx: Prisma.TransactionClient, input: StartWorkflowInstanceInput, digest: string, writers: WorkflowWriters,
  expectedInstanceId: string | null, afterCreate?: (instanceId: string, node: WorkflowNode) => Promise<void>, problemType?: string, domainAccess = false): Promise<WorkflowActionResult> {
  const { version, node } = await fixedWorkflowStart(tx, input.organizationId, input.workflowDefinitionId, input.workflowVersionId, domainAccess);
  const instance = await tx.workflowInstance.create({ data: { organizationId: input.organizationId, problemIndexId: input.problemIndexId,
    workflowDefinitionId: input.workflowDefinitionId, workflowVersionId: version.id, instanceKey: input.instanceKey, currentNodeId: node.id,
    createdById: input.actor.id, updatedById: input.actor.id } });
  await afterCreate?.(instance.id, node);
  const problemVersion = await writers.problems.applyWorkflowState(tx, { organizationId: input.organizationId, id: input.problemIndexId,
    expectedVersion: input.expectedProblemVersion, expectedInstanceId, instanceId: instance.id, status: workflowProblemStatus(node, false), actorUserId: input.actor.id, problemType });
  const result: WorkflowActionResult = { instanceId: instance.id, currentNodeId: node.id, workflowVersionId: version.id, version: 1, problemVersion, status: 'RUNNING' };
  await persistWorkflowMutation(tx, input, digest, 'START', node.id, null, result, writers);
  return result;
}

export async function persistWorkflowMutation(tx: Prisma.TransactionClient, input: WorkflowCommand, digest: string, action: string, nodeId: string,
  previousNodeId: string | null, result: WorkflowActionResult, writers: Pick<WorkflowWriters, 'audit' | 'outbox'>): Promise<void> {
  const eventType = action === 'START' ? 'WORKFLOW_STARTED' : 'WORKFLOW_ACTION_COMPLETED';
  const eventKey = `workflow:${result.instanceId}:${result.version}`;
  await writers.audit.record({ organizationId: input.organizationId, actorUserId: input.actor.id, action: eventType,
    resourceType: 'WorkflowInstance', resourceId: result.instanceId, outcome: 'SUCCESS', traceId: input.traceId,
    metadata: { eventKey, resourceVersion: result.version, status: result.status, reasonCode: action } }, tx);
  await writers.outbox.enqueue({ eventKey, aggregateType: 'WorkflowInstance', aggregateId: result.instanceId, eventType,
    payload: { schemaVersion: 1, organizationId: input.organizationId, problemIndexId: input.problemIndexId, instanceId: result.instanceId,
      workflowVersionId: result.workflowVersionId, instanceVersion: result.version, previousNodeId, currentNodeId: result.currentNodeId, action, status: result.status } }, tx);
  await tx.workflowMutation.create({ data: { organizationId: input.organizationId, actorUserId: input.actor.id, key: input.idempotencyKey,
    requestDigest: digest, instanceId: result.instanceId, instanceVersion: result.version, workflowVersionId: result.workflowVersionId,
    nodeId, action, response: { ...result } } });
}
