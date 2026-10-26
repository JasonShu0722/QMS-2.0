import { Injectable, type OnModuleInit } from '@nestjs/common';
import type { Prisma, ProblemIndex, WorkflowInstance } from '../../generated/prisma/client.js';
import { DomainProblemReadAdapter } from '../problem-index/domain-problem-read.adapter.js';
import { ProblemDomainRegistry, type ProblemDomainReadAdapter, type ProblemDomainReadContext, type ProblemDomainSection, type ProblemDomainSummary } from '../problem-index/problem-domain-registry.js';
import type { WorkflowActor } from '../workflow/workflow-access-policy.js';
import { jsonObject } from '../workflow/workflow-runtime-policy.js';
import { documentFileIds, normalizeProcessEightDDocument } from './process-eight-d-document.js';
import { ProcessEightDService } from './process-eight-d.service.js';

@Injectable()
export class ProcessEightDReadAdapter implements ProblemDomainReadAdapter, OnModuleInit {
  readonly domainCode = 'process-quality';
  readonly sourceType = 'process-defect';
  readonly revisionResourceType = 'ProcessEightDRevision';
  private readonly legacy = new DomainProblemReadAdapter({ domainCode: this.domainCode, sourceType: this.sourceType, permission: 'process-quality:defects:read', label: '过程质量' });
  constructor(private readonly registry: ProblemDomainRegistry, private readonly service: ProcessEightDService) {}
  onModuleInit(): void { this.registry.registerOverride(this); }
  visibilityPredicate(actor: WorkflowActor, organizationId: string) { return this.service.visibilityPredicate(actor, organizationId, this.legacy.visibilityPredicate(actor, organizationId)); }

  async authorizeRead(tx: Prisma.TransactionClient, context: ProblemDomainReadContext) {
    if (!await this.eightD(tx, context.problem)) return this.legacy.authorizeRead(tx, context);
    const record = await this.service.lockRecord(tx, context.actor, context.problem.id, 'READ');
    await this.service.authorizeRead(tx, context.actor, record);
  }

  async readSummaries(tx: Prisma.TransactionClient, actor: WorkflowActor, problems: readonly ProblemIndex[]) {
    const map = new Map<string, ProblemDomainSummary>();
    for (const problem of problems) {
      if (!await this.eightD(tx, problem)) {
        const legacy = await this.legacy.readSummaries(tx, actor, [problem]);
        map.set(problem.id, legacy.get(problem.id)!);
      } else {
        const { record } = await this.service.readReport(tx, actor, problem.id);
        map.set(problem.id, this.summary(problem.reportNumber, record.report.document.description));
      }
    }
    return map;
  }

  async readWorkspace(tx: Prisma.TransactionClient, context: ProblemDomainReadContext, instance: WorkflowInstance | null) {
    if (!await this.eightD(tx, context.problem)) return this.legacy.readWorkspace(tx, context, instance);
    const { record } = await this.service.readReport(tx, context.actor, context.problem.id);
    return { domainVersion: record.report.version, revisionId: record.report.closedRevisionId,
      summary: this.summary(record.problem.reportNumber, record.report.document.description),
      sections: this.sections(record.report.document) };
  }

  async readReport(tx: Prisma.TransactionClient, context: ProblemDomainReadContext, instance: WorkflowInstance) {
    if (!await this.eightD(tx, context.problem)) return this.legacy.readReport(tx, context, instance);
    const { record, revision, snapshot } = await this.service.readReport(tx, context.actor, context.problem.id);
    const body = jsonObject(snapshot), problem = jsonObject(body.problem), workflow = jsonObject(body.instance);
    const document = normalizeProcessEightDDocument(body.document);
    return { revisionId: revision?.id ?? `problem:${record.problem.id}:v${record.report.version}`, instanceId: String(workflow.id), instanceVersion: Number(workflow.version),
      recordedAt: revision?.recordedAt.toISOString() ?? record.report.updatedAt.toISOString(),
      summary: this.summary(String(problem.reportNumber), document.description),
      snapshot: { problemType: String(problem.problemType), severity: String(problem.severity), status: String(problem.status),
        responsibleParty: problem.responsibleParty as string | null, ownerId: problem.ownerId as string | null, dueAt: problem.dueAt as string | null },
      sections: this.sections(document) };
  }

  async listRevisionIds(tx: Prisma.TransactionClient, context: ProblemDomainReadContext): Promise<readonly string[]> {
    if (!await this.eightD(tx, context.problem)) return [];
    const { record } = await this.service.readReport(tx, context.actor, context.problem.id);
    return (await this.service.revisions(tx, record)).map(r => r.id);
  }

  async listEvidenceReferences(tx: Prisma.TransactionClient, context: ProblemDomainReadContext, revisionId: string | null) {
    if (!await this.eightD(tx, context.problem)) return this.legacy.listEvidenceReferences(tx, context, revisionId);
    const { snapshot } = await this.service.readReport(tx, context.actor, context.problem.id, revisionId ?? undefined);
    const document = normalizeProcessEightDDocument(jsonObject(snapshot).document);
    return documentFileIds(document).map(fileId => ({ fileId, resourceType: 'process-eight-d', resourceId: context.problem.id }));
  }

  async describeActions(tx: Prisma.TransactionClient, context: ProblemDomainReadContext) {
    if (!await this.eightD(tx, context.problem)) return this.legacy.describeActions(tx, context);
    const record = await this.service.lockRecord(tx, context.actor, context.problem.id, 'READ');
    await this.service.authorizeRead(tx, context.actor, record);
    const allowed = await this.service.allowedActions(tx, context.actor, record);
    const labels: Record<string, string> = { read: '查看8D', save: '保存草稿', 'analysis-complete': '确认分析完成', submit: '完整提交', collaborators: '维护协作者', reassign: '转派', risk: '调整风险', sources: '调整来源', deadlines: '设置计划' };
    return Object.entries(labels).map(([actionKey, label]) => ({ actionKey: `process-eight-d:${actionKey}`, label, enabled: allowed.includes(actionKey), reasonCode: allowed.includes(actionKey) ? null : 'PROCESS_EIGHT_D_ACTION_UNAVAILABLE' }));
  }

  private eightD(tx: Prisma.TransactionClient, problem: ProblemIndex) { return this.service.hasReport(tx, problem.organizationId, problem.id); }
  private summary(reportNumber: string, description: string): ProblemDomainSummary { return { title: reportNumber, description, domainUiKey: 'process-eight-d' }; }
  private sections(document: ReturnType<typeof normalizeProcessEightDDocument>): ProblemDomainSection[] {
    const fields = (keys: (keyof typeof document)[]) => keys.map(key => ({ key, label: key, value: typeof document[key] === 'string' ? document[key] as string : JSON.stringify(document[key]) }));
    return [
      { key: 'D2', title: 'D2 问题描述', fields: fields(['description', 'okFileIds', 'ngFileIds']) },
      { key: 'D3', title: 'D3 临时措施与围堵', fields: fields(['temporaryMeasures', 'containment', 'optionalAffectedContainment']) },
      { key: 'D4', title: 'D4 原因分析', fields: fields(['analysisProcess', 'analysisFileIds', 'occurrenceCause', 'escapeCause', 'systemCause']) },
      { key: 'D5-D6', title: 'D5/D6 对策实施与有效性', fields: fields(['correctiveActions']) },
      { key: 'D7', title: 'D7 横向展开与标准化', fields: fields(['horizontalDeployment', 'standardization']) },
      { key: 'D8', title: 'D8 总结', fields: fields(['closureSummary']) },
    ];
  }
}
