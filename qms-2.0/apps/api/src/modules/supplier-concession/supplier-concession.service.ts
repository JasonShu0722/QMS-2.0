import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../database/prisma.service.js';
import { AdminMutationService, assertAdminAccess, type AdminActor, type AdminTransaction } from '../../common/security/admin-mutation.service.js';
import { AuditLogService } from '../audit-log/audit-log.service.js';
import { SupplierIncomingService } from '../supplier-incoming/supplier-incoming.service.js';
import type { ConcessionQueryDto, CreateConcessionDto, ConcessionVersionDto, DecideConcessionDto } from './supplier-concession.dto.js';
import { CONCESSION_PERMISSIONS, concessionError, requiredText, validateConcessionRequest } from './supplier-concession.rules.js';

type ConcessionRow = {
  id: string; owner_organization_id: string; inspection_id: string; inspection_version: number;
  profile_id: string; supplier_organization_id: string | null; supplier_name: string; material_code: string;
  incoming_batch: string; received_quantity: number; quantity: number; reason: string;
  expires_at: Date; status: string; version: number; requested_by_id: string;
  approved_by_id: string | null; approved_at: Date | null; released_at: Date | null;
  decision_note: string | null; release_note: string | null; created_at: Date;
};

function serialize(row: ConcessionRow) {
  return {
    id: row.id, organizationId: row.owner_organization_id, inspectionId: row.inspection_id,
    inspectionVersion: row.inspection_version, profileId: row.profile_id,
    supplierName: row.supplier_name, materialCode: row.material_code, incomingBatch: row.incoming_batch,
    receivedQuantity: row.received_quantity, quantity: row.quantity, reason: row.reason,
    expiresAt: row.expires_at.toISOString(), status: row.status, version: row.version,
    requestedById: row.requested_by_id, approvedById: row.approved_by_id,
    approvedAt: row.approved_at?.toISOString() ?? null, releasedAt: row.released_at?.toISOString() ?? null,
    decisionNote: row.decision_note, releaseNote: row.release_note, createdAt: row.created_at.toISOString(),
  };
}

function capabilities(row: ConcessionRow, actor: AdminActor, granted: string[]) {
  const active = row.expires_at > new Date();
  const canReadInspection = granted.includes('supplier-incoming:inspections:read');
  return {
    canSubmit: active && row.status === 'DRAFT' && row.requested_by_id === actor.id && canReadInspection && granted.includes(CONCESSION_PERMISSIONS.write),
    canWithdraw: ['DRAFT', 'SUBMITTED', 'APPROVED'].includes(row.status) && row.requested_by_id === actor.id && granted.includes(CONCESSION_PERMISSIONS.write),
    canApprove: active && row.status === 'SUBMITTED' && row.requested_by_id !== actor.id && canReadInspection && granted.includes(CONCESSION_PERMISSIONS.approve),
    canRelease: active && row.status === 'APPROVED' && canReadInspection && granted.includes(CONCESSION_PERMISSIONS.release),
  };
}

@Injectable()
export class SupplierConcessionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mutations: AdminMutationService,
    private readonly audit: AuditLogService,
    private readonly incoming: SupplierIncomingService,
  ) {}

  private scope(actor: AdminActor, requested?: string) {
    if (actor.accountType !== 'INTERNAL') concessionError('ORGANIZATION_SCOPE_DENIED', 403);
    return requested ?? actor.scopeOrganizationId ?? actor.organizationId;
  }

  private async record(tx: AdminTransaction, actor: AdminActor, organizationId: string, row: ConcessionRow, eventType: 'CREATED' | 'SUBMITTED' | 'APPROVED' | 'REJECTED' | 'RELEASED' | 'WITHDRAWN', traceId: string, note?: string) {
    await tx.$executeRaw`
      INSERT INTO supplier_concession_events (id, request_id, event_type, request_version, actor_user_id, note)
      VALUES (${randomUUID()}::uuid, ${row.id}::uuid, ${eventType}, ${row.version}, ${actor.id}::uuid, ${note ?? null})`;
    await this.audit.record({ organizationId, actorUserId: actor.id, action: `SUPPLIER_CONCESSION_${eventType}`, resourceType: 'SupplierConcessionRequest', resourceId: row.id, outcome: 'SUCCESS', traceId, metadata: { requestVersion: row.version, inspectionId: row.inspection_id, inspectionVersion: row.inspection_version } }, tx);
  }

  private async get(tx: AdminTransaction, organizationId: string, id: string) {
    const rows = await tx.$queryRaw<ConcessionRow[]>`
      SELECT * FROM supplier_concession_requests
      WHERE id = ${id}::uuid AND owner_organization_id = ${organizationId}::uuid FOR UPDATE`;
    if (!rows[0]) concessionError('SUPPLIER_CONCESSION_NOT_FOUND', 404);
    return rows[0];
  }

  private async assertSource(tx: AdminTransaction, organizationId: string, row: Pick<ConcessionRow, 'inspection_id' | 'inspection_version'>) {
    const source = await this.incoming.concessionSource(tx, organizationId, row.inspection_id);
    if (!source || source.conclusion !== 'NG' || !['COMPLETED', 'CORRECTED'].includes(source.status) || source.version !== row.inspection_version) concessionError('SUPPLIER_CONCESSION_SOURCE_CHANGED', 409);
    return source;
  }

  async list(actor: AdminActor, query: ConcessionQueryDto) {
    const organizationId = this.scope(actor, query.organizationId);
    return this.prisma.$transaction(async (tx) => {
      const granted = await assertAdminAccess(tx, actor, organizationId, CONCESSION_PERMISSIONS.read);
      const filters = [Prisma.sql`owner_organization_id = ${organizationId}::uuid`];
      if (query.inspectionId) filters.push(Prisma.sql`inspection_id = ${query.inspectionId}::uuid`);
      if (query.status) filters.push(Prisma.sql`status = ${query.status}`);
      const where = Prisma.join(filters, ' AND ');
      const rows = await tx.$queryRaw<ConcessionRow[]>(Prisma.sql`SELECT * FROM supplier_concession_requests WHERE ${where} ORDER BY created_at DESC, id DESC LIMIT ${query.pageSize} OFFSET ${(query.page - 1) * query.pageSize}`);
      const counts = await tx.$queryRaw<{ count: bigint }[]>(Prisma.sql`SELECT count(*)::bigint AS count FROM supplier_concession_requests WHERE ${where}`);
      return { items: rows.map((row) => ({ ...serialize(row), ...capabilities(row, actor, granted) })), total: Number(counts[0]?.count ?? 0), page: query.page, pageSize: query.pageSize, canCreate: granted.includes(CONCESSION_PERMISSIONS.write) && granted.includes('supplier-incoming:inspections:read') };
    });
  }

  async detail(actor: AdminActor, id: string, requestedOrganizationId?: string) {
    const organizationId = this.scope(actor, requestedOrganizationId);
    return this.prisma.$transaction(async (tx) => {
      const granted = await assertAdminAccess(tx, actor, organizationId, CONCESSION_PERMISSIONS.read);
      const rows = await tx.$queryRaw<ConcessionRow[]>`SELECT * FROM supplier_concession_requests WHERE id = ${id}::uuid AND owner_organization_id = ${organizationId}::uuid`;
      if (!rows[0]) concessionError('SUPPLIER_CONCESSION_NOT_FOUND', 404);
      const events = await tx.$queryRaw<{ event_type: string; request_version: number; actor_user_id: string; note: string | null; created_at: Date }[]>`
        SELECT event_type, request_version, actor_user_id, note, created_at FROM supplier_concession_events
        WHERE request_id = ${id}::uuid ORDER BY request_version`;
      return { ...serialize(rows[0]), ...capabilities(rows[0], actor, granted), events: events.map((event) => ({ eventType: event.event_type, requestVersion: event.request_version, actorUserId: event.actor_user_id, note: event.note, createdAt: event.created_at.toISOString() })) };
    });
  }

  create(actor: AdminActor, input: CreateConcessionDto, traceId: string, key?: string) {
    const organizationId = this.scope(actor, input.organizationId);
    return this.mutations.run({ actor, organizationId, key, traceId, action: 'SUPPLIER_CONCESSION_CREATED', payload: { ...input, expiresAt: input.expiresAt?.toISOString() }, permission: CONCESSION_PERMISSIONS.write, additionalAccess: [{ organizationId, permission: 'supplier-incoming:inspections:read' }] }, async (tx) => {
      const source = await this.incoming.concessionSource(tx, organizationId, input.inspectionId);
      if (!source) concessionError('SUPPLIER_INCOMING_NOT_FOUND', 404);
      if (source.conclusion !== 'NG' || !['COMPLETED', 'CORRECTED'].includes(source.status)) concessionError('SUPPLIER_CONCESSION_REQUIRES_NG', 409);
      const validated = validateConcessionRequest({ quantity: input.quantity, receivedQuantity: source.received_quantity, reason: input.reason, expiresAt: input.expiresAt });
      const id = randomUUID();
      const rows = await tx.$queryRaw<ConcessionRow[]>`
        INSERT INTO supplier_concession_requests (id, owner_organization_id, inspection_id, inspection_version,
          profile_id, supplier_organization_id, supplier_name, material_code, incoming_batch,
          received_quantity, quantity, reason, expires_at, requested_by_id)
        VALUES (${id}::uuid, ${organizationId}::uuid, ${source.id}::uuid, ${source.version},
          ${source.profile_id}::uuid, ${source.supplier_organization_id}::uuid, ${source.supplier_name},
          ${source.material_code}, ${source.incoming_batch}, ${source.received_quantity}, ${validated.quantity},
          ${validated.reason}, ${input.expiresAt}, ${actor.id}::uuid)
        ON CONFLICT DO NOTHING RETURNING *`;
      if (!rows[0]) concessionError('CONCURRENCY_CONFLICT', 409);
      await this.record(tx, actor, organizationId, rows[0], 'CREATED', traceId, validated.reason);
      return serialize(rows[0]);
    });
  }

  submit(actor: AdminActor, id: string, input: ConcessionVersionDto, traceId: string, key?: string) {
    const organizationId = this.scope(actor);
    return this.mutations.run({ actor, organizationId, key, traceId, action: 'SUPPLIER_CONCESSION_SUBMITTED', payload: { id, ...input }, permission: CONCESSION_PERMISSIONS.write, additionalAccess: [{ organizationId, permission: 'supplier-incoming:inspections:read' }] }, async (tx) => {
      const row = await this.get(tx, organizationId, id);
      if (row.status !== 'DRAFT' || row.version !== input.expectedVersion) concessionError('CONCURRENCY_CONFLICT', 409);
      if (row.requested_by_id !== actor.id) concessionError('FEATURE_PERMISSION_DENIED', 403);
      if (row.expires_at <= new Date()) concessionError('SUPPLIER_CONCESSION_EXPIRED', 409);
      await this.assertSource(tx, organizationId, row);
      const updated = await tx.$queryRaw<ConcessionRow[]>`
        UPDATE supplier_concession_requests SET status = 'SUBMITTED', submitted_at = CURRENT_TIMESTAMP,
          version = version + 1, updated_at = CURRENT_TIMESTAMP
        WHERE id = ${id}::uuid AND version = ${input.expectedVersion} AND status = 'DRAFT' RETURNING *`;
      if (!updated[0]) concessionError('CONCURRENCY_CONFLICT', 409);
      await this.record(tx, actor, organizationId, updated[0], 'SUBMITTED', traceId);
      return serialize(updated[0]);
    });
  }

  withdraw(actor: AdminActor, id: string, input: ConcessionVersionDto, traceId: string, key?: string) {
    const organizationId = this.scope(actor);
    return this.mutations.run({ actor, organizationId, key, traceId, action: 'SUPPLIER_CONCESSION_WITHDRAWN', payload: { id, ...input }, permission: CONCESSION_PERMISSIONS.write }, async (tx) => {
      const row = await this.get(tx, organizationId, id);
      if (!['DRAFT', 'SUBMITTED', 'APPROVED'].includes(row.status) || row.version !== input.expectedVersion) concessionError('CONCURRENCY_CONFLICT', 409);
      if (row.requested_by_id !== actor.id) concessionError('FEATURE_PERMISSION_DENIED', 403);
      const updated = await tx.$queryRaw<ConcessionRow[]>`
        UPDATE supplier_concession_requests SET status = 'WITHDRAWN', version = version + 1,
          updated_at = CURRENT_TIMESTAMP WHERE id = ${id}::uuid AND version = ${input.expectedVersion}
          AND status IN ('DRAFT', 'SUBMITTED', 'APPROVED') RETURNING *`;
      if (!updated[0]) concessionError('CONCURRENCY_CONFLICT', 409);
      await this.record(tx, actor, organizationId, updated[0], 'WITHDRAWN', traceId);
      return serialize(updated[0]);
    });
  }

  decide(actor: AdminActor, id: string, input: DecideConcessionDto, approved: boolean, traceId: string, key?: string) {
    const organizationId = this.scope(actor);
    const event = approved ? 'APPROVED' : 'REJECTED';
    const note = requiredText(input.note, 2000);
    return this.mutations.run({ actor, organizationId, key, traceId, action: `SUPPLIER_CONCESSION_${event}`, payload: { id, ...input }, permission: CONCESSION_PERMISSIONS.approve, additionalAccess: [{ organizationId, permission: 'supplier-incoming:inspections:read' }] }, async (tx) => {
      const row = await this.get(tx, organizationId, id);
      if (row.status !== 'SUBMITTED' || row.version !== input.expectedVersion) concessionError('CONCURRENCY_CONFLICT', 409);
      if (row.requested_by_id === actor.id) concessionError('FEATURE_PERMISSION_DENIED', 403);
      if (approved) {
        if (row.expires_at <= new Date()) concessionError('SUPPLIER_CONCESSION_EXPIRED', 409);
        await this.assertSource(tx, organizationId, row);
      }
      const updated = await tx.$queryRaw<ConcessionRow[]>`
        UPDATE supplier_concession_requests SET status = ${event}, approved_by_id = ${approved ? actor.id : null}::uuid,
          approved_at = ${approved ? new Date() : null}, decision_note = ${note},
          version = version + 1, updated_at = CURRENT_TIMESTAMP
        WHERE id = ${id}::uuid AND version = ${input.expectedVersion} AND status = 'SUBMITTED'
          AND (${!approved} OR expires_at > CURRENT_TIMESTAMP) RETURNING *`;
      if (!updated[0]) concessionError('CONCURRENCY_CONFLICT', 409);
      await this.record(tx, actor, organizationId, updated[0], event, traceId, note);
      return serialize(updated[0]);
    });
  }

  release(actor: AdminActor, id: string, input: DecideConcessionDto, traceId: string, key?: string) {
    const organizationId = this.scope(actor);
    const note = requiredText(input.note, 2000);
    return this.mutations.run({ actor, organizationId, key, traceId, action: 'SUPPLIER_CONCESSION_RELEASED', payload: { id, ...input }, permission: CONCESSION_PERMISSIONS.release, additionalAccess: [{ organizationId, permission: 'supplier-incoming:inspections:read' }] }, async (tx) => {
      const row = await this.get(tx, organizationId, id);
      if (row.status !== 'APPROVED' || row.version !== input.expectedVersion) concessionError('CONCURRENCY_CONFLICT', 409);
      if (row.expires_at <= new Date()) concessionError('SUPPLIER_CONCESSION_EXPIRED', 409);
      await this.assertSource(tx, organizationId, row);
      const updated = await tx.$queryRaw<ConcessionRow[]>`
        UPDATE supplier_concession_requests SET status = 'RELEASED', released_by_id = ${actor.id}::uuid,
          released_at = CURRENT_TIMESTAMP, release_note = ${note}, version = version + 1,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ${id}::uuid AND version = ${input.expectedVersion} AND status = 'APPROVED'
          AND expires_at > CURRENT_TIMESTAMP RETURNING *`;
      if (!updated[0]) concessionError('CONCURRENCY_CONFLICT', 409);
      await this.record(tx, actor, organizationId, updated[0], 'RELEASED', traceId, note);
      return serialize(updated[0]);
    });
  }
}
