import { randomUUID } from 'node:crypto';
import { Test, type TestingModule } from '@nestjs/testing';
import { DatabaseModule } from '../../src/database/database.module.js';
import { PrismaService } from '../../src/database/prisma.service.js';
import { AuditLogService } from '../../src/modules/audit-log/audit-log.service.js';
import { OutboxService } from '../../src/modules/task-notification/outbox.service.js';
import { TaskNotificationModule } from '../../src/modules/task-notification/task-notification.module.js';
import { OUTBOX_HANDLER, OutboxWorkerService, runConfiguredWorker, type OutboxHandler } from '../../src/modules/task-notification/outbox-worker.service.js';
import { WorkflowRuntimeService, type WorkflowActionResult } from '../../src/modules/workflow/workflow-runtime.service.js';
import { WorkflowDefinitionService } from '../../src/modules/workflow/workflow-definition.service.js';
import { WorkflowValidationService } from '../../src/modules/workflow/workflow-validation.service.js';
import { ProblemIndexService } from '../../src/modules/problem-index/problem-index.service.js';
import { NumberingService } from '../../src/modules/problem-index/numbering.service.js';
import type { WorkflowAction } from '../../src/modules/workflow/workflow.types.js';
import { OUTBOX_LEASE_MS, type AtomicOutboxHandler } from '../../src/modules/task-notification/outbox-worker.service.js';
import type { Prisma } from '../../src/generated/prisma/client.js';

if (!process.env.DATABASE_URL) throw new Error('Real PostgreSQL DATABASE_URL is required for workflow projection.');

describe('workflow task projection on PostgreSQL', () => {
  let module: TestingModule;
  let prisma: PrismaService;
  let runtime: WorkflowRuntimeService;
  let worker: OutboxWorkerService;
  let handler: OutboxHandler | null;
  const organizationIds: string[] = [];
  const extraEventIds: string[] = [];

  beforeAll(async () => {
    module = await Test.createTestingModule({ imports: [DatabaseModule, TaskNotificationModule] }).compile();
    await module.init();
    prisma = module.get(PrismaService);
    worker = module.get(OutboxWorkerService);
    handler = module.get(OUTBOX_HANDLER);
    const audit = new AuditLogService(prisma);
    const outbox = new OutboxService(prisma);
    const problems = new ProblemIndexService(prisma, new NumberingService(prisma), audit, outbox);
    runtime = new WorkflowRuntimeService(prisma, audit, outbox, problems);
  });
  afterAll(async () => module?.close());
  beforeEach(async () => {
    if (!handler || typeof handler === 'function') return;
    await prisma.outboxEvent.updateMany({
      where: { status: 'PENDING', eventType: { in: handler.eventTypes } },
      data: { availableAt: new Date(Date.now() + 86_400_000) },
    });
    await prisma.outboxEvent.updateMany({
      where: { status: 'PROCESSING', eventType: { in: handler.eventTypes } },
      data: { processingAt: new Date(Date.now() + 86_400_000) },
    });
  });
  afterEach(async () => {
    const instances = await prisma.workflowInstance.findMany({ where: { organizationId: { in: organizationIds } }, select: { id: true } });
    const tasks = await prisma.workflowTask.findMany({ where: { organizationId: { in: organizationIds } }, select: { id: true } });
    await prisma.outboxEvent.deleteMany({ where: { OR: [{ aggregateId: { in: [...instances, ...tasks].map((record) => record.id) } }, { id: { in: extraEventIds } }] } });
  });

  async function fixture(exactAssignment = false) {
    const organization = await prisma.organization.create({ data: { code: randomUUID(), name: 'Projection fixture', type: 'INTERNAL' } });
    organizationIds.push(organization.id);
    const user = await prisma.user.create({ data: { organizationId: organization.id, username: randomUUID(), passwordHash: 'not-a-login-fixture', accountType: 'INTERNAL' } });
    const role = await prisma.role.create({ data: { organizationId: organization.id, code: 'HANDLER', name: 'Handler' } });
    for (const code of ['workflow:start', 'workflow:act']) {
      const permission = await prisma.permission.upsert({ where: { code }, create: { code, name: code }, update: {} });
      await prisma.rolePermission.create({ data: { roleId: role.id, permissionId: permission.id } });
    }
    await prisma.userRole.create({ data: { userId: user.id, roleId: role.id, organizationId: organization.id } });
    const definitions = new WorkflowDefinitionService(prisma, new WorkflowValidationService(), new AuditLogService(prisma));
    const definition = await definitions.createDraft({ organizationId: organization.id, userId: user.id, code: randomUUID(), name: 'Projection flow', draft: {
      nodes: [
        { id: 'handle', name: 'Handle', type: 'ACTION', config: { isStart: true, slaMinutes: 60, assignment: { roleCode: 'HANDLER', ...(exactAssignment ? { assigneeUserId: user.id, permission: 'workflow:start' } : {}) } } },
        { id: 'close', name: 'Close', type: 'CLOSE', config: { isEnd: true, assignment: { roleCode: 'HANDLER' } } },
      ],
      transitions: [
        { id: 'submit', from: 'handle', to: 'close' },
        { id: 'return', from: 'close', to: 'handle', action: 'RETURN' },
        { id: 'reopen', from: 'close', to: 'handle', action: 'REOPEN' },
      ],
    } });
    const version = await definitions.publishVersion({ organizationId: organization.id, userId: user.id, definitionId: String(definition.id) });
    const nodes = await prisma.workflowNode.findMany({ where: { workflowVersionId: String(version.id) } });
    const problem = await prisma.problemIndex.create({ data: { organizationId: organization.id, reportNumber: randomUUID(), domainCode: 'neutral-test', problemType: 'test', sourceType: 'neutral', severity: 'LOW' } });
    const command = { organizationId: organization.id, actor: { id: user.id, organizationId: organization.id, accountType: 'INTERNAL' as const }, problemIndexId: problem.id, workflowVersionId: String(version.id), idempotencyKey: randomUUID(), traceId: randomUUID() };
    const started = await runtime.startInstance({ ...command, workflowDefinitionId: String(definition.id), instanceKey: problem.id, expectedProblemVersion: 1 });
    const action = (result: WorkflowActionResult, action: WorkflowAction) => runtime.submitAction({ ...command, idempotencyKey: randomUUID(), instanceId: result.instanceId, currentNodeId: result.currentNodeId, expectedVersion: result.version, expectedProblemVersion: result.problemVersion, action });
    return { organization, user, role, nodes, version, problem, started, action };
  }

  it('projects real runtime start, action and close through the configured worker', async () => {
    const context = await fixture();
    await runConfiguredWorker(worker, handler);
    expect(await prisma.workflowTask.count({ where: { workflowInstanceId: context.started.instanceId } })).toBe(1);
    expect(await prisma.notification.findMany({ where: { organizationId: context.organization.id } })).toEqual([expect.objectContaining({ status: 'DELIVERED', recipientUserId: context.user.id })]);
    const submitted = await context.action(context.started, 'SUBMIT');
    await runConfiguredWorker(worker, handler);
    expect(await prisma.workflowTask.count({ where: { workflowInstanceId: context.started.instanceId, status: 'COMPLETED' } })).toBe(1);
    await context.action(submitted, 'CLOSE');
    await runConfiguredWorker(worker, handler);
    expect(await prisma.workflowTask.count({ where: { workflowInstanceId: context.started.instanceId, status: 'COMPLETED' } })).toBe(2);
    expect(await prisma.workflowTask.count({ where: { workflowInstanceId: context.started.instanceId, status: 'PENDING' } })).toBe(0);
  });

  function atomicHandler(): AtomicOutboxHandler {
    if (!handler || typeof handler === 'function') throw new Error('Atomic workflow handler required');
    return handler;
  }

  async function eventFor(instanceId: string, version = 1) {
    return prisma.outboxEvent.findUniqueOrThrow({ where: { eventKey: `workflow:${instanceId}:${version}` } });
  }

  it('preserves separate return and reopen rounds and tolerates duplicate delivery', async () => {
    const context = await fixture();
    await runConfiguredWorker(worker, handler);
    let current = context.started;
    for (const action of ['SUBMIT', 'RETURN', 'SUBMIT', 'CLOSE', 'REOPEN'] as const) {
      current = await context.action(current, action);
      await runConfiguredWorker(worker, handler);
    }
    const tasks = await prisma.workflowTask.findMany({ where: { workflowInstanceId: current.instanceId }, orderBy: { entryInstanceVersion: 'asc' } });
    expect(tasks.map((task) => task.entryInstanceVersion)).toEqual([1, 2, 3, 4, 6]);
    expect(tasks.filter((task) => task.status === 'PENDING').map((task) => task.entryInstanceVersion)).toEqual([6]);
    const oldEvent = await eventFor(current.instanceId);
    await prisma.outboxEvent.update({ where: { id: oldEvent.id }, data: { status: 'PENDING', processedAt: null } });
    await runConfiguredWorker(worker, handler);
    expect(await prisma.workflowTask.count({ where: { workflowInstanceId: current.instanceId } })).toBe(5);
    expect(await prisma.notification.count({ where: { organizationId: context.organization.id } })).toBe(5);
  });

  it('defers v3 before v1 and v2 without failed attempts or obsolete notifications', async () => {
    const context = await fixture();
    const second = await context.action(context.started, 'SUBMIT');
    await context.action(second, 'RETURN');
    const latest = await eventFor(second.instanceId, 3);
    const future = new Date(Date.now() + 60_000);
    await prisma.outboxEvent.updateMany({ where: { aggregateId: second.instanceId, id: { not: latest.id } }, data: { availableAt: future } });
    expect(await worker.processAtomicDue(1, atomicHandler())).toEqual({ processed: 0, retried: 0, failed: 0 });
    expect(await eventFor(second.instanceId, 3)).toMatchObject({ status: 'PENDING', attempts: 0, processingAt: null });
    for (const version of [1, 2, 3]) {
      const event = await eventFor(second.instanceId, version);
      await prisma.outboxEvent.update({ where: { id: event.id }, data: { availableAt: new Date(0) } });
      await worker.processAtomicDue(1, atomicHandler());
    }
    expect(await prisma.workflowInstance.findUnique({ where: { id: second.instanceId } })).toMatchObject({ version: 3, taskProjectionVersion: 3 });
    expect(await prisma.workflowTask.count({ where: { workflowInstanceId: second.instanceId } })).toBe(3);
    expect(await prisma.notification.count({ where: { organizationId: context.organization.id } })).toBe(1);
  });

  it('keeps unsupported problem events pending', async () => {
    const event = await prisma.outboxEvent.create({ data: { eventKey: randomUUID(), aggregateType: 'ProblemIndex', aggregateId: randomUUID(), eventType: 'PROBLEM_INDEX_CREATED', payload: {} } });
    extraEventIds.push(event.id);
    await runConfiguredWorker(worker, handler);
    expect(await prisma.outboxEvent.findUnique({ where: { id: event.id } })).toMatchObject({ status: 'PENDING', attempts: 0, processingAt: null });
  });

  it('uses event time for SLA and keeps missing SLA null', async () => {
    const context = await fixture();
    const event = await eventFor(context.started.instanceId);
    const enteredAt = new Date(Date.now() - 5 * 60 * 60_000);
    await prisma.outboxEvent.update({ where: { id: event.id }, data: { createdAt: enteredAt } });
    await runConfiguredWorker(worker, handler);
    expect(await prisma.workflowTask.findFirst({ where: { workflowInstanceId: context.started.instanceId } })).toMatchObject({ enteredAt, dueAt: new Date(enteredAt.getTime() + 60 * 60_000) });
    await context.action(context.started, 'SUBMIT');
    await runConfiguredWorker(worker, handler);
    expect(await prisma.workflowTask.findFirst({ where: { workflowInstanceId: context.started.instanceId, entryInstanceVersion: 2 } })).toMatchObject({ dueAt: null });
  });

  it('lets competing workers commit a single shared task and notifications', async () => {
    const context = await fixture();
    const secondUser = await prisma.user.create({ data: { organizationId: context.organization.id, username: randomUUID(), passwordHash: 'fixture', accountType: 'INTERNAL' } });
    await prisma.userRole.create({ data: { userId: secondUser.id, organizationId: context.organization.id, roleId: context.role.id } });
    const results = await Promise.all([worker.processAtomicDue(1, atomicHandler()), new OutboxWorkerService(prisma).processAtomicDue(1, atomicHandler())]);
    expect(results.reduce((sum, result) => sum + result.processed, 0)).toBe(1);
    expect(await prisma.workflowTask.count({ where: { workflowInstanceId: context.started.instanceId } })).toBe(1);
    expect(await prisma.notification.count({ where: { organizationId: context.organization.id } })).toBe(2);
  });

  it.each(['disabled', 'organization-disabled', 'role', 'permission', 'extra-permission', 'organization', 'exact-user'] as const)('requires all current recipient rules: %s', async (rule) => {
    const context = await fixture(true);
    if (rule === 'disabled') await prisma.user.update({ where: { id: context.user.id }, data: { status: 'DISABLED' } });
    if (rule === 'organization-disabled') await prisma.organization.update({ where: { id: context.organization.id }, data: { status: 'DISABLED' } });
    if (rule === 'role') await prisma.role.update({ where: { id: context.role.id }, data: { code: 'OTHER' } });
    if (rule === 'permission' || rule === 'extra-permission') {
      const permission = await prisma.permission.findUniqueOrThrow({ where: { code: rule === 'permission' ? 'workflow:act' : 'workflow:start' } });
      await prisma.rolePermission.delete({ where: { roleId_permissionId: { roleId: context.role.id, permissionId: permission.id } } });
    }
    if (rule === 'organization' || rule === 'exact-user') {
      await prisma.user.update({ where: { id: context.user.id }, data: { status: 'DISABLED' } });
      const organizationId = rule === 'organization'
        ? (await prisma.organization.create({ data: { code: randomUUID(), name: 'Foreign organization', type: 'SUPPLIER' } })).id
        : context.organization.id;
      const other = await prisma.user.create({ data: { organizationId, username: randomUUID(), passwordHash: 'fixture', accountType: rule === 'organization' ? 'SUPPLIER' : 'INTERNAL' } });
      await prisma.userRole.create({ data: { userId: other.id, roleId: context.role.id, organizationId: context.organization.id } });
    }
    await runConfiguredWorker(worker, handler);
    expect(await eventFor(context.started.instanceId)).toMatchObject({ status: 'PROCESSED' });
    expect(await prisma.workflowTask.count({ where: { workflowInstanceId: context.started.instanceId } })).toBe(1);
    expect(await prisma.notification.count({ where: { organizationId: context.organization.id } })).toBe(0);
  });

  it('accepts a recipient satisfying exact user, role and additional permission together', async () => {
    const context = await fixture(true);
    await runConfiguredWorker(worker, handler);
    expect(await prisma.notification.count({ where: { organizationId: context.organization.id, recipientUserId: context.user.id } })).toBe(1);
  });

  it.each(['schemaVersion', 'instanceVersion', 'organizationId', 'problemIndexId', 'workflowVersionId', 'currentNodeId', 'eventKey', 'aggregateType', 'aggregateId'] as const)('rejects an inconsistent event %s', async (field) => {
    const context = await fixture();
    const event = await eventFor(context.started.instanceId);
    const payload = event.payload as Prisma.JsonObject;
    const replacement = field === 'schemaVersion' ? 2 : field === 'instanceVersion' ? '1' : randomUUID();
    const data = ['eventKey', 'aggregateType', 'aggregateId'].includes(field)
      ? { [field]: replacement }
      : { payload: { ...payload, [field]: replacement } as Prisma.InputJsonObject };
    await prisma.outboxEvent.update({ where: { id: event.id }, data });
    extraEventIds.push(event.id);
    expect(await worker.processAtomicDue(1, atomicHandler())).toMatchObject({ retried: 1, processed: 0 });
    expect(await prisma.workflowTask.count({ where: { workflowInstanceId: context.started.instanceId } })).toBe(0);
    expect(await prisma.outboxEvent.findUnique({ where: { id: event.id } })).toMatchObject({ lastError: 'WORKFLOW_EVENT_INVALID', attempts: 1 });
  });

  it('rolls back task, notification and cursor if the handler fails and retries at 1/2/4/8 seconds', async () => {
    const context = await fixture();
    let now = new Date(Date.now() + 100);
    const timedWorker = new OutboxWorkerService(prisma, () => now);
    const failing: AtomicOutboxHandler = { eventTypes: atomicHandler().eventTypes, handle: async (tx, event) => { await atomicHandler().handle(tx, event); throw new Error('projection fault'); } };
    for (const attempt of [1, 2, 3, 4, 5]) {
      const result = await timedWorker.processAtomicDue(1, failing);
      expect(result).toMatchObject(attempt === 5 ? { failed: 1 } : { retried: 1 });
      const event = await eventFor(context.started.instanceId);
      expect(event.attempts).toBe(attempt);
      if (attempt < 5) {
        expect(event.availableAt.getTime() - now.getTime()).toBe(1000 * 2 ** (attempt - 1));
        now = event.availableAt;
      }
    }
    expect(await prisma.workflowTask.count({ where: { workflowInstanceId: context.started.instanceId } })).toBe(0);
    expect(await prisma.notification.count({ where: { organizationId: context.organization.id } })).toBe(0);
    expect(await prisma.workflowInstance.findUnique({ where: { id: context.started.instanceId } })).toMatchObject({ taskProjectionVersion: 0 });
    await timedWorker.retryFailed((await eventFor(context.started.instanceId)).id);
    expect(await timedWorker.processAtomicDue(1, atomicHandler())).toMatchObject({ processed: 1 });
  });

  it('rolls back the projection when the PROCESSED write fails', async () => {
    const context = await fixture();
    const event = await eventFor(context.started.instanceId);
    const functionName = `fail_projection_${randomUUID().replaceAll('-', '')}`;
    await prisma.$executeRawUnsafe(`CREATE FUNCTION ${functionName}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.id = '${event.id}'::uuid AND NEW.status = 'PROCESSED' THEN RAISE EXCEPTION 'completion fault'; END IF; RETURN NEW; END $$`);
    await prisma.$executeRawUnsafe(`CREATE TRIGGER ${functionName} BEFORE UPDATE ON outbox_events FOR EACH ROW EXECUTE FUNCTION ${functionName}()`);
    try {
      expect(await worker.processAtomicDue(1, atomicHandler())).toMatchObject({ retried: 1, processed: 0 });
      expect(await prisma.workflowTask.count({ where: { workflowInstanceId: context.started.instanceId } })).toBe(0);
      expect(await prisma.notification.count({ where: { organizationId: context.organization.id } })).toBe(0);
      expect(await prisma.workflowInstance.findUnique({ where: { id: context.started.instanceId } })).toMatchObject({ taskProjectionVersion: 0 });
      expect(await eventFor(context.started.instanceId)).toMatchObject({ status: 'PENDING', attempts: 1 });
    } finally {
      await prisma.$executeRawUnsafe(`DROP TRIGGER ${functionName} ON outbox_events`);
      await prisma.$executeRawUnsafe(`DROP FUNCTION ${functionName}()`);
    }
  });

  it.each([false, true])('rejects an expired lease before side effects, reclaimed=%s', async (reclaimed) => {
    const context = await fixture();
    let now = new Date(Date.now() + 100);
    let interceptClaim = true;
    const client = new Proxy(prisma, { get(target, property) {
      if (property !== '$transaction') return Reflect.get(target, property);
      return async (work: (tx: Prisma.TransactionClient) => Promise<unknown>) => {
        const result = await target.$transaction(work);
        if (interceptClaim && Array.isArray(result)) {
          interceptClaim = false;
          now = new Date(now.getTime() + OUTBOX_LEASE_MS);
          if (reclaimed) expect(await new OutboxWorkerService(prisma, () => now).processAtomicDue(1, atomicHandler())).toMatchObject({ processed: 1 });
        }
        return result;
      };
    } });
    expect(await new OutboxWorkerService(client, () => now).processAtomicDue(1, atomicHandler())).toEqual({ processed: 0, failed: 0, retried: 0 });
    expect(await prisma.workflowTask.count({ where: { workflowInstanceId: context.started.instanceId } })).toBe(reclaimed ? 1 : 0);
    if (!reclaimed) expect(await new OutboxWorkerService(prisma, () => now).processAtomicDue(1, atomicHandler())).toMatchObject({ processed: 1 });
    expect(await prisma.notification.count({ where: { organizationId: context.organization.id } })).toBe(1);
  });

  it('rolls back writes when processing outlasts its lease', async () => {
    const context = await fixture();
    let now = new Date(Date.now() + 100);
    const slowHandler: AtomicOutboxHandler = { eventTypes: atomicHandler().eventTypes, handle: async (tx, event) => {
      await atomicHandler().handle(tx, event);
      now = new Date(now.getTime() + OUTBOX_LEASE_MS);
    } };
    expect(await new OutboxWorkerService(prisma, () => now).processAtomicDue(1, slowHandler)).toEqual({ processed: 0, retried: 0, failed: 0 });
    expect(await prisma.workflowTask.count({ where: { workflowInstanceId: context.started.instanceId } })).toBe(0);
    expect(await eventFor(context.started.instanceId)).toMatchObject({ status: 'PROCESSING', attempts: 0 });
    expect(await new OutboxWorkerService(prisma, () => now).processAtomicDue(1, atomicHandler())).toMatchObject({ processed: 1 });
  });

  it('allows explicit Prisma task creation but rejects version and organization mismatches', async () => {
    const context = await fixture();
    const other = await fixture();
    const data = { organizationId: context.organization.id, workflowVersionId: context.started.workflowVersionId, workflowInstanceId: context.started.instanceId, workflowNodeId: context.started.currentNodeId };
    const legacy = await prisma.workflowTask.create({ data });
    const migrated = await prisma.workflowTask.create({ data: { ...data, entryInstanceVersion: -1 } });
    expect(legacy.entryInstanceVersion).toBe(0);
    await expect(prisma.workflowTask.create({ data: { ...data, entryInstanceVersion: -2, workflowNodeId: other.started.currentNodeId } })).rejects.toMatchObject({ code: 'P2003' });
    await expect(prisma.workflowTask.create({ data: { ...data, entryInstanceVersion: -2, organizationId: other.organization.id } })).rejects.toMatchObject({ code: 'P2003' });
    await runConfiguredWorker(worker, handler);
    expect(await prisma.workflowTask.findUnique({ where: { id: legacy.id } })).toMatchObject({ status: 'COMPLETED', entryInstanceVersion: 0 });
    expect(await prisma.workflowTask.findUnique({ where: { id: migrated.id } })).toMatchObject({ status: 'COMPLETED', entryInstanceVersion: -1 });
    expect(await prisma.workflowTask.count({ where: { workflowInstanceId: context.started.instanceId } })).toBe(3);
  });
});
