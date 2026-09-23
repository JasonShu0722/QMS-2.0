import { Injectable } from '@nestjs/common';
import { Prisma, type ProblemIndex, type SupplierQualityProblem, type WorkflowInstance } from '../../generated/prisma/client.js';
import type { ProblemDomainReadAdapter, ProblemDomainReadContext, ProblemDomainSummary, ProblemDomainWorkspace } from '../problem-index/problem-domain-registry.js';
import { assertWorkflowFeature, featurePredicate, type WorkflowActor } from '../workflow/workflow-access-policy.js';
import { jsonObject, workflowError } from '../workflow/workflow-runtime-policy.js';

type SupplierReadRecord = SupplierQualityProblem & { profile: { displayName: string } };
const responseFields = [
  ['problemDescription', '问题描述'], ['containmentAction', '遏制措施'], ['interimAction', '临时措施'], ['rootCause', '根本原因'],
  ['correctiveAction', '纠正措施'], ['preventiveAction', '预防措施'], ['verificationResult', '验证结果'], ['completionTime', '完成时间'],
] as const;

/** Public internal reads only. Supplier collaboration remains on its resource-scoped portal. */
@Injectable()
export class SupplierProblemReadAdapter implements ProblemDomainReadAdapter {
  readonly domainCode = 'supplier-quality';
  readonly sourceType = 'supplier-quality';

  visibilityPredicate(actor: WorkflowActor, organizationId: string): Prisma.Sql {
    if (actor.accountType !== 'INTERNAL') return Prisma.sql`FALSE`;
    return Prisma.sql`(
      ${featurePredicate(Prisma.sql`${actor.id}::uuid`, Prisma.sql`${organizationId}::uuid`, Prisma.sql`'supplier-quality:problems:read'`)}
      AND EXISTS (SELECT 1 FROM supplier_quality_problems supplier_problem
        WHERE supplier_problem.id = p.source_id
          AND supplier_problem.problem_index_id = p.id
          AND supplier_problem.owner_organization_id = p.organization_id)
    )`;
  }

  async authorizeRead(tx: Prisma.TransactionClient, context: ProblemDomainReadContext): Promise<void> {
    await this.record(tx, context);
  }

  async readSummaries(tx: Prisma.TransactionClient, actor: WorkflowActor, problems: readonly ProblemIndex[]): Promise<ReadonlyMap<string, ProblemDomainSummary>> {
    if (actor.accountType !== 'INTERNAL') workflowError('PROBLEM_NOT_FOUND', 404);
    for (const organizationId of new Set(problems.map((problem) => problem.organizationId))) {
      await assertWorkflowFeature(tx, actor, organizationId, 'supplier-quality:problems:read');
    }
    if (!problems.length) return new Map();
    const records = await tx.supplierQualityProblem.findMany({ where: { OR: problems.map((problem) => this.reference(problem)) }, include: { profile: { select: { displayName: true } } } });
    return new Map(records.map((record) => [record.problemIndexId!, this.summary(record)]));
  }

  async readWorkspace(tx: Prisma.TransactionClient, context: ProblemDomainReadContext, instance: WorkflowInstance | null): Promise<ProblemDomainWorkspace | null> {
    const record = await this.record(tx, context);
    if (instance && instance.id !== context.problem.workflowInstanceId) {
      if (context.purpose !== 'history') return null;
      const upgrade = await tx.workflowUpgrade.findFirst({ where: { organizationId: context.problem.organizationId, problemIndexId: context.problem.id,
        beforeInstanceId: instance.id }, select: { beforeDomainRevisionId: true, response: true } });
      const domainVersion = jsonObject(upgrade?.response).domainVersion;
      if (!upgrade || typeof domainVersion !== 'number' || !Number.isSafeInteger(domainVersion) || domainVersion < 2) return null;
      const revision = await tx.supplierResponseRevision.findFirst({ where: { id: upgrade.beforeDomainRevisionId, problemId: record.id,
        workflowInstanceId: instance.id } });
      if (!revision) return null;
      return { domainVersion: domainVersion - 1, revisionId: revision.id, summary: this.summary(record),
        sections: [this.responseSection('BRIEF', revision.content, true)] };
    }
    if (context.purpose !== 'overview') return null;
    const revision = instance ? await tx.supplierResponseRevision.findFirst({ where: { problemId: record.id, workflowInstanceId: instance.id },
      orderBy: { revision: 'desc' } }) : null;
    return {
      domainVersion: record.version, revisionId: revision?.id ?? null, summary: this.summary(record),
      sections: [{ key: 'supplierFacts', title: '供应商问题资料', fields: [
        { key: 'title', label: '问题标题', value: record.title },
        { key: 'supplierName', label: '责任供应商', value: record.profile.displayName },
        { key: 'materialCode', label: '物料编码', value: record.materialCode },
        { key: 'materialCategory', label: '来料分类', value: record.materialCategory === 'STRUCTURE' ? '结构件' : record.materialCategory === 'ELECTRONIC' ? '电子件' : null },
        { key: 'defectDescription', label: '缺陷描述', value: record.defectDescription },
        { key: 'defectQuantity', label: '不良数量', value: String(record.defectQuantity) },
        { key: 'severity', label: '严重度', value: ({ LOW: '低', MEDIUM: '中', HIGH: '高', CRITICAL: '严重' } as Record<string, string>)[record.severity] ?? record.severity },
        { key: 'responseForm', label: '回复形式', value: record.responseForm === 'BRIEF' ? '简报' : '8D' },
        { key: 'replyMode', label: '回复方', value: record.replyMode === 'INTERNAL' ? '指定内部人员' : '供应商企业' },
      ] }, ...(revision ? [this.responseSection(record.responseForm, revision.content, false)] : [])],
    };
  }

  async readReport(tx: Prisma.TransactionClient, context: ProblemDomainReadContext): Promise<null> {
    await this.record(tx, context);
    return null;
  }

  async listEvidenceReferences(tx: Prisma.TransactionClient, context: ProblemDomainReadContext, revisionId: string | null) {
    const record = await this.record(tx, context);
    const revision = revisionId
      ? await tx.supplierResponseRevision.findFirst({ where: { id: revisionId, problemId: record.id }, select: { id: true } })
      : context.problem.workflowInstanceId ? await tx.supplierResponseRevision.findFirst({ where: { problemId: record.id,
        workflowInstanceId: context.problem.workflowInstanceId }, orderBy: { revision: 'desc' }, select: { id: true } }) : null;
    if (!revision) return [];
    const references = await tx.supplierEvidenceReference.findMany({ where: { problemId: record.id, revisionId: revision.id }, select: { fileId: true } });
    return references.map((reference) => ({ fileId: reference.fileId, resourceType: this.domainCode, resourceId: record.id }));
  }

  async describeActions(tx: Prisma.TransactionClient, context: ProblemDomainReadContext) {
    await this.record(tx, context);
    return [];
  }

  private reference(problem: ProblemIndex) {
    if (problem.domainCode !== this.domainCode || problem.sourceType !== this.sourceType || !problem.sourceId) workflowError('PROBLEM_NOT_FOUND', 404);
    return { id: problem.sourceId, ownerOrganizationId: problem.organizationId, problemIndexId: problem.id };
  }

  private async record(tx: Prisma.TransactionClient, { actor, problem }: ProblemDomainReadContext): Promise<SupplierReadRecord> {
    if (actor.accountType !== 'INTERNAL') workflowError('PROBLEM_NOT_FOUND', 404);
    await assertWorkflowFeature(tx, actor, problem.organizationId, 'supplier-quality:problems:read');
    const record = await tx.supplierQualityProblem.findFirst({ where: this.reference(problem), include: { profile: { select: { displayName: true } } } });
    if (!record) workflowError('PROBLEM_NOT_FOUND', 404);
    return record;
  }

  private summary(record: SupplierReadRecord): ProblemDomainSummary {
    // The public summary is capped at 200 UTF-16 units; the full title remains in the facts section.
    const title = record.title.length <= 200 ? record.title : `${record.title.slice(0, 199).replace(/[\uD800-\uDBFF]$/, '')}…`;
    return { title, description: record.defectDescription, domainUiKey: this.domainCode };
  }

  private responseSection(form: string, content: Prisma.JsonValue, historical: boolean) {
    const fields = jsonObject(content);
    return { key: 'supplierResponse', title: historical ? '历史回复修订' : '当前回复修订', fields: [
      { key: 'responseForm', label: '回复形式', value: form === 'BRIEF' ? '简报' : '8D' },
      ...responseFields.map(([key, label]) => ({ key, label, value: typeof fields[key] === 'string' ? fields[key] as string : null })),
    ] };
  }
}
