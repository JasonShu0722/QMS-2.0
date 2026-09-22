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
  constructor(@Inject(WORKFLOW_UPGRADE_ADAPTERS) private readonly adapters: readonly WorkflowUpgradeDomainAdapter[]) {
    const keys = adapters.map((adapter) => `${adapter.domainCode}\0${adapter.sourceType}`);
    if (new Set(keys).size !== keys.length) throw new Error('WORKFLOW_UPGRADE_ADAPTER_DUPLICATE');
  }

  forProblem(problem: ProblemIndex): WorkflowUpgradeDomainAdapter {
    const adapter = this.adapters.find((candidate) => candidate.domainCode === problem.domainCode && candidate.sourceType === problem.sourceType);
    if (!problem.sourceId || !adapter) workflowError('WORKFLOW_UPGRADE_DOMAIN_DENIED', 403);
    return adapter;
  }
}
