import 'reflect-metadata';
import { createHash, randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { jest } from '@jest/globals';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import request from 'supertest';
import ExcelJS from 'exceljs';
import { DatabaseModule } from '../../src/database/database.module.js';
import { PrismaService } from '../../src/database/prisma.service.js';
import { AUTHENTICATED_SESSION } from '../../src/common/guards/authenticated.guard.js';
import { NewProductQualityModule } from '../../src/modules/new-product-quality/new-product-quality.module.js';
import { NewProductQualityService } from '../../src/modules/new-product-quality/new-product-quality.service.js';
import type { AdminTransaction } from '../../src/common/security/admin-mutation.service.js';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl || process.env.QMS_DISPOSABLE_TEST_DB !== 'true' || new URL(databaseUrl).port === '55440') throw new Error('Disposable PostgreSQL is required');

const binary = (response: NodeJS.ReadableStream, callback: (error: Error | null, body?: Buffer) => void) => {
  const chunks: Buffer[] = [];
  response.on('data', (chunk: Buffer) => chunks.push(chunk));
  response.on('end', () => callback(null, Buffer.concat(chunks)));
  response.on('error', callback);
};

describe('trial summary approval on PostgreSQL', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const organizationId = randomUUID();
  const authorId = randomUUID();
  const reviewerId = randomUUID();
  const authorSessionId = randomUUID();
  const reviewerSessionId = randomUUID();

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [DatabaseModule, NewProductQualityModule] }).compile();
    app = module.createNestApplication();
    app.use((incoming: { headers: Record<string, string> }, _response: object, next: () => void) => {
      const reviewer = incoming.headers['x-test-reviewer'] === 'true';
      Reflect.set(incoming, AUTHENTICATED_SESSION, { id: reviewer ? reviewerSessionId : authorSessionId, user: { id: reviewer ? reviewerId : authorId, organizationId, accountType: 'INTERNAL' } });
      Reflect.set(incoming, 'authorizedOrganizationId', incoming.headers['x-test-other-scope'] === 'true' ? randomUUID() : organizationId);
      next();
    });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);
    await prisma.organization.create({ data: { id: organizationId, code: `NPTS-${organizationId.slice(0, 8)}`, name: 'Trial Summary', type: 'INTERNAL' } });
    for (const [id, sessionId] of [[authorId, authorSessionId], [reviewerId, reviewerSessionId]]) {
      await prisma.user.create({ data: { id, organizationId, username: `npts-${id.slice(0, 8)}`, passwordHash: 'test-only', accountType: 'INTERNAL' } });
      await prisma.session.create({ data: { id: sessionId, userId: id, tokenHash: randomUUID(), expiresAt: new Date(Date.now() + 3_600_000), reauthenticatedAt: new Date() } });
    }
    const role = await prisma.role.create({ data: { organizationId, code: 'NPTS', name: 'Trial Summary' } });
    for (const code of ['new-product-quality:projects:read', 'new-product-quality:projects:write']) {
      const permission = await prisma.permission.findUniqueOrThrow({ where: { code } });
      await prisma.rolePermission.create({ data: { roleId: role.id, permissionId: permission.id } });
    }
    for (const userId of [authorId, reviewerId]) await prisma.userRole.create({ data: { userId, organizationId, roleId: role.id } });
  });

  afterAll(async () => app?.close());

  it('freezes real batch metrics and project risks, rejects self approval and replays safely', async () => {
    const server = app.getHttpServer();
    const project = await request(server).post('/api/v1/new-product-quality/projects').set('Idempotency-Key', randomUUID()).send({ code: 'SUMMARY-001', name: '试产总结项目', productCode: 'PART-001' }).expect(201);
    const batch = await request(server).post(`/api/v1/new-product-quality/projects/${project.body.id}/trial-batches`).set('Idempotency-Key', randomUUID()).send({ code: 'RUN-1' }).expect(201);
    await request(server).post(`/api/v1/new-product-quality/trial-batches/${batch.body.id}/metrics`).set('Idempotency-Key', randomUUID()).send({ code: 'CPK', target: 1.33, actual: 1.4, comparison: 'GTE', source: 'MANUAL' }).expect(201);
    const risk = await request(server).post(`/api/v1/new-product-quality/projects/${project.body.id}/legacy-issues`).set('Idempotency-Key', randomUUID()).send({ description: '试产夹具风险待跟踪', riskLevel: 'HIGH' }).expect(201);
    const route = `/api/v1/new-product-quality/trial-batches/${batch.body.id}/summary`;
    const draft = await request(server).post(route).set('Idempotency-Key', randomUUID()).send({ conclusion: '工艺窗口满足当前试产目标，遗留夹具风险需跟踪' }).expect(201);
    expect(draft.body).toMatchObject({ status: 'DRAFT', conclusion: '工艺窗口满足当前试产目标，遗留夹具风险需跟踪', version: 1 });
    const submitKey = randomUUID();
    const submitted = await request(server).put(`${route}/submit`).set('Idempotency-Key', submitKey).send({ expectedVersion: 1 }).expect(200);
    expect(submitted.body).toMatchObject({ status: 'SUBMITTED', version: 2, submittedById: authorId });
    expect(submitted.body.metricSnapshot).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'CPK', actual: 1.4, signal: 'GREEN' })]));
    expect(submitted.body.issueSnapshot).toEqual(expect.arrayContaining([expect.objectContaining({ id: risk.body.id, riskLevel: 'HIGH' })]));
    expect(submitted.body.sourceSha256).toMatch(/^[a-f0-9]{64}$/);
    expect((await request(server).put(`${route}/submit`).set('Idempotency-Key', submitKey).send({ expectedVersion: 1 }).expect(200)).body).toEqual(submitted.body);
    await request(server).put(`${route}/submit`).set('Idempotency-Key', submitKey).send({ expectedVersion: 2 }).expect(409);
    await request(server).put(`${route}/decision`).set('Idempotency-Key', randomUUID()).send({ expectedVersion: 2, decision: 'APPROVE' }).expect(409);
    const approved = await request(server).put(`${route}/decision`).set('x-test-reviewer', 'true').set('Idempotency-Key', randomUUID()).send({ expectedVersion: 2, decision: 'APPROVE', note: '风险有责任人，准予总结归档' }).expect(200);
    expect(approved.body).toMatchObject({ status: 'APPROVED', approvedById: reviewerId, version: 3 });
    expect((await request(server).get(route).expect(200)).body.sourceSha256).toBe(submitted.body.sourceSha256);
    await request(server).put(`${route}/decision`).set('x-test-reviewer', 'true').set('Idempotency-Key', randomUUID()).send({ expectedVersion: 2, decision: 'REJECT', note: '改写' }).expect(409);
    expect((await request(server).get(route).expect(200)).body.status).toBe('APPROVED');
  });

  it('keeps rejected snapshot history while revising, resubmitting and approving a formal batch issue', async () => {
    const server = app.getHttpServer();
    const project = await request(server).post('/api/v1/new-product-quality/projects').set('Idempotency-Key', randomUUID()).send({ code: `REVISE-${randomUUID().slice(0, 8)}`, name: '修订项目', productCode: 'PART-002' }).expect(201);
    const batch = await request(server).post(`/api/v1/new-product-quality/projects/${project.body.id}/trial-batches`).set('Idempotency-Key', randomUUID()).send({ code: 'RUN-2' }).expect(201);
    await request(server).post(`/api/v1/new-product-quality/trial-batches/${batch.body.id}/metrics`).set('Idempotency-Key', randomUUID()).send({ code: 'INPUT', target: 10, actual: 10, comparison: 'GTE', source: 'MANUAL' }).expect(201);
    const formalIssueId = randomUUID();
    await prisma.$executeRawUnsafe('INSERT INTO new_product_issues(id, organization_id, project_id, trial_batch_id, response_form, complexity, severity, created_by_id) VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,$6,$7,$8::uuid)', formalIssueId, organizationId, project.body.id, batch.body.id, 'BRIEF', 'SIMPLE', 'HIGH', authorId);
    const route = `/api/v1/new-product-quality/trial-batches/${batch.body.id}/summary`;
    await request(server).get(route).expect(404);
    await request(server).post(route).set('Idempotency-Key', randomUUID()).send({ conclusion: '初稿结论' }).expect(201);
    const first = await request(server).put(`${route}/submit`).set('Idempotency-Key', randomUUID()).send({ expectedVersion: 1 }).expect(200);
    expect(first.body.issueSnapshot).toEqual(expect.arrayContaining([expect.objectContaining({ id: formalIssueId, kind: 'FORMAL', severity: 'HIGH' })]));
    const canonical = (value: unknown): string => Array.isArray(value) ? `[${value.map(canonical).join(',')}]` : value && typeof value === 'object' ? `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}` : JSON.stringify(value);
    const expectedDigest = (body: Record<string, unknown>) => createHash('sha256').update(canonical({ batchId: batch.body.id, conclusion: body.conclusion, metricSnapshot: body.metricSnapshot, issueSnapshot: body.issueSnapshot })).digest('hex');
    expect(first.body.sourceSha256).toBe(expectedDigest((await request(server).get(route).expect(200)).body));
    const rejected = await request(server).put(`${route}/decision`).set('x-test-reviewer', 'true').set('Idempotency-Key', randomUUID()).send({ expectedVersion: 2, decision: 'REJECT', note: '补充改善结论' }).expect(200);
    expect(rejected.body.status).toBe('REJECTED');
    await request(server).put(`${route}/revise`).set('Idempotency-Key', randomUUID()).send({ expectedVersion: 2, conclusion: '旧版本冲突' }).expect(409);
    const revised = await request(server).put(`${route}/revise`).set('Idempotency-Key', randomUUID()).send({ expectedVersion: 3, conclusion: '改善后满足试产目标' }).expect(200);
    expect(revised.body).toMatchObject({ status: 'DRAFT', version: 4, conclusion: '改善后满足试产目标', sourceSha256: null });
    const second = await request(server).put(`${route}/submit`).set('Idempotency-Key', randomUUID()).send({ expectedVersion: 4 }).expect(200);
    expect(second.body.sourceSha256).toBe(expectedDigest((await request(server).get(route).expect(200)).body));
    expect(second.body.sourceSha256).not.toBe(first.body.sourceSha256);
    await prisma.$executeRawUnsafe("UPDATE new_product_issues SET status = 'ESCALATED', response_form = 'EIGHT_D', complexity = 'COMPLEX', version = version + 1 WHERE id = $1::uuid", formalIssueId);
    const stale = await request(server).put(`${route}/decision`).set('x-test-reviewer', 'true').set('Idempotency-Key', randomUUID()).send({ expectedVersion: 5, decision: 'APPROVE' }).expect(409);
    expect(stale.body.code).toBe('NEW_PRODUCT_TRIAL_SUMMARY_STALE');
    await request(server).put(`${route}/decision`).set('x-test-reviewer', 'true').set('Idempotency-Key', randomUUID()).send({ expectedVersion: 5, decision: 'REJECT', note: '问题已升级，请重审' }).expect(200);
    await request(server).put(`${route}/revise`).set('Idempotency-Key', randomUUID()).send({ expectedVersion: 6, conclusion: '问题升级后重新评估' }).expect(200);
    const third = await request(server).put(`${route}/submit`).set('Idempotency-Key', randomUUID()).send({ expectedVersion: 7 }).expect(200);
    expect(third.body.issueSnapshot).toEqual(expect.arrayContaining([expect.objectContaining({ id: formalIssueId, responseForm: 'EIGHT_D', status: 'ESCALATED' })]));
    await request(server).put(`${route}/decision`).set('x-test-reviewer', 'true').set('Idempotency-Key', randomUUID()).send({ expectedVersion: 8, decision: 'APPROVE' }).expect(200);
    const history = await request(server).get(`${route}/revisions`).expect(200);
    expect(history.body).toMatchObject([{ revision: 1, sourceSha256: first.body.sourceSha256, decision: 'REJECT' }, { revision: 2, sourceSha256: second.body.sourceSha256, decision: 'REJECT' }, { revision: 3, sourceSha256: third.body.sourceSha256, decision: 'APPROVE' }]);
  });

  it('downloads only the current approved revision as native XLSX and PDF', async () => {
    const server = app.getHttpServer();
    const project = await request(server).post('/api/v1/new-product-quality/projects').set('Idempotency-Key', randomUUID()).send({ code: `EXPORT-${randomUUID().slice(0, 8)}`, name: '导出项目', productCode: 'PART-003' }).expect(201);
    const batch = await request(server).post(`/api/v1/new-product-quality/projects/${project.body.id}/trial-batches`).set('Idempotency-Key', randomUUID()).send({ code: 'RUN-EXPORT' }).expect(201);
    await request(server).post(`/api/v1/new-product-quality/trial-batches/${batch.body.id}/metrics`).set('Idempotency-Key', randomUUID()).send({ code: 'CPK', target: 1.33, actual: 1.4, comparison: 'GTE', source: 'MANUAL' }).expect(201);
    const summaryRoute = `/api/v1/new-product-quality/trial-batches/${batch.body.id}/summary`;
    const exportRoute = `${summaryRoute}/export`;
    await request(server).get(`${exportRoute}/xlsx?expectedVersion=3`).expect(404);
    await request(server).post(summaryRoute).set('Idempotency-Key', randomUUID()).send({ conclusion: '批准试产总结' }).expect(201);
    await request(server).get(`${exportRoute}/xlsx?expectedVersion=1`).expect(409);
    await request(server).put(`${summaryRoute}/submit`).set('Idempotency-Key', randomUUID()).send({ expectedVersion: 1 }).expect(200);
    await request(server).get(`${exportRoute}/pdf?expectedVersion=2`).expect(409);
    await request(server).put(`${summaryRoute}/decision`).set('x-test-reviewer', 'true').set('Idempotency-Key', randomUUID()).send({ expectedVersion: 2, decision: 'APPROVE' }).expect(200);
    await request(server).get(`${exportRoute}/xlsx?expectedVersion=2`).expect(409);
    await request(server).get(`${exportRoute}/xlsx?expectedVersion=3`).set('x-test-other-scope', 'true').expect(403);
    const service = app.get(NewProductQualityService) as unknown as { trialSummarySource: (transaction: AdminTransaction, ...args: string[]) => Promise<{ sourceSha256: string }> };
    const originalSource = service.trialSummarySource.bind(service);
    const observedIsolation: string[] = [];
    const sourceObservation = jest.spyOn(service, 'trialSummarySource').mockImplementation(async (transaction, ...args) => {
      const isolation = await transaction.$queryRawUnsafe<{ transaction_isolation: string }[]>('SHOW transaction_isolation');
      observedIsolation.push(isolation[0]!.transaction_isolation);
      return originalSource(transaction, ...args);
    });
    let xlsx: request.Response;
    try {
      xlsx = await request(server).get(`${exportRoute}/xlsx?expectedVersion=3`).buffer(true).parse(binary).expect(200);
      expect(observedIsolation).toEqual(['repeatable read']);
    } finally {
      sourceObservation.mockRestore();
    }
    expect(xlsx.headers['content-type']).toMatch(/spreadsheetml/);
    expect(xlsx.headers['content-disposition']).toMatch(/\.xlsx"$/);
    expect(xlsx.headers['cache-control']).toBe('no-store');
    expect(xlsx.body.subarray(0, 2).toString()).toBe('PK');
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(xlsx.body);
    expect(workbook.getWorksheet('试产总结')?.getCell('B2').value).toBe(project.body.code);
    expect(workbook.getWorksheet('试产总结')?.getCell('B10').value).toMatch(/^[a-f0-9]{64}$/);
    const pdf = await request(server).get(`${exportRoute}/pdf?expectedVersion=3`).buffer(true).parse(binary).expect(200);
    expect(pdf.headers['content-type']).toMatch(/application\/pdf/);
    expect(pdf.body.subarray(0, 5).toString()).toBe('%PDF-');
    const permission = await prisma.permission.findUniqueOrThrow({ where: { code: 'new-product-quality:projects:read' } });
    const rolePermission = await prisma.rolePermission.findFirstOrThrow({ where: { permissionId: permission.id, role: { code: 'NPTS', organizationId } } });
    await prisma.rolePermission.delete({ where: { roleId_permissionId: { roleId: rolePermission.roleId, permissionId: permission.id } } });
    try {
      await request(server).get(`${exportRoute}/pdf?expectedVersion=3`).expect(403);
    } finally {
      await prisma.rolePermission.create({ data: { roleId: rolePermission.roleId, permissionId: permission.id } });
    }
    await request(server).post(`/api/v1/new-product-quality/trial-batches/${batch.body.id}/metrics`).set('Idempotency-Key', randomUUID()).send({ code: 'DEFECT', target: 2, actual: 1, comparison: 'LTE', source: 'MANUAL' }).expect(201);
    await request(server).get(`${exportRoute}/xlsx?expectedVersion=3`).expect(409);
  });
});
