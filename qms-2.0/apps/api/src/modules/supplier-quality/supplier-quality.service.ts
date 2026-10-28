import { HttpException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';
import { Prisma, type ProblemIndex, type WorkflowInstance, type WorkflowNode } from '../../generated/prisma/client.js';
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
import { supplierProfileInput } from './supplier-profile-input.js';
import { assertSupplierAccountGovernance } from '../authorization/supplier-account-authorization.js';

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
      const current = await this.findProfile(transaction, actor, id);
      const data = supplierProfileInput(dto, current.displayName);
      const updated = await transaction.supplierBusinessProfile.updateMany({ where: { id, ownerOrganizationId: this.scope(actor), version: dto.expectedVersion }, data: { ...data, version: { increment: 1 } } });
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

  async performanceProfile(transaction: AdminTransaction, organizationId: string, profileId: string) {
    const profile = await transaction.supplierBusinessProfile.findFirst({ where: { id: profileId, ownerOrganizationId: organizationId }, select: { id: true, supplierOrganizationId: true, displayName: true, businessCode: true } });
    if (!profile) adminError('SUPPLIER_RECORD_NOT_FOUND', 404);
    return profile;
  }

  async collaborationProfile(transaction: AdminTransaction, organizationId: string, profileId: string) {
    await transaction.$queryRaw`SELECT id FROM supplier_business_profiles WHERE id = ${profileId}::uuid AND owner_organization_id = ${organizationId}::uuid FOR SHARE`;
    const profile = await this.performanceProfile(transaction, organizationId, profileId);
    if (!profile.supplierOrganizationId) adminError('SUPPLIER_COLLABORATION_NOT_ENABLED', 409);
    return { ...profile, supplierOrganizationId: profile.supplierOrganizationId };
  }

  async pcnSupplierProfile(transaction: AdminTransaction, supplierOrganizationId: string, profileId: string) {
    const profile = await transaction.supplierBusinessProfile.findFirst({ where: { id: profileId, supplierOrganizationId }, select: { id: true, ownerOrganizationId: true, supplierOrganizationId: true, displayName: true } });
    if (!profile || profile.supplierOrganizationId !== supplierOrganizationId) adminError('SUPPLIER_RECORD_NOT_FOUND', 404);
    const owner = await transaction.organization.findUnique({ where: { id: profile.ownerOrganizationId }, select: { status: true } });
    const supplier = await transaction.organization.findUnique({ where: { id: supplierOrganizationId }, select: { status: true } });
    if (owner?.status !== 'ACTIVE' || supplier?.status !== 'ACTIVE') adminError('ORGANIZATION_DISABLED', 403);
    return { ...profile, supplierOrganizationId };
  }

  async pcnSupplierProfiles(transaction: AdminTransaction, supplierOrganizationId: string) {
    return transaction.$queryRaw<{ id: string; ownerOrganizationId: string; supplierOrganizationId: string; displayName: string }[]>`
      SELECT profile.id, profile.owner_organization_id AS "ownerOrganizationId", profile.supplier_organization_id AS "supplierOrganizationId", profile.display_name AS "displayName"
      FROM supplier_business_profiles profile
      JOIN organizations owner_org ON owner_org.id = profile.owner_organization_id AND owner_org.status = 'ACTIVE'
      JOIN organizations supplier_org ON supplier_org.id = profile.supplier_organization_id AND supplier_org.status = 'ACTIVE'
      WHERE profile.supplier_organization_id = ${supplierOrganizationId}::uuid
      ORDER BY profile.business_code ASC, profile.id ASC LIMIT 100`;
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
      const owner = await this.organizations.lookup(ownerOrganizationId, transaction);
      const supplier = dto.supplierOrganizationId ? await this.organizations.lookup(dto.supplierOrganizationId, transaction) : null;
      if (owner?.type !== 'INTERNAL' || (dto.supplierOrganizationId && supplier?.type !== 'SUPPLIER')) adminError('SUPPLIER_INPUT_INVALID', 400);
      if (supplier) await assertSupplierAccountGovernance(transaction, actor, supplier.id, 'account:users:create');
      const data = supplierProfileInput(dto, supplier?.name);
      const profile = await transaction.supplierBusinessProfile.create({ data: { ownerOrganizationId, supplierOrganizationId: supplier?.id ?? null, ...data } });
      await this.record(transaction, actor, ownerOrganizationId, 'SUPPLIER_PROFILE_CREATED', profile.id, traceId);
      return this.serializeProfile(profile);
    }, async (transaction) => {
      if (dto.supplierOrganizationId) {
        const supplier = await this.organizations.lookup(dto.supplierOrganizationId, transaction);
        if (supplier?.type !== 'SUPPLIER') adminError('SUPPLIER_INPUT_INVALID', 400);
        await assertSupplierAccountGovernance(transaction, actor, supplier.id, 'account:users:create');
      }
    });
  }

  async list(actor: AdminActor, query: SupplierProblemQueryDto, portal: boolean) {
    portal ? this.portal(actor) : this.internal(actor);
    return this.prisma.$transaction(async (transaction) => {
      const granted = await assertAdminAccess(transaction, actor, this.scope(actor), portal ? 'supplier-quality:responses:read' : 'supplier-quality:problems:read');
      const where = Prisma.sql`${this.readScope(actor, portal, granted)}
        ${query.severity ? Prisma.sql`AND supplier.severity = ${query.severity}` : Prisma.empty}
        ${query.responseForm ? Prisma.sql`AND supplier.response_form = ${query.responseForm}` : Prisma.empty}
        ${query.stage ? query.stage === 'DRAFT' ? Prisma.sql`AND supplier.problem_index_id IS NULL` : Prisma.sql`AND supplier.problem_index_id IS NOT NULL` : Prisma.empty}
        ${query.search ? Prisma.sql`AND (strpos(lower(supplier.title), lower(${query.search})) > 0 OR strpos(lower(supplier.material_code), lower(${query.search})) > 0)` : Prisma.empty}`;
      const [page, [count]] = await Promise.all([
        transaction.$queryRaw<{ id: string }[]>(Prisma.sql`SELECT supplier.id FROM supplier_quality_problems supplier WHERE ${where}
          ORDER BY supplier.updated_at DESC, supplier.id ASC LIMIT ${query.pageSize} OFFSET ${(query.page - 1) * query.pageSize}`),
        transaction.$queryRaw<{ total: bigint }[]>(Prisma.sql`SELECT count(*) AS total FROM supplier_quality_problems supplier WHERE ${where}`),
      ]);
      const total = Number(count!.total);
      const records = page.length ? await transaction.supplierQualityProblem.findMany({ where: { id: { in: page.map(row => row.id) } },
        include: { profile: true }, orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }] }) : [];
      const controlled = records.length ? await transaction.$queryRaw<{ id: string }[]>`SELECT supplier_problem_id AS id
        FROM supplier_eight_d_controls WHERE supplier_problem_id = ANY(${records.map(record => record.id)}::uuid[])` : [];
      const controlledIds = new Set(controlled.map(record => record.id));
      const legacyIds = records.filter(record => !controlledIds.has(record.id)).map(record => record.id);
      const drafts = legacyIds.length ? await transaction.supplierResponseDraft.findMany({ where: { problemId: { in: legacyIds } } }) : [];
      const draftByProblem = new Map(drafts.map(draft => [draft.problemId, draft]));
      return { items: await Promise.all(records.map(record => this.serialize(transaction, actor,
        { ...record, responseDraft: draftByProblem.get(record.id) ?? null }, granted, controlledIds.has(record.id)))),
      total, canCreateDraft: !portal && granted.includes('supplier-quality:problems:write') };
    });
  }

  async detail(actor: AdminActor, id: string, portal: boolean, query: SupplierProblemDetailQueryDto) {
    portal ? this.portal(actor) : this.internal(actor);
    return this.prisma.$transaction(async (transaction) => {
      const granted = await assertAdminAccess(transaction, actor, this.scope(actor), portal ? 'supplier-quality:responses:read' : 'supplier-quality:problems:read');
      const [visible] = await transaction.$queryRaw<{ id: string }[]>(Prisma.sql`SELECT supplier.id FROM supplier_quality_problems supplier
        WHERE supplier.id = ${id}::uuid AND ${this.readScope(actor, portal, granted)}`);
      if (!visible) adminError('SUPPLIER_RECORD_NOT_FOUND', 404);
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

  async createDraftFromIncoming(transaction: AdminTransaction, actor: AdminActor, dto: SupplierProblemDraftDto, traceId: string): Promise<{ id: string; version: number }> {
    return this.createDraftInTransaction(transaction, actor, dto, traceId);
  }

  async createDraftInTransaction(transaction: AdminTransaction, actor: AdminActor, dto: SupplierProblemDraftDto, traceId: string): Promise<{ id: string; version: number }> {
    this.internal(actor);
    const organizationId = this.scope(actor);
    if (dto.organizationId && dto.organizationId !== organizationId) adminError('ORGANIZATION_SCOPE_DENIED', 403);
    await assertAdminAccess(transaction, actor, organizationId, 'supplier-quality:problems:write');
    await transaction.$queryRaw`SELECT id FROM supplier_business_profiles WHERE id = ${dto.profileId}::uuid AND owner_organization_id = ${organizationId}::uuid FOR SHARE`;
    const facts = await this.facts(transaction, actor, dto);
    const record = await transaction.supplierQualityProblem.create({ data: { ...facts, ownerOrganizationId: organizationId, profileId: dto.profileId, createdById: actor.id } });
    await this.record(transaction, actor, organizationId, 'SUPPLIER_PROBLEM_DRAFT_CREATED', record.id, traceId);
    return { id: record.id, version: record.version };
  }

  issueDraft(actor: AdminActor, id: string, dto: IssueSupplierProblemDto, traceId: string, key?: string) {
    this.internal(actor);
    const organizationId = this.scope(actor);
    return this.prisma.$transaction(async (transaction) => {
      await assertActiveAuthentication(transaction, actor);
      await assertAdminAccess(transaction, actor, organizationId, 'supplier-quality:problems:write');
      if (!key || !/^[a-zA-Z0-9._:-]{8,128}$/.test(key)) adminError('IDEMPOTENCY_KEY_REQUIRED', 400);
      let record = await transaction.supplierQualityProblem.findFirst({ where: { id, ownerOrganizationId: organizationId }, include: problemInclude });
      if (!record) adminError('SUPPLIER_RECORD_NOT_FOUND', 404);
      if (await this.controlled(transaction, record.id)) adminError('SUPPLIER_DRAFT_LOCKED', 409);
      if (record.problemIndexId && !record.workflowBindingId) adminError('SUPPLIER_DRAFT_LOCKED', 409);
      if (!record.problemIndexId && record.version !== dto.expectedVersion) adminError('CONCURRENCY_CONFLICT', 409);
      if (record.replyMode === 'SUPPLIER') {
        const profile = await this.collaborationProfile(transaction, organizationId, record.profileId);
        if (record.supplierOrganizationId && record.supplierOrganizationId !== profile.supplierOrganizationId) adminError('CONCURRENCY_CONFLICT', 409);
        if (!record.supplierOrganizationId) {
          if (record.problemIndexId || record.releasedToSupplierAt) adminError('CONCURRENCY_CONFLICT', 409);
          record = await transaction.supplierQualityProblem.update({ where: { id: record.id }, data: { supplierOrganizationId: profile.supplierOrganizationId }, include: problemInclude });
        }
      }
      const issuedRecord = record;
      const binding = await this.bindings.resolve(transaction, organizationId, { severity: record.severity as never, responseForm: record.responseForm as never, replyMode: record.replyMode as never });
      if (binding.controlledEightD) adminError('SUPPLIER_DRAFT_LOCKED', 409);
      const problemIndex = await this.indexes.createFromDomain(transaction as never, {
        organizationId, domainCode: 'supplier-quality', problemType: record.responseForm, sourceType: 'supplier-quality', sourceId: record.id,
        severity: record.severity, ...(record.supplierOrganizationId ? { responsibleParty: record.supplierOrganizationId } : {}), ownerId: actor.id,
        dueAt: new Date(Date.now() + binding.responseSlaMinutes * 60_000), createdById: actor.id, traceId,
      });
      await this.runtime.startInstance({
        organizationId, actor, problemIndexId: String(problemIndex.id), workflowDefinitionId: binding.workflowDefinitionId,
        workflowVersionId: binding.workflowVersionId, expectedProblemVersion: record.problemIndexId ? Number(problemIndex.version) - 1 : Number(problemIndex.version), instanceKey: record.id,
        idempotencyKey: key, traceId, commandPayload: { supplierIssueExpectedVersion: dto.expectedVersion },
      }, transaction, undefined, async (tx, context) => {
        const current = await tx.supplierQualityProblem.findFirst({ where: { id: issuedRecord.id, ownerOrganizationId: organizationId } });
        if (!current) adminError('SUPPLIER_RECORD_NOT_FOUND', 404);
        if (current.problemIndexId === String(problemIndex.id) && current.workflowBindingId === binding.bindingId && current.workflowBindingVersion === binding.bindingVersion) return;
        if (context.replay || current.workflowBindingId) adminError('CONCURRENCY_CONFLICT', 409);
        const changed = await tx.supplierQualityProblem.updateMany({ where: { id: issuedRecord.id, ownerOrganizationId: organizationId, problemIndexId: null, version: dto.expectedVersion, workflowBindingId: null }, data: { problemIndexId: String(problemIndex.id), workflowBindingId: binding.bindingId, workflowBindingVersion: binding.bindingVersion, version: { increment: 1 } } });
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
      if (await this.controlled(transaction, record.id)) adminError('SUPPLIER_DRAFT_LOCKED', 409);
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
      if (await this.controlled(transaction, record.id)) adminError('SUPPLIER_DRAFT_LOCKED', 409);
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

  // Keep controlled read eligibility ahead of count/page selection, without changing legacy write permissions.
  private readScope(actor: AdminActor, portal: boolean, granted: string[]): Prisma.Sql {
    const scope = portal
      ? Prisma.sql`supplier.supplier_organization_id = ${actor.organizationId}::uuid AND supplier.reply_mode = 'SUPPLIER'
          AND supplier.released_to_supplier_at IS NOT NULL AND supplier.problem_index_id IS NOT NULL`
      : Prisma.sql`supplier.owner_organization_id = ${this.scope(actor)}::uuid`;
    const controlledAccess = portal
      ? Prisma.sql`problem.archived_at IS NULL AND problem.status <> 'ARCHIVED'`
      : Prisma.sql`${granted.includes('supplier-quality:issues:read')} AND control.organization_id = ${actor.organizationId}::uuid`;
    return Prisma.sql`${scope} AND (
      NOT EXISTS (SELECT 1 FROM supplier_eight_d_controls control
        WHERE control.supplier_problem_id = supplier.id OR control.problem_index_id = supplier.problem_index_id)
      OR EXISTS (SELECT 1 FROM supplier_eight_d_controls control
        JOIN problem_indexes problem ON problem.id = control.problem_index_id AND problem.organization_id = control.organization_id
        JOIN organizations owner ON owner.id = control.organization_id AND owner.type = 'INTERNAL' AND owner.status = 'ACTIVE'
        JOIN supplier_business_profiles profile ON profile.id = supplier.profile_id AND profile.owner_organization_id = owner.id
          AND profile.supplier_organization_id IS NOT DISTINCT FROM supplier.supplier_organization_id
        WHERE control.supplier_problem_id = supplier.id AND control.organization_id = supplier.owner_organization_id
          AND problem.id = supplier.problem_index_id AND problem.source_id = supplier.id
          AND problem.domain_code = 'supplier-quality' AND problem.source_type = 'supplier-quality'
          AND problem.problem_type = 'EIGHT_D' AND supplier.response_form = 'EIGHT_D' AND ${controlledAccess})
    )`;
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
    if (await this.controlled(transaction, record.id)) return false;
    const index = await transaction.problemIndex.findFirst({ where: { id: record.problemIndexId, organizationId: record.ownerOrganizationId, archivedAt: null }, select: { status: true, workflowInstanceId: true } });
    if (!index || !['OPEN', 'IN_PROGRESS', 'PENDING'].includes(String(index.status)) || !index.workflowInstanceId) return false;
    const instance = await transaction.workflowInstance.findFirst({ where: { id: index.workflowInstanceId, organizationId: record.ownerOrganizationId }, select: { currentNodeId: true, workflowVersionId: true } });
    if (!instance?.currentNodeId) return false;
    const node = await transaction.workflowNode.findFirst({ where: { id: instance.currentNodeId, organizationId: record.ownerOrganizationId, workflowVersionId: instance.workflowVersionId }, select: { type: true, config: true } });
    return node?.type === 'ACTION' && jsonObject(jsonObject(node.config).assignment).permission === 'supplier-quality:responses:write';
  }

  private async controlled(transaction: AdminTransaction, id: string): Promise<boolean> {
    const [record] = await transaction.$queryRaw<{ id: string }[]>`SELECT supplier_problem_id AS id FROM supplier_eight_d_controls WHERE supplier_problem_id = ${id}::uuid`;
    return !!record;
  }

  private async serialize(transaction: AdminTransaction, actor: AdminActor, record: ProblemRecord, granted: string[], controlled?: boolean): Promise<SupplierProblemDto> {
    const completeEightD = controlled ?? await this.controlled(transaction, record.id);
    const completeRoute = completeEightD || !record.problemIndexId && await this.bindings.controlledDraft(transaction, record.ownerOrganizationId,
      { severity: record.severity as SupplierProblemDraftDto['severity'], responseForm: record.responseForm as SupplierProblemDraftDto['responseForm'], replyMode: record.replyMode as SupplierProblemDraftDto['replyMode'] });
    const index = record.problemIndexId ? await this.indexes.findById(record.problemIndexId, record.ownerOrganizationId, transaction as never) : null;
    const ownReply = record.replyMode === 'INTERNAL' ? actor.accountType === 'INTERNAL' && actor.id === record.internalResponderId : actor.accountType === 'SUPPLIER' && actor.organizationId === record.supplierOrganizationId && !!record.releasedToSupplierAt;
    return {
      id: record.id, organizationId: record.ownerOrganizationId, profileId: record.profileId, supplierOrganizationId: record.supplierOrganizationId, supplierName: record.profile.displayName,
      title: record.title, materialCode: record.materialCode, ...(record.materialCategory ? { materialCategory: record.materialCategory as 'STRUCTURE' | 'ELECTRONIC' } : {}),
      defectDescription: record.defectDescription, defectQuantity: record.defectQuantity, severity: record.severity as SupplierProblemDto['severity'], responseForm: record.responseForm as SupplierProblemDto['responseForm'], replyMode: record.replyMode as SupplierProblemDto['replyMode'],
      ...(record.internalResponderId ? { internalResponderId: record.internalResponderId } : {}), version: record.version, updatedAt: record.updatedAt.toISOString(), stage: record.problemIndexId ? 'ISSUED' : 'DRAFT',
      ...(index ? { ...(actor.accountType === 'INTERNAL' ? { problemIndexId: String(index.id) } : {}), reportNumber: String(index.reportNumber), problemStatus: String(index.status) as SupplierProblemDto['problemStatus'], ...(index.dueAt instanceof Date ? { dueAt: index.dueAt.toISOString() } : {}) } : {}),
      canEditFacts: actor.accountType === 'INTERNAL' && !record.problemIndexId && granted.includes('supplier-quality:problems:write'),
      canEditResponse: !completeRoute && ownReply && granted.includes('supplier-quality:responses:write') && await this.openForDraft(transaction, record),
      responseDraft: (completeRoute ? {} : record.responseDraft?.content ?? {}) as SupplierProblemDto['responseDraft'],
      ...(completeRoute ? { controlledEightD: true } : {}),
    };
  }

  private async serializeDetail(transaction: AdminTransaction, actor: AdminActor, record: ProblemRecord, granted: string[], query: SupplierProblemDetailQueryDto): Promise<SupplierProblemDto> {
    const result = await this.serialize(transaction, actor, record, granted);
    if (result.controlledEightD) return result;
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
