import { Injectable, type OnModuleInit } from '@nestjs/common';
import { Prisma, type ProblemIndex } from '../../generated/prisma/client.js';
import type { WorkflowActor } from '../workflow/workflow-access-policy.js';
import { assertWorkflowFeature } from '../workflow/workflow-access-policy.js';
import { WorkflowUpgradeRegistry, type WorkflowUpgradeContext, type WorkflowUpgradeDomainAdapter, type WorkflowUpgradePlan } from '../workflow/workflow-upgrade.registry.js';
import { jsonObject, workflowError } from '../workflow/workflow-runtime-policy.js';
import { mergeBriefContent } from './supplier-quality.rules.js';
import type { SupplierResponseContent } from './supplier-quality.types.js';
import { SupplierWorkflowBindingService } from './supplier-workflow-binding.service.js';

const contentFields = ['problemDescription', 'containmentAction', 'interimAction', 'rootCause', 'correctiveAction', 'preventiveAction', 'verificationResult', 'completionTime'] as const;

@Injectable()
export class SupplierQualityUpgradeAdapter implements WorkflowUpgradeDomainAdapter, OnModuleInit {
  readonly domainCode = 'supplier-quality';
  readonly sourceType = 'supplier-quality';

  constructor(private readonly registry: WorkflowUpgradeRegistry, private readonly bindings: SupplierWorkflowBindingService) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async authorizeAndLock(tx: Prisma.TransactionClient, actor: WorkflowActor, problem: ProblemIndex): Promise<void> {
    if (actor.accountType !== 'INTERNAL' || actor.organizationId !== problem.organizationId || !problem.sourceId) workflowError('WORKFLOW_UPGRADE_DOMAIN_DENIED', 403);
    await tx.$queryRaw`SELECT id FROM supplier_quality_problems WHERE id = ${problem.sourceId}::uuid AND owner_organization_id = ${problem.organizationId}::uuid FOR UPDATE`;
    const source = await tx.supplierQualityProblem.findFirst({ where: { id: problem.sourceId, problemIndexId: problem.id, ownerOrganizationId: problem.organizationId } });
    if (!source) workflowError('WORKFLOW_UPGRADE_DOMAIN_DENIED', 403);
    await assertWorkflowFeature(tx, actor, problem.organizationId, 'supplier-quality:problems:write');
  }

  async prepare(tx: Prisma.TransactionClient, context: WorkflowUpgradeContext): Promise<WorkflowUpgradePlan> {
    const source = await this.source(tx, context);
    if (source.responseForm !== 'BRIEF' || context.problem.problemType !== 'BRIEF' || (source.replyMode === 'SUPPLIER' && !source.releasedToSupplierAt)
      || context.node.type === 'CLOSE' || jsonObject(jsonObject(context.node.config).assignment).permission === 'supplier-quality:responses:write') workflowError('WORKFLOW_UPGRADE_NOT_ALLOWED', 409);
    const revision = await tx.supplierResponseRevision.findFirst({ where: { problemId: source.id }, orderBy: { revision: 'desc' }, include: { evidence: true } });
    if (!revision || revision.workflowInstanceId !== context.instance.id) workflowError('WORKFLOW_UPGRADE_NOT_ALLOWED', 409);
    const target = await this.bindings.resolve(tx, source.ownerOrganizationId, { severity: source.severity as 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL', responseForm: 'EIGHT_D', replyMode: source.replyMode as 'INTERNAL' | 'SUPPLIER' });
    const draft = await tx.supplierResponseDraft.findUnique({ where: { problemId: source.id } });
    const brief = revision.content as SupplierResponseContent;
    const existing = (draft?.content ?? {}) as SupplierResponseContent;
    const mappingSummary = contentFields.map((fieldId) => ({ fieldId, outcome: Object.prototype.hasOwnProperty.call(existing, fieldId) ? 'PRESERVED' as const
      : Object.prototype.hasOwnProperty.call(brief, fieldId) ? 'COPIED' as const : 'UNMAPPED' as const }));
    return { domainVersion: source.version, targetDefinitionId: target.workflowDefinitionId, targetVersionId: target.workflowVersionId,
      targetProblemType: 'EIGHT_D', allowedNodeIds: [context.node.id], mappingVersion: 'supplier-brief-eight-d-v1',
      beforeDomainRevisionId: revision.id, mappingSummary, evidenceFileIds: revision.evidence.map((item) => item.fileId).sort() };
  }

  async apply(tx: Prisma.TransactionClient, context: WorkflowUpgradeContext, plan: WorkflowUpgradePlan,
    target: { instanceId: string; nodeId: string; expectedDomainVersion: number }) {
    const source = await this.source(tx, context);
    if (source.responseForm !== 'BRIEF' || source.version !== target.expectedDomainVersion) workflowError('CONCURRENCY_CONFLICT', 409);
    const current = await tx.supplierResponseRevision.findFirst({ where: { problemId: source.id }, orderBy: { revision: 'desc' }, include: { evidence: true } });
    if (!current || current.id !== plan.beforeDomainRevisionId || current.workflowInstanceId !== context.instance.id) workflowError('CONCURRENCY_CONFLICT', 409);
    const binding = await this.bindings.resolve(tx, source.ownerOrganizationId, { severity: source.severity as 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL', responseForm: 'EIGHT_D', replyMode: source.replyMode as 'INTERNAL' | 'SUPPLIER' });
    if (binding.workflowVersionId !== plan.targetVersionId || binding.workflowDefinitionId !== plan.targetDefinitionId) workflowError('CONCURRENCY_CONFLICT', 409);
    const version = await tx.workflowVersion.findUniqueOrThrow({ where: { id: binding.workflowVersionId }, select: { version: true } });
    const draft = await tx.supplierResponseDraft.findUnique({ where: { problemId: source.id } });
    const merged = mergeBriefContent(current.content as SupplierResponseContent, (draft?.content ?? {}) as SupplierResponseContent);
    const expectedEvidence = [...plan.evidenceFileIds].sort();
    if (JSON.stringify(current.evidence.map((item) => item.fileId).sort()) !== JSON.stringify(expectedEvidence)) workflowError('CONCURRENCY_CONFLICT', 409);
    const changed = await tx.supplierQualityProblem.updateMany({ where: { id: source.id, version: target.expectedDomainVersion, responseForm: 'BRIEF' },
      data: { version: { increment: 1 }, responseForm: 'EIGHT_D', workflowBindingId: binding.bindingId, workflowBindingVersion: binding.bindingVersion } });
    if (changed.count !== 1) workflowError('CONCURRENCY_CONFLICT', 409);
    const revision = await tx.supplierResponseRevision.create({ data: { problemId: source.id, revision: current.revision + 1,
      content: merged as Prisma.InputJsonValue, submittedById: context.actor.id, workflowInstanceId: target.instanceId, workflowVersion: version.version } });
    if (current.evidence.length) await tx.supplierEvidenceReference.createMany({ data: current.evidence.map((item) => ({ problemId: source.id, fileId: item.fileId, revisionId: revision.id, purpose: item.purpose })) });
    await tx.supplierResponseDraft.upsert({ where: { problemId: source.id },
      create: { problemId: source.id, content: merged as Prisma.InputJsonValue, updatedById: context.actor.id },
      update: { content: merged as Prisma.InputJsonValue, updatedById: context.actor.id } });
    return { domainVersion: source.version + 1, beforeDomainRevisionId: current.id, afterDomainRevisionId: revision.id,
      mappingSummary: plan.mappingSummary, evidenceFileIds: expectedEvidence };
  }

  private async source(tx: Prisma.TransactionClient, context: WorkflowUpgradeContext) {
    if (!context.problem.sourceId) workflowError('WORKFLOW_UPGRADE_DOMAIN_DENIED', 403);
    const source = await tx.supplierQualityProblem.findFirst({ where: { id: context.problem.sourceId, problemIndexId: context.problem.id, ownerOrganizationId: context.problem.organizationId } });
    if (!source) workflowError('WORKFLOW_UPGRADE_DOMAIN_DENIED', 403);
    return source;
  }
}
