import { Injectable, type OnModuleInit } from '@nestjs/common';
import { Prisma, type ProblemIndex, type WorkflowInstance } from '../../generated/prisma/client.js';
import { internalEightDSections } from '../../common/eight-d/internal-eight-d-sections.js';
import { ProblemDomainRegistry, type ProblemDomainReadAdapter, type ProblemDomainReadContext, type ProblemDomainSummary } from '../problem-index/problem-domain-registry.js';
import type { DomainSourceResponseForm } from '../problem-index/domain-source-issue.service.js';
import { assertWorkflowFeature, featurePredicate, type WorkflowActor } from '../workflow/workflow-access-policy.js';
import { jsonObject, workflowError } from '../workflow/workflow-runtime-policy.js';
import { documentFileIds, normalizeProcessEightDDocument } from '../process-quality/process-eight-d-document.js';
import { SupplierProblemReadAdapter } from './supplier-problem-read.adapter.js';
import { SupplierEightDService } from './supplier-eight-d.service.js';

type SummaryRow = { id: string; title: string; description: string; materialCode: string; supplierName: string; stage: string;
  controlled: boolean; analysisDueAt: Date | null; submissionDueAt: Date | null; closureDueAt: Date | null };

@Injectable()
export class SupplierEightDReadAdapter implements ProblemDomainReadAdapter, OnModuleInit {
  readonly domainCode = 'supplier-quality';
  readonly sourceType = 'supplier-quality';
  readonly revisionResourceType = 'SupplierResponseRevision';
  private readonly legacy = new SupplierProblemReadAdapter();

  constructor(private readonly registry: ProblemDomainRegistry, private readonly core: SupplierEightDService) {}
  onModuleInit(): void { this.registry.registerOverride(this); }

  visibilityPredicate(actor: WorkflowActor, organizationId: string): Prisma.Sql {
    if (actor.accountType !== 'INTERNAL') return Prisma.sql`FALSE`;
    return Prisma.sql`EXISTS (
      SELECT 1 FROM supplier_quality_problems own_supplier_problem
      JOIN organizations owner ON owner.id = own_supplier_problem.owner_organization_id AND owner.type = 'INTERNAL' AND owner.status = 'ACTIVE'
      JOIN supplier_business_profiles profile ON profile.id = own_supplier_problem.profile_id
        AND profile.owner_organization_id = owner.id
        AND profile.supplier_organization_id IS NOT DISTINCT FROM own_supplier_problem.supplier_organization_id
      WHERE own_supplier_problem.id = p.source_id AND own_supplier_problem.problem_index_id = p.id AND owner.id = p.organization_id
        AND ((p.organization_id = ${actor.organizationId}::uuid AND EXISTS (
          SELECT 1 FROM supplier_eight_d_controls control WHERE control.supplier_problem_id = own_supplier_problem.id
            AND control.problem_index_id = p.id AND control.organization_id = p.organization_id AND own_supplier_problem.response_form = 'EIGHT_D'
        ) AND ${featurePredicate(Prisma.sql`${actor.id}::uuid`, Prisma.sql`${organizationId}::uuid`, Prisma.sql`'supplier-quality:issues:read'`)})
        OR (NOT EXISTS (SELECT 1 FROM supplier_eight_d_controls control
          WHERE control.supplier_problem_id = own_supplier_problem.id OR control.problem_index_id = p.id)
          AND ${this.legacy.visibilityPredicate(actor, organizationId)}))
    )`;
  }

  responseFormPredicate(form: DomainSourceResponseForm): Prisma.Sql {
    return Prisma.sql`EXISTS (SELECT 1 FROM supplier_quality_problems own_supplier_problem
      WHERE own_supplier_problem.id = p.source_id AND own_supplier_problem.problem_index_id = p.id
        AND own_supplier_problem.owner_organization_id = p.organization_id AND own_supplier_problem.response_form::text = ${form})`;
  }

  async authorizeRead(tx: Prisma.TransactionClient, context: ProblemDomainReadContext): Promise<void> {
    if (!await this.controlled(tx, context.problem)) return this.legacy.authorizeRead(tx, context);
    await this.record(tx, context);
  }

  async readSummaries(tx: Prisma.TransactionClient, actor: WorkflowActor, problems: readonly ProblemIndex[]): Promise<ReadonlyMap<string, ProblemDomainSummary>> {
    if (!problems.length) return new Map();
    // Read only bounded metadata, never drafts, report snapshots or evidence per row.
    const rows: SummaryRow[] = [];
    for (const organizationId of new Set(problems.map(problem => problem.organizationId))) {
      rows.push(...await tx.$queryRaw<SummaryRow[]>(Prisma.sql`SELECT p.id, supplier.title, supplier.defect_description AS description,
        supplier.material_code AS "materialCode", profile.display_name AS "supplierName",
        CASE WHEN p.archived_at IS NOT NULL OR p.status = 'ARCHIVED' THEN '已归档'
          WHEN control.closed_at IS NOT NULL OR p.status = 'CLOSED' THEN '已关闭'
          WHEN p.status = 'PENDING' THEN '关闭审批中'
          WHEN control.analysis_completed_at IS NOT NULL THEN '完整提交阶段' ELSE '分析阶段' END AS stage,
        (control.supplier_problem_id IS NOT NULL) AS controlled, control.analysis_due_at AS "analysisDueAt",
        control.submission_due_at AS "submissionDueAt", control.closure_due_at AS "closureDueAt"
        FROM problem_indexes p JOIN supplier_quality_problems supplier ON supplier.id = p.source_id
        JOIN supplier_business_profiles profile ON profile.id = supplier.profile_id
        LEFT JOIN supplier_eight_d_controls control ON control.supplier_problem_id = supplier.id
          AND control.organization_id = p.organization_id AND control.problem_index_id = p.id
        WHERE p.id IN (${Prisma.join(problems.filter(problem => problem.organizationId === organizationId).map(problem => Prisma.sql`${problem.id}::uuid`))})
          AND p.organization_id = ${organizationId}::uuid AND p.domain_code = ${this.domainCode} AND p.source_type = ${this.sourceType}
          AND ${this.visibilityPredicate(actor, organizationId)}`));
    }
    return new Map(rows.map(row => [row.id, row.controlled ? { ...this.summary(row.title, row.description), fields: [
      { key: 'supplierName', label: '责任供应商', value: row.supplierName }, { key: 'materialCode', label: '物料编码', value: row.materialCode },
      { key: 'stage', label: '当前阶段', value: row.stage },
      ...(['analysisDueAt', 'submissionDueAt', 'closureDueAt'] as const).map((key, index) => ({ key,
        label: ['分析计划', '提交计划', '关闭计划'][index]!, value: row[key]?.toISOString() ?? null })),
    ] } : { title: this.title(row.title), description: row.description, domainUiKey: this.domainCode }]));
  }

  async readWorkspace(tx: Prisma.TransactionClient, context: ProblemDomainReadContext, instance: WorkflowInstance | null) {
    if (!await this.controlled(tx, context.problem)) return this.legacy.readWorkspace(tx, context, instance);
    await this.record(tx, context);
    if (!instance || instance.id !== context.problem.workflowInstanceId || context.purpose === 'history') return null;
    const { result, body } = await this.read(tx, context);
    const facts = jsonObject(body.problem);
    return { domainVersion: Number(body.contentVersion), revisionId: result.revision?.id ?? null,
      summary: this.summary(String(facts.title), String(facts.defectDescription)),
      sections: [{ key: 'supplierFacts', title: '供应商问题资料', fields: [
        { key: 'title', label: '问题标题', value: String(facts.title) }, { key: 'materialCode', label: '物料编码', value: String(facts.materialCode) },
      ] }, ...internalEightDSections(normalizeProcessEightDDocument(body.document))] };
  }

  async readReport(tx: Prisma.TransactionClient, context: ProblemDomainReadContext, instance: WorkflowInstance) {
    if (!await this.controlled(tx, context.problem)) return this.legacy.readReport(tx, context);
    const current = await this.record(tx, context);
    await assertWorkflowFeature(tx, context.actor, context.problem.organizationId, 'supplier-quality:issues:report');
    if (instance.id !== context.problem.workflowInstanceId || context.purpose === 'history') return null;
    const revisionId = current.control.closedAt ? current.control.approvedRevisionId
      : (await tx.supplierResponseRevision.findFirst({ where: { problemId: current.supplier.id, workflowInstanceId: instance.id },
        orderBy: { revision: 'desc' }, select: { id: true } }))?.id;
    if (!revisionId) return null;
    const { result, body } = await this.read(tx, context, revisionId);
    const facts = jsonObject(body.problem), workflow = jsonObject(body.instance), deadlines = jsonObject(body.deadlines);
    const revision = await tx.supplierResponseRevision.findUniqueOrThrow({ where: { id: result.revision!.id }, select: { createdAt: true } });
    return { revisionId: revisionId, instanceId: String(workflow.id), instanceVersion: Number(workflow.version),
      recordedAt: revision.createdAt.toISOString(), summary: this.summary(String(facts.title), String(facts.defectDescription)),
      snapshot: { problemType: 'EIGHT_D', severity: String(facts.severity), status: String(workflow.status), responsibleParty: null,
        ownerId: typeof body.ownerUserId === 'string' ? body.ownerUserId : null, dueAt: typeof deadlines.closureDueAt === 'string' ? deadlines.closureDueAt : null },
      sections: internalEightDSections(normalizeProcessEightDDocument(body.document)) };
  }

  async listRevisionIds(tx: Prisma.TransactionClient, context: ProblemDomainReadContext): Promise<readonly string[] | null> {
    if (!await this.controlled(tx, context.problem)) return null;
    const record = await this.record(tx, context);
    const rows = await tx.$queryRaw<{ id: string }[]>`SELECT revision.id FROM supplier_response_revisions revision
      JOIN supplier_eight_d_submission_origins origin ON origin.revision_id = revision.id AND origin.supplier_problem_id = revision.problem_id
      WHERE origin.organization_id = ${context.problem.organizationId}::uuid AND origin.supplier_problem_id = ${record.supplier.id}::uuid
        AND revision.workflow_instance_id = ${context.problem.workflowInstanceId}::uuid`;
    return rows.map(row => row.id);
  }

  async listEvidenceReferences(tx: Prisma.TransactionClient, context: ProblemDomainReadContext, revisionId: string | null) {
    if (!await this.controlled(tx, context.problem)) return this.legacy.listEvidenceReferences(tx, context, revisionId);
    if (context.purpose === 'history') { await this.record(tx, context); return []; }
    const { result, body, record } = await this.read(tx, context, revisionId);
    const privateIds = new Set(result.privateSupplementFileIds);
    return documentFileIds(normalizeProcessEightDDocument(body.document)).map(fileId => ({ fileId,
      resourceType: privateIds.has(fileId) ? 'supplier-eight-d-supplement' : 'supplier-quality', resourceId: record.supplier.id }));
  }

  async describeActions(tx: Prisma.TransactionClient, context: ProblemDomainReadContext) {
    if (!await this.controlled(tx, context.problem)) return this.legacy.describeActions(tx, context);
    await this.record(tx, context);
    return [];
  }

  private async controlled(tx: Prisma.TransactionClient, problem: ProblemIndex): Promise<boolean> {
    if (problem.domainCode !== this.domainCode || problem.sourceType !== this.sourceType || !problem.sourceId) workflowError('PROBLEM_NOT_FOUND', 404);
    const [row] = await tx.$queryRaw<{ controlled: boolean }[]>`SELECT EXISTS (SELECT 1 FROM supplier_eight_d_controls
      WHERE supplier_problem_id = ${problem.sourceId}::uuid OR problem_index_id = ${problem.id}::uuid) AS controlled`;
    return row!.controlled;
  }

  private async record(tx: Prisma.TransactionClient, context: ProblemDomainReadContext) {
    if (context.actor.accountType !== 'INTERNAL') workflowError('PROBLEM_NOT_FOUND', 404);
    const record = await this.core.lockRecord(tx, context.actor, context.problem.sourceId!, true);
    if (record.problem.id !== context.problem.id || record.control.problemIndexId !== context.problem.id
      || record.control.supplierProblemId !== context.problem.sourceId || record.control.organizationId !== context.problem.organizationId) workflowError('PROBLEM_NOT_FOUND', 404);
    await this.core.authorizeRead(tx, context.actor, record);
    return record;
  }

  private async read(tx: Prisma.TransactionClient, context: ProblemDomainReadContext, revisionId?: string | null) {
    const record = await this.record(tx, context);
    // Undefined means APPROVED in core; a live case must explicitly request CURRENT with null.
    const revision = revisionId ?? (record.control.closedAt ? undefined : null);
    const result = await this.core.readReport(tx, context.actor, record.supplier.id, revision);
    const body = jsonObject(result.snapshot);
    if (jsonObject(body.instance).id !== context.problem.workflowInstanceId || jsonObject(body.problem).id !== context.problem.id) workflowError('PROBLEM_NOT_FOUND', 404);
    return { result, body, record };
  }

  private title(value: string) { return value.length <= 200 ? value : `${value.slice(0, 199).replace(/[\uD800-\uDBFF]$/, '')}…`; }
  private summary(title: string, description: string): ProblemDomainSummary { return { title: this.title(title), description, domainUiKey: 'supplier-eight-d' }; }
}
