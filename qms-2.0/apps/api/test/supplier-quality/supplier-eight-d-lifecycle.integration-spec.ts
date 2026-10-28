import 'reflect-metadata';
import { createHash, randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { AppModule } from '../../src/app.module.js';
import { GlobalExceptionFilter } from '../../src/common/contracts/global-exception.filter.js';
import { isDisposableLoopbackPostgres } from '../disposable-postgres.js';
import { supplierEightDDocument, supplierEightDFixture } from './supplier-eight-d.fixture.js';
import { FileScanWorkerService } from '../../src/modules/file-management/file-scan-worker.service.js';
import { FileVerificationService } from '../../src/modules/file-management/file-verification.service.js';
import { AuditLogService } from '../../src/modules/audit-log/audit-log.service.js';
import { SupplierEightDService } from '../../src/modules/supplier-quality/supplier-eight-d.service.js';
import { WorkflowRuntimeService } from '../../src/modules/workflow/workflow-runtime.service.js';
import { png } from '../process-quality/process-eight-d-pdf.fixture.js';

if (process.env.QMS_DISPOSABLE_TEST_DB !== 'true' || !isDisposableLoopbackPostgres(process.env.DATABASE_URL)) throw new Error('Supplier 8D requires disposable loopback PostgreSQL, never preview 55440.');
type Fixture = Awaited<ReturnType<typeof supplierEightDFixture>>;

describe('supplier 8D actual domain lifecycle / HTTP / PostgreSQL', () => {
  let app: INestApplication;
  beforeAll(async () => {
    app = (await Test.createTestingModule({ imports: [AppModule] }).compile()).createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init();
  }, 120_000);
  afterAll(async () => { await app?.close(); });

  async function release(f: Fixture) {
    const current = await f.read();
    const preview = (await f.http(f.sqe.cookie, 'post', `${f.prefix}/disclosure-preview`, { expectedRowVersion: current.rowVersion, selectedFileIds: [] }).expect(200)).body;
    await f.http(f.sqe.cookie, 'post', `${f.prefix}/release`, { expectedRowVersion: preview.rowVersion, previewToken: preview.previewToken, confirmed: true, selectedFileIds: [] }).expect(200);
  }
  async function prepare(f: Fixture) {
    if (f.mode === 'SUPPLIER') await release(f);
    const person = f.mode === 'SUPPLIER' ? f.vendor : f.outsider, path = f.mode === 'SUPPLIER' ? f.portal : f.prefix;
    let current = await f.read();
    current = (await f.http(person.cookie, 'put', path, { ...f.version(current), document: supplierEightDDocument() }).expect(200)).body;
    current = (await f.http(person.cookie, 'post', `${path}/analysis-complete`, { ...f.version(current), submissionDueAt: '2026-11-03T00:00:00Z' }).expect(201)).body;
    return { current, person, path };
  }
  async function submit(f: Fixture) {
    const { current, person, path } = await prepare(f);
    return (await f.http(person.cookie, 'post', `${path}/submit`, f.version(current)).expect(201)).body;
  }
  async function upload(f: Fixture, cookie: string, resourceType: string) {
    const upload = (await f.http(cookie, 'post', 'files/uploads', { resourceType, resourceId: f.draft.id, originalName: 'actual-evidence.png', contentType: 'image/png',
      sizeBytes: png.length, sha256: createHash('sha256').update(png).digest('hex') }).expect(201)).body;
    expect((await fetch(upload.uploadUrl, { method: 'PUT', headers: upload.headers, body: png })).status).toBe(200);
    await f.http(cookie, 'post', `files/${upload.file.id}/complete`, { expectedVersion: upload.file.version }).expect(202);
    const [{ now }] = await f.db.$queryRaw<{ now: Date }[]>`SELECT CURRENT_TIMESTAMP AS now`;
    const offset = now.getTime() - Date.now() + 1000;
    const scanner = new FileScanWorkerService(f.db, app.get(FileVerificationService), app.get(AuditLogService), () => new Date(Date.now() + offset));
    await scanner.processDue(100);
    const file = (await f.http(cookie, 'get', `files/${upload.file.id}`).expect(200)).body;
    expect(file).toMatchObject({ status: 'AVAILABLE', scanStatus: 'CLEAN' });
    return file;
  }

  it('issues one existing supplier primary, without fabricated delivery or deadlines, and replays exact issue', async () => {
    const f = await supplierEightDFixture(app);
    expect(f.issued).toMatchObject({ supplierProblemId: f.draft.id, sqeUserId: f.f.owner.user.id, sqeAssignmentId: f.f.owner.assignment.id,
      responsibleSectionDepartmentId: f.f.section.id, analysisDueAt: null, closureDueAt: null, submissionDueAt: null, releasedToSupplierAt: null, approvedRevisionId: null });
    const primary = await f.db.supplierQualityProblem.findUniqueOrThrow({ where: { id: f.draft.id } });
    const index = await f.db.problemIndex.findUniqueOrThrow({ where: { id: primary.problemIndexId! } });
    expect(index.ownerId).toBe(f.sqe.actor.id);
    expect(index.dueAt).toBeNull();
    expect(await f.db.supplierQualityProblem.count({ where: { id: f.draft.id } })).toBe(1);
    expect((await f.http(f.sqe.cookie, 'post', `supplier-quality/eight-d/drafts/${f.draft.id}/issue`, f.issueInput, f.issueKey).expect(201)).body).toEqual(f.issued);
    const issuedEvents = await f.db.outboxEvent.findMany({ where: { aggregateId: f.draft.id, eventType: 'SUPPLIER_EIGHT_D_CHANGED', payload: { path: ['action'], equals: 'ISSUE' } } });
    expect(issuedEvents).toHaveLength(1);
    expect(issuedEvents[0]!.payload).toMatchObject({ schemaVersion: 1, supplierProblemId: f.draft.id, organizationId: f.f.org.id,
      problemId: f.issued.problemId, rowVersion: f.issued.rowVersion, contentVersion: f.issued.contentVersion, action: 'ISSUE' });
    await f.http(f.vendor.cookie, 'get', f.portal).expect(404);
    await f.http(f.otherVendor.cookie, 'get', f.portal).expect(404);
    await f.http(f.vendor.cookie, 'put', f.portal, { ...f.version(f.issued), document: supplierEightDDocument() }).expect(404);
    await f.http(f.sqe.cookie, 'post', `supplier-quality/eight-d/drafts/${f.draft.id}/issue`, { ...f.issueInput, expectedVersion: primary.version }).expect(409);
  }, 30_000);

  it.each(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const)('%s: real supplier origin, SQE first, all actual management duties, immutable approved basis', async severity => {
    const f = await supplierEightDFixture(app, severity);
    const submitted = await submit(f);
    const round = submitted.closure;
    expect(round.duties.find((d: { duty: string }) => d.duty === 'PROFESSIONAL').status).toBe('PENDING');
    expect(round.duties.filter((d: { duty: string }) => d.duty !== 'PROFESSIONAL').every((d: { status: string }) => d.status === 'WAITING')).toBe(true);
    const [origin] = await f.db.$queryRaw<{ submittedBy: string; org: string; creator: string; creatorOrg: string; revision: string }[]>`SELECT o.submitted_by AS "submittedBy", o.submitted_organization_id AS org,
      r.created_by AS creator, r.creator_organization_id AS "creatorOrg", r.supplier_response_revision_id AS revision
      FROM supplier_eight_d_submission_origins o JOIN workflow_closure_rounds r ON r.supplier_response_revision_id = o.revision_id WHERE r.id = ${round.id}::uuid`;
    expect(origin).toEqual({ submittedBy: f.vendor.user.id, org: f.vendor.org.id, creator: f.vendor.user.id, creatorOrg: f.vendor.org.id, revision: submitted.submittedRevisionId });
    await f.decide(f.manager, round, ['SECTION_MANAGER']).then(r => expect(r.status).toBe(409));
    await f.http(f.vendor.cookie, 'put', f.portal, { ...f.version(submitted), document: supplierEightDDocument() }).expect(409);
    await f.decide(f.outsider, round, ['PROFESSIONAL']).then(r => expect(r.status).toBe(403));
    let currentRound = (await f.decide(f.sqe, round, ['PROFESSIONAL'])).body;
    expect((await f.read()).closedAt).toBeNull();
    currentRound = (await f.decide(f.manager, currentRound, ['SECTION_MANAGER'])).body;
    if (severity === 'HIGH' || severity === 'CRITICAL') {
      expect((await f.read()).closedAt).toBeNull();
      currentRound = (await f.decide(f.minister, currentRound, ['MINISTER'])).body;
    }
    expect(currentRound.status).toBe('APPROVED');
    const closed = await f.read();
    expect(closed.status).toBe('CLOSED');
    expect(closed.approvedRevisionId).toBe(submitted.submittedRevisionId);
    expect(closed.closedAt).toBeTruthy();
    expect((await f.db.supplierResponseRevision.findUniqueOrThrow({ where: { id: closed.approvedRevisionId } })).submittedById).toBe(f.vendor.user.id);
    expect(currentRound.duties.every((d: { status: string; decidedBy: string }) => d.status === 'APPROVED' && d.decidedBy)).toBe(true);
  }, 30_000);

  it('can issue to a bound active enterprise without an active portal account and never fabricates delivery', async () => {
    const f = await supplierEightDFixture(app);
    await f.db.user.update({ where: { id: f.vendor.user.id }, data: { status: 'DISABLED' } });
    const draft = (await f.http(f.sqe.cookie, 'post', 'supplier-quality/drafts', { profileId: f.profile.id, title: 'No account defect', materialCode: 'NO-ACCOUNT',
      defectDescription: 'Actual fact', defectQuantity: 1, severity: 'LOW', responseForm: 'EIGHT_D', replyMode: 'SUPPLIER' }).expect(201)).body;
    const issued = (await f.http(f.sqe.cookie, 'post', `supplier-quality/eight-d/drafts/${draft.id}/issue`, { expectedVersion: draft.version, sqeAssignmentId: f.f.owner.assignment.id }).expect(201)).body;
    expect(issued.releasedToSupplierAt).toBeNull();
    const row = await f.db.supplierQualityProblem.findUniqueOrThrow({ where: { id: draft.id } });
    expect(row.supplierOrganizationId).toBe(f.vendor.org.id);
    expect(row.releasedToSupplierAt).toBeNull();
    await f.http(f.otherVendor.cookie, 'get', `supplier-portal/eight-d/${draft.id}`).expect(404);
  }, 30_000);

  it('same actual manager/minister explicitly confirms two duties; neither is skipped', async () => {
    const f = await supplierEightDFixture(app, 'HIGH', true);
    let round = (await submit(f)).closure;
    round = (await f.decide(f.sqe, round, ['PROFESSIONAL'])).body;
    await f.decide(f.manager, round, ['SECTION_MANAGER']).then(r => expect(r.status).toBe(409));
    await f.decide(f.manager, round, ['MINISTER']).then(r => expect(r.status).toBe(409));
    round = (await f.decide(f.manager, round, ['SECTION_MANAGER', 'MINISTER'])).body;
    expect(round.status).toBe('APPROVED');
    expect(round.duties.filter((d: { duty: string }) => d.duty !== 'PROFESSIONAL').map((d: { status: string; decidedBy: string }) => [d.status, d.decidedBy])).toEqual([
      ['APPROVED', f.manager.actor.id], ['APPROVED', f.manager.actor.id],
    ]);
    expect((await f.read()).closedAt).toBeTruthy();
  }, 30_000);

  it('return invalidates the entire round and resubmission requires SQE and both managers again', async () => {
    const f = await supplierEightDFixture(app, 'CRITICAL');
    let current = await submit(f), old = current.closure;
    const firstRevisionId = current.submittedRevisionId;
    old = (await f.decide(f.sqe, old, ['PROFESSIONAL'])).body;
    old = (await f.decide(f.manager, old, ['SECTION_MANAGER'])).body;
    const pendingRound = old, returnKey = randomUUID();
    old = (await f.decide(f.minister, pendingRound, ['MINISTER'], 'RETURN', returnKey)).body;
    expect(old.status).toBe('RETURNED');
    current = await f.read();
    expect(current.submittedRevisionId).toBeNull();
    await f.decide(f.minister, pendingRound, ['MINISTER'], 'RETURN', returnKey).then(r => expect(r.status).toBe(200));
    const returnedEvents = await f.db.outboxEvent.findMany({ where: { aggregateId: f.draft.id, eventType: 'SUPPLIER_EIGHT_D_CHANGED', payload: { path: ['action'], equals: 'RETURN' } } });
    expect(returnedEvents).toHaveLength(1);
    expect(returnedEvents[0]!.eventKey).toMatch(new RegExp(`^supplier-eight-d:${f.draft.id}:RETURN:[a-f0-9]{64}$`));
    expect(returnedEvents[0]!.payload).toMatchObject({ schemaVersion: 1, supplierProblemId: f.draft.id, organizationId: f.f.org.id,
      problemId: current.problemId, rowVersion: current.rowVersion, contentVersion: current.contentVersion, action: 'RETURN' });
    const next = (await f.http(f.vendor.cookie, 'post', `${f.portal}/submit`, f.version(current)).expect(201)).body;
    expect(next.submittedRevisionId).not.toBe(firstRevisionId);
    expect(next.closure.roundNumber).toBe(2);
    expect(next.closure.duties.map((d: { status: string }) => d.status)).toEqual(['PENDING', 'WAITING', 'WAITING']);
    await f.decide(f.minister, old, ['MINISTER']).then(r => expect([403, 409]).toContain(r.status));
    let round = (await f.decide(f.sqe, next.closure, ['PROFESSIONAL'])).body;
    round = (await f.decide(f.minister, round, ['MINISTER'])).body;
    expect((await f.read()).closedAt).toBeNull();
    await f.decide(f.manager, round, ['SECTION_MANAGER']).then(r => expect(r.status).toBe(200));
    expect((await f.read()).status).toBe('CLOSED');
  }, 30_000);

  it('reauthorizes exact receipt body and enterprise, rejects version conflicts and does not guess the latest revision', async () => {
    const f = await supplierEightDFixture(app);
    const { current } = await prepare(f), key = randomUUID(), body = f.version(current);
    const submitted = (await f.http(f.vendor.cookie, 'post', `${f.portal}/submit`, body, key).expect(201)).body;
    const replay = (await f.http(f.vendor.cookie, 'post', `${f.portal}/submit`, body, key).expect(201)).body;
    expect(replay).toEqual(submitted);
    await f.http(f.vendor.cookie, 'post', `${f.portal}/submit`, { ...body, expectedRowVersion: body.expectedRowVersion + 1 }, key).expect(409);
    await f.http(f.otherVendor.cookie, 'post', `${f.portal}/submit`, body, key).expect(404);
    expect(await f.db.supplierResponseRevision.count({ where: { problemId: f.draft.id } })).toBe(1);
    await f.decide(f.sqe, submitted.closure, ['PROFESSIONAL'], 'RETURN').then(r => expect(r.status).toBe(200));
    const returned = await f.read();
    const resubmitted = (await f.http(f.vendor.cookie, 'post', `${f.portal}/submit`, f.version(returned)).expect(201)).body;
    expect(resubmitted.submittedRevisionId).not.toBe(submitted.submittedRevisionId);
    const firstReplay = (await f.http(f.vendor.cookie, 'post', `${f.portal}/submit`, body, key).expect(201)).body;
    expect(firstReplay).toEqual(submitted);
    expect(firstReplay.submittedRevisionId).not.toBe(resubmitted.submittedRevisionId);
    const permission = await f.db.permission.findUniqueOrThrow({ where: { code: 'supplier-quality:responses:write' } });
    await f.db.rolePermission.delete({ where: { roleId_permissionId: { roleId: f.vendor.role.id, permissionId: permission.id } } });
    await f.http(f.vendor.cookie, 'post', `${f.portal}/submit`, body, key).expect(403);
  }, 30_000);

  it('rejects old partial-body and generic workflow bypasses without changing the controlled document or instance', async () => {
    const f = await supplierEightDFixture(app);
    const { current } = await prepare(f), before = await f.read();
    const legacyContent = { rootCause: 'Cannot overwrite the controlled full document', correctiveAction: 'Rejected legacy write' };
    await f.http(f.vendor.cookie, 'put', `supplier-portal/problems/${f.draft.id}/response-draft`, { expectedVersion: current.contentVersion, content: legacyContent }).expect(409);
    await f.http(f.vendor.cookie, 'post', `supplier-portal/problems/${f.draft.id}/actions`, { expectedContentVersion: current.contentVersion, content: legacyContent }).expect(409);
    for (const action of ['VERIFY', 'RETURN', 'CLOSE', 'REOPEN']) {
      await f.http(f.sqe.cookie, 'post', `supplier-quality/problems/${f.draft.id}/workflow-actions`, { action, expectedContentVersion: current.contentVersion }).expect(409);
    }
    const index = await f.db.problemIndex.findUniqueOrThrow({ where: { id: current.problemId } });
    const instance = await f.db.workflowInstance.findUniqueOrThrow({ where: { id: current.instanceId } });
    // This is an attempted generic-server bypass by the actual authenticated SQE, never a vendor impersonation.
    await expect(app.get(WorkflowRuntimeService).submitAction({ organizationId: f.f.org.id, actor: f.sqe.actor, problemIndexId: index.id,
      workflowVersionId: instance.workflowVersionId, expectedProblemVersion: index.version, instanceId: instance.id, currentNodeId: instance.currentNodeId!,
      expectedVersion: instance.version, action: 'SUBMIT', idempotencyKey: randomUUID(), traceId: randomUUID() })).rejects.toMatchObject({ status: 409 });
    expect(await f.read()).toEqual(before);
    expect(await f.db.supplierResponseRevision.count({ where: { problemId: f.draft.id } })).toBe(0);
    const submitted = (await f.http(f.vendor.cookie, 'post', `${f.portal}/submit`, f.version(current)).expect(201)).body;
    expect(submitted.closure.roundNumber).toBe(1);
    expect(submitted.submittedRevisionId).toBeTruthy();
  }, 30_000);

  it('rolls back revision/origin/content CAS/workflow/outbox when actual current management cannot form the round', async () => {
    const f = await supplierEightDFixture(app, 'HIGH', false, 'INTERNAL');
    const { current, person, path } = await prepare(f);
    const before = await f.read();
    const key = randomUUID();
    await f.db.userPosition.update({ where: { id: f.f.manager.assignment.id }, data: { endedAt: new Date() } });
    await f.http(person.cookie, 'post', `${path}/submit`, f.version(current), key).expect(409);
    expect(await f.read()).toEqual(before);
    expect(await f.db.supplierResponseRevision.count({ where: { problemId: f.draft.id } })).toBe(0);
    const [counts] = await f.db.$queryRaw<{ origins: number; rounds: number; events: number }[]>`SELECT
      (SELECT count(*)::int FROM supplier_eight_d_submission_origins WHERE supplier_problem_id = ${f.draft.id}::uuid) AS origins,
      (SELECT count(*)::int FROM workflow_closure_rounds WHERE problem_id = ${current.problemId}::uuid) AS rounds,
      (SELECT count(*)::int FROM outbox_events WHERE event_type = 'SUPPLIER_EIGHT_D_CHANGED' AND payload->>'supplierProblemId' = ${f.draft.id} AND payload->>'action' = 'SUBMIT') AS events`;
    expect(counts).toEqual({ origins: 0, rounds: 0, events: 0 });
    await f.db.userPosition.update({ where: { id: f.f.manager.assignment.id }, data: { endedAt: null } });
    const submitted = (await f.http(person.cookie, 'post', `${path}/submit`, f.version(current), key).expect(201)).body;
    expect(submitted.closure.roundNumber).toBe(1);
  }, 30_000);

  it('requires actual D4/D5, allows only assigned SQE deadlines and never silently extends plans', async () => {
    const f = await supplierEightDFixture(app);
    await release(f);
    let current = await f.read();
    await f.http(f.vendor.cookie, 'post', `${f.portal}/analysis-complete`, { ...f.version(current), submissionDueAt: '2026-11-03T00:00:00Z' }).expect(400);
    await f.http(f.vendor.cookie, 'post', `${f.portal}/submit`, f.version(current)).expect(400);
    await f.http(f.outsider.cookie, 'put', `${f.prefix}/deadlines`, { ...f.version(current), analysisDueAt: '2026-11-01T00:00:00Z' }).expect(403);
    current = (await f.http(f.sqe.cookie, 'put', `${f.prefix}/deadlines`, { ...f.version(current), analysisDueAt: '2026-11-01T00:00:00Z', closureDueAt: '2026-11-05T00:00:00Z' }).expect(200)).body;
    await f.http(f.sqe.cookie, 'put', `${f.prefix}/deadlines`, { ...f.version(current), closureDueAt: '2026-11-06T00:00:00Z' }).expect(409);
    await f.http(f.vendor.cookie, 'put', f.portal, { ...f.version(f.issued), document: supplierEightDDocument() }).expect(409);
    current = (await f.http(f.vendor.cookie, 'put', f.portal, { ...f.version(current), document: supplierEightDDocument() }).expect(200)).body;
    current = (await f.http(f.vendor.cookie, 'post', `${f.portal}/analysis-complete`, { ...f.version(current), submissionDueAt: '2026-11-03T00:00:00Z' }).expect(201)).body;
    await f.http(f.vendor.cookie, 'post', `${f.portal}/analysis-complete`, { ...f.version(current), submissionDueAt: '2026-11-04T00:00:00Z' }).expect(409);
    const changed = supplierEightDDocument(); changed.occurrenceCause = 'Corrected cause';
    current = (await f.http(f.vendor.cookie, 'put', f.portal, { ...f.version(current), document: changed }).expect(200)).body;
    expect(current.analysisCompletedAt).toBeNull();
    expect(current.submissionDueAt).toBe('2026-11-03T00:00:00.000Z');
    await f.http(f.vendor.cookie, 'post', `${f.portal}/submit`, f.version(current)).expect(400);
  }, 30_000);

  it('legacy INTERNAL controlled mode permits only its assigned internal responder, not arbitrary problem writers', async () => {
    const f = await supplierEightDFixture(app, 'LOW', false, 'INTERNAL');
    await f.http(f.sqe.cookie, 'put', f.prefix, { ...f.version(f.issued), document: supplierEightDDocument() }).expect(403);
    const submitted = await submit(f);
    const revision = await f.db.supplierResponseRevision.findUniqueOrThrow({ where: { id: submitted.submittedRevisionId } });
    expect(revision.submittedById).toBe(f.outsider.actor.id);
    await f.http(f.vendor.cookie, 'get', f.portal).expect(404);
  }, 30_000);

  it('post-close SQE/current section manager supplement without mutating approval or closing time or adding a round', async () => {
    const f = await supplierEightDFixture(app);
    const submitted = await submit(f);
    let round = (await f.decide(f.sqe, submitted.closure, ['PROFESSIONAL'])).body;
    await f.decide(f.manager, round, ['SECTION_MANAGER']).then(r => expect(r.status).toBe(200));
    const closed = await f.read();
    const [before] = await f.db.$queryRaw<{ snapshot: unknown }[]>`SELECT approved_snapshot AS snapshot FROM supplier_eight_d_controls WHERE supplier_problem_id = ${f.draft.id}::uuid`;
    const core = app.get(SupplierEightDService);
    const disclosureGrant = { organizationId: f.vendor.org.id, version: closed.contentVersion };
    expect(await f.db.$transaction(tx => core.disclosureFileGrant(tx, f.sqe.actor, f.draft.id, 'read'))).toEqual(disclosureGrant);
    expect(await f.db.$transaction(tx => core.disclosureFileGrant(tx, f.vendor.actor, f.draft.id, 'read'))).toEqual(disclosureGrant);
    for (const action of ['upload', 'complete', 'attach', 'delete'] as const) {
      await expect(f.db.$transaction(tx => core.disclosureFileGrant(tx, f.sqe.actor, f.draft.id, action))).rejects.toMatchObject({ status: 409 });
    }
    await expect(f.db.$transaction(tx => core.disclosureContext(tx, f.sqe.actor, f.draft.id))).rejects.toMatchObject({ status: 409 });
    const replayContext = await f.db.$transaction(tx => core.disclosureContext(tx, f.sqe.actor, f.draft.id, 'REPLAY'));
    expect(replayContext.releasedToSupplierAt?.toISOString()).toBe(closed.releasedToSupplierAt);
    const document = supplierEightDDocument(); document.closureSummary = 'Internal post-close supplemental evidence';
    await f.http(f.vendor.cookie, 'put', f.portal, { ...f.version(closed), document }).expect(403);
    await f.http(f.outsider.cookie, 'put', f.prefix, { ...f.version(closed), document }).expect(403);
    let supplemented = (await f.http(f.sqe.cookie, 'put', f.prefix, { ...f.version(closed), document }).expect(200)).body;
    document.closureSummary = 'Current local manager supplement';
    supplemented = (await f.http(f.manager.cookie, 'put', f.prefix, { ...f.version(supplemented), document }).expect(200)).body;
    expect(supplemented).toMatchObject({ closedAt: closed.closedAt, approvedRevisionId: closed.approvedRevisionId, severity: closed.severity, status: 'CLOSED', instanceVersion: closed.instanceVersion });
    const [after] = await f.db.$queryRaw<{ snapshot: unknown }[]>`SELECT approved_snapshot AS snapshot FROM supplier_eight_d_controls WHERE supplier_problem_id = ${f.draft.id}::uuid`;
    expect(after.snapshot).toEqual(before.snapshot);
    expect((await f.http(f.vendor.cookie, 'get', f.portal).expect(200)).body.document.closureSummary).not.toBe(document.closureSummary);
    expect(await f.db.supplierResponseRevision.count({ where: { problemId: f.draft.id } })).toBe(1);
    const [{ count }] = await f.db.$queryRaw<{ count: number }[]>`SELECT count(*)::int AS count FROM supplier_eight_d_supplements WHERE supplier_problem_id = ${f.draft.id}::uuid`;
    expect(count).toBe(2);
    await f.db.userPosition.update({ where: { id: f.f.manager.assignment.id }, data: { endedAt: new Date() } });
    await f.http(f.manager.cookie, 'put', f.prefix, { ...f.version(supplemented), document: { ...document, closureSummary: 'Stale manager denied' } }).expect(403);
  }, 30_000);

  it('freezes real scanned supplier evidence and isolates every new post-close supplement attachment from the portal', async () => {
    const f = await supplierEightDFixture(app);
    await release(f);
    const core = app.get(SupplierEightDService);
    await expect(f.db.$transaction(tx => core.disclosureFileGrant(tx, f.vendor.actor, f.draft.id, 'upload'))).rejects.toMatchObject({ status: 403 });
    expect(await f.db.$transaction(tx => core.disclosureFileGrant(tx, f.sqe.actor, f.draft.id, 'upload'))).toEqual({ organizationId: f.vendor.org.id, version: (await f.read()).contentVersion });
    const publicFile = await upload(f, f.vendor.cookie, 'supplier-quality');
    const unusedPublicFile = await upload(f, f.vendor.cookie, 'supplier-quality');
    let current = await f.read();
    const document = supplierEightDDocument(); document.okFileIds = [publicFile.id];
    current = (await f.http(f.vendor.cookie, 'put', f.portal, { ...f.version(current), document }).expect(200)).body;
    current = (await f.http(f.vendor.cookie, 'post', `${f.portal}/analysis-complete`, { ...f.version(current), submissionDueAt: '2026-11-03T00:00:00Z' }).expect(201)).body;
    current = (await f.http(f.vendor.cookie, 'post', `${f.portal}/submit`, f.version(current)).expect(201)).body;
    for (const action of ['upload', 'complete', 'attach', 'delete'] as const) {
      await expect(f.db.$transaction(tx => core.disclosureFileGrant(tx, f.sqe.actor, f.draft.id, action))).rejects.toMatchObject({ status: 409 });
    }
    await f.http(f.vendor.cookie, 'post', `files/${publicFile.id}/delete`, { expectedVersion: publicFile.version }).expect(409);
    const round = (await f.decide(f.sqe, current.closure, ['PROFESSIONAL'])).body;
    await f.decide(f.manager, round, ['SECTION_MANAGER']).then(r => expect(r.status).toBe(200));
    const closed = await f.read();
    await f.http(f.sqe.cookie, 'put', f.prefix, { ...f.version(closed), document: { ...document, analysisFileIds: [unusedPublicFile.id] } }).expect(403);
    const privateFile = await upload(f, f.sqe.cookie, 'supplier-eight-d-supplement');
    await f.http(f.vendor.cookie, 'get', `files/${privateFile.id}`).expect(403);
    await f.http(f.vendor.cookie, 'post', `files/${privateFile.id}/download`, {}).expect(403);
    const malicious = { ...document, ngFileIds: [publicFile.id], analysisFileIds: [privateFile.id] };
    const supplement = (await f.http(f.sqe.cookie, 'put', f.prefix, { ...f.version(closed), document: malicious }).expect(200)).body;
    expect(supplement.document.analysisFileIds).toEqual([privateFile.id]);
    const portal = (await f.http(f.vendor.cookie, 'get', f.portal).expect(200)).body;
    expect(portal.document.analysisFileIds).toEqual([]);
    expect(portal.document.okFileIds).toEqual([publicFile.id]);
    expect(JSON.stringify(portal)).not.toContain(privateFile.id);
    const publicReport = await f.db.$transaction(tx => core.readReport(tx, f.vendor.actor, f.draft.id, null));
    expect(publicReport.revision?.id).toBe(closed.approvedRevisionId);
    expect(publicReport.privateSupplementFileIds).toEqual([]);
    expect(JSON.stringify(publicReport.snapshot)).not.toContain(privateFile.id);
    const internalReport = await f.db.$transaction(tx => core.readReport(tx, f.sqe.actor, f.draft.id, null));
    expect(internalReport.revision).toBeNull();
    expect(internalReport.privateSupplementFileIds).toEqual([privateFile.id]);
    const download = (await f.http(f.vendor.cookie, 'post', `files/${publicFile.id}/download`, {}).expect(201)).body;
    const bytes = Buffer.from(await (await fetch(download.url)).arrayBuffer());
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(createHash('sha256').update(png).digest('hex'));
    await f.http(f.sqe.cookie, 'post', 'files/uploads', { resourceType: 'supplier-quality', resourceId: f.draft.id, originalName: 'must-stay-private.png',
      contentType: 'image/png', sizeBytes: png.length, sha256: createHash('sha256').update(png).digest('hex') }).expect(403);
  }, 120_000);
});
