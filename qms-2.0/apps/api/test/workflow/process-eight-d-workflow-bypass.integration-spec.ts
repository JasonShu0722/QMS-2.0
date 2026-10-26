import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../src/database/prisma.service.js';
import { AdminMutationService } from '../../src/common/security/admin-mutation.service.js';
import { AuditLogService } from '../../src/modules/audit-log/audit-log.service.js';
import { OutboxService } from '../../src/modules/task-notification/outbox.service.js';
import { TaskService } from '../../src/modules/task-notification/task.service.js';
import { TaskTransferService } from '../../src/modules/task-notification/task-transfer.service.js';
import { WorkflowEventHandler } from '../../src/modules/task-notification/workflow-event.handler.js';
import { NumberingService } from '../../src/modules/problem-index/numbering.service.js';
import { ProblemIndexService } from '../../src/modules/problem-index/problem-index.service.js';
import { WorkflowRuntimeService } from '../../src/modules/workflow/workflow-runtime.service.js';
import { workflowCapabilities } from '../../src/modules/workflow/workflow-capabilities.js';

const url = new URL(process.env.DATABASE_URL ?? 'http://invalid');
if (process.env.QMS_DISPOSABLE_TEST_DB !== 'true' || !['postgres:', 'postgresql:'].includes(url.protocol)
  || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.port === '55440') throw new Error('Disposable loopback PostgreSQL required');

describe('process 8D generic bypass boundary on disposable PostgreSQL', () => {
  const prisma = new PrismaService();
  const audit = new AuditLogService(prisma);
  const outbox = new OutboxService(prisma);
  const runtime = new WorkflowRuntimeService(prisma, audit, outbox, new ProblemIndexService(prisma, new NumberingService(prisma), audit, outbox));
  const tasks = new TaskService(prisma, audit);
  const invalidAction = { status: 409, response: { code: 'WORKFLOW_ACTION_INVALID' } };
  beforeAll(() => prisma.$connect());
  afterAll(() => prisma.$disconnect());

  async function fixture() {
    const org = await prisma.organization.create({ data: { code: randomUUID(), name: 'Controlled workflow boundary', type: 'INTERNAL' } });
    const user = await prisma.user.create({ data: { organizationId: org.id, username: randomUUID(), passwordHash: 'unused', accountType: 'INTERNAL' } });
    const permissions = await prisma.permission.findMany({ where: { code: { in: ['workflow:start', 'workflow:act', 'task:read', 'task:claim'] } } });
    expect(permissions).toHaveLength(4);
    const role = await prisma.role.create({ data: { organizationId: org.id, code: randomUUID(), name: 'Boundary actors',
      permissions: { create: permissions.map(permission => ({ permissionId: permission.id })) } } });
    await prisma.userRole.create({ data: { organizationId: org.id, userId: user.id, roleId: role.id } });
    const session = await prisma.session.create({ data: { userId: user.id, tokenHash: randomUUID(), securityVersion: user.securityVersion,
      expiresAt: new Date(Date.now() + 3600000), mfaVerifiedAt: new Date() } });
    const actor = { id: user.id, organizationId: org.id, accountType: 'INTERNAL' as const, sessionId: session.id };
    const definition = await prisma.workflowDefinition.create({ data: { organizationId: org.id, code: randomUUID(), name: 'Process boundary fixture' } });
    // Direct fixture setup tests runtime enforcement, not production publication/readiness.
    const version = await prisma.workflowVersion.create({ data: { organizationId: org.id, workflowDefinitionId: definition.id, version: 1, status: 'PUBLISHED' } });
    const owner = await prisma.workflowNode.create({ data: { organizationId: org.id, workflowVersionId: version.id, nodeKey: 'owner', type: 'ACTION', name: 'Owner',
      config: { isStart: true, assignment: { permission: 'workflow:act' }, processEightD: { schemaVersion: 1, extensionPolicy: 'LEADER_THEN_PROFESSIONAL', reminderEveryHours: null } } } });
    const review = await prisma.workflowNode.create({ data: { organizationId: org.id, workflowVersionId: version.id, nodeKey: 'review', type: 'APPROVAL', name: 'Review',
      config: { closureReview: { schemaVersion: 1, policy: 'INTERNAL', domainCode: 'process-quality' } } } });
    const close = await prisma.workflowNode.create({ data: { organizationId: org.id, workflowVersionId: version.id, nodeKey: 'close', type: 'CLOSE', name: 'Close',
      config: { isEnd: true, assignment: { permission: 'workflow:act' } } } });
    await prisma.workflowTransition.createMany({ data: [
      { organizationId: org.id, workflowVersionId: version.id, transitionKey: 'submit', action: 'SUBMIT', fromNodeId: owner.id, toNodeId: review.id },
      { organizationId: org.id, workflowVersionId: version.id, transitionKey: 'return', action: 'RETURN', fromNodeId: review.id, toNodeId: owner.id },
      { organizationId: org.id, workflowVersionId: version.id, transitionKey: 'approve', action: 'APPROVE', fromNodeId: review.id, toNodeId: close.id },
      { organizationId: org.id, workflowVersionId: version.id, transitionKey: 'legacy-reopen', action: 'REOPEN', fromNodeId: close.id, toNodeId: owner.id },
    ] });
    const problem = await prisma.problemIndex.create({ data: { organizationId: org.id, domainCode: 'process-quality', sourceType: 'process-defect', sourceId: randomUUID(),
      problemType: 'EIGHT_D', reportNumber: randomUUID(), severity: 'LOW', ownerId: user.id } });
    const command = { organizationId: org.id, actor, problemIndexId: problem.id, workflowDefinitionId: definition.id, workflowVersionId: version.id,
      instanceKey: randomUUID(), expectedProblemVersion: problem.version, idempotencyKey: randomUUID(), traceId: randomUUID() };
    const start = () => runtime.startInstance(command, undefined, undefined, async tx => {
      const current = await tx.problemIndex.findUniqueOrThrow({ where: { id: problem.id } });
      expect(current.organizationId).toBe(org.id);
    });
    return { org, actor, definition, version, owner, review, close, problem, command, start };
  }

  it('rejects generic start without writes and requires trusted access again on replay', async () => {
    const f = await fixture();
    await expect(runtime.startInstance(f.command)).rejects.toMatchObject(invalidAction);
    expect(await prisma.workflowInstance.count({ where: { problemIndexId: f.problem.id } })).toBe(0);
    expect(await prisma.workflowMutation.count({ where: { organizationId: f.org.id } })).toBe(0);
    const started = await f.start();
    await expect(runtime.startInstance(f.command)).rejects.toMatchObject(invalidAction);
    await expect(f.start()).resolves.toEqual(started);
    expect(await prisma.workflowMutation.count({ where: { instanceId: started.instanceId } })).toBe(1);
  });

  it('rejects generic owner action and capabilities even when a trusted action callback is supplied', async () => {
    const f = await fixture(); const started = await f.start();
    const command = { ...f.command, idempotencyKey: randomUUID(), instanceId: started.instanceId, currentNodeId: f.owner.id,
      expectedVersion: started.version, expectedProblemVersion: started.problemVersion, action: 'SUBMIT' as const };
    await expect(runtime.submitAction(command)).rejects.toMatchObject(invalidAction);
    await expect(runtime.submitAction(command, undefined, undefined, async () => {})).rejects.toMatchObject(invalidAction);
    const instance = await prisma.workflowInstance.findUniqueOrThrow({ where: { id: started.instanceId } });
    const problem = await prisma.problemIndex.findUniqueOrThrow({ where: { id: f.problem.id } });
    expect(await prisma.$transaction(tx => workflowCapabilities(tx, f.actor, problem, instance)))
      .toMatchObject({ canAct: false, allowedActions: [], reasonCode: 'WORKFLOW_ACTION_INVALID', taskId: null });
    expect(await prisma.workflowMutation.count({ where: { instanceId: instance.id } })).toBe(1);
  });

  it('rejects CLOSED end-node REOPEN using the whole version even with a corrupt owner policy', async () => {
    const f = await fixture(); const started = await f.start();
    await prisma.workflowNode.update({ where: { id: f.owner.id }, data: { config: { assignment: { permission: 'workflow:act' }, processEightD: null } } });
    const instance = await prisma.workflowInstance.update({ where: { id: started.instanceId }, data: { currentNodeId: f.close.id, status: 'COMPLETED' } });
    const problem = await prisma.problemIndex.update({ where: { id: f.problem.id }, data: { status: 'CLOSED', closedAt: new Date() } });
    await expect(runtime.submitAction({ ...f.command, idempotencyKey: randomUUID(), instanceId: instance.id, currentNodeId: f.close.id,
      expectedVersion: instance.version, expectedProblemVersion: problem.version, action: 'REOPEN' })).rejects.toMatchObject(invalidAction);
    expect(await prisma.workflowInstance.findUniqueOrThrow({ where: { id: instance.id } })).toEqual(instance);
    expect(await prisma.problemIndex.findUniqueOrThrow({ where: { id: problem.id } })).toEqual(problem);
  });

  it('filters manually inserted old tasks from inbox/statistics and rejects claim/release/retry without mutations', async () => {
    const f = await fixture(); const started = await f.start();
    const task = await prisma.workflowTask.create({ data: { organizationId: f.org.id, workflowInstanceId: started.instanceId, workflowVersionId: f.version.id,
      workflowNodeId: f.owner.id, entryInstanceVersion: started.version } });
    for (const operation of ['claim', 'release', 'retry'] as const) {
      const before = await prisma.workflowTask.update({ where: { id: task.id }, data: {
        status: operation === 'retry' ? 'FAILED' : 'PENDING', claimedByUserId: operation === 'release' ? f.actor.id : null,
        claimedAt: operation === 'release' ? new Date() : null,
      } });
      expect(await tasks.list(f.actor, operation === 'retry' ? { status: 'FAILED' } : {})).toEqual({ total: 0, items: [] });
      expect(await tasks.statistics(f.actor)).toMatchObject({ total: 0, failed: 0, mine: 0 });
      await expect(tasks[operation](f.actor, task.id, f.org.id, before.version, randomUUID())).rejects.toMatchObject({ status: 404, response: { code: 'TASK_NOT_FOUND' } });
      expect(await prisma.workflowTask.findUniqueOrThrow({ where: { id: task.id } })).toEqual(before);
    }
    expect(await prisma.auditEvent.count({ where: { resourceId: task.id } })).toBe(0);
  });

  it('advances the legacy event cursor without projecting generic tasks, notifications or timers', async () => {
    const f = await fixture(); const started = await f.start();
    const event = await prisma.outboxEvent.findUniqueOrThrow({ where: { eventKey: `workflow:${started.instanceId}:1` } });
    await prisma.$transaction(tx => new WorkflowEventHandler().handle(tx, { ...event, processingAt: new Date() }));
    expect(await prisma.workflowInstance.findUniqueOrThrow({ where: { id: started.instanceId } })).toMatchObject({ taskProjectionVersion: 1 });
    expect(await prisma.workflowTask.count({ where: { workflowInstanceId: started.instanceId } })).toBe(0);
    expect(await prisma.notification.count({ where: { organizationId: f.org.id } })).toBe(0);
    expect(await prisma.outboxEvent.count({ where: { aggregateType: 'WorkflowTask', payload: { path: ['organizationId'], equals: f.org.id } } })).toBe(0);
  });

  it.each([
    { marked: true, replay: false }, { marked: false, replay: false },
    { marked: true, replay: true }, { marked: false, replay: true },
  ])('rejects generic transfer before writes or receipt replay: %j', async ({ marked, replay }) => {
    const f = await fixture(); const started = await f.start();
    const membership = await prisma.userRole.findFirstOrThrow({ where: { userId: f.actor.id, organizationId: f.org.id } });
    const permission = await prisma.permission.findUniqueOrThrow({ where: { code: 'task:transfer' } });
    await prisma.rolePermission.create({ data: { roleId: membership.roleId, permissionId: permission.id } });
    await prisma.session.update({ where: { id: f.actor.sessionId }, data: { reauthenticatedAt: new Date() } });
    const target = await prisma.user.create({ data: { organizationId: f.org.id, username: randomUUID(), passwordHash: 'unused', accountType: 'INTERNAL' } });
    await prisma.userRole.create({ data: { organizationId: f.org.id, userId: target.id, roleId: membership.roleId } });
    if (!marked) {
      await prisma.workflowNode.update({ where: { id: f.owner.id }, data: { config: { isStart: true, assignment: { permission: 'workflow:act' } } } });
      await prisma.workflowNode.update({ where: { id: f.review.id }, data: { config: { ...f.review.config as object, processEightD: null } } });
    }
    const task = await prisma.workflowTask.create({ data: { organizationId: f.org.id, workflowInstanceId: started.instanceId, workflowVersionId: f.version.id,
      workflowNodeId: f.owner.id, entryInstanceVersion: started.version, status: 'IN_PROGRESS', claimedByUserId: f.actor.id, claimedAt: new Date() } });
    const input = { assigneeUserId: target.id, items: [{ id: task.id, expectedVersion: task.version }] };
    const key = randomUUID();
    const mutations = new AdminMutationService(prisma, audit);
    if (replay) {
      // Seed a pre-guard legacy receipt with the real mutation envelope and authentication.
      await mutations.run({ actor: f.actor, organizationId: f.org.id, key, traceId: randomUUID(), action: 'TASKS_TRANSFERRED', payload: input, permission: 'task:transfer' },
        async () => [{ id: task.id, version: task.version + 1, assigneeUserId: target.id, status: 'IN_PROGRESS' }]);
    }
    const receipts = await prisma.adminMutation.findMany({ where: { organizationId: f.org.id } });
    const instance = await prisma.workflowInstance.findUniqueOrThrow({ where: { id: started.instanceId } });
    const problem = await prisma.problemIndex.findUniqueOrThrow({ where: { id: f.problem.id } });
    await expect(new TaskTransferService(prisma, mutations, audit).transfer(f.actor, f.org.id, input, randomUUID(), key))
      .rejects.toMatchObject({ status: 404, response: { code: 'TASK_NOT_FOUND' } });
    expect(await prisma.workflowTask.findUniqueOrThrow({ where: { id: task.id } })).toEqual(task);
    expect(await prisma.workflowInstance.findUniqueOrThrow({ where: { id: instance.id } })).toEqual(instance);
    expect(await prisma.problemIndex.findUniqueOrThrow({ where: { id: problem.id } })).toEqual(problem);
    expect(await prisma.adminMutation.findMany({ where: { organizationId: f.org.id } })).toEqual(receipts);
    expect(await prisma.auditEvent.count({ where: { resourceId: task.id, action: 'TASK_TRANSFERRED' } })).toBe(0);
  });
});
