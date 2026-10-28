import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { AppModule } from '../../src/app.module.js';
import { GlobalExceptionFilter } from '../../src/common/contracts/global-exception.filter.js';
import { WorkflowDefinitionService } from '../../src/modules/workflow/workflow-definition.service.js';
import type { WorkflowDraft } from '../../src/modules/workflow/workflow-validation.service.js';
import { SupplierEightDTaskService } from '../../src/modules/supplier-quality/supplier-eight-d-task.service.js';
import { SupplierEightDReminderService } from '../../src/modules/supplier-quality/supplier-eight-d-reminder.service.js';
import { APPLICATION_OUTBOX_HANDLER, OutboxWorkerService, type AtomicOutboxHandler } from '../../src/modules/task-notification/outbox-worker.service.js';
import { Prisma } from '../../src/generated/prisma/client.js';
import { PrismaService } from '../../src/database/prisma.service.js';
import { isDisposableLoopbackPostgres } from '../disposable-postgres.js';
import { supplierEightDDocument, supplierEightDFixture } from './supplier-eight-d.fixture.js';

if (process.env.QMS_DISPOSABLE_TEST_DB !== 'true' || !isDisposableLoopbackPostgres(process.env.DATABASE_URL)) {
  throw new Error('Disposable loopback PostgreSQL required; never preview 55440.');
}
type Fixture = Awaited<ReturnType<typeof supplierEightDFixture>>;
const dueAt = '2026-10-01T00:00:00.000Z';

describe('supplier 8D tasks and atomic reminder worker / real HTTP and PostgreSQL', () => {
  let app: INestApplication, tasks: SupplierEightDTaskService, reminders: SupplierEightDReminderService;
  beforeAll(async () => {
    app = (await Test.createTestingModule({ imports: [AppModule] }).compile()).createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init(); tasks = app.get(SupplierEightDTaskService); reminders = app.get(SupplierEightDReminderService);
  }, 120000);
  afterAll(async () => { await app?.close(); });

  async function fixture(severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' = 'LOW', dual = false, cadence: number | null = null) {
    const f = await supplierEightDFixture(app, severity, dual);
    const permissions = await f.db.permission.findMany({ where: { code: { in: ['task:read', 'notification:read'] } } });
    for (const roleId of [f.f.role.id, f.vendor.role.id, f.otherVendor.role.id]) await f.db.rolePermission.createMany({
      data: permissions.filter(p => roleId === f.f.role.id || p.code !== 'task:read').map(p => ({ roleId, permissionId: p.id })), skipDuplicates: true });
    if (cadence !== null) {
      // Set cadence in a real draft, never mutate a published graph to make a test pass.
      const template = (await f.http(f.sqe.cookie, 'post', 'workflows/closure-templates', { policy: 'SUPPLIER', domainCode: 'supplier-quality', code: randomUUID(), name: 'Explicit hourly supplier reminders' }).expect(201)).body;
      const graph = template.version.structureSnapshot as WorkflowDraft;
      graph.nodes.find(n => n.id === 'owner')!.config!.supplierEightD = { schemaVersion: 1, reminderEveryHours: cadence };
      const definitions = app.get(WorkflowDefinitionService);
      const updated = await definitions.updateDraft({ organizationId: f.f.org.id, userId: f.sqe.actor.id, actor: f.sqe.actor,
        definitionId: template.id, expectedRevision: template.revision, draftVersionId: template.version.id, draft: graph });
      const published = await definitions.publishVersion({ organizationId: f.f.org.id, userId: f.sqe.actor.id, actor: f.sqe.actor,
        definitionId: updated.id, expectedRevision: updated.revision, draftVersionId: updated.version.id });
      const prior = await f.db.supplierWorkflowBinding.findFirstOrThrow({ where: { organizationId: f.f.org.id, severity, responseForm: 'EIGHT_D', replyMode: 'SUPPLIER' }, orderBy: { version: 'desc' } });
      const binding = (await f.http(f.sqe.cookie, 'put', 'supplier-quality/workflow-bindings', { severity, responseForm: 'EIGHT_D', replyMode: 'SUPPLIER', expectedVersion: prior.version, workflowVersionId: published.id, enabled: false }).expect(200)).body;
      await f.http(f.sqe.cookie, 'put', 'supplier-quality/workflow-bindings/activation', { severity, responseForm: 'EIGHT_D', replyMode: 'SUPPLIER', expectedVersion: binding.version, enabled: true }).expect(200);
      const draft = (await f.http(f.sqe.cookie, 'post', 'supplier-quality/drafts', { profileId: f.profile.id, title: 'Explicit reminder task', materialCode: 'TASK-1',
        defectDescription: 'Actual fixture nonconformity', defectQuantity: 1, severity, responseForm: 'EIGHT_D', replyMode: 'SUPPLIER' }).expect(201)).body;
      await f.http(f.sqe.cookie, 'post', `supplier-quality/eight-d/drafts/${draft.id}/issue`, { expectedVersion: draft.version, sqeAssignmentId: f.f.owner.assignment.id }).expect(201);
      f.draft = draft; f.prefix = `supplier-quality/eight-d/${draft.id}`; f.portal = `supplier-portal/eight-d/${draft.id}`;
      f.read = async () => (await f.http(f.sqe.cookie, 'get', f.prefix).expect(200)).body;
    }
    const current = await f.read();
    await f.http(f.sqe.cookie, 'put', `${f.prefix}/deadlines`, { ...f.version(current), analysisDueAt: dueAt, closureDueAt: dueAt }).expect(200);
    return f;
  }
  async function release(f: Fixture) {
    const current = await f.read();
    const preview = (await f.http(f.sqe.cookie, 'post', `${f.prefix}/disclosure-preview`, { expectedRowVersion: current.rowVersion, selectedFileIds: [] }).expect(200)).body;
    await f.http(f.sqe.cookie, 'post', `${f.prefix}/release`, { expectedRowVersion: preview.rowVersion, previewToken: preview.previewToken, confirmed: true, selectedFileIds: [] }).expect(200);
  }
  const list = (f: Fixture, person = f.vendor) => tasks.list(person.actor, { supplierProblemId: f.draft.id });
  async function decide(f: Fixture, person: Fixture['sqe'], round: { id: string; version: number }, duties: string[], decision = 'APPROVE') {
    const response = await f.decide(person, round, duties, decision);
    expect(response.status).toBe(200);
    return response.body;
  }
  async function submit(f: Fixture) {
    let row = await f.read();
    await f.http(f.vendor.cookie, 'put', f.portal, { ...f.version(row), document: supplierEightDDocument() }).expect(200);
    row = await f.read();
    await f.http(f.vendor.cookie, 'post', `${f.portal}/analysis-complete`, { ...f.version(row), submissionDueAt: '2026-12-01T00:00:00.000Z' }).expect(201);
    row = await f.read();
    return (await f.http(f.vendor.cookie, 'post', `${f.portal}/submit`, f.version(row)).expect(201)).body;
  }
  async function cycle(f: Fixture, limit = 100) {
    const [{ count }] = await f.db.$queryRaw<{ count: number }[]>`SELECT count(*)::int AS count FROM supplier_eight_d_controls`;
    for (let page = 0; page <= Math.ceil(count / limit); page++) {
      const result = await reminders.poll(limit);
      expect(result.examined).toBeLessThanOrEqual(limit);
      expect(result.deliveryState).toBe('PENDING_PROJECTION');
    }
  }
  async function deliver() {
    const db = app.get(PrismaService);
    const handler = app.get<AtomicOutboxHandler>(APPLICATION_OUTBOX_HANDLER);
    const pending = await db.outboxEvent.count({ where: { eventType: { in: [...handler.eventTypes] }, status: 'PENDING', availableAt: { lte: new Date() } } });
    for (let batch = 0; batch <= Math.ceil(pending / 100); batch++) await app.get(OutboxWorkerService).processAtomicDue(100, handler);
  }
  const notices = (f: Fixture, projection?: 'PERIODIC' | 'STATE_CHANGE') => f.db.$queryRaw<Array<{ userId: string; kind: string }>>(Prisma.sql`
    SELECT recipient_user_id AS "userId", kind FROM supplier_eight_d_notifications WHERE supplier_problem_id = ${f.draft.id}::uuid
    ${projection ? Prisma.sql`AND context->>'projection' = ${projection}` : Prisma.empty} ORDER BY kind, recipient_user_id`);

  it('hides drafts/unreleased/other enterprises and creates handling only for actual released supplier accounts', async () => {
    const f = await fixture();
    expect((await list(f)).items).toEqual([]);
    expect((await list(f, f.otherVendor)).items).toEqual([]);
    const draft = (await f.http(f.sqe.cookie, 'post', 'supplier-quality/drafts', { profileId: f.profile.id, title: 'Not formally issued', materialCode: 'DRAFT', defectDescription: 'Draft only', defectQuantity: 1,
      severity: 'LOW', responseForm: 'EIGHT_D', replyMode: 'SUPPLIER' }).expect(201)).body;
    expect((await tasks.list(f.sqe.actor, { supplierProblemId: draft.id })).items).toEqual([]);
    await release(f);
    expect((await list(f)).items).toMatchObject([{ kind: 'HANDLING', stage: 'ANALYSIS', userId: f.vendor.actor.id }]);
    expect((await tasks.list(f.sqe.actor, { supplierProblemId: f.draft.id })).items).toEqual([]);
    expect((await list(f, f.otherVendor)).items).toEqual([]);
    await cycle(f); await deliver(); expect(await notices(f, 'PERIODIC')).toEqual([]);
    expect(await notices(f, 'STATE_CHANGE')).toEqual([{ userId: f.vendor.actor.id, kind: 'HANDLING_REMINDER' }]);
    await f.http(f.vendor.cookie, 'get', `supplier-portal/eight-d/tasks?supplierProblemId=${f.draft.id}`).expect(200);
    await f.http(f.vendor.cookie, 'get', 'supplier-portal/eight-d/tasks?pageSize=101').expect(400);
    await f.http(f.vendor.cookie, 'get', `supplier-portal/eight-d/tasks?organizationId=${f.f.org.id}`).expect(403);
  }, 120000);

  it.each(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const)('%s projects supplier -> SQE -> actual management and retires old returned rounds', async severity => {
    const f = await fixture(severity); await release(f);
    const submitted = await submit(f);
    expect((await list(f)).items).toEqual([]);
    expect((await tasks.list(f.manager.actor, { supplierProblemId: f.draft.id })).items).toEqual([]);
    expect((await tasks.list(f.sqe.actor, { supplierProblemId: f.draft.id })).items).toMatchObject([{ kind: 'CLOSURE', duty: 'PROFESSIONAL', roundId: submitted.closure.id }]);
    const quality = await decide(f, f.sqe, submitted.closure, ['PROFESSIONAL']);
    expect((await tasks.list(f.sqe.actor, { supplierProblemId: f.draft.id })).items).toEqual([]);
    expect((await tasks.list(f.manager.actor, { supplierProblemId: f.draft.id })).items).toMatchObject([{ duty: 'SECTION_MANAGER' }]);
    const ministerTasks = await tasks.list(f.minister.actor, { supplierProblemId: f.draft.id });
    expect(ministerTasks.items.map(t => t.duty)).toEqual(severity === 'HIGH' || severity === 'CRITICAL' ? ['MINISTER'] : []);
    await deliver();
    const managementNotice = (await f.http(f.manager.cookie, 'get', `notifications/closure?problemId=${submitted.problemId}`).expect(200)).body;
    expect(managementNotice.items).toMatchObject([{ duties: ['SECTION_MANAGER'] }]);
    await decide(f, f.manager, quality, ['SECTION_MANAGER'], 'RETURN');
    expect((await tasks.list(f.manager.actor, { supplierProblemId: f.draft.id })).items).toEqual([]);
    expect((await tasks.list(f.minister.actor, { supplierProblemId: f.draft.id })).items).toEqual([]);
    const resubmitted = await submit(f);
    expect(resubmitted.closure.id).not.toBe(submitted.closure.id);
    expect((await tasks.list(f.sqe.actor, { supplierProblemId: f.draft.id })).items[0].roundId).toBe(resubmitted.closure.id);
  }, 120000);

  it('retains dual real duties for the same manager and creates no work for closed supplements', async () => {
    const f = await fixture('HIGH', true); await release(f); const row = await submit(f);
    const quality = await decide(f, f.sqe, row.closure, ['PROFESSIONAL']);
    expect((await tasks.list(f.manager.actor, { supplierProblemId: f.draft.id })).items.map(t => t.duty).sort()).toEqual(['MINISTER', 'SECTION_MANAGER']);
    await decide(f, f.manager, quality, ['SECTION_MANAGER', 'MINISTER']);
    const closed = await f.read();
    await f.http(f.sqe.cookie, 'put', f.prefix, { ...f.version(closed), document: { ...closed.document, description: 'Post-close factual supplement' } }).expect(200);
    expect((await tasks.list(f.sqe.actor, { supplierProblemId: f.draft.id })).items).toEqual([]);
    expect((await tasks.list(f.manager.actor, { supplierProblemId: f.draft.id })).items).toEqual([]);
    expect((await f.read()).closedAt).toBe(closed.closedAt);
    await cycle(f); await deliver(); expect(await notices(f)).toEqual([]);
  }, 120000);

  it('enqueues with bounded cursor and projects exactly once through the real atomic worker', async () => {
    const f = await fixture('LOW', false, 1); await release(f);
    await cycle(f, 1);
    const event = await f.db.outboxEvent.findFirstOrThrow({ where: { aggregateId: f.draft.id, eventType: 'SUPPLIER_EIGHT_D_REMINDER_DUE' } });
    expect(event.status).toBe('PENDING'); expect(await notices(f)).toEqual([]);
    await deliver(); await cycle(f); await deliver();
    expect(await notices(f, 'PERIODIC')).toEqual([{ userId: f.vendor.actor.id, kind: 'HANDLING_REMINDER' }]);
    await f.db.$transaction(tx => reminders.handle(tx, { ...event, processingAt: new Date() }));
    expect(await notices(f, 'PERIODIC')).toHaveLength(1);
    expect(await notices(f, 'STATE_CHANGE')).toHaveLength(1);
    const inbox = await tasks.notifications(f.vendor.actor, { supplierProblemId: f.draft.id });
    expect(inbox.items).toHaveLength(2);
    expect(inbox.items.every(item => item.channel === 'IN_APP' && item.status === 'DELIVERED')).toBe(true);
    expect((await tasks.notifications(f.otherVendor.actor, { supplierProblemId: f.draft.id })).items).toEqual([]);
    const sessions = await f.db.session.count({ where: { userId: f.vendor.actor.id } });
    await cycle(f); await deliver();
    expect(await f.db.session.count({ where: { userId: f.vendor.actor.id } })).toBe(sessions);
  }, 120000);

  it('consumes actual release/submit/return state events with default null cadence instead of deferring them forever', async () => {
    const f = await fixture('HIGH'); await release(f);
    const releaseEvent = await f.db.outboxEvent.findFirstOrThrow({ where: { aggregateId: f.draft.id, eventType: 'SUPPLIER_EIGHT_D_CHANGED', payload: { path: ['action'], equals: 'RELEASE' } } });
    await deliver();
    expect((await f.db.outboxEvent.findUniqueOrThrow({ where: { id: releaseEvent.id } })).status).toBe('PROCESSED');
    expect(await notices(f, 'STATE_CHANGE')).toEqual([{ userId: f.vendor.actor.id, kind: 'HANDLING_REMINDER' }]);
    await f.db.$transaction(tx => reminders.handle(tx, { ...releaseEvent, processingAt: new Date() }));
    expect(await notices(f, 'STATE_CHANGE')).toHaveLength(1);
    const submitted = await submit(f); await deliver();
    expect((await tasks.notifications(f.vendor.actor, { supplierProblemId: f.draft.id })).items).toEqual([]);
    expect((await tasks.notifications(f.sqe.actor, { supplierProblemId: f.draft.id })).items).toMatchObject([{ kind: 'CLOSURE_REMINDER' }]);
    await decide(f, f.sqe, submitted.closure, ['PROFESSIONAL'], 'RETURN');
    await deliver();
    expect((await tasks.list(f.vendor.actor, { supplierProblemId: f.draft.id })).items).toMatchObject([{ kind: 'HANDLING' }]);
    expect((await tasks.notifications(f.sqe.actor, { supplierProblemId: f.draft.id })).items).toEqual([]);
    expect((await tasks.notifications(f.vendor.actor, { supplierProblemId: f.draft.id })).items).toMatchObject([{ kind: 'HANDLING_REMINDER' }]);
    const pending = await f.db.outboxEvent.count({ where: { aggregateId: f.draft.id, eventType: 'SUPPLIER_EIGHT_D_CHANGED', status: { not: 'PROCESSED' } } });
    expect(pending).toBe(0);
  }, 120000);

  it('rechecks revoked recipients at projection time', async () => {
    const f = await fixture('LOW', false, 1); await release(f); await cycle(f);
    await f.db.rolePermission.deleteMany({ where: { roleId: f.vendor.role.id, permission: { code: 'supplier-quality:responses:write' } } });
    await deliver(); expect(await notices(f)).toEqual([]);
    expect((await list(f)).items).toEqual([]);
    expect((await tasks.notifications(f.vendor.actor, { supplierProblemId: f.draft.id })).items).toEqual([]);
  }, 120000);

  it('rolls back a real notification projection and rejects a forged event source', async () => {
    const f = await fixture('LOW', false, 1); await release(f); await cycle(f);
    const event = await f.db.outboxEvent.findFirstOrThrow({ where: { aggregateId: f.draft.id, eventType: 'SUPPLIER_EIGHT_D_REMINDER_DUE' } });
    await expect(f.db.$transaction(async tx => {
      await reminders.handle(tx, { ...event, processingAt: new Date() });
      const rows = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM supplier_eight_d_notifications WHERE supplier_problem_id = ${f.draft.id}::uuid`;
      expect(rows).toHaveLength(1);
      throw new Error('Actual transaction rollback');
    })).rejects.toThrow('Actual transaction rollback');
    expect(await notices(f)).toEqual([]);
    await expect(f.db.$transaction(tx => reminders.handle(tx, { ...event, aggregateType: 'WorkflowDeadlineExtension', processingAt: new Date() }))).rejects.toThrow('SUPPLIER_EIGHT_D_REMINDER_EVENT_INVALID');
    expect(await notices(f)).toEqual([]);
    await deliver();
    const before = await notices(f);
    await expect(f.db.$executeRaw`INSERT INTO supplier_eight_d_notifications
      (id, organization_id, supplier_problem_id, recipient_user_id, event_key, kind, subject, body, context)
      SELECT ${randomUUID()}::uuid, organization_id, supplier_problem_id, ${f.otherVendor.actor.id}::uuid, event_key, kind, subject, body,
        jsonb_set(context, '{userId}', to_jsonb(${f.otherVendor.actor.id}::text))
      FROM supplier_eight_d_notifications WHERE supplier_problem_id = ${f.draft.id}::uuid LIMIT 1`).rejects.toThrow();
    expect(await notices(f)).toEqual(before);
  }, 120000);

  it('uses actual supplier-only serial extension tasks, including the same person second manager decision', async () => {
    const f = await fixture('HIGH'); await release(f);
    await f.db.userPosition.update({ where: { id: f.f.manager.assignment.id }, data: { userId: f.sqe.actor.id } });
    const c = await f.read();
    const pending = (await f.http(f.vendor.cookie, 'post', `${f.portal}/deadline-extensions`, { ...f.version(c), expectedContentVersion: c.contentVersion,
      stage: 'ANALYSIS', requestedDueAt: '2026-12-01T00:00:00.000Z', reason: 'Actual required verification' }).expect(201)).body;
    expect((await tasks.list(f.sqe.actor, { supplierProblemId: f.draft.id })).items).toMatchObject([{ kind: 'EXTENSION', duty: 'SQE', status: 'QUALITY_PENDING' }]);
    await deliver();
    expect((await tasks.notifications(f.sqe.actor, { supplierProblemId: f.draft.id })).items).toMatchObject([{ kind: 'EXTENSION_PENDING' }]);
    const requestEvent = await f.db.outboxEvent.findUniqueOrThrow({ where: { eventKey: `supplier-eight-d-deadline:${pending.id}:v1` } });
    expect(requestEvent.status).toBe('PROCESSED');
    const quality = (await f.http(f.sqe.cookie, 'post', `${f.prefix}/deadline-extensions/${pending.id}/decide`, { expectedVersion: pending.version, duty: 'SQE', decision: 'APPROVE', comment: 'First actual duty' }).expect(200)).body;
    expect((await f.read()).analysisDueAt).toBe(dueAt);
    expect((await tasks.list(f.sqe.actor, { supplierProblemId: f.draft.id })).items).toMatchObject([{ kind: 'EXTENSION', duty: 'MANAGER', status: 'MANAGER_PENDING', requestVersion: quality.version }]);
    expect((await tasks.list(f.minister.actor, { supplierProblemId: f.draft.id })).items).toEqual([]);
    await deliver();
    expect((await tasks.notifications(f.sqe.actor, { supplierProblemId: f.draft.id })).items).toMatchObject([{ kind: 'EXTENSION_PENDING' }]);
    const managerEvent = await f.db.outboxEvent.findUniqueOrThrow({ where: { eventKey: `supplier-eight-d-deadline:${pending.id}:v2` } });
    expect(managerEvent.status).toBe('PROCESSED');
    await f.http(f.sqe.cookie, 'post', `${f.prefix}/deadline-extensions/${pending.id}/decide`, { expectedVersion: quality.version, duty: 'MANAGER', decision: 'APPROVE', comment: 'Second actual duty' }).expect(200);
    await deliver();
    expect((await tasks.list(f.sqe.actor, { supplierProblemId: f.draft.id })).items).toEqual([]);
    expect((await tasks.notifications(f.sqe.actor, { supplierProblemId: f.draft.id })).items).toEqual([]);
    expect((await f.db.outboxEvent.findUniqueOrThrow({ where: { eventKey: `supplier-eight-d-deadline:${pending.id}:v3` } })).status).toBe('PROCESSED');
  }, 120000);
});
