import { Inject, Injectable } from '@nestjs/common';
import { Prisma, type ProblemIndex, type WorkflowInstance } from '../../generated/prisma/client.js';
import type { WorkflowActor } from '../workflow/workflow-access-policy.js';
import { workflowError } from '../workflow/workflow-runtime-policy.js';

export type ProblemReadPurpose = 'overview' | 'report' | 'history';
export interface ProblemDomainSummary { title: string; description: string; domainUiKey: string }
export interface ProblemDomainField { key: string; label: string; value: string | null }
export interface ProblemDomainSection { key: string; title: string; fields: ProblemDomainField[] }
export interface ProblemDomainAction { actionKey: string; label: string; enabled: boolean; reasonCode: string | null }
export interface ProblemEvidenceReference { fileId: string; resourceType: string; resourceId: string }
export interface ProblemDomainWorkspace { domainVersion: number; revisionId: string | null; summary: ProblemDomainSummary; sections: ProblemDomainSection[] }
export interface ProblemReportSnapshot {
  problemType: string | null; severity: string | null; status: string | null; responsibleParty: string | null; ownerId: string | null; dueAt: string | null;
}
export interface ProblemDomainReport {
  revisionId: string; instanceId: string; instanceVersion: number; recordedAt: string;
  summary: ProblemDomainSummary; snapshot: ProblemReportSnapshot; sections: ProblemDomainSection[];
}
export interface ProblemDomainReadContext { actor: WorkflowActor; problem: ProblemIndex; purpose: ProblemReadPurpose }
export interface ProblemDomainReadAdapter {
  readonly domainCode: string;
  readonly sourceType: string;
  readonly revisionResourceType?: string;
  listRevisionIds?(tx: Prisma.TransactionClient, context: ProblemDomainReadContext): Promise<readonly string[]>;
  visibilityPredicate(actor: WorkflowActor, organizationId: string): Prisma.Sql;
  authorizeRead(tx: Prisma.TransactionClient, context: ProblemDomainReadContext): Promise<void>;
  readSummaries(tx: Prisma.TransactionClient, actor: WorkflowActor, problems: readonly ProblemIndex[]): Promise<ReadonlyMap<string, ProblemDomainSummary>>;
  readWorkspace(tx: Prisma.TransactionClient, context: ProblemDomainReadContext, instance: WorkflowInstance | null): Promise<ProblemDomainWorkspace | null>;
  readReport(tx: Prisma.TransactionClient, context: ProblemDomainReadContext, instance: WorkflowInstance): Promise<ProblemDomainReport | null>;
  listEvidenceReferences(tx: Prisma.TransactionClient, context: ProblemDomainReadContext, revisionId: string | null): Promise<readonly ProblemEvidenceReference[]>;
  describeActions(tx: Prisma.TransactionClient, context: ProblemDomainReadContext): Promise<readonly ProblemDomainAction[]>;
}
export const PROBLEM_DOMAIN_READ_ADAPTERS = Symbol('PROBLEM_DOMAIN_READ_ADAPTERS');

@Injectable()
export class ProblemDomainRegistry {
  constructor(@Inject(PROBLEM_DOMAIN_READ_ADAPTERS) private readonly adapters: readonly ProblemDomainReadAdapter[]) {
    const keys = adapters.map((adapter) => `${adapter.domainCode}\0${adapter.sourceType}`);
    if (new Set(keys).size !== keys.length || adapters.some((adapter) => !adapter.domainCode || !adapter.sourceType)) throw new Error('PROBLEM_DOMAIN_REGISTRATION_INVALID');
    const reserved = new Set(['User', 'Session', 'Organization', 'Role', 'Permission', 'ProblemIndex', 'WorkflowInstance', 'WorkflowTask', 'WorkflowMutation', 'WorkflowVersion', 'WorkflowNode', 'WorkflowDefinition', 'WorkflowUpgrade', 'FileObject', 'Notification', 'OutboxEvent', 'AuditEvent']);
    for (const adapter of adapters) {
      if (!!adapter.revisionResourceType !== !!adapter.listRevisionIds || adapter.revisionResourceType && (!/^[A-Za-z][A-Za-z0-9._:-]{0,99}$/.test(adapter.revisionResourceType) || reserved.has(adapter.revisionResourceType))) throw new Error('PROBLEM_DOMAIN_REGISTRATION_INVALID');
    }
  }
  visibility(actor: WorkflowActor, organizationId: string): Prisma.Sql {
    const predicates = this.adapters.map((adapter) => Prisma.sql`(p.domain_code = ${adapter.domainCode} AND p.source_type = ${adapter.sourceType} AND p.source_id IS NOT NULL AND (${adapter.visibilityPredicate(actor, organizationId)}))`);
    return predicates.length ? Prisma.sql`(${Prisma.join(predicates, ' OR ')})` : Prisma.sql`FALSE`;
  }
  forProblem(problem: Pick<ProblemIndex, 'domainCode' | 'sourceType' | 'sourceId'>): ProblemDomainReadAdapter {
    const adapter = this.adapters.find((entry) => entry.domainCode === problem.domainCode && entry.sourceType === problem.sourceType);
    if (!problem.sourceId || !adapter) workflowError('PROBLEM_NOT_FOUND', 404);
    return adapter;
  }
}
