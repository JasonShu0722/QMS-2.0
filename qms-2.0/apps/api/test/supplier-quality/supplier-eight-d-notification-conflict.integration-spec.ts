import 'reflect-metadata';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '../../src/app.module.js';
import { GlobalExceptionFilter } from '../../src/common/contracts/global-exception.filter.js';
import { PrismaService } from '../../src/database/prisma.service.js';
import { APPLICATION_OUTBOX_HANDLER, OutboxWorkerService, type AtomicOutboxHandler } from '../../src/modules/task-notification/outbox-worker.service.js';
import { SupplierEightDService } from '../../src/modules/supplier-quality/supplier-eight-d.service.js';
import { SupplierEightDDeadlineService } from '../../src/modules/supplier-quality/supplier-eight-d-deadline.service.js';
import { supplierEightDDocument, supplierEightDFixture } from './supplier-eight-d.fixture.js';
import { isDisposableLoopbackPostgres } from '../disposable-postgres.js';

if (process.env.QMS_DISPOSABLE_TEST_DB !== 'true' || !isDisposableLoopbackPostgres(process.env.DATABASE_URL)
  || new URL(process.env.DATABASE_URL!).pathname !== '/qms_n5_20261028_tasks') throw new Error('Dedicated supplier task disposable PostgreSQL required');

type Fixture = Awaited<ReturnType<typeof supplierEightDFixture>>;
describe('supplier notification real conflict recovery', () => {
  let app: INestApplication;
  beforeAll(async () => {
    app = (await Test.createTestingModule({ imports: [AppModule] }).compile()).createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init();
  }, 120000);
  afterAll(async () => { await app?.close(); });

  async function setup(severity: 'LOW' | 'HIGH' = 'LOW') {
    const f = await supplierEightDFixture(app, severity);
    const permissions = await f.db.permission.findMany({ where: { code: { in: ['task:read', 'notification:read'] } } });
    for (const roleId of [f.f.role.id, f.vendor.role.id]) await f.db.rolePermission.createMany({ data: permissions.map(p => ({ roleId, permissionId: p.id })), skipDuplicates: true });
    let c = await f.read();
    await f.http(f.sqe.cookie, 'put', `${f.prefix}/deadlines`, { ...f.version(c), analysisDueAt: '2026-11-01T00:00:00.000Z', closureDueAt: '2026-11-01T00:00:00.000Z' }).expect(200);
    c = await f.read();
    const preview = (await f.http(f.sqe.cookie, 'post', `${f.prefix}/disclosure-preview`, { expectedRowVersion: c.rowVersion, selectedFileIds: [] }).expect(200)).body;
    await f.http(f.sqe.cookie, 'post', `${f.prefix}/release`, { expectedRowVersion: preview.rowVersion, previewToken: preview.previewToken, confirmed: true, selectedFileIds: [] }).expect(200);
    return f;
  }
  async function request(f: Fixture) {
    const c = await f.read();
    return (await f.http(f.vendor.cookie, 'post', `${f.portal}/deadline-extensions`, { ...f.version(c), expectedContentVersion: c.contentVersion,
      stage: 'ANALYSIS', requestedDueAt: '2026-12-01T00:00:00.000Z', reason: 'Actual verification requires time' }).expect(201)).body;
  }
  async function drain() {
    const db = app.get(PrismaService), handler = app.get<AtomicOutboxHandler>(APPLICATION_OUTBOX_HANDLER);
    const count = await db.outboxEvent.count({ where: { eventType: { in: [...handler.eventTypes] }, status: 'PENDING', availableAt: { lte: new Date() } } });
    for (let i = 0; i <= Math.ceil(count / 100); i++) await app.get(OutboxWorkerService).processAtomicDue(100, handler);
  }
  const pending = (f: Fixture) => f.db.$transaction(tx => app.get(SupplierEightDDeadlineService).notificationPending(tx, f.f.org.id, f.draft.id));
  const notices = (f: Fixture, eventKey: string) => f.db.$queryRaw<{ id: string }[]>`SELECT id FROM supplier_eight_d_notifications WHERE supplier_problem_id = ${f.draft.id}::uuid AND event_key = ${eventKey}`;

  it('propagates actual lockFacts version mismatch through both ports and the application atomic worker, then retries after facts recover', async () => {
    const f = await setup(), c = await f.read();
    const event = await f.db.outboxEvent.findFirstOrThrow({ where: { aggregateId: f.draft.id, eventType: 'SUPPLIER_EIGHT_D_CHANGED', payload: { path: ['action'], equals: 'RELEASE' } } });
    await f.db.problemIndex.update({ where: { id: c.problemId }, data: { severity: 'HIGH' } });
    try {
      await drain();
      const failed = await f.db.outboxEvent.findUniqueOrThrow({ where: { id: event.id } });
      expect(failed).toMatchObject({ status: 'PENDING', attempts: 1, processedAt: null });
      expect(failed.lastError).toContain('WORKFLOW_VERSION_MISMATCH');
      expect(await notices(f, event.eventKey)).toEqual([]);
      console.info('REAL_FAILURE', { eventId: event.id, status: failed.status, attempts: failed.attempts, lastError: failed.lastError });
      expect(await f.db.outboxDeliveryAttempt.findMany({ where: { outboxEventId: event.id }, select: { outcome: true } })).toEqual([{ outcome: 'FAILED' }]);
      await expect(f.db.$transaction(tx => app.get(SupplierEightDService).notificationContext(tx, f.f.org.id, f.draft.id))).rejects.toThrow('WORKFLOW_VERSION_MISMATCH');
      await expect(f.db.$transaction(tx => app.get(SupplierEightDService).deadlineNotificationContext(tx, f.f.org.id, f.draft.id, 'ANALYSIS'))).rejects.toThrow('WORKFLOW_VERSION_MISMATCH');
      // Advance only this real event's scheduling fact, not the worker clock or its retry policy.
      for (let attempt = 2; attempt <= 5; attempt++) {
        await f.db.outboxEvent.update({ where: { id: event.id }, data: { availableAt: new Date() } });
        await drain();
      }
      const terminal = await f.db.outboxEvent.findUniqueOrThrow({ where: { id: event.id } });
      expect(terminal).toMatchObject({ status: 'FAILED', attempts: 5, processedAt: null, lastError: 'WORKFLOW_VERSION_MISMATCH' });
      expect(await notices(f, event.eventKey)).toEqual([]);
      console.info('REAL_TERMINAL_FAILURE', { eventId: event.id, status: terminal.status, attempts: terminal.attempts, lastError: terminal.lastError });
    } finally {
      await f.db.problemIndex.update({ where: { id: c.problemId }, data: { severity: 'LOW' } });
    }
    await app.get(OutboxWorkerService).retryFailed(event.id);
    await drain();
    expect(await f.db.outboxEvent.findUniqueOrThrow({ where: { id: event.id } })).toMatchObject({ status: 'PROCESSED', attempts: 0, lastError: null });
    expect(await notices(f, event.eventKey)).toHaveLength(1);
    console.info('REAL_RETRY_SUCCESS', { eventId: event.id, status: 'PROCESSED', notifications: 1 });
  }, 120000);

  it('consumes ended analysis and old request sources without notification or retry failures', async () => {
    const f = await setup(), row = await request(f);
    const event = await f.db.outboxEvent.findUniqueOrThrow({ where: { eventKey: `supplier-eight-d-deadline:${row.id}:v1` } });
    let c = await f.read();
    await f.http(f.vendor.cookie, 'put', f.portal, { ...f.version(c), document: supplierEightDDocument() }).expect(200);
    c = await f.read();
    await f.http(f.vendor.cookie, 'post', `${f.portal}/analysis-complete`, { ...f.version(c), submissionDueAt: '2026-12-01T00:00:00.000Z' }).expect(201);
    expect(await pending(f)).toEqual([]);
    await drain();
    expect(await f.db.outboxEvent.findUniqueOrThrow({ where: { id: event.id } })).toMatchObject({ status: 'PROCESSED', attempts: 0 });
    expect(await notices(f, event.eventKey)).toEqual([]);
  }, 120000);

  it('silences explicitly revoked management facts but keeps strict decisions rejected', async () => {
    const f = await setup('HIGH'), row = await request(f);
    await f.db.userPosition.update({ where: { id: f.f.manager.assignment.id }, data: { endedAt: new Date() } });
    expect(await pending(f)).toEqual([]);
    await f.http(f.sqe.cookie, 'post', `${f.prefix}/deadline-extensions/${row.id}/decide`, { expectedVersion: row.version, duty: 'SQE', decision: 'APPROVE', comment: 'No stale source accepted' }).expect(409);
    await drain();
    const event = await f.db.outboxEvent.findUniqueOrThrow({ where: { eventKey: `supplier-eight-d-deadline:${row.id}:v1` } });
    expect(event).toMatchObject({ status: 'PROCESSED', attempts: 0 });
    expect(await notices(f, event.eventKey)).toEqual([]);
  }, 120000);

  it('filters closed phase explicitly for pending deadline ports and queued real events', async () => {
    const f = await setup(), row = await request(f);
    let c = await f.read();
    await f.http(f.vendor.cookie, 'put', f.portal, { ...f.version(c), document: supplierEightDDocument() }).expect(200);
    c = await f.read();
    await f.http(f.vendor.cookie, 'post', `${f.portal}/analysis-complete`, { ...f.version(c), submissionDueAt: '2026-12-01T00:00:00.000Z' }).expect(201);
    c = await f.read();
    const submitted = (await f.http(f.vendor.cookie, 'post', `${f.portal}/submit`, f.version(c)).expect(201)).body;
    const sqe = await f.decide(f.sqe, submitted.closure, ['PROFESSIONAL']); expect(sqe.status).toBe(200);
    expect((await f.decide(f.manager, sqe.body, ['SECTION_MANAGER'])).status).toBe(200);
    expect((await f.read()).closedAt).not.toBeNull();
    expect(await f.db.$transaction(tx => app.get(SupplierEightDService).deadlineNotificationContext(tx, f.f.org.id, f.draft.id, 'CLOSURE'))).toBeNull();
    expect(await pending(f)).toEqual([]);
    await drain();
    const event = await f.db.outboxEvent.findUniqueOrThrow({ where: { eventKey: `supplier-eight-d-deadline:${row.id}:v1` } });
    expect(event).toMatchObject({ status: 'PROCESSED', attempts: 0 });
    expect(await notices(f, event.eventKey)).toEqual([]);
  }, 120000);
});
