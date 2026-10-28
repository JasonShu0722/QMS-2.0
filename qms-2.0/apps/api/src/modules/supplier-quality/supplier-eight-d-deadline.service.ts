import { HttpException, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { plainToInstance } from 'class-transformer';
import { isUUID, validateSync } from 'class-validator';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../database/prisma.service.js';
import { isSecurityConcurrencyConflict } from '../../common/security/session-security.js';
import { AuditLogService } from '../audit-log/audit-log.service.js';
import { OrganizationResponsibilityService } from '../organization/organization-responsibility.service.js';
import { OutboxService } from '../task-notification/outbox.service.js';
import { eightDError as fail, eightDRequestDigest } from '../process-quality/process-eight-d-policy.js';
import { featurePredicate } from '../workflow/workflow-access-policy.js';
import { SupplierEightDService } from './supplier-eight-d.service.js';
import type { SupplierEightDActor } from './supplier-eight-d.types.js';
import { assertSupplierDeadlineDates, initialSupplierDeadlineStatus, nextSupplierDeadlineStatus, supplierDeadlineDuty, type SupplierDeadlineApproval, type SupplierDeadlineStage } from './supplier-eight-d-deadline.policy.js';
import type { SupplierEightDDeadlinePending } from './supplier-eight-d-task.types.js';
import { SupplierEightDDeadlineCancelDto, SupplierEightDDeadlineDecisionDto, SupplierEightDDeadlineRequestDto, type SupplierEightDDeadlineResultDto } from './supplier-eight-d-deadline.dto.js';

type Context = Awaited<ReturnType<SupplierEightDService['deadlineContext']>>;
type Row = {
  id: string; organizationId: string; supplierProblemId: string; stage: SupplierDeadlineStage; severity: Context['severity'];
  status: SupplierDeadlineApproval; originalDueAt: Date; requestedDueAt: Date; originallyOverdue: boolean;
  rowVersion: number; contentVersion: number; instanceVersion: number; sqeUserId: string; sqeAssignmentId: string; sqeFingerprint: string;
  managerUserId: string | null; managerFingerprint: string | null; applicantUserId: string; applicantOrganizationId: string;
  reason: string; version: number; createdAt: Date; updatedAt: Date;
};
type Receipt = { requestId: string; supplierProblemId: string; action: string; digest: string; response: SupplierEightDDeadlineResultDto };
const columns = Prisma.sql`id, organization_id AS "organizationId", supplier_problem_id AS "supplierProblemId", stage, severity, status,
  original_due_at AS "originalDueAt", requested_due_at AS "requestedDueAt", originally_overdue AS "originallyOverdue",
  row_version AS "rowVersion", content_version AS "contentVersion", instance_version AS "instanceVersion",
  sqe_user_id AS "sqeUserId", sqe_assignment_id AS "sqeAssignmentId", sqe_fingerprint AS "sqeFingerprint",
  manager_user_id AS "managerUserId", manager_fingerprint AS "managerFingerprint",
  applicant_user_id AS "applicantUserId", applicant_organization_id AS "applicantOrganizationId", reason, version, created_at AS "createdAt", updated_at AS "updatedAt"`;
const pending = (row: Row) => row.status === 'QUALITY_PENDING' || row.status === 'MANAGER_PENDING';

@Injectable()
export class SupplierEightDDeadlineService {
  constructor(private readonly prisma: PrismaService, private readonly core: SupplierEightDService,
    private readonly responsibilities: OrganizationResponsibilityService, private readonly audit: AuditLogService,
    private readonly outbox: OutboxService) {}

  async notificationPending(tx: Prisma.TransactionClient, organizationId: string, id: string): Promise<SupplierEightDDeadlinePending[]> {
    this.uuid(organizationId); this.uuid(id);
    const candidates = await tx.$queryRaw<{ id: string; stage: SupplierDeadlineStage }[]>`SELECT id, stage FROM supplier_eight_d_deadline_requests
      WHERE organization_id = ${organizationId}::uuid AND supplier_problem_id = ${id}::uuid AND status IN ('QUALITY_PENDING', 'MANAGER_PENDING')
      ORDER BY created_at, id LIMIT 3`;
    const result: SupplierEightDDeadlinePending[] = [];
    for (const candidate of candidates) {
      const context = await this.core.deadlineNotificationContext(tx, organizationId, id, candidate.stage);
      if (!context) continue;
      // Re-read after the domain lock: the SQE decision may have advanced while we waited.
      const row = await this.row(tx, organizationId, id, candidate.id);
      const management = await this.managementFacts(tx, context);
      if (!management) continue;
      if (!this.matches(row, context, management)) continue;
      const duty = supplierDeadlineDuty(row.severity, row.status), userId = duty === 'SQE' ? row.sqeUserId : duty === 'MANAGER' ? row.managerUserId : null;
      if (!userId || !await this.decisionEligible(tx, organizationId, userId)) continue;
      result.push({ id: row.id, version: row.version, stage: row.stage, status: row.status as SupplierEightDDeadlinePending['status'],
        originalDueAt: row.originalDueAt.toISOString(), requestedDueAt: row.requestedDueAt.toISOString(), updatedAt: row.updatedAt.toISOString(), pendingUserId: userId });
    }
    return result;
  }

  async canNotifyPending(tx: Prisma.TransactionClient, organizationId: string, id: string, requestId: string, requestVersion: number, userId: string): Promise<boolean> {
    this.uuid(requestId); this.uuid(userId);
    if (!Number.isInteger(requestVersion) || requestVersion < 1 || requestVersion > 2147483647) return false;
    return (await this.notificationPending(tx, organizationId, id)).some(row => row.id === requestId && row.version === requestVersion && row.pendingUserId === userId);
  }

  private async decisionEligible(tx: Prisma.TransactionClient, organizationId: string, userId: string) {
    const [row] = await tx.$queryRaw<{ allowed: boolean }[]>(Prisma.sql`SELECT EXISTS (SELECT 1 FROM users u
      JOIN organizations o ON o.id = u.organization_id WHERE u.id = ${userId}::uuid AND u.organization_id = ${organizationId}::uuid
      AND u.account_type = 'INTERNAL' AND u.status = 'ACTIVE' AND u.must_change_password = false AND o.status = 'ACTIVE' AND o.type = 'INTERNAL'
      AND ${featurePredicate(Prisma.sql`u.id`, Prisma.sql`${organizationId}::uuid`, Prisma.sql`'supplier-quality:issues:read'`)}
      AND ${featurePredicate(Prisma.sql`u.id`, Prisma.sql`${organizationId}::uuid`, Prisma.sql`'supplier-quality:issues:deadlines'`)}
      AND ${featurePredicate(Prisma.sql`u.id`, Prisma.sql`${organizationId}::uuid`, Prisma.sql`'workflow:act'`)}) AS allowed`);
    return row?.allowed === true;
  }

  async history(actor: SupplierEightDActor, id: string): Promise<SupplierEightDDeadlineResultDto[]> {
    this.uuid(id);
    return this.transaction(async tx => {
      const record = await this.core.lockRecord(tx, actor, id, true);
      await this.core.authorizeRead(tx, actor, record);
      const rows = await tx.$queryRaw<Row[]>(Prisma.sql`SELECT ${columns} FROM supplier_eight_d_deadline_requests
        WHERE organization_id = ${record.control.organizationId}::uuid AND supplier_problem_id = ${id}::uuid ORDER BY created_at DESC, id`);
      const results: SupplierEightDDeadlineResultDto[] = [];
      for (const row of rows) {
        const actions: string[] = [];
        if (pending(row)) {
          try {
            // READ must stay SHARE-only; never call a write context from concurrent history requests.
            const context = await this.core.deadlineContext(tx, actor, id, row.stage, 'READ');
            if (actor.id === row.applicantUserId && actor.organizationId === row.applicantOrganizationId) {
              await this.core.authorizeReply(tx, actor, record);
              actions.push('cancel');
            }
            const manager = await this.management(tx, context);
            const userId = row.status === 'QUALITY_PENDING' ? row.sqeUserId : row.managerUserId;
            if (this.matches(row, context, manager) && actor.accountType === 'INTERNAL' && actor.id === userId
              && actor.organizationId === row.organizationId && await this.decisionEligible(tx, row.organizationId, actor.id)) {
              const duty = row.status === 'QUALITY_PENDING' ? 'sqe' : 'manager';
              actions.push(`approve-${duty}`, `return-${duty}`);
            }
          } catch (error) {
            if (!(error instanceof HttpException) || ![403, 404, 409].includes(error.getStatus())) throw error;
          }
        }
        results.push({ ...this.result(row), allowedActions: actions });
      }
      return results;
    });
  }

  async request(actor: SupplierEightDActor, id: string, input: SupplierEightDDeadlineRequestDto, key: string, traceId: string): Promise<SupplierEightDDeadlineResultDto> {
    this.validate(SupplierEightDDeadlineRequestDto, input, id, key);
    const digest = eightDRequestDigest({ action: 'REQUEST', id, input });
    return this.transaction(async tx => {
      const context = await this.core.deadlineContext(tx, actor, id, input.stage, 'REQUEST');
      await this.receiptLock(tx, context, actor, key);
      const receipt = await this.receipt(tx, context, actor, key, 'REQUEST', digest);
      const management = await this.management(tx, context);
      if (receipt) {
        const row = await this.row(tx, context.organizationId, id, receipt.requestId);
        this.current(row, context, management);
        if (row.applicantUserId !== actor.id || row.applicantOrganizationId !== actor.organizationId) fail('WORKFLOW_NODE_FORBIDDEN', 403);
        return this.replay(row, receipt);
      }
      this.versions(input, context);
      try { assertSupplierDeadlineDates(input.stage, context.originalDueAt.toISOString(), input.requestedDueAt); }
      catch { fail('SUPPLIER_INPUT_INVALID', 400); }
      const existing = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM supplier_eight_d_deadline_requests
        WHERE organization_id = ${context.organizationId}::uuid AND supplier_problem_id = ${id}::uuid AND stage = ${input.stage}
          AND status IN ('QUALITY_PENDING', 'MANAGER_PENDING')`;
      if (existing.length) fail('CONCURRENCY_CONFLICT', 409);
      const requestId = randomUUID(), status = initialSupplierDeadlineStatus(context.severity), now = new Date();
      await tx.$executeRaw`INSERT INTO supplier_eight_d_deadline_requests
        (id, organization_id, supplier_problem_id, stage, severity, status, original_due_at, requested_due_at, originally_overdue,
          row_version, content_version, instance_version, sqe_user_id, sqe_assignment_id, sqe_fingerprint, manager_user_id, manager_fingerprint,
          applicant_user_id, applicant_organization_id, reason, created_at, updated_at)
        VALUES (${requestId}::uuid, ${context.organizationId}::uuid, ${id}::uuid, ${input.stage}, ${context.severity}, ${status},
          ${context.originalDueAt}, ${new Date(input.requestedDueAt)}, ${context.originalDueAt < now}, ${context.rowVersion}, ${context.contentVersion},
          ${context.instanceVersion}, ${context.sqeUserId}::uuid, ${context.sqeAssignmentId}::uuid, ${context.sqeFingerprint},
          ${management.userId}::uuid, ${management.fingerprint}, ${actor.id}::uuid, ${actor.organizationId}::uuid, ${input.reason}, ${now}, ${now})`;
      const row = await this.row(tx, context.organizationId, id, requestId), result = this.result(row);
      await this.auditAndReceipt(tx, actor, row, 'REQUEST', key, digest, result, traceId);
      return result;
    });
  }

  async decide(actor: SupplierEightDActor, id: string, requestId: string, input: SupplierEightDDeadlineDecisionDto, key: string, traceId: string): Promise<SupplierEightDDeadlineResultDto> {
    this.validate(SupplierEightDDeadlineDecisionDto, input, id, key); this.uuid(requestId);
    return this.change(actor, id, requestId, input, key, traceId, 'DECIDE');
  }

  async cancel(actor: SupplierEightDActor, id: string, requestId: string, input: SupplierEightDDeadlineCancelDto, key: string, traceId: string): Promise<SupplierEightDDeadlineResultDto> {
    this.validate(SupplierEightDDeadlineCancelDto, input, id, key); this.uuid(requestId);
    return this.change(actor, id, requestId, input, key, traceId, 'CANCEL');
  }

  private async change(actor: SupplierEightDActor, id: string, requestId: string, input: SupplierEightDDeadlineCancelDto | SupplierEightDDeadlineDecisionDto,
    key: string, traceId: string, action: 'DECIDE' | 'CANCEL'): Promise<SupplierEightDDeadlineResultDto> {
    const digest = eightDRequestDigest({ action, id, requestId, input });
    return this.transaction(async tx => {
      const [reference] = await tx.$queryRaw<{ stage: SupplierDeadlineStage }[]>`SELECT stage FROM supplier_eight_d_deadline_requests
        WHERE id = ${requestId}::uuid AND supplier_problem_id = ${id}::uuid`;
      if (!reference) fail('SUPPLIER_RECORD_NOT_FOUND', 404);
      const context = await this.core.deadlineContext(tx, actor, id, reference.stage, action);
      await this.receiptLock(tx, context, actor, key);
      const row = await this.row(tx, context.organizationId, id, requestId);
      if (action === 'DECIDE') this.current(row, context, await this.management(tx, context));
      // Withdrawal never applies a date; let the actual applicant remove a stale pending request.
      else if (!pending(row)) fail('CONCURRENCY_CONFLICT', 409);
      const decisionInput = action === 'DECIDE' ? input as SupplierEightDDeadlineDecisionDto : null;
      if (decisionInput) {
        const userId = decisionInput.duty === 'SQE' ? row.sqeUserId : row.managerUserId;
        if (actor.accountType !== 'INTERNAL' || actor.organizationId !== row.organizationId || actor.id !== userId) fail('WORKFLOW_NODE_FORBIDDEN', 403);
      } else if (actor.id !== row.applicantUserId || actor.organizationId !== row.applicantOrganizationId) fail('WORKFLOW_NODE_FORBIDDEN', 403);
      const receipt = await this.receipt(tx, context, actor, key, action, digest);
      if (receipt) {
        if (receipt.requestId !== requestId) fail('IDEMPOTENCY_REPLAY', 409);
        return this.replay(row, receipt);
      }
      if (input.expectedVersion !== row.version || row.version >= 2147483647) fail('CONCURRENCY_CONFLICT', 409);
      let status: SupplierDeadlineApproval = 'CANCELLED';
      if (decisionInput) {
        try { status = nextSupplierDeadlineStatus({ severity: row.severity, status: row.status, decision: decisionInput.decision,
          duty: decisionInput.duty, actorUserId: actor.id, sqeUserId: row.sqeUserId, managerUserId: row.managerUserId }); }
        catch { fail('WORKFLOW_NODE_FORBIDDEN', 403); }
      }
      const changed = await tx.$executeRaw`UPDATE supplier_eight_d_deadline_requests SET status = ${status}, version = version + 1, updated_at = CURRENT_TIMESTAMP
        WHERE id = ${requestId}::uuid AND organization_id = ${context.organizationId}::uuid AND status = ${row.status} AND version = ${row.version}`;
      if (changed !== 1) fail('CONCURRENCY_CONFLICT', 409);
      await tx.$executeRaw`INSERT INTO supplier_eight_d_deadline_decisions
        (id, request_id, actor_user_id, duty, decision, comment, from_status, to_status, request_version)
        VALUES (${randomUUID()}::uuid, ${requestId}::uuid, ${actor.id}::uuid, ${decisionInput?.duty ?? 'APPLICANT'},
          ${decisionInput?.decision ?? 'CANCEL'}, ${input.comment}, ${row.status}, ${status}, ${row.version + 1})`;
      if (status === 'APPROVED') await this.core.applyDeadlineExtension(tx, actor, context, row.requestedDueAt, traceId);
      const result = this.result({ ...row, status, version: row.version + 1 });
      await this.auditAndReceipt(tx, actor, { ...row, status, version: row.version + 1 }, action, key, digest, result, traceId);
      return result;
    });
  }

  private async management(tx: Prisma.TransactionClient, context: Context): Promise<{ userId: string | null; fingerprint: string | null }> {
    const facts = await this.managementFacts(tx, context);
    if (!facts) fail('CONCURRENCY_CONFLICT', 409);
    return facts;
  }

  private async managementFacts(tx: Prisma.TransactionClient, context: Context): Promise<{ userId: string | null; fingerprint: string | null } | null> {
    if (context.severity === 'LOW' || context.severity === 'MEDIUM') return { userId: null, fingerprint: null };
    const management = context.management;
    if (!management || management.organizationId !== context.organizationId || management.sectionDepartmentId !== context.responsibleSectionDepartmentId) return null;
    const valid = await this.responsibilities.revalidateLockedManagementResponsibilities(tx, management, new Date());
    const sources = management.responsibilities.filter(source => source.responsibility === 'SECTION_MANAGER' && valid.has(source.bindingId));
    if (sources.length !== 1 || management.issues.some(issue => issue.responsibility === 'SECTION_MANAGER')) return null;
    const source = sources[0]!;
    return { userId: source.userId, fingerprint: eightDRequestDigest({ userId: source.userId, assignmentId: source.assignmentId,
      positionId: source.positionId, positionVersion: source.positionVersion, departmentId: source.departmentId, startedAt: source.startedAt, endedAt: source.endedAt,
      bindingId: source.bindingId, bindingVersion: source.bindingVersion, departmentVersion: source.departmentVersion,
      sectionDepartmentVersion: source.sectionDepartmentVersion, organizationVersion: source.organizationVersion }) };
  }

  private current(row: Row, context: Context, manager: { userId: string | null; fingerprint: string | null }) {
    if (!this.matches(row, context, manager)) fail('CONCURRENCY_CONFLICT', 409);
  }

  private matches(row: Row, context: Context, manager: { userId: string | null; fingerprint: string | null }) {
    return pending(row) && row.stage === context.stage && row.severity === context.severity && row.originalDueAt.getTime() === context.originalDueAt.getTime()
      && row.rowVersion === context.rowVersion && row.contentVersion === context.contentVersion && row.instanceVersion === context.instanceVersion
      && row.sqeUserId === context.sqeUserId && row.sqeAssignmentId === context.sqeAssignmentId && row.sqeFingerprint === context.sqeFingerprint
      && row.managerUserId === manager.userId && row.managerFingerprint === manager.fingerprint;
  }

  private versions(input: SupplierEightDDeadlineRequestDto, context: Context) {
    if (input.expectedRowVersion !== context.rowVersion || input.expectedContentVersion !== context.contentVersion || input.expectedInstanceVersion !== context.instanceVersion) fail('CONCURRENCY_CONFLICT', 409);
  }

  private async row(tx: Prisma.TransactionClient, organizationId: string, id: string, requestId: string): Promise<Row> {
    const [row] = await tx.$queryRaw<Row[]>(Prisma.sql`SELECT ${columns} FROM supplier_eight_d_deadline_requests
      WHERE organization_id = ${organizationId}::uuid AND supplier_problem_id = ${id}::uuid AND id = ${requestId}::uuid FOR UPDATE`);
    if (!row) fail('SUPPLIER_RECORD_NOT_FOUND', 404);
    return row;
  }

  private receiptLock(tx: Prisma.TransactionClient, context: Context, actor: SupplierEightDActor, key: string) {
    return tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`supplier-deadline:${context.organizationId}:${actor.id}:${key}`}, 0))::text`;
  }

  private async receipt(tx: Prisma.TransactionClient, context: Context, actor: SupplierEightDActor, key: string, action: string, digest: string): Promise<Receipt | undefined> {
    const [receipt] = await tx.$queryRaw<Receipt[]>`SELECT request_id AS "requestId", supplier_problem_id AS "supplierProblemId", action, digest, response
      FROM supplier_eight_d_deadline_receipts WHERE organization_id = ${context.organizationId}::uuid AND actor_user_id = ${actor.id}::uuid AND key = ${key}`;
    if (receipt && (receipt.supplierProblemId !== context.supplierProblemId || receipt.action !== action || receipt.digest !== digest)) fail('IDEMPOTENCY_REPLAY', 409);
    return receipt;
  }

  private replay(row: Row, receipt: Receipt) {
    if (!pending(row) || row.version !== receipt.response.version || row.status !== receipt.response.status) fail('CONCURRENCY_CONFLICT', 409);
    return this.result(row);
  }

  private async auditAndReceipt(tx: Prisma.TransactionClient, actor: SupplierEightDActor, row: Row, action: string, key: string, digest: string,
    response: SupplierEightDDeadlineResultDto, traceId: string) {
    await this.audit.record({ organizationId: row.organizationId, actorUserId: actor.id,
      action: `SUPPLIER_EIGHT_D_DEADLINE_${action === 'REQUEST' ? 'REQUESTED' : row.status}`, resourceType: 'SupplierEightDDeadline', resourceId: row.id,
      outcome: 'SUCCESS', traceId, metadata: { status: row.status, resourceVersion: row.version } }, tx);
    await tx.$executeRaw`INSERT INTO supplier_eight_d_deadline_receipts
      (organization_id, supplier_problem_id, request_id, actor_user_id, actor_organization_id, key, action, digest, response)
      VALUES (${row.organizationId}::uuid, ${row.supplierProblemId}::uuid, ${row.id}::uuid, ${actor.id}::uuid, ${actor.organizationId}::uuid,
        ${key}, ${action}, ${digest}, ${JSON.stringify(response)}::jsonb)`;
    await this.outbox.enqueue({ eventKey: `supplier-eight-d-deadline:${row.id}:v${row.version}`,
      eventType: 'SUPPLIER_EIGHT_D_DEADLINE_CHANGED', aggregateType: 'SupplierEightDDeadline', aggregateId: row.id,
      payload: { schemaVersion: 1, organizationId: row.organizationId, supplierProblemId: row.supplierProblemId,
        requestId: row.id, version: row.version, stage: row.stage, status: row.status } }, tx);
  }

  private result(row: Row): SupplierEightDDeadlineResultDto {
    return { id: row.id, supplierProblemId: row.supplierProblemId, stage: row.stage, severity: row.severity, status: row.status,
      originalDueAt: row.originalDueAt.toISOString(), requestedDueAt: row.requestedDueAt.toISOString(), originallyOverdue: row.originallyOverdue,
      reason: row.reason, version: row.version, createdAt: row.createdAt.toISOString() };
  }

  private validate<T extends object>(type: new () => T, input: T, id: string, key: string) {
    this.uuid(id);
    if (!input || typeof input !== 'object' || validateSync(plainToInstance(type, input), { whitelist: true, forbidNonWhitelisted: true }).length
      || typeof key !== 'string' || !/^[a-zA-Z0-9._:-]{8,128}$/.test(key)) fail('SUPPLIER_INPUT_INVALID', 400);
  }

  private uuid(id: string) { if (typeof id !== 'string' || !isUUID(id)) fail('SUPPLIER_INPUT_INVALID', 400); }

  private async transaction<T>(work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    try { return await this.prisma.$transaction(work, { isolationLevel: 'ReadCommitted', timeout: 30_000 }); }
    catch (error) {
      const e = error as { code?: string; meta?: { code?: string; driverAdapterError?: { cause?: { originalCode?: string } } } };
      if (isSecurityConcurrencyConflict(error) || e.code === 'P2002' || (e.meta?.code ?? e.meta?.driverAdapterError?.cause?.originalCode) === '23505') fail('CONCURRENCY_CONFLICT', 409);
      throw error;
    }
  }
}
