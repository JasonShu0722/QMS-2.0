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
if (!databaseUrl || process.env.QMS_DISPOSABLE_TEST_DB !== 'true' || new URL(databaseUrl).port === '55440') {
  throw new Error('IQC problem integration requires independent disposable PostgreSQL');
}
for (const name of ['QMS_OBJECT_STORAGE_ENDPOINT', 'QMS_OBJECT_STORAGE_BUCKET', 'QMS_OBJECT_STORAGE_ACCESS_KEY', 'QMS_OBJECT_STORAGE_SECRET_KEY', 'QMS_FILE_SCANNER_HOST', 'QMS_FILE_SCANNER_PORT']) {
  if (!process.env[name]) throw new Error(`IQC photo integration requires ${name}`);
}

describe('IQC NG to supplier problem draft', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const owner = randomUUID();
  const otherOwner = randomUUID();
  const supplier = randomUUID();
  const actorId = randomUUID();
  const otherActorId = randomUUID();
  const roleId = randomUUID();
  const otherRoleId = randomUUID();
  const profileId = randomUUID();
  const inspectionId = randomUUID();
  const csrf = randomUUID();
  let cookie: string;
  let otherCookie: string;

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init();
    prisma = app.get(PrismaService);
    for (const [id, type] of [[owner, 'INTERNAL'], [otherOwner, 'INTERNAL'], [supplier, 'SUPPLIER']] as const) {
      await prisma.organization.create({ data: { id, code: `IQC-${id.slice(0, 8)}`, name: `IQC ${type}`, type } });
    }
    for (const [userId, organizationId, assignedRoleId] of [[actorId, owner, roleId], [otherActorId, otherOwner, otherRoleId]]) {
      await prisma.user.create({ data: { id: userId, organizationId, username: `iqc-${userId.slice(0, 8)}`, accountType: 'INTERNAL', passwordHash: 'test-only' } });
      await prisma.role.create({ data: { id: assignedRoleId, organizationId, code: `IQC-${assignedRoleId.slice(0, 8)}`, name: 'IQC' } });
      for (const code of ['supplier-incoming:inspections:read', 'supplier-incoming:inspections:write', 'supplier-quality:problems:write']) {
        const permission = await prisma.permission.upsert({ where: { code }, create: { code, name: code }, update: {} });
        await prisma.rolePermission.create({ data: { roleId: assignedRoleId, permissionId: permission.id } });
      }
      await prisma.userRole.create({ data: { userId, organizationId, roleId: assignedRoleId } });
    }
    const sessions = app.get(SessionService);
    cookie = `qms_session=${await sessions.create(actorId, prisma, { reauthenticated: true })}; qms_csrf=${csrf}`;
    otherCookie = `qms_session=${await sessions.create(otherActorId, prisma, { reauthenticated: true })}; qms_csrf=${csrf}`;
    await prisma.supplierBusinessProfile.create({ data: { id: profileId, ownerOrganizationId: owner, supplierOrganizationId: supplier, businessCode: 'IQC-01', displayName: 'IQC 供应商' } });
    await prisma.$executeRaw`
      INSERT INTO supplier_incoming_inspections (id, owner_organization_id, profile_id, supplier_organization_id, supplier_business_code, supplier_name,
        material_code, incoming_batch, received_quantity, sampled_quantity, conclusion, status, inspector_id,
        source_system, source_snapshot, inspected_at, created_by_id)
      VALUES (${inspectionId}::uuid, ${owner}::uuid, ${profileId}::uuid, ${supplier}::uuid, 'IQC-01', 'IQC 供应商',
        'MAT-IQC', 'BATCH-IQC', 100, 10, 'NG', 'COMPLETED', ${actorId}::uuid, 'MANUAL', '{}'::jsonb, CURRENT_TIMESTAMP, ${actorId}::uuid)`;
  });

  afterAll(async () => { await app?.close(); });

  function trigger(session: string, key: string, expectedVersion = 1) {
    return request(app.getHttpServer()).post(`/api/v1/supplier-incoming/inspections/${inspectionId}/problem-links`)
      .set('Cookie', session).set('x-csrf-token', csrf).set('Idempotency-Key', key)
      .send({ expectedVersion, title: '来料批次检验不合格', defectDescription: '来料批次抽检发现不合格', defectQuantity: 1, severity: 'MEDIUM', responseForm: 'BRIEF', replyMode: 'SUPPLIER' });
  }

  it('creates one audited supplier draft and stable source link with replay and scope protection', async () => {
    await trigger(otherCookie, randomUUID()).expect(404);
    await trigger(cookie, randomUUID(), 99).expect(409);
    expect(await prisma.supplierQualityProblem.count({ where: { ownerOrganizationId: owner } })).toBe(0);
    const key = randomUUID();
    const created = await trigger(cookie, key).expect(201);
    expect(created.body).toMatchObject({ inspection_id: inspectionId, conclusion_snapshot: 'NG' });
    expect((await trigger(cookie, key).expect(201)).body).toEqual(created.body);
    expect((await trigger(cookie, randomUUID()).expect(201)).body.problem_id).toBe(created.body.problem_id);
    await trigger(cookie, key, 2).expect(409);
    expect((await prisma.supplierQualityProblem.findMany({ where: { id: created.body.problem_id } })).length).toBe(1);
    expect((await prisma.$queryRaw<{ count: bigint }[]>`SELECT count(*)::bigint AS count FROM supplier_incoming_problem_links WHERE inspection_id = ${inspectionId}::uuid`)[0]?.count).toBe(1n);
    expect(await prisma.auditEvent.count({ where: { organizationId: owner, resourceId: inspectionId, action: 'SUPPLIER_INCOMING_PROBLEM_LINKED' } })).toBe(1);
    const supplierWrite = await prisma.permission.findUniqueOrThrow({ where: { code: 'supplier-quality:problems:write' } });
    await prisma.rolePermission.delete({ where: { roleId_permissionId: { roleId, permissionId: supplierWrite.id } } });
    await trigger(cookie, key).expect(403);
  });

  it('uploads a photo to real object storage, waits for ClamAV, then archives one scanned reference', async () => {
    const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lXcAAAAASUVORK5CYII=', 'base64');
    const created = await request(app.getHttpServer()).post('/api/v1/files/uploads').set('Cookie', cookie)
      .set('x-csrf-token', csrf).set('Idempotency-Key', randomUUID()).send({ resourceType: 'supplier-incoming', resourceId: inspectionId,
        originalName: '检验照片.png', contentType: 'image/png', sizeBytes: image.length, sha256: createHash('sha256').update(image).digest('hex') }).expect(201);
    const fileId = created.body.file.id as string;
    expect(created.body.file).toMatchObject({ status: 'QUARANTINED', scanStatus: 'WAITING_UPLOAD' });
    const archive = (version: number, key = randomUUID()) => request(app.getHttpServer()).post(`/api/v1/supplier-incoming/inspections/${inspectionId}/photos`)
      .set('Cookie', cookie).set('x-csrf-token', csrf).set('Idempotency-Key', key).send({ fileId, expectedVersion: version });
    await archive(1).expect(409);
    expect((await fetch(created.body.uploadUrl, { method: 'PUT', headers: created.body.headers, body: image })).status).toBe(200);
    await request(app.getHttpServer()).post(`/api/v1/files/${fileId}/complete`).set('Cookie', cookie)
      .set('x-csrf-token', csrf).set('Idempotency-Key', randomUUID()).send({ expectedVersion: 1 }).expect(202);
    await archive(1).expect(409);
    await app.get(FileScanWorkerService).processDue(100);
    expect((await request(app.getHttpServer()).get(`/api/v1/files/${fileId}`).set('Cookie', cookie).expect(200)).body).toMatchObject({ status: 'AVAILABLE', scanStatus: 'CLEAN' });
    await archive(1).expect(201);
    await archive(1).expect(409);
    const detail = await request(app.getHttpServer()).get(`/api/v1/supplier-incoming/inspections/${inspectionId}`).set('Cookie', cookie).expect(200);
    expect(detail.body).toMatchObject({ version: 2, photos: [{ file_id: fileId }] });
    await request(app.getHttpServer()).get(`/api/v1/files/${fileId}`).set('Cookie', otherCookie).expect(403);
    expect(await prisma.auditEvent.count({ where: { organizationId: owner, resourceId: inspectionId, action: 'SUPPLIER_INCOMING_PHOTO_ATTACHED' } })).toBe(1);
  });
});
