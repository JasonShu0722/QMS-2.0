import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { jest } from '@jest/globals';
import { PrismaService } from '../../src/database/prisma.service.js';
import { AuditLogService } from '../../src/modules/audit-log/audit-log.service.js';
import { OutboxAdministrationService } from '../../src/modules/task-notification/outbox-administration.service.js';
import { timingFixture, clearTimingEvents } from './workflow-timing-fixture.js';
import { setTimeout as delay } from 'node:timers/promises';
import { Test } from '@nestjs/testing';
import { ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../../src/app.module.js';
import { GlobalExceptionFilter } from '../../src/common/contracts/global-exception.filter.js';
import { SessionService } from '../../src/modules/identity/session.service.js';
import { WorkflowEventHandler } from '../../src/modules/task-notification/workflow-event.handler.js';
import { OutboxWorkerService } from '../../src/modules/task-notification/outbox-worker.service.js';

if (!process.env.DATABASE_URL) throw new Error('PostgreSQL integration requires DATABASE_URL');

describe('outbox organization administration', () => {
  const prisma = new PrismaService(process.env.DATABASE_URL!);
  const organizations: string[] = [];
  const audit = new AuditLogService(prisma);
  const service = new OutboxAdministrationService(prisma, audit);
  beforeAll(() => prisma.$connect());
  afterEach(() => clearTimingEvents(prisma, organizations));
  afterAll(() => prisma.$disconnect());

  async function fixture() {
    const context = await timingFixture(prisma, organizations);
    for (const code of ['outbox:read', 'outbox:retry']) {
      const permission = await prisma.permission.upsert({ where: { code }, create: { code, name: code }, update: {} });
      await prisma.rolePermission.create({ data: { roleId: context.role.id, permissionId: permission.id } });
    }
    const event = await prisma.outboxEvent.findFirstOrThrow({ where: { aggregateId: context.started.instanceId, eventType: 'WORKFLOW_STARTED' } });
    await prisma.outboxEvent.update({ where: { id: event.id }, data: { status: 'FAILED', attempts: 5, lastError: 'secret-db-password-and-stack' } });
    const session = await prisma.session.create({ data: { userId: context.user.id, tokenHash: randomUUID(), expiresAt: new Date(Date.now() + 3600000), mfaVerifiedAt: new Date(), reauthenticatedAt: new Date() } });
    return { ...context, event, actor: { id: context.user.id, organizationId: context.organization.id, sessionId: session.id, accountType: 'INTERNAL' as const } };
  }

  it('lists only actual owned supported failures and hides errors and payloads', async () => {
    const context = await fixture();
    const foreign = await fixture();
    await prisma.outboxEvent.update({ where: { id: foreign.event.id }, data: { payload: { ...(foreign.event.payload as object), organizationId: context.organization.id } } });
    const result = await service.list(context.actor, {});
    expect(result.total).toBe(1);
    expect(result.items[0]?.id).toBe(context.event.id);
    expect(JSON.stringify(result)).not.toMatch(/secret-db|payload|lastError/);
    expect(result.items[0]?.reasonCode).toBe('OUTBOX_DELIVERY_FAILED');
    expect(result.items[0]?.failureReasonCode).toBe('OUTBOX_HANDLER_ERROR');
    await expect(service.retry(context.actor, foreign.event.id, context.organization.id, randomUUID())).rejects.toMatchObject({ status: 404 });
  });

  it('returns durable failure receipts and retry history without exposing handler details', async () => {
    const context = await fixture();
    await prisma.$executeRaw`
      INSERT INTO outbox_delivery_attempts (id, outbox_event_id, attempt_number, outcome, reason_code, occurred_at)
      VALUES (${randomUUID()}::uuid, ${context.event.id}::uuid, 5, 'FAILED', 'OUTBOX_HANDLER_ERROR', CURRENT_TIMESTAMP)
    `;
    const history = await service.attempts(context.actor, context.event.id, context.organization.id);
    expect(history.items).toHaveLength(1);
    expect(history.items[0]).toMatchObject({ attemptNumber: 5, outcome: 'FAILED', reasonCode: 'OUTBOX_HANDLER_ERROR' });
    expect(JSON.stringify(history)).not.toMatch(/secret-db|lastError|payload/);
  });

  it('atomically resets a failed event, preserves its key, and audits one concurrent winner', async () => {
    const context = await fixture();
    const results = await Promise.allSettled([service.retry(context.actor, context.event.id, context.organization.id, randomUUID()), service.retry(context.actor, context.event.id, context.organization.id, randomUUID())]);
    expect(results.filter((entry) => entry.status === 'fulfilled')).toHaveLength(1);
    expect(results.find((entry) => entry.status === 'rejected')).toMatchObject({ reason: { status: 409 } });
    expect(await prisma.outboxEvent.findUnique({ where: { id: context.event.id } })).toMatchObject({ status: 'PENDING', attempts: 0, lastError: null, processingAt: null, processedAt: null, eventKey: context.event.eventKey });
    expect(await prisma.auditEvent.count({ where: { resourceId: context.event.id, action: 'OUTBOX_RETRY_REQUESTED' } })).toBe(1);
  });

  it('hides damaged node references even when the aggregate and claimed organization are valid', async () => {
    const context = await fixture();
    for (const field of ['currentNodeId', 'previousNodeId']) {
      await prisma.outboxEvent.update({ where: { id: context.event.id }, data: { payload: { ...(context.event.payload as object), [field]: randomUUID() } } });
      expect((await service.list(context.actor, {})).total).toBe(0);
      await expect(service.retry(context.actor, context.event.id, context.organization.id, randomUUID())).rejects.toMatchObject({ status: 404 });
    }
  });

  it('resolves task failures by persisted task references and retries without duplicate notifications', async () => {
    const context = await fixture();
    const worker = new OutboxWorkerService(prisma, () => new Date());
    const handler = new WorkflowEventHandler();
    await service.retry(context.actor, context.event.id, context.organization.id, randomUUID());
    await worker.processAtomicDue(100, handler);
    const task = await prisma.workflowTask.findFirstOrThrow({ where: { workflowInstanceId: context.started.instanceId } });
    const timing = await prisma.outboxEvent.findFirstOrThrow({ where: { aggregateId: task.id, eventType: 'WORKFLOW_TASK_REMINDER' } });
    await prisma.outboxEvent.update({ where: { id: timing.id }, data: { status: 'FAILED', attempts: 5 } });
    expect((await service.list(context.actor, {})).items.map((entry) => entry.id)).toEqual([timing.id]);
    await service.retry(context.actor, timing.id, context.organization.id, randomUUID());
    const dueWorker = new OutboxWorkerService(prisma, () => task.dueAt!);
    await dueWorker.processAtomicDue(100, handler);
    const notifications = await prisma.notification.count({ where: { workflowTaskId: task.id } });
    await prisma.outboxEvent.update({ where: { id: timing.id }, data: { status: 'FAILED', attempts: 5 } });
    await service.retry(context.actor, timing.id, context.organization.id, randomUUID());
    await dueWorker.processAtomicDue(100, handler);
    expect(await prisma.notification.count({ where: { workflowTaskId: task.id } })).toBe(notifications);
    await prisma.outboxEvent.update({ where: { id: timing.id }, data: { status: 'FAILED', payload: { ...(timing.payload as object), nodeId: randomUUID() } } });
    expect((await service.list(context.actor, {})).total).toBe(0);
  });

  it('rolls back retry if success audit fails', async () => {
    const context = await fixture();
    const failingAudit = { record: jest.fn(async () => { throw new Error('audit unavailable'); }) };
    await expect(new OutboxAdministrationService(prisma, failingAudit as never).retry(context.actor, context.event.id, context.organization.id, randomUUID())).rejects.toThrow();
    expect(await prisma.outboxEvent.findUnique({ where: { id: context.event.id } })).toMatchObject({ status: 'FAILED', attempts: 5 });
  });

  it('requires separate read and retry permissions, rejecting disabled or spoofed actors', async () => {
    const context = await fixture();
    const retryPermission = await prisma.permission.findUniqueOrThrow({ where: { code: 'outbox:retry' } });
    await prisma.rolePermission.delete({ where: { roleId_permissionId: { roleId: context.role.id, permissionId: retryPermission.id } } });
    expect((await service.list(context.actor, {})).total).toBe(1);
    await expect(service.retry(context.actor, context.event.id, context.organization.id, randomUUID())).rejects.toMatchObject({ status: 403 });
    await expect(service.list({ ...context.actor, accountType: 'SUPPLIER' }, {})).rejects.toMatchObject({ status: 401 });
    await prisma.user.update({ where: { id: context.user.id }, data: { status: 'DISABLED' } });
    await expect(service.list(context.actor, {})).rejects.toMatchObject({ status: 401 });
  });

  it('rechecks permissions after waiting for the event row lock', async () => {
    const context = await fixture();
    let release!: () => void;
    let locked!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const acquired = new Promise<void>((resolve) => { locked = resolve; });
    const blocker = prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`SELECT id FROM outbox_events WHERE id = ${context.event.id}::uuid FOR UPDATE`;
      locked();
      await gate;
    }, { timeout: 15000 });
    await acquired;
    const retry = service.retry(context.actor, context.event.id, context.organization.id, randomUUID()).then((value) => ({ value }), (error: unknown) => ({ error }));
    try {
      const deadline = Date.now() + 5000;
      let waiting = false;
      while (!waiting && Date.now() < deadline) {
        const result = await prisma.$queryRaw<{ count: bigint }[]>`SELECT count(*) AS count FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND query LIKE '%outbox_events%' AND pid <> pg_backend_pid()`;
        waiting = Number(result[0]!.count) > 0;
        if (!waiting) await delay(20);
      }
      expect(waiting).toBe(true);
      const permission = await prisma.permission.findUniqueOrThrow({ where: { code: 'outbox:retry' } });
      await prisma.rolePermission.delete({ where: { roleId_permissionId: { roleId: context.role.id, permissionId: permission.id } } });
    } finally { release(); await blocker; }
    expect(await retry).toMatchObject({ error: { status: 403 } });
    expect(await prisma.outboxEvent.findUnique({ where: { id: context.event.id } })).toMatchObject({ status: 'FAILED', attempts: 5 });
  });

  it('enforces HTTP authentication, CSRF, UUID and bounded query contracts', async () => {
    const context = await fixture();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(PrismaService).useValue(prisma).compile();
    const app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init();
    try {
      const token = await app.get(SessionService).create(context.user.id, prisma, { mfaVerified: true, reauthenticated: true });
      const cookie = `qms_session=${token}; qms_csrf=test-csrf`;
      await request(app.getHttpServer()).get('/api/v1/outbox/failures').expect(401);
      await request(app.getHttpServer()).get('/api/v1/outbox/failures?pageSize=101').set('Cookie', cookie).expect(400);
      const result = await request(app.getHttpServer()).get('/api/v1/outbox/failures').set('Cookie', cookie).expect(200);
      expect(result.body.total).toBe(1);
      expect(JSON.stringify(result.body)).not.toMatch(/secret-db|payload|lastError/);
      await request(app.getHttpServer()).post(`/api/v1/outbox/failures/${context.event.id}/retry`).set('Cookie', cookie).expect(403);
      await request(app.getHttpServer()).post('/api/v1/outbox/failures/invalid/retry').set('Cookie', cookie).set('x-csrf-token', 'test-csrf').expect(400);
      await request(app.getHttpServer()).post(`/api/v1/outbox/failures/${context.event.id}/retry`).set('Cookie', cookie).set('x-csrf-token', 'test-csrf').expect(201);
      await request(app.getHttpServer()).post(`/api/v1/outbox/failures/${context.event.id}/retry`).set('Cookie', cookie).set('x-csrf-token', 'test-csrf').expect(409);
    } finally { await app.close(); }
  });
});
