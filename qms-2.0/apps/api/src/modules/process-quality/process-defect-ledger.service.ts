import { HttpException, Injectable } from '@nestjs/common';
import type { Prisma, ProcessDefect } from '../../generated/prisma/client.js';
import { PrismaService } from '../../database/prisma.service.js';
import { AdminMutationService, assertAdminAccess, type AdminActor, type AdminTransaction } from '../../common/security/admin-mutation.service.js';
import { AuditLogService } from '../audit-log/audit-log.service.js';
import type { DomainSourceRecord, DomainSourceReference } from '../problem-index/domain-source-issue.service.js';

export const PROCESS_RESPONSIBILITY_CATEGORIES = ['MATERIAL', 'OPERATION', 'EQUIPMENT', 'PROCESS', 'DESIGN'] as const;
export type ProcessResponsibilityCategory = (typeof PROCESS_RESPONSIBILITY_CATEGORIES)[number];
export type ProcessExternalSourceSystem = 'MES' | 'IMS';
export type ProcessIngestionStatus = 'PENDING_VERIFICATION';

// A future verified adapter may map an external payload to these fields. No live client is registered.
export interface ProcessDefectSourceAdapter<ExternalRecord> {
  readonly system: ProcessExternalSourceSystem;
  map(record: ExternalRecord): ProcessDefectInput & { externalSourceSystem: ProcessExternalSourceSystem; externalRecordKey: string; sourceObservedAt: Date };
}

export interface ProcessDefectInput {
  defectTypeCode: string;
  description: string;
  defectQuantity: number;
  occurredAt: Date;
  batchCode?: string | null;
  workOrderCode?: string | null;
  operationCode?: string | null;
  lineCode?: string | null;
  projectCode?: string | null;
  productCode?: string | null;
  materialCode?: string | null;
  supplierOrganizationId?: string | null;
  responsibilityCategory: ProcessResponsibilityCategory;
  externalSourceSystem?: ProcessExternalSourceSystem | null;
  externalRecordKey?: string | null;
  sourceObservedAt?: Date | null;
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
  includeArchived?: boolean;
}

function reject(code: string, status: number): never {
  throw new HttpException({ code, message: code }, status);
}

function required(value: string, maximum: number): string {
  const trimmed = value?.trim();
  if (!trimmed || trimmed.length > maximum) reject('PROCESS_DEFECT_INPUT_INVALID', 400);
  return trimmed;
}

function optional(value: string | null | undefined, maximum: number): string | null {
  return value == null || !value.trim() ? null : required(value, maximum);
}

@Injectable()
export class ProcessDefectLedgerService {
  constructor(private readonly prisma: PrismaService, private readonly mutations: AdminMutationService, private readonly audit: AuditLogService) {}

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
    const facts = await this.normalize(input);
    return this.mutations.run({ actor, organizationId, key, traceId, action: 'PROCESS_DEFECT_CREATED', payload: { ...facts, occurredAt: facts.occurredAt.toISOString(), sourceObservedAt: facts.sourceObservedAt?.toISOString() }, permission: 'process-quality:defects:write' }, async (tx) => {
      await this.validateReferences(tx, organizationId, facts);
      const record = await tx.processDefect.create({ data: { ...facts, organizationId, createdById: actor.id, updatedById: actor.id, sourceKind: 'MANUAL', ingestionStatus: facts.externalSourceSystem ? 'PENDING_VERIFICATION' : null } });
      if (facts.externalSourceSystem && facts.externalRecordKey) {
        await tx.processDefectIngestionAudit.create({ data: { organizationId, defectId: record.id, externalSourceSystem: facts.externalSourceSystem, externalRecordKey: facts.externalRecordKey, status: 'PENDING_VERIFICATION', observedAt: facts.sourceObservedAt, recordedById: actor.id } });
      }
      await this.audit.record({ organizationId, actorUserId: actor.id, action: 'PROCESS_DEFECT_CREATED', resourceType: 'ProcessDefect', resourceId: record.id, outcome: 'SUCCESS', traceId, metadata: { resourceVersion: record.version } }, tx);
      return record;
    });
  }

  async update(actor: AdminActor, id: string, input: Partial<ProcessDefectInput> & { expectedVersion: number }, traceId: string, key?: string) {
    const organizationId = this.scope(actor);
    if (!Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 1) reject('PROCESS_DEFECT_INPUT_INVALID', 400);
    if (input.externalSourceSystem !== undefined || input.externalRecordKey !== undefined || input.sourceObservedAt !== undefined) reject('PROCESS_DEFECT_EXTERNAL_IDENTITY_IMMUTABLE', 409);
    return this.mutations.run({ actor, organizationId, key, traceId, action: 'PROCESS_DEFECT_UPDATED', payload: { id, ...input, occurredAt: input.occurredAt?.toISOString() }, permission: 'process-quality:defects:write' }, async (tx) => {
      const existing = await this.find(tx, organizationId, id);
      if (existing.archivedAt) reject('PROCESS_DEFECT_ARCHIVED', 409);
      const changes = Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined));
      const facts = await this.normalize({ ...existing, responsibilityCategory: existing.responsibilityCategory as ProcessResponsibilityCategory, externalSourceSystem: existing.externalSourceSystem as ProcessExternalSourceSystem | null, ...changes });
      await this.validateReferences(tx, organizationId, facts);
      const changed = await tx.processDefect.updateMany({ where: { id, organizationId, version: input.expectedVersion, archivedAt: null }, data: { ...facts, updatedById: actor.id, version: { increment: 1 } } });
      if (changed.count !== 1) reject('CONCURRENCY_CONFLICT', 409);
      const record = await this.find(tx, organizationId, id);
      await this.audit.record({ organizationId, actorUserId: actor.id, action: 'PROCESS_DEFECT_UPDATED', resourceType: 'ProcessDefect', resourceId: id, outcome: 'SUCCESS', traceId, metadata: { resourceVersion: record.version } }, tx);
      return record;
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
      return record;
    }, async (tx) => { await this.find(tx, organizationId, id); });
  }

  async list(actor: AdminActor, query: ProcessDefectQuery) {
    const organizationId = this.scope(actor);
    if (!Number.isSafeInteger(query.page) || query.page < 1 || !Number.isSafeInteger(query.pageSize) || query.pageSize < 1 || query.pageSize > 100) reject('PROCESS_DEFECT_QUERY_INVALID', 400);
    const defectTypeCode = query.defectTypeCode?.trim().toUpperCase();
    return this.prisma.$transaction(async (tx) => {
      await assertAdminAccess(tx, actor, organizationId, 'process-quality:defects:read');
      const where: Prisma.ProcessDefectWhereInput = {
        organizationId, ...(query.includeArchived ? {} : { archivedAt: null }),
        ...(defectTypeCode ? { defectTypeCode } : {}),
        ...(query.batchCode ? { batchCode: query.batchCode } : {}),
        ...(query.workOrderCode ? { workOrderCode: query.workOrderCode } : {}),
        ...(query.operationCode ? { operationCode: query.operationCode } : {}),
        ...(query.lineCode ? { lineCode: query.lineCode } : {}),
        ...(query.projectCode ? { projectCode: query.projectCode } : {}),
        ...(query.productCode ? { productCode: query.productCode } : {}),
        ...(query.materialCode ? { materialCode: query.materialCode } : {}),
        ...(query.responsibilityCategory ? { responsibilityCategory: query.responsibilityCategory } : {}),
        ...(query.search ? { OR: [{ description: { contains: query.search, mode: 'insensitive' } }, { batchCode: { contains: query.search, mode: 'insensitive' } }, { workOrderCode: { contains: query.search, mode: 'insensitive' } }] } : {}),
      };
      const [items, total] = await Promise.all([tx.processDefect.findMany({ where, orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }], skip: (query.page - 1) * query.pageSize, take: query.pageSize }), tx.processDefect.count({ where })]);
      return { items, total, page: query.page, pageSize: query.pageSize };
    });
  }

  async detail(actor: AdminActor, id: string) {
    const organizationId = this.scope(actor);
    return this.prisma.$transaction(async (tx) => {
      await assertAdminAccess(tx, actor, organizationId, 'process-quality:defects:read');
      const record = await this.find(tx, organizationId, id);
      const evidence = await tx.fileObject.findMany({ where: { organizationId, resourceType: 'process-defect', resourceId: id, status: 'AVAILABLE', scanStatus: 'CLEAN' }, select: { id: true, originalName: true, scanStatus: true, status: true } });
      return { ...record, evidence };
    });
  }

  async sourceReference(actor: AdminActor, id: string): Promise<DomainSourceReference> {
    const organizationId = this.scope(actor);
    return this.prisma.$transaction(async (tx) => {
      await assertAdminAccess(tx, actor, organizationId, 'process-quality:defects:read');
      const record = await this.find(tx, organizationId, id);
      return {
        sourceDomain: 'process-quality', sourceType: 'process-defect', sourceId: record.id,
        sourceVersion: record.version, sourceSnapshot: this.snapshot(record), createdBy: record.createdById,
      };
    });
  }

  async lockAndResolve(tx: AdminTransaction, source: DomainSourceReference): Promise<DomainSourceRecord | null> {
    if (source.sourceDomain !== 'process-quality' || source.sourceType !== 'process-defect') return null;
    await tx.$queryRaw`SELECT id FROM process_defects WHERE id = ${source.sourceId}::uuid FOR UPDATE`;
    const record = await tx.processDefect.findUnique({ where: { id: source.sourceId } });
    if (!record) return null;
    return { organizationId: record.organizationId, createdBy: record.createdById, sourceVersion: record.version, sourceSnapshot: this.snapshot(record), archivedAt: record.archivedAt };
  }

  private snapshot(record: ProcessDefect): Prisma.InputJsonObject {
    return {
      id: record.id, defectTypeCode: record.defectTypeCode, description: record.description, defectQuantity: record.defectQuantity,
      occurredAt: record.occurredAt.toISOString(), batchCode: record.batchCode, workOrderCode: record.workOrderCode,
      operationCode: record.operationCode, lineCode: record.lineCode, projectCode: record.projectCode, productCode: record.productCode,
      materialCode: record.materialCode, supplierOrganizationId: record.supplierOrganizationId,
      responsibilityCategory: record.responsibilityCategory, sourceKind: record.sourceKind,
      externalSourceSystem: record.externalSourceSystem, externalRecordKey: record.externalRecordKey,
      sourceObservedAt: record.sourceObservedAt?.toISOString() ?? null, ingestionStatus: record.ingestionStatus,
    };
  }

  private async find(tx: AdminTransaction, organizationId: string, id: string) {
    const record = await tx.processDefect.findFirst({ where: { id, organizationId } });
    if (!record) reject('PROCESS_DEFECT_NOT_FOUND', 404);
    return record;
  }

  private async normalize(input: ProcessDefectInput) {
    if (!Number.isSafeInteger(input.defectQuantity) || input.defectQuantity < 1 || input.defectQuantity > 2147483647) reject('PROCESS_DEFECT_INPUT_INVALID', 400);
    if (!(input.occurredAt instanceof Date) || Number.isNaN(input.occurredAt.getTime())) reject('PROCESS_DEFECT_INPUT_INVALID', 400);
    if (!PROCESS_RESPONSIBILITY_CATEGORIES.includes(input.responsibilityCategory)) reject('PROCESS_DEFECT_INPUT_INVALID', 400);
    const externalSourceSystem = input.externalSourceSystem;
    const externalRecordKey = input.externalRecordKey;
    const sourceObservedAt = input.sourceObservedAt;
    if ([externalSourceSystem, externalRecordKey, sourceObservedAt].some((value) => value != null) &&
      (!['MES', 'IMS'].includes(externalSourceSystem ?? '') || !externalRecordKey?.trim() || !(sourceObservedAt instanceof Date) || Number.isNaN(sourceObservedAt.getTime()))) reject('PROCESS_DEFECT_EXTERNAL_IDENTITY_INVALID', 400);
    return {
      defectTypeCode: required(input.defectTypeCode, 64).toUpperCase(), description: required(input.description, 10000), defectQuantity: input.defectQuantity, occurredAt: input.occurredAt,
      batchCode: optional(input.batchCode, 100), workOrderCode: optional(input.workOrderCode, 100), operationCode: optional(input.operationCode, 100), lineCode: optional(input.lineCode, 100),
      projectCode: optional(input.projectCode, 100), productCode: optional(input.productCode, 100), materialCode: optional(input.materialCode, 100),
      supplierOrganizationId: input.supplierOrganizationId ?? null, responsibilityCategory: input.responsibilityCategory,
      externalSourceSystem: externalSourceSystem ?? null, externalRecordKey: externalRecordKey ? required(externalRecordKey, 200) : null, sourceObservedAt: sourceObservedAt ?? null,
    };
  }

  private async validateReferences(tx: AdminTransaction, organizationId: string, facts: Awaited<ReturnType<ProcessDefectLedgerService['normalize']>>) {
    const type = await tx.processDefectType.findUnique({ where: { organizationId_code: { organizationId, code: facts.defectTypeCode } } });
    if (!type?.active) reject('PROCESS_DEFECT_TYPE_NOT_FOUND', 400);
    if (facts.supplierOrganizationId) {
      const supplier = await tx.organization.findUnique({ where: { id: facts.supplierOrganizationId }, select: { type: true, status: true } });
      if (supplier?.type !== 'SUPPLIER' || supplier.status !== 'ACTIVE') reject('PROCESS_DEFECT_SUPPLIER_INVALID', 400);
    }
  }
}
