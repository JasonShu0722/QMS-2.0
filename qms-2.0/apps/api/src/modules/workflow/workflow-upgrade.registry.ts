import { Inject, Injectable } from '@nestjs/common';
import type { Prisma, ProblemIndex, WorkflowInstance, WorkflowNode } from '../../generated/prisma/client.js';
import type { WorkflowActor } from './workflow-access-policy.js';
import { workflowError } from './workflow-runtime-policy.js';

export interface WorkflowMappingOutcome { fieldId: string; outcome: 'COPIED' | 'PRESERVED' | 'UNMAPPED' }
export interface WorkflowUpgradeContext { actor: WorkflowActor; problem: ProblemIndex; instance: WorkflowInstance; node: WorkflowNode }
export interface WorkflowUpgradePlan {
  domainVersion: number;
  targetDefinitionId: string;
  targetVersionId: string;
  targetProblemType: string;
  allowedNodeIds: readonly string[];
  mappingVersion: string;
  beforeDomainRevisionId: string;
  mappingSummary: WorkflowMappingOutcome[];
  evidenceFileIds: readonly string[];
}
export interface WorkflowUpgradeRevision {
  domainVersion: number;
  beforeDomainRevisionId: string;
  afterDomainRevisionId: string;
  mappingSummary: WorkflowMappingOutcome[];
  evidenceFileIds: readonly string[];
}
export interface WorkflowUpgradeDomainAdapter {
  readonly domainCode: string;
  readonly sourceType: string;
  authorizeAndLock(tx: Prisma.TransactionClient, actor: WorkflowActor, problem: ProblemIndex, purpose: 'preview' | 'upgrade' | 'history'): Promise<void>;
  prepare(tx: Prisma.TransactionClient, context: WorkflowUpgradeContext): Promise<WorkflowUpgradePlan>;
  apply(tx: Prisma.TransactionClient, context: WorkflowUpgradeContext, plan: WorkflowUpgradePlan,
    target: { instanceId: string; nodeId: string; expectedDomainVersion: number }): Promise<WorkflowUpgradeRevision>;
}
export const WORKFLOW_UPGRADE_ADAPTERS = Symbol('WORKFLOW_UPGRADE_ADAPTERS');

@Injectable()
export class WorkflowUpgradeRegistry {
  private readonly adapters: WorkflowUpgradeDomainAdapter[];

  constructor(@Inject(WORKFLOW_UPGRADE_ADAPTERS) adapters: readonly WorkflowUpgradeDomainAdapter[]) {
    this.adapters = [];
    adapters.forEach((adapter) => this.register(adapter));
  }

  register(adapter: WorkflowUpgradeDomainAdapter): void {
    if (this.adapters.some((candidate) => candidate.domainCode === adapter.domainCode && candidate.sourceType === adapter.sourceType)) {
      throw new Error('WORKFLOW_UPGRADE_ADAPTER_DUPLICATE');
    }
    this.adapters.push(adapter);
  }

  forProblem(problem: ProblemIndex): WorkflowUpgradeDomainAdapter {
    const adapter = this.adapters.find((candidate) => candidate.domainCode === problem.domainCode && candidate.sourceType === problem.sourceType);
    if (!problem.sourceId || !adapter) workflowError('WORKFLOW_UPGRADE_DOMAIN_DENIED', 403);
    return adapter;
  }
}
