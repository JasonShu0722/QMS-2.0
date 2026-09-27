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
    const exported = await request(app.getHttpServer()).get(`/api/v1/new-product-quality/trial-batches/${batch.body.id}/report/export`).expect(200);
    expect(exported.headers['content-type']).toMatch(/text\/csv/);
    expect(exported.headers['content-disposition']).toMatch(/^attachment; filename="qms-trial-report-[0-9a-f-]+\.csv"$/);
    expect(exported.text).toContain('batchId,batchCode,workOrderCode,metricSetSha256,exportedAt,metricId,metricCode,target,actual,comparison,signal,source,recordedAt');
    expect(exported.text).toMatch(/[a-f0-9]{64}/);
    expect(exported.text).toContain(`"${batch.body.id}"`);
    expect(exported.text).toContain(`"${metric.body.id}"`);
    expect(exported.text).toContain('"CPK"');
    expect(exported.text).toContain('"MANUAL"');
    expect(exported.text).toContain('"GREEN"');
    expect(exported.headers['cache-control']).toBe('no-store');
    const detail = await request(app.getHttpServer()).get(`/api/v1/new-product-quality/projects/${created.body.id}`).expect(200);
    expect(detail.body.stages).toHaveLength(1);
    await request(app.getHttpServer()).post(`/api/v1/new-product-quality/projects/${created.body.id}/handover`).set('Idempotency-Key', randomUUID()).send({ expectedVersion: 0, riskStatement: '' }).expect(400);
    const incomplete = await request(app.getHttpServer()).post(`/api/v1/new-product-quality/projects/${created.body.id}/handover`).set('Idempotency-Key', randomUUID()).send({ expectedVersion: 1, riskStatement: '量产前风险确认' }).expect(409);
    expect(incomplete.body.code).toBe('NEW_PRODUCT_HANDOVER_STAGES_INCOMPLETE');

    await request(app.getHttpServer()).post(`/api/v1/new-product-quality/projects/${created.body.id}/early-flow`).set('Idempotency-Key', randomUUID()).send({ monitoringWindowDays: 30, plan: '每日首件确认' }).expect(400);
    const earlyFlow = await request(app.getHttpServer()).post(`/api/v1/new-product-quality/projects/${created.body.id}/early-flow`).set('Idempotency-Key', randomUUID()).send({ monitoringWindowDays: 30, monitoringFrequency: '每日', plan: '每日首件确认并记录关键尺寸趋势', exitCriteria: '连续三批符合尺寸目标且无未关闭缺陷' }).expect(201);
    expect(earlyFlow.body).toMatchObject({ status: 'DRAFT', monitoringWindowDays: 30, monitoringFrequency: '每日', exitCriteria: '连续三批符合尺寸目标且无未关闭缺陷', version: 1 });
    const submittedFlow = await request(app.getHttpServer()).put(`/api/v1/new-product-quality/early-flows/${earlyFlow.body.id}/submit`).set('Idempotency-Key', randomUUID()).send({ expectedVersion: 1 }).expect(200);
    expect(submittedFlow.body.status).toBe('SUBMITTED');
    const approvedFlow = await request(app.getHttpServer()).put(`/api/v1/new-product-quality/early-flows/${earlyFlow.body.id}/approve`).set('Idempotency-Key', randomUUID()).send({ expectedVersion: submittedFlow.body.version, decision: 'APPROVE', note: '首批监控方案已确认' }).expect(200);
    expect(approvedFlow.body).toMatchObject({ status: 'APPROVED', approvalNote: '首批监控方案已确认' });
  });

  it('escapes spreadsheet formulas and preserves the batch row without metrics', async () => {
    const created = await request(app.getHttpServer()).post('/api/v1/new-product-quality/projects').set('Idempotency-Key', randomUUID()).send({ code: `EXPORT-${randomUUID().slice(0, 8)}`, name: '导出项目', productCode: 'P-002' }).expect(201);
    const batch = await request(app.getHttpServer()).post(`/api/v1/new-product-quality/projects/${created.body.id}/trial-batches`).set('Idempotency-Key', randomUUID()).send({ code: '=HYPERLINK("https://example.test")', workOrderCode: '+SUM(1,1)' }).expect(201);
    const path = `/api/v1/new-product-quality/trial-batches/${batch.body.id}/report/export`;
    const empty = await request(app.getHttpServer()).get(path).expect(200);
    expect(empty.text).toContain('metricCode,target,actual');
    expect(empty.text).toContain(`"${batch.body.id}"`);
    expect(empty.text).toContain('"\'=HYPERLINK(""HTTPS://EXAMPLE.TEST"")"');
    await request(app.getHttpServer()).post(`/api/v1/new-product-quality/trial-batches/${batch.body.id}/metrics`).set('Idempotency-Key', randomUUID()).send({ code: 'DEFECT', target: 2, actual: 1, comparison: 'LTE', source: 'MANUAL' }).expect(201);
    const exported = await request(app.getHttpServer()).get(path).expect(200);
    expect(exported.text).toContain('"\'=HYPERLINK(""HTTPS://EXAMPLE.TEST"")"');
    expect(exported.text).toContain('"\'+SUM(1,1)"');
    await request(app.getHttpServer()).get(`/api/v1/new-product-quality/trial-batches/${randomUUID()}/report/export`).expect(404);
  });
});
