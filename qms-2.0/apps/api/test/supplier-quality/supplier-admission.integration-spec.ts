import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../../src/app.module.js';
import { SupplierAdmissionModule } from '../../src/modules/supplier-admission/supplier-admission.module.js';
import { PrismaService } from '../../src/database/prisma.service.js';
import { SessionService } from '../../src/modules/identity/session.service.js';
import { GlobalExceptionFilter } from '../../src/common/contracts/global-exception.filter.js';

if (!process.env.DATABASE_URL || process.env.QMS_DISPOSABLE_TEST_DB !== 'true') throw new Error('Supplier admission tests require a disposable PostgreSQL database.');

describe('supplier admission quality documents', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const suffix = randomUUID();
  const csrf = randomUUID();
  const organizations: string[] = [];
  const users: { id: string; cookie: string }[] = [];
  let profileId: string;

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule, SupplierAdmissionModule] }).compile();
    app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init();
    prisma = app.get(PrismaService);
    for (const [index, accountType] of (['INTERNAL', 'SUPPLIER', 'INTERNAL', 'SUPPLIER'] as const).entries()) {
      const organization = await prisma.organization.create({ data: { code: `SA-${index}-${suffix}`, name: `C3 测试组织 ${index}`, type: accountType } });
      organizations.push(organization.id);
      const user = await prisma.user.create({ data: { organizationId: organization.id, username: `sa-${index}-${suffix}`, accountType, passwordHash: 'unused-test-hash' } });
      const role = await prisma.role.create({ data: { organizationId: organization.id, code: 'SA_TEST', name: 'C3 测试授权' } });
      const permissions = accountType === 'INTERNAL'
        ? ['supplier-admission:documents:read', 'supplier-admission:documents:review']
        : ['supplier-admission:submissions:read', 'supplier-admission:submissions:write'];
      for (const code of permissions) {
        const permission = await prisma.permission.upsert({ where: { code }, create: { code, name: code }, update: {} });
        await prisma.rolePermission.create({ data: { roleId: role.id, permissionId: permission.id } });
      }
      await prisma.userRole.create({ data: { userId: user.id, roleId: role.id, organizationId: organization.id } });
      users.push({ id: user.id, cookie: `qms_session=${await app.get(SessionService).create(user.id, prisma, { reauthenticated: true })}; qms_csrf=${csrf}` });
    }
    const profile = await prisma.supplierBusinessProfile.create({ data: { ownerOrganizationId: organizations[0]!, supplierOrganizationId: organizations[1]!, businessCode: `SA-${suffix}`, displayName: '供应商甲' } });
    profileId = profile.id;
  });

  afterAll(async () => { await app?.close(); });

  function post(user: number, path: string, body: object, key = randomUUID()) {
    return request(app.getHttpServer()).post(`/api/v1/${path}`).set('Cookie', users[user]!.cookie).set('x-csrf-token', csrf).set('Idempotency-Key', key).send(body);
  }

  async function createDocument() {
    const result = await post(1, 'supplier-portal/quality-documents', { profileId, documentType: 'QUALITY_MANUAL', title: '质量手册' }).expect(201);
    expect(result.body).toMatchObject({ profileId, status: 'DRAFT', version: 1 });
    return result.body as { id: string; version: number };
  }

  async function file(documentId: string, scanStatus: 'PENDING' | 'CLEAN') {
    return prisma.fileObject.create({ data: {
      organizationId: organizations[1]!, resourceType: 'supplier-admission', resourceId: documentId,
      resourceVersion: 1, uploadedById: users[1]!.id, objectKey: randomUUID(), originalName: 'quality.pdf',
      contentType: 'application/pdf', sizeBytes: 12, sha256: 'a'.repeat(64),
      verifiedSha256: scanStatus === 'CLEAN' ? 'a'.repeat(64) : null,
      verifiedContentType: scanStatus === 'CLEAN' ? 'application/pdf' : null,
      verifiedSizeBytes: scanStatus === 'CLEAN' ? 12 : null,
      objectVersionId: 'supplier-admission-test-version', uploadCompletedAt: new Date(),
      uploadExpiresAt: new Date(Date.now() + 60_000), scannedAt: scanStatus === 'CLEAN' ? new Date() : null,
      scannerEngine: scanStatus === 'CLEAN' ? 'ClamAV test' : null, scanStatus,
      status: scanStatus === 'CLEAN' ? 'AVAILABLE' : 'QUARANTINED', retainUntil: new Date(Date.now() + 86_400_000),
    } });
  }

  it('keeps the supplier draft and internal review in their own organizations', async () => {
    const document = await createDocument();
    await request(app.getHttpServer()).get(`/api/v1/supplier-portal/quality-documents/${document.id}`).set('Cookie', users[3]!.cookie).expect(404);
    await request(app.getHttpServer()).get(`/api/v1/supplier-admission/quality-documents/${document.id}`).set('Cookie', users[2]!.cookie).expect(404);
    await request(app.getHttpServer()).get(`/api/v1/supplier-admission/quality-documents/${document.id}`).set('Cookie', users[0]!.cookie).expect(200);
    await post(3, `supplier-portal/quality-documents/${document.id}/submit`, { expectedVersion: 1, fileId: randomUUID() }).expect(404);
  });

  it('requires an available scanned file, tracks review issues, and enforces CAS and replay', async () => {
    const document = await createDocument();
    const pending = await file(document.id, 'PENDING');
    await post(1, `supplier-portal/quality-documents/${document.id}/submit`, { expectedVersion: 1, fileId: pending.id }).expect(409);
    const clean = await file(document.id, 'CLEAN');
    const submitKey = randomUUID();
    const submitted = await post(1, `supplier-portal/quality-documents/${document.id}/submit`, { expectedVersion: 1, fileId: clean.id }, submitKey).expect(201);
    expect(submitted.body).toMatchObject({ status: 'SUBMITTED', version: 2, fileId: clean.id });
    await post(1, `supplier-portal/quality-documents/${document.id}/submit`, { expectedVersion: 1, fileId: clean.id }, submitKey).expect(201);
    await post(1, `supplier-portal/quality-documents/${document.id}/submit`, { expectedVersion: 1, fileId: pending.id }, submitKey).expect(409);
    await post(0, `supplier-admission/quality-documents/${document.id}/review`, { expectedVersion: 1, decision: 'ACCEPTED', note: '通过' }).expect(409);
    const returned = await post(0, `supplier-admission/quality-documents/${document.id}/review`, { expectedVersion: 2, decision: 'NEEDS_CHANGES', note: '请补充签章页' }).expect(201);
    expect(returned.body).toMatchObject({ status: 'NEEDS_CHANGES', version: 3, reviewNote: '请补充签章页' });
    const correction = await file(document.id, 'CLEAN');
    const resubmitted = await post(1, `supplier-portal/quality-documents/${document.id}/submit`, { expectedVersion: 3, fileId: correction.id }).expect(201);
    expect(resubmitted.body).toMatchObject({ status: 'SUBMITTED', version: 4, fileId: correction.id });
    const accepted = await post(0, `supplier-admission/quality-documents/${document.id}/review`, { expectedVersion: 4, decision: 'ACCEPTED', note: '资料齐全' }).expect(201);
    expect(accepted.body).toMatchObject({ status: 'ACCEPTED', version: 5 });
    await post(1, `supplier-portal/quality-documents/${document.id}/submit`, { expectedVersion: 5, fileId: correction.id }).expect(409);
    const detail = await request(app.getHttpServer()).get(`/api/v1/supplier-portal/quality-documents/${document.id}`).set('Cookie', users[1]!.cookie).expect(200);
    expect(detail.body.events.map((event: { eventType: string }) => event.eventType)).toEqual(['CREATED', 'SUBMITTED', 'NEEDS_CHANGES', 'SUBMITTED', 'ACCEPTED']);
    expect(await prisma.auditEvent.count({ where: { resourceId: document.id, action: { startsWith: 'SUPPLIER_ADMISSION_' } } })).toBe(5);
  });
});
