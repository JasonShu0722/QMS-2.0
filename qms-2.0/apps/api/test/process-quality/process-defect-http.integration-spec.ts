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
if (!databaseUrl || process.env.QMS_DISPOSABLE_TEST_DB !== 'true' || new URL(databaseUrl).port === '55440') throw new Error('Disposable PostgreSQL is required');

describe('process defect ledger HTTP and PostgreSQL', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let cookie: string;
  const csrf = randomUUID();
  const organizationId = randomUUID();
  const userId = randomUUID();

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init();
    prisma = app.get(PrismaService);
    await prisma.organization.create({ data: { id: organizationId, code: `PD-HTTP-${organizationId.slice(0, 8)}`, name: 'Process HTTP', type: 'INTERNAL' } });
    await prisma.user.create({ data: { id: userId, organizationId, username: `pqe-${userId.slice(0, 8)}`, passwordHash: 'test-only', accountType: 'INTERNAL' } });
    const role = await prisma.role.create({ data: { organizationId, code: 'PQE', name: 'Process QE' } });
    for (const code of ['process-quality:defects:read', 'process-quality:defects:write']) {
      const permission = await prisma.permission.upsert({ where: { code }, create: { code, name: code }, update: {} });
      await prisma.rolePermission.create({ data: { roleId: role.id, permissionId: permission.id } });
    }
    await prisma.userRole.create({ data: { userId, organizationId, roleId: role.id } });
    cookie = `qms_session=${await app.get(SessionService).create(userId, prisma, { reauthenticated: true })}; qms_csrf=${csrf}`;
  });

  afterAll(async () => { await app?.close(); });

  function send(method: 'post' | 'put', path: string, body: object) {
    return request(app.getHttpServer())[method](`/api/v1/process-quality/${path}`).set('Cookie', cookie).set('x-csrf-token', csrf).set('Idempotency-Key', randomUUID()).send(body);
  }

  it('creates, queries, updates and archives a manual defect through protected routes', async () => {
    await send('post', 'defect-types', { code: 'BURR', name: '毛刺' }).expect(201);
    const input = { defectTypeCode: 'BURR', description: '端面毛刺', defectQuantity: 3, occurredAt: '2026-09-24T02:00:00Z', batchCode: 'HTTP-B', responsibilityCategory: 'PROCESS' };
    const created = await send('post', 'defects', input).expect(201);
    expect(created.body.version).toBe(1);
    const listed = await request(app.getHttpServer()).get('/api/v1/process-quality/defects?batchCode=HTTP-B').set('Cookie', cookie).expect(200);
    expect(listed.body.items.some((item: { id: string }) => item.id === created.body.id)).toBe(true);
    await send('put', `defects/${created.body.id}`, { expectedVersion: 1, description: '复测毛刺' }).expect(200);
    await send('put', `defects/${created.body.id}/archive`, { expectedVersion: 2 }).expect(200);
    const hidden = await request(app.getHttpServer()).get('/api/v1/process-quality/defects?batchCode=HTTP-B').set('Cookie', cookie).expect(200);
    expect(hidden.body.items.some((item: { id: string }) => item.id === created.body.id)).toBe(false);
  });

  it('rejects a write without matching CSRF and a cross-organization read', async () => {
    await request(app.getHttpServer()).post('/api/v1/process-quality/defects').set('Cookie', cookie).set('Idempotency-Key', randomUUID()).send({}).expect(403);
    await request(app.getHttpServer()).get(`/api/v1/process-quality/defects?organizationId=${randomUUID()}`).set('Cookie', cookie).expect(403);
  });

  it('exposes protected formal issue creation with validated source selection', async () => {
    await send('post', 'issues', { sources: [] }).expect(400);
  });
});
