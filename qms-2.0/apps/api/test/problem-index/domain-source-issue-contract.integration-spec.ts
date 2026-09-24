import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import type { Prisma } from '../../src/generated/prisma/client.js';
import { PrismaService } from '../../src/database/prisma.service.js';
import { AuditLogService } from '../../src/modules/audit-log/audit-log.service.js';
import { NumberingService } from '../../src/modules/problem-index/numbering.service.js';
import { ProblemIndexService } from '../../src/modules/problem-index/problem-index.service.js';
import {
  DomainSourceIssueService, type DomainSourceIssueAdapters, type DomainSourceIssueCommand,
} from '../../src/modules/problem-index/domain-source-issue.service.js';
import { OutboxService } from '../../src/modules/task-notification/outbox.service.js';
import { WorkflowRuntimeService } from '../../src/modules/workflow/workflow-runtime.service.js';
import { WorkflowDefinitionService } from '../../src/modules/workflow/workflow-definition.service.js';
import { WorkflowValidationService } from '../../src/modules/workflow/workflow-validation.service.js';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl || process.env.QMS_DISPOSABLE_TEST_DB !== 'true') throw new Error('Disposable PostgreSQL DATABASE_URL and QMS_DISPOSABLE_TEST_DB=true are required.');
if (new URL(databaseUrl).port === '55440') throw new Error('Reserved preview database port 55440 is forbidden.');

describe('PostgreSQL domain source to issue contract', () => {
  const prisma = new PrismaService(databaseUrl);
  const numbering = new NumberingService(prisma);
  const audit = new AuditLogService(prisma);
  const outbox = new OutboxService(prisma);
  const problems = new ProblemIndexService(prisma, numbering, audit, outbox);
  const runtime = new WorkflowRuntimeService(prisma, audit, outbox, problems);
  const definitions = new WorkflowDefinitionService(prisma, new WorkflowValidationService(), audit);
  const service = new DomainSourceIssueService(prisma, problems, outbox);
  const sourceTable = `test_domain_source_${randomUUID().replaceAll('-', '')}`;
  let organizationId: string;
  let actorUserId: string;
  let sessionId: string;
  let roleId: string;
  const createdPermissionIds: string[] = [];
  let workflowDefinitionId: string;
  let workflowVersionId: string;

  beforeAll(async () => {
    await prisma.$connect();
    const [server] = await prisma.$queryRaw<{ server_version_num: string }[]>`SHOW server_version_num`;
    expect(Number(server!.server_version_num)).toBeGreaterThanOrEqual(180000);
    await prisma.$executeRawUnsafe(`CREATE TABLE "${sourceTable}" (id uuid PRIMARY KEY, organization_id uuid NOT NULL, source_version integer NOT NULL, source_snapshot jsonb NOT NULL, created_by varchar(128) NOT NULL, archived_at timestamptz)`);
    organizationId = randomUUID();
    actorUserId = randomUUID();
    sessionId = randomUUID();
    await prisma.organization.create({ data: { id: organizationId, code: `SRC-${organizationId.slice(0, 8)}`, name: 'Source contract integration', type: 'INTERNAL' } });
    await prisma.user.create({ data: { id: actorUserId, organizationId, username: `source-${actorUserId.slice(0, 8)}`, passwordHash: 'not-a-login-fixture', accountType: 'INTERNAL' } });
    await prisma.session.create({ data: { id: sessionId, userId: actorUserId, tokenHash: randomUUID(), expiresAt: new Date(Date.now() + 3_600_000) } });
    const role = await prisma.role.create({ data: { organizationId, code: 'SOURCE_HANDLER', name: 'Source handler' } });
    roleId = role.id;
    for (const code of ['workflow:start', 'process-quality:issues:create']) {
      const existing = await prisma.permission.findUnique({ where: { code }, select: { id: true } });
      const permission = await prisma.permission.upsert({ where: { code }, create: { code, name: code }, update: {} });
      if (!existing) createdPermissionIds.push(permission.id);
      await prisma.rolePermission.create({ data: { roleId: role.id, permissionId: permission.id } });
    }
    await prisma.userRole.create({ data: { userId: actorUserId, organizationId, roleId: role.id } });
    await numbering.publishRuleVersion({ organizationId, ruleCode: 'PROBLEM', pattern: '{CODE}-{YYMM}-{SEQ3}' });
    const draft = await definitions.createDraft({ organizationId, userId: actorUserId, code: randomUUID(), name: 'Source issue workflow', draft: {
      nodes: [
        { id: 'handle', type: 'ACTION', name: 'Handle', config: { isStart: true, assignment: { roleCode: 'SOURCE_HANDLER' } } },
        { id: 'approve', type: 'APPROVAL', name: 'Approve', config: { assignment: { roleCode: 'SOURCE_HANDLER' } } },
        { id: 'verify', type: 'VERIFICATION', name: 'Verify', config: { assignment: { roleCode: 'SOURCE_HANDLER' } } },
        { id: 'close', type: 'CLOSE', name: 'Close', config: { isEnd: true, assignment: { roleCode: 'SOURCE_HANDLER' } } },
      ],
      transitions: [
        { id: 'submit', from: 'handle', to: 'approve' }, { id: 'approve', from: 'approve', to: 'verify' }, { id: 'verify', from: 'verify', to: 'close' },
      ],
    } });
    workflowDefinitionId = String(draft.id);
    workflowVersionId = String((await definitions.publishVersion({ organizationId, userId: actorUserId, definitionId: workflowDefinitionId })).id);
  });

  afterAll(async () => {
    try {
      if (organizationId) {
        const problemsToClean = await prisma.problemIndex.findMany({ where: { organizationId }, select: { id: true } });
        const instancesToClean = await prisma.workflowInstance.findMany({ where: { organizationId }, select: { id: true } });
        const problemIds = problemsToClean.map(({ id }) => id);
        const instanceIds = instancesToClean.map(({ id }) => id);
        await prisma.outboxEvent.deleteMany({ where: { OR: [
          { aggregateType: { in: ['ProblemIndex', 'DomainSourceIssue'] }, aggregateId: { in: problemIds } },
          { aggregateType: 'WorkflowInstance', aggregateId: { in: instanceIds } },
        ] } });
        await prisma.notification.deleteMany({ where: { organizationId } });
        await prisma.workflowTask.deleteMany({ where: { organizationId } });
        await prisma.workflowMutation.deleteMany({ where: { organizationId } });
        await prisma.domainSourceIssueLink.deleteMany({ where: { organizationId } });
        await prisma.problemIndex.updateMany({ where: { organizationId }, data: { workflowInstanceId: null } });
        await prisma.workflowInstance.deleteMany({ where: { organizationId } });
        await prisma.problemIndex.deleteMany({ where: { organizationId } });
        await prisma.workflowTransition.deleteMany({ where: { organizationId } });
        await prisma.workflowNode.deleteMany({ where: { organizationId } });
        await prisma.workflowVersion.deleteMany({ where: { organizationId } });
        await prisma.workflowDefinition.deleteMany({ where: { organizationId } });
        await prisma.numberSequence.deleteMany({ where: { organizationId } });
        await prisma.numberRuleVersion.deleteMany({ where: { organizationId } });
        await prisma.auditEvent.deleteMany({ where: { organizationId } });
        await prisma.userRole.deleteMany({ where: { organizationId } });
        await prisma.rolePermission.deleteMany({ where: { roleId } });
        await prisma.role.deleteMany({ where: { id: roleId } });
        const users = await prisma.user.findMany({ where: { organizationId }, select: { id: true } });
        await prisma.session.deleteMany({ where: { userId: { in: users.map(({ id }) => id) } } });
        await prisma.user.deleteMany({ where: { organizationId } });
        await prisma.organization.delete({ where: { id: organizationId } });
        await prisma.permission.deleteMany({ where: { id: { in: createdPermissionIds } } });
      }
    } finally {
      await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS "${sourceTable}"`);
      await prisma.$disconnect();
    }
  });

  async function createSource(input: { organizationId?: string; version?: number; severity?: string; archived?: boolean } = {}) {
    const id = randomUUID();
    const snapshot = { reportNumber: `SOURCE-${id.slice(0, 8)}`, severity: input.severity ?? 'MEDIUM' };
    await prisma.$executeRawUnsafe(
      `INSERT INTO "${sourceTable}" (id, organization_id, source_version, source_snapshot, created_by, archived_at) VALUES ($1::uuid, $2::uuid, $3, $4::jsonb, $5, $6::timestamptz)`,
      id, input.organizationId ?? organizationId, input.version ?? 3, JSON.stringify(snapshot), actorUserId, input.archived ? new Date() : null,
    );
    return { sourceDomain: 'process-quality', sourceType: 'process-defect-ledger', sourceId: id, sourceVersion: input.version ?? 3, sourceSnapshot: snapshot, createdBy: actorUserId };
  }

  function command(source: DomainSourceIssueCommand['source'], extra: Partial<DomainSourceIssueCommand> = {}): DomainSourceIssueCommand {
    return {
      organizationId,
      actor: { id: actorUserId, organizationId, accountType: 'INTERNAL', sessionId },
      source,
      problemType: 'PROCESS_DEFECT', responseForm: 'EIGHT_D', responsibleScope: 'manufacturing', severity: 'HIGH',
      idempotencyKey: randomUUID(), traceId: randomUUID(),
      workflowBinding: { workflowDefinitionId, workflowVersionId, instanceKey: randomUUID() },
      ...extra,
    };
  }

  const lockAndResolve: DomainSourceIssueAdapters['lockAndResolve'] = async (tx, source) => {
    const [record] = await tx.$queryRawUnsafe<Array<{ organization_id: string; source_version: number; source_snapshot: Prisma.InputJsonObject; created_by: string; archived_at: Date | null }>>(
      `SELECT organization_id, source_version, source_snapshot, created_by, archived_at FROM "${sourceTable}" WHERE id = $1::uuid FOR UPDATE`, source.sourceId,
    );
    return record ? { organizationId: record.organization_id, sourceVersion: record.source_version, sourceSnapshot: record.source_snapshot, createdBy: record.created_by, archivedAt: record.archived_at } : null;
  };

  function adapters(overrides: Partial<DomainSourceIssueAdapters> = {}): DomainSourceIssueAdapters {
    return {
      authorize: async (tx, requested) => {
        const assigned = await tx.userRole.findFirst({ where: { organizationId: requested.organizationId, userId: requested.actor.id,
          role: { permissions: { some: { permission: { code: 'process-quality:issues:create' } } } } }, select: { userId: true } });
        if (!assigned) throw new Error('DOMAIN_ISSUE_FORBIDDEN');
      },
      lockAndResolve,
      bindWorkflow: async (tx, binding) => runtime.startInstance({
        organizationId: binding.organizationId, actor: binding.actor, problemIndexId: binding.problemIndexId,
        workflowDefinitionId: binding.workflowBinding.workflowDefinitionId, workflowVersionId: binding.workflowBinding.workflowVersionId,
        expectedProblemVersion: binding.expectedProblemVersion, instanceKey: binding.workflowBinding.instanceKey,
        idempotencyKey: binding.idempotencyKey, traceId: binding.traceId,
      }, tx),
      ...overrides,
    };
  }

  it('persists a source link and starts a real workflow in one transaction', async () => {
    const source = await createSource();
    const result = await service.issue(command(source), adapters());
    const problem = await prisma.problemIndex.findUniqueOrThrow({ where: { id: String(result.problem.id) } });
    const link = await prisma.domainSourceIssueLink.findFirstOrThrow({ where: { organizationId, problemIndexId: problem.id } });
    const instance = await prisma.workflowInstance.findUniqueOrThrow({ where: { id: problem.workflowInstanceId! } });
    expect(problem).toMatchObject({ sourceType: source.sourceType, sourceId: source.sourceId, version: 2 });
    expect(link).toMatchObject({ sourceDomain: source.sourceDomain, sourceType: source.sourceType, sourceId: source.sourceId, sourceVersion: 3, sourceSnapshot: source.sourceSnapshot, createdBy: source.createdBy });
    expect(instance).toMatchObject({ problemIndexId: problem.id, workflowVersionId });
    expect(await prisma.outboxEvent.count({ where: { aggregateId: problem.id, aggregateType: 'DomainSourceIssue' } })).toBe(1);
    await prisma.$executeRawUnsafe(`DELETE FROM "${sourceTable}" WHERE id = $1::uuid`, source.sourceId);
    expect(await prisma.domainSourceIssueLink.findFirst({ where: { problemIndexId: problem.id } })).not.toBeNull();
    expect(await prisma.problemIndex.findUnique({ where: { id: problem.id } })).not.toBeNull();
  });

  it('supports several sources per issue and several issues per source', async () => {
    const first = await createSource();
    const second = await createSource();
    const issuedA = await service.issue(command(first, { additionalSources: [second] }), adapters());
    const issuedB = await service.issue(command(first), adapters());
    expect(issuedA.problem.id).not.toBe(issuedB.problem.id);
    expect(await prisma.domainSourceIssueLink.count({ where: { sourceId: first.sourceId } })).toBe(2);
    expect(await prisma.domainSourceIssueLink.count({ where: { problemIndexId: String(issuedA.problem.id) } })).toBe(2);
    expect(await prisma.problemIndex.findUniqueOrThrow({ where: { id: String(issuedB.problem.id) } })).toMatchObject({ sourceType: first.sourceType, sourceId: first.sourceId });
  });

  it('locks opposite source selections in the same stable order under concurrent issuance', async () => {
    const first = await createSource();
    const second = await createSource();
    const secondUser = await prisma.user.create({ data: { organizationId, username: randomUUID(), passwordHash: 'not-a-login-fixture', accountType: 'INTERNAL' } });
    const secondSession = await prisma.session.create({ data: { userId: secondUser.id, tokenHash: randomUUID(), expiresAt: new Date(Date.now() + 3_600_000) } });
    await prisma.userRole.create({ data: { userId: secondUser.id, organizationId, roleId } });
    const firstOrder: string[] = [];
    const secondOrder: string[] = [];
    const withOrder = (order: string[]) => adapters({ lockAndResolve: async (tx, source) => {
      order.push(source.sourceId);
      return lockAndResolve(tx, source);
    } });
    const opposite = command(second, { additionalSources: [first], actor: { id: secondUser.id, organizationId, accountType: 'INTERNAL', sessionId: secondSession.id } });
    const [issuedA, issuedB] = await Promise.all([
      service.issue(command(first, { additionalSources: [second] }), withOrder(firstOrder)),
      service.issue(opposite, withOrder(secondOrder)),
    ]);
    const expectedOrder = [first.sourceId, second.sourceId].sort();
    expect(firstOrder).toEqual(expectedOrder);
    expect(secondOrder).toEqual(expectedOrder);
    expect(issuedA.problem.id).not.toBe(issuedB.problem.id);
  });

  it('rejects missing, cross-organization, stale and archived sources before writes', async () => {
    const source = await createSource();
    const other = await createSource({ organizationId: randomUUID() });
    const archived = await createSource({ archived: true });
    const cases = [
      [command({ ...source, sourceId: randomUUID() }), 'SOURCE_NOT_FOUND'],
      [command(other), 'SOURCE_ORGANIZATION_FORBIDDEN'],
      [command({ ...source, sourceVersion: 2 }), 'SOURCE_VERSION_CONFLICT'],
      [command(archived), 'SOURCE_ARCHIVED'],
    ] as const;
    for (const [requested, code] of cases) await expect(service.issue(requested, adapters())).rejects.toMatchObject({ response: { code } });
    expect(await prisma.domainSourceIssueLink.count({ where: { sourceId: source.sourceId } })).toBe(0);
  });

  it('replays one key and rejects changed payload without a second workflow', async () => {
    const source = await createSource();
    const requested = command(source);
    const first = await service.issue(requested, adapters());
    const replay = await service.issue(requested, adapters());
    expect(replay).toMatchObject({ replayed: true, problem: { id: first.problem.id } });
    expect(replay.problem).toEqual(first.problem);
    expect(await prisma.workflowInstance.count({ where: { problemIndexId: String(first.problem.id) } })).toBe(1);
    await expect(service.issue({ ...requested, severity: 'LOW' }, adapters())).rejects.toMatchObject({ status: 409, response: { code: 'IDEMPOTENCY_REPLAY' } });
  });

  it('rejects the same key with a different dueAt and an invalid dueAt', async () => {
    const source = await createSource();
    const requested = command(source, { dueAt: new Date('2026-10-01T00:00:00.000Z') });
    await service.issue(requested, adapters());
    await expect(service.issue({ ...requested, dueAt: new Date('2026-10-02T00:00:00.000Z') }, adapters()))
      .rejects.toMatchObject({ status: 409, response: { code: 'IDEMPOTENCY_REPLAY' } });
    await expect(service.issue(command(source, { dueAt: new Date(Number.NaN) }), adapters()))
      .rejects.toMatchObject({ status: 400, response: { code: 'SOURCE_ISSUE_DUE_AT_INVALID' } });
  });

  it('rolls back the index and source link if workflow binding fails', async () => {
    const source = await createSource();
    const requested = command(source);
    await expect(service.issue(requested, adapters({ bindWorkflow: async () => { throw new Error('WORKFLOW_BINDING_FAILED'); } }))).rejects.toThrow('WORKFLOW_BINDING_FAILED');
    expect(await prisma.problemIndex.count({ where: { organizationId, sourceId: source.sourceId } })).toBe(0);
    expect(await prisma.domainSourceIssueLink.count({ where: { sourceId: source.sourceId } })).toBe(0);
  });

  it('rolls back the index, workflow and links if the final Outbox write fails', async () => {
    const source = await createSource();
    const requested = command(source);
    const failingOutbox = { enqueue: async () => { throw new Error('DOMAIN_OUTBOX_FAILED'); } };
    const failingService = new DomainSourceIssueService(prisma, problems, failingOutbox as never);
    await expect(failingService.issue(requested, adapters())).rejects.toThrow('DOMAIN_OUTBOX_FAILED');
    expect(await prisma.problemIndex.count({ where: { organizationId, sourceId: source.sourceId } })).toBe(0);
    expect(await prisma.domainSourceIssueLink.count({ where: { sourceId: source.sourceId } })).toBe(0);
    expect(await prisma.workflowInstance.count({ where: { organizationId, instanceKey: requested.workflowBinding.instanceKey } })).toBe(0);
  });

  it('rolls back before binding if the problem audit write fails', async () => {
    const source = await createSource();
    const requested = command(source);
    const failingAudit = { record: async () => { throw new Error('PROBLEM_AUDIT_FAILED'); } };
    const failingProblems = new ProblemIndexService(prisma, numbering, failingAudit as never, outbox);
    const failingService = new DomainSourceIssueService(prisma, failingProblems, outbox);
    await expect(failingService.issue(requested, adapters())).rejects.toThrow('PROBLEM_AUDIT_FAILED');
    expect(await prisma.problemIndex.count({ where: { organizationId, sourceId: source.sourceId } })).toBe(0);
    expect(await prisma.domainSourceIssueLink.count({ where: { sourceId: source.sourceId } })).toBe(0);
  });

  it('does not accept a no-op workflow adapter', async () => {
    const source = await createSource();
    const requested = command(source);
    await expect(service.issue(requested, adapters({ bindWorkflow: async () => ({ instanceId: randomUUID() }) }))).rejects.toThrow('SOURCE_ISSUE_WORKFLOW_NOT_BOUND');
    expect(await prisma.problemIndex.count({ where: { organizationId, sourceId: source.sourceId } })).toBe(0);
  });

  it('keeps supplier source uniqueness after the new domain migration', async () => {
    const sourceId = randomUUID();
    const data = { organizationId, reportNumber: randomUUID(), domainCode: 'supplier-quality', problemType: '8D', sourceType: 'supplier-quality', sourceId, severity: 'HIGH' };
    await prisma.problemIndex.create({ data });
    await expect(prisma.problemIndex.create({ data: { ...data, reportNumber: randomUUID() } })).rejects.toMatchObject({ code: 'P2002' });
  });

  it('rechecks the active session on idempotent replay', async () => {
    const source = await createSource();
    const replaySession = await prisma.session.create({ data: { userId: actorUserId, tokenHash: randomUUID(), expiresAt: new Date(Date.now() + 3_600_000) } });
    const requested = command(source, { actor: { id: actorUserId, organizationId, accountType: 'INTERNAL', sessionId: replaySession.id } });
    await service.issue(requested, adapters());
    await prisma.session.update({ where: { id: replaySession.id }, data: { revokedAt: new Date() } });
    await expect(service.issue(requested, adapters())).rejects.toMatchObject({ response: { code: 'AUTH_SESSION_REQUIRED' } });
  });
});
