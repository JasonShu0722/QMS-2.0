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

if (!process.env.DATABASE_URL || process.env.QMS_DISPOSABLE_TEST_DB !== 'true' || new URL(process.env.DATABASE_URL).port === '55440') throw new Error('Disposable PostgreSQL is required');

describe('N4 ledger HTTP with real guards and PostgreSQL', () => {
  let app: NestExpressApplication; let prisma: PrismaService; let cookie: string;
  const csrf = randomUUID(); const organizationId = randomUUID(); const userId = randomUUID();
  const path = '/api/v1/customer-quality/ledger';
  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication<NestExpressApplication>({ bodyParser: false });
    configureHttpBodyParser(app);
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init();
    prisma = app.get(PrismaService);
    await prisma.organization.create({ data: { id: organizationId, code: `N4-HTTP-${organizationId}`, name: 'N4 HTTP', type: 'INTERNAL' } });
    await prisma.user.create({ data: { id: userId, organizationId, username: `N4-http-${userId}`, accountType: 'INTERNAL', passwordHash: 'test-only' } });
    const role = await prisma.role.create({ data: { organizationId, code: 'N4_HTTP', name: 'No identity from name' } });
    for (const code of ['customer-quality:complaints:read','customer-quality:complaints:write']) {
      const permission = await prisma.permission.upsert({ where: { code }, create: { code, name: code }, update: {} });
      await prisma.rolePermission.create({ data: { roleId: role.id, permissionId: permission.id } });
    }
    await prisma.userRole.create({ data: { organizationId, userId, roleId: role.id } });
    cookie = `qms_session=${await app.get(SessionService).create(userId, prisma, { reauthenticated: true })}; qms_csrf=${csrf}`;
  });
  afterAll(async () => app?.close());
  const post = (suffix: string, body: object, key = randomUUID()) => request(app.getHttpServer()).post(`${path}${suffix}`).set('Cookie', cookie).set('x-csrf-token',csrf).set('Idempotency-Key',key).send(body);

  it('persists invalid original cells via manual and import without fictitious normalized facts', async () => {
    const manual = await post('', { fields: { complaintType: 'AFTER_SALES', quantity: '待补正', mileage: -1, occurredOn: '2026-02-30' } }).expect(201);
    expect(manual.body).toMatchObject({ status: 'FOLLOWING', normalized: { quantity: null, mileage: null, occurredOn: null }, raw: { quantity: '待补正' } });
    const batch = await post('/import/commit', { mode: 'CONTINUE', rows: [{ rowNumber: 1, action: 'ADD', fields: { complaintType: 'ZERO_KM', customerName: 'unresolved' } }] }).expect(201);
    expect(batch.body.created).toBe(1);
    const read = await request(app.getHttpServer()).get(`${path}/${manual.body.id}`).set('Cookie',cookie).expect(200);
    expect(read.body.raw.quantity).toBe('待补正');
    expect(read.body.history).toEqual([]);
  });
  it('enforces envelope validation, query bounds, CSRF and actual authentication', async () => {
    await request(app.getHttpServer()).get(path).expect(401);
    await request(app.getHttpServer()).get(`${path}?pageSize=101`).set('Cookie',cookie).expect(400);
    await post('', { fields: {}, createdById: userId }).expect(400);
    await post('', { fields: { quantity: 1 }, customerId: 'not-uuid' }).expect(400);
    await post('', { fields: { defectDescription: 'x'.repeat(20001) } }).expect(400);
    await request(app.getHttpServer()).post(path).set('Cookie',cookie).set('Idempotency-Key',randomUUID()).send({ fields: {} }).expect(403);
  });
  it('receiving cannot smuggle quantity and technical retries do not create another complaint', async () => {
    const key = randomUUID(); const body = { fields: { quantity: 2 } };
    const first = await post('',body,key).expect(201);
    const second = await post('',body,key).expect(201);
    expect(second.body.id).toBe(first.body.id);
    await request(app.getHttpServer()).put(`${path}/${first.body.id}/receiving`).set('Cookie',cookie).set('x-csrf-token',csrf).set('Idempotency-Key',randomUUID())
      .send({ expectedVersion: 1, quantity: 99 }).expect(400);
    await post(`/${first.body.id}/close`,{ expectedVersion: 1, note: 'Registrar is not corresponding engineer' }).expect(403);
    const list = await request(app.getHttpServer()).get(`${path}?page=1&pageSize=1`).set('Cookie',cookie).expect(200);
    expect(list.body.items).toHaveLength(1);
    expect(list.body.total).toBeGreaterThanOrEqual(1);
  });
  it('adopts a legacy row through B update and fences every subsequent legacy HTTP path', async () => {
    const base = '/api/v1/customer-quality';
    const customer = await request(app.getHttpServer()).post(`${base}/customers`).set('Cookie',cookie).set('x-csrf-token',csrf).set('Idempotency-Key',randomUUID())
      .send({ code: randomUUID(), name: 'Legacy HTTP customer' }).expect(201);
    const original = await request(app.getHttpServer()).post(`${base}/complaints`).set('Cookie',cookie).set('x-csrf-token',csrf).set('Idempotency-Key',randomUUID())
      .send({ customerId: customer.body.id, complaintType: 'ZERO_KM', defectDescription: 'old facts', severity: 'LOW', severityPolicyVersion: 'legacy', severitySnapshot: { level: 'LOW' } }).expect(201);
    const adopted = await request(app.getHttpServer()).put(`${path}/${original.body.id}`).set('Cookie',cookie).set('x-csrf-token',csrf).set('Idempotency-Key',randomUUID())
      .send({ expectedVersion: 1, customerId: null, fields: { defectDescription: null } }).expect(200);
    expect(adopted.body).toMatchObject({ status: 'FOLLOWING', customerId: null, normalized: { defectDescription: null } });
    await request(app.getHttpServer()).get(`${base}/complaints/${original.body.id}`).set('Cookie',cookie).expect(409);
    await request(app.getHttpServer()).get(`${base}/complaints/${original.body.id}/8d`).set('Cookie',cookie).expect(409);
    await request(app.getHttpServer()).put(`${base}/complaints/${original.body.id}`).set('Cookie',cookie).set('x-csrf-token',csrf).set('Idempotency-Key',randomUUID())
      .send({ expectedVersion: adopted.body.version, defectDescription: 'legacy bypass' }).expect(409);
    const legacyList = await request(app.getHttpServer()).get(`${base}/complaints`).set('Cookie',cookie).expect(200);
    expect(legacyList.body.map((row: { id: string }) => row.id)).not.toContain(original.body.id);
  });
  it('lists original customer documents on the formal ledger without using the fenced legacy entry or changing quantities', async () => {
    const created = await post('', { fields: { complaintType: 'AFTER_SALES', quantity: 2, batch: 'Customer-list-only batch' } }).expect(201);
    const endpoint = `${path}/${created.body.id}/attachments`;
    await request(app.getHttpServer()).get(endpoint).expect(401);
    const empty = await request(app.getHttpServer()).get(endpoint).set('Cookie', cookie).expect(200);
    expect(empty.body).toEqual([]);
    const initialized = await request(app.getHttpServer()).post('/api/v1/files/uploads').set('Cookie', cookie)
      .set('x-csrf-token', csrf).set('Idempotency-Key', randomUUID()).send({ resourceType: 'CustomerComplaint', resourceId: created.body.id,
        originalName: 'customer-list.txt', contentType: 'text/plain', sizeBytes: 5, sha256: 'a'.repeat(64) }).expect(201);
    const listed = await request(app.getHttpServer()).get(endpoint).set('Cookie', cookie).expect(200);
    expect(listed.body).toHaveLength(1);
    expect(listed.body[0]).toMatchObject({ id: initialized.body.file.id, resourceType: 'CustomerComplaint', resourceId: created.body.id,
      status: 'QUARANTINED', scanStatus: 'WAITING_UPLOAD' });
    const unchanged = await request(app.getHttpServer()).get(`${path}/${created.body.id}`).set('Cookie', cookie).expect(200);
    expect(unchanged.body).toMatchObject({ version: created.body.version, normalized: { quantity: 2 }, status: 'FOLLOWING' });
    await request(app.getHttpServer()).get(`/api/v1/customer-quality/complaints/${created.body.id}/attachments`).set('Cookie', cookie).expect(409);
    await request(app.getHttpServer()).get(`${path}/${randomUUID()}/attachments`).set('Cookie', cookie).expect(404);
    const grant = await prisma.userRole.findFirstOrThrow({ where: { userId, organizationId } });
    const writePermission = await prisma.permission.findUniqueOrThrow({ where: { code: 'customer-quality:complaints:write' } });
    await prisma.rolePermission.delete({ where: { roleId_permissionId: { roleId: grant.roleId, permissionId: writePermission.id } } });
    const readOnly = await request(app.getHttpServer()).get(endpoint).set('Cookie', cookie).expect(200);
    expect(readOnly.body.map((file: { id: string }) => file.id)).toEqual([initialized.body.file.id]);
    await request(app.getHttpServer()).post('/api/v1/files/uploads').set('Cookie', cookie)
      .set('x-csrf-token', csrf).set('Idempotency-Key', randomUUID()).send({ resourceType: 'CustomerComplaint', resourceId: created.body.id,
        originalName: 'forbidden.txt', contentType: 'text/plain', sizeBytes: 5, sha256: 'b'.repeat(64) }).expect(403);
    expect(await prisma.fileObject.count({ where: { resourceId: created.body.id } })).toBe(1);
    const permission = await prisma.permission.findUniqueOrThrow({ where: { code: 'customer-quality:complaints:read' } });
    await prisma.rolePermission.delete({ where: { roleId_permissionId: { roleId: grant.roleId, permissionId: permission.id } } });
    await request(app.getHttpServer()).get(endpoint).set('Cookie', cookie).expect(403);
  });
});
