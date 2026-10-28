import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { AppModule } from '../../src/app.module.js';
import { GlobalExceptionFilter } from '../../src/common/contracts/global-exception.filter.js';
import { isDisposableLoopbackPostgres } from '../disposable-postgres.js';
import { supplierEightDDocument, supplierEightDFixture } from './supplier-eight-d.fixture.js';
import { SupplierEightDDeadlineService } from '../../src/modules/supplier-quality/supplier-eight-d-deadline.service.js';
import { SessionService } from '../../src/modules/identity/session.service.js';

if (process.env.QMS_DISPOSABLE_TEST_DB !== 'true' || !isDisposableLoopbackPostgres(process.env.DATABASE_URL)
  || !new URL(process.env.DATABASE_URL!).pathname.includes('deadline')) throw new Error('Dedicated supplier deadline disposable PostgreSQL lease required; never preview 55440 or another agent database.');
type Fixture = Awaited<ReturnType<typeof supplierEightDFixture>>;
const oldDue = '2026-10-01T00:00:00.000Z', newDue = '2026-12-01T00:00:00.000Z';

describe('supplier dedicated deadline persistence / real HTTP / PostgreSQL', () => {
  let app: INestApplication;
  beforeAll(async () => {
    app = (await Test.createTestingModule({ imports: [AppModule] }).compile()).createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init();
  }, 120_000);
  afterAll(async () => { await app?.close(); });

  async function setup(severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' = 'LOW') {
    const f = await supplierEightDFixture(app, severity);
    let current = await f.read();
    await f.http(f.sqe.cookie, 'put', `${f.prefix}/deadlines`, { ...f.version(current), analysisDueAt: oldDue, closureDueAt: oldDue }).expect(200);
    current = await f.read();
    const preview = (await f.http(f.sqe.cookie, 'post', `${f.prefix}/disclosure-preview`, { expectedRowVersion: current.rowVersion, selectedFileIds: [] }).expect(200)).body;
    await f.http(f.sqe.cookie, 'post', `${f.prefix}/release`, { expectedRowVersion: preview.rowVersion, previewToken: preview.previewToken, confirmed: true, selectedFileIds: [] }).expect(200);
    return f;
  }
  async function input(f: Fixture, stage: 'ANALYSIS' | 'SUBMISSION' | 'CLOSURE' = 'ANALYSIS') {
    const current = await f.read();
    return { ...f.version(current), expectedContentVersion: current.contentVersion, stage, requestedDueAt: newDue, reason: 'Actual supplier verification requires time' };
  }
  async function apply(f: Fixture, stage: 'ANALYSIS' | 'SUBMISSION' | 'CLOSURE' = 'ANALYSIS', key = randomUUID()) {
    const body = await input(f, stage);
    const row = (await f.http(f.vendor.cookie, 'post', `${f.portal}/deadline-extensions`, body, key).expect(201)).body;
    return { row, body, key };
  }
  const decide = (f: Fixture, cookie: string, row: { id: string; version: number }, duty: 'SQE' | 'MANAGER', decision = 'APPROVE', key = randomUUID()) =>
    f.http(cookie, 'post', `${f.prefix}/deadline-extensions/${row.id}/decide`, { expectedVersion: row.version, duty, decision, comment: 'Current evidence reviewed' }, key);

  it.each(['LOW', 'MEDIUM'] as const)('%s needs only SQE, preserves original overdue, and applies exactly once', async severity => {
    const f = await setup(severity), before = await f.read();
    const { row, body, key } = await apply(f);
    expect(row).toMatchObject({ stage: 'ANALYSIS', status: 'QUALITY_PENDING', originalDueAt: oldDue, requestedDueAt: newDue, originallyOverdue: true, version: 1 });
    expect((await f.read()).analysisDueAt).toBe(oldDue);
    expect((await f.http(f.vendor.cookie, 'post', `${f.portal}/deadline-extensions`, body, key).expect(201)).body).toEqual(row);
    const approved = (await decide(f, f.sqe.cookie, row, 'SQE').expect(200)).body;
    expect(approved).toMatchObject({ status: 'APPROVED', version: 2, originalDueAt: oldDue, originallyOverdue: true });
    expect(await f.read()).toMatchObject({ analysisDueAt: newDue, closureDueAt: oldDue, rowVersion: before.rowVersion + 1, instanceVersion: before.instanceVersion });
    const [record] = await f.db.$queryRaw<{ applicant: string; organization: string; count: number }[]>`SELECT r.applicant_user_id AS applicant,
      r.applicant_organization_id AS organization, (SELECT count(*)::integer FROM supplier_eight_d_deadline_decisions d WHERE d.request_id = r.id) AS count
      FROM supplier_eight_d_deadline_requests r WHERE r.id = ${row.id}::uuid`;
    expect(record).toEqual({ applicant: f.vendor.actor.id, organization: f.vendor.org.id, count: 1 });
    await decide(f, f.sqe.cookie, row, 'SQE').expect(409);
    await f.http(f.vendor.cookie, 'post', `${f.portal}/deadline-extensions`, body, key).expect(409);
  }, 30_000);

  it.each(['HIGH', 'CRITICAL'] as const)('%s is SQE then manager serially, never minister-first', async severity => {
    const f = await setup(severity), { row } = await apply(f, 'CLOSURE');
    await decide(f, f.manager.cookie, row, 'MANAGER').expect(403);
    await decide(f, f.minister.cookie, row, 'MANAGER').expect(403);
    const intermediate = (await decide(f, f.sqe.cookie, row, 'SQE').expect(200)).body;
    expect(intermediate).toMatchObject({ status: 'MANAGER_PENDING', version: 2 });
    expect((await f.read()).closureDueAt).toBe(oldDue);
    await decide(f, f.minister.cookie, intermediate, 'MANAGER').expect(403);
    expect((await decide(f, f.manager.cookie, intermediate, 'MANAGER').expect(200)).body.status).toBe('APPROVED');
    const current = await f.read();
    expect(current.closureDueAt).toBe(newDue);
    expect((await f.db.problemIndex.findUniqueOrThrow({ where: { id: current.problemId } })).dueAt?.toISOString()).toBe(newDue);
    expect((await f.db.$queryRaw<{ duty: string }[]>`SELECT duty FROM supplier_eight_d_deadline_decisions WHERE request_id = ${row.id}::uuid ORDER BY request_version`).map(r => r.duty)).toEqual(['SQE', 'MANAGER']);
  }, 30_000);

  it('keeps two serial duty decisions when the actual SQE and manager are the same user', async () => {
    const f = await setup('HIGH');
    await f.db.userPosition.update({ where: { id: f.f.manager.assignment.id }, data: { userId: f.sqe.actor.id } });
    const { row } = await apply(f);
    const intermediate = (await decide(f, f.sqe.cookie, row, 'SQE').expect(200)).body;
    expect(intermediate.status).toBe('MANAGER_PENDING');
    expect((await f.read()).analysisDueAt).toBe(oldDue);
    expect((await decide(f, f.sqe.cookie, intermediate, 'MANAGER').expect(200)).body.status).toBe('APPROVED');
    const records = await f.db.$queryRaw<{ actor: string; duty: string }[]>`SELECT actor_user_id AS actor, duty FROM supplier_eight_d_deadline_decisions WHERE request_id = ${row.id}::uuid ORDER BY request_version`;
    expect(records).toEqual([{ actor: f.sqe.actor.id, duty: 'SQE' }, { actor: f.sqe.actor.id, duty: 'MANAGER' }]);
  }, 30_000);

  it.each(['SQE', 'MANAGER'] as const)('retains %s return without changing deadline and rejects terminal replay', async duty => {
    const f = await setup('HIGH');
    let { row } = await apply(f);
    if (duty === 'MANAGER') row = (await decide(f, f.sqe.cookie, row, 'SQE').expect(200)).body;
    const cookie = duty === 'SQE' ? f.sqe.cookie : f.manager.cookie, key = randomUUID();
    const returned = (await decide(f, cookie, row, duty, 'RETURN', key).expect(200)).body;
    expect(returned.status).toBe('RETURNED');
    expect((await f.read()).analysisDueAt).toBe(oldDue);
    await decide(f, cookie, row, duty, 'RETURN', key).expect(409);
    expect((await apply(f)).row.id).not.toBe(row.id);
  }, 30_000);

  it('permits only the real applicant to cancel and keeps immutable history', async () => {
    const f = await setup(), { row } = await apply(f), body = { expectedVersion: row.version, comment: 'Verification completed early' }, key = randomUUID();
    await f.http(f.otherVendor.cookie, 'post', `${f.portal}/deadline-extensions/${row.id}/cancel`, body).expect(404);
    await f.http(f.sqe.cookie, 'post', `${f.prefix}/deadline-extensions/${row.id}/cancel`, body).expect(403);
    expect((await f.http(f.vendor.cookie, 'post', `${f.portal}/deadline-extensions/${row.id}/cancel`, body, key).expect(200)).body.status).toBe('CANCELLED');
    await f.http(f.vendor.cookie, 'post', `${f.portal}/deadline-extensions/${row.id}/cancel`, body, key).expect(409);
    expect((await f.read()).analysisDueAt).toBe(oldDue);
    await expect(f.db.$executeRaw`DELETE FROM supplier_eight_d_deadline_decisions WHERE request_id = ${row.id}::uuid`).rejects.toThrow();
  }, 30_000);

  it.each(['row', 'content', 'instance', 'sqe', 'manager', 'severity', 'original-date', 'archived'] as const)('rejects stale %s context before approval without partial audit or apply', async changed => {
    const f = await setup('HIGH'), { row } = await apply(f), before = await f.read();
    if (changed === 'row') await f.db.$executeRaw`UPDATE supplier_eight_d_controls SET row_version = row_version + 1 WHERE supplier_problem_id = ${f.draft.id}::uuid`;
    if (changed === 'content') await f.db.supplierQualityProblem.update({ where: { id: f.draft.id }, data: { version: { increment: 1 } } });
    if (changed === 'instance') await f.db.workflowInstance.update({ where: { id: before.instanceId }, data: { version: { increment: 1 } } });
    if (changed === 'sqe') await f.db.userPosition.update({ where: { id: f.f.owner.assignment.id }, data: { endedAt: new Date() } });
    if (changed === 'manager') await f.db.$executeRaw`UPDATE department_management_bindings SET version = version + 1 WHERE id = ${f.f.managerBinding}::uuid`;
    if (changed === 'severity') await f.db.$transaction([
      f.db.supplierQualityProblem.update({ where: { id: f.draft.id }, data: { severity: 'CRITICAL' } }),
      f.db.problemIndex.update({ where: { id: before.problemId }, data: { severity: 'CRITICAL' } }),
    ]);
    if (changed === 'original-date') await f.db.$executeRaw`UPDATE supplier_eight_d_controls SET analysis_due_at = ${new Date('2026-10-02T00:00:00Z')} WHERE supplier_problem_id = ${f.draft.id}::uuid`;
    if (changed === 'archived') await f.db.problemIndex.update({ where: { id: before.problemId }, data: { status: 'ARCHIVED', archivedAt: new Date() } });
    const response = await decide(f, f.sqe.cookie, row, 'SQE');
    expect([403, 409]).toContain(response.status);
    expect((await f.read()).analysisDueAt).toBe(changed === 'original-date' ? '2026-10-02T00:00:00.000Z' : oldDue);
    expect(await f.db.$queryRaw`SELECT id FROM supplier_eight_d_deadline_decisions WHERE request_id = ${row.id}::uuid`).toEqual([]);
  }, 30_000);

  it('does not pause analysis or accept an old request after the analysis stage ends', async () => {
    const f = await setup(), { row, body, key } = await apply(f);
    let current = await f.read();
    current = (await f.http(f.vendor.cookie, 'put', f.portal, { ...f.version(current), document: supplierEightDDocument() }).expect(200)).body;
    await f.http(f.vendor.cookie, 'post', `${f.portal}/analysis-complete`, { ...f.version(current), submissionDueAt: '2026-11-15T00:00:00Z' }).expect(201);
    await decide(f, f.sqe.cookie, row, 'SQE').expect(409);
    await f.http(f.vendor.cookie, 'post', `${f.portal}/deadline-extensions`, body, key).expect(409);
    expect((await f.read()).analysisDueAt).toBe(oldDue);
  }, 30_000);

  it('rejects cross-enterprise access, requester masquerading, and revoked replay', async () => {
    const f = await setup(), body = await input(f), key = randomUUID();
    await f.http(f.otherVendor.cookie, 'post', `${f.portal}/deadline-extensions`, body).expect(404);
    await f.http(f.sqe.cookie, 'post', `${f.prefix}/deadline-extensions`, body).expect(403);
    const { row } = await apply(f, 'ANALYSIS', key);
    await decide(f, f.vendor.cookie, row, 'SQE').then(r => expect([403, 404]).toContain(r.status));
    await f.db.userRole.deleteMany({ where: { userId: f.vendor.actor.id, organizationId: f.vendor.org.id } });
    await f.http(f.vendor.cookie, 'post', `${f.portal}/deadline-extensions`, body, key).then(r => expect([401, 403]).toContain(r.status));
    expect((await f.read()).analysisDueAt).toBe(oldDue);
  }, 30_000);

  it('serializes concurrent requests and approvals with a single final date and audit', async () => {
    const f = await setup(), body = await input(f);
    const attempts = await Promise.all([0, 1].map(() => f.http(f.vendor.cookie, 'post', `${f.portal}/deadline-extensions`, body)));
    expect(attempts.map(r => r.status).sort()).toEqual([201, 409]);
    const row = attempts.find(r => r.status === 201)!.body;
    const decisions = await Promise.all([0, 1].map(() => decide(f, f.sqe.cookie, row, 'SQE')));
    expect(decisions.map(r => r.status).sort()).toEqual([200, 409]);
    expect((await f.read()).analysisDueAt).toBe(newDue);
    expect((await f.db.$queryRaw<{ count: number }[]>`SELECT count(*)::integer AS count FROM supplier_eight_d_deadline_decisions WHERE request_id = ${row.id}::uuid`)[0]!.count).toBe(1);
    expect(await f.db.auditEvent.count({ where: { action: 'SUPPLIER_EIGHT_D_DEADLINE_APPROVED', resourceId: row.id } })).toBe(1);
  }, 30_000);

  it('validates absolute dates, existing plans, precise versions, and idempotency bodies', async () => {
    const f = await setup(), body = await input(f), key = randomUUID();
    for (const requestedDueAt of [oldDue, '2026-09-01T00:00:00Z', '2026-11-02']) {
      await f.http(f.vendor.cookie, 'post', `${f.portal}/deadline-extensions`, { ...body, requestedDueAt }).expect(400);
    }
    for (const field of ['expectedRowVersion', 'expectedContentVersion', 'expectedInstanceVersion']) {
      await f.http(f.vendor.cookie, 'post', `${f.portal}/deadline-extensions`, { ...body, [field]: (body[field as keyof typeof body] as number) + 1 }).expect(409);
    }
    await f.http(f.vendor.cookie, 'post', `${f.portal}/deadline-extensions`, { ...body, managerUserId: f.manager.actor.id }).expect(400);
    await f.http(f.vendor.cookie, 'post', `${f.portal}/deadline-extensions`, { ...body, stage: 'SUBMISSION' }).expect(409);
    await f.http(f.vendor.cookie, 'post', `${f.portal}/deadline-extensions`, body, key).expect(201);
    await f.http(f.vendor.cookie, 'post', `${f.portal}/deadline-extensions`, { ...body, reason: 'Changed original request body' }, key).expect(409);
  }, 30_000);

  it('extends the supplier-chosen submission plan without changing analysis or closure', async () => {
    const f = await setup();
    let current = await f.read();
    current = (await f.http(f.vendor.cookie, 'put', f.portal, { ...f.version(current), document: supplierEightDDocument() }).expect(200)).body;
    await f.http(f.vendor.cookie, 'post', `${f.portal}/analysis-complete`, { ...f.version(current), submissionDueAt: oldDue }).expect(201);
    const { row } = await apply(f, 'SUBMISSION');
    await decide(f, f.sqe.cookie, row, 'SQE').expect(200);
    expect(await f.read()).toMatchObject({ analysisDueAt: oldDue, submissionDueAt: newDue, closureDueAt: oldDue });
    const history = (await f.http(f.vendor.cookie, 'get', `${f.portal}/deadline-extensions`).expect(200)).body;
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ id: row.id, status: 'APPROVED', originalDueAt: oldDue });
    expect(history[0]).not.toHaveProperty('managerFingerprint');
    await f.http(f.otherVendor.cookie, 'get', `${f.portal}/deadline-extensions`).expect(404);
  }, 30_000);

  it('rejects old requests after submission and closure; history remains read-only', async () => {
    const f = await setup();
    let current = await f.read();
    current = (await f.http(f.vendor.cookie, 'put', f.portal, { ...f.version(current), document: supplierEightDDocument() }).expect(200)).body;
    current = (await f.http(f.vendor.cookie, 'post', `${f.portal}/analysis-complete`, { ...f.version(current), submissionDueAt: oldDue }).expect(201)).body;
    const { row, body, key } = await apply(f, 'SUBMISSION');
    current = (await f.http(f.vendor.cookie, 'post', `${f.portal}/submit`, f.version(current)).expect(201)).body;
    await decide(f, f.sqe.cookie, row, 'SQE').expect(409);
    const professional = await f.decide(f.sqe, current.closure, ['PROFESSIONAL']);
    expect(professional.status).toBe(200);
    expect((await f.decide(f.manager, professional.body, ['SECTION_MANAGER'])).status).toBe(200);
    const closed = await f.read();
    await decide(f, f.sqe.cookie, row, 'SQE').expect(409);
    await f.http(f.vendor.cookie, 'post', `${f.portal}/deadline-extensions`, body, key).expect(409);
    expect(await f.read()).toMatchObject({ closedAt: closed.closedAt, submissionDueAt: oldDue, closureDueAt: oldDue });
    expect((await f.http(f.sqe.cookie, 'get', `${f.prefix}/deadline-extensions`).expect(200)).body[0].id).toBe(row.id);
  }, 30_000);

  it('rolls back date, decision, status, and receipt if the transactional audit write fails', async () => {
    const f = await setup(), { row } = await apply(f), key = randomUUID();
    await f.db.$executeRawUnsafe(`CREATE FUNCTION supplier_deadline_test_reject_audit() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.action = 'SUPPLIER_EIGHT_D_DEADLINE_APPROVED' THEN RAISE EXCEPTION 'controlled test audit failure'; END IF; RETURN NEW; END; $$`);
    await f.db.$executeRawUnsafe(`CREATE TRIGGER supplier_deadline_test_reject_audit BEFORE INSERT ON audit_events
      FOR EACH ROW EXECUTE FUNCTION supplier_deadline_test_reject_audit()`);
    try {
      await decide(f, f.sqe.cookie, row, 'SQE', 'APPROVE', key).expect(500);
      expect((await f.read()).analysisDueAt).toBe(oldDue);
      expect((await f.db.$queryRaw<{ status: string; version: number }[]>`SELECT status, version FROM supplier_eight_d_deadline_requests WHERE id = ${row.id}::uuid`)[0]).toEqual({ status: 'QUALITY_PENDING', version: 1 });
      expect(await f.db.$queryRaw`SELECT id FROM supplier_eight_d_deadline_decisions WHERE request_id = ${row.id}::uuid`).toEqual([]);
      expect(await f.db.$queryRaw`SELECT key FROM supplier_eight_d_deadline_receipts WHERE key = ${key}`).toEqual([]);
    } finally {
      await f.db.$executeRawUnsafe('DROP TRIGGER supplier_deadline_test_reject_audit ON audit_events');
      await f.db.$executeRawUnsafe('DROP FUNCTION supplier_deadline_test_reject_audit()');
    }
    await decide(f, f.sqe.cookie, row, 'SQE', 'APPROVE', key).expect(200);
  }, 30_000);

  it('lets the still-authorized applicant cancel a content-stale request and apply afresh', async () => {
    const f = await setup(), { row } = await apply(f), current = await f.read();
    await f.http(f.vendor.cookie, 'put', f.portal, { ...f.version(current), document: supplierEightDDocument() }).expect(200);
    await decide(f, f.sqe.cookie, row, 'SQE').expect(409);
    const cancelled = (await f.http(f.vendor.cookie, 'post', `${f.portal}/deadline-extensions/${row.id}/cancel`, {
      expectedVersion: row.version, comment: 'Content changed; withdraw the superseded request' }).expect(200)).body;
    expect(cancelled.status).toBe('CANCELLED');
    expect((await apply(f)).row.id).not.toBe(row.id);
    expect((await f.read()).analysisDueAt).toBe(oldDue);
  }, 30_000);

  it('projects only the actual current serial duty without impersonation or notification-read grants', async () => {
    const service = app.get(SupplierEightDDeadlineService), project = Reflect.get(service, 'notificationPending'), canNotify = Reflect.get(service, 'canNotifyPending');
    expect(typeof project).toBe('function'); expect(typeof canNotify).toBe('function');
    const f = await setup('HIGH'), { row } = await apply(f);
    const pending = () => f.db.$transaction(tx => project.call(service, tx, f.f.org.id, f.draft.id));
    expect(await pending()).toEqual([expect.objectContaining({ id: row.id, version: 1, status: 'QUALITY_PENDING', stage: 'ANALYSIS', pendingUserId: f.sqe.actor.id })]);
    expect(await f.db.$transaction(tx => canNotify.call(service, tx, f.f.org.id, f.draft.id, row.id, 1, f.manager.actor.id))).toBe(false);
    expect(await f.db.$transaction(tx => canNotify.call(service, tx, f.f.org.id, f.draft.id, row.id, 1, f.sqe.actor.id))).toBe(true);
    const intermediate = (await decide(f, f.sqe.cookie, row, 'SQE').expect(200)).body;
    expect(await pending()).toEqual([expect.objectContaining({ id: row.id, version: 2, status: 'MANAGER_PENDING', pendingUserId: f.manager.actor.id })]);
    expect(await f.db.$transaction(tx => canNotify.call(service, tx, f.f.org.id, f.draft.id, row.id, 1, f.sqe.actor.id))).toBe(false);
    await decide(f, f.manager.cookie, intermediate, 'MANAGER').expect(200);
    expect(await pending()).toEqual([]);
  }, 30_000);

  it('silences stale or revoked pending projections and rejects foreign-owner task guesses', async () => {
    const service = app.get(SupplierEightDDeadlineService), project = Reflect.get(service, 'notificationPending'), canNotify = Reflect.get(service, 'canNotifyPending');
    expect(typeof project).toBe('function'); expect(typeof canNotify).toBe('function');
    const f = await setup(), { row } = await apply(f);
    expect(await f.db.$transaction(tx => project.call(service, tx, f.otherVendor.org.id, f.draft.id))).toEqual([]);
    const permission = await f.db.permission.findUniqueOrThrow({ where: { code: 'supplier-quality:issues:deadlines' } });
    await f.db.rolePermission.delete({ where: { roleId_permissionId: { roleId: f.f.role.id, permissionId: permission.id } } });
    expect(await f.db.$transaction(tx => project.call(service, tx, f.f.org.id, f.draft.id))).toEqual([]);
    expect(await f.db.$transaction(tx => canNotify.call(service, tx, f.f.org.id, f.draft.id, row.id, 1, f.sqe.actor.id))).toBe(false);
    await f.db.rolePermission.create({ data: { roleId: f.f.role.id, permissionId: permission.id } });
    await f.db.$executeRaw`UPDATE supplier_eight_d_controls SET row_version = row_version + 1 WHERE supplier_problem_id = ${f.draft.id}::uuid`;
    expect(await f.db.$transaction(tx => project.call(service, tx, f.f.org.id, f.draft.id))).toEqual([]);
  }, 30_000);

  it('linearizes actual session revocation against approval without a late false-success replay', async () => {
    const f = await setup(), { row } = await apply(f), key = randomUUID();
    const [approval] = await Promise.all([
      decide(f, f.sqe.cookie, row, 'SQE', 'APPROVE', key),
      app.get(SessionService).revoke(f.sqe.cookie.slice('qms_session='.length), randomUUID()),
    ]);
    expect([200, 401, 409]).toContain(approval.status);
    const current = (await f.http(f.vendor.cookie, 'get', f.portal).expect(200)).body;
    expect(current.analysisDueAt).toBe(approval.status === 200 ? newDue : oldDue);
    const [count] = await f.db.$queryRaw<{ count: number }[]>`SELECT count(*)::integer AS count FROM supplier_eight_d_deadline_decisions WHERE request_id = ${row.id}::uuid`;
    expect(count!.count).toBe(approval.status === 200 ? 1 : 0);
    await decide(f, f.sqe.cookie, row, 'SQE', 'APPROVE', key).expect(401);
  }, 30_000);

  it('requires a current password-capable actor for the no-session decision projection', async () => {
    const f = await setup(), { row } = await apply(f), service = app.get(SupplierEightDDeadlineService);
    await f.db.user.update({ where: { id: f.sqe.actor.id }, data: { mustChangePassword: true } });
    expect(await f.db.$transaction(tx => service.canNotifyPending(tx, f.f.org.id, f.draft.id, row.id, 1, f.sqe.actor.id))).toBe(false);
  }, 30_000);

  it('enqueues each changed outbox version once, never on replay, with the exact supplier event contract', async () => {
    const f = await setup('HIGH'), { row, body, key } = await apply(f), approvalKey = randomUUID();
    const events = () => f.db.outboxEvent.findMany({ where: { eventType: 'SUPPLIER_EIGHT_D_DEADLINE_CHANGED', aggregateId: row.id }, orderBy: { eventKey: 'asc' } });
    expect(await events()).toHaveLength(1);
    await f.http(f.vendor.cookie, 'post', `${f.portal}/deadline-extensions`, body, key).expect(201);
    const intermediate = (await decide(f, f.sqe.cookie, row, 'SQE', 'APPROVE', approvalKey).expect(200)).body;
    await decide(f, f.sqe.cookie, row, 'SQE', 'APPROVE', approvalKey).expect(200);
    await decide(f, f.manager.cookie, intermediate, 'MANAGER').expect(200);
    const rows = await events();
    expect(rows).toHaveLength(3);
    for (const [index, status] of ['QUALITY_PENDING', 'MANAGER_PENDING', 'APPROVED'].entries()) {
      expect(rows[index]).toMatchObject({ eventKey: `supplier-eight-d-deadline:${row.id}:v${index + 1}`,
        eventType: 'SUPPLIER_EIGHT_D_DEADLINE_CHANGED', aggregateType: 'SupplierEightDDeadline', aggregateId: row.id });
      expect(rows[index]!.payload).toEqual({ schemaVersion: 1, organizationId: f.f.org.id, supplierProblemId: f.draft.id,
        requestId: row.id, version: index + 1, stage: 'ANALYSIS', status });
    }
    const [coreEvent] = await f.db.$queryRaw<{ present: boolean }[]>`SELECT EXISTS (SELECT 1 FROM outbox_events
      WHERE aggregate_id = ${f.draft.id} AND event_type = 'SUPPLIER_EIGHT_D_CHANGED' AND payload->>'action' = 'DEADLINE_EXTENDED') AS present`;
    expect(coreEvent!.present).toBe(true);
  }, 30_000);

  it('publishes returned and cancelled terminal changed events without notifying an approval side again', async () => {
    const f = await setup(), first = (await apply(f)).row;
    await decide(f, f.sqe.cookie, first, 'SQE', 'RETURN').expect(200);
    const second = (await apply(f)).row;
    await f.http(f.vendor.cookie, 'post', `${f.portal}/deadline-extensions/${second.id}/cancel`, { expectedVersion: 1, comment: 'Withdraw application' }).expect(200);
    for (const [id, terminal] of [[first.id, 'RETURNED'], [second.id, 'CANCELLED']]) {
      const events = await f.db.outboxEvent.findMany({ where: { eventType: 'SUPPLIER_EIGHT_D_DEADLINE_CHANGED', aggregateId: id }, orderBy: { eventKey: 'asc' } });
      expect(events.map(event => (event.payload as { status: string }).status)).toEqual(['QUALITY_PENDING', terminal]);
      expect(await f.db.$transaction(tx => app.get(SupplierEightDDeadlineService).notificationPending(tx, f.f.org.id, f.draft.id))).toEqual([]);
    }
    expect((await f.read()).analysisDueAt).toBe(oldDue);
  }, 30_000);

  it('rolls back the applied date, decision, audit, receipt and changed event when outbox insertion fails', async () => {
    const f = await setup(), { row } = await apply(f), key = randomUUID();
    await f.db.$executeRawUnsafe(`CREATE FUNCTION supplier_deadline_test_reject_outbox() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.event_type = 'SUPPLIER_EIGHT_D_DEADLINE_CHANGED' AND NEW.payload->>'status' = 'APPROVED'
        THEN RAISE EXCEPTION 'controlled test outbox failure'; END IF; RETURN NEW; END; $$`);
    await f.db.$executeRawUnsafe(`CREATE TRIGGER supplier_deadline_test_reject_outbox BEFORE INSERT ON outbox_events
      FOR EACH ROW EXECUTE FUNCTION supplier_deadline_test_reject_outbox()`);
    try {
      await decide(f, f.sqe.cookie, row, 'SQE', 'APPROVE', key).expect(500);
      expect((await f.read()).analysisDueAt).toBe(oldDue);
      expect((await f.db.$queryRaw<{ status: string; version: number }[]>`SELECT status, version FROM supplier_eight_d_deadline_requests WHERE id = ${row.id}::uuid`)[0]).toEqual({ status: 'QUALITY_PENDING', version: 1 });
      expect(await f.db.$queryRaw`SELECT id FROM supplier_eight_d_deadline_decisions WHERE request_id = ${row.id}::uuid`).toEqual([]);
      expect(await f.db.$queryRaw`SELECT key FROM supplier_eight_d_deadline_receipts WHERE key = ${key}`).toEqual([]);
      expect(await f.db.auditEvent.count({ where: { resourceId: row.id, action: 'SUPPLIER_EIGHT_D_DEADLINE_APPROVED' } })).toBe(0);
      expect(await f.db.outboxEvent.count({ where: { eventKey: `supplier-eight-d-deadline:${row.id}:v2` } })).toBe(0);
    } finally {
      await f.db.$executeRawUnsafe('DROP TRIGGER supplier_deadline_test_reject_outbox ON outbox_events');
      await f.db.$executeRawUnsafe('DROP FUNCTION supplier_deadline_test_reject_outbox()');
    }
    await decide(f, f.sqe.cookie, row, 'SQE', 'APPROVE', key).expect(200);
    expect(await f.db.outboxEvent.count({ where: { eventKey: `supplier-eight-d-deadline:${row.id}:v2` } })).toBe(1);
  }, 30_000);
});
