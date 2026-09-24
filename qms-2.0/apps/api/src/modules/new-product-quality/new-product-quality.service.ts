import { randomUUID } from 'node:crypto';
import { HttpException, Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../database/prisma.service.js';
import { AdminMutationService, assertAdminAccess, type AdminActor, type AdminTransaction } from '../../common/security/admin-mutation.service.js';
import { AuditLogService } from '../audit-log/audit-log.service.js';
import { ProblemIndexService } from '../problem-index/problem-index.service.js';
import { WorkflowRuntimeService } from '../workflow/workflow-runtime.service.js';
import { jsonObject } from '../workflow/workflow-runtime-policy.js';

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

@Injectable()
export class NewProductQualityService {
  constructor(private readonly prisma: PrismaService, private readonly mutations: AdminMutationService, private readonly audit: AuditLogService, private readonly problems?: ProblemIndexService, private readonly runtime?: WorkflowRuntimeService) {}

  private scope(actor: AdminActor): string {
    if (actor.accountType !== 'INTERNAL') fail('ORGANIZATION_SCOPE_DENIED', 403);
    return actor.scopeOrganizationId ?? actor.organizationId;
  }

  private async read<Result>(actor: AdminActor, work: (tx: AdminTransaction, organizationId: string) => Promise<Result>): Promise<Result> {
    const organizationId = this.scope(actor);
    return this.prisma.$transaction(async (tx) => { await assertAdminAccess(tx, actor, organizationId, READ); return work(tx, organizationId); });
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
      return { ...project, stages, lessons, batches, selected_defects };
    });
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

  async trialReport(actor: AdminActor, batchId: string) {
    const id = uuid(batchId);
    return this.read(actor, async (tx, organizationId) => {
      const [batch] = await tx.$queryRaw<Row[]>(Prisma.sql`SELECT * FROM new_product_trial_batches WHERE id = ${id}::uuid AND organization_id = ${organizationId}::uuid`);
      if (!batch) fail('NEW_PRODUCT_TRIAL_BATCH_NOT_FOUND', 404);
      const metrics = await tx.$queryRaw<Row[]>(Prisma.sql`SELECT * FROM new_product_trial_metrics WHERE batch_id = ${id}::uuid AND organization_id = ${organizationId}::uuid ORDER BY code`);
      return { ...batch, metrics: metrics.map((metric) => ({ ...metric, target: Number(metric.target), actual: Number(metric.actual), signal: metric.comparison === 'GTE' ? Number(metric.actual) >= Number(metric.target) ? 'GREEN' : 'RED' : Number(metric.actual) <= Number(metric.target) ? 'GREEN' : 'RED' })) };
    });
  }

  async selectProcessDefect(actor: AdminActor, projectId: string, input: { defectId: string; expectedVersion: number; reason?: string }, traceId: string, key?: string) {
    const organizationId = this.scope(actor); const project = uuid(projectId); const defectId = uuid(input.defectId); const expectedVersion = version(input.expectedVersion);
    const reason = input.reason === undefined ? null : text(input.reason, 2000);
    return this.mutations.run({ actor, organizationId, key, traceId, action: 'NEW_PRODUCT_DEFECT_SELECTED', payload: { project, defectId, expectedVersion, reason }, permission: WRITE }, async (tx) => {
      await assertAdminAccess(tx, actor, organizationId, ['new-product-quality:projects:write', 'process-quality:defects:read']);
      const [projectRow] = await tx.$queryRaw<Row[]>(Prisma.sql`SELECT status, code, product_code FROM new_product_projects WHERE id = ${project}::uuid AND organization_id = ${organizationId}::uuid FOR UPDATE`);
      if (!projectRow) fail('NEW_PRODUCT_PROJECT_NOT_FOUND', 404); if (projectRow.status !== 'ACTIVE') fail('NEW_PRODUCT_PROJECT_ARCHIVED', 409);
      const [defect] = await tx.$queryRaw<Row[]>(Prisma.sql`SELECT * FROM process_defects WHERE id = ${defectId}::uuid AND organization_id = ${organizationId}::uuid AND archived_at IS NULL FOR UPDATE`);
      if (!defect) fail('PROCESS_DEFECT_NOT_FOUND', 404); if (defect.version !== expectedVersion) fail('CONCURRENCY_CONFLICT', 409);
      if (defect.project_code !== projectRow.code && defect.project_code !== projectRow.product_code && defect.product_code !== projectRow.product_code) fail('NEW_PRODUCT_DEFECT_PROJECT_MISMATCH', 409);
      const snapshot = { id: defect.id, defectTypeCode: defect.defect_type_code, description: defect.description, defectQuantity: defect.defect_quantity, occurredAt: defect.occurred_at.toISOString(), batchCode: defect.batch_code, workOrderCode: defect.work_order_code, projectCode: defect.project_code, productCode: defect.product_code, sourceKind: defect.source_kind, version: defect.version };
      const id = randomUUID();
      const [row] = await tx.$queryRaw<Row[]>(Prisma.sql`INSERT INTO new_product_defect_selections(id, organization_id, project_id, defect_id, source_version, source_snapshot, selection_reason, selected_by_id) VALUES (${id}::uuid, ${organizationId}::uuid, ${project}::uuid, ${defectId}::uuid, ${expectedVersion}, ${JSON.stringify(snapshot)}::jsonb, ${reason}, ${actor.id}::uuid) RETURNING *`);
      await this.record(tx, actor, organizationId, 'NEW_PRODUCT_DEFECT_SELECTED', 'NewProductDefectSelection', id, traceId); return row;
    }).catch(mapUnique);
  }

  async selectedDefects(actor: AdminActor, projectId: string) {
    const organizationId = this.scope(actor); const project = uuid(projectId);
    return this.read(actor, async (tx) => {
      await assertAdminAccess(tx, actor, organizationId, ['new-product-quality:projects:read', 'process-quality:defects:read']);
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
          await this.runtime.startInstance({ organizationId, actor, problemIndexId: String(problem.id), workflowDefinitionId: binding.workflowDefinitionId, workflowVersionId: binding.workflowVersionId, expectedProblemVersion: Number(problem.version), instanceKey: binding.instanceKey, idempotencyKey: key ?? randomUUID(), traceId }, tx);
        }
      } else {
        [issue] = await tx.$queryRaw<Row[]>(Prisma.sql`SELECT * FROM new_product_issues WHERE id = ${id}::uuid AND organization_id = ${organizationId}::uuid`);
      }
      await this.record(tx, actor, organizationId, 'NEW_PRODUCT_ISSUE_CREATED', 'NewProductIssue', id, traceId); return issue;
    });
  }

  async escalateIssue(actor: AdminActor, issueId: string, input: { expectedVersion: number }, traceId: string, key?: string) {
    const organizationId = this.scope(actor); const id = uuid(issueId); const expectedVersion = version(input.expectedVersion);
    return this.mutations.run({ actor, organizationId, key, traceId, action: 'NEW_PRODUCT_ISSUE_ESCALATED', payload: { id, expectedVersion }, permission: WRITE }, async (tx) => {
      const [row] = await tx.$queryRaw<Row[]>(Prisma.sql`UPDATE new_product_issues SET complexity = 'COMPLEX', response_form = 'EIGHT_D', status = 'ESCALATED', version = version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ${id}::uuid AND organization_id = ${organizationId}::uuid AND version = ${expectedVersion} AND status = 'OPEN' RETURNING *`);
      if (!row) fail('CONCURRENCY_CONFLICT', 409); await this.record(tx, actor, organizationId, 'NEW_PRODUCT_ISSUE_ESCALATED', 'NewProductIssue', id, traceId); return row;
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
      const [projectRow] = await tx.$queryRaw<Row[]>(Prisma.sql`SELECT id FROM new_product_projects WHERE id = ${project}::uuid AND organization_id = ${organizationId}::uuid FOR UPDATE`); if (!projectRow) fail('NEW_PRODUCT_PROJECT_NOT_FOUND', 404);
      const [file] = await tx.$queryRaw<Row[]>(Prisma.sql`SELECT id FROM file_objects WHERE id = ${evidence}::uuid AND organization_id = ${organizationId}::uuid AND status = 'AVAILABLE' AND scan_status = 'CLEAN' AND deleted_at IS NULL`); if (!file) fail('NEW_PRODUCT_EVIDENCE_UNAVAILABLE', 409);
      const [row] = await tx.$queryRaw<Row[]>(Prisma.sql`INSERT INTO new_product_mass_production_approvals(id, organization_id, project_id, decision, risk_statement, evidence_object_id, signed_by_id) VALUES (gen_random_uuid(), ${organizationId}::uuid, ${project}::uuid, ${input.decision}, ${riskStatement}, ${evidence}::uuid, ${actor.id}::uuid) ON CONFLICT (organization_id, project_id) DO UPDATE SET decision = EXCLUDED.decision, risk_statement = EXCLUDED.risk_statement, evidence_object_id = EXCLUDED.evidence_object_id, signed_by_id = EXCLUDED.signed_by_id, signed_at = CURRENT_TIMESTAMP, version = new_product_mass_production_approvals.version + 1 RETURNING *`);
      await this.record(tx, actor, organizationId, 'NEW_PRODUCT_MASS_PRODUCTION_DECISION', 'NewProductMassProductionApproval', row.id, traceId); return row;
    });
  }
}
