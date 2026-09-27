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
  let app: INestApplication; let prisma: PrismaService; let ownerCookie: string; let otherCookie: string;
  const ownerId = randomUUID(); const otherOwnerId = randomUUID(); const supplierId = randomUUID(); const ownerUserId = randomUUID(); const otherUserId = randomUUID(); const ownerRoleId = randomUUID(); const otherRoleId = randomUUID(); const profileId = randomUUID(); const csrf = randomUUID();
  const permissions = ['supplier-meetings:read', 'supplier-meetings:write', 'supplier-meetings:conclude', 'supplier-meetings:actions'];

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile(); app = module.createNestApplication(); app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true })); app.useGlobalFilters(new GlobalExceptionFilter()); await app.init(); prisma = app.get(PrismaService);
    for (const [id, type] of [[ownerId, 'INTERNAL'], [otherOwnerId, 'INTERNAL'], [supplierId, 'SUPPLIER']] as const) await prisma.organization.create({ data: { id, code: `MEETING-${id.slice(0, 8)}`, name: type, type } });
    for (const [userId, organizationId, roleId] of [[ownerUserId, ownerId, ownerRoleId], [otherUserId, otherOwnerId, otherRoleId]] as const) { await prisma.user.create({ data: { id: userId, organizationId, username: `meeting-${userId.slice(0, 8)}`, accountType: 'INTERNAL', passwordHash: 'test-only' } }); await prisma.role.create({ data: { id: roleId, organizationId, code: 'MEETING', name: 'Meeting' } }); for (const code of permissions) { const permission = await prisma.permission.upsert({ where: { code }, create: { code, name: code }, update: {} }); await prisma.rolePermission.create({ data: { roleId, permissionId: permission.id } }); } await prisma.userRole.create({ data: { userId, organizationId, roleId } }); }
    ownerCookie = `qms_session=${await app.get(SessionService).create(ownerUserId, prisma, { reauthenticated: true })}; qms_csrf=${csrf}`; otherCookie = `qms_session=${await app.get(SessionService).create(otherUserId, prisma, { reauthenticated: true })}; qms_csrf=${csrf}`;
    await prisma.supplierBusinessProfile.create({ data: { id: profileId, ownerOrganizationId: ownerId, supplierOrganizationId: supplierId, businessCode: 'MEETING-01', displayName: '会议供应商' } });
  }, 30_000);
  afterAll(async () => { if (prisma) { await prisma.$executeRaw`DELETE FROM supplier_meetings WHERE owner_organization_id IN (${ownerId}::uuid, ${otherOwnerId}::uuid)`; await prisma.supplierBusinessProfile.deleteMany({ where: { id: profileId } }); await prisma.adminMutation.deleteMany({ where: { organizationId: { in: [ownerId, otherOwnerId] } } }); await prisma.auditEvent.deleteMany({ where: { organizationId: { in: [ownerId, otherOwnerId] } } }); await prisma.userRole.deleteMany({ where: { roleId: { in: [ownerRoleId, otherRoleId] } } }); await prisma.rolePermission.deleteMany({ where: { roleId: { in: [ownerRoleId, otherRoleId] } } }); await prisma.role.deleteMany({ where: { id: { in: [ownerRoleId, otherRoleId] } } }); await prisma.session.deleteMany({ where: { userId: { in: [ownerUserId, otherUserId] } } }); await prisma.user.deleteMany({ where: { id: { in: [ownerUserId, otherUserId] } } }); await prisma.organization.deleteMany({ where: { id: { in: [ownerId, otherOwnerId, supplierId] } } }); } await app?.close(); }, 30_000);
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
});
