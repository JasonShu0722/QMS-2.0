import 'reflect-metadata';
import { createHash, randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { AppModule } from '../../src/app.module.js';
import { GlobalExceptionFilter } from '../../src/common/contracts/global-exception.filter.js';
import { isDisposableLoopbackPostgres } from '../disposable-postgres.js';
import { supplierEightDFixture } from './supplier-eight-d.fixture.js';
import { FileScanWorkerService } from '../../src/modules/file-management/file-scan-worker.service.js';
import { FileVerificationService } from '../../src/modules/file-management/file-verification.service.js';
import { AuditLogService } from '../../src/modules/audit-log/audit-log.service.js';
import { png } from '../process-quality/process-eight-d-pdf.fixture.js';
import { FileLifecycleService } from '../../src/modules/file-management/file-lifecycle.service.js';

if (process.env.QMS_DISPOSABLE_TEST_DB !== 'true' || !isDisposableLoopbackPostgres(process.env.DATABASE_URL)) {
  throw new Error('Supplier disclosure requires disposable loopback PostgreSQL, never preview 55440.');
}

describe('supplier disclosure through actual application and enterprise accounts', () => {
  let app: INestApplication;
  beforeAll(async () => {
    app = (await Test.createTestingModule({ imports: [AppModule] }).compile()).createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init();
  }, 120_000);
  afterAll(async () => { await app?.close(); });

  it('publishes only explicitly selected CLEAN staging files, never another staged file or private response evidence', async () => {
    const f = await supplierEightDFixture(app);
    const upload = async () => {
      const value = (await f.http(f.sqe.cookie, 'post', 'files/uploads', {
        resourceType: 'supplier-eight-d-disclosure', resourceId: f.draft.id,
        originalName: 'selected-evidence.png', contentType: 'image/png', sizeBytes: png.length,
        sha256: createHash('sha256').update(png).digest('hex'),
      }).expect(201)).body;
      expect((await fetch(value.uploadUrl, { method: 'PUT', headers: value.headers, body: png })).status).toBe(200);
      await f.http(f.sqe.cookie, 'post', `files/${value.file.id}/complete`, { expectedVersion: value.file.version }).expect(202);
      return value.file.id as string;
    };
    const selected = await upload(), hidden = await upload();
    await f.http(f.vendor.cookie, 'get', `files/${selected}`).expect(404);
    const previewInput = { expectedRowVersion: f.issued.rowVersion, selectedFileIds: [selected] };
    await f.http(f.sqe.cookie, 'post', `${f.prefix}/disclosure-preview`, previewInput).expect(409);
    const [{ now }] = await f.db.$queryRaw<{ now: Date }[]>`SELECT CURRENT_TIMESTAMP AS now`;
    const offset = now.getTime() - Date.now() + 1000;
    const scanner = new FileScanWorkerService(f.db, app.get(FileVerificationService), app.get(AuditLogService), () => new Date(Date.now() + offset));
    await scanner.processDue(100);
    expect((await f.http(f.sqe.cookie, 'get', `files/${selected}`).expect(200)).body.scanStatus).toBe('CLEAN');
    const preview = (await f.http(f.sqe.cookie, 'post', `${f.prefix}/disclosure-preview`, previewInput).expect(200)).body;
    expect(preview.attachments).toEqual([expect.objectContaining({ id: selected, sha256: createHash('sha256').update(png).digest('hex'), scanStatus: 'CLEAN' })]);
    expect(preview.attachments[0]).not.toHaveProperty('objectKey');
    expect(preview.attachments[0]).not.toHaveProperty('objectVersionId');
    const releaseInput = { ...previewInput, previewToken: preview.previewToken, confirmed: true };
    await f.http(f.sqe.cookie, 'post', `${f.prefix}/release`, { ...releaseInput, selectedFileIds: [hidden] }).expect(409);
    await f.http(f.sqe.cookie, 'post', `${f.prefix}/release`, releaseInput).expect(200);
    await f.http(f.vendor.cookie, 'get', `files/${selected}`).expect(200);
    await f.http(f.vendor.cookie, 'get', `files/${hidden}`).expect(403);
    await f.http(f.otherVendor.cookie, 'get', `files/${selected}`).expect(404);
    const download = (await f.http(f.vendor.cookie, 'post', `files/${selected}/download`, {}).expect(201)).body;
    expect(Buffer.from(await (await fetch(download.url)).arrayBuffer())).toEqual(png);
    const listed = await app.get(FileLifecycleService).listResource(f.vendor.actor, { resourceType: 'supplier-eight-d-disclosure', resourceId: f.draft.id });
    expect(listed.map((file: { id: string }) => file.id)).toEqual([selected]);
    const portalFiles = (await f.http(f.vendor.cookie, 'get', `${f.portal}/disclosure-attachments`).expect(200)).body;
    expect(portalFiles).toEqual([expect.objectContaining({ id: selected, resourceType: 'supplier-eight-d-disclosure', resourceId: f.draft.id, scanStatus: 'CLEAN' })]);
    expect(JSON.stringify(portalFiles)).not.toContain(hidden);
    expect(portalFiles[0]).not.toHaveProperty('objectKey');
    expect(portalFiles[0]).not.toHaveProperty('objectVersionId');
    await f.http(f.otherVendor.cookie, 'get', `${f.portal}/disclosure-attachments`).expect(404);
    await f.http(f.sqe.cookie, 'get', `${f.portal}/disclosure-attachments`).expect(403);
    await f.db.rolePermission.deleteMany({ where: { roleId: f.vendor.role.id, permission: { code: 'supplier-quality:responses:read' } } });
    await f.http(f.vendor.cookie, 'get', `${f.portal}/disclosure-attachments`).expect(403);
  }, 30_000);

  it('requires an explicit bound preview before a real same-enterprise release and replays only the original operation', async () => {
    const f = await supplierEightDFixture(app);
    await f.http(f.vendor.cookie, 'get', f.portal).expect(404);
    await f.http(f.vendor.cookie, 'get', `${f.portal}/disclosure-attachments`).expect(404);
    const preview = await f.http(f.sqe.cookie, 'post', `${f.prefix}/disclosure-preview`, {
      expectedRowVersion: f.issued.rowVersion, selectedFileIds: [],
    });
    expect(preview.status).toBe(200);
    expect(preview.body.supplierOrganizationId).toBe(f.vendor.org.id);
    expect(preview.body.publicFacts.materialCode).toBe('PART-N5');
    expect(preview.body.publicFacts).not.toHaveProperty('document');
    expect(preview.body).not.toHaveProperty('sqeAssignmentId');
    const input = { expectedRowVersion: preview.body.rowVersion, previewToken: preview.body.previewToken,
      confirmed: true, selectedFileIds: [] };
    const key = randomUUID();
    const released = await f.http(f.sqe.cookie, 'post', `${f.prefix}/release`, input, key);
    expect(released.status).toBe(200);
    expect(released.body.notificationState).toBe('PENDING_PROJECTION');
    const visible = (await f.http(f.vendor.cookie, 'get', f.portal).expect(200)).body;
    expect(visible.releasedToSupplierAt).toBe(released.body.releasedAt);
    expect((await f.http(f.vendor.cookie, 'get', `${f.portal}/disclosure-attachments`).expect(200)).body).toEqual([]);
    await f.http(f.otherVendor.cookie, 'get', f.portal).expect(404);
    expect((await f.http(f.sqe.cookie, 'post', `${f.prefix}/release`, input, key).expect(200)).body).toEqual(released.body);
    await f.http(f.sqe.cookie, 'post', `${f.prefix}/release`, { ...input, confirmed: false }, key).expect(400);
  }, 30_000);

  it('serializes concurrent release retries into one immutable publication and one event', async () => {
    const f = await supplierEightDFixture(app);
    const preview = (await f.http(f.sqe.cookie, 'post', `${f.prefix}/disclosure-preview`, {
      expectedRowVersion: f.issued.rowVersion, selectedFileIds: [],
    }).expect(200)).body;
    const input = { expectedRowVersion: f.issued.rowVersion, selectedFileIds: [], previewToken: preview.previewToken, confirmed: true };
    const key = randomUUID();
    const results = await Promise.all([1, 2].map(() => f.http(f.sqe.cookie, 'post', `${f.prefix}/release`, input, key)));
    expect(results.map(result => result.status)).toEqual([200, 200]);
    expect(results[0]!.body).toEqual(results[1]!.body);
    const [counts] = await f.db.$queryRaw<{ count: number }[]>`SELECT count(*)::int AS count FROM supplier_eight_d_publications WHERE supplier_problem_id = ${f.draft.id}::uuid`;
    expect(counts!.count).toBe(1);
    expect(await f.db.outboxEvent.count({ where: { aggregateId: f.draft.id, eventType: 'SUPPLIER_EIGHT_D_CHANGED', payload: { path: ['action'], equals: 'RELEASE' } } })).toBe(1);
  }, 30_000);

  it('does not release to an enterprise whose only eligible responder lost write permission after preview', async () => {
    const f = await supplierEightDFixture(app);
    const preview = (await f.http(f.sqe.cookie, 'post', `${f.prefix}/disclosure-preview`, {
      expectedRowVersion: f.issued.rowVersion, selectedFileIds: [],
    }).expect(200)).body;
    const permission = await f.db.permission.findUniqueOrThrow({ where: { code: 'supplier-quality:responses:write' } });
    await f.db.rolePermission.deleteMany({ where: { roleId: f.vendor.role.id, permissionId: permission.id } });
    await f.http(f.sqe.cookie, 'post', `${f.prefix}/release`, {
      expectedRowVersion: f.issued.rowVersion, selectedFileIds: [], previewToken: preview.previewToken, confirmed: true,
    }).expect(409);
    expect((await f.db.supplierQualityProblem.findUniqueOrThrow({ where: { id: f.draft.id } })).releasedToSupplierAt).toBeNull();
    const [counts] = await f.db.$queryRaw<{ count: number }[]>`SELECT count(*)::int AS count FROM supplier_eight_d_publications WHERE supplier_problem_id = ${f.draft.id}::uuid`;
    expect(counts!.count).toBe(0);
  }, 30_000);

  it('rejects a preview after a real content version change, without consuming it or publishing', async () => {
    const f = await supplierEightDFixture(app);
    const preview = (await f.http(f.sqe.cookie, 'post', `${f.prefix}/disclosure-preview`, {
      expectedRowVersion: f.issued.rowVersion, selectedFileIds: [],
    }).expect(200)).body;
    await f.http(f.sqe.cookie, 'put', `${f.prefix}/deadlines`, {
      ...f.version(f.issued), closureDueAt: '2026-12-01T00:00:00Z',
    }).expect(200);
    await f.http(f.sqe.cookie, 'post', `${f.prefix}/release`, {
      expectedRowVersion: f.issued.rowVersion, selectedFileIds: [], previewToken: preview.previewToken, confirmed: true,
    }).expect(409);
    const [stored] = await f.db.$queryRaw<{ consumedAt: Date | null }[]>`SELECT consumed_at AS "consumedAt" FROM supplier_eight_d_disclosure_previews WHERE id = ${preview.previewToken}::uuid`;
    expect(stored!.consumedAt).toBeNull();
    expect((await f.db.supplierQualityProblem.findUniqueOrThrow({ where: { id: f.draft.id } })).releasedToSupplierAt).toBeNull();
  }, 30_000);
});
