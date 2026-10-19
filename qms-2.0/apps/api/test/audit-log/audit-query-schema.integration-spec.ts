import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../src/database/prisma.service.js';
import { AuditLogService } from '../../src/modules/audit-log/audit-log.service.js';
import { AuditQueryService } from '../../src/modules/audit-log/audit-query.service.js';
import { Test } from '@nestjs/testing';
import { ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../../src/app.module.js';
import { GlobalExceptionFilter } from '../../src/common/contracts/global-exception.filter.js';
import { SessionService } from '../../src/modules/identity/session.service.js';

if (!process.env.DATABASE_URL) throw new Error('PostgreSQL integration requires DATABASE_URL');

describe('authorized audit queries on PostgreSQL', () => {
  const prisma = new PrismaService(process.env.DATABASE_URL!);
  const organizations = [randomUUID(), randomUUID()];
  const userId = randomUUID();
  const roleId = randomUUID();
  const actor = { id: userId, organizationId: organizations[0]!, sessionId: randomUUID(), accountType: 'INTERNAL' as const };
  const service = new AuditQueryService(prisma, new AuditLogService(prisma));
  const prefix = `audit-query-${randomUUID()}`;

  beforeAll(async () => {
    await prisma.$connect();
    for (const organizationId of organizations) await prisma.organization.create({ data: { id: organizationId, code: `audit-${organizationId}`, name: 'Audit test', type: 'INTERNAL' } });
    await prisma.user.create({ data: { id: userId, organizationId: organizations[0]!, username: prefix, passwordHash: 'not-used', accountType: 'INTERNAL' } });
    const permission = await prisma.permission.upsert({ where: { code: 'audit:read' }, create: { code: 'audit:read', name: 'Audit read' }, update: {} });
    await prisma.role.create({ data: { id: roleId, organizationId: organizations[0], code: prefix, name: 'Audit reader', permissions: { create: { permissionId: permission.id } } } });
    await prisma.userRole.create({ data: { userId, roleId, organizationId: organizations[0]! } });
    for (let index = 0; index < 5; index += 1) await prisma.auditEvent.create({ data: {
      organizationId: organizations[0], actorUserId: userId, action: 'CONFIG_UPDATED', resourceType: 'Configuration', resourceId: String(index),
      outcome: index === 4 ? 'DENIED' : 'SUCCESS', traceId: prefix, createdAt: new Date('2026-01-01T12:00:00Z'),
      metadata: { resourceVersion: index, reasonCode: null, password: 'must-not-leak', nested: { token: 'must-not-leak' } },
    } });
    for (const organizationId of [organizations[1], null]) await prisma.auditEvent.create({ data: { organizationId, action: 'HIDDEN', resourceType: 'Configuration', outcome: 'SUCCESS', traceId: prefix } });
  });

  afterAll(async () => {
    await prisma.auditEvent.deleteMany({ where: { traceId: prefix } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.organization.deleteMany({ where: { id: { in: organizations } } });
    await prisma.$disconnect();
  });

  it('filters before counting, hides global/foreign rows, and sanitizes stored legacy metadata', async () => {
    const result = await service.list(actor, { pageSize: 100 });
    expect(result.total).toBe(5);
    expect(result.items).toHaveLength(5);
    expect(JSON.stringify(result)).not.toMatch(/must-not-leak|HIDDEN|password|nested/);
    expect(result.items.every((entry) => entry.organizationId === organizations[0])).toBe(true);
    expect(result.items.every((entry) => entry.metadata.reasonCode === null)).toBe(true);
  });

  it('uses stable keyset pagination across identical timestamps', async () => {
    const first = await service.list(actor, { pageSize: 2 });
    const second = await service.list(actor, { pageSize: 2, cursor: first.nextCursor! });
    const third = await service.list(actor, { pageSize: 2, cursor: second.nextCursor! });
    expect(new Set([...first.items, ...second.items, ...third.items].map((entry) => entry.id)).size).toBe(5);
    expect(third.nextCursor).toBeNull();
    expect([first.total, second.total, third.total]).toEqual([5, 5, 5]);
  });

  it('projects current safe summaries only for actors in the event organization, including disabled actors', async () => {
    const sameId = randomUUID(); const foreignId = randomUUID();
    const summaryTrace = `${prefix}-summary`;
    try {
      await prisma.user.create({ data: { id: sameId, organizationId: organizations[0]!, username: `${prefix}-disabled`, status: 'DISABLED', passwordHash: 'never-project-password', email: `${sameId}@private.test`, accountType: 'INTERNAL' } });
      await prisma.user.create({ data: { id: foreignId, organizationId: organizations[1]!, username: `${prefix}-foreign-secret`, passwordHash: 'never-project-password', accountType: 'INTERNAL' } });
      for (const actorUserId of [sameId, foreignId, null]) await prisma.auditEvent.create({ data: { organizationId: organizations[0], actorUserId, action: actorUserId ? 'USER_UPDATED' : 'UNKNOWN_ACTION', resourceType: 'SummaryTest', outcome: 'DENIED', traceId: summaryTrace } });
      const page = await service.list(actor, { resourceType: 'SummaryTest' });
      const same = page.items.find((entry) => entry.actorUserId === sameId)!;
      expect(same.actionLabel).toBe('更新用户');
      expect(same.actorSummary).toEqual({ username: `${prefix}-disabled`, accountType: 'INTERNAL', organizationName: 'Audit test' });
      expect(page.items.find((entry) => entry.actorUserId === foreignId)?.actorSummary).toBeNull();
      expect(page.items.find((entry) => entry.actorUserId === null)).toMatchObject({ actionLabel: 'UNKNOWN_ACTION', actorSummary: null });
      expect(JSON.stringify(page)).not.toMatch(/foreign-secret|never-project-password|private.test|passwordHash|email/);
      await prisma.user.update({ where: { id: sameId }, data: { username: `${prefix}-renamed` } });
      expect((await service.list(actor, { actorUserId: sameId })).items[0]?.actorSummary?.username).toBe(`${prefix}-renamed`);
      await prisma.user.update({ where: { id: sameId }, data: { organizationId: organizations[1]!, username: `${prefix}-moved-private` } });
      const moved = (await service.list(actor, { actorUserId: sameId })).items[0]!;
      expect(moved).toMatchObject({ actorUserId: sameId, actorSummary: null });
      expect(JSON.stringify(moved)).not.toContain('moved-private');
      await prisma.user.delete({ where: { id: sameId } });
      const deleted = (await service.list(actor, { resourceType: 'SummaryTest' })).items.find((entry) => entry.id === same.id)!;
      expect(deleted).toMatchObject({ actorUserId: null, actorSummary: null });
    } finally {
      await prisma.auditEvent.deleteMany({ where: { traceId: summaryTrace } });
      await prisma.user.deleteMany({ where: { id: { in: [sameId, foreignId] } } });
    }
  });

  it('applies actor, action, resource, outcome and inclusive date filters', async () => {
    const result = await service.list(actor, { actorUserId: userId, action: 'CONFIG_UPDATED', resourceType: 'Configuration', resourceId: '4', outcome: 'DENIED', from: '2026-01-01T12:00:00Z', to: '2026-01-01T12:00:00Z' });
    expect(result.total).toBe(1);
    expect(result.items[0]?.resourceId).toBe('4');
  });

  it('rejects foreign organization, spoofed identity and disabled users', async () => {
    await expect(service.list(actor, { organizationId: organizations[1] })).rejects.toMatchObject({ status: 403 });
    await expect(service.list({ ...actor, accountType: 'SUPPLIER' }, {})).rejects.toMatchObject({ status: 401 });
    await prisma.user.update({ where: { id: userId }, data: { status: 'DISABLED' } });
    try { await expect(service.list(actor, {})).rejects.toMatchObject({ status: 401 }); }
    finally { await prisma.user.update({ where: { id: userId }, data: { status: 'ACTIVE' } }); }
  });

  it('rejects invalid cursor, inverted date range and unbounded page size', async () => {
    for (const query of [{ cursor: 'broken' }, { pageSize: 101 }, { pageSize: -1 }, { from: '2026-01-02T00:00:00Z', to: '2026-01-01T00:00:00Z' }]) {
      await expect(service.list(actor, query)).rejects.toMatchObject({ status: 400 });
    }
  });

  it('rechecks revoked permission for every read', async () => {
    await prisma.userRole.deleteMany({ where: { userId } });
    try { await expect(service.list(actor, {})).rejects.toMatchObject({ status: 403 }); }
    finally { await prisma.userRole.create({ data: { userId, roleId, organizationId: organizations[0]! } }); }
  });

  it('enforces real HTTP guards, DTO boundaries and safe response', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(PrismaService).useValue(prisma).compile();
    const app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init();
    try {
      const token = await app.get(SessionService).create(userId, prisma, { mfaVerified: true, reauthenticated: true });
      const cookie = `qms_session=${token}`;
      await request(app.getHttpServer()).get('/api/v1/admin/audit-events').expect(401);
      const result = await request(app.getHttpServer()).get('/api/v1/admin/audit-events?pageSize=2').set('Cookie', cookie).expect(200);
      expect(result.body.items).toHaveLength(2);
      expect(result.body.total).toBe(5);
      for (const query of ['pageSize=101', 'organizationId=invalid', 'actorUserId=invalid', 'outcome=other', 'unexpected=value', 'cursor=broken']) {
        await request(app.getHttpServer()).get(`/api/v1/admin/audit-events?${query}`).set('Cookie', cookie).expect(400);
      }
      await request(app.getHttpServer()).get(`/api/v1/admin/audit-events?organizationId=${organizations[1]}`).set('Cookie', cookie).expect(403);
      await prisma.userRole.deleteMany({ where: { userId } });
      await request(app.getHttpServer()).get('/api/v1/admin/audit-events').set('Cookie', cookie).expect(403);
    } finally {
      await prisma.userRole.createMany({ data: [{ userId, roleId, organizationId: organizations[0]! }], skipDuplicates: true });
      await prisma.auditEvent.deleteMany({ where: { actorUserId: userId, traceId: { not: prefix } } });
      await app.close();
    }
  });
});
