import { HttpException, Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../database/prisma.service.js';
import { AdminMutationService, assertAdminAccess, type AdminActor, type AdminTransaction } from '../../common/security/admin-mutation.service.js';
import { AuditLogService } from '../audit-log/audit-log.service.js';
import { ProblemIndexService } from '../problem-index/problem-index.service.js';

export type AuditType = 'SYSTEM' | 'PROCESS' | 'PRODUCT' | 'SECOND_PARTY' | 'CUSTOMER';
export type ChecklistResult = 'OK' | 'NG' | 'NA';
export type NcSeverity = 'MINOR' | 'MAJOR' | 'CRITICAL';
export interface AuditImportAdapter<ExternalRecord = unknown> { readonly sourceSystem: 'CUSTOMER' | 'SECOND_PARTY'; map(record: ExternalRecord): { externalKey: string; payload: Record<string, unknown> }; }

type Row = Record<string, any>;
const WRITE = 'audit-management:write';
const READ = 'audit-management:read';
const AUDIT_TYPES: AuditType[] = ['SYSTEM', 'PROCESS', 'PRODUCT', 'SECOND_PARTY', 'CUSTOMER'];

function fail(code: string, status: number): never { throw new HttpException({ code, message: code }, status); }
function uuid(value: string, code = 'AUDIT_INPUT_INVALID'): string { if (!/^[0-9a-f-]{36}$/i.test(value)) fail(code, 400); return value; }
function text(value: string, max: number): string { const result = value?.trim(); if (!result || result.length > max) fail('AUDIT_INPUT_INVALID', 400); return result; }
function iso(value: string): Date { const result = new Date(value); if (Number.isNaN(result.getTime())) fail('AUDIT_INPUT_INVALID', 400); return result; }
function templateItemKeys(definition: unknown): Set<string> {
  if (!definition || typeof definition !== 'object' || Array.isArray(definition)) fail('AUDIT_TEMPLATE_DEFINITION_INVALID', 400);
  const items = (definition as Record<string, unknown>).items;
  if (!Array.isArray(items) || items.length === 0) fail('AUDIT_TEMPLATE_DEFINITION_INVALID', 400);
  const keys = new Set<string>();
  for (const item of items) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) fail('AUDIT_TEMPLATE_DEFINITION_INVALID', 400);
    const fields = item as Record<string, unknown>;
    if (typeof fields.key !== 'string' || typeof fields.text !== 'string') fail('AUDIT_TEMPLATE_DEFINITION_INVALID', 400);
    const key = text(fields.key, 120);
    text(fields.text, 2000);
    if (keys.has(key)) fail('AUDIT_TEMPLATE_DEFINITION_INVALID', 400);
    keys.add(key);
  }
  return keys;
}

@Injectable()
export class AuditManagementService {
  constructor(private readonly prisma: PrismaService, private readonly mutations: AdminMutationService, private readonly audit: AuditLogService, private readonly problems?: ProblemIndexService) {}

  private scope(actor: AdminActor): string { if (actor.accountType !== 'INTERNAL') fail('ORGANIZATION_SCOPE_DENIED', 403); return actor.scopeOrganizationId ?? actor.organizationId; }

  private async read<T>(actor: AdminActor, work: (tx: AdminTransaction, organizationId: string) => Promise<T>): Promise<T> {
    if (actor.accountType !== 'INTERNAL') fail('ORGANIZATION_SCOPE_DENIED', 403);
    const organizationId = this.scope(actor);
    return this.prisma.$transaction(async (tx) => { await assertAdminAccess(tx, actor, organizationId, READ); return work(tx, organizationId); });
  }

  createPlan(actor: AdminActor, input: { year: number; title: string; auditType: AuditType; plannedStart: string; plannedEnd: string }, traceId: string, key?: string) {
    const organizationId = this.scope(actor);
    const title = text(input.title, 300); const start = iso(input.plannedStart); const end = iso(input.plannedEnd);
    if (!Number.isInteger(input.year) || input.year < 2000 || input.year > 2200 || end < start || !AUDIT_TYPES.includes(input.auditType)) fail('AUDIT_INPUT_INVALID', 400);
    return this.mutations.run({ actor, organizationId, key, traceId, action: 'AUDIT_PLAN_CREATED', permission: WRITE, payload: { ...input, plannedStart: start.toISOString(), plannedEnd: end.toISOString() } }, async (tx) => {
      const [row] = await tx.$queryRaw<Row[]>(Prisma.sql`INSERT INTO audit_plans(id, organization_id, year, title, audit_type, planned_start, planned_end, created_by_id, updated_by_id) VALUES (gen_random_uuid(), ${organizationId}::uuid, ${input.year}, ${title}, ${input.auditType}, ${start}, ${end}, ${actor.id}::uuid, ${actor.id}::uuid) RETURNING *`);
      await this.record(tx, actor, organizationId, 'AUDIT_PLAN_CREATED', row.id, traceId); return row;
    });
  }

  async getPlan(actor: AdminActor, id: string) { return this.read(actor, async (tx, organizationId) => { const [row] = await tx.$queryRaw<Row[]>(Prisma.sql`SELECT * FROM audit_plans WHERE organization_id = ${organizationId}::uuid AND id = ${uuid(id)}::uuid`); if (!row) fail('AUDIT_PLAN_NOT_FOUND', 404); return row; }); }

  updatePlan(actor: AdminActor, id: string, input: { expectedVersion: number; title?: string; plannedStart?: string; plannedEnd?: string; status?: string }, traceId: string, key?: string) {
    const organizationId = this.scope(actor); const planId = uuid(id);
    return this.mutations.run({ actor, organizationId, key, traceId, action: 'AUDIT_PLAN_UPDATED', permission: WRITE, payload: input }, async (tx) => {
      const current = await this.lockPlan(tx, organizationId, planId); if (current.version !== input.expectedVersion) fail('CONCURRENCY_CONFLICT', 409);
      const title = input.title === undefined ? current.title : text(input.title, 300); const start = input.plannedStart ? iso(input.plannedStart) : current.planned_start; const end = input.plannedEnd ? iso(input.plannedEnd) : current.planned_end;
      if (end < start) fail('AUDIT_INPUT_INVALID', 400);
      if (input.status !== undefined) {
        const transitions: Record<string, string[]> = { PLANNED: ['APPROVED', 'CANCELLED'], APPROVED: ['IN_PROGRESS', 'CANCELLED'], IN_PROGRESS: ['COMPLETED', 'CANCELLED'], COMPLETED: [], CANCELLED: [] };
        if (!transitions[current.status]?.includes(input.status)) fail('AUDIT_PLAN_STATE_INVALID', 409);
      }
      const [row] = await tx.$queryRaw<Row[]>(Prisma.sql`UPDATE audit_plans SET title = ${title}, planned_start = ${start}, planned_end = ${end}, status = COALESCE(${input.status ?? null}, status), version = version + 1, updated_by_id = ${actor.id}::uuid, updated_at = CURRENT_TIMESTAMP WHERE organization_id = ${organizationId}::uuid AND id = ${planId}::uuid AND version = ${input.expectedVersion} RETURNING *`);
      if (!row) fail('CONCURRENCY_CONFLICT', 409); await this.record(tx, actor, organizationId, 'AUDIT_PLAN_UPDATED', planId, traceId); return row;
    });
  }

  requestPostponement(actor: AdminActor, id: string, input: { expectedVersion: number; proposedStart: string; proposedEnd: string; reason: string }, traceId: string, key?: string) {
    const organizationId = this.scope(actor); const planId = uuid(id); const start = iso(input.proposedStart); const end = iso(input.proposedEnd); if (end < start) fail('AUDIT_INPUT_INVALID', 400);
    return this.mutations.run({ actor, organizationId, key, traceId, action: 'AUDIT_POSTPONEMENT_REQUESTED', permission: WRITE, payload: input }, async (tx) => {
      const current = await this.lockPlan(tx, organizationId, planId); if (current.version !== input.expectedVersion) fail('CONCURRENCY_CONFLICT', 409);
      const [row] = await tx.$queryRaw<Row[]>(Prisma.sql`INSERT INTO audit_postponements(id, organization_id, plan_id, original_start, original_end, proposed_start, proposed_end, reason, plan_version, requested_by_id) VALUES (gen_random_uuid(), ${organizationId}::uuid, ${planId}::uuid, ${current.planned_start}, ${current.planned_end}, ${start}, ${end}, ${text(input.reason, 2000)}, ${current.version}, ${actor.id}::uuid) RETURNING *`); await this.record(tx, actor, organizationId, 'AUDIT_POSTPONEMENT_REQUESTED', row.id, traceId); return row;
    });
  }

  approvePostponement(actor: AdminActor, id: string, approve: boolean, expectedVersion: number, traceId: string, key?: string) {
    const organizationId = this.scope(actor); const requestId = uuid(id);
    return this.mutations.run({ actor, organizationId, key, traceId, action: 'AUDIT_POSTPONEMENT_DECIDED', permission: WRITE, payload: { id, approve, expectedVersion } }, async (tx) => {
      const [request] = await tx.$queryRaw<Row[]>(Prisma.sql`SELECT * FROM audit_postponements WHERE organization_id = ${organizationId}::uuid AND id = ${requestId}::uuid FOR UPDATE`); if (!request) fail('AUDIT_POSTPONEMENT_NOT_FOUND', 404); if (request.version !== expectedVersion || request.status !== 'PENDING') fail('CONCURRENCY_CONFLICT', 409);
      const [plan] = await tx.$queryRaw<Row[]>(Prisma.sql`SELECT * FROM audit_plans WHERE organization_id = ${organizationId}::uuid AND id = ${request.plan_id}::uuid FOR UPDATE`); if (!plan) fail('AUDIT_PLAN_NOT_FOUND', 404); if (approve && plan.version !== request.plan_version) fail('CONCURRENCY_CONFLICT', 409);
      if (approve) await tx.$executeRaw(Prisma.sql`UPDATE audit_plans SET planned_start = ${request.proposed_start}, planned_end = ${request.proposed_end}, version = version + 1, updated_by_id = ${actor.id}::uuid, updated_at = CURRENT_TIMESTAMP WHERE organization_id = ${organizationId}::uuid AND id = ${request.plan_id}::uuid AND version = ${request.plan_version}`);
      const [row] = await tx.$queryRaw<Row[]>(Prisma.sql`UPDATE audit_postponements SET status = ${approve ? 'APPROVED' : 'REJECTED'}, decided_by_id = ${actor.id}::uuid, decided_at = CURRENT_TIMESTAMP, version = version + 1 WHERE id = ${requestId}::uuid RETURNING *`); await this.record(tx, actor, organizationId, 'AUDIT_POSTPONEMENT_DECIDED', row.id, traceId); return row;
    });
  }

  createTemplate(actor: AdminActor, input: { name: string; auditType: AuditType; definition: Record<string, unknown> }, traceId: string, key?: string) {
    const organizationId = this.scope(actor); const name = text(input.name, 300); if (!AUDIT_TYPES.includes(input.auditType)) fail('AUDIT_INPUT_INVALID', 400); templateItemKeys(input.definition);
    return this.mutations.run({ actor, organizationId, key, traceId, action: 'AUDIT_TEMPLATE_CREATED', permission: WRITE, payload: input }, async (tx) => { const [row] = await tx.$queryRaw<Row[]>(Prisma.sql`INSERT INTO audit_templates(id, organization_id, name, audit_type, draft_definition, created_by_id, updated_by_id) VALUES (gen_random_uuid(), ${organizationId}::uuid, ${name}, ${input.auditType}, ${JSON.stringify(input.definition)}::jsonb, ${actor.id}::uuid, ${actor.id}::uuid) RETURNING *`); await this.record(tx, actor, organizationId, 'AUDIT_TEMPLATE_CREATED', row.id, traceId); return row; });
  }

  updateTemplate(actor: AdminActor, id: string, input: { expectedVersion: number; definition: Record<string, unknown> }, traceId: string, key?: string) {
    const organizationId = this.scope(actor); const templateId = uuid(id);
    return this.mutations.run({ actor, organizationId, key, traceId, action: 'AUDIT_TEMPLATE_UPDATED', permission: WRITE, payload: input }, async (tx) => { const [current] = await tx.$queryRaw<Row[]>(Prisma.sql`SELECT * FROM audit_templates WHERE organization_id = ${organizationId}::uuid AND id = ${templateId}::uuid FOR UPDATE`); if (!current) fail('AUDIT_TEMPLATE_NOT_FOUND', 404); if (current.status !== 'DRAFT' || current.version !== input.expectedVersion) fail('CONCURRENCY_CONFLICT', 409); templateItemKeys(input.definition); const [row] = await tx.$queryRaw<Row[]>(Prisma.sql`UPDATE audit_templates SET draft_definition = ${JSON.stringify(input.definition)}::jsonb, version = version + 1, updated_by_id = ${actor.id}::uuid, updated_at = CURRENT_TIMESTAMP WHERE id = ${templateId}::uuid AND version = ${input.expectedVersion} RETURNING *`); await this.record(tx, actor, organizationId, 'AUDIT_TEMPLATE_UPDATED', row.id, traceId); return row; });
  }

  publishTemplate(actor: AdminActor, id: string, expectedVersion: number, traceId: string, key?: string) {
    const organizationId = this.scope(actor); const templateId = uuid(id);
    return this.mutations.run({ actor, organizationId, key, traceId, action: 'AUDIT_TEMPLATE_PUBLISHED', permission: WRITE, payload: { id, expectedVersion } }, async (tx) => { const [current] = await tx.$queryRaw<Row[]>(Prisma.sql`SELECT * FROM audit_templates WHERE organization_id = ${organizationId}::uuid AND id = ${templateId}::uuid FOR UPDATE`); if (!current || current.status !== 'DRAFT' || current.version !== expectedVersion) fail('CONCURRENCY_CONFLICT', 409); templateItemKeys(current.draft_definition); const [version] = await tx.$queryRaw<Row[]>(Prisma.sql`INSERT INTO audit_template_versions(id, organization_id, template_id, version, definition, published_by_id) VALUES (gen_random_uuid(), ${organizationId}::uuid, ${templateId}::uuid, 1, ${JSON.stringify(current.draft_definition)}::jsonb, ${actor.id}::uuid) RETURNING *`); await tx.$executeRaw(Prisma.sql`UPDATE audit_templates SET status = 'PUBLISHED', version = version + 1, updated_by_id = ${actor.id}::uuid, updated_at = CURRENT_TIMESTAMP WHERE id = ${templateId}::uuid`); await this.record(tx, actor, organizationId, 'AUDIT_TEMPLATE_PUBLISHED', templateId, traceId); return { ...current, versionId: version.id, publishedVersion: version.version }; });
  }

  createExecution(actor: AdminActor, planId: string, templateVersionId: string, traceId: string, key?: string) { const organizationId = this.scope(actor); return this.mutations.run({ actor, organizationId, key, traceId, action: 'AUDIT_EXECUTION_CREATED', permission: WRITE, payload: { planId, templateVersionId } }, async (tx) => { const [plan] = await tx.$queryRaw<Row[]>(Prisma.sql`SELECT id, audit_type FROM audit_plans WHERE organization_id = ${organizationId}::uuid AND id = ${uuid(planId)}::uuid`); if (!plan) fail('AUDIT_PLAN_NOT_FOUND', 404); const [template] = await tx.$queryRaw<Row[]>(Prisma.sql`SELECT v.id, t.audit_type FROM audit_template_versions v JOIN audit_templates t ON t.id = v.template_id AND t.organization_id = v.organization_id WHERE v.organization_id = ${organizationId}::uuid AND v.id = ${uuid(templateVersionId)}::uuid`); if (!template) fail('AUDIT_TEMPLATE_VERSION_NOT_FOUND', 404); if (plan.audit_type !== template.audit_type) fail('AUDIT_TYPE_MISMATCH', 409); const [row] = await tx.$queryRaw<Row[]>(Prisma.sql`INSERT INTO audit_executions(organization_id, plan_id, template_version_id, created_by_id) VALUES (${organizationId}::uuid, ${uuid(planId)}::uuid, ${uuid(templateVersionId)}::uuid, ${actor.id}::uuid) RETURNING *`); await this.record(tx, actor, organizationId, 'AUDIT_EXECUTION_CREATED', row.id, traceId); return row; }); }

  recordChecklistResult(actor: AdminActor, executionId: string, input: { itemKey: string; result: ChecklistResult; note?: string }, traceId: string, key?: string) { const organizationId = this.scope(actor); if (!['OK', 'NG', 'NA'].includes(input.result)) fail('AUDIT_INPUT_INVALID', 400); const itemKey = text(input.itemKey, 120); return this.mutations.run({ actor, organizationId, key, traceId, action: 'AUDIT_CHECKLIST_RECORDED', permission: WRITE, payload: input }, async (tx) => { const [execution] = await tx.$queryRaw<Row[]>(Prisma.sql`SELECT id, status, template_version_id FROM audit_executions WHERE organization_id = ${organizationId}::uuid AND id = ${uuid(executionId)}::uuid FOR UPDATE`); if (!execution) fail('AUDIT_EXECUTION_NOT_FOUND', 404); if (execution.status !== 'OPEN') fail('AUDIT_EXECUTION_LOCKED', 409); const [templateVersion] = await tx.$queryRaw<Row[]>(Prisma.sql`SELECT definition FROM audit_template_versions WHERE organization_id = ${organizationId}::uuid AND id = ${execution.template_version_id}::uuid`); if (!templateVersion || !templateItemKeys(templateVersion.definition).has(itemKey)) fail('AUDIT_CHECKLIST_ITEM_NOT_FOUND', 400); const [linkedNc] = await tx.$queryRaw<Row[]>(Prisma.sql`SELECT n.id FROM audit_ncs n JOIN audit_checklist_results r ON r.id = n.checklist_result_id AND r.organization_id = n.organization_id WHERE r.organization_id = ${organizationId}::uuid AND r.execution_id = ${uuid(executionId)}::uuid AND r.item_key = ${itemKey}`); if (linkedNc) fail('AUDIT_CHECKLIST_NC_LOCKED', 409); const [row] = await tx.$queryRaw<Row[]>(Prisma.sql`INSERT INTO audit_checklist_results(organization_id, execution_id, item_key, result, note, recorded_by_id) VALUES (${organizationId}::uuid, ${uuid(executionId)}::uuid, ${itemKey}, ${input.result}, ${input.note ?? null}, ${actor.id}::uuid) ON CONFLICT (organization_id, execution_id, item_key) DO UPDATE SET result = EXCLUDED.result, note = EXCLUDED.note, version = audit_checklist_results.version + 1, recorded_by_id = EXCLUDED.recorded_by_id RETURNING *`); await this.record(tx, actor, organizationId, 'AUDIT_CHECKLIST_RECORDED', row.id, traceId); return row; }); }

  async createNcFromNg(actor: AdminActor, executionId: string, resultId: string, input: { severity: NcSeverity; dueAt: string; duePolicyVersion: string; calendarVersion: string; dueBusinessDays: number }, traceId: string, key?: string) { const organizationId = this.scope(actor); const duePolicyVersion = text(input.duePolicyVersion, 100); const calendarVersion = text(input.calendarVersion, 100); if (!['MINOR', 'MAJOR', 'CRITICAL'].includes(input.severity) || !Number.isInteger(input.dueBusinessDays) || input.dueBusinessDays < 1) fail('AUDIT_INPUT_INVALID', 400); const dueAt = iso(input.dueAt); return this.mutations.run({ actor, organizationId, key, traceId, action: 'AUDIT_NC_CREATED', permission: WRITE, payload: { ...input, dueAt: dueAt.toISOString(), duePolicyVersion, calendarVersion } }, async (tx) => { const [execution] = await tx.$queryRaw<Row[]>(Prisma.sql`SELECT status FROM audit_executions WHERE organization_id = ${organizationId}::uuid AND id = ${uuid(executionId)}::uuid FOR UPDATE`); if (!execution) fail('AUDIT_EXECUTION_NOT_FOUND', 404); if (!['OPEN', 'SUBMITTED'].includes(execution.status)) fail('AUDIT_EXECUTION_LOCKED', 409); const [result] = await tx.$queryRaw<Row[]>(Prisma.sql`SELECT * FROM audit_checklist_results WHERE organization_id = ${organizationId}::uuid AND execution_id = ${uuid(executionId)}::uuid AND id = ${uuid(resultId)}::uuid FOR UPDATE`); if (!result) fail('AUDIT_CHECKLIST_RESULT_NOT_FOUND', 404); if (result.result !== 'NG') fail('AUDIT_NG_REQUIRED', 409); const [row] = await tx.$queryRaw<Row[]>(Prisma.sql`INSERT INTO audit_ncs(organization_id, execution_id, checklist_result_id, severity, due_at, due_policy_version, calendar_version, due_business_days, created_by_id) VALUES (${organizationId}::uuid, ${uuid(executionId)}::uuid, ${uuid(resultId)}::uuid, ${input.severity}, ${dueAt}, ${duePolicyVersion}, ${calendarVersion}, ${input.dueBusinessDays}, ${actor.id}::uuid) ON CONFLICT (organization_id, checklist_result_id) DO NOTHING RETURNING *`); if (!row) fail('AUDIT_NC_ALREADY_EXISTS', 409); if (this.problems) { const problem = await this.problems.createForDomainSourceIssue(tx as never, { organizationId, domainCode: 'audit-management', problemType: 'AUDIT_NC', sourceType: 'audit-nc', sourceId: row.id, severity: input.severity, responsibleParty: 'audit-management', dueAt, createdById: actor.id, traceId }); await tx.$executeRaw(Prisma.sql`UPDATE audit_ncs SET problem_index_id = ${String(problem.id)}::uuid WHERE organization_id = ${organizationId}::uuid AND id = ${row.id}::uuid`); row.problem_index_id = String(problem.id); } await this.record(tx, actor, organizationId, 'AUDIT_NC_CREATED', row.id, traceId); return row; }); }

  assignNc(actor: AdminActor, id: string, assigneeUserId: string, expectedVersion: number, traceId: string, key?: string) { return this.ncUpdate(actor, id, expectedVersion, 'ASSIGNED', { assigneeUserId: uuid(assigneeUserId) }, traceId, key); }
  respondNc(actor: AdminActor, id: string, input: { expectedVersion: number; response: string }, traceId: string, key?: string) { return this.ncUpdate(actor, id, input.expectedVersion, 'RESPONDED', { response: text(input.response, 10000) }, traceId, key); }
  verifyNc(actor: AdminActor, id: string, expectedVersion: number, accepted: boolean, traceId: string, key?: string) { return this.ncUpdate(actor, id, expectedVersion, accepted ? 'VERIFIED' : 'REJECTED', { verificationNote: accepted ? '验证通过' : '验证退回', verifiedById: actor.id }, traceId, key); }
  closeNc(actor: AdminActor, id: string, expectedVersion: number, traceId: string, key?: string) { return this.ncUpdate(actor, id, expectedVersion, 'CLOSED', { closedById: actor.id }, traceId, key, true); }

  private ncUpdate(actor: AdminActor, id: string, expectedVersion: number, status: string, changes: Record<string, string>, traceId: string, key?: string, requireVerified = false) { const organizationId = this.scope(actor); return this.mutations.run({ actor, organizationId, key, traceId, action: `AUDIT_NC_${status}`, permission: WRITE, payload: { id, expectedVersion, status, changes } }, async (tx) => { const [current] = await tx.$queryRaw<Row[]>(Prisma.sql`SELECT * FROM audit_ncs WHERE organization_id = ${organizationId}::uuid AND id = ${uuid(id)}::uuid FOR UPDATE`); if (!current) fail('AUDIT_NC_NOT_FOUND', 404); if (current.version !== expectedVersion) fail('CONCURRENCY_CONFLICT', 409); if (status === 'ASSIGNED' && !['OPEN', 'REJECTED'].includes(current.status)) fail('AUDIT_NC_STATE_INVALID', 409); if (changes.assigneeUserId) { const [assignee] = await tx.$queryRaw<Row[]>(Prisma.sql`SELECT id FROM users WHERE organization_id = ${organizationId}::uuid AND id = ${changes.assigneeUserId}::uuid AND account_type = 'INTERNAL' AND status = 'ACTIVE'`); if (!assignee) fail('AUDIT_ASSIGNEE_SCOPE_DENIED', 403); } if (requireVerified && current.status !== 'VERIFIED') fail('AUDIT_NC_VERIFY_REQUIRED', 409); if (status === 'RESPONDED' && !['ASSIGNED','REJECTED'].includes(current.status)) fail('AUDIT_NC_STATE_INVALID', 409); if (status === 'RESPONDED' && current.assignee_user_id !== actor.id) fail('AUDIT_NC_RESPONDER_DENIED', 403); if (['VERIFIED', 'REJECTED'].includes(status) && current.status !== 'RESPONDED') fail('AUDIT_NC_STATE_INVALID', 409); if (['VERIFIED', 'REJECTED'].includes(status) && [current.assignee_user_id, current.responded_by_id].includes(actor.id)) fail('AUDIT_NC_REVIEWER_DENIED', 403); if (status === 'CLOSED' && current.status !== 'VERIFIED') fail('AUDIT_NC_VERIFY_REQUIRED', 409); const [row] = await tx.$queryRaw<Row[]>(Prisma.sql`UPDATE audit_ncs SET status = ${status}, assignee_user_id = COALESCE(${changes.assigneeUserId ?? null}::uuid, assignee_user_id), assigned_by_id = CASE WHEN ${status} = 'ASSIGNED' THEN ${actor.id}::uuid ELSE assigned_by_id END, response = COALESCE(${changes.response ?? null}, response), responded_by_id = CASE WHEN ${status} = 'RESPONDED' THEN ${actor.id}::uuid ELSE responded_by_id END, verification_note = COALESCE(${changes.verificationNote ?? null}, verification_note), verified_by_id = COALESCE(${changes.verifiedById ?? null}::uuid, verified_by_id), closed_by_id = COALESCE(${changes.closedById ?? null}::uuid, closed_by_id), version = version + 1, updated_at = CURRENT_TIMESTAMP WHERE organization_id = ${organizationId}::uuid AND id = ${uuid(id)}::uuid AND version = ${expectedVersion} RETURNING *`); if (!row) fail('CONCURRENCY_CONFLICT', 409); await this.record(tx, actor, organizationId, `AUDIT_NC_${status}`, row.id, traceId); return row; }); }

  importCustomerOrSecondPartyRow(actor: AdminActor, adapter: AuditImportAdapter, record: unknown, traceId: string, key?: string) { const organizationId = this.scope(actor); if (!['CUSTOMER', 'SECOND_PARTY'].includes(adapter.sourceSystem)) fail('AUDIT_IMPORT_SOURCE_INVALID', 400); const mapped = adapter.map(record); const externalKey = text(mapped.externalKey, 200); if (!mapped.payload || typeof mapped.payload !== 'object' || Array.isArray(mapped.payload)) fail('AUDIT_INPUT_INVALID', 400); return this.mutations.run({ actor, organizationId, key, traceId, action: 'AUDIT_IMPORT_ROW_RECORDED', permission: WRITE, payload: { sourceSystem: adapter.sourceSystem, externalKey, payload: mapped.payload } }, async (tx) => { const [row] = await tx.$queryRaw<Row[]>(Prisma.sql`INSERT INTO audit_import_rows(organization_id, source_system, external_key, payload, imported_by_id) VALUES (${organizationId}::uuid, ${adapter.sourceSystem}, ${externalKey}, ${JSON.stringify(mapped.payload)}::jsonb, ${actor.id}::uuid) RETURNING *`); await this.record(tx, actor, organizationId, 'AUDIT_IMPORT_ROW_RECORDED', row.id, traceId); return row; }); }

  private async lockPlan(tx: AdminTransaction, organizationId: string, id: string) { const [row] = await tx.$queryRaw<Row[]>(Prisma.sql`SELECT * FROM audit_plans WHERE organization_id = ${organizationId}::uuid AND id = ${id}::uuid FOR UPDATE`); if (!row) fail('AUDIT_PLAN_NOT_FOUND', 404); return row; }
  private record(tx: AdminTransaction, actor: AdminActor, organizationId: string, action: string, resourceId: string, traceId: string) { return this.audit.record({ organizationId, actorUserId: actor.id, action, resourceType: 'AuditManagement', resourceId, outcome: 'SUCCESS', traceId }, tx); }
}
