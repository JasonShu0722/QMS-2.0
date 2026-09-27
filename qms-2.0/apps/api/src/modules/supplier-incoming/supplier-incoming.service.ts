import { HttpException, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../database/prisma.service.js';
import { AdminMutationService, assertAdminAccess, type AdminActor, type AdminTransaction } from '../../common/security/admin-mutation.service.js';
import { AuditLogService } from '../audit-log/audit-log.service.js';
import { FileLifecycleService } from '../file-management/file-lifecycle.service.js';
import { SupplierQualityService } from '../supplier-quality/supplier-quality.service.js';
import type { CreateIncomingInspectionDto, CompleteIncomingInspectionDto, CorrectIncomingInspectionDto, IncomingQueryDto, LinkIncomingProblemDto } from './supplier-incoming.dto.js';
import { READ_PERMISSION, WRITE_PERMISSION, assertQuantities, fail, normalizeItems, positive, text } from './supplier-incoming.rules.js';

type Row = Record<string, any>;

@Injectable()
export class SupplierIncomingService {
  constructor(private readonly prisma: PrismaService, private readonly mutations: AdminMutationService, private readonly audit: AuditLogService, private readonly files: FileLifecycleService, private readonly supplierProblems: SupplierQualityService) {}

  async concessionSource(tx: AdminTransaction, organizationId: string, inspectionId: string) {
    const rows = await tx.$queryRaw<{ id: string; owner_organization_id: string; profile_id: string; supplier_organization_id: string; supplier_name: string; material_code: string; incoming_batch: string; received_quantity: number; conclusion: string; status: string; version: number }[]>`
      SELECT id, owner_organization_id, profile_id, supplier_organization_id, supplier_name, material_code,
        incoming_batch, received_quantity, conclusion, status, version
      FROM supplier_incoming_inspections
      WHERE id = ${inspectionId}::uuid AND owner_organization_id = ${organizationId}::uuid FOR SHARE`;
    return rows[0] ?? null;
  }

  private scope(actor: AdminActor) { if (actor.accountType !== 'INTERNAL') fail('ORGANIZATION_SCOPE_DENIED', 403); return actor.scopeOrganizationId ?? actor.organizationId; }
  private serialize(row: Row) {
    return { id: row.id, organizationId: row.owner_organization_id, profileId: row.profile_id, supplierOrganizationId: row.supplier_organization_id,
      supplierBusinessCode: row.supplier_business_code, supplierName: row.supplier_name, materialCode: row.material_code, incomingBatch: row.incoming_batch,
      receivedQuantity: Number(row.received_quantity), sampledQuantity: Number(row.sampled_quantity), conclusion: row.conclusion, status: row.status,
      inspectorId: row.inspector_id, inspectedAt: row.inspected_at ? new Date(row.inspected_at).toISOString() : null, sourceSystem: row.source_system,
      externalRecordKey: row.external_record_key ?? null, externalBatchKey: row.external_batch_key ?? null, observedAt: row.observed_at ? new Date(row.observed_at).toISOString() : null,
      sourceSnapshot: row.source_snapshot, correctionReason: row.correction_reason ?? null, version: Number(row.version), createdAt: new Date(row.created_at).toISOString(), updatedAt: new Date(row.updated_at).toISOString(),
    };
  }

  async performanceSources(tx: AdminTransaction, organizationId: string, profileId: string, start: Date, end: Date) {
    const rows = await tx.$queryRaw<{ id: string; version: number; conclusion: 'PASS' | 'NG' }[]>`
      SELECT id, version, conclusion FROM supplier_incoming_inspections
      WHERE owner_organization_id = ${organizationId}::uuid AND profile_id = ${profileId}::uuid
        AND status IN ('COMPLETED', 'CORRECTED') AND inspected_at >= ${start} AND inspected_at < ${end}
      ORDER BY inspected_at, id LIMIT 10001`;
    if (rows.length > 10000) fail('SUPPLIER_PERFORMANCE_SOURCE_LIMIT', 409);
    return rows;
  }

  async list(actor: AdminActor, query: IncomingQueryDto) {
    const organizationId = query.organizationId ?? this.scope(actor);
    return this.prisma.$transaction(async (tx) => {
      await assertAdminAccess(tx, actor, organizationId, READ_PERMISSION);
      const filters = [Prisma.sql`owner_organization_id = ${organizationId}::uuid`];
      if (query.profileId) filters.push(Prisma.sql`profile_id = ${query.profileId}::uuid`);
      if (query.materialCode) filters.push(Prisma.sql`material_code = ${query.materialCode.trim()}`);
      if (query.status) filters.push(Prisma.sql`status = ${query.status}`);
      const where = Prisma.join(filters, ' AND ');
      const rows = await tx.$queryRaw<Row[]>(Prisma.sql`SELECT * FROM supplier_incoming_inspections WHERE ${where} ORDER BY created_at DESC, id DESC LIMIT ${query.pageSize} OFFSET ${(query.page - 1) * query.pageSize}`);
      const count = await tx.$queryRaw<{ count: bigint }[]>(Prisma.sql`SELECT count(*)::bigint AS count FROM supplier_incoming_inspections WHERE ${where}`);
      return { items: rows.map((row) => this.serialize(row)), total: Number(count[0]?.count ?? 0), page: query.page, pageSize: query.pageSize };
    });
  }

  async detail(actor: AdminActor, id: string, organizationId?: string) {
    const scope = organizationId ?? this.scope(actor);
    return this.prisma.$transaction(async (tx) => {
      await assertAdminAccess(tx, actor, scope, READ_PERMISSION);
      const rows = await tx.$queryRaw<Row[]>`SELECT * FROM supplier_incoming_inspections WHERE id = ${id}::uuid AND owner_organization_id = ${scope}::uuid`;
      if (!rows[0]) fail('SUPPLIER_INCOMING_NOT_FOUND', 404);
      const items = await tx.$queryRaw<Row[]>`SELECT id, item_order, item_name, measured_value, result FROM supplier_incoming_items WHERE inspection_id = ${id}::uuid ORDER BY item_order`;
      const photos = await tx.$queryRaw<Row[]>`SELECT id, file_id, purpose, note, created_at FROM supplier_incoming_photos WHERE inspection_id = ${id}::uuid ORDER BY created_at, id`;
      const links = await tx.$queryRaw<Row[]>`SELECT id, problem_id, conclusion_snapshot, created_at FROM supplier_incoming_problem_links WHERE inspection_id = ${id}::uuid`;
      return { ...this.serialize(rows[0]), items: items.map((item) => ({ id: item.id, order: item.item_order, name: item.item_name, measuredValue: item.measured_value, result: item.result })), photos, problemLinks: links };
    });
  }

  async create(actor: AdminActor, input: CreateIncomingInspectionDto, traceId: string, key?: string) {
    const organizationId = input.organizationId ?? this.scope(actor);
    assertQuantities(input.receivedQuantity, input.sampledQuantity);
    if (input.sourceSystem !== 'MANUAL') fail('SUPPLIER_INCOMING_SOURCE_NOT_ENABLED', 409);
    const materialCode = text(input.materialCode, 100); const incomingBatch = text(input.incomingBatch, 160);
    const items = normalizeItems(input.items ?? []);
    return this.mutations.run({ actor, organizationId, key, traceId, action: 'SUPPLIER_INCOMING_CREATED', payload: { ...input, items }, permission: WRITE_PERMISSION, duplicateCode: 'CONCURRENCY_CONFLICT' }, async (tx) => {
      const profile = await tx.$queryRaw<Row[]>`SELECT id, owner_organization_id, supplier_organization_id, business_code, display_name FROM supplier_business_profiles WHERE id = ${input.profileId}::uuid AND owner_organization_id = ${organizationId}::uuid FOR SHARE`;
      if (!profile[0]) fail('SUPPLIER_PROFILE_NOT_FOUND', 404);
      const id = randomUUID();
      const rows = await tx.$queryRaw<Row[]>`INSERT INTO supplier_incoming_inspections (id, owner_organization_id, profile_id, supplier_organization_id, supplier_business_code, supplier_name, material_code, incoming_batch, received_quantity, sampled_quantity, inspector_id, source_system, source_snapshot) VALUES (${id}::uuid, ${organizationId}::uuid, ${input.profileId}::uuid, ${profile[0].supplier_organization_id}::uuid, ${profile[0].business_code}, ${profile[0].display_name}, ${materialCode}, ${incomingBatch}, ${input.receivedQuantity}, ${input.sampledQuantity}, ${actor.id}::uuid, 'MANUAL', ${JSON.stringify({ source: 'MANUAL' })}::jsonb) RETURNING *`;
      for (const item of items) await tx.$executeRaw`INSERT INTO supplier_incoming_items (id, inspection_id, item_order, item_name, measured_value, result) VALUES (${randomUUID()}::uuid, ${id}::uuid, ${item.order}, ${item.name}, ${item.measuredValue}, ${item.result})`;
      await this.audit.record({ organizationId, actorUserId: actor.id, action: 'SUPPLIER_INCOMING_CREATED', resourceType: 'SupplierIncomingInspection', resourceId: id, outcome: 'SUCCESS', traceId, metadata: { resourceVersion: 1 } }, tx);
      return this.serialize(rows[0]);
    });
  }

  async complete(actor: AdminActor, id: string, input: CompleteIncomingInspectionDto, traceId: string, key?: string) {
    const organizationId = this.scope(actor); positive(input.expectedVersion);
    return this.mutations.run({ actor, organizationId, key, traceId, action: 'SUPPLIER_INCOMING_COMPLETED', payload: { id, ...input }, permission: WRITE_PERMISSION }, async (tx) => {
      const rows = await tx.$queryRaw<Row[]>`UPDATE supplier_incoming_inspections SET conclusion = ${input.conclusion}, status = 'COMPLETED', inspected_at = CURRENT_TIMESTAMP, version = version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ${id}::uuid AND owner_organization_id = ${organizationId}::uuid AND version = ${input.expectedVersion} AND status = 'DRAFT' RETURNING *`;
      if (!rows[0]) fail('CONCURRENCY_CONFLICT', 409);
      await this.audit.record({ organizationId, actorUserId: actor.id, action: 'SUPPLIER_INCOMING_COMPLETED', resourceType: 'SupplierIncomingInspection', resourceId: id, outcome: 'SUCCESS', traceId, metadata: { resourceVersion: rows[0].version } }, tx);
      return this.serialize(rows[0]);
    }, async (tx) => { const found = await tx.$queryRaw<Row[]>`SELECT id FROM supplier_incoming_inspections WHERE id = ${id}::uuid AND owner_organization_id = ${organizationId}::uuid`; if (!found[0]) fail('SUPPLIER_INCOMING_NOT_FOUND', 404); });
  }

  async correct(actor: AdminActor, id: string, input: CorrectIncomingInspectionDto, traceId: string, key?: string) {
    const organizationId = this.scope(actor); positive(input.expectedVersion); const reason = text(input.reason, 2000);
    return this.mutations.run({ actor, organizationId, key, traceId, action: 'SUPPLIER_INCOMING_CORRECTED', payload: { id, ...input }, permission: WRITE_PERMISSION }, async (tx) => {
      const rows = await tx.$queryRaw<Row[]>`UPDATE supplier_incoming_inspections SET conclusion = ${input.conclusion}, status = 'CORRECTED', correction_reason = ${reason}, inspected_at = COALESCE(inspected_at, CURRENT_TIMESTAMP), version = version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ${id}::uuid AND owner_organization_id = ${organizationId}::uuid AND version = ${input.expectedVersion} RETURNING *`;
      if (!rows[0]) fail('CONCURRENCY_CONFLICT', 409);
      await this.audit.record({ organizationId, actorUserId: actor.id, action: 'SUPPLIER_INCOMING_CORRECTED', resourceType: 'SupplierIncomingInspection', resourceId: id, outcome: 'SUCCESS', traceId, metadata: { resourceVersion: rows[0].version, reason } }, tx);
      return this.serialize(rows[0]);
    }, async (tx) => { const found = await tx.$queryRaw<Row[]>`SELECT id FROM supplier_incoming_inspections WHERE id = ${id}::uuid AND owner_organization_id = ${organizationId}::uuid`; if (!found[0]) fail('SUPPLIER_INCOMING_NOT_FOUND', 404); });
  }

  async linkProblem(actor: AdminActor, id: string, input: LinkIncomingProblemDto, traceId: string, key?: string) {
    const organizationId = this.scope(actor); positive(input.expectedVersion);
    return this.mutations.run({ actor, organizationId, key, traceId, action: 'SUPPLIER_INCOMING_PROBLEM_LINKED', payload: { id, ...input }, permission: WRITE_PERMISSION, additionalAccess: [{ organizationId, permission: 'supplier-quality:problems:write' }] }, async (tx) => {
      const inspection = await tx.$queryRaw<Row[]>`SELECT * FROM supplier_incoming_inspections WHERE id = ${id}::uuid AND owner_organization_id = ${organizationId}::uuid FOR UPDATE`;
      if (!inspection[0]) fail('SUPPLIER_INCOMING_NOT_FOUND', 404);
      const existing = await tx.$queryRaw<Row[]>`SELECT * FROM supplier_incoming_problem_links WHERE inspection_id = ${id}::uuid`;
      if (existing[0]) return existing[0];
      if (Number(inspection[0].version) !== input.expectedVersion) fail('CONCURRENCY_CONFLICT', 409);
      if (inspection[0].conclusion !== 'NG' || !['COMPLETED', 'CORRECTED'].includes(inspection[0].status)) fail('SUPPLIER_INCOMING_PROBLEM_REQUIRES_NG', 409);
      const profiles = await tx.$queryRaw<Row[]>`SELECT id FROM supplier_business_profiles WHERE id = ${inspection[0].profile_id}::uuid AND owner_organization_id = ${organizationId}::uuid AND supplier_organization_id = ${inspection[0].supplier_organization_id}::uuid FOR SHARE`;
      if (!profiles[0]) fail('SUPPLIER_PROFILE_NOT_FOUND', 404);
      const problem = await this.supplierProblems.createDraftFromIncoming(tx, actor, {
        profileId: inspection[0].profile_id, title: input.title, materialCode: inspection[0].material_code,
        defectDescription: input.defectDescription, defectQuantity: input.defectQuantity,
        severity: input.severity, responseForm: input.responseForm, replyMode: input.replyMode,
        ...(input.internalResponderId ? { internalResponderId: input.internalResponderId } : {}),
      }, traceId);
      const items = await tx.$queryRaw<Row[]>`SELECT item_order, item_name, measured_value, result FROM supplier_incoming_items WHERE inspection_id = ${id}::uuid ORDER BY item_order`;
      const linkId = randomUUID();
      const snapshot = { inspection: this.serialize(inspection[0]), items: items.map((item) => ({ order: item.item_order, name: item.item_name, measuredValue: item.measured_value, result: item.result })) };
      const rows = await tx.$queryRaw<Row[]>`INSERT INTO supplier_incoming_problem_links (id, owner_organization_id, inspection_id, problem_id, conclusion_snapshot, source_snapshot, created_by_id) VALUES (${linkId}::uuid, ${organizationId}::uuid, ${id}::uuid, ${problem.id}::uuid, ${inspection[0].conclusion}, ${JSON.stringify(snapshot)}::jsonb, ${actor.id}::uuid) RETURNING *`;
      await this.audit.record({ organizationId, actorUserId: actor.id, action: 'SUPPLIER_INCOMING_PROBLEM_LINKED', resourceType: 'SupplierIncomingInspection', resourceId: id, outcome: 'SUCCESS', traceId, metadata: { problemId: problem.id, inspectionVersion: inspection[0].version } }, tx);
      return rows[0];
    });
  }

  async source(actor: AdminActor, id: string) {
    const organizationId = this.scope(actor);
    return this.prisma.$transaction(async (tx) => { await assertAdminAccess(tx, actor, organizationId, READ_PERMISSION); const rows = await tx.$queryRaw<Row[]>`SELECT id, source_system, external_record_key, external_batch_key, observed_at, source_snapshot, version FROM supplier_incoming_inspections WHERE id = ${id}::uuid AND owner_organization_id = ${organizationId}::uuid`; if (!rows[0]) fail('SUPPLIER_INCOMING_NOT_FOUND', 404); return rows[0]; });
  }

  async attachPhoto(actor: AdminActor, id: string, fileId: string, expectedVersion: number, traceId: string, key?: string) {
    const organizationId = this.scope(actor); positive(expectedVersion);
    return this.mutations.run({ actor, organizationId, key, traceId, action: 'SUPPLIER_INCOMING_PHOTO_ATTACHED', payload: { id, fileId, expectedVersion }, permission: WRITE_PERMISSION, isolationLevel: 'ReadCommitted' }, async (tx) => {
      await this.files.assertAttachable(tx, actor, { resourceType: 'supplier-incoming', resourceId: id }, [fileId]);
      const current = await tx.$queryRaw<Row[]>`SELECT version FROM supplier_incoming_inspections WHERE id = ${id}::uuid AND owner_organization_id = ${organizationId}::uuid FOR UPDATE`;
      if (!current[0]) fail('SUPPLIER_INCOMING_NOT_FOUND', 404); if (Number(current[0].version) !== expectedVersion) fail('CONCURRENCY_CONFLICT', 409);
      const rows = await tx.$queryRaw<Row[]>`INSERT INTO supplier_incoming_photos (id, inspection_id, file_id, created_by_id) VALUES (${randomUUID()}::uuid, ${id}::uuid, ${fileId}::uuid, ${actor.id}::uuid) ON CONFLICT (inspection_id, file_id) DO NOTHING RETURNING *`;
      if (!rows[0]) fail('CONCURRENCY_CONFLICT', 409);
      await tx.$executeRaw`UPDATE supplier_incoming_inspections SET version = version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ${id}::uuid AND owner_organization_id = ${organizationId}::uuid AND version = ${expectedVersion}`;
      await this.audit.record({ organizationId, actorUserId: actor.id, action: 'SUPPLIER_INCOMING_PHOTO_ATTACHED', resourceType: 'SupplierIncomingInspection', resourceId: id, outcome: 'SUCCESS', traceId, metadata: { fileId, resourceVersion: expectedVersion + 1 } }, tx);
      return rows[0];
    });
  }
}
