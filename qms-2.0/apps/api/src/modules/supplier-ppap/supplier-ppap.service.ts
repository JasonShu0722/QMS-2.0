import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Prisma } from '../../generated/prisma/client.js';
import { SupplierQualityService } from '../supplier-quality/supplier-quality.service.js';
import { PrismaService } from '../../database/prisma.service.js';
import { AdminMutationService, adminError, assertAdminAccess, type AdminActor, type AdminTransaction } from '../../common/security/admin-mutation.service.js';
import { AuditLogService } from '../audit-log/audit-log.service.js';
import { FileLifecycleService } from '../file-management/file-lifecycle.service.js';
import type { CreateSupplierPpapDto, CreateSupplierPpapItemDto, ReviewSupplierPpapDto, ReviewSupplierPpapItemDto, RequalifySupplierPpapDto, SupplierPpapEvidenceDto, SupplierPpapQueryDto, SupplierPpapTransitionDto } from './supplier-ppap.dto.js';
import { ppapTemplate } from './supplier-ppap-template.js';

type Row = Record<string, unknown>;
const READ = 'supplier-ppap:read';
const WRITE = 'supplier-ppap:write';
const REVIEW = 'supplier-ppap:review';

function uuid(value: string): string { if (!/^[0-9a-f-]{36}$/i.test(value)) adminError('SUPPLIER_PPAP_INPUT_INVALID', 400); return value; }
function text(value: string, max: number): string { const normalized = value?.trim(); if (!normalized || normalized.length > max) adminError('SUPPLIER_PPAP_INPUT_INVALID', 400); return normalized; }
function iso(value: unknown): string { return new Date(String(value)).toISOString(); }
function isUniqueViolation(error: unknown): boolean { const value = error as { code?: string; meta?: { code?: string }; message?: string }; const message = String(value?.message ?? error); return value?.code === 'P2002' || value?.code === 'P2010' && value?.meta?.code === '23505' || message.includes('23505') || message.includes('duplicate key'); }
function itemDto(row: Row) { return { id: String(row.id), packageId: String(row.package_id), itemCode: String(row.item_code), title: String(row.title), description: row.description === null ? null : String(row.description), required: Boolean(row.required), status: String(row.status), content: (row.content ?? {}) as Record<string, unknown>, evidenceFileIds: (row.evidence_file_ids ?? []) as string[], reviewNote: row.review_note === null || row.review_note === undefined ? null : String(row.review_note), reviewedAt: row.reviewed_at ? iso(row.reviewed_at) : null, version: Number(row.version), createdAt: iso(row.created_at), updatedAt: iso(row.updated_at) }; }
function packageDto(row: Row, items: Row[] = []) { return { id: String(row.id), ownerOrganizationId: String(row.owner_organization_id), supplierOrganizationId: row.supplier_organization_id === null ? null : String(row.supplier_organization_id), profileId: String(row.profile_id), level: Number(row.level), title: String(row.title), partNumber: String(row.part_number), status: String(row.status), version: Number(row.version), reviewNote: row.review_note === null ? null : String(row.review_note), requalificationDueAt: row.requalification_due_at ? iso(row.requalification_due_at) : null, lastRequalifiedAt: row.last_requalified_at ? iso(row.last_requalified_at) : null, requalificationNote: row.requalification_note === null || row.requalification_note === undefined ? null : String(row.requalification_note), items: items.map(itemDto), createdAt: iso(row.created_at), updatedAt: iso(row.updated_at) }; }

@Injectable()
export class SupplierPpapService {
  constructor(private readonly suppliers: SupplierQualityService, private readonly prisma: PrismaService, private readonly mutations: AdminMutationService, private readonly audit: AuditLogService, private readonly files: FileLifecycleService) {}

  private scope(actor: AdminActor, requested?: string) {
    if (actor.accountType !== 'INTERNAL') adminError('FEATURE_PERMISSION_DENIED', 403);
    const organizationId = actor.scopeOrganizationId ?? actor.organizationId;
    if (requested && requested !== organizationId) adminError('ORGANIZATION_SCOPE_DENIED', 403);
    return organizationId;
  }

  private async current(tx: AdminTransaction, organizationId: string, id: string, lock = false) {
    const rows = await tx.$queryRaw<Row[]>(Prisma.sql`SELECT * FROM supplier_ppap_packages WHERE owner_organization_id = ${organizationId}::uuid AND id = ${uuid(id)}::uuid ${lock ? Prisma.sql`FOR UPDATE` : Prisma.empty}`);
    if (!rows[0]) adminError('SUPPLIER_PPAP_NOT_FOUND', 404);
    return rows[0]!;
  }

  private async items(tx: AdminTransaction, organizationId: string, packageId: string) {
    return tx.$queryRaw<Row[]>(Prisma.sql`SELECT item.*, COALESCE((SELECT array_agg(evidence.file_id ORDER BY evidence.file_id) FROM supplier_ppap_item_evidence evidence WHERE evidence.owner_organization_id = item.owner_organization_id AND evidence.item_id = item.id), ARRAY[]::uuid[]) AS evidence_file_ids FROM supplier_ppap_items item WHERE item.owner_organization_id = ${organizationId}::uuid AND item.package_id = ${uuid(packageId)}::uuid ORDER BY item.item_code`);
  }

  private async event(tx: AdminTransaction, actor: AdminActor, organizationId: string, packageId: string, entityType: 'PACKAGE' | 'ITEM', entityId: string, eventType: string, version: number, traceId: string, note?: string) {
    await tx.$executeRaw`INSERT INTO supplier_ppap_events (id, owner_organization_id, package_id, entity_type, entity_id, event_type, entity_version, actor_user_id, note) VALUES (${randomUUID()}::uuid, ${organizationId}::uuid, ${packageId}::uuid, ${entityType}, ${entityId}::uuid, ${eventType}, ${version}, ${actor.id}::uuid, ${note ?? null})`;
    await this.audit.record({ organizationId, actorUserId: actor.id, action: `SUPPLIER_PPAP_${eventType}`, resourceType: entityType === 'PACKAGE' ? 'SupplierPpapPackage' : 'SupplierPpapItem', resourceId: entityId, outcome: 'SUCCESS', traceId, metadata: { packageId, version, note: note ?? null } }, tx);
  }

  async list(actor: AdminActor, query: SupplierPpapQueryDto) {
    const organizationId = this.scope(actor, query.organizationId);
    return this.prisma.$transaction(async (tx) => {
      await assertAdminAccess(tx, actor, organizationId, READ);
      const filters = [Prisma.sql`owner_organization_id = ${organizationId}::uuid`];
      if (query.status) filters.push(Prisma.sql`status = ${query.status}`);
      if (query.level) filters.push(Prisma.sql`level = ${query.level}`);
      const where = Prisma.join(filters, ' AND ');
      const [rows, counts] = await Promise.all([
        tx.$queryRaw<Row[]>(Prisma.sql`SELECT * FROM supplier_ppap_packages WHERE ${where} ORDER BY created_at DESC, id DESC LIMIT ${query.pageSize} OFFSET ${(query.page - 1) * query.pageSize}`),
        tx.$queryRaw<{ count: bigint }[]>(Prisma.sql`SELECT count(*)::bigint AS count FROM supplier_ppap_packages WHERE ${where}`),
      ]);
      const packageItems = await Promise.all(rows.map((row) => this.items(tx, organizationId, String(row.id))));
      return { items: rows.map((row, index) => packageDto(row, packageItems[index])), total: Number(counts[0]?.count ?? 0), page: query.page, pageSize: query.pageSize };
    });
  }

  async detail(actor: AdminActor, id: string) {
    const organizationId = this.scope(actor);
    return this.prisma.$transaction(async (tx) => { await assertAdminAccess(tx, actor, organizationId, READ); const row = await this.current(tx, organizationId, id); return packageDto(row, await this.items(tx, organizationId, id)); });
  }

  create(actor: AdminActor, input: CreateSupplierPpapDto, traceId: string, key?: string) {
    const organizationId = this.scope(actor); const title = text(input.title, 300); const partNumber = text(input.partNumber, 120);
    return this.mutations.run({ actor, organizationId, key, traceId, action: 'SUPPLIER_PPAP_CREATED', payload: input, permission: WRITE, additionalAccess: [{ organizationId, permission: 'supplier-quality:profiles:read' }] }, async (tx) => {
      const profile = await this.suppliers.performanceProfile(tx, organizationId, input.profileId); const rows = await tx.$queryRaw<Row[]>(Prisma.sql`INSERT INTO supplier_ppap_packages (id, owner_organization_id, supplier_organization_id, profile_id, level, title, part_number, created_by_id) VALUES (${randomUUID()}::uuid, ${organizationId}::uuid, ${profile.supplierOrganizationId}::uuid, ${profile.id}::uuid, ${input.level}, ${title}, ${partNumber}, ${actor.id}::uuid) RETURNING *`);
      const row = rows[0]!;
      for (const item of ppapTemplate(input.level)) await tx.$executeRaw`INSERT INTO supplier_ppap_items (id, owner_organization_id, package_id, item_code, title, required, status, created_by_id) VALUES (${randomUUID()}::uuid, ${organizationId}::uuid, ${String(row.id)}::uuid, ${item.code}, ${item.title}, true, 'PENDING', ${actor.id}::uuid)`;
      await this.event(tx, actor, organizationId, String(row.id), 'PACKAGE', String(row.id), 'CREATED', 1, traceId);
      return packageDto(row, await this.items(tx, organizationId, String(row.id)));
    });
  }

  addItem(actor: AdminActor, packageId: string, input: CreateSupplierPpapItemDto, traceId: string, key?: string) {
    const organizationId = this.scope(actor); const itemCode = text(input.itemCode, 80); const title = text(input.title, 300); const description = input.description?.trim() || null;
    return this.mutations.run({ actor, organizationId, key, traceId, action: 'SUPPLIER_PPAP_ITEM_CREATED', payload: { packageId, ...input }, permission: WRITE, duplicateCode: 'SUPPLIER_PPAP_ITEM_EXISTS' }, async (tx) => {
      const pack = await this.current(tx, organizationId, packageId, true);
      if (!['DRAFT', 'REJECTED'].includes(String(pack.status))) adminError('SUPPLIER_PPAP_STATE_INVALID', 409);
      const duplicate = await tx.$queryRaw<Row[]>(Prisma.sql`SELECT id FROM supplier_ppap_items WHERE owner_organization_id = ${organizationId}::uuid AND package_id = ${String(pack.id)}::uuid AND item_code = ${itemCode} LIMIT 1`);
      if (duplicate[0]) adminError('SUPPLIER_PPAP_ITEM_EXISTS', 409);
      let rows: Row[];
      try {
        rows = await tx.$queryRaw<Row[]>(Prisma.sql`INSERT INTO supplier_ppap_items (id, owner_organization_id, package_id, item_code, title, description, required, status, content, created_by_id) VALUES (${randomUUID()}::uuid, ${organizationId}::uuid, ${String(pack.id)}::uuid, ${itemCode}, ${title}, ${description}, ${input.required ?? true}, 'PENDING', ${JSON.stringify(input.content ?? {})}::jsonb, ${actor.id}::uuid) RETURNING *`);
      } catch (error) {
        if (isUniqueViolation(error)) adminError('SUPPLIER_PPAP_ITEM_EXISTS', 409);
        throw error;
      }
      if (!rows[0]) adminError('SUPPLIER_PPAP_ITEM_EXISTS', 409);
      await this.event(tx, actor, organizationId, String(pack.id), 'ITEM', String(rows[0]!.id), 'ITEM_CREATED', 1, traceId); return itemDto(rows[0]!);
    });
  }

  bindEvidence(actor: AdminActor, packageId: string, itemId: string, input: SupplierPpapEvidenceDto, traceId: string, key?: string) {
    const organizationId = this.scope(actor);
    if (new Set(input.evidenceFileIds).size !== input.evidenceFileIds.length) adminError('SUPPLIER_PPAP_INPUT_INVALID', 400);
    return this.mutations.run({ actor, organizationId, key, traceId, action: 'SUPPLIER_PPAP_ITEM_EVIDENCE_BOUND', payload: { packageId, itemId, ...input }, permission: WRITE, isolationLevel: 'ReadCommitted' }, async (tx) => {
      const pack = await this.current(tx, organizationId, packageId, true);
      if (!['DRAFT', 'REJECTED'].includes(String(pack.status))) adminError('SUPPLIER_PPAP_STATE_INVALID', 409);
      const [item] = await tx.$queryRaw<Row[]>(Prisma.sql`SELECT * FROM supplier_ppap_items WHERE owner_organization_id = ${organizationId}::uuid AND package_id = ${uuid(packageId)}::uuid AND id = ${uuid(itemId)}::uuid FOR UPDATE`);
      if (!item) adminError('SUPPLIER_PPAP_NOT_FOUND', 404);
      if (Number(item.version) !== input.expectedVersion) adminError('CONCURRENCY_CONFLICT', 409);
      await this.files.assertAttachable(tx, actor, { resourceType: 'supplier-ppap-item', resourceId: itemId }, input.evidenceFileIds);
      await tx.$executeRaw`DELETE FROM supplier_ppap_item_evidence WHERE owner_organization_id = ${organizationId}::uuid AND item_id = ${itemId}::uuid`;
      for (const fileId of input.evidenceFileIds) await tx.$executeRaw`INSERT INTO supplier_ppap_item_evidence (id, owner_organization_id, item_id, file_id) VALUES (${randomUUID()}::uuid, ${organizationId}::uuid, ${itemId}::uuid, ${fileId}::uuid)`;
      const [updated] = await tx.$queryRaw<Row[]>(Prisma.sql`UPDATE supplier_ppap_items SET status = 'PROVIDED', version = version + 1, updated_at = CURRENT_TIMESTAMP WHERE owner_organization_id = ${organizationId}::uuid AND id = ${itemId}::uuid AND version = ${input.expectedVersion} RETURNING *`);
      if (!updated) adminError('CONCURRENCY_CONFLICT', 409);
      await this.event(tx, actor, organizationId, packageId, 'ITEM', itemId, 'EVIDENCE_BOUND', Number(updated.version), traceId);
      return itemDto({ ...updated, evidence_file_ids: [...input.evidenceFileIds].sort() });
    });
  }

  submit(actor: AdminActor, id: string, input: SupplierPpapTransitionDto, traceId: string, key?: string) {
    const organizationId = this.scope(actor);
    return this.mutations.run({ actor, organizationId, key, traceId, action: 'SUPPLIER_PPAP_SUBMITTED', payload: { id, ...input }, permission: WRITE, isolationLevel: 'ReadCommitted' }, async (tx) => {
      const pack = await this.current(tx, organizationId, id, true);
      if (!['DRAFT', 'REJECTED'].includes(String(pack.status)) || Number(pack.version) !== input.expectedVersion) adminError('CONCURRENCY_CONFLICT', 409);
      const checklist = await this.items(tx, organizationId, id);
      const mandatory = ppapTemplate(Number(pack.level));
      if (mandatory.some((template) => !checklist.some((item) => item.item_code === template.code && item.required === true))
        || checklist.some((item) => item.required === true && (!['PROVIDED', 'ACCEPTED'].includes(String(item.status)) || !(item.evidence_file_ids as string[]).length))) adminError('SUPPLIER_PPAP_ITEMS_INCOMPLETE', 409);
      const evidenceFileIds = checklist.flatMap((item) => item.evidence_file_ids as string[]);
      if (new Set(evidenceFileIds).size !== evidenceFileIds.length) adminError('SUPPLIER_PPAP_ITEMS_INCOMPLETE', 409);
      for (const item of checklist) if ((item.evidence_file_ids as string[]).length) await this.files.assertAttachable(tx, actor, { resourceType: 'supplier-ppap-item', resourceId: String(item.id) }, item.evidence_file_ids as string[]);
      const rows = await tx.$queryRaw<Row[]>(Prisma.sql`UPDATE supplier_ppap_packages SET status = 'SUBMITTED', version = version + 1, submitted_by_id = ${actor.id}::uuid, submitted_at = CURRENT_TIMESTAMP, reviewed_by_id = NULL, reviewed_at = NULL, review_note = NULL, updated_at = CURRENT_TIMESTAMP WHERE owner_organization_id = ${organizationId}::uuid AND id = ${id}::uuid AND version = ${input.expectedVersion} AND status IN ('DRAFT', 'REJECTED') RETURNING *`);
      if (!rows[0]) adminError('CONCURRENCY_CONFLICT', 409); await this.event(tx, actor, organizationId, id, 'PACKAGE', id, 'SUBMITTED', Number(rows[0]!.version), traceId); return packageDto(rows[0]!, await this.items(tx, organizationId, id));
    });
  }

  review(actor: AdminActor, id: string, input: ReviewSupplierPpapDto, traceId: string, key?: string) {
    const organizationId = this.scope(actor); const note = text(input.note, 2000);
    return this.mutations.run({ actor, organizationId, key, traceId, action: `SUPPLIER_PPAP_${input.decision}`, payload: { id, ...input }, permission: REVIEW }, async (tx) => {
      const pack = await this.current(tx, organizationId, id, true);
      if (String(pack.status) !== 'SUBMITTED' || Number(pack.version) !== input.expectedVersion) adminError('CONCURRENCY_CONFLICT', 409);
      if (input.decision === 'APPROVED') {
        const pending = await tx.$queryRaw<Row[]>(Prisma.sql`SELECT id FROM supplier_ppap_items WHERE owner_organization_id = ${organizationId}::uuid AND package_id = ${id}::uuid AND required = true AND status <> 'ACCEPTED' LIMIT 1`);
        if (pending[0]) adminError('SUPPLIER_PPAP_ITEMS_NOT_REVIEWED', 409);
      }
      const rows = await tx.$queryRaw<Row[]>(Prisma.sql`UPDATE supplier_ppap_packages SET status = ${input.decision}, version = version + 1, reviewed_by_id = ${actor.id}::uuid, reviewed_at = CURRENT_TIMESTAMP, review_note = ${note}, updated_at = CURRENT_TIMESTAMP WHERE owner_organization_id = ${organizationId}::uuid AND id = ${id}::uuid AND status = 'SUBMITTED' AND version = ${input.expectedVersion} RETURNING *`);
      if (!rows[0]) adminError('CONCURRENCY_CONFLICT', 409); await this.event(tx, actor, organizationId, id, 'PACKAGE', id, input.decision, Number(rows[0]!.version), traceId, note); return packageDto(rows[0]!, await this.items(tx, organizationId, id));
    });
  }

  reviewItem(actor: AdminActor, packageId: string, itemId: string, input: ReviewSupplierPpapItemDto, traceId: string, key?: string) {
    const organizationId = this.scope(actor); const note = text(input.note, 2000);
    return this.mutations.run({ actor, organizationId, key, traceId, action: `SUPPLIER_PPAP_ITEM_${input.decision}`, payload: { packageId, itemId, ...input }, permission: REVIEW }, async (tx) => {
      const pack = await this.current(tx, organizationId, packageId, true);
      if (String(pack.status) !== 'SUBMITTED') adminError('SUPPLIER_PPAP_STATE_INVALID', 409);
      const [item] = await tx.$queryRaw<Row[]>(Prisma.sql`SELECT item.*, COALESCE((SELECT array_agg(evidence.file_id ORDER BY evidence.file_id) FROM supplier_ppap_item_evidence evidence WHERE evidence.owner_organization_id = item.owner_organization_id AND evidence.item_id = item.id), ARRAY[]::uuid[]) AS evidence_file_ids FROM supplier_ppap_items item WHERE item.owner_organization_id = ${organizationId}::uuid AND item.package_id = ${packageId}::uuid AND item.id = ${itemId}::uuid FOR UPDATE`);
      if (!item) adminError('SUPPLIER_PPAP_NOT_FOUND', 404);
      if (Number(item.version) !== input.expectedVersion) adminError('CONCURRENCY_CONFLICT', 409);
      if (input.decision === 'ACCEPTED' && !(Array.isArray(item.evidence_file_ids) && item.evidence_file_ids.length)) adminError('SUPPLIER_PPAP_ITEM_EVIDENCE_REQUIRED', 409);
      const [updated] = await tx.$queryRaw<Row[]>(Prisma.sql`UPDATE supplier_ppap_items SET status = ${input.decision}, review_note = ${note}, reviewed_by_id = ${actor.id}::uuid, reviewed_at = CURRENT_TIMESTAMP, version = version + 1, updated_at = CURRENT_TIMESTAMP WHERE owner_organization_id = ${organizationId}::uuid AND id = ${itemId}::uuid AND version = ${input.expectedVersion} RETURNING *`);
      if (!updated) adminError('CONCURRENCY_CONFLICT', 409);
      await tx.$executeRaw`UPDATE supplier_ppap_packages SET version = version + 1, updated_at = CURRENT_TIMESTAMP WHERE owner_organization_id = ${organizationId}::uuid AND id = ${packageId}::uuid`;
      await this.event(tx, actor, organizationId, packageId, 'ITEM', itemId, input.decision, Number(updated.version), traceId, note);
      return itemDto({ ...updated, evidence_file_ids: item.evidence_file_ids ?? [] });
    });
  }

  requalify(actor: AdminActor, id: string, input: RequalifySupplierPpapDto, traceId: string, key?: string) {
    const organizationId = this.scope(actor); const note = text(input.note, 2000);
    return this.mutations.run({ actor, organizationId, key, traceId, action: 'SUPPLIER_PPAP_ANNUAL_REQUALIFIED', payload: { id, ...input }, permission: REVIEW }, async (tx) => {
      const pack = await this.current(tx, organizationId, id, true);
      if (String(pack.status) !== 'APPROVED' || Number(pack.version) !== input.expectedVersion) adminError('SUPPLIER_PPAP_STATE_INVALID', 409);
      const rows = await tx.$queryRaw<Row[]>(Prisma.sql`UPDATE supplier_ppap_packages SET last_requalified_at = CURRENT_TIMESTAMP, requalification_due_at = CURRENT_TIMESTAMP + INTERVAL '1 year', requalification_note = ${note}, version = version + 1, updated_at = CURRENT_TIMESTAMP WHERE owner_organization_id = ${organizationId}::uuid AND id = ${id}::uuid AND status = 'APPROVED' AND version = ${input.expectedVersion} RETURNING *`);
      if (!rows[0]) adminError('CONCURRENCY_CONFLICT', 409);
      await this.event(tx, actor, organizationId, id, 'PACKAGE', id, 'ANNUAL_REQUALIFIED', Number(rows[0]!.version), traceId, note);
      return packageDto(rows[0]!, await this.items(tx, organizationId, id));
    });
  }
}
