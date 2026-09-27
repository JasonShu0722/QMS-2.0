import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../src/database/prisma.service.js';
import { AdminMutationService } from '../../src/common/security/admin-mutation.service.js';
import { AuditLogService } from '../../src/modules/audit-log/audit-log.service.js';
import { AnnouncementService } from '../../src/modules/announcements/announcement.service.js';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl || process.env.QMS_DISPOSABLE_TEST_DB !== 'true' || new URL(databaseUrl).port === '55440') throw new Error('An independent disposable PostgreSQL database is required');

describe('announcements on PostgreSQL', () => {
  const prisma = new PrismaService(databaseUrl);
  const audit = new AuditLogService(prisma);
  const service = new AnnouncementService(prisma, new AdminMutationService(prisma, audit), audit);
  const organizationId = randomUUID();
  const otherOrganizationId = randomUUID();
  const publisherId = randomUUID();
  const recipientId = randomUUID();
  const outsiderId = randomUUID();
  const publisher = { id: publisherId, organizationId, accountType: 'INTERNAL' as const, sessionId: randomUUID() };
  const recipient = { id: recipientId, organizationId, accountType: 'INTERNAL' as const, sessionId: randomUUID() };
  const outsider = { id: outsiderId, organizationId: otherOrganizationId, accountType: 'INTERNAL' as const, sessionId: randomUUID() };

  beforeAll(async () => {
    await prisma.$connect();
    for (const organization of [organizationId, otherOrganizationId]) await prisma.organization.create({ data: { id: organization, code: `ANN-${organization.slice(0, 8)}`, name: '公告测试组织', type: 'INTERNAL' } });
    for (const actor of [publisher, recipient, outsider]) {
      await prisma.user.create({ data: { id: actor.id, organizationId: actor.organizationId, username: `ann-${actor.id.slice(0, 8)}`, passwordHash: 'test-only', accountType: 'INTERNAL' } });
      await prisma.session.create({ data: { id: actor.sessionId, userId: actor.id, tokenHash: randomUUID(), expiresAt: new Date(Date.now() + 3_600_000), reauthenticatedAt: new Date() } });
      const roleId = randomUUID();
      await prisma.role.create({ data: { id: roleId, organizationId: actor.organizationId, code: `ANN-${actor.id.slice(0, 8)}`, name: '公告测试角色' } });
      const codes = actor.id === publisherId ? ['announcement:read', 'announcement:manage', 'announcement:audit:read'] : ['announcement:read'];
      for (const code of codes) {
        const permission = await prisma.permission.upsert({ where: { code }, create: { code, name: code }, update: {} });
        await prisma.rolePermission.create({ data: { roleId, permissionId: permission.id } });
      }
      await prisma.userRole.create({ data: { userId: actor.id, organizationId: actor.organizationId, roleId } });
    }
  });

  afterAll(async () => prisma.$disconnect());

  it('publishes a selected audience and records one read audit with idempotent replay', async () => {
    const created = await service.create(publisher, { title: '质量公告', content: '请阅读本月变更', importance: 'IMPORTANT', mustRead: true, audience: 'SELECTED', recipientUserIds: [recipientId] }, randomUUID(), randomUUID());
    expect(created.status).toBe('DRAFT');
    const published = await service.publish(publisher, created.id, created.version, randomUUID(), randomUUID());
    expect(published.recipientCount).toBe(1);
    expect((await service.mine(recipient, true)).unreadMustReadCount).toBe(1);
    expect((await service.mine(publisher, true)).items).toHaveLength(0);
    const key = randomUUID();
    const first = await service.markRead(recipient, created.id, randomUUID(), key);
    const replay = await service.markRead(recipient, created.id, randomUUID(), key);
    expect(replay.readAt).toBe(first.readAt);
    await service.markRead(recipient, created.id, randomUUID(), randomUUID());
    expect(await prisma.auditEvent.count({ where: { action: 'ANNOUNCEMENT_READ', resourceId: created.id, actorUserId: recipientId } })).toBe(1);
    expect((await service.mine(recipient, true)).unreadMustReadCount).toBe(0);
    const receipts = await service.receipts(publisher, created.id);
    expect(receipts).toHaveLength(1);
    expect(receipts[0]?.userId).toBe(recipientId);
    expect(receipts[0]?.readAt).toBeTruthy();
    await expect(service.markRead(publisher, created.id, randomUUID(), randomUUID())).rejects.toMatchObject({ status: 404 });
  });

  it('rejects cross-organization recipients, stale versions, and unauthorized reading', async () => {
    await expect(service.create(publisher, { title: '越权', content: '不可发给外组织', importance: 'NORMAL', mustRead: false, audience: 'SELECTED', recipientUserIds: [outsiderId] }, randomUUID(), randomUUID())).rejects.toMatchObject({ status: 403 });
    const created = await service.create(publisher, { title: '待发布', content: '正文', importance: 'NORMAL', mustRead: false, audience: 'ALL', recipientUserIds: [] }, randomUUID(), randomUUID());
    await expect(service.publish(publisher, created.id, 0, randomUUID(), randomUUID())).rejects.toMatchObject({ status: 409 });
    await service.publish(publisher, created.id, 1, randomUUID(), randomUUID());
    await expect(service.markRead(outsider, created.id, randomUUID(), randomUUID())).rejects.toMatchObject({ status: 404 });
    await expect(service.publish(publisher, created.id, 1, randomUUID(), randomUUID())).rejects.toMatchObject({ status: 409 });
  });

  it('freezes the published audience and receipt, then removes an archived announcement from unread reminders', async () => {
    const created = await service.create(publisher, { title: '范围快照', content: '已发布名单不变', importance: 'IMPORTANT', mustRead: true, audience: 'ALL', recipientUserIds: [] }, randomUUID(), randomUUID());
    const published = await service.publish(publisher, created.id, 1, randomUUID(), randomUUID());
    expect(published.recipientCount).toBe(2);
    const lateUserId = randomUUID();
    const lateSessionId = randomUUID();
    await prisma.user.create({ data: { id: lateUserId, organizationId, username: 'ann-late-' + lateUserId.slice(0, 8), passwordHash: 'test-only', accountType: 'INTERNAL' } });
    await prisma.session.create({ data: { id: lateSessionId, userId: lateUserId, tokenHash: randomUUID(), expiresAt: new Date(Date.now() + 3_600_000), reauthenticatedAt: new Date() } });
    const roleId = randomUUID();
    await prisma.role.create({ data: { id: roleId, organizationId, code: 'ANN-LATE-' + lateUserId.slice(0, 8), name: '晚加入用户' } });
    const permission = await prisma.permission.findUniqueOrThrow({ where: { code: 'announcement:read' } });
    await prisma.rolePermission.create({ data: { roleId, permissionId: permission.id } });
    await prisma.userRole.create({ data: { userId: lateUserId, roleId, organizationId } });
    expect((await service.mine({ id: lateUserId, sessionId: lateSessionId, organizationId, accountType: 'INTERNAL' })).items).toHaveLength(0);
    await expect(prisma.$executeRawUnsafe('INSERT INTO announcement_recipients (organization_id, announcement_id, user_id) VALUES ($1::uuid, $2::uuid, $3::uuid)', organizationId, created.id, lateUserId)).rejects.toThrow();
    await service.markRead(recipient, created.id, randomUUID(), randomUUID());
    await expect(prisma.$executeRawUnsafe('UPDATE announcement_recipients SET read_at=NULL, read_session_id=NULL, read_trace_id=NULL WHERE announcement_id=$1::uuid AND user_id=$2::uuid', created.id, recipientId)).rejects.toThrow();
    await service.archive(publisher, created.id, published.version, randomUUID(), randomUUID());
    expect((await service.mine(recipient, true)).items.find((item) => item.id === created.id)).toBeUndefined();
    await prisma.userRole.deleteMany({ where: { userId: recipientId, organizationId } });
    await expect(service.mine(recipient)).rejects.toMatchObject({ status: 403 });
  });

  it('pages managed announcements without hiding older records or crossing organizations', async () => {
    const all = await service.manage(publisher, 1, 100);
    expect(all.items.length).toBeGreaterThanOrEqual(3);
    const first = await service.manage(publisher, 1, 2);
    const second = await service.manage(publisher, 2, 2);
    expect(first.items).toHaveLength(2);
    expect(first.total).toBe(all.items.length);
    expect(second.total).toBe(first.total);
    expect(second.items[0]?.id).not.toBe(first.items[0]?.id);
    await expect(service.manage(publisher, 0, 2)).rejects.toMatchObject({ status: 400 });
    const outsiderAssignment = await prisma.userRole.findFirstOrThrow({ where: { userId: outsiderId, organizationId: otherOrganizationId } });
    const permission = await prisma.permission.findUniqueOrThrow({ where: { code: 'announcement:manage' } });
    await prisma.rolePermission.create({ data: { roleId: outsiderAssignment.roleId, permissionId: permission.id } });
    const otherPage = await service.manage(outsider, 1, 2);
    expect(otherPage.total).toBe(0);
    expect(otherPage.items).toHaveLength(0);
  });
});
