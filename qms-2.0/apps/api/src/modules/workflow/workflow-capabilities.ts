import type { Prisma, ProblemIndex, WorkflowInstance } from '../../generated/prisma/client.js';
import { HttpException } from '@nestjs/common';
import { assertWorkflowFeature, canProcessWorkflowNode, type WorkflowActor } from './workflow-access-policy.js';
import type { WorkflowAction } from './workflow.types.js';
import { actionAllowed, forwardAction, isClosureReviewNode, jsonObject, matchesCondition } from './workflow-runtime-policy.js';

export interface WorkflowCapabilities {
  canAct: boolean;
  allowedActions: WorkflowAction[];
  reasonCode: string | null;
  currentNodeId: string | null;
  taskId: string | null;
  claimedByUserId: string | null;
  projectionPending: boolean;
}

export async function workflowCapabilities(tx: Prisma.TransactionClient, actor: WorkflowActor, problem: ProblemIndex, instance: WorkflowInstance): Promise<WorkflowCapabilities> {
  const result: WorkflowCapabilities = { canAct: false, allowedActions: [], reasonCode: null, currentNodeId: instance.currentNodeId,
    taskId: null, claimedByUserId: null, projectionPending: false };
  const currentProblem = await tx.problemIndex.findFirst({ where: { id: problem.id, organizationId: problem.organizationId } });
  const currentInstance = await tx.workflowInstance.findFirst({ where: { id: instance.id, organizationId: problem.organizationId, problemIndexId: problem.id } });
  if (!currentProblem || !currentInstance) return { ...result, reasonCode: 'WORKFLOW_INSTANCE_NOT_FOUND' };
  problem = currentProblem;
  instance = currentInstance;
  result.currentNodeId = instance.currentNodeId;
  if (instance.problemIndexId !== problem.id || instance.organizationId !== problem.organizationId || problem.workflowInstanceId !== instance.id
    || problem.archivedAt || problem.status === 'ARCHIVED' || instance.status === 'CANCELLED') return { ...result, reasonCode: 'WORKFLOW_INSTANCE_NOT_FOUND' };
  try { await assertWorkflowFeature(tx, actor, problem.organizationId, 'workflow:act'); }
  catch (error) {
    if (!(error instanceof HttpException)) throw error;
    return { ...result, reasonCode: (error.getResponse() as { code: string }).code };
  }
  if (!instance.currentNodeId) return { ...result, reasonCode: 'WORKFLOW_NODE_FORBIDDEN' };
  const node = await tx.workflowNode.findFirst({ where: { id: instance.currentNodeId, workflowVersionId: instance.workflowVersionId, organizationId: problem.organizationId } });
  if (node && isClosureReviewNode(node)) return { ...result, reasonCode: 'WORKFLOW_ACTION_INVALID' };
  if (!node || !await canProcessWorkflowNode(tx, actor.id, problem.organizationId, jsonObject(node.config).assignment)) return { ...result, reasonCode: 'WORKFLOW_NODE_FORBIDDEN' };
  const task = await tx.workflowTask.findFirst({ where: { workflowInstanceId: instance.id, organizationId: problem.organizationId, workflowVersionId: instance.workflowVersionId,
    workflowNodeId: node.id, entryInstanceVersion: instance.version, status: { in: ['PENDING', 'IN_PROGRESS', 'OVERDUE'] } } });
  result.taskId = task?.id ?? null;
  result.claimedByUserId = task?.claimedByUserId ?? null;
  result.projectionPending = !task && instance.status === 'RUNNING';
  const transitions = await tx.workflowTransition.findMany({ where: { organizationId: problem.organizationId, workflowVersionId: instance.workflowVersionId, fromNodeId: node.id }, include: { toNode: true } });
  const visited = await tx.$queryRaw<{ nodeId: string }[]>`SELECT DISTINCT node_id AS "nodeId" FROM workflow_mutations WHERE organization_id = ${problem.organizationId}::uuid AND instance_id = ${instance.id}::uuid`;
  for (const action of ['SUBMIT', 'APPROVE', 'VERIFY', 'REJECT', 'RETURN', 'REOPEN', 'CLOSE'] as const) {
    if (!actionAllowed(node.type, action) || (action === 'REOPEN' ? instance.status !== 'COMPLETED' : instance.status !== 'RUNNING')) continue;
    if (action !== 'REOPEN' && task?.claimedByUserId && task.claimedByUserId !== actor.id) { result.reasonCode = 'TASK_CLAIM_OWNER_REQUIRED'; continue; }
    if (action === 'CLOSE') {
      if (node.type !== 'CLOSE' || jsonObject(node.config).isEnd !== true) continue;
      if (jsonObject(node.config).requireIndependentVerification === true) {
        const verification = await tx.workflowMutation.findFirst({ where: { organizationId: problem.organizationId, instanceId: instance.id, action: { in: ['VERIFY', 'RETURN', 'REJECT', 'REOPEN'] } }, orderBy: { instanceVersion: 'desc' } });
        if (verification?.action !== 'VERIFY' || verification.actorUserId === actor.id) { result.reasonCode = 'WORKFLOW_INDEPENDENT_VERIFICATION_REQUIRED'; continue; }
      }
    } else {
      const matches = transitions.filter((edge) => (edge.action ?? forwardAction(node.type)) === action && matchesCondition(edge.condition, problem));
      if (matches.length !== 1) { if (matches.length > 1 || action === forwardAction(node.type)) result.reasonCode = 'WORKFLOW_TRANSITION_AMBIGUOUS'; continue; }
      if (isClosureReviewNode(matches[0]!.toNode)) { result.reasonCode = 'WORKFLOW_ACTION_INVALID'; continue; }
      if (['REJECT', 'RETURN', 'REOPEN'].includes(action) && !visited.some((mutation) => mutation.nodeId === matches[0]!.toNodeId)) continue;
    }
    result.allowedActions.push(action);
  }
  result.canAct = result.allowedActions.length > 0;
  if (result.canAct) result.reasonCode = null;
  return result;
}
