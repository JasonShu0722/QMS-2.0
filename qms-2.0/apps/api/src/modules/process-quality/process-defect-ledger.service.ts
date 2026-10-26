import { HttpException, Injectable, Optional } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Prisma, type ProcessDefect } from '../../generated/prisma/client.js';
import { PrismaService } from '../../database/prisma.service.js';
import { AdminMutationService, adminPermissions, assertAdminAccess, type AdminActor, type AdminTransaction } from '../../common/security/admin-mutation.service.js';
import { assertActiveAuthentication } from '../../common/security/session-security.js';
import { effectivePositionAssignmentWhere } from '../../common/security/effective-role-grants.js';
import { AuditLogService } from '../audit-log/audit-log.service.js';
import type { DomainSourceRecord, DomainSourceReference } from '../problem-index/domain-source-issue.service.js';
import { ComponentProjectService } from '../platform-configuration/component-project.service.js';
import { SupplierQualityService } from '../supplier-quality/supplier-quality.service.js';

export const PROCESS_RESPONSIBILITY_CATEGORIES = ['MATERIAL', 'OPERATION', 'EQUIPMENT', 'PROCESS', 'DESIGN', 'FALSE_POSITIVE'] as const;
export const PROCESS_MATERIAL_VERIFICATIONS = ['UNREVIEWED', 'CONFIRMED_DEFECT', 'NOT_MATERIAL', 'NEGOTIATED', 'RETURN_ANALYSIS'] as const;
export type ProcessMaterialVerification = (typeof PROCESS_MATERIAL_VERIFICATIONS)[number];
export type ProcessLedgerStatus = 'FOLLOWING' | 'CLOSED';
export type ProcessResponsibilityCategory = (typeof PROCESS_RESPONSIBILITY_CATEGORIES)[number];
export type ProcessExternalSourceSystem = 'MES' | 'IMS';
export type ProcessIngestionStatus = 'PENDING_VERIFICATION';

// A future verified adapter may map an external payload to these fields. No live client is registered.
export interface ProcessDefectSourceAdapter<ExternalRecord> {
  readonly system: ProcessExternalSourceSystem;
  map(record: ExternalRecord): ProcessDefectInput & { externalSourceSystem: ProcessExternalSourceSystem; externalRecordKey: string; sourceObservedAt: Date };
}

export interface ProcessDefectInput {
  defectTypeCode?: string | null;
  description?: string;
  defectQuantity?: number | null;
  occurredAt?: Date | null;
  batchCode?: string | null;
  workOrderCode?: string | null;
  operationCode?: string | null;
  lineCode?: string | null;
  projectCode?: string | null;
  productCode?: string | null;
  materialCode?: string | null;
  supplierOrganizationId?: string | null;
  responsibilityCategory?: ProcessResponsibilityCategory | null;
  traceCode?: string | null;
  analysisProgress?: string | null;
  materials?: ProcessDefectMaterialInput[];
  externalSourceSystem?: ProcessExternalSourceSystem | null;
  externalRecordKey?: string | null;
  sourceObservedAt?: Date | null;
}

export interface ProcessDefectMaterialInput {
  id?: string;
  materialCode?: string | null;
  materialName?: string | null;
  supplierOrganizationId?: string | null;
  supplierProfileId?: string | null;
  materialBatch?: string | null;
  sqeUserId?: string | null;
  notes?: string | null;
}

export interface ProcessDefectMaterial extends Omit<Required<ProcessDefectMaterialInput>, 'id'> {
  id: string;
  organizationId: string;
  defectId: string;
  position: number;
  verification: ProcessMaterialVerification;
  verificationNotes: string | null;
  verifiedById: string | null;
  verifiedAt: Date | null;
  verificationHistory: ProcessMaterialVerificationHistory[];
}

export interface ProcessMaterialVerificationHistory {
  id: string;
  materialItemId: string;
  verification: Exclude<ProcessMaterialVerification, 'UNREVIEWED'>;
  verificationNotes: string | null;
  actorUserId: string;
  recordedAt: Date;
  defectVersion: number;
  materialSnapshot: ProcessDefectMaterialInput;
}

export interface ProcessLedgerHistory {
  id: string;
  fromStatus: ProcessLedgerStatus;
  toStatus: ProcessLedgerStatus;
  actorUserId: string;
  reason: string | null;
  recordedAt: Date;
  defectVersion: number;
}

export interface ProcessDefectQuery {
  page: number;
  pageSize: number;
  search?: string;
  defectTypeCode?: string;
  batchCode?: string;
  workOrderCode?: string;
  operationCode?: string;
  lineCode?: string;
  projectCode?: string;
  productCode?: string;
  materialCode?: string;
  responsibilityCategory?: ProcessResponsibilityCategory;
  ledgerStatus?: ProcessLedgerStatus;
  traceCode?: string;
  includeArchived?: boolean;
}

function reject(code: string, status: number): never {
  throw new HttpException({ code, message: code }, status);
}

function required(value: string, maximum: number): string {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  if (!trimmed || trimmed.length > maximum) reject('PROCESS_DEFECT_INPUT_INVALID', 400);
  return trimmed;
}

function optional(value: string | null | undefined, maximum: number): string | null {
  if (value == null) return null;
  if (typeof value !== 'string') reject('PROCESS_DEFECT_INPUT_INVALID', 400);
  return !value.trim() ? null : required(value, maximum);
}

function uuid(value: string): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) reject('PROCESS_DEFECT_INPUT_INVALID', 400);
  return value.toLowerCase();
}

function version(value: number) {
  if (!Number.isSafeInteger(value) || value < 1 || value > 2147483647) reject('PROCESS_DEFECT_INPUT_INVALID', 400);
  return value;
}

export function normalizeProcessDefectFacts(input: ProcessDefectInput) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) reject('PROCESS_DEFECT_INPUT_INVALID', 400);
  if (input.defectQuantity != null && (!Number.isSafeInteger(input.defectQuantity) || input.defectQuantity < 1 || input.defectQuantity > 2147483647)) reject('PROCESS_DEFECT_INPUT_INVALID', 400);
  if (input.occurredAt != null && (!(input.occurredAt instanceof Date) || Number.isNaN(input.occurredAt.getTime()))) reject('PROCESS_DEFECT_INPUT_INVALID', 400);
  if (input.responsibilityCategory != null && !PROCESS_RESPONSIBILITY_CATEGORIES.includes(input.responsibilityCategory)) reject('PROCESS_DEFECT_INPUT_INVALID', 400);
  if (input.description !== undefined && (typeof input.description !== 'string' || input.description.length > 10000)) reject('PROCESS_DEFECT_INPUT_INVALID', 400);
  const { externalSourceSystem, externalRecordKey, sourceObservedAt } = input;
  if ([externalSourceSystem, externalRecordKey, sourceObservedAt].some(value => value != null) &&
    (!['MES', 'IMS'].includes(externalSourceSystem ?? '') || typeof externalRecordKey !== 'string' || !externalRecordKey.trim() || !(sourceObservedAt instanceof Date) || Number.isNaN(sourceObservedAt.getTime()))) reject('PROCESS_DEFECT_EXTERNAL_IDENTITY_INVALID', 400);
  return {
    defectTypeCode: optional(input.defectTypeCode, 64)?.toUpperCase() ?? null, description: input.description?.trim() ?? '',
    defectQuantity: input.defectQuantity ?? null, occurredAt: input.occurredAt ?? null,
    batchCode: optional(input.batchCode, 100), workOrderCode: optional(input.workOrderCode, 100), operationCode: optional(input.operationCode, 100), lineCode: optional(input.lineCode, 100),
    projectCode: optional(input.projectCode, 100), productCode: optional(input.productCode, 100), traceCode: optional(input.traceCode, 200), analysisProgress: optional(input.analysisProgress, 10000),
    responsibilityCategory: input.responsibilityCategory ?? null,
    externalSourceSystem: externalSourceSystem ?? null, externalRecordKey: optional(externalRecordKey, 200), sourceObservedAt: sourceObservedAt ?? null,
  };
}

const materialFields = ['id', 'materialCode', 'materialName', 'supplierOrganizationId', 'supplierProfileId', 'materialBatch', 'sqeUserId', 'notes'] as const;

export function normalizeProcessDefectMaterials(items: ProcessDefectMaterialInput[]) {
  if (!Array.isArray(items) || items.length > 100) reject('PROCESS_DEFECT_MATERIALS_INVALID', 400);
  const normalized = items.map(item => {
    if (!item || typeof item !== 'object' || Array.isArray(item) || Object.keys(item).some(key => !(materialFields as readonly string[]).includes(key))) reject('PROCESS_DEFECT_MATERIALS_INVALID', 400);
    const row = {
      ...(item.id === undefined ? {} : { id: uuid(item.id) }), materialCode: optional(item.materialCode, 100), materialName: optional(item.materialName, 200),
      supplierOrganizationId: item.supplierOrganizationId == null ? null : uuid(item.supplierOrganizationId), supplierProfileId: item.supplierProfileId == null ? null : uuid(item.supplierProfileId),
      materialBatch: optional(item.materialBatch, 100), sqeUserId: item.sqeUserId == null ? null : uuid(item.sqeUserId), notes: optional(item.notes, 2000),
    };
    return row;
  }).filter(item => Object.entries(item).some(([key, value]) => key !== 'id' && value !== null));
  const ids = normalized.flatMap(item => item.id ? [item.id] : []);
  if (new Set(ids).size !== ids.length) reject('PROCESS_DEFECT_MATERIALS_INVALID', 400);
  return normalized;
}

export function processMaterialIdentityChanged(previous: ProcessDefectMaterialInput, next: ProcessDefectMaterialInput): boolean {
  const previousOrganization = previous.supplierOrganizationId?.toLowerCase() ?? null;
  const nextOrganization = next.supplierOrganizationId?.toLowerCase() ?? null;
  const previousProfile = previous.supplierProfileId?.toLowerCase() ?? null;
  const nextProfile = next.supplierProfileId?.toLowerCase() ?? null;
  // A shared profile bridges a missing organization mapping; never compare IDs across fields.
  const sameSupplier = previousOrganization && nextOrganization ? previousOrganization === nextOrganization
    : previousProfile && nextProfile ? previousProfile === nextProfile
    : previousOrganization === nextOrganization && previousProfile === nextProfile;
  return (['materialCode', 'materialName', 'materialBatch'] as const).some(field => (previous[field] ?? null) !== (next[field] ?? null))
    || !sameSupplier;
}

const materialColumns = Prisma.sql`id, organization_id AS "organizationId", defect_id AS "defectId", position, material_code AS "materialCode", material_name AS "materialName",
  supplier_organization_id AS "supplierOrganizationId", supplier_profile_id AS "supplierProfileId", material_batch AS "materialBatch", sqe_user_id AS "sqeUserId", notes,
  verification, verification_notes AS "verificationNotes", verified_by_id AS "verifiedById", verified_at AS "verifiedAt"`;

@Injectable()
export class ProcessDefectLedgerService {
  constructor(private readonly prisma: PrismaService, private readonly mutations: AdminMutationService, private readonly audit: AuditLogService,
    @Optional() private readonly projects?: ComponentProjectService, @Optional() private readonly suppliers?: SupplierQualityService) {}

  private scope(actor: AdminActor): string {
    if (actor.accountType !== 'INTERNAL') reject('ORGANIZATION_SCOPE_DENIED', 403);
    return actor.scopeOrganizationId ?? actor.organizationId;
  }

  async createDefectType(actor: AdminActor, input: { code: string; name: string }, traceId: string, key?: string) {
    const organizationId = this.scope(actor);
    const code = required(input.code, 64).toUpperCase();
    const name = required(input.name, 200);
    return this.mutations.run({ actor, organizationId, key, traceId, action: 'PROCESS_DEFECT_TYPE_CREATED', payload: { code, name }, permission: 'process-quality:defects:write' }, async (tx) => {
      const type = await tx.processDefectType.create({ data: { organizationId, code, name, createdById: actor.id } });
      await this.audit.record({ organizationId, actorUserId: actor.id, action: 'PROCESS_DEFECT_TYPE_CREATED', resourceType: 'ProcessDefectType', resourceId: type.id, outcome: 'SUCCESS', traceId }, tx);
      return type;
    });
  }

  async defectTypes(actor: AdminActor) {
    const organizationId = this.scope(actor);
    return this.prisma.$transaction(async (tx) => {
      await assertAdminAccess(tx, actor, organizationId, 'process-quality:defects:read');
      return tx.processDefectType.findMany({ where: { organizationId, active: true }, orderBy: { code: 'asc' } });
    });
  }

  async updateDefectType(actor: AdminActor, id: string, input: { expectedVersion: number; name: string; active: boolean }, traceId: string, key?: string) {
    const organizationId = this.scope(actor);
    if (!Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 1 || typeof input.active !== 'boolean') reject('PROCESS_DEFECT_INPUT_INVALID', 400);
    const name = required(input.name, 200);
    return this.mutations.run({ actor, organizationId, key, traceId, action: 'PROCESS_DEFECT_TYPE_UPDATED', payload: { id, expectedVersion: input.expectedVersion, name, active: input.active }, permission: 'process-quality:defects:write' }, async (tx) => {
      const changed = await tx.processDefectType.updateMany({ where: { id, organizationId, version: input.expectedVersion }, data: { name, active: input.active, version: { increment: 1 } } });
      if (changed.count !== 1) reject('CONCURRENCY_CONFLICT', 409);
      const type = await tx.processDefectType.findUniqueOrThrow({ where: { id } });
      await this.audit.record({ organizationId, actorUserId: actor.id, action: 'PROCESS_DEFECT_TYPE_UPDATED', resourceType: 'ProcessDefectType', resourceId: id, outcome: 'SUCCESS', traceId, metadata: { resourceVersion: type.version } }, tx);
      return type;
    }, async (tx) => {
      if (!(await tx.processDefectType.findFirst({ where: { id, organizationId } }))) reject('PROCESS_DEFECT_TYPE_NOT_FOUND', 404);
    });
  }

  async create(actor: AdminActor, input: ProcessDefectInput, traceId: string, key?: string) {
    const organizationId = this.scope(actor);
    this.validateInputFields(input);
    const facts = normalizeProcessDefectFacts(input);
    const materials = this.materialInput(input, []);
    if (materials?.some(item => item.id)) reject('PROCESS_DEFECT_MATERIALS_INVALID', 400);
    return this.mutations.run({ actor, organizationId, key, traceId, action: 'PROCESS_DEFECT_CREATED', payload: { ...facts, materials, occurredAt: facts.occurredAt?.toISOString() ?? null, sourceObservedAt: facts.sourceObservedAt?.toISOString() }, permission: 'process-quality:defects:write' }, async (tx) => {
      await this.validateReferences(tx, organizationId, facts);
      const record = await tx.processDefect.create({ data: { ...facts, organizationId, createdById: actor.id, updatedById: actor.id, sourceKind: 'MANUAL', ingestionStatus: facts.externalSourceSystem ? 'PENDING_VERIFICATION' : null } });
      await this.saveMaterials(tx, actor, record, materials ?? [], []);
      if (facts.externalSourceSystem && facts.externalRecordKey) {
        await tx.processDefectIngestionAudit.create({ data: { organizationId, defectId: record.id, externalSourceSystem: facts.externalSourceSystem, externalRecordKey: facts.externalRecordKey, status: 'PENDING_VERIFICATION', observedAt: facts.sourceObservedAt, recordedById: actor.id } });
      }
      await this.audit.record({ organizationId, actorUserId: actor.id, action: 'PROCESS_DEFECT_CREATED', resourceType: 'ProcessDefect', resourceId: record.id, outcome: 'SUCCESS', traceId, metadata: { resourceVersion: record.version } }, tx);
      return this.view(tx, await this.find(tx, organizationId, record.id));
    });
  }

  async update(actor: AdminActor, id: string, input: Partial<ProcessDefectInput> & { expectedVersion: number }, traceId: string, key?: string) {
    const organizationId = this.scope(actor);
    version(input.expectedVersion);
    this.validateInputFields(input);
    if (input.externalSourceSystem !== undefined || input.externalRecordKey !== undefined || input.sourceObservedAt !== undefined) reject('PROCESS_DEFECT_EXTERNAL_IDENTITY_IMMUTABLE', 409);
    normalizeProcessDefectFacts(input);
    return this.mutations.run({ actor, organizationId, key, traceId, action: 'PROCESS_DEFECT_UPDATED', payload: { id, ...input, occurredAt: input.occurredAt === undefined ? undefined : input.occurredAt?.toISOString() ?? null }, permission: 'process-quality:defects:write' }, async (tx) => {
      await this.lock(tx, organizationId, id);
      const existing = await this.find(tx, organizationId, id);
      if (existing.archivedAt) reject('PROCESS_DEFECT_ARCHIVED', 409);
      const changes = Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined));
      const facts = normalizeProcessDefectFacts({ ...existing, responsibilityCategory: existing.responsibilityCategory as ProcessResponsibilityCategory | null, externalSourceSystem: existing.externalSourceSystem as ProcessExternalSourceSystem | null, ...changes });
      if (facts.defectTypeCode !== existing.defectTypeCode) await this.validateReferences(tx, organizationId, facts);
      const previousMaterials = await this.materials(tx, organizationId, id);
      const materials = this.materialInput(input, previousMaterials);
      const changed = await tx.processDefect.updateMany({ where: { id, organizationId, version: input.expectedVersion, archivedAt: null }, data: { ...facts, updatedById: actor.id, version: { increment: 1 } } });
      if (changed.count !== 1) reject('CONCURRENCY_CONFLICT', 409);
      const record = await this.find(tx, organizationId, id);
      if (materials !== undefined) await this.saveMaterials(tx, actor, record, materials, previousMaterials);
      await this.classificationHistory(tx, actor, existing, record);
      await this.audit.record({ organizationId, actorUserId: actor.id, action: 'PROCESS_DEFECT_UPDATED', resourceType: 'ProcessDefect', resourceId: id, outcome: 'SUCCESS', traceId, metadata: { resourceVersion: record.version, previousResponsibilityCategory: existing.responsibilityCategory, responsibilityCategory: record.responsibilityCategory } }, tx);
      return this.view(tx, await this.find(tx, organizationId, id));
    }, async (tx) => { await this.find(tx, organizationId, id); });
  }

  async archive(actor: AdminActor, id: string, expectedVersion: number, traceId: string, key?: string) {
    const organizationId = this.scope(actor);
    if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1) reject('PROCESS_DEFECT_INPUT_INVALID', 400);
    return this.mutations.run({ actor, organizationId, key, traceId, action: 'PROCESS_DEFECT_ARCHIVED', payload: { id, expectedVersion }, permission: 'process-quality:defects:write' }, async (tx) => {
      const changed = await tx.processDefect.updateMany({ where: { id, organizationId, version: expectedVersion, archivedAt: null }, data: { archivedAt: new Date(), updatedById: actor.id, version: { increment: 1 } } });
      if (changed.count !== 1) reject('CONCURRENCY_CONFLICT', 409);
      const record = await this.find(tx, organizationId, id);
      await this.audit.record({ organizationId, actorUserId: actor.id, action: 'PROCESS_DEFECT_ARCHIVED', resourceType: 'ProcessDefect', resourceId: id, outcome: 'SUCCESS', traceId, metadata: { resourceVersion: record.version } }, tx);
      return this.view(tx, record);
    }, async (tx) => { await this.find(tx, organizationId, id); });
  }

  async close(actor: AdminActor, id: string, input: { expectedVersion: number; reason?: string | null }, traceId: string, key?: string) {
    return this.changeStatus(actor, id, input, 'CLOSED', traceId, key);
  }

  async reopen(actor: AdminActor, id: string, input: { expectedVersion: number; reason: string }, traceId: string, key?: string) {
    required(input.reason, 2000);
    return this.changeStatus(actor, id, input, 'FOLLOWING', traceId, key);
  }

  private async changeStatus(actor: AdminActor, id: string, input: { expectedVersion: number; reason?: string | null }, status: ProcessLedgerStatus, traceId: string, key?: string) {
    const organizationId = this.scope(actor);
    version(input.expectedVersion);
    const reason = status === 'FOLLOWING' ? required(input.reason ?? '', 2000) : optional(input.reason, 2000);
    const action = status === 'CLOSED' ? 'PROCESS_DEFECT_CLOSED' : 'PROCESS_DEFECT_REOPENED';
    return this.mutations.run({ actor, organizationId, key, traceId, action, payload: { id, expectedVersion: input.expectedVersion, reason }, permission: 'process-quality:defects:close' }, async tx => {
      await this.lock(tx, organizationId, id);
      const current = await this.find(tx, organizationId, id);
      if (current.archivedAt) reject('PROCESS_DEFECT_ARCHIVED', 409);
      if (current.ledgerStatus === status) reject('PROCESS_DEFECT_STATUS_CONFLICT', 409);
      const changed = await tx.processDefect.updateMany({ where: { id, organizationId, version: input.expectedVersion, archivedAt: null, ledgerStatus: current.ledgerStatus },
        data: { ledgerStatus: status, closedAt: status === 'CLOSED' ? new Date() : null, closedById: status === 'CLOSED' ? actor.id : null, updatedById: actor.id, version: { increment: 1 } } });
      if (changed.count !== 1) reject('CONCURRENCY_CONFLICT', 409);
      await tx.$executeRaw`INSERT INTO process_defect_ledger_history (id, organization_id, defect_id, from_status, to_status, actor_user_id, reason, defect_version)
        VALUES (${randomUUID()}::uuid, ${organizationId}::uuid, ${id}::uuid, ${current.ledgerStatus}, ${status}, ${actor.id}::uuid, ${reason}, ${input.expectedVersion + 1})`;
      await this.audit.record({ organizationId, actorUserId: actor.id, action, resourceType: 'ProcessDefect', resourceId: id, outcome: 'SUCCESS', traceId, metadata: { resourceVersion: input.expectedVersion + 1, status } }, tx);
      return this.view(tx, await this.find(tx, organizationId, id));
    }, async tx => { await this.find(tx, organizationId, id); });
  }

  async classify(actor: AdminActor, input: { sources: Array<{ defectId: string; expectedVersion: number }>; responsibilityCategory: ProcessResponsibilityCategory | null }, traceId: string, key?: string) {
    const organizationId = this.scope(actor);
    if (!Array.isArray(input.sources) || input.sources.length < 1 || input.sources.length > 100 ||
      (input.responsibilityCategory !== null && !PROCESS_RESPONSIBILITY_CATEGORIES.includes(input.responsibilityCategory))) reject('PROCESS_DEFECT_CLASSIFICATION_INVALID', 400);
    const sources = input.sources.map(item => {
      if (!item || typeof item !== 'object') reject('PROCESS_DEFECT_CLASSIFICATION_INVALID', 400);
      return { defectId: uuid(item.defectId), expectedVersion: version(item.expectedVersion) };
    });
    if (new Set(sources.map(item => item.defectId)).size !== sources.length) reject('PROCESS_DEFECT_CLASSIFICATION_INVALID', 400);
    return this.mutations.run({ actor, organizationId, key, traceId, action: 'PROCESS_DEFECTS_CLASSIFIED', payload: { sources, responsibilityCategory: input.responsibilityCategory }, permission: 'process-quality:defects:write' }, async tx => {
      const results = [];
      for (const source of [...sources].sort((a, b) => a.defectId.localeCompare(b.defectId))) {
        await this.lock(tx, organizationId, source.defectId);
        const current = await this.find(tx, organizationId, source.defectId);
        if (current.archivedAt) reject('PROCESS_DEFECT_ARCHIVED', 409);
        const changed = await tx.processDefect.updateMany({ where: { id: source.defectId, organizationId, version: source.expectedVersion, archivedAt: null }, data: { responsibilityCategory: input.responsibilityCategory, updatedById: actor.id, version: { increment: 1 } } });
        if (changed.count !== 1) reject('CONCURRENCY_CONFLICT', 409);
        const record = await this.find(tx, organizationId, source.defectId);
        await this.classificationHistory(tx, actor, current, record);
        await this.audit.record({ organizationId, actorUserId: actor.id, action: 'PROCESS_DEFECT_CLASSIFIED', resourceType: 'ProcessDefect', resourceId: record.id, outcome: 'SUCCESS', traceId, metadata: { resourceVersion: record.version, changedFields: ['responsibilityCategory'] } }, tx);
        results.push(await this.view(tx, record));
      }
      return { items: results.sort((a, b) => sources.findIndex(source => source.defectId === a.id) - sources.findIndex(source => source.defectId === b.id)) };
    }, async tx => { for (const source of sources) await this.find(tx, organizationId, source.defectId); });
  }

  async verifyMaterial(actor: AdminActor, id: string, materialId: string, input: { expectedVersion: number; verification: Exclude<ProcessMaterialVerification, 'UNREVIEWED'>; verificationNotes?: string | null }, traceId: string, key?: string) {
    const organizationId = this.scope(actor);
    version(input.expectedVersion);
    materialId = uuid(materialId);
    if (!(PROCESS_MATERIAL_VERIFICATIONS.slice(1) as readonly string[]).includes(input.verification)) reject('PROCESS_DEFECT_VERIFICATION_INVALID', 400);
    const verificationNotes = optional(input.verificationNotes, 2000);
    const designated = async (tx: AdminTransaction) => {
      await this.find(tx, organizationId, id);
      const material = (await this.materials(tx, organizationId, id)).find(item => item.id === materialId);
      if (!material) reject('PROCESS_DEFECT_MATERIAL_NOT_FOUND', 404);
      if (material.sqeUserId !== actor.id || !(await this.validSqe(tx, organizationId, actor.id))) reject('PROCESS_DEFECT_SQE_REQUIRED', 403);
      return material;
    };
    return this.mutations.run({ actor, organizationId, key, traceId, action: 'PROCESS_DEFECT_MATERIAL_VERIFIED', payload: { id, materialId, expectedVersion: input.expectedVersion, verification: input.verification, verificationNotes }, permission: 'process-quality:materials:review' }, async tx => {
      await this.lock(tx, organizationId, id);
      const material = await designated(tx);
      const changed = await tx.processDefect.updateMany({ where: { id, organizationId, version: input.expectedVersion, archivedAt: null }, data: { updatedById: actor.id, version: { increment: 1 } } });
      if (changed.count !== 1) reject('CONCURRENCY_CONFLICT', 409);
      await tx.$executeRaw`UPDATE process_defect_material_items SET verification = ${input.verification}, verification_notes = ${verificationNotes}, verified_by_id = ${actor.id}::uuid,
        verified_at = CURRENT_TIMESTAMP, updated_by_id = ${actor.id}::uuid, updated_at = CURRENT_TIMESTAMP WHERE id = ${materialId}::uuid AND organization_id = ${organizationId}::uuid AND defect_id = ${id}::uuid AND removed_at IS NULL`;
      await tx.$executeRaw`INSERT INTO process_defect_material_verifications (id, organization_id, defect_id, material_item_id, verification, verification_notes, actor_user_id, defect_version, material_snapshot)
        VALUES (${randomUUID()}::uuid, ${organizationId}::uuid, ${id}::uuid, ${materialId}::uuid, ${input.verification}, ${verificationNotes}, ${actor.id}::uuid, ${input.expectedVersion + 1}, ${JSON.stringify(this.editableMaterial(material))}::jsonb)`;
      await this.audit.record({ organizationId, actorUserId: actor.id, action: 'PROCESS_DEFECT_MATERIAL_VERIFIED', resourceType: 'ProcessDefect', resourceId: id, outcome: 'SUCCESS', traceId, metadata: { resourceVersion: input.expectedVersion + 1, status: input.verification } }, tx);
      return this.view(tx, await this.find(tx, organizationId, id));
    }, async tx => { await designated(tx); });
  }

  async materialSqes(actor: AdminActor, query: { page: number; pageSize: number; search?: string }) {
    const organizationId = this.scope(actor);
    if (!Number.isSafeInteger(query.page) || query.page < 1 || !Number.isSafeInteger(query.pageSize) || query.pageSize < 1 || query.pageSize > 100) reject('PROCESS_DEFECT_QUERY_INVALID', 400);
    return this.prisma.$transaction(async tx => {
      await assertActiveAuthentication(tx, actor);
      await assertAdminAccess(tx, actor, organizationId, 'process-quality:defects:read');
      const hasPermission = { permissions: { some: { permission: { code: 'process-quality:materials:review' } } } };
      const where: Prisma.UserWhereInput = { organizationId, accountType: 'INTERNAL', status: 'ACTIVE',
        AND: [{ OR: [{ userRoles: { some: { organizationId, role: hasPermission } } }, { positions: { some: { organizationId, ...effectivePositionAssignmentWhere(), position: { status: 'ACTIVE', department: { status: 'ACTIVE' }, roles: { some: { role: hasPermission } } } } } }] },
          ...(query.search ? [{ OR: [{ username: { contains: query.search, mode: 'insensitive' as const } }, { fullName: { contains: query.search, mode: 'insensitive' as const } }] }] : [])] };
      const [items, total] = await Promise.all([tx.user.findMany({ where, select: { id: true, username: true, fullName: true }, orderBy: [{ username: 'asc' }, { id: 'asc' }], skip: (query.page - 1) * query.pageSize, take: query.pageSize }), tx.user.count({ where })]);
      return { items, total, page: query.page, pageSize: query.pageSize };
    });
  }

  async list(actor: AdminActor, query: ProcessDefectQuery) {
    const organizationId = this.scope(actor);
    if (!Number.isSafeInteger(query.page) || query.page < 1 || !Number.isSafeInteger(query.pageSize) || query.pageSize < 1 || query.pageSize > 100) reject('PROCESS_DEFECT_QUERY_INVALID', 400);
    const defectTypeCode = query.defectTypeCode?.trim().toUpperCase();
    return this.prisma.$transaction(async (tx) => {
      await assertActiveAuthentication(tx, actor);
      await assertAdminAccess(tx, actor, organizationId, 'process-quality:defects:read');
      const materialMatches = query.materialCode ? await tx.$queryRaw<{ defectId: string }[]>`SELECT DISTINCT defect_id AS "defectId" FROM process_defect_material_items WHERE organization_id = ${organizationId}::uuid AND removed_at IS NULL AND material_code = ${query.materialCode}` : null;
      const where: Prisma.ProcessDefectWhereInput = {
        organizationId, ...(query.includeArchived ? {} : { archivedAt: null }),
        ...(defectTypeCode ? { defectTypeCode } : {}),
        ...(query.batchCode ? { batchCode: query.batchCode } : {}),
        ...(query.workOrderCode ? { workOrderCode: query.workOrderCode } : {}),
        ...(query.operationCode ? { operationCode: query.operationCode } : {}),
        ...(query.lineCode ? { lineCode: query.lineCode } : {}),
        ...(query.projectCode ? { projectCode: query.projectCode } : {}),
        ...(query.productCode ? { productCode: query.productCode } : {}),
        ...(materialMatches ? { id: { in: materialMatches.map(item => item.defectId) } } : {}),
        ...(query.responsibilityCategory ? { responsibilityCategory: query.responsibilityCategory } : {}),
        ...(query.ledgerStatus ? { ledgerStatus: query.ledgerStatus } : {}),
        ...(query.traceCode ? { traceCode: query.traceCode } : {}),
        ...(query.search ? { OR: [{ description: { contains: query.search, mode: 'insensitive' } }, { batchCode: { contains: query.search, mode: 'insensitive' } }, { workOrderCode: { contains: query.search, mode: 'insensitive' } }, { traceCode: { contains: query.search, mode: 'insensitive' } }] } : {}),
      };
      const [items, total] = await Promise.all([tx.processDefect.findMany({ where, orderBy: [{ occurredAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }, { id: 'desc' }], skip: (query.page - 1) * query.pageSize, take: query.pageSize }), tx.processDefect.count({ where })]);
      return { items: await Promise.all(items.map(item => this.view(tx, item))), total, page: query.page, pageSize: query.pageSize };
    }, { isolationLevel: 'RepeatableRead' });
  }

  async detail(actor: AdminActor, id: string) {
    const organizationId = this.scope(actor);
    return this.prisma.$transaction(async (tx) => {
      await assertActiveAuthentication(tx, actor);
      await assertAdminAccess(tx, actor, organizationId, 'process-quality:defects:read');
      const record = await this.find(tx, organizationId, id);
      const evidence = await tx.fileObject.findMany({ where: { organizationId, resourceType: 'process-defect', resourceId: id, status: 'AVAILABLE', scanStatus: 'CLEAN' }, select: { id: true, originalName: true, scanStatus: true, status: true } });
      return { ...await this.view(tx, record), evidence };
    }, { isolationLevel: 'RepeatableRead' });
  }

  async sourceReference(actor: AdminActor, id: string): Promise<DomainSourceReference> {
    const organizationId = this.scope(actor);
    return this.prisma.$transaction(async (tx) => {
      await assertActiveAuthentication(tx, actor);
      await assertAdminAccess(tx, actor, organizationId, 'process-quality:defects:read');
      const record = await this.find(tx, organizationId, id);
      return {
        sourceDomain: 'process-quality', sourceType: 'process-defect', sourceId: record.id,
        sourceVersion: record.version, sourceSnapshot: await this.snapshot(tx, record), createdBy: record.createdById,
      };
    }, { isolationLevel: 'RepeatableRead' });
  }

  async lockAndResolve(tx: AdminTransaction, source: DomainSourceReference): Promise<DomainSourceRecord | null> {
    if (source.sourceDomain !== 'process-quality' || source.sourceType !== 'process-defect') return null;
    await tx.$queryRaw`SELECT id FROM process_defects WHERE id = ${source.sourceId}::uuid FOR UPDATE`;
    const record = await tx.processDefect.findUnique({ where: { id: source.sourceId } });
    if (!record) return null;
    return { organizationId: record.organizationId, createdBy: record.createdById, sourceVersion: record.version, sourceSnapshot: await this.snapshot(tx, record), archivedAt: record.archivedAt };
  }

  private async snapshot(tx: AdminTransaction, record: ProcessDefect): Promise<Prisma.InputJsonObject> {
    const view = await this.view(tx, record);
    // Live mapping/duplicate hints can change without a source edit; they are not source-owned facts.
    return JSON.parse(JSON.stringify({ ...record, materialCode: view.materialCode, supplierOrganizationId: view.supplierOrganizationId, materials: view.materials,
      materialVerificationHistory: view.materialVerificationHistory, ledgerHistory: view.ledgerHistory, classificationHistory: view.classificationHistory })) as Prisma.InputJsonObject;
  }

  private async find(tx: AdminTransaction, organizationId: string, id: string) {
    const record = await tx.processDefect.findFirst({ where: { id, organizationId } });
    if (!record) reject('PROCESS_DEFECT_NOT_FOUND', 404);
    return record;
  }

  private async lock(tx: AdminTransaction, organizationId: string, id: string) {
    uuid(id);
    await tx.$queryRaw`SELECT id FROM process_defects WHERE organization_id = ${organizationId}::uuid AND id = ${id}::uuid FOR UPDATE`;
  }

  private validateInputFields(input: Partial<ProcessDefectInput>) {
    const allowed = ['organizationId', 'expectedVersion', 'defectTypeCode', 'description', 'defectQuantity', 'occurredAt', 'batchCode', 'workOrderCode', 'operationCode', 'lineCode', 'projectCode', 'productCode', 'materialCode', 'supplierOrganizationId', 'responsibilityCategory', 'traceCode', 'analysisProgress', 'materials', 'externalSourceSystem', 'externalRecordKey', 'sourceObservedAt'];
    if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(field => !allowed.includes(field))) reject('PROCESS_DEFECT_INPUT_INVALID', 400);
  }

  private editableMaterial(item: ProcessDefectMaterial): ProcessDefectMaterialInput {
    return { id: item.id, materialCode: item.materialCode, materialName: item.materialName, supplierOrganizationId: item.supplierOrganizationId,
      supplierProfileId: item.supplierProfileId, materialBatch: item.materialBatch, sqeUserId: item.sqeUserId, notes: item.notes };
  }

  private materialInput(input: Partial<ProcessDefectInput>, previous: ProcessDefectMaterial[]) {
    const legacy = input.materialCode !== undefined || input.supplierOrganizationId !== undefined;
    if (input.materials !== undefined) {
      if (legacy) reject('PROCESS_DEFECT_MATERIAL_OWNERSHIP_CONFLICT', 400);
      if (!Array.isArray(input.materials)) reject('PROCESS_DEFECT_MATERIALS_INVALID', 400);
      return normalizeProcessDefectMaterials(input.materials.map(item => {
        if (!item || typeof item !== 'object') return item;
        const changes = Object.fromEntries(Object.entries(item).filter(([, value]) => value !== undefined));
        for (const field of ['id', 'supplierOrganizationId', 'supplierProfileId', 'sqeUserId'] as const) {
          if (changes[field] != null) changes[field] = uuid(changes[field] as string);
        }
        const old = changes.id ? previous.find(row => row.id === changes.id) : undefined;
        if (item.id !== undefined && !old) reject('PROCESS_DEFECT_MATERIAL_NOT_FOUND', 404);
        return { ...(old ? this.editableMaterial(old) : {}),
          ...(old && changes.supplierProfileId !== undefined && changes.supplierProfileId !== old.supplierProfileId && changes.supplierOrganizationId === undefined ? { supplierOrganizationId: null } : {}),
          ...(old && changes.supplierOrganizationId !== undefined && changes.supplierOrganizationId !== old.supplierOrganizationId && changes.supplierProfileId === undefined ? { supplierProfileId: null } : {}),
          ...changes };
      }));
    }
    if (!legacy) return undefined;
    const [first, ...rest] = previous.map(item => this.editableMaterial(item));
    const supplierOrganizationId = input.supplierOrganizationId == null ? input.supplierOrganizationId : uuid(input.supplierOrganizationId);
    return normalizeProcessDefectMaterials([{ ...first, ...(input.materialCode === undefined ? {} : { materialCode: input.materialCode }),
      ...(supplierOrganizationId === undefined ? {} : { supplierOrganizationId,
        ...(supplierOrganizationId !== first?.supplierOrganizationId ? { supplierProfileId: null } : {}) }) }, ...rest]);
  }

  private async validSqe(tx: AdminTransaction, organizationId: string, id: string) {
    const user = await tx.user.findFirst({ where: { id, organizationId, status: 'ACTIVE', accountType: 'INTERNAL' }, select: { id: true } });
    return !!user && (await adminPermissions(tx, id, organizationId)).includes('process-quality:materials:review');
  }

  private async materials(tx: AdminTransaction, organizationId: string, defectId: string, history?: ProcessMaterialVerificationHistory[]): Promise<ProcessDefectMaterial[]> {
    const items = await tx.$queryRaw<ProcessDefectMaterial[]>(Prisma.sql`SELECT ${materialColumns} FROM process_defect_material_items
      WHERE organization_id = ${organizationId}::uuid AND defect_id = ${defectId}::uuid AND removed_at IS NULL ORDER BY position, id`);
    const entries = history ?? await this.materialVerificationHistory(tx, organizationId, defectId);
    return items.map(item => ({ ...item, verificationHistory: entries.filter(entry => entry.materialItemId === item.id) }));
  }

  private materialVerificationHistory(tx: AdminTransaction, organizationId: string, defectId: string) {
    return tx.$queryRaw<ProcessMaterialVerificationHistory[]>`SELECT id, material_item_id AS "materialItemId", verification,
      verification_notes AS "verificationNotes", actor_user_id AS "actorUserId", recorded_at AS "recordedAt", defect_version AS "defectVersion", material_snapshot AS "materialSnapshot"
      FROM process_defect_material_verifications WHERE organization_id = ${organizationId}::uuid AND defect_id = ${defectId}::uuid ORDER BY defect_version, id`;
  }

  private async saveMaterials(tx: AdminTransaction, actor: AdminActor, record: ProcessDefect, items: ReturnType<typeof normalizeProcessDefectMaterials>, previous: ProcessDefectMaterial[]) {
    for (const item of items) {
      const old = item.id ? previous.find(row => row.id === item.id) : undefined;
      if (item.id && !old) reject('PROCESS_DEFECT_MATERIAL_NOT_FOUND', 404);
      if (item.sqeUserId && item.sqeUserId !== old?.sqeUserId && !(await this.validSqe(tx, record.organizationId, item.sqeUserId))) reject('PROCESS_DEFECT_SQE_INVALID', 400);
      if (item.supplierProfileId && (item.supplierProfileId !== old?.supplierProfileId || item.supplierOrganizationId !== old?.supplierOrganizationId)) {
        if (!this.suppliers) reject('PROCESS_DEFECT_SUPPLIER_SERVICE_REQUIRED', 503);
        const profile = await this.suppliers.performanceProfile(tx, record.organizationId, item.supplierProfileId);
        if (item.supplierOrganizationId && profile.supplierOrganizationId !== item.supplierOrganizationId) reject('PROCESS_DEFECT_SUPPLIER_INVALID', 400);
      }
      if (item.supplierOrganizationId && item.supplierOrganizationId !== old?.supplierOrganizationId) {
        const supplier = await tx.organization.findFirst({ where: { id: item.supplierOrganizationId, type: 'SUPPLIER', status: 'ACTIVE' }, select: { id: true } });
        if (!supplier) reject('PROCESS_DEFECT_SUPPLIER_INVALID', 400);
      }
    }
    // Soft removal keeps each SQE conclusion attached to its historical material identity.
    const ids = items.flatMap(item => item.id ? [item.id] : []);
    await tx.$executeRaw(Prisma.sql`UPDATE process_defect_material_items SET removed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP, updated_by_id = ${actor.id}::uuid
      WHERE organization_id = ${record.organizationId}::uuid AND defect_id = ${record.id}::uuid AND removed_at IS NULL ${ids.length ? Prisma.sql`AND id NOT IN (${Prisma.join(ids.map(id => Prisma.sql`${id}::uuid`))})` : Prisma.empty}`);
    for (const [position, item] of items.entries()) {
      if (item.id) {
        const old = previous.find(row => row.id === item.id)!;
        // A conclusion describes the reviewed facts, not a reusable material row id; its history stays immutable.
        const resetReview = processMaterialIdentityChanged(old, item)
          ? Prisma.sql`verification = 'UNREVIEWED', verification_notes = NULL, verified_by_id = NULL, verified_at = NULL,` : Prisma.empty;
        await tx.$executeRaw(Prisma.sql`UPDATE process_defect_material_items SET position = ${position}, material_code = ${item.materialCode}, material_name = ${item.materialName},
          supplier_organization_id = ${item.supplierOrganizationId}::uuid, supplier_profile_id = ${item.supplierProfileId}::uuid, material_batch = ${item.materialBatch},
          sqe_user_id = ${item.sqeUserId}::uuid, notes = ${item.notes}, ${resetReview} updated_by_id = ${actor.id}::uuid, updated_at = CURRENT_TIMESTAMP
          WHERE id = ${item.id}::uuid AND organization_id = ${record.organizationId}::uuid AND defect_id = ${record.id}::uuid AND removed_at IS NULL`);
      } else {
        await tx.$executeRaw`INSERT INTO process_defect_material_items (id, organization_id, defect_id, position, material_code, material_name, supplier_organization_id, supplier_profile_id, material_batch, sqe_user_id, notes, created_by_id, updated_by_id)
          VALUES (${randomUUID()}::uuid, ${record.organizationId}::uuid, ${record.id}::uuid, ${position}, ${item.materialCode}, ${item.materialName}, ${item.supplierOrganizationId}::uuid,
            ${item.supplierProfileId}::uuid, ${item.materialBatch}, ${item.sqeUserId}::uuid, ${item.notes}, ${actor.id}::uuid, ${actor.id}::uuid)`;
      }
    }
  }

  private async classificationHistory(tx: AdminTransaction, actor: AdminActor, previous: ProcessDefect, record: ProcessDefect) {
    if (previous.responsibilityCategory === record.responsibilityCategory) return;
    await tx.$executeRaw`INSERT INTO process_defect_classification_history (id, organization_id, defect_id, previous_category, category, actor_user_id, defect_version)
      VALUES (${randomUUID()}::uuid, ${record.organizationId}::uuid, ${record.id}::uuid, ${previous.responsibilityCategory}, ${record.responsibilityCategory}, ${actor.id}::uuid, ${record.version})`;
  }

  private async view(tx: AdminTransaction, record: ProcessDefect) {
    const materialVerificationHistory = await this.materialVerificationHistory(tx, record.organizationId, record.id);
    const materials = await this.materials(tx, record.organizationId, record.id, materialVerificationHistory);
    if (record.productCode && !this.projects) reject('PROCESS_DEFECT_MAPPING_SERVICE_REQUIRED', 503);
    const componentProject = record.productCode && this.projects ? await this.projects.resolveForDomain(tx, record.organizationId, record.productCode) : null;
    const duplicateCount = record.traceCode && record.operationCode ? await tx.processDefect.count({ where: { organizationId: record.organizationId,
      id: { not: record.id }, traceCode: record.traceCode, operationCode: record.operationCode, archivedAt: null } }) : 0;
    const issues = [
      ...(!record.description.trim() ? ['DESCRIPTION_EMPTY'] : []), ...(record.defectTypeCode === null ? ['DEFECT_TYPE_UNKNOWN'] : []),
      ...(record.defectQuantity === null ? ['DEFECT_QUANTITY_UNKNOWN'] : []), ...(record.occurredAt === null ? ['OCCURRED_AT_UNKNOWN'] : []),
      ...(duplicateCount ? ['SAME_OPERATION_TRACE_DUPLICATE'] : []), ...(componentProject?.issues ?? []),
      ...(record.projectCode && componentProject?.project && record.projectCode !== componentProject.project.code ? ['MANUAL_PROJECT_DIFFERS'] : []),
    ];
    const ledgerHistory = await tx.$queryRaw<ProcessLedgerHistory[]>`SELECT id, from_status AS "fromStatus", to_status AS "toStatus", actor_user_id AS "actorUserId", reason,
      recorded_at AS "recordedAt", defect_version AS "defectVersion" FROM process_defect_ledger_history WHERE organization_id = ${record.organizationId}::uuid AND defect_id = ${record.id}::uuid ORDER BY defect_version, id`;
    const classificationHistory = await tx.$queryRaw<Array<{ id: string; previousCategory: ProcessResponsibilityCategory | null; category: ProcessResponsibilityCategory | null; actorUserId: string; recordedAt: Date; defectVersion: number }>>`SELECT id, previous_category AS "previousCategory", category,
      actor_user_id AS "actorUserId", recorded_at AS "recordedAt", defect_version AS "defectVersion" FROM process_defect_classification_history WHERE organization_id = ${record.organizationId}::uuid AND defect_id = ${record.id}::uuid ORDER BY defect_version, id`;
    return { ...record, materialCode: materials[0]?.materialCode ?? null, supplierOrganizationId: materials[0]?.supplierOrganizationId ?? null,
      materials, materialVerificationHistory, ledgerHistory, classificationHistory, componentProject, duplicateCount, issues };
  }

  private async validateReferences(tx: AdminTransaction, organizationId: string, facts: ReturnType<typeof normalizeProcessDefectFacts>) {
    if (facts.defectTypeCode) {
      const type = await tx.processDefectType.findUnique({ where: { organizationId_code: { organizationId, code: facts.defectTypeCode } } });
      if (!type?.active) reject('PROCESS_DEFECT_TYPE_NOT_FOUND', 400);
    }
  }
}
