import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../src/database/prisma.service.js';
import { AdminMutationService } from '../../src/common/security/admin-mutation.service.js';
import { AuditLogService } from '../../src/modules/audit-log/audit-log.service.js';
import { AuditManagementService } from '../../src/modules/audit-management/audit-management.service.js';
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

describe('audit import review and issue workflow on PostgreSQL', () => {
  const prisma = new PrismaService(databaseUrl);
  const audit = new AuditLogService(prisma);
  const outbox = new OutboxService(prisma);
  const numbering = new NumberingService(prisma);
  const problems = new ProblemIndexService(prisma, numbering, audit, outbox);
  const runtime = new WorkflowRuntimeService(prisma, audit, outbox, problems);
  const domainIssues = new DomainSourceIssueService(prisma, problems, outbox);
  const mutations = new AdminMutationService(prisma, audit);
  const service = new AuditManagementService(prisma, mutations, audit, problems, runtime, domainIssues);
  const organizationId = randomUUID();
  const userId = randomUUID();
  const sessionId = randomUUID();
  const roleId = randomUUID();
  const actor = { id: userId, organizationId, accountType: 'INTERNAL' as const, sessionId };
  let workflowDefinitionId: string;
  let workflowVersionId: string;

  beforeAll(async () => {
    await prisma.$connect();
    await prisma.organization.create({ data: { id: organizationId, code: `AIR-${organizationId.slice(0, 8)}`, name: 'Audit import review', type: 'INTERNAL' } });
    await prisma.user.create({ data: { id: userId, organizationId, username: `air-${userId.slice(0, 8)}`, accountType: 'INTERNAL', passwordHash: 'test-only' } });
    await prisma.session.create({ data: { id: sessionId, userId, tokenHash: randomUUID(), expiresAt: new Date(Date.now() + 3_600_000), reauthenticatedAt: new Date() } });
    await prisma.role.create({ data: { id: roleId, organizationId, code: 'AUDIT_IMPORT_REVIEWER', name: 'Audit import reviewer' } });
    for (const code of ['audit-management:read', 'audit-management:write', 'workflow:start']) {
      const permission = await prisma.permission.upsert({ where: { code }, create: { code, name: code }, update: {} });
      await prisma.rolePermission.create({ data: { roleId, permissionId: permission.id } });
    }
    await prisma.userRole.create({ data: { userId, organizationId, roleId } });
    await numbering.publishRuleVersion({ organizationId, ruleCode: 'PROBLEM', pattern: '{CODE}-{YYMM}-{SEQ3}' });
    const definitions = new WorkflowDefinitionService(prisma, new WorkflowValidationService(), audit);
    const draft = await definitions.createDraft({ organizationId, userId, code: 'AUDIT_IMPORT_BRIEF', name: 'Audit import issue', draft: {
      nodes: [
        { id: 'handle', type: 'ACTION', name: 'Handle', config: { isStart: true, assignment: { roleCode: 'AUDIT_IMPORT_REVIEWER' } } },
        { id: 'verify', type: 'VERIFICATION', name: 'Verify', config: { assignment: { roleCode: 'AUDIT_IMPORT_REVIEWER' } } },
        { id: 'close', type: 'CLOSE', name: 'Close', config: { isEnd: true, requireIndependentVerification: true, assignment: { roleCode: 'AUDIT_IMPORT_REVIEWER' } } },
      ], transitions: [{ id: 'submit', from: 'handle', to: 'verify' }, { id: 'verify', from: 'verify', to: 'close' }],
    } });
    workflowDefinitionId = draft.id;
    workflowVersionId = (await definitions.publishVersion({ organizationId, userId, definitionId: draft.id })).id;
  });

  afterAll(async () => prisma.$disconnect());

  it('lists rows, enforces review CAS, and issues an accepted row with a source link atomically', async () => {
    const externalKey = `AUD-${randomUUID()}`;
    const imported = await service.importCustomerOrSecondPartyRow(actor, { sourceSystem: 'CUSTOMER', map: () => ({ externalKey, payload: { finding: '缺少记录' } }) }, {}, randomUUID(), randomUUID());
    const pending = await service.listImportRows(actor, { page: 1, pageSize: 20 });
    expect(pending.items).toEqual(expect.arrayContaining([expect.objectContaining({ id: imported.id, status: 'PENDING_REVIEW', version: 1 })]));
    const accepted = await service.reviewImportRow(actor, imported.id, { expectedVersion: 1, decision: 'ACCEPTED', note: '确认纳入整改' }, randomUUID(), randomUUID());
    expect(accepted).toMatchObject({ id: imported.id, status: 'ACCEPTED', version: 2 });
    await expect(service.reviewImportRow(actor, imported.id, { expectedVersion: 1, decision: 'REJECTED' }, randomUUID(), randomUUID())).rejects.toMatchObject({ status: 409 });
    const issueInput = { expectedVersion: 2, problemType: 'AUDIT_IMPORT', responseForm: 'BRIEF' as const, responsibleScope: 'audit-management', severity: 'MAJOR', workflowBinding: { workflowDefinitionId, workflowVersionId, instanceKey: randomUUID() } };
    const issueKey = randomUUID();
    const issued = await service.issueImportedRow(actor, imported.id, issueInput, randomUUID(), issueKey);
    expect(issued.problem).toBeDefined();
    expect(issued.replayed).toBe(false);
    const replayed = await service.issueImportedRow(actor, imported.id, issueInput, randomUUID(), issueKey);
    expect(replayed).toMatchObject({ replayed: true, problem: { id: issued.problem.id } });
    await expect(service.issueImportedRow(actor, imported.id, { ...issueInput, severity: 'CRITICAL' }, randomUUID(), issueKey)).rejects.toMatchObject({ status: 409 });
    await expect(service.issueImportedRow(actor, imported.id, issueInput, randomUUID(), randomUUID())).rejects.toMatchObject({ status: 409 });
    const row = await prisma.auditImportRow.findUnique({ where: { id: imported.id } });
    expect(row).toMatchObject({ status: 'ISSUED', version: 3, problemIndexId: issued.problem.id });
    expect(await prisma.domainSourceIssueLink.count({ where: { problemIndexId: String(issued.problem.id), sourceId: imported.id } })).toBe(1);
    const writePermission = await prisma.permission.findUniqueOrThrow({ where: { code: 'audit-management:write' } });
    await prisma.rolePermission.delete({ where: { roleId_permissionId: { roleId, permissionId: writePermission.id } } });
    await expect(service.issueImportedRow(actor, imported.id, issueInput, randomUUID(), issueKey)).rejects.toMatchObject({ status: 403 });
  });
});
