import 'reflect-metadata';
import { jest } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { Test } from '@nestjs/testing';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { AppModule } from '../../src/app.module.js';
import { GlobalExceptionFilter } from '../../src/common/contracts/global-exception.filter.js';
import { OrganizationService } from '../../src/modules/organization/organization.service.js';
import { SupplierEightDService } from '../../src/modules/supplier-quality/supplier-eight-d.service.js';
import { isDisposableLoopbackPostgres } from '../disposable-postgres.js';
import { supplierEightDDocument, supplierEightDFixture } from './supplier-eight-d.fixture.js';

if (process.env.QMS_DISPOSABLE_TEST_DB !== 'true' || !isDisposableLoopbackPostgres(process.env.DATABASE_URL)) throw new Error('Core repair requires disposable loopback PostgreSQL, never preview 55440.');
type Fixture = Awaited<ReturnType<typeof supplierEightDFixture>>;

describe('supplier core SPEC repair, actual HTTP / organization mutations / PostgreSQL barriers', () => {
  let app: INestApplication, core: SupplierEightDService, organization: OrganizationService;
  beforeAll(async () => {
    app = (await Test.createTestingModule({ imports: [AppModule] }).compile()).createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init(); core = app.get(SupplierEightDService); organization = app.get(OrganizationService);
  }, 120_000);
  afterAll(async () => { await app?.close(); });
  afterEach(() => jest.restoreAllMocks());

  async function admin(f: Fixture) {
    for (const code of ['organization:structure:manage', 'organization:positions:assign', 'account:roles:read', 'account:roles:assign']) {
      await f.db.rolePermission.create({ data: { roleId: f.f.role.id, permissionId: (await f.db.permission.findUniqueOrThrow({ where: { code } })).id } });
    }
  }
  async function prepare(f: Fixture) {
    let row = (await f.http(f.outsider.cookie, 'put', f.prefix, { ...f.version(f.issued), document: supplierEightDDocument() }).expect(200)).body;
    row = (await f.http(f.outsider.cookie, 'post', `${f.prefix}/analysis-complete`, { ...f.version(row), submissionDueAt: '2026-11-03T00:00:00Z' }).expect(201)).body;
    return row;
  }
  async function managerPending(f: Fixture) {
    const row = await prepare(f);
    const submitted = (await f.http(f.outsider.cookie, 'post', `${f.prefix}/submit`, f.version(row)).expect(201)).body;
    return (await f.decide(f.sqe, submitted.closure, ['PROFESSIONAL']).then(r => { expect(r.status).toBe(200); return r.body; }));
  }
  async function draft(f: Fixture) {
    return (await f.http(f.sqe.cookie, 'post', 'supplier-quality/drafts', { profileId: f.profile.id, title: 'Deadline authority regression', materialCode: 'N5-SPEC',
      defectDescription: 'Actual observed defect', defectQuantity: 1, severity: 'LOW', responseForm: 'EIGHT_D', replyMode: 'INTERNAL', internalResponderId: f.outsider.actor.id }).expect(201)).body;
  }
  async function noIssue(f: Fixture, id: string) {
    expect((await f.db.supplierQualityProblem.findUniqueOrThrow({ where: { id } })).problemIndexId).toBeNull();
    expect(await f.db.$queryRaw`SELECT supplier_problem_id FROM supplier_eight_d_controls WHERE supplier_problem_id = ${id}::uuid`).toEqual([]);
    expect(await f.db.$queryRaw`SELECT supplier_problem_id FROM supplier_eight_d_receipts WHERE supplier_problem_id = ${id}::uuid`).toEqual([]);
  }

  it('freezes the exact SQE appointment through final approval against a real replacement retaining another valid appointment', async () => {
    const f = await supplierEightDFixture(app, 'LOW', false, 'INTERNAL');
    const round = await managerPending(f);
    await admin(f);
    const alternate = await f.db.position.create({ data: { organizationId: f.f.org.id, departmentId: f.f.dept.id, code: randomUUID(), name: 'Other valid position' } });
    await f.db.userPosition.create({ data: { organizationId: f.f.org.id, userId: f.sqe.actor.id, positionId: alternate.id } });
    const entered = Promise.withResolvers<void>(), resume = Promise.withResolvers<void>();
    const original = core.closureContext.bind(core);
    jest.spyOn(core, 'closureContext').mockImplementation(async (...args) => {
      const context = await original(...args);
      if (args[2] === f.issued.problemId && args[3] === 'DECIDE') { entered.resolve(); await resume.promise; }
      return context;
    });
    const decision = f.decide(f.manager, round, ['SECTION_MANAGER']).then(r => r);
    await entered.promise;
    let mutationDone = false;
    const mutation = organization.replaceUserPositions(f.outsider.actor, f.f.org.id, f.sqe.actor.id,
      { expectedPositionIds: [f.f.owner.position.id, alternate.id], positionIds: [alternate.id] }, randomUUID(), randomUUID())
      .then(value => ({ value, error: null }), error => ({ value: null, error })).finally(() => { mutationDone = true; });
    let blocked = false;
    try {
      const until = Date.now() + 5000;
      while (!mutationDone && !blocked && Date.now() < until) {
        const [{ waiting }] = await f.db.$queryRaw<{ waiting: boolean }[]>`SELECT EXISTS (SELECT 1 FROM pg_stat_activity
          WHERE datname = current_database() AND wait_event_type = 'Lock'
            AND query ~ '^SELECT id FROM (users|positions|user_positions)') AS waiting`;
        blocked = waiting;
        if (!blocked && !mutationDone) await delay(10);
      }
      expect(mutationDone || blocked).toBe(true);
    } finally { resume.resolve(); }
    const result = await decision, changed = await mutation;
    console.info('SQE appointment barrier', { organizationWriterBlocked: blocked, finalApprovalStatus: result.status, mutationSucceeded: changed.error === null });
    // A deadlock/serialization rejection is not evidence of a correct freeze.
    expect(changed.error).toBeNull();
    expect(changed.value?.map(a => a.positionId)).toEqual([alternate.id]);
    expect((await f.db.userPosition.findUniqueOrThrow({ where: { id: f.f.owner.assignment.id } })).endedAt).not.toBeNull();
    if (blocked) {
      expect(result.status).toBe(200);
      expect((await f.read()).closedAt).not.toBeNull();
    } else {
      expect(result.status).toBe(403);
      expect((await f.read()).closedAt).toBeNull();
    }
  }, 30_000);

  it('does not wait on SQE structure behind its user lock when a real organization writer already owns the position', async () => {
    const f = await supplierEightDFixture(app, 'LOW', false, 'INTERNAL');
    const round = await managerPending(f);
    await admin(f);
    await f.db.positionRole.create({ data: { organizationId: f.f.org.id, positionId: f.f.owner.position.id, roleId: f.f.role.id } });
    const entered = Promise.withResolvers<void>(), resume = Promise.withResolvers<void>();
    const observed = organization as unknown as { lockPositions: (tx: unknown, org: string, ids: string[]) => Promise<void> };
    const original = observed.lockPositions.bind(organization);
    jest.spyOn(observed, 'lockPositions').mockImplementation(async (...args) => {
      await original(...args);
      if (args[2].includes(f.f.owner.position.id)) { entered.resolve(); await resume.promise; }
    });
    const mutation = organization.updatePosition(f.outsider.actor, f.f.org.id, f.f.owner.position.id,
      { expectedVersion: f.f.owner.position.version, departmentId: f.f.dept.id }, randomUUID(), randomUUID())
      .then(value => ({ value, error: null }), error => ({ value: null, error }));
    await entered.promise;
    try {
      const decision = await f.decide(f.manager, round, ['SECTION_MANAGER']);
      expect(decision.status).toBe(409);
      expect(decision.body.code).toBe('CONCURRENCY_CONFLICT');
    } finally { resume.resolve(); }
    const changed = await mutation;
    expect(changed.error).toBeNull();
    expect(changed.value?.departmentId).toBe(f.f.dept.id);
    expect((await f.read()).closedAt).toBeNull();
  }, 30_000);

  it('rejects submission after the SQE position moves section and rolls back revision, origin, round, receipt and workflow state', async () => {
    const f = await supplierEightDFixture(app, 'LOW', false, 'INTERNAL');
    const before = await prepare(f);
    await admin(f);
    await organization.updatePosition(f.outsider.actor, f.f.org.id, f.f.owner.position.id,
      { expectedVersion: f.f.owner.position.version, departmentId: f.f.dept.id }, randomUUID(), randomUUID());
    const key = randomUUID();
    const response = await f.http(f.outsider.cookie, 'post', `${f.prefix}/submit`, f.version(before), key);
    expect(response.status).toBe(403);
    expect(await f.read()).toMatchObject({ rowVersion: before.rowVersion, contentVersion: before.contentVersion, instanceVersion: before.instanceVersion, submittedRevisionId: null, closure: null });
    expect(await f.db.supplierResponseRevision.count({ where: { problemId: f.draft.id } })).toBe(0);
    expect(await f.db.$queryRaw`SELECT revision_id FROM supplier_eight_d_submission_origins WHERE supplier_problem_id = ${f.draft.id}::uuid`).toEqual([]);
    expect(await f.db.$queryRaw`SELECT id FROM workflow_closure_rounds WHERE problem_id = ${f.issued.problemId}::uuid`).toEqual([]);
    expect(await f.db.$queryRaw`SELECT key FROM supplier_eight_d_receipts WHERE key = ${key}`).toEqual([]);
  }, 30_000);

  it.each(['analysisDueAt', 'closureDueAt'] as const)('does not let an issuer set %s on behalf of the selected SQE, but preserves issue without dates', async field => {
    const f = await supplierEightDFixture(app, 'LOW', false, 'INTERNAL'), d = await draft(f);
    const input = { expectedVersion: d.version, sqeAssignmentId: f.f.owner.assignment.id };
    await f.http(f.outsider.cookie, 'post', `supplier-quality/eight-d/drafts/${d.id}/issue`, { ...input, [field]: '2026-11-05T00:00:00Z' }).expect(403);
    await noIssue(f, d.id);
    const issued = (await f.http(f.outsider.cookie, 'post', `supplier-quality/eight-d/drafts/${d.id}/issue`, input).expect(201)).body;
    expect(issued).toMatchObject({ sqeUserId: f.sqe.actor.id, analysisDueAt: null, closureDueAt: null });
  }, 30_000);

  it('requires deadlines permission even for the selected SQE and rechecks it on issue replay', async () => {
    const f = await supplierEightDFixture(app, 'LOW', false, 'INTERNAL'), d = await draft(f);
    const permission = await f.db.permission.findUniqueOrThrow({ where: { code: 'supplier-quality:issues:deadlines' } });
    const input = { expectedVersion: d.version, sqeAssignmentId: f.f.owner.assignment.id, analysisDueAt: '2026-11-01T00:00:00Z', closureDueAt: '2026-11-05T00:00:00Z' };
    const path = `supplier-quality/eight-d/drafts/${d.id}/issue`, key = randomUUID();
    await f.db.rolePermission.delete({ where: { roleId_permissionId: { roleId: f.f.role.id, permissionId: permission.id } } });
    await f.http(f.sqe.cookie, 'post', path, input, key).expect(403);
    await noIssue(f, d.id);
    await f.db.rolePermission.create({ data: { roleId: f.f.role.id, permissionId: permission.id } });
    const issued = (await f.http(f.sqe.cookie, 'post', path, input, key).expect(201)).body;
    expect(issued).toMatchObject({ analysisDueAt: '2026-11-01T00:00:00.000Z', closureDueAt: '2026-11-05T00:00:00.000Z' });
    expect((await f.http(f.sqe.cookie, 'post', path, input, key).expect(201)).body).toEqual(issued);
    await f.db.rolePermission.delete({ where: { roleId_permissionId: { roleId: f.f.role.id, permissionId: permission.id } } });
    await f.http(f.sqe.cookie, 'post', path, input, key).expect(403);
  }, 30_000);

  it('projects actual latest immutable supplement time only for internal CURRENT, never onto approved or historical snapshots', async () => {
    const f = await supplierEightDFixture(app, 'LOW', false, 'INTERNAL');
    const report = (revision: string | null | undefined) => f.db.$transaction(tx => core.readReport(tx, f.sqe.actor, f.draft.id, revision));
    const round = await managerPending(f);
    await f.decide(f.manager, round, ['SECTION_MANAGER']).then(r => expect(r.status).toBe(200));
    const closed = await f.read(), approved = await report(undefined), history = await report(closed.approvedRevisionId);
    expect((await report(null)).snapshot).toMatchObject({ problem: { supplementUpdatedAt: null } });
    for (const text of ['First internal supplement', 'Latest internal supplement']) {
      const current = await f.read();
      await f.http(f.sqe.cookie, 'put', f.prefix, { ...f.version(current), document: { ...supplierEightDDocument(), closureSummary: text } }).expect(200);
    }
    const [latest] = await f.db.$queryRaw<{ createdAt: Date }[]>`SELECT recorded_at AS "createdAt" FROM supplier_eight_d_supplements
      WHERE organization_id = ${f.f.org.id}::uuid AND supplier_problem_id = ${f.draft.id}::uuid ORDER BY content_version DESC LIMIT 1`;
    expect((await report(null)).snapshot).toMatchObject({ problem: { supplementUpdatedAt: latest!.createdAt.toISOString(), closedAt: closed.closedAt } });
    expect((await report(undefined)).snapshot).toEqual(approved.snapshot);
    expect((await report(closed.approvedRevisionId)).snapshot).toEqual(history.snapshot);
  }, 30_000);

  it('projects internal report and unissued disclosure actions from actual permissions and the assigned SQE', async () => {
    const f = await supplierEightDFixture(app);
    expect(f.issued.allowedActions).toEqual(expect.arrayContaining(['deadline-extensions', 'disclosure-preview', 'release']));
    expect(f.issued.allowedActions).not.toContain('report');
    expect(f.issued.allowedActions).not.toContain('request-extension');
    const outsider = (await f.http(f.outsider.cookie, 'get', f.prefix).expect(200)).body;
    expect(outsider.allowedActions).not.toContain('disclosure-preview');
    expect(outsider.allowedActions).not.toContain('release');
    const reportPermission = await f.db.permission.findUniqueOrThrow({ where: { code: 'supplier-quality:issues:report' } });
    await f.db.rolePermission.create({ data: { roleId: f.f.role.id, permissionId: reportPermission.id } });
    expect((await f.read()).allowedActions).toContain('report');
    const preview = (await f.http(f.sqe.cookie, 'post', `${f.prefix}/disclosure-preview`, { expectedRowVersion: f.issued.rowVersion, selectedFileIds: [] }).expect(200)).body;
    await f.http(f.sqe.cookie, 'post', `${f.prefix}/release`, { expectedRowVersion: preview.rowVersion, previewToken: preview.previewToken, confirmed: true, selectedFileIds: [] }).expect(200);
    const released = await f.read();
    expect(released.allowedActions).not.toContain('disclosure-preview');
    expect(released.allowedActions).not.toContain('release');
    await f.db.rolePermission.delete({ where: { roleId_permissionId: { roleId: f.f.role.id, permissionId: reportPermission.id } } });
    expect((await f.read()).allowedActions).not.toContain('report');
  }, 30_000);

  it('projects extension history for readers but request only to the actual responder with an open dated stage', async () => {
    const f = await supplierEightDFixture(app, 'LOW', false, 'INTERNAL');
    const readResponder = async () => (await f.http(f.outsider.cookie, 'get', f.prefix).expect(200)).body;
    expect((await readResponder()).allowedActions).toContain('deadline-extensions');
    expect((await readResponder()).allowedActions).not.toContain('request-extension');
    await f.http(f.sqe.cookie, 'put', `${f.prefix}/deadlines`, { ...f.version(f.issued), analysisDueAt: '2026-11-01T00:00:00Z' }).expect(200);
    expect((await readResponder()).allowedActions).toContain('request-extension');
    expect((await f.read()).allowedActions).not.toContain('request-extension');
    const row = await f.read();
    let current = (await f.http(f.outsider.cookie, 'put', f.prefix, { ...f.version(row), document: supplierEightDDocument() }).expect(200)).body;
    current = (await f.http(f.outsider.cookie, 'post', `${f.prefix}/analysis-complete`, { ...f.version(current), submissionDueAt: '2026-11-03T00:00:00Z' }).expect(201)).body;
    const submitted = (await f.http(f.outsider.cookie, 'post', `${f.prefix}/submit`, f.version(current)).expect(201)).body;
    expect(submitted.allowedActions).not.toContain('request-extension');
    const round = (await f.decide(f.sqe, submitted.closure, ['PROFESSIONAL'])).body;
    await f.decide(f.manager, round, ['SECTION_MANAGER']).then(r => expect(r.status).toBe(200));
    const closed = await readResponder();
    expect(closed.allowedActions).toContain('deadline-extensions');
    expect(closed.allowedActions).not.toContain('request-extension');
  }, 30_000);

  it('projects portal report/history/request with the real supplier identity and clears request after write revocation', async () => {
    const f = await supplierEightDFixture(app);
    const dated = (await f.http(f.sqe.cookie, 'put', `${f.prefix}/deadlines`, { ...f.version(f.issued), closureDueAt: '2026-11-05T00:00:00Z' }).expect(200)).body;
    const preview = (await f.http(f.sqe.cookie, 'post', `${f.prefix}/disclosure-preview`, { expectedRowVersion: dated.rowVersion, selectedFileIds: [] }).expect(200)).body;
    await f.http(f.sqe.cookie, 'post', `${f.prefix}/release`, { expectedRowVersion: preview.rowVersion, previewToken: preview.previewToken, confirmed: true, selectedFileIds: [] }).expect(200);
    const read = async () => (await f.http(f.vendor.cookie, 'get', f.portal).expect(200)).body;
    expect((await read()).allowedActions).toEqual(expect.arrayContaining(['report', 'deadline-extensions', 'request-extension']));
    expect((await read()).allowedActions).not.toContain('release');
    await f.http(f.otherVendor.cookie, 'get', f.portal).expect(404);
    const write = await f.db.permission.findUniqueOrThrow({ where: { code: 'supplier-quality:responses:write' } });
    await f.db.rolePermission.delete({ where: { roleId_permissionId: { roleId: f.vendor.role.id, permissionId: write.id } } });
    const readonly = await read();
    expect(readonly.allowedActions).toEqual(expect.arrayContaining(['report', 'deadline-extensions']));
    expect(readonly.allowedActions).not.toContain('request-extension');
  }, 30_000);
});
