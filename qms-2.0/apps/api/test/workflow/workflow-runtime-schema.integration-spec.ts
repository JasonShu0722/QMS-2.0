import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../src/database/prisma.service.js';
import type { Prisma } from '../../src/generated/prisma/client.js';
import { AuditLogService } from '../../src/modules/audit-log/audit-log.service.js';
import { OutboxService } from '../../src/modules/task-notification/outbox.service.js';
import { WorkflowRuntimeService } from '../../src/modules/workflow/workflow-runtime.service.js';
import { WorkflowDefinitionService } from '../../src/modules/workflow/workflow-definition.service.js';
import { WorkflowValidationService } from '../../src/modules/workflow/workflow-validation.service.js';
import { ProblemIndexService } from '../../src/modules/problem-index/problem-index.service.js';
import { NumberingService } from '../../src/modules/problem-index/numbering.service.js';

if (!process.env.DATABASE_URL) throw new Error('Real PostgreSQL DATABASE_URL is required; no skipped runtime tests.');

type Result = { instanceId: string; currentNodeId: string; workflowVersionId: string; version: number; problemVersion: number; status: string };
type Mutation = (transaction: Prisma.TransactionClient) => Promise<void>;
type DomainAccess = (transaction: Prisma.TransactionClient, context: { replay: boolean }) => Promise<void>;
type Runtime = {
  startInstance(input: object, transaction?: Prisma.TransactionClient, mutation?: Mutation, domainAccess?: DomainAccess): Promise<Result>;
  submitAction(input: object, transaction?: Prisma.TransactionClient, mutation?: Mutation, domainAccess?: DomainAccess): Promise<Result>;
};

describe('transactional workflow runtime on PostgreSQL', () => {
  let prisma: PrismaService;
  let runtime: Runtime;
  let audit: AuditLogService;
  let outbox: OutboxService;
  let problems: ProblemIndexService;
  const fixtureOrganizations: string[] = [];

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    audit = new AuditLogService(prisma);
    outbox = new OutboxService(prisma);
    problems = new ProblemIndexService(prisma, new NumberingService(prisma), audit, outbox);
    runtime = new WorkflowRuntimeService(prisma, audit, outbox, problems) as unknown as Runtime;
  });
  afterAll(async () => prisma?.$disconnect());
  afterEach(async () => {
    const instances = await prisma.workflowInstance.findMany({ where: { organizationId: { in: fixtureOrganizations } }, select: { id: true } });
    await prisma.outboxEvent.deleteMany({ where: { aggregateType: 'WorkflowInstance', aggregateId: { in: instances.map((instance) => instance.id) } } });
  });

  async function fixture(options: { backward?: boolean; independent?: boolean; bypassVerification?: boolean; ambiguous?: boolean; exactAssignment?: boolean } = {}) {
    const organization = await prisma.organization.create({ data: { code: randomUUID(), name: 'Neutral runtime', type: 'INTERNAL' } });
    fixtureOrganizations.push(organization.id);
    const user = await prisma.user.create({ data: { organizationId: organization.id, username: randomUUID(), passwordHash: 'not-a-login-fixture', accountType: 'INTERNAL' } });
    const role = await prisma.role.create({ data: { organizationId: organization.id, code: 'HANDLER', name: 'Handler' } });
    for (const code of ['workflow:start', 'workflow:act']) {
      const permission = await prisma.permission.upsert({ where: { code }, create: { code, name: code }, update: {} });
      await prisma.rolePermission.create({ data: { roleId: role.id, permissionId: permission.id } });
    }
    await prisma.userRole.create({ data: { userId: user.id, organizationId: organization.id, roleId: role.id } });
    const definitions = new WorkflowDefinitionService(prisma, new WorkflowValidationService(), audit);
    const definition = await definitions.createDraft({ organizationId: organization.id, userId: user.id, code: randomUUID(), name: 'Neutral', draft: {
      nodes: [
        { id: 'handle', type: 'ACTION', name: 'Handle', config: { isStart: true, assignment: { roleCode: 'HANDLER', ...(options.exactAssignment ? { assigneeUserId: user.id, permission: 'workflow:start' } : {}) } } },
        { id: 'approve', type: 'APPROVAL', name: 'Approve', config: { assignment: { roleCode: 'HANDLER' } } },
        { id: 'verify', type: 'VERIFICATION', name: 'Verify', config: { assignment: { roleCode: 'HANDLER' } } },
        { id: 'close', type: 'CLOSE', name: 'Close', config: { isEnd: true, assignment: { roleCode: 'HANDLER' }, requireIndependentVerification: options.independent ?? false } },
      ],
      transitions: [
        { id: 'submit', from: 'handle', to: 'approve' },
        { id: 'approve', from: 'approve', to: 'verify', ...(options.bypassVerification ? { condition: { field: 'severity', operator: 'eq', value: 'LOW' } } : {}) },
        { id: 'verify', from: 'verify', to: 'close' },
        ...(options.ambiguous ? [{ id: 'ambiguous', from: 'handle', to: 'verify', condition: { field: 'severity', operator: 'eq', value: 'LOW' } }] : []),
        ...(options.bypassVerification ? [{ id: 'bypass', from: 'approve', to: 'close', action: 'APPROVE', condition: { field: 'severity', operator: 'eq', value: 'HIGH' } }] : []),
        ...(options.backward ? [
          { id: 'return', from: 'close', to: 'handle', action: 'RETURN' },
          { id: 'reject', from: 'approve', to: 'handle', action: 'REJECT' },
          { id: 'reopen', from: 'close', to: 'handle', action: 'REOPEN' },
        ] : []),
      ],
    } });
    const version = await definitions.publishVersion({ organizationId: organization.id, userId: user.id, definitionId: String(definition.id) });
    const nodes = await prisma.workflowNode.findMany({ where: { workflowVersionId: String(version.id) } });
    const nodeId = (key: string) => nodes.find((node) => node.nodeKey === key)!.id;
    const problem = await prisma.problemIndex.create({ data: { organizationId: organization.id, reportNumber: randomUUID(), domainCode: 'neutral-test', problemType: 'test', sourceType: 'neutral-record', sourceId: randomUUID(), severity: 'LOW' } });
    const actor = { id: user.id, organizationId: organization.id, accountType: 'INTERNAL' as const };
    const start = { organizationId: organization.id, actor, problemIndexId: problem.id, workflowDefinitionId: String(definition.id), workflowVersionId: String(version.id), instanceKey: problem.id, idempotencyKey: randomUUID(), expectedProblemVersion: 1, traceId: randomUUID() };
    const action = (result: Result, name = 'SUBMIT') => ({ organizationId: organization.id, actor, problemIndexId: problem.id, instanceId: result.instanceId, workflowVersionId: result.workflowVersionId, currentNodeId: result.currentNodeId, expectedVersion: result.version, expectedProblemVersion: result.problemVersion, action: name, idempotencyKey: randomUUID(), traceId: randomUUID() });
    return { organization, user, role, definitions, definition, version, nodeId, problem, start, action };
  }

  async function secondActor(context: Awaited<ReturnType<typeof fixture>>) {
    const user = await prisma.user.create({ data: { organizationId: context.organization.id, username: randomUUID(), passwordHash: 'not-a-login-fixture', accountType: 'INTERNAL' } });
    await prisma.userRole.create({ data: { userId: user.id, organizationId: context.organization.id, roleId: context.role.id } });
    return { id: user.id, organizationId: context.organization.id, accountType: 'INTERNAL' as const };
  }

  async function advanceToClose(context: Awaited<ReturnType<typeof fixture>>, started?: Result) {
    let result = started ?? await runtime.startInstance(context.start);
    for (const action of ['SUBMIT', 'APPROVE', 'VERIFY']) result = await runtime.submitAction(context.action(result, action));
    return result;
  }

  it.each(['home', 'target'] as const)('denies direct start, action and replay after %s organization is disabled', async (scope) => {
    const context = await fixture();
    const home = await prisma.organization.create({ data: { code: randomUUID(), name: 'Remote actor home', type: 'INTERNAL' } });
    const user = await prisma.user.create({ data: { organizationId: home.id, username: randomUUID(), passwordHash: 'fixture', accountType: 'INTERNAL' } });
    await prisma.userRole.create({ data: { userId: user.id, organizationId: context.organization.id, roleId: context.role.id } });
    const actor = { id: user.id, organizationId: home.id, accountType: 'INTERNAL' as const };
    const start = { ...context.start, actor };
    const started = await runtime.startInstance(start);
    const action = { ...context.action(started), actor };
    const advanced = await runtime.submitAction(action);
    const unstarted = await prisma.problemIndex.create({ data: { organizationId: context.organization.id, reportNumber: randomUUID(), domainCode: 'neutral-test', problemType: 'test', sourceType: 'neutral', severity: 'LOW' } });
    await prisma.organization.update({ where: { id: scope === 'home' ? home.id : context.organization.id }, data: { status: 'DISABLED' } });
    const denied = { status: 403, response: { code: 'ORGANIZATION_DISABLED' } };
    await expect(runtime.startInstance({ ...start, problemIndexId: unstarted.id, instanceKey: unstarted.id, idempotencyKey: randomUUID() })).rejects.toMatchObject(denied);
    await expect(runtime.startInstance(start)).rejects.toMatchObject(denied);
    await expect(runtime.submitAction({ ...context.action(advanced, 'APPROVE'), actor })).rejects.toMatchObject(denied);
    await expect(runtime.submitAction(action)).rejects.toMatchObject(denied);
    expect(await prisma.workflowMutation.count({ where: { instanceId: started.instanceId } })).toBe(2);
    expect(await prisma.workflowInstance.findUniqueOrThrow({ where: { id: started.instanceId } })).toMatchObject({ version: advanced.version });
    expect(await prisma.problemIndex.findUniqueOrThrow({ where: { id: unstarted.id } })).toMatchObject({ workflowInstanceId: null, version: 1 });
  });

  it('requires independent current verification before closing when configured', async () => {
    const context = await fixture({ independent: true });
    const ready = await advanceToClose(context);
    await expect(runtime.submitAction(context.action(ready, 'CLOSE'))).rejects.toMatchObject({ status: 403, response: { code: 'WORKFLOW_INDEPENDENT_VERIFICATION_REQUIRED' } });
    const closed = await runtime.submitAction({ ...context.action(ready, 'CLOSE'), actor: await secondActor(context) });
    expect(closed.status).toBe('COMPLETED');
  });

  it('does not accept a close path that has never been verified', async () => {
    const context = await fixture({ independent: true, bypassVerification: true });
    await prisma.problemIndex.update({ where: { id: context.problem.id }, data: { severity: 'HIGH' } });
    let result = await runtime.startInstance(context.start);
    for (const action of ['SUBMIT', 'APPROVE']) result = await runtime.submitAction(context.action(result, action));
    await expect(runtime.submitAction({ ...context.action(result, 'CLOSE'), actor: await secondActor(context) })).rejects.toMatchObject({ status: 403, response: { code: 'WORKFLOW_INDEPENDENT_VERIFICATION_REQUIRED' } });
  });

  it('publishes, copies and executes explicit rejection, return and reopening edges', async () => {
    const context = await fixture({ backward: true, independent: true });
    const copied = await context.definitions.copyPublishedVersion({ organizationId: context.organization.id, userId: context.user.id, definitionId: String(context.definition.id) });
    const copiedId = String((copied.version as { id: string }).id);
    expect(await prisma.workflowTransition.count({ where: { workflowVersionId: copiedId, action: { in: ['RETURN', 'REJECT', 'REOPEN'] } } })).toBe(3);
    let result = await runtime.startInstance(context.start);
    result = await runtime.submitAction(context.action(result));
    result = await runtime.submitAction(context.action(result, 'REJECT'));
    expect(result.currentNodeId).toBe(context.nodeId('handle'));
    result = await advanceToClose(context, result);
    result = await runtime.submitAction(context.action(result, 'RETURN'));
    expect(result.currentNodeId).toBe(context.nodeId('handle'));
    result = await advanceToClose(context, result);
    result = await runtime.submitAction({ ...context.action(result, 'CLOSE'), actor: await secondActor(context) });
    result = await runtime.submitAction(context.action(result, 'REOPEN'));
    expect(result).toMatchObject({ currentNodeId: context.nodeId('handle'), status: 'RUNNING' });
    expect(await prisma.problemIndex.findUnique({ where: { id: context.problem.id } })).toMatchObject({ closedAt: null, reportNumber: context.problem.reportNumber });
  });

  it('invalidates old verification after a return even when a later branch bypasses verification', async () => {
    const context = await fixture({ backward: true, independent: true, bypassVerification: true });
    let result = await advanceToClose(context);
    result = await runtime.submitAction(context.action(result, 'RETURN'));
    await prisma.problemIndex.update({ where: { id: context.problem.id }, data: { severity: 'HIGH' } });
    for (const action of ['SUBMIT', 'APPROVE']) result = await runtime.submitAction(context.action(result, action));
    await expect(runtime.submitAction({ ...context.action(result, 'CLOSE'), actor: await secondActor(context) })).rejects.toMatchObject({ status: 403, response: { code: 'WORKFLOW_INDEPENDENT_VERIFICATION_REQUIRED' } });
  });

  it('starts, submits, approves, verifies and closes with fixed version, index, audit and outbox', async () => {
    const context = await fixture();
    let result = await runtime.startInstance(context.start);
    expect(result).toMatchObject({ currentNodeId: context.nodeId('handle'), version: 1, problemVersion: 2, status: 'RUNNING' });
    for (const [action, target] of [['SUBMIT', 'approve'], ['APPROVE', 'verify'], ['VERIFY', 'close'], ['CLOSE', 'close']]) {
      result = await runtime.submitAction(context.action(result, action));
      expect(result.currentNodeId).toBe(context.nodeId(target!));
      expect(result.workflowVersionId).toBe(context.version.id);
    }
    expect(result).toMatchObject({ status: 'COMPLETED', version: 5, problemVersion: 6 });
    expect(await prisma.problemIndex.findUnique({ where: { id: context.problem.id } })).toMatchObject({ status: 'CLOSED', reportNumber: context.problem.reportNumber, workflowInstanceId: result.instanceId, closedAt: expect.any(Date) });
    expect(await prisma.auditEvent.count({ where: { resourceId: result.instanceId } })).toBe(5);
    expect(await prisma.outboxEvent.count({ where: { aggregateId: result.instanceId } })).toBe(5);
  });

  it('replays exact results without duplicate domain writes and rejects changed payloads', async () => {
    const context = await fixture();
    const started = await runtime.startInstance(context.start);
    expect(await runtime.startInstance({ ...context.start, traceId: randomUUID() })).toEqual(started);
    const input = { ...context.action(started), commandPayload: { content: 'first' } };
    let writes = 0;
    const mutate = async () => { writes += 1; };
    const result = await runtime.submitAction(input, undefined, mutate);
    expect(await runtime.submitAction(input, undefined, mutate)).toEqual(result);
    expect(writes).toBe(1);
    await expect(runtime.submitAction({ ...input, commandPayload: { content: 'changed' } })).rejects.toMatchObject({ status: 409, response: { code: 'IDEMPOTENCY_REPLAY' } });
    expect(await prisma.outboxEvent.count({ where: { aggregateId: started.instanceId } })).toBe(2);
  });

  it('permits exactly one simultaneous version update and returns 409 to the other', async () => {
    const context = await fixture();
    const started = await runtime.startInstance(context.start);
    const results = await Promise.allSettled([runtime.submitAction(context.action(started)), runtime.submitAction(context.action(started))]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.find((result) => result.status === 'rejected')).toMatchObject({ reason: { status: 409, response: { code: 'CONCURRENCY_CONFLICT' } } });
    expect(await prisma.outboxEvent.count({ where: { aggregateId: started.instanceId } })).toBe(2);
  });

  it('runs multiple independent problems on the same published definition', async () => {
    const context = await fixture();
    const otherProblem = await prisma.problemIndex.create({ data: { organizationId: context.organization.id, reportNumber: randomUUID(), domainCode: 'neutral-test', problemType: 'test', sourceType: 'neutral-record', sourceId: randomUUID(), severity: 'LOW' } });
    const first = await runtime.startInstance(context.start);
    const second = await runtime.startInstance({ ...context.start, problemIndexId: otherProblem.id, instanceKey: otherProblem.id, idempotencyKey: randomUUID() });
    const firstAction = await runtime.submitAction(context.action(first));
    const secondAction = await runtime.submitAction({ ...context.action(second), problemIndexId: otherProblem.id });
    expect(firstAction.version).toBe(2);
    expect(secondAction.version).toBe(2);
    expect(secondAction.instanceId).not.toBe(firstAction.instanceId);
  });

  it('rejects mutation receipts with foreign organization or workflow-version nodes at the database boundary', async () => {
    const context = await fixture();
    const other = await fixture();
    const started = await runtime.startInstance(context.start);
    const receipt = await prisma.workflowMutation.findFirstOrThrow({ where: { instanceId: started.instanceId } });
    await expect(prisma.workflowMutation.update({ where: { id: receipt.id }, data: { organizationId: other.organization.id } })).rejects.toMatchObject({ code: 'P2003' });
    const copied = await context.definitions.copyPublishedVersion({ organizationId: context.organization.id, userId: context.user.id, definitionId: String(context.definition.id) });
    const foreignNode = await prisma.workflowNode.findFirstOrThrow({ where: { workflowVersionId: String((copied.version as { id: string }).id) } });
    await expect(prisma.workflowMutation.update({ where: { id: receipt.id }, data: { nodeId: foreignNode.id } })).rejects.toMatchObject({ code: 'P2003' });
  });

  it('rechecks node authorization before replaying an old successful result', async () => {
    const context = await fixture();
    const started = await runtime.startInstance(context.start);
    const input = context.action(started);
    await runtime.submitAction(input);
    await prisma.role.update({ where: { id: context.role.id }, data: { code: 'OTHER' } });
    await expect(runtime.submitAction(input)).rejects.toMatchObject({ status: 403, response: { code: 'WORKFLOW_NODE_FORBIDDEN' } });
  });

  it('rejects a supplier acting on another owning organization even with a role grant', async () => {
    const context = await fixture();
    const supplierOrganization = await prisma.organization.create({ data: { code: randomUUID(), name: 'External participant', type: 'SUPPLIER' } });
    const supplier = await prisma.user.create({ data: { organizationId: supplierOrganization.id, username: randomUUID(), passwordHash: 'not-a-login-fixture', accountType: 'SUPPLIER' } });
    await prisma.userRole.create({ data: { userId: supplier.id, organizationId: context.organization.id, roleId: context.role.id } });
    await expect(runtime.startInstance({ ...context.start, actor: { id: supplier.id, organizationId: supplierOrganization.id, accountType: 'SUPPLIER' } })).rejects.toMatchObject({ status: 403, response: { code: 'ORGANIZATION_SCOPE_DENIED' } });
  });

  it('serializes simultaneous identical idempotency requests into one result', async () => {
    const context = await fixture();
    const started = await runtime.startInstance(context.start);
    const input = context.action(started);
    const results = await Promise.all([runtime.submitAction(input), runtime.submitAction(input)]);
    expect(results[0]).toEqual(results[1]);
    expect(await prisma.auditEvent.count({ where: { resourceId: started.instanceId } })).toBe(2);
  });

  it('requires current feature permission even for an otherwise authorized node and replay', async () => {
    const context = await fixture();
    const started = await runtime.startInstance(context.start);
    const input = context.action(started);
    await runtime.submitAction(input);
    await prisma.rolePermission.deleteMany({ where: { roleId: context.role.id, permission: { code: 'workflow:act' } } });
    await expect(runtime.submitAction(input)).rejects.toMatchObject({ status: 403, response: { code: 'FEATURE_PERMISSION_DENIED' } });
  });

  it.each(['permission', 'organization'] as const)('rejects revoked %s access while the action waits for the problem lock', async (revocation) => {
    const context = await fixture();
    const started = await runtime.startInstance(context.start);
    let releaseLock!: () => void;
    let locked!: () => void;
    const acquired = new Promise<void>((resolve) => { locked = resolve; });
    const release = new Promise<void>((resolve) => { releaseLock = resolve; });
    const holder = prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`SELECT id FROM problem_indexes WHERE id = ${context.problem.id}::uuid FOR UPDATE`;
      locked();
      await release;
    }, { timeout: 10_000 });
    await acquired;
    const pending = runtime.submitAction(context.action(started)).then((value) => ({ value }), (error: unknown) => ({ error }));
    try {
      let waiting = false;
      const deadline = Date.now() + 3_000;
      while (!waiting && Date.now() < deadline) {
        const rows = await prisma.$queryRaw<{ waiting: boolean }[]>`SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND query LIKE 'SELECT id FROM problem_indexes%') AS waiting`;
        waiting = rows[0]!.waiting;
        if (!waiting) await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(waiting).toBe(true);
      if (revocation === 'permission') await prisma.rolePermission.deleteMany({ where: { roleId: context.role.id, permission: { code: 'workflow:act' } } });
      else await prisma.organization.update({ where: { id: context.organization.id }, data: { status: 'DISABLED' } });
    } finally {
      releaseLock();
      await holder;
    }
    expect(await pending).toMatchObject({ error: { status: 403, response: { code: revocation === 'permission' ? 'FEATURE_PERMISSION_DENIED' : 'ORGANIZATION_DISABLED' } } });
    expect(await prisma.workflowInstance.findUnique({ where: { id: started.instanceId } })).toMatchObject({ version: 1 });
  });

  it('checks node role independently of feature permission', async () => {
    const context = await fixture();
    const started = await runtime.startInstance(context.start);
    await prisma.role.update({ where: { id: context.role.id }, data: { code: 'OTHER' } });
    await expect(runtime.submitAction(context.action(started))).rejects.toMatchObject({ status: 403, response: { code: 'WORKFLOW_NODE_FORBIDDEN' } });
  });

  it.each(['start', 'action'] as const)('rechecks authentication after the %s domain lock hook without holding the session lock prematurely', async (operation) => {
    const context = await fixture();
    const started = operation === 'action' ? await runtime.startInstance(context.start) : undefined;
    const session = await prisma.session.create({ data: { userId: context.user.id, tokenHash: randomUUID(), expiresAt: new Date(Date.now() + 60000) } });
    const input = { ...(started ? context.action(started) : context.start), actor: { ...context.start.actor, sessionId: session.id } };
    let mutated = false;
    const access: DomainAccess = async (_transaction, phase) => {
      expect(phase.replay).toBe(false);
      await prisma.$transaction(async (other) => {
        await other.$executeRawUnsafe("SET LOCAL lock_timeout = '500ms'");
        await other.session.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
      });
    };
    const execute = operation === 'start' ? runtime.startInstance.bind(runtime) : runtime.submitAction.bind(runtime);
    await expect(execute(input, undefined, async () => { mutated = true; }, access)).rejects.toMatchObject({ response: { code: 'AUTH_SESSION_REQUIRED' } });
    expect(mutated).toBe(false);
    expect(await prisma.problemIndex.findUnique({ where: { id: context.problem.id } })).toMatchObject({ version: started?.problemVersion ?? 1 });
  });

  it('rolls back domain-access writes when the final authorization recheck fails', async () => {
    const context = await fixture();
    const started = await runtime.startInstance(context.start);
    const access: DomainAccess = async (transaction, phase) => {
      expect(phase.replay).toBe(false);
      await transaction.organization.update({ where: { id: context.organization.id }, data: { name: 'uncommitted domain access' } });
      await transaction.rolePermission.deleteMany({ where: { roleId: context.role.id, permission: { code: 'workflow:act' } } });
    };

    await expect(runtime.submitAction(context.action(started), undefined, undefined, access))
      .rejects.toMatchObject({ status: 403, response: { code: 'FEATURE_PERMISSION_DENIED' } });
    expect(await prisma.organization.findUnique({ where: { id: context.organization.id } })).toMatchObject({ name: 'Neutral runtime' });
    expect(await prisma.rolePermission.count({ where: { roleId: context.role.id, permission: { code: 'workflow:act' } } })).toBe(1);
    expect(await prisma.workflowInstance.findUnique({ where: { id: started.instanceId } })).toMatchObject({ version: 1 });
  });

  it('rechecks domain authorization on idempotent start and action replay without repeating domain mutation', async () => {
    const context = await fixture();
    const phases: boolean[] = [];
    const access: DomainAccess = async (transaction, phase) => {
      phases.push(phase.replay);
      const problem = await transaction.problemIndex.findUniqueOrThrow({ where: { id: context.problem.id } });
      if (problem.responsibleParty === 'DOMAIN_ACCESS_REVOKED') throw new Error('DOMAIN_ACCESS_DENIED');
    };
    let mutations = 0;
    const started = await runtime.startInstance(context.start, undefined, async () => { mutations++; }, access);
    expect(await runtime.startInstance(context.start, undefined, async () => { mutations++; }, access)).toEqual(started);
    const command = context.action(started);
    const acted = await runtime.submitAction(command, undefined, async () => { mutations++; }, access);
    expect(await runtime.submitAction(command, undefined, async () => { mutations++; }, access)).toEqual(acted);
    expect(phases).toEqual([false, true, false, true]);
    expect(mutations).toBe(2);
    await prisma.problemIndex.update({ where: { id: context.problem.id }, data: { responsibleParty: 'DOMAIN_ACCESS_REVOKED' } });
    await expect(runtime.startInstance(context.start, undefined, undefined, access)).rejects.toThrow('DOMAIN_ACCESS_DENIED');
    await expect(runtime.submitAction(command, undefined, undefined, access)).rejects.toThrow('DOMAIN_ACCESS_DENIED');
    expect(await prisma.workflowInstance.findUnique({ where: { id: started.instanceId } })).toMatchObject({ version: acted.version });
  });

  it('prelocks a shared domain resource before authentication so a concurrent domain reader can finish', async () => {
    const context = await fixture();
    const started = await runtime.startInstance(context.start);
    const session = await prisma.session.create({ data: { userId: context.user.id, tokenHash: randomUUID(), expiresAt: new Date(Date.now() + 60000) } });
    let readerReady!: () => void;
    let domainRequested!: () => void;
    const ready = new Promise<void>((resolve) => { readerReady = resolve; });
    const requested = new Promise<void>((resolve) => { domainRequested = resolve; });
    const reader = prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`SELECT id FROM roles WHERE id = ${context.role.id}::uuid FOR SHARE`;
      readerReady();
      await requested;
      await transaction.$queryRaw`SELECT id FROM users WHERE id = ${context.user.id}::uuid FOR UPDATE NOWAIT`;
      return true;
    }, { timeout: 10000 }).then((value) => ({ value }), (error: unknown) => ({ error }));
    await ready;
    const lockDomain: Mutation = async (transaction) => {
      domainRequested();
      await transaction.$queryRaw`SELECT id FROM roles WHERE id = ${context.role.id}::uuid FOR UPDATE`;
    };
    const result = await runtime.submitAction({ ...context.action(started), actor: { ...context.start.actor, sessionId: session.id } }, undefined, lockDomain, lockDomain);
    expect(await reader).toEqual({ value: true });
    expect(result.version).toBe(2);
  });

  it('requires the node assignee and extra permission in addition to its role', async () => {
    const context = await fixture({ exactAssignment: true });
    const started = await runtime.startInstance(context.start);
    await expect(runtime.submitAction({ ...context.action(started), actor: await secondActor(context) })).rejects.toMatchObject({ status: 403, response: { code: 'WORKFLOW_NODE_FORBIDDEN' } });
    await prisma.rolePermission.deleteMany({ where: { roleId: context.role.id, permission: { code: 'workflow:start' } } });
    await expect(runtime.submitAction(context.action(started))).rejects.toMatchObject({ status: 403, response: { code: 'WORKFLOW_NODE_FORBIDDEN' } });
  });

  it('rejects ambiguous and unmatched branches without invoking the domain mutation', async () => {
    const ambiguous = await fixture({ ambiguous: true });
    const started = await runtime.startInstance(ambiguous.start);
    let mutated = false;
    await expect(runtime.submitAction(ambiguous.action(started), undefined, async () => { mutated = true; })).rejects.toMatchObject({ status: 409, response: { code: 'WORKFLOW_TRANSITION_AMBIGUOUS' } });
    expect(mutated).toBe(false);
    const unmatched = await fixture({ bypassVerification: true });
    await prisma.problemIndex.update({ where: { id: unmatched.problem.id }, data: { severity: 'MEDIUM' } });
    const pending = await runtime.submitAction(unmatched.action(await runtime.startInstance(unmatched.start)));
    await expect(runtime.submitAction(unmatched.action(pending, 'APPROVE'))).rejects.toMatchObject({ status: 409, response: { code: 'WORKFLOW_TRANSITION_AMBIGUOUS' } });
  });

  it('rejects disabled accounts and forged session identity', async () => {
    const context = await fixture();
    await expect(runtime.startInstance({ ...context.start, actor: { ...context.start.actor, organizationId: randomUUID() } })).rejects.toMatchObject({ status: 401 });
    await prisma.user.update({ where: { id: context.user.id }, data: { status: 'DISABLED' } });
    await expect(runtime.startInstance(context.start)).rejects.toMatchObject({ status: 401 });
  });

  it('rejects cross-organization problem and frozen-version mismatch', async () => {
    const context = await fixture();
    const other = await fixture();
    await expect(runtime.startInstance({ ...context.start, problemIndexId: other.problem.id })).rejects.toMatchObject({ status: 404 });
    const started = await runtime.startInstance(context.start);
    await expect(runtime.submitAction({ ...context.action(started), workflowVersionId: other.version.id })).rejects.toMatchObject({ status: 409, response: { code: 'WORKFLOW_VERSION_MISMATCH' } });
  });

  it('rejects wrong action, stale problem version and stale node without side effects', async () => {
    const context = await fixture();
    const started = await runtime.startInstance(context.start);
    await expect(runtime.submitAction(context.action(started, 'APPROVE'))).rejects.toMatchObject({ status: 409, response: { code: 'WORKFLOW_ACTION_INVALID' } });
    await expect(runtime.submitAction({ ...context.action(started), expectedProblemVersion: 1 })).rejects.toMatchObject({ status: 409 });
    await expect(runtime.submitAction({ ...context.action(started), currentNodeId: context.nodeId('close') })).rejects.toMatchObject({ status: 409 });
    expect(await prisma.outboxEvent.count({ where: { aggregateId: started.instanceId } })).toBe(1);
  });

  it('rolls back outer domain transaction including instance, index, audit and event', async () => {
    const context = await fixture();
    await expect(prisma.$transaction(async (transaction) => {
      await transaction.organization.update({ where: { id: context.organization.id }, data: { name: 'uncommitted domain state' } });
      await runtime.startInstance(context.start, transaction);
      throw new Error('DOMAIN_FAILURE');
    })).rejects.toThrow('DOMAIN_FAILURE');
    expect(await prisma.workflowInstance.count({ where: { organizationId: context.organization.id } })).toBe(0);
    expect(await prisma.problemIndex.findUnique({ where: { id: context.problem.id } })).toMatchObject({ version: 1, workflowInstanceId: null });
    expect(await prisma.organization.findUnique({ where: { id: context.organization.id } })).toMatchObject({ name: 'Neutral runtime' });
    expect(await prisma.auditEvent.count({ where: { organizationId: context.organization.id, action: 'WORKFLOW_STARTED' } })).toBe(0);
    expect((await runtime.startInstance(context.start)).version).toBe(1);
  });

  it.each(['RepeatableRead', 'Serializable'] as const)('rejects an outer %s snapshot that cannot observe revocation after waiting', async (isolationLevel) => {
    const context = await fixture();
    let mutated = false;
    await expect(prisma.$transaction((transaction) => runtime.startInstance(context.start, transaction, async () => { mutated = true; }), { isolationLevel })).rejects.toMatchObject({ status: 409, response: { code: 'WORKFLOW_TRANSACTION_ISOLATION_UNSUPPORTED' } });
    expect(mutated).toBe(false);
    expect(await prisma.workflowInstance.count({ where: { organizationId: context.organization.id } })).toBe(0);
  });

  it.each(['audit', 'outbox'] as const)('rolls back domain mutation when %s fails', async (failure) => {
    const context = await fixture();
    const started = await runtime.startInstance(context.start);
    const failingAudit = failure === 'audit' ? { record: async () => { throw new Error('AUDIT_FAILURE'); } } : audit;
    const failingOutbox = failure === 'outbox' ? { enqueue: async () => { throw new Error('OUTBOX_FAILURE'); } } : outbox;
    const failing = new WorkflowRuntimeService(prisma, failingAudit as AuditLogService, failingOutbox as OutboxService, problems) as unknown as Runtime;
    await expect(failing.submitAction({ ...context.action(started), commandPayload: { name: 'changed' } }, undefined, async (transaction) => {
      await transaction.organization.update({ where: { id: context.organization.id }, data: { name: 'changed' } });
    })).rejects.toThrow('FAILURE');
    expect(await prisma.organization.findUnique({ where: { id: context.organization.id } })).toMatchObject({ name: 'Neutral runtime' });
    expect(await prisma.workflowInstance.findUnique({ where: { id: started.instanceId } })).toMatchObject({ version: 1 });
    expect(await prisma.outboxEvent.count({ where: { aggregateId: started.instanceId } })).toBe(1);
  });
});
