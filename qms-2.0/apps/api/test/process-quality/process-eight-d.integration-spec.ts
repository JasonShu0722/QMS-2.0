import 'reflect-metadata';
import { jest } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { Prisma } from '../../src/generated/prisma/client.js';
import { assertActiveAuthentication } from '../../src/common/security/session-security.js';
import { PrismaService } from '../../src/database/prisma.service.js';
import { AdminMutationService } from '../../src/common/security/admin-mutation.service.js';
import { AuditLogService } from '../../src/modules/audit-log/audit-log.service.js';
import { FileResourceAccess } from '../../src/modules/file-management/file-resource-access.js';
import { OrganizationResponsibilityService } from '../../src/modules/organization/organization-responsibility.service.js';
import { DomainSourceIssueService } from '../../src/modules/problem-index/domain-source-issue.service.js';
import { DomainSourceLinkService } from '../../src/modules/problem-index/domain-source-link.service.js';
import { NumberingService } from '../../src/modules/problem-index/numbering.service.js';
import { ProblemIndexService } from '../../src/modules/problem-index/problem-index.service.js';
import { DomainProblemReadAdapter } from '../../src/modules/problem-index/domain-problem-read.adapter.js';
import { ProblemDomainRegistry } from '../../src/modules/problem-index/problem-domain-registry.js';
import { ProcessDefectLedgerService } from '../../src/modules/process-quality/process-defect-ledger.service.js';
import { ProcessEightDClosureAdapter } from '../../src/modules/process-quality/process-eight-d-closure.adapter.js';
import { ProcessEightDFileAdapter } from '../../src/modules/process-quality/process-eight-d-file.adapter.js';
import { normalizeProcessEightDDocument } from '../../src/modules/process-quality/process-eight-d-document.js';
import { ProcessEightDService } from '../../src/modules/process-quality/process-eight-d.service.js';
import { ProcessEightDReadAdapter } from '../../src/modules/process-quality/process-eight-d-read.adapter.js';
import { ProcessEightDAssignmentOptionsQueryDto } from '../../src/modules/process-quality/process-eight-d.dto.js';
import { OutboxService } from '../../src/modules/task-notification/outbox.service.js';
import { WorkflowClosureRegistry } from '../../src/modules/workflow/workflow-closure-registry.js';
import { WorkflowClosureRoundService } from '../../src/modules/workflow/workflow-closure-round.service.js';
import { WorkflowDefinitionService } from '../../src/modules/workflow/workflow-definition.service.js';
import { WorkflowDeadlineExtensionService } from '../../src/modules/workflow/workflow-deadline-extension.service.js';
import { WorkflowRuntimeService } from '../../src/modules/workflow/workflow-runtime.service.js';
import { WorkflowValidationService } from '../../src/modules/workflow/workflow-validation.service.js';
import type { ProcessEightDActor } from '../../src/modules/process-quality/process-eight-d.types.js';

const url = process.env.DATABASE_URL && new URL(process.env.DATABASE_URL);
if (!url || process.env.QMS_DISPOSABLE_TEST_DB !== 'true' || !['postgres:', 'postgresql:'].includes(url.protocol)
  || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.port === '55440' || url.search || url.hash) {
  throw new Error('Process 8D requires disposable loopback PostgreSQL, never preview 55440.');
}

describe('process 8D real domain transactions', () => {
  const prisma = new PrismaService();
  const audit = new AuditLogService(prisma), outbox = new OutboxService(prisma), mutations = new AdminMutationService(prisma, audit);
  const numbering = new NumberingService(prisma), problems = new ProblemIndexService(prisma, numbering, audit, outbox);
  const responsibilities = new OrganizationResponsibilityService(prisma, mutations, audit);
  const registry = new WorkflowClosureRegistry([]), resources = new FileResourceAccess([]);
  const rounds = new WorkflowClosureRoundService(prisma, audit, responsibilities, registry, outbox);
  const extensions = new WorkflowDeadlineExtensionService(prisma, audit, responsibilities, registry, rounds, outbox);
  const ledger = new ProcessDefectLedgerService(prisma, mutations, audit);
  const readRegistry = new ProblemDomainRegistry([
    new DomainProblemReadAdapter({ domainCode: 'process-quality', sourceType: 'process-defect', permission: 'process-quality:defects:read', label: 'Process' }),
    new DomainProblemReadAdapter({ domainCode: 'customer-quality', sourceType: 'customer-complaint', permission: 'customer-quality:complaints:read', label: 'Customer' }),
  ]);
  const sourceLinks = new DomainSourceLinkService(prisma, audit, outbox);
  const service = new ProcessEightDService(prisma, ledger, new DomainSourceIssueService(prisma, problems, outbox), sourceLinks,
    new WorkflowRuntimeService(prisma, audit, outbox, problems), problems, rounds, responsibilities, resources, audit, outbox, readRegistry, extensions);
  const closure = new ProcessEightDClosureAdapter(registry, service), files = new ProcessEightDFileAdapter(resources, service);

  beforeAll(async () => { await prisma.$connect(); closure.onModuleInit(); files.onModuleInit(); new ProcessEightDReadAdapter(readRegistry, service).onModuleInit(); }, 120_000);
  afterAll(() => prisma.$disconnect());

  function gate() {
    let open!: () => void;
    const promise = new Promise<void>(resolve => { open = resolve; });
    return { promise, open };
  }

  async function waitFor(check: () => Promise<boolean>, message: string) {
    for (let attempt = 0; attempt < 200; attempt++) {
      if (await check()) return;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    throw new Error(message);
  }

  async function lockWait(pid: number, blocker: number, query: string) {
    const [row] = await prisma.$queryRaw<{ waiting: boolean }[]>`SELECT EXISTS (SELECT 1 FROM pg_stat_activity
      WHERE pid = ${pid} AND datname = current_database() AND state = 'active' AND wait_event_type = 'Lock'
        AND ${blocker} = ANY(pg_blocking_pids(pid)) AND query ILIKE ${`%${query}%`}) AS waiting`;
    return row?.waiting === true;
  }

  async function fixture(activate = true) {
    const organization = await prisma.organization.create({ data: { code: randomUUID(), name: '8D isolated fixture', type: 'INTERNAL' } });
    const department = await prisma.department.create({ data: { organizationId: organization.id, code: randomUUID(), name: '部' } });
    const section = await prisma.department.create({ data: { organizationId: organization.id, parentId: department.id, code: randomUUID(), name: '科' } });
    const otherSection = await prisma.department.create({ data: { organizationId: organization.id, parentId: department.id, code: randomUUID(), name: '跨部门' } });
    const role = await prisma.role.create({ data: { organizationId: organization.id, code: randomUUID(), name: 'Explicit test action grants' } });
    const permissions = ['configuration:read', 'configuration:manage', 'workflow:start', 'workflow:act', 'workflow:manage', 'process-quality:defects:read', 'process-quality:defects:write',
      ...['read', 'issue', 'work', 'sources', 'risk', 'reassign', 'deadlines'].map(action => `process-quality:issues:${action}`)];
    for (const code of permissions) {
      const permission = await prisma.permission.upsert({ where: { code }, create: { code, name: code }, update: {} });
      await prisma.rolePermission.create({ data: { roleId: role.id, permissionId: permission.id } });
    }
    const person = async (departmentId: string) => {
      const position = await prisma.position.create({ data: { organizationId: organization.id, departmentId, code: randomUUID(), name: 'No role-name special casing' } });
      const user = await prisma.user.create({ data: { organizationId: organization.id, username: randomUUID(), passwordHash: 'unused', accountType: 'INTERNAL' } });
      const assignment = await prisma.userPosition.create({ data: { organizationId: organization.id, userId: user.id, positionId: position.id, startedAt: new Date(Date.now() - 60_000) } });
      await prisma.userRole.create({ data: { organizationId: organization.id, userId: user.id, roleId: role.id } });
      const session = await prisma.session.create({ data: { userId: user.id, tokenHash: randomUUID(), expiresAt: new Date(Date.now() + 3_600_000), securityVersion: user.securityVersion, mfaVerifiedAt: new Date(), reauthenticatedAt: new Date() } });
      const actor: ProcessEightDActor = { id: user.id, organizationId: organization.id, accountType: 'INTERNAL', sessionId: session.id };
      return { user, actor, position, assignment };
    };
    const issuer = await person(department.id), owner = await person(section.id), manager = await person(section.id), minister = await person(department.id), collaborator = await person(otherSection.id);
    for (const [responsibility, departmentId, positionId] of [['SECTION_MANAGER', section.id, manager.position.id], ['MINISTER', department.id, minister.position.id]]) {
      await prisma.$executeRaw`INSERT INTO department_management_bindings (id, organization_id, department_id, responsibility, position_id, created_by, updated_by)
        VALUES (${randomUUID()}::uuid, ${organization.id}::uuid, ${departmentId}::uuid, ${responsibility}, ${positionId}::uuid, ${issuer.user.id}::uuid, ${issuer.user.id}::uuid)`;
    }
    await prisma.$executeRaw`INSERT INTO department_minister_scopes (id, organization_id, department_id, section_department_id, minister_assignment_id, valid_from, created_by, updated_by)
      VALUES (${randomUUID()}::uuid, ${organization.id}::uuid, ${department.id}::uuid, ${section.id}::uuid, ${minister.assignment.id}::uuid, CURRENT_TIMESTAMP - INTERVAL '1 minute', ${issuer.user.id}::uuid, ${issuer.user.id}::uuid)`;
    await numbering.publishRuleVersion({ organizationId: organization.id, ruleCode: 'PROBLEM', pattern: '{CODE}-{YYMM}-{SEQ3}' });
    const definitions = new WorkflowDefinitionService(prisma, new WorkflowValidationService(), audit, registry);
    const definition = await definitions.createDraft({ organizationId: organization.id, userId: issuer.user.id, actor: issuer.actor, code: randomUUID(), name: 'Real process 8D', draft: {
      nodes: [
        { id: 'owner', type: 'ACTION', name: 'Owner', config: { isStart: true, assignment: { permission: 'workflow:act' }, processEightD: { schemaVersion: 1, extensionPolicy: 'LEADER_THEN_PROFESSIONAL', reminderEveryHours: null } } },
        { id: 'closure', type: 'APPROVAL', name: 'Parallel closure', config: { closureReview: { schemaVersion: 1, policy: 'INTERNAL', domainCode: 'process-quality' } } },
        { id: 'close', type: 'CLOSE', name: 'Close', config: { isEnd: true, assignment: { permission: 'workflow:act' } } },
      ], transitions: [
        { id: 'submit', from: 'owner', to: 'closure', action: 'SUBMIT' }, { id: 'approve', from: 'closure', to: 'close', action: 'APPROVE' }, { id: 'return', from: 'closure', to: 'owner', action: 'RETURN' },
      ],
    } });
    const version = await definitions.publishVersion({ organizationId: organization.id, userId: issuer.user.id, actor: issuer.actor,
      definitionId: definition.id, draftVersionId: definition.version.id, expectedRevision: definition.revision });
    await service.bind(issuer.actor, { expectedVersion: 0, workflowDefinitionId: definition.id, workflowVersionId: version.id }, randomUUID(), randomUUID());
    if (activate) await service.activate(issuer.actor, { expectedVersion: 1, enabled: true }, randomUUID(), randomUUID());
    const source = () => ledger.create(issuer.actor, { description: '真实原台账来源，未知分类保留空' }, randomUUID(), randomUUID());
    const input = (sources: { id: string; version: number }[]) => ({ sources: sources.map(s => ({ defectId: s.id, expectedVersion: s.version })), severity: 'LOW' as const,
      ownerUserId: owner.user.id, responsibleSectionDepartmentId: section.id, analysisDueAt: new Date('2026-11-01T00:00:00Z'), closureDueAt: new Date('2026-12-01T00:00:00Z') });
    const issue = async () => { const defect = await source(); const issued = await service.issue(issuer.actor, input([defect]), randomUUID(), randomUUID()); return String(issued.problem.id); };
    const read = (id: string) => service.read(owner.actor, id);
    const draft = () => normalizeProcessEightDDocument({ occurrenceCause: '发生因', escapeCause: '流出因', correctiveActions: ['OCCURRENCE', 'ESCAPE'].map((causeKind, index) => ({
      id: `action-${index}`, causeKind, action: '真实对策', owner: '实际负责人', plannedAt: '2026-10-25', verificationMethod: '按实测标准', implementationAt: '2026-10-25',
      result: '已实施', beforeState: '改善前', afterState: '改善后', firstBatch: `REAL-BATCH-${index}`, followUpDuration: '实际跟进一周', verificationRecord: '实测符合判定标准', effective: true,
    })) });
    const ready = async (id: string) => {
      let current = await read(id);
      await service.save(owner.actor, id, { expectedVersion: current.version, document: draft() }, randomUUID(), randomUUID());
      current = await read(id);
      await service.analysisComplete(owner.actor, id, { expectedVersion: current.version, submissionDueAt: new Date('2026-11-10T00:00:00Z') }, randomUUID(), randomUUID());
      return read(id);
    };
    const submit = async (id: string) => { const current = await ready(id); await service.submit(owner.actor, id, { expectedVersion: current.version }, randomUUID(), randomUUID()); return rounds.readProjection(prisma, organization.id, id); };
    return { organization, department, section, otherSection, role, person, issuer, owner, manager, minister, collaborator, source, input, issue, read, ready, submit, draft };
  }

  it('does not issue until a published binding is separately enabled; records the real issuer as professional', async () => {
    const f = await fixture(false), source = await f.source();
    await expect(service.issue(f.issuer.actor, f.input([source]), randomUUID(), randomUUID())).rejects.toMatchObject({ status: 409 });
    expect(await prisma.problemIndex.count({ where: { organizationId: f.organization.id } })).toBe(0);
    await service.activate(f.issuer.actor, { expectedVersion: 1, enabled: true }, randomUUID(), randomUUID());
    const result = await service.issue(f.issuer.actor, f.input([source]), randomUUID(), randomUUID());
    const id = String(result.problem.id), model = await f.read(id);
    expect(model).toMatchObject({ professionalUserId: f.issuer.user.id, ownerUserId: f.owner.user.id, version: 1, contentVersion: 1 });
    await expect(service.save(f.issuer.actor, id, { expectedVersion: 1, document: f.draft() }, randomUUID(), randomUUID())).rejects.toMatchObject({ status: 403 });
  }, 120_000);

  it('lists domain-authorized active assignment candidates without workflow/structure management grants', async () => {
    const f = await fixture(), other = await fixture();
    const workflowManage = await prisma.permission.findUniqueOrThrow({ where: { code: 'workflow:manage' } });
    await prisma.rolePermission.delete({ where: { roleId_permissionId: { roleId: f.role.id, permissionId: workflowManage.id } } });
    const query = (input: Partial<ProcessEightDAssignmentOptionsQueryDto>) => Object.assign(new ProcessEightDAssignmentOptionsQueryDto(), input);
    const selected = await service.assignmentOptions(f.issuer.actor, query({ sectionDepartmentId: f.section.id, search: f.owner.user.username }));
    expect(selected.users).toEqual([{ id: f.owner.user.id, username: f.owner.user.username, fullName: null }]);
    expect(selected.userTotal).toBe(1);
    expect(Object.keys(selected.users[0]!).sort()).toEqual(['fullName', 'id', 'username']);
    expect(selected.departments.every(department => [f.section.id, f.department.id, f.otherSection.id].includes(department.id))).toBe(true);
    const page = await service.assignmentOptions(f.issuer.actor, query({ sectionDepartmentId: f.section.id, pageSize: 1, page: 2 }));
    expect(page.users).toHaveLength(1); expect(page.userTotal).toBe(2);
    const outsider = await service.assignmentOptions(f.issuer.actor, query({ sectionDepartmentId: other.section.id }));
    expect(outsider.users).toEqual([]); expect(outsider.userTotal).toBe(0);
    const id = await f.issue();
    const collaborators = await service.assignmentOptions(f.owner.actor, query({ action: 'COLLABORATORS', problemId: id, search: f.collaborator.user.username }));
    expect(collaborators.users.map(user => user.id)).toEqual([f.collaborator.user.id]);
    await prisma.userPosition.update({ where: { id: f.collaborator.assignment.id }, data: { endedAt: new Date(Date.now() - 1_000) } });
    expect((await service.assignmentOptions(f.owner.actor, query({ action: 'COLLABORATORS', problemId: id, search: f.collaborator.user.username }))).userTotal).toBe(0);
    await expect(service.assignmentOptions(f.collaborator.actor, query({ action: 'COLLABORATORS', problemId: id }))).rejects.toMatchObject({ status: 403 });
    const issuePermission = await prisma.permission.findUniqueOrThrow({ where: { code: 'process-quality:issues:issue' } });
    await prisma.rolePermission.delete({ where: { roleId_permissionId: { roleId: f.role.id, permissionId: issuePermission.id } } });
    await expect(service.assignmentOptions(f.issuer.actor, query({}))).rejects.toMatchObject({ status: 403 });
    await prisma.session.update({ where: { id: f.owner.actor.sessionId }, data: { revokedAt: new Date() } });
    await expect(service.assignmentOptions(f.owner.actor, query({ action: 'REASSIGN', problemId: id }))).rejects.toMatchObject({ status: 401 });
  }, 120_000);

  it('joins 1..100 original ledger sources and requires exact explicit non-recurrence confirmation for another issue', async () => {
    const f = await fixture(), a = await f.source(), b = await f.source();
    const first = await service.issue(f.issuer.actor, f.input([a, b]), randomUUID(), randomUUID());
    expect((await f.read(String(first.problem.id))).sources).toHaveLength(2);
    await expect(service.issue(f.issuer.actor, f.input([a]), randomUUID(), randomUUID())).rejects.toMatchObject({ status: 409 });
    const second = await service.issue(f.issuer.actor, { ...f.input([a]), sourceConfirmations: [{ defectId: a.id, relatedProblemIds: [String(first.problem.id)], recurrence: 'NOT_RECURRENCE' }] }, randomUUID(), randomUUID());
    expect(second.problem.id).not.toBe(first.problem.id);
    const [confirmation] = await prisma.$queryRaw<{ recurrence: string; actorUserId: string }[]>`SELECT recurrence, actor_user_id AS "actorUserId" FROM process_eight_d_source_confirmations WHERE problem_id = ${String(second.problem.id)}::uuid`;
    expect(confirmation).toEqual({ recurrence: 'NOT_RECURRENCE', actorUserId: f.issuer.user.id });
  }, 120_000);

  it('allows a current cross-department collaborator whole-document saves, never submission, and immediately revokes removed collaborators', async () => {
    const f = await fixture(), id = await f.issue();
    await service.collaborators(f.owner.actor, id, { expectedVersion: 1, userIds: [f.collaborator.user.id] }, randomUUID(), randomUUID());
    await service.save(f.collaborator.actor, id, { expectedVersion: 2, document: f.draft() }, randomUUID(), randomUUID());
    await expect(service.submit(f.collaborator.actor, id, { expectedVersion: 3 }, randomUUID(), randomUUID())).rejects.toMatchObject({ status: 403 });
    await service.collaborators(f.owner.actor, id, { expectedVersion: 3, userIds: [] }, randomUUID(), randomUUID());
    await expect(service.save(f.collaborator.actor, id, { expectedVersion: 4, document: f.draft() }, randomUUID(), randomUUID())).rejects.toMatchObject({ status: 403 });
  }, 120_000);

  it('previews primary and secondary links, hides other domains and revalidates the exact set before issuing', async () => {
    const f = await fixture(), a = await f.source(), b = await f.source();
    const first = await service.issue(f.issuer.actor, f.input([a, b]), randomUUID(), randomUUID());
    const id = String(first.problem.id);
    const document = f.draft(); document.description = 'Visible process title';
    await service.save(f.owner.actor, id, { expectedVersion: 1, document }, randomUUID(), randomUUID());
    const previewInput = { sources: f.input([a, b]).sources };
    const [primary, secondary] = await service.previewSources(f.issuer.actor, previewInput);
    expect(primary!.relatedProblems).toEqual([{ problemId: id, reportNumber: first.problem.reportNumber, title: 'Visible process title', status: first.problem.status, primary: true }]);
    expect(secondary!.relatedProblems).toEqual([{ ...primary!.relatedProblems[0], primary: false }]);
    const hidden = await prisma.problemIndex.create({ data: { organizationId: f.organization.id, reportNumber: randomUUID(),
      domainCode: 'customer-quality', sourceType: 'customer-complaint', problemType: 'CUSTOMER', sourceId: randomUUID(), severity: 'LOW' } });
    await prisma.domainSourceIssueLink.create({ data: { organizationId: f.organization.id, problemIndexId: hidden.id,
      ...await ledger.sourceReference(f.issuer.actor, a.id) } });
    const stale = { defectId: a.id, relatedProblemIds: [id], relatedSetToken: primary!.relatedSetToken, recurrence: 'NOT_RECURRENCE' as const };
    await expect(service.issue(f.issuer.actor, { ...f.input([a]), sourceConfirmations: [stale] }, randomUUID(), randomUUID())).rejects.toMatchObject({ status: 409 });
    const [current] = await service.previewSources(f.issuer.actor, { sources: f.input([a]).sources });
    expect(current).toMatchObject({ hasHiddenRelations: true, relatedProblems: primary!.relatedProblems });
    expect(JSON.stringify(current)).not.toContain(hidden.id);
    expect(JSON.stringify(current)).not.toContain(hidden.reportNumber);
    const issued = await service.issue(f.issuer.actor, { ...f.input([a]), sourceConfirmations: [{ ...stale, relatedSetToken: current!.relatedSetToken, reason: 'Different cause' }] }, randomUUID(), randomUUID());
    const [fact] = await prisma.$queryRaw<{ relatedProblemIds: string[]; recurrence: string; reason: string; actorUserId: string; recordedAt: Date }[]>`SELECT related_problem_ids AS "relatedProblemIds", recurrence, reason, actor_user_id AS "actorUserId", recorded_at AS "recordedAt"
      FROM process_eight_d_source_confirmations WHERE problem_id = ${String(issued.problem.id)}::uuid`;
    expect(fact).toMatchObject({ relatedProblemIds: [id, hidden.id].sort(), recurrence: 'NOT_RECURRENCE', reason: 'Different cause', actorUserId: f.issuer.user.id });
    expect(fact!.recordedAt).toBeInstanceOf(Date);
    const permission = await prisma.permission.upsert({ where: { code: 'customer-quality:complaints:read' }, create: { code: 'customer-quality:complaints:read', name: 'Customer read' }, update: {} });
    await prisma.rolePermission.create({ data: { roleId: f.role.id, permissionId: permission.id } });
    const [authorized] = await service.previewSources(f.issuer.actor, { sources: f.input([a]).sources });
    expect(authorized!.hasHiddenRelations).toBe(false);
    expect(authorized!.relatedProblems).toContainEqual({ problemId: hidden.id, reportNumber: hidden.reportNumber, title: hidden.reportNumber, status: hidden.status, primary: false });
  }, 120_000);

  it('revalidates source-change previews and never exposes relations after read permission is revoked', async () => {
    const f = await fixture(), a = await f.source(), b = await f.source(), target = await f.issue();
    const first = await service.issue(f.issuer.actor, f.input([a]), randomUUID(), randomUUID());
    const [preview] = await service.previewSources(f.issuer.actor, { sources: f.input([a]).sources, problemId: target });
    const confirmation = { defectId: a.id, relatedProblemIds: [String(first.problem.id)], relatedSetToken: preview!.relatedSetToken, recurrence: 'RECURRENCE' as const };
    const [issuePreview] = await service.previewSources(f.issuer.actor, { sources: f.input([a]).sources });
    await service.issue(f.issuer.actor, { ...f.input([a]), sourceConfirmations: [{ ...confirmation, relatedSetToken: issuePreview!.relatedSetToken }] }, randomUUID(), randomUUID());
    await expect(service.sources(f.issuer.actor, target, { expectedVersion: 1, add: f.input([a]).sources, removeDefectIds: [], sourceConfirmations: [confirmation] }, randomUUID(), randomUUID())).rejects.toMatchObject({ status: 409 });
    expect((await f.read(target)).version).toBe(1);
    const [fresh] = await service.previewSources(f.issuer.actor, { sources: f.input([a]).sources, problemId: target });
    await service.sources(f.issuer.actor, target, { expectedVersion: 1, add: f.input([a]).sources, removeDefectIds: [], sourceConfirmations: [{ ...confirmation,
      relatedProblemIds: fresh!.relatedProblems.map(p => p.problemId), relatedSetToken: fresh!.relatedSetToken }] }, randomUUID(), randomUUID());
    const [fact] = await prisma.$queryRaw<{ recurrence: string }[]>`SELECT recurrence FROM process_eight_d_source_confirmations WHERE problem_id = ${target}::uuid`;
    expect(fact!.recurrence).toBe('RECURRENCE');
    const readPermission = await prisma.permission.findUniqueOrThrow({ where: { code: 'process-quality:issues:read' } });
    await prisma.rolePermission.delete({ where: { roleId_permissionId: { roleId: f.role.id, permissionId: readPermission.id } } });
    const [hidden] = await service.previewSources(f.issuer.actor, { sources: f.input([a]).sources });
    expect(hidden).toMatchObject({ relatedProblems: [], hasHiddenRelations: true });
    const other = await fixture();
    await expect(service.previewSources(other.issuer.actor, { sources: f.input([b]).sources })).rejects.toMatchObject({ status: 404 });
    await prisma.session.update({ where: { id: f.issuer.actor.sessionId }, data: { revokedAt: new Date() } });
    await expect(service.previewSources(f.issuer.actor, { sources: f.input([a]).sources })).rejects.toMatchObject({ status: 401 });
  }, 120_000);

  it('never rewrites analysis completion on repeat and cannot postpone an existing plan after analysis edits', async () => {
    const f = await fixture(), id = await f.issue(), before = await f.ready(id);
    await service.analysisComplete(f.owner.actor, id, { expectedVersion: before.version, submissionDueAt: new Date(before.submissionDueAt!) }, randomUUID(), randomUUID());
    expect(await f.read(id)).toMatchObject({ version: before.version, analysisCompletedAt: before.analysisCompletedAt, submissionDueAt: before.submissionDueAt });
    const document = f.draft(); document.analysisProcess = 'Revised analysis';
    await service.save(f.owner.actor, id, { expectedVersion: before.version, document }, randomUUID(), randomUUID());
    const revised = await f.read(id);
    expect(revised.analysisCompletedAt).toBeNull();
    await expect(service.analysisComplete(f.owner.actor, id, { expectedVersion: revised.version, submissionDueAt: new Date('2027-01-01T00:00:00Z') }, randomUUID(), randomUUID())).rejects.toMatchObject({ status: 409 });
    expect((await f.read(id)).version).toBe(revised.version);
    await service.analysisComplete(f.owner.actor, id, { expectedVersion: revised.version, submissionDueAt: new Date(before.submissionDueAt!) }, randomUUID(), randomUUID());
    expect((await f.read(id)).submissionDueAt).toBe(before.submissionDueAt);
    await prisma.$transaction(async tx => { const record = await service.lockRecord(tx, f.owner.actor, id, 'DEADLINE');
      await service.applyDeadlineExtension(tx, record, 'SUBMISSION', new Date('2027-01-01T00:00:00Z')); });
    expect((await f.read(id)).submissionDueAt).toBe('2027-01-01T00:00:00.000Z');
  }, 120_000);

  it('keeps chosen submission plans when only D6 implementation changes and rejects stale row CAS with no partial writes', async () => {
    const f = await fixture(), id = await f.issue(), model = await f.ready(id);
    const document = f.draft(); document.correctiveActions[0]!.result = '更新实际实施事实';
    await service.save(f.owner.actor, id, { expectedVersion: model.version, document }, randomUUID(), randomUUID());
    const after = await f.read(id);
    expect(after.analysisCompletedAt).toBe(model.analysisCompletedAt);
    expect(after.submissionDueAt).toBe(model.submissionDueAt);
    await expect(service.save(f.owner.actor, id, { expectedVersion: model.version, document: f.draft() }, randomUUID(), randomUUID())).rejects.toMatchObject({ status: 409 });
    expect((await f.read(id)).document.correctiveActions[0]!.result).toBe('更新实际实施事实');
  }, 120_000);

  it('only starts N2 after real complete content; locks editing/reassignment and cancels old round before a confirmed risk change', async () => {
    const f = await fixture(), id = await f.issue();
    await expect(service.submit(f.owner.actor, id, { expectedVersion: 1 }, randomUUID(), randomUUID())).rejects.toMatchObject({ status: 400 });
    const round = (await f.submit(id))!, current = await f.read(id);
    expect(round.duties.map(d => d.duty)).toEqual(['PROFESSIONAL', 'SECTION_MANAGER']);
    await expect(service.save(f.owner.actor, id, { expectedVersion: current.version, document: f.draft() }, randomUUID(), randomUUID())).rejects.toMatchObject({ status: 409 });
    await expect(service.reassign(f.owner.actor, id, { expectedVersion: current.version, ownerUserId: f.manager.user.id, responsibleSectionDepartmentId: f.section.id }, randomUUID(), randomUUID())).rejects.toMatchObject({ status: 409 });
    await expect(service.risk(f.issuer.actor, id, { expectedVersion: current.version, severity: 'HIGH' }, randomUUID(), randomUUID())).rejects.toMatchObject({ status: 409 });
    expect((await rounds.readProjection(prisma, f.organization.id, id))!.status).toBe('PENDING');
    await service.risk(f.issuer.actor, id, { expectedVersion: current.version, severity: 'HIGH', confirmCancelApproval: true }, randomUUID(), randomUUID());
    expect((await rounds.readProjection(prisma, f.organization.id, id))!.status).toBe('CANCELLED');
    expect(await f.read(id)).toMatchObject({ severity: 'HIGH', status: 'PROCESSING' });
  }, 120_000);

  it('closes only after both actual N2 duties, creates immutable complete revision, and never rewrites it on closed source append', async () => {
    const f = await fixture(), id = await f.issue(), round = (await f.submit(id))!;
    const one = await rounds.decide(f.issuer.actor, round.id, { expectedRoundVersion: round.version, duties: ['PROFESSIONAL'], decision: 'APPROVE', comment: '按当前事实核验通过' }, randomUUID(), randomUUID());
    expect((await f.read(id)).status).toBe('IN_REVIEW');
    const key = randomUUID(), decision = { expectedRoundVersion: one.version, duties: ['SECTION_MANAGER'] as ['SECTION_MANAGER'], decision: 'APPROVE' as const, comment: '按当前事实核验通过' };
    const done = await rounds.decide(f.manager.actor, one.id, decision, key, randomUUID());
    expect(done.status).toBe('APPROVED');
    expect(await rounds.decide(f.manager.actor, one.id, decision, key, randomUUID())).toEqual(done);
    const closed = await f.read(id);
    expect(closed.status).toBe('CLOSED'); expect(closed.closedRevisionId).not.toBeNull();
    const snapshot = await prisma.$transaction(tx => service.readReport(tx, f.owner.actor, id, closed.closedRevisionId!));
    const additional = await f.source();
    await service.sources(f.issuer.actor, id, { expectedVersion: closed.version, add: [{ defectId: additional.id, expectedVersion: additional.version }], removeDefectIds: [] }, randomUUID(), randomUUID());
    expect((await f.read(id)).contentVersion).toBe(closed.contentVersion);
    const historical = await prisma.$transaction(tx => service.readReport(tx, f.owner.actor, id, closed.closedRevisionId!));
    expect(historical.snapshot).toEqual(snapshot.snapshot);
    const current = await prisma.$transaction(tx => service.readReport(tx, f.owner.actor, id, null));
    expect(current.revision).toBeNull();
    expect((current.snapshot as { sources: unknown[] }).sources).toHaveLength(2);
    expect(((await prisma.$transaction(tx => service.readReport(tx, f.owner.actor, id))).snapshot as { sources: unknown[] }).sources).toHaveLength(1);
    await expect(prisma.$executeRaw`UPDATE process_eight_d_revisions SET snapshot = '{}'::jsonb WHERE id = ${closed.closedRevisionId}::uuid`).rejects.toThrow();
    await expect(service.save(f.owner.actor, id, { expectedVersion: (await f.read(id)).version, document: f.draft() }, randomUUID(), randomUUID())).rejects.toMatchObject({ status: 409 });
  }, 120_000);

  it('return restores the same owner/collaborator editing and next submission carries none of the prior approvals', async () => {
    const f = await fixture(), id = await f.issue();
    await service.collaborators(f.owner.actor, id, { expectedVersion: 1, userIds: [f.collaborator.user.id] }, randomUUID(), randomUUID());
    const round = (await f.submit(id))!;
    await rounds.decide(f.manager.actor, round.id, { expectedRoundVersion: round.version, duties: ['SECTION_MANAGER'], decision: 'RETURN', comment: '请完善实测' }, randomUUID(), randomUUID());
    const returned = await f.read(id);
    expect(returned).toMatchObject({ status: 'PROCESSING', ownerUserId: f.owner.user.id, collaboratorUserIds: [f.collaborator.user.id] });
    await service.save(f.collaborator.actor, id, { expectedVersion: returned.version, document: f.draft() }, randomUUID(), randomUUID());
    await service.submit(f.owner.actor, id, { expectedVersion: (await f.read(id)).version }, randomUUID(), randomUUID());
    const next = (await rounds.readProjection(prisma, f.organization.id, id))!;
    expect(next.roundNumber).toBe(2); expect(next.duties.every(d => d.status === 'PENDING')).toBe(true);
  }, 120_000);

  it('keeps pending closure signatures on a deadline extension and applies row CAS only inside the original transaction', async () => {
    const f = await fixture(), id = await f.issue(), round = (await f.submit(id))!, before = await f.read(id);
    await prisma.$transaction(async tx => { const record = await service.lockRecord(tx, f.owner.actor, id, 'DEADLINE');
      await service.applyDeadlineExtension(tx, record, 'CLOSURE', new Date('2027-01-01T00:00:00Z')); }, { isolationLevel: 'ReadCommitted' });
    const after = await f.read(id);
    expect(after.version).toBe(before.version + 1); expect(after.contentVersion).toBe(before.contentVersion);
    expect((await rounds.readProjection(prisma, f.organization.id, id))!.id).toBe(round.id);
    expect((await rounds.decide(f.issuer.actor, round.id, { expectedRoundVersion: round.version, duties: ['PROFESSIONAL'], decision: 'APPROVE', comment: '按当前事实核验通过' }, randomUUID(), randomUUID())).status).toBe('PENDING');
  }, 120_000);

  it('projects the first closure deadline to the problem center without changing controlled content', async () => {
    const f = await fixture(), source = await f.source();
    const issued = await service.issue(f.issuer.actor, { ...f.input([source]), closureDueAt: undefined }, randomUUID(), randomUUID());
    const id = String(issued.problem.id), before = await f.read(id), dueAt = new Date('2026-12-15T00:00:00Z');
    await service.deadlines(f.issuer.actor, id, { expectedVersion: before.version, closureDueAt: dueAt }, randomUUID(), randomUUID());
    const after = await f.read(id), index = await prisma.problemIndex.findUniqueOrThrow({ where: { id } });
    expect(after).toMatchObject({ closureDueAt: dueAt.toISOString(), contentVersion: before.contentVersion, version: before.version + 1 });
    expect(index.dueAt).toEqual(dueAt);
    expect(index.version).toBe(before.problemVersion + 1);
    await expect(service.deadlines(f.issuer.actor, id, { expectedVersion: before.version, closureDueAt: new Date('2027-01-01') }, randomUUID(), randomUUID()))
      .rejects.toMatchObject({ status: 409 });
    expect((await prisma.problemIndex.findUniqueOrThrow({ where: { id } })).dueAt).toEqual(dueAt);
  }, 120_000);

  it('projects only fully approved closure extensions and retains original deadline history and existing signatures', async () => {
    const f = await fixture(), id = await f.issue(), round = (await f.submit(id))!;
    const signed = await rounds.decide(f.issuer.actor, round.id, { expectedRoundVersion: round.version, duties: ['PROFESSIONAL'], decision: 'APPROVE', comment: 'Verified current report' }, randomUUID(), randomUUID());
    const before = await f.read(id), originalDueAt = before.closureDueAt!, requestedDueAt = '2027-01-15T00:00:00.000Z';
    const request = await extensions.request(f.owner.actor, id, { expectedRowVersion: before.version, expectedInstanceVersion: before.instanceVersion,
      stage: 'CLOSURE', requestedDueAt, reason: 'Keep the original deadline until both actual approvals' }, randomUUID(), randomUUID());
    expect(request.originalDueAt).toBe(originalDueAt);
    const leader = await extensions.decide(f.manager.actor, request.id, { expectedVersion: request.version, decision: 'APPROVE' }, randomUUID(), randomUUID());
    expect(leader.status).toBe('QUALITY_PENDING');
    expect((await f.read(id)).closureDueAt).toBe(originalDueAt);
    expect((await prisma.problemIndex.findUniqueOrThrow({ where: { id } })).dueAt?.toISOString()).toBe(originalDueAt);
    const approved = await extensions.decide(f.issuer.actor, request.id, { expectedVersion: leader.version, decision: 'APPROVE' }, randomUUID(), randomUUID());
    expect(approved).toMatchObject({ status: 'APPROVED', originalDueAt, requestedDueAt });
    expect((await extensions.history(f.owner.actor, id))[0]).toMatchObject({ originalDueAt, history: approved.history });
    expect((await f.read(id)).closureDueAt).toBe(requestedDueAt);
    expect((await prisma.problemIndex.findUniqueOrThrow({ where: { id } })).dueAt?.toISOString()).toBe(requestedDueAt);
    expect((await rounds.readProjection(prisma, f.organization.id, id))!.duties).toEqual(signed.duties);
    expect((await f.read(id)).contentVersion).toBe(before.contentVersion);
  }, 120_000);

  it.each(['REPORT', 'INDEX'] as const)('rolls back both closure deadline projections, audit and outbox when the %s CAS fails', async stale => {
    const f = await fixture(), id = await f.issue(), before = await f.read(id);
    const audits = await prisma.auditEvent.count({ where: { resourceId: id } }), events = await prisma.outboxEvent.count({ where: { aggregateId: id } });
    const mutation = prisma.$transaction(async tx => {
      const record = await service.lockRecord(tx, f.owner.actor, id, 'DEADLINE');
      if (stale === 'REPORT') await tx.$executeRaw`UPDATE process_eight_d_reports SET version = version + 1 WHERE problem_id = ${id}::uuid`;
      else await tx.problemIndex.update({ where: { id }, data: { version: { increment: 1 } } });
      await service.applyDeadlineExtension(tx, record, 'CLOSURE', new Date('2027-01-15'));
    });
    if (stale === 'REPORT') await expect(mutation).rejects.toMatchObject({ status: 409 });
    else await expect(mutation).rejects.toThrow('PROBLEM_VERSION_CONFLICT');
    expect(await f.read(id)).toMatchObject({ version: before.version, contentVersion: before.contentVersion, closureDueAt: before.closureDueAt });
    const index = await prisma.problemIndex.findUniqueOrThrow({ where: { id } });
    expect(index).toMatchObject({ version: before.problemVersion, dueAt: new Date(before.closureDueAt!) });
    expect(await prisma.auditEvent.count({ where: { resourceId: id } })).toBe(audits);
    expect(await prisma.outboxEvent.count({ where: { aggregateId: id } })).toBe(events);
  }, 120_000);

  it.each(['manager', 'minister'] as const)('replays a %s internal reassignment with current work/management eligibility, not cross-department grants', async person => {
    const f = await fixture(), id = await f.issue(), target = await f.person(f.section.id), actor = f[person].actor;
    const permission = await prisma.permission.findUniqueOrThrow({ where: { code: 'process-quality:issues:reassign' } });
    await prisma.rolePermission.delete({ where: { roleId_permissionId: { roleId: f.role.id, permissionId: permission.id } } });
    const key = randomUUID(), input = { expectedVersion: 1, ownerUserId: target.user.id, responsibleSectionDepartmentId: f.section.id };
    const result = await service.reassign(actor, id, input, randomUUID(), key);
    const before = await f.read(id), audits = await prisma.auditEvent.count({ where: { resourceId: id } }), events = await prisma.outboxEvent.count({ where: { aggregateId: id } });
    expect(await service.reassign(actor, id, input, randomUUID(), key)).toEqual(result);
    expect((await f.read(id)).version).toBe(before.version);
    expect(await prisma.auditEvent.count({ where: { resourceId: id } })).toBe(audits);
    expect(await prisma.outboxEvent.count({ where: { aggregateId: id } })).toBe(events);
    await expect(service.reassign(actor, id, { ...input, reason: 'changed body' }, randomUUID(), key)).rejects.toMatchObject({ status: 409 });
    await prisma.userPosition.update({ where: { id: f[person].assignment.id }, data: { endedAt: new Date() } });
    await expect(service.reassign(actor, id, input, randomUUID(), key)).rejects.toMatchObject({ status: 403 });
  }, 120_000);

  it('does not let a former owner replay internal reassignment using an unrelated cross-department grant', async () => {
    const f = await fixture(), id = await f.issue(), key = randomUUID();
    const permission = await prisma.permission.findUniqueOrThrow({ where: { code: 'process-quality:issues:reassign' } });
    await prisma.rolePermission.delete({ where: { roleId_permissionId: { roleId: f.role.id, permissionId: permission.id } } });
    const input = { expectedVersion: 1, ownerUserId: f.manager.user.id, responsibleSectionDepartmentId: f.section.id };
    await service.reassign(f.owner.actor, id, input, randomUUID(), key);
    const [receipt] = await prisma.$queryRaw<{ kind: string }[]>`SELECT response->'reassignmentAccess'->>'kind' AS kind FROM process_eight_d_receipts
      WHERE organization_id = ${f.organization.id}::uuid AND actor_user_id = ${f.owner.user.id}::uuid AND key = ${key}`;
    expect(receipt).toEqual({ kind: 'OWNER' });
    await prisma.rolePermission.create({ data: { roleId: f.role.id, permissionId: permission.id } });
    await expect(service.reassign(f.owner.actor, id, input, randomUUID(), key)).rejects.toMatchObject({ status: 403 });
    expect((await f.read(id)).ownerUserId).toBe(f.manager.user.id);
  }, 120_000);

  it('preserves cross-department replay authorization but rejects revoked work and changed workflow state for internal replay', async () => {
    const f = await fixture(), id = await f.issue(), key = randomUUID();
    const input = { expectedVersion: 1, ownerUserId: f.collaborator.user.id, responsibleSectionDepartmentId: f.otherSection.id };
    const result = await service.reassign(f.issuer.actor, id, input, randomUUID(), key);
    expect(await service.reassign(f.issuer.actor, id, input, randomUUID(), key)).toEqual(result);
    const permission = await prisma.permission.findUniqueOrThrow({ where: { code: 'process-quality:issues:reassign' } });
    await prisma.rolePermission.delete({ where: { roleId_permissionId: { roleId: f.role.id, permissionId: permission.id } } });
    await expect(service.reassign(f.issuer.actor, id, input, randomUUID(), key)).rejects.toMatchObject({ status: 403 });

    const g = await fixture(), internalId = await g.issue(), internalKey = randomUUID();
    await prisma.rolePermission.delete({ where: { roleId_permissionId: { roleId: g.role.id, permissionId: permission.id } } });
    const internalInput = { expectedVersion: 1, ownerUserId: g.owner.user.id, responsibleSectionDepartmentId: g.section.id };
    await service.reassign(g.manager.actor, internalId, internalInput, randomUUID(), internalKey);
    const [receipt] = await prisma.$queryRaw<{ kind: string }[]>`SELECT response->'reassignmentAccess'->>'kind' AS kind FROM process_eight_d_receipts
      WHERE organization_id = ${g.organization.id}::uuid AND actor_user_id = ${g.manager.user.id}::uuid AND key = ${internalKey}`;
    expect(receipt).toEqual({ kind: 'MANAGEMENT' });
    const work = await prisma.permission.findUniqueOrThrow({ where: { code: 'process-quality:issues:work' } });
    await prisma.rolePermission.delete({ where: { roleId_permissionId: { roleId: g.role.id, permissionId: work.id } } });
    await expect(service.reassign(g.manager.actor, internalId, internalInput, randomUUID(), internalKey)).rejects.toMatchObject({ status: 403 });
    await prisma.rolePermission.create({ data: { roleId: g.role.id, permissionId: work.id } });
    await g.submit(internalId);
    await expect(service.reassign(g.manager.actor, internalId, internalInput, randomUUID(), internalKey)).rejects.toMatchObject({ status: 409 });
  }, 120_000);

  it('durably retains bounded risk reasons and actor/before/after facts in domain outbox history, including changes outside review', async () => {
    const f = await fixture(), id = await f.issue(), key = randomUUID(), reason = 'Measured field impact requires escalation';
    const input = { expectedVersion: 1, severity: 'HIGH' as const, reason };
    const changed = await service.risk(f.issuer.actor, id, input, randomUUID(), key);
    const event = await prisma.outboxEvent.findFirstOrThrow({ where: { aggregateId: id, eventType: 'PROCESS_EIGHT_D_CHANGED' } });
    expect(event.payload).toMatchObject({ action: 'RISK', organizationId: f.organization.id, problemId: id,
      riskChange: { actorUserId: f.issuer.user.id, previousSeverity: 'LOW', severity: 'HIGH', reason } });
    const audited = await prisma.auditEvent.findFirstOrThrow({ where: { resourceId: id, action: 'PROCESS_EIGHT_D_RISK' } });
    expect(audited.metadata).not.toHaveProperty('reason');
    expect(await service.risk(f.issuer.actor, id, input, randomUUID(), key)).toEqual(changed);
    expect(await prisma.outboxEvent.count({ where: { aggregateId: id, eventType: 'PROCESS_EIGHT_D_CHANGED' } })).toBe(1);
    await service.risk(f.issuer.actor, id, { expectedVersion: changed.version, severity: 'CRITICAL', reason: 'New independently recorded assessment' }, randomUUID(), randomUUID());
    expect((await prisma.outboxEvent.findUniqueOrThrow({ where: { id: event.id } })).payload).toEqual(event.payload);
    await expect(service.risk(f.issuer.actor, id, { expectedVersion: changed.version + 1, severity: 'LOW', reason: 'x'.repeat(2001) }, randomUUID(), randomUUID()))
      .rejects.toMatchObject({ status: 400 });
    expect(await prisma.outboxEvent.count({ where: { aggregateId: id, eventType: 'PROCESS_EIGHT_D_CHANGED' } })).toBe(2);
  }, 120_000);

  it.each(['ASSIGNMENT', 'SCOPE'] as const)('rejects management reassignment when %s expires during a real resolver lock wait, without resolving again', async source => {
    const f = await fixture(), id = await f.issue(), before = await f.read(id);
    const permission = await prisma.permission.findUniqueOrThrow({ where: { code: 'process-quality:issues:reassign' } });
    await prisma.rolePermission.delete({ where: { roleId_permissionId: { roleId: f.role.id, permissionId: permission.id } } });
    const expiresAt = new Date(Date.now() + 2000);
    const actor = source === 'ASSIGNMENT' ? f.manager.actor : f.minister.actor;
    if (source === 'ASSIGNMENT') await prisma.userPosition.update({ where: { id: f.manager.assignment.id }, data: { endedAt: expiresAt } });
    else await prisma.$executeRaw`UPDATE department_minister_scopes SET valid_to = ${expiresAt}
      WHERE organization_id = ${f.organization.id}::uuid AND section_department_id = ${f.section.id}::uuid AND minister_assignment_id = ${f.minister.assignment.id}::uuid`;
    const audits = await prisma.auditEvent.count({ where: { resourceId: id } }), events = await prisma.outboxEvent.count({ where: { aggregateId: id } });
    let locked!: () => void, release!: () => void, resolving!: () => void;
    const lockReady = new Promise<void>(resolve => { locked = resolve; }), hold = new Promise<void>(resolve => { release = resolve; });
    const resolverStarted = new Promise<void>(resolve => { resolving = resolve; });
    const blocker = prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM departments WHERE id = ${f.section.id}::uuid FOR UPDATE`;
      locked(); await hold;
    }, { timeout: 15_000 });
    const original = responsibilities.resolveManagementResponsibilities.bind(responsibilities);
    const resolver = jest.spyOn(responsibilities, 'resolveManagementResponsibilities').mockImplementation(async (tx, organizationId, sectionId, at = new Date()) => {
      resolving(); return original(tx, organizationId, sectionId, at);
    });
    let result: Promise<unknown> | undefined;
    try {
      await lockReady;
      result = service.reassign(actor, id, { expectedVersion: before.version, ownerUserId: f.owner.user.id, responsibleSectionDepartmentId: f.section.id }, randomUUID(), randomUUID())
        .then(value => ({ value }), reason => ({ reason }));
      await resolverStarted;
      let waiting = false;
      for (let attempt = 0; attempt < 100 && !waiting; attempt++) {
        const [row] = await prisma.$queryRaw<{ waiting: boolean }[]>`SELECT EXISTS (SELECT 1 FROM pg_stat_activity
          WHERE datname = current_database() AND state = 'active' AND wait_event_type = 'Lock' AND query ILIKE '%FROM departments%') AS waiting`;
        waiting = row!.waiting;
        if (!waiting) await new Promise(resolve => setTimeout(resolve, 20));
      }
      expect(waiting).toBe(true);
      expect(Date.now()).toBeLessThan(expiresAt.getTime());
      await new Promise(resolve => setTimeout(resolve, Math.max(0, expiresAt.getTime() - Date.now()) + 75));
      release(); await blocker;
      expect(await result).toMatchObject({ reason: { status: 403 } });
      expect(resolver).toHaveBeenCalledTimes(1);
    } finally {
      release();
      try { await blocker; }
      finally {
        try { await result; }
        finally { resolver.mockRestore(); }
      }
    }
    expect(await f.read(id)).toMatchObject({ version: before.version, contentVersion: before.contentVersion, ownerUserId: before.ownerUserId });
    expect(await prisma.auditEvent.count({ where: { resourceId: id } })).toBe(audits);
    expect(await prisma.outboxEvent.count({ where: { aggregateId: id } })).toBe(events);
  }, 120_000);

  it('commits both distinct-report source appends by one actor without a SHARE authentication upgrade deadlock', async () => {
    const f = await fixture(), ids = [await f.issue(), await f.issue()], sources = [await f.source(), await f.source()];
    const entered: number[] = [], run = gate(), sessionLocked = gate(), releaseSession = gate(), referencesReady = gate();
    let referencesRead = 0;
    const readReference = ledger.sourceReference.bind(ledger);
    const references = jest.spyOn(ledger, 'sourceReference').mockImplementation(async (...args: Parameters<ProcessDefectLedgerService['sourceReference']>) => {
      const reference = await readReference(...args);
      if (++referencesRead === 2) referencesReady.open();
      // Finish both real preflight transactions before either command holds participant locks.
      await referencesReady.promise; return reference;
    });
    const original = sourceLinks.change.bind(sourceLinks);
    const change = jest.spyOn(sourceLinks, 'change').mockImplementation(async (...args: Parameters<DomainSourceLinkService['change']>) => {
      const [command, adapters, tx] = args;
      const [backend] = await tx!.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
      entered.push(backend!.pid); await run.promise;
      return original(command, adapters, tx);
    });
    let blocker: Promise<unknown> | undefined;
    const results = Promise.allSettled(ids.map((id, i) => service.sources(f.issuer.actor, id, { expectedVersion: 1,
      add: f.input([sources[i]!]).sources, removeDefectIds: [] }, randomUUID(), randomUUID())));
    try {
      await waitFor(async () => entered.length === 2, 'both real C commands must hold participant SHARE locks');
      blocker = prisma.$transaction(async tx => {
        await tx.$queryRaw`SELECT id FROM sessions WHERE id = ${f.issuer.actor.sessionId}::uuid FOR UPDATE`;
        sessionLocked.open(); await releaseSession.promise;
      }, { timeout: 15_000 });
      await sessionLocked.promise; run.open();
      await waitFor(async () => {
        const rows = await prisma.$queryRaw<{ pid: number }[]>(Prisma.sql`SELECT pid FROM pg_stat_activity
          WHERE pid IN (${Prisma.join(entered)}) AND datname = current_database() AND state = 'active' AND wait_event_type = 'Lock'
            AND (query ILIKE '%FROM users%' OR query ILIKE '%FROM sessions%')`);
        return rows.length === 2;
      }, 'observe both backend lock waits, not only elapsed time');
      releaseSession.open(); await blocker;
      const settled = await results;
      // A deadlock mapped to HTTP 409 is still a failure: both operations must commit.
      expect(settled.map(result => result.status)).toEqual(['fulfilled', 'fulfilled']);
      for (const id of ids) expect((await f.read(id)).sources).toHaveLength(2);
      expect(await prisma.auditEvent.count({ where: { resourceId: { in: ids }, action: 'PROCESS_EIGHT_D_SOURCES' } })).toBe(2);
    } finally {
      referencesReady.open(); run.open(); releaseSession.open();
      try { await blocker; }
      finally {
        try { await results; }
        finally { change.mockRestore(); references.mockRestore(); }
      }
    }
  }, 120_000);

  it('rejects issue when the owner appointment naturally expires while waiting for the source row and rolls back every write', async () => {
    const f = await fixture(), source = await f.source(), key = randomUUID(), expiresAt = new Date(Date.now() + 3000);
    await prisma.userPosition.update({ where: { id: f.owner.assignment.id }, data: { endedAt: expiresAt } });
    const before = { problems: await prisma.problemIndex.count({ where: { organizationId: f.organization.id } }),
      instances: await prisma.workflowInstance.count({ where: { organizationId: f.organization.id } }),
      links: await prisma.domainSourceIssueLink.count({ where: { organizationId: f.organization.id } }),
      history: await prisma.domainSourceIssueLinkHistory.count({ where: { organizationId: f.organization.id } }),
      audits: await prisma.auditEvent.count({ where: { organizationId: f.organization.id } }),
      events: await prisma.outboxEvent.count({ where: { aggregateType: 'DomainSourceIssue', payload: { path: ['organizationId'], equals: f.organization.id } } }) };
    const locked = gate(), release = gate(); let issuerPid = 0, blockerPid = 0;
    const original = ledger.lockAndResolve.bind(ledger);
    const resolve = jest.spyOn(ledger, 'lockAndResolve').mockImplementation(async (...args: Parameters<ProcessDefectLedgerService['lockAndResolve']>) => {
      const [tx] = args;
      const [backend] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`; issuerPid = backend!.pid;
      return original(...args);
    });
    const blocker = prisma.$transaction(async tx => {
      const [backend] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`; blockerPid = backend!.pid;
      await tx.$queryRaw`SELECT id FROM process_defects WHERE id = ${source.id}::uuid FOR UPDATE`;
      locked.open(); await release.promise;
    }, { timeout: 15_000 });
    let result: Promise<unknown> | undefined;
    try {
      await locked.promise;
      result = service.issue(f.issuer.actor, f.input([source]), randomUUID(), key).then(value => ({ value }), reason => ({ reason }));
      await waitFor(() => lockWait(issuerPid, blockerPid, 'FROM process_defects'), 'issuer must really wait for the source row');
      expect(Date.now()).toBeLessThan(expiresAt.getTime());
      await new Promise(resolve => setTimeout(resolve, Math.max(0, expiresAt.getTime() - Date.now()) + 75));
      release.open(); await blocker;
      expect(await result).toMatchObject({ reason: { status: 403, response: { code: 'PROCESS_EIGHT_D_OWNER_ASSIGNMENT_INVALID' } } });
      expect(resolve).toHaveBeenCalledTimes(1);
    } finally {
      release.open();
      try { await blocker; }
      finally {
        try { await result; }
        finally { resolve.mockRestore(); }
      }
    }
    expect(await prisma.problemIndex.count({ where: { organizationId: f.organization.id } })).toBe(before.problems);
    expect(await prisma.workflowInstance.count({ where: { organizationId: f.organization.id } })).toBe(before.instances);
    expect(await prisma.domainSourceIssueLink.count({ where: { organizationId: f.organization.id } })).toBe(before.links);
    expect(await prisma.domainSourceIssueLinkHistory.count({ where: { organizationId: f.organization.id } })).toBe(before.history);
    expect(await prisma.auditEvent.count({ where: { organizationId: f.organization.id } })).toBe(before.audits);
    expect(await prisma.outboxEvent.count({ where: { aggregateType: 'DomainSourceIssue', payload: { path: ['organizationId'], equals: f.organization.id } } })).toBe(before.events);
    const [reports] = await prisma.$queryRaw<{ count: number }[]>`SELECT count(*)::int AS count FROM process_eight_d_reports WHERE organization_id = ${f.organization.id}::uuid`;
    expect(reports!.count).toBe(0);
  }, 120_000);

  it.each(['SESSION', 'VERSION', 'MFA', 'PERMISSION'] as const)('shared authentication waits for the real security writer and rejects changed %s', async change => {
    const f = await fixture(), locked = gate(), release = gate(); let readerPid = 0, writerPid = 0;
    if (change === 'MFA') {
      await prisma.user.update({ where: { id: f.issuer.user.id }, data: { mfaRequirementOverride: false } });
      await prisma.session.update({ where: { id: f.issuer.actor.sessionId }, data: { mfaVerifiedAt: null } });
    }
    await prisma.$transaction(tx => assertActiveAuthentication(tx, f.issuer.actor, 'SHARE'));
    const writer = prisma.$transaction(async tx => {
      const [backend] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`; writerPid = backend!.pid;
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${f.issuer.user.id}::uuid FOR NO KEY UPDATE`;
      if (change === 'SESSION') await tx.session.update({ where: { id: f.issuer.actor.sessionId }, data: { revokedAt: new Date() } });
      if (change === 'PERMISSION') await tx.userRole.deleteMany({ where: { userId: f.issuer.user.id, roleId: f.role.id } });
      if (change === 'VERSION' || change === 'PERMISSION') await tx.user.update({ where: { id: f.issuer.user.id }, data: { securityVersion: { increment: 1 } } });
      if (change === 'MFA') await tx.user.update({ where: { id: f.issuer.user.id }, data: { mfaRequirementOverride: true } });
      locked.open(); await release.promise;
    }, { timeout: 15_000 });
    let result: Promise<unknown> | undefined;
    try {
      await locked.promise;
      result = prisma.$transaction(async tx => {
        const [backend] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`; readerPid = backend!.pid;
        return assertActiveAuthentication(tx, f.issuer.actor, 'SHARE');
      }, { isolationLevel: 'ReadCommitted', timeout: 15_000 }).then(value => ({ value }), reason => ({ reason }));
      await waitFor(() => lockWait(readerPid, writerPid, 'FROM users'), 'shared authentication must block behind the security writer');
      release.open(); await writer;
      expect(await result).toMatchObject({ reason: { status: 401, response: { code: change === 'MFA' ? 'AUTH_MFA_REQUIRED' : 'AUTH_SESSION_REQUIRED' } } });
      if (change === 'PERMISSION') expect(await prisma.userRole.count({ where: { userId: f.issuer.user.id } })).toBe(0);
    } finally { release.open(); await writer; await result; }
  }, 120_000);

  it('shared authentication also blocks a later NO KEY UPDATE security writer until the authenticated transaction ends', async () => {
    const f = await fixture(), authenticated = gate(), release = gate(); let readerPid = 0, writerPid = 0;
    const reader = prisma.$transaction(async tx => {
      const [backend] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`; readerPid = backend!.pid;
      await assertActiveAuthentication(tx, f.issuer.actor, 'SHARE');
      authenticated.open(); await release.promise;
    }, { isolationLevel: 'ReadCommitted', timeout: 15_000 });
    let writer: Promise<unknown> | undefined;
    try {
      await authenticated.promise;
      writer = prisma.$transaction(async tx => {
        const [backend] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`; writerPid = backend!.pid;
        await tx.user.update({ where: { id: f.issuer.user.id }, data: { securityVersion: { increment: 1 } } });
      }, { timeout: 15_000 });
      await waitFor(() => lockWait(writerPid, readerPid, 'UPDATE'), 'a later security writer must block behind shared authentication');
      release.open(); await reader; await writer;
      await expect(prisma.$transaction(tx => assertActiveAuthentication(tx, f.issuer.actor, 'SHARE')))
        .rejects.toMatchObject({ status: 401 });
    } finally { release.open(); await reader; await writer; }
  }, 120_000);

  it('rejects cross-organization/session-revoked writes and unowned or unscanned attachments without modifying content', async () => {
    const f = await fixture(), other = await fixture(), id = await f.issue();
    await expect(service.read(other.owner.actor, id)).rejects.toMatchObject({ status: 404 });
    const document = f.draft(); document.okFileIds = [randomUUID()];
    await expect(service.save(f.owner.actor, id, { expectedVersion: 1, document }, randomUUID(), randomUUID())).rejects.toMatchObject({ status: 409 });
    expect((await f.read(id)).version).toBe(1);
    await prisma.session.update({ where: { id: f.owner.actor.sessionId }, data: { revokedAt: new Date() } });
    await expect(service.save(f.owner.actor, id, { expectedVersion: 1, document: f.draft() }, randomUUID(), randomUUID())).rejects.toMatchObject({ status: 401 });
  }, 120_000);
});
