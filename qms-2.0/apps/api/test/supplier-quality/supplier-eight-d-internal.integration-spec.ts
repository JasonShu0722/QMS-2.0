import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AppModule } from '../../src/app.module.js';
import { GlobalExceptionFilter } from '../../src/common/contracts/global-exception.filter.js';
import { isDisposableLoopbackPostgres } from '../disposable-postgres.js';
import { supplierEightDDocument, supplierEightDFixture } from './supplier-eight-d.fixture.js';
import { SupplierEightDService } from '../../src/modules/supplier-quality/supplier-eight-d.service.js';

if (process.env.QMS_DISPOSABLE_TEST_DB !== 'true' || !isDisposableLoopbackPostgres(process.env.DATABASE_URL)) throw new Error('Supplier 8D requires disposable loopback PostgreSQL.');

describe('controlled supplier 8D core before external disclosure', () => {
  let app: INestApplication;
  beforeAll(async () => {
    app = (await Test.createTestingModule({ imports: [AppModule] }).compile()).createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init();
  }, 120_000);
  afterAll(async () => { await app?.close(); });

  it('rejects a direct-only SQE appointment rather than treating its functional permissions as a responsible section', async () => {
    const f = await supplierEightDFixture(app);
    await f.db.position.update({ where: { id: f.f.owner.position.id }, data: { departmentId: null } });
    await expect(f.db.$transaction(tx => app.get(SupplierEightDService).disclosureContext(tx, f.sqe.actor, f.draft.id)))
      .rejects.toMatchObject({ response: { code: 'SUPPLIER_EIGHT_D_SQE_ASSIGNMENT_INVALID' }, status: 403 });
    expect((await f.db.supplierQualityProblem.findUniqueOrThrow({ where: { id: f.draft.id } })).releasedToSupplierAt).toBeNull();
  }, 30_000);

  it('offers disclosure only through the actual assigned SQE and exports no document or internal assignment data', async () => {
    const f = await supplierEightDFixture(app);
    const core = app.get(SupplierEightDService);
    const context = await f.db.$transaction(tx => core.disclosureContext(tx, f.sqe.actor, f.draft.id), { isolationLevel: 'ReadCommitted' });
    expect(Object.keys(context).sort()).toEqual(['organizationId', 'supplierProblemId', 'problemId', 'profileId', 'supplierOrganizationId', 'rowVersion', 'contentVersion', 'instanceVersion', 'releasedToSupplierAt', 'publicFacts'].sort());
    expect(context.publicFacts).toEqual({ title: 'Supplier defect', materialCode: 'PART-N5', defectDescription: 'Observed actual nonconformity',
      defectQuantity: 2, severity: 'LOW', reportNumber: f.issued.reportNumber });
    const grant = { organizationId: f.vendor.org.id, version: f.issued.contentVersion };
    expect(await f.db.$transaction(tx => core.disclosureFileGrant(tx, f.sqe.actor, f.draft.id, 'read'))).toEqual(grant);
    for (const action of ['upload', 'complete', 'attach', 'delete'] as const) {
      expect(await f.db.$transaction(tx => core.disclosureFileGrant(tx, f.sqe.actor, f.draft.id, action))).toEqual(grant);
      await expect(f.db.$transaction(tx => core.disclosureFileGrant(tx, f.outsider.actor, f.draft.id, action))).rejects.toMatchObject({ status: 403 });
    }
    await expect(f.db.$transaction(tx => core.disclosureFileGrant(tx, f.vendor.actor, f.draft.id, 'read'))).rejects.toMatchObject({ status: 404 });
    await expect(f.db.$transaction(tx => core.disclosureFileGrant(tx, f.otherVendor.actor, f.draft.id, 'read'))).rejects.toMatchObject({ status: 404 });
    await expect(f.db.$transaction(tx => core.disclosureContext(tx, f.outsider.actor, f.draft.id))).rejects.toMatchObject({ status: 403 });
    await expect(f.db.$transaction(tx => core.disclosureContext(tx, f.outsider.actor, f.draft.id, 'REPLAY'))).rejects.toMatchObject({ status: 403 });
    await f.db.userPosition.update({ where: { id: f.f.owner.assignment.id }, data: { endedAt: new Date() } });
    await expect(f.db.$transaction(tx => core.disclosureContext(tx, f.sqe.actor, f.draft.id))).rejects.toMatchObject({ status: 403 });
    await expect(f.db.$transaction(tx => core.disclosureContext(tx, f.sqe.actor, f.draft.id, 'REPLAY'))).rejects.toMatchObject({ status: 403 });
    await expect(f.db.$transaction(tx => core.disclosureFileGrant(tx, f.sqe.actor, f.draft.id, 'attach'))).rejects.toMatchObject({ status: 403 });
    expect((await f.db.supplierQualityProblem.findUniqueOrThrow({ where: { id: f.draft.id } })).releasedToSupplierAt).toBeNull();
  }, 30_000);

  it('keeps unbound supplier profiles/drafts but rejects SUPPLIER formal issue before creating an index or control', async () => {
    const f = await supplierEightDFixture(app, 'LOW', false, 'INTERNAL');
    const profile = (await f.http(f.sqe.cookie, 'post', 'supplier-quality/profiles', { businessCode: randomUUID(), displayName: 'Unbound enterprise draft' }).expect(201)).body;
    const draft = (await f.http(f.sqe.cookie, 'post', 'supplier-quality/drafts', { profileId: profile.id, title: 'Unbound supplier draft', materialCode: 'UNBOUND',
      defectDescription: 'Actual observation', defectQuantity: 1, severity: 'LOW', responseForm: 'EIGHT_D', replyMode: 'SUPPLIER' }).expect(201)).body;
    const response = await f.http(f.sqe.cookie, 'post', `supplier-quality/eight-d/drafts/${draft.id}/issue`, { expectedVersion: draft.version, sqeAssignmentId: f.f.owner.assignment.id });
    expect(response.status).toBe(409);
    expect(response.body.code).toBe('SUPPLIER_COLLABORATION_NOT_ENABLED');
    const row = await f.db.supplierQualityProblem.findUniqueOrThrow({ where: { id: draft.id } });
    expect(row.problemIndexId).toBeNull();
    expect(row.releasedToSupplierAt).toBeNull();
    expect(await f.db.problemIndex.count({ where: { sourceId: draft.id, domainCode: 'supplier-quality' } })).toBe(0);
    const internalDraft = (await f.http(f.sqe.cookie, 'post', 'supplier-quality/drafts', { profileId: profile.id, title: 'Internal handling without enterprise', materialCode: 'INTERNAL-UNBOUND',
      defectDescription: 'Actual observation', defectQuantity: 1, severity: 'LOW', responseForm: 'EIGHT_D', replyMode: 'INTERNAL', internalResponderId: f.outsider.actor.id }).expect(201)).body;
    const internal = (await f.http(f.sqe.cookie, 'post', `supplier-quality/eight-d/drafts/${internalDraft.id}/issue`, { expectedVersion: internalDraft.version, sqeAssignmentId: f.f.owner.assignment.id }).expect(201)).body;
    expect(internal.releasedToSupplierAt).toBeNull();
    expect((await f.db.supplierQualityProblem.findUniqueOrThrow({ where: { id: internalDraft.id } })).supplierOrganizationId).toBeNull();
  }, 30_000);

  it('uses the actual assigned INTERNAL responder, immutable submission, actual SQE/manager and closed supplements', async () => {
    const f = await supplierEightDFixture(app, 'LOW', false, 'INTERNAL');
    const document = supplierEightDDocument();
    await f.http(f.sqe.cookie, 'put', f.prefix, { ...f.version(f.issued), document }).expect(403);
    const saveKey = randomUUID(), saveBody = { ...f.version(f.issued), document };
    const saved = (await f.http(f.outsider.cookie, 'put', f.prefix, saveBody, saveKey).expect(200)).body;
    let current = saved;
    current = (await f.http(f.outsider.cookie, 'post', `${f.prefix}/analysis-complete`, { ...f.version(current), submissionDueAt: '2026-11-03T00:00:00Z' }).expect(201)).body;
    const key = randomUUID(), body = f.version(current);
    current = (await f.http(f.outsider.cookie, 'post', `${f.prefix}/submit`, body, key).expect(201)).body;
    expect(current.submittedAt).toBeTruthy();
    expect((await f.db.supplierResponseRevision.findUniqueOrThrow({ where: { id: current.submittedRevisionId } })).submittedById).toBe(f.outsider.actor.id);
    expect((await f.http(f.outsider.cookie, 'post', `${f.prefix}/submit`, body, key).expect(201)).body).toEqual(current);
    await f.decide(f.manager, current.closure, ['SECTION_MANAGER']).then(r => expect(r.status).toBe(409));
    const professional = await f.decide(f.sqe, current.closure, ['PROFESSIONAL']);
    expect(professional.status).toBe(200);
    const management = await f.decide(f.manager, professional.body, ['SECTION_MANAGER']);
    expect(management.status).toBe(200);
    const closed = await f.read();
    expect(closed.status).toBe('CLOSED');
    expect(closed.approvedRevisionId).toBe(current.submittedRevisionId);
    expect((await f.http(f.outsider.cookie, 'put', f.prefix, saveBody, saveKey).expect(200)).body).toEqual(saved);
    document.closureSummary = 'Actual internal supplement';
    const updated = (await f.http(f.sqe.cookie, 'put', f.prefix, { ...f.version(closed), document }).expect(200)).body;
    expect(updated.closedAt).toBe(closed.closedAt);
    expect(updated.approvedRevisionId).toBe(closed.approvedRevisionId);
    expect(updated.contentVersion).toBe(closed.contentVersion + 1);
    await f.http(f.vendor.cookie, 'get', f.portal).expect(404);
    const history = (await f.http(f.sqe.cookie, 'get', `workflow-closure/problems/${current.problemId}/rounds`).expect(200)).body;
    expect(history).toHaveLength(1);
    expect(history[0].status).toBe('APPROVED');
  }, 30_000);

  it('rolls back the whole submission when an actual manager loses the required appointment', async () => {
    const f = await supplierEightDFixture(app, 'HIGH', false, 'INTERNAL');
    let current = (await f.http(f.outsider.cookie, 'put', f.prefix, { ...f.version(f.issued), document: supplierEightDDocument() }).expect(200)).body;
    current = (await f.http(f.outsider.cookie, 'post', `${f.prefix}/analysis-complete`, { ...f.version(current), submissionDueAt: '2026-11-03T00:00:00Z' }).expect(201)).body;
    const before = await f.read(), key = randomUUID();
    await f.db.userPosition.update({ where: { id: f.f.manager.assignment.id }, data: { endedAt: new Date() } });
    await f.http(f.outsider.cookie, 'post', `${f.prefix}/submit`, f.version(current), key).expect(409);
    expect(await f.read()).toEqual(before);
    expect(await f.db.supplierResponseRevision.count({ where: { problemId: f.draft.id } })).toBe(0);
    const [counts] = await f.db.$queryRaw<{ origins: number; receipts: number; rounds: number }[]>`SELECT
      (SELECT count(*)::int FROM supplier_eight_d_submission_origins WHERE supplier_problem_id = ${f.draft.id}::uuid) AS origins,
      (SELECT count(*)::int FROM supplier_eight_d_receipts WHERE supplier_problem_id = ${f.draft.id}::uuid AND action = 'SUBMIT') AS receipts,
      (SELECT count(*)::int FROM workflow_closure_rounds WHERE problem_id = ${current.problemId}::uuid) AS rounds`;
    expect(counts).toEqual({ origins: 0, receipts: 0, rounds: 0 });
    await f.db.userPosition.update({ where: { id: f.f.manager.assignment.id }, data: { endedAt: null } });
    const submitted = (await f.http(f.outsider.cookie, 'post', `${f.prefix}/submit`, f.version(current), key).expect(201)).body;
    expect(submitted.closure.roundNumber).toBe(1);
  }, 30_000);

  it('CAS closes once, concurrent saves preserve versions, and two actors can independently reuse a key', async () => {
    const f = await supplierEightDFixture(app, 'LOW', false, 'INTERNAL');
    let current = (await f.http(f.outsider.cookie, 'put', f.prefix, { ...f.version(f.issued), document: supplierEightDDocument() }).expect(200)).body;
    current = (await f.http(f.outsider.cookie, 'post', `${f.prefix}/analysis-complete`, { ...f.version(current), submissionDueAt: '2026-11-03T00:00:00Z' }).expect(201)).body;
    current = (await f.http(f.outsider.cookie, 'post', `${f.prefix}/submit`, f.version(current)).expect(201)).body;
    const professional = await f.decide(f.sqe, current.closure, ['PROFESSIONAL']);
    expect(professional.status).toBe(200);
    const decisions = await Promise.all([f.decide(f.manager, professional.body, ['SECTION_MANAGER']), f.decide(f.manager, professional.body, ['SECTION_MANAGER'])]);
    expect(decisions.map(r => r.status).sort()).toEqual([200, 409]);
    const closed = await f.read();
    const documents = ['SQE concurrent supplement', 'Manager concurrent supplement'].map(closureSummary => ({ ...supplierEightDDocument(), closureSummary }));
    const saves = await Promise.all([
      f.http(f.sqe.cookie, 'put', f.prefix, { ...f.version(closed), document: documents[0] }),
      f.http(f.manager.cookie, 'put', f.prefix, { ...f.version(closed), document: documents[1] }),
    ]);
    expect(saves.map(r => r.status).sort()).toEqual([200, 409]);
    const after = await f.read();
    expect(after).toMatchObject({ rowVersion: closed.rowVersion + 1, contentVersion: closed.contentVersion + 1,
      instanceVersion: closed.instanceVersion, closedAt: closed.closedAt, approvedRevisionId: closed.approvedRevisionId });
    const [counts] = await f.db.$queryRaw<{ supplements: number; closures: number }[]>`SELECT
      (SELECT count(*)::int FROM supplier_eight_d_supplements WHERE supplier_problem_id = ${f.draft.id}::uuid) AS supplements,
      (SELECT count(*)::int FROM audit_events WHERE resource_id = ${f.draft.id} AND action = 'SUPPLIER_EIGHT_D_CLOSED') AS closures`;
    expect(counts).toEqual({ supplements: 1, closures: 1 });
    const sharedKey = randomUUID();
    const first = (await f.http(f.sqe.cookie, 'put', f.prefix, { ...f.version(after), document: { ...supplierEightDDocument(), closureSummary: 'SQE actor-scoped key' } }, sharedKey).expect(200)).body;
    const second = (await f.http(f.manager.cookie, 'put', f.prefix, { ...f.version(first), document: { ...supplierEightDDocument(), closureSummary: 'Manager independent same key' } }, sharedKey).expect(200)).body;
    expect(second.rowVersion).toBe(after.rowVersion + 2);
    expect(second.closedAt).toBe(closed.closedAt);
  }, 30_000);
});
