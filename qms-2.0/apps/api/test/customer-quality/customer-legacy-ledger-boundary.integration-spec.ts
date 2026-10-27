import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../src/database/prisma.service.js';
import { AdminMutationService } from '../../src/common/security/admin-mutation.service.js';
import { AuditLogService } from '../../src/modules/audit-log/audit-log.service.js';
import { CustomerQualityService } from '../../src/modules/customer-quality/customer-quality.service.js';
import { CustomerComplaintProcessingService } from '../../src/modules/customer-quality/customer-complaint-processing.service.js';
import { FileLifecycleService } from '../../src/modules/file-management/file-lifecycle.service.js';
import { FilePolicyService } from '../../src/modules/file-management/file-policy.service.js';
import { FileResourceAccess } from '../../src/modules/file-management/file-resource-access.js';
import { createObjectStorage } from '../../src/modules/file-management/object-storage.service.js';
import { OrganizationService } from '../../src/modules/organization/organization.service.js';
import { PositionOnboardingService } from '../../src/modules/organization/position-onboarding.service.js';
import { CustomerIssueService } from '../../src/modules/customer-quality/customer-issue.service.js';
import { NumberingService } from '../../src/modules/problem-index/numbering.service.js';
import { ProblemIndexService } from '../../src/modules/problem-index/problem-index.service.js';
import { DomainSourceIssueService } from '../../src/modules/problem-index/domain-source-issue.service.js';
import { DomainSourceLinkService } from '../../src/modules/problem-index/domain-source-link.service.js';
import { OutboxService } from '../../src/modules/task-notification/outbox.service.js';
import { WorkflowRuntimeService } from '../../src/modules/workflow/workflow-runtime.service.js';
import { WorkflowDefinitionService } from '../../src/modules/workflow/workflow-definition.service.js';
import { WorkflowValidationService } from '../../src/modules/workflow/workflow-validation.service.js';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl || process.env.QMS_DISPOSABLE_TEST_DB !== 'true'
  || !['localhost', '127.0.0.1', '[::1]'].includes(new URL(databaseUrl).hostname)
  || new URL(databaseUrl).port === '55440') throw new Error('Disposable loopback PostgreSQL is required');

const boundary = { status: 409, response: { code: 'CUSTOMER_LEDGER_ROUTE_REQUIRED' } };
const content = {
  what: 'Defect', why: 'Cause', where: 'Site', when: 'Today', who: 'QE', how: 'Observed', howMuch: 'One',
  containment: 'Isolated', rootCause: 'Verified', verification: 'Confirmed', preventiveAction: 'Updated',
  horizontalDeployment: 'Recorded', lessonsLearned: 'Recorded', verificationEvidenceFileIds: [randomUUID()],
  archiveChecklist: ['SOURCE_CONFIRMED', 'CONTAINMENT_VERIFIED', 'ROOT_CAUSE_VERIFIED', 'PREVENTION_DEPLOYED', 'HORIZONTAL_DEPLOYMENT_RECORDED', 'EVIDENCE_COMPLETE'],
};

describe('bounded legacy customer routes on PostgreSQL', () => {
  const prisma = new PrismaService(databaseUrl);
  const audit = new AuditLogService(prisma);
  const mutations = new AdminMutationService(prisma, audit);
  const ledger = new CustomerQualityService(prisma, mutations, audit);
  const files = new FileLifecycleService(prisma, new FilePolicyService(), createObjectStorage(), audit, new FileResourceAccess([]));
  const processing = new CustomerComplaintProcessingService(prisma, mutations, audit, files,
    new OrganizationService(prisma, mutations, audit, new PositionOnboardingService(prisma, audit)));
  const organizationId = randomUUID();
  const roleId = randomUUID();
  const departmentId = randomUUID();
  const actor = { id: randomUUID(), organizationId, accountType: 'INTERNAL' as const, sessionId: randomUUID() };
  let customerId: string;

  beforeAll(async () => {
    await prisma.$connect();
    const [server] = await prisma.$queryRaw<{ server_version_num: string }[]>`SHOW server_version_num`;
    expect(Number(server!.server_version_num)).toBeGreaterThanOrEqual(180000);
    await prisma.organization.create({ data: { id: organizationId, code: randomUUID(), name: 'Legacy boundary', type: 'INTERNAL' } });
    await prisma.user.create({ data: { id: actor.id, organizationId, username: actor.id, accountType: 'INTERNAL', passwordHash: 'test-only' } });
    await prisma.session.create({ data: { id: actor.sessionId, userId: actor.id, tokenHash: randomUUID(), expiresAt: new Date(Date.now() + 3600000), reauthenticatedAt: new Date() } });
    await prisma.department.create({ data: { id: departmentId, organizationId, code: 'QE', name: 'QE' } });
    await prisma.role.create({ data: { id: roleId, organizationId, code: 'LEGACY', name: 'Legacy consumer' } });
    for (const code of ['customer-quality:complaints:read', 'customer-quality:complaints:write']) {
      const permission = await prisma.permission.upsert({ where: { code }, create: { code, name: code }, update: {} });
      await prisma.rolePermission.create({ data: { roleId, permissionId: permission.id } });
    }
    await prisma.userRole.create({ data: { userId: actor.id, organizationId, roleId } });
    customerId = (await ledger.createCustomer(actor, { code: randomUUID(), name: 'Legacy customer' }, randomUUID(), randomUUID())).id;
  });
  afterAll(async () => prisma.$disconnect());

  async function legacy() {
    return ledger.createComplaint(actor, { customerId, complaintType: 'ZERO_KM', defectDescription: 'Historical facts',
      severity: 'LOW', severityPolicyVersion: 'historical-policy', severitySnapshot: { level: 'LOW' },
      returnRequired: true, physicalAnalysisRequired: true }, randomUUID(), randomUUID());
  }

  async function formal(status: 'FOLLOWING' | 'CLOSED' = 'FOLLOWING', nullable = false) {
    const id = randomUUID();
    // Both old-shaped and nullable formal rows must be blocked, independent of legacy validation.
    await prisma.$executeRaw`INSERT INTO customer_quality_complaints
      (id, organization_id, complaint_number, customer_id, complaint_type, defect_description,
       severity, severity_policy_version, severity_snapshot, ledger_status, status,
       return_required, physical_analysis_required, created_by_id, updated_by_id, updated_at)
      VALUES (${id}::uuid, ${organizationId}::uuid, ${`CQ-BOUNDARY-${id}`}, ${nullable ? null : customerId}::uuid,
        ${nullable ? null : 'ZERO_KM'}, ${nullable ? null : 'Formal facts'}, ${nullable ? null : 'LOW'},
        ${nullable ? null : 'fixture-policy'}, ${nullable ? null : '{"level":"LOW"}'}::jsonb,
        ${status}, 'IN_ANALYSIS', true, true, ${actor.id}::uuid, ${actor.id}::uuid, CURRENT_TIMESTAMP)`;
    return id;
  }

  const triage = { expectedVersion: 1, category: 'PRODUCT_QUALITY' as const, responsibleDepartmentId: departmentId, ownerUserId: actor.id, note: 'Assigned' };
  const writes: Array<[string, (id: string, key: string) => Promise<unknown>]> = [
    ['update', (id, key) => ledger.updateComplaint(actor, id, { expectedVersion: 1, defectDescription: 'Bypass' }, randomUUID(), key)],
    ['archive', (id, key) => ledger.archiveComplaint(actor, id, 1, randomUUID(), key)],
    ['disposition', (id, key) => ledger.recordPhysicalDisposition(actor, id, { action: 'RETURN', status: 'RECEIVED' }, randomUUID(), key)],
    ['analysis', (id, key) => ledger.recordPhysicalAnalysis(actor, id, { summary: 'Bypass', status: 'COMPLETED' }, randomUUID(), key)],
    ['triage', (id, key) => processing.triage(actor, id, triage, randomUUID(), key)],
    ['progress', (id, key) => processing.progress(actor, id, { expectedVersion: 1, note: 'Bypass' }, randomUUID(), key)],
    ['resolve', (id, key) => processing.resolve(actor, id, { expectedVersion: 1, resolutionSummary: 'Bypass' }, randomUUID(), key)],
    ['close', (id, key) => processing.close(actor, id, { expectedVersion: 1, note: 'Bypass' }, randomUUID(), key)],
    ['reopen', (id, key) => processing.reopen(actor, id, { expectedVersion: 1, note: 'Bypass' }, randomUUID(), key)],
    ['8d draft', (id, key) => processing.saveEightD(actor, id, { expectedVersion: 1, content }, randomUUID(), key)],
    ['8d submit', (id, key) => processing.submitEightD(actor, id, { expectedVersion: 1, content }, randomUUID(), key)],
    ['8d approve', (id, key) => processing.approveEightD(actor, id, { expectedVersion: 1, note: 'Bypass' }, randomUUID(), key)],
  ];

  async function snapshot(id: string) {
    const [row] = await prisma.$queryRaw<Record<string, unknown>[]>`SELECT * FROM customer_quality_complaints WHERE id = ${id}::uuid`;
    const [counts] = await prisma.$queryRaw<Record<string, bigint>[]>`SELECT
      (SELECT count(*) FROM customer_quality_complaint_events WHERE complaint_id = ${id}::uuid) AS events,
      (SELECT count(*) FROM customer_quality_physical_dispositions WHERE complaint_id = ${id}::uuid) AS dispositions,
      (SELECT count(*) FROM customer_quality_physical_analyses WHERE complaint_id = ${id}::uuid) AS analyses`;
    return { row, counts, receipts: await prisma.adminMutation.count({ where: { organizationId } }),
      workflowReceipts: await prisma.workflowMutation.count({ where: { organizationId } }),
      successAudits: await prisma.auditEvent.count({ where: { organizationId, outcome: 'SUCCESS' } }) };
  }

  it('lists only legacy facts while keeping their old non-null response shape', async () => {
    const old = await legacy();
    const nonnull = await formal();
    const nullable = await formal('CLOSED', true);
    const listed = await ledger.listComplaints(actor);
    expect(listed.map(row => row.id)).toContain(old.id);
    expect(listed.map(row => row.id)).not.toContain(nonnull);
    expect(listed.map(row => row.id)).not.toContain(nullable);
    expect(listed.every(row => row.ledger_status === null && row.customer_id && row.severity && row.severity_snapshot)).toBe(true);
    expect(await ledger.detailComplaint(actor, old.id)).toMatchObject({ id: old.id, ledger_status: null, severity: 'LOW' });
  });

  it.each(writes)('rejects formal %s before any success side effect or receipt', async (_name, write) => {
    for (const status of ['FOLLOWING', 'CLOSED'] as const) {
      for (const nullable of [false, true]) {
        const id = await formal(status, nullable);
        const before = await snapshot(id);
        await expect(write(id, randomUUID())).rejects.toMatchObject(boundary);
        expect(await snapshot(id)).toEqual(before);
      }
    }
  });

  it('blocks formal detail, histories, attachment entry and old 8D reads', async () => {
    const id = await formal();
    for (const read of [() => ledger.detailComplaint(actor, id), () => ledger.dispositionHistory(actor, id),
      () => ledger.analysisHistory(actor, id), () => processing.events(actor, id),
      () => processing.attachments(actor, id), () => processing.eightD(actor, id)]) {
      await expect(read()).rejects.toMatchObject(boundary);
    }
  });

  it('rejects formal source references and locked source resolution even with an unknown customer', async () => {
    for (const nullable of [false, true]) {
      const id = await formal('FOLLOWING', nullable);
      await expect(ledger.sourceReference(actor, id)).rejects.toMatchObject(boundary);
      await expect(prisma.$transaction(tx => ledger.lockAndResolve(tx, { sourceDomain: 'customer-quality', sourceType: 'customer-complaint',
        sourceId: id, sourceVersion: 1, sourceSnapshot: {}, createdBy: actor.id }))).rejects.toMatchObject(boundary);
    }
  });

  it.each(['update', 'disposition', 'analysis', 'triage', 'progress'])(
    'rechecks the current legacy boundary before replaying an existing %s receipt', async name => {
      const old = await legacy();
      if (name === 'progress') await processing.triage(actor, old.id, triage, randomUUID(), randomUUID());
      const key = randomUUID();
      const write = name === 'progress'
        ? (id: string, receipt: string) => processing.progress(actor, id, { expectedVersion: 2, note: 'Progress' }, randomUUID(), receipt)
        : writes.find(([operation]) => operation === name)![1];
      const first = await write(old.id, key);
      expect(await write(old.id, key)).toEqual(first);
      await prisma.$executeRaw`UPDATE customer_quality_complaints SET ledger_status = 'CLOSED' WHERE id = ${old.id}::uuid`;
      const before = await snapshot(old.id);
      await expect(write(old.id, key)).rejects.toMatchObject(boundary);
      expect(await snapshot(old.id)).toEqual(before);
    });

  it('checks live permissions, actor and scope before exposing the boundary or a receipt', async () => {
    const old = await legacy();
    const id = await formal();
    const input = { expectedVersion: 1, defectDescription: 'Authorized update' };
    const key = randomUUID();
    await ledger.updateComplaint(actor, old.id, input, randomUUID(), key);
    await prisma.userRole.deleteMany({ where: { userId: actor.id, organizationId } });
    try {
      await expect(ledger.detailComplaint(actor, id)).rejects.toMatchObject({ status: 403 });
      await expect(ledger.updateComplaint(actor, old.id, input, randomUUID(), key)).rejects.toMatchObject({ status: 403 });
      await expect(processing.approveEightD(actor, id, { expectedVersion: 1, note: 'Denied' }, randomUUID(), randomUUID())).rejects.toMatchObject({ status: 403 });
    } finally {
      await prisma.userRole.create({ data: { userId: actor.id, organizationId, roleId } });
    }
    await prisma.user.update({ where: { id: actor.id }, data: { status: 'DISABLED' } });
    try {
      await expect(processing.eightD(actor, id)).rejects.toMatchObject({ status: 401 });
    } finally {
      await prisma.user.update({ where: { id: actor.id }, data: { status: 'ACTIVE' } });
    }
    const foreign = await prisma.organization.create({ data: { code: randomUUID(), name: 'Other scope', type: 'INTERNAL' } });
    await prisma.userRole.create({ data: { userId: actor.id, organizationId: foreign.id, roleId } });
    await expect(ledger.detailComplaint({ ...actor, scopeOrganizationId: foreign.id }, id)).rejects.toMatchObject({ status: 404 });
  });

  it('preserves old physical-analysis gates, histories and source snapshots', async () => {
    const old = await legacy();
    await expect(ledger.sourceReference(actor, old.id)).rejects.toMatchObject({ response: { code: 'CUSTOMER_PHYSICAL_ANALYSIS_INCOMPLETE' } });
    await ledger.recordPhysicalDisposition(actor, old.id, { action: 'RETURN', status: 'RECEIVED' }, randomUUID(), randomUUID());
    await ledger.recordPhysicalAnalysis(actor, old.id, { summary: 'Historical analysis', status: 'COMPLETED', evidenceSummary: 'Historical evidence' }, randomUUID(), randomUUID());
    expect(await ledger.sourceReference(actor, old.id)).toMatchObject({ sourceSnapshot: { analysisStatus: 'COMPLETED', severity: 'LOW', customerId } });
    expect(await ledger.dispositionHistory(actor, old.id)).toHaveLength(1);
    expect(await ledger.analysisHistory(actor, old.id)).toHaveLength(1);
    await expect(ledger.updateComplaint(actor, old.id, { expectedVersion: 1, defectDescription: 'Stale' }, randomUUID(), randomUUID())).rejects.toMatchObject({ response: { code: 'CONCURRENCY_CONFLICT' } });
    expect(await ledger.detailComplaint(actor, old.id)).toMatchObject({ version: 3 });
  });

  it('preserves historical row-based 8D read/draft/replay but not after a formal-ledger boundary change', async () => {
    const old = await legacy();
    await ledger.recordPhysicalAnalysis(actor, old.id, { summary: 'Historical analysis', status: 'COMPLETED' }, randomUUID(), randomUUID());
    for (const code of ['workflow:start', 'workflow:manage']) {
      const permission = await prisma.permission.upsert({ where: { code }, create: { code, name: code }, update: {} });
      await prisma.rolePermission.create({ data: { roleId, permissionId: permission.id } });
    }
    const numbering = new NumberingService(prisma);
    await numbering.publishRuleVersion({ organizationId, ruleCode: 'PROBLEM', pattern: '{CODE}-{YYMM}-{SEQ3}' });
    const outbox = new OutboxService(prisma);
    const problems = new ProblemIndexService(prisma, numbering, audit, outbox);
    const runtime = new WorkflowRuntimeService(prisma, audit, outbox, problems);
    const issues = new CustomerIssueService(prisma, ledger, new DomainSourceIssueService(prisma, problems, outbox), runtime,
      new DomainSourceLinkService(prisma, audit, outbox));
    const definitions = new WorkflowDefinitionService(prisma, new WorkflowValidationService(), audit);
    const draft = await definitions.createDraft({ organizationId, userId: actor.id, actor, code: 'CUSTOMER_8D', name: 'Historical row 8D', draft: {
      nodes: [
        { id: 'handle', type: 'ACTION', name: 'Handle', config: { isStart: true, assignment: { roleCode: 'LEGACY' } } },
        { id: 'verify', type: 'VERIFICATION', name: 'Verify', config: { assignment: { roleCode: 'LEGACY' } } },
        { id: 'close', type: 'CLOSE', name: 'Close', config: { isEnd: true, requireIndependentVerification: true, assignment: { roleCode: 'LEGACY' } } },
      ], transitions: [{ id: 'submit', from: 'handle', to: 'verify' }, { id: 'verify', from: 'verify', to: 'close' }],
    } });
    const published = await definitions.publishVersion({ organizationId, userId: actor.id, actor, definitionId: draft.id, expectedRevision: draft.revision, draftVersionId: draft.version.id });
    await issues.issue(actor, { sources: [{ complaintId: old.id, expectedVersion: 2 }], problemType: 'CUSTOMER_COMPLAINT',
      responseForm: 'EIGHT_D', responsibleScope: 'customer-quality',
      workflowBinding: { workflowDefinitionId: draft.id, workflowVersionId: published.id, instanceKey: randomUUID() } }, randomUUID(), randomUUID());
    const before = await ledger.sourceReference(actor, old.id);
    const input = { expectedVersion: before.sourceVersion, content };
    const key = randomUUID();
    const saved = await processing.saveEightD(actor, old.id, input, randomUUID(), key);
    expect(saved).toMatchObject({ complaintId: old.id, what: 'Defect', status: 'DRAFT' });
    expect(await processing.eightD(actor, old.id)).toMatchObject(saved);
    expect(await processing.saveEightD(actor, old.id, input, randomUUID(), key)).toEqual(saved);
    await prisma.$executeRaw`UPDATE customer_quality_complaints SET ledger_status = 'FOLLOWING' WHERE id = ${old.id}::uuid`;
    const snapshotBefore = await snapshot(old.id);
    await expect(processing.saveEightD(actor, old.id, input, randomUUID(), key)).rejects.toMatchObject(boundary);
    await expect(processing.eightD(actor, old.id)).rejects.toMatchObject(boundary);
    expect(await snapshot(old.id)).toEqual(snapshotBefore);
  }, 15000);
});
