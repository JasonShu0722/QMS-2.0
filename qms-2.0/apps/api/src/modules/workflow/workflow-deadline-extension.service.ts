import { BadRequestException, Injectable } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { isISO8601, isUUID } from 'class-validator';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../database/prisma.service.js';
import { effectivePositionAssignmentWhere } from '../../common/security/effective-role-grants.js';
import { isSecurityConcurrencyConflict } from '../../common/security/session-security.js';
import { AuditLogService } from '../audit-log/audit-log.service.js';
import { OrganizationResponsibilityService } from '../organization/organization-responsibility.service.js';
import type { ManagementResponsibilitiesDto } from '../organization/organization-responsibility.dto.js';
import { OutboxService } from '../task-notification/outbox.service.js';
import { canProcessWorkflowNode, type WorkflowActor } from './workflow-access-policy.js';
import { WorkflowClosureRegistry } from './workflow-closure-registry.js';
import { WorkflowClosureRoundService } from './workflow-closure-round.service.js';
import type { WorkflowClosureParticipant } from './workflow-closure-policy.js';
import { canonical, jsonObject, workflowError } from './workflow-runtime-policy.js';
import { deadlineDueAt, deadlineStageOpen, initialDeadlineStatus, nextDeadlineStatus, parseDeadlinePolicy, sameDeadlineSources } from './workflow-deadline-extension.policy.js';
import type { WorkflowDeadlineContext, WorkflowDeadlineDecideInput, WorkflowDeadlineExtension, WorkflowDeadlineOperation, WorkflowDeadlineParticipants, WorkflowDeadlineRequestInput, WorkflowDeadlineStage } from './workflow-deadline-extension.types.js';

const columns = Prisma.sql`id, organization_id AS "organizationId", problem_id AS "problemId", workflow_version_id AS "workflowVersionId", stage,
  original_due_at AS "originalDueAt", requested_due_at AS "requestedDueAt", originally_overdue AS "originallyOverdue", reason,
  applicant_user_id AS "applicantUserId", context, participants, status, version, history, created_at AS "createdAt", updated_at AS "updatedAt"`;
type Row = Omit<WorkflowDeadlineExtension, 'originalDueAt' | 'requestedDueAt' | 'createdAt' | 'updatedAt'> & { originalDueAt: Date; requestedDueAt: Date; createdAt: Date; updatedAt: Date };
const pending = (r: WorkflowDeadlineExtension) => r.status === 'LEADER_PENDING' || r.status === 'QUALITY_PENDING';
type ParticipantSelection = { plan: WorkflowDeadlineParticipants | null; current: () => Promise<boolean>; currentParticipant: (participant: WorkflowClosureParticipant) => Promise<boolean> };

@Injectable()
export class WorkflowDeadlineExtensionService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditLogService,
    private readonly responsibilities: OrganizationResponsibilityService, private readonly registry: WorkflowClosureRegistry,
    private readonly rounds: WorkflowClosureRoundService, private readonly outbox: OutboxService) {}

  async request(actor: WorkflowActor, problemId: string, input: WorkflowDeadlineRequestInput, key: string, traceId: string): Promise<WorkflowDeadlineExtension> {
    this.validate('REQUEST', problemId, input, key);
    return this.command(actor, problemId, input, key, traceId, 'REQUEST');
  }

  async decide(actor: WorkflowActor, requestId: string, input: WorkflowDeadlineDecideInput, key: string, traceId: string): Promise<WorkflowDeadlineExtension> {
    this.validate('DECIDE', requestId, input, key);
    return this.command(actor, requestId, input, key, traceId, 'DECIDE');
  }

  async history(actor: WorkflowActor, problemId: string): Promise<WorkflowDeadlineExtension[]> {
    this.uuid(problemId);
    return this.transaction(async tx => {
      await this.context(tx, actor, problemId, 'READ');
      const rows = await this.readProjection(tx, actor.organizationId, problemId);
      await this.rounds.assertActor(tx, actor);
      return rows;
    });
  }

  // For authorized domain task projections; never grants domain access by itself.
  async eligible(tx: Prisma.TransactionClient, actor: WorkflowActor, problemId: string): Promise<WorkflowDeadlineExtension[]> {
    const { context, closureContext, adapter } = await this.context(tx, actor, problemId, 'DECIDE');
    const selection = await this.selectParticipants(tx, context);
    const plan = selection.plan;
    const rows = await this.readProjection(tx, context.organizationId, problemId);
    await adapter.deadlineContext!(tx, closureContext, actor, 'DECIDE');
    await this.rounds.assertActor(tx, actor);
    if (!await selection.current()) return [];
    return rows.filter(r => pending(r) && plan !== null && sameDeadlineSources(r.context, context, r.stage)
      && canonical(r.participants) === canonical(plan) && this.pendingUser(r) === actor.id && actor.id !== r.applicantUserId);
  }

  async readProjection(tx: Prisma.TransactionClient, organizationId: string, problemId: string): Promise<WorkflowDeadlineExtension[]> {
    this.uuid(organizationId); this.uuid(problemId);
    const rows = await tx.$queryRaw<Row[]>(Prisma.sql`SELECT ${columns} FROM workflow_deadline_extensions
      WHERE organization_id = ${organizationId}::uuid AND problem_id = ${problemId}::uuid ORDER BY created_at DESC, id`);
    return rows.map(row => this.hydrate(row));
  }

  async candidateProblemIds(tx: Prisma.TransactionClient, actor: WorkflowActor): Promise<string[]> {
    await this.rounds.assertActor(tx, actor);
    const rows = await tx.$queryRaw<{ problemId: string }[]>`SELECT DISTINCT problem_id AS "problemId" FROM workflow_deadline_extensions
      WHERE organization_id = ${actor.organizationId}::uuid AND status IN ('LEADER_PENDING', 'QUALITY_PENDING')
        AND (participants->'leader'->>'userId' = ${actor.id} OR participants->'professional'->>'userId' = ${actor.id}) ORDER BY problem_id`;
    return rows.map(r => r.problemId);
  }

  pendingUser(r: WorkflowDeadlineExtension): string | null {
    return r.status === 'LEADER_PENDING' ? r.participants.leader.userId : r.status === 'QUALITY_PENDING' ? r.participants.professional.userId : null;
  }

  // Session-free worker path. The caller supplies a freshly locked, domain-owned context.
  async reconcile(tx: Prisma.TransactionClient, context: WorkflowDeadlineContext, invalidate = true, selection?: ParticipantSelection): Promise<WorkflowDeadlineExtension[]> {
    const rows = (await this.readProjection(tx, context.organizationId, context.problemId)).filter(pending);
    if (!rows.length) return [];
    selection ??= await this.selectParticipants(tx, context);
    const plan = selection.plan;
    const valid: WorkflowDeadlineExtension[] = [];
    for (const r of rows) {
      if (!await this.policyCurrent(tx, context) || !plan || !sameDeadlineSources(r.context, context, r.stage) || canonical(r.participants) !== canonical(plan) || !await selection.current()) {
        if (invalidate) await this.persist(tx, r, 'CANCELLED', null, 'SOURCE_CHANGED_REAPPLY', 'worker');
      } else valid.push(r);
    }
    return valid;
  }

  async policyCurrent(tx: Prisma.TransactionClient, c: WorkflowDeadlineContext): Promise<boolean> {
    if ([c.organizationId, c.problemId, c.instanceId, c.workflowVersionId, c.ownerNodeId, c.ownerUserId, c.professionalUserId, c.responsibleSectionDepartmentId]
      .some(id => typeof id !== 'string' || !isUUID(id)) || !Number.isSafeInteger(c.instanceVersion) || c.instanceVersion < 1) return false;
    const instance = await tx.workflowInstance.findFirst({ where: { id: c.instanceId, organizationId: c.organizationId, problemIndexId: c.problemId }, include: { workflowVersion: true, currentNode: true } });
    const node = await tx.workflowNode.findFirst({ where: { id: c.ownerNodeId, organizationId: c.organizationId, workflowVersionId: c.workflowVersionId } });
    const problem = await tx.problemIndex.findFirst({ where: { id: c.problemId, organizationId: c.organizationId } });
    const policy = node && parseDeadlinePolicy(jsonObject(node.config).processEightD);
    const gate = jsonObject(jsonObject(instance?.currentNode?.config).closureReview);
    return !!(instance && instance.status === 'RUNNING' && instance.workflowVersionId === c.workflowVersionId
      && instance.version === c.instanceVersion && instance.workflowVersion.status === 'PUBLISHED' && instance.workflowVersion.organizationId === c.organizationId
      && node && node.type === 'ACTION' && jsonObject(node.config).isStart === true && problem && problem.workflowInstanceId === c.instanceId && problem.ownerId === c.ownerUserId
      && instance.currentNode?.organizationId === c.organizationId && instance.currentNode.workflowVersionId === c.workflowVersionId
      && (instance.currentNodeId === c.ownerNodeId || (instance.currentNode.type === 'APPROVAL' && gate.schemaVersion === 1 && gate.policy === 'INTERNAL' && gate.domainCode === problem.domainCode))
      && !problem.closedAt && !problem.archivedAt && !['CLOSED', 'ARCHIVED'].includes(problem.status) && !c.closedAt
      && policy && canonical(policy) === canonical(c.policy));
  }

  private async command(actor: WorkflowActor, id: string, input: WorkflowDeadlineRequestInput | WorkflowDeadlineDecideInput, key: string, traceId: string, operation: 'REQUEST' | 'DECIDE') {
    return this.transaction(async tx => {
      await this.rounds.assertActor(tx, actor);
      const before = operation === 'DECIDE' ? await this.read(tx, actor.organizationId, id) : null;
      if (operation === 'DECIDE' && !before) workflowError('WORKFLOW_INSTANCE_NOT_FOUND', 404);
      const problemId = before?.problemId ?? id;
      await tx.$queryRaw`SELECT id FROM problem_indexes WHERE organization_id = ${actor.organizationId}::uuid AND id = ${problemId}::uuid FOR UPDATE`;
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`deadline:${actor.organizationId}:${actor.id}:${key}`}, 0))::text`;
      const digest = createHash('sha256').update(canonical({ operation, id, input, actor: actor.id })).digest('hex');
      const [receipt] = await tx.$queryRaw<{ digest: string; response: WorkflowDeadlineExtension }[]>`SELECT digest, response FROM workflow_deadline_extension_receipts
        WHERE organization_id = ${actor.organizationId}::uuid AND actor_user_id = ${actor.id}::uuid AND key = ${key}`;
      const { context: c, closureContext, adapter } = await this.context(tx, actor, problemId, operation);
      const selection = await this.selectParticipants(tx, c);
      const plan = selection.plan;
      if (operation === 'REQUEST' && actor.id !== c.ownerUserId) workflowError('WORKFLOW_NODE_FORBIDDEN', 403);
      if (receipt) {
        if (receipt.digest !== digest) workflowError('IDEMPOTENCY_REPLAY', 409);
        if (operation === 'DECIDE' && (!plan || ![plan.leader.userId, plan.professional.userId].includes(actor.id) || actor.id === receipt.response.applicantUserId)) workflowError('WORKFLOW_NODE_FORBIDDEN', 403);
        await this.rounds.assertActor(tx, actor);
        if (!await selection.current()) workflowError('STRUCTURE_REFERENCE_INVALID', 409);
        return receipt.response;
      }
      let result: WorkflowDeadlineExtension;
      if (operation === 'REQUEST') {
        const body = input as WorkflowDeadlineRequestInput;
        if (body.expectedRowVersion !== c.rowVersion || body.expectedInstanceVersion !== c.instanceVersion) workflowError('CONCURRENCY_CONFLICT', 409);
        if (!plan || plan.professional.userId === actor.id || !await selection.current()) workflowError('STRUCTURE_REFERENCE_INVALID', 409);
        const dueAt = deadlineDueAt(c, body.stage);
        if (!dueAt || !deadlineStageOpen(c, body.stage) || new Date(body.requestedDueAt).getTime() <= new Date(dueAt).getTime()) workflowError('WORKFLOW_ACTION_INVALID', 409);
        const old = (await this.readProjection(tx, c.organizationId, c.problemId)).find(r => r.stage === body.stage && pending(r));
        if (old) {
          if (sameDeadlineSources(old.context, c, old.stage) && canonical(old.participants) === canonical(plan)) workflowError('CONCURRENCY_CONFLICT', 409);
          // Persist invalidation first; the response explicitly asks the owner to reapply.
          result = await this.persist(tx, old, 'CANCELLED', actor.id, 'SOURCE_CHANGED_REAPPLY', traceId);
        } else {
          const now = new Date().toISOString();
          result = { id: randomUUID(), organizationId: c.organizationId, problemId, workflowVersionId: c.workflowVersionId, stage: body.stage,
            originalDueAt: dueAt, requestedDueAt: new Date(body.requestedDueAt).toISOString(), originallyOverdue: new Date(dueAt).getTime() < Date.now(),
            reason: body.reason.trim(), applicantUserId: actor.id, context: c, participants: plan, status: initialDeadlineStatus(actor.id, plan.leader.userId), version: 1,
            history: [{ action: 'REQUESTED', userId: actor.id, comment: body.reason.trim(), at: now },
              ...(plan.leaderSkipped ? [{ action: 'LEADER_SKIPPED_SAME_PERSON', userId: actor.id, comment: 'SAME_EFFECTIVE_USER', at: now }] : [])], createdAt: now, updatedAt: now };
          await tx.$executeRaw`INSERT INTO workflow_deadline_extensions (id, organization_id, problem_id, workflow_version_id, stage, original_due_at, requested_due_at,
            originally_overdue, reason, applicant_user_id, context, participants, status, history, created_at, updated_at)
            VALUES (${result.id}::uuid, ${c.organizationId}::uuid, ${problemId}::uuid, ${c.workflowVersionId}::uuid, ${result.stage}, ${new Date(dueAt)}, ${new Date(result.requestedDueAt)},
              ${result.originallyOverdue}, ${result.reason}, ${actor.id}::uuid, ${JSON.stringify(c)}::jsonb, ${JSON.stringify(plan)}::jsonb, ${result.status}, ${JSON.stringify(result.history)}::jsonb,
              ${new Date(result.createdAt)}, ${new Date(result.updatedAt)})`;
          await this.changed(tx, result, actor.id, traceId);
        }
      } else {
        const r = (await this.read(tx, actor.organizationId, id, true))!;
        const body = input as WorkflowDeadlineDecideInput;
        if (this.pendingUser(r) !== actor.id || actor.id === r.applicantUserId) workflowError('WORKFLOW_NODE_FORBIDDEN', 403);
        if (!pending(r) || r.version !== body.expectedVersion) workflowError('CONCURRENCY_CONFLICT', 409);
        if (!plan || !sameDeadlineSources(r.context, c, r.stage) || canonical(r.participants) !== canonical(plan) || !await selection.current()) {
          result = await this.persist(tx, r, 'CANCELLED', actor.id, 'SOURCE_CHANGED_REAPPLY', traceId);
        } else {
          const status = nextDeadlineStatus(r.status, body.decision);
          if (status === 'APPROVED') await adapter.applyDeadlineExtension!(tx, closureContext, r.stage, new Date(r.requestedDueAt));
          result = await this.persist(tx, r, status, actor.id, body.comment?.trim() ?? '', traceId);
        }
      }
      await adapter.deadlineContext!(tx, closureContext, actor, operation);
      await this.rounds.assertActor(tx, actor);
      if (result.status !== 'CANCELLED' && !await selection.current()) workflowError('STRUCTURE_REFERENCE_INVALID', 409);
      await tx.$executeRaw`INSERT INTO workflow_deadline_extension_receipts (organization_id, actor_user_id, key, digest, response)
        VALUES (${actor.organizationId}::uuid, ${actor.id}::uuid, ${key}, ${digest}, ${JSON.stringify(result)}::jsonb)`;
      return result;
    });
  }

  private async context(tx: Prisma.TransactionClient, actor: WorkflowActor, problemId: string, operation: WorkflowDeadlineOperation) {
    await this.rounds.assertActor(tx, actor);
    const problem = await tx.problemIndex.findFirst({ where: { id: problemId, organizationId: actor.organizationId } });
    if (!problem) workflowError('ORGANIZATION_SCOPE_DENIED', 403);
    const adapter = this.registry.get(problem.domainCode);
    if (!adapter.deadlineContext || !adapter.applyDeadlineExtension) workflowError('WORKFLOW_ACTION_INVALID', 409);
    const closureContext = await adapter.lockAndRead(tx, actor, problemId, 'READ');
    const context = await adapter.deadlineContext(tx, closureContext, actor, operation);
    if (context.organizationId !== actor.organizationId || context.problemId !== problemId || context.instanceId !== closureContext.instanceId
      || context.workflowVersionId !== closureContext.workflowVersionId) workflowError('CONCURRENCY_CONFLICT', 409);
    if (operation !== 'READ' && !await this.policyCurrent(tx, context)) workflowError('WORKFLOW_ACTION_INVALID', 409);
    return { context, closureContext, adapter };
  }

  async selectParticipants(tx: Prisma.TransactionClient, c: WorkflowDeadlineContext): Promise<ParticipantSelection> {
    await tx.$queryRaw(Prisma.sql`SELECT id FROM users WHERE organization_id = ${c.organizationId}::uuid
      AND id IN (${Prisma.join([...new Set([c.ownerUserId, c.professionalUserId])].sort().map(id => Prisma.sql`${id}::uuid`))}) ORDER BY id FOR SHARE`);
    const management = await this.responsibilities.resolveManagementResponsibilities(tx, c.organizationId, c.responsibleSectionDepartmentId);
    const plan = await this.participantsFromLockedSources(tx, c, management);
    // Capture resolver identities once. Final checks are reads only, even after later lock waits.
    return { plan, current: async () => plan !== null && canonical(plan) === canonical(await this.participantsFromLockedSources(tx, c, management)),
      currentParticipant: async participant => {
        if (!participant.bindingId) return participant.userId === c.professionalUserId;
        const valid = await this.responsibilities.revalidateLockedManagementResponsibilities(tx, management, new Date());
        return valid.has(participant.bindingId) && management.responsibilities.some(source => source.bindingId === participant.bindingId
          && source.userId === participant.userId && source.assignmentId === participant.assignmentId && source.positionId === participant.positionId
          && source.departmentId === participant.departmentId && source.bindingVersion === participant.bindingVersion
          && source.scopeId === participant.scopeId && source.scopeVersion === participant.scopeVersion);
      } };
  }

  private async participantsFromLockedSources(tx: Prisma.TransactionClient, c: WorkflowDeadlineContext, management: ManagementResponsibilitiesDto): Promise<WorkflowDeadlineParticipants | null> {
    const now = new Date();
    const valid = await this.responsibilities.revalidateLockedManagementResponsibilities(tx, management, now);
    const source = (duty: 'SECTION_MANAGER' | 'MINISTER'): WorkflowClosureParticipant | null => {
      if (management.issues.some(issue => issue.responsibility === duty)) return null;
      const s = management.responsibilities.find(item => item.responsibility === duty);
      return s && valid.has(s.bindingId) ? { userId: s.userId, assignmentId: s.assignmentId, positionId: s.positionId, departmentId: s.departmentId,
        bindingId: s.bindingId, bindingVersion: s.bindingVersion, scopeId: s.scopeId, scopeVersion: s.scopeVersion } : null;
    };
    const manager = source('SECTION_MANAGER');
    if (!manager) return null;
    const leader = manager.userId === c.ownerUserId ? source('MINISTER') : manager;
    if (!leader) return null;
    const owner = await tx.userPosition.findFirst({ where: { organizationId: c.organizationId, userId: c.ownerUserId, ...effectivePositionAssignmentWhere(now),
      position: { organizationId: c.organizationId, departmentId: c.responsibleSectionDepartmentId, status: 'ACTIVE', department: { status: 'ACTIVE' } }, user: { status: 'ACTIVE', accountType: 'INTERNAL' } }, select: { id: true } });
    const professional = await tx.userPosition.findFirst({ where: { organizationId: c.organizationId, userId: c.professionalUserId, ...effectivePositionAssignmentWhere(now),
      position: { organizationId: c.organizationId, status: 'ACTIVE', department: { status: 'ACTIVE' } }, user: { status: 'ACTIVE', accountType: 'INTERNAL' } }, select: { id: true } });
    for (const userId of new Set([c.ownerUserId, c.professionalUserId, leader.userId])) {
      if (!await canProcessWorkflowNode(tx, userId, c.organizationId, { assigneeUserId: userId })) return null;
    }
    if (!owner || !professional) return null;
    return { leader, professional: { userId: c.professionalUserId, assignmentId: null, positionId: null, departmentId: null, bindingId: null, scopeId: null, bindingVersion: null, scopeVersion: null }, leaderSkipped: leader.userId === c.ownerUserId };
  }

  private async persist(tx: Prisma.TransactionClient, r: WorkflowDeadlineExtension, status: WorkflowDeadlineExtension['status'], userId: string | null, comment: string, traceId: string) {
    if (r.version >= 2147483647) workflowError('CONCURRENCY_CONFLICT', 409);
    const at = new Date().toISOString();
    const result = { ...r, status, version: r.version + 1, updatedAt: at, history: [...r.history,
      ...(status === 'APPROVED' && new Date(r.originalDueAt).getTime() < new Date(at).getTime()
        ? [{ action: 'ORIGINAL_DUE_ELAPSED_BEFORE_APPROVAL', userId: null, comment: r.originalDueAt, at }] : []),
      { action: `${r.status}:${status}`, userId, comment, at }] };
    const changed = await tx.$executeRaw`UPDATE workflow_deadline_extensions SET status = ${status}, version = version + 1, history = ${JSON.stringify(result.history)}::jsonb, updated_at = ${new Date(at)}
      WHERE id = ${r.id}::uuid AND organization_id = ${r.organizationId}::uuid AND version = ${r.version} AND status = ${r.status}`;
    if (changed !== 1) workflowError('CONCURRENCY_CONFLICT', 409);
    await this.changed(tx, result, userId, traceId);
    return result;
  }

  private async changed(tx: Prisma.TransactionClient, r: WorkflowDeadlineExtension, userId: string | null, traceId: string) {
    await this.audit.record({ organizationId: r.organizationId, actorUserId: userId, action: 'WORKFLOW_DEADLINE_EXTENSION_CHANGED', resourceType: 'WorkflowDeadlineExtension', resourceId: r.id,
      outcome: 'SUCCESS', traceId, metadata: { status: r.status, resourceVersion: r.version } }, tx);
    await this.outbox.enqueue({ eventKey: `deadline:${r.id}:${r.version}`, aggregateType: 'WorkflowDeadlineExtension', aggregateId: r.id,
      eventType: 'WORKFLOW_DEADLINE_EXTENSION_CHANGED', payload: { schemaVersion: 1, organizationId: r.organizationId, problemId: r.problemId, requestId: r.id, requestVersion: r.version } }, tx);
  }

  private async read(tx: Prisma.TransactionClient, organizationId: string, id: string, lock = false): Promise<WorkflowDeadlineExtension | null> {
    const [row] = await tx.$queryRaw<Row[]>(Prisma.sql`SELECT ${columns} FROM workflow_deadline_extensions WHERE organization_id = ${organizationId}::uuid AND id = ${id}::uuid ${lock ? Prisma.sql`FOR UPDATE` : Prisma.empty}`);
    return row ? this.hydrate(row) : null;
  }
  private hydrate(row: Row): WorkflowDeadlineExtension { return { ...row, originalDueAt: row.originalDueAt.toISOString(), requestedDueAt: row.requestedDueAt.toISOString(), createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() }; }
  private uuid(value: unknown): asserts value is string { if (typeof value !== 'string' || !isUUID(value)) throw new BadRequestException(); }
  private validate(operation: 'REQUEST' | 'DECIDE', id: string, input: WorkflowDeadlineRequestInput | WorkflowDeadlineDecideInput, key: string) {
    this.uuid(id);
    if (typeof key !== 'string' || !/^[a-zA-Z0-9._:-]{8,128}$/.test(key) || !input || typeof input !== 'object') throw new BadRequestException();
    const allowed = operation === 'REQUEST' ? ['expectedRowVersion', 'expectedInstanceVersion', 'stage', 'requestedDueAt', 'reason'] : ['expectedVersion', 'decision', 'comment'];
    if (Object.keys(input).some(k => !allowed.includes(k))) throw new BadRequestException();
    const positive = (n: unknown) => Number.isSafeInteger(n) && Number(n) > 0 && Number(n) <= 2147483647;
    if (operation === 'REQUEST') {
      const b = input as WorkflowDeadlineRequestInput;
      if (!positive(b.expectedRowVersion) || !positive(b.expectedInstanceVersion) || !['ANALYSIS', 'SUBMISSION', 'CLOSURE'].includes(b.stage)
        || typeof b.requestedDueAt !== 'string' || !isISO8601(b.requestedDueAt, { strict: true }) || !Number.isFinite(new Date(b.requestedDueAt).getTime())
        || typeof b.reason !== 'string' || !b.reason.trim() || b.reason.length > 2000) throw new BadRequestException();
    } else {
      const b = input as WorkflowDeadlineDecideInput;
      if (!positive(b.expectedVersion) || !['APPROVE', 'RETURN'].includes(b.decision)
        || (b.comment !== undefined && (typeof b.comment !== 'string' || b.comment.length > 2000))) throw new BadRequestException();
    }
  }
  private async transaction<T>(work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    try { return await this.prisma.$transaction(work, { isolationLevel: 'ReadCommitted', timeout: 30_000 }); }
    catch (error) { if (isSecurityConcurrencyConflict(error)) workflowError('CONCURRENCY_CONFLICT', 409); throw error; }
  }
}
