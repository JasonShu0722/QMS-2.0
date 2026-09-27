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
if (!databaseUrl || process.env.QMS_DISPOSABLE_TEST_DB !== 'true' || new URL(databaseUrl).port === '55440') throw new Error('Supplier PPAP requires an independent disposable PostgreSQL database');
for (const name of ['QMS_OBJECT_STORAGE_ENDPOINT', 'QMS_OBJECT_STORAGE_BUCKET', 'QMS_FILE_SCANNER_HOST', 'QMS_FILE_SCANNER_PORT']) if (!process.env[name]) throw new Error(`Supplier PPAP real evidence requires ${name}`);

describe('supplier PPAP on PostgreSQL and HTTP', () => {
  let app: INestApplication; let prisma: PrismaService; let ownerCookie: string; let otherCookie: string;
  const ownerId = randomUUID(); const otherOwnerId = randomUUID(); const supplierId = randomUUID(); const ownerUserId = randomUUID(); const otherUserId = randomUUID(); const ownerRoleId = randomUUID(); const otherRoleId = randomUUID(); const profileId = randomUUID(); const csrf = randomUUID();
  const permissions = ['supplier-ppap:read', 'supplier-ppap:write', 'supplier-ppap:review', 'supplier-quality:profiles:read'];
  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile(); app = module.createNestApplication(); app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true })); app.useGlobalFilters(new GlobalExceptionFilter()); await app.init(); prisma = app.get(PrismaService);
    for (const [id, type] of [[ownerId, 'INTERNAL'], [otherOwnerId, 'INTERNAL'], [supplierId, 'SUPPLIER']] as const) await prisma.organization.create({ data: { id, code: `PPAP-${id.slice(0, 8)}`, name: type, type } });
    for (const [userId, organizationId, roleId] of [[ownerUserId, ownerId, ownerRoleId], [otherUserId, otherOwnerId, otherRoleId]] as const) { await prisma.user.create({ data: { id: userId, organizationId, username: `ppap-${userId.slice(0, 8)}`, accountType: 'INTERNAL', passwordHash: 'test-only' } }); await prisma.role.create({ data: { id: roleId, organizationId, code: 'PPAP', name: 'PPAP' } }); for (const code of permissions) { const permission = await prisma.permission.upsert({ where: { code }, create: { code, name: code }, update: {} }); await prisma.rolePermission.create({ data: { roleId, permissionId: permission.id } }); } await prisma.userRole.create({ data: { userId, organizationId, roleId } }); }
    ownerCookie = `qms_session=${await app.get(SessionService).create(ownerUserId, prisma, { reauthenticated: true })}; qms_csrf=${csrf}`; otherCookie = `qms_session=${await app.get(SessionService).create(otherUserId, prisma, { reauthenticated: true })}; qms_csrf=${csrf}`;
    await prisma.supplierBusinessProfile.create({ data: { id: profileId, ownerOrganizationId: ownerId, supplierOrganizationId: supplierId, businessCode: 'PPAP-01', displayName: 'PPAP供应商' } });
  }, 30_000);
  afterAll(async () => { if (prisma) { await prisma.$executeRaw`DELETE FROM supplier_ppap_packages WHERE owner_organization_id IN (${ownerId}::uuid, ${otherOwnerId}::uuid)`; const files = await prisma.fileObject.findMany({ where: { organizationId: { in: [ownerId, otherOwnerId] } }, select: { id: true } }); await prisma.outboxEvent.deleteMany({ where: { aggregateType: 'FileObject', aggregateId: { in: files.map((file) => file.id) } } }); await prisma.fileUploadReceipt.deleteMany({ where: { fileId: { in: files.map((file) => file.id) } } }); await prisma.fileObject.deleteMany({ where: { id: { in: files.map((file) => file.id) } } }); await prisma.supplierBusinessProfile.deleteMany({ where: { id: profileId } }); await prisma.adminMutation.deleteMany({ where: { organizationId: { in: [ownerId, otherOwnerId] } } }); await prisma.auditEvent.deleteMany({ where: { organizationId: { in: [ownerId, otherOwnerId] } } }); await prisma.userRole.deleteMany({ where: { roleId: { in: [ownerRoleId, otherRoleId] } } }); await prisma.rolePermission.deleteMany({ where: { roleId: { in: [ownerRoleId, otherRoleId] } } }); await prisma.role.deleteMany({ where: { id: { in: [ownerRoleId, otherRoleId] } } }); await prisma.session.deleteMany({ where: { userId: { in: [ownerUserId, otherUserId] } } }); await prisma.user.deleteMany({ where: { id: { in: [ownerUserId, otherUserId] } } }); await prisma.organization.deleteMany({ where: { id: { in: [ownerId, otherOwnerId, supplierId] } } }); } await app?.close(); }, 30_000);
  function post(path: string, cookie: string, value: object, key = randomUUID()) { return request(app.getHttpServer()).post(path).set('Cookie', cookie).set('x-csrf-token', csrf).set('Idempotency-Key', key).send(value); }
  it('supports PPAP package lifecycle, required items, CAS, idempotency and isolation', async () => {
    const body = { profileId, level: 3, title: '新项目 PPAP', partNumber: 'PART-001' }; const key = randomUUID();
    const created = await post('/api/v1/supplier-ppap', ownerCookie, body, key).expect(201); expect(created.body).toMatchObject({ profileId, level: 3, status: 'DRAFT', version: 1 }); expect(created.body.items.length).toBe(18); expect(created.body.items.find((entry: { itemCode: string }) => entry.itemCode === 'PSW')).toMatchObject({ required: true, status: 'PENDING', evidenceFileIds: [] }); expect((await post('/api/v1/supplier-ppap', ownerCookie, body, key).expect(201)).body).toEqual(created.body);
    await post('/api/v1/supplier-ppap', otherCookie, body).expect(404);
    await post(`/api/v1/supplier-ppap/${created.body.id}/submit`, ownerCookie, { expectedVersion: 1 }).expect(409);
    const item = await post(`/api/v1/supplier-ppap/${created.body.id}/items`, ownerCookie, { itemCode: 'CUSTOM', title: '客户指定附件', content: { fileId: 'evidence-1' } }).expect(201); expect(item.body).toMatchObject({ itemCode: 'CUSTOM', status: 'PENDING', version: 1, evidenceFileIds: [] });
    await post(`/api/v1/supplier-ppap/${created.body.id}/items`, ownerCookie, { itemCode: 'PSW', title: '重复' }).expect(409);
    expect((await request(app.getHttpServer()).get('/api/v1/supplier-ppap').set('Cookie', ownerCookie).expect(200)).body.total).toBe(1);
    expect(await prisma.auditEvent.count({ where: { organizationId: ownerId, action: { startsWith: 'SUPPLIER_PPAP_' } } })).toBe(2);
  });
  it('requires real scanned evidence for a Level 1 PSW and rechecks deletion at submit', async () => {
    const created = await post('/api/v1/supplier-ppap', ownerCookie, { profileId, level: 1, title: '一级 PPAP', partNumber: 'PART-002' }).expect(201);
    expect(created.body.items).toMatchObject([{ itemCode: 'PSW', required: true, status: 'PENDING', evidenceFileIds: [] }]);
    const itemId = created.body.items[0].id;
    const bytes = Buffer.from('PPAP part submission warrant evidence.');
    const upload = await post('/api/v1/files/uploads', ownerCookie, { resourceType: 'supplier-ppap-item', resourceId: itemId, originalName: 'psw.txt', contentType: 'text/plain', sizeBytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }).expect(201);
    await post(`/api/v1/supplier-ppap/${created.body.id}/items/${itemId}/evidence`, ownerCookie, { expectedVersion: 1, evidenceFileIds: [upload.body.file.id] }).expect(409);
    expect((await fetch(upload.body.uploadUrl, { method: 'PUT', headers: upload.body.headers, body: bytes })).status).toBe(200);
    await post(`/api/v1/files/${upload.body.file.id}/complete`, ownerCookie, { expectedVersion: 1 }).expect(202);
    await post(`/api/v1/supplier-ppap/${created.body.id}/items/${itemId}/evidence`, ownerCookie, { expectedVersion: 1, evidenceFileIds: [upload.body.file.id] }).expect(409);
    expect(await app.get(FileScanWorkerService).processDue(10)).toMatchObject({ processed: 1 });
    const key = randomUUID();
    const bound = await post(`/api/v1/supplier-ppap/${created.body.id}/items/${itemId}/evidence`, ownerCookie, { expectedVersion: 1, evidenceFileIds: [upload.body.file.id] }, key).expect(201);
    expect(bound.body).toMatchObject({ status: 'PROVIDED', version: 2, evidenceFileIds: [upload.body.file.id] });
    expect((await post(`/api/v1/supplier-ppap/${created.body.id}/items/${itemId}/evidence`, ownerCookie, { expectedVersion: 1, evidenceFileIds: [upload.body.file.id] }, key).expect(201)).body).toEqual(bound.body);
    await post(`/api/v1/supplier-ppap/${created.body.id}/items/${itemId}/evidence`, ownerCookie, { expectedVersion: 1, evidenceFileIds: [upload.body.file.id] }).expect(409);
    await request(app.getHttpServer()).get(`/api/v1/files/${upload.body.file.id}`).set('Cookie', otherCookie).expect(403);
    await post(`/api/v1/files/${upload.body.file.id}/delete`, ownerCookie, { expectedVersion: 3 }).expect(201);
    await post(`/api/v1/supplier-ppap/${created.body.id}/submit`, ownerCookie, { expectedVersion: 1 }).expect(409);
    const bytes2 = Buffer.from('PPAP replacement evidence after deletion.');
    const upload2 = await post('/api/v1/files/uploads', ownerCookie, { resourceType: 'supplier-ppap-item', resourceId: itemId, originalName: 'psw-restored.txt', contentType: 'text/plain', sizeBytes: bytes2.length, sha256: createHash('sha256').update(bytes2).digest('hex') }).expect(201);
    expect((await fetch(upload2.body.uploadUrl, { method: 'PUT', headers: upload2.body.headers, body: bytes2 })).status).toBe(200);
    await post(`/api/v1/files/${upload2.body.file.id}/complete`, ownerCookie, { expectedVersion: 1 }).expect(202);
    expect(await app.get(FileScanWorkerService).processDue(10)).toMatchObject({ processed: 1 });
    await post(`/api/v1/supplier-ppap/${created.body.id}/items/${itemId}/evidence`, ownerCookie, { expectedVersion: 2, evidenceFileIds: [upload2.body.file.id] }).expect(201);
    const submitted = await post(`/api/v1/supplier-ppap/${created.body.id}/submit`, ownerCookie, { expectedVersion: 1 }).expect(201);
    expect(submitted.body.status).toBe('SUBMITTED');
    const itemReview = await post(`/api/v1/supplier-ppap/${created.body.id}/items/${itemId}/review`, ownerCookie, { expectedVersion: 3, decision: 'ACCEPTED', note: '证据核验通过' }).expect(201);
    expect(itemReview.body).toMatchObject({ status: 'ACCEPTED', version: 4, reviewNote: '证据核验通过' });
    const approved = await post(`/api/v1/supplier-ppap/${created.body.id}/review`, ownerCookie, { expectedVersion: 3, decision: 'APPROVED', note: 'PPAP 逐项审核通过' }).expect(201);
    expect(approved.body.status).toBe('APPROVED');
    const requalified = await post(`/api/v1/supplier-ppap/${created.body.id}/requalify`, ownerCookie, { expectedVersion: 4, note: '年度再鉴定通过' }).expect(201);
    expect(requalified.body).toMatchObject({ status: 'APPROVED', version: 5, requalificationNote: '年度再鉴定通过' });
  });
});
