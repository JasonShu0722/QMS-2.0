import { Injectable, type OnModuleInit } from '@nestjs/common';
import { Prisma, type ProblemIndex, type WorkflowInstance } from '../../generated/prisma/client.js';
import type { DomainSourceResponseForm } from '../problem-index/domain-source-issue.service.js';
import { DomainProblemReadAdapter } from '../problem-index/domain-problem-read.adapter.js';
import { ProblemDomainRegistry, type ProblemDomainReadAdapter, type ProblemDomainReadContext, type ProblemDomainSummary } from '../problem-index/problem-domain-registry.js';
import { internalEightDSections } from '../../common/eight-d/internal-eight-d-sections.js';
export { internalEightDSections } from '../../common/eight-d/internal-eight-d-sections.js';
import type { WorkflowActor } from '../workflow/workflow-access-policy.js';
import { jsonObject } from '../workflow/workflow-runtime-policy.js';
import { documentFileIds, normalizeProcessEightDDocument } from './process-eight-d-document.js';
import { ProcessEightDService } from './process-eight-d.service.js';
import { readProcessEightDFollowupSummaries } from './process-eight-d-followup.read-model.js';
import type { ProcessEightDRecord } from './process-eight-d.types.js';

@Injectable()
export class ProcessEightDReadAdapter implements ProblemDomainReadAdapter, OnModuleInit {
  readonly domainCode = 'process-quality';
  readonly sourceType = 'process-defect';
  readonly revisionResourceType = 'ProcessEightDRevision';
  private readonly legacy = new DomainProblemReadAdapter({ domainCode: this.domainCode, sourceType: this.sourceType, permission: 'process-quality:defects:read', label: '过程质量' });
  constructor(private readonly registry: ProblemDomainRegistry, private readonly service: ProcessEightDService) {}
  onModuleInit(): void { this.registry.registerOverride(this); }
  visibilityPredicate(actor: WorkflowActor, organizationId: string) { return this.service.visibilityPredicate(actor, organizationId, this.legacy.visibilityPredicate(actor, organizationId)); }
  responseFormPredicate(form: DomainSourceResponseForm): Prisma.Sql {
    const exists = Prisma.sql`EXISTS (SELECT 1 FROM process_eight_d_reports eight_d WHERE eight_d.organization_id = p.organization_id AND eight_d.problem_id = p.id)`;
    return form === 'EIGHT_D' ? exists : Prisma.sql`NOT ${exists}`;
  }

  async authorizeRead(tx: Prisma.TransactionClient, context: ProblemDomainReadContext) {
    if (!await this.eightD(tx, context.problem)) return this.legacy.authorizeRead(tx, context);
    const record = await this.service.lockRecord(tx, this.readActor(context.actor, context.problem), context.problem.id, 'READ');
    await this.service.authorizeRead(tx, context.actor, record);
  }

  async readSummaries(tx: Prisma.TransactionClient, actor: WorkflowActor, problems: readonly ProblemIndex[]) {
    const map = new Map<string, ProblemDomainSummary>();
    const records: ProcessEightDRecord[] = [];
    for (const problem of problems) {
      if (!await this.eightD(tx, problem)) {
        const legacy = await this.legacy.readSummaries(tx, actor, [problem]);
        map.set(problem.id, legacy.get(problem.id)!);
      } else {
        const record = await this.service.lockRecord(tx, this.readActor(actor, problem), problem.id, 'READ');
        await this.service.authorizeRead(tx, actor, record);
        records.push(record);
      }
    }
    for (const [id, summary] of await readProcessEightDFollowupSummaries(tx, records)) map.set(id, summary);
    return map;
  }

  async readWorkspace(tx: Prisma.TransactionClient, context: ProblemDomainReadContext, instance: WorkflowInstance | null) {
    if (!await this.eightD(tx, context.problem)) return this.legacy.readWorkspace(tx, context, instance);
    const { record } = await this.service.readReport(tx, this.readActor(context.actor, context.problem), context.problem.id);
    return { domainVersion: record.report.version, revisionId: record.report.closedRevisionId,
      summary: this.summary(record.problem.reportNumber, record.report.document.description),
      sections: internalEightDSections(record.report.document) };
  }

  async readReport(tx: Prisma.TransactionClient, context: ProblemDomainReadContext, instance: WorkflowInstance) {
    if (!await this.eightD(tx, context.problem)) return this.legacy.readReport(tx, context, instance);
    const { record, revision, snapshot } = await this.service.readReport(tx, this.readActor(context.actor, context.problem), context.problem.id);
    const body = jsonObject(snapshot), problem = jsonObject(body.problem), workflow = jsonObject(body.instance);
    const document = normalizeProcessEightDDocument(body.document);
    return { revisionId: revision?.id ?? `problem:${record.problem.id}:v${record.report.version}`, instanceId: String(workflow.id), instanceVersion: Number(workflow.version),
      recordedAt: revision?.recordedAt.toISOString() ?? record.report.updatedAt.toISOString(),
      summary: this.summary(String(problem.reportNumber), document.description),
      snapshot: { problemType: String(problem.problemType), severity: String(problem.severity), status: String(problem.status),
        responsibleParty: problem.responsibleParty as string | null, ownerId: problem.ownerId as string | null, dueAt: problem.dueAt as string | null },
      sections: internalEightDSections(document) };
  }

  async listRevisionIds(tx: Prisma.TransactionClient, context: ProblemDomainReadContext): Promise<readonly string[]> {
    if (!await this.eightD(tx, context.problem)) return [];
    const { record } = await this.service.readReport(tx, this.readActor(context.actor, context.problem), context.problem.id);
    return (await this.service.revisions(tx, record)).map(r => r.id);
  }

  async listEvidenceReferences(tx: Prisma.TransactionClient, context: ProblemDomainReadContext, revisionId: string | null) {
    if (!await this.eightD(tx, context.problem)) return this.legacy.listEvidenceReferences(tx, context, revisionId);
    const { snapshot } = await this.service.readReport(tx, this.readActor(context.actor, context.problem), context.problem.id, revisionId ?? undefined);
    const document = normalizeProcessEightDDocument(jsonObject(snapshot).document);
    return documentFileIds(document).map(fileId => ({ fileId, resourceType: 'process-eight-d', resourceId: context.problem.id }));
  }

  async describeActions(tx: Prisma.TransactionClient, context: ProblemDomainReadContext) {
    if (!await this.eightD(tx, context.problem)) return this.legacy.describeActions(tx, context);
    const record = await this.service.lockRecord(tx, this.readActor(context.actor, context.problem), context.problem.id, 'READ');
    await this.service.authorizeRead(tx, context.actor, record);
    const allowed = await this.service.allowedActions(tx, context.actor, record);
    const labels: Record<string, string> = { read: '查看8D', save: '保存草稿', 'analysis-complete': '确认分析完成', submit: '完整提交', collaborators: '维护协作者', reassign: '转派', risk: '调整风险', sources: '调整来源', deadlines: '设置计划' };
    return Object.entries(labels).map(([actionKey, label]) => ({ actionKey: `process-eight-d:${actionKey}`, label, enabled: allowed.includes(actionKey), reasonCode: allowed.includes(actionKey) ? null : 'PROCESS_EIGHT_D_ACTION_UNAVAILABLE' }));
  }

  private readActor(actor: WorkflowActor, problem: ProblemIndex) { return actor.organizationId === problem.organizationId ? actor : { ...actor, scopeOrganizationId: problem.organizationId }; }
  private eightD(tx: Prisma.TransactionClient, problem: ProblemIndex) { return this.service.hasReport(tx, problem.organizationId, problem.id); }
  private summary(reportNumber: string, description: string): ProblemDomainSummary { return { title: reportNumber, description, domainUiKey: 'process-eight-d' }; }
}
