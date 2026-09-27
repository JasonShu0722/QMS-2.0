import 'reflect-metadata';
import { createHash, randomUUID } from 'node:crypto';
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
  const reviewerId = randomUUID();
  const sessionId = randomUUID();
  const reviewerSessionId = randomUUID();
  const roleId = randomUUID();
  const actor = { id: userId, organizationId, accountType: 'INTERNAL' as const, sessionId };
  const reviewer = { id: reviewerId, organizationId, accountType: 'INTERNAL' as const, sessionId: reviewerSessionId };
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
    await prisma.user.create({ data: { id: reviewerId, organizationId, username: `npe-${reviewerId.slice(0, 8)}`, accountType: 'INTERNAL', passwordHash: 'test-only' } });
    await prisma.session.create({ data: { id: sessionId, userId, tokenHash: randomUUID(), expiresAt: new Date(Date.now() + 3_600_000), reauthenticatedAt: new Date() } });
    await prisma.session.create({ data: { id: reviewerSessionId, userId: reviewerId, tokenHash: randomUUID(), expiresAt: new Date(Date.now() + 3_600_000), reauthenticatedAt: new Date() } });
    await prisma.role.create({ data: { id: roleId, organizationId, code: 'NPE', name: 'New Product QE' } });
    for (const code of ['new-product-quality:projects:read', 'new-product-quality:projects:write']) {
      const permission = await prisma.permission.upsert({ where: { code }, create: { code, name: code }, update: {} });
      await prisma.rolePermission.create({ data: { roleId, permissionId: permission.id } });
    }
    await prisma.userRole.create({ data: { userId, organizationId, roleId } });
    await prisma.userRole.create({ data: { userId: reviewerId, organizationId, roleId } });
  });

  afterAll(async () => prisma.$disconnect());

  async function project() {
    return service.createProject(actor, { code: `NP-${randomUUID().slice(0, 8)}`, name: '电机项目', productCode: `M-${randomUUID().slice(0, 8)}` }, trace(), key());
  }

  async function approveTrialSummary(batchId: string) {
    await service.createTrialSummary(actor, batchId, { conclusion: '试产数据和遗留风险已复核' }, trace(), key());
    await service.submitTrialSummary(actor, batchId, { expectedVersion: 1 }, trace(), key());
    await service.decideTrialSummary(reviewer, batchId, { expectedVersion: 2, decision: 'APPROVE', note: '准予移交' }, trace(), key());
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

  it('records an independent early-flow release with evidence and version history', async () => {
    const created = await project();
    const flow = await service.createEarlyFlow(actor, created.id, { monitoringWindowDays: 30, monitoringFrequency: '每日', plan: '首件与关键尺寸追踪', exitCriteria: '连续三批合格且无未关闭缺陷' }, trace(), key());
    const submitted = await service.submitEarlyFlow(actor, flow.id, { expectedVersion: 1 }, trace(), key());
    const approved = await service.approveEarlyFlow(reviewer, flow.id, { expectedVersion: submitted.version, decision: 'APPROVE', note: '计划通过' }, trace(), key());
    const evidenceId = await evidence('new-product-early-flow', flow.id);
    await prisma.$executeRaw`UPDATE file_objects SET resource_version = ${approved.version} WHERE id = ${evidenceId}::uuid`;
    await expect(service.decideEarlyFlowRelease(actor, flow.id, { expectedVersion: approved.version, decision: 'APPROVE', evidenceObjectId: evidenceId }, trace(), key())).rejects.toMatchObject({ status: 409 });
    const decision = await service.decideEarlyFlowRelease(reviewer, flow.id, { expectedVersion: approved.version, decision: 'APPROVE', evidenceObjectId: evidenceId, note: '已满足退出条件' }, trace(), key());
    expect(decision).toMatchObject({ decision: 'APPROVE', evidenceObjectId: evidenceId, flowVersion: approved.version + 1 });
    await expect(service.decideEarlyFlowRelease(reviewer, flow.id, { expectedVersion: approved.version, decision: 'REJECT', evidenceObjectId: evidenceId, note: '旧版本' }, trace(), key())).rejects.toMatchObject({ status: 409 });
    const detail = await service.projectDetail(actor, created.id);
    expect(detail.early_flow).toMatchObject({ monitoringFrequency: '每日', exitCriteria: '连续三批合格且无未关闭缺陷', releaseDecision: { decision: 'APPROVE', evidenceObjectId: evidenceId } });
    expect(await service.earlyFlowReleases(actor, flow.id)).toHaveLength(1);
  });

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
    const beforeExport = await prisma.auditEvent.count({ where: { organizationId } });
    const exported = await service.trialReportCsv(actor, batch.id);
    expect(exported.filename).toBe(`qms-trial-report-${batch.id}.csv`);
    expect(exported.content).toContain(`"${input.id}"`);
    expect(exported.content).toContain('"MANUAL"');
    expect(exported.content).toContain('metricSetSha256,exportedAt');
    expect(exported.content).not.toContain('batchVersion');
    const digest = exported.content.match(/[a-f0-9]{64}/)?.[0];
    expect(digest).toMatch(/^[a-f0-9]{64}$/);
    const [csvHeader, ...csvRows] = exported.content.slice(1).split('\r\n');
    const sourceHeader = csvHeader!.replace('metricSetSha256,exportedAt,', '');
    const sourceRows = csvRows.map((row) => {
      const metadata = row.match(/,"([a-f0-9]{64})","([^"]+)",/);
      expect(metadata?.[1]).toBe(digest);
      expect(Number.isFinite(Date.parse(metadata?.[2] ?? ''))).toBe(true);
      return row.replace(/,"[a-f0-9]{64}","[^"]+",/, ',');
    });
    expect(createHash('sha256').update([sourceHeader, ...sourceRows].join('\r\n'), 'utf8').digest('hex')).toBe(digest);
    expect((await service.trialReportCsv(actor, batch.id)).content.match(/[a-f0-9]{64}/)?.[0]).toBe(digest);
    expect(await prisma.auditEvent.count({ where: { organizationId } })).toBe(beforeExport);
    await expect(service.trialReportCsv({ ...actor, scopeOrganizationId: otherOrganizationId }, batch.id)).rejects.toMatchObject({ status: 403 });
    await expect(service.recordMetric(actor, batch.id, { code: 'OUTPUT', target: 100, actual: 100, comparison: 'GTE', source: 'IMS' }, trace(), key())).rejects.toMatchObject({ status: 400 });
    await expect(service.recordMetric(actor, batch.id, { code: 'INPUT', target: 100, actual: 100, comparison: 'GTE', source: 'MANUAL' }, trace(), key())).rejects.toMatchObject({ status: 409 });
    await service.recordMetric(actor, batch.id, { code: 'OUTPUT', target: 100, actual: 100, comparison: 'GTE', source: 'MANUAL' }, trace(), key());
    expect((await service.trialReportCsv(actor, batch.id)).content.match(/[a-f0-9]{64}/)?.[0]).not.toBe(digest);
  });

  it('archives a production handover only after stage and trial gates pass', async () => {
    const created = await project();
    const request = { expectedVersion: 1, riskStatement: '试产指标已复核，允许移交量产。' };
    await expect(service.handoverProject(actor, created.id, request, trace(), key())).rejects.toMatchObject({ status: 409 });
    const stage = await service.addStage(actor, created.id, { code: 'SOP', name: '量产前评审' }, trace(), key());
    const deliverable = await service.addDeliverable(actor, stage.id, { code: 'SOP_DOC', name: 'SOP 资料', required: true }, trace(), key());
    const batch = await service.createTrialBatch(actor, created.id, { code: 'TRIAL' }, trace(), key());
    await service.recordMetric(actor, batch.id, { code: 'FIRST_PASS', target: 95, actual: 97, comparison: 'GTE', source: 'MANUAL' }, trace(), key());
    await expect(service.handoverProject(actor, created.id, request, trace(), key())).rejects.toMatchObject({ status: 409 });
    const evidenceObjectId = await evidence('new-product-deliverable', deliverable.id);
    await service.submitDeliverable(actor, deliverable.id, { expectedVersion: 1, evidenceObjectId }, trace(), key());
    await service.reviewStage(actor, stage.id, { expectedVersion: 1, decision: 'PASS' }, trace(), key());
    await service.approveMassProduction(actor, created.id, { decision: 'REJECT', riskStatement: request.riskStatement, evidenceObjectId }, trace(), key());
    await expect(service.handoverProject(actor, created.id, request, trace(), key())).rejects.toMatchObject({ status: 409 });
    await service.approveMassProduction(actor, created.id, { decision: 'APPROVE', riskStatement: request.riskStatement, evidenceObjectId }, trace(), key());
    await expect(service.handoverProject(actor, created.id, request, trace(), key())).rejects.toMatchObject({ status: 409, response: expect.objectContaining({ message: 'NEW_PRODUCT_HANDOVER_TRIAL_SUMMARY_INCOMPLETE' }) });
    await approveTrialSummary(batch.id);
    await service.recordMetric(actor, batch.id, { code: 'CPK', target: 1.33, actual: 1.4, comparison: 'GTE', source: 'MANUAL' }, trace(), key());
    await expect(service.handoverProject(actor, created.id, request, trace(), key())).rejects.toMatchObject({ status: 409, response: expect.objectContaining({ message: 'NEW_PRODUCT_HANDOVER_TRIAL_SUMMARY_STALE' }) });
    await service.reviseTrialSummary(actor, batch.id, { expectedVersion: 3, conclusion: '新增 CPK 指标后的试产结论' }, trace(), key());
    await service.submitTrialSummary(actor, batch.id, { expectedVersion: 4 }, trace(), key());
    await service.decideTrialSummary(reviewer, batch.id, { expectedVersion: 5, decision: 'APPROVE' }, trace(), key());
    await service.createLegacyIssue(actor, created.id, { description: '设备切换时继续监测', riskLevel: 'MEDIUM' }, trace(), key());
    await expect(service.handoverProject(actor, created.id, request, trace(), key())).rejects.toMatchObject({ status: 409, response: expect.objectContaining({ message: 'NEW_PRODUCT_HANDOVER_TRIAL_SUMMARY_STALE' }) });
    await service.reviseTrialSummary(actor, batch.id, { expectedVersion: 6, conclusion: '设备切换风险已纳入跟踪' }, trace(), key());
    await service.submitTrialSummary(actor, batch.id, { expectedVersion: 7 }, trace(), key());
    await service.decideTrialSummary(reviewer, batch.id, { expectedVersion: 8, decision: 'APPROVE' }, trace(), key());
    const requestKey = key();
    const handover = await service.handoverProject(actor, created.id, request, trace(), requestKey);
    expect(handover).toMatchObject({ project_id: created.id, project_version: 1, risk_statement: request.riskStatement });
    expect((await service.handoverProject(actor, created.id, request, trace(), requestKey)).id).toBe(handover.id);
    expect(await service.projectDetail(actor, created.id)).toMatchObject({ status: 'ARCHIVED', handover: { id: handover.id } });
    await expect(service.addStage(actor, created.id, { code: 'LATE', name: '逾期阶段' }, trace(), key())).rejects.toMatchObject({ status: 409 });
    await expect(service.handoverProject(actor, created.id, request, trace(), key())).rejects.toMatchObject({ status: 409 });
  });

  it('requires approved and scanned risk evidence before handing over open issues', async () => {
    const created = await project();
    const stage = await service.addStage(actor, created.id, { code: 'SOP', name: '量产前评审' }, trace(), key());
    const deliverable = await service.addDeliverable(actor, stage.id, { code: 'SOP_DOC', name: 'SOP 资料', required: true }, trace(), key());
    const evidenceObjectId = await evidence('new-product-deliverable', deliverable.id);
    await service.submitDeliverable(actor, deliverable.id, { expectedVersion: 1, evidenceObjectId }, trace(), key());
    await service.reviewStage(actor, stage.id, { expectedVersion: 1, decision: 'PASS' }, trace(), key());
    const batch = await service.createTrialBatch(actor, created.id, { code: 'TRIAL' }, trace(), key());
    await service.recordMetric(actor, batch.id, { code: 'INPUT', target: 100, actual: 100, comparison: 'GTE', source: 'MANUAL' }, trace(), key());
    await service.createLegacyIssue(actor, created.id, { description: '遗留噪声风险', riskLevel: 'HIGH' }, trace(), key());
    const request = { expectedVersion: 1, riskStatement: '风险已评估，批准带病量产。' };
    await expect(service.handoverProject(actor, created.id, request, trace(), key())).rejects.toMatchObject({ status: 409 });
    const otherProject = await project();
    const otherStage = await service.addStage(actor, otherProject.id, { code: 'SOP', name: '另一个项目' }, trace(), key());
    const otherDeliverable = await service.addDeliverable(actor, otherStage.id, { code: 'SOP_DOC', name: '其他项目资料', required: true }, trace(), key());
    await service.approveMassProduction(actor, created.id, { decision: 'APPROVE', riskStatement: request.riskStatement, evidenceObjectId: await evidence('new-product-deliverable', otherDeliverable.id) }, trace(), key());
    await expect(service.handoverProject(actor, created.id, request, trace(), key())).rejects.toMatchObject({ status: 409 });
    const approval = await service.approveMassProduction(actor, created.id, { decision: 'APPROVE', riskStatement: request.riskStatement, evidenceObjectId }, trace(), key());
    await prisma.fileObject.update({ where: { id: evidenceObjectId }, data: { status: 'DELETED', deletedAt: new Date(), deletedById: userId } });
    await expect(service.handoverProject(actor, created.id, request, trace(), key())).rejects.toMatchObject({ status: 409 });
    await prisma.fileObject.update({ where: { id: evidenceObjectId }, data: { status: 'AVAILABLE', deletedAt: null, deletedById: null } });
    await approveTrialSummary(batch.id);
    const handover = await service.handoverProject(actor, created.id, request, trace(), key());
    expect(handover.mass_production_approval_id).toBe(approval.id);
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

  it('closes a trial issue through assignment, measure, independent verification and CAS protected closure', async () => {
    const created = await project();
    const issueId = randomUUID();
    await prisma.$executeRawUnsafe('INSERT INTO new_product_issues(id, organization_id, project_id, response_form, complexity, severity, created_by_id) VALUES ($1::uuid,$2::uuid,$3::uuid,$4,$5,$6,$7::uuid)', issueId, organizationId, created.id, 'BRIEF', 'SIMPLE', 'HIGH', userId);
    expect((await service.issueListForProject(actor, created.id)).stats).toMatchObject({ total: 1, open: 1 });
    const assigned = await service.assignIssue(actor, issueId, { expectedVersion: 1, assigneeUserId: userId }, trace(), key());
    expect(assigned).toMatchObject({ id: issueId, status: 'IN_PROGRESS', version: 2, owner_user_id: userId });
    const measured = await service.recordIssueMeasure(actor, issueId, { expectedVersion: 2, measurePlan: '调整压装压力并连续三批验证', measureDueAt: '2026-10-01T00:00:00.000Z' }, trace(), key());
    expect(measured).toMatchObject({ status: 'IN_PROGRESS', version: 3, measure_plan: '调整压装压力并连续三批验证' });
    await expect(service.verifyIssue(actor, issueId, { expectedVersion: 3, verificationSummary: '复测三批均达到目标' }, trace(), key())).rejects.toMatchObject({ status: 409 });
    const verified = await service.verifyIssue(reviewer, issueId, { expectedVersion: 3, verificationSummary: '复测三批均达到目标' }, trace(), key());
    expect(verified).toMatchObject({ status: 'VERIFIED', version: 4, verified_by_id: reviewerId });
    await expect(service.closeIssue(reviewer, issueId, { expectedVersion: 4, closureNote: '措施有效，问题关闭' }, trace(), key())).rejects.toMatchObject({ status: 409 });
    const closed = await service.closeIssue(actor, issueId, { expectedVersion: 4, closureNote: '措施有效，问题关闭' }, trace(), key());
    expect(closed).toMatchObject({ status: 'CLOSED', version: 5, closed_by_id: userId });
    expect((await service.issueListForProject(actor, created.id)).stats).toMatchObject({ total: 1, closed: 1 });
    await expect(service.closeIssue(actor, issueId, { expectedVersion: 4, closureNote: '重复关闭' }, trace(), key())).rejects.toMatchObject({ status: 409 });
    const actions = await prisma.auditEvent.findMany({ where: { organizationId, resourceId: issueId }, select: { action: true }, orderBy: { createdAt: 'asc' } });
    expect(actions.map((item) => item.action)).toEqual(expect.arrayContaining(['NEW_PRODUCT_ISSUE_ASSIGNED', 'NEW_PRODUCT_ISSUE_MEASURE_RECORDED', 'NEW_PRODUCT_ISSUE_VERIFIED', 'NEW_PRODUCT_ISSUE_CLOSED']));
  });

  it('does not close a formal trial issue while its problem workflow is unfinished', async () => {
    const created = await project();
    const issueId = randomUUID();
    await prisma.$executeRawUnsafe('INSERT INTO new_product_issues(id, organization_id, project_id, response_form, complexity, severity, created_by_id) VALUES ($1::uuid,$2::uuid,$3::uuid,$4,$5,$6,$7::uuid)', issueId, organizationId, created.id, 'BRIEF', 'SIMPLE', 'HIGH', userId);
    const problem = await prisma.problemIndex.create({ data: {
      organizationId, reportNumber: `NP-${randomUUID()}`, domainCode: 'new-product-quality', problemType: 'NEW_PRODUCT_ISSUE',
      sourceType: 'new-product-issue', sourceId: issueId, severity: 'HIGH', status: 'IN_PROGRESS', createdById: userId,
    } });
    await prisma.$executeRawUnsafe("UPDATE new_product_issues SET problem_index_id=$1::uuid, status='VERIFIED', version=4, verified_by_id=$2::uuid WHERE id=$3::uuid", problem.id, reviewerId, issueId);
    await expect(service.closeIssue(actor, issueId, { expectedVersion: 4, closureNote: '领域自行关闭' }, trace(), key()))
      .rejects.toMatchObject({ status: 409 });
  });

  it('enforces organization scope and live permission revocation', async () => {
    const created = await project();
    await expect(service.projectDetail({ ...actor, scopeOrganizationId: otherOrganizationId }, created.id)).rejects.toMatchObject({ status: 403 });
    const permission = await prisma.permission.findUniqueOrThrow({ where: { code: 'new-product-quality:projects:read' } });
    await prisma.rolePermission.delete({ where: { roleId_permissionId: { roleId, permissionId: permission.id } } });
    await expect(service.projectDetail(actor, created.id)).rejects.toMatchObject({ status: 403 });
  });
});
