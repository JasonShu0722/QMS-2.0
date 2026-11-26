import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { PrismaService } from '../../database/prisma.service.js';
import type { Prisma, WorkflowNode } from '../../generated/prisma/client.js';
import type { AuthorizedSessionUser } from '../authorization/authorization.service.js';
import { AuditLogService } from '../audit-log/audit-log.service.js';
import { OutboxService } from '../task-notification/outbox.service.js';
import { ProblemIndexService } from '../problem-index/problem-index.service.js';
import { actionAllowed, canonical, forwardAction, isClosureReviewNode, isDomainControlledNode, isControlledEightDNode, isControlledEightDVersion, jsonObject, matchesCondition, workflowError } from './workflow-runtime-policy.js';
import type { WorkflowAction } from './workflow.types.js';
import { assertWorkflowFeature, canProcessWorkflowNode } from './workflow-access-policy.js';
import { assertActiveAuthentication, isSecurityConcurrencyConflict } from '../../common/security/session-security.js';
import { createWorkflowStart, persistWorkflowMutation, workflowProblemStatus } from './workflow-start.js';
import { administrativeReturn, type WorkflowAdministrativeReturnInput } from './workflow-administrative-return.js';
import type { WorkflowClosureContext } from './workflow-closure-round.types.js';

export interface WorkflowCommand {
  organizationId: string;
  actor: AuthorizedSessionUser & { sessionId?: string };
  problemIndexId: string;
  workflowVersionId: string;
  expectedProblemVersion: number;
  idempotencyKey: string;
  traceId: string;
  commandPayload?: Prisma.InputJsonValue;
}

export interface StartWorkflowInstanceInput extends WorkflowCommand {
  workflowDefinitionId: string;
  instanceKey: string;
}

export interface WorkflowActionInput extends WorkflowCommand {
  instanceId: string;
  currentNodeId: string;
  expectedVersion: number;
  action: WorkflowAction;
}

export interface WorkflowActionResult {
  instanceId: string;
  currentNodeId: string;
  workflowVersionId: string;
  version: number;
  problemVersion: number;
  status: 'RUNNING' | 'COMPLETED';
}

export type WorkflowDomainMutation = (transaction: Prisma.TransactionClient) => Promise<void>;
export type WorkflowDomainAccess = (transaction: Prisma.TransactionClient, context: { replay: boolean }) => Promise<void>;

/** Trusted server-side domain policy; never accepted as command payload or actor claims. */
export interface WorkflowParticipantAccess {
  authorize(transaction: Prisma.TransactionClient, input: WorkflowCommand, node?: WorkflowNode): Promise<void>;
  lock(transaction: Prisma.TransactionClient, input: WorkflowCommand): Promise<void>;
}

@Injectable()
export class WorkflowRuntimeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
    private readonly outbox: OutboxService,
    private readonly problems: ProblemIndexService,
  ) {}

  async administrativeReturn(tx: Prisma.TransactionClient, input: WorkflowAdministrativeReturnInput): Promise<number> {
    return administrativeReturn(tx, input, this.problems, this.audit);
  }

  async completeProcessAfterManagementSkip(tx: Prisma.TransactionClient, context: WorkflowClosureContext, traceId: string): Promise<void> {
    const { organizationId, problemId, instanceId, workflowVersionId, currentNodeId, instanceVersion } = context;
    const problem = await this.problems.lockForWorkflow(tx, organizationId, problemId);
    await tx.$queryRaw`SELECT id FROM workflow_instances WHERE organization_id = ${organizationId}::uuid AND id = ${instanceId}::uuid FOR UPDATE`;
    const instance = await tx.workflowInstance.findFirst({ where: { id: instanceId, organizationId, problemIndexId: problemId, workflowVersionId,
      currentNodeId, version: instanceVersion, status: 'RUNNING' }, include: { currentNode: true } });
    const gate = jsonObject(jsonObject(instance?.currentNode?.config).closureReview);
    if (problem.domainCode !== 'process-quality' || problem.workflowInstanceId !== instanceId || problem.closedAt || ['CLOSED', 'ARCHIVED'].includes(problem.status)
      || !instance || instance.currentNode?.type !== 'APPROVAL' || gate.domainCode !== 'process-quality' || gate.schemaVersion !== 1 || gate.policy !== 'INTERNAL') {
      workflowError('WORKFLOW_ACTION_INVALID', 409);
    }
    const end = await tx.workflowNode.findMany({ where: { organizationId, workflowVersionId, type: 'CLOSE' } });
    if (end.length !== 1 || jsonObject(end[0]!.config).isEnd !== true) workflowError('WORKFLOW_TRANSITION_AMBIGUOUS', 409);
    const target = end[0]!;
    const transitions = await tx.workflowTransition.findMany({ where: { organizationId, workflowVersionId, fromNodeId: currentNodeId,
      toNodeId: target.id, action: 'APPROVE' } });
    if (transitions.length !== 1 || !matchesCondition(transitions[0]!.condition, problem)) workflowError('WORKFLOW_TRANSITION_AMBIGUOUS', 409);
    const version = instanceVersion + 1;
    await tx.workflowInstance.update({ where: { id: instanceId }, data: { currentNodeId: target.id, status: 'COMPLETED', version,
      taskProjectionVersion: version, updatedById: null } });
    await tx.workflowTask.updateMany({ where: { organizationId, workflowInstanceId: instanceId, status: { in: ['PENDING', 'IN_PROGRESS', 'OVERDUE'] } },
      data: { status: 'COMPLETED', completedAt: new Date(), version: { increment: 1 } } });
    await this.problems.applyWorkflowState(tx, { organizationId, id: problemId, expectedVersion: problem.version, expectedInstanceId: instanceId,
      instanceId, status: 'CLOSED', actorUserId: null });
    await this.audit.record({ organizationId, actorUserId: null, action: 'WORKFLOW_ACTION_COMPLETED', resourceType: 'WorkflowInstance',
      resourceId: instanceId, outcome: 'SUCCESS', traceId, metadata: { resourceVersion: version, status: 'COMPLETED', reasonCode: 'CLOSE' } }, tx);
  }

  readTransitionProjection(tx: Prisma.TransactionClient, organizationId: string, problemIndexId: string) {
    return tx.$queryRaw<{ actorUserId: string; action: string; occurredAt: Date; instanceId: string; instanceVersion: number }[]>`
      WITH upgrades AS (
        SELECT id, actor_user_id, after_instance_id, created_at FROM workflow_upgrades
        WHERE organization_id = ${organizationId}::uuid AND problem_index_id = ${problemIndexId}::uuid
      ), events AS (
        SELECT mutation.actor_user_id, mutation.action, mutation.created_at, mutation.instance_version, mutation.id, mutation.instance_id
        FROM workflow_mutations mutation
        JOIN workflow_instances instance ON instance.id = mutation.instance_id AND instance.organization_id = mutation.organization_id
        WHERE instance.organization_id = ${organizationId}::uuid AND instance.problem_index_id = ${problemIndexId}::uuid
          AND (mutation.action <> 'START' OR NOT EXISTS (SELECT 1 FROM upgrades WHERE after_instance_id = mutation.instance_id))
        UNION ALL
        SELECT actor_user_id, 'UPGRADE', created_at, 0, id, after_instance_id FROM upgrades
      )
      SELECT actor_user_id AS "actorUserId", action, created_at AS "occurredAt", instance_id AS "instanceId", instance_version AS "instanceVersion" FROM events
      ORDER BY created_at, instance_version, id`;
  }

  async startInstance(input: StartWorkflowInstanceInput, transaction?: Prisma.TransactionClient, mutate?: WorkflowDomainMutation, domainAccess?: WorkflowDomainAccess): Promise<WorkflowActionResult> {
    return this.inTransaction(transaction, async (tx) => {
      await this.authorize(tx, input, 'workflow:start');
      const digest = await this.lockCommand(tx, input, 'START');
      await this.authorize(tx, input, 'workflow:start');
      const replay = await this.replay(tx, input, digest, false, domainAccess);
      if (replay) return replay;
      const problem = await this.problems.lockForWorkflow(tx, input.organizationId, input.problemIndexId);
      await domainAccess?.(tx, { replay: false });
      await this.authorize(tx, input, 'workflow:start', true);
      if (problem.version !== input.expectedProblemVersion || problem.workflowInstanceId || problem.status === 'CLOSED') workflowError('CONCURRENCY_CONFLICT', 409);
      return createWorkflowStart(tx, input, digest, { audit: this.audit, outbox: this.outbox, problems: this.problems }, null, mutate ? () => mutate(tx) : undefined, undefined, !!domainAccess);
    });
  }

  async submitAction(input: WorkflowActionInput, transaction?: Prisma.TransactionClient, mutate?: WorkflowDomainMutation, domainAccess?: WorkflowDomainAccess, participant?: WorkflowParticipantAccess): Promise<WorkflowActionResult> {
    return this.inTransaction(transaction, async (tx) => {
      await this.authorize(tx, input, 'workflow:act', false, participant);
      const digest = await this.lockCommand(tx, input, input.action);
      await this.authorize(tx, input, 'workflow:act', false, participant);
      const replay = await this.replay(tx, input, digest, true, domainAccess, participant);
      if (replay) return replay;
      const problem = await this.problems.lockForWorkflow(tx, input.organizationId, input.problemIndexId);
      await this.authorize(tx, input, 'workflow:act', false, participant);
      await tx.$queryRaw`SELECT id FROM workflow_instances WHERE id = ${input.instanceId}::uuid AND organization_id = ${input.organizationId}::uuid FOR UPDATE`;
      await this.authorize(tx, input, 'workflow:act', false, participant);
      const instance = await tx.workflowInstance.findFirst({ where: { id: input.instanceId, organizationId: input.organizationId }, include: { currentNode: true } });
      if (!instance || instance.problemIndexId !== problem.id || problem.workflowInstanceId !== instance.id) workflowError('WORKFLOW_INSTANCE_NOT_FOUND', 404);
      if (instance.workflowVersionId !== input.workflowVersionId) workflowError('WORKFLOW_VERSION_MISMATCH', 409);
      if (instance.version !== input.expectedVersion || problem.version !== input.expectedProblemVersion || instance.currentNodeId !== input.currentNodeId) workflowError('CONCURRENCY_CONFLICT', 409);
      const node = instance.currentNode;
      if (!node || isDomainControlledNode(node) || await isControlledEightDVersion(tx, input.organizationId, instance.workflowVersionId)) workflowError('WORKFLOW_ACTION_INVALID', 409);
      const [task] = await tx.$queryRaw<{ claimed_by_user_id: string | null }[]>`
        SELECT claimed_by_user_id FROM workflow_tasks
        WHERE organization_id = ${input.organizationId}::uuid AND workflow_instance_id = ${instance.id}::uuid
          AND workflow_version_id = ${instance.workflowVersionId}::uuid AND workflow_node_id = ${node.id}::uuid
          AND entry_instance_version = ${instance.version} AND status IN ('PENDING', 'IN_PROGRESS', 'OVERDUE') FOR UPDATE`;
      await participant?.lock(tx, input);
      await domainAccess?.(tx, { replay: false });
      await this.authorize(tx, input, 'workflow:act', true, participant);
      await this.authorizeNode(tx, input, node, participant);
      if (input.action !== 'REOPEN' && task?.claimed_by_user_id && task.claimed_by_user_id !== input.actor.id) workflowError('TASK_CLAIM_OWNER_REQUIRED', 403);
      if (!actionAllowed(node.type, input.action)) workflowError('WORKFLOW_ACTION_INVALID', 409);
      if (input.action === 'REOPEN' ? instance.status !== 'COMPLETED' : instance.status !== 'RUNNING') workflowError('WORKFLOW_ACTION_INVALID', 409);
      const closing = input.action === 'CLOSE';
      let target = node;
      if (closing) {
        if (node.type !== 'CLOSE' || jsonObject(node.config).isEnd !== true) workflowError('WORKFLOW_ACTION_INVALID', 409);
        if (jsonObject(node.config).requireIndependentVerification === true) {
          const verification = await tx.workflowMutation.findFirst({
            where: { organizationId: input.organizationId, instanceId: instance.id, action: { in: ['VERIFY', 'RETURN', 'REJECT', 'REOPEN'] } },
            orderBy: { instanceVersion: 'desc' },
          });
          if (verification?.action !== 'VERIFY' || verification.actorUserId === input.actor.id) workflowError('WORKFLOW_INDEPENDENT_VERIFICATION_REQUIRED', 403);
        }
      } else {
        const transitions = await tx.workflowTransition.findMany({ where: { organizationId: input.organizationId, workflowVersionId: instance.workflowVersionId, fromNodeId: node.id }, include: { toNode: true } });
        const matches = transitions.filter((edge) => (edge.action ?? forwardAction(node.type)) === input.action && matchesCondition(edge.condition, problem));
        if (matches.length !== 1) workflowError('WORKFLOW_TRANSITION_AMBIGUOUS', 409);
        target = matches[0]!.toNode;
        if (isControlledEightDNode(target) || (isClosureReviewNode(target) && !domainAccess)) workflowError('WORKFLOW_ACTION_INVALID', 409);
        if (['REJECT', 'RETURN', 'REOPEN'].includes(input.action)) {
          const visited = await tx.workflowMutation.count({ where: { organizationId: input.organizationId, instanceId: instance.id, nodeId: target.id } });
          if (!visited) workflowError('WORKFLOW_ACTION_INVALID', 409);
        }
      }
      if (mutate) await mutate(tx);
      const changed = await tx.workflowInstance.updateMany({
        where: { id: instance.id, organizationId: input.organizationId, version: input.expectedVersion, currentNodeId: input.currentNodeId },
        data: { currentNodeId: target.id, status: closing ? 'COMPLETED' : 'RUNNING', version: { increment: 1 }, updatedById: input.actor.id },
      });
      if (changed.count !== 1) workflowError('CONCURRENCY_CONFLICT', 409);
      const problemVersion = await this.problems.applyWorkflowState(tx, {
        organizationId: input.organizationId, id: problem.id, expectedVersion: input.expectedProblemVersion,
        expectedInstanceId: instance.id, instanceId: instance.id, status: workflowProblemStatus(target, closing), actorUserId: input.actor.id,
      });
      const result: WorkflowActionResult = { instanceId: instance.id, currentNodeId: target.id, workflowVersionId: instance.workflowVersionId, version: instance.version + 1, problemVersion, status: closing ? 'COMPLETED' : 'RUNNING' };
      await persistWorkflowMutation(tx, input, digest, input.action, node.id, node.id, result, { audit: this.audit, outbox: this.outbox });
      return result;
    });
  }

  private async inTransaction<Result>(transaction: Prisma.TransactionClient | undefined, work: (tx: Prisma.TransactionClient) => Promise<Result>): Promise<Result> {
    const checkedWork = async (tx: Prisma.TransactionClient): Promise<Result> => {
      const [isolation] = await tx.$queryRaw<{ transaction_isolation: string }[]>`SHOW transaction_isolation`;
      if (isolation?.transaction_isolation !== 'read committed') workflowError('WORKFLOW_TRANSACTION_ISOLATION_UNSUPPORTED', 409);
      return work(tx);
    };
    try {
      return transaction ? await checkedWork(transaction) : await this.prisma.$transaction(checkedWork, { isolationLevel: 'ReadCommitted' });
    } catch (error) {
      if ((error as { code?: string }).code === 'P2002' || isSecurityConcurrencyConflict(error)) workflowError('CONCURRENCY_CONFLICT', 409);
      throw error;
    }
  }

  private async authorize(tx: Prisma.TransactionClient, input: WorkflowCommand, permission: string, authenticate = false, participant?: WorkflowParticipantAccess): Promise<void> {
    if (participant && !input.actor.sessionId) workflowError('AUTH_SESSION_REQUIRED', 401);
    if (authenticate && input.actor.sessionId) await assertActiveAuthentication(tx, { id: input.actor.id, sessionId: input.actor.sessionId });
    const permissionOrganizationId = participant && input.actor.accountType === 'SUPPLIER' ? input.actor.organizationId : input.organizationId;
    await assertWorkflowFeature(tx, input.actor, permissionOrganizationId, permission);
    await participant?.authorize(tx, input);
  }

  private async authorizeNode(tx: Prisma.TransactionClient, input: WorkflowCommand, node: WorkflowNode, participant?: WorkflowParticipantAccess): Promise<void> {
    await participant?.authorize(tx, input, node);
    const permissionOrganizationId = participant && input.actor.accountType === 'SUPPLIER' ? input.actor.organizationId : input.organizationId;
    if (!await canProcessWorkflowNode(tx, input.actor.id, permissionOrganizationId, jsonObject(node.config).assignment)) workflowError('WORKFLOW_NODE_FORBIDDEN', 403);
  }

  private async lockCommand(tx: Prisma.TransactionClient, input: WorkflowCommand, action: string): Promise<string> {
    if (!/^[a-zA-Z0-9._:-]{8,128}$/.test(input.idempotencyKey ?? '')) workflowError('IDEMPOTENCY_KEY_REQUIRED', 400);
    const { traceId: _trace, idempotencyKey: _key, ...payload } = input;
    const { sessionId: _sessionId, ...actor } = input.actor;
    const digest = createHash('sha256').update(canonical({ action, payload: { ...payload, actor } })).digest('hex');
    const lockKey = `workflow:${input.organizationId}:${input.actor.id}:${input.idempotencyKey}`;
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))::text`;
    return digest;
  }

  private async replay(tx: Prisma.TransactionClient, input: WorkflowCommand, digest: string, checkNode: boolean, domainAccess?: WorkflowDomainAccess, participant?: WorkflowParticipantAccess): Promise<WorkflowActionResult | null> {
    const existing = await tx.workflowMutation.findUnique({ where: { organizationId_actorUserId_key: { organizationId: input.organizationId, actorUserId: input.actor.id, key: input.idempotencyKey } } });
    if (!existing) return null;
    const instance = await tx.workflowInstance.findUnique({ where: { id: existing.instanceId } });
    if (!instance || instance.problemIndexId !== input.problemIndexId) workflowError('WORKFLOW_INSTANCE_NOT_FOUND', 404);
    if ((checkNode || !domainAccess) && await isControlledEightDVersion(tx, input.organizationId, instance.workflowVersionId)) workflowError('WORKFLOW_ACTION_INVALID', 409);
    if (domainAccess || participant) {
      await this.problems.lockForWorkflow(tx, input.organizationId, input.problemIndexId);
      await tx.$queryRaw`SELECT id FROM workflow_instances WHERE id = ${instance.id}::uuid AND organization_id = ${input.organizationId}::uuid FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM workflow_tasks WHERE workflow_instance_id = ${instance.id}::uuid AND organization_id = ${input.organizationId}::uuid
        AND status IN ('PENDING', 'IN_PROGRESS', 'OVERDUE') ORDER BY id FOR UPDATE`;
      await participant?.lock(tx, input);
      await domainAccess?.(tx, { replay: true });
    }
    await this.authorize(tx, input, checkNode ? 'workflow:act' : 'workflow:start', true, participant);
    if (existing.requestDigest !== digest) workflowError('IDEMPOTENCY_REPLAY', 409);
    if (checkNode) {
      const node = await tx.workflowNode.findFirst({ where: { id: existing.nodeId, organizationId: input.organizationId } });
      if (!node) workflowError('WORKFLOW_NODE_FORBIDDEN', 403);
      if (isDomainControlledNode(node)) workflowError('WORKFLOW_ACTION_INVALID', 409);
      await this.authorizeNode(tx, input, node, participant);
    }
    return existing.response as unknown as WorkflowActionResult;
  }

}
