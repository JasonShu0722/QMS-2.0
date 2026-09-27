import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { AppModule } from '../../src/app.module.js';
import { PrismaService } from '../../src/database/prisma.service.js';
import { SessionService } from '../../src/modules/identity/session.service.js';
import { GlobalExceptionFilter } from '../../src/common/contracts/global-exception.filter.js';
import { configureHttpBodyParser } from '../../src/http-body-parser.js';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl || process.env.QMS_DISPOSABLE_TEST_DB !== 'true' || new URL(databaseUrl).port === '55440') throw new Error('Disposable PostgreSQL is required');

describe('customer complaint processing through HTTP and PostgreSQL', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let customerId: string;
  let departmentId: string;
  let writerCookie: string;
  let reviewerCookie: string;
  let readerCookie: string;
  const organizationId = randomUUID();
  const writerId = randomUUID();
  const reviewerId = randomUUID();
  const readerId = randomUUID();
  const csrf = randomUUID();

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication<NestExpressApplication>({ bodyParser: false });
    configureHttpBodyParser(app);
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init();
    prisma = app.get(PrismaService);
    await prisma.organization.create({ data: { id: organizationId, code: `D2H-${organizationId.slice(0, 8)}`, name: 'D2 HTTP', type: 'INTERNAL' } });
    const permissions = await Promise.all(['customer-quality:complaints:read', 'customer-quality:complaints:write'].map((code) => prisma.permission.upsert({ where: { code }, create: { code, name: code }, update: {} })));
    for (const [userId, roleCode, writable] of [[writerId, 'WRITER', true], [reviewerId, 'REVIEWER', true], [readerId, 'READER', false]] as const) {
      await prisma.user.create({ data: { id: userId, organizationId, username: userId, passwordHash: 'test-only', accountType: 'INTERNAL' } });
      const role = await prisma.role.create({ data: { organizationId, code: roleCode, name: roleCode } });
      await prisma.rolePermission.create({ data: { roleId: role.id, permissionId: permissions[0]!.id } });
      if (writable) await prisma.rolePermission.create({ data: { roleId: role.id, permissionId: permissions[1]!.id } });
      await prisma.userRole.create({ data: { userId, organizationId, roleId: role.id } });
    }
    const sessions = app.get(SessionService);
    writerCookie = `qms_session=${await sessions.create(writerId, prisma, { reauthenticated: true })}; qms_csrf=${csrf}`;
    reviewerCookie = `qms_session=${await sessions.create(reviewerId, prisma, { reauthenticated: true })}; qms_csrf=${csrf}`;
    readerCookie = `qms_session=${await sessions.create(readerId, prisma, { reauthenticated: true })}; qms_csrf=${csrf}`;
    departmentId = (await prisma.department.create({ data: { organizationId, code: 'QE', name: '质量部' } })).id;
    customerId = (await request(app.getHttpServer()).post('/api/v1/customer-quality/customers').set('Cookie', writerCookie).set('x-csrf-token', csrf).set('Idempotency-Key', randomUUID()).send({ code: 'D2-CUSTOMER', name: '客户' }).expect(201)).body.id;
  });

  afterAll(async () => app?.close());

  it('enforces permission, independent closure, and immutable event order', async () => {
    const server = app.getHttpServer();
    const created = await request(server).post('/api/v1/customer-quality/complaints').set('Cookie', writerCookie).set('x-csrf-token', csrf).set('Idempotency-Key', randomUUID()).send({ customerId, complaintType: 'ZERO_KM', defectDescription: '尺寸异常', severity: 'LOW', severityPolicyVersion: 'v1', severitySnapshot: { level: 'LOW' } }).expect(201);
    const path = `/api/v1/customer-quality/complaints/${created.body.id}`;
    const triage = { expectedVersion: 1, category: 'PRODUCT_QUALITY', responsibleDepartmentId: departmentId, ownerUserId: writerId, note: '质量部接收' };
    await request(server).put(`${path}/triage`).set('Cookie', readerCookie).set('x-csrf-token', csrf).set('Idempotency-Key', randomUUID()).send(triage).expect(403);
    const triaged = await request(server).put(`${path}/triage`).set('Cookie', writerCookie).set('x-csrf-token', csrf).set('Idempotency-Key', randomUUID()).send(triage).expect(200);
    expect(triaged.body).toMatchObject({ status: 'IN_ANALYSIS', version: 2 });
    await request(server).post(`${path}/progress`).set('Cookie', writerCookie).set('x-csrf-token', csrf).set('Idempotency-Key', randomUUID()).send({ expectedVersion: 2, note: '已确认样件' }).expect(201);
    const resolved = await request(server).put(`${path}/resolve`).set('Cookie', writerCookie).set('x-csrf-token', csrf).set('Idempotency-Key', randomUUID()).send({ expectedVersion: 3, resolutionSummary: '换件完成' }).expect(200);
    await request(server).put(`${path}/close`).set('Cookie', writerCookie).set('x-csrf-token', csrf).set('Idempotency-Key', randomUUID()).send({ expectedVersion: resolved.body.version, note: '复核通过' }).expect(403);
    const closed = await request(server).put(`${path}/close`).set('Cookie', reviewerCookie).set('x-csrf-token', csrf).set('Idempotency-Key', randomUUID()).send({ expectedVersion: resolved.body.version, note: '复核通过' }).expect(200);
    expect(closed.body.status).toBe('CLOSED');
    const events = await request(server).get(`${path}/events`).set('Cookie', readerCookie).expect(200);
    expect(events.body.map((event: { event_type: string }) => event.event_type)).toEqual(['TRIAGED', 'PROGRESS_RECORDED', 'RESOLVED', 'CLOSED']);
  });

  it('allows a writer to initialize a complaint upload and denies a reader', async () => {
    const server = app.getHttpServer();
    const created = await request(server).post('/api/v1/customer-quality/complaints').set('Cookie', writerCookie).set('x-csrf-token', csrf).set('Idempotency-Key', randomUUID()).send({ customerId, complaintType: 'ZERO_KM', defectDescription: '外观损伤', severity: 'LOW', severityPolicyVersion: 'v1', severitySnapshot: { level: 'LOW' } }).expect(201);
    const upload = { resourceType: 'CustomerComplaint', resourceId: created.body.id, originalName: 'evidence.txt', contentType: 'text/plain', sizeBytes: 12, sha256: 'a'.repeat(64) };
    await request(server).post('/api/v1/files/uploads').set('Cookie', readerCookie).set('x-csrf-token', csrf).set('Idempotency-Key', randomUUID()).send(upload).expect(403);
    const initialized = await request(server).post('/api/v1/files/uploads').set('Cookie', writerCookie).set('x-csrf-token', csrf).set('Idempotency-Key', randomUUID()).send(upload).expect(201);
    expect(initialized.body.file).toMatchObject({ resourceType: 'CustomerComplaint', resourceId: created.body.id, status: 'QUARANTINED' });
    await request(server).get(`/api/v1/files/${initialized.body.file.id}`).set('Cookie', readerCookie).expect(200);
    const discovered = await request(server).get(`/api/v1/customer-quality/complaints/${created.body.id}/attachments`).set('Cookie', readerCookie).expect(200);
    expect(discovered.body).toEqual([expect.objectContaining({ id: initialized.body.file.id, status: 'QUARANTINED' })]);
    await request(server).get(`/api/v1/customer-quality/complaints/${randomUUID()}/attachments`).set('Cookie', readerCookie).expect(404);
  });
});
