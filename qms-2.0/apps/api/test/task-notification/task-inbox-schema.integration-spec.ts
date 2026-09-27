import { randomUUID } from 'node:crypto';
import { ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { Prisma } from '../../src/generated/prisma/client.js';
import { AppModule } from '../../src/app.module.js';
import { GlobalExceptionFilter } from '../../src/common/contracts/global-exception.filter.js';
import { SessionService } from '../../src/modules/identity/session.service.js';
import { AuditLogService } from '../../src/modules/audit-log/audit-log.service.js';
import { WorkflowRuntimeService } from '../../src/modules/workflow/workflow-runtime.service.js';
import { ProblemIndexService } from '../../src/modules/problem-index/problem-index.service.js';
import { NumberingService } from '../../src/modules/problem-index/numbering.service.js';
import { OutboxService } from '../../src/modules/task-notification/outbox.service.js';
import { canProcessWorkflowNode, type WorkflowActor } from '../../src/modules/workflow/workflow-access-policy.js';
import { Test, type TestingModule } from '@nestjs/testing';
import { DatabaseModule } from '../../src/database/database.module.js';
import { PrismaService } from '../../src/database/prisma.service.js';
import { TaskNotificationModule } from '../../src/modules/task-notification/task-notification.module.js';
import { TaskService } from '../../src/modules/task-notification/task.service.js';
import { TaskTransferService } from '../../src/modules/task-notification/task-transfer.service.js';
import { NotificationService } from '../../src/modules/task-notification/notification.service.js';
import { OUTBOX_HANDLER, OutboxWorkerService, type AtomicOutboxHandler } from '../../src/modules/task-notification/outbox-worker.service.js';
import { clearTimingEvents, timingFixture } from './workflow-timing-fixture.js';

if (!process.env.DATABASE_URL) throw new Error('Real PostgreSQL DATABASE_URL is required for task inbox.');

describe('authorized task inbox on PostgreSQL', () => {
  let module: TestingModule;
  let prisma: PrismaService;
  let tasks: TaskService;
  let transfers: TaskTransferService;
  let notifications: NotificationService;
  let runtime: WorkflowRuntimeService;
  let worker: OutboxWorkerService;
  let handler: AtomicOutboxHandler;
  const organizations: string[] = [];
  beforeAll(async () => {
    module = await Test.createTestingModule({ imports: [DatabaseModule, TaskNotificationModule] }).compile();
    await module.init();
    prisma = module.get(PrismaService);
    tasks = module.get(TaskService);
    transfers = module.get(TaskTransferService);
    notifications = module.get(NotificationService);
    worker = module.get(OutboxWorkerService);
    handler = module.get(OUTBOX_HANDLER);
    const audit = new AuditLogService(prisma);
    const outbox = new OutboxService(prisma);
    runtime = new WorkflowRuntimeService(prisma, audit, outbox, new ProblemIndexService(prisma, new NumberingService(prisma), audit, outbox));
  });
  afterEach(() => clearTimingEvents(prisma, organizations));
  afterAll(() => module?.close());

  async function actor(user: { id: string; organizationId: string; accountType: 'INTERNAL' | 'SUPPLIER' }) {
    const session = await prisma.session.create({ data: { userId: user.id, tokenHash: randomUUID(), expiresAt: new Date(Date.now() + 3600000), reauthenticatedAt: new Date(Date.now() - 600000) } });
    return { id: user.id, organizationId: user.organizationId, accountType: user.accountType, sessionId: session.id };
  }
  async function fixture() {
    const context = await timingFixture(prisma, organizations);
    for (const code of ['task:read', 'task:claim', 'task:transfer', 'notification:read']) {
      const permission = await prisma.permission.upsert({ where: { code }, create: { code, name: code }, update: {} });
      await prisma.rolePermission.create({ data: { roleId: context.role.id, permissionId: permission.id } });
    }
    const peer = await prisma.user.create({ data: { organizationId: context.organization.id, username: randomUUID(), passwordHash: 'fixture', accountType: 'INTERNAL' } });
    await prisma.userRole.create({ data: { userId: peer.id, roleId: context.role.id, organizationId: context.organization.id } });
    await worker.processAtomicDue(100, handler);
    const task = await prisma.workflowTask.findFirstOrThrow({ where: { workflowInstanceId: context.started.instanceId } });
    return { ...context, task, actor: await actor(context.user), peer: await actor(peer) };
  }

  function action(context: Awaited<ReturnType<typeof fixture>>, who = context.actor) {
    return { organizationId: context.organization.id, actor: who, problemIndexId: context.problem.id, workflowVersionId: context.started.workflowVersionId,
      idempotencyKey: randomUUID(), traceId: randomUUID(), instanceId: context.started.instanceId, currentNodeId: context.started.currentNodeId,
      expectedVersion: context.started.version, expectedProblemVersion: context.started.problemVersion, action: 'SUBMIT' as const };
  }

  async function holdLock(lock: Prisma.Sql) {
    let unlock!: () => void;
    let acquired!: (pid: number) => void;
    const released = new Promise<void>((resolve) => { unlock = resolve; });
    const ready = new Promise<number>((resolve) => { acquired = resolve; });
    const holder = prisma.$transaction(async (tx) => {
      const [backend] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
      await tx.$queryRaw(lock);
      acquired(backend!.pid);
      await released;
    }, { timeout: 15000 });
    const pid = await ready;
    return { pid, release: async () => { unlock(); await holder; } };
  }

  async function waitForBlocked(pid: number) {
    const deadline = Date.now() + 3000;
    while (Date.now() < deadline) {
      const [row] = await prisma.$queryRaw<{ waiting: boolean }[]>`SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE ${pid}::int = ANY(pg_blocking_pids(pid))) AS waiting`;
      if (row!.waiting) return;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error('Request did not wait for the independently held PostgreSQL lock');
  }

  it('lists eligible role tasks and retains the total on an empty page', async () => {
    const context = await fixture();
    expect(await tasks.list(context.actor, { pageSize: 1 })).toMatchObject({ total: 1, items: [{ id: context.task.id, canAct: true, canClaim: true, canRelease: false }] });
    expect(await tasks.list(context.actor, { offset: 5 })).toEqual({ total: 1, items: [] });
    expect(await tasks.statistics(context.actor)).toMatchObject({ total: 1, pending: 1, inProgress: 0, overdue: 0, unclaimed: 1, mine: 0, dueToday: 1, dueThisWeek: 1 });
  });

  it('lists failed tasks and retries them with authorization, CAS and audit', async () => {
    const context = await fixture();
    await prisma.workflowTask.update({ where: { id: context.task.id }, data: { status: 'FAILED', claimedByUserId: context.peer.id, claimedAt: new Date() } });
    await expect(tasks.list(context.actor, { status: 'FAILED' })).resolves.toMatchObject({ total: 1, items: [{ id: context.task.id, status: 'FAILED', canRetry: true }] });
    await expect(tasks.retry(context.actor, context.task.id, context.organization.id, 1, randomUUID())).resolves.toMatchObject({ id: context.task.id, status: 'PENDING', version: 2, canRetry: false });
    expect(await prisma.workflowTask.findUniqueOrThrow({ where: { id: context.task.id } })).toMatchObject({ status: 'PENDING', claimedByUserId: null, claimedAt: null, version: 2 });
    expect(await prisma.auditEvent.count({ where: { resourceId: context.task.id, action: 'TASK_RETRIED' } })).toBe(1);
    await expect(tasks.retry(context.actor, context.task.id, context.organization.id, 1, randomUUID())).rejects.toMatchObject({ response: { code: 'CONCURRENCY_CONFLICT' } });
  });

  it('exposes failed task recovery through the guarded HTTP contract', async () => {
    const context = await fixture();
    await prisma.workflowTask.update({ where: { id: context.task.id }, data: { status: 'FAILED' } });
    const application = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(PrismaService).useValue(prisma).compile();
    const app = application.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init();
    try {
      const token = await app.get(SessionService).create(context.actor.id, prisma, { mfaVerified: true, reauthenticated: true });
      const cookie = `qms_session=${token}; qms_csrf=g6-csrf`;
      await request(app.getHttpServer()).get('/api/v1/tasks?status=FAILED').set('Cookie', cookie).expect(200).expect((response) => {
        expect(response.body).toMatchObject({ total: 1, items: [{ id: context.task.id, status: 'FAILED', canRetry: true }] });
      });
      await request(app.getHttpServer()).post(`/api/v1/tasks/${context.task.id}/retry`).set('Cookie', cookie).set('x-csrf-token', 'g6-csrf').send({ expectedVersion: 1 }).expect(201).expect((response) => {
        expect(response.body).toMatchObject({ id: context.task.id, status: 'PENDING', version: 2, canRetry: false });
      });
    } finally { await app.close(); }
  });

  it('transfers a task with workflow eligibility, idempotency and CAS', async () => {
    const context = await fixture();
    await prisma.session.update({ where: { id: context.actor.sessionId }, data: { reauthenticatedAt: new Date() } });
    const key = randomUUID();
    const input = { assigneeUserId: context.peer.id, items: [{ id: context.task.id, expectedVersion: 1 }] };
    await expect(transfers.transfer(context.actor, context.organization.id, input, randomUUID(), key)).resolves.toMatchObject([{ id: context.task.id, version: 2, assigneeUserId: context.peer.id, status: 'IN_PROGRESS' }]);
    await expect(transfers.transfer(context.actor, context.organization.id, input, randomUUID(), key)).resolves.toMatchObject([{ id: context.task.id, version: 2, assigneeUserId: context.peer.id }]);
    await expect(transfers.transfer(context.actor, context.organization.id, { ...input, items: [{ id: context.task.id, expectedVersion: 1 }] }, randomUUID(), randomUUID())).rejects.toMatchObject({ response: { code: 'CONCURRENCY_CONFLICT' } });
    expect(await prisma.workflowTask.findUniqueOrThrow({ where: { id: context.task.id } })).toMatchObject({ version: 2, claimedByUserId: context.peer.id });
    expect(await prisma.auditEvent.count({ where: { resourceId: context.task.id, action: 'TASK_TRANSFERRED' } })).toBe(1);
  });

  it('serializes claims, preserves visibility, blocks another actor, and releases with CAS', async () => {
    const context = await fixture();
    const results = await Promise.allSettled([context.actor, context.peer].map((who) => tasks.claim(who, context.task.id, context.organization.id, 1, randomUUID())));
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const updated = await prisma.workflowTask.findUniqueOrThrow({ where: { id: context.task.id } });
    const owner = updated.claimedByUserId === context.actor.id ? context.actor : context.peer;
    const other = owner.id === context.actor.id ? context.peer : context.actor;
    expect(await tasks.list(other, {})).toMatchObject({ total: 1, items: [{ canAct: false, canClaim: false }] });
    await expect(tasks.release(other, context.task.id, context.organization.id, 2, randomUUID())).rejects.toMatchObject({ response: { code: 'TASK_CLAIM_OWNER_REQUIRED' } });
    await expect(tasks.claim(owner, context.task.id, context.organization.id, 1, randomUUID())).rejects.toMatchObject({ response: { code: 'CONCURRENCY_CONFLICT' } });
    await tasks.release(owner, context.task.id, context.organization.id, 2, randomUUID());
    await tasks.claim(other, context.task.id, context.organization.id, 3, randomUUID());
    expect(await prisma.workflowTask.findUnique({ where: { id: context.task.id } })).toMatchObject({ version: 4, claimedByUserId: other.id, assigneeUserId: null, entryInstanceVersion: 1 });
  });

  it('hides stale projection tasks after runtime advances while retaining history notifications', async () => {
    const context = await fixture();
    await context.action(context.started, 'SUBMIT');
    expect(await tasks.list(context.actor, {})).toEqual({ total: 0, items: [] });
    await expect(tasks.claim(context.actor, context.task.id, context.organization.id, 1, randomUUID())).rejects.toMatchObject({ response: { code: 'TASK_NOT_FOUND' } });
    const page = await notifications.list(context.actor, {});
    expect(page).toMatchObject({ total: 1, items: [{ kind: 'TASK_ASSIGNED', readAt: null, organizationId: context.organization.id, problemId: context.problem.id, instanceId: context.started.instanceId }] });
    const result = await notifications.read(context.actor, page.items[0]!.id, context.organization.id, 1, randomUUID());
    expect(result).toMatchObject({ version: 2, readAt: expect.any(String) });
    await expect(notifications.read(context.peer, page.items[0]!.id, context.organization.id, 2, randomUUID())).rejects.toMatchObject({ response: { code: 'NOTIFICATION_NOT_FOUND' } });
  });

  it('requires an active authenticated session after the business locks', async () => {
    const context = await fixture();
    await prisma.session.update({ where: { id: context.actor.sessionId }, data: { revokedAt: new Date() } });
    await expect(tasks.claim(context.actor, context.task.id, context.organization.id, 1, randomUUID())).rejects.toMatchObject({ response: { code: 'AUTH_SESSION_REQUIRED' } });
  });

  it('runtime refuses an eligible actor when someone else owns the current task', async () => {
    const context = await fixture();
    await tasks.claim(context.peer, context.task.id, context.organization.id, 1, randomUUID());
    await expect(context.action(context.started, 'SUBMIT')).rejects.toMatchObject({ response: { code: 'TASK_CLAIM_OWNER_REQUIRED' } });
  });

  it.each(['role', 'user', 'session'] as const)('rechecks %s after waiting for the task lock', async (revocation) => {
    const context = await fixture();
    const held = await holdLock(Prisma.sql`SELECT id FROM workflow_tasks WHERE id = ${context.task.id}::uuid FOR UPDATE`);
    const pending = tasks.claim(context.actor, context.task.id, context.organization.id, 1, randomUUID()).then((value) => ({ value }), (error: unknown) => ({ error }));
    try {
      await waitForBlocked(held.pid);
      if (revocation === 'role') await prisma.userRole.deleteMany({ where: { userId: context.actor.id } });
      if (revocation === 'user') await prisma.user.update({ where: { id: context.actor.id }, data: { status: 'DISABLED' } });
      if (revocation === 'session') await prisma.session.update({ where: { id: context.actor.sessionId }, data: { revokedAt: new Date() } });
    } finally { await held.release(); }
    expect(await pending).toMatchObject({ error: { response: { code: revocation === 'role' ? 'FEATURE_PERMISSION_DENIED' : 'AUTH_SESSION_REQUIRED' } } });
    expect(await prisma.workflowTask.findUnique({ where: { id: context.task.id } })).toMatchObject({ version: 1, claimedByUserId: null });
  });

  it('checks runtime authentication after waiting for the instance lock', async () => {
    const context = await fixture();
    const held = await holdLock(Prisma.sql`SELECT id FROM workflow_instances WHERE id = ${context.started.instanceId}::uuid FOR UPDATE`);
    const pending = runtime.submitAction(action(context)).then((value) => ({ value }), (error: unknown) => ({ error }));
    try {
      await waitForBlocked(held.pid);
      await prisma.session.update({ where: { id: context.actor.sessionId }, data: { revokedAt: new Date() } });
    } finally { await held.release(); }
    expect(await pending).toMatchObject({ error: { response: { code: 'AUTH_SESSION_REQUIRED' } } });
  });

  it('requires role AND assignee AND permission, with independently granted role and permission', async () => {
    const context = await fixture();
    const rule = { roleCode: 'HANDLER', assigneeUserId: context.actor.id, permission: 'problem-index:read' };
    const permitted = () => prisma.$transaction((tx) => canProcessWorkflowNode(tx, context.actor.id, context.organization.id, rule));
    expect(await permitted()).toBe(false);
    await prisma.userRole.create({ data: { userId: context.actor.id, roleId: context.managerRole.id, organizationId: context.organization.id } });
    expect(await permitted()).toBe(true);
    expect(await prisma.$transaction((tx) => canProcessWorkflowNode(tx, context.peer.id, context.organization.id, rule))).toBe(false);
    await prisma.role.update({ where: { id: context.role.id }, data: { code: 'NOT_HANDLER' } });
    expect(await permitted()).toBe(false);
  });

  it('permits an internal cross-organization role but rejects supplier cross-organization access', async () => {
    const context = await fixture();
    const home = await prisma.organization.create({ data: { code: randomUUID(), name: 'External home', type: 'INTERNAL' } });
    organizations.push(home.id);
    const user = await prisma.user.create({ data: { organizationId: home.id, username: randomUUID(), passwordHash: 'fixture', accountType: 'INTERNAL' } });
    await prisma.userRole.create({ data: { userId: user.id, roleId: context.role.id, organizationId: context.organization.id } });
    const internal = await actor(user);
    expect(await tasks.list(internal, { organizationId: context.organization.id })).toMatchObject({ total: 1 });
    await tasks.claim(internal, context.task.id, context.organization.id, 1, randomUUID());
    await prisma.user.update({ where: { id: user.id }, data: { accountType: 'SUPPLIER' } });
    await expect(tasks.list({ ...internal, accountType: 'SUPPLIER' }, { organizationId: context.organization.id })).rejects.toMatchObject({ response: { code: 'ORGANIZATION_SCOPE_DENIED' } });
  });

  it('reclaims a disabled owner but still requires explicit reclaim before action', async () => {
    const context = await fixture();
    await tasks.claim(context.peer, context.task.id, context.organization.id, 1, randomUUID());
    await prisma.user.update({ where: { id: context.peer.id }, data: { status: 'DISABLED' } });
    expect(await tasks.list(context.actor, {})).toMatchObject({ items: [{ canAct: false, canClaim: true }] });
    await expect(runtime.submitAction(action(context))).rejects.toMatchObject({ response: { code: 'TASK_CLAIM_OWNER_REQUIRED' } });
    await tasks.claim(context.actor, context.task.id, context.organization.id, 2, randomUUID());
    await runtime.submitAction(action(context));
    expect(await prisma.auditEvent.findFirst({ where: { resourceId: context.task.id, action: 'TASK_RECLAIMED' } })).toMatchObject({ metadata: { previousClaimedByUserId: context.peer.id, claimedByUserId: context.actor.id, resourceVersion: 3 } });
  });

  it('does not invalidate an existing claim when only task:claim is revoked', async () => {
    const context = await fixture();
    await tasks.claim(context.actor, context.task.id, context.organization.id, 1, randomUUID());
    await prisma.rolePermission.deleteMany({ where: { roleId: context.role.id, permission: { code: 'task:claim' } } });
    expect(await tasks.list(context.actor, {})).toMatchObject({ items: [{ canAct: true, canClaim: false, canRelease: false }] });
    await runtime.submitAction(action(context));
  });

  it('rolls back claims and read receipts when audit fails', async () => {
    const context = await fixture();
    const audit = { record: async () => { throw new Error('audit unavailable'); } } as unknown as AuditLogService;
    await expect(new TaskService(prisma, audit).claim(context.actor, context.task.id, context.organization.id, 1, randomUUID())).rejects.toThrow('audit unavailable');
    expect(await prisma.workflowTask.findUnique({ where: { id: context.task.id } })).toMatchObject({ version: 1, claimedByUserId: null });
    const notification = await prisma.notification.findFirstOrThrow({ where: { workflowTaskId: context.task.id, recipientUserId: context.actor.id } });
    await expect(new NotificationService(prisma, audit).read(context.actor, notification.id, context.organization.id, 1, randomUUID())).rejects.toThrow('audit unavailable');
    expect(await prisma.notification.findUnique({ where: { id: notification.id } })).toMatchObject({ version: 1, readAt: null });
  });

  it('requires MFA when configured and permits complete sessions older than five minutes', async () => {
    const context = await fixture();
    await prisma.role.update({ where: { id: context.role.id }, data: { mfaRequired: true } });
    await expect(tasks.claim(context.actor, context.task.id, context.organization.id, 1, randomUUID())).rejects.toMatchObject({ response: { code: 'AUTH_MFA_REQUIRED' } });
    await prisma.session.update({ where: { id: context.actor.sessionId }, data: { mfaVerifiedAt: new Date(Date.now() - 600000) } });
    await tasks.claim(context.actor, context.task.id, context.organization.id, 1, randomUUID());
    await tasks.release(context.actor, context.task.id, context.organization.id, 2, randomUUID());
  });

  it('enforces real cookie/CSRF guards and rejects forged actor fields or generic completion', async () => {
    const context = await fixture();
    const application = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(PrismaService).useValue(prisma).compile();
    const app = application.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init();
    try {
      const token = await app.get(SessionService).create(context.actor.id, prisma, { mfaVerified: true, reauthenticated: true });
      const cookie = `qms_session=${token}; qms_csrf=inbox-csrf`;
      const path = `/api/v1/tasks/${context.task.id}`;
      await request(app.getHttpServer()).get('/api/v1/tasks').expect(401);
      await request(app.getHttpServer()).get('/api/v1/tasks').set('Cookie', cookie).expect(200);
      await request(app.getHttpServer()).get('/api/v1/tasks?pageSize=101').set('Cookie', cookie).expect(400);
      await request(app.getHttpServer()).post(`${path}/claim`).set('Cookie', cookie).send({ expectedVersion: 1 }).expect(403);
      for (const body of [{ expectedVersion: 0 }, { expectedVersion: 1.5 }, { expectedVersion: 1, actor: context.peer.id }, { expectedVersion: 1, claimedByUserId: context.peer.id }]) {
        await request(app.getHttpServer()).post(`${path}/claim`).set('Cookie', cookie).set('x-csrf-token', 'inbox-csrf').send(body).expect(400);
      }
      await request(app.getHttpServer()).post(`${path}/complete`).set('Cookie', cookie).set('x-csrf-token', 'inbox-csrf').send({ expectedVersion: 1 }).expect(404);
      await request(app.getHttpServer()).post(`${path}/claim`).set('Cookie', cookie).set('x-csrf-token', 'inbox-csrf').send({ expectedVersion: 1 }).expect(201);
      await request(app.getHttpServer()).post(`${path}/release`).set('Cookie', cookie).set('x-csrf-token', 'inbox-csrf').send({ expectedVersion: 2 }).expect(201);
      const page = await request(app.getHttpServer()).get('/api/v1/notifications').set('Cookie', cookie).expect(200);
      await request(app.getHttpServer()).post(`/api/v1/notifications/${page.body.items[0].id}/read`).set('Cookie', cookie).set('x-csrf-token', 'inbox-csrf').send({ expectedVersion: 1 }).expect(201);
    } finally { await app.close(); }
  });

  it.each(['claim-first', 'action-first'] as const)('serializes claim and runtime in both directions: %s', async (order) => {
    const context = await fixture();
    const held = await holdLock(Prisma.sql`SELECT id FROM workflow_tasks WHERE id = ${context.task.id}::uuid FOR UPDATE`);
    const claim = () => tasks.claim(context.peer, context.task.id, context.organization.id, 1, randomUUID());
    const submit = () => runtime.submitAction(action(context));
    const first = (order === 'claim-first' ? claim() : submit()).then((value) => ({ value }), (error: unknown) => ({ error }));
    let second!: Promise<unknown>;
    try {
      await waitForBlocked(held.pid);
      second = (order === 'claim-first' ? submit() : claim()).then((value) => ({ value }), (error: unknown) => ({ error }));
    } finally { await held.release(); }
    expect(await first).toHaveProperty('value');
    expect(await second).toMatchObject({ error: { response: { code: order === 'claim-first' ? 'TASK_CLAIM_OWNER_REQUIRED' : 'TASK_NOT_FOUND' } } });
  });

  it('serializes reclaim with the old owner action and rechecks the old owner permission', async () => {
    const context = await fixture();
    await tasks.claim(context.peer, context.task.id, context.organization.id, 1, randomUUID());
    const held = await holdLock(Prisma.sql`SELECT id FROM workflow_tasks WHERE id = ${context.task.id}::uuid FOR UPDATE`);
    const reclaim = tasks.claim(context.actor, context.task.id, context.organization.id, 2, randomUUID());
    let submit!: Promise<unknown>;
    try {
      await waitForBlocked(held.pid);
      submit = runtime.submitAction(action(context, context.peer)).then((value) => ({ value }), (error: unknown) => ({ error }));
      await prisma.userRole.deleteMany({ where: { userId: context.peer.id } });
    } finally { await held.release(); }
    await expect(reclaim).resolves.toMatchObject({ claimedByUserId: context.actor.id });
    expect(await submit).toMatchObject({ error: { response: { code: 'FEATURE_PERMISSION_DENIED' } } });
  });

  it('keeps fixed assignment unchanged across release and rejects an otherwise eligible peer', async () => {
    const context = await fixture();
    const node = await prisma.workflowNode.findUniqueOrThrow({ where: { id: context.task.workflowNodeId } });
    await prisma.workflowNode.update({ where: { id: node.id }, data: { config: { ...node.config as Prisma.JsonObject, assignment: { roleCode: 'HANDLER', assigneeUserId: context.actor.id } } } });
    await prisma.workflowTask.update({ where: { id: context.task.id }, data: { assigneeUserId: context.actor.id } });
    await tasks.claim(context.actor, context.task.id, context.organization.id, 1, randomUUID());
    await tasks.release(context.actor, context.task.id, context.organization.id, 2, randomUUID());
    await expect(tasks.claim(context.peer, context.task.id, context.organization.id, 3, randomUUID())).rejects.toMatchObject({ response: { code: 'TASK_NOT_FOUND' } });
    expect(await prisma.workflowTask.findUnique({ where: { id: context.task.id } })).toMatchObject({ assigneeUserId: context.actor.id, claimedByUserId: null, version: 3 });
  });

  it('authorizes before pagination with many unauthorized tasks in the same organization', async () => {
    const context = await fixture();
    const instance = await prisma.workflowInstance.findUniqueOrThrow({ where: { id: context.started.instanceId } });
    const hiddenNode = await prisma.workflowNode.create({ data: { organizationId: context.organization.id, workflowVersionId: instance.workflowVersionId, nodeKey: randomUUID(), name: 'Private node', type: 'ACTION', config: { assignment: 'OTHER' } } });
    for (let index = 0; index < 35; index += 1) {
      const nodeId = index < 30 ? hiddenNode.id : context.task.workflowNodeId;
      const problem = await prisma.problemIndex.create({ data: { organizationId: context.organization.id, reportNumber: randomUUID(), domainCode: 'neutral-test', problemType: 'test', sourceType: 'neutral', severity: 'LOW' } });
      const cloned = await prisma.workflowInstance.create({ data: { organizationId: instance.organizationId, problemIndexId: problem.id, workflowDefinitionId: instance.workflowDefinitionId, workflowVersionId: instance.workflowVersionId, currentNodeId: nodeId, instanceKey: randomUUID() } });
      await prisma.problemIndex.update({ where: { id: problem.id }, data: { workflowInstanceId: cloned.id } });
      await prisma.workflowTask.create({ data: { organizationId: context.organization.id, workflowInstanceId: cloned.id, workflowVersionId: instance.workflowVersionId, workflowNodeId: nodeId, entryInstanceVersion: 1, dueAt: new Date(1000 + index) } });
    }
    const first = await tasks.list(context.actor, { pageSize: 4 });
    const second = await tasks.list(context.actor, { pageSize: 4, offset: 4 });
    expect(first.total).toBe(6);
    expect(first.items).toHaveLength(4);
    expect(second.total).toBe(6);
    expect(second.items).toHaveLength(2);
    expect(new Set([...first.items, ...second.items].map((task) => task.id)).size).toBe(6);
    expect(await tasks.list(context.actor, { offset: 100 })).toEqual({ total: 6, items: [] });
  });

  it('allows all three notification kinds by their own historical node policies and denies untrusted kinds', async () => {
    const context = await fixture();
    const permission = await prisma.permission.findUniqueOrThrow({ where: { code: 'notification:read' } });
    await prisma.rolePermission.create({ data: { roleId: context.managerRole.id, permissionId: permission.id } });
    const manager = await actor(context.manager);
    const timedWorker = new OutboxWorkerService(prisma, () => context.task.dueAt!);
    await timedWorker.processAtomicDue(100, handler);
    await runtime.submitAction(action(context));
    await prisma.problemIndex.update({ where: { id: context.problem.id }, data: { workflowInstanceId: null } });
    expect(await notifications.list(context.actor, {})).toMatchObject({ total: 3 });
    expect(await notifications.list(manager, {})).toMatchObject({ total: 1, items: [{ kind: 'TASK_ESCALATED' }] });
    await expect(prisma.notification.create({ data: { organizationId: context.organization.id, recipientUserId: context.actor.id, workflowTaskId: context.task.id, channel: 'IN_APP', status: 'DELIVERED', kind: 'UNKNOWN', body: 'untrusted kind' } })).rejects.toThrow();
    await prisma.notification.createMany({ data: ['LEGACY', 'TASK_ASSIGNED'].map((kind) => ({ organizationId: context.organization.id, recipientUserId: context.actor.id, workflowTaskId: kind === 'TASK_ASSIGNED' ? null : context.task.id, channel: 'IN_APP', status: 'DELIVERED' as const, kind, body: 'not an authorization source' })) });
    expect(await notifications.list(context.actor, {})).toMatchObject({ total: 3 });
    await prisma.rolePermission.deleteMany({ where: { roleId: context.role.id, permission: { code: 'workflow:act' } } });
    expect(await notifications.list(context.actor, {})).toEqual({ total: 0, items: [] });
    await prisma.role.update({ where: { id: context.managerRole.id }, data: { code: 'OTHER' } });
    expect(await notifications.list(manager, {})).toEqual({ total: 0, items: [] });
  });

  it('rechecks notification authorization after waiting for its row lock', async () => {
    const context = await fixture();
    const notification = await prisma.notification.findFirstOrThrow({ where: { workflowTaskId: context.task.id, recipientUserId: context.actor.id } });
    const held = await holdLock(Prisma.sql`SELECT id FROM notifications WHERE id = ${notification.id}::uuid FOR UPDATE`);
    const pending = notifications.read(context.actor, notification.id, context.organization.id, 1, randomUUID()).then((value) => ({ value }), (error: unknown) => ({ error }));
    try {
      await waitForBlocked(held.pid);
      await prisma.rolePermission.deleteMany({ where: { roleId: context.role.id, permission: { code: 'workflow:act' } } });
    } finally { await held.release(); }
    expect(await pending).toMatchObject({ error: { response: { code: 'NOTIFICATION_NOT_FOUND' } } });
    expect(await prisma.notification.findUnique({ where: { id: notification.id } })).toMatchObject({ readAt: null, version: 1 });
  });

  it('leaves old claims in history while a returned round starts unclaimed and replay ignores its owner', async () => {
    const context = await fixture();
    await tasks.claim(context.actor, context.task.id, context.organization.id, 1, randomUUID());
    const command = action(context);
    const submitted = await runtime.submitAction(command);
    await worker.processAtomicDue(100, handler);
    const returned = await context.action(submitted, 'RETURN');
    await worker.processAtomicDue(100, handler);
    const current = await prisma.workflowTask.findFirstOrThrow({ where: { workflowInstanceId: returned.instanceId, entryInstanceVersion: returned.version } });
    expect(current.claimedByUserId).toBeNull();
    await tasks.claim(context.peer, current.id, context.organization.id, 1, randomUUID());
    expect(await runtime.submitAction(command)).toEqual(submitted);
    expect(await tasks.list(context.actor, {})).toMatchObject({ total: 1, items: [{ id: current.id, canAct: false }] });
  });

  it('preserves overdue status and schedule while claims race the timeout worker', async () => {
    const context = await fixture();
    const dueAt = context.task.dueAt!;
    const timedWorker = new OutboxWorkerService(prisma, () => dueAt);
    const results = await Promise.allSettled([tasks.claim(context.actor, context.task.id, context.organization.id, 1, randomUUID()), timedWorker.processAtomicDue(100, handler)]);
    expect(results[1]!.status).toBe('fulfilled');
    let current = await prisma.workflowTask.findUniqueOrThrow({ where: { id: context.task.id } });
    if (results[0]!.status === 'rejected') {
      expect(results[0]).toMatchObject({ reason: { response: { code: 'CONCURRENCY_CONFLICT' } } });
      await tasks.claim(context.actor, current.id, context.organization.id, current.version, randomUUID());
      current = await prisma.workflowTask.findUniqueOrThrow({ where: { id: context.task.id } });
    }
    expect(current).toMatchObject({ status: 'OVERDUE', dueAt, enteredAt: context.task.enteredAt, entryInstanceVersion: 1 });
    await tasks.release(context.actor, current.id, context.organization.id, current.version, randomUUID());
    expect(await prisma.workflowTask.findUnique({ where: { id: current.id } })).toMatchObject({ status: 'OVERDUE', dueAt });
    expect(await prisma.workflowInstance.findUnique({ where: { id: context.started.instanceId } })).toMatchObject({ version: 1, taskProjectionVersion: 1 });
  });

  it.each(['task:read', 'task:claim', 'workflow:act', 'notification:read'] as const)('denies access when required permission %s is revoked', async (permission) => {
    const context = await fixture();
    await prisma.rolePermission.deleteMany({ where: { roleId: context.role.id, permission: { code: permission } } });
    if (permission === 'task:read') await expect(tasks.list(context.actor, {})).rejects.toMatchObject({ response: { code: 'FEATURE_PERMISSION_DENIED' } });
    if (permission === 'task:claim') await expect(tasks.claim(context.actor, context.task.id, context.organization.id, 1, randomUUID())).rejects.toMatchObject({ response: { code: 'FEATURE_PERMISSION_DENIED' } });
    if (permission === 'workflow:act') {
      expect(await tasks.list(context.actor, {})).toEqual({ total: 0, items: [] });
      expect(await notifications.list(context.actor, {})).toEqual({ total: 0, items: [] });
    }
    if (permission === 'notification:read') await expect(notifications.list(context.actor, {})).rejects.toMatchObject({ response: { code: 'FEATURE_PERMISSION_DENIED' } });
  });

  it('rejects malformed assignment constraints and honors a global role assigned in the target organization', async () => {
    const context = await fixture();
    const invalidRules = [null, {}, { roleCode: '' }, { roleCode: 'HANDLER', permission: 1 }, { assigneeUserId: 'invalid' }];
    for (const rule of invalidRules) expect(await prisma.$transaction((tx) => canProcessWorkflowNode(tx, context.actor.id, context.organization.id, rule))).toBe(false);
    const global = await prisma.role.create({ data: { code: randomUUID(), name: 'Global role' } });
    await prisma.userRole.create({ data: { userId: context.actor.id, roleId: global.id, organizationId: context.organization.id } });
    expect(await prisma.$transaction((tx) => canProcessWorkflowNode(tx, context.actor.id, context.organization.id, { roleCode: global.code }))).toBe(true);
  });

  it('enforces claim pair and owner foreign key constraints without changing the fixed-assignee foreign key', async () => {
    const context = await fixture();
    await expect(prisma.workflowTask.update({ where: { id: context.task.id }, data: { claimedAt: new Date() } })).rejects.toThrow();
    await expect(prisma.workflowTask.update({ where: { id: context.task.id }, data: { claimedByUserId: randomUUID(), claimedAt: new Date() } })).rejects.toThrow();
    const foreign = await timingFixture(prisma, organizations);
    await expect(prisma.workflowTask.update({ where: { id: context.task.id }, data: { assigneeUserId: foreign.user.id } })).rejects.toThrow();
    expect(await prisma.workflowTask.findUnique({ where: { id: context.task.id } })).toMatchObject({ claimedByUserId: null, claimedAt: null, assigneeUserId: null });
  });

  it('permits action before the Worker creates a task and serializes late projection through the instance lock', async () => {
    const context = await timingFixture(prisma, organizations);
    const who = await actor(context.user);
    let continueAction!: () => void;
    let acquired!: (pid: number) => void;
    const released = new Promise<void>((resolve) => { continueAction = resolve; });
    const ready = new Promise<number>((resolve) => { acquired = resolve; });
    const command = { organizationId: context.organization.id, actor: who, problemIndexId: context.problem.id, workflowVersionId: context.started.workflowVersionId,
      idempotencyKey: randomUUID(), traceId: randomUUID(), instanceId: context.started.instanceId, currentNodeId: context.started.currentNodeId,
      expectedVersion: context.started.version, expectedProblemVersion: context.started.problemVersion, action: 'SUBMIT' as const };
    const pending = runtime.submitAction(command, undefined, async (tx) => {
      const [backend] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
      acquired(backend!.pid);
      await released;
    });
    const pid = await ready;
    const projection = worker.processAtomicDue(100, handler);
    try { await waitForBlocked(pid); } finally { continueAction(); }
    const submitted = await pending;
    await projection;
    await worker.processAtomicDue(100, handler);
    expect(await prisma.workflowTask.findMany({ where: { workflowInstanceId: context.started.instanceId }, orderBy: { entryInstanceVersion: 'asc' } })).toMatchObject([
      { entryInstanceVersion: 1, status: 'COMPLETED', claimedByUserId: null },
      { entryInstanceVersion: submitted.version, status: 'PENDING', claimedByUserId: null },
    ]);
  });

  it('replays a successful command from a new valid session for the same actor', async () => {
    const context = await timingFixture(prisma, organizations);
    const command = { organizationId: context.organization.id, actor: await actor(context.user), problemIndexId: context.problem.id, workflowVersionId: context.started.workflowVersionId,
      idempotencyKey: randomUUID(), traceId: randomUUID(), instanceId: context.started.instanceId, currentNodeId: context.started.currentNodeId,
      expectedVersion: context.started.version, expectedProblemVersion: context.started.problemVersion, action: 'SUBMIT' as const };
    const submitted = await runtime.submitAction(command);
    await prisma.session.update({ where: { id: command.actor.sessionId }, data: { revokedAt: new Date() } });
    await expect(runtime.submitAction(command)).rejects.toMatchObject({ response: { code: 'AUTH_SESSION_REQUIRED' } });
    expect(await runtime.submitAction({ ...command, actor: await actor(context.user) })).toEqual(submitted);
  });
});
