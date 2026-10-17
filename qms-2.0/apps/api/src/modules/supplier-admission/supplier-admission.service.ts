import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Prisma } from '../../generated/prisma/client.js';
import { SupplierQualityService } from '../supplier-quality/supplier-quality.service.js';
import { PrismaService } from '../../database/prisma.service.js';
import { AdminMutationService, adminError, assertAdminAccess, type AdminActor, type AdminTransaction } from '../../common/security/admin-mutation.service.js';
import { AuditLogService } from '../audit-log/audit-log.service.js';
import { FileLifecycleService } from '../file-management/file-lifecycle.service.js';
import type { CreateSupplierAdmissionDocumentDto, ReviewSupplierAdmissionDocumentDto, SubmitSupplierAdmissionDocumentDto, SupplierAdmissionQueryDto } from './supplier-admission.dto.js';

type DocumentRow = {
  id: string; owner_organization_id: string; supplier_organization_id: string; profile_id: string;
  document_type: string; title: string; status: string; version: number; file_id: string | null;
  review_note: string | null; created_by_id: string; reviewed_by_id: string | null;
  created_at: Date; updated_at: Date;
};
type EventRow = { event_type: string; document_version: number; actor_user_id: string; file_id: string | null; note: string | null; created_at: Date };

function documentDto(row: DocumentRow) {
  return {
    id: row.id, profileId: row.profile_id, ownerOrganizationId: row.owner_organization_id,
    supplierOrganizationId: row.supplier_organization_id, documentType: row.document_type,
    title: row.title, status: row.status, version: row.version, fileId: row.file_id,
    reviewNote: row.review_note, createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString(),
  };
}

@Injectable()
export class SupplierAdmissionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mutations: AdminMutationService,
    private readonly audit: AuditLogService,
    private readonly files: FileLifecycleService,
    private readonly suppliers: SupplierQualityService,
  ) {}

  private scope(actor: AdminActor, requested?: string) {
    if (actor.accountType === 'SUPPLIER') {
      if (requested && requested !== actor.organizationId) adminError('ORGANIZATION_SCOPE_DENIED', 403);
      return actor.organizationId;
    }
    return requested ?? actor.scopeOrganizationId ?? actor.organizationId;
  }

  private permission(actor: AdminActor, write: boolean) {
    return actor.accountType === 'SUPPLIER'
      ? write ? 'supplier-admission:submissions:write' : 'supplier-admission:submissions:read'
      : write ? 'supplier-admission:documents:review' : 'supplier-admission:documents:read';
  }

  private column(actor: AdminActor) {
    return actor.accountType === 'SUPPLIER' ? Prisma.raw('supplier_organization_id') : Prisma.raw('owner_organization_id');
  }

  private async get(tx: AdminTransaction, actor: AdminActor, organizationId: string, id: string) {
    const column = this.column(actor);
    const rows = await tx.$queryRaw<DocumentRow[]>(Prisma.sql`
      SELECT * FROM supplier_admission_documents WHERE id = ${id}::uuid AND ${column} = ${organizationId}::uuid FOR UPDATE`);
    if (!rows[0]) adminError('SUPPLIER_RECORD_NOT_FOUND', 404);
    return rows[0];
  }

  private async record(tx: AdminTransaction, actor: AdminActor, row: DocumentRow, eventType: 'CREATED' | 'SUBMITTED' | 'NEEDS_CHANGES' | 'ACCEPTED', traceId: string, note?: string) {
    await tx.$executeRaw`
      INSERT INTO supplier_admission_document_events (id, document_id, event_type, document_version, actor_user_id, file_id, note)
      VALUES (${randomUUID()}::uuid, ${row.id}::uuid, ${eventType}, ${row.version}, ${actor.id}::uuid, ${row.file_id}::uuid, ${note ?? null})`;
    await this.audit.record({ organizationId: row.owner_organization_id, actorUserId: actor.id,
      action: `SUPPLIER_ADMISSION_${eventType}`, resourceType: 'SupplierAdmissionDocument', resourceId: row.id,
      outcome: 'SUCCESS', traceId, metadata: { documentVersion: row.version, profileId: row.profile_id, supplierOrganizationId: row.supplier_organization_id } }, tx);
  }

  async list(actor: AdminActor, query: SupplierAdmissionQueryDto) {
    const organizationId = this.scope(actor, query.organizationId);
    return this.prisma.$transaction(async (tx) => {
      await assertAdminAccess(tx, actor, organizationId, this.permission(actor, false));
      const filters = [Prisma.sql`${this.column(actor)} = ${organizationId}::uuid`];
      if (query.profileId) filters.push(Prisma.sql`profile_id = ${query.profileId}::uuid`);
      if (query.status) filters.push(Prisma.sql`status = ${query.status}`);
      const where = Prisma.join(filters, ' AND ');
      const rows = await tx.$queryRaw<DocumentRow[]>(Prisma.sql`SELECT * FROM supplier_admission_documents WHERE ${where} ORDER BY created_at DESC, id DESC LIMIT ${query.pageSize} OFFSET ${(query.page - 1) * query.pageSize}`);
      const counts = await tx.$queryRaw<{ count: bigint }[]>(Prisma.sql`SELECT count(*)::bigint AS count FROM supplier_admission_documents WHERE ${where}`);
      return { items: rows.map(documentDto), total: Number(counts[0]?.count ?? 0), page: query.page, pageSize: query.pageSize };
    });
  }

  async detail(actor: AdminActor, id: string, requestedOrganizationId?: string) {
    const organizationId = this.scope(actor, requestedOrganizationId);
    return this.prisma.$transaction(async (tx) => {
      await assertAdminAccess(tx, actor, organizationId, this.permission(actor, false));
      const row = await this.get(tx, actor, organizationId, id);
      const events = await tx.$queryRaw<EventRow[]>`
        SELECT event_type, document_version, actor_user_id, file_id, note, created_at
        FROM supplier_admission_document_events WHERE document_id = ${id}::uuid ORDER BY document_version`;
      return { ...documentDto(row), events: events.map((event) => ({ eventType: event.event_type, documentVersion: event.document_version,
        actorUserId: event.actor_user_id, fileId: event.file_id, note: event.note, createdAt: event.created_at.toISOString() })) };
    });
  }

  create(actor: AdminActor, input: CreateSupplierAdmissionDocumentDto, traceId: string, key?: string) {
    if (actor.accountType !== 'SUPPLIER') adminError('FEATURE_PERMISSION_DENIED', 403);
    const organizationId = actor.organizationId;
    const title = input.title.trim();
    if (!title) adminError('SUPPLIER_INPUT_INVALID', 400);
    return this.mutations.run({ actor, organizationId, key, traceId, action: 'SUPPLIER_ADMISSION_CREATED', payload: input,
      permission: this.permission(actor, true) }, async (tx) => {
      const profile = await this.suppliers.pcnSupplierProfile(tx, organizationId, input.profileId);
      const rows = await tx.$queryRaw<DocumentRow[]>`
        INSERT INTO supplier_admission_documents (id, owner_organization_id, supplier_organization_id,
          profile_id, document_type, title, created_by_id)
        VALUES (${randomUUID()}::uuid, ${profile.ownerOrganizationId}::uuid, ${organizationId}::uuid,
          ${profile.id}::uuid, ${input.documentType}, ${title}, ${actor.id}::uuid) RETURNING *`;
      const row = rows[0]!;
      await this.record(tx, actor, row, 'CREATED', traceId);
      return documentDto(row);
    });
  }

  submit(actor: AdminActor, id: string, input: SubmitSupplierAdmissionDocumentDto, traceId: string, key?: string) {
    if (actor.accountType !== 'SUPPLIER') adminError('FEATURE_PERMISSION_DENIED', 403);
    const organizationId = actor.organizationId;
    return this.mutations.run({ actor, organizationId, key, traceId, action: 'SUPPLIER_ADMISSION_SUBMITTED', payload: { id, ...input },
      permission: this.permission(actor, true), isolationLevel: 'ReadCommitted' }, async (tx) => {
      const row = await this.get(tx, actor, organizationId, id);
      if (row.version !== input.expectedVersion || !['DRAFT', 'NEEDS_CHANGES'].includes(row.status)) adminError('CONCURRENCY_CONFLICT', 409);
      await this.files.assertAttachable(tx, actor, { resourceType: 'supplier-admission', resourceId: id }, [input.fileId]);
      const updated = await tx.$queryRaw<DocumentRow[]>`
        UPDATE supplier_admission_documents SET status = 'SUBMITTED', file_id = ${input.fileId}::uuid,
          submitted_at = CURRENT_TIMESTAMP, review_note = NULL, reviewed_by_id = NULL, reviewed_at = NULL,
          version = version + 1, updated_at = CURRENT_TIMESTAMP
        WHERE id = ${id}::uuid AND version = ${input.expectedVersion} AND status IN ('DRAFT', 'NEEDS_CHANGES') RETURNING *`;
      if (!updated[0]) adminError('CONCURRENCY_CONFLICT', 409);
      await this.record(tx, actor, updated[0], 'SUBMITTED', traceId);
      return documentDto(updated[0]);
    });
  }

  review(actor: AdminActor, id: string, input: ReviewSupplierAdmissionDocumentDto, traceId: string, key?: string) {
    if (actor.accountType !== 'INTERNAL') adminError('FEATURE_PERMISSION_DENIED', 403);
    const organizationId = this.scope(actor);
    const note = input.note.trim();
    if (!note) adminError('SUPPLIER_INPUT_INVALID', 400);
    return this.mutations.run({ actor, organizationId, key, traceId, action: `SUPPLIER_ADMISSION_${input.decision}`,
      payload: { id, ...input }, permission: this.permission(actor, true) }, async (tx) => {
      const row = await this.get(tx, actor, organizationId, id);
      if (row.status !== 'SUBMITTED' || row.version !== input.expectedVersion) adminError('CONCURRENCY_CONFLICT', 409);
      const updated = await tx.$queryRaw<DocumentRow[]>`
        UPDATE supplier_admission_documents SET status = ${input.decision}, review_note = ${note},
          reviewed_by_id = ${actor.id}::uuid, reviewed_at = CURRENT_TIMESTAMP,
          version = version + 1, updated_at = CURRENT_TIMESTAMP
        WHERE id = ${id}::uuid AND version = ${input.expectedVersion} AND status = 'SUBMITTED' RETURNING *`;
      if (!updated[0]) adminError('CONCURRENCY_CONFLICT', 409);
      await this.record(tx, actor, updated[0], input.decision, traceId, note);
      return documentDto(updated[0]);
    });
  }
}
