import { BadRequestException, HttpException, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { isUUID } from 'class-validator';
import { Prisma } from '../../generated/prisma/client.js';
import type { AdminActor } from '../../common/security/admin-mutation.service.js';
import { AdministrativeLifecycleRegistry } from '../../common/security/administrative-lifecycle.registry.js';
import type { AdministrativeLifecycleEffect, AdministrativeLifecycleImpact } from '../../common/security/administrative-lifecycle.types.js';
import { AuditLogService } from '../audit-log/audit-log.service.js';
import { ProblemIndexService } from '../problem-index/problem-index.service.js';
import { OutboxService } from '../task-notification/outbox.service.js';
import { WorkflowClosureRegistry } from './workflow-closure-registry.js';
import type { WorkflowAdministrativeImpact, WorkflowAdministrativeSnapshot } from './workflow-administrative-invalidation.types.js';
import { jsonObject, workflowError } from './workflow-runtime-policy.js';

type PendingRow = WorkflowAdministrativeSnapshot & {
  kind: 'closure' | 'deadline'; id: string; problemId: string; status: string; version: number;
};
type ProblemScope = { organizationId: string; problemId: string };

export function workflowInvalidationMatches(snapshot: WorkflowAdministrativeSnapshot, impact: WorkflowAdministrativeImpact): boolean {
  const context = jsonObject(snapshot.context);
  const participants = Array.isArray(snapshot.participants) ? snapshot.participants
    : [jsonObject(snapshot.participants).leader, jsonObject(snapshot.participants).professional];
  return impact.kind === 'ORGANIZATION' && [snapshot.organizationId, snapshot.creatorOrganizationId].some(id => typeof id === 'string' && impact.organizationIds.includes(id))
    || impact.kind === 'USER' && [context.ownerUserId, context.professionalUserId, snapshot.applicantUserId, snapshot.creatorUserId].some(id => typeof id === 'string' && impact.userIds.includes(id))
    || typeof context.responsibleSectionDepartmentId === 'string' && impact.departmentIds.includes(context.responsibleSectionDepartmentId)
    || participants.some(value => {
      const participant = jsonObject(value);
      return impact.kind === 'USER' && typeof participant.userId === 'string' && impact.userIds.includes(participant.userId)
        || typeof participant.departmentId === 'string' && impact.departmentIds.includes(participant.departmentId)
        || typeof participant.positionId === 'string' && impact.positionIds.includes(participant.positionId);
    });
}

@Injectable()
export class WorkflowAdministrativeInvalidationService implements AdministrativeLifecycleEffect {
  readonly module = 'workflow' as const;

  constructor(lifecycle: AdministrativeLifecycleRegistry, private readonly registry: WorkflowClosureRegistry,
    private readonly problems: ProblemIndexService, private readonly audit: AuditLogService, private readonly outbox: OutboxService) {
    lifecycle.register(this);
  }

  // Caller owns deletion authorization/target locks and must roll back the transaction on any error.
  async apply(tx: Prisma.TransactionClient, actor: AdminActor, impact: AdministrativeLifecycleImpact) {
    if (actor.accountType !== 'INTERNAL') workflowError('WORKFLOW_NODE_FORBIDDEN', 403);
    const ids = [actor.id, actor.sessionId, actor.organizationId, impact.entityId, impact.organizationId, impact.receiptOrganizationId];
    for (const values of [impact.userIds, impact.departmentIds, impact.positionIds, impact.organizationIds]) {
      if (!Array.isArray(values)) throw new BadRequestException();
      ids.push(...values);
    }
    if (ids.some(id => typeof id !== 'string' || !isUUID(id)) || !['USER', 'DEPARTMENT', 'ORGANIZATION'].includes(impact.kind)) throw new BadRequestException();
    const result = { module: this.module, changed: 0, pendingConfiguration: 0 };
    if (![impact.userIds, impact.departmentIds, impact.positionIds, impact.organizationIds].some(ids => ids.length)) return result;
    const candidates = (await this.pending(tx)).filter(row => workflowInvalidationMatches(row, impact));
    const supplier = this.registry.hasDomain('supplier-quality') ? this.registry.get('supplier-quality') : null;
    if (supplier && !supplier.administrativeInvalidationTargets) throw new HttpException({ code: 'WORKFLOW_ACTION_INVALID',
      reason: 'ADMINISTRATIVE_INVALIDATION_TARGETS_REQUIRED', domainCode: supplier.domainCode }, 409);
    const domainTargets = supplier ? await supplier.administrativeInvalidationTargets!(tx, impact) : [];
    const scopes = [...new Map([...candidates, ...domainTargets].map(row => [`${row.organizationId}:${row.problemId}`,
      { organizationId: row.organizationId, problemId: row.problemId }])).values()]
      .sort((a, b) => a.organizationId.localeCompare(b.organizationId) || a.problemId.localeCompare(b.problemId));

    // Preflight every domain before any write; never leave a cancelled round with a locked domain submission.
    const targets = [];
    for (const scope of scopes) {
      const problem = await this.problems.lockForWorkflow(tx, scope.organizationId, scope.problemId);
      const adapter = this.registry.get(problem.domainCode);
      if (!adapter.administrativeInvalidation) throw new HttpException({ code: 'WORKFLOW_ACTION_INVALID',
        reason: 'ADMINISTRATIVE_INVALIDATION_HOOK_REQUIRED', domainCode: problem.domainCode }, 409);
      targets.push({ ...scope, instanceId: problem.workflowInstanceId, adapter });
    }
    // All problem locks precede all current instance locks, which precede round/duty/deadline locks.
    for (const target of targets) {
      if (!target.instanceId) workflowError('CONCURRENCY_CONFLICT', 409);
      const [instance] = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM workflow_instances
        WHERE organization_id = ${target.organizationId}::uuid AND problem_index_id = ${target.problemId}::uuid
        AND id = ${target.instanceId}::uuid FOR UPDATE`;
      if (!instance) workflowError('CONCURRENCY_CONFLICT', 409);
    }

    const reason = `ADMINISTRATIVE_${impact.kind}_DELETED`, traceId = randomUUID();
    for (const target of targets) {
      const rows = (await this.pending(tx, target, true)).filter(row => workflowInvalidationMatches(row, impact));
      if (!rows.length && !domainTargets.some(scope => scope.organizationId === target.organizationId && scope.problemId === target.problemId)) continue;
      for (const row of rows) {
        if (row.kind === 'closure') {
          await tx.$queryRaw`SELECT id FROM workflow_closure_duties WHERE organization_id = ${row.organizationId}::uuid
            AND round_id = ${row.id}::uuid ORDER BY id FOR UPDATE`;
          const changed = await tx.$executeRaw`UPDATE workflow_closure_rounds SET status = 'CANCELLED', version = version + 1,
            updated_at = CURRENT_TIMESTAMP, context = context || ${JSON.stringify({ endedBy: actor.id, endReason: reason })}::jsonb
            WHERE organization_id = ${row.organizationId}::uuid AND id = ${row.id}::uuid AND status = 'PENDING'
            AND version = ${row.version} AND version < 2147483647`;
          if (changed !== 1) workflowError('CONCURRENCY_CONFLICT', 409);
          await tx.$executeRaw`UPDATE workflow_closure_duties SET status = 'CANCELLED', version = version + 1
            WHERE organization_id = ${row.organizationId}::uuid AND round_id = ${row.id}::uuid AND status IN ('PENDING', 'WAITING')`;
        } else {
          const history = [{ action: `${row.status}:CANCELLED`, userId: actor.id, comment: reason, at: new Date().toISOString() }];
          const changed = await tx.$executeRaw`UPDATE workflow_deadline_extensions SET status = 'CANCELLED', version = version + 1,
            updated_at = CURRENT_TIMESTAMP, history = history || ${JSON.stringify(history)}::jsonb
            WHERE organization_id = ${row.organizationId}::uuid AND id = ${row.id}::uuid AND status = ${row.status}
            AND version = ${row.version} AND version < 2147483647`;
          if (changed !== 1) workflowError('CONCURRENCY_CONFLICT', 409);
        }
      }
      const domainChanged = await target.adapter.administrativeInvalidation!(tx, { organizationId: target.organizationId,
        problemId: target.problemId, actorUserId: actor.id, reason, impact });
      if (!Number.isSafeInteger(domainChanged) || domainChanged < 0) workflowError('WORKFLOW_ACTION_INVALID', 409);
      for (const row of rows) await this.changed(tx, row, actor.id, reason, traceId);
      result.changed += rows.length + domainChanged;
      if (rows.length || domainChanged) result.pendingConfiguration++;
    }
    return result;
  }

  private async pending(tx: Prisma.TransactionClient, scope?: ProblemScope, lock = false): Promise<PendingRow[]> {
    const filter = scope ? Prisma.sql`AND r.organization_id = ${scope.organizationId}::uuid AND r.problem_id = ${scope.problemId}::uuid` : Prisma.empty;
    const locking = lock ? Prisma.sql`FOR UPDATE OF r` : Prisma.empty;
    // shortcut: scan pending workflow snapshots only; add targeted JSON indexes if pending volume requires it.
    const rounds = await tx.$queryRaw<PendingRow[]>(Prisma.sql`SELECT 'closure' AS kind, r.id, r.organization_id AS "organizationId",
      r.problem_id AS "problemId", r.status, r.version, r.context, r.created_by AS "creatorUserId", r.creator_organization_id AS "creatorOrganizationId",
      COALESCE((SELECT jsonb_agg(d.participant) FROM workflow_closure_duties d
        WHERE d.organization_id = r.organization_id AND d.round_id = r.id), '[]'::jsonb) AS participants
      FROM workflow_closure_rounds r WHERE r.status = 'PENDING' ${filter}
      ORDER BY r.organization_id, r.problem_id, r.id ${locking}`);
    const deadlines = await tx.$queryRaw<PendingRow[]>(Prisma.sql`SELECT 'deadline' AS kind, r.id, r.organization_id AS "organizationId",
      r.problem_id AS "problemId", r.status, r.version, r.context, r.participants, r.applicant_user_id AS "applicantUserId"
      FROM workflow_deadline_extensions r WHERE r.status IN ('LEADER_PENDING', 'QUALITY_PENDING') ${filter}
      ORDER BY r.organization_id, r.problem_id, r.id ${locking}`);
    return [...rounds, ...deadlines];
  }

  private async changed(tx: Prisma.TransactionClient, row: PendingRow, actorUserId: string, reason: string, traceId: string) {
    const closure = row.kind === 'closure', version = row.version + 1;
    const eventType = closure ? 'WORKFLOW_CLOSURE_CHANGED' : 'WORKFLOW_DEADLINE_EXTENSION_CHANGED';
    const resourceType = closure ? 'WorkflowClosureRound' : 'WorkflowDeadlineExtension';
    await this.audit.record({ organizationId: row.organizationId, actorUserId, action: eventType, resourceType, resourceId: row.id,
      outcome: 'SUCCESS', traceId, metadata: { status: 'CANCELLED', resourceVersion: version, reasonCode: reason } }, tx);
    await this.outbox.enqueue({ eventKey: `${row.kind}:${row.id}:${version}`, eventType, aggregateType: resourceType, aggregateId: row.id,
      payload: { schemaVersion: 1, organizationId: row.organizationId, problemId: row.problemId,
        ...(closure ? { roundId: row.id, roundVersion: version } : { requestId: row.id, requestVersion: version }) } }, tx);
  }
}
