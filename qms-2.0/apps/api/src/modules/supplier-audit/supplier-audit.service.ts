import { HttpException, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../database/prisma.service.js';
import { AdminMutationService, adminError, assertAdminAccess, type AdminActor, type AdminTransaction } from '../../common/security/admin-mutation.service.js';
import { AuditLogService } from '../audit-log/audit-log.service.js';
import { FileLifecycleService } from '../file-management/file-lifecycle.service.js';
import { SupplierQualityService } from '../supplier-quality/supplier-quality.service.js';
import type { CloseSupplierAuditRecordDto, CreateSupplierAuditPlanDto, CreateSupplierAuditRecordDto, SupplierAuditQueryDto, SupplierAuditTransitionDto, UpdateSupplierAuditChecklistDto } from './supplier-audit.dto.js';

type Row = Record<string, unknown>;
const PLAN_READ = 'supplier-audit:plans:read';
const PLAN_WRITE = 'supplier-audit:plans:write';
const RECORD_READ = 'supplier-audit:records:read';
const RECORD_WRITE = 'supplier-audit:records:write';
const RECORD_CLOSE = 'supplier-audit:records:close';

function fail(code: string, status: number): never { throw new HttpException({ code, message: code }, status); }
function uuid(value: string): string { if (!/^[0-9a-f-]{36}$/i.test(value)) fail('SUPPLIER_AUDIT_INPUT_INVALID', 400); return value; }
function text(value: string, max: number): string { const result = value?.trim(); if (!result || result.length > max) fail('SUPPLIER_AUDIT_INPUT_INVALID', 400); return result; }
function instant(value: string): Date { const result = new Date(value); if (Number.isNaN(result.getTime())) fail('SUPPLIER_AUDIT_INPUT_INVALID', 400); return result; }

function serializePlan(row: Row) {
  return {
    id: String(row.id), ownerOrganizationId: String(row.owner_organization_id), supplierOrganizationId: String(row.supplier_organization_id),
    profileId: String(row.profile_id), auditYear: Number(row.audit_year), auditType: String(row.audit_type), title: String(row.title),
    plannedStart: new Date(String(row.planned_start)).toISOString(), plannedEnd: new Date(String(row.planned_end)).toISOString(),
    status: String(row.status), version: Number(row.version), createdAt: new Date(String(row.created_at)).toISOString(),
    updatedAt: new Date(String(row.updated_at)).toISOString(),
  };
}

function serializeRecord(row: Row) {
  return {
    id: String(row.id), ownerOrganizationId: String(row.owner_organization_id), supplierOrganizationId: String(row.supplier_organization_id),
    profileId: String(row.profile_id), planId: String(row.plan_id), auditDate: String(row.audit_date).slice(0, 10),
    auditor: String(row.auditor), summary: String(row.summary), findings: (row.findings ?? {}) as Record<string, unknown>,
    conclusion: row.conclusion ? String(row.conclusion) : null, closeNote: row.close_note ? String(row.close_note) : null,
    status: String(row.status), version: Number(row.version), createdAt: new Date(String(row.created_at)).toISOString(),
    updatedAt: new Date(String(row.updated_at)).toISOString(),
  };
}

@Injectable()
export class SupplierAuditService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mutations: AdminMutationService,
    private readonly audit: AuditLogService,
    private readonly files: FileLifecycleService,
    private readonly suppliers: SupplierQualityService,
  ) {}

  private scope(actor: AdminActor, requested?: string) {
    if (actor.accountType !== 'INTERNAL') adminError('ORGANIZATION_SCOPE_DENIED', 403);
    return requested ?? actor.scopeOrganizationId ?? actor.organizationId;
  }

  private async recordEvent(tx: AdminTransaction, actor: AdminActor, organizationId: string, record: Row, eventType: 'CREATED' | 'CHECKLIST_UPDATED' | 'SUBMITTED' | 'CLOSED', traceId: string, note?: string) {
    await tx.$executeRaw(Prisma.sql`INSERT INTO supplier_audit_record_events
      (id, owner_organization_id, record_id, event_type, record_version, actor_user_id, note)
      VALUES (${randomUUID()}::uuid, ${organizationId}::uuid, ${String(record.id)}::uuid,
        ${eventType}, ${Number(record.version)}, ${actor.id}::uuid, ${note ?? null})`);
    await this.audit.record({
      organizationId, actorUserId: actor.id, action: 'SUPPLIER_AUDIT_RECORD_' + eventType,
      resourceType: 'SupplierAuditRecord', resourceId: String(record.id), outcome: 'SUCCESS', traceId,
      metadata: { version: Number(record.version), planId: String(record.plan_id) },
    }, tx);
  }

  async listPlans(actor: AdminActor, query: SupplierAuditQueryDto) {
    const organizationId = this.scope(actor, query.organizationId);
    return this.prisma.$transaction(async (tx) => {
      await assertAdminAccess(tx, actor, organizationId, PLAN_READ);
      const filters = [Prisma.sql`owner_organization_id = ${organizationId}::uuid`];
      if (query.profileId) filters.push(Prisma.sql`profile_id = ${uuid(query.profileId)}::uuid`);
      if (query.year) filters.push(Prisma.sql`audit_year = ${query.year}`);
      if (query.status) filters.push(Prisma.sql`status = ${query.status}`);
      const where = Prisma.join(filters, ' AND ');
      const [rows, counts] = await Promise.all([
        tx.$queryRaw<Row[]>(Prisma.sql`SELECT * FROM supplier_audit_plans WHERE ${where} ORDER BY audit_year DESC, planned_start DESC, id DESC LIMIT ${query.pageSize} OFFSET ${(query.page - 1) * query.pageSize}`),
        tx.$queryRaw<{ count: bigint }[]>(Prisma.sql`SELECT count(*)::bigint AS count FROM supplier_audit_plans WHERE ${where}`),
      ]);
      return { items: rows.map(serializePlan), total: Number(counts[0]?.count ?? 0), page: query.page, pageSize: query.pageSize };
    });
  }

  async listRecords(actor: AdminActor, query: SupplierAuditQueryDto) {
    const organizationId = this.scope(actor, query.organizationId);
    return this.prisma.$transaction(async (tx) => {
      await assertAdminAccess(tx, actor, organizationId, RECORD_READ);
      const filters = [Prisma.sql`r.owner_organization_id = ${organizationId}::uuid`];
      if (query.profileId) filters.push(Prisma.sql`r.profile_id = ${uuid(query.profileId)}::uuid`);
      if (query.year) filters.push(Prisma.sql`EXTRACT(YEAR FROM r.audit_date) = ${query.year}`);
      if (query.status) filters.push(Prisma.sql`r.status = ${query.status}`);
      const where = Prisma.join(filters, ' AND ');
      const [rows, counts] = await Promise.all([
        tx.$queryRaw<Row[]>(Prisma.sql`SELECT r.* FROM supplier_audit_records r WHERE ${where} ORDER BY r.audit_date DESC, r.id DESC LIMIT ${query.pageSize} OFFSET ${(query.page - 1) * query.pageSize}`),
        tx.$queryRaw<{ count: bigint }[]>(Prisma.sql`SELECT count(*)::bigint AS count FROM supplier_audit_records r WHERE ${where}`),
      ]);
      return { items: rows.map(serializeRecord), total: Number(counts[0]?.count ?? 0), page: query.page, pageSize: query.pageSize };
    });
  }

  createPlan(actor: AdminActor, input: CreateSupplierAuditPlanDto, traceId: string, key?: string) {
    const organizationId = this.scope(actor);
    const title = text(input.title, 300); const start = instant(input.plannedStart); const end = instant(input.plannedEnd);
    if (end < start) fail('SUPPLIER_AUDIT_INPUT_INVALID', 400);
    return this.mutations.run({ actor, organizationId, key, traceId, action: 'SUPPLIER_AUDIT_PLAN_CREATED', payload: input, permission: PLAN_WRITE, duplicateCode: 'CONCURRENCY_CONFLICT' }, async (tx) => {
      const profile = await this.suppliers.performanceProfile(tx, organizationId, input.profileId);
      const rows = await tx.$queryRaw<Row[]>(Prisma.sql`INSERT INTO supplier_audit_plans
        (id, owner_organization_id, supplier_organization_id, profile_id, audit_year, audit_type, title, planned_start, planned_end, created_by_id, updated_at)
        VALUES (${randomUUID()}::uuid, ${organizationId}::uuid, ${profile.supplierOrganizationId}::uuid, ${profile.id}::uuid, ${input.auditYear}, ${input.auditType}, ${title}, ${start}, ${end}, ${actor.id}::uuid, CURRENT_TIMESTAMP)
        RETURNING *`);
      const row = rows[0]!;
      await this.audit.record({ organizationId, actorUserId: actor.id, action: 'SUPPLIER_AUDIT_PLAN_CREATED', resourceType: 'SupplierAuditPlan', resourceId: String(row.id), outcome: 'SUCCESS', traceId, metadata: { profileId: profile.id, supplierOrganizationId: profile.supplierOrganizationId, auditYear: input.auditYear } }, tx);
      return serializePlan(row);
    });
  }

  submitPlan(actor: AdminActor, id: string, input: SupplierAuditTransitionDto, traceId: string, key?: string) {
    const organizationId = this.scope(actor);
    return this.mutations.run({ actor, organizationId, key, traceId, action: 'SUPPLIER_AUDIT_PLAN_SUBMITTED', payload: { id, ...input }, permission: PLAN_WRITE }, async (tx) => {
      const rows = await tx.$queryRaw<Row[]>(Prisma.sql`UPDATE supplier_audit_plans
        SET status = 'SUBMITTED', version = version + 1, submitted_by_id = ${actor.id}::uuid,
            submitted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
        WHERE id = ${uuid(id)}::uuid AND owner_organization_id = ${organizationId}::uuid
          AND status = 'PLANNED' AND version = ${input.expectedVersion}
        RETURNING *`);
      if (!rows[0]) fail('CONCURRENCY_CONFLICT', 409);
      await this.audit.record({ organizationId, actorUserId: actor.id, action: 'SUPPLIER_AUDIT_PLAN_SUBMITTED', resourceType: 'SupplierAuditPlan', resourceId: id, outcome: 'SUCCESS', traceId, metadata: { version: Number(rows[0]!.version) } }, tx);
      return serializePlan(rows[0]!);
    });
  }

  createRecord(actor: AdminActor, input: CreateSupplierAuditRecordDto, traceId: string, key?: string) {
    const organizationId = this.scope(actor); const auditor = text(input.auditor, 200); const summary = text(input.summary, 10000);
    const auditDate = instant(input.auditDate); const findings = input.findings ?? {};
    return this.mutations.run({ actor, organizationId, key, traceId, action: 'SUPPLIER_AUDIT_RECORD_CREATED', payload: input, permission: RECORD_WRITE, duplicateCode: 'CONCURRENCY_CONFLICT' }, async (tx) => {
      const plans = await tx.$queryRaw<Row[]>(Prisma.sql`SELECT id, profile_id, supplier_organization_id, status FROM supplier_audit_plans WHERE id = ${uuid(input.planId)}::uuid AND owner_organization_id = ${organizationId}::uuid FOR UPDATE`);
      const plan = plans[0];
      if (!plan || !['SUBMITTED', 'CLOSED'].includes(String(plan.status))) fail('SUPPLIER_AUDIT_PLAN_NOT_FOUND', 404);
      const rows = await tx.$queryRaw<Row[]>(Prisma.sql`INSERT INTO supplier_audit_records
        (id, owner_organization_id, supplier_organization_id, profile_id, plan_id, audit_date, auditor, summary, findings, created_by_id, updated_at)
        VALUES (${randomUUID()}::uuid, ${organizationId}::uuid, ${String(plan.supplier_organization_id)}::uuid, ${String(plan.profile_id)}::uuid, ${String(plan.id)}::uuid, ${auditDate}::date, ${auditor}, ${summary}, ${JSON.stringify(findings)}::jsonb, ${actor.id}::uuid, CURRENT_TIMESTAMP)
        RETURNING *`);
      const row = rows[0]!;
      await this.recordEvent(tx, actor, organizationId, row, 'CREATED', traceId);
      return serializeRecord(row);
    });
  }

  private async checklist(tx: AdminTransaction, organizationId: string, id: string) {
    const [record] = await tx.$queryRaw<Row[]>`SELECT id, version FROM supplier_audit_records WHERE id = ${uuid(id)}::uuid AND owner_organization_id = ${organizationId}::uuid`;
    if (!record) fail('SUPPLIER_AUDIT_RECORD_NOT_FOUND', 404);
    const items = await tx.$queryRaw<(Row & { evidence_file_ids: string[] })[]>`
      SELECT i.code, i.title, i.result, i.note,
        ARRAY(SELECT e.file_id FROM supplier_audit_checklist_evidence e
          WHERE e.checklist_item_id = i.id AND e.owner_organization_id = ${organizationId}::uuid
          ORDER BY e.created_at, e.id) AS evidence_file_ids
      FROM supplier_audit_checklist_items i
      WHERE i.record_id = ${id}::uuid AND i.owner_organization_id = ${organizationId}::uuid
      ORDER BY i.position`;
    return { recordId: id, recordVersion: Number(record.version), items: items.map((item) => ({
      code: String(item.code), title: String(item.title), result: String(item.result),
      note: item.note == null ? null : String(item.note), evidenceFileIds: item.evidence_file_ids,
    })) };
  }

  async getChecklist(actor: AdminActor, id: string) {
    const organizationId = this.scope(actor);
    return this.prisma.$transaction(async (tx) => {
      await assertAdminAccess(tx, actor, organizationId, RECORD_READ);
      return this.checklist(tx, organizationId, id);
    });
  }

  private async assertChecklistEvidenceCurrent(tx: AdminTransaction, organizationId: string, recordId: string) {
    const files = await tx.$queryRaw<Row[]>(Prisma.sql`SELECT f.* FROM supplier_audit_checklist_evidence e
      JOIN supplier_audit_checklist_items i ON i.id = e.checklist_item_id AND i.owner_organization_id = e.owner_organization_id
      JOIN file_objects f ON f.id = e.file_id
      WHERE i.owner_organization_id = ${organizationId}::uuid AND i.record_id = ${recordId}::uuid
      ORDER BY f.id FOR UPDATE OF f`);
    for (const file of files) {
      if (file.organization_id !== organizationId || file.resource_type !== 'supplier-audit-record' || file.resource_id !== recordId
        || file.status !== 'AVAILABLE' || file.scan_status !== 'CLEAN' || !file.object_version_id || !file.scanned_at || !file.scanner_engine
        || file.verified_sha256 !== file.sha256 || file.verified_content_type !== file.content_type || file.verified_size_bytes !== file.size_bytes) {
        fail('SUPPLIER_AUDIT_EVIDENCE_NOT_AVAILABLE', 409);
      }
    }
  }

  updateChecklist(actor: AdminActor, id: string, input: UpdateSupplierAuditChecklistDto, traceId: string, key?: string) {
    const organizationId = this.scope(actor);
    const items = input.items.map((item) => ({
      code: text(item.code, 64), title: text(item.title, 300), result: item.result,
      note: item.note?.trim() || null, evidenceFileIds: item.evidenceFileIds,
    }));
    const fileIds = items.flatMap((item) => item.evidenceFileIds);
    if (new Set(items.map((item) => item.code)).size !== items.length || new Set(fileIds).size !== fileIds.length
      || items.some((item) => (item.result === 'MINOR_NC' || item.result === 'MAJOR_NC') && !item.note)) fail('SUPPLIER_AUDIT_INPUT_INVALID', 400);
    return this.mutations.run({ actor, organizationId, key, traceId, action: 'SUPPLIER_AUDIT_RECORD_CHECKLIST_UPDATED', payload: { id, ...input }, permission: RECORD_WRITE, isolationLevel: 'ReadCommitted' }, async (tx) => {
      const [current] = await tx.$queryRaw<Row[]>`SELECT * FROM supplier_audit_records
        WHERE id = ${uuid(id)}::uuid AND owner_organization_id = ${organizationId}::uuid FOR UPDATE`;
      if (!current) fail('SUPPLIER_AUDIT_RECORD_NOT_FOUND', 404);
      if (current.status !== 'DRAFT' || Number(current.version) !== input.expectedVersion) fail('CONCURRENCY_CONFLICT', 409);
      await this.files.assertAttachable(tx, actor, { resourceType: 'supplier-audit-record', resourceId: id }, fileIds);
      await tx.$executeRaw`DELETE FROM supplier_audit_checklist_items WHERE owner_organization_id = ${organizationId}::uuid AND record_id = ${id}::uuid`;
      for (const [position, item] of items.entries()) {
        const itemId = randomUUID();
        await tx.$executeRaw`INSERT INTO supplier_audit_checklist_items
          (id, owner_organization_id, record_id, code, title, result, note, position)
          VALUES (${itemId}::uuid, ${organizationId}::uuid, ${id}::uuid, ${item.code}, ${item.title}, ${item.result}, ${item.note}, ${position})`;
        for (const fileId of item.evidenceFileIds) await tx.$executeRaw`INSERT INTO supplier_audit_checklist_evidence
          (id, owner_organization_id, checklist_item_id, file_id)
          VALUES (${randomUUID()}::uuid, ${organizationId}::uuid, ${itemId}::uuid, ${fileId}::uuid)`;
      }
      const [updated] = await tx.$queryRaw<Row[]>`UPDATE supplier_audit_records
        SET version = version + 1, updated_at = CURRENT_TIMESTAMP
        WHERE id = ${id}::uuid AND owner_organization_id = ${organizationId}::uuid AND version = ${input.expectedVersion} AND status = 'DRAFT'
        RETURNING *`;
      if (!updated) fail('CONCURRENCY_CONFLICT', 409);
      await this.recordEvent(tx, actor, organizationId, updated, 'CHECKLIST_UPDATED', traceId);
      return this.checklist(tx, organizationId, id);
    });
  }

  submitRecord(actor: AdminActor, id: string, input: SupplierAuditTransitionDto, traceId: string, key?: string) {
    const organizationId = this.scope(actor);
    return this.mutations.run({ actor, organizationId, key, traceId, action: 'SUPPLIER_AUDIT_RECORD_SUBMITTED', payload: { id, ...input }, permission: RECORD_WRITE }, async (tx) => {
      const rows = await tx.$queryRaw<Row[]>(Prisma.sql`UPDATE supplier_audit_records
        SET status = 'SUBMITTED', version = version + 1, submitted_by_id = ${actor.id}::uuid, submitted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
        WHERE id = ${uuid(id)}::uuid AND owner_organization_id = ${organizationId}::uuid
          AND status = 'DRAFT' AND version = ${input.expectedVersion}
        RETURNING *`);
      if (!rows[0]) fail('CONCURRENCY_CONFLICT', 409);
      await this.assertChecklistEvidenceCurrent(tx, organizationId, id);
      await this.recordEvent(tx, actor, organizationId, rows[0]!, 'SUBMITTED', traceId);
      return serializeRecord(rows[0]!);
    });
  }

  closeRecord(actor: AdminActor, id: string, input: CloseSupplierAuditRecordDto, traceId: string, key?: string) {
    const organizationId = this.scope(actor); const note = text(input.closeNote, 2000);
    return this.mutations.run({ actor, organizationId, key, traceId, action: 'SUPPLIER_AUDIT_RECORD_CLOSED', payload: { id, ...input }, permission: RECORD_CLOSE }, async (tx) => {
      const rows = await tx.$queryRaw<Row[]>(Prisma.sql`UPDATE supplier_audit_records
        SET status = 'CLOSED', conclusion = ${input.conclusion}, close_note = ${note}, closed_by_id = ${actor.id}::uuid,
            closed_at = CURRENT_TIMESTAMP, version = version + 1, updated_at = CURRENT_TIMESTAMP
        WHERE id = ${uuid(id)}::uuid AND owner_organization_id = ${organizationId}::uuid
          AND status = 'SUBMITTED' AND version = ${input.expectedVersion}
        RETURNING *`);
      if (!rows[0]) fail('CONCURRENCY_CONFLICT', 409);
      await this.assertChecklistEvidenceCurrent(tx, organizationId, id);
      await this.recordEvent(tx, actor, organizationId, rows[0]!, 'CLOSED', traceId, note);
      return serializeRecord(rows[0]!);
    });
  }
}
