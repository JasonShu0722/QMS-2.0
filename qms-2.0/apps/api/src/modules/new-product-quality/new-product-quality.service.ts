import { createHash, randomUUID } from 'node:crypto';
import { HttpException, Injectable, Optional } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../database/prisma.service.js';
import { AdminMutationService, assertAdminAccess, type AdminActor, type AdminTransaction } from '../../common/security/admin-mutation.service.js';
import { AuditLogService } from '../audit-log/audit-log.service.js';
import { ProblemIndexService } from '../problem-index/problem-index.service.js';
import { WorkflowRuntimeService } from '../workflow/workflow-runtime.service.js';
import { WorkflowUpgradeService } from '../workflow/workflow-upgrade.service.js';
import { jsonObject } from '../workflow/workflow-runtime-policy.js';
import { renderTrialSummaryReport, type TrialSummaryReport } from './trial-summary-report.js';
import { NewProductEightDSourceService } from './new-product-eight-d-source.service.js';

export type TrialMetricCode = 'INPUT' | 'OUTPUT' | 'FIRST_PASS' | 'DEFECT' | 'CPK' | 'DIMENSION_PASS_RATE';
export interface TrialMetricSourceAdapter<ExternalRecord> {
  readonly system: 'IMS';
  map(record: ExternalRecord): { workOrderCode: string; metrics: Partial<Record<TrialMetricCode, number>> };
}
export type NewProductIssueComplexity = 'SIMPLE' | 'COMPLEX';

type Row = Record<string, any>;
const READ = 'new-product-quality:projects:read';
const WRITE = 'new-product-quality:projects:write';
const METRICS: TrialMetricCode[] = ['INPUT', 'OUTPUT', 'FIRST_PASS', 'DEFECT', 'CPK', 'DIMENSION_PASS_RATE'];
const COUNT_METRICS: TrialMetricCode[] = ['INPUT', 'OUTPUT', 'FIRST_PASS', 'DEFECT'];

function fail(code: string, status: number): never { throw new HttpException({ code, message: code }, status); }
function uuid(value: string): string { if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) fail('NEW_PRODUCT_INPUT_INVALID', 400); return value; }
function text(value: string, max: number): string { const normalized = value?.trim(); if (!normalized || normalized.length > max) fail('NEW_PRODUCT_INPUT_INVALID', 400); return normalized; }
function optional(value: string | undefined, max: number): string | null { return value === undefined ? null : text(value, max); }
function version(value: number): number { if (!Number.isSafeInteger(value) || value < 1) fail('NEW_PRODUCT_INPUT_INVALID', 400); return value; }
function mapUnique(error: unknown): never {
  if ((error as { code?: string }).code === '23505' || String(error).includes('duplicate key')) fail('CONCURRENCY_CONFLICT', 409);
  throw error;
}
function csvCell(value: unknown): string {
  const normalized = value === null || value === undefined ? '' : String(value);
  const safe = /^[\s\u0000-\u001f]*[=+@-]/.test(normalized) || /^[\t\r\n]/.test(normalized) ? `'${normalized}` : normalized;
  return `"${safe.replaceAll('"', '""')}"`;
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([first], [second]) => first.localeCompare(second)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}

@Injectable()
export class NewProductQualityService {
  constructor(private readonly prisma: PrismaService, private readonly mutations: AdminMutationService, private readonly audit: AuditLogService, private readonly problems?: ProblemIndexService, private readonly runtime?: WorkflowRuntimeService, @Optional() private readonly upgrades?: WorkflowUpgradeService, @Optional() private readonly sources?: NewProductEightDSourceService) {}

  private sourceService(): NewProductEightDSourceService {
    if (!this.sources) fail('NEW_PRODUCT_SOURCE_SERVICE_REQUIRED', 503);
    return this.sources;
  }

  private scope(actor: AdminActor): string {
    if (actor.accountType !== 'INTERNAL') fail('ORGANIZATION_SCOPE_DENIED', 403);
    return actor.scopeOrganizationId ?? actor.organizationId;
  }

  private async read<Result>(actor: AdminActor, work: (tx: AdminTransaction, organizationId: string) => Promise<Result>, isolationLevel: Prisma.TransactionIsolationLevel = 'ReadCommitted'): Promise<Result> {
    const organizationId = this.scope(actor);
    return this.prisma.$transaction(async (tx) => { await assertAdminAccess(tx, actor, organizationId, READ); return work(tx, organizationId); }, { isolationLevel });
  }

  private async record(tx: AdminTransaction, actor: AdminActor, organizationId: string, action: string, resourceType: string, resourceId: string, traceId: string) {
    await this.audit.record({ organizationId, actorUserId: actor.id, action, resourceType, resourceId, outcome: 'SUCCESS', traceId }, tx);
  }

  private async availableEvidence(tx: AdminTransaction, organizationId: string, id: string, resourceType: string, resourceId: string, resourceVersion: number) {
    const [file] = await tx.$queryRaw<Row[]>(Prisma.sql`SELECT id FROM file_objects WHERE id = ${uuid(id)}::uuid AND organization_id = ${organizationId}::uuid AND status = 'AVAILABLE' AND scan_status = 'CLEAN' AND deleted_at IS NULL AND resource_type = ${resourceType} AND resource_id = ${resourceId} AND resource_version = ${resourceVersion}`);
    if (!file) fail('NEW_PRODUCT_EVIDENCE_UNAVAILABLE', 409);
  }

  async createProject(actor: AdminActor, input: { code: string; name: string; productCode: string }, traceId: string, key?: string) {
    const organizationId = this.scope(actor);
    const code = text(input.code, 100).toUpperCase(); const name = text(input.name, 200); const productCode = text(input.productCode, 100);
    return this.mutations.run({ actor, organizationId, key, traceId, action: 'NEW_PRODUCT_PROJECT_CREATED', payload: { code, name, productCode }, permission: WRITE }, async (tx) => {
      const id = randomUUID();
      const [row] = await tx.$queryRaw<Row[]>(Prisma.sql`INSERT INTO new_product_projects(id, organization_id, code, name, product_code, created_by_id) VALUES (${id}::uuid, ${organizationId}::uuid, ${code}, ${name}, ${productCode}, ${actor.id}::uuid) RETURNING *`);
      await tx.$executeRaw(Prisma.sql`INSERT INTO new_product_lesson_checks(id, organization_id, project_id, lesson_id, created_by_id) SELECT gen_random_uuid(), ${organizationId}::uuid, ${id}::uuid, lesson.id, ${actor.id}::uuid FROM new_product_lessons lesson WHERE lesson.organization_id = ${organizationId}::uuid AND lesson.product_code = ${productCode}`);
      await this.record(tx, actor, organizationId, 'NEW_PRODUCT_PROJECT_CREATED', 'NewProductProject', id, traceId);
      return row;
    }).catch(mapUnique);
  }

  async projectDetail(actor: AdminActor, projectId: string) {
    const id = uuid(projectId);
    return this.read(actor, async (tx, organizationId) => {
      const [project] = await tx.$queryRaw<Row[]>(Prisma.sql`SELECT * FROM new_product_projects WHERE id = ${id}::uuid AND organization_id = ${organizationId}::uuid`);
      if (!project) fail('NEW_PRODUCT_PROJECT_NOT_FOUND', 404);
      const stages = await tx.$queryRaw<Row[]>(Prisma.sql`SELECT * FROM new_product_stages WHERE project_id = ${id}::uuid AND organization_id = ${organizationId}::uuid ORDER BY created_at, id`);
      const lessons = await tx.$queryRaw<Row[]>(Prisma.sql`SELECT lesson_checks.*, lessons.title, lessons.lesson FROM new_product_lesson_checks lesson_checks JOIN new_product_lessons lessons ON lessons.id = lesson_checks.lesson_id AND lessons.organization_id = lesson_checks.organization_id WHERE lesson_checks.project_id = ${id}::uuid AND lesson_checks.organization_id = ${organizationId}::uuid ORDER BY lesson_checks.created_at, lesson_checks.id`);
      const batches = await tx.$queryRaw<Row[]>(Prisma.sql`SELECT * FROM new_product_trial_batches WHERE project_id = ${id}::uuid AND organization_id = ${organizationId}::uuid ORDER BY created_at, id`);
      const selected_defects = await tx.$queryRaw<Row[]>(Prisma.sql`SELECT * FROM new_product_defect_selections WHERE project_id = ${id}::uuid AND organization_id = ${organizationId}::uuid ORDER BY selected_at, id`);
      if (selected_defects.length) await NewProductEightDSourceService.assertRead(tx, actor, organizationId);
      const [handover] = await tx.$queryRaw<Row[]>(Prisma.sql`SELECT * FROM new_product_handovers WHERE project_id = ${id}::uuid AND organization_id = ${organizationId}::uuid`);
      const [earlyFlow] = await tx.$queryRaw<Row[]>(Prisma.sql`SELECT flow.*, release.decision AS release_decision, release.note AS release_note, release.evidence_object_id AS release_evidence_object_id, release.decided_by_id AS release_decided_by_id, release.decided_at AS release_decided_at, release.flow_version AS release_flow_version FROM new_product_early_flows flow LEFT JOIN new_product_early_flow_releases release ON release.early_flow_id = flow.id AND release.organization_id = flow.organization_id AND release.flow_version = flow.version WHERE flow.project_id = ${id}::uuid AND flow.organization_id = ${organizationId}::uuid`);
      const issues = await this.issueList(tx, organizationId, id);
      return { ...project, stages, lessons, batches, selected_defects, handover: handover ?? null, early_flow: earlyFlow ? this.earlyFlowDto(earlyFlow) : null, issues };
    });
  }

  private issueDto(row: Row) {
    return {
      ...row,
      version: Number(row.version),
      measure_due_at: row.measure_due_at ? new Date(row.measure_due_at).toISOString() : null,
      verified_at: row.verified_at ? new Date(row.verified_at).toISOString() : null,
      closed_at: row.closed_at ? new Date(row.closed_at).toISOString() : null,
    };
  }

  private async issueList(tx: AdminTransaction, organizationId: string, projectId: string) {
    const items = await tx.$queryRaw<Row[]>(Prisma.sql`SELECT issue.*, owner.username AS owner_username FROM new_product_issues issue LEFT JOIN users owner ON owner.id = issue.owner_user_id AND owner.organization_id = issue.organization_id WHERE issue.project_id = ${projectId}::uuid AND issue.organization_id = ${organizationId}::uuid ORDER BY issue.created_at, issue.id`);
    const [counts] = await tx.$queryRaw<Row[]>(Prisma.sql`SELECT count(*)::int AS total, count(*) FILTER (WHERE status = 'OPEN')::int AS open, count(*) FILTER (WHERE status = 'ESCALATED')::int AS escalated, count(*) FILTER (WHERE status = 'IN_PROGRESS')::int AS in_progress, count(*) FILTER (WHERE status = 'VERIFIED')::int AS verified, count(*) FILTER (WHERE status = 'CLOSED')::int AS closed FROM new_product_issues WHERE project_id = ${projectId}::uuid AND organization_id = ${organizationId}::uuid`);
    const internalEightDIssues = await this.projectEightDIssues(tx, organizationId, projectId);
    const count = (status: string) => internalEightDIssues.filter(issue => issue.status === status).length;
    return { items: items.map((item) => this.issueDto(item)), internalEightDIssues, stats: {
      total: Number(counts?.total ?? 0) + internalEightDIssues.length,
      open: Number(counts?.open ?? 0) + count('OPEN'), escalated: Number(counts?.escalated ?? 0),
      in_progress: Number(counts?.in_progress ?? 0) + count('IN_PROGRESS'), verified: Number(counts?.verified ?? 0),
      closed: Number(counts?.closed ?? 0) + count('CLOSED'), pending: count('PENDING'), resolved: count('RESOLVED'), archived: count('ARCHIVED'),
    } };
  }

  private async projectEightDIssues(tx: AdminTransaction, organizationId: string, projectId: string) {
    const selections = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`SELECT id FROM new_product_defect_selections WHERE project_id = ${projectId}::uuid AND organization_id = ${organizationId}::uuid ORDER BY id`);
    if (!selections.length) return [];
    if (!this.problems) fail('NEW_PRODUCT_PROBLEM_SERVICE_REQUIRED', 503);
    const states = await this.problems.readSourceLinkedStates(tx, { organizationId, domainCode: 'new-product-quality',
      sourceType: 'new-product-defect-selection', sourceIds: selections.map(selection => selection.id) });
    return states.map(({ sourceIds, ...state }) => ({ ...state, selectionIds: sourceIds }));
  }

  async issueListForProject(actor: AdminActor, projectId: string) {
    const id = uuid(projectId);
    return this.read(actor, async (tx, organizationId) => {
      const [project] = await tx.$queryRaw<Row[]>(Prisma.sql`SELECT id FROM new_product_projects WHERE id = ${id}::uuid AND organization_id = ${organizationId}::uuid`);
      if (!project) fail('NEW_PRODUCT_PROJECT_NOT_FOUND', 404);
      return this.issueList(tx, organizationId, id);
    });
  }

  private earlyFlowDto(row: Row) {
    return {
      id: row.id,
      organizationId: row.organization_id,
      projectId: row.project_id,
      monitoringWindowDays: Number(row.monitoring_window_days),
      monitoringFrequency: row.monitoring_frequency,
      plan: row.plan,
      exitCriteria: row.exit_criteria,
      status: row.status,
      approvalNote: row.approval_note,
      version: Number(row.version),
      submittedById: row.submitted_by_id,
      submittedAt: row.submitted_at ? new Date(row.submitted_at).toISOString() : null,
      approvedById: row.approved_by_id,
      approvedAt: row.approved_at ? new Date(row.approved_at).toISOString() : null,
      releaseDecision: row.release_decision ? { decision: row.release_decision, note: row.release_note, evidenceObjectId: row.release_evidence_object_id, decidedById: row.release_decided_by_id, decidedAt: row.release_decided_at ? new Date(row.release_decided_at).toISOString() : null, flowVersion: Number(row.release_flow_version) } : null,
      createdAt: new Date(row.created_at).toISOString(),
      updatedAt: new Date(row.updated_at).toISOString(),
    };
  }

  async addStage(actor: AdminActor, projectId: string, input: { code: string; name: string }, traceId: string, key?: string) {
    const organizationId = this.scope(actor); const id = uuid(projectId); const code = text(input.code, 100).toUpperCase(); const name = text(input.name, 200);
    return this.mutations.run({ actor, organizationId, key, traceId, action: 'NEW_PRODUCT_STAGE_ADDED', payload: { id, code, name }, permission: WRITE }, async (tx) => {
      const [project] = await tx.$queryRaw<Row[]>(Prisma.sql`SELECT status FROM new_product_projects WHERE id = ${id}::uuid AND organization_id = ${organizationId}::uuid FOR UPDATE`);
      if (!project) fail('NEW_PRODUCT_PROJECT_NOT_FOUND', 404); if (project.status !== 'ACTIVE') fail('NEW_PRODUCT_PROJECT_ARCHIVED', 409);
      const stageId = randomUUID();
      const [row] = await tx.$queryRaw<Row[]>(Prisma.sql`INSERT INTO new_product_stages(id, organization_id, project_id, code, name, created_by_id) VALUES (${stageId}::uuid, ${organizationId}::uuid, ${id}::uuid, ${code}, ${name}, ${actor.id}::uuid) RETURNING *`);
      await this.record(tx, actor, organizationId, 'NEW_PRODUCT_STAGE_ADDED', 'NewProductStage', stageId, traceId); return row;
    }).catch(mapUnique);
  }

  async addDeliverable(actor: AdminActor, stageId: string, input: { code: string; name: string; required: boolean }, traceId: string, key?: string) {
    const organizationId = this.scope(actor); const id = uuid(stageId); const code = text(input.code, 100).toUpperCase(); const name = text(input.name, 200);
    if (typeof input.required !== 'boolean') fail('NEW_PRODUCT_INPUT_INVALID', 400);
    return this.mutations.run({ actor, organizationId, key, traceId, action: 'NEW_PRODUCT_DELIVERABLE_ADDED', payload: { id, code, name, required: input.required }, permission: WRITE }, async (tx) => {
      const [stage] = await tx.$queryRaw<Row[]>(Prisma.sql`SELECT status FROM new_product_stages WHERE id = ${id}::uuid AND organization_id = ${organizationId}::uuid FOR UPDATE`);
      if (!stage) fail('NEW_PRODUCT_STAGE_NOT_FOUND', 404); if (stage.status !== 'OPEN') fail('NEW_PRODUCT_STAGE_LOCKED', 409);
      const deliverableId = randomUUID();
      const [row] = await tx.$queryRaw<Row[]>(Prisma.sql`INSERT INTO new_product_deliverables(id, organization_id, stage_id, code, name, required, created_by_id, updated_by_id) VALUES (${deliverableId}::uuid, ${organizationId}::uuid, ${id}::uuid, ${code}, ${name}, ${input.required}, ${actor.id}::uuid, ${actor.id}::uuid) RETURNING *`);
      await this.record(tx, actor, organizationId, 'NEW_PRODUCT_DELIVERABLE_ADDED', 'NewProductDeliverable', deliverableId, traceId); return row;
    }).catch(mapUnique);
  }

  async submitDeliverable(actor: AdminActor, deliverableId: string, input: { expectedVersion: number; evidenceObjectId: string }, traceId: string, key?: string) {
    const organizationId = this.scope(actor); const id = uuid(deliverableId); const expectedVersion = version(input.expectedVersion); const evidenceObjectId = uuid(input.evidenceObjectId);
    return this.mutations.run({ actor, organizationId, key, traceId, action: 'NEW_PRODUCT_DELIVERABLE_SUBMITTED', payload: { id, expectedVersion, evidenceObjectId }, permission: WRITE }, async (tx) => {
      const [deliverable] = await tx.$queryRaw<Row[]>(Prisma.sql`SELECT * FROM new_product_deliverables WHERE id = ${id}::uuid AND organization_id = ${organizationId}::uuid FOR UPDATE`);
      if (!deliverable) fail('NEW_PRODUCT_DELIVERABLE_NOT_FOUND', 404); if (deliverable.version !== expectedVersion) fail('CONCURRENCY_CONFLICT', 409);
      const [stage] = await tx.$queryRaw<Row[]>(Prisma.sql`SELECT status FROM new_product_stages WHERE id = ${deliverable.stage_id}::uuid AND organization_id = ${organizationId}::uuid FOR UPDATE`);
      if (stage?.status !== 'OPEN') fail('NEW_PRODUCT_STAGE_LOCKED', 409);
      await this.availableEvidence(tx, organizationId, evidenceObjectId, 'new-product-deliverable', id, expectedVersion);
      const [row] = await tx.$queryRaw<Row[]>(Prisma.sql`UPDATE new_product_deliverables SET evidence_object_id = ${evidenceObjectId}::uuid, version = version + 1, updated_by_id = ${actor.id}::uuid, updated_at = CURRENT_TIMESTAMP WHERE id = ${id}::uuid AND organization_id = ${organizationId}::uuid AND version = ${expectedVersion} RETURNING *`);
      await this.record(tx, actor, organizationId, 'NEW_PRODUCT_DELIVERABLE_SUBMITTED', 'NewProductDeliverable', id, traceId); return row;
    });
  }

  async createLesson(actor: AdminActor, input: { title: string; lesson: string; productCode?: string }, traceId: string, key?: string) {
    const organizationId = this.scope(actor); const title = text(input.title, 200); const lesson = text(input.lesson, 10000); const productCode = optional(input.productCode, 100);
    return this.mutations.run({ actor, organizationId, key, traceId, action: 'NEW_PRODUCT_LESSON_CREATED', payload: { title, lesson, productCode }, permission: WRITE }, async (tx) => {
      const id = randomUUID();
      const [row] = await tx.$queryRaw<Row[]>(Prisma.sql`INSERT INTO new_product_lessons(id, organization_id, title, lesson, product_code, created_by_id) VALUES (${id}::uuid, ${organizationId}::uuid, ${title}, ${lesson}, ${productCode}, ${actor.id}::uuid) RETURNING *`);
      await this.record(tx, actor, organizationId, 'NEW_PRODUCT_LESSON_CREATED', 'NewProductLesson', id, traceId); return row;
    });
  }

  async attachLesson(actor: AdminActor, projectId: string, lessonId: string, traceId: string, key?: string) {
    const organizationId = this.scope(actor); const id = uuid(projectId); const lesson = uuid(lessonId);
    return this.mutations.run({ actor, organizationId, key, traceId, action: 'NEW_PRODUCT_LESSON_ATTACHED', payload: { id, lesson }, permission: WRITE }, async (tx) => {
      const [project] = await tx.$queryRaw<Row[]>(Prisma.sql`SELECT status FROM new_product_projects WHERE id = ${id}::uuid AND organization_id = ${organizationId}::uuid FOR UPDATE`);
      if (!project) fail('NEW_PRODUCT_PROJECT_NOT_FOUND', 404); if (project.status !== 'ACTIVE') fail('NEW_PRODUCT_PROJECT_ARCHIVED', 409);
      const [source] = await tx.$queryRaw<Row[]>(Prisma.sql`SELECT id FROM new_product_lessons WHERE id = ${lesson}::uuid AND organization_id = ${organizationId}::uuid`);
      if (!source) fail('NEW_PRODUCT_LESSON_NOT_FOUND', 404);
      const checkId = randomUUID();
      const [row] = await tx.$queryRaw<Row[]>(Prisma.sql`INSERT INTO new_product_lesson_checks(id, organization_id, project_id, lesson_id, created_by_id) VALUES (${checkId}::uuid, ${organizationId}::uuid, ${id}::uuid, ${lesson}::uuid, ${actor.id}::uuid) RETURNING *`);
      await this.record(tx, actor, organizationId, 'NEW_PRODUCT_LESSON_ATTACHED', 'NewProductLessonCheck', checkId, traceId); return row;
    }).catch(mapUnique);
  }

  async confirmLesson(actor: AdminActor, checkId: string, input: { expectedVersion: number; avoided: boolean; reason?: string; evidenceObjectId?: string }, traceId: string, key?: string) {
    const organizationId = this.scope(actor); const id = uuid(checkId); const expectedVersion = version(input.expectedVersion);
    if (typeof input.avoided !== 'boolean' || !input.evidenceObjectId || (!input.avoided && !input.reason?.trim())) fail('NEW_PRODUCT_INPUT_INVALID', 400);
    const evidenceObjectId = uuid(input.evidenceObjectId); const reason = input.reason === undefined ? null : text(input.reason, 2000);
    return this.mutations.run({ actor, organizationId, key, traceId, action: 'NEW_PRODUCT_LESSON_CONFIRMED', payload: { id, expectedVersion, avoided: input.avoided, reason, evidenceObjectId }, permission: WRITE }, async (tx) => {
      const [check] = await tx.$queryRaw<Row[]>(Prisma.sql`SELECT * FROM new_product_lesson_checks WHERE id = ${id}::uuid AND organization_id = ${organizationId}::uuid FOR UPDATE`);
      if (!check) fail('NEW_PRODUCT_LESSON_CHECK_NOT_FOUND', 404); if (check.version !== expectedVersion) fail('CONCURRENCY_CONFLICT', 409);
      const [project] = await tx.$queryRaw<Row[]>(Prisma.sql`SELECT status FROM new_product_projects WHERE id = ${check.project_id}::uuid AND organization_id = ${organizationId}::uuid FOR UPDATE`);
      if (project?.status !== 'ACTIVE') fail('NEW_PRODUCT_PROJECT_ARCHIVED', 409);
      await this.availableEvidence(tx, organizationId, evidenceObjectId, 'new-product-lesson-check', id, expectedVersion);
      const [row] = await tx.$queryRaw<Row[]>(Prisma.sql`UPDATE new_product_lesson_checks SET avoided = ${input.avoided}, reason = ${reason}, evidence_object_id = ${evidenceObjectId}::uuid, confirmed_by_id = ${actor.id}::uuid, confirmed_at = CURRENT_TIMESTAMP, version = version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ${id}::uuid AND organization_id = ${organizationId}::uuid AND version = ${expectedVersion} RETURNING *`);
      await this.record(tx, actor, organizationId, 'NEW_PRODUCT_LESSON_CONFIRMED', 'NewProductLessonCheck', id, traceId); return row;
    });
  }

  async reviewStage(actor: AdminActor, stageId: string, input: { expectedVersion: number; decision: 'PASS' | 'REJECT' }, traceId: string, key?: string) {
    const organizationId = this.scope(actor); const id = uuid(stageId); const expectedVersion = version(input.expectedVersion);
    if (!['PASS', 'REJECT'].includes(input.decision)) fail('NEW_PRODUCT_INPUT_INVALID', 400);
    return this.mutations.run({ actor, organizationId, key, traceId, action: 'NEW_PRODUCT_STAGE_REVIEWED', payload: { id, expectedVersion, decision: input.decision }, permission: WRITE }, async (tx) => {
      const [stage] = await tx.$queryRaw<Row[]>(Prisma.sql`SELECT * FROM new_product_stages WHERE id = ${id}::uuid AND organization_id = ${organizationId}::uuid FOR UPDATE`);
      if (!stage) fail('NEW_PRODUCT_STAGE_NOT_FOUND', 404); if (stage.version !== expectedVersion || stage.status !== 'OPEN') fail('CONCURRENCY_CONFLICT', 409);
      const [project] = await tx.$queryRaw<Row[]>(Prisma.sql`SELECT status FROM new_product_projects WHERE id = ${stage.project_id}::uuid AND organization_id = ${organizationId}::uuid FOR UPDATE`);
      if (project?.status !== 'ACTIVE') fail('NEW_PRODUCT_PROJECT_ARCHIVED', 409);
      if (input.decision === 'PASS') {
        const [deliverables] = await tx.$queryRaw<{ total: bigint; missing: bigint }[]>(Prisma.sql`SELECT count(*) FILTER (WHERE deliverable.required) AS total, count(*) FILTER (WHERE deliverable.required AND file.id IS NULL) AS missing FROM new_product_deliverables deliverable LEFT JOIN file_objects file ON file.id = deliverable.evidence_object_id AND file.organization_id = deliverable.organization_id AND file.resource_type = 'new-product-deliverable' AND file.resource_id = deliverable.id::text AND file.resource_version = deliverable.version - 1 AND file.status = 'AVAILABLE' AND file.scan_status = 'CLEAN' AND file.deleted_at IS NULL WHERE deliverable.stage_id = ${id}::uuid AND deliverable.organization_id = ${organizationId}::uuid`);
        if (!deliverables || deliverables.total < 1n || deliverables.missing > 0n) fail('NEW_PRODUCT_STAGE_DELIVERABLES_INCOMPLETE', 409);
        const [lessons] = await tx.$queryRaw<{ missing: bigint }[]>(Prisma.sql`SELECT count(*) FILTER (WHERE lesson_check.avoided IS NULL OR file.id IS NULL) AS missing FROM new_product_lesson_checks lesson_check LEFT JOIN file_objects file ON file.id = lesson_check.evidence_object_id AND file.organization_id = lesson_check.organization_id AND file.resource_type = 'new-product-lesson-check' AND file.resource_id = lesson_check.id::text AND file.resource_version = lesson_check.version - 1 AND file.status = 'AVAILABLE' AND file.scan_status = 'CLEAN' AND file.deleted_at IS NULL WHERE lesson_check.project_id = ${stage.project_id}::uuid AND lesson_check.organization_id = ${organizationId}::uuid`);
        if (lessons?.missing > 0n) fail('NEW_PRODUCT_STAGE_LESSONS_INCOMPLETE', 409);
      }
      const status = input.decision === 'PASS' ? 'PASSED' : 'REJECTED';
      const [row] = await tx.$queryRaw<Row[]>(Prisma.sql`UPDATE new_product_stages SET status = ${status}, version = version + 1, reviewed_by_id = ${actor.id}::uuid, reviewed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ${id}::uuid AND organization_id = ${organizationId}::uuid AND version = ${expectedVersion} RETURNING *`);
      await this.record(tx, actor, organizationId, 'NEW_PRODUCT_STAGE_REVIEWED', 'NewProductStage', id, traceId); return row;
    });
  }

  async createTrialBatch(actor: AdminActor, projectId: string, input: { code: string; workOrderCode?: string }, traceId: string, key?: string) {
    const organizationId = this.scope(actor); const id = uuid(projectId); const code = text(input.code, 100).toUpperCase(); const workOrderCode = optional(input.workOrderCode, 100);
    return this.mutations.run({ actor, organizationId, key, traceId, action: 'NEW_PRODUCT_TRIAL_BATCH_CREATED', payload: { id, code, workOrderCode }, permission: WRITE }, async (tx) => {
      const [project] = await tx.$queryRaw<Row[]>(Prisma.sql`SELECT status FROM new_product_projects WHERE id = ${id}::uuid AND organization_id = ${organizationId}::uuid FOR UPDATE`);
      if (!project) fail('NEW_PRODUCT_PROJECT_NOT_FOUND', 404); if (project.status !== 'ACTIVE') fail('NEW_PRODUCT_PROJECT_ARCHIVED', 409);
      const batchId = randomUUID();
      const [row] = await tx.$queryRaw<Row[]>(Prisma.sql`INSERT INTO new_product_trial_batches(id, organization_id, project_id, code, work_order_code, created_by_id) VALUES (${batchId}::uuid, ${organizationId}::uuid, ${id}::uuid, ${code}, ${workOrderCode}, ${actor.id}::uuid) RETURNING *`);
      await this.record(tx, actor, organizationId, 'NEW_PRODUCT_TRIAL_BATCH_CREATED', 'NewProductTrialBatch', batchId, traceId); return row;
    }).catch(mapUnique);
  }

  async recordMetric(actor: AdminActor, batchId: string, input: { code: TrialMetricCode; target: number; actual: number; comparison: 'GTE' | 'LTE'; source: 'MANUAL' | 'IMS' }, traceId: string, key?: string) {
    const organizationId = this.scope(actor); const id = uuid(batchId);
    if (!METRICS.includes(input.code) || !['GTE', 'LTE'].includes(input.comparison) || input.source !== 'MANUAL' || !Number.isFinite(input.target) || !Number.isFinite(input.actual) || input.target < 0 || input.actual < 0 || COUNT_METRICS.includes(input.code) && (!Number.isSafeInteger(input.target) || !Number.isSafeInteger(input.actual))) fail('NEW_PRODUCT_INPUT_INVALID', 400);
    return this.mutations.run({ actor, organizationId, key, traceId, action: 'NEW_PRODUCT_METRIC_RECORDED', payload: { id, ...input }, permission: WRITE }, async (tx) => {
      const [batch] = await tx.$queryRaw<Row[]>(Prisma.sql`SELECT project_id FROM new_product_trial_batches WHERE id = ${id}::uuid AND organization_id = ${organizationId}::uuid FOR UPDATE`);
      if (!batch) fail('NEW_PRODUCT_TRIAL_BATCH_NOT_FOUND', 404);
      const [project] = await tx.$queryRaw<Row[]>(Prisma.sql`SELECT status FROM new_product_projects WHERE id = ${batch.project_id}::uuid AND organization_id = ${organizationId}::uuid FOR UPDATE`);
      if (project?.status !== 'ACTIVE') fail('NEW_PRODUCT_PROJECT_ARCHIVED', 409);
      const metricId = randomUUID();
      const [row] = await tx.$queryRaw<Row[]>(Prisma.sql`INSERT INTO new_product_trial_metrics(id, organization_id, batch_id, code, target, actual, comparison, source, recorded_by_id) VALUES (${metricId}::uuid, ${organizationId}::uuid, ${id}::uuid, ${input.code}, ${input.target}, ${input.actual}, ${input.comparison}, 'MANUAL', ${actor.id}::uuid) RETURNING *`);
      await this.record(tx, actor, organizationId, 'NEW_PRODUCT_METRIC_RECORDED', 'NewProductTrialMetric', metricId, traceId); return { ...row, target: Number(row.target), actual: Number(row.actual) };
    }).catch(mapUnique);
  }

  async trialReport(actor: AdminActor, batchId: string): Promise<Row & { metrics: Row[] }> {
    const id = uuid(batchId);
    return this.read(actor, async (tx, organizationId) => {
      const [batch] = await tx.$queryRaw<Row[]>(Prisma.sql`SELECT * FROM new_product_trial_batches WHERE id = ${id}::uuid AND organization_id = ${organizationId}::uuid`);
      if (!batch) fail('NEW_PRODUCT_TRIAL_BATCH_NOT_FOUND', 404);
      const metrics = await tx.$queryRaw<Row[]>(Prisma.sql`SELECT * FROM new_product_trial_metrics WHERE batch_id = ${id}::uuid AND organization_id = ${organizationId}::uuid ORDER BY code`);
      return { ...batch, metrics: metrics.map((metric) => ({ ...metric, target: Number(metric.target), actual: Number(metric.actual), signal: metric.comparison === 'GTE' ? Number(metric.actual) >= Number(metric.target) ? 'GREEN' : 'RED' : Number(metric.actual) <= Number(metric.target) ? 'GREEN' : 'RED' })) };
    });
  }

  async trialReportCsv(actor: AdminActor, batchId: string) {
    const report = await this.trialReport(actor, batchId);
    const sourceHeader = ['batchId', 'batchCode', 'workOrderCode', 'metricId', 'metricCode', 'target', 'actual', 'comparison', 'signal', 'source', 'recordedAt'];
    const sourceRows = (report.metrics.length ? report.metrics : [{}]).map((metric: Row) => [
      report.id,
      report.code,
      report.work_order_code,
      metric.id,
      metric.code,
      metric.target,
      metric.actual,
      metric.comparison,
      metric.signal,
      metric.source,
      metric.recorded_at ? new Date(metric.recorded_at).toISOString() : null,
    ]);
    const sourceContent = [sourceHeader.join(','), ...sourceRows.map((row) => row.map(csvCell).join(','))].join('\r\n');
    const metricSetSha256 = createHash('sha256').update(sourceContent, 'utf8').digest('hex');
    const exportedAt = new Date().toISOString();
    const header = [...sourceHeader.slice(0, 3), 'metricSetSha256', 'exportedAt', ...sourceHeader.slice(3)];
    const rows = sourceRows.map((row) => [...row.slice(0, 3), metricSetSha256, exportedAt, ...row.slice(3)]);
    const content = '\uFEFF' + [header.join(','), ...rows.map((row) => row.map(csvCell).join(','))].join('\r\n');
    return { filename: `qms-trial-report-${uuid(batchId)}.csv`, contentType: 'text/csv; charset=utf-8', content };
  }

  private trialSummaryDto(row: Row) {
    return {
      id: row.id, batchId: row.batch_id, projectId: row.project_id, conclusion: row.conclusion,
      status: row.status, metricSnapshot: row.metric_snapshot, issueSnapshot: row.issue_snapshot,
      sourceSha256: row.source_sha256, version: Number(row.version), createdById: row.created_by_id,
      submittedById: row.submitted_by_id, submittedAt: row.submitted_at ? new Date(row.submitted_at).toISOString() : null,
      approvedById: row.approved_by_id, approvedAt: row.approved_at ? new Date(row.approved_at).toISOString() : null,
      approvalNote: row.approval_note,
    };
  }

  async trialSummary(actor: AdminActor, batchId: string) {
    const id = uuid(batchId);
    return this.read(actor, async (tx, organizationId) => {
      const [batch] = await tx.$queryRaw<Row[]>(Prisma.sql`SELECT id FROM new_product_trial_batches WHERE id = ${id}::uuid AND organization_id = ${organizationId}::uuid`);
      if (!batch) fail('NEW_PRODUCT_TRIAL_BATCH_NOT_FOUND', 404);
      const [summary] = await tx.$queryRaw<Row[]>(Prisma.sql`SELECT * FROM new_product_trial_summaries WHERE batch_id = ${id}::uuid AND organization_id = ${organizationId}::uuid`);
      if (!summary) fail('NEW_PRODUCT_TRIAL_SUMMARY_NOT_FOUND', 404);
      return this.trialSummaryDto(summary);
    });
  }

  async trialSummaryFile(actor: AdminActor, batchId: string, format: 'xlsx' | 'pdf', expectedVersion: number) {
    const id = uuid(batchId);
    const requestedVersion = version(expectedVersion);
    const report = await this.read(actor, async (tx, organizationId): Promise<TrialSummaryReport> => {
      const [context] = await tx.$queryRaw<Row[]>(Prisma.sql`SELECT project.id AS project_id, project.code AS project_code, project.name AS project_name, project.product_code, batch.id AS batch_id, batch.code AS batch_code, batch.work_order_code, summary.* FROM new_product_trial_batches batch JOIN new_product_projects project ON project.id = batch.project_id AND project.organization_id = batch.organization_id LEFT JOIN new_product_trial_summaries summary ON summary.batch_id = batch.id AND summary.organization_id = batch.organization_id WHERE batch.id = ${id}::uuid AND batch.organization_id = ${organizationId}::uuid`);
      if (!context) fail('NEW_PRODUCT_TRIAL_BATCH_NOT_FOUND', 404);
      if (!context.source_sha256) {
        const [summary] = await tx.$queryRaw<Row[]>(Prisma.sql`SELECT id FROM new_product_trial_summaries WHERE batch_id = ${id}::uuid AND organization_id = ${organizationId}::uuid`);
        if (!summary) fail('NEW_PRODUCT_TRIAL_SUMMARY_NOT_FOUND', 404);
      }
      if (context.status !== 'APPROVED' || Number(context.version) !== requestedVersion || !context.source_sha256) fail('CONCURRENCY_CONFLICT', 409);
      const source = await this.trialSummarySource(tx, organizationId, id, context.project_id, context.conclusion);
      if (source.sourceSha256 !== context.source_sha256) fail('NEW_PRODUCT_TRIAL_SUMMARY_STALE', 409);
      return {
        project: { id: context.project_id, code: context.project_code, name: context.project_name, productCode: context.product_code },
        batch: { id: context.batch_id, code: context.batch_code, workOrderCode: context.work_order_code },
        summary: { version: Number(context.version), conclusion: context.conclusion, sourceSha256: context.source_sha256, submittedAt: new Date(context.submitted_at).toISOString(), approvedAt: new Date(context.approved_at).toISOString(), metricSnapshot: context.metric_snapshot, issueSnapshot: context.issue_snapshot },
      };
    }, 'RepeatableRead');
    const file = await renderTrialSummaryReport(report, format);
    return { ...file, filename: `qms-trial-summary-${id}-v${requestedVersion}.${format}` };
  }

  async trialSummaryRevisions(actor: AdminActor, batchId: string) {
    const id = uuid(batchId);
    return this.read(actor, async (tx, organizationId) => {
      const [summary] = await tx.$queryRaw<Row[]>(Prisma.sql`SELECT id FROM new_product_trial_summaries WHERE batch_id = ${id}::uuid AND organization_id = ${organizationId}::uuid`);
      if (!summary) fail('NEW_PRODUCT_TRIAL_SUMMARY_NOT_FOUND', 404);
      const rows = await tx.$queryRaw<Row[]>(Prisma.sql`SELECT * FROM new_product_trial_summary_revisions WHERE summary_id = ${summary.id}::uuid AND organization_id = ${organizationId}::uuid ORDER BY revision`);
      return rows.map((row) => ({ revision: Number(row.revision), conclusion: row.conclusion, metricSnapshot: row.metric_snapshot, issueSnapshot: row.issue_snapshot, sourceSha256: row.source_sha256, submittedById: row.submitted_by_id, submittedAt: new Date(row.submitted_at).toISOString(), decision: row.decision, decidedById: row.decided_by_id, decidedAt: row.decided_at ? new Date(row.decided_at).toISOString() : null, decisionNote: row.decision_note }));
    });
  }

  private async trialSummarySource(tx: AdminTransaction, organizationId: string, batchId: string, projectId: string, conclusion: string) {
    const metricRows = await tx.$queryRaw<Row[]>(Prisma.sql`SELECT id, code, target, actual, comparison, source, recorded_at FROM new_product_trial_metrics WHERE batch_id = ${batchId}::uuid AND organization_id = ${organizationId}::uuid ORDER BY code, id`);
    if (!metricRows.length) fail('NEW_PRODUCT_TRIAL_METRICS_INCOMPLETE', 409);
    const metricSnapshot = metricRows.map((metric) => ({ id: metric.id, code: metric.code, target: Number(metric.target), actual: Number(metric.actual), comparison: metric.comparison, signal: metric.comparison === 'GTE' ? Number(metric.actual) >= Number(metric.target) ? 'GREEN' : 'RED' : Number(metric.actual) <= Number(metric.target) ? 'GREEN' : 'RED', source: metric.source, recordedAt: new Date(metric.recorded_at).toISOString() }));
    const legacyIssues = await tx.$queryRaw<Row[]>(Prisma.sql`SELECT id, description, risk_level, status, created_at FROM new_product_legacy_issues WHERE project_id = ${projectId}::uuid AND organization_id = ${organizationId}::uuid ORDER BY created_at, id`);
    const formalIssues = await tx.$queryRaw<Row[]>(Prisma.sql`SELECT id, response_form, complexity, severity, status, created_at FROM new_product_issues WHERE trial_batch_id = ${batchId}::uuid AND project_id = ${projectId}::uuid AND organization_id = ${organizationId}::uuid ORDER BY created_at, id`);
    const internalEightDIssues = await this.projectEightDIssues(tx, organizationId, projectId);
    const issueSnapshot = [
      ...legacyIssues.map((issue) => ({ kind: 'PROJECT_LEGACY', id: issue.id, description: issue.description, riskLevel: issue.risk_level, status: issue.status, createdAt: new Date(issue.created_at).toISOString() })),
      ...formalIssues.map((issue) => ({ kind: 'FORMAL', id: issue.id, responseForm: issue.response_form, complexity: issue.complexity, severity: issue.severity, status: issue.status, createdAt: new Date(issue.created_at).toISOString() })),
      ...internalEightDIssues.map(issue => ({ kind: 'INTERNAL_EIGHT_D', id: issue.problemId, ...issue, responseForm: 'EIGHT_D' })),
    ];
    const sourceSha256 = createHash('sha256').update(canonical({ batchId, conclusion, metricSnapshot, issueSnapshot }), 'utf8').digest('hex');
    return { metricSnapshot, issueSnapshot, sourceSha256 };
  }

  private async lockTrialSummary(tx: AdminTransaction, organizationId: string, batchId: string) {
    const [batch] = await tx.$queryRaw<Row[]>(Prisma.sql`SELECT project_id FROM new_product_trial_batches WHERE id = ${batchId}::uuid AND organization_id = ${organizationId}::uuid`);
    if (!batch) fail('NEW_PRODUCT_TRIAL_BATCH_NOT_FOUND', 404);
    const [project] = await tx.$queryRaw<Row[]>(Prisma.sql`SELECT status FROM new_product_projects WHERE id = ${batch.project_id}::uuid AND organization_id = ${organizationId}::uuid FOR UPDATE`);
    if (project?.status !== 'ACTIVE') fail('NEW_PRODUCT_PROJECT_ARCHIVED', 409);
    const [summary] = await tx.$queryRaw<Row[]>(Prisma.sql`SELECT * FROM new_product_trial_summaries WHERE batch_id = ${batchId}::uuid AND organization_id = ${organizationId}::uuid FOR UPDATE`);
    if (!summary) fail('NEW_PRODUCT_TRIAL_SUMMARY_NOT_FOUND', 404);
    return summary;
  }

  async reviseTrialSummary(actor: AdminActor, batchId: string, input: { expectedVersion: number; conclusion: string }, traceId: string, key?: string) {
    const organizationId = this.scope(actor); const id = uuid(batchId); const expectedVersion = version(input.expectedVersion); const conclusion = text(input.conclusion, 10000);
    return this.mutations.run({ actor, organizationId, key, traceId, action: 'NEW_PRODUCT_TRIAL_SUMMARY_REVISED', payload: { id, expectedVersion, conclusion }, permission: WRITE }, async (tx) => {
      const summary = await this.lockTrialSummary(tx, organizationId, id);
      if (!['REJECTED', 'APPROVED'].includes(summary.status) || summary.version !== expectedVersion) fail('CONCURRENCY_CONFLICT', 409);
      const [row] = await tx.$queryRaw<Row[]>(Prisma.sql`UPDATE new_product_trial_summaries SET conclusion = ${conclusion}, status = 'DRAFT', metric_snapshot = '[]'::jsonb, issue_snapshot = '[]'::jsonb, source_sha256 = NULL, submitted_by_id = NULL, submitted_at = NULL, approved_by_id = NULL, approved_at = NULL, approval_note = NULL, version = version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ${summary.id}::uuid AND organization_id = ${organizationId}::uuid AND status IN ('REJECTED', 'APPROVED') AND version = ${expectedVersion} RETURNING *`);
      if (!row) fail('CONCURRENCY_CONFLICT', 409);
      await this.record(tx, actor, organizationId, 'NEW_PRODUCT_TRIAL_SUMMARY_REVISED', 'NewProductTrialSummary', row.id, traceId);
      return this.trialSummaryDto(row);
    });
  }

  async createTrialSummary(actor: AdminActor, batchId: string, input: { conclusion: string }, traceId: string, key?: string) {
    const organizationId = this.scope(actor); const id = uuid(batchId); const conclusion = text(input.conclusion, 10000);
    return this.mutations.run({ actor, organizationId, key, traceId, action: 'NEW_PRODUCT_TRIAL_SUMMARY_CREATED', payload: { id, conclusion }, permission: WRITE }, async (tx) => {
      const [batch] = await tx.$queryRaw<Row[]>(Prisma.sql`SELECT project_id FROM new_product_trial_batches WHERE id = ${id}::uuid AND organization_id = ${organizationId}::uuid FOR UPDATE`);
      if (!batch) fail('NEW_PRODUCT_TRIAL_BATCH_NOT_FOUND', 404);
      const [project] = await tx.$queryRaw<Row[]>(Prisma.sql`SELECT status FROM new_product_projects WHERE id = ${batch.project_id}::uuid AND organization_id = ${organizationId}::uuid FOR UPDATE`);
      if (project?.status !== 'ACTIVE') fail('NEW_PRODUCT_PROJECT_ARCHIVED', 409);
      const summaryId = randomUUID();
      const [row] = await tx.$queryRaw<Row[]>(Prisma.sql`INSERT INTO new_product_trial_summaries(id, organization_id, project_id, batch_id, conclusion, created_by_id) VALUES (${summaryId}::uuid, ${organizationId}::uuid, ${batch.project_id}::uuid, ${id}::uuid, ${conclusion}, ${actor.id}::uuid) RETURNING *`);
      await this.record(tx, actor, organizationId, 'NEW_PRODUCT_TRIAL_SUMMARY_CREATED', 'NewProductTrialSummary', summaryId, traceId);
      return this.trialSummaryDto(row);
    }).catch(mapUnique);
  }

  async submitTrialSummary(actor: AdminActor, batchId: string, input: { expectedVersion: number }, traceId: string, key?: string) {
    const organizationId = this.scope(actor); const id = uuid(batchId); const expectedVersion = version(input.expectedVersion);
    return this.mutations.run({ actor, organizationId, key, traceId, action: 'NEW_PRODUCT_TRIAL_SUMMARY_SUBMITTED', payload: { id, expectedVersion }, permission: WRITE }, async (tx) => {
      const summary = await this.lockTrialSummary(tx, organizationId, id);
      if (summary.status !== 'DRAFT' || summary.version !== expectedVersion) fail('CONCURRENCY_CONFLICT', 409);
      const { metricSnapshot, issueSnapshot, sourceSha256 } = await this.trialSummarySource(tx, organizationId, id, summary.project_id, summary.conclusion);
      const [row] = await tx.$queryRaw<Row[]>(Prisma.sql`UPDATE new_product_trial_summaries SET status = 'SUBMITTED', metric_snapshot = ${JSON.stringify(metricSnapshot)}::jsonb, issue_snapshot = ${JSON.stringify(issueSnapshot)}::jsonb, source_sha256 = ${sourceSha256}, submitted_by_id = ${actor.id}::uuid, submitted_at = CURRENT_TIMESTAMP, version = version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ${summary.id}::uuid AND organization_id = ${organizationId}::uuid AND status = 'DRAFT' AND version = ${expectedVersion} RETURNING *`);
      if (!row) fail('CONCURRENCY_CONFLICT', 409);
      const [latest] = await tx.$queryRaw<{ revision: number }[]>(Prisma.sql`SELECT COALESCE(max(revision), 0)::integer AS revision FROM new_product_trial_summary_revisions WHERE summary_id = ${summary.id}::uuid AND organization_id = ${organizationId}::uuid`);
      await tx.$executeRaw(Prisma.sql`INSERT INTO new_product_trial_summary_revisions(id, organization_id, summary_id, revision, conclusion, metric_snapshot, issue_snapshot, source_sha256, submitted_by_id, submitted_at) VALUES (${randomUUID()}::uuid, ${organizationId}::uuid, ${summary.id}::uuid, ${Number(latest?.revision ?? 0) + 1}, ${row.conclusion}, ${JSON.stringify(metricSnapshot)}::jsonb, ${JSON.stringify(issueSnapshot)}::jsonb, ${sourceSha256}, ${actor.id}::uuid, ${row.submitted_at}::timestamptz)`);
      await this.record(tx, actor, organizationId, 'NEW_PRODUCT_TRIAL_SUMMARY_SUBMITTED', 'NewProductTrialSummary', row.id, traceId);
      return this.trialSummaryDto(row);
    });
  }

  async decideTrialSummary(actor: AdminActor, batchId: string, input: { expectedVersion: number; decision: 'APPROVE' | 'REJECT'; note?: string }, traceId: string, key?: string) {
    const organizationId = this.scope(actor); const id = uuid(batchId); const expectedVersion = version(input.expectedVersion); const note = input.note?.trim() || null;
    if (!['APPROVE', 'REJECT'].includes(input.decision) || note && note.length > 2000 || input.decision === 'REJECT' && !note) fail('NEW_PRODUCT_INPUT_INVALID', 400);
    return this.mutations.run({ actor, organizationId, key, traceId, action: 'NEW_PRODUCT_TRIAL_SUMMARY_DECIDED', payload: { id, expectedVersion, decision: input.decision, note }, permission: WRITE }, async (tx) => {
      const summary = await this.lockTrialSummary(tx, organizationId, id);
      if (summary.status !== 'SUBMITTED' || summary.version !== expectedVersion || summary.submitted_by_id === actor.id) fail('CONCURRENCY_CONFLICT', 409);
      if (input.decision === 'APPROVE' && (await this.trialSummarySource(tx, organizationId, id, summary.project_id, summary.conclusion)).sourceSha256 !== summary.source_sha256) fail('NEW_PRODUCT_TRIAL_SUMMARY_STALE', 409);
      const status = input.decision === 'APPROVE' ? 'APPROVED' : 'REJECTED';
      const [row] = await tx.$queryRaw<Row[]>(Prisma.sql`UPDATE new_product_trial_summaries SET status = ${status}, approval_note = ${note}, approved_by_id = ${actor.id}::uuid, approved_at = CURRENT_TIMESTAMP, version = version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ${summary.id}::uuid AND organization_id = ${organizationId}::uuid AND status = 'SUBMITTED' AND version = ${expectedVersion} RETURNING *`);
      if (!row) fail('CONCURRENCY_CONFLICT', 409);
      await tx.$executeRaw(Prisma.sql`UPDATE new_product_trial_summary_revisions SET decision = ${input.decision}, decided_by_id = ${actor.id}::uuid, decided_at = ${row.approved_at}::timestamptz, decision_note = ${note} WHERE summary_id = ${summary.id}::uuid AND organization_id = ${organizationId}::uuid AND revision = (SELECT max(revision) FROM new_product_trial_summary_revisions WHERE summary_id = ${summary.id}::uuid AND organization_id = ${organizationId}::uuid)`);
      await this.record(tx, actor, organizationId, status === 'APPROVED' ? 'NEW_PRODUCT_TRIAL_SUMMARY_APPROVED' : 'NEW_PRODUCT_TRIAL_SUMMARY_REJECTED', 'NewProductTrialSummary', row.id, traceId);
      return this.trialSummaryDto(row);
    });
  }

  async selectProcessDefect(actor: AdminActor, projectId: string, input: { defectId: string; expectedVersion: number; reason?: string }, traceId: string, key?: string) {
    const organizationId = this.scope(actor); const project = uuid(projectId); const defectId = uuid(input.defectId); const expectedVersion = version(input.expectedVersion);
    const reason = input.reason === undefined ? null : text(input.reason, 2000);
    const reference = await this.sourceService().processReference(actor, defectId);
    reference.sourceVersion = expectedVersion;
    return this.mutations.run({ actor, organizationId, key, traceId, action: 'NEW_PRODUCT_DEFECT_SELECTED', payload: { project, defectId, expectedVersion, reason }, permission: [WRITE, READ, 'process-quality:defects:read'] }, async (tx) => {
      const [projectRow] = await tx.$queryRaw<Row[]>(Prisma.sql`SELECT status, code, product_code FROM new_product_projects WHERE id = ${project}::uuid AND organization_id = ${organizationId}::uuid FOR UPDATE`);
      if (!projectRow) fail('NEW_PRODUCT_PROJECT_NOT_FOUND', 404); if (projectRow.status !== 'ACTIVE') fail('NEW_PRODUCT_PROJECT_ARCHIVED', 409);
      const snapshot = await this.sourceService().selectionSnapshot(tx, actor, { id: project, code: projectRow.code }, reference, reason);
      const id = randomUUID();
      const [row] = await tx.$queryRaw<Row[]>(Prisma.sql`INSERT INTO new_product_defect_selections(id, organization_id, project_id, defect_id, source_version, source_snapshot, selection_reason, selected_by_id) VALUES (${id}::uuid, ${organizationId}::uuid, ${project}::uuid, ${defectId}::uuid, ${expectedVersion}, ${JSON.stringify(snapshot)}::jsonb, ${reason}, ${actor.id}::uuid) RETURNING *`);
      await this.record(tx, actor, organizationId, 'NEW_PRODUCT_DEFECT_SELECTED', 'NewProductDefectSelection', id, traceId); return row;
    }, async tx => { await NewProductEightDSourceService.assertRead(tx, actor, organizationId); }).catch(mapUnique);
  }

  async selectedDefects(actor: AdminActor, projectId: string) {
    const organizationId = this.scope(actor); const project = uuid(projectId);
    return this.read(actor, async (tx) => {
      await NewProductEightDSourceService.assertRead(tx, actor, organizationId);
      return tx.$queryRaw<Row[]>(Prisma.sql`SELECT * FROM new_product_defect_selections WHERE project_id = ${project}::uuid AND organization_id = ${organizationId}::uuid ORDER BY selected_at, id`);
    });
  }

  async issueSelectedDefects(actor: AdminActor, projectId: string, input: { selectionIds: string[]; trialBatchId?: string; severity: string; complexity: NewProductIssueComplexity; workflowBinding?: { workflowDefinitionId: string; workflowVersionId: string; instanceKey: string } }, traceId: string, key?: string) {
    const organizationId = this.scope(actor); const project = uuid(projectId); const selectionIds = input.selectionIds.map(uuid); const severity = text(input.severity, 64);
    if (!selectionIds.length || new Set(selectionIds).size !== selectionIds.length || !['SIMPLE', 'COMPLEX'].includes(input.complexity)) fail('NEW_PRODUCT_INPUT_INVALID', 400);
    const trialBatch = input.trialBatchId ? uuid(input.trialBatchId) : null;
    return this.mutations.run({ actor, organizationId, key, traceId, action: 'NEW_PRODUCT_ISSUE_CREATED', payload: { project, selectionIds, trialBatch, severity, complexity: input.complexity, workflowBinding: input.workflowBinding }, permission: WRITE, isolationLevel: 'ReadCommitted' }, async (tx) => {
      const [projectRow] = await tx.$queryRaw<Row[]>(Prisma.sql`SELECT status FROM new_product_projects WHERE id = ${project}::uuid AND organization_id = ${organizationId}::uuid FOR UPDATE`);
      if (!projectRow) fail('NEW_PRODUCT_PROJECT_NOT_FOUND', 404); if (projectRow.status !== 'ACTIVE') fail('NEW_PRODUCT_PROJECT_ARCHIVED', 409);
      if (trialBatch) { const [batch] = await tx.$queryRaw<Row[]>(Prisma.sql`SELECT id FROM new_product_trial_batches WHERE id = ${trialBatch}::uuid AND project_id = ${project}::uuid AND organization_id = ${organizationId}::uuid`); if (!batch) fail('NEW_PRODUCT_TRIAL_BATCH_NOT_FOUND', 404); }
      const selections = await tx.$queryRaw<Row[]>(Prisma.sql`SELECT * FROM new_product_defect_selections WHERE project_id = ${project}::uuid AND organization_id = ${organizationId}::uuid AND id IN (${Prisma.join(selectionIds.map((id) => Prisma.sql`${id}::uuid`))}) FOR UPDATE`);
      if (selections.length !== selectionIds.length) fail('NEW_PRODUCT_SELECTION_NOT_FOUND', 404);
      for (const selection of selections) {
        const [defect] = await tx.$queryRaw<Row[]>(Prisma.sql`SELECT version, archived_at FROM process_defects WHERE id = ${selection.defect_id}::uuid AND organization_id = ${organizationId}::uuid FOR UPDATE`);
        if (!defect || defect.archived_at) fail('SOURCE_ARCHIVED', 409);
        if (defect.version !== selection.source_version) fail('SOURCE_VERSION_CONFLICT', 409);
      }
      const id = randomUUID(); const form = input.complexity === 'COMPLEX' ? 'EIGHT_D' : 'BRIEF';
      await tx.$executeRaw(Prisma.sql`INSERT INTO new_product_issues(id, organization_id, project_id, trial_batch_id, response_form, complexity, severity, created_by_id) VALUES (${id}::uuid, ${organizationId}::uuid, ${project}::uuid, ${trialBatch}::uuid, ${form}, ${input.complexity}, ${severity}, ${actor.id}::uuid)`);
      for (const selection of selections) await tx.$executeRaw(Prisma.sql`INSERT INTO new_product_issue_sources(organization_id, issue_id, selection_id, source_version, source_snapshot) VALUES (${organizationId}::uuid, ${id}::uuid, ${selection.id}::uuid, ${selection.source_version}, ${selection.source_snapshot}::jsonb)`);
      let issue: Row | undefined;
      if (this.problems) {
        const problem = await this.problems.createForDomainSourceIssue(tx as never, {
          organizationId, domainCode: 'new-product-quality', problemType: 'NEW_PRODUCT_ISSUE',
          sourceType: 'new-product-issue', sourceId: id, severity, responsibleParty: 'new-product-quality',
          createdById: actor.id, traceId,
        });
        [issue] = await tx.$queryRaw<Row[]>(Prisma.sql`UPDATE new_product_issues SET problem_index_id = ${String(problem.id)}::uuid, updated_at = CURRENT_TIMESTAMP WHERE id = ${id}::uuid AND organization_id = ${organizationId}::uuid RETURNING *`);
        if (this.runtime) {
          const binding = input.workflowBinding;
          if (!binding || Object.values(binding).some((value) => typeof value !== 'string' || !value.trim())) fail('NEW_PRODUCT_WORKFLOW_BINDING_REQUIRED', 400);
          const workflowCode = input.complexity === 'COMPLEX' ? 'NEW_PRODUCT_8D' : 'NEW_PRODUCT_BRIEF';
          const definition = await tx.workflowDefinition.findUnique({ where: { organizationId_code: { organizationId, code: workflowCode } } });
          if (!definition || definition.id !== binding.workflowDefinitionId) fail('NEW_PRODUCT_WORKFLOW_CONFIGURATION_REQUIRED', 409);
          const workflowVersion = await tx.workflowVersion.findFirst({ where: { organizationId, workflowDefinitionId: definition.id, status: 'PUBLISHED' }, orderBy: { version: 'desc' }, include: { nodes: true } });
          const closes = workflowVersion?.nodes.filter((node) => node.type === 'CLOSE') ?? [];
          if (!workflowVersion || workflowVersion.id !== binding.workflowVersionId || !workflowVersion.nodes.some((node) => node.type === 'VERIFICATION') || closes.length !== 1 || jsonObject(closes[0]!.config).requireIndependentVerification !== true) fail('NEW_PRODUCT_WORKFLOW_CONFIGURATION_REQUIRED', 409);
          const started = await this.runtime.startInstance({ organizationId, actor, problemIndexId: String(problem.id), workflowDefinitionId: binding.workflowDefinitionId, workflowVersionId: binding.workflowVersionId, expectedProblemVersion: Number(problem.version), instanceKey: binding.instanceKey, idempotencyKey: key ?? randomUUID(), traceId }, tx);
          await tx.$executeRaw(Prisma.sql`INSERT INTO new_product_issue_revisions(id, organization_id, issue_id, revision, response_form, workflow_instance_id, workflow_version_id, created_by_id) VALUES (${randomUUID()}::uuid, ${organizationId}::uuid, ${id}::uuid, 1, ${form}, ${started.instanceId}::uuid, ${started.workflowVersionId}::uuid, ${actor.id}::uuid)`);
        }
      } else {
        [issue] = await tx.$queryRaw<Row[]>(Prisma.sql`SELECT * FROM new_product_issues WHERE id = ${id}::uuid AND organization_id = ${organizationId}::uuid`);
      }
      await this.record(tx, actor, organizationId, 'NEW_PRODUCT_ISSUE_CREATED', 'NewProductIssue', id, traceId); return issue;
    });
  }

  async escalateIssue(actor: AdminActor, issueId: string, input: { expectedVersion: number }, traceId: string, key?: string) {
    const organizationId = this.scope(actor); const id = uuid(issueId); const expectedVersion = version(input.expectedVersion);
    if (this.upgrades && this.problems && this.runtime) {
      const context = await this.prisma.$transaction(async (tx) => {
        const [issue] = await tx.$queryRaw<Row[]>(Prisma.sql`SELECT id, problem_index_id, version FROM new_product_issues WHERE id = ${id}::uuid AND organization_id = ${organizationId}::uuid`);
        if (!issue?.problem_index_id) fail('CONCURRENCY_CONFLICT', 409);
        const [problem] = await tx.$queryRaw<Row[]>(Prisma.sql`SELECT id, version, workflow_instance_id FROM problem_indexes WHERE id = ${issue.problem_index_id}::uuid AND organization_id = ${organizationId}::uuid`);
        if (!problem?.workflow_instance_id) fail('NEW_PRODUCT_WORKFLOW_UPGRADE_REQUIRED', 409);
        const instance = await tx.workflowInstance.findFirst({ where: { id: problem.workflow_instance_id, organizationId, problemIndexId: problem.id }, include: { currentNode: true } });
        if (!instance?.currentNode) fail('NEW_PRODUCT_WORKFLOW_UPGRADE_REQUIRED', 409);
        return { problemId: problem.id, problemVersion: Number(problem.version), instanceId: instance.id, instanceVersion: instance.version, currentNodeId: instance.currentNode.id };
      });
      const upgrade = await this.upgrades.upgrade(actor, context.problemId, {
        organizationId, instanceId: context.instanceId, currentNodeId: context.currentNodeId,
        expectedProblemVersion: context.problemVersion, expectedInstanceVersion: context.instanceVersion,
        expectedDomainVersion: expectedVersion, reason: '新品质量问题升级为 8D 响应',
      }, key ?? '', traceId);
      const [row] = await this.prisma.$queryRaw<Row[]>(Prisma.sql`SELECT * FROM new_product_issues WHERE id = ${id}::uuid AND organization_id = ${organizationId}::uuid`);
      return { ...row, workflowUpgrade: upgrade };
    }
    return this.mutations.run({ actor, organizationId, key, traceId, action: 'NEW_PRODUCT_ISSUE_ESCALATED', payload: { id, expectedVersion }, permission: WRITE }, async (tx) => {
      const [issue] = await tx.$queryRaw<Row[]>(Prisma.sql`SELECT project_id FROM new_product_issues WHERE id = ${id}::uuid AND organization_id = ${organizationId}::uuid`);
      if (!issue) fail('CONCURRENCY_CONFLICT', 409);
      const [project] = await tx.$queryRaw<Row[]>(Prisma.sql`SELECT status FROM new_product_projects WHERE id = ${issue.project_id}::uuid AND organization_id = ${organizationId}::uuid FOR UPDATE`);
      if (project?.status !== 'ACTIVE') fail('NEW_PRODUCT_PROJECT_ARCHIVED', 409);
      const [row] = await tx.$queryRaw<Row[]>(Prisma.sql`UPDATE new_product_issues SET complexity = 'COMPLEX', response_form = 'EIGHT_D', status = 'ESCALATED', version = version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ${id}::uuid AND organization_id = ${organizationId}::uuid AND version = ${expectedVersion} AND status = 'OPEN' RETURNING *`);
      if (!row) fail('CONCURRENCY_CONFLICT', 409); await this.record(tx, actor, organizationId, 'NEW_PRODUCT_ISSUE_ESCALATED', 'NewProductIssue', id, traceId); return row;
    });
  }

  async assignIssue(actor: AdminActor, issueId: string, input: { expectedVersion: number; assigneeUserId: string }, traceId: string, key?: string) {
    const organizationId = this.scope(actor); const id = uuid(issueId); const expectedVersion = version(input.expectedVersion); const assignee = uuid(input.assigneeUserId);
    return this.mutations.run({ actor, organizationId, key, traceId, action: 'NEW_PRODUCT_ISSUE_ASSIGNED', payload: { id, expectedVersion, assignee }, permission: WRITE }, async (tx) => {
      const [issue] = await tx.$queryRaw<Row[]>(Prisma.sql`SELECT * FROM new_product_issues WHERE id = ${id}::uuid AND organization_id = ${organizationId}::uuid FOR UPDATE`);
      if (!issue) fail('NEW_PRODUCT_ISSUE_NOT_FOUND', 404);
      if (issue.version !== expectedVersion || !['OPEN', 'ESCALATED'].includes(issue.status)) fail('NEW_PRODUCT_ISSUE_STATE_INVALID', 409);
      const [project] = await tx.$queryRaw<Row[]>(Prisma.sql`SELECT status FROM new_product_projects WHERE id = ${issue.project_id}::uuid AND organization_id = ${organizationId}::uuid FOR UPDATE`);
      if (project?.status !== 'ACTIVE') fail('NEW_PRODUCT_PROJECT_ARCHIVED', 409);
      const [user] = await tx.$queryRaw<Row[]>(Prisma.sql`SELECT id, username FROM users WHERE id = ${assignee}::uuid AND organization_id = ${organizationId}::uuid AND account_type = 'INTERNAL' AND status = 'ACTIVE'`);
      if (!user) fail('NEW_PRODUCT_ISSUE_ASSIGNEE_INVALID', 400);
      const [row] = await tx.$queryRaw<Row[]>(Prisma.sql`UPDATE new_product_issues SET owner_user_id = ${assignee}::uuid, status = 'IN_PROGRESS', version = version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ${id}::uuid AND organization_id = ${organizationId}::uuid AND version = ${expectedVersion} RETURNING *`);
      if (!row) fail('CONCURRENCY_CONFLICT', 409);
      await this.record(tx, actor, organizationId, 'NEW_PRODUCT_ISSUE_ASSIGNED', 'NewProductIssue', id, traceId);
      return { ...this.issueDto(row), owner_username: user.username };
    });
  }

  async recordIssueMeasure(actor: AdminActor, issueId: string, input: { expectedVersion: number; measurePlan: string; measureDueAt?: string }, traceId: string, key?: string) {
    const organizationId = this.scope(actor); const id = uuid(issueId); const expectedVersion = version(input.expectedVersion); const measurePlan = text(input.measurePlan, 10000);
    const dueAt = input.measureDueAt ? new Date(input.measureDueAt) : null;
    if (dueAt && Number.isNaN(dueAt.getTime())) fail('NEW_PRODUCT_INPUT_INVALID', 400);
    return this.mutations.run({ actor, organizationId, key, traceId, action: 'NEW_PRODUCT_ISSUE_MEASURE_RECORDED', payload: { id, expectedVersion }, permission: WRITE }, async (tx) => {
      const [issue] = await tx.$queryRaw<Row[]>(Prisma.sql`SELECT * FROM new_product_issues WHERE id = ${id}::uuid AND organization_id = ${organizationId}::uuid FOR UPDATE`);
      if (!issue) fail('NEW_PRODUCT_ISSUE_NOT_FOUND', 404);
      if (issue.version !== expectedVersion || issue.status !== 'IN_PROGRESS') fail('NEW_PRODUCT_ISSUE_STATE_INVALID', 409);
      const [project] = await tx.$queryRaw<Row[]>(Prisma.sql`SELECT status FROM new_product_projects WHERE id = ${issue.project_id}::uuid AND organization_id = ${organizationId}::uuid FOR UPDATE`);
      if (project?.status !== 'ACTIVE') fail('NEW_PRODUCT_PROJECT_ARCHIVED', 409);
      const [row] = await tx.$queryRaw<Row[]>(Prisma.sql`UPDATE new_product_issues SET measure_plan = ${measurePlan}, measure_due_at = ${dueAt}, version = version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ${id}::uuid AND organization_id = ${organizationId}::uuid AND version = ${expectedVersion} RETURNING *`);
      if (!row) fail('CONCURRENCY_CONFLICT', 409);
      await this.record(tx, actor, organizationId, 'NEW_PRODUCT_ISSUE_MEASURE_RECORDED', 'NewProductIssue', id, traceId);
      return this.issueDto(row);
    });
  }

  async verifyIssue(actor: AdminActor, issueId: string, input: { expectedVersion: number; verificationSummary: string; evidenceObjectId?: string }, traceId: string, key?: string) {
    const organizationId = this.scope(actor); const id = uuid(issueId); const expectedVersion = version(input.expectedVersion); const summary = text(input.verificationSummary, 10000); const evidence = input.evidenceObjectId ? uuid(input.evidenceObjectId) : null;
    return this.mutations.run({ actor, organizationId, key, traceId, action: 'NEW_PRODUCT_ISSUE_VERIFIED', payload: { id, expectedVersion, evidence }, permission: WRITE }, async (tx) => {
      const [issue] = await tx.$queryRaw<Row[]>(Prisma.sql`SELECT * FROM new_product_issues WHERE id = ${id}::uuid AND organization_id = ${organizationId}::uuid FOR UPDATE`);
      if (!issue) fail('NEW_PRODUCT_ISSUE_NOT_FOUND', 404);
      if (issue.version !== expectedVersion || issue.status !== 'IN_PROGRESS' || !issue.measure_plan) fail('NEW_PRODUCT_ISSUE_STATE_INVALID', 409);
      if (issue.owner_user_id === actor.id) fail('WORKFLOW_INDEPENDENT_VERIFICATION_REQUIRED', 409);
      const [project] = await tx.$queryRaw<Row[]>(Prisma.sql`SELECT status FROM new_product_projects WHERE id = ${issue.project_id}::uuid AND organization_id = ${organizationId}::uuid FOR UPDATE`);
      if (project?.status !== 'ACTIVE') fail('NEW_PRODUCT_PROJECT_ARCHIVED', 409);
      if (evidence) await this.availableEvidence(tx, organizationId, evidence, 'new-product-issue', id, expectedVersion);
      const [row] = await tx.$queryRaw<Row[]>(Prisma.sql`UPDATE new_product_issues SET verification_summary = ${summary}, verification_evidence_object_id = ${evidence}::uuid, verified_by_id = ${actor.id}::uuid, verified_at = CURRENT_TIMESTAMP, status = 'VERIFIED', version = version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ${id}::uuid AND organization_id = ${organizationId}::uuid AND version = ${expectedVersion} RETURNING *`);
      if (!row) fail('CONCURRENCY_CONFLICT', 409);
      await this.record(tx, actor, organizationId, 'NEW_PRODUCT_ISSUE_VERIFIED', 'NewProductIssue', id, traceId);
      return this.issueDto(row);
    });
  }

  async closeIssue(actor: AdminActor, issueId: string, input: { expectedVersion: number; closureNote: string }, traceId: string, key?: string) {
    const organizationId = this.scope(actor); const id = uuid(issueId); const expectedVersion = version(input.expectedVersion); const note = text(input.closureNote, 2000);
    return this.mutations.run({ actor, organizationId, key, traceId, action: 'NEW_PRODUCT_ISSUE_CLOSED', payload: { id, expectedVersion }, permission: WRITE }, async (tx) => {
      const [issue] = await tx.$queryRaw<Row[]>(Prisma.sql`SELECT * FROM new_product_issues WHERE id = ${id}::uuid AND organization_id = ${organizationId}::uuid FOR UPDATE`);
      if (!issue) fail('NEW_PRODUCT_ISSUE_NOT_FOUND', 404);
      if (issue.version !== expectedVersion || issue.status !== 'VERIFIED') fail('NEW_PRODUCT_ISSUE_STATE_INVALID', 409);
      if (issue.verified_by_id === actor.id) fail('WORKFLOW_INDEPENDENT_VERIFICATION_REQUIRED', 409);
      if (issue.problem_index_id) {
        const [formal] = await tx.$queryRaw<Row[]>(Prisma.sql`SELECT p.status AS problem_status, w.status AS workflow_status
          FROM problem_indexes p LEFT JOIN workflow_instances w ON w.id = p.workflow_instance_id AND w.organization_id = p.organization_id
          WHERE p.id = ${issue.problem_index_id}::uuid AND p.organization_id = ${organizationId}::uuid FOR UPDATE OF p`);
        if (formal?.problem_status !== 'CLOSED' || formal.workflow_status !== 'COMPLETED') fail('NEW_PRODUCT_WORKFLOW_NOT_CLOSED', 409);
      }
      const [project] = await tx.$queryRaw<Row[]>(Prisma.sql`SELECT status FROM new_product_projects WHERE id = ${issue.project_id}::uuid AND organization_id = ${organizationId}::uuid FOR UPDATE`);
      if (project?.status !== 'ACTIVE') fail('NEW_PRODUCT_PROJECT_ARCHIVED', 409);
      const [row] = await tx.$queryRaw<Row[]>(Prisma.sql`UPDATE new_product_issues SET closure_note = ${note}, closed_by_id = ${actor.id}::uuid, closed_at = CURRENT_TIMESTAMP, status = 'CLOSED', version = version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ${id}::uuid AND organization_id = ${organizationId}::uuid AND version = ${expectedVersion} RETURNING *`);
      if (!row) fail('CONCURRENCY_CONFLICT', 409);
      await this.record(tx, actor, organizationId, 'NEW_PRODUCT_ISSUE_CLOSED', 'NewProductIssue', id, traceId);
      return this.issueDto(row);
    });
  }

  async createLegacyIssue(actor: AdminActor, projectId: string, input: { description: string; riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' }, traceId: string, key?: string) {
    const organizationId = this.scope(actor); const project = uuid(projectId); const description = text(input.description, 10000);
    if (!['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].includes(input.riskLevel)) fail('NEW_PRODUCT_INPUT_INVALID', 400);
    return this.mutations.run({ actor, organizationId, key, traceId, action: 'NEW_PRODUCT_LEGACY_ISSUE_CREATED', payload: { project, description, riskLevel: input.riskLevel }, permission: WRITE }, async (tx) => {
      const [projectRow] = await tx.$queryRaw<Row[]>(Prisma.sql`SELECT id, status FROM new_product_projects WHERE id = ${project}::uuid AND organization_id = ${organizationId}::uuid FOR UPDATE`);
      if (!projectRow) fail('NEW_PRODUCT_PROJECT_NOT_FOUND', 404); if (projectRow.status !== 'ACTIVE') fail('NEW_PRODUCT_PROJECT_ARCHIVED', 409);
      const [row] = await tx.$queryRaw<Row[]>(Prisma.sql`INSERT INTO new_product_legacy_issues(id, organization_id, project_id, description, risk_level, created_by_id) VALUES (gen_random_uuid(), ${organizationId}::uuid, ${project}::uuid, ${description}, ${input.riskLevel}, ${actor.id}::uuid) RETURNING *`);
      await this.record(tx, actor, organizationId, 'NEW_PRODUCT_LEGACY_ISSUE_CREATED', 'NewProductLegacyIssue', row.id, traceId); return row;
    });
  }

  async approveMassProduction(actor: AdminActor, projectId: string, input: { decision: 'APPROVE' | 'REJECT'; riskStatement: string; evidenceObjectId: string }, traceId: string, key?: string) {
    const organizationId = this.scope(actor); const project = uuid(projectId); const riskStatement = text(input.riskStatement, 10000); const evidence = uuid(input.evidenceObjectId);
    if (!['APPROVE', 'REJECT'].includes(input.decision)) fail('NEW_PRODUCT_INPUT_INVALID', 400);
    return this.mutations.run({ actor, organizationId, key, traceId, action: 'NEW_PRODUCT_MASS_PRODUCTION_DECISION', payload: { project, decision: input.decision }, permission: WRITE }, async (tx) => {
      const [projectRow] = await tx.$queryRaw<Row[]>(Prisma.sql`SELECT id, status FROM new_product_projects WHERE id = ${project}::uuid AND organization_id = ${organizationId}::uuid FOR UPDATE`); if (!projectRow) fail('NEW_PRODUCT_PROJECT_NOT_FOUND', 404); if (projectRow.status !== 'ACTIVE') fail('NEW_PRODUCT_PROJECT_ARCHIVED', 409);
      const [file] = await tx.$queryRaw<Row[]>(Prisma.sql`SELECT id FROM file_objects WHERE id = ${evidence}::uuid AND organization_id = ${organizationId}::uuid AND status = 'AVAILABLE' AND scan_status = 'CLEAN' AND deleted_at IS NULL`); if (!file) fail('NEW_PRODUCT_EVIDENCE_UNAVAILABLE', 409);
      const [row] = await tx.$queryRaw<Row[]>(Prisma.sql`INSERT INTO new_product_mass_production_approvals(id, organization_id, project_id, decision, risk_statement, evidence_object_id, signed_by_id) VALUES (gen_random_uuid(), ${organizationId}::uuid, ${project}::uuid, ${input.decision}, ${riskStatement}, ${evidence}::uuid, ${actor.id}::uuid) ON CONFLICT (organization_id, project_id) DO UPDATE SET decision = EXCLUDED.decision, risk_statement = EXCLUDED.risk_statement, evidence_object_id = EXCLUDED.evidence_object_id, signed_by_id = EXCLUDED.signed_by_id, signed_at = CURRENT_TIMESTAMP, version = new_product_mass_production_approvals.version + 1 RETURNING *`);
      await this.record(tx, actor, organizationId, 'NEW_PRODUCT_MASS_PRODUCTION_DECISION', 'NewProductMassProductionApproval', row.id, traceId); return row;
    });
  }

  async createEarlyFlow(actor: AdminActor, projectId: string, input: { monitoringWindowDays: number; monitoringFrequency: string; plan: string; exitCriteria: string }, traceId: string, key?: string) {
    const organizationId = this.scope(actor); const id = uuid(projectId); const days = input.monitoringWindowDays; const frequency = text(input.monitoringFrequency, 200); const plan = text(input.plan, 10000); const exitCriteria = text(input.exitCriteria, 10000);
    if (!Number.isSafeInteger(days) || days < 1 || days > 365) fail('NEW_PRODUCT_INPUT_INVALID', 400);
    return this.mutations.run({ actor, organizationId, key, traceId, action: 'NEW_PRODUCT_EARLY_FLOW_CREATED', payload: { projectId: id, monitoringWindowDays: days, monitoringFrequency: frequency, plan, exitCriteria }, permission: WRITE }, async (tx) => {
      const [project] = await tx.$queryRaw<Row[]>(Prisma.sql`SELECT status FROM new_product_projects WHERE id = ${id}::uuid AND organization_id = ${organizationId}::uuid FOR UPDATE`);
      if (!project) fail('NEW_PRODUCT_PROJECT_NOT_FOUND', 404); if (project.status !== 'ACTIVE') fail('NEW_PRODUCT_PROJECT_ARCHIVED', 409);
      const flowId = randomUUID();
      const [row] = await tx.$queryRaw<Row[]>(Prisma.sql`INSERT INTO new_product_early_flows(id, organization_id, project_id, monitoring_window_days, monitoring_frequency, plan, exit_criteria, created_by_id) VALUES (${flowId}::uuid, ${organizationId}::uuid, ${id}::uuid, ${days}, ${frequency}, ${plan}, ${exitCriteria}, ${actor.id}::uuid) RETURNING *`);
      await this.record(tx, actor, organizationId, 'NEW_PRODUCT_EARLY_FLOW_CREATED', 'NewProductEarlyFlow', flowId, traceId);
      return this.earlyFlowDto(row);
    }).catch(mapUnique);
  }

  async earlyFlow(actor: AdminActor, projectId: string) {
    const id = uuid(projectId);
    return this.read(actor, async (tx, organizationId) => {
      const [row] = await tx.$queryRaw<Row[]>(Prisma.sql`SELECT flow.*, release.decision AS release_decision, release.note AS release_note, release.evidence_object_id AS release_evidence_object_id, release.decided_by_id AS release_decided_by_id, release.decided_at AS release_decided_at, release.flow_version AS release_flow_version FROM new_product_early_flows flow LEFT JOIN new_product_early_flow_releases release ON release.early_flow_id = flow.id AND release.organization_id = flow.organization_id AND release.flow_version = flow.version WHERE flow.project_id = ${id}::uuid AND flow.organization_id = ${organizationId}::uuid`);
      return row ? this.earlyFlowDto(row) : null;
    });
  }

  async reviseEarlyFlow(actor: AdminActor, flowId: string, input: { expectedVersion: number; monitoringWindowDays: number; monitoringFrequency: string; plan: string; exitCriteria: string }, traceId: string, key?: string) {
    const organizationId = this.scope(actor); const id = uuid(flowId); const expectedVersion = version(input.expectedVersion);
    const days = input.monitoringWindowDays; const frequency = text(input.monitoringFrequency, 200); const plan = text(input.plan, 10000); const exitCriteria = text(input.exitCriteria, 10000);
    if (!Number.isSafeInteger(days) || days < 1 || days > 365) fail('NEW_PRODUCT_INPUT_INVALID', 400);
    return this.mutations.run({ actor, organizationId, key, traceId, action: 'NEW_PRODUCT_EARLY_FLOW_REVISED', payload: { id, expectedVersion, days, frequency, plan, exitCriteria }, permission: WRITE }, async (tx) => {
      const [flow] = await tx.$queryRaw<Row[]>(Prisma.sql`SELECT flow.status, project.status AS project_status FROM new_product_early_flows flow JOIN new_product_projects project ON project.id = flow.project_id AND project.organization_id = flow.organization_id WHERE flow.id = ${id}::uuid AND flow.organization_id = ${organizationId}::uuid FOR UPDATE OF flow, project`);
      if (!flow) fail('NEW_PRODUCT_EARLY_FLOW_NOT_FOUND', 404);
      if (flow.project_status !== 'ACTIVE' || !['DRAFT', 'REJECTED', 'APPROVED'].includes(flow.status)) fail('NEW_PRODUCT_EARLY_FLOW_STATE_INVALID', 409);
      const [row] = await tx.$queryRaw<Row[]>(Prisma.sql`UPDATE new_product_early_flows SET monitoring_window_days = ${days}, monitoring_frequency = ${frequency}, plan = ${plan}, exit_criteria = ${exitCriteria}, status = 'DRAFT', submitted_by_id = NULL, submitted_at = NULL, approved_by_id = NULL, approved_at = NULL, approval_note = NULL, version = version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ${id}::uuid AND organization_id = ${organizationId}::uuid AND version = ${expectedVersion} RETURNING *`);
      if (!row) fail('CONCURRENCY_CONFLICT', 409);
      await this.record(tx, actor, organizationId, 'NEW_PRODUCT_EARLY_FLOW_REVISED', 'NewProductEarlyFlow', id, traceId);
      return this.earlyFlowDto(row);
    });
  }

  async earlyFlowReleases(actor: AdminActor, flowId: string) {
    const id = uuid(flowId);
    return this.read(actor, async (tx, organizationId) => tx.$queryRaw<Row[]>(Prisma.sql`SELECT id, early_flow_id AS "earlyFlowId", flow_version AS "flowVersion", decision, note, evidence_object_id AS "evidenceObjectId", decided_by_id AS "decidedById", decided_at AS "decidedAt" FROM new_product_early_flow_releases WHERE early_flow_id = ${id}::uuid AND organization_id = ${organizationId}::uuid ORDER BY decided_at DESC`));
  }

  async decideEarlyFlowRelease(actor: AdminActor, flowId: string, input: { expectedVersion: number; decision: 'APPROVE' | 'REJECT'; evidenceObjectId: string; note?: string }, traceId: string, key?: string) {
    const organizationId = this.scope(actor); const id = uuid(flowId); const expectedVersion = version(input.expectedVersion); const evidenceId = uuid(input.evidenceObjectId); const note = input.note?.trim() || null;
    if (input.decision === 'REJECT' && !note) fail('NEW_PRODUCT_INPUT_INVALID', 400);
    return this.mutations.run({ actor, organizationId, key, traceId, action: 'NEW_PRODUCT_EARLY_FLOW_RELEASE_DECISION', payload: { id, expectedVersion, decision: input.decision, evidenceObjectId: evidenceId }, permission: WRITE }, async (tx) => {
      const [flow] = await tx.$queryRaw<Row[]>(Prisma.sql`SELECT id, status, version, submitted_by_id, monitoring_frequency, exit_criteria FROM new_product_early_flows WHERE id = ${id}::uuid AND organization_id = ${organizationId}::uuid FOR UPDATE`);
      if (!flow) fail('NEW_PRODUCT_EARLY_FLOW_NOT_FOUND', 404);
      if (flow.status !== 'APPROVED' || Number(flow.version) !== expectedVersion) fail('CONCURRENCY_CONFLICT', 409);
      if (flow.monitoring_frequency === '未记录' || flow.exit_criteria === '未记录') fail('NEW_PRODUCT_EARLY_FLOW_INCOMPLETE', 409);
      const [prior] = await tx.$queryRaw<Row[]>(Prisma.sql`SELECT id FROM new_product_early_flow_releases WHERE early_flow_id = ${id}::uuid AND organization_id = ${organizationId}::uuid AND flow_version = ${expectedVersion}`);
      if (prior) fail('NEW_PRODUCT_EARLY_FLOW_ALREADY_DECIDED', 409);
      if (flow.submitted_by_id === actor.id) fail('NEW_PRODUCT_EARLY_FLOW_INDEPENDENT_DECISION_REQUIRED', 409);
      const [file] = await tx.$queryRaw<Row[]>(Prisma.sql`SELECT id FROM file_objects WHERE id = ${evidenceId}::uuid AND organization_id = ${organizationId}::uuid AND status = 'AVAILABLE' AND scan_status = 'CLEAN' AND deleted_at IS NULL AND resource_type = 'new-product-early-flow' AND resource_id = ${id} AND resource_version = ${expectedVersion}`);
      if (!file) fail('NEW_PRODUCT_EVIDENCE_UNAVAILABLE', 409);
      const [updated] = await tx.$queryRaw<Row[]>(Prisma.sql`UPDATE new_product_early_flows SET version = version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ${id}::uuid AND organization_id = ${organizationId}::uuid AND version = ${expectedVersion} RETURNING version`);
      if (!updated) fail('CONCURRENCY_CONFLICT', 409);
      const [decision] = await tx.$queryRaw<Row[]>(Prisma.sql`INSERT INTO new_product_early_flow_releases(id, organization_id, early_flow_id, flow_version, decision, note, evidence_object_id, decided_by_id) VALUES (gen_random_uuid(), ${organizationId}::uuid, ${id}::uuid, ${Number(updated.version)}, ${input.decision}, ${note}, ${evidenceId}::uuid, ${actor.id}::uuid) RETURNING id, early_flow_id AS "earlyFlowId", flow_version AS "flowVersion", decision, note, evidence_object_id AS "evidenceObjectId", decided_by_id AS "decidedById", decided_at AS "decidedAt"`);
      await this.record(tx, actor, organizationId, 'NEW_PRODUCT_EARLY_FLOW_RELEASE_DECISION', 'NewProductEarlyFlow', id, traceId);
      return decision;
    });
  }

  async submitEarlyFlow(actor: AdminActor, flowId: string, input: { expectedVersion: number }, traceId: string, key?: string) {
    const organizationId = this.scope(actor); const id = uuid(flowId); const expectedVersion = version(input.expectedVersion);
    return this.mutations.run({ actor, organizationId, key, traceId, action: 'NEW_PRODUCT_EARLY_FLOW_SUBMITTED', payload: { id, expectedVersion }, permission: WRITE }, async (tx) => {
      const [row] = await tx.$queryRaw<Row[]>(Prisma.sql`UPDATE new_product_early_flows SET status = 'SUBMITTED', version = version + 1, submitted_by_id = ${actor.id}::uuid, submitted_at = CURRENT_TIMESTAMP, approval_note = NULL, approved_by_id = NULL, approved_at = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ${id}::uuid AND organization_id = ${organizationId}::uuid AND status IN ('DRAFT', 'REJECTED') AND version = ${expectedVersion} RETURNING *`);
      if (!row) fail('CONCURRENCY_CONFLICT', 409);
      await this.record(tx, actor, organizationId, 'NEW_PRODUCT_EARLY_FLOW_SUBMITTED', 'NewProductEarlyFlow', id, traceId);
      return this.earlyFlowDto(row);
    });
  }

  async approveEarlyFlow(actor: AdminActor, flowId: string, input: { expectedVersion: number; decision: 'APPROVE' | 'REJECT'; note?: string }, traceId: string, key?: string) {
    const organizationId = this.scope(actor); const id = uuid(flowId); const expectedVersion = version(input.expectedVersion); const note = input.note?.trim() || null;
    if (input.decision === 'REJECT' && !note) fail('NEW_PRODUCT_INPUT_INVALID', 400);
    return this.mutations.run({ actor, organizationId, key, traceId, action: input.decision === 'APPROVE' ? 'NEW_PRODUCT_EARLY_FLOW_APPROVED' : 'NEW_PRODUCT_EARLY_FLOW_REJECTED', payload: { id, expectedVersion, decision: input.decision, note }, permission: WRITE }, async (tx) => {
      const status = input.decision === 'APPROVE' ? 'APPROVED' : 'REJECTED';
      const [row] = await tx.$queryRaw<Row[]>(Prisma.sql`UPDATE new_product_early_flows SET status = ${status}, approval_note = ${note}, approved_by_id = ${actor.id}::uuid, approved_at = CURRENT_TIMESTAMP, version = version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ${id}::uuid AND organization_id = ${organizationId}::uuid AND status = 'SUBMITTED' AND version = ${expectedVersion} RETURNING *`);
      if (!row) fail('CONCURRENCY_CONFLICT', 409);
      await this.record(tx, actor, organizationId, input.decision === 'APPROVE' ? 'NEW_PRODUCT_EARLY_FLOW_APPROVED' : 'NEW_PRODUCT_EARLY_FLOW_REJECTED', 'NewProductEarlyFlow', id, traceId);
      return this.earlyFlowDto(row);
    });
  }

  async handoverProject(actor: AdminActor, projectId: string, input: { expectedVersion: number; riskStatement: string }, traceId: string, key?: string) {
    const organizationId = this.scope(actor); const projectIdValue = uuid(projectId); const expectedVersion = version(input.expectedVersion); const riskStatement = text(input.riskStatement, 10000);
    return this.mutations.run({ actor, organizationId, key, traceId, action: 'NEW_PRODUCT_PROJECT_HANDED_OVER', payload: { projectId: projectIdValue, expectedVersion, riskStatement }, permission: WRITE }, async (tx) => {
      const [project] = await tx.$queryRaw<Row[]>(Prisma.sql`SELECT id, status, version FROM new_product_projects WHERE id = ${projectIdValue}::uuid AND organization_id = ${organizationId}::uuid FOR UPDATE`);
      if (!project) fail('NEW_PRODUCT_PROJECT_NOT_FOUND', 404);
      if (project.status !== 'ACTIVE' || project.version !== expectedVersion) fail('CONCURRENCY_CONFLICT', 409);
      const stages = await tx.$queryRaw<Row[]>(Prisma.sql`SELECT id, code, name, status, version FROM new_product_stages WHERE project_id = ${projectIdValue}::uuid AND organization_id = ${organizationId}::uuid ORDER BY created_at, id`);
      if (!stages.length || stages.some((stage) => stage.status !== 'PASSED')) fail('NEW_PRODUCT_HANDOVER_STAGES_INCOMPLETE', 409);
      const [deliverables] = await tx.$queryRaw<{ missing: bigint }[]>(Prisma.sql`SELECT count(*) FILTER (WHERE file.id IS NULL) AS missing FROM new_product_deliverables deliverable LEFT JOIN file_objects file ON file.id = deliverable.evidence_object_id AND file.organization_id = deliverable.organization_id AND file.resource_type = 'new-product-deliverable' AND file.resource_id = deliverable.id::text AND file.resource_version = deliverable.version - 1 AND file.status = 'AVAILABLE' AND file.scan_status = 'CLEAN' AND file.deleted_at IS NULL WHERE deliverable.organization_id = ${organizationId}::uuid AND deliverable.stage_id IN (SELECT id FROM new_product_stages WHERE organization_id = ${organizationId}::uuid AND project_id = ${projectIdValue}::uuid) AND deliverable.required`);
      if (deliverables?.missing > 0n) fail('NEW_PRODUCT_HANDOVER_EVIDENCE_UNAVAILABLE', 409);
      const [lessons] = await tx.$queryRaw<{ missing: bigint }[]>(Prisma.sql`SELECT count(*) FILTER (WHERE lesson_check.avoided IS NULL OR file.id IS NULL) AS missing FROM new_product_lesson_checks lesson_check LEFT JOIN file_objects file ON file.id = lesson_check.evidence_object_id AND file.organization_id = lesson_check.organization_id AND file.resource_type = 'new-product-lesson-check' AND file.resource_id = lesson_check.id::text AND file.resource_version = lesson_check.version - 1 AND file.status = 'AVAILABLE' AND file.scan_status = 'CLEAN' AND file.deleted_at IS NULL WHERE lesson_check.project_id = ${projectIdValue}::uuid AND lesson_check.organization_id = ${organizationId}::uuid`);
      if (lessons?.missing > 0n) fail('NEW_PRODUCT_HANDOVER_LESSONS_INCOMPLETE', 409);
      const trials = await tx.$queryRaw<Row[]>(Prisma.sql`SELECT batch.id, batch.code, metric.code AS metric_code, metric.target, metric.actual, metric.comparison, metric.source FROM new_product_trial_batches batch LEFT JOIN new_product_trial_metrics metric ON metric.batch_id = batch.id AND metric.organization_id = batch.organization_id WHERE batch.project_id = ${projectIdValue}::uuid AND batch.organization_id = ${organizationId}::uuid ORDER BY batch.created_at, batch.id, metric.code`);
      if (!trials.some((trial) => trial.metric_code)) fail('NEW_PRODUCT_HANDOVER_TRIAL_INCOMPLETE', 409);
      const [unapprovedSummaries] = await tx.$queryRaw<{ count: bigint }[]>(Prisma.sql`SELECT count(*) AS count FROM new_product_trial_batches batch LEFT JOIN new_product_trial_summaries summary ON summary.batch_id = batch.id AND summary.organization_id = batch.organization_id WHERE batch.project_id = ${projectIdValue}::uuid AND batch.organization_id = ${organizationId}::uuid AND (summary.id IS NULL OR summary.status <> 'APPROVED')`);
      if (Number(unapprovedSummaries?.count ?? 0n) > 0) fail('NEW_PRODUCT_HANDOVER_TRIAL_SUMMARY_INCOMPLETE', 409);
      const summaries = await tx.$queryRaw<Row[]>(Prisma.sql`SELECT batch_id, conclusion, source_sha256 FROM new_product_trial_summaries WHERE project_id = ${projectIdValue}::uuid AND organization_id = ${organizationId}::uuid ORDER BY batch_id`);
      for (const summary of summaries) {
        const source = await this.trialSummarySource(tx, organizationId, summary.batch_id, projectIdValue, summary.conclusion);
        if (source.sourceSha256 !== summary.source_sha256) fail('NEW_PRODUCT_HANDOVER_TRIAL_SUMMARY_STALE', 409);
      }
      const [issues] = await tx.$queryRaw<{ open_count: bigint }[]>(Prisma.sql`SELECT (SELECT count(*) FROM new_product_issues WHERE organization_id = ${organizationId}::uuid AND project_id = ${projectIdValue}::uuid AND status <> 'CLOSED') + (SELECT count(*) FROM new_product_legacy_issues WHERE organization_id = ${organizationId}::uuid AND project_id = ${projectIdValue}::uuid AND status <> 'CLOSED') AS open_count`);
      const internalEightDIssues = await this.projectEightDIssues(tx, organizationId, projectIdValue);
      const openIssueCount = Number(issues?.open_count ?? 0n) + internalEightDIssues.filter(issue => issue.status !== 'CLOSED').length;
      const [decision] = await tx.$queryRaw<Row[]>(Prisma.sql`SELECT id, decision, risk_statement FROM new_product_mass_production_approvals WHERE project_id = ${projectIdValue}::uuid AND organization_id = ${organizationId}::uuid FOR UPDATE`);
      let approvalId: string | null = null;
      if (decision) {
        if (decision.decision !== 'APPROVE' || decision.risk_statement !== riskStatement) fail('NEW_PRODUCT_HANDOVER_RISK_APPROVAL_REQUIRED', 409);
        const [approval] = await tx.$queryRaw<Row[]>(Prisma.sql`SELECT approval.id FROM new_product_mass_production_approvals approval JOIN file_objects file ON file.id = approval.evidence_object_id AND file.organization_id = approval.organization_id AND file.status = 'AVAILABLE' AND file.scan_status = 'CLEAN' AND file.deleted_at IS NULL JOIN new_product_deliverables deliverable ON deliverable.id::text = file.resource_id AND deliverable.organization_id = approval.organization_id AND file.resource_type = 'new-product-deliverable' AND file.resource_version = deliverable.version - 1 AND deliverable.evidence_object_id = file.id JOIN new_product_stages stage ON stage.id = deliverable.stage_id AND stage.organization_id = deliverable.organization_id AND stage.project_id = approval.project_id WHERE approval.project_id = ${projectIdValue}::uuid AND approval.organization_id = ${organizationId}::uuid AND approval.decision = 'APPROVE' AND approval.risk_statement = ${riskStatement} FOR UPDATE OF approval`);
        if (!approval) fail('NEW_PRODUCT_HANDOVER_RISK_APPROVAL_REQUIRED', 409);
        approvalId = approval.id;
      } else if (openIssueCount > 0) fail('NEW_PRODUCT_HANDOVER_RISK_APPROVAL_REQUIRED', 409);
      const handoverId = randomUUID();
      const stageSnapshot = JSON.stringify(stages);
      const trialSnapshot = JSON.stringify(trials.map((trial) => ({ ...trial, target: trial.target === null ? null : Number(trial.target), actual: trial.actual === null ? null : Number(trial.actual) })));
      const [handover] = await tx.$queryRaw<Row[]>(Prisma.sql`INSERT INTO new_product_handovers(id, organization_id, project_id, project_version, risk_statement, mass_production_approval_id, stage_snapshot, trial_snapshot, open_issue_count, handed_over_by_id) VALUES (${handoverId}::uuid, ${organizationId}::uuid, ${projectIdValue}::uuid, ${expectedVersion}, ${riskStatement}, ${approvalId}::uuid, ${stageSnapshot}::jsonb, ${trialSnapshot}::jsonb, ${openIssueCount}, ${actor.id}::uuid) RETURNING *`);
      await tx.$executeRaw(Prisma.sql`UPDATE new_product_projects SET status = 'ARCHIVED', version = version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ${projectIdValue}::uuid AND organization_id = ${organizationId}::uuid AND version = ${expectedVersion}`);
      await this.record(tx, actor, organizationId, 'NEW_PRODUCT_PROJECT_HANDED_OVER', 'NewProductProject', projectIdValue, traceId);
      return handover;
    }).catch(mapUnique);
  }
}
