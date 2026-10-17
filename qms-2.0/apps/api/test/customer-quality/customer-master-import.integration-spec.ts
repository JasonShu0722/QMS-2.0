import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { ValidationPipe } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { jest } from '@jest/globals';
import { AppModule } from '../../src/app.module.js';
import { PrismaService } from '../../src/database/prisma.service.js';
import { SessionService } from '../../src/modules/identity/session.service.js';
import { CustomerQualityService } from '../../src/modules/customer-quality/customer-quality.service.js';
import { GlobalExceptionFilter } from '../../src/common/contracts/global-exception.filter.js';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl || process.env.QMS_DISPOSABLE_TEST_DB !== 'true' || new URL(databaseUrl).port === '55440') throw new Error('An independent disposable PostgreSQL database is required');
jest.setTimeout(60_000);

describe('customer master batch ADD on real HTTP and PostgreSQL', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let service: CustomerQualityService;
  let cookie: string;
  let actor: { id: string; organizationId: string; sessionId: string; accountType: 'INTERNAL' };
  const organizationId = randomUUID();
  const otherOrganizationId = randomUUID();
  const userId = randomUUID();
  const csrf = randomUUID();
  const path = '/api/v1/customer-quality/customers/import';

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init();
    prisma = app.get(PrismaService);
    service = app.get(CustomerQualityService);
    await prisma.organization.createMany({ data: [organizationId, otherOrganizationId].map((id) => ({ id, code: `CMI-${id}`, name: 'Customer master import', type: 'INTERNAL' as const })) });
    await prisma.user.create({ data: { id: userId, organizationId, username: `cmi-${userId}`, accountType: 'INTERNAL', passwordHash: 'test-only' } });
    const role = await prisma.role.create({ data: { organizationId, code: 'CUSTOMER_IMPORT', name: 'Customer import' } });
    for (const code of ['customer-quality:complaints:read', 'customer-quality:complaints:write']) {
      const permission = await prisma.permission.findUniqueOrThrow({ where: { code } });
      await prisma.rolePermission.create({ data: { roleId: role.id, permissionId: permission.id } });
    }
    await prisma.userRole.create({ data: { userId, organizationId, roleId: role.id } });
    const token = await app.get(SessionService).create(userId, prisma, { reauthenticated: true });
    cookie = `qms_session=${token}; qms_csrf=${csrf}`;
    const session = await prisma.session.findFirstOrThrow({ where: { userId } });
    actor = { id: userId, organizationId, sessionId: session.id, accountType: 'INTERNAL' };
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.$executeRaw`DELETE FROM customer_quality_customer_relations WHERE organization_id = ${organizationId}::uuid`;
      await prisma.$executeRaw`DELETE FROM customer_quality_customers WHERE organization_id = ${organizationId}::uuid`;
      await prisma.auditEvent.deleteMany({ where: { organizationId: { in: [organizationId, otherOrganizationId] } } });
      await prisma.user.deleteMany({ where: { organizationId } });
      await prisma.organization.deleteMany({ where: { id: { in: [organizationId, otherOrganizationId] } } });
    }
    await app?.close();
  });

  const send = (body: object, key = randomUUID()) => request(app.getHttpServer()).post(path).set('Cookie', cookie).set('x-csrf-token', csrf).set('Idempotency-Key', key).send(body);
  const rowsFor = (code: string) => [{ rowNumber: 2, code, name: '客户' }];

  it('adds valid rows, reports invalid rows, and preserves duplicate facts and relations', async () => {
    const existing = await service.createCustomer(actor, { code: 'existing', name: '原客户' }, randomUUID(), randomUUID());
    const relation = await service.createCustomerRelation(actor, existing.id, { relationType: 'PROJECT', relatedCode: 'P-001', relatedName: '原项目' }, randomUUID(), randomUUID());
    const rows = [
      { rowNumber: 2, code: ' existing ', name: '不应覆盖' },
      { rowNumber: 3, code: ' new ', name: ' 新客户 ' },
      { rowNumber: 4, code: 'new', name: '重复新客户' },
      { rowNumber: 5, code: 'later', name: '' },
      { rowNumber: 6, code: 'LATER', name: '后续有效客户' },
      { rowNumber: 7, code: 42, name: '编码不是文本' },
    ];
    const key = randomUUID();
    const result = await send({ rows }, key).expect(201);
    expect(result.body).toMatchObject({ created: 2, skipped: 2, failed: 2, items: [
      { rowNumber: 2, code: 'EXISTING', status: 'SKIPPED_DUPLICATE' },
      { rowNumber: 3, code: 'NEW', status: 'CREATED' },
      { rowNumber: 4, code: 'NEW', status: 'SKIPPED_DUPLICATE' },
      { rowNumber: 5, status: 'FAILED', errorCode: 'CUSTOMER_QUALITY_INPUT_INVALID' },
      { rowNumber: 6, code: 'LATER', status: 'CREATED' },
      { rowNumber: 7, status: 'FAILED', errorCode: 'CUSTOMER_QUALITY_INPUT_INVALID' },
    ] });
    expect((await send({ rows }, key).expect(201)).body).toEqual(result.body);
    expect((await service.listCustomers(actor)).find((item) => item.id === existing.id)).toMatchObject({ name: '原客户', version: 1 });
    expect(await service.listCustomerRelations(actor, existing.id)).toMatchObject([{ id: relation.id, related_name: '原项目', version: 1 }]);
    expect(await prisma.auditEvent.count({ where: { organizationId, action: 'CUSTOMER_MASTER_CREATED' } })).toBe(3);
    await send({ rows: [...rows, { rowNumber: 8, code: 'CHANGED', name: '变更' }] }, key).expect(409);
  });

  it('rejects structural and authorization errors before creating any row', async () => {
    for (const body of [
      { rows: [] },
      { rows: Array.from({ length: 101 }, (_, index) => ({ rowNumber: index + 2, code: `SIZE-${index}`, name: '客户' })) },
      { rows: [...rowsFor('STRUCTURAL'), { rowNumber: 3, code: 'OTHER', name: '客户', active: false }] },
      { rows: [...rowsFor('STRUCTURAL'), { rowNumber: 2, code: 'OTHER', name: '客户' }] },
    ]) await send(body).expect(400);
    await send({ organizationId: otherOrganizationId, rows: rowsFor('CROSS-ORG') }).expect(403);
    const customers = await service.listCustomers(actor);
    expect(customers.some((row) => /^(SIZE-|STRUCTURAL|OTHER|CROSS-ORG)/.test(row.code))).toBe(false);
  });

  it('rejects a missing CSRF token and missing write permission', async () => {
    await request(app.getHttpServer()).post(path).set('Cookie', cookie).set('Idempotency-Key', randomUUID()).send({ rows: rowsFor('NO-CSRF') }).expect(403);
    const key = randomUUID();
    const rows = rowsFor('REVOKE-REPLAY');
    await send({ rows }, key).expect(201);
    const assignment = await prisma.userRole.findFirstOrThrow({ where: { userId } });
    await prisma.userRole.delete({ where: { userId_roleId_organizationId: assignment } });
    try {
      await send({ rows: rowsFor('NO-PERMISSION') }).expect(403);
      await send({ rows }, key).expect(403);
    }
    finally { await prisma.userRole.create({ data: assignment }); }
  });

  it('accepts exactly 100 rows and rejects a missing idempotency key', async () => {
    const rows = Array.from({ length: 100 }, (_, index) => ({ rowNumber: index + 2, code: `BULK-${index}`, name: `客户 ${index}` }));
    const result = await send({ rows }).expect(201);
    expect(result.body).toMatchObject({ created: 100, skipped: 0, failed: 0 });
    await request(app.getHttpServer()).post(path).set('Cookie', cookie).set('x-csrf-token', csrf).send({ rows: rowsFor('NO-KEY') }).expect(400);
    expect((await service.listCustomers(actor)).some((row) => row.code === 'NO-KEY')).toBe(false);
  });

  it('rolls back the current customer when the real audit insert fails', async () => {
    const result = await Reflect.get(service, 'importCustomers').call(service, actor, rowsFor('AUDIT-FAIL'), 'x'.repeat(101), randomUUID());
    expect(result).toMatchObject({ created: 0, skipped: 0, failed: 1, items: [{ status: 'FAILED' }] });
    expect((await service.listCustomers(actor)).some((row) => row.code === 'AUDIT-FAIL')).toBe(false);
  });

  it('handles concurrent identical customer codes without overwriting', async () => {
    const result = await Promise.all([send({ rows: rowsFor('RACE') }), send({ rows: rowsFor(' race ') })]);
    expect(result.map((response) => response.status)).toEqual([201, 201]);
    expect(result.flatMap((response) => response.body.items.map((item: { status: string }) => item.status)).sort()).toEqual(['CREATED', 'SKIPPED_DUPLICATE']);
    expect((await service.listCustomers(actor)).filter((row) => row.code === 'RACE')).toHaveLength(1);
  });
});
