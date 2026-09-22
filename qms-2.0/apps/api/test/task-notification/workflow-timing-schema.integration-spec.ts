import { Test, type TestingModule } from '@nestjs/testing';
import { DatabaseModule } from '../../src/database/database.module.js';
import { PrismaService } from '../../src/database/prisma.service.js';
import { TaskNotificationModule } from '../../src/modules/task-notification/task-notification.module.js';
import { OUTBOX_HANDLER, OutboxWorkerService, type AtomicOutboxHandler } from '../../src/modules/task-notification/outbox-worker.service.js';
import { clearTimingEvents, timingFixture } from './workflow-timing-fixture.js';
import { randomUUID } from 'node:crypto';
import type { Prisma } from '../../src/generated/prisma/client.js';

if (!process.env.DATABASE_URL) throw new Error('Real PostgreSQL DATABASE_URL is required for workflow timing.');

describe('workflow timing on PostgreSQL', () => {
  let module: TestingModule;
  let prisma: PrismaService;
  let handler: AtomicOutboxHandler;
  let now: Date;
  let worker: OutboxWorkerService;
  const organizations: string[] = [];

  beforeAll(async () => {
    module = await Test.createTestingModule({ imports: [DatabaseModule, TaskNotificationModule] }).compile();
    await module.init();
    prisma = module.get(PrismaService);
    handler = module.get(OUTBOX_HANDLER);
  });
  beforeEach(() => { now = new Date(Date.now() + 1000); worker = new OutboxWorkerService(prisma, () => now); });
  afterEach(() => clearTimingEvents(prisma, organizations));
  afterAll(async () => module?.close());

  async function fixture(config: Record<string, unknown> = {}) {
    const context = await timingFixture(prisma, organizations, config);
    now = new Date();
    return context;
  }

  async function projected(config: Record<string, unknown> = {}) {
    const context = await fixture(config);
    await worker.processAtomicDue(100, handler);
    const task = await prisma.workflowTask.findFirstOrThrow({ where: { workflowInstanceId: context.started.instanceId } });
    return { ...context, task };
  }

  it('schedules reminders before the deadline and only marks overdue at the deadline', async () => {
    const context = await projected();
    const events = await prisma.outboxEvent.findMany({ where: { aggregateId: context.task.id }, orderBy: { availableAt: 'asc' } });
    expect(events).toHaveLength(4);
    expect(events[0]!.availableAt.getTime()).toBe(context.task.dueAt!.getTime() - 10 * 60_000);
    now = new Date(context.task.dueAt!.getTime() - 10 * 60_000 - 1);
    await worker.processAtomicDue(100, handler);
    expect(await prisma.outboxEvent.findUnique({ where: { id: events[0]!.id } })).toMatchObject({ status: 'PENDING', processedAt: null });
    now = new Date(now.getTime() + 1);
    await worker.processAtomicDue(100, handler);
    expect(await prisma.outboxEvent.findUnique({ where: { id: events[0]!.id } })).toMatchObject({ status: 'PROCESSED' });
    expect(await prisma.notification.count({ where: { workflowTaskId: context.task.id } })).toBe(2);
    expect(await prisma.workflowTask.findUnique({ where: { id: context.task.id } })).toMatchObject({ status: 'PENDING', version: 1 });
    now = context.task.dueAt!;
    await worker.processAtomicDue(100, handler);
    expect(await prisma.outboxEvent.count({ where: { aggregateId: context.task.id, status: 'PROCESSED' } })).toBe(4);
    expect(await prisma.workflowTask.findUnique({ where: { id: context.task.id } })).toMatchObject({ status: 'OVERDUE', version: 2, assigneeUserId: null });
    expect(await prisma.notification.count({ where: { workflowTaskId: context.task.id, recipientUserId: context.user.id } })).toBe(3);
    expect(await prisma.notification.count({ where: { workflowTaskId: context.task.id, recipientUserId: context.manager.id } })).toBe(1);
    expect(await prisma.workflowInstance.findUnique({ where: { id: context.started.instanceId } })).toMatchObject({ version: 1, taskProjectionVersion: 1, currentNodeId: context.started.currentNodeId });
  });

  it('catches up each configured reminder once, preserves the assignee, and tolerates competing delivery', async () => {
    const context = await projected();
    await prisma.workflowTask.update({ where: { id: context.task.id }, data: { assigneeUserId: context.user.id, status: 'IN_PROGRESS' } });
    now = new Date(context.task.dueAt!.getTime() + 60_000);
    await Promise.all([worker.processAtomicDue(100, handler), new OutboxWorkerService(prisma, () => now).processAtomicDue(100, handler)]);
    expect(await prisma.outboxEvent.count({ where: { aggregateId: context.task.id, status: 'PROCESSED' } })).toBe(4);
    await prisma.outboxEvent.updateMany({ where: { aggregateId: context.task.id }, data: { status: 'PENDING', processedAt: null } });
    await worker.processAtomicDue(100, handler);
    expect(await prisma.outboxEvent.count({ where: { aggregateId: context.task.id, status: 'PROCESSED' } })).toBe(4);
    expect(await prisma.notification.count({ where: { workflowTaskId: context.task.id } })).toBe(4);
    expect(await prisma.workflowTask.findUnique({ where: { id: context.task.id } })).toMatchObject({ version: 2, status: 'OVERDUE', assigneeUserId: context.user.id });
  });

  it('does not schedule events without an SLA', async () => {
    const context = await projected({ slaMinutes: undefined, reminders: undefined, escalation: undefined });
    expect(await prisma.outboxEvent.count({ where: { aggregateId: context.task.id } })).toBe(0);
  });

  it('schedules a fresh deadline after return and only reminds the new round', async () => {
    const context = await projected();
    const submitted = await context.action(context.started, 'SUBMIT');
    await context.action(submitted, 'RETURN');
    now = new Date();
    for (const increment of [0, 1000, 1000]) {
      now = new Date(now.getTime() + increment);
      await worker.processAtomicDue(100, handler);
    }
    const current = await prisma.workflowTask.findFirstOrThrow({ where: { workflowInstanceId: context.started.instanceId, entryInstanceVersion: 3 } });
    expect(current.id).not.toBe(context.task.id);
    expect(current.dueAt!.getTime()).toBeGreaterThan(context.task.dueAt!.getTime());
    expect(await prisma.outboxEvent.count({ where: { aggregateId: current.id } })).toBe(4);
    now = current.dueAt!;
    await worker.processAtomicDue(100, handler);
    expect(await prisma.notification.count({ where: { workflowTaskId: context.task.id } })).toBe(1);
    expect(await prisma.notification.count({ where: { workflowTaskId: current.id } })).toBe(4);
  });

  it.each(['disabled', 'role', 'permission', 'organization', 'extra-permission', 'exact-user'] as const)('reevaluates escalation recipient constraints: %s', async (rule) => {
    const context = await projected();
    if (rule === 'disabled') await prisma.user.update({ where: { id: context.manager.id }, data: { status: 'DISABLED' } });
    if (rule === 'role') await prisma.role.update({ where: { id: context.managerRole.id }, data: { code: 'OTHER' } });
    if (rule === 'permission') await prisma.rolePermission.deleteMany({ where: { roleId: context.managerRole.id } });
    if (rule === 'organization') {
      const foreign = await prisma.organization.create({ data: { code: randomUUID(), name: 'Foreign supplier', type: 'SUPPLIER' } });
      await prisma.user.update({ where: { id: context.manager.id }, data: { organizationId: foreign.id, accountType: 'SUPPLIER' } });
    }
    if (rule === 'extra-permission' || rule === 'exact-user') {
      const node = await prisma.workflowNode.findUniqueOrThrow({ where: { id: context.started.currentNodeId } });
      const escalation = { roleCode: 'MANAGER', ...(rule === 'extra-permission' ? { permission: 'workflow:act' } : { assigneeUserId: context.user.id }) };
      await prisma.workflowNode.update({ where: { id: node.id }, data: { config: { ...node.config as Prisma.JsonObject, escalation } } });
    }
    now = context.task.dueAt!;
    await worker.processAtomicDue(100, handler);
    expect(await prisma.notification.count({ where: { workflowTaskId: context.task.id, recipientUserId: context.manager.id } })).toBe(0);
    expect(await prisma.workflowTask.findUnique({ where: { id: context.task.id } })).toMatchObject({ status: 'OVERDUE' });
  });

  it('reevaluates the original handler permission for reminders', async () => {
    const context = await projected();
    const permission = await prisma.permission.findUniqueOrThrow({ where: { code: 'workflow:act' } });
    await prisma.rolePermission.delete({ where: { roleId_permissionId: { roleId: context.role.id, permissionId: permission.id } } });
    now = context.task.dueAt!;
    await worker.processAtomicDue(100, handler);
    expect(await prisma.notification.count({ where: { workflowTaskId: context.task.id, recipientUserId: context.user.id } })).toBe(1);
    expect(await prisma.notification.count({ where: { workflowTaskId: context.task.id, recipientUserId: context.manager.id } })).toBe(1);
  });

  it('does not create reminders or escalation notifications after the organization is disabled', async () => {
    const context = await projected();
    const before = await prisma.notification.count({ where: { workflowTaskId: context.task.id } });
    expect(before).toBe(1);
    await prisma.organization.update({ where: { id: context.organization.id }, data: { status: 'DISABLED' } });
    now = context.task.dueAt!;
    await worker.processAtomicDue(100, handler);
    expect(await prisma.notification.count({ where: { workflowTaskId: context.task.id } })).toBe(before);
    expect(await prisma.notification.count({ where: { workflowTaskId: context.task.id, recipientUserId: context.manager.id } })).toBe(0);
  });

  it.each(['advanced', 'closed', 'returned', 'reopened', 'cancelled', 'archived-at', 'archived-status', 'closed-index', 'detached'] as const)('silently acknowledges obsolete timing events: %s', async (state) => {
    const context = await projected();
    if (['advanced', 'closed', 'returned', 'reopened'].includes(state)) {
      const submitted = await context.action(context.started, 'SUBMIT');
      if (state === 'returned') await context.action(submitted, 'RETURN');
      if (state === 'closed' || state === 'reopened') {
        const closed = await context.action(submitted, 'CLOSE');
        if (state === 'reopened') await context.action(closed, 'REOPEN');
      }
    }
    if (state === 'cancelled') await prisma.workflowTask.update({ where: { id: context.task.id }, data: { status: 'CANCELLED' } });
    if (state === 'archived-at') await prisma.problemIndex.update({ where: { id: context.problem.id }, data: { archivedAt: new Date() } });
    if (state === 'archived-status') await prisma.problemIndex.update({ where: { id: context.problem.id }, data: { status: 'ARCHIVED' } });
    if (state === 'closed-index') await prisma.problemIndex.update({ where: { id: context.problem.id }, data: { status: 'CLOSED' } });
    if (state === 'detached') await prisma.problemIndex.update({ where: { id: context.problem.id }, data: { workflowInstanceId: null } });
    now = context.task.dueAt!;
    const timingOnly: AtomicOutboxHandler = { eventTypes: handler.eventTypes.filter((type) => type.startsWith('WORKFLOW_TASK_')), handle: (tx, event) => handler.handle(tx, event) };
    await worker.processAtomicDue(100, timingOnly);
    expect(await prisma.outboxEvent.count({ where: { aggregateId: context.task.id, status: 'PROCESSED' } })).toBe(4);
    expect(await prisma.notification.count({ where: { workflowTaskId: context.task.id } })).toBe(1);
    expect(await prisma.workflowTask.findUnique({ where: { id: context.task.id } })).toMatchObject({ version: 1, status: state === 'cancelled' ? 'CANCELLED' : 'PENDING' });
  });

  it.each(['archivedAt', 'status', 'closed'] as const)('suppresses the initial live notification for inactive problem %s', async (field) => {
    const context = await fixture();
    await prisma.problemIndex.update({ where: { id: context.problem.id }, data: field === 'closed' ? { status: 'CLOSED' } : field === 'status' ? { status: 'ARCHIVED' } : { archivedAt: new Date() } });
    await worker.processAtomicDue(100, handler);
    expect(await prisma.workflowTask.count({ where: { workflowInstanceId: context.started.instanceId } })).toBe(1);
    expect(await prisma.notification.count({ where: { organizationId: context.organization.id } })).toBe(0);
  });

  it.each(['taskId', 'organizationId', 'instanceId', 'workflowVersionId', 'nodeId', 'entryInstanceVersion', 'scheduledAt', 'eventKey'] as const)('rejects inconsistent timing identity or plan: %s', async (field) => {
    const context = await projected();
    const event = await prisma.outboxEvent.findFirstOrThrow({ where: { aggregateId: context.task.id, eventType: 'WORKFLOW_TASK_OVERDUE' } });
    const value = field === 'entryInstanceVersion' ? 2 : field === 'scheduledAt' ? new Date(0).toISOString() : randomUUID();
    await prisma.outboxEvent.update({ where: { id: event.id }, data: field === 'eventKey' ? { eventKey: String(value) } : { payload: { ...event.payload as Prisma.JsonObject, [field]: value } } });
    now = context.task.dueAt!;
    const overdueOnly: AtomicOutboxHandler = { eventTypes: ['WORKFLOW_TASK_OVERDUE'], handle: (tx, claimed) => handler.handle(tx, claimed) };
    await worker.processAtomicDue(100, overdueOnly);
    expect(await prisma.workflowTask.findUnique({ where: { id: context.task.id } })).toMatchObject({ status: 'PENDING', version: 1 });
    expect(await prisma.outboxEvent.findUnique({ where: { id: event.id } })).toMatchObject({ status: 'PENDING', attempts: 1, lastError: 'WORKFLOW_TIMING_EVENT_INVALID' });
  });

  it('defers a valid event with tampered early availableAt while another aggregate is processed', async () => {
    const context = await projected();
    await prisma.outboxEvent.updateMany({ where: { aggregateId: context.task.id }, data: { availableAt: new Date(0) } });
    const other = await fixture({ slaMinutes: undefined, reminders: undefined, escalation: undefined });
    await worker.processAtomicDue(100, handler);
    expect(await prisma.workflowTask.count({ where: { workflowInstanceId: other.started.instanceId } })).toBe(1);
    const deferred = await prisma.outboxEvent.findMany({ where: { aggregateId: context.task.id } });
    expect(deferred).toHaveLength(4);
    expect(deferred.every((event) => event.status === 'PENDING' && event.processedAt === null && event.availableAt > now)).toBe(true);
    expect(await prisma.notification.count({ where: { workflowTaskId: context.task.id } })).toBe(1);
  });

  it.each(['WORKFLOW_TASK_REMINDER', 'WORKFLOW_TASK_OVERDUE'] as const)('rolls back %s effects if acknowledgement fails', async (eventType) => {
    const context = await projected();
    const event = await prisma.outboxEvent.findFirstOrThrow({ where: { aggregateId: context.task.id, eventType } });
    now = context.task.dueAt!;
    const functionName = `fail_timing_${randomUUID().replaceAll('-', '')}`;
    await prisma.$executeRawUnsafe(`CREATE FUNCTION ${functionName}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.id = '${event.id}'::uuid AND NEW.status = 'PROCESSED' THEN RAISE EXCEPTION 'timing ack fault'; END IF; RETURN NEW; END $$`);
    await prisma.$executeRawUnsafe(`CREATE TRIGGER ${functionName} BEFORE UPDATE ON outbox_events FOR EACH ROW EXECUTE FUNCTION ${functionName}()`);
    try {
      const only: AtomicOutboxHandler = { eventTypes: [eventType], handle: (tx, claimed) => handler.handle(tx, claimed) };
      await worker.processAtomicDue(100, only);
      const retried = await prisma.outboxEvent.findUniqueOrThrow({ where: { id: event.id } });
      expect(retried).toMatchObject({ status: 'PENDING', attempts: 1 });
      expect(retried.lastError).toContain('timing ack fault');
      expect(await prisma.notification.count({ where: { deduplicationKey: `${event.eventKey}:${context.user.id}` } })).toBe(0);
      expect(await prisma.workflowTask.findUnique({ where: { id: context.task.id } })).toMatchObject({ status: 'PENDING', version: 1 });
    } finally {
      await prisma.$executeRawUnsafe(`DROP TRIGGER ${functionName} ON outbox_events`);
      await prisma.$executeRawUnsafe(`DROP FUNCTION ${functionName}()`);
    }
  });

  it('rolls back delayed schedules with the originating projection transaction', async () => {
    const context = await fixture();
    const event = await prisma.outboxEvent.findUniqueOrThrow({ where: { eventKey: `workflow:${context.started.instanceId}:1` } });
    const failing: AtomicOutboxHandler = { eventTypes: handler.eventTypes, handle: async (tx, event) => { await handler.handle(tx, event); throw new Error('schedule rollback'); } };
    await worker.processAtomicDue(100, failing);
    expect(await prisma.outboxEvent.findUnique({ where: { id: event.id } })).toMatchObject({ status: 'PENDING', attempts: 1, lastError: 'schedule rollback' });
    expect(await prisma.workflowTask.count({ where: { workflowInstanceId: context.started.instanceId } })).toBe(0);
    expect(await prisma.outboxEvent.count({ where: { aggregateType: 'WorkflowTask', payload: { path: ['instanceId'], equals: context.started.instanceId } } })).toBe(0);
  });
});
