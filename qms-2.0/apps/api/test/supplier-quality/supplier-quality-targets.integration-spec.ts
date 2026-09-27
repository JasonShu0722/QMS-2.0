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
if (!databaseUrl || process.env.QMS_DISPOSABLE_TEST_DB !== 'true' || new URL(databaseUrl).port === '55440') throw new Error('Supplier quality targets requires an independent disposable PostgreSQL database');

describe('supplier quality targets on PostgreSQL and HTTP', () => {
  let app: INestApplication; let prisma: PrismaService; let ownerCookie: string; let otherCookie: string;
  const ownerId = randomUUID(); const otherOwnerId = randomUUID(); const supplierId = randomUUID(); const ownerUserId = randomUUID(); const otherUserId = randomUUID(); const ownerRoleId = randomUUID(); const otherRoleId = randomUUID(); const profileId = randomUUID(); const csrf = randomUUID();
  const permissions = ['supplier-quality:targets:read', 'supplier-quality:targets:write', 'supplier-quality:targets:approve', 'supplier-quality:targets:publish', 'supplier-quality:profiles:read'];

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile(); app = module.createNestApplication(); app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true })); app.useGlobalFilters(new GlobalExceptionFilter()); await app.init(); prisma = app.get(PrismaService);
    for (const [id, type] of [[ownerId, 'INTERNAL'], [otherOwnerId, 'INTERNAL'], [supplierId, 'SUPPLIER']] as const) await prisma.organization.create({ data: { id, code: `TARGET-${id.slice(0, 8)}`, name: type, type } });
    for (const [userId, organizationId, roleId] of [[ownerUserId, ownerId, ownerRoleId], [otherUserId, otherOwnerId, otherRoleId]] as const) { await prisma.user.create({ data: { id: userId, organizationId, username: `target-${userId.slice(0, 8)}`, accountType: 'INTERNAL', passwordHash: 'test-only' } }); await prisma.role.create({ data: { id: roleId, organizationId, code: 'TARGET', name: 'Target' } }); for (const code of permissions) { const permission = await prisma.permission.upsert({ where: { code }, create: { code, name: code }, update: {} }); await prisma.rolePermission.create({ data: { roleId, permissionId: permission.id } }); } await prisma.userRole.create({ data: { userId, organizationId, roleId } }); }
    ownerCookie = `qms_session=${await app.get(SessionService).create(ownerUserId, prisma, { reauthenticated: true })}; qms_csrf=${csrf}`; otherCookie = `qms_session=${await app.get(SessionService).create(otherUserId, prisma, { reauthenticated: true })}; qms_csrf=${csrf}`;
    await prisma.supplierBusinessProfile.create({ data: { id: profileId, ownerOrganizationId: ownerId, supplierOrganizationId: supplierId, businessCode: 'TARGET-01', displayName: '目标供应商' } });
  }, 30_000);
  afterAll(async () => { if (prisma) { await prisma.$executeRaw`DELETE FROM supplier_quality_target_actuals WHERE owner_organization_id IN (${ownerId}::uuid, ${otherOwnerId}::uuid)`; await prisma.$executeRaw`DELETE FROM supplier_quality_targets WHERE owner_organization_id IN (${ownerId}::uuid, ${otherOwnerId}::uuid)`; await prisma.supplierBusinessProfile.deleteMany({ where: { ownerOrganizationId: ownerId } }); await prisma.adminMutation.deleteMany({ where: { organizationId: { in: [ownerId, otherOwnerId] } } }); await prisma.auditEvent.deleteMany({ where: { organizationId: { in: [ownerId, otherOwnerId] } } }); await prisma.userRole.deleteMany({ where: { roleId: { in: [ownerRoleId, otherRoleId] } } }); await prisma.role.deleteMany({ where: { id: { in: [ownerRoleId, otherRoleId] } } }); await prisma.session.deleteMany({ where: { userId: { in: [ownerUserId, otherUserId] } } }); await prisma.user.deleteMany({ where: { id: { in: [ownerUserId, otherUserId] } } }); await prisma.organization.deleteMany({ where: { id: { in: [ownerId, otherOwnerId, supplierId] } } }); } await app?.close(); }, 30_000);
  const body = { profileId, periodType: 'ANNUAL', targetYear: 2026, title: '年度质量目标', metrics: { ppm: 500, onTimeDelivery: 98 } };
  function post(path: string, cookie: string, value: object, key = randomUUID()) { return request(app.getHttpServer()).post(path).set('Cookie', cookie).set('x-csrf-token', csrf).set('Idempotency-Key', key).send(value); }

  it('supports annual target lifecycle, revisions, CAS, idempotency, isolation and audit', async () => {
    const key = randomUUID(); const created = await post('/api/v1/supplier-quality-targets', ownerCookie, body, key).expect(201); expect(created.body).toMatchObject({ periodType: 'ANNUAL', targetMonth: null, revision: 1, status: 'DRAFT', version: 1 }); expect((await post('/api/v1/supplier-quality-targets', ownerCookie, body, key).expect(201)).body).toEqual(created.body);
    await post(`/api/v1/supplier-quality-targets/${created.body.id}/submit`, ownerCookie, { expectedVersion: 1 }).expect(201).expect(({ body: result }) => expect(result).toMatchObject({ status: 'SUBMITTED', version: 2 }));
    await post(`/api/v1/supplier-quality-targets/${created.body.id}/approve`, ownerCookie, { expectedVersion: 2, note: '审批通过' }).expect(201).expect(({ body: result }) => expect(result).toMatchObject({ status: 'APPROVED', version: 3 }));
    const published = await post(`/api/v1/supplier-quality-targets/${created.body.id}/publish`, ownerCookie, { expectedVersion: 3, effectiveFrom: '2026-01-01' }).expect(201); expect(published.body).toMatchObject({ status: 'PUBLISHED', version: 4, effectiveFrom: '2026-01-01' });
    await post(`/api/v1/supplier-quality-targets/${created.body.id}/publish`, ownerCookie, { expectedVersion: 3, effectiveFrom: '2026-01-01' }).expect(409);
    const revised = await post(`/api/v1/supplier-quality-targets/${created.body.id}/revise`, ownerCookie, { ...body, title: '年度质量目标 V2', metrics: { ppm: 300 }, expectedVersion: 4 }).expect(201); expect(revised.body).toMatchObject({ revision: 2, status: 'DRAFT', version: 1, title: '年度质量目标 V2' });
    await post(`/api/v1/supplier-quality-targets/${created.body.id}/revise`, ownerCookie, { ...body, title: '重复修订', metrics: { ppm: 200 }, expectedVersion: 4 }).expect(409);
    await post('/api/v1/supplier-quality-targets', ownerCookie, { ...body, targetYear: 2029, metrics: { ppm: '500' } }).expect(400);
    await post('/api/v1/supplier-quality-targets', otherCookie, body).expect(404); const ownerPage = await request(app.getHttpServer()).get('/api/v1/supplier-quality-targets').set('Cookie', ownerCookie).expect(200); expect(ownerPage.body.total).toBe(2); const otherPage = await request(app.getHttpServer()).get('/api/v1/supplier-quality-targets').set('Cookie', otherCookie).expect(200); expect(otherPage.body.total).toBe(0);
    expect(await prisma.auditEvent.count({ where: { organizationId: ownerId, action: { in: ['SUPPLIER_QUALITY_TARGET_CREATED', 'SUPPLIER_QUALITY_TARGET_SUBMITTED', 'SUPPLIER_QUALITY_TARGET_APPROVED', 'SUPPLIER_QUALITY_TARGET_PUBLISHED', 'SUPPLIER_QUALITY_TARGET_REVISED'] } } })).toBe(5);
  });

  it('records annual actuals against the published target version with deviation and immutable history', async () => {
    const target = (await post('/api/v1/supplier-quality-targets', ownerCookie, { ...body, targetYear: 2028 }).expect(201)).body;
    const path = `/api/v1/supplier-quality-targets/${target.id}/actuals`;
    await post(path, ownerCookie, { expectedVersion: 0, metrics: { ppm: 450 } }).expect(409);
    await post(`/api/v1/supplier-quality-targets/${target.id}/submit`, ownerCookie, { expectedVersion: 1 }).expect(201);
    await post(`/api/v1/supplier-quality-targets/${target.id}/approve`, ownerCookie, { expectedVersion: 2 }).expect(201);
    await post(`/api/v1/supplier-quality-targets/${target.id}/publish`, ownerCookie, { expectedVersion: 3, effectiveFrom: '2026-01-01' }).expect(201);
    const firstInput = { expectedVersion: 0, metrics: { ppm: 450, onTimeDelivery: 97 } };
    const key = randomUUID();
    const first = await post(path, ownerCookie, firstInput, key).expect(201);
    expect(first.body).toMatchObject({ targetId: target.id, targetVersion: 4, version: 1, metrics: firstInput.metrics, deviations: { ppm: -50, onTimeDelivery: -1 } });
    expect((await post(path, ownerCookie, firstInput, key).expect(201)).body).toEqual(first.body);
    await post(path, ownerCookie, { expectedVersion: 0, metrics: { ppm: 400 } }).expect(409);
    await post(path, ownerCookie, { expectedVersion: 1, metrics: { ppm: 400, unknown: 10 } }).expect(400);
    await post(path, otherCookie, { expectedVersion: 1, metrics: { ppm: 400 } }).expect(404);
    const second = await post(path, ownerCookie, { expectedVersion: 1, metrics: { ppm: 400, onTimeDelivery: 99 } }).expect(201);
    expect(second.body).toMatchObject({ version: 2, deviations: { ppm: -100, onTimeDelivery: 1 } });
    const history = await request(app.getHttpServer()).get(path).set('Cookie', ownerCookie).expect(200);
    expect(history.body).toMatchObject({ targetId: target.id, latestVersion: 2 });
    expect(history.body.items.map((item: { version: number }) => item.version)).toEqual([2, 1]);
    const paged = await request(app.getHttpServer()).get(`${path}?page=2&pageSize=1`).set('Cookie', ownerCookie).expect(200);
    expect(paged.body).toMatchObject({ latestVersion: 2, total: 2, page: 2, pageSize: 1 });
    expect(paged.body.items.map((item: { version: number }) => item.version)).toEqual([1]);
    await request(app.getHttpServer()).get(path).set('Cookie', otherCookie).expect(404);
    const readPermission = await prisma.permission.findUniqueOrThrow({ where: { code: 'supplier-quality:targets:read' } });
    await prisma.rolePermission.delete({ where: { roleId_permissionId: { roleId: ownerRoleId, permissionId: readPermission.id } } });
    await request(app.getHttpServer()).get(path).set('Cookie', ownerCookie).expect(403);
    await prisma.rolePermission.create({ data: { roleId: ownerRoleId, permissionId: readPermission.id } });
    const writePermission = await prisma.permission.findUniqueOrThrow({ where: { code: 'supplier-quality:targets:write' } });
    await prisma.rolePermission.delete({ where: { roleId_permissionId: { roleId: ownerRoleId, permissionId: writePermission.id } } });
    await post(path, ownerCookie, firstInput, key).expect(403);
    await prisma.rolePermission.create({ data: { roleId: ownerRoleId, permissionId: writePermission.id } });
    expect(await prisma.auditEvent.count({ where: { organizationId: ownerId, action: 'SUPPLIER_QUALITY_TARGET_ACTUAL_RECORDED', resourceId: target.id } })).toBe(2);
  });

  it('records monthly actuals only for numeric metrics on a published monthly target', async () => {
    const monthly = { profileId, periodType: 'MONTHLY', targetYear: 2027, targetMonth: 3, title: '三月目标', metrics: { ppm: 250 } };
    const target = (await post('/api/v1/supplier-quality-targets', ownerCookie, monthly).expect(201)).body;
    const path = `/api/v1/supplier-quality-targets/${target.id}/actuals`;
    await post(`/api/v1/supplier-quality-targets/${target.id}/submit`, ownerCookie, { expectedVersion: 1 }).expect(201);
    await post(`/api/v1/supplier-quality-targets/${target.id}/approve`, ownerCookie, { expectedVersion: 2 }).expect(201);
    await post(`/api/v1/supplier-quality-targets/${target.id}/publish`, ownerCookie, { expectedVersion: 3, effectiveFrom: '2027-03-01' }).expect(201);
    await post(path, ownerCookie, { expectedVersion: 0, metrics: { ppm: '200' } }).expect(400);
    await post(path, ownerCookie, { expectedVersion: 0, metrics: { ppm: 200 }, note: '月末汇总' }).expect(201)
      .expect(({ body: result }) => expect(result).toMatchObject({ targetVersion: 4, version: 1, deviations: { ppm: -50 }, note: '月末汇总' }));
    expect((await request(app.getHttpServer()).get(path).set('Cookie', ownerCookie).expect(200)).body.latestVersion).toBe(1);
  });
});
