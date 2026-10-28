import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { AppModule } from '../../src/app.module.js';
import { GlobalExceptionFilter } from '../../src/common/contracts/global-exception.filter.js';
import { SupplierEightDService } from '../../src/modules/supplier-quality/supplier-eight-d.service.js';
import { isDisposableLoopbackPostgres } from '../disposable-postgres.js';
import { supplierEightDDocument, supplierEightDFixture } from './supplier-eight-d.fixture.js';

if (process.env.QMS_DISPOSABLE_TEST_DB !== 'true' || !isDisposableLoopbackPostgres(process.env.DATABASE_URL)) throw new Error('Core ports require disposable PostgreSQL.');
type Fixture = Awaited<ReturnType<typeof supplierEightDFixture>>;

describe('supplier 8D server-only report/deadline ports', () => {
  let app: INestApplication, core: SupplierEightDService;
  beforeAll(async () => {
    app = (await Test.createTestingModule({ imports: [AppModule] }).compile()).createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init(); core = app.get(SupplierEightDService);
  }, 120_000);
  afterAll(async () => { await app?.close(); });
  const report = (f: Fixture, who = f.sqe, revision: string | null | undefined = null) => f.db.$transaction(tx => core.readReport(tx, who.actor, f.draft.id, revision), { isolationLevel: 'ReadCommitted' });
  async function submit(f: Fixture) {
    let current = (await f.http(f.outsider.cookie, 'put', f.prefix, { ...f.version(f.issued), document: supplierEightDDocument() }).expect(200)).body;
    current = (await f.http(f.outsider.cookie, 'post', `${f.prefix}/analysis-complete`, { ...f.version(current), submissionDueAt: '2026-11-03T00:00:00Z' }).expect(201)).body;
    return (await f.http(f.outsider.cookie, 'post', `${f.prefix}/submit`, f.version(current)).expect(201)).body;
  }

  it('fixes report metadata at submission/approval and keeps internal current supplements separate from history', async () => {
    const f = await supplierEightDFixture(app, 'LOW', false, 'INTERNAL');
    const current = await report(f);
    expect(current.snapshot).toMatchObject({ rowVersion: f.issued.rowVersion, contentVersion: f.issued.contentVersion, problem: { reportNumber: f.issued.reportNumber }, sources: [], collaboratorUserIds: [] });
    expect(current.versionFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect((await report(f)).versionFingerprint).toBe(current.versionFingerprint);
    const submitted = await submit(f), historical = await report(f, f.sqe, submitted.submittedRevisionId);
    expect(historical.snapshot).toMatchObject({ rowVersion: submitted.rowVersion, contentVersion: submitted.contentVersion,
      instance: { id: submitted.instanceId, version: submitted.instanceVersion }, submittedAt: submitted.submittedAt, problem: { reportNumber: submitted.reportNumber, severity: 'LOW' } });
    const round = (await f.decide(f.sqe, submitted.closure, ['PROFESSIONAL'])).body;
    await f.decide(f.manager, round, ['SECTION_MANAGER']).then(r => expect(r.status).toBe(200));
    const closed = await f.read(), approved = await f.db.$transaction(tx => core.readReport(tx, f.sqe.actor, f.draft.id, undefined));
    expect(approved.revision?.id).toBe(submitted.submittedRevisionId);
    expect(approved.versionFingerprint).not.toBe(historical.versionFingerprint);
    expect(approved.snapshot).toMatchObject({ problem: { closedAt: closed.closedAt }, approval: { status: 'APPROVED' } });
    const document = { ...supplierEightDDocument(), closureSummary: 'Internal supplemental text' };
    await f.http(f.sqe.cookie, 'put', f.prefix, { ...f.version(closed), document }).expect(200);
    expect((await report(f)).snapshot).toMatchObject({ document: { closureSummary: document.closureSummary } });
    expect((await f.db.$transaction(tx => core.readReport(tx, f.sqe.actor, f.draft.id, undefined))).snapshot).toEqual(approved.snapshot);
    expect((await report(f, f.sqe, submitted.submittedRevisionId)).snapshot).toEqual(historical.snapshot);
    await expect(report(f, f.sqe, randomUUID())).rejects.toMatchObject({ status: 404 });
    const permission = await f.db.permission.findUniqueOrThrow({ where: { code: 'supplier-quality:issues:read' } });
    await f.db.rolePermission.delete({ where: { roleId_permissionId: { roleId: f.f.role.id, permissionId: permission.id } } });
    await expect(report(f)).rejects.toMatchObject({ status: 403 });
  }, 30_000);

  it('returns current high-risk management and stable SQE fingerprint, applies a stage with CAS, and rechecks appointments', async () => {
    const f = await supplierEightDFixture(app, 'HIGH', false, 'INTERNAL');
    const current = (await f.http(f.sqe.cookie, 'put', `${f.prefix}/deadlines`, { ...f.version(f.issued), analysisDueAt: '2026-11-01T00:00:00Z', closureDueAt: '2026-11-05T00:00:00Z' }).expect(200)).body;
    const before = await f.db.$transaction(tx => core.deadlineContext(tx, f.outsider.actor, f.draft.id, 'ANALYSIS', 'REQUEST'));
    expect(before).toMatchObject({ rowVersion: current.rowVersion, contentVersion: current.contentVersion, instanceVersion: current.instanceVersion,
      originalDueAt: new Date('2026-11-01T00:00:00Z'), sqeUserId: f.sqe.actor.id, management: { organizationId: f.f.org.id } });
    expect(before.sqeFingerprint).toMatch(/^[a-f0-9]{64}$/);
    await f.db.$transaction(async tx => {
      const context = await core.deadlineContext(tx, f.manager.actor, f.draft.id, 'ANALYSIS', 'DECIDE');
      expect(context.sqeFingerprint).toBe(before.sqeFingerprint);
      await core.applyDeadlineExtension(tx, f.manager.actor, context, new Date('2026-11-04T00:00:00Z'), randomUUID());
    });
    expect(await f.read()).toMatchObject({ analysisDueAt: '2026-11-04T00:00:00.000Z', rowVersion: current.rowVersion + 1, contentVersion: current.contentVersion });
    await expect(f.db.$transaction(tx => core.applyDeadlineExtension(tx, f.manager.actor, before, new Date('2026-11-06T00:00:00Z'), randomUUID()))).rejects.toMatchObject({ status: 409 });
    await f.db.userPosition.update({ where: { id: f.f.owner.assignment.id }, data: { endedAt: new Date() } });
    await expect(f.db.$transaction(tx => core.deadlineContext(tx, f.outsider.actor, f.draft.id, 'ANALYSIS', 'REQUEST'))).rejects.toMatchObject({ status: 403 });
    expect(await f.db.$transaction(tx => core.deadlineNotificationContext(tx, f.f.org.id, f.draft.id, 'ANALYSIS'))).toBeNull();
  }, 30_000);

  it('serializes real concurrent deadline writes and ordinary core writes without late user FK lock upgrades', async () => {
    const f = await supplierEightDFixture(app, 'LOW', false, 'INTERNAL');
    const current = (await f.http(f.sqe.cookie, 'put', `${f.prefix}/deadlines`, { ...f.version(f.issued), closureDueAt: '2026-11-05T00:00:00Z' }).expect(200)).body;
    const attempts = await Promise.allSettled([0, 1].map(() => f.db.$transaction(async tx => {
      const context = await core.deadlineContext(tx, f.sqe.actor, f.draft.id, 'CLOSURE', 'DECIDE');
      if (context.rowVersion !== current.rowVersion) throw Object.assign(new Error('stale request'), { status: 409 });
      await core.applyDeadlineExtension(tx, f.sqe.actor, context, new Date('2026-11-08T00:00:00Z'), randomUUID());
    }, { isolationLevel: 'ReadCommitted', timeout: 10_000 })));
    expect(attempts.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = attempts.find(r => r.status === 'rejected');
    expect(rejected?.status === 'rejected' && rejected.reason.status).toBe(409);
    const after = await f.read();
    const results = await Promise.allSettled([
      f.db.$transaction(async tx => {
        const context = await core.deadlineContext(tx, f.sqe.actor, f.draft.id, 'CLOSURE', 'DECIDE');
        await core.applyDeadlineExtension(tx, f.sqe.actor, context, new Date('2026-11-09T00:00:00Z'), randomUUID());
      }, { isolationLevel: 'ReadCommitted', timeout: 10_000 }),
      core.save(f.outsider.actor, f.draft.id, { ...f.version(after), document: supplierEightDDocument() }, randomUUID(), randomUUID()),
    ]);
    for (const result of results) if (result.status === 'rejected') expect(result.reason.status).toBe(409);
    expect(results.some(r => r.status === 'fulfilled')).toBe(true);
    const now = await f.read();
    expect((await f.db.problemIndex.findUniqueOrThrow({ where: { id: now.problemId } })).dueAt?.toISOString()).toBe(now.closureDueAt);
  }, 30_000);

  it('projects only actual handling identities without sessions and rechecks notification permissions and stale context', async () => {
    const f = await supplierEightDFixture(app, 'LOW', false, 'INTERNAL');
    const context = await f.db.$transaction(tx => core.notificationContext(tx, f.f.org.id, f.draft.id));
    expect(context).toMatchObject({ supplierProblemId: f.draft.id, handling: true, handlingUserIds: [f.outsider.actor.id], reminderEveryHours: null });
    if (!context) throw new Error('Expected actual supplier task context');
    expect(await f.db.$transaction(tx => core.canTaskRecipient(tx, context, f.outsider.actor.id, 'HANDLING'))).toBe(true);
    expect(await f.db.$transaction(tx => core.canTaskRecipient(tx, context, f.sqe.actor.id, 'HANDLING'))).toBe(false);
    expect(await f.db.$transaction(tx => core.canTaskRecipient(tx, context, f.outsider.actor.id, 'NOTIFICATION'))).toBe(false);
    for (const code of ['task:read', 'notification:read']) {
      await f.db.rolePermission.create({ data: { roleId: f.f.role.id, permissionId: (await f.db.permission.findUniqueOrThrow({ where: { code } })).id } });
    }
    expect(await f.db.$transaction(tx => core.canTaskRecipient(tx, context, f.outsider.actor.id, 'NOTIFICATION'))).toBe(true);
    expect(await f.db.$transaction(tx => core.canTaskRecipient(tx, context, f.vendor.actor.id, 'READ'))).toBe(false);
    await f.db.user.update({ where: { id: f.outsider.actor.id }, data: { status: 'DISABLED' } });
    expect(await f.db.$transaction(tx => core.canTaskRecipient(tx, context, f.outsider.actor.id, 'HANDLING'))).toBe(false);
    await f.db.userPosition.update({ where: { id: f.f.owner.assignment.id }, data: { endedAt: new Date() } });
    expect(await f.db.$transaction(tx => core.notificationContext(tx, f.f.org.id, f.draft.id))).toBeNull();
  }, 30_000);
});
