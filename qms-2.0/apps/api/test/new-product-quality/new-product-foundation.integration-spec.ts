import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../src/database/prisma.service.js';
import { AdminMutationService } from '../../src/common/security/admin-mutation.service.js';
import { AuditLogService } from '../../src/modules/audit-log/audit-log.service.js';
import { NewProductQualityService } from '../../src/modules/new-product-quality/new-product-quality.service.js';
import { FileResourceAccess } from '../../src/modules/file-management/file-resource-access.js';
import { NewProductFileResourceAdapter } from '../../src/modules/new-product-quality/new-product-file-resource.adapter.js';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl || process.env.QMS_DISPOSABLE_TEST_DB !== 'true' || new URL(databaseUrl).port === '55440') {
  throw new Error('An independent disposable PostgreSQL database is required');
}

describe('new product foundation on PostgreSQL', () => {
  const prisma = new PrismaService(databaseUrl);
  const audit = new AuditLogService(prisma);
  const mutations = new AdminMutationService(prisma, audit);
  const service = new NewProductQualityService(prisma, mutations, audit);
  const organizationId = randomUUID();
  const otherOrganizationId = randomUUID();
  const userId = randomUUID();
  const sessionId = randomUUID();
  const roleId = randomUUID();
  const actor = { id: userId, organizationId, accountType: 'INTERNAL' as const, sessionId };
  const trace = () => randomUUID();
  const key = () => randomUUID();

  beforeAll(async () => {
    await prisma.$connect();
    const [server] = await prisma.$queryRaw<{ server_version_num: string }[]>`SHOW server_version_num`;
    expect(Number(server!.server_version_num)).toBeGreaterThanOrEqual(180000);
    for (const [id, code] of [[organizationId, 'owner'], [otherOrganizationId, 'other']]) {
      await prisma.organization.create({ data: { id, code: `NP-${code}-${id.slice(0, 8)}`, name: code, type: 'INTERNAL' } });
    }
    await prisma.user.create({ data: { id: userId, organizationId, username: `npe-${userId.slice(0, 8)}`, accountType: 'INTERNAL', passwordHash: 'test-only' } });
    await prisma.session.create({ data: { id: sessionId, userId, tokenHash: randomUUID(), expiresAt: new Date(Date.now() + 3_600_000), reauthenticatedAt: new Date() } });
    await prisma.role.create({ data: { id: roleId, organizationId, code: 'NPE', name: 'New Product QE' } });
    for (const code of ['new-product-quality:projects:read', 'new-product-quality:projects:write']) {
      const permission = await prisma.permission.upsert({ where: { code }, create: { code, name: code }, update: {} });
      await prisma.rolePermission.create({ data: { roleId, permissionId: permission.id } });
    }
    await prisma.userRole.create({ data: { userId, organizationId, roleId } });
  });

  afterAll(async () => prisma.$disconnect());

  async function project() {
    return service.createProject(actor, { code: `NP-${randomUUID().slice(0, 8)}`, name: '电机项目', productCode: `M-${randomUUID().slice(0, 8)}` }, trace(), key());
  }

  async function evidence(resourceType: string, resourceId: string) {
    const sha256 = 'a'.repeat(64);
    const file = await prisma.fileObject.create({ data: {
      organizationId, objectKey: `new-product/${randomUUID()}`, originalName: 'proof.png', contentType: 'image/png',
      sizeBytes: 16n, sha256, verifiedSha256: sha256, verifiedContentType: 'image/png', verifiedSizeBytes: 16n,
      objectVersionId: randomUUID(), uploadCompletedAt: new Date(), scanStatus: 'CLEAN', scannedAt: new Date(),
      scannerEngine: 'test-scanner', status: 'AVAILABLE', resourceType, resourceId, resourceVersion: 1,
      uploadedById: userId,
    } });
    return file.id;
  }

  it('creates a project idempotently and blocks stage review until deliverables have evidence', async () => {
    const requestKey = key();
    const code = `NP-${randomUUID().slice(0, 8)}`;
    const created = await service.createProject(actor, { code, name: '首件项目', productCode: 'M-100' }, trace(), requestKey);
    expect((await service.createProject(actor, { code, name: '首件项目', productCode: 'M-100' }, trace(), requestKey)).id).toBe(created.id);
    const stage = await service.addStage(actor, created.id, { code: 'DV', name: '设计验证' }, trace(), key());
    const deliverable = await service.addDeliverable(actor, stage.id, { code: 'DRAWING', name: '设计图纸', required: true }, trace(), key());
    await expect(service.reviewStage(actor, stage.id, { expectedVersion: 1, decision: 'PASS' }, trace(), key())).rejects.toMatchObject({ status: 409 });
    const evidenceId = await evidence('new-product-deliverable', deliverable.id);
    await service.submitDeliverable(actor, deliverable.id, { expectedVersion: 1, evidenceObjectId: evidenceId }, trace(), key());
    await prisma.fileObject.update({ where: { id: evidenceId }, data: { status: 'DELETED', deletedAt: new Date(), deletedById: userId } });
    await expect(service.reviewStage(actor, stage.id, { expectedVersion: 1, decision: 'PASS' }, trace(), key())).rejects.toMatchObject({ status: 409 });
    await prisma.fileObject.update({ where: { id: evidenceId }, data: { status: 'AVAILABLE', deletedAt: null, deletedById: null } });
    const reviewed = await service.reviewStage(actor, stage.id, { expectedVersion: 1, decision: 'PASS' }, trace(), key());
    expect(reviewed.status).toBe('PASSED');
    await expect(service.reviewStage(actor, stage.id, { expectedVersion: 1, decision: 'PASS' }, trace(), key())).rejects.toMatchObject({ status: 409 });
  });

  it('requires linked lessons to be checked with evidence before stage passage', async () => {
    const created = await project();
    const stage = await service.addStage(actor, created.id, { code: 'PV', name: '试产验证' }, trace(), key());
    const deliverable = await service.addDeliverable(actor, stage.id, { code: 'REPORT', name: '试产报告', required: true }, trace(), key());
    await service.submitDeliverable(actor, deliverable.id, { expectedVersion: 1, evidenceObjectId: await evidence('new-product-deliverable', deliverable.id) }, trace(), key());
    const lesson = await service.createLesson(actor, { title: '电机异响', lesson: '改善轴承压装', productCode: 'M-100' }, trace(), key());
    const obligation = await service.attachLesson(actor, created.id, lesson.id, trace(), key());
    await expect(service.reviewStage(actor, stage.id, { expectedVersion: 1, decision: 'PASS' }, trace(), key())).rejects.toMatchObject({ status: 409 });
    await expect(service.confirmLesson(actor, obligation.id, { expectedVersion: 1, avoided: false }, trace(), key())).rejects.toMatchObject({ status: 400 });
    await service.confirmLesson(actor, obligation.id, { expectedVersion: 1, avoided: false, reason: '设计方案不同', evidenceObjectId: await evidence('new-product-lesson-check', obligation.id) }, trace(), key());
    expect((await service.reviewStage(actor, stage.id, { expectedVersion: 1, decision: 'PASS' }, trace(), key())).status).toBe('PASSED');
  });

  it('injects matching manual lessons when a product project is created', async () => {
    const productCode = `M-${randomUUID().slice(0, 8)}`;
    const matched = await service.createLesson(actor, { title: '线束松动', lesson: '增加拉拔检查', productCode }, trace(), key());
    await service.createLesson(actor, { title: '其他产品问题', lesson: '复核图纸', productCode: 'OTHER' }, trace(), key());
    const created = await service.createProject(actor, { code: `NP-${randomUUID().slice(0, 8)}`, name: '线束项目', productCode }, trace(), key());
    expect((await service.projectDetail(actor, created.id)).lessons.map((item: { lesson_id: string }) => item.lesson_id)).toEqual([matched.id]);
  });

  it('records manual trial targets and actuals and reports red/green results', async () => {
    const created = await project();
    const batch = await service.createTrialBatch(actor, created.id, { code: 'T1', workOrderCode: 'IMS-WO-123' }, trace(), key());
    const input = await service.recordMetric(actor, batch.id, { code: 'INPUT', target: 100, actual: 120, comparison: 'GTE', source: 'MANUAL' }, trace(), key());
    expect(input.version).toBe(1);
    await service.recordMetric(actor, batch.id, { code: 'FIRST_PASS', target: 95, actual: 90, comparison: 'GTE', source: 'MANUAL' }, trace(), key());
    await service.recordMetric(actor, batch.id, { code: 'CPK', target: 1.33, actual: 1.41, comparison: 'GTE', source: 'MANUAL' }, trace(), key());
    const report = await service.trialReport(actor, batch.id);
    expect(report.metrics.map((metric: { code: string; signal: string }) => [metric.code, metric.signal])).toEqual([['CPK', 'GREEN'], ['FIRST_PASS', 'RED'], ['INPUT', 'GREEN']]);
    await expect(service.recordMetric(actor, batch.id, { code: 'OUTPUT', target: 100, actual: 100, comparison: 'GTE', source: 'IMS' }, trace(), key())).rejects.toMatchObject({ status: 400 });
    await expect(service.recordMetric(actor, batch.id, { code: 'INPUT', target: 100, actual: 100, comparison: 'GTE', source: 'MANUAL' }, trace(), key())).rejects.toMatchObject({ status: 409 });
  });

  it('allows real file upload authorization only for editable project resources', async () => {
    const resources = new FileResourceAccess([]);
    new NewProductFileResourceAdapter(resources).onModuleInit();
    const created = await project();
    const stage = await service.addStage(actor, created.id, { code: 'UPLOAD', name: '证据测试' }, trace(), key());
    const deliverable = await service.addDeliverable(actor, stage.id, { code: 'EVIDENCE', name: '检查表', required: true }, trace(), key());
    const grant = await prisma.$transaction((tx) => resources.authorizeAndLock(tx, actor, { resourceType: 'new-product-deliverable', resourceId: deliverable.id }, 'upload'));
    expect(grant).toMatchObject({ organizationId, version: 1 });
    await expect(prisma.$transaction((tx) => resources.authorizeAndLock(tx, { ...actor, organizationId: otherOrganizationId }, { resourceType: 'new-product-deliverable', resourceId: deliverable.id }, 'upload'))).rejects.toMatchObject({ status: 403 });
    await service.submitDeliverable(actor, deliverable.id, { expectedVersion: 1, evidenceObjectId: await evidence('new-product-deliverable', deliverable.id) }, trace(), key());
    await service.reviewStage(actor, stage.id, { expectedVersion: 1, decision: 'PASS' }, trace(), key());
    await expect(prisma.$transaction((tx) => resources.authorizeAndLock(tx, actor, { resourceType: 'new-product-deliverable', resourceId: deliverable.id }, 'upload'))).rejects.toMatchObject({ status: 403 });
  });

  it('enforces organization scope and live permission revocation', async () => {
    const created = await project();
    await expect(service.projectDetail({ ...actor, scopeOrganizationId: otherOrganizationId }, created.id)).rejects.toMatchObject({ status: 403 });
    const permission = await prisma.permission.findUniqueOrThrow({ where: { code: 'new-product-quality:projects:read' } });
    await prisma.rolePermission.delete({ where: { roleId_permissionId: { roleId, permissionId: permission.id } } });
    await expect(service.projectDetail(actor, created.id)).rejects.toMatchObject({ status: 403 });
  });
});
