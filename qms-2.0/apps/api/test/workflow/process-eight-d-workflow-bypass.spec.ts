import 'reflect-metadata';
import { createHash } from 'node:crypto';
import { Prisma, type ProblemIndex, type WorkflowInstance } from '../../src/generated/prisma/client.js';
import type { PrismaService } from '../../src/database/prisma.service.js';
import type { AuditLogService } from '../../src/modules/audit-log/audit-log.service.js';
import type { OutboxService } from '../../src/modules/task-notification/outbox.service.js';
import type { ProblemIndexService } from '../../src/modules/problem-index/problem-index.service.js';
import { WorkflowRuntimeService, type WorkflowActionInput, type StartWorkflowInstanceInput } from '../../src/modules/workflow/workflow-runtime.service.js';
import { canonical } from '../../src/modules/workflow/workflow-runtime-policy.js';
import { fixedWorkflowStart, createWorkflowStart } from '../../src/modules/workflow/workflow-start.js';
import { workflowCapabilities } from '../../src/modules/workflow/workflow-capabilities.js';
import { WorkflowUpgradeService } from '../../src/modules/workflow/workflow-upgrade.service.js';
import { WorkflowUpgradeRegistry } from '../../src/modules/workflow/workflow-upgrade.registry.js';
import { TaskService } from '../../src/modules/task-notification/task.service.js';
import { WorkflowEventHandler } from '../../src/modules/task-notification/workflow-event.handler.js';
import type { OutboxEvent } from '../../src/modules/task-notification/outbox-worker.service.js';

const jest = import.meta.jest;
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const org = id(1), userId = id(2), versionId = id(3), instanceId = id(4), problemId = id(5), nodeId = id(6), definitionId = id(7), ownerId = id(8);
const actor = { id: userId, organizationId: org, accountType: 'INTERNAL' as const, sessionId: id(9) };
const assignment = { permission: 'workflow:act' };
const policy = { schemaVersion: 1, extensionPolicy: 'LEADER_THEN_PROFESSIONAL', reminderEveryHours: null };
const invalidAction = { response: expect.objectContaining({ code: 'WORKFLOW_ACTION_INVALID' }) };

// These are consumer unit tests with an in-memory transaction double, not PostgreSQL evidence.
function fixture(config: Record<string, unknown> = { assignment, processEightD: policy }, controlledVersion = true) {
  const node = { id: nodeId, organizationId: org, workflowVersionId: versionId, type: 'ACTION', name: 'Owner', config };
  const owner = { ...node, id: ownerId, config: { isStart: true, assignment, ...(controlledVersion ? { processEightD: policy } : {}) } };
  const version = { id: versionId, organizationId: org, nodes: [owner, node] };
  const problem = { id: problemId, organizationId: org, workflowInstanceId: instanceId, version: 1, status: 'IN_PROGRESS', archivedAt: null,
    domainCode: 'process-quality', sourceType: 'process-defect', sourceId: id(10), problemType: 'BRIEF', reportNumber: 'TEST' };
  const instance = { id: instanceId, organizationId: org, problemIndexId: problemId, workflowVersionId: versionId, currentNodeId: nodeId,
    currentNode: node, version: 1, status: 'RUNNING', taskProjectionVersion: 0 };
  const task = { id: id(11), workflowInstanceId: instanceId, workflowVersionId: versionId, workflowNodeId: nodeId, organizationId: org,
    workflowNode: node, entryInstanceVersion: 1, status: 'PENDING', version: 1, dueAt: null, claimedByUserId: null as string | null };
  const query = jest.fn(async (raw: TemplateStringsArray | Prisma.Sql) => {
    const sql = Array.isArray(raw) ? raw.join('?') : (raw as Prisma.Sql).text;
    if (sql.includes('transaction_isolation')) return [{ transaction_isolation: 'read committed' }];
    if (sql.includes('SELECT id FROM workflow_nodes') && sql.includes("config ? 'processEightD'")) return controlledVersion ? [{ id: ownerId }] : [];
    if (sql.includes(' AS allowed')) return [{ allowed: true }];
    if (sql.includes('SELECT DISTINCT node_id')) return [{ nodeId: ownerId }];
    if (sql.includes(' AS total')) return [{ total: 0, items: [] }];
    if (sql.includes(' AS item')) return [{ item: task }];
    return [{ id: task.id, claimed_by_user_id: null }];
  });
  const user = { id: userId, organizationId: org, accountType: 'INTERNAL', status: 'ACTIVE', organization: { status: 'ACTIVE' },
    mfaEnabled: false, mfaPreference: 'DISABLED', mfaRequirementOverride: null, securityVersion: 1, mustChangePassword: false };
  const tx = {
    $queryRaw: query,
    user: { findUnique: async () => user }, organization: { findUnique: async () => ({ status: 'ACTIVE' }) },
    userRole: { findMany: async () => [] }, userPosition: { findMany: async () => [] }, session: { findFirst: async () => ({ mfaVerifiedAt: new Date() }) },
    workflowVersion: { findFirst: async () => version },
    workflowNode: { findFirst: async () => node, findUnique: async () => node },
    workflowInstance: { findFirst: async () => instance, findUnique: async () => instance, create: jest.fn(async () => instance),
      updateMany: jest.fn(async () => ({ count: 1 })), update: jest.fn(async () => instance) },
    workflowMutation: { findUnique: jest.fn(async (..._args: unknown[]): Promise<unknown> => null), count: async () => 1, create: jest.fn(async () => ({})) },
    problemIndex: { findFirst: async () => problem },
    workflowTask: { findFirst: async () => task, findUnique: async () => task, findUniqueOrThrow: async () => task,
      create: jest.fn(async () => task), update: jest.fn(async () => task), updateMany: jest.fn(async () => ({ count: 1 })) },
    workflowTransition: { findMany: async () => [{ action: 'SUBMIT', toNodeId: ownerId, toNode: owner, condition: {} }, { action: 'REOPEN', toNodeId: ownerId, toNode: owner, condition: {} }] },
    workflowUpgrade: { findUnique: jest.fn(async (..._args: unknown[]): Promise<unknown> => null) },
    outboxEvent: { createMany: jest.fn(async () => ({ count: 0 })) }, notification: { createMany: jest.fn(async () => ({ count: 0 })) },
  };
  const transaction = tx as unknown as Prisma.TransactionClient;
  const prisma = { $transaction: async (work: (tx: Prisma.TransactionClient) => unknown) => work(transaction) } as PrismaService;
  const audit = { record: jest.fn(async () => undefined) } as unknown as AuditLogService;
  const outbox = { enqueue: jest.fn(async () => undefined) } as unknown as OutboxService;
  const problems = { lockForWorkflow: async () => problem, applyWorkflowState: jest.fn(async () => 2) } as unknown as ProblemIndexService;
  const runtime = new WorkflowRuntimeService(prisma, audit, outbox, problems);
  const command: WorkflowActionInput = { organizationId: org, actor, problemIndexId: problemId, workflowVersionId: versionId,
    expectedProblemVersion: 1, idempotencyKey: 'controlled-test', traceId: 'test', instanceId, currentNodeId: nodeId, expectedVersion: 1, action: 'SUBMIT' };
  const start: StartWorkflowInstanceInput = { organizationId: org, actor, problemIndexId: problemId, workflowVersionId: versionId,
    expectedProblemVersion: 1, idempotencyKey: 'controlled-start', traceId: 'test', workflowDefinitionId: definitionId, instanceKey: 'test' };
  function replay(input: WorkflowActionInput | StartWorkflowInstanceInput, action: string) {
    const { traceId: _trace, idempotencyKey: _key, ...payload } = input;
    const { sessionId: _session, ...claims } = input.actor;
    tx.workflowMutation.findUnique.mockResolvedValue({ instanceId, nodeId, requestDigest: createHash('sha256').update(canonical({ action, payload: { ...payload, actor: claims } })).digest('hex'), response: { instanceId } });
  }
  return { tx, transaction, prisma, audit, outbox, problems, runtime, node, owner, version, problem, instance, task, command, start, replay };
}

describe('process 8D generic runtime bypass boundary (unit)', () => {
  it.each([null, false, {}, policy])('rejects generic handling act for every declared policy: %p', async processEightD => {
    const f = fixture({ assignment, processEightD });
    await expect(f.runtime.submitAction(f.command, f.transaction)).rejects.toMatchObject(invalidAction);
    expect(f.tx.workflowInstance.updateMany).not.toHaveBeenCalled();
  });

  it('does not let a generic domain callback or participant grant controlled handling actions', async () => {
    const f = fixture();
    await expect(f.runtime.submitAction(f.command, f.transaction, undefined, async () => {}, { authorize: async () => {}, lock: async () => {} })).rejects.toMatchObject(invalidAction);
  });

  it('blocks a CLOSED end-node REOPEN using the whole fixed version', async () => {
    const f = fixture({ assignment, isEnd: true }); f.node.type = 'CLOSE'; f.instance.status = 'COMPLETED'; f.problem.status = 'CLOSED'; f.command.action = 'REOPEN';
    await expect(f.runtime.submitAction(f.command, f.transaction)).rejects.toMatchObject(invalidAction);
    expect(f.tx.workflowInstance.updateMany).not.toHaveBeenCalled();
  });

  it.each([true, false])('blocks generic action receipt replay at a marked or unmarked node: %p', async marked => {
    const f = fixture(marked ? { assignment, processEightD: policy } : { assignment }); f.replay(f.command, 'SUBMIT');
    await expect(f.runtime.submitAction(f.command, f.transaction)).rejects.toMatchObject(invalidAction);
  });

  it('keeps ordinary legacy actions working', async () => {
    const f = fixture({ assignment }, false);
    await expect(f.runtime.submitAction(f.command, f.transaction)).resolves.toMatchObject({ status: 'RUNNING', version: 2 });
  });

  it('rejects a controlled target even in an otherwise legacy version', async () => {
    const f = fixture({ assignment }, false); f.owner.config = { ...f.owner.config, processEightD: policy };
    await expect(f.runtime.submitAction(f.command, f.transaction)).rejects.toMatchObject(invalidAction);
  });
});

describe('process 8D start and capability boundary (unit)', () => {
  it('fails closed at the lowest fixed-start helper even when the start node is unmarked', async () => {
    const f = fixture(); delete (f.owner.config as Record<string, unknown>).processEightD;
    await expect(fixedWorkflowStart(f.transaction, org, definitionId, versionId)).rejects.toMatchObject(invalidAction);
  });

  it('also rejects direct createWorkflowStart without trusted domain authorization', async () => {
    const f = fixture();
    await expect(createWorkflowStart(f.transaction, f.start, 'digest', f, null)).rejects.toMatchObject(invalidAction);
    expect(f.tx.workflowInstance.create).not.toHaveBeenCalled();
  });

  it('rejects generic start even when a mutation callback or payload tries to authorize it', async () => {
    const f = fixture(); f.problem.workflowInstanceId = null as unknown as string; f.start.commandPayload = { domainAccess: true };
    await expect(f.runtime.startInstance(f.start, f.transaction, async () => {})).rejects.toMatchObject(invalidAction);
    expect(f.tx.workflowInstance.create).not.toHaveBeenCalled();
  });

  it('allows only a successful server-owned start domainAccess callback', async () => {
    const f = fixture(); f.problem.workflowInstanceId = null as unknown as string;
    const access = jest.fn(async () => {});
    await expect(f.runtime.startInstance(f.start, f.transaction, undefined, access)).resolves.toMatchObject({ status: 'RUNNING' });
    expect(access).toHaveBeenCalledWith(f.transaction, { replay: false });
    expect(f.tx.workflowInstance.create).toHaveBeenCalledTimes(1);
  });

  it('does not create anything when trusted start authorization rejects', async () => {
    const f = fixture(); f.problem.workflowInstanceId = null as unknown as string;
    await expect(f.runtime.startInstance(f.start, f.transaction, undefined, async () => { throw new Error('DOMAIN_DENIED'); })).rejects.toThrow('DOMAIN_DENIED');
    expect(f.tx.workflowInstance.create).not.toHaveBeenCalled();
  });

  it('rejects generic start receipt replay but revalidates trusted replay access', async () => {
    const f = fixture(); f.replay(f.start, 'START');
    await expect(f.runtime.startInstance(f.start, f.transaction)).rejects.toMatchObject(invalidAction);
    const access = jest.fn(async () => {});
    await expect(f.runtime.startInstance(f.start, f.transaction, undefined, access)).resolves.toMatchObject({ instanceId });
    expect(access).toHaveBeenCalledWith(f.transaction, { replay: true });
  });

  it.each([true, false])('does not advertise generic capabilities for marked/unmarked controlled nodes: %p', async marked => {
    const f = fixture(marked ? { assignment, processEightD: policy } : { assignment, isEnd: true });
    if (!marked) { f.node.type = 'CLOSE'; f.instance.status = 'COMPLETED'; }
    const result = await workflowCapabilities(f.transaction, actor, f.problem as unknown as ProblemIndex, f.instance as unknown as WorkflowInstance);
    expect(result).toMatchObject({ canAct: false, allowedActions: [], reasonCode: 'WORKFLOW_ACTION_INVALID', taskId: null, projectionPending: false });
  });
});

describe('process 8D old-task and projection boundary (unit)', () => {
  it.each(['claim', 'release', 'retry'] as const)('blocks manually seeded old tasks from %s', async operation => {
    const f = fixture(); if (operation === 'release') f.task.claimedByUserId = userId;
    if (operation === 'retry') f.task.status = 'FAILED';
    await expect(new TaskService(f.prisma, f.audit)[operation](actor, f.task.id, org, 1, 'test')).rejects.toMatchObject({ response: expect.objectContaining({ code: 'TASK_NOT_FOUND' }) });
    expect(f.tx.workflowTask.update).not.toHaveBeenCalled();
    expect(f.audit.record).not.toHaveBeenCalled();
  });

  it.each(['claim', 'release', 'retry'] as const)('blocks old tasks on an unmarked node in the same process version from %s', async operation => {
    const f = fixture({ assignment }); if (operation === 'release') f.task.claimedByUserId = userId;
    if (operation === 'retry') f.task.status = 'FAILED';
    await expect(new TaskService(f.prisma, f.audit)[operation](actor, f.task.id, org, 1, 'test')).rejects.toMatchObject({ response: expect.objectContaining({ code: 'TASK_NOT_FOUND' }) });
    expect(f.tx.workflowTask.update).not.toHaveBeenCalled();
  });

  it.each(['claim', 'release', 'retry'] as const)('preserves legacy task %s outside controlled versions', async operation => {
    const f = fixture({ assignment }, false); if (operation === 'release') f.task.claimedByUserId = userId;
    if (operation === 'retry') f.task.status = 'FAILED';
    await expect(new TaskService(f.prisma, f.audit)[operation](actor, f.task.id, org, 1, 'test')).resolves.toMatchObject({ id: f.task.id });
    expect(f.tx.workflowTask.update).toHaveBeenCalledTimes(1);
    expect(f.audit.record).toHaveBeenCalledTimes(1);
  });

  it.each(['list', 'statistics'] as const)('filters controlled nodes and whole process versions from %s SQL including failed tasks', async operation => {
    const f = fixture(); const tasks = new TaskService(f.prisma, f.audit);
    if (operation === 'list') await tasks.list(actor, { status: 'FAILED' }); else await tasks.statistics(actor);
    const sql = f.tx.$queryRaw.mock.calls.map(([raw]) => Array.isArray(raw) ? raw.join('?') : (raw as Prisma.Sql).text).join('\n');
    expect(sql).toContain("node.config ? 'processEightD'");
    expect(sql).toContain("node.config ? 'closureReview'");
    expect(sql).toMatch(/NOT EXISTS[\s\S]*workflow_nodes[\s\S]*config \? 'processEightD'/);
  });

  function eventFixture(config?: Record<string, unknown>, controlledVersion = true) {
    const f = fixture(config, controlledVersion);
    const result = { instanceId, workflowVersionId: versionId, version: 1, currentNodeId: nodeId, status: 'RUNNING' };
    f.tx.workflowMutation.findUnique.mockResolvedValue({ organizationId: org, workflowVersionId: versionId, action: 'START', nodeId, response: result });
    const event: OutboxEvent = { id: id(12), attempts: 0, eventKey: `workflow:${instanceId}:1`, aggregateType: 'WorkflowInstance', aggregateId: instanceId,
      eventType: 'WORKFLOW_STARTED', createdAt: new Date(), processingAt: new Date(), payload: { schemaVersion: 1, organizationId: org, problemIndexId: problemId,
        instanceId, workflowVersionId: versionId, instanceVersion: 1, currentNodeId: nodeId, previousNodeId: null, action: 'START', status: 'RUNNING' } };
    return { ...f, event };
  }

  it.each([true, false])('does not project a generic task or notification for a marked/unmarked process node: %p', async marked => {
    const f = eventFixture(marked ? { assignment, processEightD: policy } : { assignment });
    await new WorkflowEventHandler().handle(f.transaction, f.event);
    expect(f.tx.workflowTask.create).not.toHaveBeenCalled();
    expect(f.tx.outboxEvent.createMany).not.toHaveBeenCalled();
    expect(f.tx.notification.createMany).not.toHaveBeenCalled();
    expect(f.tx.workflowInstance.update).toHaveBeenCalledWith(expect.objectContaining({ data: { taskProjectionVersion: 1 } }));
  });

  it.each(['WORKFLOW_TASK_OVERDUE', 'WORKFLOW_TASK_REMINDER', 'WORKFLOW_TASK_ESCALATION'])('does not run stale generic timing for controlled tasks: %s', async eventType => {
    const f = eventFixture({ assignment, processEightD: policy, slaMinutes: 60 });
    f.task.dueAt = new Date(0) as unknown as null;
    const event = { ...f.event, eventType, aggregateType: 'WorkflowTask', aggregateId: f.task.id, eventKey: `workflow-task:${f.task.id}:overdue`,
      payload: { schemaVersion: 1, taskId: f.task.id, organizationId: org, problemIndexId: problemId, instanceId, workflowVersionId: versionId,
        nodeId, entryInstanceVersion: 1, scheduledAt: new Date(0).toISOString() } };
    await new WorkflowEventHandler().handle(f.transaction, event);
    expect(f.tx.workflowTask.update).not.toHaveBeenCalled();
    expect(f.tx.notification.createMany).not.toHaveBeenCalled();
  });

  it('also suppresses old generic timing on an unmarked node in the same process version', async () => {
    const f = eventFixture({ assignment, slaMinutes: 60 });
    await new WorkflowEventHandler().handle(f.transaction, { ...f.event, eventType: 'WORKFLOW_TASK_OVERDUE',
      payload: { nodeId, organizationId: org, workflowVersionId: versionId } });
    expect(f.tx.workflowTask.update).not.toHaveBeenCalled();
    expect(f.tx.notification.createMany).not.toHaveBeenCalled();
  });
});

describe('process 8D generic upgrade boundary (unit)', () => {
  it('does not preview a generic upgrade into a controlled process version', async () => {
    const f = fixture({ assignment }, false); f.version.nodes.push({ ...f.owner, config: { ...f.owner.config, processEightD: policy } });
    const adapter = { domainCode: 'process-quality', sourceType: 'process-defect', authorizeAndLock: async () => {},
      prepare: async () => ({ domainVersion: 1, targetDefinitionId: definitionId, targetVersionId: versionId, targetProblemType: 'EIGHT_D',
        allowedNodeIds: [nodeId], mappingVersion: 'v1', beforeDomainRevisionId: id(13), mappingSummary: [], evidenceFileIds: [] }),
      apply: jest.fn(async () => { throw new Error('UNEXPECTED_APPLY'); }) };
    const service = new WorkflowUpgradeService(f.prisma, f.audit, f.outbox, f.problems, new WorkflowUpgradeRegistry([adapter]));
    await expect(service.preview(actor, problemId)).resolves.toMatchObject({ canUpgrade: false, reasonCode: 'WORKFLOW_UPGRADE_NOT_ALLOWED' });
    await expect(service.upgrade(actor, problemId, { instanceId, currentNodeId: nodeId, expectedProblemVersion: 1, expectedInstanceVersion: 1,
      expectedDomainVersion: 1, reason: 'Upgrade' }, 'upgrade-test', 'test')).rejects.toMatchObject(invalidAction);
    expect(adapter.apply).not.toHaveBeenCalled();
    expect(f.tx.workflowInstance.create).not.toHaveBeenCalled();
  });

  it('does not replay an old generic upgrade receipt into a controlled target version', async () => {
    const f = fixture({ assignment }, false);
    const targetVersionId = id(14);
    const originalQuery = f.tx.$queryRaw.getMockImplementation()!;
    // Distinguish source and target checks using the bound version parameter.
    f.tx.$queryRaw.mockImplementation(async function (raw, ...values: unknown[]) {
      if (Array.isArray(raw) && raw.join('?').includes("config ? 'processEightD'")) return values[1] === targetVersionId ? [{ id: ownerId }] : [];
      return originalQuery(raw);
    });
    const input = { instanceId, currentNodeId: nodeId, expectedProblemVersion: 1, expectedInstanceVersion: 1, expectedDomainVersion: 1, reason: 'Upgrade' };
    const requestDigest = createHash('sha256').update(canonical({ organizationId: org, problemId, actorUserId: actor.id, ...input })).digest('hex');
    f.tx.workflowUpgrade.findUnique.mockResolvedValue({ problemIndexId: problemId, requestDigest, response: { workflowVersionId: targetVersionId } });
    const adapter = { domainCode: 'process-quality', sourceType: 'process-defect', authorizeAndLock: async () => {},
      prepare: async () => { throw new Error('UNEXPECTED_PREPARE'); }, apply: async () => { throw new Error('UNEXPECTED_APPLY'); } };
    const service = new WorkflowUpgradeService(f.prisma, f.audit, f.outbox, f.problems, new WorkflowUpgradeRegistry([adapter]));
    await expect(service.upgrade(actor, problemId, input, 'upgrade-test', 'test')).rejects.toMatchObject(invalidAction);
  });
});
