import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../src/database/prisma.service.js';
import { AdminMutationService } from '../../src/common/security/admin-mutation.service.js';
import { AuditLogService } from '../../src/modules/audit-log/audit-log.service.js';
import { CustomerQualityService } from '../../src/modules/customer-quality/customer-quality.service.js';
import { CustomerIssueService } from '../../src/modules/customer-quality/customer-issue.service.js';
import { NumberingService } from '../../src/modules/problem-index/numbering.service.js';
import { ProblemIndexService } from '../../src/modules/problem-index/problem-index.service.js';
import { DomainSourceIssueService } from '../../src/modules/problem-index/domain-source-issue.service.js';
import { DomainSourceLinkService } from '../../src/modules/problem-index/domain-source-link.service.js';
import { OutboxService } from '../../src/modules/task-notification/outbox.service.js';
import { WorkflowDefinitionService } from '../../src/modules/workflow/workflow-definition.service.js';
import { WorkflowValidationService } from '../../src/modules/workflow/workflow-validation.service.js';
import { WorkflowRuntimeService } from '../../src/modules/workflow/workflow-runtime.service.js';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl || process.env.QMS_DISPOSABLE_TEST_DB !== 'true' || new URL(databaseUrl).port === '55440') {
  throw new Error('An independent disposable PostgreSQL database is required');
}

describe('customer complaint issue workflow on PostgreSQL', () => {
  const prisma = new PrismaService(databaseUrl);
  const audit = new AuditLogService(prisma);
  const outbox = new OutboxService(prisma);
  const numbering = new NumberingService(prisma);
  const problems = new ProblemIndexService(prisma, numbering, audit, outbox);
  const runtime = new WorkflowRuntimeService(prisma, audit, outbox, problems);
  const domainIssues = new DomainSourceIssueService(prisma, problems, outbox);
  const ledger = new CustomerQualityService(prisma, new AdminMutationService(prisma, audit), audit);
  const service = new CustomerIssueService(prisma, ledger, domainIssues, runtime, new DomainSourceLinkService(prisma, audit, outbox));
  const organizationId = randomUUID();
  const userId = randomUUID();
  const sessionId = randomUUID();
  const actor = { id: userId, organizationId, accountType: 'INTERNAL' as const, sessionId };
  let roleId: string;
  let customerId: string;
  let workflowDefinitionId: string;
  let workflowVersionId: string;

  beforeAll(async () => {
    await prisma.$connect();
    const [server] = await prisma.$queryRaw<{ server_version_num: string }[]>`SHOW server_version_num`;
    expect(Number(server!.server_version_num)).toBeGreaterThanOrEqual(180000);
    await prisma.organization.create({ data: { id: organizationId, code: `CI-${organizationId.slice(0, 8)}`, name: 'Main', type: 'INTERNAL' } });
    await prisma.user.create({ data: { id: userId, organizationId, username: `cqi-${userId.slice(0, 8)}`, accountType: 'INTERNAL', passwordHash: 'test-only' } });
    await prisma.session.create({ data: { id: sessionId, userId, tokenHash: randomUUID(), expiresAt: new Date(Date.now() + 3_600_000), reauthenticatedAt: new Date() } });
    const role = await prisma.role.create({ data: { organizationId, code: 'CUSTOMER_HANDLER', name: 'Customer handler' } });
    roleId = role.id;
    for (const code of ['workflow:start', 'customer-quality:complaints:read', 'customer-quality:complaints:write']) {
      const permission = await prisma.permission.upsert({ where: { code }, create: { code, name: code }, update: {} });
      await prisma.rolePermission.create({ data: { roleId: role.id, permissionId: permission.id } });
    }
    await prisma.userRole.create({ data: { userId, organizationId, roleId: role.id } });
    await numbering.publishRuleVersion({ organizationId, ruleCode: 'PROBLEM', pattern: '{CODE}-{YYMM}-{SEQ3}' });
    const definitions = new WorkflowDefinitionService(prisma, new WorkflowValidationService(), audit);
    const draft = await definitions.createDraft({ organizationId, userId, code: 'CUSTOMER_BRIEF', name: 'Customer issue', draft: {
      nodes: [
        { id: 'handle', type: 'ACTION', name: 'Handle', config: { isStart: true, assignment: { roleCode: 'CUSTOMER_HANDLER' } } },
        { id: 'verify', type: 'VERIFICATION', name: 'Verify', config: { assignment: { roleCode: 'CUSTOMER_HANDLER' } } },
        { id: 'close', type: 'CLOSE', name: 'Close', config: { isEnd: true, requireIndependentVerification: true, assignment: { roleCode: 'CUSTOMER_HANDLER' } } },
      ], transitions: [{ id: 'submit', from: 'handle', to: 'verify' }, { id: 'verify', from: 'verify', to: 'close' }],
    } });
    workflowDefinitionId = draft.id;
    workflowVersionId = (await definitions.publishVersion({ organizationId, userId, definitionId: draft.id })).id;
    customerId = (await ledger.createCustomer(actor, { code: 'C-ISSUE', name: '客户甲' }, randomUUID(), randomUUID())).id;
  });

  afterAll(async () => prisma.$disconnect());

  async function complaint(physicalAnalysisRequired = false) {
    return ledger.createComplaint(actor, { customerId, complaintType: 'ZERO_KM', defectDescription: '异响', physicalAnalysisRequired,
      severity: 'L2', severityPolicyVersion: 'policy-2', severitySnapshot: { level: 'L2' } }, randomUUID(), randomUUID());
  }

  function input(sources: Array<{ id: string; version: number }>) {
    return { sources: sources.map(({ id, version }) => ({ complaintId: id, expectedVersion: version })), problemType: 'CUSTOMER_COMPLAINT',
      responseForm: 'BRIEF' as const, responsibleScope: 'customer-quality',
      workflowBinding: { workflowDefinitionId, workflowVersionId, instanceKey: randomUUID() } };
  }

  it('issues one formal problem from several complaints with snapshots, workflow, and replay', async () => {
    const first = await complaint();
    const second = await complaint();
    const request = input([first, second]);
    const key = randomUUID();
    const issued = await service.issue(actor, request, randomUUID(), key);
    const problemId = String(issued.problem.id);
    const links = await prisma.domainSourceIssueLink.findMany({ where: { problemIndexId: problemId } });
    expect(links).toHaveLength(2);
    expect(links.map((link) => link.sourceId).sort()).toEqual([first.id, second.id].sort());
    expect(links[0]?.sourceSnapshot).toMatchObject({ customerName: '客户甲', severity: 'L2', severityPolicyVersion: 'policy-2' });
    expect(await prisma.workflowInstance.count({ where: { problemIndexId: problemId } })).toBe(1);
    expect(await prisma.outboxEvent.count({ where: { aggregateId: problemId, aggregateType: 'DomainSourceIssue' } })).toBe(1);
    const replay = await service.issue(actor, request, randomUUID(), key);
    expect(replay.replayed).toBe(true);
    expect(replay.problem.id).toBe(problemId);
    await ledger.updateComplaint(actor, second.id, { expectedVersion: second.version, defectDescription: '客户补充描述' }, randomUUID(), randomUUID());
    expect((await service.issue(actor, request, randomUUID(), key)).replayed).toBe(true);
    await ledger.archiveComplaint(actor, first.id, first.version, randomUUID(), randomUUID());
    expect((await service.issue(actor, request, randomUUID(), key)).replayed).toBe(true);
    expect((await service.problemsForComplaint(actor, first.id)).map((problem) => problem.id)).toContain(problemId);
    await prisma.domainSourceIssueLink.updateMany({ where: { problemIndexId: problemId, sourceId: first.id }, data: { removedAt: new Date(), removedBy: userId } });
    expect(await service.problemsForComplaint(actor, first.id)).toEqual([]);
  });

  it('requires explicit missing or completed analysis before issuing', async () => {
    const source = await complaint(true);
    await expect(service.issue(actor, input([source]), randomUUID(), randomUUID())).rejects.toMatchObject({ status: 409 });
    await ledger.recordPhysicalAnalysis(actor, source.id, { summary: '分析进行中', status: 'IN_PROGRESS' }, randomUUID(), randomUUID());
    const inProgress = await ledger.detailComplaint(actor, source.id);
    await expect(service.issue(actor, input([inProgress]), randomUUID(), randomUUID())).rejects.toMatchObject({ status: 409 });
    await ledger.recordPhysicalAnalysis(actor, source.id, { summary: '待件', status: 'MISSING' }, randomUUID(), randomUUID());
    const current = await ledger.detailComplaint(actor, source.id);
    const issued = await service.issue(actor, input([current]), randomUUID(), randomUUID());
    expect(issued.problem.id).toBeTruthy();
  });

  it('rejects stale source versions before creating a formal problem', async () => {
    const source = await complaint();
    await ledger.updateComplaint(actor, source.id, { expectedVersion: 1, defectDescription: '新描述' }, randomUUID(), randomUUID());
    await expect(service.issue(actor, input([source]), randomUUID(), randomUUID())).rejects.toMatchObject({ status: 409 });
    expect(await prisma.problemIndex.count({ where: { organizationId, sourceId: source.id } })).toBe(0);
  });

  it('adds and removes complaint sources with history and protects the last source', async () => {
    const first = await complaint();
    const second = await complaint();
    const issued = await service.issue(actor, input([first]), randomUUID(), randomUUID());
    const problemId = String(issued.problem.id);
    const addRequest = { expectedProblemVersion: Number(issued.problem.version), add: [{ complaintId: second.id, expectedVersion: second.version }], remove: [] };
    const addKey = randomUUID();
    const added = await service.changeSources(actor, problemId, addRequest, randomUUID(), addKey);
    expect(added.version).toBe(Number(issued.problem.version) + 1);
    expect((await service.problemsForComplaint(actor, second.id)).map((problem) => problem.id)).toContain(problemId);
    await ledger.updateComplaint(actor, second.id, { expectedVersion: second.version, defectDescription: '补充事实' }, randomUUID(), randomUUID());
    expect((await service.changeSources(actor, problemId, addRequest, randomUUID(), addKey)).version).toBe(added.version);
    await ledger.archiveComplaint(actor, second.id, second.version + 1, randomUUID(), randomUUID());
    expect((await service.changeSources(actor, problemId, addRequest, randomUUID(), addKey)).version).toBe(added.version);
    const removed = await service.changeSources(actor, problemId, { expectedProblemVersion: Number(added.version), add: [], remove: [second.id] }, randomUUID(), randomUUID());
    expect(removed.version).toBe(Number(added.version) + 1);
    expect(await service.problemsForComplaint(actor, second.id)).toEqual([]);
    expect(await prisma.domainSourceIssueLinkHistory.count({ where: { problemIndexId: problemId, sourceId: second.id } })).toBe(2);
    expect((await service.historyForComplaint(actor, second.id)).map((item) => item.action)).toEqual(['LINKED', 'UNLINKED']);
    await expect(service.changeSources(actor, problemId, { expectedProblemVersion: Number(removed.version), add: [], remove: [first.id] }, randomUUID(), randomUUID())).rejects.toMatchObject({ status: 409 });
  });

  it('rejects client-chosen workflows, responsibility scopes, and owners outside the organization', async () => {
    const source = await complaint();
    const request = input([source]);
    await expect(service.issue(actor, { ...request, workflowBinding: { ...request.workflowBinding, workflowVersionId: randomUUID() } }, randomUUID(), randomUUID())).rejects.toMatchObject({ status: 409 });
    const definitions = new WorkflowDefinitionService(prisma, new WorkflowValidationService(), audit);
    const unrelated = await definitions.createDraft({ organizationId, userId, code: randomUUID(), name: 'Unrelated flow', draft: {
      nodes: [
        { id: 'handle', type: 'ACTION', name: 'Handle', config: { isStart: true, assignment: { roleCode: 'CUSTOMER_HANDLER' } } },
        { id: 'verify', type: 'VERIFICATION', name: 'Verify', config: { assignment: { roleCode: 'CUSTOMER_HANDLER' } } },
        { id: 'close', type: 'CLOSE', name: 'Close', config: { isEnd: true, requireIndependentVerification: true, assignment: { roleCode: 'CUSTOMER_HANDLER' } } },
      ], transitions: [{ id: 'submit', from: 'handle', to: 'verify' }, { id: 'verify', from: 'verify', to: 'close' }],
    } });
    const unrelatedVersion = await definitions.publishVersion({ organizationId, userId, definitionId: unrelated.id });
    await expect(service.issue(actor, { ...request, workflowBinding: { ...request.workflowBinding, workflowDefinitionId: unrelated.id, workflowVersionId: unrelatedVersion.id } }, randomUUID(), randomUUID())).rejects.toMatchObject({ status: 409 });
    await expect(service.issue(actor, { ...request, responsibleScope: 'supplier' }, randomUUID(), randomUUID())).rejects.toMatchObject({ status: 400 });
    await expect(service.issue(actor, { ...request, ownerId: randomUUID() }, randomUUID(), randomUUID())).rejects.toMatchObject({ status: 400 });
    expect(await prisma.problemIndex.count({ where: { organizationId, sourceId: source.id } })).toBe(0);
  });

  it('does not label a generic workflow as 8D before the 8D stages exist', async () => {
    const source = await complaint();
    await expect(service.issue(actor, { ...input([source]), responseForm: 'EIGHT_D' }, randomUUID(), randomUUID())).rejects.toMatchObject({ status: 409 });
    expect(await prisma.problemIndex.count({ where: { organizationId, sourceId: source.id } })).toBe(0);
  });

  it('uses the response form workflow binding for 8D issuance', async () => {
    const source = await complaint();
    const definitions = new WorkflowDefinitionService(prisma, new WorkflowValidationService(), audit);
    const draft = await definitions.createDraft({ organizationId, userId, code: 'CUSTOMER_8D', name: 'Customer 8D', draft: {
      nodes: [
        { id: 'd1', type: 'ACTION', name: 'D1', config: { isStart: true, assignment: { roleCode: 'CUSTOMER_HANDLER' } } },
        { id: 'verify', type: 'VERIFICATION', name: 'Verify', config: { assignment: { roleCode: 'CUSTOMER_HANDLER' } } },
        { id: 'close', type: 'CLOSE', name: 'Close', config: { isEnd: true, requireIndependentVerification: true, assignment: { roleCode: 'CUSTOMER_HANDLER' } } },
      ], transitions: [{ id: 'submit', from: 'd1', to: 'verify' }, { id: 'verify', from: 'verify', to: 'close' }],
    } });
    const version = await definitions.publishVersion({ organizationId, userId, definitionId: draft.id });
    const request = input([source]);
    const issued = await service.issue(actor, { ...request, responseForm: 'EIGHT_D', workflowBinding: { workflowDefinitionId: draft.id, workflowVersionId: version.id, instanceKey: randomUUID() } }, randomUUID(), randomUUID());
    expect(issued.problem.id).toBeTruthy();
  });

  it('rejects source reads and issuance after permission revocation', async () => {
    const source = await complaint();
    const write = await prisma.permission.findUniqueOrThrow({ where: { code: 'customer-quality:complaints:write' } });
    await prisma.rolePermission.delete({ where: { roleId_permissionId: { roleId, permissionId: write.id } } });
    await expect(service.issue(actor, input([source]), randomUUID(), randomUUID())).rejects.toMatchObject({ status: 403 });
    const read = await prisma.permission.findUniqueOrThrow({ where: { code: 'customer-quality:complaints:read' } });
    await prisma.rolePermission.delete({ where: { roleId_permissionId: { roleId, permissionId: read.id } } });
    await expect(service.problemsForComplaint(actor, source.id)).rejects.toMatchObject({ status: 403 });
  });
});
