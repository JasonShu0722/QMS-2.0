import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { jest } from '@jest/globals';
import request from 'supertest';
import { AppModule } from '../../src/app.module.js';
import { PrismaService } from '../../src/database/prisma.service.js';
import { SessionService } from '../../src/modules/identity/session.service.js';
import { GlobalExceptionFilter } from '../../src/common/contracts/global-exception.filter.js';
import { configureHttpBodyParser } from '../../src/http-body-parser.js';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl || process.env.QMS_DISPOSABLE_TEST_DB !== 'true' || new URL(databaseUrl).port === '55440') {
  throw new Error('An independent disposable PostgreSQL database is required');
}

jest.setTimeout(120_000);

describe('customer complaint import through real HTTP and PostgreSQL', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let customerId: string;
  let writerCookie: string;
  let readerCookie: string;
  const organizationId = randomUUID();
  const writerId = randomUUID();
  const readerId = randomUUID();
  const csrf = randomUUID();
  const path = '/api/v1/customer-quality/complaints/import';

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication<NestExpressApplication>({ bodyParser: false });
    configureHttpBodyParser(app);
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init();
    prisma = app.get(PrismaService);
    const [server] = await prisma.$queryRaw<{ server_version_num: string }[]>`SHOW server_version_num`;
    expect(Number(server!.server_version_num)).toBeGreaterThanOrEqual(180000);
    await prisma.organization.create({ data: { id: organizationId, code: `CQ-HTTP-${organizationId.slice(0, 8)}`, name: 'Customer import HTTP', type: 'INTERNAL' } });
    const writePermission = await prisma.permission.upsert({ where: { code: 'customer-quality:complaints:write' }, create: { code: 'customer-quality:complaints:write', name: 'Customer complaint write' }, update: {} });
    const readPermission = await prisma.permission.upsert({ where: { code: 'customer-quality:complaints:read' }, create: { code: 'customer-quality:complaints:read', name: 'Customer complaint read' }, update: {} });
    for (const [userId, roleCode, permissionId] of [[writerId, 'CQ_WRITER', writePermission.id], [readerId, 'CQ_READER', readPermission.id]]) {
      await prisma.user.create({ data: { id: userId!, organizationId, username: `cq-http-${userId!.slice(0, 8)}`, accountType: 'INTERNAL', passwordHash: 'test-only' } });
      const role = await prisma.role.create({ data: { organizationId, code: roleCode!, name: roleCode! } });
      await prisma.rolePermission.create({ data: { roleId: role.id, permissionId: permissionId! } });
      await prisma.userRole.create({ data: { userId: userId!, organizationId, roleId: role.id } });
    }
    const sessions = app.get(SessionService);
    writerCookie = `qms_session=${await sessions.create(writerId, prisma, { reauthenticated: true })}; qms_csrf=${csrf}`;
    readerCookie = `qms_session=${await sessions.create(readerId, prisma, { reauthenticated: true })}; qms_csrf=${csrf}`;
    const customer = await request(app.getHttpServer()).post('/api/v1/customer-quality/customers')
      .set('Cookie', writerCookie).set('x-csrf-token', csrf).set('Idempotency-Key', randomUUID())
      .send({ code: 'HTTP-IMPORT', name: 'HTTP 导入客户' }).expect(201);
    customerId = customer.body.id;
  });

  afterAll(async () => { await app?.close(); });

  function row(rowNumber: number, defectDescription = '客诉描述') {
    return {
      rowNumber, customerId, complaintType: 'ZERO_KM', defectDescription,
      severity: 'LOW', severityPolicyVersion: 'policy-1', severitySnapshot: { level: 'LOW' },
      externalSourceSystem: 'IMS', externalRecordKey: `HTTP-${randomUUID()}`, sourceObservedAt: '2026-09-24T02:00:00Z',
    };
  }

  function send(rows: object[], cookie = writerCookie) {
    return request(app.getHttpServer()).post(path).set('Cookie', cookie)
      .set('x-csrf-token', csrf).set('Idempotency-Key', randomUUID()).send({ rows });
  }

  it('persists 100 rows with large descriptions through the import route', async () => {
    const [before] = await prisma.$queryRaw<{ count: bigint }[]>`SELECT count(*) FROM customer_quality_complaints WHERE organization_id = ${organizationId}::uuid`;
    const rows = Array.from({ length: 100 }, (_, index) => row(index + 2, '质量'.repeat(4_000)));
    const response = await send(rows).expect(201);
    expect(response.body).toMatchObject({ created: 100, duplicates: 0, rejected: 0 });
    expect(response.body.items).toHaveLength(100);
    expect(response.body.items.every((item: { status: string }) => item.status === 'CREATED')).toBe(true);
    const [count] = await prisma.$queryRaw<{ count: bigint }[]>`SELECT count(*) FROM customer_quality_complaints WHERE organization_id = ${organizationId}::uuid`;
    expect(count!.count - before!.count).toBe(100n);
  });

  it('rejects 101 rows at DTO validation', async () => {
    const response = await send(Array.from({ length: 101 }, (_, index) => row(index + 2))).expect(400);
    expect(response.body.code).toBe('HTTP_400');
  });

  it('rejects missing CSRF and a reader without write permission', async () => {
    const missingCsrf = await request(app.getHttpServer()).post(path).set('Cookie', writerCookie)
      .set('Idempotency-Key', randomUUID()).send({ rows: [row(2)] }).expect(403);
    expect(missingCsrf.body.code).toBe('CSRF_INVALID');
    const readOnly = await send([row(2)], readerCookie).expect(403);
    expect(readOnly.body.code).toBe('FEATURE_PERMISSION_DENIED');
  });

  it('returns a controlled 413 for JSON larger than 6 MB', async () => {
    const response = await send([row(2, 'a'.repeat(7 * 1024 * 1024))]).expect(413);
    expect(response.body.code).toBe('HTTP_413');
  });
});
