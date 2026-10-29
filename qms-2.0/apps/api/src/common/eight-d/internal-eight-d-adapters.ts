import type { OnModuleInit } from '@nestjs/common';
import { isUUID } from 'class-validator';
import { Prisma, type ProblemIndex, type WorkflowInstance } from '../../generated/prisma/client.js';
import type { FileActor, FileResourceAccess, FileResourceAccessAdapter, FileResourceAction, FileResourceRef } from '../../modules/file-management/file-resource-access.js';
import { DomainProblemReadAdapter } from '../../modules/problem-index/domain-problem-read.adapter.js';
import type { DomainSourceResponseForm } from '../../modules/problem-index/domain-source-issue.service.js';
import type { ProblemDomainRegistry, ProblemDomainReadAdapter, ProblemDomainReadContext, ProblemDomainSummary } from '../../modules/problem-index/problem-domain-registry.js';
import { documentFileIds, normalizeProcessEightDDocument } from '../../modules/process-quality/process-eight-d-document.js';
import { readProcessEightDFollowupSummaries } from '../../modules/process-quality/process-eight-d-followup.read-model.js';
import type { ProcessEightDService } from '../../modules/process-quality/process-eight-d.service.js';
import type { ProcessEightDRecord } from '../../modules/process-quality/process-eight-d.types.js';
import { assertWorkflowFeature, type WorkflowActor } from '../../modules/workflow/workflow-access-policy.js';
import type { WorkflowClosureRegistry } from '../../modules/workflow/workflow-closure-registry.js';
import type { WorkflowClosureAdapter, WorkflowClosureContext, WorkflowClosureOperation } from '../../modules/workflow/workflow-closure-round.types.js';
import type { WorkflowDeadlineOperation, WorkflowDeadlineStage } from '../../modules/workflow/workflow-deadline-extension.types.js';
import type { WorkflowAdministrativeInvalidationInput } from '../../modules/workflow/workflow-administrative-invalidation.types.js';
import { jsonObject, workflowError } from '../../modules/workflow/workflow-runtime-policy.js';
import { assertInternalEightDDomain, INTERNAL_EIGHT_D_DOMAINS, internalEightDSql, type InternalEightDDomainDescriptor } from './internal-eight-d-domain.js';
import { internalEightDSections } from './internal-eight-d-sections.js';

function assertCoreDomain(service: ProcessEightDService, domain: InternalEightDDomainDescriptor): void {
  assertInternalEightDDomain(domain);
  if (service.domain !== domain) throw new Error('INTERNAL_EIGHT_D_DOMAIN_MISMATCH');
}

export class InternalEightDClosureAdapter implements WorkflowClosureAdapter, OnModuleInit {
  get domainCode() { return this.domain.domainCode; }
  constructor(private readonly registry: WorkflowClosureRegistry, private readonly service: ProcessEightDService, private readonly domain: InternalEightDDomainDescriptor) {
    assertCoreDomain(service, domain);
  }
  onModuleInit(): void { this.registry.register(this); }
  lockAndRead(tx: Prisma.TransactionClient, actor: WorkflowActor, problemId: string, operation: WorkflowClosureOperation) {
    return this.service.closureContext(tx, actor, problemId, operation);
  }
  complete(tx: Prisma.TransactionClient, context: WorkflowClosureContext, actor: WorkflowActor) { return this.service.complete(tx, context, actor); }
  returnForChanges(tx: Prisma.TransactionClient, context: WorkflowClosureContext, actor: WorkflowActor) { return this.service.returnForChanges(tx, context, actor); }
  canNotifyRecipient(tx: Prisma.TransactionClient, context: WorkflowClosureContext, userId: string) { return this.service.canNotifyClosureRecipient(tx, context, userId); }
  administrativeInvalidation(tx: Prisma.TransactionClient, input: WorkflowAdministrativeInvalidationInput) { return this.service.administrativeInvalidation(tx, input); }

  async deadlineContext(tx: Prisma.TransactionClient, context: WorkflowClosureContext, actor: WorkflowActor, operation: WorkflowDeadlineOperation) {
    const record = await this.service.lockRecord(tx, actor, context.problemId, operation === 'READ' || operation === 'ELIGIBILITY' ? 'READ' : 'DEADLINE');
    await this.service.authorizeRead(tx, actor, record);
    if (record.problem.organizationId !== context.organizationId || record.instance.id !== context.instanceId || record.instance.workflowVersionId !== context.workflowVersionId) workflowError('CONCURRENCY_CONFLICT', 409);
    if (operation === 'REQUEST') await this.service.authorizeDeadlineRequest(tx, actor, record);
    if (operation === 'DECIDE' || operation === 'ELIGIBILITY') await assertWorkflowFeature(tx, actor, context.organizationId, 'workflow:act');
    return this.service.deadlineContext(tx, record);
  }

  async applyDeadlineExtension(tx: Prisma.TransactionClient, context: WorkflowClosureContext, stage: WorkflowDeadlineStage, dueAt: Date) {
    const deadline = await this.service.notificationContext(tx, context.organizationId, context.problemId);
    if (!deadline || deadline.instanceId !== context.instanceId || deadline.workflowVersionId !== context.workflowVersionId
      || deadline.ownerUserId !== context.ownerUserId || deadline.professionalUserId !== context.professionalUserId
      || deadline.responsibleSectionDepartmentId !== context.responsibleSectionDepartmentId) workflowError('CONCURRENCY_CONFLICT', 409);
    // Trusted engine hook inside its transaction; never synthesize an acting user.
    await this.service.applyApprovedDeadlineExtension(tx, deadline, stage, dueAt);
  }
}

export class InternalEightDFileAdapter implements FileResourceAccessAdapter, OnModuleInit {
  get resourceType() { return this.domain.resourceType; }
  constructor(private readonly resources: FileResourceAccess, private readonly service: ProcessEightDService, private readonly domain: InternalEightDDomainDescriptor) {
    assertCoreDomain(service, domain);
  }
  onModuleInit(): void { this.resources.register(this); }
  async authorizeAndLock(tx: Prisma.TransactionClient, actor: FileActor, resource: FileResourceRef, action: FileResourceAction) {
    if (resource.resourceType !== this.resourceType || !isUUID(resource.resourceId)) workflowError('FILE_RESOURCE_DENIED', 403);
    const reader = action === 'read' ? { ...actor, scopeOrganizationId: await this.service.readResourceOrganizationId(tx, resource.resourceId) } : actor;
    const record = await this.service.lockRecord(tx, reader, resource.resourceId, action === 'read' ? 'READ' : 'EDIT');
    if (action === 'read') await this.service.authorizeRead(tx, reader, record);
    else await this.service.authorizeEdit(tx, actor, record);
    return { organizationId: record.problem.organizationId, version: record.report.version };
  }
}

export class InternalEightDReadAdapter implements ProblemDomainReadAdapter, OnModuleInit {
  get domainCode() { return this.domain.domainCode; }
  get sourceType() { return this.domain.sourceType; }
  get revisionResourceType() { return this.domain.revisionType; }
  private readonly legacy: DomainProblemReadAdapter;
  constructor(private readonly registry: ProblemDomainRegistry, private readonly service: ProcessEightDService, private readonly domain: InternalEightDDomainDescriptor) {
    assertCoreDomain(service, domain);
    const label = domain === INTERNAL_EIGHT_D_DOMAINS.PROCESS ? '过程质量' : domain === INTERNAL_EIGHT_D_DOMAINS.CUSTOMER ? '客户质量问题' : '新品质量问题';
    // Selection fallback exposes only controlled source facts, never legacy new_product_issues content.
    this.legacy = new DomainProblemReadAdapter({ domainCode: domain.domainCode, sourceType: domain.sourceType, permission: domain.sourceReadPermission, label });
  }
  onModuleInit(): void { this.registry.registerOverride(this); }
  visibilityPredicate(actor: WorkflowActor, organizationId: string) { return this.service.visibilityPredicate(actor, organizationId, this.legacy.visibilityPredicate(actor, organizationId)); }
  responseFormPredicate(form: DomainSourceResponseForm): Prisma.Sql {
    const exists = Prisma.sql`EXISTS (SELECT 1 FROM ${internalEightDSql(this.domain).reports} eight_d WHERE eight_d.organization_id = p.organization_id AND eight_d.problem_id = p.id)`;
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
    for (const [id, summary] of await readProcessEightDFollowupSummaries(tx, records, this.domain)) map.set(id, summary);
    return map;
  }

  async readWorkspace(tx: Prisma.TransactionClient, context: ProblemDomainReadContext, instance: WorkflowInstance | null) {
    if (!await this.eightD(tx, context.problem)) return this.legacy.readWorkspace(tx, context, instance);
    const { record } = await this.service.readReport(tx, this.readActor(context.actor, context.problem), context.problem.id);
    return { domainVersion: record.report.version, revisionId: record.report.closedRevisionId,
      summary: this.summary(record.problem.reportNumber, record.report.document.description), sections: internalEightDSections(record.report.document) };
  }

  async readReport(tx: Prisma.TransactionClient, context: ProblemDomainReadContext, instance: WorkflowInstance) {
    if (!await this.eightD(tx, context.problem)) {
      const report = await this.legacy.readReport(tx, context, instance);
      return report && isUUID(report.revisionId) ? report : null;
    }
    const { revision, snapshot } = await this.service.readReport(tx, this.readActor(context.actor, context.problem), context.problem.id);
    if (!revision) return null;
    const body = jsonObject(snapshot), problem = jsonObject(body.problem), workflow = jsonObject(body.instance);
    const document = normalizeProcessEightDDocument(body.document);
    return { revisionId: revision.id, instanceId: String(workflow.id), instanceVersion: Number(workflow.version),
      recordedAt: revision.recordedAt.toISOString(), summary: this.summary(String(problem.reportNumber), document.description),
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
    return documentFileIds(document).map(fileId => ({ fileId, resourceType: this.domain.resourceType, resourceId: context.problem.id }));
  }

  async describeActions(tx: Prisma.TransactionClient, context: ProblemDomainReadContext) {
    if (!await this.eightD(tx, context.problem)) return this.legacy.describeActions(tx, context);
    const record = await this.service.lockRecord(tx, this.readActor(context.actor, context.problem), context.problem.id, 'READ');
    await this.service.authorizeRead(tx, context.actor, record);
    const allowed = await this.service.allowedActions(tx, context.actor, record);
    const labels: Record<string, string> = { read: '查看8D', save: '保存草稿', 'analysis-complete': '确认分析完成', submit: '完整提交', collaborators: '维护协作者', reassign: '转派', risk: '调整风险', sources: '调整来源', deadlines: '设置计划' };
    return Object.entries(labels).map(([actionKey, label]) => ({ actionKey: `${this.domain.resourceType}:${actionKey}`, label, enabled: allowed.includes(actionKey),
      reasonCode: allowed.includes(actionKey) ? null : `${this.domain.storagePrefix.toUpperCase()}_ACTION_UNAVAILABLE` }));
  }

  private readActor(actor: WorkflowActor, problem: ProblemIndex) { return actor.organizationId === problem.organizationId ? actor : { ...actor, scopeOrganizationId: problem.organizationId }; }
  private eightD(tx: Prisma.TransactionClient, problem: ProblemIndex) { return this.service.hasReport(tx, problem.organizationId, problem.id); }
  private summary(reportNumber: string, description: string): ProblemDomainSummary { return { title: reportNumber, description, domainUiKey: this.domain.resourceType }; }
}
