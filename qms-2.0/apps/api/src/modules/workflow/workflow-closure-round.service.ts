import { BadRequestException, HttpException, Injectable, Optional } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { isUUID } from 'class-validator';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../database/prisma.service.js';
import { effectivePositionAssignmentWhere } from '../../common/security/effective-role-grants.js';
import { isSecurityConcurrencyConflict, mfaPolicy } from '../../common/security/session-security.js';
import { AuditLogService } from '../audit-log/audit-log.service.js';
import { OrganizationResponsibilityService } from '../organization/organization-responsibility.service.js';
import { OutboxService } from '../task-notification/outbox.service.js';
import { assertWorkflowFeature, canProcessWorkflowNode, featurePredicate, type WorkflowActor } from './workflow-access-policy.js';
import { WorkflowClosureRegistry } from './workflow-closure-registry.js';
import { planWorkflowClosure, type WorkflowClosureParticipant, type WorkflowClosurePlan } from './workflow-closure-policy.js';
import { canonical, jsonObject, workflowError } from './workflow-runtime-policy.js';
import type { WorkflowClosureAdapter, WorkflowClosureCancelInput, WorkflowClosureContext, WorkflowClosureDecideInput, WorkflowClosureDuty, WorkflowClosureDutyProjection, WorkflowClosureDutyRecord, WorkflowClosureFlowRecord, WorkflowClosureOperation, WorkflowClosureRound, WorkflowClosureSnapshot, WorkflowClosureStartInput, WorkflowSupplierSubmissionInput } from './workflow-closure-round.types.js';

const roundColumns = Prisma.sql`id, organization_id AS "organizationId", problem_id AS "problemId", instance_id AS "instanceId",
  workflow_version_id AS "workflowVersionId", node_id AS "nodeId", content_version AS "contentVersion", content_snapshot AS "contentSnapshot",
  context, round_number AS "roundNumber", status, version, created_by AS "createdBy", created_at AS "createdAt", updated_at AS "updatedAt"`;
const dutyColumns = Prisma.sql`id, organization_id AS "organizationId", round_id AS "roundId", duty, status, user_id AS "userId", participant,
  decided_by AS "decidedBy", comment, decided_at AS "decidedAt", version`;
type RoundRow = Omit<WorkflowClosureRound, 'duties' | 'createdAt' | 'updatedAt'> & { createdAt: Date; updatedAt: Date };
type DutyRow = Omit<WorkflowClosureDutyRecord, 'decidedAt'> & { decidedAt: Date | null };
type CommandInput = WorkflowClosureStartInput | WorkflowClosureDecideInput | WorkflowClosureCancelInput;
const allDuties: WorkflowClosureDuty[] = ['PROFESSIONAL', 'SECTION_MANAGER', 'MINISTER'];

@Injectable()
export class WorkflowClosureRoundService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditLogService,
    private readonly responsibilities: OrganizationResponsibilityService, private readonly registry: WorkflowClosureRegistry,
    @Optional() private readonly outbox: OutboxService = new OutboxService(prisma)) {}

  async start(actor: WorkflowActor, problemId: string, input: WorkflowClosureStartInput, key: string, traceId: string, transaction?: Prisma.TransactionClient): Promise<WorkflowClosureRound> {
    this.validateInput('SUBMIT', problemId, input, key);
    return this.command(actor, problemId, input, key, traceId, 'SUBMIT', transaction);
  }

  // Only the supplier domain's immutable submission transaction can bridge an external creator.
  async startForSupplierSubmission(tx: Prisma.TransactionClient, actor: WorkflowActor, problemId: string,
    input: WorkflowSupplierSubmissionInput, traceId: string): Promise<WorkflowClosureRound> {
    this.uuid(problemId);
    if (!input || typeof input !== 'object' || Array.isArray(input)
      || Object.keys(input).length !== 4 || Object.keys(input).some(key => !['supplierProblemId', 'responseRevisionId', 'expectedContentVersion', 'expectedInstanceVersion'].includes(key))) {
      throw new BadRequestException();
    }
    this.uuid(input.supplierProblemId); this.uuid(input.responseRevisionId);
    if (!this.positive(input.expectedContentVersion) || !this.positive(input.expectedInstanceVersion)) throw new BadRequestException();
    const accountType = actor.accountType === 'SUPPLIER' ? 'SUPPLIER' : 'INTERNAL';
    await this.authorize(tx, actor, accountType);
    await assertWorkflowFeature(tx, actor, actor.organizationId, 'supplier-quality:responses:write');
    await tx.$queryRaw`SELECT id FROM problem_indexes WHERE id = ${problemId}::uuid AND domain_code = 'supplier-quality' FOR UPDATE`;
    const problem = await tx.problemIndex.findUnique({ where: { id: problemId } });
    if (!problem || problem.domainCode !== 'supplier-quality' || problem.sourceType !== 'supplier-quality'
      || problem.sourceId !== input.supplierProblemId) workflowError('WORKFLOW_NODE_FORBIDDEN', 403);
    const adapter = this.registry.get('supplier-quality');
    if (!adapter.lockSupplierSubmission) workflowError('WORKFLOW_ACTION_INVALID', 409);
    const context = await adapter.lockSupplierSubmission(tx, actor, problemId, input);
    const { active } = await this.validateContext(tx, problem.organizationId, problemId, context, adapter, true);
    if (!active || context.policy !== 'SUPPLIER') workflowError('WORKFLOW_ACTION_INVALID', 409);
    if (context.contentVersion !== input.expectedContentVersion || context.instanceVersion !== input.expectedInstanceVersion) workflowError('CONCURRENCY_CONFLICT', 409);
    const plan = await this.plan(tx, context);
    if (plan.duties.some(duty => !duty.participant)) workflowError('STRUCTURE_REFERENCE_INVALID', 409);
    const current = await this.readProjection(tx, context.organizationId, problemId);
    if (current?.status === 'PENDING') workflowError('CONCURRENCY_CONFLICT', 409);
    await this.authorize(tx, actor, accountType);
    await assertWorkflowFeature(tx, actor, actor.organizationId, 'supplier-quality:responses:write');
    const result = await this.createRound(tx, actor, context, plan, (current?.roundNumber ?? 0) + 1, input.responseRevisionId);
    await this.audit.record({ organizationId: context.organizationId, actorUserId: actor.id, action: 'WORKFLOW_CLOSURE_CHANGED',
      resourceType: 'WorkflowClosureRound', resourceId: result.id, outcome: 'SUCCESS', traceId,
      metadata: { status: result.status, resourceVersion: result.version } }, tx);
    await this.outbox.enqueue({ eventKey: `closure:${result.id}:${result.version}`, eventType: 'WORKFLOW_CLOSURE_CHANGED',
      aggregateType: 'WorkflowClosureRound', aggregateId: result.id,
      payload: { schemaVersion: 1, organizationId: result.organizationId, problemId: result.problemId, roundId: result.id, roundVersion: result.version } }, tx);
    return result;
  }

  async decide(actor: WorkflowActor, roundId: string, input: WorkflowClosureDecideInput, key: string, traceId: string, transaction?: Prisma.TransactionClient): Promise<WorkflowClosureRound> {
    this.validateInput('DECIDE', roundId, input, key);
    return this.command(actor, roundId, input, key, traceId, 'DECIDE', transaction);
  }

  async cancel(actor: WorkflowActor, roundId: string, input: WorkflowClosureCancelInput, key: string, traceId: string, transaction?: Prisma.TransactionClient): Promise<WorkflowClosureRound> {
    this.validateInput('CANCEL', roundId, input, key);
    return this.command(actor, roundId, input, key, traceId, 'CANCEL', transaction);
  }

  async history(actor: WorkflowActor, problemId: string): Promise<WorkflowClosureRound[]> {
    this.uuid(problemId);
    return this.inTransaction(undefined, async tx => {
      await this.authorize(tx, actor);
      await this.context(tx, actor, problemId, 'READ');
      const rows = await tx.$queryRaw<RoundRow[]>(Prisma.sql`SELECT ${roundColumns} FROM workflow_closure_rounds
        WHERE organization_id = ${actor.organizationId}::uuid AND problem_id = ${problemId}::uuid ORDER BY round_number DESC`);
      const rounds = await Promise.all(rows.map(row => this.hydrate(tx, row)));
      const userIds = [...new Set(rounds.flatMap(round => round.duties.map(duty => duty.userId)))];
      const users = userIds.length ? await tx.user.findMany({
        where: { organizationId: actor.organizationId, id: { in: userIds } },
        select: { id: true, fullName: true },
      }) : [];
      const names = new Map(users.map(user => [user.id, user.fullName?.trim() || null]));
      await this.authorize(tx, actor);
      return rounds.map(round => ({ ...round, duties: round.duties.map(duty => ({
        ...duty, userDisplayName: names.get(duty.userId) ?? null,
      })) }));
    });
  }

  async readSnapshot(tx: Prisma.TransactionClient, actor: WorkflowActor, problemId: string): Promise<WorkflowClosureSnapshot> {
    return (await this.snapshotWithAdapter(tx, actor, problemId)).snapshot;
  }

  private async snapshotWithAdapter(tx: Prisma.TransactionClient, actor: WorkflowActor, problemId: string) {
    this.uuid(problemId);
    await this.authorize(tx, actor);
    const { context, active, adapter } = await this.context(tx, actor, problemId, 'READ');
    const plan = await this.plan(tx, context);
    const current = await this.readProjection(tx, context.organizationId, problemId);
    await this.authorize(tx, actor);
    return { adapter, active, snapshot: { context, plan, current, sourcesCurrent: active && !!current && this.sameSources(current, context, plan) } };
  }

  // Server-side facts only: callers must authorize their own reader and recheck eligibility before delivery.
  async readProjection(tx: Prisma.TransactionClient, organizationId: string, problemId: string): Promise<WorkflowClosureRound | null> {
    this.uuid(organizationId); this.uuid(problemId);
    const [row] = await tx.$queryRaw<RoundRow[]>(Prisma.sql`SELECT ${roundColumns} FROM workflow_closure_rounds
      WHERE organization_id = ${organizationId}::uuid AND problem_id = ${problemId}::uuid ORDER BY round_number DESC LIMIT 1`);
    return row ? this.hydrate(tx, row) : null;
  }

  // Trusted domain readers authorize scope before requesting the complete saved history.
  async readHistoryProjection(tx: Prisma.TransactionClient, organizationId: string, problemId: string): Promise<WorkflowClosureRound[]> {
    this.uuid(organizationId); this.uuid(problemId);
    const rows = await tx.$queryRaw<RoundRow[]>(Prisma.sql`SELECT ${roundColumns} FROM workflow_closure_rounds
      WHERE organization_id = ${organizationId}::uuid AND problem_id = ${problemId}::uuid ORDER BY round_number DESC`);
    return Promise.all(rows.map(row => this.hydrate(tx, row)));
  }

  async reconcileProcessManagement(tx: Prisma.TransactionClient, context: WorkflowClosureContext): Promise<boolean> {
    const adapter = this.registry.get('process-quality');
    if (!adapter.completeProcessAfterManagementSkip) return false;
    const { active } = await this.validateContext(tx, context.organizationId, context.problemId, context, adapter, true);
    if (!active) return false;
    const saved = await this.readProjection(tx, context.organizationId, context.problemId);
    if (!saved || saved.status !== 'PENDING' || !this.sameRoundFacts(saved, context)) return false;
    const management = saved.duties.find(duty => duty.duty !== 'PROFESSIONAL' && duty.status === 'PENDING');
    const professional = saved.duties.find(duty => duty.duty === 'PROFESSIONAL');
    if (!management || !professional) return false;
    if (!saved.context.processManagement) {
      const legacy = await this.plan(tx, { ...context, processManagement: undefined });
      if (this.samePendingSource(management, legacy) && await this.processParticipantEligible(tx, context.organizationId, management.userId)) return false;
    }
    const processContext: WorkflowClosureContext = { ...context, processManagement: true };
    const plan = await this.planProcessClosure(tx, processContext, management.participant?.scopeId);
    const replacement = plan.duties.find(duty => duty.duty === management.duty);
    if (replacement?.participant && canonical(replacement.participant) === canonical(management.participant) && replacement.status === 'PENDING') return false;
    const current = await this.round(tx, context.organizationId, saved.id, true);
    if (current?.version !== saved.version || current.status !== 'PENDING') workflowError('CONCURRENCY_CONFLICT', 409);
    const updated = replacement?.participant
      ? await tx.$executeRaw`UPDATE workflow_closure_duties SET user_id = ${replacement.participant.userId}::uuid,
          participant = ${JSON.stringify(replacement.participant)}::jsonb, status = ${replacement.status}, version = version + 1
          WHERE id = ${management.id}::uuid AND round_id = ${current.id}::uuid AND status = 'PENDING'`
      : await tx.$executeRaw`DELETE FROM workflow_closure_duties WHERE id = ${management.id}::uuid AND round_id = ${current.id}::uuid AND status = 'PENDING'`;
    if (updated !== 1) workflowError('CONCURRENCY_CONFLICT', 409);
    const records = await this.recordProcessDispatch(tx, context.organizationId, { ...plan,
      duties: replacement ? [replacement] : [], managementEvent: plan.managementEvent ?? (replacement?.status === 'PENDING' ? { content: '审核职责已变更，重新分配管理审核' } : undefined) });
    const history = current.context.flowRecords ?? [];
    if (!current.context.processManagement) {
      const priorReviewer = await this.processDisplayName(tx, context.organizationId, management.userId);
      history.push({ occurredAt: current.createdAt, person: '系统', content: `管理审核派给${priorReviewer}` });
    }
    const complete = professional.status === 'APPROVED' && replacement?.status !== 'PENDING';
    await tx.$executeRaw`UPDATE workflow_closure_rounds SET context = context || ${JSON.stringify({
      processManagement: true, flowRecords: [...history, ...records], ...(complete ? { closedAfterManagementSkip: true } : {}),
    })}::jsonb WHERE id = ${current.id}::uuid`;
    await this.bump(tx, current, complete ? 'APPROVED' : 'PENDING');
    if (complete) await adapter.completeProcessAfterManagementSkip(tx, processContext);
    const version = current.version + 1;
    await this.audit.record({ organizationId: context.organizationId, action: 'WORKFLOW_CLOSURE_CHANGED', resourceType: 'WorkflowClosureRound',
      resourceId: current.id, outcome: 'SUCCESS', traceId: randomUUID(), metadata: { status: complete ? 'APPROVED' : 'PENDING', resourceVersion: version } }, tx);
    await this.outbox.enqueue({ eventKey: `closure:${current.id}:${version}`, eventType: 'WORKFLOW_CLOSURE_CHANGED',
      aggregateType: 'WorkflowClosureRound', aggregateId: current.id, payload: { schemaVersion: 1,
        organizationId: current.organizationId, problemId: current.problemId, roundId: current.id, roundVersion: version } }, tx);
    return true;
  }

  async eligible(tx: Prisma.TransactionClient, actor: WorkflowActor, snapshot: WorkflowClosureSnapshot, duty: WorkflowClosureDuty): Promise<boolean> {
    try {
      const { snapshot: fresh, adapter, active } = await this.snapshotWithAdapter(tx, actor, snapshot.context.problemId);
      if (!active || !fresh.current || fresh.current.id !== snapshot.current?.id || fresh.current.version !== snapshot.current.version) return false;
      return this.pendingFor(fresh.current, actor, duty)
        && this.dutySourceCurrent(adapter, fresh, duty)
        && (!adapter.isParticipantStageEligible || await adapter.isParticipantStageEligible(tx, fresh.context, actor.id));
    } catch (error) {
      if (error instanceof HttpException && [401, 403, 404, 409].includes(error.getStatus())) return false;
      throw error;
    }
  }

  async eligibleDuties(actor: WorkflowActor, transaction?: Prisma.TransactionClient): Promise<WorkflowClosureDutyProjection[]> {
    return this.inTransaction(transaction, async tx => {
      await this.authorize(tx, actor);
      const candidates = await tx.$queryRaw<{ problemId: string }[]>`SELECT DISTINCT r.problem_id AS "problemId"
        FROM workflow_closure_rounds r JOIN workflow_closure_duties d ON d.organization_id = r.organization_id AND d.round_id = r.id
        WHERE r.organization_id = ${actor.organizationId}::uuid AND r.status = 'PENDING' AND d.status = 'PENDING' AND d.user_id = ${actor.id}::uuid`;
      const results: WorkflowClosureDutyProjection[] = [];
      for (const candidate of candidates) {
        try {
          const { snapshot, adapter, active } = await this.snapshotWithAdapter(tx, actor, candidate.problemId);
          if (!active || !snapshot.current) continue;
          if (adapter.isParticipantStageEligible && !await adapter.isParticipantStageEligible(tx, snapshot.context, actor.id)) continue;
          const r = snapshot.current;
          for (const duty of r.duties.filter(d => this.pendingFor(r, actor, d.duty) && this.dutySourceCurrent(adapter, snapshot, d.duty))) {
            results.push({ organizationId: r.organizationId, problemId: r.problemId, roundId: r.id, roundVersion: r.version, roundNumber: r.roundNumber,
              duty: duty.duty, participant: duty.participant,
              samePersonDuties: snapshot.plan.samePersonGroups.find(group => group.userId === actor.id)?.duties ?? [] });
          }
        } catch (error) {
          if (!(error instanceof HttpException) || ![403, 404, 409].includes(error.getStatus())) throw error;
        }
      }
      await this.authorize(tx, actor);
      return results;
    });
  }

  async notificationRecipients(tx: Prisma.TransactionClient, organizationId: string, problemId: string, roundId: string, roundVersion: number): Promise<string[]> {
    this.uuid(organizationId); this.uuid(problemId); this.uuid(roundId);
    if (!this.positive(roundVersion)) throw new BadRequestException();
    // Same domain -> users -> structure lock order as commands; no session is synthesized for a recipient.
    await tx.$queryRaw`SELECT id FROM problem_indexes WHERE organization_id = ${organizationId}::uuid AND id = ${problemId}::uuid FOR SHARE`;
    const problem = await tx.problemIndex.findFirst({ where: { id: problemId, organizationId } });
    if (!problem || !this.registry.hasDomain(problem.domainCode)) return [];
    const adapter = this.registry.get(problem.domainCode);
    if (!adapter.canNotifyRecipient) return [];
    const current = await this.readProjection(tx, organizationId, problemId);
    if (!current || current.id !== roundId || current.version !== roundVersion || current.status !== 'PENDING') return [];
    const { flowRecords: _flowRecords, closedAfterManagementSkip: _closedAfterManagementSkip, ...c } = current.context;
    if (c.organizationId !== organizationId || c.problemId !== problemId || problem.workflowInstanceId !== current.instanceId) return [];
    await tx.$queryRaw`SELECT id FROM workflow_instances WHERE organization_id = ${organizationId}::uuid AND id = ${current.instanceId}::uuid FOR SHARE`;
    const instance = await tx.workflowInstance.findFirst({ where: { id: current.instanceId, organizationId }, include: { currentNode: true, workflowVersion: true } });
    if (!instance || instance.status !== 'RUNNING' || instance.problemIndexId !== problemId || instance.version !== c.instanceVersion
      || instance.workflowVersionId !== current.workflowVersionId || instance.currentNodeId !== current.nodeId
      || instance.workflowVersion.organizationId !== organizationId || instance.workflowVersion.status !== 'PUBLISHED'
      || instance.currentNode?.organizationId !== organizationId || instance.currentNode.workflowVersionId !== current.workflowVersionId
      || problem.ownerId !== c.ownerUserId || problem.severity !== c.severity || problem.archivedAt || problem.closedAt || ['CLOSED', 'ARCHIVED'].includes(problem.status)) return [];
    const config = jsonObject(instance.currentNode.config);
    const gate = jsonObject(config.closureReview);
    if (instance.currentNode.type !== 'APPROVAL' || config.isStart === true || config.isEnd === true || 'assignment' in config
      || gate.schemaVersion !== 1 || gate.policy !== c.policy || gate.domainCode !== adapter.domainCode) return [];
    await adapter.lockParticipantStageConfiguration?.(tx, c);
    const plan = await this.plan(tx, c);
    const snapshot = { context: c, current, plan, sourcesCurrent: this.sameSources(current, c, plan) };
    const recipients: string[] = [];
    for (const userId of new Set(current.duties.filter(d => d.status === 'PENDING' && this.dutySourceCurrent(adapter, snapshot, d.duty)).map(d => d.userId))) {
      const user = await tx.user.findFirst({ where: { id: userId, organizationId, accountType: 'INTERNAL', status: 'ACTIVE', organization: { status: 'ACTIVE', type: 'INTERNAL' } }, select: { id: true } });
      if (!user || !await canProcessWorkflowNode(tx, userId, organizationId, { assigneeUserId: userId })) continue;
      if (adapter.isParticipantStageEligible && !await adapter.isParticipantStageEligible(tx, c, userId)) continue;
      const [features] = await tx.$queryRaw<{ allowed: boolean }[]>`SELECT
        (${featurePredicate(Prisma.sql`${userId}::uuid`, Prisma.sql`${organizationId}::uuid`, Prisma.sql`'task:read'`)}
          AND ${featurePredicate(Prisma.sql`${userId}::uuid`, Prisma.sql`${organizationId}::uuid`, Prisma.sql`'notification:read'`)}) AS allowed`;
      if (features?.allowed && await adapter.canNotifyRecipient(tx, c, userId)) recipients.push(userId);
    }
    return recipients;
  }

  private async command(actor: WorkflowActor, id: string, input: CommandInput, key: string, traceId: string, operation: Exclude<WorkflowClosureOperation, 'READ'>, transaction?: Prisma.TransactionClient): Promise<WorkflowClosureRound> {
    return this.inTransaction(transaction, async tx => {
      await this.authorize(tx, actor);
      const digest = createHash('sha256').update(canonical({ operation, id, input, actor: { id: actor.id, organizationId: actor.organizationId, accountType: actor.accountType } })).digest('hex');
      const before = operation === 'SUBMIT' ? null : await this.round(tx, actor.organizationId, id);
      if (operation !== 'SUBMIT' && !before) workflowError('WORKFLOW_INSTANCE_NOT_FOUND', 404);
      const problemId = before?.problemId ?? id;
      // Outer callers may already have written the problem. Both paths lock problem before the actor/key receipt.
      const [problem] = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM problem_indexes
        WHERE organization_id = ${actor.organizationId}::uuid AND id = ${problemId}::uuid FOR UPDATE`;
      if (!problem) workflowError('ORGANIZATION_SCOPE_DENIED', 403);
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`closure:${actor.organizationId}:${actor.id}:${key}`}, 0))::text`;
      await this.authorize(tx, actor);
      const [receipt] = await tx.$queryRaw<{ digest: string; response: WorkflowClosureRound }[]>`SELECT digest, response FROM workflow_closure_receipts
        WHERE organization_id = ${actor.organizationId}::uuid AND actor_user_id = ${actor.id}::uuid AND key = ${key}`;
      // The adapter locks problem -> instance -> domain content. Resolver then locks users -> structure.
      // All subsequent identity checks are reads, never a late actor FOR UPDATE.
      const { context, adapter, active } = await this.context(tx, actor, problemId, operation, !receipt);
      const plan = await this.plan(tx, receipt && adapter.domainCode === 'process-quality'
        ? { ...context, processManagement: receipt.response.context.processManagement } : context);
      await this.authorize(tx, actor);
      if (operation === 'SUBMIT') await this.assertOwner(tx, actor, context);
      if (receipt) {
        if (receipt.digest !== digest) workflowError('IDEMPOTENCY_REPLAY', 409);
        if (operation === 'DECIDE') this.assertReplayParticipant(actor, receipt.response, input as WorkflowClosureDecideInput, plan);
        return receipt.response;
      }
      if (!active) workflowError('WORKFLOW_ACTION_INVALID', 409);
      let result: WorkflowClosureRound;
      if (operation === 'SUBMIT') {
        const body = input as WorkflowClosureStartInput;
        if (body.expectedContentVersion !== context.contentVersion || body.expectedInstanceVersion !== context.instanceVersion) workflowError('CONCURRENCY_CONFLICT', 409);
        const current = await this.readProjection(tx, context.organizationId, problemId);
        if (current?.status === 'PENDING') {
          if (this.sameSources(current, context, plan)
            || adapter.domainCode === 'process-quality' && this.sameRoundFacts(current, context)) workflowError('CONCURRENCY_CONFLICT', 409);
          result = await this.endRound(tx, actor, current, context, adapter, 'CANCELLED', 'SOURCE_CHANGED');
        } else {
          await adapter.assertStartParticipants?.(tx, context, plan);
          if (plan.duties.some(d => !d.participant)) workflowError('STRUCTURE_REFERENCE_INVALID', 409);
          result = await this.createRound(tx, actor, context, plan, (current?.roundNumber ?? 0) + 1);
        }
      } else {
        const current = await this.round(tx, actor.organizationId, id, true);
        if (!current || current.status !== 'PENDING' || current.version !== (input as WorkflowClosureDecideInput | WorkflowClosureCancelInput).expectedRoundVersion) workflowError('CONCURRENCY_CONFLICT', 409);
        if (current.instanceId !== context.instanceId || current.workflowVersionId !== context.workflowVersionId || current.nodeId !== context.currentNodeId
          || current.context.instanceVersion !== context.instanceVersion || current.contentVersion !== context.contentVersion
          || canonical(current.contentSnapshot) !== canonical(context.content)) workflowError('CONCURRENCY_CONFLICT', 409);
        if (operation === 'DECIDE') {
          for (const duty of (input as WorkflowClosureDecideInput).duties) {
            const stored = current.duties.find(d => d.duty === duty);
            if (stored?.userId !== actor.id) workflowError('WORKFLOW_NODE_FORBIDDEN', 403);
            if (stored.status !== 'PENDING') workflowError('WORKFLOW_ACTION_INVALID', 409);
            if (adapter.domainCode === 'process-quality' && this.sameRoundFacts(current, context)
              && (!this.samePendingSource(stored, plan) || !await this.processParticipantEligible(tx, context.organizationId, actor.id))) {
              workflowError('WORKFLOW_NODE_FORBIDDEN', 403);
            }
          }
        }
        if (!(adapter.domainCode === 'process-quality' ? this.sameRoundFacts(current, context) : this.sameSources(current, context, plan))) {
          result = await this.endRound(tx, actor, current, context, adapter, 'CANCELLED', 'SOURCE_CHANGED');
        } else if (operation === 'CANCEL') {
          result = await this.endRound(tx, actor, current, context, adapter, 'CANCELLED', (input as WorkflowClosureCancelInput).reason);
        } else {
          result = await this.applyDecision(tx, actor, current, context, plan, adapter, input as WorkflowClosureDecideInput);
        }
      }
      await this.authorize(tx, actor);
      await this.audit.record({ organizationId: context.organizationId, actorUserId: actor.id, action: 'WORKFLOW_CLOSURE_CHANGED',
        resourceType: 'WorkflowClosureRound', resourceId: result.id, outcome: 'SUCCESS', traceId,
        metadata: { status: result.status, resourceVersion: result.version } }, tx);
      await this.outbox.enqueue({ eventKey: `closure:${result.id}:${result.version}`, eventType: 'WORKFLOW_CLOSURE_CHANGED', aggregateType: 'WorkflowClosureRound', aggregateId: result.id,
        payload: { schemaVersion: 1, organizationId: result.organizationId, problemId: result.problemId, roundId: result.id, roundVersion: result.version } }, tx);
      await tx.$executeRaw`INSERT INTO workflow_closure_receipts (organization_id, actor_user_id, key, digest, response)
        VALUES (${actor.organizationId}::uuid, ${actor.id}::uuid, ${key}, ${digest}, ${JSON.stringify(result)}::jsonb)`;
      return result;
    });
  }

  private async context(tx: Prisma.TransactionClient, actor: WorkflowActor, problemId: string, operation: WorkflowClosureOperation, enforceGate = operation !== 'READ') {
    const before = await tx.problemIndex.findUnique({ where: { id: problemId } });
    if (!before || before.organizationId !== actor.organizationId) workflowError('ORGANIZATION_SCOPE_DENIED', 403);
    const adapter = this.registry.get(before.domainCode);
    const context = await adapter.lockAndRead(tx, actor, problemId, operation);
    return this.validateContext(tx, actor.organizationId, problemId, context, adapter, enforceGate);
  }

  private async validateContext(tx: Prisma.TransactionClient, organizationId: string, problemId: string,
    context: WorkflowClosureContext, adapter: WorkflowClosureAdapter, enforceGate: boolean) {
    const problem = await tx.problemIndex.findUnique({ where: { id: problemId } });
    const instance = await tx.workflowInstance.findFirst({ where: { id: context.instanceId, organizationId }, include: { currentNode: true, workflowVersion: true } });
    if (!problem || problem.organizationId !== organizationId || context.organizationId !== organizationId || context.problemId !== problem.id || problem.domainCode !== adapter.domainCode
      || problem.workflowInstanceId !== context.instanceId || instance?.problemIndexId !== problem.id
      || instance.workflowVersionId !== context.workflowVersionId || instance.currentNodeId !== context.currentNodeId
      || instance.version !== context.instanceVersion || instance.workflowVersion.organizationId !== context.organizationId
      || instance.workflowVersion.status !== 'PUBLISHED' || instance.currentNode?.organizationId !== context.organizationId
      || instance.currentNode.workflowVersionId !== context.workflowVersionId || context.ownerUserId !== problem.ownerId || context.severity !== problem.severity) {
      workflowError('CONCURRENCY_CONFLICT', 409);
    }
    const config = jsonObject(instance.currentNode.config);
    const gate = jsonObject(config.closureReview);
    if (enforceGate && (instance.currentNode.type !== 'APPROVAL' || config.isStart === true || config.isEnd === true || 'assignment' in config
      || gate.schemaVersion !== 1 || gate.policy !== context.policy || gate.domainCode !== adapter.domainCode)) workflowError('WORKFLOW_ACTION_INVALID', 409);
    for (const id of [context.responsibleSectionDepartmentId, context.ownerUserId, context.professionalUserId]) this.uuid(id);
    if (!this.positive(context.contentVersion) || !this.positive(context.instanceVersion)) workflowError('WORKFLOW_ACTION_INVALID', 409);
    this.validateContent(context.content);
    const active = instance.status === 'RUNNING' && problem.archivedAt === null && problem.closedAt === null && !['CLOSED', 'ARCHIVED'].includes(problem.status);
    return { context, adapter, active };
  }

  async plan(tx: Prisma.TransactionClient, c: Pick<WorkflowClosureContext, 'organizationId' | 'responsibleSectionDepartmentId' | 'professionalUserId' | 'ownerUserId' | 'policy' | 'severity' | 'processManagement'>): Promise<WorkflowClosurePlan> {
    if (c.processManagement) return this.planProcessClosure(tx, c);
    const management = await this.responsibilities.resolveManagementResponsibilities(tx, c.organizationId, c.responsibleSectionDepartmentId);
    // Resolver time precedes lock waits. Revalidate only its locked identities, never resolve new users after structure locks.
    const now = new Date();
    const validSources = await this.responsibilities.revalidateLockedManagementResponsibilities(tx, management, now);
    const professionalActive = await tx.user.findFirst({ where: { id: c.professionalUserId, organizationId: c.organizationId, status: 'ACTIVE', accountType: 'INTERNAL',
      positions: { some: { organizationId: c.organizationId, ...effectivePositionAssignmentWhere(now), AND: { position: { departmentId: { not: null } } } } } }, select: { id: true } });
    const professional: WorkflowClosureParticipant | null = professionalActive && await canProcessWorkflowNode(tx, c.professionalUserId, c.organizationId, { assigneeUserId: c.professionalUserId })
      ? { userId: c.professionalUserId, assignmentId: null, positionId: null, departmentId: null, bindingId: null, scopeId: null, bindingVersion: null, scopeVersion: null } : null;
    const participant = (duty: 'SECTION_MANAGER' | 'MINISTER'): WorkflowClosureParticipant | null => {
      if (management.issues.some(issue => issue.responsibility === duty)) return null;
      const source = management.responsibilities.find(r => r.responsibility === duty);
      return source && validSources.has(source.bindingId) ? { userId: source.userId, assignmentId: source.assignmentId, positionId: source.positionId, departmentId: source.departmentId,
        bindingId: source.bindingId, bindingVersion: source.bindingVersion, scopeId: source.scopeId, scopeVersion: source.scopeVersion } : null;
    };
    return planWorkflowClosure({ policy: c.policy, severity: c.severity, ownerUserId: c.ownerUserId, professional, sectionManager: participant('SECTION_MANAGER'), minister: participant('MINISTER') });
  }

  private async planProcessClosure(tx: Prisma.TransactionClient, c: Pick<WorkflowClosureContext, 'organizationId' | 'responsibleSectionDepartmentId' | 'professionalUserId' | 'ownerUserId' | 'severity'>,
    previousScopeId?: string | null) {
    const eligible = (userId: string) => this.processParticipantEligible(tx, c.organizationId, userId);
    const highRisk = ['HIGH', 'CRITICAL'].includes(c.severity);
    const processManagement = await this.responsibilities.resolveProcessClosureManagement(tx, c.organizationId, c.responsibleSectionDepartmentId, highRisk, eligible, [c.professionalUserId], previousScopeId);
    const professionalActive = await tx.user.findFirst({ where: { id: c.professionalUserId, organizationId: c.organizationId, status: 'ACTIVE', accountType: 'INTERNAL',
      deletedAt: null, configurationRequired: false }, select: { id: true } });
    const professional: WorkflowClosureParticipant | null = professionalActive && await eligible(c.professionalUserId)
      ? { userId: c.professionalUserId, assignmentId: null, positionId: null, departmentId: null, bindingId: null, scopeId: null, bindingVersion: null, scopeVersion: null } : null;
    return planWorkflowClosure({ ...c, policy: 'INTERNAL', professional, sectionManager: null, minister: null, processManagement });
  }

  private async processParticipantEligible(tx: Prisma.TransactionClient, organizationId: string, userId: string): Promise<boolean> {
    if (!await canProcessWorkflowNode(tx, userId, organizationId, { assigneeUserId: userId })) return false;
    const [result] = await tx.$queryRaw<{ allowed: boolean }[]>(Prisma.sql`SELECT ${featurePredicate(Prisma.sql`${userId}::uuid`, Prisma.sql`${organizationId}::uuid`, Prisma.sql`'process-quality:issues:read'`)} AS allowed`);
    return result?.allowed === true;
  }

  async assertActor(tx: Prisma.TransactionClient, actor: WorkflowActor): Promise<void> {
    return this.authorize(tx, actor);
  }

  private async authorize(tx: Prisma.TransactionClient, actor: WorkflowActor, accountType: 'INTERNAL' | 'SUPPLIER' = 'INTERNAL') {
    this.uuid(actor.id); this.uuid(actor.organizationId);
    if (!actor.sessionId || !isUUID(actor.sessionId)) workflowError('AUTH_SESSION_REQUIRED', 401);
    if (actor.accountType !== accountType) workflowError('ORGANIZATION_SCOPE_DENIED', 403);
    await assertWorkflowFeature(tx, actor, actor.organizationId, 'workflow:act');
    const session = await tx.session.findFirst({ where: { id: actor.sessionId, userId: actor.id, revokedAt: null, expiresAt: { gt: new Date() }, user: { mustChangePassword: false } },
      select: { securityVersion: true, mfaVerifiedAt: true, user: { select: { securityVersion: true, organization: { select: { type: true } } } } } });
    if (!session || session.securityVersion !== session.user.securityVersion) workflowError('AUTH_SESSION_REQUIRED', 401);
    if (session.user.organization.type !== accountType) workflowError('ORGANIZATION_SCOPE_DENIED', 403);
    if ((await mfaPolicy(tx, actor.id)).required && !session.mfaVerifiedAt) workflowError('AUTH_MFA_REQUIRED', 401);
  }

  private async assertOwner(tx: Prisma.TransactionClient, actor: WorkflowActor, c: WorkflowClosureContext) {
    if (actor.id !== c.ownerUserId) workflowError('WORKFLOW_NODE_FORBIDDEN', 403);
    const assignment = await tx.userPosition.findFirst({ where: { organizationId: c.organizationId, userId: actor.id,
      ...effectivePositionAssignmentWhere(), position: { organizationId: c.organizationId, departmentId: c.responsibleSectionDepartmentId, status: 'ACTIVE', department: { status: 'ACTIVE' } } } });
    if (!assignment) workflowError('WORKFLOW_NODE_FORBIDDEN', 403);
  }

  private sameRoundFacts(round: WorkflowClosureRound, c: WorkflowClosureContext): boolean {
    const previous = round.context;
    return round.instanceId === c.instanceId && round.workflowVersionId === c.workflowVersionId && round.nodeId === c.currentNodeId
      && round.contentVersion === c.contentVersion && previous.instanceVersion === c.instanceVersion
      && canonical(round.contentSnapshot) === canonical(c.content)
      && previous.ownerUserId === c.ownerUserId && previous.professionalUserId === c.professionalUserId
      && previous.responsibleSectionDepartmentId === c.responsibleSectionDepartmentId && previous.policy === c.policy && previous.severity === c.severity;
  }

  private sameSources(round: WorkflowClosureRound, c: WorkflowClosureContext, plan: WorkflowClosurePlan): boolean {
    if (!this.sameRoundFacts(round, c)) return false;
    if (round.context.processManagement && c.processManagement) {
      return round.duties.filter(duty => duty.status === 'PENDING' || duty.status === 'WAITING').every(duty => this.samePendingSource(duty, plan));
    }
    return round.duties.length === plan.duties.length && plan.duties.every(d => d.participant !== null
        && canonical(d.participant) === canonical(round.duties.find(old => old.duty === d.duty)?.participant)
        && (d.status === 'SKIPPED_SAME_PERSON') === (round.duties.find(old => old.duty === d.duty)?.status === 'SKIPPED_SAME_PERSON'));
  }

  private samePendingSource(duty: WorkflowClosureDutyRecord, plan: WorkflowClosurePlan): boolean {
    const live = plan.duties.find(candidate => candidate.duty === duty.duty);
    return live?.status === duty.status && canonical(live.participant) === canonical(duty.participant);
  }

  private dutySourceCurrent(adapter: WorkflowClosureAdapter, snapshot: WorkflowClosureSnapshot, duty: WorkflowClosureDuty): boolean {
    if (adapter.domainCode !== 'process-quality') return snapshot.sourcesCurrent;
    const { current, context, plan } = snapshot;
    const stored = current?.duties.find(candidate => candidate.duty === duty);
    return !!current && !!stored && this.sameRoundFacts(current, context) && this.samePendingSource(stored, plan);
  }

  private pendingFor(round: WorkflowClosureRound, actor: WorkflowActor, duty: WorkflowClosureDuty): boolean {
    return round.status === 'PENDING' && round.organizationId === actor.organizationId
      && round.duties.some(d => d.duty === duty && d.userId === actor.id && d.status === 'PENDING');
  }

  private assertReplayParticipant(actor: WorkflowActor, round: WorkflowClosureRound, body: WorkflowClosureDecideInput, plan: WorkflowClosurePlan) {
    for (const duty of body.duties) {
      const source = plan.duties.find(d => d.duty === duty)?.participant;
      const stored = round.duties.find(d => d.duty === duty);
      if (!source || source.userId !== actor.id || canonical(source) !== canonical(stored?.participant)) workflowError('WORKFLOW_NODE_FORBIDDEN', 403);
    }
  }

  private async createRound(tx: Prisma.TransactionClient, actor: WorkflowActor, c: WorkflowClosureContext, plan: WorkflowClosurePlan, roundNumber: number, supplierResponseRevisionId: string | null = null) {
    const id = randomUUID();
    const context = c.processManagement ? { ...c, flowRecords: await this.recordProcessDispatch(tx, c.organizationId, plan) } : c;
    await tx.$executeRaw`INSERT INTO workflow_closure_rounds (id, organization_id, problem_id, instance_id, workflow_version_id, node_id, content_version, content_snapshot, context, round_number, created_by, creator_organization_id, supplier_response_revision_id)
      VALUES (${id}::uuid, ${c.organizationId}::uuid, ${c.problemId}::uuid, ${c.instanceId}::uuid, ${c.workflowVersionId}::uuid, ${c.currentNodeId}::uuid,
        ${c.contentVersion}, ${JSON.stringify(c.content)}::jsonb, ${JSON.stringify(context)}::jsonb, ${roundNumber}, ${actor.id}::uuid, ${actor.organizationId}::uuid, ${supplierResponseRevisionId}::uuid)`;
    for (const d of plan.duties) {
      await tx.$executeRaw`INSERT INTO workflow_closure_duties (id, organization_id, round_id, duty, status, user_id, participant)
        VALUES (${randomUUID()}::uuid, ${c.organizationId}::uuid, ${id}::uuid, ${d.duty}, ${d.status}, ${d.participant!.userId}::uuid, ${JSON.stringify(d.participant)}::jsonb)`;
    }
    return (await this.round(tx, c.organizationId, id))!;
  }

  private async processDisplayName(tx: Prisma.TransactionClient, organizationId: string, userId: string) {
    const user = await tx.user.findFirst({ where: { id: userId, organizationId }, select: { fullName: true, username: true } });
    return user?.fullName?.trim() || user?.username || userId;
  }

  private async recordProcessDispatch(tx: Prisma.TransactionClient, organizationId: string, plan: WorkflowClosurePlan): Promise<WorkflowClosureFlowRecord[]> {
    const [time] = await tx.$queryRaw<{ now: Date }[]>`SELECT CURRENT_TIMESTAMP AS now`;
    const occurredAt = time!.now.toISOString();
    const records: WorkflowClosureFlowRecord[] = [];
    for (const duty of plan.duties) {
      if (!duty.participant) continue;
      const name = await this.processDisplayName(tx, organizationId, duty.participant.userId);
      const label = duty.duty === 'PROFESSIONAL' ? '专业审核' : '管理审核';
      if (duty.duty !== 'PROFESSIONAL' && plan.managementEvent) records.push({ occurredAt, person: '系统', content: plan.managementEvent.content });
      records.push({ occurredAt, person: '系统', content: duty.status === 'SKIPPED_SAME_PERSON'
        ? `${name}为问题负责人，跳过管理审核` : `${label}派给${name}` });
    }
    if (!plan.duties.some(duty => duty.duty !== 'PROFESSIONAL') && plan.managementEvent) records.push({ occurredAt, person: '系统', content: plan.managementEvent.content });
    return records;
  }

  private async applyDecision(tx: Prisma.TransactionClient, actor: WorkflowActor, r: WorkflowClosureRound, c: WorkflowClosureContext, plan: WorkflowClosurePlan, adapter: WorkflowClosureAdapter, body: WorkflowClosureDecideInput) {
    for (const duty of body.duties) {
      const record = r.duties.find(d => d.duty === duty);
      if (!record || record.userId !== actor.id) workflowError('WORKFLOW_NODE_FORBIDDEN', 403);
      if (!this.pendingFor(r, actor, duty)) workflowError('WORKFLOW_ACTION_INVALID', 409);
    }
    const group = plan.samePersonGroups.find(g => g.userId === actor.id);
    if (group && body.duties.some(d => group.duties.includes(d)) && canonical([...body.duties].sort()) !== canonical([...group.duties].sort())) workflowError('WORKFLOW_ACTION_INVALID', 409);
    if (body.duties.length > 1 && (!group || body.duties.includes('PROFESSIONAL'))) workflowError('WORKFLOW_ACTION_INVALID', 409);
    await tx.$executeRaw`UPDATE workflow_closure_duties SET status = ${body.decision === 'APPROVE' ? 'APPROVED' : 'CANCELLED'}, decided_by = ${actor.id}::uuid,
      comment = ${body.comment}, decided_at = CURRENT_TIMESTAMP, version = version + 1 WHERE organization_id = ${r.organizationId}::uuid AND round_id = ${r.id}::uuid
      AND duty IN (${Prisma.join(body.duties)})`;
    if (body.decision === 'RETURN') return this.endRound(tx, actor, r, c, adapter, 'RETURNED', body.comment);
    if (c.policy === 'SUPPLIER' && body.duties.includes('PROFESSIONAL')) {
      await tx.$executeRaw`UPDATE workflow_closure_duties SET status = 'PENDING', version = version + 1
        WHERE organization_id = ${r.organizationId}::uuid AND round_id = ${r.id}::uuid AND status = 'WAITING'`;
    }
    const changed = (await this.round(tx, r.organizationId, r.id))!;
    const complete = changed.duties.some(d => d.duty === 'PROFESSIONAL' && d.status === 'APPROVED')
      && changed.duties.every(d => ['APPROVED', 'SKIPPED_SAME_PERSON'].includes(d.status));
    await this.bump(tx, r, complete ? 'APPROVED' : 'PENDING');
    if (complete) await adapter.complete(tx, c, actor);
    return (await this.round(tx, r.organizationId, r.id))!;
  }

  private async endRound(tx: Prisma.TransactionClient, actor: WorkflowActor, r: WorkflowClosureRound, c: WorkflowClosureContext, adapter: WorkflowClosureAdapter, status: 'CANCELLED' | 'RETURNED', reason: string) {
    await tx.$executeRaw`UPDATE workflow_closure_duties SET status = 'CANCELLED', version = version + 1
      WHERE organization_id = ${r.organizationId}::uuid AND round_id = ${r.id}::uuid AND status IN ('PENDING', 'WAITING')`;
    await this.bump(tx, r, status);
    await adapter.returnForChanges(tx, c, actor);
    // The receipt preserves why the terminal transition occurred without overwriting old decisions.
    await tx.$executeRaw`UPDATE workflow_closure_rounds SET context = context || ${JSON.stringify({ endedBy: actor.id, endReason: reason })}::jsonb
      WHERE organization_id = ${r.organizationId}::uuid AND id = ${r.id}::uuid`;
    return (await this.round(tx, r.organizationId, r.id))!;
  }

  private async bump(tx: Prisma.TransactionClient, r: WorkflowClosureRound, status: WorkflowClosureRound['status']) {
    const changed = await tx.$executeRaw`UPDATE workflow_closure_rounds SET status = ${status}, version = version + 1, updated_at = CURRENT_TIMESTAMP
      WHERE organization_id = ${r.organizationId}::uuid AND id = ${r.id}::uuid AND status = 'PENDING' AND version = ${r.version}`;
    if (changed !== 1) workflowError('CONCURRENCY_CONFLICT', 409);
  }

  private async round(tx: Prisma.TransactionClient, organizationId: string, id: string, lock = false) {
    const [row] = await tx.$queryRaw<RoundRow[]>(Prisma.sql`SELECT ${roundColumns} FROM workflow_closure_rounds
      WHERE organization_id = ${organizationId}::uuid AND id = ${id}::uuid ${lock ? Prisma.sql`FOR UPDATE` : Prisma.empty}`);
    return row ? this.hydrate(tx, row) : null;
  }

  private async hydrate(tx: Prisma.TransactionClient, row: RoundRow): Promise<WorkflowClosureRound> {
    const duties = await tx.$queryRaw<DutyRow[]>(Prisma.sql`SELECT ${dutyColumns} FROM workflow_closure_duties
      WHERE organization_id = ${row.organizationId}::uuid AND round_id = ${row.id}::uuid
      ORDER BY CASE duty WHEN 'PROFESSIONAL' THEN 1 WHEN 'SECTION_MANAGER' THEN 2 ELSE 3 END`);
    return { ...row, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(), duties: duties.map(d => ({ ...d, decidedAt: d.decidedAt?.toISOString() ?? null })) };
  }

  private async inTransaction<T>(transaction: Prisma.TransactionClient | undefined, work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    try {
      const checked = async (tx: Prisma.TransactionClient) => {
        const [isolation] = await tx.$queryRaw<{ transaction_isolation: string }[]>`SHOW transaction_isolation`;
        if (isolation?.transaction_isolation !== 'read committed') workflowError('WORKFLOW_TRANSACTION_ISOLATION_UNSUPPORTED', 409);
        return work(tx);
      };
      return await (transaction ? checked(transaction) : this.prisma.$transaction(checked, { isolationLevel: 'ReadCommitted', timeout: 30_000 }));
    } catch (error) {
      const failure = error as { code?: string; meta?: { code?: string; driverAdapterError?: { cause?: { originalCode?: string } } } };
      const state = failure.meta?.code ?? failure.meta?.driverAdapterError?.cause?.originalCode;
      if (failure.code === 'P2002' || isSecurityConcurrencyConflict(error) || ['23505', '55P03'].includes(state ?? '')) workflowError('CONCURRENCY_CONFLICT', 409);
      throw error;
    }
  }

  private uuid(value: unknown): asserts value is string {
    if (typeof value !== 'string' || !isUUID(value)) throw new BadRequestException();
  }

  private positive(value: unknown): value is number { return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 && value <= 2_147_483_647; }

  private validateInput(operation: string, id: string, input: CommandInput, key: string) {
    this.uuid(id);
    if (typeof key !== 'string' || !/^[a-zA-Z0-9._:-]{8,128}$/.test(key)) workflowError('IDEMPOTENCY_KEY_REQUIRED', 400);
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new BadRequestException();
    const keys = operation === 'SUBMIT' ? ['expectedContentVersion', 'expectedInstanceVersion'] : operation === 'DECIDE' ? ['expectedRoundVersion', 'duties', 'decision', 'comment'] : ['expectedRoundVersion', 'reason'];
    if (Object.keys(input).length !== keys.length || keys.some(k => !Object.hasOwn(input, k)) || Object.keys(input).some(k => !keys.includes(k))) throw new BadRequestException();
    if (operation === 'SUBMIT') {
      const body = input as WorkflowClosureStartInput;
      if (!this.positive(body.expectedContentVersion) || !this.positive(body.expectedInstanceVersion)) throw new BadRequestException();
    } else {
      const body = input as WorkflowClosureDecideInput & WorkflowClosureCancelInput;
      if (!this.positive(body.expectedRoundVersion)) throw new BadRequestException();
      const text = operation === 'DECIDE' ? body.comment : body.reason;
      if (typeof text !== 'string' || !text.trim() || text.length > 2000) throw new BadRequestException();
      if (operation === 'DECIDE' && (!['APPROVE', 'RETURN'].includes(body.decision) || !Array.isArray(body.duties) || !body.duties.length || body.duties.length > 2
        || new Set(body.duties).size !== body.duties.length || body.duties.some(d => !allDuties.includes(d)))) throw new BadRequestException();
    }
  }

  private validateContent(content: Prisma.InputJsonValue) {
    const visit = (value: unknown, depth: number): void => {
      if (depth > 64) throw new BadRequestException();
      if (value === null || typeof value === 'boolean' || typeof value === 'string' || typeof value === 'number' && Number.isFinite(value)) return;
      if (!value || typeof value !== 'object' || !Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) throw new BadRequestException();
      for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) {
        if (descriptor.get || descriptor.set) throw new BadRequestException();
        visit(descriptor.value, depth + 1);
      }
    };
    visit(content, 0);
    if (Buffer.byteLength(JSON.stringify(content), 'utf8') > 1_048_576) throw new BadRequestException();
  }
}
