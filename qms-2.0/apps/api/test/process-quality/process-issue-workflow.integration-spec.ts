import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../src/database/prisma.service.js';
import { AdminMutationService } from '../../src/common/security/admin-mutation.service.js';
import { AuditLogService } from '../../src/modules/audit-log/audit-log.service.js';
import { ProcessDefectLedgerService } from '../../src/modules/process-quality/process-defect-ledger.service.js';
import { ProcessIssueService } from '../../src/modules/process-quality/process-issue.service.js';
import { NumberingService } from '../../src/modules/problem-index/numbering.service.js';
import { ProblemIndexService } from '../../src/modules/problem-index/problem-index.service.js';
import { DomainSourceIssueService } from '../../src/modules/problem-index/domain-source-issue.service.js';
import { OutboxService } from '../../src/modules/task-notification/outbox.service.js';
import { WorkflowDefinitionService } from '../../src/modules/workflow/workflow-definition.service.js';
import { WorkflowValidationService } from '../../src/modules/workflow/workflow-validation.service.js';
import { WorkflowRuntimeService } from '../../src/modules/workflow/workflow-runtime.service.js';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl || process.env.QMS_DISPOSABLE_TEST_DB !== 'true' || new URL(databaseUrl).port === '55440') {
  throw new Error('An independent disposable PostgreSQL database is required');
}

describe('process defect issue workflow on PostgreSQL', () => {
  const prisma = new PrismaService(databaseUrl);
  const audit = new AuditLogService(prisma);
  const outbox = new OutboxService(prisma);
  const numbering = new NumberingService(prisma);
  const problems = new ProblemIndexService(prisma, numbering, audit, outbox);
  const runtime = new WorkflowRuntimeService(prisma, audit, outbox, problems);
  const domainIssues = new DomainSourceIssueService(prisma, problems, outbox);
  const ledger = new ProcessDefectLedgerService(prisma, new AdminMutationService(prisma, audit), audit);
  const service = new ProcessIssueService(prisma, ledger, domainIssues, runtime);
  const organizationId = randomUUID();
  const otherOrganizationId = randomUUID();
  const userId = randomUUID();
  const sessionId = randomUUID();
  const actor = { id: userId, organizationId, accountType: 'INTERNAL' as const, sessionId };
  let workflowDefinitionId: string;
  let workflowVersionId: string;

  beforeAll(async () => {
    await prisma.$connect();
    const [server] = await prisma.$queryRaw<{ server_version_num: string }[]>`SHOW server_version_num`;
    expect(Number(server!.server_version_num)).toBeGreaterThanOrEqual(180000);
    for (const [id, suffix] of [[organizationId, 'main'], [otherOrganizationId, 'other']]) {
      await prisma.organization.create({ data: { id, code: `PI-${suffix}-${id.slice(0, 8)}`, name: suffix, type: 'INTERNAL' } });
    }
    await prisma.user.create({ data: { id: userId, organizationId, username: `pqe-${userId.slice(0, 8)}`, accountType: 'INTERNAL', passwordHash: 'test-only' } });
    await prisma.session.create({ data: { id: sessionId, userId, tokenHash: randomUUID(), expiresAt: new Date(Date.now() + 3_600_000), reauthenticatedAt: new Date() } });
    const role = await prisma.role.create({ data: { organizationId, code: 'PROCESS_HANDLER', name: 'Process handler' } });
    for (const code of ['workflow:start', 'process-quality:defects:read', 'process-quality:defects:write']) {
      const permission = await prisma.permission.upsert({ where: { code }, create: { code, name: code }, update: {} });
      await prisma.rolePermission.create({ data: { roleId: role.id, permissionId: permission.id } });
    }
    await prisma.userRole.create({ data: { userId, organizationId, roleId: role.id } });
    await numbering.publishRuleVersion({ organizationId, ruleCode: 'PROBLEM', pattern: '{CODE}-{YYMM}-{SEQ3}' });
    const definitions = new WorkflowDefinitionService(prisma, new WorkflowValidationService(), audit);
    const draft = await definitions.createDraft({ organizationId, userId, code: 'PROCESS_BRIEF', name: 'Process issue', draft: {
      nodes: [
        { id: 'handle', type: 'ACTION', name: 'Handle', config: { isStart: true, assignment: { roleCode: 'PROCESS_HANDLER' } } },
        { id: 'verify', type: 'VERIFICATION', name: 'Verify', config: { assignment: { roleCode: 'PROCESS_HANDLER' } } },
        { id: 'close', type: 'CLOSE', name: 'Close', config: { isEnd: true, requireIndependentVerification: true, assignment: { roleCode: 'PROCESS_HANDLER' } } },
      ],
      transitions: [{ id: 'submit', from: 'handle', to: 'verify' }, { id: 'verify', from: 'verify', to: 'close' }],
    } });
    workflowDefinitionId = draft.id;
    workflowVersionId = (await definitions.publishVersion({ organizationId, userId, definitionId: draft.id })).id;
    await ledger.createDefectType(actor, { code: 'OXIDATION', name: '氧化' }, randomUUID(), randomUUID());
  });

  afterAll(async () => { await prisma.$disconnect(); });

  async function defect(owner = actor) {
    return ledger.create(owner, { defectTypeCode: 'OXIDATION', description: '端子氧化', defectQuantity: 3,
      occurredAt: new Date('2026-09-24T00:00:00Z'), responsibilityCategory: 'MATERIAL' }, randomUUID(), randomUUID());
  }

  function input(sources: Array<{ id: string; version: number }>) {
    return { sources: sources.map(({ id, version }) => ({ defectId: id, expectedVersion: version })), problemType: 'PROCESS_DEFECT',
      responseForm: 'BRIEF' as const, responsibleScope: 'process-quality', severity: 'HIGH',
      workflowBinding: { workflowDefinitionId, workflowVersionId, instanceKey: randomUUID() } };
  }

  it('issues one problem for several defects with immutable links, workflow, audit and outbox', async () => {
    const first = await defect();
    const second = await defect();
    const request = input([first, second]);
    const result = await service.issue(actor, request, randomUUID(), randomUUID());
    const problemId = String(result.problem.id);
    const problem = await prisma.problemIndex.findUniqueOrThrow({ where: { id: problemId } });
    const links = await prisma.domainSourceIssueLink.findMany({ where: { problemIndexId: problemId }, orderBy: { sourceId: 'asc' } });
    expect(problem).toMatchObject({ sourceId: first.id, sourceType: 'process-defect', version: 2 });
    expect(problem.reportNumber).toMatch(/^PROCESS-QUALITY-/);
    expect(links).toHaveLength(2);
    expect(links.map((link) => link.sourceId).sort()).toEqual([first.id, second.id].sort());
    expect(links[0]?.sourceSnapshot).toMatchObject({ description: '端子氧化', defectQuantity: 3 });
    expect(await prisma.workflowInstance.count({ where: { problemIndexId: problemId, workflowVersionId } })).toBe(1);
    expect(await prisma.auditEvent.count({ where: { resourceId: problemId, action: 'PROBLEM_INDEX_CREATED' } })).toBe(1);
    expect(await prisma.outboxEvent.count({ where: { aggregateId: problemId, aggregateType: 'DomainSourceIssue' } })).toBe(1);
    await ledger.archive(actor, first.id, first.version, randomUUID(), randomUUID());
    expect(await service.problemsForDefect(actor, first.id)).toEqual(expect.arrayContaining([expect.objectContaining({ id: problemId })]));
    expect((await prisma.domainSourceIssueLink.findFirstOrThrow({ where: { sourceId: first.id, problemIndexId: problemId } })).sourceSnapshot).toMatchObject({ description: '端子氧化' });
  });

  it('replays one command without duplicate problem or workflow', async () => {
    const source = await defect();
    const request = input([source]);
    const key = randomUUID();
    const first = await service.issue(actor, request, randomUUID(), key);
    await ledger.update(actor, source.id, { expectedVersion: source.version, description: '更正后的描述' }, randomUUID(), randomUUID());
    const replay = await service.issue(actor, request, randomUUID(), key);
    expect(replay.replayed).toBe(true);
    expect(replay.problem.id).toBe(first.problem.id);
    await expect(service.issue(actor, { ...request, severity: 'LOW' }, randomUUID(), key)).rejects.toMatchObject({ status: 409 });
  });

  it('rejects a stale source version without creating a formal problem', async () => {
    const source = await defect();
    const before = await prisma.problemIndex.count({ where: { organizationId, sourceId: source.id } });
    await ledger.update(actor, source.id, { expectedVersion: 1, description: '新版本' }, randomUUID(), randomUUID());
    await expect(service.issue(actor, input([source]), randomUUID(), randomUUID())).rejects.toMatchObject({ status: 409 });
    expect(await prisma.problemIndex.count({ where: { organizationId, sourceId: source.id } })).toBe(before);
  });

  it('rejects cross-organization and archived sources', async () => {
    const source = await defect();
    await expect(service.issue({ ...actor, scopeOrganizationId: otherOrganizationId }, input([source]), randomUUID(), randomUUID())).rejects.toMatchObject({ status: 403 });
    await ledger.archive(actor, source.id, source.version, randomUUID(), randomUUID());
    await expect(service.issue(actor, input([source]), randomUUID(), randomUUID())).rejects.toMatchObject({ status: 409 });
  });

  it('rejects unbound workflows, unsafe response forms and invalid domain decisions', async () => {
    const source = await defect();
    const requested = input([source]);
    await expect(service.issue(actor, { ...requested, workflowBinding: { ...requested.workflowBinding, workflowDefinitionId: randomUUID() } }, randomUUID(), randomUUID())).rejects.toMatchObject({ status: 409 });
    await expect(service.issue(actor, { ...requested, responseForm: 'EIGHT_D' }, randomUUID(), randomUUID())).rejects.toMatchObject({ status: 409 });
    await expect(service.issue(actor, { ...requested, problemType: 'OTHER' }, randomUUID(), randomUUID())).rejects.toMatchObject({ status: 400 });
    await expect(service.issue(actor, { ...requested, responsibleScope: 'untrusted' }, randomUUID(), randomUUID())).rejects.toMatchObject({ status: 400 });
    await expect(service.issue(actor, { ...requested, severity: 'UNTRUSTED' }, randomUUID(), randomUUID())).rejects.toMatchObject({ status: 400 });
    expect(await prisma.problemIndex.count({ where: { organizationId, sourceId: source.id } })).toBe(0);
  });

  it('rejects an owner outside the source organization', async () => {
    const otherUserId = randomUUID();
    await prisma.user.create({ data: { id: otherUserId, organizationId: otherOrganizationId, username: `other-${otherUserId.slice(0, 8)}`, accountType: 'INTERNAL', passwordHash: 'test-only' } });
    const source = await defect();
    await expect(service.issue(actor, { ...input([source]), ownerId: otherUserId }, randomUUID(), randomUUID())).rejects.toMatchObject({ status: 400 });
  });

  it('omits removed source links from the defect reverse lookup', async () => {
    const source = await defect();
    const result = await service.issue(actor, input([source]), randomUUID(), randomUUID());
    await prisma.domainSourceIssueLink.updateMany({ where: { organizationId, problemIndexId: String(result.problem.id), sourceId: source.id }, data: { removedAt: new Date(), removedBy: userId } });
    expect(await service.problemsForDefect(actor, source.id)).toEqual([]);
  });

  it('rejects a published process flow without independent closing verification', async () => {
    const source = await defect();
    const close = await prisma.workflowNode.findFirstOrThrow({ where: { organizationId, workflowVersionId, type: 'CLOSE' } });
    await prisma.workflowNode.update({ where: { id: close.id }, data: { config: { isEnd: true, assignment: { roleCode: 'PROCESS_HANDLER' } } } });
    try {
      await expect(service.issue(actor, input([source]), randomUUID(), randomUUID())).rejects.toMatchObject({ status: 409 });
      expect(await prisma.problemIndex.count({ where: { organizationId, sourceId: source.id } })).toBe(0);
    } finally {
      await prisma.workflowNode.update({ where: { id: close.id }, data: { config: close.config as object } });
    }
  });
});
