import { Injectable } from '@nestjs/common';
import { Prisma, type ProblemIndex, type WorkflowInstance } from '../../generated/prisma/client.js';
import type { WorkflowActor } from '../workflow/workflow-access-policy.js';
import { assertWorkflowFeature, featurePredicate } from '../workflow/workflow-access-policy.js';
import { workflowError } from '../workflow/workflow-runtime-policy.js';
import type { ProblemDomainReadAdapter, ProblemDomainReadContext, ProblemDomainSummary, ProblemDomainWorkspace, ProblemDomainReport, ProblemEvidenceReference, ProblemDomainAction } from './problem-domain-registry.js';

export type DomainProblemReadDefinition = { domainCode: string; sourceType: string; permission: string; label: string };

@Injectable()
export class DomainProblemReadAdapter implements ProblemDomainReadAdapter {
  constructor(private readonly definition: DomainProblemReadDefinition) {}
  get domainCode() { return this.definition.domainCode; }
  get sourceType() { return this.definition.sourceType; }
  visibilityPredicate(actor: WorkflowActor, organizationId: string) {
    return featurePredicate(Prisma.sql`${actor.id}::uuid`, Prisma.sql`${organizationId}::uuid`, Prisma.sql`${this.definition.permission}`);
  }
  async authorizeRead(tx: Prisma.TransactionClient, context: ProblemDomainReadContext) {
    await assertWorkflowFeature(tx, context.actor, context.problem.organizationId, this.definition.permission);
  }
  async readSummaries(_tx: Prisma.TransactionClient, _actor: WorkflowActor, problems: readonly ProblemIndex[]) {
    return new Map(problems.map((problem) => [problem.id, this.summary(problem)]));
  }
  async readWorkspace(tx: Prisma.TransactionClient, context: ProblemDomainReadContext, _instance: WorkflowInstance | null): Promise<ProblemDomainWorkspace | null> {
    await this.authorizeRead(tx, context);
    return { domainVersion: context.problem.version, revisionId: null, summary: this.summary(context.problem), sections: [{ key: 'problemFacts', title: this.definition.label, fields: [
      { key: 'reportNumber', label: '问题编号', value: context.problem.reportNumber }, { key: 'problemType', label: '问题类型', value: context.problem.problemType },
      { key: 'severity', label: '严重度', value: context.problem.severity }, { key: 'status', label: '状态', value: context.problem.status },
    ] }] };
  }
  async readReport(tx: Prisma.TransactionClient, context: ProblemDomainReadContext, instance: WorkflowInstance): Promise<ProblemDomainReport | null> {
    const workspace = await this.readWorkspace(tx, context, instance);
    if (!workspace) return null;
    return { revisionId: `problem:${context.problem.id}:v${context.problem.version}`, instanceId: instance.id, instanceVersion: instance.version, recordedAt: context.problem.updatedAt.toISOString(),
      summary: workspace.summary, snapshot: { problemType: context.problem.problemType, severity: context.problem.severity, status: context.problem.status, responsibleParty: context.problem.responsibleParty, ownerId: context.problem.ownerId, dueAt: context.problem.dueAt?.toISOString() ?? null }, sections: workspace.sections };
  }
  async listEvidenceReferences(_tx: Prisma.TransactionClient, _context: ProblemDomainReadContext, _revisionId: string | null): Promise<readonly ProblemEvidenceReference[]> { return []; }
  async describeActions(_tx: Prisma.TransactionClient, _context: ProblemDomainReadContext): Promise<readonly ProblemDomainAction[]> { return []; }
  private summary(problem: ProblemIndex): ProblemDomainSummary { return { title: problem.reportNumber, description: `${this.definition.label} · ${problem.problemType}`, domainUiKey: this.definition.domainCode }; }
}

export function domainProblemReadDefinition(definition: DomainProblemReadDefinition): new () => DomainProblemReadAdapter {
  @Injectable()
  class ConfiguredDomainProblemReadAdapter extends DomainProblemReadAdapter { constructor() { super(definition); } }
  return ConfiguredDomainProblemReadAdapter;
}
