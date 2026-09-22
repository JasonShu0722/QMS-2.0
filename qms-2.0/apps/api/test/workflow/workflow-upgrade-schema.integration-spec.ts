import { createHash, randomUUID } from 'node:crypto';
import { PrismaService } from '../../src/database/prisma.service.js';
import { timingFixture, clearTimingEvents } from '../task-notification/workflow-timing-fixture.js';
import { WorkflowUpgradeService } from '../../src/modules/workflow/workflow-upgrade.service.js';
import { WorkflowUpgradeRegistry } from '../../src/modules/workflow/workflow-upgrade.registry.js';
import { AuditLogService } from '../../src/modules/audit-log/audit-log.service.js';
import { OutboxService } from '../../src/modules/task-notification/outbox.service.js';
import { ProblemIndexService } from '../../src/modules/problem-index/problem-index.service.js';
import { NumberingService } from '../../src/modules/problem-index/numbering.service.js';
import { NeutralUpgradeAdapter, prepareUpgradeTestSchema, upgradeFixture } from './workflow-upgrade-fixture.js';
import { WorkflowEventHandler } from '../../src/modules/task-notification/workflow-event.handler.js';
import { OutboxWorkerService } from '../../src/modules/task-notification/outbox-worker.service.js';
import { OutboxAdministrationService } from '../../src/modules/task-notification/outbox-administration.service.js';
import { workflowCapabilities } from '../../src/modules/workflow/workflow-capabilities.js';
import { Prisma } from '../../src/generated/prisma/client.js';
import { TaskService } from '../../src/modules/task-notification/task.service.js';
import { NotificationService } from '../../src/modules/task-notification/notification.service.js';
import { WorkflowRuntimeService } from '../../src/modules/workflow/workflow-runtime.service.js';
import { FileLifecycleService } from '../../src/modules/file-management/file-lifecycle.service.js';
import { FilePolicyService } from '../../src/modules/file-management/file-policy.service.js';
import { FileResourceAccess } from '../../src/modules/file-management/file-resource-access.js';
import { S3CompatibleObjectStorage } from '../../src/modules/file-management/object-storage.service.js';
import { FileScanWorkerService } from '../../src/modules/file-management/file-scan-worker.service.js';
import { FileScannerService } from '../../src/modules/file-management/file-scanner.service.js';
import { FileVerificationService } from '../../src/modules/file-management/file-verification.service.js';
import { NeutralFileResourceAdapter } from '../file-management/file-fixture.js';
import { Test } from '@nestjs/testing';
import { ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../../src/app.module.js';
import { GlobalExceptionFilter } from '../../src/common/contracts/global-exception.filter.js';
import { SessionService } from '../../src/modules/identity/session.service.js';
import { WORKFLOW_UPGRADE_ADAPTERS } from '../../src/modules/workflow/workflow-upgrade.registry.js';

if (!process.env.DATABASE_URL) throw new Error('Workflow upgrade requires real PostgreSQL');

describe('workflow upgrade and immutable problem history', () => {
  const prisma = new PrismaService();
  const organizations: string[] = [];
  const audit = new AuditLogService(prisma);
  const outbox = new OutboxService(prisma);
  const problems = new ProblemIndexService(prisma, new NumberingService(prisma), audit, outbox);
  const service = new WorkflowUpgradeService(prisma, audit, outbox, problems, new WorkflowUpgradeRegistry([new NeutralUpgradeAdapter()]));
  const runtime = new WorkflowRuntimeService(prisma, audit, outbox, problems);
  const tasks = new TaskService(prisma, audit);
  const notifications = new NotificationService(prisma, audit);
  const worker = () => new OutboxWorkerService(prisma, () => new Date(Date.now() + 1000));
  const handler = new WorkflowEventHandler();
  beforeAll(async () => { await prisma.$connect(); await prepareUpgradeTestSchema(prisma); });
  afterEach(async () => {
    await clearTimingEvents(prisma, organizations);
    const files = await prisma.fileObject.findMany({ where: { organizationId: { in: organizations } }, select: { id: true } });
    await prisma.outboxEvent.deleteMany({ where: { aggregateType: 'FileObject', aggregateId: { in: files.map((file) => file.id) } } });
  });
  afterAll(() => prisma.$disconnect());

  async function projected() {
    const context = await upgradeFixture(prisma, organizations);
    await worker().processAtomicDue(100, handler);
    const task = await prisma.workflowTask.findFirstOrThrow({ where: { workflowInstanceId: context.started.instanceId } });
    return { ...context, task };
  }

  async function holdLock(lock: Prisma.Sql, beforeRelease?: (tx: Prisma.TransactionClient) => Promise<unknown>) {
    let release!: () => void;
    let acquired!: (pid: number) => void;
    const ready = new Promise<number>((resolve) => { acquired = resolve; });
    const released = new Promise<void>((resolve) => { release = resolve; });
    const holder = prisma.$transaction(async (tx) => {
      const [backend] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
      await tx.$queryRaw(lock);
      acquired(backend!.pid);
      await released;
      await beforeRelease?.(tx);
    }, { timeout: 15000 });
    return { pid: await ready, release: async () => { release(); await holder; } };
  }

  async function waitForBlocked(pid: number) {
    const deadline = Date.now() + 3000;
    while (Date.now() < deadline) {
      const [row] = await prisma.$queryRaw<{ waiting: boolean }[]>`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE ${pid}::int = ANY(pg_blocking_pids(pid))) AS waiting`;
      if (row!.waiting) return;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error('Upgrade request did not wait for the independently held PostgreSQL lock');
  }

  function action(context: Awaited<ReturnType<typeof upgradeFixture>>, name: 'SUBMIT' | 'CLOSE' | 'VERIFY' = 'SUBMIT') {
    return { organizationId: context.organization.id, actor: context.actor, problemIndexId: context.problem.id, workflowVersionId: context.started.workflowVersionId,
      idempotencyKey: randomUUID(), traceId: randomUUID(), instanceId: context.input.instanceId, currentNodeId: context.input.currentNodeId,
      expectedVersion: context.input.expectedInstanceVersion, expectedProblemVersion: context.input.expectedProblemVersion, action: name };
  }

  it('persists problem ownership when the ordinary runtime starts an instance', async () => {
    const fixture = await timingFixture(prisma, organizations);
    const [row] = await prisma.$queryRaw<{ problemId: string | null }[]>`SELECT to_jsonb(instance)->>'problem_index_id' AS "problemId"
      FROM workflow_instances instance WHERE id = ${fixture.started.instanceId}::uuid`;
    expect(row?.problemId).toBe(fixture.problem.id);
  });

  it('rejects the current instance of another problem in the same organization', async () => {
    const fixture = await timingFixture(prisma, organizations);
    await expect(prisma.problemIndex.create({ data: { organizationId: fixture.organization.id, reportNumber: randomUUID(), domainCode: 'neutral-test',
      problemType: 'test', sourceType: 'neutral', severity: 'LOW', workflowInstanceId: fixture.started.instanceId } })).rejects.toThrow();
  });

  it('upgrades atomically while preserving problem identity and explicit human values', async () => {
    const context = await upgradeFixture(prisma, organizations);
    const upgraded = await service.upgrade(context.actor, context.problem.id, context.input, randomUUID(), randomUUID());
    expect(upgraded).toMatchObject({ problemId: context.problem.id, reportNumber: context.problem.reportNumber,
      beforeInstanceId: context.started.instanceId, problemVersion: context.started.problemVersion + 1, instanceVersion: 1, domainVersion: 2 });
    expect(upgraded.afterInstanceId).not.toBe(context.started.instanceId);
    expect(await prisma.problemIndex.findUnique({ where: { id: context.problem.id } })).toMatchObject({ reportNumber: context.problem.reportNumber,
      sourceType: context.problem.sourceType, sourceId: context.problem.sourceId, problemType: '8D', workflowInstanceId: upgraded.afterInstanceId });
    const [source] = await prisma.$queryRaw<{ data: unknown }[]>`SELECT data FROM workflow_upgrade_test.sources WHERE id = ${context.sourceId}::uuid`;
    expect(source!.data).toEqual({ summary: 'source summary', flag: false, zero: 0, empty: '', cleared: null });
    expect(await prisma.workflowInstance.findUnique({ where: { id: context.started.instanceId } })).toMatchObject({ status: 'CANCELLED', version: 2 });
    expect(await prisma.workflowInstance.findUnique({ where: { id: upgraded.afterInstanceId } })).toMatchObject({ problemIndexId: context.problem.id, workflowVersionId: String(context.target.id), version: 1 });
    expect(await prisma.workflowMutation.count({ where: { instanceId: upgraded.afterInstanceId, action: 'START' } })).toBe(1);
    expect(await prisma.workflowUpgrade.count({ where: { problemIndexId: context.problem.id } })).toBe(1);
  });

  it('quietly acknowledges the legitimate old START after upgrade without creating an obsolete task', async () => {
    const context = await upgradeFixture(prisma, organizations);
    const upgraded = await service.upgrade(context.actor, context.problem.id, context.input, randomUUID(), randomUUID());
    const worker = new OutboxWorkerService(prisma, () => new Date(Date.now() + 1000));
    expect(await worker.processAtomicDue(100, new WorkflowEventHandler())).toMatchObject({ processed: 2, retried: 0, failed: 0 });
    expect(await prisma.workflowTask.count({ where: { workflowInstanceId: context.started.instanceId } })).toBe(0);
    expect(await prisma.workflowTask.count({ where: { workflowInstanceId: upgraded.afterInstanceId } })).toBe(1);
  });

  it('keeps a genuine old failed event visible and safely retryable after the current pointer changes', async () => {
    const context = await upgradeFixture(prisma, organizations);
    for (const code of ['outbox:read', 'outbox:retry']) {
      const permission = await prisma.permission.upsert({ where: { code }, create: { code, name: code }, update: {} });
      await prisma.rolePermission.create({ data: { roleId: context.role.id, permissionId: permission.id } });
    }
    await prisma.session.update({ where: { id: context.session.id }, data: { mfaVerifiedAt: new Date(), reauthenticatedAt: new Date() } });
    const event = await prisma.outboxEvent.findUniqueOrThrow({ where: { eventKey: `workflow:${context.started.instanceId}:1` } });
    await prisma.outboxEvent.update({ where: { id: event.id }, data: { status: 'FAILED', attempts: 5 } });
    await service.upgrade(context.actor, context.problem.id, context.input, randomUUID(), randomUUID());
    const admin = new OutboxAdministrationService(prisma, audit);
    expect(await admin.list(context.actor, {})).toMatchObject({ total: 1, items: [{ id: event.id }] });
    await admin.retry(context.actor, event.id, context.organization.id, randomUUID());
    expect(await new OutboxWorkerService(prisma, () => new Date(Date.now() + 1000)).processAtomicDue(100, new WorkflowEventHandler())).toMatchObject({ retried: 0, failed: 0 });
    expect(await prisma.workflowTask.count({ where: { workflowInstanceId: context.started.instanceId } })).toBe(0);
  });

  it('describes executable actions before task projection without mutating state', async () => {
    const context = await upgradeFixture(prisma, organizations);
    const instance = await prisma.workflowInstance.findUniqueOrThrow({ where: { id: context.started.instanceId } });
    const capabilities = await prisma.$transaction((tx) => workflowCapabilities(tx, context.actor, context.problem, instance), { isolationLevel: 'ReadCommitted' });
    expect(capabilities).toMatchObject({ canAct: true, allowedActions: ['SUBMIT'], taskId: null, projectionPending: true });
    expect(await prisma.workflowTask.count({ where: { workflowInstanceId: instance.id } })).toBe(0);
    expect(await prisma.workflowInstance.findUnique({ where: { id: instance.id } })).toEqual(instance);
  });

  it('denies unregistered production domains and protects immutable history and upgrade facts', async () => {
    const context = await upgradeFixture(prisma, organizations);
    const empty = new WorkflowUpgradeService(prisma, audit, outbox, problems, new WorkflowUpgradeRegistry([]));
    await expect(empty.upgrade(context.actor, context.problem.id, context.input, randomUUID(), randomUUID())).rejects.toMatchObject({ response: { code: 'WORKFLOW_UPGRADE_DOMAIN_DENIED' } });
    const another = await prisma.problemIndex.create({ data: { organizationId: context.organization.id, reportNumber: randomUUID(), domainCode: 'neutral', problemType: 'test', sourceType: 'neutral', severity: 'LOW' } });
    await expect(prisma.workflowInstance.update({ where: { id: context.started.instanceId }, data: { problemIndexId: another.id } })).rejects.toThrow();
    const upgraded = await service.upgrade(context.actor, context.problem.id, context.input, randomUUID(), randomUUID());
    await expect(prisma.workflowUpgrade.update({ where: { id: upgraded.id }, data: { reason: 'rewritten' } })).rejects.toThrow();
    await expect(prisma.workflowUpgrade.delete({ where: { id: upgraded.id } })).rejects.toThrow();
  });

  it('replays once, rejects a changed digest, and rechecks revoked authentication on replay', async () => {
    const context = await upgradeFixture(prisma, organizations);
    const key = randomUUID();
    const [first, replay] = await Promise.all([service.upgrade(context.actor, context.problem.id, context.input, key, randomUUID()), service.upgrade(context.actor, context.problem.id, context.input, key, randomUUID())]);
    expect(replay).toEqual(first);
    await expect(service.upgrade(context.actor, context.problem.id, { ...context.input, reason: 'Different' }, key, randomUUID())).rejects.toMatchObject({ response: { code: 'IDEMPOTENCY_REPLAY' } });
    await prisma.session.update({ where: { id: context.session.id }, data: { revokedAt: new Date() } });
    await expect(service.upgrade(context.actor, context.problem.id, context.input, key, randomUUID())).rejects.toMatchObject({ response: { code: 'AUTH_SESSION_REQUIRED' } });
    const valid = await prisma.session.create({ data: { userId: context.actor.id, tokenHash: randomUUID(), expiresAt: new Date(Date.now() + 3600000) } });
    expect(await service.upgrade({ ...context.actor, sessionId: valid.id }, context.problem.id, context.input, key, randomUUID())).toEqual(first);
    await prisma.$executeRaw`UPDATE workflow_upgrade_test.sources SET active = false WHERE id = ${context.sourceId}::uuid`;
    await expect(service.upgrade({ ...context.actor, sessionId: valid.id }, context.problem.id, context.input, key, randomUUID())).rejects.toMatchObject({ response: { code: 'WORKFLOW_UPGRADE_DOMAIN_DENIED' } });
    expect(await prisma.workflowUpgrade.count({ where: { problemIndexId: context.problem.id } })).toBe(1);
  });

  it('allows only one different-key upgrade under concurrency', async () => {
    const context = await projected();
    const results = await Promise.allSettled([service.upgrade(context.actor, context.problem.id, context.input, randomUUID(), randomUUID()), service.upgrade(context.actor, context.problem.id, context.input, randomUUID(), randomUUID())]);
    expect(results.filter((entry) => entry.status === 'fulfilled')).toHaveLength(1);
    expect(results.find((entry) => entry.status === 'rejected')).toMatchObject({ reason: { response: { code: 'CONCURRENCY_CONFLICT' } } });
    expect(await prisma.workflowTask.findUnique({ where: { id: context.task.id } })).toMatchObject({ status: 'CANCELLED', version: 2 });
    expect(await prisma.workflowUpgrade.count({ where: { problemIndexId: context.problem.id } })).toBe(1);
  });

  it.each(['session', 'user', 'permission', 'organization'] as const)('rechecks %s after waiting for the current task lock', async (revocation) => {
    const context = await projected();
    const held = await holdLock(Prisma.sql`SELECT id FROM workflow_tasks WHERE id = ${context.task.id}::uuid FOR UPDATE`);
    const pending = service.upgrade(context.actor, context.problem.id, context.input, randomUUID(), randomUUID()).then((value) => ({ value }), (error: unknown) => ({ error }));
    try {
      await waitForBlocked(held.pid);
      if (revocation === 'session') await prisma.session.update({ where: { id: context.session.id }, data: { revokedAt: new Date() } });
      if (revocation === 'user') await prisma.user.update({ where: { id: context.user.id }, data: { status: 'DISABLED' } });
      if (revocation === 'permission') await prisma.rolePermission.deleteMany({ where: { roleId: context.role.id, permission: { code: 'workflow:act' } } });
      if (revocation === 'organization') await prisma.organization.update({ where: { id: context.organization.id }, data: { status: 'DISABLED' } });
    } finally { await held.release(); }
    expect(await pending).toMatchObject({ error: { response: { code: revocation === 'permission' ? 'FEATURE_PERMISSION_DENIED' : 'AUTH_SESSION_REQUIRED' } } });
    expect(await prisma.workflowUpgrade.count({ where: { problemIndexId: context.problem.id } })).toBe(0);
  });

  it('rechecks domain permission after waiting on its owned source', async () => {
    const context = await upgradeFixture(prisma, organizations);
    const held = await holdLock(Prisma.sql`SELECT id FROM workflow_upgrade_test.sources WHERE id = ${context.sourceId}::uuid FOR UPDATE`,
      (tx) => tx.$executeRaw`UPDATE workflow_upgrade_test.sources SET active = false WHERE id = ${context.sourceId}::uuid`);
    const pending = service.upgrade(context.actor, context.problem.id, context.input, randomUUID(), randomUUID()).then((value) => ({ value }), (error: unknown) => ({ error }));
    try { await waitForBlocked(held.pid); } finally { await held.release(); }
    expect(await pending).toMatchObject({ error: { response: { code: 'WORKFLOW_UPGRADE_DOMAIN_DENIED' } } });
  });

  it.each(['domain', 'audit', 'start-audit', 'outbox'] as const)('rolls back every upgrade write when %s fails', async (failure) => {
    const context = await projected();
    const adapter = new NeutralUpgradeAdapter();
    const original = adapter.apply.bind(adapter);
    if (failure === 'domain') adapter.apply = async (...args) => { await original(...args); throw new Error('domain failed'); };
    const failingAudit = { record: async (...args: Parameters<AuditLogService['record']>) => {
      if ((failure === 'audit' && args[0].action === 'WORKFLOW_UPGRADED') || (failure === 'start-audit' && args[0].action === 'WORKFLOW_STARTED')) throw new Error('audit failed');
      return audit.record(...args);
    } } as AuditLogService;
    const failingOutbox = failure === 'outbox' ? { enqueue: async () => { throw new Error('outbox failed'); } } as unknown as OutboxService : outbox;
    const broken = new WorkflowUpgradeService(prisma, failingAudit, failingOutbox, problems, new WorkflowUpgradeRegistry([adapter]));
    await expect(broken.upgrade(context.actor, context.problem.id, context.input, randomUUID(), randomUUID())).rejects.toThrow('failed');
    expect(await prisma.workflowInstance.count({ where: { problemIndexId: context.problem.id } })).toBe(1);
    expect(await prisma.workflowInstance.findUnique({ where: { id: context.started.instanceId } })).toMatchObject({ status: 'RUNNING', version: 1 });
    expect(await prisma.workflowTask.findUnique({ where: { id: context.task.id } })).toMatchObject({ status: 'PENDING', version: 1 });
    expect(await prisma.problemIndex.findUnique({ where: { id: context.problem.id } })).toMatchObject({ workflowInstanceId: context.started.instanceId, version: context.input.expectedProblemVersion });
    const [source] = await prisma.$queryRaw<{ kind: string; version: number }[]>`SELECT kind, version FROM workflow_upgrade_test.sources WHERE id = ${context.sourceId}::uuid`;
    expect(source).toEqual({ kind: 'BRIEF', version: 1 });
    expect(await prisma.workflowUpgrade.count({ where: { problemIndexId: context.problem.id } })).toBe(0);
    expect(await prisma.$queryRaw<{ count: bigint }[]>`SELECT count(*) AS count FROM workflow_upgrade_test.revisions WHERE source_id = ${context.sourceId}::uuid`).toEqual([{ count: 1n }]);
  });

  it('preserves delivered historical notifications and cancelled claims without inheriting the claim', async () => {
    const context = await projected();
    await tasks.claim(context.actor, context.task.id, context.organization.id, 1, randomUUID());
    const original = await notifications.list(context.actor, {});
    const upgraded = await service.upgrade(context.actor, context.problem.id, context.input, randomUUID(), randomUUID());
    expect(await prisma.workflowTask.findUnique({ where: { id: context.task.id } })).toMatchObject({ status: 'CANCELLED', claimedByUserId: context.actor.id, version: 3 });
    await worker().processAtomicDue(100, handler);
    expect(await prisma.workflowTask.findFirst({ where: { workflowInstanceId: upgraded.afterInstanceId } })).toMatchObject({ status: 'PENDING', claimedByUserId: null });
    expect((await tasks.list(context.actor, {})).items.map((task) => task.instanceId)).toEqual([upgraded.afterInstanceId]);
    expect((await notifications.list(context.actor, {})).items.map((notification) => notification.id)).toContain(original.items[0]!.id);
    await expect(notifications.read(context.actor, original.items[0]!.id, context.organization.id, 1, randomUUID())).resolves.toMatchObject({ instanceId: context.started.instanceId, version: 2 });
    const old = await prisma.workflowInstance.findUniqueOrThrow({ where: { id: context.started.instanceId } });
    const problem = await prisma.problemIndex.findUniqueOrThrow({ where: { id: context.problem.id } });
    expect(await prisma.$transaction((tx) => workflowCapabilities(tx, context.actor, problem, old))).toMatchObject({ canAct: false, allowedActions: [] });
    await expect(runtime.submitAction(action(context))).rejects.toMatchObject({ response: { code: 'WORKFLOW_INSTANCE_NOT_FOUND' } });
  });

  it('does not acknowledge cancelled timing events whose originating receipt is missing', async () => {
    const context = await projected();
    const event = await prisma.outboxEvent.findFirstOrThrow({ where: { aggregateId: context.task.id, eventType: 'WORKFLOW_TASK_REMINDER' } });
    await service.upgrade(context.actor, context.problem.id, context.input, randomUUID(), randomUUID());
    await prisma.workflowMutation.deleteMany({ where: { instanceId: context.started.instanceId } });
    await expect(prisma.$transaction((tx) => handler.handle(tx, { ...event, processingAt: new Date(Date.now() + 3600000) }))).rejects.toThrow('WORKFLOW_TIMING_EVENT_INVALID');
  });

  it.each(['claim-first', 'upgrade-first'] as const)('serializes upgrade against exclusive claim: %s', async (order) => {
    const context = await projected();
    const peer = await prisma.user.create({ data: { organizationId: context.organization.id, username: randomUUID(), passwordHash: 'fixture', accountType: 'INTERNAL' } });
    await prisma.userRole.create({ data: { userId: peer.id, roleId: context.role.id, organizationId: context.organization.id } });
    const session = await prisma.session.create({ data: { userId: peer.id, tokenHash: randomUUID(), expiresAt: new Date(Date.now() + 3600000) } });
    const actor = { id: peer.id, organizationId: context.organization.id, accountType: 'INTERNAL' as const, sessionId: session.id };
    const claim = () => tasks.claim(actor, context.task.id, context.organization.id, 1, randomUUID());
    const upgrade = () => service.upgrade(context.actor, context.problem.id, context.input, randomUUID(), randomUUID());
    const held = await holdLock(Prisma.sql`SELECT id FROM workflow_tasks WHERE id = ${context.task.id}::uuid FOR UPDATE`);
    const first = (order === 'claim-first' ? claim() : upgrade()).then((value) => ({ value }), (error: unknown) => ({ error }));
    let second!: Promise<unknown>;
    try { await waitForBlocked(held.pid); second = (order === 'claim-first' ? upgrade() : claim()).then((value) => ({ value }), (error: unknown) => ({ error })); }
    finally { await held.release(); }
    expect(await first).toHaveProperty('value');
    expect(await second).toMatchObject({ error: { response: { code: order === 'claim-first' ? 'TASK_CLAIM_OWNER_REQUIRED' : 'CONCURRENCY_CONFLICT' } } });
    expect(await prisma.workflowUpgrade.count({ where: { problemIndexId: context.problem.id } })).toBe(order === 'claim-first' ? 0 : 1);
  });

  it.each(['release-first', 'upgrade-first'] as const)('serializes owner release with upgrade: %s', async (order) => {
    const context = await projected();
    await tasks.claim(context.actor, context.task.id, context.organization.id, 1, randomUUID());
    const release = () => tasks.release(context.actor, context.task.id, context.organization.id, 2, randomUUID());
    const upgrade = () => service.upgrade(context.actor, context.problem.id, context.input, randomUUID(), randomUUID());
    const held = await holdLock(Prisma.sql`SELECT id FROM workflow_tasks WHERE id = ${context.task.id}::uuid FOR UPDATE`);
    const first = (order === 'release-first' ? release() : upgrade()).then((value) => ({ value }), (error: unknown) => ({ error }));
    let second!: Promise<unknown>;
    try { await waitForBlocked(held.pid); second = (order === 'release-first' ? upgrade() : release()).then((value) => ({ value }), (error: unknown) => ({ error })); }
    finally { await held.release(); }
    expect(await first).toHaveProperty('value');
    if (order === 'release-first') expect(await second).toHaveProperty('value');
    else expect(await second).toMatchObject({ error: { response: { code: 'CONCURRENCY_CONFLICT' } } });
    expect(await prisma.workflowTask.findUnique({ where: { id: context.task.id } })).toMatchObject({ status: 'CANCELLED' });
  });

  it.each([['submit', 'action-first'], ['submit', 'upgrade-first'], ['close', 'action-first'], ['close', 'upgrade-first']] as const)('serializes %s with upgrade: %s', async (kind, order) => {
    const context = await projected();
    if (kind === 'close') {
      const next = await runtime.submitAction(action(context));
      context.input = { ...context.input, currentNodeId: next.currentNodeId, expectedInstanceVersion: next.version, expectedProblemVersion: next.problemVersion };
      await worker().processAtomicDue(100, handler);
      context.task = await prisma.workflowTask.findFirstOrThrow({ where: { workflowInstanceId: context.started.instanceId, entryInstanceVersion: next.version } });
    }
    const submit = () => runtime.submitAction(action(context, kind === 'close' ? 'CLOSE' : 'SUBMIT'));
    const upgrade = () => service.upgrade(context.actor, context.problem.id, context.input, randomUUID(), randomUUID());
    const held = await holdLock(Prisma.sql`SELECT id FROM workflow_tasks WHERE id = ${context.task.id}::uuid FOR UPDATE`);
    const first = (order === 'action-first' ? submit() : upgrade()).then((value) => ({ value }), (error: unknown) => ({ error }));
    let second!: Promise<unknown>;
    try { await waitForBlocked(held.pid); second = (order === 'action-first' ? upgrade() : submit()).then((value) => ({ value }), (error: unknown) => ({ error })); }
    finally { await held.release(); }
    expect(await first).toHaveProperty('value');
    expect(await second).toMatchObject({ error: { response: { code: order === 'action-first' ? 'CONCURRENCY_CONFLICT' : 'WORKFLOW_INSTANCE_NOT_FOUND' } } });
    expect(await prisma.workflowUpgrade.count({ where: { problemIndexId: context.problem.id } })).toBe(order === 'action-first' ? 0 : 1);
  });

  it.each(['timing-first', 'upgrade-first'] as const)('avoids inverted locks while reminder and upgrade compete: %s', async (order) => {
    const context = await projected();
    const timed = new OutboxWorkerService(prisma, () => new Date(context.task.dueAt!.getTime() - 600000));
    const timing = () => timed.processAtomicDue(100, handler);
    const upgrade = () => service.upgrade(context.actor, context.problem.id, context.input, randomUUID(), randomUUID());
    const held = await holdLock(Prisma.sql`SELECT id FROM workflow_tasks WHERE id = ${context.task.id}::uuid FOR UPDATE`);
    const first = (order === 'timing-first' ? timing() : upgrade()).then((value) => ({ value }), (error: unknown) => ({ error }));
    let second!: Promise<unknown>;
    try { await waitForBlocked(held.pid); second = (order === 'timing-first' ? upgrade() : timing()).then((value) => ({ value }), (error: unknown) => ({ error })); }
    finally { await held.release(); }
    expect(await first).toHaveProperty('value');
    expect(await second).toHaveProperty('value');
    expect(await prisma.workflowTask.findUnique({ where: { id: context.task.id } })).toMatchObject({ status: 'CANCELLED' });
    expect(await prisma.notification.count({ where: { workflowTaskId: context.task.id } })).toBe(order === 'timing-first' ? 2 : 1);
  });

  it('acknowledges out-of-order historical actions but rejects forged historical payloads', async () => {
    const context = await upgradeFixture(prisma, organizations);
    const next = await runtime.submitAction(action(context));
    context.input = { ...context.input, currentNodeId: next.currentNodeId, expectedInstanceVersion: next.version, expectedProblemVersion: next.problemVersion };
    await service.upgrade(context.actor, context.problem.id, context.input, randomUUID(), randomUUID());
    const oldStart = await prisma.outboxEvent.findUniqueOrThrow({ where: { eventKey: `workflow:${context.started.instanceId}:1` } });
    const oldAction = await prisma.outboxEvent.findUniqueOrThrow({ where: { eventKey: `workflow:${context.started.instanceId}:2` } });
    for (const event of [oldAction, oldStart]) await expect(prisma.$transaction((tx) => handler.handle(tx, { ...event, processingAt: new Date() }))).resolves.toBeUndefined();
    for (const payload of [{ ...(oldAction.payload as object), problemIndexId: randomUUID() }, { ...(oldAction.payload as object), currentNodeId: context.started.currentNodeId }]) {
      await expect(prisma.$transaction((tx) => handler.handle(tx, { ...oldAction, payload, processingAt: new Date() }))).rejects.toThrow('WORKFLOW_EVENT_INVALID');
    }
    expect(await prisma.workflowTask.count({ where: { workflowInstanceId: context.started.instanceId } })).toBe(0);
  });

  it.each(['archived', 'domain-version', 'not-brief', 'node-not-allowed'] as const)('rejects stale or unsupported upgrade state: %s', async (condition) => {
    const context = await upgradeFixture(prisma, organizations);
    const adapter = new NeutralUpgradeAdapter();
    if (condition === 'archived') await prisma.problemIndex.update({ where: { id: context.problem.id }, data: { archivedAt: new Date(), status: 'ARCHIVED' } });
    if (condition === 'domain-version') await prisma.$executeRaw`UPDATE workflow_upgrade_test.sources SET version = 2 WHERE id = ${context.sourceId}::uuid`;
    if (condition === 'not-brief') await prisma.$executeRaw`UPDATE workflow_upgrade_test.sources SET kind = '8D' WHERE id = ${context.sourceId}::uuid`;
    if (condition === 'node-not-allowed') { const prepare = adapter.prepare.bind(adapter); adapter.prepare = async (...args) => ({ ...await prepare(...args), allowedNodeIds: [] }); }
    const guarded = new WorkflowUpgradeService(prisma, audit, outbox, problems, new WorkflowUpgradeRegistry([adapter]));
    await expect(guarded.upgrade(context.actor, context.problem.id, context.input, randomUUID(), randomUUID())).rejects.toMatchObject({ response: { code: condition === 'domain-version' ? 'CONCURRENCY_CONFLICT' : 'WORKFLOW_UPGRADE_NOT_ALLOWED' } });
    expect(await prisma.workflowUpgrade.count({ where: { problemIndexId: context.problem.id } })).toBe(0);
  });

  it('requires real owning organization and domain authorization even with valid roles', async () => {
    const context = await upgradeFixture(prisma, organizations);
    const foreign = await upgradeFixture(prisma, organizations);
    await expect(service.upgrade(foreign.actor, context.problem.id, context.input, randomUUID(), randomUUID())).rejects.toMatchObject({ response: { code: 'PROBLEM_NOT_FOUND' } });
    await prisma.userRole.create({ data: { userId: foreign.user.id, roleId: context.role.id, organizationId: context.organization.id } });
    await expect(service.upgrade(foreign.actor, context.problem.id, { ...context.input, organizationId: context.organization.id }, randomUUID(), randomUUID())).rejects.toMatchObject({ response: { code: 'WORKFLOW_UPGRADE_DOMAIN_DENIED' } });
    await prisma.$executeRaw`UPDATE workflow_upgrade_test.sources SET owner_id = ${foreign.user.id}::uuid WHERE id = ${context.sourceId}::uuid`;
    await prisma.user.update({ where: { id: foreign.user.id }, data: { accountType: 'SUPPLIER' } });
    await expect(service.upgrade({ ...foreign.actor, accountType: 'SUPPLIER' }, context.problem.id, { ...context.input, organizationId: context.organization.id }, randomUUID(), randomUUID())).rejects.toMatchObject({ response: { code: 'ORGANIZATION_SCOPE_DENIED' } });
  });

  it('rolls back a domain adapter that changes the stable report identity', async () => {
    const context = await upgradeFixture(prisma, organizations);
    const adapter = new NeutralUpgradeAdapter();
    const original = adapter.apply.bind(adapter);
    adapter.apply = async (...args) => {
      const revision = await original(...args);
      await args[0].problemIndex.update({ where: { id: context.problem.id }, data: { reportNumber: 'unexpected-renumbering' } });
      return revision;
    };
    const guarded = new WorkflowUpgradeService(prisma, audit, outbox, problems, new WorkflowUpgradeRegistry([adapter]));
    await expect(guarded.upgrade(context.actor, context.problem.id, context.input, randomUUID(), randomUUID())).rejects.toMatchObject({ response: { code: 'WORKFLOW_UPGRADE_MAPPING_INVALID' } });
    expect(await prisma.problemIndex.findUnique({ where: { id: context.problem.id } })).toMatchObject({ reportNumber: context.problem.reportNumber, workflowInstanceId: context.started.instanceId });
  });

  it('rolls back an actual database failure creating the new START receipt', async () => {
    const context = await upgradeFixture(prisma, organizations);
    await prisma.$executeRaw`CREATE OR REPLACE FUNCTION workflow_upgrade_test.reject_start_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF current_setting('qms.upgrade_test_fail_receipt', true) = 'yes' AND NEW.action = 'START' THEN RAISE EXCEPTION 'TEST_START_RECEIPT_FAILED'; END IF;
        RETURN NEW;
      END $$`;
    await prisma.$executeRaw`CREATE TRIGGER workflow_upgrade_test_receipt BEFORE INSERT ON workflow_mutations FOR EACH ROW EXECUTE FUNCTION workflow_upgrade_test.reject_start_receipt()`;
    try {
      const adapter = new NeutralUpgradeAdapter();
      const original = adapter.apply.bind(adapter);
      adapter.apply = async (...args) => {
        const revision = await original(...args);
        await args[0].$queryRaw`SELECT set_config('qms.upgrade_test_fail_receipt', 'yes', true)`;
        return revision;
      };
      const broken = new WorkflowUpgradeService(prisma, audit, outbox, problems, new WorkflowUpgradeRegistry([adapter]));
      await expect(broken.upgrade(context.actor, context.problem.id, context.input, randomUUID(), randomUUID())).rejects.toThrow();
      expect(await prisma.workflowInstance.count({ where: { problemIndexId: context.problem.id } })).toBe(1);
      expect(await prisma.workflowUpgrade.count({ where: { problemIndexId: context.problem.id } })).toBe(0);
      const [source] = await prisma.$queryRaw<{ kind: string; version: number }[]>`SELECT kind, version FROM workflow_upgrade_test.sources WHERE id = ${context.sourceId}::uuid`;
      expect(source).toEqual({ kind: 'BRIEF', version: 1 });
    } finally { await prisma.$executeRaw`DROP TRIGGER workflow_upgrade_test_receipt ON workflow_mutations`; }
  });

  it('preserves actual scanned evidence in both immutable domain revisions and the fixed object version', async () => {
    for (const name of ['QMS_OBJECT_STORAGE_ENDPOINT', 'QMS_OBJECT_STORAGE_BUCKET', 'QMS_FILE_SCANNER_HOST', 'QMS_FILE_SCANNER_PORT']) {
      if (!process.env[name]) throw new Error(`Real upgrade evidence requires ${name}`);
    }
    const storage = new S3CompatibleObjectStorage();
    const files = new FileLifecycleService(prisma, new FilePolicyService(), storage, audit, new FileResourceAccess([new NeutralFileResourceAdapter()]));
    const scanner = new FileScanWorkerService(prisma, new FileVerificationService(storage, new FileScannerService()), audit, () => new Date(Date.now() + 1000));
    const bytes = Buffer.from('Preserved immutable upgrade evidence.');
    let fileId!: string;
    const context = await upgradeFixture(prisma, organizations, async ({ problem, actor }) => {
      const upload = await files.initializeUpload(actor, { resourceType: 'NeutralEvidence', resourceId: problem.id, originalName: 'evidence.txt', contentType: 'text/plain',
        sizeBytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }, randomUUID(), randomUUID());
      expect((await fetch(upload.uploadUrl, { method: 'PUT', headers: upload.headers, body: bytes })).status).toBe(200);
      await files.complete(actor, upload.file.id, 1, randomUUID(), randomUUID());
      await scanner.processDue(100);
      expect(await files.get(actor, upload.file.id)).toMatchObject({ status: 'AVAILABLE' });
      fileId = upload.file.id;
      return [fileId];
    });
    const original = await prisma.fileObject.findUniqueOrThrow({ where: { id: fileId } });
    const upgraded = await service.upgrade(context.actor, context.problem.id, context.input, randomUUID(), randomUUID());
    const revisions = await prisma.$queryRaw<{ id: string; evidence_ids: string[] }[]>`SELECT id, evidence_ids FROM workflow_upgrade_test.revisions WHERE source_id = ${context.sourceId}::uuid`;
    expect(revisions).toHaveLength(2);
    expect(revisions.every((revision) => revision.evidence_ids.length === 1 && revision.evidence_ids[0] === fileId)).toBe(true);
    await expect(prisma.$executeRaw`UPDATE workflow_upgrade_test.revisions SET data = '{}'::jsonb WHERE id = ${upgraded.beforeDomainRevisionId}::uuid`).rejects.toThrow();
    expect(await prisma.fileObject.findUnique({ where: { id: fileId } })).toEqual(original);
    const download = await files.download(context.actor, fileId, randomUUID());
    expect(new URL(download.url).searchParams.get('versionId')).toBe(original.objectVersionId);
    expect(Buffer.from(await (await fetch(download.url)).arrayBuffer())).toEqual(bytes);
  });

  it('uses real HTTP authentication and CSRF, and rejects caller target versions or mappings', async () => {
    const context = await upgradeFixture(prisma, organizations);
    const application = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(PrismaService).useValue(prisma)
      .overrideProvider(WORKFLOW_UPGRADE_ADAPTERS).useValue([new NeutralUpgradeAdapter()]).compile();
    const app = application.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init();
    try {
      const token = await app.get(SessionService).create(context.actor.id, prisma, { mfaVerified: true });
      const cookie = `qms_session=${token}; qms_csrf=upgrade-csrf`;
      const path = `/api/v1/problem-index/${context.problem.id}`;
      await request(app.getHttpServer()).get(`${path}/upgrade-preview`).expect(401);
      const preview = await request(app.getHttpServer()).get(`${path}/upgrade-preview`).set('Cookie', cookie).expect(200);
      expect(preview.body).toMatchObject({ canUpgrade: true, expectedDomainVersion: 1, targetVersionId: String(context.target.id) });
      expect(preview.body.mappingSummary).toContainEqual({ fieldId: 'cleared', outcome: 'PRESERVED' });
      await request(app.getHttpServer()).post(`${path}/upgrade`).set('Cookie', cookie).send(context.input).expect(403);
      const post = (body: object, key = randomUUID()) => request(app.getHttpServer()).post(`${path}/upgrade`).set('Cookie', cookie).set('x-csrf-token', 'upgrade-csrf').set('Idempotency-Key', key).send(body);
      for (const fields of [{ targetVersionId: String(context.target.id) }, { actor: context.actor.id }, { mapping: {} }, { expectedDomainVersion: 0 }, { expectedInstanceVersion: 1.5 }, { reason: '  ' }]) await post({ ...context.input, ...fields }).expect(400);
      const key = randomUUID();
      const upgraded = await post(context.input, key).expect(201);
      expect((await post(context.input, key).expect(201)).body).toEqual(upgraded.body);
      await post(context.input).expect(409);
      const after = await request(app.getHttpServer()).get(`${path}/upgrade-preview`).set('Cookie', cookie).expect(200);
      expect(after.body).toMatchObject({ canUpgrade: false, reasonCode: 'WORKFLOW_UPGRADE_NOT_ALLOWED' });
    } finally { await app.close(); }
  });

  it('keeps the exclusive owner requirement until explicit reclaim even after the owner becomes inactive', async () => {
    const context = await projected();
    await prisma.workflowTask.update({ where: { id: context.task.id }, data: { claimedByUserId: context.manager.id, claimedAt: new Date(), status: 'IN_PROGRESS' } });
    await prisma.user.update({ where: { id: context.manager.id }, data: { status: 'DISABLED' } });
    expect(await service.preview(context.actor, context.problem.id)).toMatchObject({ canUpgrade: false, reasonCode: 'TASK_CLAIM_OWNER_REQUIRED' });
    await expect(service.upgrade(context.actor, context.problem.id, context.input, randomUUID(), randomUUID())).rejects.toMatchObject({ response: { code: 'TASK_CLAIM_OWNER_REQUIRED' } });
    await tasks.claim(context.actor, context.task.id, context.organization.id, 1, randomUUID());
    await prisma.rolePermission.deleteMany({ where: { roleId: context.role.id, permission: { code: 'task:claim' } } });
    await expect(service.upgrade(context.actor, context.problem.id, context.input, randomUUID(), randomUUID())).resolves.toHaveProperty('afterInstanceId');
  });

  it('aligns independent verification and reopened action capabilities with runtime decisions', async () => {
    const context = await upgradeFixture(prisma, organizations);
    await prisma.workflowNode.update({ where: { id: context.started.currentNodeId }, data: { type: 'VERIFICATION' } });
    await prisma.workflowTransition.updateMany({ where: { fromNodeId: context.started.currentNodeId }, data: { action: 'VERIFY' } });
    const closing = await runtime.submitAction(action(context, 'VERIFY'));
    const node = await prisma.workflowNode.findUniqueOrThrow({ where: { id: closing.currentNodeId } });
    await prisma.workflowNode.update({ where: { id: node.id }, data: { config: { ...(node.config as Prisma.JsonObject), requireIndependentVerification: true } } });
    const problem = await prisma.problemIndex.findUniqueOrThrow({ where: { id: context.problem.id } });
    const instance = await prisma.workflowInstance.findUniqueOrThrow({ where: { id: closing.instanceId } });
    const own = await prisma.$transaction((tx) => workflowCapabilities(tx, context.actor, problem, instance));
    expect(own.allowedActions).not.toContain('CLOSE');
    expect(own.allowedActions).toContain('RETURN');
    const peer = await prisma.user.create({ data: { organizationId: context.organization.id, username: randomUUID(), passwordHash: 'fixture', accountType: 'INTERNAL' } });
    await prisma.userRole.create({ data: { roleId: context.role.id, userId: peer.id, organizationId: context.organization.id } });
    const session = await prisma.session.create({ data: { userId: peer.id, tokenHash: randomUUID(), expiresAt: new Date(Date.now() + 3600000) } });
    const actor = { id: peer.id, organizationId: context.organization.id, accountType: 'INTERNAL' as const, sessionId: session.id };
    expect((await prisma.$transaction((tx) => workflowCapabilities(tx, actor, problem, instance))).allowedActions).toContain('CLOSE');
    context.input = { ...context.input, currentNodeId: closing.currentNodeId, expectedInstanceVersion: closing.version, expectedProblemVersion: closing.problemVersion };
    await expect(runtime.submitAction(action(context, 'CLOSE'))).rejects.toMatchObject({ response: { code: 'WORKFLOW_INDEPENDENT_VERIFICATION_REQUIRED' } });
    await runtime.submitAction({ ...action(context, 'CLOSE'), actor });
    expect(await prisma.$transaction((tx) => workflowCapabilities(tx, actor, problem, instance))).toMatchObject({ allowedActions: ['REOPEN'], projectionPending: false });
  });
});
