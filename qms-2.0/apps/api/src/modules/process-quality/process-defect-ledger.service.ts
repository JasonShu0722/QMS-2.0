import { HttpException, Injectable, Optional } from '@nestjs/common';
import { isISO8601 } from 'class-validator';
import { randomUUID } from 'node:crypto';
import { Prisma, type ProcessDefect } from '../../generated/prisma/client.js';
import { PrismaService } from '../../database/prisma.service.js';
import { ControlledValidationException } from '../../common/contracts/controlled-validation.exception.js';
import { AdminMutationService, adminPermissions, assertAdminAccess, type AdminActor, type AdminTransaction } from '../../common/security/admin-mutation.service.js';
import { assertActiveAuthentication } from '../../common/security/session-security.js';
import { featurePredicate } from '../workflow/workflow-access-policy.js';
import { effectivePositionAssignmentWhere } from '../../common/security/effective-role-grants.js';
import type { SupplierCollaborationProjection } from '../../common/eight-d/supplier-collaboration.types.js';
import { AuditLogService } from '../audit-log/audit-log.service.js';
import type { DomainSourceRecord, DomainSourceReference } from '../problem-index/domain-source-issue.service.js';
import { ComponentProjectService } from '../platform-configuration/component-project.service.js';
import { SupplierQualityService } from '../supplier-quality/supplier-quality.service.js';
import type { SupplierCopyProjection, SupplierCopySource } from '../../common/eight-d/supplier-copy.types.js';
import { isProcessFactoryCode, PROCESS_FACTORY_CODES, processDefectRequiredIssues, processDefectShift } from './process-defect-registration.policy.js';
import { ProcessDefectCompletionService, processProjectSnapshot } from './process-defect-completion.service.js';
import { processDeletionProblemReferences } from '../problem-index/process-deletion-references.read-model.js';
import { processDeletionSelectionReferences } from '../new-product-quality/process-deletion-references.read-model.js';
import { processDeletionCopyReferences } from '../supplier-eight-d-source/process-deletion-references.read-model.js';
import { ProblemDomainRegistry } from '../problem-index/problem-domain-registry.js';

type DeletionSelection = { defectId: string; expectedVersion: number };

export const PROCESS_RESPONSIBILITY_CATEGORIES = ['MATERIAL', 'OPERATION', 'EQUIPMENT', 'PROCESS', 'DESIGN', 'FALSE_POSITIVE'] as const;
export const PROCESS_MATERIAL_VERIFICATIONS = ['UNREVIEWED', 'CONFIRMED_DEFECT', 'NOT_MATERIAL', 'NEGOTIATED', 'RETURN_ANALYSIS'] as const;
export const PROCESS_DEFECT_LEDGER_MAX_ROWS = 1000;
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
  factoryCode?: string | null;
  defectTypeCode?: string | null;
  description?: string;
  defectQuantity?: number | null;
  occurredAt?: Date | null;
  batchCode?: string | null;
  workOrderCode?: string | null;
  operationCode?: string | null;
  lineCode?: string | null;
  lineName?: string | null;
  operationName?: string | null;
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

type ProcessClassificationHistory = {
  id: string;
  previousCategory: ProcessResponsibilityCategory | null;
  category: ProcessResponsibilityCategory | null;
  actorUserId: string;
  recordedAt: Date;
  defectVersion: number;
};

function appendToGroup<Value>(groups: Map<string, Value[]>, key: string, value: Value) {
  const items = groups.get(key);
  if (items) items.push(value);
  else groups.set(key, [value]);
}

function groupByDefect<Value extends { defectId: string }>(rows: Value[]) {
  const groups = new Map<string, Omit<Value, 'defectId'>[]>();
  for (const { defectId, ...row } of rows) appendToGroup(groups, defectId, row);
  return groups;
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
  pendingCompletion?: boolean;
  pendingConfiguration?: boolean;
  filters?: string;
  occurredFrom?: string;
  occurredTo?: string;
}

export const PROCESS_FILTER_FIELDS = {
  description: 'text', defectTypeCode: 'text', batchCode: 'text', workOrderCode: 'text', operationCode: 'text', lineCode: 'text',
  projectCode: 'text', productCode: 'text', materialCode: 'text', traceCode: 'text', lineName: 'text', operationName: 'text',
  operationSector: 'text', productSubcategory: 'text', occurredAt: 'date', defectQuantity: 'number', shift: 'enum', projectStage: 'enum',
  ledgerStatus: 'enum', responsibilityCategory: 'enum', pendingCompletion: 'boolean', pendingConfiguration: 'boolean', factoryCode: 'enum',
} as const;
type ProcessFilterField = keyof typeof PROCESS_FILTER_FIELDS;
type ProcessFilterType = (typeof PROCESS_FILTER_FIELDS)[ProcessFilterField];
type ProcessFilterOperator = 'CONTAINS' | 'NOT_CONTAINS' | 'EQ' | 'NE' | 'EMPTY' | 'NOT_EMPTY' | 'BEFORE' | 'AFTER' | 'GT' | 'GTE' | 'LT' | 'LTE';
type ProcessFilter = { field: ProcessFilterField; operator: ProcessFilterOperator; value?: unknown };
type ProcessFilterSet = { logic: 'ALL' | 'ANY'; items: ProcessFilter[] };
export const PROCESS_FILTER_OPERATORS: Record<ProcessFilterType, readonly ProcessFilterOperator[]> = {
  text: ['CONTAINS', 'NOT_CONTAINS', 'EQ', 'NE', 'EMPTY', 'NOT_EMPTY'],
  date: ['EQ', 'NE', 'BEFORE', 'AFTER', 'EMPTY', 'NOT_EMPTY'],
  enum: ['EQ', 'NE', 'EMPTY', 'NOT_EMPTY'],
  number: ['EQ', 'NE', 'GT', 'GTE', 'LT', 'LTE', 'EMPTY', 'NOT_EMPTY'],
  boolean: ['EQ'],
};
const PROCESS_FILTER_ENUMS: Partial<Record<ProcessFilterField, readonly string[]>> = {
  shift: ['DAY', 'NIGHT'], projectStage: ['NEW_PRODUCT', 'MASS_PRODUCTION'], ledgerStatus: ['FOLLOWING', 'CLOSED'],
  responsibilityCategory: PROCESS_RESPONSIBILITY_CATEGORIES, factoryCode: PROCESS_FACTORY_CODES,
};

function reject(code: string, status: number): never {
  throw new HttpException({ code, message: code }, status);
}

function rejectFactory(code: 'PROCESS_DEFECT_INPUT_INVALID' | 'PROCESS_DEFECT_DERIVED_FIELD_READ_ONLY'): never {
  throw new ControlledValidationException(code, [{ path: 'factoryCode', message: '' }]);
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

export const PROCESS_FILTER_MAX_LENGTH = 12000;
export const PROCESS_FILTER_MAX_ITEMS = 10;

function parseProcessFilters(raw: string | undefined): ProcessFilterSet | undefined {
  if (raw === undefined) return undefined;
  if (typeof raw !== 'string' || raw.length > PROCESS_FILTER_MAX_LENGTH) reject('PROCESS_DEFECT_FILTER_INVALID', 400);
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { reject('PROCESS_DEFECT_FILTER_INVALID', 400); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) reject('PROCESS_DEFECT_FILTER_INVALID', 400);
  const input = parsed as Record<string, unknown>;
  if (Object.keys(input).some(key => !['logic', 'items'].includes(key))) reject('PROCESS_DEFECT_FILTER_INVALID', 400);
  if ((input.logic !== 'ALL' && input.logic !== 'ANY') || !Array.isArray(input.items) || input.items.length < 1 || input.items.length > PROCESS_FILTER_MAX_ITEMS) reject('PROCESS_DEFECT_FILTER_INVALID', 400);
  const items = input.items.map((value): ProcessFilter => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) reject('PROCESS_DEFECT_FILTER_INVALID', 400);
    const item = value as Record<string, unknown>;
    if (Object.keys(item).some(key => !['field', 'operator', 'value'].includes(key)) || typeof item.field !== 'string' || typeof item.operator !== 'string') reject('PROCESS_DEFECT_FILTER_INVALID', 400);
    const field = item.field as ProcessFilterField;
    const operator = item.operator as ProcessFilterOperator;
    if (!Object.hasOwn(PROCESS_FILTER_FIELDS, field)) reject('PROCESS_DEFECT_FILTER_INVALID', 400);
    const type = PROCESS_FILTER_FIELDS[field];
    if (!PROCESS_FILTER_OPERATORS[type].includes(operator)) reject('PROCESS_DEFECT_FILTER_INVALID', 400);
    const hasValue = Object.hasOwn(item, 'value');
    if (['EMPTY', 'NOT_EMPTY'].includes(operator) ? hasValue : !hasValue) reject('PROCESS_DEFECT_FILTER_INVALID', 400);
    if (hasValue) {
      const valueType = typeof item.value;
      if (type === 'text' && (typeof item.value !== 'string' || !item.value.trim() || item.value.length > 200 || item.value.includes('\0'))) reject('PROCESS_DEFECT_FILTER_INVALID', 400);
      if (type === 'number' && (valueType !== 'number' || !Number.isSafeInteger(item.value) || (item.value as number) < -2147483648 || (item.value as number) > 2147483647)) reject('PROCESS_DEFECT_FILTER_INVALID', 400);
      if (type === 'boolean' && valueType !== 'boolean') reject('PROCESS_DEFECT_FILTER_INVALID', 400);
      if (type === 'enum' && (valueType !== 'string' || !PROCESS_FILTER_ENUMS[field]?.includes(item.value as string))) reject('PROCESS_DEFECT_FILTER_INVALID', 400);
      if (type === 'date' && (valueType !== 'string' || !validProcessDate(item.value as string))) reject('PROCESS_DEFECT_FILTER_INVALID', 400);
    }
    return { field, operator, ...(hasValue ? { value: item.value } : {}) };
  });
  return { logic: input.logic, items };
}

function validProcessDate(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  if (/^\d{4}-\d\d-\d\d$/.test(value)) { const [year, month, day] = value.split('-').map(Number); const date = new Date(Date.UTC(year!, month! - 1, day!)); return date.getUTCFullYear() === year && date.getUTCMonth() === month! - 1 && date.getUTCDate() === day; }
  return /^\d{4}-\d\d-\d\dT(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-]\d\d:\d\d)$/.test(value)
    && isISO8601(value, { strict: true }) && Number.isFinite(Date.parse(value));
}

function processDateValue(value: string, boundary: 'start' | 'end' = 'start') {
  if (/^\d{4}-\d\d-\d\d$/.test(value)) return new Date(`${value}T${boundary === 'end' ? '23:59:59.999' : '00:00:00'}+08:00`);
  return new Date(value);
}

const FILTER_COMPARISONS = { EQ: '=', NE: '<>', BEFORE: '<', AFTER: '>', GT: '>', GTE: '>=', LT: '<', LTE: '<=' } as const;

function materialExists(predicate: Prisma.Sql) {
  return Prisma.sql`EXISTS (SELECT 1 FROM process_defect_material_items mi WHERE mi.organization_id = d.organization_id AND mi.defect_id = d.id AND mi.removed_at IS NULL AND ${predicate})`;
}

function filterComparison(column: Prisma.Sql, type: ProcessFilterType, operator: ProcessFilterOperator, value: unknown): Prisma.Sql {
  if (operator === 'EMPTY') return Prisma.sql`${column} IS NULL`;
  if (operator === 'NOT_EMPTY') return Prisma.sql`${column} IS NOT NULL`;
  if (operator === 'CONTAINS' || operator === 'NOT_CONTAINS') {
    const pattern = `%${(value as string).replace(/[\\%_]/g, '\\$&')}%`;
    return Prisma.sql`${column} ${Prisma.raw(operator === 'CONTAINS' ? 'ILIKE' : 'NOT ILIKE')} ${pattern} ESCAPE '\\'`;
  }
  const comparison = Prisma.raw(FILTER_COMPARISONS[operator]);
  if (type === 'date' && /^\d{4}-\d\d-\d\d$/.test(value as string)) {
    const start = processDateValue(value as string);
    if (operator === 'EQ') return Prisma.sql`${column} >= ${start} AND ${column} < ${new Date(start.getTime() + 86400000)}`;
    if (operator === 'NE') return Prisma.sql`(${column} < ${start} OR ${column} >= ${new Date(start.getTime() + 86400000)})`;
    if (operator === 'BEFORE') return Prisma.sql`${column} < ${start}`;
    if (operator === 'AFTER') return Prisma.sql`${column} >= ${new Date(start.getTime() + 86400000)}`;
  }
  if (type === 'text') return Prisma.sql`LOWER(${column}) ${comparison} LOWER(${value})`;
  return Prisma.sql`${column} ${comparison} ${type === 'date' ? processDateValue(value as string) : value}`;
}

function processFilterPredicate({ field, operator, value }: ProcessFilter): Prisma.Sql {
  if (field === 'materialCode') {
    const material = Prisma.sql`NULLIF(mi.material_code, '')`;
    const present = materialExists(Prisma.sql`${material} IS NOT NULL`);
    if (operator === 'EMPTY') return Prisma.sql`NOT ${present}`;
    if (operator === 'NOT_EMPTY') return present;
    if (operator === 'NE' || operator === 'NOT_CONTAINS') {
      const matching = materialExists(filterComparison(material, 'text', operator === 'NE' ? 'EQ' : 'CONTAINS', value));
      return Prisma.sql`(${present} AND NOT ${matching})`;
    }
    return materialExists(filterComparison(material, 'text', operator, value));
  }
  const type = PROCESS_FILTER_FIELDS[field];
  const column = field === 'projectStage' ? Prisma.sql`d.project_snapshot #>> '{project,stage}'`
    : field === 'projectCode' ? Prisma.sql`d.project_snapshot #>> '{project,code}'`
    : Prisma.sql`d.${Prisma.raw(field.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`))}`;
  return filterComparison(type === 'text' || type === 'enum' ? Prisma.sql`NULLIF(${column}, '')` : column, type, operator, value);
}

export function normalizeProcessDefectFacts(input: ProcessDefectInput, mode: 'MANUAL' | 'UPDATE' | 'IMS' = 'UPDATE') {
  if (!input || typeof input !== 'object' || Array.isArray(input)) reject('PROCESS_DEFECT_INPUT_INVALID', 400);
  const factoryCode = isProcessFactoryCode(input.factoryCode) ? input.factoryCode : null;
  if (factoryCode === null && (mode === 'MANUAL' || (mode === 'UPDATE' && input.factoryCode != null))) rejectFactory('PROCESS_DEFECT_INPUT_INVALID');
  if (input.defectQuantity != null && (!Number.isSafeInteger(input.defectQuantity) || input.defectQuantity < 1 || input.defectQuantity > 2147483647)) reject('PROCESS_DEFECT_INPUT_INVALID', 400);
  if (input.occurredAt != null && (!(input.occurredAt instanceof Date) || Number.isNaN(input.occurredAt.getTime()))) reject('PROCESS_DEFECT_INPUT_INVALID', 400);
  if (input.responsibilityCategory != null && !PROCESS_RESPONSIBILITY_CATEGORIES.includes(input.responsibilityCategory)) reject('PROCESS_DEFECT_INPUT_INVALID', 400);
  if (input.description !== undefined && (typeof input.description !== 'string' || input.description.length > 10000)) reject('PROCESS_DEFECT_INPUT_INVALID', 400);
  const { externalSourceSystem, externalRecordKey, sourceObservedAt } = input;
  if ((mode === 'MANUAL' || mode !== 'IMS' && externalSourceSystem !== 'IMS') && [externalSourceSystem, externalRecordKey, sourceObservedAt].some(value => value != null) &&
    (!['MES', 'IMS'].includes(externalSourceSystem ?? '') || typeof externalRecordKey !== 'string' || !externalRecordKey.trim() || !(sourceObservedAt instanceof Date) || Number.isNaN(sourceObservedAt.getTime()))) reject('PROCESS_DEFECT_EXTERNAL_IDENTITY_INVALID', 400);
  const facts = {
    factoryCode,
    defectTypeCode: optional(input.defectTypeCode, 64)?.toUpperCase() ?? null, description: input.description?.trim() ?? '',
    defectQuantity: mode === 'IMS' ? 1 : input.defectQuantity === undefined && mode === 'MANUAL' ? 1 : input.defectQuantity ?? null, occurredAt: input.occurredAt ?? null,
    batchCode: optional(input.batchCode, 100), workOrderCode: optional(input.workOrderCode, 100), operationCode: optional(input.operationCode, 100), lineCode: optional(input.lineCode, 100),
    projectCode: optional(input.projectCode, 100), productCode: optional(input.productCode, 100), traceCode: optional(input.traceCode, 200), analysisProgress: optional(input.analysisProgress, 10000),
    lineName: optional(input.lineName, 200), operationName: optional(input.operationName, 200), shift: processDefectShift(input.occurredAt ?? null),
    responsibilityCategory: input.responsibilityCategory ?? null,
    externalSourceSystem: externalSourceSystem ?? null, externalRecordKey: optional(externalRecordKey, 200), sourceObservedAt: sourceObservedAt ?? null,
  };
  if (mode === 'MANUAL' && (processDefectRequiredIssues(facts).length || facts.defectQuantity === null)) reject('PROCESS_DEFECT_REQUIRED_FACTS_MISSING', 400);
  return facts;
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
    @Optional() private readonly projects?: ComponentProjectService, @Optional() private readonly suppliers?: SupplierQualityService,
    @Optional() private readonly completion?: ProcessDefectCompletionService, @Optional() private readonly readRegistry?: ProblemDomainRegistry) {}

  private scope(actor: AdminActor): string {
    if (actor.accountType !== 'INTERNAL') reject('ORGANIZATION_SCOPE_DENIED', 403);
    return actor.scopeOrganizationId ?? actor.organizationId;
  }

  async createDefectType(actor: AdminActor, input: { code: string; name: string }, traceId: string, key?: string) {
    const organizationId = this.scope(actor);
    const code = required(input.code, 64).toUpperCase();
    const name = required(input.name, 200);
    return this.mutations.run({ actor, organizationId, key, traceId, action: 'PROCESS_DEFECT_TYPE_CREATED', payload: { code, name }, permission: 'process-quality:defects:write', authentication: 'active' }, async (tx) => {
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
    return this.mutations.run({ actor, organizationId, key, traceId, action: 'PROCESS_DEFECT_TYPE_UPDATED', payload: { id, expectedVersion: input.expectedVersion, name, active: input.active }, permission: 'process-quality:defects:write', authentication: 'active' }, async (tx) => {
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
    const facts = normalizeProcessDefectFacts(input, 'MANUAL');
    const materials = this.materialInput(input, []);
    if (materials?.some(item => item.id)) reject('PROCESS_DEFECT_MATERIALS_INVALID', 400);
    return this.mutations.run({ actor, organizationId, key, traceId, action: 'PROCESS_DEFECT_CREATED', payload: { ...facts, materials, occurredAt: facts.occurredAt?.toISOString() ?? null, sourceObservedAt: facts.sourceObservedAt?.toISOString() }, permission: 'process-quality:defects:write', authentication: 'active' }, async (tx) => {
      await this.validateReferences(tx, organizationId, facts);
      const derived = await this.completionFor(tx, organizationId, facts);
      const record = await tx.processDefect.create({ data: { ...facts, ...derived, registrationVersion: 1,
        manualFields: Object.keys(input).filter(field => !['organizationId', 'externalSourceSystem', 'externalRecordKey', 'sourceObservedAt'].includes(field)),
        organizationId, createdById: actor.id, updatedById: actor.id, sourceKind: 'MANUAL', ingestionStatus: facts.externalSourceSystem ? 'PENDING_VERIFICATION' : null } });
      await ProcessDefectCompletionService.history(tx, record, null, actor.id, 'MANUAL_CREATED');
      await this.saveMaterials(tx, actor, record, materials ?? [], []);
      if (facts.externalSourceSystem && facts.externalRecordKey) {
        await tx.processDefectIngestionAudit.create({ data: { organizationId, defectId: record.id, externalSourceSystem: facts.externalSourceSystem, externalRecordKey: facts.externalRecordKey, status: 'PENDING_VERIFICATION', observedAt: facts.sourceObservedAt, recordedById: actor.id } });
      }
      await this.audit.record({ organizationId, actorUserId: actor.id, action: 'PROCESS_DEFECT_CREATED', resourceType: 'ProcessDefect', resourceId: record.id, outcome: 'SUCCESS', traceId, metadata: { resourceVersion: record.version, changedFields: 'factoryCode' } }, tx);
      return this.view(tx, await this.find(tx, organizationId, record.id));
    });
  }

  async update(actor: AdminActor, id: string, input: Partial<ProcessDefectInput> & { expectedVersion: number }, traceId: string, key?: string) {
    const organizationId = this.scope(actor);
    version(input.expectedVersion);
    this.validateInputFields(input);
    if (input.externalSourceSystem !== undefined || input.sourceObservedAt !== undefined) reject('PROCESS_DEFECT_EXTERNAL_IDENTITY_IMMUTABLE', 409);
    const { externalRecordKey: supplementIdentity, ...updateInput } = input;
    normalizeProcessDefectFacts(updateInput, 'UPDATE');
    return this.mutations.run({ actor, organizationId, key, traceId, action: 'PROCESS_DEFECT_UPDATED', payload: { id, ...input, occurredAt: input.occurredAt === undefined ? undefined : input.occurredAt?.toISOString() ?? null }, permission: 'process-quality:defects:write', authentication: 'active' }, async (tx) => {
      if (supplementIdentity !== undefined) {
        const identity = `${organizationId}:IMS:${required(supplementIdentity ?? '', 200)}`;
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${identity}, 0))::text`;
      }
      await this.lock(tx, organizationId, id);
      const existing = await this.find(tx, organizationId, id);
      if (existing.archivedAt) reject('PROCESS_DEFECT_ARCHIVED', 409);
      if (existing.sourceKind === 'IMS' && input.factoryCode !== undefined) rejectFactory('PROCESS_DEFECT_DERIVED_FIELD_READ_ONLY');
      if (input.factoryCode === null || (existing.sourceKind === 'MANUAL' && !isProcessFactoryCode(input.factoryCode ?? existing.factoryCode))) rejectFactory('PROCESS_DEFECT_INPUT_INVALID');
      if (existing.registrationVersion === 1 && input.defectQuantity === null) reject('PROCESS_DEFECT_INPUT_INVALID', 400);
      if (supplementIdentity !== undefined) {
        if (existing.sourceKind !== 'IMS' || existing.externalRecordKey) reject('PROCESS_DEFECT_EXTERNAL_IDENTITY_IMMUTABLE', 409);
        const identity = required(supplementIdentity ?? '', 200);
        const conflict = await tx.processDefect.findFirst({ where: { organizationId, externalSourceSystem: 'IMS', externalRecordKey: identity, id: { not: id } }, select: { id: true } });
        if (conflict) reject('PROCESS_DEFECT_EXTERNAL_IDENTITY_CONFLICT', 409);
      }
      const changes = Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined));
      const facts = normalizeProcessDefectFacts({ ...existing, responsibilityCategory: existing.responsibilityCategory as ProcessResponsibilityCategory | null, externalSourceSystem: existing.externalSourceSystem as ProcessExternalSourceSystem | null, ...changes }, 'UPDATE');
      if (facts.defectTypeCode !== existing.defectTypeCode) await this.validateReferences(tx, organizationId, facts);
      const previousMaterials = await this.materials(tx, organizationId, id);
      const materials = this.materialInput(input, previousMaterials);
      const derived = existing.registrationVersion === 1 ? await this.completionFor(tx, organizationId, facts, existing, Object.keys(changes)) : {};
      const manualFields = [...new Set([...existing.manualFields, ...Object.keys(changes).filter(field => !['expectedVersion', 'organizationId'].includes(field))])];
      const changed = await tx.processDefect.updateMany({ where: { id, organizationId, version: input.expectedVersion, archivedAt: null }, data: { ...facts, ...derived, manualFields, ...(changes.description !== undefined ? { descriptionSource: 'MANUAL' } : {}), updatedById: actor.id, version: { increment: 1 } } });
      if (changed.count !== 1) reject('CONCURRENCY_CONFLICT', 409);
      const record = await this.find(tx, organizationId, id);
      if (existing.registrationVersion === 1 || record.factoryCode !== existing.factoryCode) await ProcessDefectCompletionService.history(tx, record, existing, actor.id, 'MANUAL_UPDATED');
      if (materials !== undefined) await this.saveMaterials(tx, actor, record, materials, previousMaterials);
      await this.classificationHistory(tx, actor, existing, record);
      await this.audit.record({ organizationId, actorUserId: actor.id, action: 'PROCESS_DEFECT_UPDATED', resourceType: 'ProcessDefect', resourceId: id, outcome: 'SUCCESS', traceId, metadata: { resourceVersion: record.version, previousResponsibilityCategory: existing.responsibilityCategory, responsibilityCategory: record.responsibilityCategory, changedFields: existing.factoryCode === record.factoryCode ? undefined : 'factoryCode' } }, tx);
      return this.view(tx, await this.find(tx, organizationId, id));
    }, async (tx) => { await this.find(tx, organizationId, id); });
  }

  async archive(actor: AdminActor, id: string, expectedVersion: number, traceId: string, key?: string, reason?: string) {
    await this.deleteDefects(actor, { sources: [{ defectId: id, expectedVersion }], reason }, traceId, key);
    return this.detail(actor, id);
  }

  private deletionSources(input: { sources: DeletionSelection[]; organizationId?: string }, actor: AdminActor) {
    if (input.organizationId !== undefined && input.organizationId !== this.scope(actor)) reject('ORGANIZATION_SCOPE_DENIED', 403);
    if (!Array.isArray(input.sources) || input.sources.length < 1 || input.sources.length > PROCESS_DEFECT_LEDGER_MAX_ROWS) reject('PROCESS_DEFECT_INPUT_INVALID', 400);
    const sources = input.sources.map(source => {
      if (!source || typeof source !== 'object') reject('PROCESS_DEFECT_INPUT_INVALID', 400);
      return { defectId: uuid(source.defectId), expectedVersion: version(source.expectedVersion) };
    }).sort((left, right) => left.defectId.localeCompare(right.defectId));
    if (new Set(sources.map(source => source.defectId)).size !== sources.length) reject('PROCESS_DEFECT_INPUT_INVALID', 400);
    return sources;
  }

  private async deletionItems(tx: AdminTransaction, actor: AdminActor, sources: DeletionSelection[]) {
    const organizationId = this.scope(actor);
    const ids = sources.map(source => source.defectId);
    await tx.$queryRaw(Prisma.sql`SELECT id FROM process_defects WHERE organization_id = ${organizationId}::uuid
      AND id IN (${Prisma.join(ids.map(id => Prisma.sql`${id}::uuid`))}) ORDER BY id FOR UPDATE`);
    const records = await tx.processDefect.findMany({ where: { organizationId, id: { in: ids } }, orderBy: { id: 'asc' },
      select: { id: true, version: true, archivedAt: true, description: true } });
    if (records.length !== sources.length) reject('PROCESS_DEFECT_NOT_FOUND', 404);
    const expectedVersions = new Map(sources.map(source => [source.defectId, source.expectedVersion]));
    for (const record of records) {
      if (record.archivedAt || record.version !== expectedVersions.get(record.id)) reject('CONCURRENCY_CONFLICT', 409);
    }
    const granted = await adminPermissions(tx, actor.id, organizationId);
    const visibility = granted.includes('process-quality:issues:read') ? this.readRegistry?.visibility(actor, organizationId) : undefined;
    const problems = await processDeletionProblemReferences(tx, organizationId, ids, visibility);
    const selections = await processDeletionSelectionReferences(tx, organizationId, ids, actor);
    const copies = await processDeletionCopyReferences(tx, organizationId, ids);
    const blockersByDefect = new Map<string, { code: string; reportNumber: string | null }[]>();
    const selectedIds = new Set(ids);
    for (const problem of problems) {
      const references = new Set(problem.domainSourceLinks.map(link => link.sourceId));
      if (problem.domainCode === 'process-quality' && problem.sourceType === 'process-defect' && problem.sourceId && selectedIds.has(problem.sourceId)) {
        references.add(problem.sourceId);
      }
      for (const id of references) appendToGroup(blockersByDefect, id, { code: 'FORMAL_PROBLEM', reportNumber: problem.reportNumber });
    }
    const canReadProjects = granted.includes('new-product-quality:projects:read');
    for (const selected of selections) appendToGroup(blockersByDefect, selected.defectId, { code: 'NEW_PRODUCT_SELECTION', reportNumber: canReadProjects ? selected.projectCode : null });
    for (const copy of copies) appendToGroup(blockersByDefect, copy.defectId, { code: 'SUPPLIER_SOURCE_COPY', reportNumber: null });
    return records.map(record => {
      const blockers = blockersByDefect.get(record.id) ?? [];
      return { defectId: record.id, expectedVersion: record.version, description: record.description, blocked: blockers.length > 0, blockers };
    });
  }

  async previewDeletion(actor: AdminActor, input: { sources: DeletionSelection[]; organizationId?: string }) {
    const organizationId = this.scope(actor), sources = this.deletionSources(input, actor);
    return this.prisma.$transaction(async tx => {
      await assertActiveAuthentication(tx, actor);
      await assertAdminAccess(tx, actor, organizationId, ['process-quality:defects:read', 'process-quality:defects:delete']);
      const items = await this.deletionItems(tx, actor, sources);
      return { items, count: items.length, canDelete: items.every(item => !item.blocked) };
    }, { isolationLevel: 'ReadCommitted' });
  }

  async deleteDefects(actor: AdminActor, input: { sources: DeletionSelection[]; reason?: string; organizationId?: string }, traceId: string, key?: string) {
    const organizationId = this.scope(actor), sources = this.deletionSources(input, actor);
    const ids = sources.map(source => source.defectId);
    const reason = input.reason === undefined ? undefined : required(input.reason, 300);
    return this.mutations.run({ actor, organizationId, key, traceId, action: 'PROCESS_DEFECTS_DELETED', payload: { sources, reason },
      permission: ['process-quality:defects:read', 'process-quality:defects:delete'], authentication: 'active', isolationLevel: 'ReadCommitted' }, async tx => {
      const items = await this.deletionItems(tx, actor, sources);
      if (items.some(item => item.blocked)) reject('PROCESS_DEFECT_DELETE_BLOCKED', 409);
      const changed = await tx.processDefect.updateMany({ where: { organizationId, id: { in: ids }, archivedAt: null },
        data: { archivedAt: new Date(), updatedById: actor.id, version: { increment: 1 }, descriptionAiStatus: 'STALE' } });
      if (changed.count !== sources.length) reject('CONCURRENCY_CONFLICT', 409);
      await this.audit.recordMany(sources.map(source => ({ organizationId, actorUserId: actor.id, action: 'PROCESS_DEFECTS_DELETED', resourceType: 'ProcessDefect', resourceId: source.defectId,
        outcome: 'SUCCESS', traceId, metadata: { deletionReason: reason, rowCount: sources.length, previousResourceVersion: source.expectedVersion, resourceVersion: source.expectedVersion + 1 } })), tx);
      return { deletedIds: ids, count: sources.length };
    }, async tx => {
      if (await tx.processDefect.count({ where: { organizationId, id: { in: ids } } }) !== ids.length) reject('PROCESS_DEFECT_NOT_FOUND', 404);
    });
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
    return this.mutations.run({ actor, organizationId, key, traceId, action, payload: { id, expectedVersion: input.expectedVersion, reason }, permission: 'process-quality:defects:close', authentication: 'active' }, async tx => {
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
    return this.mutations.run({ actor, organizationId, key, traceId, action: 'PROCESS_DEFECTS_CLASSIFIED', payload: { sources, responsibilityCategory: input.responsibilityCategory }, permission: 'process-quality:defects:write', authentication: 'active' }, async tx => {
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
    return this.mutations.run({ actor, organizationId, key, traceId, action: 'PROCESS_DEFECT_MATERIAL_VERIFIED', payload: { id, materialId, expectedVersion: input.expectedVersion, verification: input.verification, verificationNotes }, permission: 'process-quality:materials:review', authentication: 'active' }, async tx => {
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
      const pattern = `%${(query.search ?? '').replace(/[\\%_]/g, '\\$&')}%`;
      const [result] = await tx.$queryRaw<{ items: { id: string; username: string; fullName: string | null; departmentName: string | null }[]; total: number }[]>(Prisma.sql`
        WITH eligible AS MATERIALIZED (
          SELECT candidate.id, candidate.username, candidate.full_name AS "fullName",
            (SELECT string_agg(DISTINCT dept.name, '、' ORDER BY dept.name) FROM user_positions assignment
              JOIN positions pos ON pos.id = assignment.position_id JOIN departments dept ON dept.id = pos.department_id
              JOIN organizations org ON org.id = assignment.organization_id
              WHERE assignment.user_id = candidate.id AND assignment.organization_id = candidate.organization_id
                AND assignment.started_at <= CURRENT_TIMESTAMP AND (assignment.ended_at IS NULL OR assignment.ended_at > CURRENT_TIMESTAMP)
                AND pos.organization_id = candidate.organization_id AND pos.status = 'ACTIVE' AND pos.deleted_at IS NULL AND NOT pos.configuration_required
                AND dept.organization_id = candidate.organization_id AND dept.status = 'ACTIVE' AND dept.deleted_at IS NULL AND NOT dept.configuration_required
                AND org.status = 'ACTIVE' AND org.type = 'INTERNAL' AND org.deleted_at IS NULL AND NOT org.configuration_required) AS "departmentName"
          FROM users candidate
          WHERE candidate.organization_id = ${organizationId}::uuid AND candidate.account_type = 'INTERNAL' AND candidate.status = 'ACTIVE'
            AND ${featurePredicate(Prisma.sql`candidate.id`, Prisma.sql`${organizationId}::uuid`, Prisma.sql`'process-quality:materials:review'`)}
            ${query.search ? Prisma.sql`AND (candidate.username ILIKE ${pattern} OR candidate.full_name ILIKE ${pattern})` : Prisma.empty}
        ), selected AS (SELECT * FROM eligible ORDER BY username, id LIMIT ${query.pageSize} OFFSET ${(query.page - 1) * query.pageSize})
        SELECT COALESCE((SELECT jsonb_agg(selected ORDER BY username, id) FROM selected), '[]'::jsonb) AS items,
          (SELECT count(*)::int FROM eligible) AS total`);
      return { items: result!.items, total: result!.total, page: query.page, pageSize: query.pageSize };
    });
  }

  async list(actor: AdminActor, query: ProcessDefectQuery) {
    const organizationId = this.scope(actor);
    const offset = (query.page - 1) * query.pageSize;
    if (!Number.isSafeInteger(query.page) || query.page < 1 || !Number.isSafeInteger(query.pageSize) || query.pageSize < 1 || query.pageSize > PROCESS_DEFECT_LEDGER_MAX_ROWS || !Number.isSafeInteger(offset)) reject('PROCESS_DEFECT_QUERY_INVALID', 400);
    if ((query.occurredFrom !== undefined && !validProcessDate(query.occurredFrom)) || (query.occurredTo !== undefined && !validProcessDate(query.occurredTo))) reject('PROCESS_DEFECT_QUERY_INVALID', 400);
    const from = query.occurredFrom === undefined ? null : new Date(query.occurredFrom);
    const to = query.occurredTo === undefined ? null : new Date(query.occurredTo);
    if (from && to && from >= to) reject('PROCESS_DEFECT_QUERY_INVALID', 400);
    const defectTypeCode = query.defectTypeCode?.trim().toUpperCase();
    const filterSet = parseProcessFilters(query.filters);
    return this.prisma.$transaction(async (tx) => {
      await assertActiveAuthentication(tx, actor);
      await assertAdminAccess(tx, actor, organizationId, 'process-quality:defects:read');
      const search = `%${query.search ?? ''}%`;
      const where = Prisma.sql`d.organization_id = ${organizationId}::uuid AND d.archived_at IS NULL
        ${from ? Prisma.sql`AND d.occurred_at >= ${from}` : Prisma.empty}
        ${to ? Prisma.sql`AND d.occurred_at < ${to}` : Prisma.empty}
        ${query.pendingCompletion === undefined ? Prisma.empty : Prisma.sql`AND d.pending_completion = ${query.pendingCompletion}`}
        ${query.pendingConfiguration === undefined ? Prisma.empty : Prisma.sql`AND d.pending_configuration = ${query.pendingConfiguration}`}
        ${defectTypeCode ? Prisma.sql`AND d.defect_type_code = ${defectTypeCode}` : Prisma.empty}
        ${query.batchCode ? Prisma.sql`AND d.batch_code = ${query.batchCode}` : Prisma.empty}
        ${query.workOrderCode ? Prisma.sql`AND d.work_order_code = ${query.workOrderCode}` : Prisma.empty}
        ${query.operationCode ? Prisma.sql`AND d.operation_code = ${query.operationCode}` : Prisma.empty}
        ${query.lineCode ? Prisma.sql`AND d.line_code = ${query.lineCode}` : Prisma.empty}
        ${query.projectCode ? Prisma.sql`AND d.project_code = ${query.projectCode}` : Prisma.empty}
        ${query.productCode ? Prisma.sql`AND d.product_code = ${query.productCode}` : Prisma.empty}
        ${query.materialCode ? Prisma.sql`AND ${materialExists(Prisma.sql`mi.material_code = ${query.materialCode}`)}` : Prisma.empty}
        ${query.responsibilityCategory ? Prisma.sql`AND d.responsibility_category = ${query.responsibilityCategory}` : Prisma.empty}
        ${query.ledgerStatus ? Prisma.sql`AND d.ledger_status = ${query.ledgerStatus}` : Prisma.empty}
        ${query.traceCode ? Prisma.sql`AND d.trace_code = ${query.traceCode}` : Prisma.empty}
        ${query.search ? Prisma.sql`AND (d.description ILIKE ${search} OR d.batch_code ILIKE ${search} OR d.work_order_code ILIKE ${search} OR d.trace_code ILIKE ${search} OR d.product_code ILIKE ${search})` : Prisma.empty}
        ${filterSet ? Prisma.sql`AND (${Prisma.join(filterSet.items.map(processFilterPredicate), filterSet.logic === 'ALL' ? ' AND ' : ' OR ')})` : Prisma.empty}`;
      const [pageIds, [count]] = await Promise.all([
        tx.$queryRaw<{ id: string }[]>`SELECT d.id FROM process_defects d WHERE ${where} ORDER BY d.occurred_at DESC NULLS LAST, d.created_at DESC, d.id DESC LIMIT ${query.pageSize} OFFSET ${offset}`,
        tx.$queryRaw<{ total: bigint }[]>`SELECT count(*) AS total FROM process_defects d WHERE ${where}`,
      ]);
      const items = await tx.processDefect.findMany({ where: { organizationId, id: { in: pageIds.map(item => item.id) } }, orderBy: [{ occurredAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }, { id: 'desc' }] });
      return { items: await this.views(tx, organizationId, items), total: Number(count!.total), page: query.page, pageSize: query.pageSize };
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

  async prepareSupplierCopyProjection(tx: AdminTransaction, actor: AdminActor, defectIds: string[]): Promise<void> {
    if (!defectIds.length) return;
    const organizationId = this.scope(actor);
    const ids = [...new Set(defectIds.map(uuid))];
    await assertActiveAuthentication(tx, actor, 'SHARE');
    await assertAdminAccess(tx, actor, organizationId, ['process-quality:defects:read', 'supplier-quality:issues:copy']);
    await tx.$queryRaw(Prisma.sql`SELECT id FROM process_defects WHERE organization_id = ${organizationId}::uuid
      AND id IN (${Prisma.join(ids.map(id => Prisma.sql`${id}::uuid`))}) ORDER BY id FOR UPDATE`);
  }

  async supplierCollaborationPredicate(tx: AdminTransaction, actualActor: AdminActor, sourceIdSql: Prisma.Sql): Promise<Prisma.Sql> {
    const organizationId = this.scope(actualActor);
    await assertActiveAuthentication(tx, actualActor, 'SHARE');
    return Prisma.sql`(
      ${featurePredicate(Prisma.sql`${actualActor.id}::uuid`, Prisma.sql`${organizationId}::uuid`, Prisma.sql`'process-quality:defects:read'`)}
      AND ${featurePredicate(Prisma.sql`${actualActor.id}::uuid`, Prisma.sql`${organizationId}::uuid`, Prisma.sql`'process-quality:materials:review'`)}
      AND EXISTS (SELECT 1 FROM process_defects collaboration_defect
        JOIN process_defect_material_items collaboration_material ON collaboration_material.organization_id = collaboration_defect.organization_id
          AND collaboration_material.defect_id = collaboration_defect.id
        WHERE collaboration_defect.organization_id = ${organizationId}::uuid AND collaboration_defect.id = ${sourceIdSql}
          AND collaboration_defect.archived_at IS NULL AND collaboration_defect.ledger_status <> 'CLOSED'
          AND collaboration_material.sqe_user_id = ${actualActor.id}::uuid AND collaboration_material.removed_at IS NULL)
      AND EXISTS (SELECT 1 FROM user_positions collaboration_assignment
        JOIN positions collaboration_position ON collaboration_position.id = collaboration_assignment.position_id AND collaboration_position.organization_id = collaboration_assignment.organization_id
        JOIN departments collaboration_department ON collaboration_department.id = collaboration_position.department_id AND collaboration_department.organization_id = collaboration_position.organization_id
        JOIN organizations collaboration_organization ON collaboration_organization.id = collaboration_assignment.organization_id
        WHERE collaboration_assignment.organization_id = ${organizationId}::uuid AND collaboration_assignment.user_id = ${actualActor.id}::uuid
          AND collaboration_assignment.started_at <= statement_timestamp() AND (collaboration_assignment.ended_at IS NULL OR collaboration_assignment.ended_at > statement_timestamp())
          AND collaboration_position.status = 'ACTIVE' AND collaboration_department.status = 'ACTIVE' AND collaboration_organization.status = 'ACTIVE')
    )`;
  }

  async supplierCollaborationProjection(tx: AdminTransaction, actualActor: AdminActor, sourceId: string): Promise<SupplierCollaborationProjection[]> {
    const organizationId = this.scope(actualActor);
    uuid(sourceId);
    await assertActiveAuthentication(tx, actualActor, 'SHARE');
    await assertAdminAccess(tx, actualActor, organizationId, ['process-quality:defects:read', 'process-quality:materials:review']);
    const current = await this.find(tx, organizationId, sourceId);
    if (current.archivedAt || current.ledgerStatus === 'CLOSED') return [];
    const assignment = await tx.userPosition.findFirst({ where: { userId: actualActor.id, organizationId,
      ...effectivePositionAssignmentWhere() }, select: { id: true } });
    if (!assignment) return [];
    const materials = await tx.$queryRaw<Array<{ id: string; verification: SupplierCollaborationProjection['verification'] }>>`
      SELECT id, verification FROM process_defect_material_items WHERE organization_id = ${organizationId}::uuid
        AND defect_id = ${sourceId}::uuid AND sqe_user_id = ${actualActor.id}::uuid AND removed_at IS NULL ORDER BY position, id`;
    return materials.map(item => ({ sourceKind: 'PROCESS_LEDGER', sourceId, canonicalFactKey: `PROCESS_LEDGER:${sourceId}`,
      materialItemId: item.id, verification: item.verification, progress: null, result: null }));
  }

  async supplierCopyProjection(tx: AdminTransaction, actor: AdminActor, source: SupplierCopySource): Promise<SupplierCopyProjection> {
    const organizationId = this.scope(actor);
    uuid(source.sourceId);
    if (source.kind !== 'PROCESS_LEDGER' || !Number.isSafeInteger(source.sourceVersion) || source.sourceVersion < 1) reject('PROCESS_DEFECT_INPUT_INVALID', 400);
    await assertActiveAuthentication(tx, actor, 'SHARE');
    await assertAdminAccess(tx, actor, organizationId, ['process-quality:defects:read', 'supplier-quality:issues:copy']);
    await this.lock(tx, organizationId, source.sourceId);
    const record = await this.find(tx, organizationId, source.sourceId);
    if (record.archivedAt) reject('PROCESS_DEFECT_ARCHIVED', 409);
    if (record.version !== source.sourceVersion) reject('CONCURRENCY_CONFLICT', 409);
    const materials = await tx.$queryRaw<Array<{ id: string; materialCode: string | null; materialName: string | null; materialBatch: string | null;
      supplierProfileId: string | null; supplierOrganizationId: string | null }>>`SELECT id, material_code AS "materialCode", material_name AS "materialName",
      material_batch AS "materialBatch", supplier_profile_id AS "supplierProfileId", supplier_organization_id AS "supplierOrganizationId"
      FROM process_defect_material_items WHERE organization_id = ${organizationId}::uuid AND defect_id = ${record.id}::uuid AND removed_at IS NULL ORDER BY position, id`;
    return { organizationId, source, facts: [{ factKey: `PROCESS_LEDGER:${record.id}`, defectDescription: record.description,
      defectQuantity: record.defectQuantity, materials }] };
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
    const allowed = ['organizationId', 'expectedVersion', 'factoryCode', 'defectTypeCode', 'description', 'defectQuantity', 'occurredAt', 'batchCode', 'workOrderCode', 'operationCode', 'lineCode', 'lineName', 'operationName', 'projectCode', 'productCode', 'materialCode', 'supplierOrganizationId', 'responsibilityCategory', 'traceCode', 'analysisProgress', 'materials', 'externalSourceSystem', 'externalRecordKey', 'sourceObservedAt'];
    if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(field => !allowed.includes(field))) reject('PROCESS_DEFECT_INPUT_INVALID', 400);
    if (input.projectCode !== undefined) reject('PROCESS_DEFECT_DERIVED_FIELD_READ_ONLY', 400);
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

  private async materials(tx: AdminTransaction, organizationId: string, defectId: string): Promise<ProcessDefectMaterial[]> {
    const scope = Prisma.sql`organization_id = ${organizationId}::uuid AND defect_id = ${defectId}::uuid`;
    const items = await this.materialRows(tx, scope);
    const entries = groupByDefect(await this.materialVerificationHistory(tx, scope)).get(defectId) ?? [];
    return items.map(item => ({ ...item, verificationHistory: entries.filter(entry => entry.materialItemId === item.id) }));
  }

  private materialRows(tx: AdminTransaction, scope: Prisma.Sql) {
    return tx.$queryRaw<Omit<ProcessDefectMaterial, 'verificationHistory'>[]>`SELECT ${materialColumns} FROM process_defect_material_items
      WHERE ${scope} AND removed_at IS NULL ORDER BY position, id`;
  }

  private materialVerificationHistory(tx: AdminTransaction, scope: Prisma.Sql) {
    return tx.$queryRaw<(ProcessMaterialVerificationHistory & { defectId: string })[]>`SELECT id, defect_id AS "defectId", material_item_id AS "materialItemId", verification,
      verification_notes AS "verificationNotes", actor_user_id AS "actorUserId", recorded_at AS "recordedAt", defect_version AS "defectVersion", material_snapshot AS "materialSnapshot"
      FROM process_defect_material_verifications WHERE ${scope} ORDER BY defect_version, id`;
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
    const [item] = await this.views(tx, record.organizationId, [record]);
    return item!;
  }

  private async views(tx: AdminTransaction, organizationId: string, records: ProcessDefect[]) {
    if (records.length === 0) return [];
    const ids = Prisma.join(records.map(record => Prisma.sql`${record.id}::uuid`));
    const scope = Prisma.sql`organization_id = ${organizationId}::uuid AND defect_id IN (${ids})`;
    const registrantIds = [...new Set(records.filter(record => record.sourceKind !== 'IMS').map(record => record.createdById))];
    const [materialRows, verificationRows, ledgerRows, classificationRows, duplicateRows, registrants] = await Promise.all([
      this.materialRows(tx, scope),
      this.materialVerificationHistory(tx, scope),
      tx.$queryRaw<(ProcessLedgerHistory & { defectId: string })[]>`SELECT id, defect_id AS "defectId", from_status AS "fromStatus", to_status AS "toStatus", actor_user_id AS "actorUserId", reason,
        recorded_at AS "recordedAt", defect_version AS "defectVersion" FROM process_defect_ledger_history WHERE ${scope} ORDER BY defect_version, id`,
      tx.$queryRaw<(ProcessClassificationHistory & { defectId: string })[]>`SELECT id, defect_id AS "defectId", previous_category AS "previousCategory", category,
        actor_user_id AS "actorUserId", recorded_at AS "recordedAt", defect_version AS "defectVersion"
        FROM process_defect_classification_history WHERE ${scope} ORDER BY defect_version, id`,
      records.some(record => record.traceCode && record.operationCode) ? tx.$queryRaw<{ id: string; duplicateCount: bigint }[]>`WITH selected AS (
          SELECT id, operation_code, trace_code FROM process_defects WHERE organization_id = ${organizationId}::uuid AND id IN (${ids})
          AND operation_code <> '' AND trace_code <> ''
        ), counts AS (
          SELECT operation_code, trace_code, count(*) AS total FROM process_defects
          JOIN (SELECT DISTINCT operation_code, trace_code FROM selected) AS selected_pairs USING (operation_code, trace_code)
          WHERE organization_id = ${organizationId}::uuid AND archived_at IS NULL GROUP BY operation_code, trace_code
        ) SELECT selected.id, counts.total AS "duplicateCount" FROM selected JOIN counts USING (operation_code, trace_code)` : [],
      registrantIds.length ? tx.user.findMany({ where: { id: { in: registrantIds } }, select: { id: true, fullName: true, username: true } }) : [],
    ]);
    const verificationsByDefect = groupByDefect(verificationRows);
    const verificationsByMaterial = new Map<string, ProcessMaterialVerificationHistory[]>();
    for (const history of verificationsByDefect.values()) {
      for (const entry of history) appendToGroup(verificationsByMaterial, entry.materialItemId, entry);
    }
    const materialsByDefect = new Map<string, ProcessDefectMaterial[]>();
    for (const item of materialRows) appendToGroup(materialsByDefect, item.defectId, { ...item, verificationHistory: verificationsByMaterial.get(item.id) ?? [] });
    const ledgerByDefect = groupByDefect(ledgerRows);
    const classificationsByDefect = groupByDefect(classificationRows);
    const countsByDefect = new Map(duplicateRows.map(row => [row.id, Number(row.duplicateCount)]));
    const registrantsById = new Map(registrants.map(user => [user.id, user.fullName ?? user.username]));
    return records.map(record => {
      const materials = materialsByDefect.get(record.id) ?? [];
      const saved = processProjectSnapshot(record.projectSnapshot);
      const componentProject = saved ? { outcome: 'matched' as const, componentCode: saved.componentCode,
        mapping: { ...saved.mapping, productCategory: record.productCategory, productSubcategory: record.productSubcategory }, project: saved.project,
        issues: [] } : null;
      const matchingCount = countsByDefect.get(record.id) ?? 0;
      const duplicateCount = matchingCount && !record.archivedAt ? matchingCount - 1 : matchingCount;
      const issues = [
        ...(!record.description.trim() ? ['DESCRIPTION_EMPTY'] : []), ...(record.defectTypeCode === null ? ['DEFECT_TYPE_UNKNOWN'] : []),
        ...(record.defectQuantity === null ? ['DEFECT_QUANTITY_UNKNOWN'] : []), ...(record.occurredAt === null ? ['OCCURRED_AT_UNKNOWN'] : []),
        ...(duplicateCount ? ['SAME_OPERATION_TRACE_DUPLICATE'] : []), ...(componentProject?.issues ?? []),
        ...(record.projectCode && componentProject?.project && record.projectCode !== componentProject.project.code ? ['MANUAL_PROJECT_DIFFERS'] : []),
        ...record.registrationIssues,
        ...(record.registrationVersion === null ? ['HISTORICAL_ASSOCIATION_UNCONFIRMED'] : [
          ...(!saved ? ['PROJECT_MAPPING_PENDING'] : []), ...(!record.productSubcategory ? ['PRODUCT_SUBCATEGORY_PENDING'] : []),
          ...(!record.operationSector ? ['OPERATION_SECTOR_PENDING'] : []),
          ...(record.sourceKind === 'IMS' && !record.externalRecordKey ? ['SOURCE_IDENTITY_INCOMPLETE'] : []),
        ]),
      ];
      return { ...record, projectStage: saved?.project.stage ?? null, projectName: saved?.project.name ?? null,
        registeredByName: record.sourceKind === 'IMS' ? '自动' : registrantsById.get(record.createdById) ?? null,
        materialCode: materials[0]?.materialCode ?? null, supplierOrganizationId: materials[0]?.supplierOrganizationId ?? null,
        materials, materialVerificationHistory: verificationsByDefect.get(record.id) ?? [], ledgerHistory: ledgerByDefect.get(record.id) ?? [],
        classificationHistory: classificationsByDefect.get(record.id) ?? [], componentProject, duplicateCount, issues };
    });
  }

  private completionFor(tx: AdminTransaction, organizationId: string, facts: ReturnType<typeof normalizeProcessDefectFacts>, previous?: ProcessDefect, correctedFields: readonly string[] = []) {
    return (this.completion ?? new ProcessDefectCompletionService(this.prisma, this.audit, this.projects)).derive(tx, organizationId, facts, previous, correctedFields);
  }

  private async validateReferences(tx: AdminTransaction, organizationId: string, facts: ReturnType<typeof normalizeProcessDefectFacts>) {
    if (facts.defectTypeCode) {
      const type = await tx.processDefectType.findUnique({ where: { organizationId_code: { organizationId, code: facts.defectTypeCode } } });
      if (!type?.active) reject('PROCESS_DEFECT_TYPE_NOT_FOUND', 400);
    }
  }
}
