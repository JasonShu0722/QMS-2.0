import { Injectable, type OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Prisma, type ProblemIndex } from '../../generated/prisma/client.js';
import type { WorkflowActor } from '../workflow/workflow-access-policy.js';
import { assertWorkflowFeature } from '../workflow/workflow-access-policy.js';
import { WorkflowUpgradeRegistry, type WorkflowUpgradeContext, type WorkflowUpgradeDomainAdapter, type WorkflowUpgradePlan } from '../workflow/workflow-upgrade.registry.js';
import { jsonObject, workflowError } from '../workflow/workflow-runtime-policy.js';

type Row = Record<string, any>;

@Injectable()
export class NewProductQualityUpgradeAdapter implements WorkflowUpgradeDomainAdapter, OnModuleInit {
  readonly domainCode = 'new-product-quality';
  readonly sourceType = 'new-product-issue';

  constructor(private readonly registry: WorkflowUpgradeRegistry) {}

  onModuleInit(): void { this.registry.register(this); }

  async authorizeAndLock(tx: Prisma.TransactionClient, actor: WorkflowActor, problem: ProblemIndex, purpose: 'preview' | 'upgrade' | 'history'): Promise<void> {
    if (actor.accountType !== 'INTERNAL' || actor.organizationId !== problem.organizationId || !problem.sourceId) workflowError('WORKFLOW_UPGRADE_DOMAIN_DENIED', 403);
    const [issue] = await tx.$queryRaw<Row[]>(Prisma.sql`SELECT project_id FROM new_product_issues WHERE id = ${problem.sourceId}::uuid AND organization_id = ${problem.organizationId}::uuid AND problem_index_id = ${problem.id}::uuid`);
    if (!issue) workflowError('WORKFLOW_UPGRADE_DOMAIN_DENIED', 403);
    const [project] = await tx.$queryRaw<Row[]>(Prisma.sql`SELECT status FROM new_product_projects WHERE id = ${issue.project_id}::uuid AND organization_id = ${problem.organizationId}::uuid FOR UPDATE`);
    if (purpose !== 'history' && project?.status !== 'ACTIVE') workflowError('WORKFLOW_UPGRADE_NOT_ALLOWED', 409);
    await tx.$queryRaw`SELECT id FROM new_product_issues WHERE id = ${problem.sourceId}::uuid AND organization_id = ${problem.organizationId}::uuid AND problem_index_id = ${problem.id}::uuid FOR UPDATE`;
    const source = await tx.$queryRaw<Row[]>(Prisma.sql`SELECT id FROM new_product_issues WHERE id = ${problem.sourceId}::uuid AND organization_id = ${problem.organizationId}::uuid AND problem_index_id = ${problem.id}::uuid`);
    if (!source[0]) workflowError('WORKFLOW_UPGRADE_DOMAIN_DENIED', 403);
    await assertWorkflowFeature(tx, actor, problem.organizationId, 'new-product-quality:projects:write');
  }

  async prepare(tx: Prisma.TransactionClient, context: WorkflowUpgradeContext): Promise<WorkflowUpgradePlan> {
    const source = await this.source(tx, context);
    if (source.response_form !== 'BRIEF' || source.status !== 'OPEN' || context.problem.problemType !== 'NEW_PRODUCT_ISSUE' || context.node.type === 'CLOSE') workflowError('WORKFLOW_UPGRADE_NOT_ALLOWED', 409);
    const [revision] = await tx.$queryRaw<Row[]>(Prisma.sql`SELECT id, revision, workflow_instance_id FROM new_product_issue_revisions WHERE organization_id = ${context.problem.organizationId}::uuid AND issue_id = ${source.id}::uuid ORDER BY revision DESC, id DESC LIMIT 1`);
    if (!revision || revision.workflow_instance_id !== context.instance.id) workflowError('WORKFLOW_UPGRADE_NOT_ALLOWED', 409);
    const target = await this.target(tx, context.problem.organizationId);
    return {
      domainVersion: Number(source.version), targetDefinitionId: target.definitionId, targetVersionId: target.versionId,
      targetProblemType: 'NEW_PRODUCT_8D', allowedNodeIds: [context.node.id], mappingVersion: 'new-product-brief-eight-d-v1',
      beforeDomainRevisionId: revision.id, mappingSummary: [
        { fieldId: 'responseForm', outcome: 'COPIED' },
        { fieldId: 'complexity', outcome: 'COPIED' },
        { fieldId: 'status', outcome: 'COPIED' },
      ], evidenceFileIds: [],
    };
  }

  async apply(tx: Prisma.TransactionClient, context: WorkflowUpgradeContext, plan: WorkflowUpgradePlan,
    target: { instanceId: string; nodeId: string; expectedDomainVersion: number }) {
    const source = await this.source(tx, context);
    if (source.response_form !== 'BRIEF' || source.status !== 'OPEN' || Number(source.version) !== target.expectedDomainVersion) workflowError('CONCURRENCY_CONFLICT', 409);
    const [current] = await tx.$queryRaw<Row[]>(Prisma.sql`SELECT id, revision, workflow_instance_id FROM new_product_issue_revisions WHERE organization_id = ${context.problem.organizationId}::uuid AND issue_id = ${source.id}::uuid ORDER BY revision DESC, id DESC LIMIT 1`);
    if (!current || current.id !== plan.beforeDomainRevisionId || current.workflow_instance_id !== context.instance.id) workflowError('CONCURRENCY_CONFLICT', 409);
    const targetVersion = await tx.workflowVersion.findUnique({ where: { id: plan.targetVersionId }, select: { version: true, workflowDefinitionId: true, organizationId: true } });
    if (!targetVersion || targetVersion.organizationId !== context.problem.organizationId || targetVersion.workflowDefinitionId !== plan.targetDefinitionId) workflowError('CONCURRENCY_CONFLICT', 409);
    const changed = await tx.$executeRaw(Prisma.sql`UPDATE new_product_issues SET complexity = 'COMPLEX', response_form = 'EIGHT_D', status = 'ESCALATED', version = version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ${source.id}::uuid AND organization_id = ${context.problem.organizationId}::uuid AND version = ${target.expectedDomainVersion} AND response_form = 'BRIEF' AND status = 'OPEN'`);
    if (changed !== 1) workflowError('CONCURRENCY_CONFLICT', 409);
    const revisionId = randomUUID();
    await tx.$executeRaw(Prisma.sql`INSERT INTO new_product_issue_revisions(id, organization_id, issue_id, revision, response_form, workflow_instance_id, workflow_version_id, created_by_id) VALUES (${revisionId}::uuid, ${context.problem.organizationId}::uuid, ${source.id}::uuid, ${Number(current.revision) + 1}, 'EIGHT_D', ${target.instanceId}::uuid, ${plan.targetVersionId}::uuid, ${context.actor.id}::uuid)`);
    return { domainVersion: target.expectedDomainVersion + 1, beforeDomainRevisionId: current.id, afterDomainRevisionId: revisionId, mappingSummary: plan.mappingSummary, evidenceFileIds: [] };
  }

  private async source(tx: Prisma.TransactionClient, context: WorkflowUpgradeContext): Promise<Row> {
    if (!context.problem.sourceId) workflowError('WORKFLOW_UPGRADE_DOMAIN_DENIED', 403);
    const [source] = await tx.$queryRaw<Row[]>(Prisma.sql`SELECT * FROM new_product_issues WHERE id = ${context.problem.sourceId}::uuid AND organization_id = ${context.problem.organizationId}::uuid AND problem_index_id = ${context.problem.id}::uuid FOR UPDATE`);
    if (!source) workflowError('WORKFLOW_UPGRADE_DOMAIN_DENIED', 403);
    return source;
  }

  private async target(tx: Prisma.TransactionClient, organizationId: string) {
    const definition = await tx.workflowDefinition.findUnique({ where: { organizationId_code: { organizationId, code: 'NEW_PRODUCT_8D' } } });
    const version = definition ? await tx.workflowVersion.findFirst({ where: { organizationId, workflowDefinitionId: definition.id, status: 'PUBLISHED' }, orderBy: { version: 'desc' }, include: { nodes: true } }) : null;
    const closes = version?.nodes.filter((node) => node.type === 'CLOSE') ?? [];
    if (!definition || !version || !version.nodes.some((node) => node.type === 'VERIFICATION') || closes.length !== 1 || jsonObject(closes[0]!.config).requireIndependentVerification !== true) workflowError('WORKFLOW_UPGRADE_NOT_ALLOWED', 409);
    return { definitionId: definition.id, versionId: version.id };
  }
}
