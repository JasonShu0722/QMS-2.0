import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { PrismaService } from '../../database/prisma.service.js';
import type { Prisma, WorkflowNode } from '../../generated/prisma/client.js';
import type { AuthorizedSessionUser } from '../authorization/authorization.service.js';
import { AuditLogService } from '../audit-log/audit-log.service.js';
import { OutboxService } from '../task-notification/outbox.service.js';
import { ProblemIndexService } from '../problem-index/problem-index.service.js';
import { actionAllowed, canonical, forwardAction, jsonObject, matchesCondition, workflowError } from './workflow-runtime-policy.js';
import type { WorkflowAction } from './workflow.types.js';
import { assertWorkflowFeature, canProcessWorkflowNode } from './workflow-access-policy.js';
import { assertActiveAuthentication } from '../../common/security/session-security.js';
import { createWorkflowStart, persistWorkflowMutation, workflowProblemStatus } from './workflow-start.js';

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

@Injectable()
export class WorkflowRuntimeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
    private readonly outbox: OutboxService,
    private readonly problems: ProblemIndexService,
  ) {}

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
      return createWorkflowStart(tx, input, digest, { audit: this.audit, outbox: this.outbox, problems: this.problems }, null, mutate ? () => mutate(tx) : undefined);
    });
  }

  async submitAction(input: WorkflowActionInput, transaction?: Prisma.TransactionClient, mutate?: WorkflowDomainMutation, domainAccess?: WorkflowDomainAccess): Promise<WorkflowActionResult> {
    return this.inTransaction(transaction, async (tx) => {
      await this.authorize(tx, input, 'workflow:act');
      const digest = await this.lockCommand(tx, input, input.action);
      await this.authorize(tx, input, 'workflow:act');
      const replay = await this.replay(tx, input, digest, true, domainAccess);
      if (replay) return replay;
      const problem = await this.problems.lockForWorkflow(tx, input.organizationId, input.problemIndexId);
      await this.authorize(tx, input, 'workflow:act');
      await tx.$queryRaw`SELECT id FROM workflow_instances WHERE id = ${input.instanceId}::uuid AND organization_id = ${input.organizationId}::uuid FOR UPDATE`;
      await this.authorize(tx, input, 'workflow:act');
      const instance = await tx.workflowInstance.findFirst({ where: { id: input.instanceId, organizationId: input.organizationId }, include: { currentNode: true } });
      if (!instance || instance.problemIndexId !== problem.id || problem.workflowInstanceId !== instance.id) workflowError('WORKFLOW_INSTANCE_NOT_FOUND', 404);
      if (instance.workflowVersionId !== input.workflowVersionId) workflowError('WORKFLOW_VERSION_MISMATCH', 409);
      if (instance.version !== input.expectedVersion || problem.version !== input.expectedProblemVersion || instance.currentNodeId !== input.currentNodeId) workflowError('CONCURRENCY_CONFLICT', 409);
      const node = instance.currentNode;
      if (!node) workflowError('WORKFLOW_ACTION_INVALID', 409);
      const [task] = await tx.$queryRaw<{ claimed_by_user_id: string | null }[]>`
        SELECT claimed_by_user_id FROM workflow_tasks
        WHERE organization_id = ${input.organizationId}::uuid AND workflow_instance_id = ${instance.id}::uuid
          AND workflow_version_id = ${instance.workflowVersionId}::uuid AND workflow_node_id = ${node.id}::uuid
          AND entry_instance_version = ${instance.version} AND status IN ('PENDING', 'IN_PROGRESS', 'OVERDUE') FOR UPDATE`;
      await domainAccess?.(tx, { replay: false });
      await this.authorize(tx, input, 'workflow:act', true);
      await this.authorizeNode(tx, input, node);
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
      if (['P2002', 'P2034'].includes(String((error as { code?: string }).code))) workflowError('CONCURRENCY_CONFLICT', 409);
      throw error;
    }
  }

  private async authorize(tx: Prisma.TransactionClient, input: WorkflowCommand, permission: string, authenticate = false): Promise<void> {
    if (authenticate && input.actor.sessionId) await assertActiveAuthentication(tx, { id: input.actor.id, sessionId: input.actor.sessionId });
    await assertWorkflowFeature(tx, input.actor, input.organizationId, permission);
  }

  private async authorizeNode(tx: Prisma.TransactionClient, input: WorkflowCommand, node: WorkflowNode): Promise<void> {
    if (!await canProcessWorkflowNode(tx, input.actor.id, input.organizationId, jsonObject(node.config).assignment)) workflowError('WORKFLOW_NODE_FORBIDDEN', 403);
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

  private async replay(tx: Prisma.TransactionClient, input: WorkflowCommand, digest: string, checkNode: boolean, domainAccess?: WorkflowDomainAccess): Promise<WorkflowActionResult | null> {
    const existing = await tx.workflowMutation.findUnique({ where: { organizationId_actorUserId_key: { organizationId: input.organizationId, actorUserId: input.actor.id, key: input.idempotencyKey } } });
    if (!existing) return null;
    const instance = await tx.workflowInstance.findUnique({ where: { id: existing.instanceId } });
    if (!instance || instance.problemIndexId !== input.problemIndexId) workflowError('WORKFLOW_INSTANCE_NOT_FOUND', 404);
    if (domainAccess) {
      await this.problems.lockForWorkflow(tx, input.organizationId, input.problemIndexId);
      await tx.$queryRaw`SELECT id FROM workflow_instances WHERE id = ${instance.id}::uuid AND organization_id = ${input.organizationId}::uuid FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM workflow_tasks WHERE workflow_instance_id = ${instance.id}::uuid AND organization_id = ${input.organizationId}::uuid
        AND status IN ('PENDING', 'IN_PROGRESS', 'OVERDUE') ORDER BY id FOR UPDATE`;
      await domainAccess(tx, { replay: true });
    }
    await this.authorize(tx, input, checkNode ? 'workflow:act' : 'workflow:start', true);
    if (existing.requestDigest !== digest) workflowError('IDEMPOTENCY_REPLAY', 409);
    if (checkNode) {
      const node = await tx.workflowNode.findFirst({ where: { id: existing.nodeId, organizationId: input.organizationId } });
      if (!node) workflowError('WORKFLOW_NODE_FORBIDDEN', 403);
      await this.authorizeNode(tx, input, node);
    }
    return existing.response as unknown as WorkflowActionResult;
  }

}
