import { HttpException, Injectable } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import type { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../database/prisma.service.js';
import { AdminMutationService, assertAdminAccess, type AdminActor, type AdminTransaction } from '../../common/security/admin-mutation.service.js';
import { AuditLogService } from '../audit-log/audit-log.service.js';
import type { DomainSourceRecord, DomainSourceReference } from '../problem-index/domain-source-issue.service.js';

export type CustomerComplaintType = 'ZERO_KM' | 'AFTER_SALES';
export type CustomerExternalSourceSystem = 'ERP' | 'SAP' | 'IMS';
export type CustomerRelationType = 'CUSTOMER_PARENT' | 'VEHICLE_MODEL' | 'PROJECT' | 'PRODUCT';
export interface CustomerQualityExternalAdapter<ExternalRecord> {
  readonly system: CustomerExternalSourceSystem;
  map(record: ExternalRecord): Pick<CustomerComplaintInput, 'externalSourceSystem' | 'externalRecordKey' | 'sourceObservedAt'>;
}
export interface CustomerComplaintInput {
  customerId: string;
  complaintType: CustomerComplaintType;
  terminalCustomerName?: string | null;
  productCode?: string | null;
  productModel?: string | null;
  defectDescription: string;
  vin?: string | null;
  mileage?: number | null;
  purchaseDate?: Date | null;
  returnRequired?: boolean;
  physicalAnalysisRequired?: boolean;
  severity: string;
  severityPolicyVersion: string;
  severitySnapshot: Prisma.InputJsonValue;
  externalSourceSystem?: CustomerExternalSourceSystem | null;
  externalRecordKey?: string | null;
  sourceObservedAt?: Date | null;
}
export type CustomerComplaintImportRow = CustomerComplaintInput & { rowNumber: number };
export type CustomerMasterImportRow = { rowNumber: number; code: unknown; name: unknown };
type CustomerMasterImportResultItem = { rowNumber: number; code: string; status: 'CREATED' | 'SKIPPED_DUPLICATE' | 'FAILED'; errorCode?: string };

type Row = Record<string, any>;
function fail(code: string, status: number): never { throw new HttpException({ code, message: code }, status); }
function text(value: unknown, max: number, code = 'CUSTOMER_QUALITY_INPUT_INVALID'): string {
  const result = typeof value === 'string' ? value.trim() : ''; if (!result || result.length > max) fail(code, 400); return result;
}
function optional(value: string | null | undefined, max: number): string | null { return value == null || !value.trim() ? null : text(value, max); }
function uuid(value: string, code = 'CUSTOMER_QUALITY_INPUT_INVALID'): string { if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) fail(code, 400); return value; }
function severitySnapshot(value: Prisma.InputJsonValue, level: string, policyVersion: string): Prisma.InputJsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('CUSTOMER_QUALITY_SEVERITY_SNAPSHOT_INVALID', 400);
  const snapshot = value as Prisma.InputJsonObject;
  if (snapshot.level !== undefined && snapshot.level !== level) fail('CUSTOMER_QUALITY_SEVERITY_SNAPSHOT_INVALID', 400);
  if (snapshot.policyVersion !== undefined && snapshot.policyVersion !== policyVersion) fail('CUSTOMER_QUALITY_SEVERITY_SNAPSHOT_INVALID', 400);
  const normalized = { ...snapshot, level, policyVersion };
  if (JSON.stringify(normalized).length > 10000) fail('CUSTOMER_QUALITY_SEVERITY_SNAPSHOT_INVALID', 400);
  return normalized;
}
function mapUnique(error: unknown): never {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes('23505') || message.includes('duplicate key')) fail('CONCURRENCY_CONFLICT', 409);
  throw error;
}

@Injectable()
export class CustomerQualityService {
  constructor(private readonly prisma: PrismaService, private readonly mutations: AdminMutationService, private readonly audit: AuditLogService) {}

  private scope(actor: AdminActor): string {
    if (actor.accountType !== 'INTERNAL') fail('ORGANIZATION_SCOPE_DENIED', 403);
    return actor.scopeOrganizationId ?? actor.organizationId;
  }

  async createCustomer(actor: AdminActor, input: { code: string; name: string }, traceId: string, key?: string) {
    const organizationId = this.scope(actor); const code = text(input.code, 100).toUpperCase(); const name = text(input.name, 200);
    return this.mutations.run({ actor, organizationId, key, traceId, action: 'CUSTOMER_MASTER_CREATED', payload: { code, name }, permission: 'customer-quality:complaints:write', duplicateCode: 'CONCURRENCY_CONFLICT' }, async (tx) => {
      const record = await this.createCustomerInTransaction(tx, actor, { code, name }, traceId);
      if (!record) fail('CONCURRENCY_CONFLICT', 409);
      return record;
    }).catch(mapUnique);
  }

  async createCustomerInTransaction(tx: AdminTransaction, actor: AdminActor, input: { code: unknown; name: unknown }, traceId: string) {
    const organizationId = this.scope(actor); const code = text(input.code, 100).toUpperCase(); const name = text(input.name, 200);
    await assertAdminAccess(tx, actor, organizationId, 'customer-quality:complaints:write');
    const id = randomUUID();
    const rows = await tx.$queryRaw<Row[]>`INSERT INTO customer_quality_customers (id, organization_id, code, name, active, version, created_by_id, updated_by_id, updated_at) VALUES (${id}::uuid, ${organizationId}::uuid, ${code}, ${name}, true, 1, ${actor.id}::uuid, ${actor.id}::uuid, CURRENT_TIMESTAMP) ON CONFLICT (organization_id, code) DO NOTHING RETURNING *`;
    if (!rows[0]) return null;
    await this.audit.record({ organizationId, actorUserId: actor.id, action: 'CUSTOMER_MASTER_CREATED', resourceType: 'CustomerMaster', resourceId: id, outcome: 'SUCCESS', traceId, metadata: { resourceVersion: 1 } }, tx);
    return rows[0];
  }

  async importCustomers(actor: AdminActor, rows: CustomerMasterImportRow[], traceId: string, key?: string) {
    const organizationId = this.scope(actor);
    if (!Array.isArray(rows) || rows.length < 1 || rows.length > 100 || rows.some((row) => !row || typeof row !== 'object' || Array.isArray(row) || !Number.isSafeInteger(row.rowNumber) || row.rowNumber < 1 || Object.keys(row).some((field) => !['rowNumber', 'code', 'name'].includes(field))) || new Set(rows.map((row) => row.rowNumber)).size !== rows.length) fail('CUSTOMER_QUALITY_INPUT_INVALID', 400);
    // Reserve the complete payload before committing rows, so a replay cannot append or change rows.
    await this.mutations.run({ actor, organizationId, key, traceId, action: 'CUSTOMER_MASTER_IMPORT', payload: rows, permission: 'customer-quality:complaints:write', isolationLevel: 'ReadCommitted' }, async () => null);
    const batchKey = createHash('sha256').update(key!).digest('hex');
    const items: CustomerMasterImportResultItem[] = [];
    for (const row of [...rows].sort((first, second) => first.rowNumber - second.rowNumber)) {
      const code = typeof row.code === 'string' ? row.code.trim().toUpperCase() : '';
      try {
        const result = await this.mutations.run({ actor, organizationId, key: `customer-import:${batchKey}:${row.rowNumber}`, traceId, action: 'CUSTOMER_MASTER_IMPORT_ROW', payload: row, permission: 'customer-quality:complaints:write', isolationLevel: 'ReadCommitted' }, async (tx) => {
          const customer = await this.createCustomerInTransaction(tx, actor, row, traceId);
          return { rowNumber: row.rowNumber, code, status: customer ? 'CREATED' as const : 'SKIPPED_DUPLICATE' as const };
        });
        items.push(result);
      } catch (error) {
        const errorCode = error instanceof HttpException ? (error.getResponse() as { code?: string }).code : undefined;
        if (error instanceof HttpException && ([401, 403].includes(error.getStatus()) || errorCode === 'IDEMPOTENCY_REPLAY')) throw error;
        items.push({ rowNumber: row.rowNumber, code, status: 'FAILED', errorCode: errorCode ?? 'CUSTOMER_MASTER_IMPORT_ROW_FAILED' });
      }
    }
    return { items, created: items.filter((item) => item.status === 'CREATED').length, skipped: items.filter((item) => item.status === 'SKIPPED_DUPLICATE').length, failed: items.filter((item) => item.status === 'FAILED').length };
  }

  async updateCustomer(actor: AdminActor, id: string, input: { expectedVersion: number; name?: string; active?: boolean }, traceId: string, key?: string) {
    const organizationId = this.scope(actor); id = uuid(id); if (!Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 1) fail('CUSTOMER_QUALITY_INPUT_INVALID', 400);
    const name = input.name === undefined ? null : text(input.name, 200); if (input.active !== undefined && typeof input.active !== 'boolean') fail('CUSTOMER_QUALITY_INPUT_INVALID', 400);
    return this.mutations.run({ actor, organizationId, key, traceId, action: 'CUSTOMER_MASTER_UPDATED', payload: { id, ...input }, permission: 'customer-quality:complaints:write' }, async (tx) => {
      const rows = await tx.$queryRaw<Row[]>`UPDATE customer_quality_customers SET name = COALESCE(${name}, name), active = COALESCE(${input.active ?? null}, active), version = version + 1, updated_by_id = ${actor.id}::uuid, updated_at = CURRENT_TIMESTAMP WHERE id = ${id}::uuid AND organization_id = ${organizationId}::uuid AND version = ${input.expectedVersion} AND active IS NOT NULL RETURNING *`;
      if (!rows[0]) fail('CONCURRENCY_CONFLICT', 409);
      await this.audit.record({ organizationId, actorUserId: actor.id, action: 'CUSTOMER_MASTER_UPDATED', resourceType: 'CustomerMaster', resourceId: id, outcome: 'SUCCESS', traceId, metadata: { resourceVersion: rows[0].version } }, tx);
      return rows[0];
    }, async (tx) => {
      const rows = await tx.$queryRaw<Row[]>`SELECT id FROM customer_quality_customers WHERE id = ${id}::uuid AND organization_id = ${organizationId}::uuid`;
      if (!rows[0]) fail('CUSTOMER_MASTER_NOT_FOUND', 404);
    });
  }

  async listCustomers(actor: AdminActor) {
    const organizationId = this.scope(actor);
    return this.prisma.$transaction(async (tx) => { await assertAdminAccess(tx, actor, organizationId, 'customer-quality:complaints:read'); return tx.$queryRaw<Row[]>`SELECT * FROM customer_quality_customers WHERE organization_id = ${organizationId}::uuid ORDER BY code`; });
  }

  async createComplaint(actor: AdminActor, input: CustomerComplaintInput, traceId: string, key?: string) {
    const organizationId = this.scope(actor); const facts = this.normalize(input);
    facts.customerId = uuid(facts.customerId);
    return this.mutations.run({ actor, organizationId, key, traceId, action: 'CUSTOMER_COMPLAINT_CREATED', payload: { ...facts, purchaseDate: facts.purchaseDate?.toISOString(), sourceObservedAt: facts.sourceObservedAt?.toISOString() }, permission: 'customer-quality:complaints:write', duplicateCode: 'CONCURRENCY_CONFLICT' }, async (tx) => {
      const customer = await tx.$queryRaw<Row[]>`SELECT id, active FROM customer_quality_customers WHERE id = ${facts.customerId}::uuid AND organization_id = ${organizationId}::uuid FOR UPDATE`;
      if (!customer[0]) fail('CUSTOMER_MASTER_NOT_FOUND', 404); if (!customer[0].active) fail('CUSTOMER_MASTER_INACTIVE', 409);
      const id = randomUUID(); const complaintNumber = `CQ-${new Date().toISOString().slice(0, 10).replaceAll('-', '')}-${id.slice(0, 8).toUpperCase()}`;
      const rows = await tx.$queryRaw<Row[]>`INSERT INTO customer_quality_complaints (id, organization_id, complaint_number, customer_id, complaint_type, terminal_customer_name, product_code, product_model, defect_description, vin, mileage, purchase_date, return_required, physical_analysis_required, severity, severity_policy_version, severity_snapshot, external_source_system, external_record_key, source_observed_at, ingestion_status, version, created_by_id, updated_by_id, updated_at) VALUES (${id}::uuid, ${organizationId}::uuid, ${complaintNumber}, ${facts.customerId}::uuid, ${facts.complaintType}, ${facts.terminalCustomerName}, ${facts.productCode}, ${facts.productModel}, ${facts.defectDescription}, ${facts.vin}, ${facts.mileage}, ${facts.purchaseDate}, ${facts.returnRequired}, ${facts.physicalAnalysisRequired}, ${facts.severity}, ${facts.severityPolicyVersion}, ${JSON.stringify(facts.severitySnapshot)}::jsonb, ${facts.externalSourceSystem}, ${facts.externalRecordKey}, ${facts.sourceObservedAt}, ${facts.externalSourceSystem ? 'PENDING_VERIFICATION' : null}, 1, ${actor.id}::uuid, ${actor.id}::uuid, CURRENT_TIMESTAMP) RETURNING *`;
      const record = rows[0]!;
      if (facts.externalSourceSystem) await tx.$executeRaw`INSERT INTO customer_quality_ingestion_audits (id, organization_id, complaint_id, external_source_system, external_record_key, status, observed_at, recorded_by_id) VALUES (${randomUUID()}::uuid, ${organizationId}::uuid, ${id}::uuid, ${facts.externalSourceSystem}, ${facts.externalRecordKey}, 'PENDING_VERIFICATION', ${facts.sourceObservedAt}, ${actor.id}::uuid)`;
      await this.audit.record({ organizationId, actorUserId: actor.id, action: 'CUSTOMER_COMPLAINT_CREATED', resourceType: 'CustomerComplaint', resourceId: id, outcome: 'SUCCESS', traceId, metadata: { resourceVersion: 1 } }, tx);
      return record;
    }).catch(mapUnique);
  }

  async listCustomerRelations(actor: AdminActor, customerId: string) {
    const organizationId = this.scope(actor); customerId = uuid(customerId);
    return this.prisma.$transaction(async (tx) => {
      await assertAdminAccess(tx, actor, organizationId, 'customer-quality:complaints:read');
      const customer = await tx.$queryRaw<Row[]>`SELECT id FROM customer_quality_customers WHERE id = ${customerId}::uuid AND organization_id = ${organizationId}::uuid`;
      if (!customer[0]) fail('CUSTOMER_MASTER_NOT_FOUND', 404);
      return tx.$queryRaw<Row[]>`SELECT * FROM customer_quality_customer_relations WHERE organization_id = ${organizationId}::uuid AND customer_id = ${customerId}::uuid ORDER BY relation_type, related_code NULLS LAST, related_name NULLS LAST`;
    });
  }

  private normalizeCustomerRelation(input: { relationType: CustomerRelationType; relatedCustomerId?: string | null; relatedCode?: string | null; relatedName?: string | null }) {
    if (!['CUSTOMER_PARENT', 'VEHICLE_MODEL', 'PROJECT', 'PRODUCT'].includes(input.relationType)) fail('CUSTOMER_QUALITY_INPUT_INVALID', 400);
    const relatedCustomerId = input.relatedCustomerId ? uuid(input.relatedCustomerId) : null;
    const relatedCode = optional(input.relatedCode, 100); const relatedName = optional(input.relatedName, 200);
    if (input.relationType === 'CUSTOMER_PARENT' && (!relatedCustomerId || relatedCode || relatedName)) fail('CUSTOMER_QUALITY_INPUT_INVALID', 400);
    if (input.relationType !== 'CUSTOMER_PARENT' && (relatedCustomerId || !relatedCode || !relatedName)) fail('CUSTOMER_QUALITY_INPUT_INVALID', 400);
    return { relationType: input.relationType, relatedCustomerId, relatedCode, relatedName };
  }

  async createCustomerRelation(actor: AdminActor, customerId: string, input: { relationType: CustomerRelationType; relatedCustomerId?: string; relatedCode?: string; relatedName?: string }, traceId: string, key?: string) {
    const organizationId = this.scope(actor); customerId = uuid(customerId); const relation = this.normalizeCustomerRelation(input);
    return this.mutations.run({ actor, organizationId, key, traceId, action: 'CUSTOMER_MASTER_RELATION_CREATED', payload: { customerId, ...relation }, permission: 'customer-quality:complaints:write', duplicateCode: 'CONCURRENCY_CONFLICT' }, async (tx) => {
      const customer = await tx.$queryRaw<Row[]>`SELECT id FROM customer_quality_customers WHERE id = ${customerId}::uuid AND organization_id = ${organizationId}::uuid`;
      if (!customer[0]) fail('CUSTOMER_MASTER_NOT_FOUND', 404);
      if (relation.relatedCustomerId) {
        if (relation.relatedCustomerId === customerId) fail('CUSTOMER_QUALITY_INPUT_INVALID', 400);
        const parent = await tx.$queryRaw<Row[]>`SELECT id FROM customer_quality_customers WHERE id = ${relation.relatedCustomerId}::uuid AND organization_id = ${organizationId}::uuid`;
        if (!parent[0]) fail('CUSTOMER_MASTER_NOT_FOUND', 404);
        const cycle = await tx.$queryRaw<Row[]>`WITH RECURSIVE ancestors(id) AS (SELECT ${relation.relatedCustomerId}::uuid UNION SELECT r.related_customer_id FROM customer_quality_customer_relations r JOIN ancestors a ON r.customer_id = a.id WHERE r.organization_id = ${organizationId}::uuid AND r.relation_type = 'CUSTOMER_PARENT') SELECT id FROM ancestors WHERE id = ${customerId}::uuid LIMIT 1`;
        if (cycle[0]) fail('CONCURRENCY_CONFLICT', 409);
      }
      const id = randomUUID();
      const rows = await tx.$queryRaw<Row[]>`INSERT INTO customer_quality_customer_relations (id, organization_id, customer_id, relation_type, related_customer_id, related_code, related_name, version, created_by_id, updated_by_id, updated_at) VALUES (${id}::uuid, ${organizationId}::uuid, ${customerId}::uuid, ${relation.relationType}, ${relation.relatedCustomerId}::uuid, ${relation.relatedCode}, ${relation.relatedName}, 1, ${actor.id}::uuid, ${actor.id}::uuid, CURRENT_TIMESTAMP) RETURNING *`;
      await this.audit.record({ organizationId, actorUserId: actor.id, action: 'CUSTOMER_MASTER_RELATION_CREATED', resourceType: 'CustomerMasterRelation', resourceId: id, outcome: 'SUCCESS', traceId, metadata: { customerId, relationType: relation.relationType, resourceVersion: 1 } }, tx);
      return rows[0]!;
    }).catch(mapUnique);
  }

  async updateCustomerRelation(actor: AdminActor, id: string, input: { expectedVersion: number; relatedCustomerId?: string; relatedCode?: string; relatedName?: string }, traceId: string, key?: string) {
    const organizationId = this.scope(actor); id = uuid(id); if (!Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 1) fail('CUSTOMER_QUALITY_INPUT_INVALID', 400);
    return this.mutations.run({ actor, organizationId, key, traceId, action: 'CUSTOMER_MASTER_RELATION_UPDATED', payload: { id, ...input }, permission: 'customer-quality:complaints:write' }, async (tx) => {
      const current = await tx.$queryRaw<Row[]>`SELECT * FROM customer_quality_customer_relations WHERE id = ${id}::uuid AND organization_id = ${organizationId}::uuid FOR UPDATE`;
      if (!current[0]) fail('CUSTOMER_MASTER_RELATION_NOT_FOUND', 404);
      const normalized = this.normalizeCustomerRelation({ relationType: current[0].relation_type, relatedCustomerId: input.relatedCustomerId ?? current[0].related_customer_id, relatedCode: input.relatedCode ?? current[0].related_code, relatedName: input.relatedName ?? current[0].related_name });
      if (normalized.relatedCustomerId) {
        if (normalized.relatedCustomerId === current[0].customer_id) fail('CUSTOMER_QUALITY_INPUT_INVALID', 400);
        const parent = await tx.$queryRaw<Row[]>`SELECT id FROM customer_quality_customers WHERE id = ${normalized.relatedCustomerId}::uuid AND organization_id = ${organizationId}::uuid`;
        if (!parent[0]) fail('CUSTOMER_MASTER_NOT_FOUND', 404);
        const cycle = await tx.$queryRaw<Row[]>`WITH RECURSIVE ancestors(id) AS (SELECT ${normalized.relatedCustomerId}::uuid UNION SELECT r.related_customer_id FROM customer_quality_customer_relations r JOIN ancestors a ON r.customer_id = a.id WHERE r.organization_id = ${organizationId}::uuid AND r.relation_type = 'CUSTOMER_PARENT') SELECT id FROM ancestors WHERE id = ${current[0].customer_id}::uuid LIMIT 1`;
        if (cycle[0]) fail('CONCURRENCY_CONFLICT', 409);
      }
      const rows = await tx.$queryRaw<Row[]>`UPDATE customer_quality_customer_relations SET related_customer_id = ${normalized.relatedCustomerId}::uuid, related_code = ${normalized.relatedCode}, related_name = ${normalized.relatedName}, version = version + 1, updated_by_id = ${actor.id}::uuid, updated_at = CURRENT_TIMESTAMP WHERE id = ${id}::uuid AND organization_id = ${organizationId}::uuid AND version = ${input.expectedVersion} RETURNING *`;
      if (!rows[0]) fail('CONCURRENCY_CONFLICT', 409);
      await this.audit.record({ organizationId, actorUserId: actor.id, action: 'CUSTOMER_MASTER_RELATION_UPDATED', resourceType: 'CustomerMasterRelation', resourceId: id, outcome: 'SUCCESS', traceId, metadata: { resourceVersion: rows[0].version } }, tx);
      return rows[0];
    }, async (tx) => { const rows = await tx.$queryRaw<Row[]>`SELECT id FROM customer_quality_customer_relations WHERE id = ${id}::uuid AND organization_id = ${organizationId}::uuid`; if (!rows[0]) fail('CUSTOMER_MASTER_RELATION_NOT_FOUND', 404); }).catch(mapUnique);
  }

  async deleteCustomerRelation(actor: AdminActor, id: string, expectedVersion: number, traceId: string, key?: string) {
    const organizationId = this.scope(actor); id = uuid(id); if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1) fail('CUSTOMER_QUALITY_INPUT_INVALID', 400);
    return this.mutations.run({ actor, organizationId, key, traceId, action: 'CUSTOMER_MASTER_RELATION_DELETED', payload: { id, expectedVersion }, permission: 'customer-quality:complaints:write' }, async (tx) => {
      const rows = await tx.$queryRaw<Row[]>`DELETE FROM customer_quality_customer_relations WHERE id = ${id}::uuid AND organization_id = ${organizationId}::uuid AND version = ${expectedVersion} RETURNING id`;
      if (!rows[0]) fail('CONCURRENCY_CONFLICT', 409);
      await this.audit.record({ organizationId, actorUserId: actor.id, action: 'CUSTOMER_MASTER_RELATION_DELETED', resourceType: 'CustomerMasterRelation', resourceId: id, outcome: 'SUCCESS', traceId, metadata: { expectedVersion } }, tx);
      return { id, deleted: true };
    });
  }

  async importComplaints(actor: AdminActor, rows: CustomerComplaintImportRow[], traceId: string, key?: string) {
    const organizationId = this.scope(actor);
    if (!Array.isArray(rows) || rows.length < 1 || rows.length > 100) fail('CUSTOMER_QUALITY_IMPORT_ROWS_INVALID', 400);
    const batchKey = key;
    if (!batchKey) fail('IDEMPOTENCY_KEY_REQUIRED', 400);
    const items: { rowNumber: number; status: 'CREATED' | 'DUPLICATE' | 'REJECTED'; complaintId: string | null; complaintNumber: string | null; errorCode: string | null }[] = [];
    for (const row of rows) {
      const rowKey = `${batchKey}:${row.rowNumber}`.slice(0, 128);
      try {
        const facts = this.normalize(row);
        facts.customerId = uuid(facts.customerId);
        if (!facts.externalSourceSystem || !facts.externalRecordKey || !facts.sourceObservedAt) fail('CUSTOMER_QUALITY_IMPORT_EXTERNAL_ID_REQUIRED', 400);
        try {
          const created = await this.createComplaint(actor, facts, traceId, rowKey);
          items.push({ rowNumber: row.rowNumber, status: 'CREATED', complaintId: created.id, complaintNumber: created.complaint_number, errorCode: null });
        } catch (error) {
          const status = error instanceof HttpException ? error.getStatus() : 500;
          if (status === 409) {
            const existing = await this.prisma.$transaction(async (tx) => {
              await assertAdminAccess(tx, actor, organizationId, 'customer-quality:complaints:write');
              const records = await tx.$queryRaw<Row[]>`SELECT id, complaint_number FROM customer_quality_complaints WHERE organization_id = ${organizationId}::uuid AND external_source_system = ${facts.externalSourceSystem} AND external_record_key = ${facts.externalRecordKey}`;
              return records[0] ?? null;
            });
            if (existing) {
              items.push({ rowNumber: row.rowNumber, status: 'DUPLICATE', complaintId: existing.id, complaintNumber: existing.complaint_number, errorCode: null });
              continue;
            }
          }
          throw error;
        }
      } catch (error) {
        const response = error instanceof HttpException ? error.getResponse() : null;
        const errorCode = typeof response === 'object' && response !== null && 'code' in response ? String((response as { code: unknown }).code) : 'CUSTOMER_QUALITY_IMPORT_ROW_FAILED';
        items.push({ rowNumber: row.rowNumber, status: 'REJECTED', complaintId: null, complaintNumber: null, errorCode });
      }
    }
    return { created: items.filter((item) => item.status === 'CREATED').length, duplicates: items.filter((item) => item.status === 'DUPLICATE').length, rejected: items.filter((item) => item.status === 'REJECTED').length, items };
  }

  async updateComplaint(actor: AdminActor, id: string, input: { expectedVersion: number; defectDescription?: string; severity?: string; severityPolicyVersion?: string; severitySnapshot?: Prisma.InputJsonValue }, traceId: string, key?: string) {
    const organizationId = this.scope(actor); id = uuid(id); if (!Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 1) fail('CUSTOMER_QUALITY_INPUT_INVALID', 400);
    const severityFields = [input.severity, input.severityPolicyVersion, input.severitySnapshot];
    if (severityFields.some((value) => value !== undefined) && severityFields.some((value) => value === undefined)) fail('CUSTOMER_QUALITY_SEVERITY_SNAPSHOT_REQUIRED', 400);
    const description = input.defectDescription === undefined ? null : text(input.defectDescription, 10000); const severity = input.severity === undefined ? null : text(input.severity, 32); const policy = input.severityPolicyVersion === undefined ? null : text(input.severityPolicyVersion, 100); const snapshot = input.severitySnapshot === undefined ? null : JSON.stringify(severitySnapshot(input.severitySnapshot, severity!, policy!));
    return this.mutations.run({ actor, organizationId, key, traceId, action: 'CUSTOMER_COMPLAINT_UPDATED', payload: { id, ...input }, permission: 'customer-quality:complaints:write' }, async (tx) => {
      const rows = await tx.$queryRaw<Row[]>`UPDATE customer_quality_complaints SET defect_description = COALESCE(${description}, defect_description), severity = COALESCE(${severity}, severity), severity_policy_version = COALESCE(${policy}, severity_policy_version), severity_snapshot = COALESCE(${snapshot}::jsonb, severity_snapshot), version = version + 1, updated_by_id = ${actor.id}::uuid, updated_at = CURRENT_TIMESTAMP WHERE id = ${id}::uuid AND organization_id = ${organizationId}::uuid AND version = ${input.expectedVersion} AND archived_at IS NULL RETURNING *`;
      if (!rows[0]) fail('CONCURRENCY_CONFLICT', 409); await this.audit.record({ organizationId, actorUserId: actor.id, action: 'CUSTOMER_COMPLAINT_UPDATED', resourceType: 'CustomerComplaint', resourceId: id, outcome: 'SUCCESS', traceId, metadata: { resourceVersion: rows[0].version } }, tx); return rows[0];
    }, async (tx) => { const rows = await tx.$queryRaw<Row[]>`SELECT id FROM customer_quality_complaints WHERE id = ${id}::uuid AND organization_id = ${organizationId}::uuid`; if (!rows[0]) fail('CUSTOMER_COMPLAINT_NOT_FOUND', 404); });
  }

  async detailComplaint(actor: AdminActor, id: string) {
    const organizationId = this.scope(actor); id = uuid(id); return this.prisma.$transaction(async (tx) => { await assertAdminAccess(tx, actor, organizationId, 'customer-quality:complaints:read'); const rows = await tx.$queryRaw<Row[]>`SELECT * FROM customer_quality_complaints WHERE id = ${id}::uuid AND organization_id = ${organizationId}::uuid`; if (!rows[0]) fail('CUSTOMER_COMPLAINT_NOT_FOUND', 404); const dispositions = await tx.$queryRaw<Row[]>`SELECT * FROM customer_quality_physical_dispositions WHERE complaint_id = ${id}::uuid AND organization_id = ${organizationId}::uuid ORDER BY version DESC LIMIT 1`; const analyses = await tx.$queryRaw<Row[]>`SELECT * FROM customer_quality_physical_analyses WHERE complaint_id = ${id}::uuid AND organization_id = ${organizationId}::uuid ORDER BY version DESC LIMIT 1`; return { ...rows[0], currentDisposition: dispositions[0] ?? null, currentAnalysis: analyses[0] ?? null }; });
  }

  async dispositionHistory(actor: AdminActor, complaintId: string) {
    const organizationId = this.scope(actor); complaintId = uuid(complaintId);
    return this.prisma.$transaction(async (tx) => { await assertAdminAccess(tx, actor, organizationId, 'customer-quality:complaints:read'); const complaint = await tx.$queryRaw<Row[]>`SELECT id FROM customer_quality_complaints WHERE id = ${complaintId}::uuid AND organization_id = ${organizationId}::uuid`; if (!complaint[0]) fail('CUSTOMER_COMPLAINT_NOT_FOUND', 404); return tx.$queryRaw<Row[]>`SELECT * FROM customer_quality_physical_dispositions WHERE complaint_id = ${complaintId}::uuid AND organization_id = ${organizationId}::uuid ORDER BY version`; });
  }

  async analysisHistory(actor: AdminActor, complaintId: string) {
    const organizationId = this.scope(actor); complaintId = uuid(complaintId);
    return this.prisma.$transaction(async (tx) => { await assertAdminAccess(tx, actor, organizationId, 'customer-quality:complaints:read'); const complaint = await tx.$queryRaw<Row[]>`SELECT id FROM customer_quality_complaints WHERE id = ${complaintId}::uuid AND organization_id = ${organizationId}::uuid`; if (!complaint[0]) fail('CUSTOMER_COMPLAINT_NOT_FOUND', 404); return tx.$queryRaw<Row[]>`SELECT * FROM customer_quality_physical_analyses WHERE complaint_id = ${complaintId}::uuid AND organization_id = ${organizationId}::uuid ORDER BY version`; });
  }

  async listComplaints(actor: AdminActor) {
    const organizationId = this.scope(actor);
    return this.prisma.$transaction(async (tx) => { await assertAdminAccess(tx, actor, organizationId, 'customer-quality:complaints:read'); return tx.$queryRaw<Row[]>`SELECT * FROM customer_quality_complaints WHERE organization_id = ${organizationId}::uuid AND archived_at IS NULL ORDER BY created_at DESC, id DESC`; });
  }

  async sourceReference(actor: AdminActor, complaintId: string): Promise<DomainSourceReference> {
    const organizationId = this.scope(actor); complaintId = uuid(complaintId);
    return this.prisma.$transaction(async (tx) => {
      await assertAdminAccess(tx, actor, organizationId, 'customer-quality:complaints:read');
      const record = await this.sourceRecord(tx, complaintId);
      if (!record || record.organizationId !== organizationId) fail('CUSTOMER_COMPLAINT_NOT_FOUND', 404);
      return { sourceDomain: 'customer-quality', sourceType: 'customer-complaint', sourceId: complaintId,
        sourceVersion: record.sourceVersion, sourceSnapshot: record.sourceSnapshot, createdBy: record.createdBy };
    });
  }

  async lockAndResolve(tx: AdminTransaction, source: DomainSourceReference): Promise<DomainSourceRecord | null> {
    if (source.sourceDomain !== 'customer-quality' || source.sourceType !== 'customer-complaint') return null;
    await tx.$queryRaw`SELECT id FROM customer_quality_complaints WHERE id = ${source.sourceId}::uuid FOR UPDATE`;
    return this.sourceRecord(tx, source.sourceId);
  }

  private async sourceRecord(tx: AdminTransaction, complaintId: string): Promise<DomainSourceRecord | null> {
    const records = await tx.$queryRaw<Row[]>`SELECT complaint.*, customer.name AS customer_name FROM customer_quality_complaints complaint JOIN customer_quality_customers customer ON customer.id = complaint.customer_id AND customer.organization_id = complaint.organization_id WHERE complaint.id = ${complaintId}::uuid`;
    const record = records[0]; if (!record) return null;
    const analyses = await tx.$queryRaw<Row[]>`SELECT status, summary, evidence_summary FROM customer_quality_physical_analyses WHERE complaint_id = ${complaintId}::uuid AND organization_id = ${record.organization_id}::uuid ORDER BY version DESC LIMIT 1`;
    const dispositions = await tx.$queryRaw<Row[]>`SELECT action, status, responsibility FROM customer_quality_physical_dispositions WHERE complaint_id = ${complaintId}::uuid AND organization_id = ${record.organization_id}::uuid ORDER BY version DESC LIMIT 1`;
    const analysis = analyses[0]; const disposition = dispositions[0];
    if (record.physical_analysis_required && (!analysis || !['MISSING', 'COMPLETED'].includes(String(analysis.status)))) fail('CUSTOMER_PHYSICAL_ANALYSIS_INCOMPLETE', 409);
    return { organizationId: record.organization_id, createdBy: record.created_by_id, sourceVersion: record.version,
      archivedAt: record.archived_at, sourceSnapshot: {
        id: record.id, complaintNumber: record.complaint_number, customerId: record.customer_id, customerName: record.customer_name,
        complaintType: record.complaint_type, terminalCustomerName: record.terminal_customer_name,
        productCode: record.product_code, productModel: record.product_model, defectDescription: record.defect_description,
        vin: record.vin, mileage: record.mileage, purchaseDate: record.purchase_date?.toISOString().slice(0, 10) ?? null,
        returnRequired: record.return_required, physicalAnalysisRequired: record.physical_analysis_required,
        severity: record.severity, severityPolicyVersion: record.severity_policy_version, severitySnapshot: record.severity_snapshot,
        analysisStatus: analysis?.status ?? null, analysisSummary: analysis?.summary ?? null, analysisEvidenceSummary: analysis?.evidence_summary ?? null,
        dispositionAction: disposition?.action ?? null, dispositionStatus: disposition?.status ?? null, dispositionResponsibility: disposition?.responsibility ?? null,
      } as Prisma.InputJsonObject };
  }

  async archiveComplaint(actor: AdminActor, id: string, expectedVersion: number, traceId: string, key?: string) {
    const organizationId = this.scope(actor); id = uuid(id); if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1) fail('CUSTOMER_QUALITY_INPUT_INVALID', 400);
    return this.mutations.run({ actor, organizationId, key, traceId, action: 'CUSTOMER_COMPLAINT_ARCHIVED', payload: { id, expectedVersion }, permission: 'customer-quality:complaints:write' }, async (tx) => {
      const eightD = await tx.$queryRaw<{ eight_d_status: string }[]>`SELECT c.eight_d_status FROM customer_quality_complaints c JOIN domain_source_issue_links l ON l.organization_id = c.organization_id AND l.source_domain = 'customer-quality' AND l.source_type = 'customer-complaint' AND l.source_id = c.id AND l.removed_at IS NULL JOIN problem_indexes p ON p.organization_id = l.organization_id AND p.id = l.problem_index_id JOIN workflow_instances wi ON wi.organization_id = p.organization_id AND wi.id = p.workflow_instance_id JOIN workflow_definitions wd ON wd.organization_id = wi.organization_id AND wd.id = wi.workflow_definition_id WHERE c.organization_id = ${organizationId}::uuid AND c.id = ${id}::uuid AND wd.code = 'CUSTOMER_8D'`;
      if (eightD.some((entry) => entry.eight_d_status !== 'APPROVED')) throw new HttpException({ code: 'CUSTOMER_8D_APPROVAL_REQUIRED', message: 'CUSTOMER_8D_APPROVAL_REQUIRED' }, 409);
      const rows = await tx.$queryRaw<Row[]>`UPDATE customer_quality_complaints SET status = 'ARCHIVED', archived_at = CURRENT_TIMESTAMP, version = version + 1, updated_by_id = ${actor.id}::uuid, updated_at = CURRENT_TIMESTAMP WHERE id = ${id}::uuid AND organization_id = ${organizationId}::uuid AND version = ${expectedVersion} AND status = 'CLOSED' RETURNING *`;
      if (!rows[0]) fail('CONCURRENCY_CONFLICT', 409);
      await tx.$executeRaw`INSERT INTO customer_quality_complaint_events (id, organization_id, complaint_id, seq, event_type, from_status, to_status, note, category, responsible_department_id, owner_user_id, actor_user_id) VALUES (${randomUUID()}::uuid, ${organizationId}::uuid, ${id}::uuid, (SELECT COALESCE(MAX(seq), 0) + 1 FROM customer_quality_complaint_events WHERE organization_id = ${organizationId}::uuid AND complaint_id = ${id}::uuid), 'ARCHIVED', 'CLOSED', 'ARCHIVED', '复核关闭后归档', ${rows[0].category}, ${rows[0].responsible_department_id}::uuid, ${rows[0].owner_user_id}::uuid, ${actor.id}::uuid)`;
      await this.audit.record({ organizationId, actorUserId: actor.id, action: 'CUSTOMER_COMPLAINT_ARCHIVED', resourceType: 'CustomerComplaint', resourceId: id, outcome: 'SUCCESS', traceId, metadata: { resourceVersion: rows[0].version } }, tx);
      return rows[0];
    }, async (tx) => { const rows = await tx.$queryRaw<Row[]>`SELECT id FROM customer_quality_complaints WHERE id = ${id}::uuid AND organization_id = ${organizationId}::uuid`; if (!rows[0]) fail('CUSTOMER_COMPLAINT_NOT_FOUND', 404); });
  }

  async recordPhysicalDisposition(actor: AdminActor, complaintId: string, input: { action: string; status: string; responsibility?: string | null; notes?: string | null }, traceId: string, key?: string) {
    const organizationId = this.scope(actor); complaintId = uuid(complaintId); const action = text(input.action, 32).toUpperCase(); const status = text(input.status, 32).toUpperCase(); if (!['RETURN', 'REPAIR', 'SCRAP', 'NO_RETURN', 'OTHER'].includes(action) || !['PENDING', 'RECEIVED', 'REPAIRED', 'SCRAPPED', 'CLOSED'].includes(status)) fail('CUSTOMER_QUALITY_INPUT_INVALID', 400); const responsibility = optional(input.responsibility, 200); const notes = optional(input.notes, 10000);
    return this.mutations.run({ actor, organizationId, key, traceId, action: 'CUSTOMER_PHYSICAL_DISPOSITION_RECORDED', payload: { complaintId, action, status, responsibility, notes }, permission: 'customer-quality:complaints:write' }, async (tx) => {
      const complaint = await tx.$queryRaw<Row[]>`SELECT id, return_required FROM customer_quality_complaints WHERE id = ${complaintId}::uuid AND organization_id = ${organizationId}::uuid AND archived_at IS NULL FOR UPDATE`; if (!complaint[0]) fail('CUSTOMER_COMPLAINT_NOT_FOUND', 404);
      const previous = await tx.$queryRaw<Row[]>`SELECT status, action, version FROM customer_quality_physical_dispositions WHERE complaint_id = ${complaintId}::uuid AND organization_id = ${organizationId}::uuid ORDER BY version DESC LIMIT 1`;
      if ((status === 'REPAIRED' && action !== 'REPAIR') || (status === 'SCRAPPED' && action !== 'SCRAP') || (action === 'NO_RETURN' && !['PENDING', 'CLOSED'].includes(status))) fail('CUSTOMER_PHYSICAL_DISPOSITION_ACTION_STATUS_INVALID', 400);
      if (previous[0]?.status === 'CLOSED' || (previous[0] && !({ PENDING: ['RECEIVED', 'CLOSED'], RECEIVED: ['REPAIRED', 'SCRAPPED', 'CLOSED'], REPAIRED: ['CLOSED'], SCRAPPED: ['CLOSED'] } as Record<string, string[]>)[previous[0].status]?.includes(status))) fail('CUSTOMER_PHYSICAL_DISPOSITION_TRANSITION_INVALID', 409);
      if (previous[0] && previous[0].action !== action && !(previous[0].action === 'RETURN' && ['REPAIR', 'SCRAP'].includes(action))) fail('CUSTOMER_PHYSICAL_DISPOSITION_ACTION_TRANSITION_INVALID', 409);
      if (!complaint[0].return_required && action !== 'NO_RETURN') fail('CUSTOMER_PHYSICAL_DISPOSITION_RETURN_NOT_REQUIRED', 409);
      if (complaint[0].return_required && action === 'NO_RETURN') fail('CUSTOMER_PHYSICAL_DISPOSITION_RETURN_REQUIRED', 409);
      const rows = await tx.$queryRaw<Row[]>`INSERT INTO customer_quality_physical_dispositions (id, organization_id, complaint_id, action, status, responsibility, notes, version, created_by_id, updated_at) VALUES (${randomUUID()}::uuid, ${organizationId}::uuid, ${complaintId}::uuid, ${action}, ${status}, ${responsibility}, ${notes}, ${previous[0] ? previous[0].version + 1 : 1}, ${actor.id}::uuid, CURRENT_TIMESTAMP) RETURNING *`;
      await tx.$executeRaw`UPDATE customer_quality_complaints SET version = version + 1, updated_by_id = ${actor.id}::uuid, updated_at = CURRENT_TIMESTAMP WHERE id = ${complaintId}::uuid AND organization_id = ${organizationId}::uuid`;
      await this.audit.record({ organizationId, actorUserId: actor.id, action: 'CUSTOMER_PHYSICAL_DISPOSITION_RECORDED', resourceType: 'CustomerPhysicalDisposition', resourceId: rows[0].id, outcome: 'SUCCESS', traceId }, tx); return rows[0];
    });
  }

  async recordPhysicalAnalysis(actor: AdminActor, complaintId: string, input: { summary: string; status: string; evidenceSummary?: string | null }, traceId: string, key?: string) {
    const organizationId = this.scope(actor); complaintId = uuid(complaintId); const summary = text(input.summary, 10000); const status = text(input.status, 32).toUpperCase(); if (!['MISSING', 'IN_PROGRESS', 'COMPLETED'].includes(status)) fail('CUSTOMER_QUALITY_INPUT_INVALID', 400); const evidenceSummary = optional(input.evidenceSummary, 10000);
    return this.mutations.run({ actor, organizationId, key, traceId, action: 'CUSTOMER_PHYSICAL_ANALYSIS_RECORDED', payload: { complaintId, summary, status, evidenceSummary }, permission: 'customer-quality:complaints:write' }, async (tx) => {
      const complaint = await tx.$queryRaw<Row[]>`SELECT id, physical_analysis_required FROM customer_quality_complaints WHERE id = ${complaintId}::uuid AND organization_id = ${organizationId}::uuid AND archived_at IS NULL FOR UPDATE`; if (!complaint[0]) fail('CUSTOMER_COMPLAINT_NOT_FOUND', 404);
      if (!complaint[0].physical_analysis_required) fail('CUSTOMER_PHYSICAL_ANALYSIS_NOT_REQUIRED', 409);
      const previous = await tx.$queryRaw<Row[]>`SELECT status, version FROM customer_quality_physical_analyses WHERE complaint_id = ${complaintId}::uuid AND organization_id = ${organizationId}::uuid ORDER BY version DESC LIMIT 1`;
      if (previous[0]?.status === 'COMPLETED' || (previous[0] && !({ MISSING: ['IN_PROGRESS', 'COMPLETED'], IN_PROGRESS: ['MISSING', 'COMPLETED'] } as Record<string, string[]>)[previous[0].status]?.includes(status))) fail('CUSTOMER_PHYSICAL_ANALYSIS_TRANSITION_INVALID', 409);
      const rows = await tx.$queryRaw<Row[]>`INSERT INTO customer_quality_physical_analyses (id, organization_id, complaint_id, summary, status, evidence_summary, version, created_by_id, updated_at) VALUES (${randomUUID()}::uuid, ${organizationId}::uuid, ${complaintId}::uuid, ${summary}, ${status}, ${evidenceSummary}, ${previous[0] ? previous[0].version + 1 : 1}, ${actor.id}::uuid, CURRENT_TIMESTAMP) RETURNING *`;
      await tx.$executeRaw`UPDATE customer_quality_complaints SET version = version + 1, updated_by_id = ${actor.id}::uuid, updated_at = CURRENT_TIMESTAMP WHERE id = ${complaintId}::uuid AND organization_id = ${organizationId}::uuid`;
      await this.audit.record({ organizationId, actorUserId: actor.id, action: 'CUSTOMER_PHYSICAL_ANALYSIS_RECORDED', resourceType: 'CustomerPhysicalAnalysis', resourceId: rows[0].id, outcome: 'SUCCESS', traceId }, tx); return rows[0];
    });
  }

  private normalize(input: CustomerComplaintInput) {
    if (!['ZERO_KM', 'AFTER_SALES'].includes(input.complaintType)) fail('CUSTOMER_QUALITY_INPUT_INVALID', 400);
    const purchaseDate = input.purchaseDate ?? null; const sourceObservedAt = input.sourceObservedAt ?? null;
    if (purchaseDate && (!(purchaseDate instanceof Date) || Number.isNaN(purchaseDate.getTime()))) fail('CUSTOMER_QUALITY_INPUT_INVALID', 400);
    if (sourceObservedAt && (!(sourceObservedAt instanceof Date) || Number.isNaN(sourceObservedAt.getTime()))) fail('CUSTOMER_QUALITY_INPUT_INVALID', 400);
    const vin = optional(input.vin, 100); const mileage = input.mileage ?? null;
    if (input.complaintType === 'AFTER_SALES' && (!vin || mileage === null || !purchaseDate || !Number.isSafeInteger(mileage) || mileage < 0)) fail('CUSTOMER_QUALITY_AFTER_SALES_FACTS_REQUIRED', 400);
    if (mileage !== null && (!Number.isSafeInteger(mileage) || mileage < 0)) fail('CUSTOMER_QUALITY_INPUT_INVALID', 400);
    const externalSourceSystem = input.externalSourceSystem ?? null; const externalRecordKey = optional(input.externalRecordKey, 200);
    if ([externalSourceSystem, externalRecordKey, sourceObservedAt].some((value) => value != null) && (!externalSourceSystem || !['ERP', 'SAP', 'IMS'].includes(externalSourceSystem) || !externalRecordKey || !sourceObservedAt)) fail('CUSTOMER_QUALITY_EXTERNAL_IDENTITY_INVALID', 400);
    if ((input.returnRequired !== undefined && typeof input.returnRequired !== 'boolean') || (input.physicalAnalysisRequired !== undefined && typeof input.physicalAnalysisRequired !== 'boolean')) fail('CUSTOMER_QUALITY_INPUT_INVALID', 400);
    const severity = text(input.severity, 32); const severityPolicyVersion = text(input.severityPolicyVersion, 100);
    return { customerId: text(input.customerId, 64), complaintType: input.complaintType, terminalCustomerName: optional(input.terminalCustomerName, 200), productCode: optional(input.productCode, 100), productModel: optional(input.productModel, 100), defectDescription: text(input.defectDescription, 10000), vin, mileage, purchaseDate, returnRequired: input.returnRequired ?? false, physicalAnalysisRequired: input.physicalAnalysisRequired ?? false, severity, severityPolicyVersion, severitySnapshot: severitySnapshot(input.severitySnapshot, severity, severityPolicyVersion), externalSourceSystem, externalRecordKey, sourceObservedAt };
  }
}
