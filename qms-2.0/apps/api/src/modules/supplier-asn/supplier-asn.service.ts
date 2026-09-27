import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../database/prisma.service.js';
import { AdminMutationService, adminError, assertAdminAccess, type AdminActor, type AdminTransaction } from '../../common/security/admin-mutation.service.js';
import { AuditLogService } from '../audit-log/audit-log.service.js';
import { FileLifecycleService } from '../file-management/file-lifecycle.service.js';
import type { CreateSupplierAsnDto, SupplierAsnQueryDto, SupplierAsnTransitionDto, UpdateSupplierAsnEvidenceDto } from './supplier-asn.dto.js';
type Row = Record<string, unknown>;
const READ = 'supplier-asn:read'; const WRITE = 'supplier-asn:write'; const SUBMIT = 'supplier-asn:submit';
function text(value: string, max: number): string { const normalized = value?.trim(); if (!normalized || normalized.length > max) adminError('SUPPLIER_ASN_INPUT_INVALID', 400); return normalized; }
function uuid(value: string): string { if (!/^[0-9a-f-]{36}$/i.test(value)) adminError('SUPPLIER_ASN_INPUT_INVALID', 400); return value; }
function date(value: string): string { if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) adminError('SUPPLIER_ASN_INPUT_INVALID', 400); return value; }
function iso(value: unknown): string { return new Date(String(value)).toISOString(); }
function dateOnly(value: unknown): string { return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10); }
function dto(row: Row, evidence: Row[] = []) { return { id: String(row.id), ownerOrganizationId: String(row.owner_organization_id), supplierOrganizationId: String(row.supplier_organization_id), profileId: String(row.profile_id), asnNumber: String(row.asn_number), materialCode: String(row.material_code), plannedArrivalDate: dateOnly(row.planned_arrival_date), quantity: Number(row.quantity), status: String(row.status), version: Number(row.version), evidence: evidence.map((item) => ({ fileId: String(item.file_id), fileVersion: Number(item.file_version), sha256: String(item.sha256), scannedAt: iso(item.scanned_at) })), createdAt: iso(row.created_at), updatedAt: iso(row.updated_at) }; }
@Injectable()
export class SupplierAsnService {
  constructor(private readonly prisma: PrismaService, private readonly mutations: AdminMutationService, private readonly audit: AuditLogService, private readonly files: FileLifecycleService) {}
  private scope(actor: AdminActor, requested?: string) { if (actor.accountType !== 'INTERNAL') adminError('FEATURE_PERMISSION_DENIED', 403); const organizationId = actor.scopeOrganizationId ?? actor.organizationId; if (requested && requested !== organizationId) adminError('ORGANIZATION_SCOPE_DENIED', 403); return organizationId; }
  private async current(tx: AdminTransaction, organizationId: string, id: string, lock = false) { const rows = await tx.$queryRaw<Row[]>(Prisma.sql`SELECT * FROM supplier_asn_records WHERE owner_organization_id = ${organizationId}::uuid AND id = ${uuid(id)}::uuid ${lock ? Prisma.sql`FOR UPDATE` : Prisma.empty}`); if (!rows[0]) adminError('SUPPLIER_ASN_NOT_FOUND', 404); return rows[0]!; }
  private evidence(tx: AdminTransaction, organizationId: string, id: string) { return tx.$queryRaw<Row[]>(Prisma.sql`SELECT file_id, file_version, sha256, scanned_at FROM supplier_asn_evidence_refs WHERE owner_organization_id = ${organizationId}::uuid AND asn_id = ${id}::uuid ORDER BY position`); }
  private async event(tx: AdminTransaction, actor: AdminActor, organizationId: string, id: string, type: string, version: number, traceId: string, note?: string) { await tx.$executeRaw`INSERT INTO supplier_asn_events (id, owner_organization_id, asn_id, event_type, asn_version, actor_user_id, note) VALUES (${randomUUID()}::uuid, ${organizationId}::uuid, ${id}::uuid, ${type}, ${version}, ${actor.id}::uuid, ${note ?? null})`; await this.audit.record({ organizationId, actorUserId: actor.id, action: `SUPPLIER_ASN_${type}`, resourceType: 'SupplierAsn', resourceId: id, outcome: 'SUCCESS', traceId, metadata: { resourceVersion: version, note: note ?? null } }, tx); }
  async list(actor: AdminActor, query: SupplierAsnQueryDto) { const organizationId = this.scope(actor, query.organizationId); return this.prisma.$transaction(async (tx) => { await assertAdminAccess(tx, actor, organizationId, READ); const filters = [Prisma.sql`owner_organization_id = ${organizationId}::uuid`]; if (query.profileId) filters.push(Prisma.sql`profile_id = ${uuid(query.profileId)}::uuid`); const where = Prisma.join(filters, ' AND '); const [rows, count] = await Promise.all([tx.$queryRaw<Row[]>(Prisma.sql`SELECT * FROM supplier_asn_records WHERE ${where} ORDER BY created_at DESC, id DESC LIMIT ${query.pageSize} OFFSET ${(query.page - 1) * query.pageSize}`), tx.$queryRaw<{ count: bigint }[]>(Prisma.sql`SELECT count(*)::bigint AS count FROM supplier_asn_records WHERE ${where}`)]); const items = await Promise.all(rows.map(async (row) => dto(row, await this.evidence(tx, organizationId, String(row.id))))); return { items, total: Number(count[0]?.count ?? 0), page: query.page, pageSize: query.pageSize }; }); }
  async detail(actor: AdminActor, id: string) { const organizationId = this.scope(actor); return this.prisma.$transaction(async (tx) => { await assertAdminAccess(tx, actor, organizationId, READ); const row = await this.current(tx, organizationId, id); return dto(row, await this.evidence(tx, organizationId, id)); }); }
  create(actor: AdminActor, input: CreateSupplierAsnDto, traceId: string, key?: string) { const organizationId = this.scope(actor); const asnNumber = text(input.asnNumber, 120); const materialCode = text(input.materialCode, 100); const plannedArrivalDate = date(input.plannedArrivalDate); return this.mutations.run({ actor, organizationId, key, traceId, action: 'SUPPLIER_ASN_CREATED', payload: input, permission: WRITE, additionalAccess: [{ organizationId, permission: 'supplier-quality:profiles:read' }] }, async (tx) => { const profile = await tx.$queryRaw<Row[]>(Prisma.sql`SELECT id, supplier_organization_id FROM supplier_business_profiles WHERE id = ${uuid(input.profileId)}::uuid AND owner_organization_id = ${organizationId}::uuid`); if (!profile[0]) adminError('SUPPLIER_ASN_NOT_FOUND', 404); const rows = await tx.$queryRaw<Row[]>(Prisma.sql`INSERT INTO supplier_asn_records (id, owner_organization_id, supplier_organization_id, profile_id, asn_number, material_code, planned_arrival_date, quantity, created_by_id) VALUES (${randomUUID()}::uuid, ${organizationId}::uuid, ${String(profile[0]!.supplier_organization_id)}::uuid, ${String(profile[0]!.id)}::uuid, ${asnNumber}, ${materialCode}, ${plannedArrivalDate}::date, ${input.quantity}, ${actor.id}::uuid) RETURNING *`); const row = rows[0]!; await this.event(tx, actor, organizationId, String(row.id), 'CREATED', 1, traceId); return dto(row); }); }
  updateEvidence(actor: AdminActor, id: string, input: UpdateSupplierAsnEvidenceDto, traceId: string, key?: string) {
    const organizationId = this.scope(actor);
    if (!input.fileIds?.length || input.fileIds.length > 10 || new Set(input.fileIds).size !== input.fileIds.length) adminError('FILE_UPLOAD_INVALID', 400);
    return this.mutations.run({ actor, organizationId, key, traceId, action: 'SUPPLIER_ASN_EVIDENCE_UPDATED', payload: { id, ...input }, permission: WRITE, isolationLevel: 'ReadCommitted' }, async (tx) => {
      const asn = await this.current(tx, organizationId, id, true);
      if (String(asn.status) !== 'DRAFT' || Number(asn.version) !== input.expectedVersion) adminError('CONCURRENCY_CONFLICT', 409);
      const files = await this.files.assertAttachable(tx, actor, { resourceType: 'supplier-asn-record', resourceId: id }, input.fileIds);
      await tx.$executeRaw`DELETE FROM supplier_asn_evidence_refs WHERE owner_organization_id = ${organizationId}::uuid AND asn_id = ${id}::uuid`;
      for (const [position, fileId] of input.fileIds.entries()) {
        const file = files.find((candidate) => candidate.id === fileId)!;
        await tx.$executeRaw`INSERT INTO supplier_asn_evidence_refs (id, owner_organization_id, asn_id, file_id, file_version, sha256, scanned_at, position)
          VALUES (${randomUUID()}::uuid, ${organizationId}::uuid, ${id}::uuid, ${fileId}::uuid, ${file.version}, ${file.sha256}, ${file.scannedAt}::timestamptz, ${position})`;
      }
      const [updated] = await tx.$queryRaw<Row[]>`UPDATE supplier_asn_records SET version = version + 1, updated_at = CURRENT_TIMESTAMP
        WHERE owner_organization_id = ${organizationId}::uuid AND id = ${id}::uuid AND status = 'DRAFT' AND version = ${input.expectedVersion} RETURNING *`;
      if (!updated) adminError('CONCURRENCY_CONFLICT', 409);
      await this.event(tx, actor, organizationId, id, 'EVIDENCE_UPDATED', Number(updated.version), traceId);
      return dto(updated, await this.evidence(tx, organizationId, id));
    });
  }
  submit(actor: AdminActor, id: string, input: SupplierAsnTransitionDto, traceId: string, key?: string) {
    const organizationId = this.scope(actor);
    return this.mutations.run({ actor, organizationId, key, traceId, action: 'SUPPLIER_ASN_SUBMITTED', payload: { id, ...input }, permission: SUBMIT, isolationLevel: 'ReadCommitted' }, async (tx) => {
      const asn = await this.current(tx, organizationId, id, true);
      if (String(asn.status) !== 'DRAFT' || Number(asn.version) !== input.expectedVersion) adminError('CONCURRENCY_CONFLICT', 409);
      const standard = await tx.$queryRaw<Row[]>(Prisma.sql`SELECT id FROM supplier_inspection_standards WHERE owner_organization_id = ${organizationId}::uuid AND profile_id = ${String(asn.profile_id)}::uuid AND material_code = ${String(asn.material_code)} AND status = 'PUBLISHED'`);
      if (!standard[0]) adminError('SUPPLIER_ASN_STANDARD_REQUIRED', 409);
      const ppap = await tx.$queryRaw<Row[]>(Prisma.sql`SELECT id FROM supplier_ppap_packages WHERE owner_organization_id = ${organizationId}::uuid AND profile_id = ${String(asn.profile_id)}::uuid AND part_number = ${String(asn.material_code)} AND status = 'APPROVED'`);
      if (!ppap[0]) adminError('SUPPLIER_ASN_PPAP_REQUIRED', 409);
      const evidence = await this.evidence(tx, organizationId, id);
      if (!evidence.length) adminError('FILE_NOT_AVAILABLE', 409);
      const files = await this.files.assertAttachable(tx, actor, { resourceType: 'supplier-asn-record', resourceId: id }, evidence.map((item) => String(item.file_id)));
      const mismatch = evidence.some((item) => {
        const file = files.find((candidate) => candidate.id === String(item.file_id));
        const fileScanTime = file?.scannedAt ? new Date(file.scannedAt).getTime() : null;
        const evidenceScanTime = item.scanned_at instanceof Date ? item.scanned_at.getTime() : new Date(String(item.scanned_at)).getTime();
        const checks = { found: !!file, version: file?.version === Number(item.file_version), sha: file?.sha256 === String(item.sha256).trim(), scanned: fileScanTime !== null && fileScanTime === evidenceScanTime };
        return !checks.found || !checks.version || !checks.sha || !checks.scanned;
      });
      if (mismatch) adminError('CONCURRENCY_CONFLICT', 409);
      const rows = await tx.$queryRaw<Row[]>(Prisma.sql`UPDATE supplier_asn_records SET status = 'SUBMITTED', version = version + 1, submitted_by_id = ${actor.id}::uuid, submitted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE owner_organization_id = ${organizationId}::uuid AND id = ${id}::uuid AND status = 'DRAFT' AND version = ${input.expectedVersion} RETURNING *`);
      if (!rows[0]) adminError('CONCURRENCY_CONFLICT', 409);
      await this.event(tx, actor, organizationId, id, 'SUBMITTED', Number(rows[0]!.version), traceId);
      return dto(rows[0]!, evidence);
    });
  }
}
