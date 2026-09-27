import 'reflect-metadata';
import { createHash, randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../../src/app.module.js';
import { PrismaService } from '../../src/database/prisma.service.js';
import { SessionService } from '../../src/modules/identity/session.service.js';
import { GlobalExceptionFilter } from '../../src/common/contracts/global-exception.filter.js';
import { FileScanWorkerService } from '../../src/modules/file-management/file-scan-worker.service.js';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl || process.env.QMS_DISPOSABLE_TEST_DB !== 'true' || new URL(databaseUrl).port === '55440') throw new Error('Supplier audit requires an independent disposable PostgreSQL database');
for (const name of ['QMS_OBJECT_STORAGE_ENDPOINT', 'QMS_OBJECT_STORAGE_BUCKET', 'QMS_OBJECT_STORAGE_ACCESS_KEY', 'QMS_OBJECT_STORAGE_SECRET_KEY', 'QMS_FILE_SCANNER_HOST', 'QMS_FILE_SCANNER_PORT']) if (!process.env[name]) throw new Error(`Supplier audit evidence requires ${name}`);

describe('supplier audit plan and record', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const suffix = randomUUID();
  const ownerId = randomUUID(); const otherOwnerId = randomUUID(); const supplierId = randomUUID();
  const ownerUserId = randomUUID(); const otherUserId = randomUUID();
  const ownerRoleId = randomUUID(); const otherRoleId = randomUUID(); const profileId = randomUUID(); const csrf = randomUUID();
  let ownerCookie: string; let otherCookie: string;

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init();
    prisma = app.get(PrismaService);
    await prisma.organization.createMany({ data: [
      { id: ownerId, code: 'SAU-O-' + suffix.slice(0, 8), name: '审核方', type: 'INTERNAL' },
      { id: otherOwnerId, code: 'SAU-X-' + suffix.slice(0, 8), name: '其他审核方', type: 'INTERNAL' },
      { id: supplierId, code: 'SAU-S-' + suffix.slice(0, 8), name: '被审核供应商', type: 'SUPPLIER' },
    ] });
    for (const [userId, organizationId, roleId, permissions] of [
      [ownerUserId, ownerId, ownerRoleId, ['supplier-audit:plans:read', 'supplier-audit:plans:write', 'supplier-audit:records:read', 'supplier-audit:records:write', 'supplier-audit:records:close']],
      [otherUserId, otherOwnerId, otherRoleId, ['supplier-audit:plans:read', 'supplier-audit:plans:write', 'supplier-audit:records:read', 'supplier-audit:records:write', 'supplier-audit:records:close']],
    ] as const) {
      await prisma.user.create({ data: { id: userId, organizationId, username: 'sau-' + userId.slice(0, 8), accountType: 'INTERNAL', passwordHash: 'test-only' } });
      await prisma.role.create({ data: { id: roleId, organizationId, code: 'SAU-' + roleId.slice(0, 8), name: '供应商审核测试' } });
      for (const code of permissions) {
        const permission = await prisma.permission.upsert({ where: { code }, create: { code, name: code }, update: {} });
        await prisma.rolePermission.create({ data: { roleId, permissionId: permission.id } });
      }
      await prisma.userRole.create({ data: { userId, organizationId, roleId } });
    }
    await prisma.supplierBusinessProfile.create({ data: { id: profileId, ownerOrganizationId: ownerId, supplierOrganizationId: supplierId, businessCode: 'SAU-' + suffix.slice(0, 8), displayName: '被审核供应商' } });
    const sessions = app.get(SessionService);
    ownerCookie = 'qms_session=' + await sessions.create(ownerUserId, prisma, { reauthenticated: true }) + '; qms_csrf=' + csrf;
    otherCookie = 'qms_session=' + await sessions.create(otherUserId, prisma, { reauthenticated: true }) + '; qms_csrf=' + csrf;
  }, 120_000);

  afterAll(async () => {
    if (prisma) {
      await prisma.$executeRaw`DELETE FROM supplier_audit_record_events WHERE owner_organization_id IN (${ownerId}::uuid, ${otherOwnerId}::uuid)`;
      await prisma.$executeRaw`DELETE FROM supplier_audit_records WHERE owner_organization_id IN (${ownerId}::uuid, ${otherOwnerId}::uuid)`;
      const files = await prisma.fileObject.findMany({ where: { organizationId: { in: [ownerId, otherOwnerId] } }, select: { id: true } });
      await prisma.fileUploadReceipt.deleteMany({ where: { fileId: { in: files.map((file) => file.id) } } });
      await prisma.outboxEvent.deleteMany({ where: { aggregateType: 'FileObject', aggregateId: { in: files.map((file) => file.id) } } });
      await prisma.fileObject.deleteMany({ where: { organizationId: { in: [ownerId, otherOwnerId] } } });
      await prisma.$executeRaw`DELETE FROM supplier_audit_plans WHERE owner_organization_id IN (${ownerId}::uuid, ${otherOwnerId}::uuid)`;
      await prisma.adminMutation.deleteMany({ where: { organizationId: { in: [ownerId, otherOwnerId] } } });
      await prisma.auditEvent.deleteMany({ where: { organizationId: { in: [ownerId, otherOwnerId] } } });
      await prisma.supplierBusinessProfile.deleteMany({ where: { id: profileId } });
      await prisma.userRole.deleteMany({ where: { roleId: { in: [ownerRoleId, otherRoleId] } } });
      await prisma.rolePermission.deleteMany({ where: { roleId: { in: [ownerRoleId, otherRoleId] } } });
      await prisma.role.deleteMany({ where: { id: { in: [ownerRoleId, otherRoleId] } } });
      await prisma.session.deleteMany({ where: { userId: { in: [ownerUserId, otherUserId] } } });
      await prisma.user.deleteMany({ where: { id: { in: [ownerUserId, otherUserId] } } });
      await prisma.organization.deleteMany({ where: { id: { in: [ownerId, otherOwnerId, supplierId] } } });
    }
    await app?.close();
  }, 120_000);

  function write(cookie: string, path: string, body: object, key = randomUUID()) {
    return request(app.getHttpServer()).post(path).set('Cookie', cookie).set('x-csrf-token', csrf).set('Idempotency-Key', key).send(body);
  }

  it('keeps plan and record lifecycle inside the owner organization', async () => {
    const planBody = { profileId, auditYear: 2026, auditType: 'ANNUAL', title: '年度供应商审核', plannedStart: '2026-10-01T00:00:00.000Z', plannedEnd: '2026-10-31T00:00:00.000Z' };
    const planKey = randomUUID();
    const created = await write(ownerCookie, '/api/v1/supplier-audit/plans', planBody, planKey).expect(201);
    expect(created.body).toMatchObject({ profileId, auditYear: 2026, status: 'PLANNED', version: 1 });
    expect((await write(ownerCookie, '/api/v1/supplier-audit/plans', planBody, planKey).expect(201)).body).toEqual(created.body);
    const submittedPlan = await request(app.getHttpServer()).put('/api/v1/supplier-audit/plans/' + created.body.id + '/submit').set('Cookie', ownerCookie).set('x-csrf-token', csrf).set('Idempotency-Key', randomUUID()).send({ expectedVersion: 1 }).expect(200);
    expect(submittedPlan.body).toMatchObject({ status: 'SUBMITTED', version: 2 });

    const record = await write(ownerCookie, '/api/v1/supplier-audit/records', { planId: created.body.id, auditDate: '2026-10-10', auditor: '审核员甲', summary: '现场审核完成', findings: { major: 0, minor: 1 } }).expect(201);
    expect(record.body).toMatchObject({ planId: created.body.id, status: 'DRAFT', version: 1, findings: { major: 0, minor: 1 } });
    const submittedRecord = await request(app.getHttpServer()).put('/api/v1/supplier-audit/records/' + record.body.id + '/submit').set('Cookie', ownerCookie).set('x-csrf-token', csrf).set('Idempotency-Key', randomUUID()).send({ expectedVersion: 1 }).expect(200);
    expect(submittedRecord.body).toMatchObject({ status: 'SUBMITTED', version: 2 });
    const closed = await request(app.getHttpServer()).put('/api/v1/supplier-audit/records/' + record.body.id + '/close').set('Cookie', ownerCookie).set('x-csrf-token', csrf).set('Idempotency-Key', randomUUID()).send({ expectedVersion: 2, conclusion: 'CONDITIONAL', closeNote: '跟踪轻微项整改' }).expect(200);
    expect(closed.body).toMatchObject({ status: 'CLOSED', version: 3, conclusion: 'CONDITIONAL' });
    await request(app.getHttpServer()).put('/api/v1/supplier-audit/records/' + record.body.id + '/close').set('Cookie', ownerCookie).set('x-csrf-token', csrf).set('Idempotency-Key', randomUUID()).send({ expectedVersion: 2, conclusion: 'PASS', closeNote: '过期版本' }).expect(409);

    const plans = await request(app.getHttpServer()).get('/api/v1/supplier-audit/plans').set('Cookie', ownerCookie).expect(200);
    const records = await request(app.getHttpServer()).get('/api/v1/supplier-audit/records').set('Cookie', ownerCookie).expect(200);
    expect(plans.body.total).toBe(1);
    expect(records.body.total).toBe(1);
    const eventCount = await prisma.$queryRaw<{ count: bigint }[]>`SELECT count(*)::bigint AS count FROM supplier_audit_record_events WHERE record_id = ${record.body.id}::uuid`;
    expect(Number(eventCount[0]?.count ?? 0)).toBe(3);
    expect(await prisma.auditEvent.count({ where: { resourceId: record.body.id, action: { startsWith: 'SUPPLIER_AUDIT_RECORD_' } } })).toBe(3);
  });

  it('rejects cross-organization profile references and hides foreign data', async () => {
    await write(otherCookie, '/api/v1/supplier-audit/plans', { profileId, auditYear: 2027, auditType: 'ANNUAL', title: '越权审核', plannedStart: '2027-01-01T00:00:00.000Z', plannedEnd: '2027-01-31T00:00:00.000Z' }).expect(404);
    expect((await request(app.getHttpServer()).get('/api/v1/supplier-audit/plans').set('Cookie', otherCookie).expect(200)).body.total).toBe(0);
    expect((await request(app.getHttpServer()).get('/api/v1/supplier-audit/records').set('Cookie', otherCookie).expect(200)).body.total).toBe(0);
  });

  it('stores structured checklist items with scanned, record-bound evidence and CAS', async () => {
    const plan = await write(ownerCookie, '/api/v1/supplier-audit/plans', { profileId, auditYear: 2028, auditType: 'ANNUAL', title: '现场审核', plannedStart: '2028-10-01T00:00:00.000Z', plannedEnd: '2028-10-31T00:00:00.000Z' }).expect(201);
    await request(app.getHttpServer()).put(`/api/v1/supplier-audit/plans/${plan.body.id}/submit`).set('Cookie', ownerCookie).set('x-csrf-token', csrf).set('Idempotency-Key', randomUUID()).send({ expectedVersion: 1 }).expect(200);
    const record = await write(ownerCookie, '/api/v1/supplier-audit/records', { planId: plan.body.id, auditDate: '2028-10-10', auditor: '审核员乙', summary: '结构化现场检查' }).expect(201);
    const bytes = Buffer.from('Onsite supplier audit evidence.');
    const upload = await write(ownerCookie, '/api/v1/files/uploads', { resourceType: 'supplier-audit-record', resourceId: record.body.id, originalName: '现场证据.txt', contentType: 'text/plain', sizeBytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }).expect(201);
    expect((await fetch(upload.body.uploadUrl, { method: 'PUT', headers: upload.body.headers, body: bytes })).status).toBe(200);
    await write(ownerCookie, `/api/v1/files/${upload.body.file.id}/complete`, { expectedVersion: 1 }).expect(202);
    const body = { expectedVersion: 1, items: [{ code: 'QMS-01', title: '过程控制', result: 'MINOR_NC', note: '批次记录不完整', evidenceFileIds: [upload.body.file.id] }] };
    const endpoint = `/api/v1/supplier-audit/records/${record.body.id}/checklist`;
    const put = (cookie: string, payload: object, key = randomUUID()) => request(app.getHttpServer()).put(endpoint).set('Cookie', cookie).set('x-csrf-token', csrf).set('Idempotency-Key', key).send(payload);
    await put(ownerCookie, body).expect(409);
    expect((await prisma.$queryRaw<{ count: bigint }[]>`SELECT count(*)::bigint AS count FROM supplier_audit_checklist_items WHERE record_id = ${record.body.id}::uuid`)[0]?.count).toBe(0n);
    await app.get(FileScanWorkerService).processDue(100);
    expect((await prisma.fileObject.findUniqueOrThrow({ where: { id: upload.body.file.id } })).scanStatus).toBe('CLEAN');
    const key = randomUUID();
    const saved = await put(ownerCookie, body, key).expect(200);
    expect(saved.body).toMatchObject({ recordId: record.body.id, recordVersion: 2, items: [{ code: 'QMS-01', result: 'MINOR_NC', evidenceFileIds: [upload.body.file.id] }] });
    expect((await put(ownerCookie, body, key).expect(200)).body).toEqual(saved.body);
    await put(ownerCookie, body).expect(409);
    await put(otherCookie, { ...body, expectedVersion: 2 }).expect(404);
    await request(app.getHttpServer()).get(endpoint).set('Cookie', otherCookie).expect(404);
    expect((await request(app.getHttpServer()).get(endpoint).set('Cookie', ownerCookie).expect(200)).body).toEqual(saved.body);
    await request(app.getHttpServer()).get(`/api/v1/files/${upload.body.file.id}`).set('Cookie', otherCookie).expect(403);
    await prisma.fileObject.update({ where: { id: upload.body.file.id }, data: { status: 'QUARANTINED', scanStatus: 'ERROR', scanReason: 'FILE_SCANNER_UNAVAILABLE' } });
    await request(app.getHttpServer()).put(`/api/v1/supplier-audit/records/${record.body.id}/submit`).set('Cookie', ownerCookie).set('x-csrf-token', csrf).set('Idempotency-Key', randomUUID()).send({ expectedVersion: 2 }).expect(409);
    await prisma.fileObject.update({ where: { id: upload.body.file.id }, data: { status: 'AVAILABLE', scanStatus: 'CLEAN', scanReason: null } });
    await request(app.getHttpServer()).put(`/api/v1/supplier-audit/records/${record.body.id}/submit`).set('Cookie', ownerCookie).set('x-csrf-token', csrf).set('Idempotency-Key', randomUUID()).send({ expectedVersion: 2 }).expect(200);
    await prisma.fileObject.update({ where: { id: upload.body.file.id }, data: { status: 'QUARANTINED', scanStatus: 'ERROR', scanReason: 'FILE_SCANNER_UNAVAILABLE' } });
    await request(app.getHttpServer()).put(`/api/v1/supplier-audit/records/${record.body.id}/close`).set('Cookie', ownerCookie).set('x-csrf-token', csrf).set('Idempotency-Key', randomUUID()).send({ expectedVersion: 3, conclusion: 'CONDITIONAL', closeNote: '证据失效' }).expect(409);
    await prisma.fileObject.update({ where: { id: upload.body.file.id }, data: { status: 'AVAILABLE', scanStatus: 'CLEAN', scanReason: null } });
    await request(app.getHttpServer()).put(`/api/v1/supplier-audit/records/${record.body.id}/close`).set('Cookie', ownerCookie).set('x-csrf-token', csrf).set('Idempotency-Key', randomUUID()).send({ expectedVersion: 3, conclusion: 'CONDITIONAL', closeNote: '复核证据后关闭' }).expect(200);
    await put(ownerCookie, { ...body, expectedVersion: 3 }).expect(409);
    await write(ownerCookie, '/api/v1/files/uploads', { resourceType: 'supplier-audit-record', resourceId: record.body.id, originalName: '晚到证据.txt', contentType: 'text/plain', sizeBytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }).expect(403);
    const writePermission = await prisma.permission.findUniqueOrThrow({ where: { code: 'supplier-audit:records:write' } });
    await prisma.rolePermission.deleteMany({ where: { roleId: ownerRoleId, permissionId: writePermission.id } });
    await put(ownerCookie, { ...body, expectedVersion: 3 }).expect(403);
    expect(await prisma.auditEvent.count({ where: { resourceId: record.body.id, action: 'SUPPLIER_AUDIT_RECORD_CHECKLIST_UPDATED' } })).toBe(1);
  });
});
