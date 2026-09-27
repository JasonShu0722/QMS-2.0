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
if (!databaseUrl || process.env.QMS_DISPOSABLE_TEST_DB !== 'true' || new URL(databaseUrl).port === '55440') {
  throw new Error('Supplier performance requires an independent disposable PostgreSQL database');
}

describe('supplier performance scorecards on PostgreSQL and HTTP', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const ownerId = randomUUID();
  const otherOwnerId = randomUUID();
  const supplierId = randomUUID();
  const otherSupplierId = randomUUID();
  const ownerUserId = randomUUID();
  const otherUserId = randomUUID();
  const ownerRoleId = randomUUID();
  const otherRoleId = randomUUID();
  const supplierUserId = randomUUID();
  const otherSupplierUserId = randomUUID();
  const supplierRoleId = randomUUID();
  const otherSupplierRoleId = randomUUID();
  const profileId = randomUUID();
  const firstInspectionId = randomUUID();
  const secondInspectionId = randomUUID();
  const csrf = randomUUID();
  let ownerCookie: string;
  let otherCookie: string;
  let supplierCookie: string;
  let otherSupplierCookie: string;

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init();
    prisma = app.get(PrismaService);
    for (const [id, type] of [[ownerId, 'INTERNAL'], [otherOwnerId, 'INTERNAL'], [supplierId, 'SUPPLIER'], [otherSupplierId, 'SUPPLIER']] as const) {
      await prisma.organization.create({ data: { id, code: `PERF-${id.slice(0, 8)}`, name: type, type } });
    }
    for (const [userId, organizationId, roleId] of [[ownerUserId, ownerId, ownerRoleId], [otherUserId, otherOwnerId, otherRoleId]]) {
      await prisma.user.create({ data: { id: userId, organizationId, username: `perf-${userId.slice(0, 8)}`, accountType: 'INTERNAL', passwordHash: 'test-only' } });
      await prisma.role.create({ data: { id: roleId, organizationId, code: 'PERFORMANCE', name: 'Performance' } });
      for (const code of ['supplier-performance:cards:read', 'supplier-performance:cards:write', 'supplier-performance:cards:publish', 'supplier-performance:appeals:read', 'supplier-performance:appeals:write', 'supplier-performance:appeals:review', 'supplier-quality:profiles:read', 'supplier-incoming:inspections:read']) {
        const permission = await prisma.permission.upsert({ where: { code }, create: { code, name: code }, update: {} });
        await prisma.rolePermission.create({ data: { roleId, permissionId: permission.id } });
      }
      await prisma.userRole.create({ data: { userId, organizationId, roleId } });
    }
    ownerCookie = `qms_session=${await app.get(SessionService).create(ownerUserId, prisma, { reauthenticated: true })}; qms_csrf=${csrf}`;
    otherCookie = `qms_session=${await app.get(SessionService).create(otherUserId, prisma, { reauthenticated: true })}; qms_csrf=${csrf}`;
    for (const [userId, organizationId, roleId] of [[supplierUserId, supplierId, supplierRoleId], [otherSupplierUserId, otherSupplierId, otherSupplierRoleId]]) {
      await prisma.user.create({ data: { id: userId, organizationId, username: `perf-${userId.slice(0, 8)}`, accountType: 'SUPPLIER', passwordHash: 'test-only' } });
      await prisma.role.create({ data: { id: roleId, organizationId, code: 'PERFORMANCE_PORTAL', name: 'Performance portal' } });
      for (const code of ['supplier-performance:portal:cards:read', 'supplier-performance:portal:appeals:read', 'supplier-performance:portal:appeals:write']) {
        const permission = await prisma.permission.upsert({ where: { code }, create: { code, name: code }, update: {} });
        await prisma.rolePermission.create({ data: { roleId, permissionId: permission.id } });
      }
      await prisma.userRole.create({ data: { userId, organizationId, roleId } });
    }
    supplierCookie = `qms_session=${await app.get(SessionService).create(supplierUserId, prisma, { reauthenticated: true })}; qms_csrf=${csrf}`;
    otherSupplierCookie = `qms_session=${await app.get(SessionService).create(otherSupplierUserId, prisma, { reauthenticated: true })}; qms_csrf=${csrf}`;
    await prisma.supplierBusinessProfile.create({ data: { id: profileId, ownerOrganizationId: ownerId, supplierOrganizationId: supplierId, businessCode: 'PERF-01', displayName: '绩效供应商' } });
    for (const [id, conclusion] of [[firstInspectionId, 'PASS'], [secondInspectionId, 'NG']] as const) {
      await prisma.$executeRaw`
        INSERT INTO supplier_incoming_inspections (
          id, owner_organization_id, profile_id, supplier_organization_id, supplier_business_code, supplier_name,
          material_code, incoming_batch, received_quantity, sampled_quantity, conclusion, status, inspector_id,
          source_system, source_snapshot, inspected_at, created_by_id
        ) VALUES (
          ${id}::uuid, ${ownerId}::uuid, ${profileId}::uuid, ${supplierId}::uuid, 'PERF-01', '绩效供应商',
          'MAT-01', ${id}, 100, 10, ${conclusion}, 'COMPLETED', ${ownerUserId}::uuid,
          'MANUAL', '{}'::jsonb, ${new Date('2026-09-15T12:00:00Z')}, ${ownerUserId}::uuid
        )`;
    }
  }, 30_000);

  afterAll(async () => {
    if (prisma) {
      await prisma.$executeRaw`DELETE FROM supplier_performance_appeals WHERE owner_organization_id = ${ownerId}::uuid`;
      await prisma.$executeRaw`DELETE FROM supplier_performance_cards WHERE owner_organization_id = ${ownerId}::uuid`;
      await prisma.$executeRaw`DELETE FROM supplier_incoming_inspections WHERE owner_organization_id = ${ownerId}::uuid`;
      await prisma.supplierBusinessProfile.deleteMany({ where: { ownerOrganizationId: ownerId } });
      await prisma.adminMutation.deleteMany({ where: { organizationId: { in: [ownerId, otherOwnerId] } } });
      await prisma.auditEvent.deleteMany({ where: { organizationId: { in: [ownerId, otherOwnerId] } } });
      await prisma.userRole.deleteMany({ where: { roleId: { in: [ownerRoleId, otherRoleId, supplierRoleId, otherSupplierRoleId] } } });
      await prisma.role.deleteMany({ where: { id: { in: [ownerRoleId, otherRoleId, supplierRoleId, otherSupplierRoleId] } } });
      await prisma.session.deleteMany({ where: { userId: { in: [ownerUserId, otherUserId, supplierUserId, otherSupplierUserId] } } });
      await prisma.user.deleteMany({ where: { id: { in: [ownerUserId, otherUserId, supplierUserId, otherSupplierUserId] } } });
      await prisma.organization.deleteMany({ where: { id: { in: [ownerId, otherOwnerId, supplierId, otherSupplierId] } } });
    }
    await app?.close();
  }, 30_000);

  const input = { profileId, month: '2026-09', cooperationScore: 90, cooperationNote: '按期回复并完成整改', incomingWeight: 60, cooperationWeight: 40 };
  function create(cookie: string, body: object, key = randomUUID()) {
    return request(app.getHttpServer()).post('/api/v1/supplier-performance/cards').set('Cookie', cookie).set('x-csrf-token', csrf).set('Idempotency-Key', key).send(body);
  }

  it('calculates and persists a scoped, auditable scorecard with idempotent replay', async () => {
    const key = randomUUID();
    const created = await create(ownerCookie, input, key).expect(201);
    expect(created.body).toMatchObject({ supplierName: '绩效供应商', month: '2026-09', inspectionCount: 2, passCount: 1, incomingScore: 50, cooperationScore: 90, totalScore: 66 });
    expect(created.body.sourceInspections).toEqual(expect.arrayContaining([{ id: firstInspectionId, version: 1, conclusion: 'PASS' }, { id: secondInspectionId, version: 1, conclusion: 'NG' }]));
    expect((await create(ownerCookie, input, key).expect(201)).body).toEqual(created.body);
    await create(ownerCookie, input).expect(409);
    expect(await prisma.auditEvent.count({ where: { resourceId: created.body.id, action: 'SUPPLIER_PERFORMANCE_CARD_CREATED' } })).toBe(1);
    const ownerPage = await request(app.getHttpServer()).get('/api/v1/supplier-performance/cards').set('Cookie', ownerCookie).expect(200);
    expect(ownerPage.body).toMatchObject({ total: 1, items: [{ id: created.body.id, totalScore: 66 }] });
    const otherPage = await request(app.getHttpServer()).get('/api/v1/supplier-performance/cards').set('Cookie', otherCookie).expect(200);
    expect(otherPage.body).toMatchObject({ total: 0, items: [] });
    await prisma.$executeRaw`UPDATE supplier_incoming_inspections SET conclusion = 'PASS', version = 2 WHERE id = ${secondInspectionId}::uuid`;
    const historical = await request(app.getHttpServer()).get('/api/v1/supplier-performance/cards').set('Cookie', ownerCookie).expect(200);
    expect(historical.body.items[0]).toMatchObject({ passCount: 1, totalScore: 66 });
    expect(historical.body.items[0].sourceInspections).toContainEqual({ id: secondInspectionId, version: 1, conclusion: 'NG' });
  });

  it('rejects cross-organization profile access and empty source months', async () => {
    await create(otherCookie, input).expect(404);
    await create(ownerCookie, { ...input, month: '2026-10' }).expect(400);
    await request(app.getHttpServer()).get(`/api/v1/supplier-performance/cards?organizationId=${otherOwnerId}`).set('Cookie', ownerCookie).expect(403);
  });

  it('publishes by CAS and exposes only published cards to the matched supplier organization', async () => {
    const card = await prisma.$queryRaw<{ id: string }[]>`SELECT id FROM supplier_performance_cards WHERE owner_organization_id = ${ownerId}::uuid LIMIT 1`;
    const id = card[0]!.id;
    const portal = '/api/v1/supplier-portal/performance/cards';
    await request(app.getHttpServer()).get(portal).set('Cookie', supplierCookie).expect(200).expect(({ body }) => expect(body).toMatchObject({ total: 0, items: [] }));
    await request(app.getHttpServer()).post('/api/v1/supplier-portal/performance/appeals').set('Cookie', supplierCookie).set('x-csrf-token', csrf).set('Idempotency-Key', randomUUID()).send({ cardId: id, reason: '未发布申诉' }).expect(404);
    const publish = () => request(app.getHttpServer()).put(`/api/v1/supplier-performance/cards/${id}/publish`).set('Cookie', ownerCookie).set('x-csrf-token', csrf);
    await request(app.getHttpServer()).put(`/api/v1/supplier-performance/cards/${id}/publish`).set('Cookie', otherCookie).set('x-csrf-token', csrf).set('Idempotency-Key', randomUUID()).send({ organizationId: ownerId, expectedVersion: 1 }).expect(403);
    await publish().set('Idempotency-Key', randomUUID()).send({ expectedVersion: 2 }).expect(409);
    const key = randomUUID();
    const published = await publish().set('Idempotency-Key', key).send({ expectedVersion: 1 }).expect(200);
    expect(published.body).toMatchObject({ id, status: 'PUBLISHED', version: 2 });
    expect(published.body.publishedAt).toEqual(expect.any(String));
    expect((await publish().set('Idempotency-Key', key).send({ expectedVersion: 1 }).expect(200)).body).toEqual(published.body);
    await publish().set('Idempotency-Key', key).send({ expectedVersion: 2 }).expect(409);
    await publish().set('Idempotency-Key', randomUUID()).send({ expectedVersion: 1 }).expect(409);
    await request(app.getHttpServer()).get(portal).set('Cookie', supplierCookie).expect(200).expect(({ body }) => expect(body).toMatchObject({ total: 1, items: [{ id, status: 'PUBLISHED' }] }));
    await request(app.getHttpServer()).get(portal).set('Cookie', otherSupplierCookie).expect(200).expect(({ body }) => expect(body).toMatchObject({ total: 0, items: [] }));
    await request(app.getHttpServer()).get(`${portal}?organizationId=${otherSupplierId}`).set('Cookie', supplierCookie).expect(403);
    await request(app.getHttpServer()).get(portal).set('Cookie', ownerCookie).expect(403);
    expect(await prisma.auditEvent.count({ where: { resourceId: id, action: 'SUPPLIER_PERFORMANCE_CARD_PUBLISHED' } })).toBe(1);
    const publishPermission = await prisma.permission.findUniqueOrThrow({ where: { code: 'supplier-performance:cards:publish' } });
    await prisma.rolePermission.delete({ where: { roleId_permissionId: { roleId: ownerRoleId, permissionId: publishPermission.id } } });
    await publish().set('Idempotency-Key', key).send({ expectedVersion: 1 }).expect(403);
    await prisma.rolePermission.create({ data: { roleId: ownerRoleId, permissionId: publishPermission.id } });
  });

  it('enforces published card and supplier identity constraints in PostgreSQL', async () => {
    const card = await prisma.$queryRaw<{ id: string }[]>`SELECT id FROM supplier_performance_cards WHERE owner_organization_id = ${ownerId}::uuid LIMIT 1`;
    const id = card[0]!.id;
    await expect(prisma.$executeRaw`UPDATE supplier_performance_cards SET status = 'DRAFT' WHERE id = ${id}::uuid`).rejects.toThrow();
    await expect(prisma.$executeRaw`
      INSERT INTO supplier_performance_appeals (id, owner_organization_id, card_id, supplier_organization_id, reason, created_by_id)
      VALUES (${randomUUID()}::uuid, ${ownerId}::uuid, ${id}::uuid, ${otherSupplierId}::uuid, '跨企业伪造', ${otherSupplierUserId}::uuid)
    `).rejects.toThrow();
  });

  it('lets only the matched supplier create and submit an appeal, with isolated listing and review', async () => {
    const card = await prisma.$queryRaw<{ id: string }[]>`SELECT id FROM supplier_performance_cards WHERE owner_organization_id = ${ownerId}::uuid LIMIT 1`;
    const id = card[0]!.id;
    const endpoint = '/api/v1/supplier-portal/performance/appeals';
    const body = { cardId: id, reason: '请复核评分' };
    await request(app.getHttpServer()).post(endpoint).set('Cookie', otherSupplierCookie).set('x-csrf-token', csrf).set('Idempotency-Key', randomUUID()).send(body).expect(404);
    const key = randomUUID();
    const createAppeal = () => request(app.getHttpServer()).post(endpoint).set('Cookie', supplierCookie).set('x-csrf-token', csrf).set('Idempotency-Key', key).send(body);
    const appeal = await createAppeal().expect(201);
    expect(appeal.body).toMatchObject({ cardId: id, supplierOrganizationId: supplierId, status: 'DRAFT', version: 1 });
    expect((await createAppeal().expect(201)).body).toEqual(appeal.body);
    const writePermission = await prisma.permission.findUniqueOrThrow({ where: { code: 'supplier-performance:portal:appeals:write' } });
    await prisma.rolePermission.delete({ where: { roleId_permissionId: { roleId: supplierRoleId, permissionId: writePermission.id } } });
    await createAppeal().expect(403);
    await prisma.rolePermission.create({ data: { roleId: supplierRoleId, permissionId: writePermission.id } });
    await request(app.getHttpServer()).get(endpoint).set('Cookie', otherSupplierCookie).expect(200).expect(({ body: page }) => expect(page).toMatchObject({ total: 0, items: [] }));
    await request(app.getHttpServer()).get(endpoint).set('Cookie', supplierCookie).expect(200).expect(({ body: page }) => expect(page).toMatchObject({ total: 1, items: [{ id: appeal.body.id }] }));
    await request(app.getHttpServer()).put(`${endpoint}/${appeal.body.id}/submit`).set('Cookie', otherSupplierCookie).set('x-csrf-token', csrf).set('Idempotency-Key', randomUUID()).send({ expectedVersion: 1 }).expect(409);
    const submitted = await request(app.getHttpServer()).put(`${endpoint}/${appeal.body.id}/submit`).set('Cookie', supplierCookie).set('x-csrf-token', csrf).set('Idempotency-Key', randomUUID()).send({ expectedVersion: 1 }).expect(200);
    expect(submitted.body).toMatchObject({ status: 'SUBMITTED', version: 2 });
    await request(app.getHttpServer()).put(`${endpoint}/${appeal.body.id}/submit`).set('Cookie', supplierCookie).set('x-csrf-token', csrf).set('Idempotency-Key', randomUUID()).send({ expectedVersion: 1 }).expect(409);
    await request(app.getHttpServer()).put(`/api/v1/supplier-performance/appeals/${appeal.body.id}/review`).set('Cookie', supplierCookie).set('x-csrf-token', csrf).set('Idempotency-Key', randomUUID()).send({ expectedVersion: 2, decision: 'ACCEPTED' }).expect(403);
    await request(app.getHttpServer()).put(`/api/v1/supplier-performance/appeals/${appeal.body.id}/review`).set('Cookie', ownerCookie).set('x-csrf-token', csrf).set('Idempotency-Key', randomUUID()).send({ expectedVersion: 2, decision: 'REJECTED', note: '维持评分' }).expect(200);
    expect(await prisma.auditEvent.count({ where: { resourceId: appeal.body.id, action: { in: ['SUPPLIER_PERFORMANCE_APPEAL_CREATED', 'SUPPLIER_PERFORMANCE_APPEAL_SUBMITTED', 'SUPPLIER_PERFORMANCE_APPEAL_REJECTED'] } } })).toBe(3);
  });

  it('supports an auditable appeal lifecycle with compare-and-set transitions', async () => {
    const card = await prisma.$queryRaw<{ id: string }[]>`SELECT id FROM supplier_performance_cards WHERE owner_organization_id = ${ownerId}::uuid LIMIT 1`;
    const appeal = await request(app.getHttpServer())
      .post('/api/v1/supplier-performance/appeals')
      .set('Cookie', ownerCookie).set('x-csrf-token', csrf).set('Idempotency-Key', randomUUID())
      .send({ cardId: card[0]!.id, reason: '请复核该月来料结论' }).expect(201);
    expect(appeal.body).toMatchObject({ cardId: card[0]!.id, status: 'DRAFT', version: 1 });
    await request(app.getHttpServer())
      .put(`/api/v1/supplier-performance/appeals/${appeal.body.id}/submit`)
      .set('Cookie', ownerCookie).set('x-csrf-token', csrf).set('Idempotency-Key', randomUUID())
      .send({ expectedVersion: 1 }).expect(200).expect(({ body }) => expect(body).toMatchObject({ status: 'SUBMITTED', version: 2 }));
    await request(app.getHttpServer())
      .put(`/api/v1/supplier-performance/appeals/${appeal.body.id}/review`)
      .set('Cookie', ownerCookie).set('x-csrf-token', csrf).set('Idempotency-Key', randomUUID())
      .send({ expectedVersion: 2, decision: 'ACCEPTED', note: '复核通过' }).expect(200)
      .expect(({ body }) => expect(body).toMatchObject({ status: 'ACCEPTED', version: 3, decisionNote: '复核通过' }));
    await request(app.getHttpServer()).get('/api/v1/supplier-performance/appeals').set('Cookie', ownerCookie).expect(200)
      .expect(({ body }) => { expect(body.total).toBe(2); expect(body.items).toEqual(expect.arrayContaining([expect.objectContaining({ id: appeal.body.id, status: 'ACCEPTED' })])); });
    await request(app.getHttpServer()).get('/api/v1/supplier-performance/appeals').set('Cookie', otherCookie).expect(200)
      .expect(({ body }) => expect(body).toMatchObject({ total: 0, items: [] }));
  });
});
