import 'reflect-metadata';
import { createHash, randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { getDocument, OPS } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { AppModule } from '../../src/app.module.js';
import { GlobalExceptionFilter } from '../../src/common/contracts/global-exception.filter.js';
import { AuditLogService } from '../../src/modules/audit-log/audit-log.service.js';
import { FileLifecycleService } from '../../src/modules/file-management/file-lifecycle.service.js';
import { FileScanWorkerService } from '../../src/modules/file-management/file-scan-worker.service.js';
import { FileVerificationService } from '../../src/modules/file-management/file-verification.service.js';
import { OBJECT_STORAGE, type ObjectStorage } from '../../src/modules/file-management/object-storage.service.js';
import { SupplierEightDService } from '../../src/modules/supplier-quality/supplier-eight-d.service.js';
import { SupplierEightDReportService } from '../../src/modules/supplier-quality/supplier-eight-d-report.service.js';
import type { SupplierEightDReportCore } from '../../src/modules/supplier-quality/supplier-eight-d-report.model.js';
import { isDisposableLoopbackPostgres } from '../disposable-postgres.js';
import { supplierEightDDocument, supplierEightDFixture } from './supplier-eight-d.fixture.js';
import { png } from '../process-quality/process-eight-d-pdf.fixture.js';

if (process.env.QMS_DISPOSABLE_TEST_DB !== 'true' || !isDisposableLoopbackPostgres(process.env.DATABASE_URL)) throw new Error('Supplier report needs its own disposable PostgreSQL, never preview 55440.');
type Fixture = Awaited<ReturnType<typeof supplierEightDFixture>>;

describe('supplier controlled report / actual PostgreSQL, HTTP, storage, scanner and PDF worker', () => {
  let app: INestApplication;
  beforeAll(async () => {
    app = (await Test.createTestingModule({ imports: [AppModule] }).compile()).createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
    app.useGlobalFilters(new GlobalExceptionFilter()); await app.init();
  }, 120_000);
  afterAll(async () => { await app?.close(); });

  async function grantReport(f: Fixture) {
    const permission = await f.db.permission.findUniqueOrThrow({ where: { code: 'supplier-quality:issues:report' } });
    await f.db.rolePermission.create({ data: { roleId: f.f.role.id, permissionId: permission.id } });
    return permission.id;
  }
  async function release(f: Fixture) {
    const current = await f.read();
    const preview = (await f.http(f.sqe.cookie, 'post', `${f.prefix}/disclosure-preview`, { expectedRowVersion: current.rowVersion, selectedFileIds: [] }).expect(200)).body;
    await f.http(f.sqe.cookie, 'post', `${f.prefix}/release`, { expectedRowVersion: preview.rowVersion, previewToken: preview.previewToken, selectedFileIds: [], confirmed: true }).expect(200);
  }
  async function upload(f: Fixture, cookie: string, resourceType = 'supplier-quality') {
    const uploaded = (await f.http(cookie, 'post', 'files/uploads', { resourceType, resourceId: f.draft.id, originalName: '实际检验图.png', contentType: 'image/png',
      sizeBytes: png.length, sha256: createHash('sha256').update(png).digest('hex') }).expect(201)).body;
    expect((await fetch(uploaded.uploadUrl, { method: 'PUT', headers: uploaded.headers, body: png })).status).toBe(200);
    await f.http(cookie, 'post', `files/${uploaded.file.id}/complete`, { expectedVersion: uploaded.file.version }).expect(202);
    const [{ now }] = await f.db.$queryRaw<{ now: Date }[]>`SELECT CURRENT_TIMESTAMP AS now`;
    const offset = now.getTime() - Date.now() + 1000;
    await new FileScanWorkerService(f.db, app.get(FileVerificationService), app.get(AuditLogService), () => new Date(Date.now() + offset)).processDue(100);
    const file = (await f.http(cookie, 'get', `files/${uploaded.file.id}`).expect(200)).body;
    expect(file).toMatchObject({ status: 'AVAILABLE', scanStatus: 'CLEAN' });
    return file;
  }
  async function saveImages(f: Fixture, long = false) {
    const ok = await upload(f, f.vendor.cookie), ng = await upload(f, f.vendor.cookie);
    const document = supplierEightDDocument(); document.description = '供应商压装开裂，中文完整8D固定正文'; document.okFileIds = [ok.id]; document.ngFileIds = [ng.id];
    if (long) document.temporaryMeasures = Array.from({ length: 80 }, (_, i) => ({ id: `measure-${i}`, description: `围堵长表第${i + 1}行：复核真实批次与工位`, departmentOwner: '供应商质量 张工', introducedAt: '2026-10-28', fileIds: [] }));
    const current = await f.read();
    await f.http(f.vendor.cookie, 'put', f.portal, { ...f.version(current), document }).expect(200);
    return { document, ok, ng };
  }

  it('requires internal read+report but uses only supplier responses read plus real same-enterprise release', async () => {
    const f = await supplierEightDFixture(app);
    await f.http(f.sqe.cookie, 'get', `${f.prefix}/report`).expect(403);
    await f.http(f.vendor.cookie, 'get', `${f.portal}/report`).expect(404);
    await grantReport(f);
    const current = await f.http(f.sqe.cookie, 'get', `${f.prefix}/report`).expect(200);
    expect(current.headers['cache-control']).toBe('no-store'); expect(current.headers['x-content-type-options']).toBe('nosniff');
    expect(current.body).toMatchObject({ supplierProblemId: f.draft.id, status: 'DRAFT', view: 'CURRENT' });
    expect((await f.http(f.sqe.cookie, 'get', `${f.prefix}/report?view=APPROVED`).expect(409)).body.code).toBe('SUPPLIER_EIGHT_D_REPORT_APPROVED_UNAVAILABLE');
    expect((await f.http(f.sqe.cookie, 'get', `${f.prefix}/report?revisionId=${randomUUID()}`).expect(404)).body.code).toBe('SUPPLIER_EIGHT_D_REPORT_REVISION_NOT_FOUND');
    expect((await f.http(f.sqe.cookie, 'get', `${f.prefix}/report?revisionId=${randomUUID()}&view=CURRENT`).expect(400)).body.code).toBe('SUPPLIER_EIGHT_D_REPORT_QUERY_INVALID');
    await release(f);
    const portal = await f.http(f.vendor.cookie, 'get', `${f.portal}/report`).expect(200);
    expect(portal.body.snapshot.sources).toEqual([]); expect(portal.headers['cache-control']).toBe('no-store');
    const internalGrants = await f.db.rolePermission.count({ where: { roleId: f.vendor.role.id, permission: { code: { startsWith: 'supplier-quality:issues:' } } } });
    expect(internalGrants).toBe(0);
    await f.http(f.otherVendor.cookie, 'get', `${f.portal}/report`).expect(404);
    await f.http(f.otherVendor.cookie, 'get', `${f.portal}/report/pdf`).expect(404);
  }, 60_000);

  it('preserves Chinese long tables, OK/NG image bytes, immutable approved/history and private closed supplements', async () => {
    const f = await supplierEightDFixture(app); await grantReport(f); await release(f);
    const { document, ok, ng } = await saveImages(f, true);
    let current = await f.read();
    const draftPdf = await f.http(f.vendor.cookie, 'get', `${f.portal}/report/pdf`).expect(200);
    expect(draftPdf.headers['content-type']).toContain('application/pdf'); expect(draftPdf.headers['cache-control']).toBe('no-store');
    const bytes = draftPdf.body as Buffer; expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
    const pdf = getDocument({ data: new Uint8Array(bytes), useSystemFonts: false }); let pdfText = '';
    try {
      const parsed = await pdf.promise; expect(parsed.numPages).toBeGreaterThan(3); let text = '', images = 0;
      for (let i = 1; i <= parsed.numPages; i++) {
        const page = await parsed.getPage(i); text += (await page.getTextContent()).items.map(item => 'str' in item ? item.str : '').join('');
        const ops = await page.getOperatorList(); images += ops.fnArray.filter(op => [OPS.paintImageXObject, OPS.paintInlineImageXObject].includes(op)).length;
      }
      expect(text).toContain('供应商压装开裂'); expect(text).toContain('围堵长表第80行'); expect(text).toContain('D2 OK'); expect(text).toContain('D2 NG'); expect(images).toBeGreaterThanOrEqual(2);
      pdfText = text;
    } finally { await pdf.destroy(); }
    const audit = await f.db.auditEvent.findFirstOrThrow({ where: { resourceId: f.draft.id, action: 'SUPPLIER_EIGHT_D_REPORT_PDF' }, orderBy: { createdAt: 'desc' } });
    expect(audit.metadata).toMatchObject({ sizeBytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
    current = (await f.http(f.vendor.cookie, 'post', `${f.portal}/analysis-complete`, { ...f.version(current), submissionDueAt: '2026-11-03T00:00:00Z' }).expect(201)).body;
    current = (await f.http(f.vendor.cookie, 'post', `${f.portal}/submit`, f.version(current)).expect(201)).body;
    expect((await f.http(f.sqe.cookie, 'get', `${f.prefix}/report`).expect(200)).body.status).toBe('IN_REVIEW');
    expect((await f.decide(f.sqe, current.closure, ['PROFESSIONAL'])).status).toBe(200); current = await f.read();
    expect((await f.decide(f.manager, current.closure, ['SECTION_MANAGER'])).status).toBe(200); current = await f.read();
    const approved = (await f.http(f.sqe.cookie, 'get', `${f.prefix}/report?view=APPROVED`).expect(200)).body;
    expect(approved).toMatchObject({ status: 'APPROVED', revisionId: current.approvedRevisionId });
    expect(approved.snapshot.approvalRounds[0].duties.every((duty: any) => duty.status === 'APPROVED' && duty.decidedBy && duty.decidedAt)).toBe(true);
    const historical = (await f.http(f.vendor.cookie, 'get', `${f.portal}/report?revisionId=${current.approvedRevisionId}`).expect(200)).body;
    const historicalInternal = (await f.http(f.sqe.cookie, 'get', `${f.prefix}/report?revisionId=${current.approvedRevisionId}`).expect(200)).body;
    expect(historical).toMatchObject({ status: 'HISTORICAL', contentVersion: approved.contentVersion });
    expect(historical.snapshot.document).toEqual(approved.snapshot.document);
    const beforeSupplement = (await f.http(f.sqe.cookie, 'get', `${f.prefix}/report`).expect(200)).body;
    expect(beforeSupplement.snapshot.problem.supplementUpdatedAt).toBeNull();
    const privateFile = await upload(f, f.sqe.cookie, 'supplier-eight-d-supplement');
    const supplement = { ...document, description: 'PRIVATE_POST_CLOSE_INTERNAL_ONLY', okFileIds: [ok.id, privateFile.id] };
    await f.http(f.sqe.cookie, 'put', f.prefix, { ...f.version(current), document: supplement }).expect(200);
    const internal = (await f.http(f.sqe.cookie, 'get', `${f.prefix}/report`).expect(200)).body;
    expect(internal.status).toBe('CLOSED_SUPPLEMENT'); expect(internal.snapshot.document.description).toBe(supplement.description);
    const internalPdf = (await f.http(f.sqe.cookie, 'get', `${f.prefix}/report/pdf`).expect(200)).body as Buffer;
    const internalLoading = getDocument({ data: new Uint8Array(internalPdf), useSystemFonts: false });
    const [firstSupplement] = await f.db.$queryRaw<{ recordedAt: Date }[]>`SELECT recorded_at AS "recordedAt" FROM supplier_eight_d_supplements
      WHERE supplier_problem_id = ${f.draft.id}::uuid ORDER BY content_version DESC LIMIT 1`;
    expect(firstSupplement).toBeDefined();
    try {
      const parsed = await internalLoading.promise; let text = '';
      for (let i = 1; i <= parsed.numPages; i++) text += (await (await parsed.getPage(i)).getTextContent()).items.map(item => 'str' in item ? item.str : '').join('');
      expect(text).toContain('原版本实际批准，未覆盖本次补充'); expect(text).not.toContain('旧轮已失效');
      for (const duty of approved.snapshot.approvalRounds[0].duties) {
        expect(text).toContain(`${duty.duty} / APPROVED`);
        expect(text).toContain(`实际签批 ${duty.decidedBy} / ${duty.decidedAt}`);
      }
      expect(text).toContain(`补充更新时间：${firstSupplement!.recordedAt.toISOString()}`);
      expect(text).toContain(supplement.description); expect(text).toContain('物料编码：PART-N5');
    } finally { await internalLoading.destroy(); }
    expect(internal.snapshot.problem.supplementUpdatedAt).toBe(firstSupplement!.recordedAt.toISOString());
    const repeated = (await f.http(f.sqe.cookie, 'get', `${f.prefix}/report`).expect(200)).body;
    expect(repeated.generatedAt).not.toBe(internal.generatedAt);
    expect(repeated.snapshot.problem.supplementUpdatedAt).toBe(internal.snapshot.problem.supplementUpdatedAt);
    expect(approved.snapshot.problem).not.toHaveProperty('supplementUpdatedAt');
    expect(historical.snapshot.problem).not.toHaveProperty('supplementUpdatedAt');
    current = await f.read();
    await f.http(f.manager.cookie, 'put', f.prefix, { ...f.version(current), document: { ...supplement, description: 'PRIVATE_POST_CLOSE_INTERNAL_ONLY_SECOND' } }).expect(200);
    const supplements = await f.db.$queryRaw<{ recordedAt: Date }[]>`SELECT recorded_at AS "recordedAt" FROM supplier_eight_d_supplements
      WHERE supplier_problem_id = ${f.draft.id}::uuid ORDER BY content_version DESC`;
    expect(supplements).toHaveLength(2); expect(supplements[1]!.recordedAt).toEqual(firstSupplement!.recordedAt);
    expect(supplements[0]!.recordedAt.getTime()).toBeGreaterThan(firstSupplement!.recordedAt.getTime());
    const latest = (await f.http(f.sqe.cookie, 'get', `${f.prefix}/report`).expect(200)).body;
    expect(latest.snapshot.problem.supplementUpdatedAt).toBe(supplements[0]!.recordedAt.toISOString());
    expect(latest.snapshot.problem.closedAt).toBe(approved.snapshot.problem.closedAt);
    const external = (await f.http(f.vendor.cookie, 'get', `${f.portal}/report`).expect(200)).body;
    expect(external).toMatchObject({ status: 'APPROVED', revisionId: current.approvedRevisionId, contentVersion: approved.contentVersion, rowVersion: approved.rowVersion });
    expect(external.snapshot.document).toEqual(approved.snapshot.document); expect(external.attachments.map((file: any) => file.id).sort()).toEqual([ok.id, ng.id].sort());
    expect(JSON.stringify(external)).not.toContain(supplement.description); expect(JSON.stringify(external)).not.toContain(privateFile.id);
    expect(external.snapshot.problem).not.toHaveProperty('supplementUpdatedAt');
    const closedPdf = (await f.http(f.vendor.cookie, 'get', `${f.portal}/report/pdf`).expect(200)).body as Buffer;
    const closedLoading = getDocument({ data: new Uint8Array(closedPdf), useSystemFonts: false });
    try {
      const parsed = await closedLoading.promise; let text = '';
      for (let i = 1; i <= parsed.numPages; i++) text += (await (await parsed.getPage(i)).getTextContent()).items.map(item => 'str' in item ? item.str : '').join('');
      expect(text).toContain(document.description); expect(text).not.toContain(supplement.description); expect(text).not.toContain(privateFile.id);
      expect(text).toContain('原批准版');
      expect(text).not.toContain('补充更新时间'); expect(text).not.toContain(supplements[0]!.recordedAt.toISOString());
    } finally { await closedLoading.destroy(); }
    await f.http(f.vendor.cookie, 'post', `files/${privateFile.id}/download`, {}).expect(403);
    const fixed = (await f.http(f.sqe.cookie, 'get', `${f.prefix}/report?view=APPROVED`).expect(200)).body;
    expect(fixed.snapshot).toEqual(approved.snapshot);
    const fixedHistory = (await f.http(f.sqe.cookie, 'get', `${f.prefix}/report?revisionId=${current.approvedRevisionId}`).expect(200)).body;
    expect(fixedHistory.snapshot).toEqual(historicalInternal.snapshot);
    const endpoint = process.env.QMS_OBJECT_STORAGE_ENDPOINT;
    try {
      // A real refused connection in this isolated runner, not a replacement storage/scanner implementation.
      process.env.QMS_OBJECT_STORAGE_ENDPOINT = 'http://127.0.0.1:1';
      const unavailable = await f.http(f.vendor.cookie, 'get', `${f.portal}/report/pdf`).expect(503);
      expect(unavailable.body.code).toBe('INTERNAL_ERROR'); expect(unavailable.body.message).toBe('服务暂时不可用');
      expect(JSON.stringify(unavailable.body)).not.toContain('STORAGE_UNAVAILABLE');
      expect(JSON.stringify(unavailable.body)).not.toContain(privateFile.id);
    } finally {
      if (endpoint === undefined) delete process.env.QMS_OBJECT_STORAGE_ENDPOINT;
      else process.env.QMS_OBJECT_STORAGE_ENDPOINT = endpoint;
    }
    await f.db.fileObject.update({ where: { id: ok.id }, data: { version: { increment: 1 } } });
    expect((await f.http(f.sqe.cookie, 'get', `${f.prefix}/report?revisionId=${current.approvedRevisionId}`).expect(409)).body.code).toBe('SUPPLIER_EIGHT_D_REPORT_VERSION_CONFLICT');
    expect(pdfText).toContain('供应商 8D 报告'); expect(pdfText).not.toContain('内部 8D 报告');
    for (const phrase of ['标题：Supplier defect', '物料编码：PART-N5', '物料类别：未记录', '不良描述：Observed actual nonconformity', '不良数量：2']) expect(pdfText).toContain(phrase);
  }, 120_000);

  it.each(['SESSION', 'REPORT_PERMISSION', 'CONTENT'] as const)('rejects %s changed during actual storage streaming before any success PDF audit', async mode => {
    const f = await supplierEightDFixture(app), permissionId = await grantReport(f); await release(f); await saveImages(f);
    const storage = app.get<ObjectStorage>(OBJECT_STORAGE); let changed = false;
    const intercepted = Object.create(storage) as ObjectStorage;
    intercepted.readVersion = async function* (key, versionId, maxBytes) {
      for await (const chunk of storage.readVersion(key, versionId, maxBytes)) yield chunk;
      if (changed) return; changed = true;
      if (mode === 'SESSION') await f.db.session.update({ where: { id: f.sqe.actor.sessionId }, data: { revokedAt: new Date() } });
      if (mode === 'REPORT_PERMISSION') await f.db.rolePermission.delete({ where: { roleId_permissionId: { roleId: f.f.role.id, permissionId } } });
      if (mode === 'CONTENT') {
        const row = await f.read(); const doc = supplierEightDDocument(); doc.description = 'Changed while PDF was rendering';
        await f.http(f.vendor.cookie, 'put', f.portal, { ...f.version(row), document: doc }).expect(200);
      }
    };
    const service = new SupplierEightDReportService(f.db, app.get(SupplierEightDService) as unknown as SupplierEightDReportCore,
      app.get(FileLifecycleService), intercepted, app.get(AuditLogService));
    await expect(service.pdf(f.sqe.actor, f.draft.id, {}, `actual-race-${mode}`)).rejects.toMatchObject({ status: mode === 'SESSION' ? 401 : mode === 'REPORT_PERMISSION' ? 403 : 409 });
    expect(changed).toBe(true);
    expect(await f.db.auditEvent.count({ where: { resourceId: f.draft.id, action: 'SUPPLIER_EIGHT_D_REPORT_PDF', outcome: 'SUCCESS' } })).toBe(0);
    expect(await f.db.auditEvent.count({ where: { resourceId: f.draft.id, action: 'SUPPLIER_EIGHT_D_REPORT_REJECTED', outcome: 'DENIED', traceId: `actual-race-${mode}` } })).toBe(1);
  }, 90_000);
});
