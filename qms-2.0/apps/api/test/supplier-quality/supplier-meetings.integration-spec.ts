import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../../src/app.module.js';
import { PrismaService } from '../../src/database/prisma.service.js';
import { SessionService } from '../../src/modules/identity/session.service.js';
import { GlobalExceptionFilter } from '../../src/common/contracts/global-exception.filter.js';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl || process.env.QMS_DISPOSABLE_TEST_DB !== 'true' || new URL(databaseUrl).port === '55440') throw new Error('Supplier meetings requires an independent disposable PostgreSQL database');

describe('supplier meetings on PostgreSQL and HTTP', () => {
  let app: INestApplication; let prisma: PrismaService; let ownerCookie: string; let otherCookie: string; let colleagueCookie: string;
  const ownerId = randomUUID(); const otherOwnerId = randomUUID(); const supplierId = randomUUID(); const ownerUserId = randomUUID(); const otherUserId = randomUUID(); const ownerRoleId = randomUUID(); const otherRoleId = randomUUID(); const profileId = randomUUID(); const csrf = randomUUID();
  const targetUserId = randomUUID();
  const colleagueUserId = randomUUID();
  const permissions = ['supplier-meetings:read', 'supplier-meetings:write', 'supplier-meetings:conclude', 'supplier-meetings:actions'];

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile(); app = module.createNestApplication(); app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true })); app.useGlobalFilters(new GlobalExceptionFilter()); await app.init(); prisma = app.get(PrismaService);
    for (const [id, type] of [[ownerId, 'INTERNAL'], [otherOwnerId, 'INTERNAL'], [supplierId, 'SUPPLIER']] as const) await prisma.organization.create({ data: { id, code: `MEETING-${id.slice(0, 8)}`, name: type, type } });
    for (const [userId, organizationId, roleId] of [[ownerUserId, ownerId, ownerRoleId], [otherUserId, otherOwnerId, otherRoleId]] as const) { await prisma.user.create({ data: { id: userId, organizationId, username: `meeting-${userId.slice(0, 8)}`, accountType: 'INTERNAL', passwordHash: 'test-only' } }); await prisma.role.create({ data: { id: roleId, organizationId, code: 'MEETING', name: 'Meeting' } }); for (const code of permissions) { const permission = await prisma.permission.upsert({ where: { code }, create: { code, name: code }, update: {} }); await prisma.rolePermission.create({ data: { roleId, permissionId: permission.id } }); } await prisma.userRole.create({ data: { userId, organizationId, roleId } }); }
    ownerCookie = `qms_session=${await app.get(SessionService).create(ownerUserId, prisma, { reauthenticated: true })}; qms_csrf=${csrf}`; otherCookie = `qms_session=${await app.get(SessionService).create(otherUserId, prisma, { reauthenticated: true })}; qms_csrf=${csrf}`;
    await prisma.user.create({ data: { id: colleagueUserId, organizationId: ownerId, username: randomUUID(), accountType: 'INTERNAL', passwordHash: 'test-only' } });
    await prisma.userRole.create({ data: { userId: colleagueUserId, organizationId: ownerId, roleId: ownerRoleId } });
    colleagueCookie = `qms_session=${await app.get(SessionService).create(colleagueUserId, prisma, { reauthenticated: true })}; qms_csrf=${csrf}`;
    await prisma.supplierBusinessProfile.create({ data: { id: profileId, ownerOrganizationId: ownerId, supplierOrganizationId: supplierId, businessCode: 'MEETING-01', displayName: '会议供应商' } });
  }, 30_000);
  afterAll(async () => { try { if (prisma) { await prisma.$executeRaw`DELETE FROM supplier_meetings WHERE owner_organization_id IN (${ownerId}::uuid, ${otherOwnerId}::uuid)`; await prisma.supplierBusinessProfile.deleteMany({ where: { id: profileId } }); await prisma.adminMutation.deleteMany({ where: { organizationId: { in: [ownerId, otherOwnerId] } } }); await prisma.auditEvent.deleteMany({ where: { organizationId: { in: [ownerId, otherOwnerId] } } }); await prisma.userRole.deleteMany({ where: { roleId: { in: [ownerRoleId, otherRoleId] } } }); await prisma.rolePermission.deleteMany({ where: { roleId: { in: [ownerRoleId, otherRoleId] } } }); await prisma.role.deleteMany({ where: { id: { in: [ownerRoleId, otherRoleId] } } }); await prisma.session.deleteMany({ where: { userId: { in: [ownerUserId, otherUserId, colleagueUserId] } } }); await prisma.user.deleteMany({ where: { id: { in: [ownerUserId, otherUserId, targetUserId, colleagueUserId] } } }); await prisma.organization.deleteMany({ where: { id: { in: [ownerId, otherOwnerId, supplierId] } } }); } } finally { await app?.close(); } }, 30_000);
  function post(path: string, cookie: string, value: object, key = randomUUID()) { return request(app.getHttpServer()).post(path).set('Cookie', cookie).set('x-csrf-token', csrf).set('Idempotency-Key', key).send(value); }
  function put(path: string, cookie: string, value: object, key = randomUUID()) { return request(app.getHttpServer()).put(path).set('Cookie', cookie).set('x-csrf-token', csrf).set('Idempotency-Key', key).send(value); }

  it('supports meeting topics and actions with CAS, idempotency, audit and isolation', async () => {
    const body = { profileId, title: '年度供应商质量会议', scheduledStart: '2026-11-01T09:00:00.000Z', scheduledEnd: '2026-11-01T10:00:00.000Z', location: '线上会议' }; const key = randomUUID();
    const created = await post('/api/v1/supplier-meetings', ownerCookie, body, key).expect(201); expect(created.body).toMatchObject({ profileId, status: 'PLANNED', version: 1 }); expect((await post('/api/v1/supplier-meetings', ownerCookie, body, key).expect(201)).body).toEqual(created.body);
    await post('/api/v1/supplier-meetings', otherCookie, body).expect(404);
    const started = await put(`/api/v1/supplier-meetings/${created.body.id}/start`, ownerCookie, { expectedVersion: 1 }).expect(200); expect(started.body).toMatchObject({ status: 'IN_PROGRESS', version: 2 });
    const topic = await post(`/api/v1/supplier-meetings/${created.body.id}/topics`, ownerCookie, { title: '交付稳定性' }).expect(201); expect(topic.body).toMatchObject({ status: 'OPEN', version: 1, sequence: 1 });
    const concluded = await put(`/api/v1/supplier-meetings/${created.body.id}/topics/${topic.body.id}/conclude`, ownerCookie, { expectedVersion: 1, conclusion: '保持周度交付复盘' }).expect(200); expect(concluded.body).toMatchObject({ status: 'CONCLUDED', version: 2 });
    const action = await post(`/api/v1/supplier-meetings/${created.body.id}/actions`, ownerCookie, { title: '提交交付改善计划', assigneeUserId: ownerUserId, dueDate: '2026-11-15' }).expect(201); expect(action.body).toMatchObject({ status: 'OPEN', version: 1 });
    const completedAction = await put(`/api/v1/supplier-meetings/${created.body.id}/actions/${action.body.id}/complete`, ownerCookie, { expectedVersion: 1 }).expect(200); expect(completedAction.body).toMatchObject({ status: 'COMPLETED', version: 2 });
    const completed = await put(`/api/v1/supplier-meetings/${created.body.id}/complete`, ownerCookie, { expectedVersion: 2 }).expect(200); expect(completed.body).toMatchObject({ status: 'COMPLETED', version: 3 });
    await put(`/api/v1/supplier-meetings/${created.body.id}/complete`, ownerCookie, { expectedVersion: 2 }).expect(409);
    expect((await request(app.getHttpServer()).get('/api/v1/supplier-meetings').set('Cookie', ownerCookie).expect(200)).body.total).toBe(1);
    expect(await prisma.auditEvent.count({ where: { organizationId: ownerId, action: { startsWith: 'SUPPLIER_MEETING_' } } })).toBe(7);
  });

  it('waits for the target identity lock before creating an action', async () => {
    const created = await post('/api/v1/supplier-meetings', ownerCookie, { profileId, title: '责任人并发校验',
      scheduledStart: '2026-11-01T09:00:00.000Z', scheduledEnd: '2026-11-01T10:00:00.000Z' }).expect(201);
    const target = await prisma.user.create({ data: { id: targetUserId, organizationId: ownerId, username: randomUUID(), accountType: 'INTERNAL', passwordHash: 'test-only' } });
    let locked!: (pid: number) => void;
    let unblock!: () => void;
    const held = new Promise<number>(resolve => { locked = resolve; });
    const release = new Promise<void>(resolve => { unblock = resolve; });
    const retire = prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${target.id}::uuid FOR UPDATE`;
      await tx.user.update({ where: { id: target.id }, data: { status: 'DISABLED' } });
      const [backend] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
      locked(backend!.pid);
      await release;
    });
    const pid = await held;
    const pending = post(`/api/v1/supplier-meetings/${created.body.id}/actions`, ownerCookie, {
      title: '不能分给停用人员', assigneeUserId: target.id, dueDate: '2026-11-15',
    }).then(response => response);
    let waiting = false;
    try {
      for (let attempt = 0; attempt < 100 && !waiting; attempt++) {
        const [waiter] = await prisma.$queryRaw<{ pid: number }[]>`SELECT pid FROM pg_stat_activity WHERE ${pid} = ANY(pg_blocking_pids(pid)) AND query LIKE '%FOR SHARE%'`;
        waiting = !!waiter;
        if (!waiting) await new Promise(resolve => setTimeout(resolve, 10));
      }
    } finally {
      unblock();
      await retire;
      await pending;
    }
    expect(waiting).toBe(true);
    expect(await pending).toMatchObject({ status: 409, body: { code: 'CONCURRENCY_CONFLICT' } });
    const [actions] = await prisma.$queryRaw<{ total: number }[]>`SELECT count(*)::int AS total FROM supplier_meeting_actions WHERE meeting_id = ${created.body.id}::uuid`;
    expect(actions?.total).toBe(0);
  }, 15_000);

  it('lets two operators assign actions on separate meetings to each other concurrently', async () => {
    const meeting = { profileId, title: '交叉分派', scheduledStart: '2026-11-01T09:00:00.000Z', scheduledEnd: '2026-11-01T10:00:00.000Z' };
    const first = await post('/api/v1/supplier-meetings', ownerCookie, meeting).expect(201);
    const second = await post('/api/v1/supplier-meetings', colleagueCookie, meeting).expect(201);
    const firstPath = `/api/v1/supplier-meetings/${first.body.id}/actions`;
    const firstAction = { title: '安排第一项', assigneeUserId: colleagueUserId, dueDate: '2026-11-15' };
    const firstKey = randomUUID();
    const assigned = await prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM supplier_meetings WHERE id IN (${first.body.id}::uuid, ${second.body.id}::uuid) FOR UPDATE`;
      const [backend] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
      const requests = Promise.allSettled([
        post(firstPath, ownerCookie, firstAction, firstKey),
        post(`/api/v1/supplier-meetings/${second.body.id}/actions`, colleagueCookie, { title: '安排第二项', assigneeUserId: ownerUserId, dueDate: '2026-11-15' }),
      ]);
      for (let attempt = 0; attempt < 100; attempt++) {
        const waiters = await prisma.$queryRaw<{ pid: number }[]>`SELECT pid FROM pg_stat_activity WHERE ${backend!.pid} = ANY(pg_blocking_pids(pid)) AND query LIKE '%FROM supplier_meetings%'`;
        if (waiters.length === 2) return { requests, queued: true };
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      return { requests, queued: false };
    });
    const results = await assigned.requests;
    expect(assigned.queued).toBe(true);
    expect(results.map(result => result.status === 'fulfilled' ? { status: result.value.status, body: result.value.body } : result.reason.response)).toMatchObject([
      { status: 201, body: { assigneeUserId: colleagueUserId } }, { status: 201, body: { assigneeUserId: ownerUserId } },
    ]);
    const replay = await post(firstPath, ownerCookie, firstAction, firstKey).expect(201);
    expect(results[0]).toMatchObject({ status: 'fulfilled', value: { body: replay.body } });
    const [count] = await prisma.$queryRaw<{ total: number }[]>`SELECT count(*)::int AS total FROM supplier_meeting_actions WHERE meeting_id = ${first.body.id}::uuid`;
    expect(count?.total).toBe(1);
  }, 15_000);

  it('lets an assignee add a topic while a colleague creates an action on the same meeting', async () => {
    const meeting = { profileId, title: '同会并行', scheduledStart: '2026-11-01T09:00:00.000Z', scheduledEnd: '2026-11-01T10:00:00.000Z' };
    const created = await post('/api/v1/supplier-meetings', ownerCookie, meeting).expect(201);
    const meetingPath = `/api/v1/supplier-meetings/${created.body.id}`;

    async function waitForWaiter(blocker: number, queryFragment: string) {
      for (let attempt = 0; attempt < 100; attempt++) {
        const [waiter] = await prisma.$queryRaw<{ pid: number }[]>`SELECT pid FROM pg_stat_activity WHERE ${blocker} = ANY(pg_blocking_pids(pid)) AND query LIKE ${`%${queryFragment}%`}`;
        if (waiter) return waiter.pid;
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      return undefined;
    }

    const race = await prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM sessions WHERE user_id = ${colleagueUserId}::uuid FOR UPDATE`;
      const [backend] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
      const topic = post(`${meetingPath}/topics`, colleagueCookie, { title: '新增议题' }).then(response => response);
      const topicPid = await waitForWaiter(backend!.pid, 'FROM sessions');
      const action = post(`${meetingPath}/actions`, ownerCookie, { title: '新增行动项', assigneeUserId: colleagueUserId, dueDate: '2026-11-15' }).then(response => response);
      const actionPid = topicPid && await waitForWaiter(topicPid, 'FROM users');
      const [meetingProbe] = await Promise.allSettled([
        prisma.$queryRaw`SELECT id FROM supplier_meetings WHERE id = ${created.body.id}::uuid FOR UPDATE NOWAIT`,
      ]);
      return { topic, action, topicPid, actionPid, meetingProbe };
    });
    const [topic, action] = await Promise.all([race.topic, race.action]);
    expect(race.topicPid).toEqual(expect.any(Number));
    expect(race.actionPid).toEqual(expect.any(Number));
    expect(race.meetingProbe?.status).toBe('fulfilled');
    expect(topic).toMatchObject({ status: 201, body: { title: '新增议题', sequence: 1 } });
    expect(action).toMatchObject({ status: 201, body: { assigneeUserId: colleagueUserId } });
  }, 15_000);
});
