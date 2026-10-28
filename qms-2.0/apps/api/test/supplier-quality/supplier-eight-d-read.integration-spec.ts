import 'reflect-metadata';
import { jest } from '@jest/globals';
import { createHash, randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { AppModule } from '../../src/app.module.js';
import { GlobalExceptionFilter } from '../../src/common/contracts/global-exception.filter.js';
import { SessionService } from '../../src/modules/identity/session.service.js';
import { isDisposableLoopbackPostgres } from '../disposable-postgres.js';
import { supplierEightDDocument, supplierEightDFixture } from './supplier-eight-d.fixture.js';
import { SupplierEightDReadAdapter } from '../../src/modules/supplier-quality/supplier-eight-d-read.adapter.js';
import { SupplierEightDService } from '../../src/modules/supplier-quality/supplier-eight-d.service.js';
import { AuditLogService } from '../../src/modules/audit-log/audit-log.service.js';
import { FileScanWorkerService } from '../../src/modules/file-management/file-scan-worker.service.js';
import { FileVerificationService } from '../../src/modules/file-management/file-verification.service.js';
import { png } from '../process-quality/process-eight-d-pdf.fixture.js';

if (process.env.QMS_DISPOSABLE_TEST_DB !== 'true' || !isDisposableLoopbackPostgres(process.env.DATABASE_URL)) throw new Error('Supplier read bridge requires disposable loopback PostgreSQL, never preview 55440.');

describe('supplier full 8D production problem-index read routing', () => {
  let app: INestApplication;
  beforeAll(async () => {
    app = (await Test.createTestingModule({ imports: [AppModule] }).compile()).createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init();
  }, 120_000);
  afterAll(async () => { await app?.close(); });

  async function fixture(mode: 'SUPPLIER' | 'INTERNAL' = 'SUPPLIER') {
    const f = await supplierEightDFixture(app, 'LOW', false, mode);
    const permission = await f.db.permission.findUniqueOrThrow({ where: { code: 'problem-index:read' } });
    await f.db.rolePermission.create({ data: { roleId: f.f.role.id, permissionId: permission.id } });
    const legacyRead = await f.db.permission.findUniqueOrThrow({ where: { code: 'supplier-quality:problems:read' } });
    await f.db.rolePermission.deleteMany({ where: { roleId: f.f.role.id, permissionId: legacyRead.id } });
    return f;
  }

  async function legacy(f: Awaited<ReturnType<typeof fixture>>, responseForm: 'BRIEF' | 'EIGHT_D') {
    const record = await f.db.supplierQualityProblem.create({ data: {
      ownerOrganizationId: f.f.org.id, supplierOrganizationId: f.vendor.org.id, profileId: f.profile.id,
      createdById: f.sqe.actor.id, title: `Legacy ${responseForm}`, materialCode: 'OLD-PART', defectDescription: 'Legacy retained facts',
      defectQuantity: 1, severity: 'LOW', responseForm, replyMode: 'SUPPLIER',
    } });
    const index = await f.db.problemIndex.create({ data: { organizationId: f.f.org.id, reportNumber: randomUUID(),
      domainCode: 'supplier-quality', sourceType: 'supplier-quality', sourceId: record.id, problemType: responseForm, severity: 'LOW' } });
    await f.db.supplierQualityProblem.update({ where: { id: record.id }, data: { problemIndexId: index.id } });
    return { record, index };
  }

  async function upload(f: Awaited<ReturnType<typeof fixture>>, cookie: string, resourceType: string) {
    const upload = (await f.http(cookie, 'post', 'files/uploads', { resourceType, resourceId: f.draft.id, originalName: 'Actual bridge evidence.png',
      contentType: 'image/png', sizeBytes: png.length, sha256: createHash('sha256').update(png).digest('hex') }).expect(201)).body;
    expect((await fetch(upload.uploadUrl, { method: 'PUT', headers: upload.headers, body: png })).status).toBe(200);
    await f.http(cookie, 'post', `files/${upload.file.id}/complete`, { expectedVersion: upload.file.version }).expect(202);
    const [{ now }] = await f.db.$queryRaw<{ now: Date }[]>`SELECT CURRENT_TIMESTAMP AS now`;
    const offset = now.getTime() - Date.now() + 1000;
    await new FileScanWorkerService(f.db, app.get(FileVerificationService), app.get(AuditLogService), () => new Date(Date.now() + offset)).processDue(100);
    const file = (await f.http(cookie, 'get', `files/${upload.file.id}`).expect(200)).body;
    expect(file).toMatchObject({ status: 'AVAILABLE', scanStatus: 'CLEAN' });
    return file.id as string;
  }

  it('RED: issues:read without legacy problems:read sees a controlled case through actual controller list, detail and CURRENT workspace', async () => {
    const f = await fixture();
    await legacy(f, 'EIGHT_D');
    const id = f.issued.problemId;
    for (const route of ['problem-index', 'problem-center']) {
      const page = (await f.http(f.sqe.cookie, 'get', `${route}?domainCode=supplier-quality&pageSize=1`).expect(200)).body;
      expect(page).toMatchObject({ total: 1, items: [{ id, sourceId: f.draft.id, summary: { domainUiKey: 'supplier-eight-d' } }] });
      expect(page.statusCounts.reduce((n: number, s: { count: number }) => n + s.count, 0)).toBe(1);
    }
    await f.http(f.sqe.cookie, 'get', `problem-index/${id}`).expect(200);
    const workspace = (await f.http(f.sqe.cookie, 'get', `problem-index/${id}/workspace`).expect(200)).body;
    expect(workspace).toMatchObject({ domainAvailability: 'AVAILABLE', problem: { sourceId: f.draft.id },
      selectedInstance: { current: true }, domain: { summary: { domainUiKey: 'supplier-eight-d' } } });
    expect(workspace.actions.filter((a: { actionKey: string }) => a.actionKey.startsWith('platform.'))).toEqual([]);
    expect(JSON.stringify(workspace)).toContain('PART-N5');
  }, 30_000);

  it('filters actual own supplier response forms, retaining both legacy forms without treating old EIGHT_D as controlled', async () => {
    const f = await fixture();
    const brief = await legacy(f, 'BRIEF'), eightD = await legacy(f, 'EIGHT_D');
    const permission = await f.db.permission.findUniqueOrThrow({ where: { code: 'supplier-quality:problems:read' } });
    await f.db.rolePermission.create({ data: { roleId: f.f.role.id, permissionId: permission.id } });
    for (const [form, ids] of [['BRIEF', [brief.index.id]], ['EIGHT_D', [f.issued.problemId, eightD.index.id]]] as const) {
      const page = (await f.http(f.sqe.cookie, 'get', `problem-index?domainCode=supplier-quality&responseForm=${form}`).expect(200)).body;
      expect(page.total).toBe(ids.length);
      expect(page.items.map((i: { id: string }) => i.id).sort()).toEqual([...ids].sort());
    }
    const old = (await f.http(f.sqe.cookie, 'get', `problem-index/${eightD.index.id}/workspace`).expect(200)).body;
    expect(old.domain.summary.domainUiKey).toBe('supplier-quality');
  }, 30_000);

  it('uses bounded metadata for the actual page without per-row report, draft or evidence loading', async () => {
    const f = await fixture();
    const secondDraft = (await f.http(f.sqe.cookie, 'post', 'supplier-quality/drafts', { profileId: f.profile.id, title: 'Second real controlled case',
      materialCode: 'SECOND-PART', defectDescription: 'Another actual defect', defectQuantity: 1, severity: 'LOW', responseForm: 'EIGHT_D', replyMode: 'SUPPLIER' }).expect(201)).body;
    await f.http(f.sqe.cookie, 'post', `supplier-quality/eight-d/drafts/${secondDraft.id}/issue`, {
      expectedVersion: secondDraft.version, sqeAssignmentId: f.f.owner.assignment.id,
    }).expect(201);
    const core = app.get(SupplierEightDService);
    const reportReads = jest.spyOn(core, 'readReport'), recordReads = jest.spyOn(core, 'lockRecord');
    try {
      const page = (await f.http(f.sqe.cookie, 'get', 'problem-index?domainCode=supplier-quality&pageSize=100').expect(200)).body;
      expect(page.total).toBe(2);
      expect(page.items).toHaveLength(2);
      for (const row of page.items) {
        expect(row.summary.fields).toEqual(expect.arrayContaining([
          { key: 'supplierName', label: '责任供应商', value: 'Supplier actual profile' },
          { key: 'stage', label: '当前阶段', value: '分析阶段' },
          expect.objectContaining({ key: 'materialCode' }), expect.objectContaining({ key: 'analysisDueAt' }),
          expect.objectContaining({ key: 'submissionDueAt' }), expect.objectContaining({ key: 'closureDueAt' }),
        ]));
      }
      expect(reportReads).not.toHaveBeenCalled();
      expect(recordReads).not.toHaveBeenCalled();
    } finally { reportReads.mockRestore(); recordReads.mockRestore(); }
  }, 30_000);

  it('distinguishes a supported empty controlled revision trail from unsupported legacy trails', async () => {
    const f = await fixture();
    const brief = await legacy(f, 'BRIEF'), eightD = await legacy(f, 'EIGHT_D');
    const permission = await f.db.permission.findUniqueOrThrow({ where: { code: 'supplier-quality:problems:read' } });
    await f.db.rolePermission.create({ data: { roleId: f.f.role.id, permissionId: permission.id } });
    const adapter = app.get(SupplierEightDReadAdapter);
    for (const [id, supported] of [[f.issued.problemId, true], [brief.index.id, false], [eightD.index.id, false]] as const) {
      const problem = await f.db.problemIndex.findUniqueOrThrow({ where: { id } });
      expect(await f.db.$transaction(tx => adapter.listRevisionIds(tx, { actor: f.sqe.actor, problem, purpose: 'history' })))
        .toEqual(supported ? [] : null);
      const revisions = jest.spyOn(adapter, 'listRevisionIds');
      try {
        const trail = (await f.http(f.sqe.cookie, 'get', `problems/${id}/audit-trail`).expect(200)).body;
        expect(trail.domainRevisionTrailAvailable).toBe(supported);
        expect(revisions).toHaveBeenCalledTimes(1);
      } finally { revisions.mockRestore(); }
    }
  }, 30_000);

  it('does not expand controlled supplier ownership through foreign-tenant feature grants', async () => {
    const f = await fixture();
    const organization = await f.db.organization.create({ data: { code: randomUUID(), name: 'Other actual internal tenant', type: 'INTERNAL' } });
    const user = await f.db.user.create({ data: { organizationId: organization.id, username: randomUUID(), accountType: 'INTERNAL', passwordHash: 'unused-session-fixture' } });
    await f.db.userRole.create({ data: { userId: user.id, roleId: f.f.role.id, organizationId: f.f.org.id } });
    const token = await app.get(SessionService).create(user.id, f.db, { mfaVerified: true });
    const cookie = `qms_session=${token}`;
    const page = (await f.http(cookie, 'get', `problem-index?organizationId=${f.f.org.id}`).expect(200)).body;
    expect(page).toMatchObject({ total: 0, items: [], statusCounts: [] });
    await f.http(cookie, 'get', `problem-index/${f.issued.problemId}/workspace?organizationId=${f.f.org.id}`).expect(404);
  }, 30_000);

  it('applies actual permission revocation before pagination and status counts', async () => {
    const f = await fixture();
    const permission = await f.db.permission.findUniqueOrThrow({ where: { code: 'supplier-quality:issues:read' } });
    await f.db.rolePermission.deleteMany({ where: { roleId: f.f.role.id, permissionId: permission.id } });
    const page = (await f.http(f.sqe.cookie, 'get', 'problem-index?pageSize=1').expect(200)).body;
    expect(page).toMatchObject({ total: 0, items: [], statusCounts: [] });
    await f.http(f.sqe.cookie, 'get', `problem-index/${f.issued.problemId}/workspace`).expect(404);
  }, 30_000);

  it('does not let legacy problems:read substitute for controlled issues:read', async () => {
    const f = await fixture();
    const old = await legacy(f, 'EIGHT_D');
    const legacyPermission = await f.db.permission.findUniqueOrThrow({ where: { code: 'supplier-quality:problems:read' } });
    await f.db.rolePermission.create({ data: { roleId: f.f.role.id, permissionId: legacyPermission.id } });
    const controlledPermission = await f.db.permission.findUniqueOrThrow({ where: { code: 'supplier-quality:issues:read' } });
    await f.db.rolePermission.deleteMany({ where: { roleId: f.f.role.id, permissionId: controlledPermission.id } });
    const page = (await f.http(f.sqe.cookie, 'get', 'problem-index?domainCode=supplier-quality&pageSize=1').expect(200)).body;
    expect(page).toMatchObject({ total: 1, items: [{ id: old.index.id, summary: { domainUiKey: 'supplier-quality' } }] });
    await f.http(f.sqe.cookie, 'get', `problem-index/${old.index.id}/workspace`).expect(200);
    await f.http(f.sqe.cookie, 'get', `problem-index/${f.issued.problemId}`).expect(404);
  }, 30_000);

  it('rejects a mismatched profile enterprise through the real database constraint', async () => {
    const f = await fixture();
    await expect(f.db.supplierBusinessProfile.update({ where: { id: f.profile.id }, data: { supplierOrganizationId: f.otherVendor.org.id } })).rejects.toMatchObject({ code: 'P2003' });
    await f.http(f.sqe.cookie, 'get', `problem-index/${f.issued.problemId}/workspace`).expect(200);
  }, 30_000);

  it('filters an invalid source link before count and pagination', async () => {
    const f = await fixture();
    await f.db.problemIndex.update({ where: { id: f.issued.problemId }, data: { sourceId: randomUUID() } });
    const page = (await f.http(f.sqe.cookie, 'get', 'problem-index?domainCode=supplier-quality&pageSize=1').expect(200)).body;
    expect(page).toMatchObject({ total: 0, items: [], statusCounts: [] });
    await f.http(f.sqe.cookie, 'get', `problem-index/${f.issued.problemId}/workspace`).expect(404);
  }, 30_000);

  it('requires the extra report permission without hiding the live CURRENT workspace', async () => {
    const f = await fixture();
    await f.http(f.sqe.cookie, 'get', `problem-index/${f.issued.problemId}/workspace`).expect(200);
    await f.http(f.sqe.cookie, 'get', `reports/problems/${f.issued.problemId}`).expect(403);
  }, 30_000);

  it('keeps live workspace, immutable submitted report, approved closure and historical instances distinct', async () => {
    const f = await fixture('INTERNAL');
    const reportPermission = await f.db.permission.findUniqueOrThrow({ where: { code: 'supplier-quality:issues:report' } });
    await f.db.rolePermission.create({ data: { roleId: f.f.role.id, permissionId: reportPermission.id } });
    const reportPath = `reports/problems/${f.issued.problemId}`, workspacePath = `problem-index/${f.issued.problemId}/workspace`;
    const empty = (await f.http(f.sqe.cookie, 'get', reportPath).expect(200)).body;
    expect(empty).toMatchObject({ dataAvailability: 'UNAVAILABLE', revision: null });
    const evidenceId = await upload(f, f.outsider.cookie, 'supplier-quality');
    let document = { ...supplierEightDDocument(), description: 'First frozen submission', okFileIds: [evidenceId] };
    let current = (await f.http(f.outsider.cookie, 'put', f.prefix, { ...f.version(f.issued), document }).expect(200)).body;
    current = (await f.http(f.outsider.cookie, 'post', `${f.prefix}/analysis-complete`, { ...f.version(current), submissionDueAt: '2099-11-03T00:00:00Z' }).expect(201)).body;
    current = (await f.http(f.outsider.cookie, 'post', `${f.prefix}/submit`, f.version(current)).expect(201)).body;
    const firstId = current.submittedRevisionId;
    expect((await f.http(f.sqe.cookie, 'get', reportPath).expect(200)).body.revision.id).toBe(firstId);
    expect((await f.decide(f.sqe, current.closure, ['PROFESSIONAL'], 'RETURN')).status).toBe(200);
    current = await f.read();
    document = { ...document, description: 'Second current document' };
    current = (await f.http(f.outsider.cookie, 'put', f.prefix, { ...f.version(current), document }).expect(200)).body;
    const live = (await f.http(f.sqe.cookie, 'get', workspacePath).expect(200)).body;
    expect(JSON.stringify(live.domain.sections)).toContain('Second current document');
    const frozen = (await f.http(f.sqe.cookie, 'get', reportPath).expect(200)).body;
    expect(frozen.evidence.map((file: { id: string }) => file.id)).toEqual([evidenceId]);
    expect(JSON.stringify(frozen.sections)).toContain('First frozen submission');
    expect(JSON.stringify(frozen.sections)).not.toContain('Second current document');
    current = (await f.http(f.outsider.cookie, 'post', `${f.prefix}/submit`, f.version(current)).expect(201)).body;
    const secondId = current.submittedRevisionId;
    const professional = await f.decide(f.sqe, current.closure, ['PROFESSIONAL']);
    expect(professional.status).toBe(200);
    expect((await f.decide(f.manager, professional.body, ['SECTION_MANAGER'])).status).toBe(200);
    current = await f.read();
    expect(current.approvedRevisionId).toBe(secondId);
    const privateId = await upload(f, f.sqe.cookie, 'supplier-eight-d-supplement');
    document = { ...document, description: 'Private closed supplement', okFileIds: [evidenceId, privateId] };
    await f.http(f.sqe.cookie, 'put', f.prefix, { ...f.version(current), document }).expect(200);
    const approved = (await f.http(f.sqe.cookie, 'get', workspacePath).expect(200)).body;
    expect(approved.domain.revisionId).toBe(secondId);
    expect(JSON.stringify(approved.domain.sections)).toContain('Second current document');
    expect(JSON.stringify(approved.domain.sections)).not.toContain('Private closed supplement');
    expect(approved.evidence.map((file: { id: string }) => file.id)).toEqual([evidenceId]);
    expect(JSON.stringify(approved)).not.toContain(privateId);
    const problem = await f.db.problemIndex.findUniqueOrThrow({ where: { id: f.issued.problemId } });
    const adapter = app.get(SupplierEightDReadAdapter);
    expect(adapter.revisionResourceType).toBe('SupplierResponseRevision');
    expect(await f.db.$transaction(tx => adapter.listEvidenceReferences(tx, { actor: f.sqe.actor, problem, purpose: 'report' }, secondId)))
      .toEqual([{ fileId: evidenceId, resourceType: 'supplier-quality', resourceId: f.draft.id }]);
    await expect(f.db.$transaction(tx => adapter.listEvidenceReferences(tx, { actor: f.sqe.actor, problem, purpose: 'report' }, randomUUID())))
      .rejects.toMatchObject({ status: 404 });
    const revisionIds = await f.db.$transaction(tx => adapter.listRevisionIds(tx, { actor: f.sqe.actor, problem, purpose: 'history' }));
    expect(revisionIds).not.toBeNull();
    expect(revisionIds && [...revisionIds].sort()).toEqual([firstId, secondId].sort());
    const original = await f.db.workflowInstance.findUniqueOrThrow({ where: { id: problem.workflowInstanceId! } });
    const historical = await f.db.workflowInstance.create({ data: { organizationId: f.f.org.id, problemIndexId: problem.id,
      workflowDefinitionId: original.workflowDefinitionId, workflowVersionId: original.workflowVersionId, instanceKey: randomUUID(), status: 'COMPLETED' } });
    const history = (await f.http(f.sqe.cookie, 'get', `${workspacePath}?instanceId=${historical.id}`).expect(200)).body;
    expect(history).toMatchObject({ domainAvailability: 'UNAVAILABLE', domain: null, readOnly: true, actions: [], evidence: [] });
    expect(JSON.stringify(history)).not.toContain('Private closed supplement');
  }, 30_000);

  it('never routes supplier accounts into the internal center even with explicit feature and owner-scope grants', async () => {
    const f = await fixture();
    const role = await f.db.role.create({ data: { organizationId: f.f.org.id, code: randomUUID(), name: 'Explicit negative read grant' } });
    for (const code of ['problem-index:read', 'supplier-quality:issues:read', 'supplier-quality:problems:read']) {
      const permission = await f.db.permission.findUniqueOrThrow({ where: { code } });
      await f.db.rolePermission.create({ data: { roleId: role.id, permissionId: permission.id } });
    }
    await f.db.userRole.create({ data: { userId: f.vendor.user.id, organizationId: f.f.org.id, roleId: role.id } });
    const token = await app.get(SessionService).create(f.vendor.user.id, f.db, { mfaVerified: true });
    const cookie = `qms_session=${token}`;
    const ownRead = await f.db.permission.findUniqueOrThrow({ where: { code: 'problem-index:read' } });
    await f.db.rolePermission.create({ data: { roleId: f.vendor.role.id, permissionId: ownRead.id } });
    const page = (await f.http(cookie, 'get', 'problem-index').expect(200)).body;
    expect(page).toMatchObject({ total: 0, items: [], statusCounts: [] });
    await f.http(cookie, 'get', `problem-index/${f.issued.problemId}/workspace`).expect(404);
    await f.http(cookie, 'get', `problem-index?organizationId=${f.f.org.id}`).expect(403);
  }, 30_000);
});
