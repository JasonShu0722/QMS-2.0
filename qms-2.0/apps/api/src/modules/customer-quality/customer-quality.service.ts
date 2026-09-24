import { HttpException, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../database/prisma.service.js';
import { AdminMutationService, assertAdminAccess, type AdminActor, type AdminTransaction } from '../../common/security/admin-mutation.service.js';
import { AuditLogService } from '../audit-log/audit-log.service.js';

export type CustomerComplaintType = 'ZERO_KM' | 'AFTER_SALES';
export type CustomerExternalSourceSystem = 'ERP' | 'SAP' | 'IMS';
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

type Row = Record<string, any>;
function fail(code: string, status: number): never { throw new HttpException({ code, message: code }, status); }
function text(value: string | null | undefined, max: number, code = 'CUSTOMER_QUALITY_INPUT_INVALID'): string {
  const result = value?.trim(); if (!result || result.length > max) fail(code, 400); return result;
}
function optional(value: string | null | undefined, max: number): string | null { return value == null || !value.trim() ? null : text(value, max); }
function uuid(value: string, code = 'CUSTOMER_QUALITY_INPUT_INVALID'): string { if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) fail(code, 400); return value; }
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
      const id = randomUUID();
      const rows = await tx.$queryRaw<Row[]>`INSERT INTO customer_quality_customers (id, organization_id, code, name, active, version, created_by_id, updated_by_id, updated_at) VALUES (${id}::uuid, ${organizationId}::uuid, ${code}, ${name}, true, 1, ${actor.id}::uuid, ${actor.id}::uuid, CURRENT_TIMESTAMP) RETURNING *`;
      const record = rows[0]!;
      await this.audit.record({ organizationId, actorUserId: actor.id, action: 'CUSTOMER_MASTER_CREATED', resourceType: 'CustomerMaster', resourceId: id, outcome: 'SUCCESS', traceId, metadata: { resourceVersion: 1 } }, tx);
      return record;
    }).catch(mapUnique);
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

  async updateComplaint(actor: AdminActor, id: string, input: { expectedVersion: number; defectDescription?: string; severity?: string; severityPolicyVersion?: string; severitySnapshot?: Prisma.InputJsonValue }, traceId: string, key?: string) {
    const organizationId = this.scope(actor); id = uuid(id); if (!Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 1) fail('CUSTOMER_QUALITY_INPUT_INVALID', 400);
    const severityFields = [input.severity, input.severityPolicyVersion, input.severitySnapshot];
    if (severityFields.some((value) => value !== undefined) && severityFields.some((value) => value === undefined)) fail('CUSTOMER_QUALITY_SEVERITY_SNAPSHOT_REQUIRED', 400);
    const description = input.defectDescription === undefined ? null : text(input.defectDescription, 10000); const severity = input.severity === undefined ? null : text(input.severity, 32); const policy = input.severityPolicyVersion === undefined ? null : text(input.severityPolicyVersion, 100); const snapshot = input.severitySnapshot === undefined ? null : JSON.stringify(input.severitySnapshot);
    return this.mutations.run({ actor, organizationId, key, traceId, action: 'CUSTOMER_COMPLAINT_UPDATED', payload: { id, ...input }, permission: 'customer-quality:complaints:write' }, async (tx) => {
      const rows = await tx.$queryRaw<Row[]>`UPDATE customer_quality_complaints SET defect_description = COALESCE(${description}, defect_description), severity = COALESCE(${severity}, severity), severity_policy_version = COALESCE(${policy}, severity_policy_version), severity_snapshot = COALESCE(${snapshot}::jsonb, severity_snapshot), version = version + 1, updated_by_id = ${actor.id}::uuid, updated_at = CURRENT_TIMESTAMP WHERE id = ${id}::uuid AND organization_id = ${organizationId}::uuid AND version = ${input.expectedVersion} AND archived_at IS NULL RETURNING *`;
      if (!rows[0]) fail('CONCURRENCY_CONFLICT', 409); await this.audit.record({ organizationId, actorUserId: actor.id, action: 'CUSTOMER_COMPLAINT_UPDATED', resourceType: 'CustomerComplaint', resourceId: id, outcome: 'SUCCESS', traceId, metadata: { resourceVersion: rows[0].version } }, tx); return rows[0];
    }, async (tx) => { const rows = await tx.$queryRaw<Row[]>`SELECT id FROM customer_quality_complaints WHERE id = ${id}::uuid AND organization_id = ${organizationId}::uuid`; if (!rows[0]) fail('CUSTOMER_COMPLAINT_NOT_FOUND', 404); });
  }

  async detailComplaint(actor: AdminActor, id: string) {
    const organizationId = this.scope(actor); id = uuid(id); return this.prisma.$transaction(async (tx) => { await assertAdminAccess(tx, actor, organizationId, 'customer-quality:complaints:read'); const rows = await tx.$queryRaw<Row[]>`SELECT * FROM customer_quality_complaints WHERE id = ${id}::uuid AND organization_id = ${organizationId}::uuid`; if (!rows[0]) fail('CUSTOMER_COMPLAINT_NOT_FOUND', 404); return rows[0]; });
  }

  async listComplaints(actor: AdminActor) {
    const organizationId = this.scope(actor);
    return this.prisma.$transaction(async (tx) => { await assertAdminAccess(tx, actor, organizationId, 'customer-quality:complaints:read'); return tx.$queryRaw<Row[]>`SELECT * FROM customer_quality_complaints WHERE organization_id = ${organizationId}::uuid AND archived_at IS NULL ORDER BY created_at DESC, id DESC`; });
  }

  async archiveComplaint(actor: AdminActor, id: string, expectedVersion: number, traceId: string, key?: string) {
    const organizationId = this.scope(actor); id = uuid(id); if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1) fail('CUSTOMER_QUALITY_INPUT_INVALID', 400);
    return this.mutations.run({ actor, organizationId, key, traceId, action: 'CUSTOMER_COMPLAINT_ARCHIVED', payload: { id, expectedVersion }, permission: 'customer-quality:complaints:write' }, async (tx) => {
      const rows = await tx.$queryRaw<Row[]>`UPDATE customer_quality_complaints SET status = 'ARCHIVED', archived_at = CURRENT_TIMESTAMP, version = version + 1, updated_by_id = ${actor.id}::uuid, updated_at = CURRENT_TIMESTAMP WHERE id = ${id}::uuid AND organization_id = ${organizationId}::uuid AND version = ${expectedVersion} AND archived_at IS NULL RETURNING *`;
      if (!rows[0]) fail('CONCURRENCY_CONFLICT', 409);
      await this.audit.record({ organizationId, actorUserId: actor.id, action: 'CUSTOMER_COMPLAINT_ARCHIVED', resourceType: 'CustomerComplaint', resourceId: id, outcome: 'SUCCESS', traceId, metadata: { resourceVersion: rows[0].version } }, tx);
      return rows[0];
    }, async (tx) => { const rows = await tx.$queryRaw<Row[]>`SELECT id FROM customer_quality_complaints WHERE id = ${id}::uuid AND organization_id = ${organizationId}::uuid`; if (!rows[0]) fail('CUSTOMER_COMPLAINT_NOT_FOUND', 404); });
  }

  async recordPhysicalDisposition(actor: AdminActor, complaintId: string, input: { action: string; status: string; responsibility?: string | null; notes?: string | null }, traceId: string, key?: string) {
    const organizationId = this.scope(actor); complaintId = uuid(complaintId); const action = text(input.action, 32).toUpperCase(); const status = text(input.status, 32).toUpperCase(); if (!['RETURN', 'REPAIR', 'SCRAP', 'NO_RETURN', 'OTHER'].includes(action) || !['PENDING', 'RECEIVED', 'REPAIRED', 'SCRAPPED', 'CLOSED'].includes(status)) fail('CUSTOMER_QUALITY_INPUT_INVALID', 400); const responsibility = optional(input.responsibility, 200); const notes = optional(input.notes, 10000);
    return this.mutations.run({ actor, organizationId, key, traceId, action: 'CUSTOMER_PHYSICAL_DISPOSITION_RECORDED', payload: { complaintId, action, status, responsibility, notes }, permission: 'customer-quality:complaints:write' }, async (tx) => {
      const complaint = await tx.$queryRaw<Row[]>`SELECT id FROM customer_quality_complaints WHERE id = ${complaintId}::uuid AND organization_id = ${organizationId}::uuid AND archived_at IS NULL FOR UPDATE`; if (!complaint[0]) fail('CUSTOMER_COMPLAINT_NOT_FOUND', 404);
      const rows = await tx.$queryRaw<Row[]>`INSERT INTO customer_quality_physical_dispositions (id, organization_id, complaint_id, action, status, responsibility, notes, created_by_id, updated_at) VALUES (${randomUUID()}::uuid, ${organizationId}::uuid, ${complaintId}::uuid, ${action}, ${status}, ${responsibility}, ${notes}, ${actor.id}::uuid, CURRENT_TIMESTAMP) RETURNING *`;
      await this.audit.record({ organizationId, actorUserId: actor.id, action: 'CUSTOMER_PHYSICAL_DISPOSITION_RECORDED', resourceType: 'CustomerPhysicalDisposition', resourceId: rows[0].id, outcome: 'SUCCESS', traceId }, tx); return rows[0];
    });
  }

  async recordPhysicalAnalysis(actor: AdminActor, complaintId: string, input: { summary: string; status: string; evidenceSummary?: string | null }, traceId: string, key?: string) {
    const organizationId = this.scope(actor); complaintId = uuid(complaintId); const summary = text(input.summary, 10000); const status = text(input.status, 32).toUpperCase(); if (!['MISSING', 'IN_PROGRESS', 'COMPLETED'].includes(status)) fail('CUSTOMER_QUALITY_INPUT_INVALID', 400); const evidenceSummary = optional(input.evidenceSummary, 10000);
    return this.mutations.run({ actor, organizationId, key, traceId, action: 'CUSTOMER_PHYSICAL_ANALYSIS_RECORDED', payload: { complaintId, summary, status, evidenceSummary }, permission: 'customer-quality:complaints:write' }, async (tx) => {
      const complaint = await tx.$queryRaw<Row[]>`SELECT id FROM customer_quality_complaints WHERE id = ${complaintId}::uuid AND organization_id = ${organizationId}::uuid AND archived_at IS NULL FOR UPDATE`; if (!complaint[0]) fail('CUSTOMER_COMPLAINT_NOT_FOUND', 404);
      const rows = await tx.$queryRaw<Row[]>`INSERT INTO customer_quality_physical_analyses (id, organization_id, complaint_id, summary, status, evidence_summary, created_by_id, updated_at) VALUES (${randomUUID()}::uuid, ${organizationId}::uuid, ${complaintId}::uuid, ${summary}, ${status}, ${evidenceSummary}, ${actor.id}::uuid, CURRENT_TIMESTAMP) RETURNING *`;
      await this.audit.record({ organizationId, actorUserId: actor.id, action: 'CUSTOMER_PHYSICAL_ANALYSIS_RECORDED', resourceType: 'CustomerPhysicalAnalysis', resourceId: rows[0].id, outcome: 'SUCCESS', traceId }, tx); return rows[0];
    });
  }

  private normalize(input: CustomerComplaintInput) {
    if (!['ZERO_KM', 'AFTER_SALES'].includes(input.complaintType)) fail('CUSTOMER_QUALITY_INPUT_INVALID', 400);
    if (!(input.severitySnapshot && typeof input.severitySnapshot === 'object')) fail('CUSTOMER_QUALITY_INPUT_INVALID', 400);
    const purchaseDate = input.purchaseDate ?? null; const sourceObservedAt = input.sourceObservedAt ?? null;
    if (purchaseDate && (!(purchaseDate instanceof Date) || Number.isNaN(purchaseDate.getTime()))) fail('CUSTOMER_QUALITY_INPUT_INVALID', 400);
    if (sourceObservedAt && (!(sourceObservedAt instanceof Date) || Number.isNaN(sourceObservedAt.getTime()))) fail('CUSTOMER_QUALITY_INPUT_INVALID', 400);
    const vin = optional(input.vin, 100); const mileage = input.mileage ?? null;
    if (input.complaintType === 'AFTER_SALES' && (!vin || mileage === null || !purchaseDate || !Number.isSafeInteger(mileage) || mileage < 0)) fail('CUSTOMER_QUALITY_AFTER_SALES_FACTS_REQUIRED', 400);
    if (mileage !== null && (!Number.isSafeInteger(mileage) || mileage < 0)) fail('CUSTOMER_QUALITY_INPUT_INVALID', 400);
    const externalSourceSystem = input.externalSourceSystem ?? null; const externalRecordKey = optional(input.externalRecordKey, 200);
    if ([externalSourceSystem, externalRecordKey, sourceObservedAt].some((value) => value != null) && (!externalSourceSystem || !['ERP', 'SAP', 'IMS'].includes(externalSourceSystem) || !externalRecordKey || !sourceObservedAt)) fail('CUSTOMER_QUALITY_EXTERNAL_IDENTITY_INVALID', 400);
    if ((input.returnRequired !== undefined && typeof input.returnRequired !== 'boolean') || (input.physicalAnalysisRequired !== undefined && typeof input.physicalAnalysisRequired !== 'boolean')) fail('CUSTOMER_QUALITY_INPUT_INVALID', 400);
    return { customerId: text(input.customerId, 64), complaintType: input.complaintType, terminalCustomerName: optional(input.terminalCustomerName, 200), productCode: optional(input.productCode, 100), productModel: optional(input.productModel, 100), defectDescription: text(input.defectDescription, 10000), vin, mileage, purchaseDate, returnRequired: input.returnRequired ?? false, physicalAnalysisRequired: input.physicalAnalysisRequired ?? false, severity: text(input.severity, 32), severityPolicyVersion: text(input.severityPolicyVersion, 100), severitySnapshot: input.severitySnapshot, externalSourceSystem, externalRecordKey, sourceObservedAt };
  }
}
