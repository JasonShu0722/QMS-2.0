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
const basePath = '/api/v1/supplier-concessions';
if (!databaseUrl || process.env.QMS_DISPOSABLE_TEST_DB !== 'true' || new URL(databaseUrl).port === '55440') {
  throw new Error('Supplier concession requires an independent disposable PostgreSQL database');
}

describe('supplier concession on PostgreSQL and HTTP', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const ownerId = randomUUID();
  const otherOwnerId = randomUUID();
  const supplierId = randomUUID();
  const applicantId = randomUUID();
  const approverId = randomUUID();
  const otherUserId = randomUUID();
  const applicantRoleId = randomUUID();
  const approverRoleId = randomUUID();
  const otherRoleId = randomUUID();
  const profileId = randomUUID();
  const inspectionId = randomUUID();
  const secondInspectionId = randomUUID();
  const csrf = randomUUID();
  let applicantCookie: string;
  let approverCookie: string;
  let otherCookie: string;

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init();
    prisma = app.get(PrismaService);
    for (const [id, type] of [[ownerId, 'INTERNAL'], [otherOwnerId, 'INTERNAL'], [supplierId, 'SUPPLIER']] as const) {
      await prisma.organization.create({ data: { id, code: `CON-${id.slice(0, 8)}`, name: type, type } });
    }
    for (const [userId, organizationId, roleId, permissions] of [
      [applicantId, ownerId, applicantRoleId, ['supplier-concession:requests:read', 'supplier-concession:requests:write', 'supplier-concession:requests:approve', 'supplier-incoming:inspections:read']],
      [approverId, ownerId, approverRoleId, ['supplier-concession:requests:read', 'supplier-concession:requests:approve', 'supplier-concession:requests:release', 'supplier-incoming:inspections:read']],
      [otherUserId, otherOwnerId, otherRoleId, ['supplier-concession:requests:read', 'supplier-concession:requests:write', 'supplier-concession:requests:approve', 'supplier-concession:requests:release', 'supplier-incoming:inspections:read']],
    ] as const) {
      await prisma.user.create({ data: { id: userId, organizationId, username: `con-${userId.slice(0, 8)}`, accountType: 'INTERNAL', passwordHash: 'test-only' } });
      await prisma.role.create({ data: { id: roleId, organizationId, code: `CON-${roleId.slice(0, 8)}`, name: 'Concession' } });
      for (const code of permissions) {
        const permission = await prisma.permission.upsert({ where: { code }, create: { code, name: code }, update: {} });
        await prisma.rolePermission.create({ data: { roleId, permissionId: permission.id } });
      }
      await prisma.userRole.create({ data: { userId, organizationId, roleId } });
    }
    const sessions = app.get(SessionService);
    applicantCookie = `qms_session=${await sessions.create(applicantId, prisma, { reauthenticated: true })}; qms_csrf=${csrf}`;
    approverCookie = `qms_session=${await sessions.create(approverId, prisma, { reauthenticated: true })}; qms_csrf=${csrf}`;
    otherCookie = `qms_session=${await sessions.create(otherUserId, prisma, { reauthenticated: true })}; qms_csrf=${csrf}`;
    await prisma.supplierBusinessProfile.create({ data: { id: profileId, ownerOrganizationId: ownerId, supplierOrganizationId: supplierId, businessCode: 'CON-01', displayName: '特采供应商' } });
    for (const id of [inspectionId, secondInspectionId]) {
      await prisma.$executeRaw`
        INSERT INTO supplier_incoming_inspections (id, owner_organization_id, profile_id, supplier_organization_id, supplier_business_code, supplier_name,
          material_code, incoming_batch, received_quantity, sampled_quantity, conclusion, status, inspector_id,
          source_system, source_snapshot, inspected_at, created_by_id)
        VALUES (${id}::uuid, ${ownerId}::uuid, ${profileId}::uuid, ${supplierId}::uuid, 'CON-01', '特采供应商',
          'MAT-CON', 'BATCH-CON', 100, 10, 'NG', 'COMPLETED', ${applicantId}::uuid, 'MANUAL', '{}'::jsonb, CURRENT_TIMESTAMP, ${applicantId}::uuid)`;
    }
  }, 30_000);

  afterAll(async () => {
    if (prisma) {
      await prisma.$executeRaw`DELETE FROM supplier_concession_events WHERE request_id IN (SELECT id FROM supplier_concession_requests WHERE owner_organization_id = ${ownerId}::uuid)`;
      await prisma.$executeRaw`DELETE FROM supplier_concession_requests WHERE owner_organization_id = ${ownerId}::uuid`;
      await prisma.$executeRaw`DELETE FROM supplier_incoming_inspections WHERE id IN (${inspectionId}::uuid, ${secondInspectionId}::uuid)`;
      await prisma.supplierBusinessProfile.deleteMany({ where: { id: profileId } });
      await prisma.adminMutation.deleteMany({ where: { organizationId: { in: [ownerId, otherOwnerId] } } });
      await prisma.auditEvent.deleteMany({ where: { organizationId: { in: [ownerId, otherOwnerId] } } });
      await prisma.userRole.deleteMany({ where: { roleId: { in: [applicantRoleId, approverRoleId, otherRoleId] } } });
      await prisma.role.deleteMany({ where: { id: { in: [applicantRoleId, approverRoleId, otherRoleId] } } });
      await prisma.session.deleteMany({ where: { userId: { in: [applicantId, approverId, otherUserId] } } });
      await prisma.user.deleteMany({ where: { id: { in: [applicantId, approverId, otherUserId] } } });
      await prisma.organization.deleteMany({ where: { id: { in: [ownerId, otherOwnerId, supplierId] } } });
    }
    await app?.close();
  }, 30_000);

  function write(cookie: string, path: string, body: object, key = randomUUID()) {
    return request(app.getHttpServer()).post(path).set('Cookie', cookie).set('x-csrf-token', csrf).set('Idempotency-Key', key).send(body);
  }

  it('creates, submits, approves and records one traced batch release', async () => {
    const key = randomUUID();
    const body = { inspectionId, quantity: 20, reason: '偏差评估后限定批次使用', expiresAt: '2027-09-25T10:00:00Z' };
    const created = await write(applicantCookie, '/api/v1/supplier-concessions', body, key).expect(201);
    expect(created.body).toMatchObject({ inspectionId, materialCode: 'MAT-CON', incomingBatch: 'BATCH-CON', quantity: 20, status: 'DRAFT', version: 1 });
    expect((await write(applicantCookie, '/api/v1/supplier-concessions', body, key).expect(201)).body).toEqual(created.body);
    await write(applicantCookie, `/api/v1/supplier-concessions/${created.body.id}/submit`, { expectedVersion: 1 }).expect(201);
    await write(applicantCookie, `/api/v1/supplier-concessions/${created.body.id}/approve`, { expectedVersion: 2, note: '本人审批' }).expect(403);
    await write(approverCookie, `/api/v1/supplier-concessions/${created.body.id}/approve`, { expectedVersion: 2, note: '评估通过' }).expect(201);
    await write(approverCookie, `/api/v1/supplier-concessions/${created.body.id}/release`, { expectedVersion: 3, note: '按限额放行' }).expect(201);
    await write(approverCookie, `/api/v1/supplier-concessions/${created.body.id}/release`, { expectedVersion: 3, note: '重复放行' }).expect(409);
    await write(applicantCookie, `/api/v1/supplier-concessions/${created.body.id}/withdraw`, { expectedVersion: 4 }).expect(409);
    const detail = await request(app.getHttpServer()).get(`/api/v1/supplier-concessions/${created.body.id}`).set('Cookie', applicantCookie).expect(200);
    expect(detail.body).toMatchObject({ status: 'RELEASED', version: 4, events: [{ eventType: 'CREATED' }, { eventType: 'SUBMITTED' }, { eventType: 'APPROVED' }, { eventType: 'RELEASED' }] });
    expect(await prisma.auditEvent.count({ where: { resourceId: created.body.id, action: 'SUPPLIER_CONCESSION_RELEASED' } })).toBe(1);
  });

  it('denies cross-organization access and excessive quantity', async () => {
    await write(otherCookie, '/api/v1/supplier-concessions', { inspectionId, quantity: 1, reason: '跨组织', expiresAt: '2027-09-25T10:00:00Z' }).expect(404);
    await write(applicantCookie, '/api/v1/supplier-concessions', { inspectionId, quantity: 101, reason: '超量', expiresAt: '2027-09-25T10:00:00Z' }).expect(400);
    const page = await request(app.getHttpServer()).get('/api/v1/supplier-concessions').set('Cookie', otherCookie).expect(200);
    expect(page.body.total).toBe(0);
  });

  it('rejects expired applications and stale IQC facts while retaining rejected history', async () => {
    const body = { inspectionId: secondInspectionId, quantity: 10, reason: '限定使用', expiresAt: '2027-09-25T10:00:00Z' };
    await write(applicantCookie, basePath, { ...body, expiresAt: '2020-01-01T00:00:00Z' }).expect(409);
    const created = await write(applicantCookie, basePath, body).expect(201);
    await write(applicantCookie, `${basePath}/${created.body.id}/submit`, { expectedVersion: 2 }).expect(409);
    await write(applicantCookie, `${basePath}/${created.body.id}/submit`, { expectedVersion: 1 }).expect(201);
    await write(approverCookie, `${basePath}/${created.body.id}/reject`, { expectedVersion: 2, note: '风险未关闭' }).expect(201);
    const replacement = await write(applicantCookie, basePath, body).expect(201);
    expect(replacement.body.id).not.toBe(created.body.id);
    await prisma.$executeRaw`UPDATE supplier_incoming_inspections SET conclusion = 'PASS', status = 'CORRECTED', version = 2 WHERE id = ${secondInspectionId}::uuid`;
    await write(applicantCookie, `${basePath}/${replacement.body.id}/submit`, { expectedVersion: 1 }).expect(409);
    await write(applicantCookie, `${basePath}/${replacement.body.id}/withdraw`, { expectedVersion: 1 }).expect(201);
    await prisma.$executeRaw`UPDATE supplier_incoming_inspections SET conclusion = 'NG', version = 3 WHERE id = ${secondInspectionId}::uuid`;
    const reopened = await write(applicantCookie, basePath, body).expect(201);
    expect(reopened.body.inspectionVersion).toBe(3);
    const detail = await request(app.getHttpServer()).get(`${basePath}/${created.body.id}`).set('Cookie', applicantCookie).expect(200);
    expect(detail.body.status).toBe('REJECTED');
  });
});
