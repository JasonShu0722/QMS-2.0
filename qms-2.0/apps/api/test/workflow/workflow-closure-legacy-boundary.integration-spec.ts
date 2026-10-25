import { randomUUID } from 'node:crypto';
import type { Prisma } from '../../src/generated/prisma/client.js';
import { PrismaService } from '../../src/database/prisma.service.js';
import { AuditLogService } from '../../src/modules/audit-log/audit-log.service.js';
import { OutboxService } from '../../src/modules/task-notification/outbox.service.js';
import { NumberingService } from '../../src/modules/problem-index/numbering.service.js';
import { ProblemIndexService } from '../../src/modules/problem-index/problem-index.service.js';
import { WorkflowRuntimeService } from '../../src/modules/workflow/workflow-runtime.service.js';
import { workflowCapabilities } from '../../src/modules/workflow/workflow-capabilities.js';

const url = new URL(process.env.DATABASE_URL ?? 'http://invalid');
if (process.env.QMS_DISPOSABLE_TEST_DB !== 'true' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.port === '55440') throw new Error('Disposable loopback PostgreSQL required');

describe('closure gates never acquire legacy single-node approval authority', () => {
  const prisma = new PrismaService();
  const audit = new AuditLogService(prisma);
  const outbox = new OutboxService(prisma);
  const problems = new ProblemIndexService(prisma, new NumberingService(prisma), audit, outbox);
  const runtime = new WorkflowRuntimeService(prisma, audit, outbox, problems);
  beforeAll(async () => { await prisma.$connect(); });
  afterAll(async () => { await prisma.$disconnect(); });

  async function fixture(gate: Prisma.InputJsonValue | null = { schemaVersion: 1, policy: 'INTERNAL', domainCode: 'neutral-boundary' }, closure = true) {
    const org = await prisma.organization.create({ data: { code: randomUUID(), name: 'Legacy boundary fixture', type: 'INTERNAL' } });
    const user = await prisma.user.create({ data: { organizationId: org.id, username: randomUUID(), passwordHash: 'unused', accountType: 'INTERNAL' } });
    const permissions = await prisma.permission.findMany({ where: { code: { in: ['workflow:act', 'workflow:start'] } } });
    const role = await prisma.role.create({ data: { organizationId: org.id, code: randomUUID(), name: 'Boundary fixture', permissions: { create: permissions.map(p => ({ permissionId: p.id })) } } });
    await prisma.userRole.create({ data: { organizationId: org.id, userId: user.id, roleId: role.id } });
    const definition = await prisma.workflowDefinition.create({ data: { organizationId: org.id, code: randomUUID(), name: 'Controlled boundary' } });
    const version = await prisma.workflowVersion.create({ data: { organizationId: org.id, workflowDefinitionId: definition.id, version: 1 } });
    const handle = await prisma.workflowNode.create({ data: { organizationId: org.id, workflowVersionId: version.id, nodeKey: 'handle', type: 'ACTION', name: 'Handle', config: { isStart: true, assignment: { permission: 'workflow:act' } } } });
    const review = await prisma.workflowNode.create({ data: { organizationId: org.id, workflowVersionId: version.id, nodeKey: 'review', type: 'APPROVAL', name: 'Review', config: { assignment: { permission: 'workflow:act' }, ...(closure ? { closureReview: gate } : {}) } } });
    const close = await prisma.workflowNode.create({ data: { organizationId: org.id, workflowVersionId: version.id, nodeKey: 'close', type: 'CLOSE', name: 'Close', config: { isEnd: true, assignment: { permission: 'workflow:act' } } } });
    await prisma.workflowTransition.createMany({ data: [
      { organizationId: org.id, workflowVersionId: version.id, transitionKey: 'submit', action: 'SUBMIT', fromNodeId: handle.id, toNodeId: review.id },
      { organizationId: org.id, workflowVersionId: version.id, transitionKey: 'approve', action: 'APPROVE', fromNodeId: review.id, toNodeId: close.id },
    ] });
    await prisma.workflowVersion.update({ where: { id: version.id }, data: { status: 'PUBLISHED', publishedAt: new Date() } });
    const problem = await prisma.problemIndex.create({ data: { organizationId: org.id, domainCode: 'neutral-boundary', sourceType: 'fixture', sourceId: randomUUID(), problemType: 'EIGHT_D', reportNumber: randomUUID(), severity: 'LOW' } });
    const instance = await prisma.workflowInstance.create({ data: { organizationId: org.id, problemIndexId: problem.id, workflowDefinitionId: definition.id, workflowVersionId: version.id, instanceKey: randomUUID(), currentNodeId: handle.id } });
    await prisma.problemIndex.update({ where: { id: problem.id }, data: { workflowInstanceId: instance.id, status: 'IN_PROGRESS' } });
    const actor = { id: user.id, organizationId: org.id, accountType: 'INTERNAL' as const, sessionId: randomUUID() };
    const command = (currentNodeId = handle.id, action: 'SUBMIT' | 'APPROVE' = 'SUBMIT') => ({ organizationId: org.id, actor: { id: user.id, organizationId: org.id, accountType: 'INTERNAL' as const },
      problemIndexId: problem.id, instanceId: instance.id, workflowVersionId: version.id, currentNodeId, expectedVersion: 1, expectedProblemVersion: problem.version, action, idempotencyKey: randomUUID(), traceId: randomUUID() });
    return { org, actor, problem, instance, handle, review, close, command, definition, version };
  }

  it('does not advertise generic submission into a closure gate that runtime rejects', async () => {
    const f = await fixture();
    const result = await prisma.$transaction(tx => workflowCapabilities(tx, f.actor, { ...f.problem, workflowInstanceId: f.instance.id }, f.instance));
    expect(result.allowedActions).not.toContain('SUBMIT');
    expect(result.canAct).toBe(false);
    await expect(runtime.submitAction(f.command())).rejects.toMatchObject({ status: 409 });
  });
  it.each([null, { schemaVersion: 999 }])('rejects old action even for corrupted gate declaration %p', async gate => {
    const f = await fixture(gate);
    await prisma.workflowInstance.update({ where: { id: f.instance.id }, data: { currentNodeId: f.review.id } });
    await expect(runtime.submitAction(f.command(f.review.id, 'APPROVE'))).rejects.toMatchObject({ status: 409 });
    expect(await prisma.workflowMutation.count({ where: { instanceId: f.instance.id } })).toBe(0);
  });
  it('rejects a closure gate as the published start node without creating an instance or receipt', async () => {
    const f = await fixture();
    await prisma.workflowNode.update({ where: { id: f.handle.id }, data: { config: {} } });
    await prisma.workflowNode.update({ where: { id: f.review.id }, data: { config: {
      isStart: true, assignment: { permission: 'workflow:act' },
      closureReview: { schemaVersion: 1, policy: 'INTERNAL', domainCode: 'neutral-boundary' },
    } } });
    const problem = await prisma.problemIndex.create({ data: { organizationId: f.org.id, domainCode: 'neutral-boundary',
      sourceType: 'fixture', sourceId: randomUUID(), problemType: 'EIGHT_D', reportNumber: randomUUID(), severity: 'LOW' } });
    await expect(runtime.startInstance({ organizationId: f.org.id, actor: f.command().actor,
      problemIndexId: problem.id, workflowDefinitionId: f.definition.id, workflowVersionId: f.version.id,
      instanceKey: randomUUID(), expectedProblemVersion: problem.version, idempotencyKey: randomUUID(), traceId: randomUUID(),
    })).rejects.toMatchObject({ status: 409, response: { code: 'WORKFLOW_DRAFT_INVALID' } });
    expect(await prisma.workflowInstance.count({ where: { problemIndexId: problem.id } })).toBe(0);
    expect(await prisma.workflowMutation.count({ where: { organizationId: f.org.id } })).toBe(0);
    expect(await prisma.problemIndex.findUniqueOrThrow({ where: { id: problem.id } })).toMatchObject({ workflowInstanceId: null, version: problem.version });
  });
  it('rejects an existing legacy approval receipt when its node is now a closure gate', async () => {
    const f = await fixture(undefined, false);
    await prisma.workflowInstance.update({ where: { id: f.instance.id }, data: { currentNodeId: f.review.id } });
    const command = f.command(f.review.id, 'APPROVE');
    const approved = await runtime.submitAction(command);
    expect(await runtime.submitAction(command)).toEqual(approved);
    const receipt = await prisma.workflowMutation.findUniqueOrThrow({ where: {
      organizationId_actorUserId_key: { organizationId: f.org.id, actorUserId: f.actor.id, key: command.idempotencyKey },
    } });
    expect(receipt).toMatchObject({ nodeId: f.review.id, action: 'APPROVE' });
    await prisma.workflowNode.update({ where: { id: f.review.id }, data: { config: {
      assignment: { permission: 'workflow:act' }, closureReview: { schemaVersion: 1, policy: 'INTERNAL', domainCode: 'neutral-boundary' },
    } } });
    await prisma.workflowInstance.update({ where: { id: f.instance.id }, data: { currentNodeId: f.review.id } });
    const before = await prisma.workflowInstance.findUniqueOrThrow({ where: { id: f.instance.id } });
    await expect(runtime.submitAction(command)).rejects.toMatchObject({ status: 409, response: { code: 'WORKFLOW_ACTION_INVALID' } });
    expect(await prisma.workflowMutation.findUniqueOrThrow({ where: { id: receipt.id } })).toEqual(receipt);
    expect(await prisma.workflowInstance.findUniqueOrThrow({ where: { id: f.instance.id } })).toEqual(before);
  });
  it('allows trusted server domain access into the gate but denies legacy approval and current-gate capability', async () => {
    const f = await fixture();
    let authorized = 0;
    const entered = await runtime.submitAction(f.command(), undefined, undefined, async (tx, context) => {
      expect(context).toEqual({ replay: false });
      expect(await tx.problemIndex.findUniqueOrThrow({ where: { id: f.problem.id } })).toMatchObject({ organizationId: f.org.id });
      authorized++;
    });
    expect(authorized).toBe(1);
    expect(entered).toMatchObject({ currentNodeId: f.review.id, version: 2, status: 'RUNNING' });
    const instance = await prisma.workflowInstance.findUniqueOrThrow({ where: { id: f.instance.id } });
    const cap = await prisma.$transaction(tx => workflowCapabilities(tx, f.actor, f.problem, instance));
    expect(cap).toMatchObject({ currentNodeId: f.review.id, canAct: false, allowedActions: [], reasonCode: 'WORKFLOW_ACTION_INVALID' });
    const command = { ...f.command(f.review.id, 'APPROVE'), expectedVersion: entered.version, expectedProblemVersion: entered.problemVersion };
    await expect(runtime.submitAction(command)).rejects.toMatchObject({ status: 409, response: { code: 'WORKFLOW_ACTION_INVALID' } });
    await expect(runtime.submitAction(command, undefined, undefined, async () => {}))
      .rejects.toMatchObject({ status: 409, response: { code: 'WORKFLOW_ACTION_INVALID' } });
    expect(await prisma.workflowMutation.count({ where: { instanceId: f.instance.id } })).toBe(1);
    expect(await prisma.workflowInstance.findUniqueOrThrow({ where: { id: f.instance.id } })).toEqual(instance);
  });
  it('preserves ordinary published graph action execution and capability', async () => {
    const f = await fixture(undefined, false);
    const cap = await prisma.$transaction(tx => workflowCapabilities(tx, f.actor, { ...f.problem, workflowInstanceId: f.instance.id }, f.instance));
    expect(cap.allowedActions).toContain('SUBMIT');
    expect(await runtime.submitAction(f.command())).toMatchObject({ currentNodeId: f.review.id, version: 2 });
  });
});
