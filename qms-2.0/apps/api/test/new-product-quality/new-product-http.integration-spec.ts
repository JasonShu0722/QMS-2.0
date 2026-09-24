import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DatabaseModule } from '../../src/database/database.module.js';
import { PrismaService } from '../../src/database/prisma.service.js';
import { AUTHENTICATED_SESSION } from '../../src/common/guards/authenticated.guard.js';
import { NewProductQualityModule } from '../../src/modules/new-product-quality/new-product-quality.module.js';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl || process.env.QMS_DISPOSABLE_TEST_DB !== 'true' || new URL(databaseUrl).port === '55440') throw new Error('Disposable PostgreSQL is required');

describe('new product HTTP adapter on PostgreSQL', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const organizationId = randomUUID();
  const userId = randomUUID();
  const sessionId = randomUUID();

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [DatabaseModule, NewProductQualityModule] }).compile();
    app = module.createNestApplication();
    app.use((incoming: object, _response: object, next: () => void) => {
      Reflect.set(incoming, AUTHENTICATED_SESSION, { id: sessionId, user: { id: userId, organizationId, accountType: 'INTERNAL' } });
      Reflect.set(incoming, 'authorizedOrganizationId', organizationId);
      next();
    });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);
    await prisma.organization.create({ data: { id: organizationId, code: `NP-HTTP-${organizationId.slice(0, 8)}`, name: 'New Product HTTP', type: 'INTERNAL' } });
    await prisma.user.create({ data: { id: userId, organizationId, username: `nph-${userId.slice(0, 8)}`, passwordHash: 'test-only', accountType: 'INTERNAL' } });
    await prisma.session.create({ data: { id: sessionId, userId, tokenHash: randomUUID(), expiresAt: new Date(Date.now() + 3_600_000), reauthenticatedAt: new Date() } });
    const role = await prisma.role.create({ data: { organizationId, code: 'NPHTTP', name: 'New Product HTTP' } });
    for (const code of ['new-product-quality:projects:read', 'new-product-quality:projects:write']) {
      const permission = await prisma.permission.findUniqueOrThrow({ where: { code } });
      await prisma.rolePermission.create({ data: { roleId: role.id, permissionId: permission.id } });
    }
    await prisma.userRole.create({ data: { userId, organizationId, roleId: role.id } });
  });

  afterAll(async () => app?.close());

  it('exposes project creation and validates stage review input', async () => {
    const created = await request(app.getHttpServer()).post('/api/v1/new-product-quality/projects').set('Idempotency-Key', randomUUID()).send({ code: 'HTTP-001', name: '驱动项目', productCode: 'P-001' }).expect(201);
    expect(created.body.code).toBe('HTTP-001');
    const stage = await request(app.getHttpServer()).post(`/api/v1/new-product-quality/projects/${created.body.id}/stages`).set('Idempotency-Key', randomUUID()).send({ code: 'DV', name: '设计验证' }).expect(201);
    await request(app.getHttpServer()).post(`/api/v1/new-product-quality/stages/${stage.body.id}/review`).set('Idempotency-Key', randomUUID()).send({ expectedVersion: 0, decision: 'INVALID' }).expect(400);
    const batch = await request(app.getHttpServer()).post(`/api/v1/new-product-quality/projects/${created.body.id}/trial-batches`).set('Idempotency-Key', randomUUID()).send({ code: 'T1' }).expect(201);
    const metric = await request(app.getHttpServer()).post(`/api/v1/new-product-quality/trial-batches/${batch.body.id}/metrics`).set('Idempotency-Key', randomUUID()).send({ code: 'CPK', target: 1.33, actual: 1.41, comparison: 'GTE', source: 'MANUAL' }).expect(201);
    expect(typeof metric.body.target).toBe('number');
    const report = await request(app.getHttpServer()).get(`/api/v1/new-product-quality/trial-batches/${batch.body.id}/report`).expect(200);
    expect(report.body.metrics[0]).toMatchObject({ target: 1.33, actual: 1.41, signal: 'GREEN' });
    const detail = await request(app.getHttpServer()).get(`/api/v1/new-product-quality/projects/${created.body.id}`).expect(200);
    expect(detail.body.stages).toHaveLength(1);
  });
});
