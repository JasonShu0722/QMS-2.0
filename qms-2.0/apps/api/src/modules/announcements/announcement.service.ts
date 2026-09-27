import { HttpException, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../database/prisma.service.js';
import { AdminMutationService, assertAdminAccess, type AdminActor, type AdminTransaction } from '../../common/security/admin-mutation.service.js';
import { AuditLogService } from '../audit-log/audit-log.service.js';

export type AnnouncementInput = {
  title: string;
  content: string;
  importance: 'NORMAL' | 'IMPORTANT';
  mustRead: boolean;
  audience: 'ALL' | 'SELECTED';
  recipientUserIds: string[];
};

type AnnouncementRow = {
  id: string; organization_id: string; title: string; content: string;
  importance: 'NORMAL' | 'IMPORTANT'; must_read: boolean; audience: 'ALL' | 'SELECTED';
  status: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED'; recipient_count: number; version: number;
  published_at: Date | null; created_at: Date; updated_at: Date;
};
type ReceiptRow = { user_id: string; read_at: Date | null; read_session_id: string | null; read_trace_id: string | null };

function fail(code: string, status: number): never { throw new HttpException({ code, message: code }, status); }
function query<Row>(transaction: AdminTransaction, sql: string, ...params: unknown[]) { return transaction.$queryRawUnsafe<Row[]>(sql, ...params); }
function normalize(input: AnnouncementInput): AnnouncementInput {
  const title = input.title?.trim();
  const content = input.content?.trim();
  if (!title || title.length > 200 || !content || content.length > 20000) fail('ANNOUNCEMENT_INPUT_INVALID', 400);
  if (!['NORMAL', 'IMPORTANT'].includes(input.importance) || typeof input.mustRead !== 'boolean' || !['ALL', 'SELECTED'].includes(input.audience) || !Array.isArray(input.recipientUserIds)) fail('ANNOUNCEMENT_INPUT_INVALID', 400);
  const recipientUserIds = [...new Set(input.recipientUserIds)];
  if (recipientUserIds.some((id) => !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id))) fail('ANNOUNCEMENT_INPUT_INVALID', 400);
  if (recipientUserIds.length > 1000) fail('ANNOUNCEMENT_AUDIENCE_TOO_LARGE', 400);
  if ((input.audience === 'ALL' && recipientUserIds.length) || (input.audience === 'SELECTED' && !recipientUserIds.length)) fail('ANNOUNCEMENT_INPUT_INVALID', 400);
  return { title, content, importance: input.importance, mustRead: input.mustRead, audience: input.audience, recipientUserIds };
}
function project(row: AnnouncementRow) {
  return { id: row.id, organizationId: row.organization_id, title: row.title, content: row.content, importance: row.importance, mustRead: row.must_read, audience: row.audience, status: row.status, recipientCount: row.recipient_count, version: row.version, publishedAt: row.published_at, createdAt: row.created_at, updatedAt: row.updated_at };
}

@Injectable()
export class AnnouncementService {
  constructor(private readonly prisma: PrismaService, private readonly mutations: AdminMutationService, private readonly audit: AuditLogService) {}
  private scope(actor: AdminActor) {
    if (actor.accountType !== 'INTERNAL') fail('ORGANIZATION_SCOPE_DENIED', 403);
    return actor.scopeOrganizationId ?? actor.organizationId;
  }
  private async find(transaction: AdminTransaction, organizationId: string, id: string, lock = false) {
    const rows = await query<AnnouncementRow>(transaction, 'SELECT * FROM announcements WHERE organization_id = $1::uuid AND id = $2::uuid' + (lock ? ' FOR UPDATE' : ''), organizationId, id);
    if (!rows[0]) fail('ANNOUNCEMENT_NOT_FOUND', 404);
    return rows[0];
  }
  private async assign(transaction: AdminTransaction, organizationId: string, id: string, recipients: string[]) {
    if (!recipients.length) return;
    const active = await transaction.user.findMany({ where: { id: { in: recipients }, organizationId, status: 'ACTIVE', accountType: 'INTERNAL' }, select: { id: true } });
    if (active.length !== recipients.length) fail('ORGANIZATION_SCOPE_DENIED', 403);
    for (const userId of recipients) await transaction.$executeRawUnsafe('INSERT INTO announcement_recipients (organization_id, announcement_id, user_id) VALUES ($1::uuid, $2::uuid, $3::uuid)', organizationId, id, userId);
  }
  private auditAction(transaction: AdminTransaction, actor: AdminActor, organizationId: string, id: string, action: string, traceId: string, version?: number) {
    return this.audit.record({ organizationId, actorUserId: actor.id, action, resourceType: 'Announcement', resourceId: id, outcome: 'SUCCESS', traceId, metadata: { resourceVersion: version } }, transaction);
  }

  async create(actor: AdminActor, raw: AnnouncementInput, traceId: string, key?: string) {
    const organizationId = this.scope(actor), input = normalize(raw);
    return this.mutations.run({ actor, organizationId, key, traceId, action: 'ANNOUNCEMENT_CREATED', payload: input, permission: 'announcement:manage' }, async (transaction) => {
      const id = randomUUID();
      const rows = await query<AnnouncementRow>(transaction, 'INSERT INTO announcements (id, organization_id, title, content, importance, must_read, audience, created_by_id) VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8::uuid) RETURNING *', id, organizationId, input.title, input.content, input.importance, input.mustRead, input.audience, actor.id);
      await this.assign(transaction, organizationId, id, input.recipientUserIds);
      await this.auditAction(transaction, actor, organizationId, id, 'ANNOUNCEMENT_CREATED', traceId, rows[0]!.version);
      return project(rows[0]!);
    });
  }

  async update(actor: AdminActor, id: string, expectedVersion: number, raw: AnnouncementInput, traceId: string, key?: string) {
    const organizationId = this.scope(actor), input = normalize(raw);
    return this.mutations.run({ actor, organizationId, key, traceId, action: 'ANNOUNCEMENT_UPDATED', payload: { id, expectedVersion, input }, permission: 'announcement:manage' }, async (transaction) => {
      const current = await this.find(transaction, organizationId, id, true);
      if (current.status !== 'DRAFT' || current.version !== expectedVersion) fail('CONCURRENCY_CONFLICT', 409);
      const rows = await query<AnnouncementRow>(transaction, 'UPDATE announcements SET title=$3, content=$4, importance=$5, must_read=$6, audience=$7, version=version+1, updated_at=CURRENT_TIMESTAMP WHERE organization_id=$1::uuid AND id=$2::uuid AND version=$8 RETURNING *', organizationId, id, input.title, input.content, input.importance, input.mustRead, input.audience, expectedVersion);
      await transaction.$executeRawUnsafe('DELETE FROM announcement_recipients WHERE organization_id=$1::uuid AND announcement_id=$2::uuid', organizationId, id);
      await this.assign(transaction, organizationId, id, input.recipientUserIds);
      await this.auditAction(transaction, actor, organizationId, id, 'ANNOUNCEMENT_UPDATED', traceId, rows[0]!.version);
      return project(rows[0]!);
    });
  }

  async publish(actor: AdminActor, id: string, expectedVersion: number, traceId: string, key?: string) {
    const organizationId = this.scope(actor);
    return this.mutations.run({ actor, organizationId, key, traceId, action: 'ANNOUNCEMENT_PUBLISHED', payload: { id, expectedVersion }, permission: 'announcement:manage' }, async (transaction) => {
      const current = await this.find(transaction, organizationId, id, true);
      if (current.status !== 'DRAFT' || current.version !== expectedVersion) fail('CONCURRENCY_CONFLICT', 409);
      if (current.audience === 'ALL') await transaction.$executeRawUnsafe("INSERT INTO announcement_recipients (organization_id, announcement_id, user_id) SELECT $1::uuid, $2::uuid, u.id FROM users u WHERE u.organization_id=$1::uuid AND u.status='ACTIVE' AND u.account_type='INTERNAL'", organizationId, id);
      else {
        const inactive = await query<{ user_id: string }>(transaction, "SELECT r.user_id FROM announcement_recipients r LEFT JOIN users u ON u.id=r.user_id WHERE r.organization_id=$1::uuid AND r.announcement_id=$2::uuid AND (u.status<>'ACTIVE' OR u.account_type<>'INTERNAL')", organizationId, id);
        if (inactive.length) fail('ANNOUNCEMENT_RECIPIENT_INACTIVE', 409);
      }
      const counts = await query<{ count: bigint }>(transaction, 'SELECT COUNT(*)::bigint AS count FROM announcement_recipients WHERE organization_id=$1::uuid AND announcement_id=$2::uuid', organizationId, id);
      const count = Number(counts[0]!.count);
      if (!count) fail('ANNOUNCEMENT_AUDIENCE_EMPTY', 409);
      const rows = await query<AnnouncementRow>(transaction, "UPDATE announcements SET status='PUBLISHED', recipient_count=$3, published_by_id=$4::uuid, published_at=CURRENT_TIMESTAMP, version=version+1, updated_at=CURRENT_TIMESTAMP WHERE organization_id=$1::uuid AND id=$2::uuid AND version=$5 RETURNING *", organizationId, id, count, actor.id, expectedVersion);
      await this.auditAction(transaction, actor, organizationId, id, 'ANNOUNCEMENT_PUBLISHED', traceId, rows[0]!.version);
      return project(rows[0]!);
    });
  }

  async archive(actor: AdminActor, id: string, expectedVersion: number, traceId: string, key?: string) {
    const organizationId = this.scope(actor);
    return this.mutations.run({ actor, organizationId, key, traceId, action: 'ANNOUNCEMENT_ARCHIVED', payload: { id, expectedVersion }, permission: 'announcement:manage' }, async (transaction) => {
      const current = await this.find(transaction, organizationId, id, true);
      if (current.status !== 'PUBLISHED' || current.version !== expectedVersion) fail('CONCURRENCY_CONFLICT', 409);
      const rows = await query<AnnouncementRow>(transaction, "UPDATE announcements SET status='ARCHIVED', archived_by_id=$3::uuid, archived_at=CURRENT_TIMESTAMP, version=version+1, updated_at=CURRENT_TIMESTAMP WHERE organization_id=$1::uuid AND id=$2::uuid AND version=$4 RETURNING *", organizationId, id, actor.id, expectedVersion);
      await this.auditAction(transaction, actor, organizationId, id, 'ANNOUNCEMENT_ARCHIVED', traceId, rows[0]!.version);
      return project(rows[0]!);
    });
  }

  async manage(actor: AdminActor, page = 1, pageSize = 20) {
    const organizationId = this.scope(actor);
    if (!Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 100) fail('ANNOUNCEMENT_PAGE_INVALID', 400);
    return this.prisma.$transaction(async (transaction) => {
      await assertAdminAccess(transaction, actor, organizationId, 'announcement:manage');
      const counts = await query<{ total: bigint }>(transaction, 'SELECT COUNT(*)::bigint AS total FROM announcements WHERE organization_id=$1::uuid', organizationId);
      const rows = await query<AnnouncementRow & { read_count: bigint; recipient_user_ids: string[] }>(transaction, "SELECT a.*, (SELECT COUNT(*)::bigint FROM announcement_recipients r WHERE r.organization_id=a.organization_id AND r.announcement_id=a.id AND r.read_at IS NOT NULL) AS read_count, (SELECT COALESCE(array_agg(r.user_id ORDER BY r.user_id), '{}'::uuid[]) FROM announcement_recipients r WHERE r.organization_id=a.organization_id AND r.announcement_id=a.id) AS recipient_user_ids FROM announcements a WHERE a.organization_id=$1::uuid ORDER BY a.created_at DESC, a.id DESC LIMIT $2::int OFFSET $3::bigint", organizationId, pageSize, BigInt((page - 1) * pageSize));
      return { items: rows.map((row) => ({ ...project(row), readCount: Number(row.read_count), recipientUserIds: row.recipient_user_ids })), total: Number(counts[0]!.total), page, pageSize };
    });
  }

  async audienceUsers(actor: AdminActor) {
    const organizationId = this.scope(actor);
    return this.prisma.$transaction(async (transaction) => {
      await assertAdminAccess(transaction, actor, organizationId, 'announcement:manage');
      const where = { organizationId, status: 'ACTIVE' as const, accountType: 'INTERNAL' as const };
      const [total, users] = await Promise.all([
        transaction.user.count({ where }),
        transaction.user.findMany({ where, select: { id: true, username: true }, orderBy: { username: 'asc' }, take: 1000 }),
      ]);
      return { items: users, total };
    });
  }

  async mine(actor: AdminActor, unreadOnly = false) {
    const organizationId = this.scope(actor);
    return this.prisma.$transaction(async (transaction) => {
      await assertAdminAccess(transaction, actor, organizationId, 'announcement:read');
      const rows = await query<AnnouncementRow & ReceiptRow>(transaction, "SELECT a.*, r.user_id, r.read_at, r.read_session_id, r.read_trace_id FROM announcements a JOIN announcement_recipients r ON r.organization_id=a.organization_id AND r.announcement_id=a.id WHERE a.organization_id=$1::uuid AND a.status='PUBLISHED' AND r.user_id=$2::uuid ORDER BY a.published_at DESC, a.id DESC", organizationId, actor.id);
      return { items: rows.filter((row) => !unreadOnly || !row.read_at).map((row) => ({ ...project(row), readAt: row.read_at })), unreadMustReadCount: rows.filter((row) => row.must_read && !row.read_at).length };
    });
  }

  async markRead(actor: AdminActor, id: string, traceId: string, key?: string) {
    const organizationId = this.scope(actor);
    return this.mutations.run({ actor, organizationId, key, traceId, action: 'ANNOUNCEMENT_READ', payload: { id }, permission: 'announcement:read' }, async (transaction) => {
      const rows = await query<ReceiptRow & { status: string }>(transaction, 'SELECT r.*, a.status FROM announcement_recipients r JOIN announcements a ON a.id=r.announcement_id AND a.organization_id=r.organization_id WHERE r.organization_id=$1::uuid AND r.announcement_id=$2::uuid AND r.user_id=$3::uuid FOR UPDATE OF r', organizationId, id, actor.id);
      const receipt = rows[0];
      if (!receipt || receipt.status !== 'PUBLISHED') fail('ANNOUNCEMENT_NOT_FOUND', 404);
      if (receipt.read_at) return { announcementId: id, userId: actor.id, readAt: receipt.read_at };
      const updated = await query<ReceiptRow>(transaction, 'UPDATE announcement_recipients SET read_at=CURRENT_TIMESTAMP, read_session_id=$4::uuid, read_trace_id=$5 WHERE organization_id=$1::uuid AND announcement_id=$2::uuid AND user_id=$3::uuid RETURNING *', organizationId, id, actor.id, actor.sessionId, traceId);
      await this.audit.record({ organizationId, actorUserId: actor.id, action: 'ANNOUNCEMENT_READ', resourceType: 'Announcement', resourceId: id, outcome: 'SUCCESS', traceId, metadata: { targetUserId: actor.id } }, transaction);
      return { announcementId: id, userId: actor.id, readAt: updated[0]!.read_at };
    });
  }

  async receipts(actor: AdminActor, id: string) {
    const organizationId = this.scope(actor);
    return this.prisma.$transaction(async (transaction) => {
      await assertAdminAccess(transaction, actor, organizationId, 'announcement:audit:read');
      await this.find(transaction, organizationId, id);
      const rows = await query<ReceiptRow>(transaction, 'SELECT user_id, read_at, read_session_id, read_trace_id FROM announcement_recipients WHERE organization_id=$1::uuid AND announcement_id=$2::uuid ORDER BY user_id', organizationId, id);
      return rows.map((row) => ({ userId: row.user_id, readAt: row.read_at, readSessionId: row.read_session_id, readTraceId: row.read_trace_id }));
    });
  }
}
