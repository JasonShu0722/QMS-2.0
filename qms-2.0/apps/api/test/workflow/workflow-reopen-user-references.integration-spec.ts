import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module.js';
import { GlobalExceptionFilter } from '../../src/common/contracts/global-exception.filter.js';
import { PrismaService } from '../../src/database/prisma.service.js';
import { SessionService } from '../../src/modules/identity/session.service.js';
import { WorkflowEventHandler } from '../../src/modules/task-notification/workflow-event.handler.js';
import { WorkflowDefinitionService } from '../../src/modules/workflow/workflow-definition.service.js';
import { WorkflowRuntimeService, type WorkflowActionResult } from '../../src/modules/workflow/workflow-runtime.service.js';
import type { WorkflowAction } from '../../src/modules/workflow/workflow.types.js';
import { isDisposableLoopbackPostgres } from '../disposable-postgres.js';

if (process.env.QMS_DISPOSABLE_TEST_DB !== 'true' || !isDisposableLoopbackPostgres(process.env.DATABASE_URL)) {
  throw new Error('Workflow reopen tests require disposable loopback PostgreSQL.');
}

function signal<Value>() {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>(done => { resolve = done; });
  return { promise, resolve };
}

describe('workflow reactivation of historical user references', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let runtime: WorkflowRuntimeService;
  const csrf = randomUUID();

  beforeAll(async () => {
    app = (await Test.createTestingModule({ imports: [AppModule] }).compile()).createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init();
    prisma = app.get(PrismaService);
    runtime = app.get(WorkflowRuntimeService);
  }, 120_000);
  afterAll(async () => app?.close());

  async function fixture(ownerState: 'ACTIVE' | 'DISABLED' | 'UNASSIGNED' = 'ACTIVE', close = true, projectTask = false) {
    const org = await prisma.organization.create({ data: { type: 'INTERNAL', code: randomUUID(), name: 'Reopen fixture' } });
    const person = () => prisma.user.create({ data: { organizationId: org.id, username: randomUUID(), accountType: 'INTERNAL', passwordHash: 'fixture' } });
    const administrator = await person();
    const operator = await person();
    const owner = await person();
    const permissions = await prisma.permission.findMany({ where: { code: { in: ['platform:admin', 'workflow:start', 'workflow:act', 'task:transfer'] } } });
    for (const actor of [administrator, operator]) {
      const role = await prisma.role.create({ data: { organizationId: org.id, code: randomUUID(), name: 'Reopen role', permissions: {
        create: permissions.filter(permission => (actor.id === administrator.id) === (permission.code === 'platform:admin'))
          .map(permission => ({ permissionId: permission.id })),
      } } });
      await prisma.userRole.create({ data: { userId: actor.id, organizationId: org.id, roleId: role.id } });
    }
    const sessions = app.get(SessionService);
    const token = await sessions.create(administrator.id, prisma, { mfaVerified: true, reauthenticated: true });
    const operatorToken = await sessions.create(operator.id, prisma, { mfaVerified: true });
    const session = await prisma.session.findFirstOrThrow({ where: { userId: operator.id } });
    const remove = (subject = owner) => request(app.getHttpServer()).delete(`/api/v1/admin/users/${subject.id}`)
      .set('Cookie', `qms_session=${token}; qms_csrf=${csrf}`).set('x-csrf-token', csrf).set('Idempotency-Key', randomUUID())
      .send({ expectedSecurityVersion: subject.securityVersion, mode: 'STANDARD' });
    const definitions = app.get(WorkflowDefinitionService);
    const definition = await definitions.createDraft({ organizationId: org.id, userId: operator.id, code: randomUUID(), name: 'Reopen', draft: {
      nodes: [
        { id: 'handle', type: 'ACTION', name: 'Handle', config: { isStart: true, assignment: { permission: 'workflow:act' } } },
        { id: 'close', type: 'CLOSE', name: 'Close', config: { isEnd: true, assignment: { permission: 'workflow:act' } } },
      ],
      transitions: [
        { id: 'finish', from: 'handle', to: 'close', action: 'SUBMIT' },
        { id: 'return', from: 'close', to: 'handle', action: 'RETURN' },
        { id: 'reopen', from: 'close', to: 'handle', action: 'REOPEN' },
      ],
    } });
    const version = await definitions.publishVersion({ organizationId: org.id, userId: operator.id, definitionId: definition.id });
    const problem = await prisma.problemIndex.create({ data: { organizationId: org.id, reportNumber: randomUUID(), domainCode: 'test',
      problemType: 'test', sourceType: 'test', severity: 'LOW', ownerId: ownerState === 'UNASSIGNED' ? null : owner.id } });
    const command = { organizationId: org.id, actor: { id: operator.id, organizationId: org.id, accountType: 'INTERNAL' as const, sessionId: session.id },
      problemIndexId: problem.id, workflowVersionId: version.id, traceId: randomUUID() };
    const started = await runtime.startInstance({ ...command, expectedProblemVersion: problem.version, workflowDefinitionId: definition.id,
      instanceKey: problem.id, idempotencyKey: randomUUID() });
    const transfer = (id: string, expectedVersion: number) => request(app.getHttpServer()).post('/api/v1/tasks/transfer')
      .set('Cookie', `qms_session=${operatorToken}; qms_csrf=${csrf}`).set('x-csrf-token', csrf).set('Idempotency-Key', randomUUID())
      .send({ assigneeUserId: operator.id, items: [{ id, expectedVersion }] });
    if (projectTask) {
      const event = await prisma.outboxEvent.findUniqueOrThrow({ where: { eventKey: `workflow:${started.instanceId}:${started.version}` } });
      await prisma.$transaction(tx => app.get(WorkflowEventHandler).handle(tx, { ...event, processingAt: new Date() }));
      const task = await prisma.workflowTask.findFirstOrThrow({ where: { workflowInstanceId: started.instanceId } });
      await transfer(task.id, task.version).expect(201);
    }
    const action = (result: WorkflowActionResult, name: WorkflowAction) => ({ ...command, instanceId: result.instanceId, currentNodeId: result.currentNodeId,
      expectedVersion: result.version, expectedProblemVersion: result.problemVersion, action: name, idempotencyKey: randomUUID() });
    const resolved = await runtime.submitAction(action(started, 'SUBMIT'));
    const historical = close ? await runtime.submitAction(action(resolved, 'CLOSE')) : resolved;
    if (ownerState === 'DISABLED') await prisma.user.update({ where: { id: owner.id }, data: { status: 'DISABLED' } });
    const reactivate = action(historical, close ? 'REOPEN' : 'RETURN');
    const read = () => prisma.problemIndex.findUniqueOrThrow({ where: { id: problem.id } });
    return { org, person, owner, remove, started, reactivate, read, session, transfer };
  }

  async function waitForBlockedTransaction(blocker: number) {
    for (let attempt = 0; attempt < 125; attempt++) {
      const [waiting] = await prisma.$queryRaw<{ pid: number }[]>`SELECT pid FROM pg_stat_activity WHERE ${blocker} = ANY(pg_blocking_pids(pid))`;
      if (waiting) return waiting.pid;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    throw new Error(`No transaction blocked by backend ${blocker}`);
  }

  it.each(['REOPEN', 'RETURN'] as const)('%s permits a new entry without restoring a deleted owner', async name => {
    const { owner, remove, read, reactivate } = await fixture('ACTIVE', name === 'REOPEN');
    const historical = await read();
    await remove().expect(200);
    expect(await read()).toEqual(historical);
    const result = await runtime.submitAction(reactivate);
    expect(await runtime.submitAction(reactivate)).toEqual(result);
    expect(await read()).toMatchObject({ ownerId: null, status: 'IN_PROGRESS', closedAt: null, version: historical.version + 1 });
    const events = await prisma.auditEvent.findMany({ where: { resourceType: 'ProblemIndex', resourceId: historical.id } });
    expect(events).toMatchObject([{ metadata: { targetUserId: owner.id, reasonCode: 'WORKFLOW_HISTORICAL_OWNER_DELETED' } }]);
  });

  it.each(['ACTIVE', 'DISABLED', 'UNASSIGNED'] as const)('reopens a problem with %s owner without changing the assignment', async state => {
    const { read, reactivate } = await fixture(state);
    const { ownerId } = await read();
    await runtime.submitAction(reactivate);
    expect(await read()).toMatchObject({ ownerId, status: 'IN_PROGRESS', closedAt: null });
  });

  it('ends stale tasks before reactivating the instance and retains their user history', async () => {
    const { org, person, started, remove, reactivate, read } = await fixture('UNASSIGNED');
    const taskOwner = await person();
    const task = await prisma.workflowTask.create({ data: { organizationId: org.id, workflowInstanceId: started.instanceId,
      workflowVersionId: started.workflowVersionId, workflowNodeId: started.currentNodeId, entryInstanceVersion: started.version,
      status: 'IN_PROGRESS', assigneeUserId: taskOwner.id, claimedByUserId: taskOwner.id, claimedAt: new Date() } });
    const { closedAt } = await read();
    await remove(taskOwner).expect(200);
    await runtime.submitAction(reactivate);
    expect(await prisma.workflowTask.findUniqueOrThrow({ where: { id: task.id } })).toMatchObject({ status: 'COMPLETED', completedAt: closedAt,
      version: task.version + 1, assigneeUserId: taskOwner.id, claimedByUserId: taskOwner.id, claimedAt: task.claimedAt });
    expect(await prisma.workflowInstance.findUniqueOrThrow({ where: { id: started.instanceId } })).toMatchObject({ status: 'RUNNING', taskProjectionVersion: 0 });
  });

  it.each(['transfer', 'reopen'] as const)('rejects a stale transfer during reopen when %s is first', async first => {
    const { started, reactivate, session, transfer } = await fixture('UNASSIGNED', true, true);
    const stale = await prisma.workflowTask.findFirstOrThrow({ where: { workflowInstanceId: started.instanceId } });
    expect(stale).toMatchObject({ status: 'IN_PROGRESS', claimedByUserId: session.userId });
    const held = signal<number>();
    const release = signal<void>();
    const gate = prisma.$transaction(async tx => {
      if (first === 'transfer') await tx.$queryRaw`SELECT id FROM sessions WHERE id = ${session.id}::uuid FOR UPDATE`;
      else await tx.$executeRaw`LOCK TABLE workflow_mutations IN SHARE MODE`;
      const [backend] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
      held.resolve(backend!.pid);
      await release.promise;
    });
    const gatePid = await held.promise;
    let transferring = first === 'transfer' ? transfer(stale.id, stale.version).then(response => response) : undefined;
    let reopening = first === 'reopen' ? runtime.submitAction(reactivate) : undefined;
    try {
      const firstPid = await waitForBlockedTransaction(gatePid);
      transferring ??= transfer(stale.id, stale.version).then(response => response);
      reopening ??= runtime.submitAction(reactivate);
      await waitForBlockedTransaction(firstPid);
    } finally {
      release.resolve();
      await gate;
      await Promise.allSettled([transferring, reopening]);
    }
    await expect(reopening).resolves.toMatchObject({ status: 'RUNNING', version: reactivate.expectedVersion + 1 });
    expect(await transferring).toMatchObject({ status: 404, body: { code: 'TASK_NOT_FOUND' } });
    expect(await prisma.workflowTask.findUniqueOrThrow({ where: { id: stale.id } })).toMatchObject({ status: 'COMPLETED',
      claimedByUserId: stale.claimedByUserId, claimedAt: stale.claimedAt, version: stale.version + 1 });
  }, 15_000);

  it.each(['delete', 'reopen'] as const)('serializes a concurrent %s that reaches its audit or receipt first', async first => {
    const { owner, remove, read, reactivate } = await fixture();
    const held = signal<number>();
    const release = signal<void>();
    const gate = prisma.$transaction(async tx => {
      if (first === 'delete') await tx.$executeRaw`LOCK TABLE admin_mutations IN SHARE MODE`;
      else await tx.$executeRaw`LOCK TABLE workflow_mutations IN SHARE MODE`;
      const [backend] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
      held.resolve(backend!.pid);
      await release.promise;
    });
    const gatePid = await held.promise;
    let deletion = first === 'delete' ? remove().then(response => response) : undefined;
    let reopening = first === 'reopen' ? runtime.submitAction(reactivate) : undefined;
    try {
      const firstPid = await waitForBlockedTransaction(gatePid);
      deletion ??= remove().then(response => response);
      reopening ??= runtime.submitAction(reactivate);
      await waitForBlockedTransaction(firstPid);
    } finally {
      release.resolve();
      await gate;
      await Promise.all([deletion, reopening]);
    }
    if (first === 'delete') {
      expect(await deletion).toMatchObject({ status: 200 });
      expect(await read()).toMatchObject({ ownerId: null, status: 'IN_PROGRESS' });
    } else {
      expect(await deletion).toMatchObject({ status: 409, body: { code: 'ADMIN_USER_ACTIVE_REFERENCES' } });
      expect(await read()).toMatchObject({ ownerId: owner.id, status: 'IN_PROGRESS' });
    }
  }, 15_000);
});
