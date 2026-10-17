import { HttpException, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../database/prisma.service.js';
import { AdminMutationService, assertAdminAccess, type AdminActor } from '../../common/security/admin-mutation.service.js';
import { AuditLogService } from '../audit-log/audit-log.service.js';
import { SupplierIncomingService } from '../supplier-incoming/supplier-incoming.service.js';
import { SupplierQualityService } from '../supplier-quality/supplier-quality.service.js';
import type { CreateSupplierPerformanceAppealDto, CreateSupplierPerformanceCardDto, PublishSupplierPerformanceCardDto, SupplierPerformanceAppealTransitionDto, SupplierPerformanceQueryDto } from './supplier-performance.dto.js';
import { monthRange, scoreCard } from './supplier-performance.rules.js';

type CardRow = Record<string, unknown>;
const READ_PERMISSION = 'supplier-performance:cards:read';
const WRITE_PERMISSION = 'supplier-performance:cards:write';
const PUBLISH_PERMISSION = 'supplier-performance:cards:publish';
const APPEAL_READ_PERMISSION = 'supplier-performance:appeals:read';
const APPEAL_WRITE_PERMISSION = 'supplier-performance:appeals:write';
const APPEAL_REVIEW_PERMISSION = 'supplier-performance:appeals:review';
const PORTAL_CARD_READ_PERMISSION = 'supplier-performance:portal:cards:read';
const PORTAL_APPEAL_READ_PERMISSION = 'supplier-performance:portal:appeals:read';
const PORTAL_APPEAL_WRITE_PERMISSION = 'supplier-performance:portal:appeals:write';

function reject(code: string, status: number): never {
  throw new HttpException({ code, message: code }, status);
}

function serialize(row: CardRow) {
  return {
    id: String(row.id), organizationId: String(row.owner_organization_id), profileId: String(row.profile_id),
    supplierOrganizationId: row.supplier_organization_id === null ? null : String(row.supplier_organization_id), supplierName: String(row.supplier_name),
    month: new Date(String(row.score_month)).toISOString().slice(0, 7), inspectionCount: Number(row.inspection_count),
    passCount: Number(row.pass_count), incomingScore: Number(row.incoming_score), cooperationScore: Number(row.cooperation_score),
    incomingWeight: Number(row.incoming_weight), cooperationWeight: Number(row.cooperation_weight),
    cooperationNote: String(row.cooperation_note), totalScore: Number(row.total_score),
    sourceInspections: row.source_inspections as { id: string; version: number; conclusion: string }[],
    status: String(row.status), version: Number(row.version),
    publishedAt: row.published_at ? new Date(String(row.published_at)).toISOString() : null,
    createdAt: new Date(String(row.created_at)).toISOString(),
  };
}

function serializeAppeal(row: CardRow) {
  return {
    id: String(row.id),
    cardId: String(row.card_id),
    supplierOrganizationId: String(row.supplier_organization_id),
    status: String(row.status),
    reason: String(row.reason),
    decisionNote: row.decision_note ? String(row.decision_note) : null,
    version: Number(row.version),
    createdAt: new Date(String(row.created_at)).toISOString(),
  };
}

@Injectable()
export class SupplierPerformanceService {
  constructor(
    private readonly prisma: PrismaService, private readonly mutations: AdminMutationService,
    private readonly audit: AuditLogService, private readonly incoming: SupplierIncomingService,
    private readonly suppliers: SupplierQualityService,
  ) {}

  private scope(actor: AdminActor, requested?: string) {
    if (actor.accountType !== 'INTERNAL') reject('ORGANIZATION_SCOPE_DENIED', 403);
    return requested ?? actor.scopeOrganizationId ?? actor.organizationId;
  }

  async list(actor: AdminActor, query: SupplierPerformanceQueryDto) {
    const organizationId = this.scope(actor, query.organizationId);
    return this.prisma.$transaction(async (transaction) => {
      await assertAdminAccess(transaction, actor, organizationId, READ_PERMISSION);
      const filters = [Prisma.sql`owner_organization_id = ${organizationId}::uuid`];
      if (query.profileId) filters.push(Prisma.sql`profile_id = ${query.profileId}::uuid`);
      if (query.month) filters.push(Prisma.sql`score_month = ${monthRange(query.month).start}::date`);
      const where = Prisma.join(filters, ' AND ');
      const [rows, counts] = await Promise.all([
        transaction.$queryRaw<CardRow[]>(Prisma.sql`SELECT * FROM supplier_performance_cards WHERE ${where} ORDER BY score_month DESC, id DESC LIMIT ${query.pageSize} OFFSET ${(query.page - 1) * query.pageSize}`),
        transaction.$queryRaw<{ count: bigint }[]>(Prisma.sql`SELECT count(*)::bigint AS count FROM supplier_performance_cards WHERE ${where}`),
      ]);
      return { items: rows.map(serialize), total: Number(counts[0]?.count ?? 0) };
    });
  }

  async listPortal(actor: AdminActor, query: SupplierPerformanceQueryDto) {
    if (actor.accountType !== 'SUPPLIER') reject('ORGANIZATION_SCOPE_DENIED', 403);
    const organizationId = actor.organizationId;
    if (query.organizationId && query.organizationId !== organizationId) reject('ORGANIZATION_SCOPE_DENIED', 403);
    return this.prisma.$transaction(async (transaction) => {
      await assertAdminAccess(transaction, actor, organizationId, PORTAL_CARD_READ_PERMISSION);
      const filters = [Prisma.sql`supplier_organization_id = ${organizationId}::uuid`, Prisma.sql`status = 'PUBLISHED'`];
      if (query.profileId) filters.push(Prisma.sql`profile_id = ${query.profileId}::uuid`);
      if (query.month) filters.push(Prisma.sql`score_month = ${monthRange(query.month).start}::date`);
      const where = Prisma.join(filters, ' AND ');
      const [rows, counts] = await Promise.all([
        transaction.$queryRaw<CardRow[]>(Prisma.sql`SELECT * FROM supplier_performance_cards WHERE ${where} ORDER BY score_month DESC, id DESC LIMIT ${query.pageSize} OFFSET ${(query.page - 1) * query.pageSize}`),
        transaction.$queryRaw<{ count: bigint }[]>(Prisma.sql`SELECT count(*)::bigint AS count FROM supplier_performance_cards WHERE ${where}`),
      ]);
      return { items: rows.map(serialize), total: Number(counts[0]?.count ?? 0) };
    });
  }

  async listAppeals(actor: AdminActor, portalOnly = false) {
    if (actor.accountType !== (portalOnly ? 'SUPPLIER' : 'INTERNAL')) reject('ORGANIZATION_SCOPE_DENIED', 403);
    const portal = actor.accountType === 'SUPPLIER';
    const organizationId = portal ? actor.organizationId : this.scope(actor);
    return this.prisma.$transaction(async (transaction) => {
      await assertAdminAccess(transaction, actor, organizationId, portal ? PORTAL_APPEAL_READ_PERMISSION : APPEAL_READ_PERMISSION);
      const where = portal
        ? Prisma.sql`appeal.supplier_organization_id = ${organizationId}::uuid AND card.status = 'PUBLISHED'`
        : Prisma.sql`appeal.owner_organization_id = ${organizationId}::uuid`;
      const [rows, counts] = await Promise.all([
        transaction.$queryRaw<CardRow[]>(Prisma.sql`SELECT appeal.* FROM supplier_performance_appeals appeal JOIN supplier_performance_cards card ON card.owner_organization_id = appeal.owner_organization_id AND card.id = appeal.card_id WHERE ${where} ORDER BY appeal.created_at DESC, appeal.id DESC`),
        transaction.$queryRaw<{ count: bigint }[]>(Prisma.sql`SELECT count(*)::bigint AS count FROM supplier_performance_appeals appeal JOIN supplier_performance_cards card ON card.owner_organization_id = appeal.owner_organization_id AND card.id = appeal.card_id WHERE ${where}`),
      ]);
      return { items: rows.map(serializeAppeal), total: Number(counts[0]?.count ?? 0) };
    });
  }

  async createAppeal(actor: AdminActor, input: CreateSupplierPerformanceAppealDto, traceId: string, key?: string, portalOnly = false) {
    if (actor.accountType !== (portalOnly ? 'SUPPLIER' : 'INTERNAL')) reject('ORGANIZATION_SCOPE_DENIED', 403);
    const portal = actor.accountType === 'SUPPLIER';
    const organizationId = portal ? actor.organizationId : this.scope(actor);
    const reason = input.reason.trim();
    if (!reason) reject('SUPPLIER_PERFORMANCE_APPEAL_INVALID', 400);
    return this.mutations.run({
      actor, organizationId, key, traceId, action: 'SUPPLIER_PERFORMANCE_APPEAL_CREATED',
      payload: { cardId: input.cardId, reason }, permission: portal ? PORTAL_APPEAL_WRITE_PERMISSION : APPEAL_WRITE_PERMISSION,
    }, async (transaction) => {
      const scope = portal
        ? Prisma.sql`supplier_organization_id = ${organizationId}::uuid`
        : Prisma.sql`owner_organization_id = ${organizationId}::uuid`;
      const cards = await transaction.$queryRaw<CardRow[]>(Prisma.sql`SELECT id, owner_organization_id, supplier_organization_id FROM supplier_performance_cards WHERE id = ${input.cardId}::uuid AND ${scope} AND status = 'PUBLISHED'`);
      if (!cards[0]) reject('SUPPLIER_PERFORMANCE_CARD_NOT_FOUND', 404);
      const ownerOrganizationId = String(cards[0].owner_organization_id);
      const id = randomUUID();
      const rows = await transaction.$queryRaw<CardRow[]>(Prisma.sql`
        INSERT INTO supplier_performance_appeals (id, owner_organization_id, card_id, supplier_organization_id, reason, created_by_id)
        VALUES (${id}::uuid, ${ownerOrganizationId}::uuid, ${input.cardId}::uuid, ${cards[0]!.supplier_organization_id}::uuid, ${reason}, ${actor.id}::uuid)
        RETURNING *`);
      await this.audit.record({
        organizationId: ownerOrganizationId, actorUserId: actor.id, action: 'SUPPLIER_PERFORMANCE_APPEAL_CREATED',
        resourceType: 'SupplierPerformanceAppeal', resourceId: id, outcome: 'SUCCESS', traceId,
        metadata: { cardId: input.cardId },
      }, transaction);
      return serializeAppeal(rows[0]!);
    });
  }

  async transitionAppeal(
    actor: AdminActor,
    id: string,
    input: SupplierPerformanceAppealTransitionDto,
    target: 'SUBMITTED' | 'ACCEPTED' | 'REJECTED',
    traceId: string,
    key?: string,
    portalOnly = false,
  ) {
    if (actor.accountType !== (portalOnly ? 'SUPPLIER' : 'INTERNAL')) reject('ORGANIZATION_SCOPE_DENIED', 403);
    const portal = actor.accountType === 'SUPPLIER';
    if (portal && target !== 'SUBMITTED') reject('FEATURE_PERMISSION_DENIED', 403);
    const organizationId = portal ? actor.organizationId : this.scope(actor);
    const permission = portal ? PORTAL_APPEAL_WRITE_PERMISSION : target === 'SUBMITTED' ? APPEAL_WRITE_PERMISSION : APPEAL_REVIEW_PERMISSION;
    const expectedStatus = target === 'SUBMITTED' ? 'DRAFT' : 'SUBMITTED';
    const note = input.note?.trim() || null;
    return this.mutations.run({
      actor, organizationId, key, traceId, action: `SUPPLIER_PERFORMANCE_APPEAL_${target}`,
      payload: { id, target, expectedVersion: input.expectedVersion, note }, permission,
    }, async (transaction) => {
      const scope = portal
        ? Prisma.sql`supplier_organization_id = ${organizationId}::uuid`
        : Prisma.sql`owner_organization_id = ${organizationId}::uuid`;
      const rows = await transaction.$queryRaw<CardRow[]>(Prisma.sql`
        UPDATE supplier_performance_appeals
        SET status = ${target}, version = version + 1,
            decision_note = CASE WHEN ${target} = 'SUBMITTED' THEN decision_note ELSE ${note} END,
            decided_by_id = CASE WHEN ${target} = 'SUBMITTED' THEN decided_by_id ELSE ${actor.id}::uuid END,
            decided_at = CASE WHEN ${target} = 'SUBMITTED' THEN decided_at ELSE CURRENT_TIMESTAMP END,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ${id}::uuid AND ${scope}
          AND status = ${expectedStatus} AND version = ${input.expectedVersion}
        RETURNING *`);
      if (!rows[0]) reject('SUPPLIER_PERFORMANCE_APPEAL_CONCURRENCY_CONFLICT', 409);
      await this.audit.record({
        organizationId: String(rows[0].owner_organization_id), actorUserId: actor.id, action: `SUPPLIER_PERFORMANCE_APPEAL_${target}`,
        resourceType: 'SupplierPerformanceAppeal', resourceId: id, outcome: 'SUCCESS', traceId,
        metadata: { target, version: Number(rows[0]!.version) },
      }, transaction);
      return serializeAppeal(rows[0]!);
    });
  }

  create(actor: AdminActor, input: CreateSupplierPerformanceCardDto, traceId: string, key?: string) {
    const organizationId = this.scope(actor, input.organizationId);
    const period = monthRange(input.month);
    if (!input.cooperationNote?.trim() || input.cooperationNote.trim().length > 2000) reject('SUPPLIER_PERFORMANCE_INPUT_INVALID', 400);
    return this.mutations.run({
      actor, organizationId, key, traceId, action: 'SUPPLIER_PERFORMANCE_CARD_CREATED', payload: input,
      permission: WRITE_PERMISSION,
      additionalAccess: [
        { organizationId, permission: 'supplier-quality:profiles:read' },
        { organizationId, permission: 'supplier-incoming:inspections:read' },
      ],
    }, async (transaction) => {
      const profile = await this.suppliers.performanceProfile(transaction, organizationId, input.profileId);
      const sources = await this.incoming.performanceSources(transaction, organizationId, input.profileId, period.start, period.end);
      const inspectionCount = sources.length;
      const passCount = sources.filter((source) => source.conclusion === 'PASS').length;
      const scores = scoreCard({ inspectionCount, passCount, cooperationScore: input.cooperationScore, incomingWeight: input.incomingWeight, cooperationWeight: input.cooperationWeight });
      const id = randomUUID();
      const rows = await transaction.$queryRaw<CardRow[]>`
        INSERT INTO supplier_performance_cards (
          id, owner_organization_id, profile_id, supplier_organization_id, supplier_name, score_month,
          inspection_count, pass_count, incoming_score, cooperation_score, incoming_weight, cooperation_weight,
          cooperation_note, total_score, source_inspections, created_by_id
        ) VALUES (
          ${id}::uuid, ${organizationId}::uuid, ${profile.id}::uuid, ${profile.supplierOrganizationId}::uuid, ${profile.displayName}, ${period.start}::date,
          ${inspectionCount}, ${passCount}, ${scores.incomingScore}, ${input.cooperationScore}, ${input.incomingWeight}, ${input.cooperationWeight},
          ${input.cooperationNote.trim()}, ${scores.totalScore}, ${JSON.stringify(sources)}::jsonb, ${actor.id}::uuid
        ) ON CONFLICT (owner_organization_id, profile_id, score_month) DO NOTHING RETURNING *`;
      if (!rows[0]) reject('CONCURRENCY_CONFLICT', 409);
      await this.audit.record({ organizationId, actorUserId: actor.id, action: 'SUPPLIER_PERFORMANCE_CARD_CREATED', resourceType: 'SupplierPerformanceCard', resourceId: id, outcome: 'SUCCESS', traceId, metadata: { month: input.month, inspectionCount, totalScore: scores.totalScore } }, transaction);
      return serialize(rows[0]);
    });
  }

  publish(actor: AdminActor, id: string, input: PublishSupplierPerformanceCardDto, traceId: string, key?: string) {
    const organizationId = this.scope(actor, input.organizationId);
    return this.mutations.run({
      actor, organizationId, key, traceId, action: 'SUPPLIER_PERFORMANCE_CARD_PUBLISHED',
      payload: { id, expectedVersion: input.expectedVersion, organizationId }, permission: PUBLISH_PERMISSION,
    }, async (transaction) => {
      const current = await transaction.$queryRaw<CardRow[]>(Prisma.sql`
        SELECT profile_id, supplier_organization_id FROM supplier_performance_cards
        WHERE id = ${id}::uuid AND owner_organization_id = ${organizationId}::uuid
          AND status = 'DRAFT' AND version = ${input.expectedVersion} FOR UPDATE`);
      if (!current[0]) reject('SUPPLIER_PERFORMANCE_CARD_CONCURRENCY_CONFLICT', 409);
      const profile = await this.suppliers.collaborationProfile(transaction, organizationId, String(current[0].profile_id));
      if (current[0].supplier_organization_id !== null && current[0].supplier_organization_id !== profile.supplierOrganizationId) {
        reject('SUPPLIER_PERFORMANCE_CARD_CONCURRENCY_CONFLICT', 409);
      }
      const rows = await transaction.$queryRaw<CardRow[]>(Prisma.sql`
        UPDATE supplier_performance_cards
        SET supplier_organization_id = ${profile.supplierOrganizationId}::uuid,
            status = 'PUBLISHED', version = version + 1, published_by_id = ${actor.id}::uuid,
            published_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
        WHERE id = ${id}::uuid AND owner_organization_id = ${organizationId}::uuid
          AND status = 'DRAFT' AND version = ${input.expectedVersion}
        RETURNING *`);
      if (!rows[0]) reject('SUPPLIER_PERFORMANCE_CARD_CONCURRENCY_CONFLICT', 409);
      await this.audit.record({ organizationId, actorUserId: actor.id, action: 'SUPPLIER_PERFORMANCE_CARD_PUBLISHED',
        resourceType: 'SupplierPerformanceCard', resourceId: id, outcome: 'SUCCESS', traceId,
        metadata: { version: Number(rows[0].version), supplierOrganizationId: profile.supplierOrganizationId } }, transaction);
      return serialize(rows[0]);
    });
  }
}
