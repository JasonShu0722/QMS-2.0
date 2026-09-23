import { HttpException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';
import type { Prisma, ProblemIndex, WorkflowInstance, WorkflowNode } from '../../generated/prisma/client.js';
import { AdminMutationService, adminError, assertAdminAccess, type AdminActor, type AdminTransaction } from '../../common/security/admin-mutation.service.js';
import { AuditLogService } from '../audit-log/audit-log.service.js';
import { OrganizationService } from '../organization/organization.service.js';
import { IdentityService } from '../identity/identity.service.js';
import { ProblemIndexService } from '../problem-index/problem-index.service.js';
import { WorkflowRuntimeService } from '../workflow/workflow-runtime.service.js';
import { assertActiveAuthentication } from '../../common/security/session-security.js';
import { SupplierWorkflowBindingService } from './supplier-workflow-binding.service.js';
import { SupplierWorkflowAccess } from './supplier-workflow-access.js';
import { FileLifecycleService } from '../file-management/file-lifecycle.service.js';
import { assertWorkflowFeature, canProcessWorkflowNode } from '../workflow/workflow-access-policy.js';
import { workflowCapabilities } from '../workflow/workflow-capabilities.js';
import { actionAllowed, matchesCondition } from '../workflow/workflow-runtime-policy.js';
import type { WorkflowAction } from '../workflow/workflow.types.js';
import type { WorkflowActionInput } from '../workflow/workflow-runtime.service.js';
import { assertInternalClosure, assertReplyActor, validateProblemFacts, validateResponseContent } from './supplier-quality.rules.js';
import { SupplierRuleError } from './supplier-quality.types.js';
import type { CreateSupplierProfileDto, IssueSupplierProblemDto, SaveSupplierResponseDraftDto, SubmitSupplierResponseDto, SupplierDirectoryQueryDto, SupplierProblemDetailQueryDto, SupplierProblemDto, SupplierProblemDraftDto, SupplierProblemQueryDto, SupplierProfileDto, SupplierReferenceQueryDto, SupplierResponseRevisionDto, SupplierScopeQueryDto, SupplierWorkflowActionDto, UpdateSupplierProblemDraftDto, UpdateSupplierProfileDto } from './supplier-quality.dto.js';
import { canonical, jsonObject } from '../workflow/workflow-runtime-policy.js';

const problemInclude = { profile: true, responseDraft: true } as const;
type ProblemRecord = Prisma.SupplierQualityProblemGetPayload<{ include: typeof problemInclude }>;

@Injectable()
export class SupplierQualityService {
  constructor(
    private readonly prisma: PrismaService, private readonly mutations: AdminMutationService,
    private readonly audit: AuditLogService, private readonly organizations: OrganizationService,
    private readonly identities: IdentityService, private readonly indexes: ProblemIndexService,
    private readonly runtime: WorkflowRuntimeService, private readonly bindings: SupplierWorkflowBindingService, private readonly workflowAccess: SupplierWorkflowAccess, private readonly files: FileLifecycleService,
  ) {}

  private scope(actor: AdminActor) { return actor.scopeOrganizationId ?? actor.organizationId; }

  private internal(actor: AdminActor) {
    if (actor.accountType !== 'INTERNAL') adminError('ORGANIZATION_SCOPE_DENIED', 403);
  }

  private portal(actor: AdminActor) {
    if (actor.accountType !== 'SUPPLIER') adminError('ORGANIZATION_SCOPE_DENIED', 403);
  }

  async profiles(actor: AdminActor, query: SupplierScopeQueryDto) {
    this.internal(actor);
    return this.prisma.$transaction(async (transaction) => {
      const granted = await assertAdminAccess(transaction, actor, this.scope(actor), 'supplier-quality:profiles:read');
      const where = { ownerOrganizationId: this.scope(actor), ...(query.search ? { OR: [{ displayName: { contains: query.search, mode: 'insensitive' as const } }, { businessCode: { contains: query.search, mode: 'insensitive' as const } }] } : {}) };
      const [records, total] = await Promise.all([
        transaction.supplierBusinessProfile.findMany({ where, orderBy: { businessCode: 'asc' }, skip: (query.page - 1) * query.pageSize, take: query.pageSize }),
        transaction.supplierBusinessProfile.count({ where }),
      ]);
      return { items: records.map((profile) => this.serializeProfile(profile)), total, canManage: granted.includes('supplier-quality:profiles:write') };
    });
  }

  async profile(actor: AdminActor, id: string) {
    this.internal(actor);
    return this.prisma.$transaction(async (transaction) => {
      await assertAdminAccess(transaction, actor, this.scope(actor), 'supplier-quality:profiles:read');
      return this.serializeProfile(await this.findProfile(transaction, actor, id));
    });
  }

  updateProfile(actor: AdminActor, id: string, dto: UpdateSupplierProfileDto, traceId: string, key?: string) {
    this.internal(actor);
    return this.mutations.run({ actor, organizationId: this.scope(actor), key, traceId, action: 'SUPPLIER_PROFILE_UPDATED', payload: { id, dto }, permission: 'supplier-quality:profiles:write', duplicateCode: 'SUPPLIER_PROFILE_DUPLICATE' }, async (transaction) => {
      if (!dto.businessCode.trim()) adminError('SUPPLIER_INPUT_INVALID', 400);
      const updated = await transaction.supplierBusinessProfile.updateMany({ where: { id, ownerOrganizationId: this.scope(actor), version: dto.expectedVersion }, data: { businessCode: dto.businessCode.trim(), contactName: dto.contactName?.trim() || null, contactEmail: dto.contactEmail?.trim() || null, version: { increment: 1 } } });
      if (updated.count !== 1) adminError('CONCURRENCY_CONFLICT', 409);
      await this.record(transaction, actor, this.scope(actor), 'SUPPLIER_PROFILE_UPDATED', id, traceId);
      return this.serializeProfile(await this.findProfile(transaction, actor, id));
    }, async (transaction) => { await this.findProfile(transaction, actor, id); });
  }

  private async findProfile(transaction: AdminTransaction, actor: AdminActor, id: string) {
    const profile = await transaction.supplierBusinessProfile.findFirst({ where: { id, ownerOrganizationId: this.scope(actor) } });
    if (!profile) adminError('SUPPLIER_RECORD_NOT_FOUND', 404);
    return profile;
  }

  private serializeProfile({ id, version, supplierOrganizationId, businessCode, displayName, contactName, contactEmail }: Prisma.SupplierBusinessProfileGetPayload<object>): SupplierProfileDto {
    return { id, version, supplierOrganizationId, businessCode, displayName, ...(contactName ? { contactName } : {}), ...(contactEmail ? { contactEmail } : {}) };
  }

  async options(actor: AdminActor, query: SupplierReferenceQueryDto) {
    this.internal(actor);
    return this.prisma.$transaction(async (transaction) => {
      await assertAdminAccess(transaction, actor, this.scope(actor), 'supplier-quality:problems:write');
      if (query.kind === 'responders') {
        const { items, total } = await this.identities.internalResponders(this.scope(actor), query, transaction);
        return { items: items.map((entry) => ({ id: entry.id, label: entry.username })), total };
      }
      const where: Prisma.SupplierBusinessProfileWhereInput = { ownerOrganizationId: this.scope(actor), ...(query.selectedId ? { id: query.selectedId } : query.search ? { OR: [{ displayName: { contains: query.search, mode: 'insensitive' } }, { businessCode: { contains: query.search, mode: 'insensitive' } }] } : {}) };
      const [profiles, total] = await Promise.all([
        transaction.supplierBusinessProfile.findMany({ where, take: query.pageSize, skip: query.selectedId ? 0 : (query.page - 1) * query.pageSize, orderBy: [{ businessCode: 'asc' }, { id: 'asc' }] }),
        transaction.supplierBusinessProfile.count({ where }),
      ]);
      return { items: profiles.map((entry) => ({ id: entry.id, label: `${entry.businessCode} · ${entry.displayName}` })), total };
    });
  }

  async supplierOptions(actor: AdminActor, query: SupplierDirectoryQueryDto) {
    this.internal(actor);
    return this.prisma.$transaction(async (transaction) => {
      await assertAdminAccess(transaction, actor, this.scope(actor), 'supplier-quality:profiles:write');
      const { items, total } = await this.organizations.supplierDirectory(query, transaction);
      return { items: items.map((entry) => ({ id: entry.id, label: `${entry.code} · ${entry.name}` })), total };
    });
  }

  createProfile(actor: AdminActor, dto: CreateSupplierProfileDto, traceId: string, key?: string) {
    this.internal(actor);
    const ownerOrganizationId = this.scope(actor);
    return this.mutations.run({ actor, organizationId: ownerOrganizationId, key, traceId, action: 'SUPPLIER_PROFILE_CREATED', payload: dto, permission: 'supplier-quality:profiles:write', duplicateCode: 'SUPPLIER_PROFILE_DUPLICATE' }, async (transaction) => {
      const [owner, supplier] = await Promise.all([this.organizations.lookup(ownerOrganizationId, transaction), this.organizations.lookup(dto.supplierOrganizationId, transaction)]);
      if (owner?.type !== 'INTERNAL' || supplier?.type !== 'SUPPLIER' || !dto.businessCode.trim()) adminError('SUPPLIER_INPUT_INVALID', 400);
      const profile = await transaction.supplierBusinessProfile.create({ data: { ownerOrganizationId, supplierOrganizationId: supplier.id, businessCode: dto.businessCode.trim(), displayName: supplier.name, contactName: dto.contactName?.trim() || null, contactEmail: dto.contactEmail?.trim() || null } });
      await this.record(transaction, actor, ownerOrganizationId, 'SUPPLIER_PROFILE_CREATED', profile.id, traceId);
      return this.serializeProfile(profile);
    });
  }

  async list(actor: AdminActor, query: SupplierProblemQueryDto, portal: boolean) {
    portal ? this.portal(actor) : this.internal(actor);
    return this.prisma.$transaction(async (transaction) => {
      const granted = await assertAdminAccess(transaction, actor, this.scope(actor), portal ? 'supplier-quality:responses:read' : 'supplier-quality:problems:read');
      const where: Prisma.SupplierQualityProblemWhereInput = { AND: [this.resourceWhere(actor, portal), {
        ...(query.severity ? { severity: query.severity } : {}), ...(query.responseForm ? { responseForm: query.responseForm } : {}),
        ...(query.stage ? { problemIndexId: query.stage === 'DRAFT' ? null : { not: null } } : {}),
        ...(query.search ? { OR: [{ title: { contains: query.search, mode: 'insensitive' } }, { materialCode: { contains: query.search, mode: 'insensitive' } }] } : {}),
      }] };
      const [records, total] = await Promise.all([
        transaction.supplierQualityProblem.findMany({ where, include: problemInclude, orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }], take: query.pageSize, skip: (query.page - 1) * query.pageSize }),
        transaction.supplierQualityProblem.count({ where }),
      ]);
      return { items: await Promise.all(records.map((record) => this.serialize(transaction, actor, record, granted))), total, canCreateDraft: !portal && granted.includes('supplier-quality:problems:write') };
    });
  }

  async detail(actor: AdminActor, id: string, portal: boolean, query: SupplierProblemDetailQueryDto) {
    portal ? this.portal(actor) : this.internal(actor);
    return this.prisma.$transaction(async (transaction) => {
      const granted = await assertAdminAccess(transaction, actor, this.scope(actor), portal ? 'supplier-quality:responses:read' : 'supplier-quality:problems:read');
      return this.serializeDetail(transaction, actor, await this.find(transaction, actor, id, portal), granted, query);
    }, { isolationLevel: 'ReadCommitted' });
  }

  createDraft(actor: AdminActor, dto: SupplierProblemDraftDto, traceId: string, key?: string) {
    this.internal(actor);
    return this.mutations.run({ actor, organizationId: this.scope(actor), key, traceId, action: 'SUPPLIER_PROBLEM_DRAFT_CREATED', payload: dto, permission: 'supplier-quality:problems:write' }, async (transaction, granted) => {
      const facts = await this.facts(transaction, actor, dto);
      const record = await transaction.supplierQualityProblem.create({ data: { ...facts, ownerOrganizationId: this.scope(actor), profileId: dto.profileId, createdById: actor.id }, include: problemInclude });
      await this.record(transaction, actor, record.ownerOrganizationId, 'SUPPLIER_PROBLEM_DRAFT_CREATED', record.id, traceId);
      return this.serialize(transaction, actor, record, granted);
    });
  }

  issueDraft(actor: AdminActor, id: string, dto: IssueSupplierProblemDto, traceId: string, key?: string) {
    this.internal(actor);
    const organizationId = this.scope(actor);
    return this.prisma.$transaction(async (transaction) => {
      await assertActiveAuthentication(transaction, actor);
      await assertAdminAccess(transaction, actor, organizationId, 'supplier-quality:problems:write');
      if (!key || !/^[a-zA-Z0-9._:-]{8,128}$/.test(key)) adminError('IDEMPOTENCY_KEY_REQUIRED', 400);
      const record = await transaction.supplierQualityProblem.findFirst({ where: { id, ownerOrganizationId: organizationId }, include: problemInclude });
      if (!record) adminError('SUPPLIER_RECORD_NOT_FOUND', 404);
      if (record.problemIndexId && !record.workflowBindingId) adminError('SUPPLIER_DRAFT_LOCKED', 409);
      if (!record.problemIndexId && record.version !== dto.expectedVersion) adminError('CONCURRENCY_CONFLICT', 409);
      const binding = await this.bindings.resolve(transaction, organizationId, { severity: record.severity as never, responseForm: record.responseForm as never, replyMode: record.replyMode as never });
      const problemIndex = await this.indexes.createFromDomain(transaction as never, {
        organizationId, domainCode: 'supplier-quality', problemType: record.responseForm, sourceType: 'supplier-quality', sourceId: record.id,
        severity: record.severity, responsibleParty: record.supplierOrganizationId, ownerId: actor.id,
        dueAt: new Date(Date.now() + binding.responseSlaMinutes * 60_000), createdById: actor.id, traceId,
      });
      await this.runtime.startInstance({
        organizationId, actor, problemIndexId: String(problemIndex.id), workflowDefinitionId: binding.workflowDefinitionId,
        workflowVersionId: binding.workflowVersionId, expectedProblemVersion: record.problemIndexId ? Number(problemIndex.version) - 1 : Number(problemIndex.version), instanceKey: record.id,
        idempotencyKey: key, traceId, commandPayload: { supplierIssueExpectedVersion: dto.expectedVersion },
      }, transaction, undefined, async (tx, context) => {
        const current = await tx.supplierQualityProblem.findFirst({ where: { id: record.id, ownerOrganizationId: organizationId } });
        if (!current) adminError('SUPPLIER_RECORD_NOT_FOUND', 404);
        if (current.problemIndexId === String(problemIndex.id) && current.workflowBindingId === binding.bindingId && current.workflowBindingVersion === binding.bindingVersion) return;
        if (context.replay || current.workflowBindingId) adminError('CONCURRENCY_CONFLICT', 409);
        const changed = await tx.supplierQualityProblem.updateMany({ where: { id: record.id, ownerOrganizationId: organizationId, problemIndexId: null, version: dto.expectedVersion, workflowBindingId: null }, data: { problemIndexId: String(problemIndex.id), workflowBindingId: binding.bindingId, workflowBindingVersion: binding.bindingVersion, version: { increment: 1 } } });
        if (changed.count !== 1) adminError('CONCURRENCY_CONFLICT', 409);
      });
      const current = await transaction.supplierQualityProblem.findUniqueOrThrow({ where: { id: record.id }, include: problemInclude });
      if (current.replyMode === 'SUPPLIER' && !current.releasedToSupplierAt) {
        await transaction.supplierQualityProblem.update({ where: { id: record.id }, data: { releasedToSupplierAt: new Date() } });
      }
      if (!record.workflowBindingId) await this.record(transaction, actor, organizationId, 'SUPPLIER_PROBLEM_ISSUED', record.id, traceId);
      return this.serialize(transaction, actor, await transaction.supplierQualityProblem.findUniqueOrThrow({ where: { id: record.id }, include: problemInclude }), ['supplier-quality:problems:write']);
    }, { isolationLevel: 'ReadCommitted' });
  }

  updateDraft(actor: AdminActor, id: string, dto: UpdateSupplierProblemDraftDto, traceId: string, key?: string) {
    this.internal(actor);
    const authorize = async (transaction: AdminTransaction) => {
      if ((await this.find(transaction, actor, id, false)).problemIndexId) adminError('SUPPLIER_DRAFT_LOCKED', 409);
    };
    return this.mutations.run({ actor, organizationId: this.scope(actor), key, traceId, action: 'SUPPLIER_PROBLEM_DRAFT_UPDATED', payload: { id, dto }, permission: 'supplier-quality:problems:write' }, async (transaction, granted) => {
      const facts = await this.facts(transaction, actor, dto);
      const existing = await this.find(transaction, actor, id, false);
      if (existing.responseDraft && (existing.replyMode !== facts.replyMode || existing.supplierOrganizationId !== facts.supplierOrganizationId || existing.internalResponderId !== (facts.internalResponderId ?? null))) adminError('SUPPLIER_DRAFT_LOCKED', 409);
      const updated = await transaction.supplierQualityProblem.updateMany({ where: { id, ownerOrganizationId: this.scope(actor), version: dto.expectedVersion, problemIndexId: null }, data: { ...facts, profileId: dto.profileId, materialCategory: facts.materialCategory ?? null, internalResponderId: facts.internalResponderId ?? null, version: { increment: 1 } } });
      if (updated.count !== 1) adminError('CONCURRENCY_CONFLICT', 409);
      await this.record(transaction, actor, this.scope(actor), 'SUPPLIER_PROBLEM_DRAFT_UPDATED', id, traceId);
      return this.serialize(transaction, actor, await this.find(transaction, actor, id, false), granted);
    }, authorize);
  }

  saveResponse(actor: AdminActor, id: string, dto: SaveSupplierResponseDraftDto, traceId: string, portal: boolean, key?: string) {
    portal ? this.portal(actor) : this.internal(actor);
    const authorize = async (transaction: AdminTransaction) => {
      const record = await this.find(transaction, actor, id, portal);
      try { assertReplyActor(actor, { ...record, contentVersion: record.version, releasedToSupplier: record.releasedToSupplierAt !== null, replyMode: record.replyMode as 'INTERNAL' | 'SUPPLIER' }, portal ? undefined : this.scope(actor)); }
      catch (error) { if (error instanceof SupplierRuleError) adminError('FEATURE_PERMISSION_DENIED', 403); throw error; }
      if (!(await this.openForDraft(transaction, record))) adminError('SUPPLIER_DRAFT_LOCKED', 409);
    };
    return this.mutations.run({ actor, organizationId: this.scope(actor), key, traceId, action: 'SUPPLIER_RESPONSE_DRAFT_SAVED', payload: { id, dto }, permission: 'supplier-quality:responses:write' }, async (transaction, granted) => {
      const record = await this.find(transaction, actor, id, portal);
      const content = this.validate(() => validateResponseContent(record.responseForm as 'BRIEF' | 'EIGHT_D', dto.content, 'DRAFT'));
      const updated = await transaction.supplierQualityProblem.updateMany({ where: { id, version: dto.expectedVersion }, data: { version: { increment: 1 } } });
      if (updated.count !== 1) adminError('CONCURRENCY_CONFLICT', 409);
      await transaction.supplierResponseDraft.upsert({ where: { problemId: id }, create: { problemId: id, content: { ...content }, updatedById: actor.id }, update: { content: { ...content }, updatedById: actor.id } });
      await this.record(transaction, actor, record.ownerOrganizationId, 'SUPPLIER_RESPONSE_DRAFT_SAVED', id, traceId);
      return this.serialize(transaction, actor, await this.find(transaction, actor, id, portal), granted);
    }, authorize);
  }

  submitResponse(actor: AdminActor, id: string, dto: SubmitSupplierResponseDto, traceId: string, portal: boolean, key?: string) {
    portal ? this.portal(actor) : this.internal(actor);
    if (!key || !/^[a-zA-Z0-9._:-]{8,128}$/.test(key)) adminError('IDEMPOTENCY_KEY_REQUIRED', 400);
    return this.prisma.$transaction(async (transaction) => {
      const record = await this.find(transaction, actor, id, portal);
      const granted = await assertAdminAccess(transaction, actor, actor.accountType === 'SUPPLIER' ? actor.organizationId : record.ownerOrganizationId, 'supplier-quality:responses:write');
      if (!record.problemIndexId) adminError('SUPPLIER_DRAFT_LOCKED', 409);
      const content = this.validate(() => validateResponseContent(record.responseForm as 'BRIEF' | 'EIGHT_D', dto.content, 'SUBMIT'));
      const evidenceFileIds = [...(dto.evidenceFileIds ?? [])].sort();
      const evidencePurpose = dto.evidencePurpose ?? 'RESPONSE';
      const commandPayload = { supplierResponseExpectedContentVersion: dto.expectedContentVersion, content: content as Prisma.InputJsonObject, evidenceFileIds, evidencePurpose };
      const index = await transaction.problemIndex.findFirst({ where: { id: record.problemIndexId, organizationId: record.ownerOrganizationId, workflowInstanceId: { not: null }, archivedAt: null } });
      if (!index?.workflowInstanceId) adminError('WORKFLOW_INSTANCE_NOT_FOUND', 404);
      const existing = await transaction.workflowMutation.findUnique({ where: { organizationId_actorUserId_key: { organizationId: record.ownerOrganizationId, actorUserId: actor.id, key } } });
      if (existing) {
        const existingInstance = await transaction.workflowInstance.findUnique({ where: { id: existing.instanceId }, select: { problemIndexId: true } });
        const revision = await transaction.supplierResponseRevision.findFirst({ where: { problemId: id, workflowInstanceId: existing.instanceId, submittedById: actor.id }, orderBy: { revision: 'desc' }, include: { evidence: { select: { fileId: true, purpose: true } } } });
        if (existing.action !== 'SUBMIT' || existingInstance?.problemIndexId !== index.id || !revision
          || dto.expectedContentVersion !== record.version - 1
          || canonical(revision.content) !== canonical(content)
          || canonical(revision.evidence.map((item) => ({ fileId: item.fileId, purpose: item.purpose })).sort((first, second) => first.fileId.localeCompare(second.fileId))) !== canonical(evidenceFileIds.map((fileId) => ({ fileId, purpose: evidencePurpose })))) adminError('IDEMPOTENCY_REPLAY', 409);
        await assertActiveAuthentication(transaction, actor);
        return this.serialize(transaction, actor, record, granted);
      }
      const instance = await transaction.workflowInstance.findFirst({ where: { id: index.workflowInstanceId, organizationId: record.ownerOrganizationId, problemIndexId: index.id } });
      if (!instance?.currentNodeId) adminError('WORKFLOW_INSTANCE_NOT_FOUND', 404);
      const command = {
        organizationId: record.ownerOrganizationId, actor, problemIndexId: index.id, workflowVersionId: instance.workflowVersionId,
        instanceId: instance.id, currentNodeId: instance.currentNodeId, expectedVersion: instance.version, expectedProblemVersion: index.version,
        action: 'SUBMIT' as const, idempotencyKey: key ?? '', traceId,
        commandPayload,
      };
      await this.runtime.submitAction(command, transaction, async (tx) => {
        const current = await tx.supplierQualityProblem.findFirst({ where: { id, ownerOrganizationId: record.ownerOrganizationId, problemIndexId: index.id } });
        if (!current || current.version !== dto.expectedContentVersion) adminError('CONCURRENCY_CONFLICT', 409);
        const evidenceFiles = evidenceFileIds.length ? await this.files.assertAttachable(tx, actor, { resourceType: 'supplier-quality', resourceId: id }, evidenceFileIds) : [];
        const workflowVersion = await tx.workflowVersion.findUnique({ where: { id: instance.workflowVersionId }, select: { version: true } });
        if (!workflowVersion) adminError('WORKFLOW_VERSION_NOT_FOUND', 404);
        const latest = await tx.supplierResponseRevision.findFirst({ where: { problemId: id }, orderBy: { revision: 'desc' }, select: { revision: true } });
        const changed = await tx.supplierQualityProblem.updateMany({ where: { id, ownerOrganizationId: record.ownerOrganizationId, version: dto.expectedContentVersion }, data: { version: { increment: 1 } } });
        if (changed.count !== 1) adminError('CONCURRENCY_CONFLICT', 409);
        const revision = await tx.supplierResponseRevision.create({ data: { problemId: id, revision: (latest?.revision ?? 0) + 1, content: content as Prisma.InputJsonValue, submittedById: actor.id, workflowInstanceId: instance.id, workflowVersion: workflowVersion.version } });
        if (evidenceFiles.length) await tx.supplierEvidenceReference.createMany({ data: evidenceFiles.map((file) => ({ problemId: id, fileId: file.id, revisionId: revision.id, purpose: evidencePurpose })) });
        await tx.supplierResponseDraft.deleteMany({ where: { problemId: id } });
        await this.record(tx, actor, record.ownerOrganizationId, 'SUPPLIER_RESPONSE_SUBMITTED', id, traceId);
      }, async (tx, context) => {
        if (context.replay) return;
        const current = await tx.supplierQualityProblem.findFirst({ where: { id, ownerOrganizationId: record.ownerOrganizationId, problemIndexId: index.id } });
        if (!current || current.version !== dto.expectedContentVersion) adminError('CONCURRENCY_CONFLICT', 409);
      }, this.workflowAccess);
      return this.serialize(transaction, actor, await transaction.supplierQualityProblem.findUniqueOrThrow({ where: { id }, include: problemInclude }), granted);
    }, { isolationLevel: 'ReadCommitted' });
  }

  submitWorkflowAction(actor: AdminActor, id: string, dto: SupplierWorkflowActionDto, traceId: string, key?: string) {
    this.internal(actor);
    if (!key || !/^[a-zA-Z0-9._:-]{8,128}$/.test(key)) adminError('IDEMPOTENCY_KEY_REQUIRED', 400);
    return this.prisma.$transaction(async (transaction) => {
      const record = await this.find(transaction, actor, id, false);
      const granted = await assertAdminAccess(transaction, actor, record.ownerOrganizationId, 'supplier-quality:problems:write');
      if (!record.problemIndexId) adminError('SUPPLIER_DRAFT_LOCKED', 409);
      if (record.version !== dto.expectedContentVersion) adminError('CONCURRENCY_CONFLICT', 409);
      if (dto.action === 'VERIFY' && dto.accepted !== true) adminError('SUPPLIER_INPUT_INVALID', 400);
      if (dto.action !== 'VERIFY' && dto.accepted !== undefined) adminError('SUPPLIER_INPUT_INVALID', 400);
      const index = await transaction.problemIndex.findFirst({ where: { id: record.problemIndexId, organizationId: record.ownerOrganizationId, workflowInstanceId: { not: null }, archivedAt: null } });
      if (!index?.workflowInstanceId) adminError('WORKFLOW_INSTANCE_NOT_FOUND', 404);
      const existing = await transaction.workflowMutation.findUnique({ where: { organizationId_actorUserId_key: { organizationId: record.ownerOrganizationId, actorUserId: actor.id, key } } });
      if (existing) {
        if (existing.action !== dto.action || existing.instanceId !== index.workflowInstanceId) adminError('IDEMPOTENCY_REPLAY', 409);
        if (dto.action === 'VERIFY') {
          const latest = await transaction.supplierResponseRevision.findFirst({ where: { problemId: id }, orderBy: { revision: 'desc' } });
          const verification = latest ? await transaction.supplierVerification.findFirst({ where: { problemId: id, revisionId: latest.id }, orderBy: { createdAt: 'desc' } }) : null;
          if (!verification || verification.verifierId !== actor.id || verification.accepted !== dto.accepted) adminError('IDEMPOTENCY_REPLAY', 409);
        }
        await assertActiveAuthentication(transaction, actor);
        return this.serialize(transaction, actor, record, granted);
      }
      const instance = await transaction.workflowInstance.findFirst({ where: { id: index.workflowInstanceId, organizationId: record.ownerOrganizationId, problemIndexId: index.id } });
      if (!instance?.currentNodeId) adminError('WORKFLOW_INSTANCE_NOT_FOUND', 404);
      const command = {
        organizationId: record.ownerOrganizationId, actor, problemIndexId: index.id, workflowVersionId: instance.workflowVersionId,
        instanceId: instance.id, currentNodeId: instance.currentNodeId, expectedVersion: instance.version, expectedProblemVersion: index.version,
        action: dto.action, idempotencyKey: key, traceId,
        commandPayload: { supplierWorkflowAction: dto.action, expectedContentVersion: dto.expectedContentVersion, ...(dto.accepted === undefined ? {} : { accepted: dto.accepted }) },
      } as const;
      await this.runtime.submitAction(command, transaction, async (tx) => {
        const current = await tx.supplierQualityProblem.findFirst({ where: { id, ownerOrganizationId: record.ownerOrganizationId, problemIndexId: index.id } });
        if (!current || current.version !== dto.expectedContentVersion) adminError('CONCURRENCY_CONFLICT', 409);
        const latest = await tx.supplierResponseRevision.findFirst({ where: { problemId: id }, orderBy: { revision: 'desc' } });
        if (dto.action === 'VERIFY') {
          if (!latest) adminError('WORKFLOW_ACTION_INVALID', 409);
          await tx.supplierVerification.create({ data: { problemId: id, revisionId: latest.id, verifierId: actor.id, contentVersion: current.version, accepted: dto.accepted === true } });
          await this.record(tx, actor, record.ownerOrganizationId, 'SUPPLIER_RESPONSE_VERIFIED', id, traceId);
        } else if (dto.action === 'CLOSE') {
          const verification = latest ? await tx.supplierVerification.findFirst({ where: { problemId: id, revisionId: latest.id }, orderBy: { createdAt: 'desc' } }) : null;
          try {
            assertInternalClosure(actor, { ...current, releasedToSupplier: current.releasedToSupplierAt !== null, contentVersion: current.version, replyMode: current.replyMode as 'INTERNAL' | 'SUPPLIER' }, verification, record.ownerOrganizationId);
          } catch (error) {
            if (error instanceof SupplierRuleError) adminError('WORKFLOW_INDEPENDENT_VERIFICATION_REQUIRED', 403);
            throw error;
          }
          await this.record(tx, actor, record.ownerOrganizationId, 'SUPPLIER_PROBLEM_CLOSED', id, traceId);
        } else {
          await this.record(tx, actor, record.ownerOrganizationId, `SUPPLIER_RESPONSE_${dto.action}`, id, traceId);
        }
      }, async (tx, context) => {
        if (context.replay) return;
        const current = await tx.supplierQualityProblem.findFirst({ where: { id, ownerOrganizationId: record.ownerOrganizationId, problemIndexId: index.id } });
        if (!current || current.version !== dto.expectedContentVersion) adminError('CONCURRENCY_CONFLICT', 409);
      }, this.workflowAccess);
      return this.serialize(transaction, actor, await transaction.supplierQualityProblem.findUniqueOrThrow({ where: { id }, include: problemInclude }), granted);
    }, { isolationLevel: 'ReadCommitted' });
  }

  private resourceWhere(actor: AdminActor, portal: boolean): Prisma.SupplierQualityProblemWhereInput {
    return portal ? { supplierOrganizationId: actor.organizationId, replyMode: 'SUPPLIER', releasedToSupplierAt: { not: null }, problemIndexId: { not: null } } : { ownerOrganizationId: this.scope(actor) };
  }

  private async find(transaction: AdminTransaction, actor: AdminActor, id: string, portal: boolean) {
    const record = await transaction.supplierQualityProblem.findFirst({ where: { id, ...this.resourceWhere(actor, portal) }, include: problemInclude });
    if (!record) adminError('SUPPLIER_RECORD_NOT_FOUND', 404);
    return record;
  }

  private async facts(transaction: AdminTransaction, actor: AdminActor, dto: SupplierProblemDraftDto) {
    const profile = await transaction.supplierBusinessProfile.findFirst({ where: { id: dto.profileId, ownerOrganizationId: this.scope(actor) } });
    if (!profile) adminError('SUPPLIER_RECORD_NOT_FOUND', 404);
    const facts = this.validate(() => validateProblemFacts({ supplierOrganizationId: profile.supplierOrganizationId, title: dto.title, materialCode: dto.materialCode, ...(dto.materialCategory ? { materialCategory: dto.materialCategory } : {}), defectDescription: dto.defectDescription, defectQuantity: dto.defectQuantity, severity: dto.severity, responseForm: dto.responseForm, replyMode: dto.replyMode, ...(dto.internalResponderId ? { internalResponderId: dto.internalResponderId } : {}) }));
    if (facts.internalResponderId && !await this.identities.isInternalResponder(facts.internalResponderId, this.scope(actor), transaction)) adminError('SUPPLIER_INPUT_INVALID', 400);
    return facts;
  }

  private async openForDraft(transaction: AdminTransaction, record: ProblemRecord) {
    if (!record.problemIndexId) return true;
    const index = await transaction.problemIndex.findFirst({ where: { id: record.problemIndexId, organizationId: record.ownerOrganizationId, archivedAt: null }, select: { status: true, workflowInstanceId: true } });
    if (!index || !['OPEN', 'IN_PROGRESS', 'PENDING'].includes(String(index.status)) || !index.workflowInstanceId) return false;
    const instance = await transaction.workflowInstance.findFirst({ where: { id: index.workflowInstanceId, organizationId: record.ownerOrganizationId }, select: { currentNodeId: true, workflowVersionId: true } });
    if (!instance?.currentNodeId) return false;
    const node = await transaction.workflowNode.findFirst({ where: { id: instance.currentNodeId, organizationId: record.ownerOrganizationId, workflowVersionId: instance.workflowVersionId }, select: { type: true, config: true } });
    return node?.type === 'ACTION' && jsonObject(jsonObject(node.config).assignment).permission === 'supplier-quality:responses:write';
  }

  private async serialize(transaction: AdminTransaction, actor: AdminActor, record: ProblemRecord, granted: string[]): Promise<SupplierProblemDto> {
    const index = record.problemIndexId ? await this.indexes.findById(record.problemIndexId, record.ownerOrganizationId, transaction as never) : null;
    const ownReply = record.replyMode === 'INTERNAL' ? actor.accountType === 'INTERNAL' && actor.id === record.internalResponderId : actor.accountType === 'SUPPLIER' && actor.organizationId === record.supplierOrganizationId && !!record.releasedToSupplierAt;
    return {
      id: record.id, organizationId: record.ownerOrganizationId, profileId: record.profileId, supplierOrganizationId: record.supplierOrganizationId, supplierName: record.profile.displayName,
      title: record.title, materialCode: record.materialCode, ...(record.materialCategory ? { materialCategory: record.materialCategory as 'STRUCTURE' | 'ELECTRONIC' } : {}),
      defectDescription: record.defectDescription, defectQuantity: record.defectQuantity, severity: record.severity as SupplierProblemDto['severity'], responseForm: record.responseForm as SupplierProblemDto['responseForm'], replyMode: record.replyMode as SupplierProblemDto['replyMode'],
      ...(record.internalResponderId ? { internalResponderId: record.internalResponderId } : {}), version: record.version, updatedAt: record.updatedAt.toISOString(), stage: record.problemIndexId ? 'ISSUED' : 'DRAFT',
      ...(index ? { reportNumber: String(index.reportNumber), problemStatus: String(index.status) as SupplierProblemDto['problemStatus'], ...(index.dueAt instanceof Date ? { dueAt: index.dueAt.toISOString() } : {}) } : {}),
      canEditFacts: actor.accountType === 'INTERNAL' && !record.problemIndexId && granted.includes('supplier-quality:problems:write'),
      canEditResponse: ownReply && granted.includes('supplier-quality:responses:write') && await this.openForDraft(transaction, record),
      responseDraft: (record.responseDraft?.content ?? {}) as SupplierProblemDto['responseDraft'],
    };
  }

  private async serializeDetail(transaction: AdminTransaction, actor: AdminActor, record: ProblemRecord, granted: string[], query: SupplierProblemDetailQueryDto): Promise<SupplierProblemDto> {
    const result = await this.serialize(transaction, actor, record, granted);
    const revision = await transaction.supplierResponseRevision.findFirst({ where: { problemId: record.id }, orderBy: { revision: 'desc' }, include: { evidence: { orderBy: { fileId: 'asc' } } } });
    const [history, total] = await Promise.all([
      transaction.supplierResponseRevision.findMany({ where: { problemId: record.id }, orderBy: { revision: 'desc' }, skip: (query.revisionPage - 1) * query.revisionPageSize, take: query.revisionPageSize, include: { evidence: { orderBy: { fileId: 'asc' } } } }),
      transaction.supplierResponseRevision.count({ where: { problemId: record.id } }),
    ]);
    const visibleRevisions = revision && !history.some((entry) => entry.id === revision.id) ? [revision, ...history] : history;
    const fileIds = [...new Set(visibleRevisions.flatMap((entry) => entry.evidence.map((reference) => reference.fileId)))];
    const filesById = new Map<string, Awaited<ReturnType<FileLifecycleService['readEvidence']>>[number]>();
    for (let offset = 0; offset < fileIds.length; offset += 100) {
      const files = await this.files.readEvidence(transaction, actor, [{ resource: { resourceType: 'supplier-quality', resourceId: record.id }, fileIds: fileIds.slice(offset, offset + 100) }]);
      for (const file of files) filesById.set(file.id, file);
    }
    const serializeRevision = (entry: (typeof visibleRevisions)[number]): SupplierResponseRevisionDto => ({
      id: entry.id, revision: entry.revision, content: entry.content as SupplierProblemDto['responseDraft'], submittedAt: entry.createdAt.toISOString(),
      evidence: entry.evidence.map((reference) => {
        const file = filesById.get(reference.fileId)!;
        return { fileId: file.id, purpose: reference.purpose, originalName: file.originalName, status: file.status, scanStatus: file.scanStatus, downloadable: file.downloadable };
      }),
    });
    if (revision) result.latestResponseRevision = serializeRevision(revision);
    result.responseHistory = { items: history.map(serializeRevision), total, page: query.revisionPage, pageSize: query.revisionPageSize };
    result.currentVerification = { status: 'NOT_VERIFIED' };
    if (!record.problemIndexId) return { ...result, availableActions: [], actionUnavailableReason: 'WORKFLOW_INSTANCE_NOT_FOUND' };
    const index = await transaction.problemIndex.findFirst({ where: { id: record.problemIndexId, organizationId: record.ownerOrganizationId, sourceId: record.id, domainCode: 'supplier-quality', sourceType: 'supplier-quality', archivedAt: null } });
    if (index && actor.accountType === 'INTERNAL') result.problemIndexId = index.id;
    const instance = index?.workflowInstanceId ? await transaction.workflowInstance.findFirst({ where: { id: index.workflowInstanceId, organizationId: record.ownerOrganizationId, problemIndexId: index.id } }) : null;
    if (!index || !instance?.currentNodeId) return { ...result, availableActions: [], actionUnavailableReason: 'WORKFLOW_INSTANCE_NOT_FOUND' };
    if (revision) {
      const verification = await transaction.supplierVerification.findFirst({ where: { problemId: record.id, revisionId: revision.id }, orderBy: { createdAt: 'desc' } });
      const latestDecision = await transaction.workflowMutation.findFirst({ where: { organizationId: record.ownerOrganizationId, instanceId: instance.id, action: { in: ['VERIFY', 'RETURN', 'REJECT', 'REOPEN'] } }, orderBy: { instanceVersion: 'desc' } });
      if (verification) {
        const accepted = verification.accepted && verification.contentVersion === record.version && revision.workflowInstanceId === instance.id && latestDecision?.action === 'VERIFY' && latestDecision.actorUserId === verification.verifierId;
        result.currentVerification = { status: accepted ? 'ACCEPTED' : 'INVALIDATED', revisionId: revision.id, verifiedAt: verification.createdAt.toISOString(), ...(actor.accountType === 'INTERNAL' ? { verifierId: verification.verifierId } : {}) };
      }
    }
    const node = await transaction.workflowNode.findFirst({ where: { id: instance.currentNodeId, organizationId: record.ownerOrganizationId, workflowVersionId: instance.workflowVersionId } });
    if (!node) return { ...result, availableActions: [], actionUnavailableReason: 'WORKFLOW_NODE_FORBIDDEN' };
    result.currentWorkflowNode = actor.accountType === 'INTERNAL' ? { id: node.id, name: node.name, type: node.type } : { type: node.type };
    const capabilities = actor.accountType === 'SUPPLIER'
      ? await this.supplierSubmitCapability(transaction, actor, record, index, instance, node, granted)
      : await workflowCapabilities(transaction, actor, index, instance);
    const actions: NonNullable<SupplierProblemDto['availableActions']> = [];
    let reason = capabilities.reasonCode;
    for (const action of capabilities.allowedActions) {
      if (!['SUBMIT', 'VERIFY', 'REJECT', 'RETURN', 'REOPEN', 'CLOSE'].includes(action)) continue;
      if (action === 'SUBMIT' && (!granted.includes('supplier-quality:responses:write') || !result.canEditResponse)) { reason = 'FEATURE_PERMISSION_DENIED'; continue; }
      if (action !== 'SUBMIT' && (actor.accountType !== 'INTERNAL' || !granted.includes('supplier-quality:problems:write'))) { reason = 'FEATURE_PERMISSION_DENIED'; continue; }
      if (action === 'VERIFY' && !revision) { reason = 'WORKFLOW_ACTION_INVALID'; continue; }
      if (action === 'CLOSE') {
        if (result.currentVerification.status !== 'ACCEPTED' || result.currentVerification.verifierId === actor.id) { reason = 'WORKFLOW_INDEPENDENT_VERIFICATION_REQUIRED'; continue; }
      }
      const command: WorkflowActionInput = {
        actor, organizationId: record.ownerOrganizationId, problemIndexId: index.id, workflowVersionId: instance.workflowVersionId,
        instanceId: instance.id, currentNodeId: node.id, expectedVersion: instance.version, expectedProblemVersion: index.version,
        action, idempotencyKey: 'read-capability', traceId: 'read-capability',
      };
      try { await this.workflowAccess.authorize(transaction, command, node); }
      catch (error) {
        if (!(error instanceof HttpException)) throw error;
        reason = (error.getResponse() as { code?: string }).code ?? 'WORKFLOW_NODE_FORBIDDEN';
        continue;
      }
      actions.push(action as NonNullable<SupplierProblemDto['availableActions']>[number]);
    }
    result.availableActions = actions;
    result.actionUnavailableReason = actions.length ? null : reason ?? 'WORKFLOW_ACTION_INVALID';
    return result;
  }

  private async supplierSubmitCapability(transaction: AdminTransaction, actor: AdminActor, record: ProblemRecord, index: ProblemIndex, instance: WorkflowInstance, node: WorkflowNode, granted: string[]) {
    const unavailable = (reasonCode: string) => ({ allowedActions: [] as WorkflowAction[], reasonCode });
    if (!record.releasedToSupplierAt || record.replyMode !== 'SUPPLIER' || record.supplierOrganizationId !== actor.organizationId) return unavailable('WORKFLOW_NODE_FORBIDDEN');
    if (!actionAllowed(node.type, 'SUBMIT')) return unavailable('WORKFLOW_NODE_FORBIDDEN');
    if (index.status === 'ARCHIVED' || instance.status !== 'RUNNING') return unavailable('WORKFLOW_ACTION_INVALID');
    if (!granted.includes('supplier-quality:responses:write')) return unavailable('FEATURE_PERMISSION_DENIED');
    try { await assertWorkflowFeature(transaction, actor, actor.organizationId, 'workflow:act'); }
    catch (error) {
      if (!(error instanceof HttpException)) throw error;
      return unavailable((error.getResponse() as { code?: string }).code ?? 'FEATURE_PERMISSION_DENIED');
    }
    if (!await canProcessWorkflowNode(transaction, actor.id, actor.organizationId, jsonObject(node.config).assignment)) return unavailable('WORKFLOW_NODE_FORBIDDEN');
    const task = await transaction.workflowTask.findFirst({ where: { workflowInstanceId: instance.id, organizationId: record.ownerOrganizationId, workflowVersionId: instance.workflowVersionId, workflowNodeId: node.id, entryInstanceVersion: instance.version, status: { in: ['PENDING', 'IN_PROGRESS', 'OVERDUE'] } } });
    if (task?.claimedByUserId && task.claimedByUserId !== actor.id) return unavailable('TASK_CLAIM_OWNER_REQUIRED');
    const transitions = await transaction.workflowTransition.findMany({ where: { organizationId: record.ownerOrganizationId, workflowVersionId: instance.workflowVersionId, fromNodeId: node.id } });
    if (transitions.filter((edge) => (edge.action ?? 'SUBMIT') === 'SUBMIT' && matchesCondition(edge.condition, index)).length !== 1) return unavailable('WORKFLOW_TRANSITION_AMBIGUOUS');
    return { allowedActions: ['SUBMIT'] as WorkflowAction[], reasonCode: null };
  }

  private validate<Result>(work: () => Result): Result {
    try { return work(); } catch (error) { if (error instanceof SupplierRuleError) adminError('SUPPLIER_INPUT_INVALID', 400); throw error; }
  }

  private record(transaction: AdminTransaction, actor: AdminActor, organizationId: string, action: string, resourceId: string, traceId: string) {
    return this.audit.record({ organizationId, actorUserId: actor.id, action, resourceType: 'SupplierQuality', resourceId, outcome: 'SUCCESS', traceId }, transaction as never);
  }
}
