import 'reflect-metadata';
import { jest } from '@jest/globals';
import { Test } from '@nestjs/testing';
import { ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { createHash, randomUUID } from 'node:crypto';
import { AppModule } from '../../src/app.module.js';
import { GlobalExceptionFilter } from '../../src/common/contracts/global-exception.filter.js';
import { SessionService } from '../../src/modules/identity/session.service.js';
import { Prisma } from '../../src/generated/prisma/client.js';
import { assertActiveAuthentication } from '../../src/common/security/session-security.js';
import { PrismaService } from '../../src/database/prisma.service.js';
import { AdminMutationService } from '../../src/common/security/admin-mutation.service.js';
import { AuditLogService, PROCESS_DEFECT_MANUAL_UPDATE } from '../../src/modules/audit-log/audit-log.service.js';
import { FileResourceAccess } from '../../src/modules/file-management/file-resource-access.js';
import { FileLifecycleService } from '../../src/modules/file-management/file-lifecycle.service.js';
import { FilePolicyService } from '../../src/modules/file-management/file-policy.service.js';
import { S3CompatibleObjectStorage } from '../../src/modules/file-management/object-storage.service.js';
import { FileScanWorkerService } from '../../src/modules/file-management/file-scan-worker.service.js';
import { FileVerificationService } from '../../src/modules/file-management/file-verification.service.js';
import { OrganizationResponsibilityService } from '../../src/modules/organization/organization-responsibility.service.js';
import { DomainSourceIssueService } from '../../src/modules/problem-index/domain-source-issue.service.js';
import { DomainSourceLinkService } from '../../src/modules/problem-index/domain-source-link.service.js';
import { NumberingService } from '../../src/modules/problem-index/numbering.service.js';
import { ProblemIndexService } from '../../src/modules/problem-index/problem-index.service.js';
import { ProblemQueryService } from '../../src/modules/problem-index/problem-query.service.js';
import { ProblemIndexQueryDto } from '../../src/modules/problem-index/problem-index.dto.js';
import { DomainProblemReadAdapter } from '../../src/modules/problem-index/domain-problem-read.adapter.js';
import { ProblemDomainRegistry } from '../../src/modules/problem-index/problem-domain-registry.js';
import { ProcessDefectLedgerService } from '../../src/modules/process-quality/process-defect-ledger.service.js';
import { ProcessEightDClosureAdapter } from '../../src/modules/process-quality/process-eight-d-closure.adapter.js';
import { ProcessEightDFileAdapter } from '../../src/modules/process-quality/process-eight-d-file.adapter.js';
import { ProcessEightDReminderService } from '../../src/modules/process-quality/process-eight-d-reminder.service.js';
import { normalizeProcessEightDDocument } from '../../src/modules/process-quality/process-eight-d-document.js';
import { ProcessEightDService } from '../../src/modules/process-quality/process-eight-d.service.js';
import { ProcessEightDWorkflowConfigurationService } from '../../src/modules/process-quality/process-eight-d-workflow-configuration.service.js';
import { ProcessEightDReportService } from '../../src/modules/process-quality/process-eight-d-report.service.js';
import { ProcessEightDReadAdapter } from '../../src/modules/process-quality/process-eight-d-read.adapter.js';
import { ProcessEightDAssignmentOptionsQueryDto } from '../../src/modules/process-quality/process-eight-d.dto.js';
import { OutboxService } from '../../src/modules/task-notification/outbox.service.js';
import { WorkflowClosureRegistry } from '../../src/modules/workflow/workflow-closure-registry.js';
import { WorkflowClosureTemplateService } from '../../src/modules/workflow/workflow-closure-template.service.js';
import { WorkflowClosureRoundService } from '../../src/modules/workflow/workflow-closure-round.service.js';
import { WorkflowDefinitionService } from '../../src/modules/workflow/workflow-definition.service.js';
import { WorkflowDeadlineExtensionService } from '../../src/modules/workflow/workflow-deadline-extension.service.js';
import { WorkflowRuntimeService } from '../../src/modules/workflow/workflow-runtime.service.js';
import { WorkflowValidationService } from '../../src/modules/workflow/workflow-validation.service.js';
import type { ProcessEightDActor } from '../../src/modules/process-quality/process-eight-d.types.js';
import { png } from './process-eight-d-pdf.fixture.js';

const url = process.env.DATABASE_URL && new URL(process.env.DATABASE_URL);
if (!url || process.env.QMS_DISPOSABLE_TEST_DB !== 'true' || !['postgres:', 'postgresql:'].includes(url.protocol)
  || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.port === '55440' || url.search || url.hash) {
  throw new Error('Process 8D requires disposable loopback PostgreSQL, never preview 55440.');
}

describe('process 8D real domain transactions with managed workflow configuration', () => {
  const prisma = new PrismaService();
  const audit = new AuditLogService(prisma), outbox = new OutboxService(prisma), mutations = new AdminMutationService(prisma, audit);
  const numbering = new NumberingService(prisma), problems = new ProblemIndexService(prisma, numbering, audit, outbox);
  const responsibilities = new OrganizationResponsibilityService(prisma, mutations, audit);
  const registry = new WorkflowClosureRegistry([]), resources = new FileResourceAccess([]);
  const definitions = new WorkflowDefinitionService(prisma, new WorkflowValidationService(), audit, registry);
  const templates = new WorkflowClosureTemplateService(prisma, definitions, mutations);
  const workflowConfiguration = new ProcessEightDWorkflowConfigurationService(prisma, mutations, audit, templates);
  const rounds = new WorkflowClosureRoundService(prisma, audit, responsibilities, registry, outbox);
  const extensions = new WorkflowDeadlineExtensionService(prisma, audit, responsibilities, registry, rounds, outbox);
  const ledger = new ProcessDefectLedgerService(prisma, mutations, audit);
  const readRegistry = new ProblemDomainRegistry([
    new DomainProblemReadAdapter({ domainCode: 'process-quality', sourceType: 'process-defect', permission: 'process-quality:defects:read', label: 'Process' }),
    new DomainProblemReadAdapter({ domainCode: 'customer-quality', sourceType: 'customer-complaint', permission: 'customer-quality:complaints:read', label: 'Customer' }),
  ]);
  const sourceLinks = new DomainSourceLinkService(prisma, audit, outbox);
  const service = new ProcessEightDService(prisma, ledger, new DomainSourceIssueService(prisma, problems, outbox), sourceLinks,
    new WorkflowRuntimeService(prisma, audit, outbox, problems), problems, rounds, responsibilities, resources, audit, outbox, readRegistry, extensions, undefined, workflowConfiguration);
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

  async function legacyBinding(actor: ProcessEightDActor) {
    const definition = await templates.initialize(actor, { code: randomUUID(), name: 'Legacy process 8D', policy: 'INTERNAL', domainCode: 'process-quality' }, randomUUID(), randomUUID());
    const version = await definitions.publishVersion({ organizationId: actor.organizationId, userId: actor.id, actor,
      definitionId: definition.id, draftVersionId: definition.version.id, expectedRevision: definition.revision });
    const binding = await service.bind(actor, { expectedVersion: 0, workflowDefinitionId: definition.id, workflowVersionId: version.id }, randomUUID(), randomUUID());
    return service.activate(actor, { expectedVersion: binding.version, enabled: true }, randomUUID(), randomUUID());
  }

  async function fixture(configure = true, configureManagement = true) {
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
    const setLeaders = (departmentId: string, primary: string, ...others: string[]) => prisma.$executeRaw`
      INSERT INTO department_responsible_appointments (organization_id, department_id, assignment_ids, primary_assignment_id, version)
      VALUES (${organization.id}::uuid, ${departmentId}::uuid, ${[primary, ...others]}::uuid[], ${primary}::uuid, 1)
      ON CONFLICT (organization_id, department_id) DO UPDATE SET assignment_ids = EXCLUDED.assignment_ids,
        primary_assignment_id = EXCLUDED.primary_assignment_id, version = department_responsible_appointments.version + 1`;
    const setScope = (assignmentId: string) => prisma.$executeRaw`INSERT INTO department_minister_scopes
      (id, organization_id, department_id, section_department_id, minister_assignment_id, department_leadership, valid_from, created_by, updated_by)
      VALUES (${randomUUID()}::uuid, ${organization.id}::uuid, ${department.id}::uuid, ${section.id}::uuid, ${assignmentId}::uuid, true,
        CURRENT_TIMESTAMP - INTERVAL '1 minute', ${issuer.user.id}::uuid, ${issuer.user.id}::uuid)`;
    if (configureManagement) {
      await setLeaders(section.id, manager.assignment.id);
      await setLeaders(department.id, minister.assignment.id);
    }
    await numbering.publishRuleVersion({ organizationId: organization.id, ruleCode: 'PROBLEM', pattern: '{CODE}-{YYMM}-{SEQ3}' });
    const configureManaged = (expectedVersion: number, issuanceConfigured = true) => {
      return workflowConfiguration.update(issuer.actor, { expectedVersion, stages: [
        { stage: 'ISSUE', positionIds: issuanceConfigured ? [issuer.position.id] : [] },
      ] }, randomUUID(), randomUUID());
    };
    if (configure) await configureManaged(0);
    const source = () => ledger.create(issuer.actor, { description: '真实原台账来源，未知分类保留空', factoryCode: 'FACTORY_1', productCode: 'EIGHT-D-PRODUCT', traceCode: randomUUID(), occurredAt: new Date('2026-11-16T00:30:00Z') }, randomUUID(), randomUUID());
    const input = (sources: { id: string; version: number }[]) => ({ sources: sources.map(s => ({ defectId: s.id, expectedVersion: s.version })), severity: 'LOW' as const,
      processBoardCode: '0' as const, sourceConfirmations: sources.map(source => ({ defectId: source.id, recurrence: 'NOT_RECURRENCE' as const, relatedProblemIds: [] })),
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
    return { organization, department, section, otherSection, role, person, issuer, owner, manager, minister, collaborator, source, input, issue, read, ready, submit, draft, configureManaged, setLeaders, setScope };
  }

  it('persists deleted D7 preset rows through HTTP save, reopen and report projection', async () => {
    const f = await fixture(), id = await f.issue();
    const permission = await prisma.permission.upsert({ where: { code: 'process-quality:issues:report' }, create: { code: 'process-quality:issues:report', name: '8D report' }, update: {} });
    await prisma.rolePermission.create({ data: { roleId: f.role.id, permissionId: permission.id } });
    const app = (await Test.createTestingModule({ imports: [AppModule] }).compile()).createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new GlobalExceptionFilter());
    try {
      await app.init();
      const csrf = randomUUID();
      const token = await app.get(SessionService).create(f.owner.user.id, app.get(PrismaService), { reauthenticated: true, mfaVerified: true });
      const cookie = `qms_session=${token}; qms_csrf=${csrf}`;
      const path = `/api/v1/process-quality/eight-d/${id}`;
      const scope = `organizationId=${f.organization.id}`;
      const get = (url: string) => request(app.getHttpServer()).get(url).set('Cookie', cookie);
      let current = (await get(`${path}?${scope}`).expect(200)).body;
      expect(current.document.standardization).toHaveLength(11);
      for (const standardization of [current.document.standardization.slice(1), []]) {
        const saved = await request(app.getHttpServer()).put(path).set('Cookie', cookie).set('x-csrf-token', csrf).set('Idempotency-Key', randomUUID())
          .send({ organizationId: f.organization.id, expectedVersion: current.version, document: { ...current.document, standardization } }).expect(200);
        expect(saved.body.document.standardization).toEqual(standardization);
        current = (await get(`${path}?${scope}`).expect(200)).body;
        expect(current.document.standardization).toEqual(standardization);
        const report = await get(`${path}/report?${scope}&view=CURRENT`).expect(200);
        expect(report.body.snapshot.document.standardization).toEqual(standardization);
      }
    } finally { await app.close(); }
  }, 120_000);

  it('filters owners by responsible department and permits analysis and reassignment independently of issuance positions', async () => {
    const f = await fixture(), source = await f.source();
    const target = await f.person(f.otherSection.id);
    const query = (input: Partial<ProcessEightDAssignmentOptionsQueryDto>) => Object.assign(new ProcessEightDAssignmentOptionsQueryDto(), input);
    const initial = query({ sectionDepartmentId: f.section.id, search: f.owner.user.username, pageSize: 1 });
    expect(await service.assignmentOptions(f.issuer.actor, query({ ...initial, sectionDepartmentId: f.otherSection.id }))).toMatchObject({ users: [], userTotal: 0 });
    expect(await service.assignmentOptions(f.issuer.actor, initial)).toMatchObject({ users: [{ id: f.owner.user.id }], userTotal: 1 });
    const id = String((await service.issue(f.issuer.actor, f.input([source]), randomUUID(), randomUUID())).problem.id);
    await service.save(f.owner.actor, id, { expectedVersion: 1, document: f.draft() }, randomUUID(), randomUUID());
    const complete = { expectedVersion: (await f.read(id)).version, submissionDueAt: new Date('2026-11-10') };
    await service.analysisComplete(f.owner.actor, id, complete, randomUUID(), randomUUID());
    await prisma.rolePermission.deleteMany({ where: { roleId: f.role.id, permission: { code: 'process-quality:issues:reassign' } } });
    const current = await f.read(id);
    expect(await service.read(f.manager.actor, id)).toMatchObject({ allowedActions: expect.arrayContaining(['reassign']) });
    expect(await service.assignmentOptions(f.manager.actor, query({ action: 'REASSIGN', problemId: id }))).toMatchObject({ users: expect.arrayContaining([{ id: f.manager.user.id, username: f.manager.user.username, fullName: null, departmentName: f.section.name }]), userTotal: 2 });
    await expect(service.reassign(f.manager.actor, id, { expectedVersion: current.version, ownerUserId: target.user.id, responsibleSectionDepartmentId: f.section.id }, randomUUID(), randomUUID())).rejects.toMatchObject({ status: 403 });
    await service.reassign(f.manager.actor, id, { expectedVersion: current.version, ownerUserId: f.manager.user.id, responsibleSectionDepartmentId: f.section.id }, randomUUID(), randomUUID());
    expect(await f.read(id)).toMatchObject({ ownerUserId: f.manager.user.id, analysisCompletedAt: current.analysisCompletedAt });
  }, 120_000);

  it('rejects an owner who is not appointed to the selected department through HTTP', async () => {
    const fixtureData = await fixture(), source = await fixtureData.source();

    const app = (await Test.createTestingModule({ imports: [AppModule] }).compile()).createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new GlobalExceptionFilter());
    try {
      await app.init();
      const csrf = randomUUID();
      const token = await app.get(SessionService).create(fixtureData.issuer.user.id, app.get(PrismaService), { reauthenticated: true, mfaVerified: true });
      const response = await request(app.getHttpServer()).post('/api/v1/process-quality/eight-d')
        .set('Cookie', `qms_session=${token}; qms_csrf=${csrf}`).set('x-csrf-token', csrf).set('Idempotency-Key', randomUUID())
        .send({ ...fixtureData.input([source]), ownerUserId: fixtureData.collaborator.user.id }).expect(403);
      expect(response.body).toMatchObject({
        code: 'PROCESS_EIGHT_D_OWNER_ASSIGNMENT_INVALID',
      });
    } finally { await app.close(); }
  }, 120_000);

  it('keeps same-section reassignment available independently of the issuance configuration', async () => {
    const f = await fixture(), id = await f.issue();
    await f.configureManaged(1, false);
    await prisma.rolePermission.deleteMany({ where: { roleId: f.role.id, permission: { code: 'process-quality:issues:reassign' } } });

    const current = await f.read(id);
    expect(current.allowedActions).toContain('reassign');
    expect(current.allowedActions).toContain('save');
    const transfer = { expectedVersion: current.version, ownerUserId: f.manager.user.id, responsibleSectionDepartmentId: f.section.id };
    expect((await service.read(f.collaborator.actor, id)).allowedActions).not.toContain('reassign');
    await expect(service.reassign(f.collaborator.actor, id, transfer, randomUUID(), randomUUID())).rejects.toMatchObject({ status: 403 });
    await service.reassign(f.owner.actor, id, transfer, randomUUID(), randomUUID());
    expect(await f.read(id)).toMatchObject({ ownerUserId: f.manager.user.id });
  }, 120_000);

  it.each([['LOW', 'SECTION_MANAGER'], ['HIGH', 'MINISTER']] as const)('requires the actual issuer and risk-selected %s closure duties before opening a round', async (severity, duty) => {
    const f = await fixture(), id = await f.issue();
    if (severity === 'HIGH') await service.risk(f.issuer.actor, id, { expectedVersion: 1, severity }, randomUUID(), randomUUID());
    const selected = severity === 'LOW' ? f.manager : f.minister;
    const current = await f.ready(id), submit = { expectedVersion: current.version };
    expect((await f.read(id)).allowedActions).toContain('submit');
    await service.submit(f.owner.actor, id, submit, randomUUID(), randomUUID());
    expect((await rounds.readProjection(prisma, f.organization.id, id))!.duties).toEqual(expect.arrayContaining([
      expect.objectContaining({ duty: 'PROFESSIONAL', userId: f.issuer.user.id }), expect.objectContaining({ duty, userId: selected.user.id }),
    ]));
  }, 120_000);

  it('records a skipped management duty when the owner is also the primary department head', async () => {
    const f = await fixture(), id = await f.issue();
    const ready = await f.ready(id);
    await service.reassign(f.owner.actor, id, { expectedVersion: ready.version, ownerUserId: f.manager.user.id,
      responsibleSectionDepartmentId: f.section.id }, randomUUID(), randomUUID());
    const current = await service.read(f.manager.actor, id), submit = { expectedVersion: current.version };
    expect((await service.read(f.manager.actor, id)).allowedActions).toContain('submit');
    await service.submit(f.manager.actor, id, submit, randomUUID(), randomUUID());
    expect((await rounds.readProjection(prisma, f.organization.id, id))?.duties).toEqual(expect.arrayContaining([
      expect.objectContaining({ duty: 'SECTION_MANAGER', userId: f.manager.user.id, status: 'SKIPPED_SAME_PERSON' }),
      expect.objectContaining({ duty: 'PROFESSIONAL', userId: f.issuer.user.id, status: 'PENDING' }),
    ]));
    expect(await rounds.eligibleDuties(f.manager.actor)).toEqual([]);
    expect(await rounds.eligibleDuties(f.issuer.actor)).toEqual([expect.objectContaining({ problemId: id, duty: 'PROFESSIONAL' })]);
    expect(await service.flowRecords(f.owner.actor, id)).toContainEqual({ occurredAt: expect.any(String), person: '系统', content: `${f.manager.user.username}为问题负责人，跳过管理审核` });
  }, 120_000);

  it('lets an appointment-free platform admin issue and professionally approve when no management reviewer can be found', async () => {
    const f = await fixture(false, false);
    const admin = await f.person(f.department.id);
    const marker = await prisma.role.create({ data: { organizationId: f.organization.id, code: 'platform:admin', name: 'Platform administrator' } });
    const permission = await prisma.permission.findUniqueOrThrow({ where: { code: 'platform:admin' } });
    await prisma.rolePermission.create({ data: { roleId: marker.id, permissionId: permission.id } });
    await prisma.userRole.deleteMany({ where: { organizationId: f.organization.id, userId: admin.user.id } });
    await prisma.userRole.create({ data: { organizationId: f.organization.id, userId: admin.user.id, roleId: marker.id } });
    await prisma.userPosition.delete({ where: { id: admin.assignment.id } });
    await f.configureManaged(0, false);
    const id = String((await service.issue(admin.actor, { ...f.input([await f.source()]), severity: 'HIGH' }, randomUUID(), randomUUID())).problem.id);
    const round = (await f.submit(id))!;
    expect(round.duties).toEqual([expect.objectContaining({ duty: 'PROFESSIONAL', userId: admin.user.id, status: 'PENDING' })]);
    const decision = { expectedRoundVersion: round.version, duties: ['PROFESSIONAL'] as const, decision: 'APPROVE' as const, comment: '核验完成' };
    const key = randomUUID();
    const finish = () => rounds.decide(admin.actor, round.id, { ...decision, duties: [...decision.duties] }, key, randomUUID());
    expect(await finish()).toMatchObject({ status: 'APPROVED' });
    expect(await finish()).toMatchObject({ status: 'APPROVED' });
    expect(await f.read(id)).toMatchObject({ status: 'CLOSED' });
    const records = await service.flowRecords(f.owner.actor, id);
    expect(records).toEqual(expect.arrayContaining([
      { occurredAt: expect.any(String), person: admin.user.username, content: '发起制程 8D' },
      { occurredAt: expect.any(String), person: f.owner.user.username, content: '提交关闭审核' },
      { occurredAt: expect.any(String), person: '系统', content: `专业审核派给${admin.user.username}` },
      { occurredAt: expect.any(String), person: '系统', content: expect.stringContaining('跳过管理审核') },
      { occurredAt: expect.any(String), person: admin.user.username, content: '专业审核通过：核验完成' },
      { occurredAt: expect.any(String), person: admin.user.username, content: '关闭制程 8D' },
    ]));
    expect(records.filter(record => record.content === '专业审核通过：核验完成')).toHaveLength(1);
    const app = (await Test.createTestingModule({ imports: [AppModule] }).compile()).createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new GlobalExceptionFilter());
    try {
      await app.init();
      const sessions = app.get(SessionService);
      const get = (token?: string) => request(app.getHttpServer()).get(`/api/v1/process-quality/eight-d/${id}/flow-records?organizationId=${f.organization.id}`)
        .set('Cookie', token ? `qms_session=${token}` : '');
      const token = await sessions.create(f.owner.user.id, app.get(PrismaService), { reauthenticated: true, mfaVerified: true });
      await get().expect(401);
      await get(token).expect(200, records);
      await prisma.rolePermission.deleteMany({ where: { roleId: f.role.id, permission: { code: 'process-quality:issues:read' } } });
      await get(token).expect(403);
    } finally { await app.close(); }
  }, 120_000);

  it('notifies eligible participants of a new process closure round with flow records', async () => {
    const f = await fixture();
    for (const code of ['task:read', 'notification:read']) {
      const permission = await prisma.permission.findUniqueOrThrow({ where: { code } });
      await prisma.rolePermission.create({ data: { roleId: f.role.id, permissionId: permission.id } });
    }
    const id = await f.issue();
    const round = (await f.submit(id))!;
    expect(round.context.flowRecords).not.toHaveLength(0);
    const recipients = await prisma.$transaction(tx => rounds.notificationRecipients(tx, f.organization.id, id, round.id, round.version));
    expect(new Set(recipients)).toEqual(new Set([f.issuer.user.id, f.manager.user.id]));
  }, 120_000);

  it.each([true, false])('reconciles an expired delegated review in the worker with an eligible parent primary: %s', async fallback => {
    const f = await fixture();
    const delegate = await f.person(f.department.id);
    await f.setLeaders(f.department.id, f.minister.assignment.id, delegate.assignment.id);
    await f.setScope(delegate.assignment.id);
    const id = await f.issue();
    await service.risk(f.issuer.actor, id, { expectedVersion: 1, severity: 'HIGH' }, randomUUID(), randomUUID());
    const first = (await f.submit(id))!;
    expect(first.duties).toContainEqual(expect.objectContaining({ duty: 'MINISTER', userId: delegate.user.id, status: 'PENDING' }));
    const approved = await rounds.decide(f.issuer.actor, first.id, { expectedRoundVersion: first.version,
      duties: ['PROFESSIONAL'], decision: 'APPROVE', comment: '首轮专业审核通过' }, randomUUID(), randomUUID());
    const professional = approved.duties.find(duty => duty.duty === 'PROFESSIONAL');
    expect(professional).toMatchObject({ status: 'APPROVED', comment: '首轮专业审核通过' });

    await prisma.userPosition.update({ where: { id: delegate.assignment.id }, data: { endedAt: new Date() } });
    if (!fallback) await prisma.userPosition.update({ where: { id: f.minister.assignment.id }, data: { endedAt: new Date() } });
    expect(await rounds.eligibleDuties(delegate.actor)).toEqual([]);
    const reminders = new ProcessEightDReminderService(prisma, service, extensions, rounds, outbox);
    jest.spyOn(service, 'reminderCandidates').mockResolvedValueOnce([{ organizationId: f.organization.id, problemId: id }]);
    await reminders.poll();
    const next = (await rounds.readProjection(prisma, f.organization.id, id))!;
    expect(next).toMatchObject({ id: first.id, version: approved.version + 1, status: fallback ? 'PENDING' : 'APPROVED',
      duties: expect.arrayContaining([professional]) });
    if (fallback) {
      expect(next.duties).toContainEqual(expect.objectContaining({ duty: 'MINISTER', userId: f.minister.user.id, status: 'PENDING' }));
      await rounds.decide(f.minister.actor, first.id, { expectedRoundVersion: next.version,
        duties: ['MINISTER'], decision: 'APPROVE', comment: '完成改派后的审核' }, randomUUID(), randomUUID());
    }
    expect(await f.read(id)).toMatchObject({ status: 'CLOSED' });
    const records = await service.flowRecords(f.owner.actor, id);
    expect(records).toContainEqual({ occurredAt: expect.any(String), person: '系统',
      content: fallback ? '原分管任职已失效，改派直属上级主负责人' : expect.stringMatching(/原分管任职已失效.*跳过管理审核/) });
    const cause = records.findIndex(record => fallback ? record.content === '管理审核通过：完成改派后的审核' : /原分管任职已失效.*跳过管理审核/.test(record.content));
    const closure = records.findIndex(record => record.content === (fallback ? '关闭制程 8D' : '跳过管理审核后自动关闭制程 8D'));
    expect(cause).toBeGreaterThanOrEqual(0);
    expect(closure).toBeGreaterThan(cause);
  }, 120_000);

  it('records professional and management decisions separately when both duties belong to one reviewer', async () => {
    const f = await fixture();
    await f.setLeaders(f.department.id, f.issuer.assignment.id, f.minister.assignment.id);
    const id = await f.issue();
    await service.risk(f.issuer.actor, id, { expectedVersion: 1, severity: 'HIGH' }, randomUUID(), randomUUID());
    const round = (await f.submit(id))!;
    await expect(rounds.decide(f.issuer.actor, round.id, { expectedRoundVersion: round.version,
      duties: ['PROFESSIONAL', 'MINISTER'], decision: 'APPROVE', comment: '不能合并两项审核' }, randomUUID(), randomUUID())).rejects.toMatchObject({ status: 409 });
    const decide = (duty: 'PROFESSIONAL' | 'MINISTER', version: number, comment: string) => rounds.decide(f.issuer.actor, round.id,
      { expectedRoundVersion: version, duties: [duty], decision: 'APPROVE', comment }, randomUUID(), randomUUID());
    const first = await decide('PROFESSIONAL', round.version, '已核验对策');
    expect(first.status).toBe('PENDING');
    const second = await decide('MINISTER', first.version, '同意关闭');
    expect(second.status).toBe('APPROVED');
    expect(await service.flowRecords(f.owner.actor, id)).toEqual(expect.arrayContaining([
      { occurredAt: expect.any(String), person: '系统', content: `专业审核派给${f.issuer.user.username}` },
      { occurredAt: expect.any(String), person: '系统', content: `管理审核派给${f.issuer.user.username}` },
      { occurredAt: expect.any(String), person: f.issuer.user.username, content: '专业审核通过：已核验对策' },
      { occurredAt: expect.any(String), person: f.issuer.user.username, content: '管理审核通过：同意关闭' },
    ]));
  }, 120_000);

  it('retains management review when the high-risk fallback reviewer is also the owner', async () => {
    const f = await fixture();
    const parentPosition = await prisma.userPosition.create({ data: { organizationId: f.organization.id, userId: f.owner.user.id,
      positionId: f.minister.position.id, startedAt: new Date(Date.now() - 60_000) } });
    await f.setLeaders(f.department.id, parentPosition.id);
    const id = await f.issue();
    await service.risk(f.issuer.actor, id, { expectedVersion: 1, severity: 'HIGH' }, randomUUID(), randomUUID());
    const round = (await f.submit(id))!;
    expect(round.duties).toEqual([expect.objectContaining({ duty: 'PROFESSIONAL', status: 'PENDING' }),
      expect.objectContaining({ duty: 'MINISTER', userId: f.owner.user.id, status: 'PENDING' })]);
  }, 120_000);

  it('preserves a previously dispatched legacy reviewer and uses new rules for the next round', async () => {
    const f = await fixture(), id = await f.issue();
    const alternate = await f.person(f.section.id);
    await f.setLeaders(f.section.id, alternate.assignment.id, f.manager.assignment.id);
    const original = closure.lockAndRead.bind(closure);
    const legacy = jest.spyOn(closure, 'lockAndRead').mockImplementation(async (tx, actor, problemId, operation) => {
      const context = await original(tx, actor, problemId, operation);
      delete context.processManagement;
      return context;
    });
    let first;
    try { first = (await f.submit(id))!; } finally { legacy.mockRestore(); }
    expect(first.duties).toContainEqual(expect.objectContaining({ duty: 'SECTION_MANAGER', userId: f.manager.user.id }));
    expect(await rounds.eligibleDuties(f.manager.actor)).toEqual([expect.objectContaining({ roundId: first.id, duty: 'SECTION_MANAGER' })]);
    expect(await rounds.eligibleDuties(alternate.actor)).toEqual([]);
    const returned = await rounds.decide(f.manager.actor, first.id, { expectedRoundVersion: first.version,
      duties: ['SECTION_MANAGER'], decision: 'RETURN', comment: '补充验证证据' }, randomUUID(), randomUUID());
    expect(returned).toMatchObject({ status: 'RETURNED', duties: expect.arrayContaining([
      expect.objectContaining({ duty: 'SECTION_MANAGER', userId: f.manager.user.id, decidedBy: f.manager.user.id, comment: '补充验证证据' }),
    ]) });
    jest.spyOn(workflowConfiguration, 'isManagedVersion').mockResolvedValueOnce(false);
    const report = await f.read(id);
    await service.submit(f.owner.actor, id, { expectedVersion: report.version }, randomUUID(), randomUUID());
    expect(await rounds.readProjection(prisma, f.organization.id, id)).toMatchObject({ roundNumber: 2,
      duties: expect.arrayContaining([expect.objectContaining({ duty: 'SECTION_MANAGER', userId: alternate.user.id })]) });
    expect(await service.flowRecords(f.owner.actor, id)).toContainEqual({ occurredAt: expect.any(String), person: f.manager.user.username,
      content: '管理审核退回：补充验证证据' });
  }, 120_000);

  it('rechecks responsibility on report replays independently of issuance positions', async () => {
    const f = await fixture(), id = await f.issue(), key = randomUUID();
    const input = { expectedVersion: 1, document: f.draft() };
    const original = await service.save(f.owner.actor, id, input, randomUUID(), key);
    await service.analysisComplete(f.owner.actor, id, { expectedVersion: (await f.read(id)).version, submissionDueAt: new Date('2026-11-10') }, randomUUID(), randomUUID());
    await f.configureManaged(1, false);
    expect(await service.save(f.owner.actor, id, input, randomUUID(), key)).toEqual(original);
    const before = await f.read(id);
    await prisma.userPosition.update({ where: { id: f.owner.assignment.id }, data: { endedAt: new Date() } });
    await expect(service.save(f.owner.actor, id, input, randomUUID(), key)).rejects.toMatchObject({ status: 403 });
    expect(await f.read(id)).toMatchObject({ version: before.version, contentVersion: before.contentVersion });
  }, 120_000);

  it('keeps the actual professional reviewer after their issuance appointment ends while their permissions remain active', async () => {
    const f = await fixture();
    const otherPosition = (await f.person(f.department.id)).position;
    await prisma.userPosition.create({ data: { organizationId: f.organization.id, userId: f.issuer.user.id, positionId: otherPosition.id, startedAt: new Date(Date.now() - 1_000) } });
    const id = await f.issue(), round = (await f.submit(id))!;
    const closure = await rounds.eligibleDuties(f.issuer.actor);
    expect(closure).toEqual(expect.arrayContaining([expect.objectContaining({ problemId: id, duty: 'PROFESSIONAL' })]));
    await prisma.userPosition.update({ where: { id: f.issuer.assignment.id }, data: { endedAt: new Date() } });
    expect(await rounds.eligibleDuties(f.issuer.actor)).toEqual(expect.arrayContaining([expect.objectContaining({ roundId: round.id, duty: 'PROFESSIONAL' })]));
    expect(await rounds.eligibleDuties(f.manager.actor)).toEqual([expect.objectContaining({ roundId: round.id, duty: 'SECTION_MANAGER' })]);
    await expect(rounds.decide(f.issuer.actor, round.id, { expectedRoundVersion: round.version, duties: ['PROFESSIONAL'], decision: 'APPROVE', comment: '核验完成' }, randomUUID(), randomUUID())).resolves.toMatchObject({ status: 'PENDING' });
  }, 120_000);

  it('requires configured issuance positions even with a legacy binding and issues once for concurrent retries', async () => {
    const f = await fixture(false), source = await f.source();
    const legacy = await legacyBinding(f.issuer.actor);
    expect(legacy).toMatchObject({ enabled: true });
    await expect(f.configureManaged(0, false)).resolves.toMatchObject({ version: 1, missingStages: ['ISSUE'] });
    const key = randomUUID();
    await expect(service.issue(f.issuer.actor, f.input([source]), randomUUID(), key)).rejects.toMatchObject({ status: 400,
      response: { code: 'PROCESS_EIGHT_D_WORKFLOW_NOT_READY' }, fields: { 'stages.ISSUE': expect.any(Array) } });
    expect(await prisma.problemIndex.count({ where: { organizationId: f.organization.id } })).toBe(0);
    await expect(f.configureManaged(1)).resolves.toMatchObject({ version: 2, missingStages: [] });
    const results = await Promise.all(Array.from({ length: 2 }, () => service.issue(f.issuer.actor, f.input([source]), randomUUID(), key)));
    const id = String(results[0]!.problem.id), model = await f.read(id);
    expect(results.map(result => result.replayed).sort()).toEqual([false, true]);
    expect(results.map(result => result.problem.id)).toEqual([id, id]);
    expect(await prisma.problemIndex.count({ where: { organizationId: f.organization.id } })).toBe(1);
    expect(await prisma.workflowInstance.count({ where: { organizationId: f.organization.id } })).toBe(1);
    expect(model).toMatchObject({ professionalUserId: f.issuer.user.id, ownerUserId: f.owner.user.id, version: 1, contentVersion: 1 });
    const instance = await prisma.workflowInstance.findUniqueOrThrow({ where: { id: model.instanceId } });
    expect(instance.workflowVersionId).not.toBe(legacy.workflowVersionId);
    expect(await service.binding(f.issuer.actor)).toEqual(legacy);
    await expect(service.save(f.issuer.actor, id, { expectedVersion: 1, document: f.draft() }, randomUUID(), randomUUID())).rejects.toMatchObject({ status: 403 });
  }, 120_000);

  it('shows real 8D link and unlink actions in the capped defect update timeline', async () => {
    const f = await fixture(), primary = await f.source(), source = await f.source();
    const actor = f.issuer.actor;
    await prisma.user.update({ where: { id: actor.id }, data: { fullName: '实际关联人' } });
    const read = () => ledger.detail(actor, source.id);
    expect((await read()).updateRecords).toEqual([]);

    const issued = await service.issue(actor, f.input([primary]), randomUUID(), randomUUID());
    const problemId = String(issued.problem.id);
    const input = { expectedVersion: 1, add: f.input([source]).sources, removeDefectIds: [], primaryDefectId: source.id };
    const key = randomUUID();
    const linked = await service.sources(actor, problemId, input, randomUUID(), key);
    await service.sources(actor, problemId, input, randomUUID(), key);
    expect((await read()).updateRecords).toEqual([
      expect.objectContaining({ content: '关联问题', actorName: '实际关联人' }),
    ]);

    await ledger.update(actor, source.id, { expectedVersion: (await read()).version, description: '更新后的台账描述' }, randomUUID(), randomUUID());
    await service.sources(actor, problemId, { expectedVersion: linked.version, add: [], removeDefectIds: [source.id], primaryDefectId: primary.id }, randomUUID(), randomUUID());
    await prisma.auditEvent.createMany({ data: Array.from({ length: 100 }, (_, index) => ({
      organizationId: actor.organizationId, actorUserId: actor.id, action: PROCESS_DEFECT_MANUAL_UPDATE, resourceType: 'ProcessDefect',
      resourceId: source.id, outcome: 'SUCCESS', traceId: randomUUID(), metadata: { changedFields: 'description' }, createdAt: new Date(index),
    })) });

    const { updateRecords } = await read();
    expect(updateRecords).toHaveLength(100);
    expect(updateRecords.slice(0, 3).map(({ content, actorName }) => [content, actorName])).toEqual([
      ['取消关联问题', '实际关联人'], ['更新不良描述', '实际关联人'], ['关联问题', '实际关联人'],
    ]);
  }, 120_000);

  it('reads authorized followup names without management grants or full reports, falls back to username and denies revoked readers', async () => {
    const f = await fixture(), id = await f.issue();
    await prisma.user.update({ where: { id: f.owner.user.id }, data: { fullName: '实际负责人' } });
    const summary = () => prisma.$transaction(async tx => {
      const problem = await tx.problemIndex.findUniqueOrThrow({ where: { id } });
      return (await readRegistry.forProblem(problem).readSummaries(tx, f.owner.actor, [problem])).get(id)!;
    });
    const readReport = jest.spyOn(service, 'readReport');
    try {
      const first = await summary();
      expect(Object.fromEntries(first.fields!.map(field => [field.key, field.value]))).toEqual({
        responsibleSectionName: f.section.name, ownerName: '实际负责人', stage: '分析阶段',
        analysisDueAt: '2026-11-01T00:00:00.000Z', submissionDueAt: null, closureDueAt: '2026-12-01T00:00:00.000Z',
        analysisCompletedAt: null, submittedAt: null,
      });
      await prisma.user.update({ where: { id: f.owner.user.id }, data: { fullName: '  ' } });
      expect((await summary()).fields!.find(field => field.key === 'ownerName')!.value).toBe(f.owner.user.username);
      const permission = await prisma.permission.findUniqueOrThrow({ where: { code: 'process-quality:issues:read' } });
      await prisma.rolePermission.delete({ where: { roleId_permissionId: { roleId: f.role.id, permissionId: permission.id } } });
      await expect(summary()).rejects.toMatchObject({ status: 403 });
      expect(readReport).not.toHaveBeenCalled();
    } finally { readReport.mockRestore(); }
  }, 120_000);

  it('reads concurrent public 8D details after both transactions hold problem SHARE locks without an upgrade deadlock', async () => {
    const f = await fixture(), id = await f.issue(), shared = gate();
    const permission = await prisma.permission.findUniqueOrThrow({ where: { code: 'problem-index:read' } });
    await prisma.rolePermission.create({ data: { roleId: f.role.id, permissionId: permission.id } });
    const query = new ProblemQueryService(prisma, readRegistry);
    let arrivals = 0;
    const read = () => prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM problem_indexes WHERE organization_id = ${f.organization.id}::uuid AND id = ${id}::uuid FOR SHARE`;
      // Neither public read starts until both real transactions hold the same problem's SHARE lock.
      if (++arrivals === 2) shared.open();
      await shared.promise;
      const { problem, adapter } = await query.authorized(tx, f.owner.actor, f.organization.id, id, 'overview');
      return (await adapter.readSummaries(tx, f.owner.actor, [problem])).get(id);
    });
    const results = await Promise.allSettled([read(), read()]);
    expect(arrivals).toBe(2);
    expect(results.filter(result => result.status === 'rejected')).toEqual([]);
    expect(results).toMatchObject([
      { status: 'fulfilled', value: { domainUiKey: 'process-eight-d' } },
      { status: 'fulfilled', value: { domainUiKey: 'process-eight-d' } },
    ]);
  });

  it('allocates across selected boards without writing back and rejects mixed recurrence before allocating', async () => {
    const fixtureData = await fixture();
    const first = await fixtureData.source(), second = await fixtureData.source();
    const actor = fixtureData.issuer.actor;
    const firstInput = fixtureData.input([first]);
    const mixed = fixtureData.input([first, second]);
    const firstKey = randomUUID();
    await expect(service.issue(actor, { ...mixed, sourceConfirmations: [mixed.sourceConfirmations[0]!, { ...mixed.sourceConfirmations[1]!, recurrence: 'RECURRENCE' }] }, randomUUID(), randomUUID()))
      .rejects.toMatchObject({ status: 400, response: { code: 'PROCESS_EIGHT_D_SOURCE_CONFIRMATION_INVALID' } });
    await expect(service.issue(actor, { ...firstInput, processBoardCode: undefined }, randomUUID(), randomUUID()))
      .rejects.toMatchObject({ status: 409, response: { code: 'PROCESS_EIGHT_D_BOARD_REQUIRED' } });
    const before = await ledger.detail(actor, first.id);
    const report = await service.issue(actor, firstInput, randomUUID(), firstKey);
    const replayed = await service.issue(actor, firstInput, randomUUID(), firstKey);
    const another = await service.issue(actor, { ...fixtureData.input([second]), processBoardCode: '1' }, randomUUID(), randomUUID());
    const firstNumber = String(report.problem.reportNumber), secondNumber = String(another.problem.reportNumber);
    expect(firstNumber).toMatch(/^ZX8D-PQ0-\d{4}-001$/);
    expect(secondNumber).toBe(firstNumber.replace('PQ0', 'PQ1').replace(/001$/, '002'));
    expect(replayed.problem.id).toBe(report.problem.id);
    expect((await ledger.detail(actor, first.id)).operationSector).toBe(before.operationSector);
    expect(await prisma.problemIndex.count({ where: { organizationId: fixtureData.organization.id } })).toBe(2);
  });

  it('rechecks the managed ISSUE stage before replaying an old issuance', async () => {
    const f = await fixture();
    const source = await f.source();
    const input = f.input([source]);
    const key = randomUUID();
    const first = await service.issue(f.issuer.actor, input, randomUUID(), key);
    await prisma.userPosition.update({ where: { id: f.issuer.assignment.id }, data: { endedAt: new Date() } });
    await expect(service.issue(f.issuer.actor, input, randomUUID(), key)).rejects.toMatchObject({ response: { code: 'FEATURE_PERMISSION_DENIED' } });
    expect(await prisma.problemIndex.count({ where: { id: first.problem.id } })).toBe(1);
  });

  it.each(['history', 'eligible'] as const)('reads concurrent deadline %s after both transactions hold real READ record locks without an upgrade deadlock', async operation => {
    const f = await fixture(), id = await f.issue(), shared = gate();
    const before = await f.read(id);
    const extension = await extensions.request(f.owner.actor, id, { expectedRowVersion: before.version, expectedInstanceVersion: before.instanceVersion,
      stage: 'CLOSURE', requestedDueAt: '2027-01-15T00:00:00.000Z', reason: 'Concurrent reads must not change the pending extension' }, randomUUID(), randomUUID());
    let arrivals = 0;
    const backends = new Set<number>();
    const original = closure.lockAndRead.bind(closure);
    const read = jest.spyOn(closure, 'lockAndRead').mockImplementation(async (tx, actor, problemId, mode) => {
      const context = await original(tx, actor, problemId, mode);
      expect(mode).toBe('READ');
      const [backend] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
      backends.add(backend.pid);
      // Both real domain READ locks must be held before either deadline hook can run.
      if (++arrivals === 2) shared.open();
      await shared.promise;
      return context;
    });
    const run = (actor: ProcessEightDActor) => operation === 'history' ? extensions.history(actor, id) : prisma.$transaction(async tx => {
      const record = await service.lockRecord(tx, actor, id, 'READ');
      await service.authorizeRead(tx, actor, record);
      return extensions.eligible(tx, actor, id);
    });
    try {
      const results = await Promise.allSettled([run(f.manager.actor), run(f.issuer.actor)]);
      expect(arrivals).toBe(2);
      expect(backends.size).toBe(2);
      expect(results.filter(result => result.status === 'rejected')).toEqual([]);
      expect(results).toMatchObject([
        { status: 'fulfilled', value: [{ id: extension.id, status: 'LEADER_PENDING' }] },
        { status: 'fulfilled', value: operation === 'history' ? [{ id: extension.id, status: 'LEADER_PENDING' }] : [] },
      ]);
    } finally { read.mockRestore(); }
  }, 120_000);

  async function archivedFixture(closed = false) {
    const f = await fixture(), id = await f.issue();
    const permission = await prisma.permission.findUniqueOrThrow({ where: { code: 'problem-index:read' } });
    await prisma.rolePermission.create({ data: { roleId: f.role.id, permissionId: permission.id } });
    if (closed) {
      const round = (await f.submit(id))!;
      const one = await rounds.decide(f.issuer.actor, round.id, { expectedRoundVersion: round.version, duties: ['PROFESSIONAL'], decision: 'APPROVE', comment: 'Verified before archive' }, randomUUID(), randomUUID());
      await rounds.decide(f.manager.actor, one.id, { expectedRoundVersion: one.version, duties: ['SECTION_MANAGER'], decision: 'APPROVE', comment: 'Verified before archive' }, randomUUID(), randomUUID());
    }
    const before = await prisma.problemIndex.findUniqueOrThrow({ where: { id } });
    await prisma.$transaction(tx => problems.archive(tx, f.organization.id, id, before.version, f.issuer.user.id));
    const archived = await prisma.problemIndex.findUniqueOrThrow({ where: { id } });
    expect(archived).toMatchObject({ status: 'ARCHIVED', archivedAt: expect.any(Date), version: before.version + 1 });
    const query = new ProblemQueryService(prisma, readRegistry);
    return { f, id, archived, query };
  }

  it.each([false, true])('lists real archived 8D summaries on a mixed public problem page, including pinned closed facts: closed=%s', async closed => {
    const { f, id, archived, query } = await archivedFixture(closed), activeId = await f.issue();
    const page = await query.list(f.owner.actor, { domainCode: 'process-quality' });
    expect(page.total).toBe(2);
    expect(page.items.map(item => item.id)).toEqual(expect.arrayContaining([id, activeId]));
    expect(page.items.find(item => item.id === id)).toMatchObject({ status: 'ARCHIVED', summary: { domainUiKey: 'process-eight-d', fields: expect.arrayContaining([
      { key: 'stage', label: '当前阶段', value: '已归档' },
      { key: 'ownerName', label: '负责人', value: f.owner.user.username },
      { key: 'responsibleSectionName', label: '责任科室', value: f.section.name },
      { key: 'analysisDueAt', label: '分析期限', value: '2026-11-01T00:00:00.000Z' },
    ]) } });
    const filtered = await query.list(f.owner.actor, { domainCode: 'process-quality', status: 'ARCHIVED' });
    expect(filtered.total).toBe(1); expect(filtered.items[0]!.id).toBe(id);
    expect(await prisma.problemIndex.findUniqueOrThrow({ where: { id } })).toEqual(archived);
  }, 120_000);

  it('keeps archived reports readable through existing APIs but rejects every write purpose and attachment mutation', async () => {
    const { f, id, archived } = await archivedFixture();
    const model = await f.read(id);
    expect(model.allowedActions).toEqual(['read']);
    const report = await prisma.$transaction(tx => service.readReport(tx, f.owner.actor, id));
    expect(report.record.problem).toEqual(archived);
    const context = await prisma.$transaction(tx => closure.lockAndRead(tx, f.owner.actor, id, 'READ'));
    const resource = { resourceType: 'process-eight-d', resourceId: id };
    await expect(prisma.$transaction(tx => resources.authorizeAndLock(tx, f.owner.actor, resource, 'read'))).resolves.toMatchObject({ organizationId: f.organization.id });
    const before = { audits: await prisma.auditEvent.count({ where: { organizationId: f.organization.id } }), events: await prisma.outboxEvent.count() };
    for (const purpose of ['EDIT', 'SUBMIT', 'DECIDE', 'CANCEL', 'DEADLINE'] as const) {
      await expect(prisma.$transaction(tx => service.lockRecord(tx, f.owner.actor, id, purpose))).rejects.toMatchObject({ status: 404, response: { code: 'PROBLEM_NOT_FOUND' } });
    }
    for (const action of ['upload', 'complete', 'delete', 'attach'] as const) {
      await expect(prisma.$transaction(tx => resources.authorizeAndLock(tx, f.owner.actor, resource, action))).rejects.toMatchObject({ status: 404 });
    }
    for (const operation of ['SUBMIT', 'DECIDE', 'CANCEL'] as const) {
      await expect(prisma.$transaction(tx => closure.lockAndRead(tx, f.owner.actor, id, operation))).rejects.toMatchObject({ status: 404 });
    }
    await expect(prisma.$transaction(tx => closure.deadlineContext(tx, context, f.owner.actor, 'REQUEST'))).rejects.toMatchObject({ status: 404 });
    await expect(service.save(f.owner.actor, id, { expectedVersion: model.version, document: f.draft() }, randomUUID(), randomUUID())).rejects.toMatchObject({ status: 404 });
    await expect(service.submit(f.owner.actor, id, { expectedVersion: model.version }, randomUUID(), randomUUID())).rejects.toMatchObject({ status: 404 });
    await expect(service.sources(f.issuer.actor, id, { expectedVersion: model.version, add: [], removeDefectIds: [] }, randomUUID(), randomUUID())).rejects.toMatchObject({ status: 404 });
    expect(await prisma.problemIndex.findUniqueOrThrow({ where: { id } })).toEqual(archived);
    expect(await f.read(id)).toEqual(model);
    expect(await prisma.auditEvent.count({ where: { organizationId: f.organization.id } })).toBe(before.audits);
    expect(await prisma.outboxEvent.count()).toBe(before.events);
  }, 120_000);

  it('denies archived reads after effective read permission is revoked, including public list and existing read APIs', async () => {
    const { f, id, query } = await archivedFixture();
    await expect(query.find(f.owner.actor, f.organization.id, id)).resolves.toMatchObject({ id, status: 'ARCHIVED' });
    const permission = await prisma.permission.findUniqueOrThrow({ where: { code: 'process-quality:issues:read' } });
    await prisma.rolePermission.delete({ where: { roleId_permissionId: { roleId: f.role.id, permissionId: permission.id } } });
    expect(await query.list(f.owner.actor, { domainCode: 'process-quality' })).toMatchObject({ total: 0, items: [] });
    await expect(query.find(f.owner.actor, f.organization.id, id)).rejects.toMatchObject({ status: 404 });
    await expect(f.read(id)).rejects.toMatchObject({ status: 403 });
    await expect(prisma.$transaction(tx => service.readReport(tx, f.owner.actor, id))).rejects.toMatchObject({ status: 403 });
    await expect(prisma.$transaction(tx => closure.lockAndRead(tx, f.owner.actor, id, 'READ'))).rejects.toMatchObject({ status: 403 });
    await expect(prisma.$transaction(tx => resources.authorizeAndLock(tx, f.owner.actor, { resourceType: 'process-eight-d', resourceId: id }, 'read'))).rejects.toMatchObject({ status: 403 });
    await expect(prisma.$transaction(async tx => {
      const problem = await tx.problemIndex.findUniqueOrThrow({ where: { id } });
      return readRegistry.forProblem(problem).readSummaries(tx, f.owner.actor, [problem]);
    })).rejects.toMatchObject({ status: 403 });
  }, 120_000);

  it('keeps archived READ constrained to the original organization and active session', async () => {
    const { f, id } = await archivedFixture(), other = await fixture();
    await expect(service.read(other.owner.actor, id)).rejects.toMatchObject({ status: 404 });
    await expect(service.read({ ...f.owner.actor, accountType: 'SUPPLIER' }, id)).rejects.toMatchObject({ status: 403 });
    await prisma.session.update({ where: { id: f.owner.actor.sessionId }, data: { revokedAt: new Date() } });
    await expect(f.read(id)).rejects.toMatchObject({ status: 401 });
  }, 120_000);

  async function organizationPair(configure: boolean) {
    const home = await fixture(configure), target = await fixture(configure);
    const marker = await prisma.permission.findUniqueOrThrow({ where: { code: 'platform:admin' } });
    const role = await prisma.role.create({ data: { organizationId: home.organization.id, code: randomUUID(), name: 'Explicit platform marker', permissions: { create: { permissionId: marker.id } } } });
    await prisma.userRole.create({ data: { organizationId: home.organization.id, userId: home.issuer.user.id, roleId: role.id } });
    const actor = { ...home.issuer.actor, scopeOrganizationId: target.organization.id };
    return { home, target, role, actor };
  }

  async function legacyCrossOrganizationFixture() {
    const pair = await organizationPair(false);
    await legacyBinding(pair.home.issuer.actor);
    await legacyBinding(pair.target.issuer.actor);
    return pair;
  }

  async function crossOrganizationFixture() {
    const pair = await organizationPair(true), id = await pair.target.issue();
    const query = new ProblemQueryService(prisma, readRegistry);
    const storage = new S3CompatibleObjectStorage();
    const reports = new ProcessEightDReportService(prisma, service, new FileLifecycleService(prisma, new FilePolicyService(), storage, audit, resources), storage, audit);
    return { ...pair, id, query, reports };
  }

  it.each(['LIST', 'READ', 'REPORT'] as const)('allows a real platform administrator in A to %s a formal B 8D without impersonating its organization', async operation => {
    const { home, target, id, role, actor, query, reports } = await crossOrganizationFixture();
    const original = { ...actor };
    expect(await prisma.userPosition.count({ where: { userId: actor.id, organizationId: target.organization.id } })).toBe(0);
    if (operation === 'LIST') {
      const page = await query.list(home.issuer.actor, { organizationId: target.organization.id, domainCode: 'process-quality' });
      expect(page).toMatchObject({ total: 1, items: [{ id, organizationId: target.organization.id, summary: { fields: expect.arrayContaining([
        { key: 'ownerName', label: '负责人', value: target.owner.user.username },
      ]) } }] });
      const problem = await prisma.problemIndex.findUniqueOrThrow({ where: { id } });
      await prisma.$transaction(tx => problems.archive(tx, target.organization.id, id, problem.version, target.issuer.user.id));
      expect((await query.list(home.issuer.actor, { organizationId: target.organization.id, status: 'ARCHIVED' })).items[0]).toMatchObject({ id, summary: { fields: expect.arrayContaining([
        { key: 'stage', label: '当前阶段', value: '已归档' },
      ]) } });
      await expect(service.read(actor, id)).resolves.toMatchObject({ problemId: id, organizationId: target.organization.id, allowedActions: ['read'] });
    } else if (operation === 'READ') {
      await expect(service.read(actor, id)).resolves.toMatchObject({ problemId: id, organizationId: target.organization.id, allowedActions: ['read'] });
      const result = await prisma.$transaction(tx => service.readReport(tx, actor, id));
      expect(result.record.problem.organizationId).toBe(target.organization.id);
      await expect(prisma.$transaction(tx => resources.authorizeAndLock(tx, actor, { resourceType: 'process-eight-d', resourceId: id }, 'read'))).resolves.toMatchObject({ organizationId: target.organization.id });
    } else {
      const traceId = randomUUID();
      await expect(reports.read(actor, id, { organizationId: target.organization.id }, traceId)).resolves.toMatchObject({ problemId: id });
      expect(await prisma.auditEvent.findFirst({ where: { traceId, action: 'PROCESS_EIGHT_D_REPORT_READ' } })).toMatchObject({ organizationId: target.organization.id, actorUserId: home.issuer.user.id });
      await expect(reports.read(actor, id, { organizationId: home.organization.id }, randomUUID())).rejects.toMatchObject({ status: 403 });
    }
    expect(actor).toEqual(original);
    await prisma.userRole.delete({ where: { userId_roleId_organizationId: { userId: actor.id, roleId: role.id, organizationId: home.organization.id } } });
    await expect(service.read(actor, id)).rejects.toMatchObject({ status: 403 });
    await expect(query.list(home.issuer.actor, { organizationId: target.organization.id })).rejects.toMatchObject({ status: 403 });
    await expect(reports.read(actor, id, { organizationId: target.organization.id }, randomUUID())).rejects.toMatchObject({ status: 403 });
  }, 120_000);

  it('never promotes cross-organization platform feature grants into owner, collaborator or closure duties', async () => {
    const { target, id, actor } = await crossOrganizationFixture();
    const before = await target.read(id);
    for (const purpose of ['EDIT', 'SUBMIT', 'DECIDE', 'CANCEL', 'DEADLINE'] as const) {
      await expect(prisma.$transaction(tx => service.lockRecord(tx, actor, id, purpose))).rejects.toMatchObject({ status: 403 });
    }
    await expect(service.save(actor, id, { expectedVersion: before.version, document: target.draft() }, randomUUID(), randomUUID())).rejects.toMatchObject({ status: 403 });
    await expect(service.submit(actor, id, { expectedVersion: before.version }, randomUUID(), randomUUID())).rejects.toMatchObject({ status: 403 });
    const round = (await target.submit(id))!;
    await expect(rounds.decide(actor, round.id, { expectedRoundVersion: round.version, duties: ['PROFESSIONAL'], decision: 'APPROVE', comment: 'No actual duty' }, randomUUID(), randomUUID())).rejects.toMatchObject({ status: 404 });
    expect((await rounds.readProjection(prisma, target.organization.id, id))!.status).toBe('PENDING');
  }, 120_000);

  it('denies ordinary users and actual supplier accounts cross-organization 8D list, read and report', async () => {
    const { home, target, id, query, reports } = await crossOrganizationFixture();
    const organization = await prisma.organization.create({ data: { code: randomUUID(), name: 'Actual supplier', type: 'SUPPLIER' } });
    const user = await prisma.user.create({ data: { organizationId: organization.id, username: randomUUID(), passwordHash: 'unused', accountType: 'SUPPLIER' } });
    const session = await prisma.session.create({ data: { userId: user.id, tokenHash: randomUUID(), expiresAt: new Date(Date.now() + 3_600_000), securityVersion: user.securityVersion } });
    const supplier: ProcessEightDActor = { id: user.id, organizationId: organization.id, accountType: 'SUPPLIER', sessionId: session.id };
    for (const reader of [home.owner.actor, supplier]) {
      const scoped = { ...reader, scopeOrganizationId: target.organization.id };
      await expect(query.list(reader, { organizationId: target.organization.id })).rejects.toMatchObject({ status: 403 });
      await expect(service.read(scoped, id)).rejects.toMatchObject({ status: 403 });
      await expect(reports.read(scoped, id, { organizationId: target.organization.id }, randomUUID())).rejects.toMatchObject({ status: 403 });
    }
  }, 120_000);

  it('serves cross-organization public HTTP list, current report and PDF through real guards, and still denies duty-free writes', async () => {
    const { home, target, id } = await crossOrganizationFixture();
    const app = (await Test.createTestingModule({ imports: [AppModule] }).compile()).createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new GlobalExceptionFilter());
    try {
      await app.init();
      const sessions = app.get(SessionService), csrf = randomUUID();
      const token = await sessions.create(home.issuer.user.id, app.get(PrismaService), { reauthenticated: true, mfaVerified: true });
      const cookie = `qms_session=${token}; qms_csrf=${csrf}`;
      const get = (path: string) => request(app.getHttpServer()).get(`/api/v1/${path}`).set('Cookie', cookie);
      const suffix = `organizationId=${target.organization.id}`;
      const base = `process-quality/eight-d/${id}`;
      const page = await get(`problem-index?${suffix}&domainCode=process-quality`).expect(200);
      expect(page.body).toMatchObject({ total: 1, items: [{ id, organizationId: target.organization.id }] });
      await get(`${base}?${suffix}`).expect(200);
      const report = await get(`${base}/report?${suffix}&view=CURRENT`).expect(200);
      expect(report.body).toMatchObject({ problemId: id, view: 'CURRENT', snapshot: { problem: { organizationId: target.organization.id } } });
      const pdf = await get(`${base}/report/pdf?${suffix}&view=CURRENT`).expect(200).expect('Content-Type', /application\/pdf/);
      expect(pdf.body.subarray(0, 5).toString()).toBe('%PDF-');
      const before = await target.read(id);
      await request(app.getHttpServer()).put(`/api/v1/${base}`).set('Cookie', cookie).set('x-csrf-token', csrf).set('Idempotency-Key', randomUUID())
        .send({ organizationId: target.organization.id, expectedVersion: before.version, document: target.draft() }).expect(403);
      await request(app.getHttpServer()).post(`/api/v1/${base}/submit`).set('Cookie', cookie).set('x-csrf-token', csrf).set('Idempotency-Key', randomUUID())
        .send({ organizationId: target.organization.id, expectedVersion: before.version }).expect(403);
      expect(await target.read(id)).toEqual(before);
      const ordinary = await sessions.create(home.owner.user.id, app.get(PrismaService), { mfaVerified: true });
      for (const path of [`problem-index?${suffix}`, `${base}?${suffix}`, `${base}/report?${suffix}`, `${base}/report/pdf?${suffix}`]) {
        await request(app.getHttpServer()).get(`/api/v1/${path}`).set('Cookie', `qms_session=${ordinary}`).expect(403);
      }
      const session = await sessions.resolve(token);
      expect(session!.user.organizationId).toBe(home.organization.id);
    } finally { await app.close(); }
  }, 120_000);

  it('filters response forms before pagination and status counts for real same-type BRIEF and formal 8D indexes', async () => {
    const { f, id: archivedId, query } = await archivedFixture(), activeId = await f.issue(), briefSource = await f.source();
    const brief = await prisma.$transaction(tx => problems.createForDomainSourceIssue(tx, { organizationId: f.organization.id, domainCode: 'process-quality',
      problemType: 'PROCESS_DEFECT', sourceType: 'process-defect', sourceId: briefSource.id, severity: 'LOW', ownerId: f.owner.user.id, createdById: f.issuer.user.id }));
    const base = { domainCode: 'process-quality', problemType: 'PROCESS_DEFECT', pageSize: 1 };
    const form = (responseForm: 'BRIEF' | 'EIGHT_D', page = 1) => Object.assign(new ProblemIndexQueryDto(), base, { responseForm, page });
    const first = await query.list(f.owner.actor, form('EIGHT_D'));
    const second = await query.list(f.owner.actor, form('EIGHT_D', 2));
    expect(first.total).toBe(2); expect(second.total).toBe(2);
    expect(first.items).toHaveLength(1); expect(second.items).toHaveLength(1);
    expect([first.items[0]!.id, second.items[0]!.id].sort()).toEqual([activeId, archivedId].sort());
    expect(first.statusCounts).toEqual(expect.arrayContaining([{ status: 'ARCHIVED', count: 1 }, { status: 'IN_PROGRESS', count: 1 }]));
    expect(first.statusCounts).toHaveLength(2); expect(second.statusCounts).toEqual(first.statusCounts);
    expect((await query.list(f.owner.actor, form('EIGHT_D', 3))).items).toEqual([]);
    const briefs = await query.list(f.owner.actor, form('BRIEF'));
    expect(briefs).toMatchObject({ total: 1, items: [{ id: brief.id }], statusCounts: [{ status: 'OPEN', count: 1 }] });
    expect((await query.list(f.owner.actor, base)).total).toBe(3);
    const permission = await prisma.permission.findUniqueOrThrow({ where: { code: 'process-quality:issues:read' } });
    await prisma.rolePermission.delete({ where: { roleId_permissionId: { roleId: f.role.id, permissionId: permission.id } } });
    expect(await query.list(f.owner.actor, form('EIGHT_D'))).toMatchObject({ total: 0, items: [], statusCounts: [] });
    expect((await query.list(f.owner.actor, form('BRIEF'))).total).toBe(1);
  }, 120_000);

  async function realFileReadFixture() {
    const f = await crossOrganizationFixture();
    const app = (await Test.createTestingModule({ imports: [AppModule] }).compile()).createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new GlobalExceptionFilter());
    try {
      await app.init();
      const csrf = randomUUID(), sessions = app.get(SessionService);
      const cookie = async (userId: string) => `qms_session=${await sessions.create(userId, app.get(PrismaService), { reauthenticated: true, mfaVerified: true })}; qms_csrf=${csrf}`;
      const ownerCookie = await cookie(f.target.owner.user.id), adminCookie = await cookie(f.home.issuer.user.id);
      const get = (who: string, path: string) => request(app.getHttpServer()).get(`/api/v1/${path}`).set('Cookie', who);
      const post = (who: string, path: string, body: object) => request(app.getHttpServer()).post(`/api/v1/${path}`)
        .set('Cookie', who).set('x-csrf-token', csrf).set('Idempotency-Key', randomUUID()).send(body);
      const permission = await prisma.permission.findUniqueOrThrow({ where: { code: 'problem-index:read' } });
      await prisma.rolePermission.create({ data: { roleId: f.target.role.id, permissionId: permission.id } });
      const uploadInput = { resourceType: 'process-eight-d', resourceId: f.id, originalName: 'actual-file-read.png', contentType: 'image/png',
        sizeBytes: png.length, sha256: createHash('sha256').update(png).digest('hex') };
      const upload = (await post(ownerCookie, 'files/uploads', uploadInput).expect(201)).body;
      expect((await fetch(upload.uploadUrl, { method: 'PUT', headers: upload.headers, body: png })).status).toBe(200);
      await post(ownerCookie, `files/${upload.file.id}/complete`, { expectedVersion: upload.file.version }).expect(202);
      const [{ now }] = await prisma.$queryRaw<{ now: Date }[]>`SELECT CURRENT_TIMESTAMP AS "now"`;
      const offset = now.getTime() - Date.now() + 1000;
      const scanner = new FileScanWorkerService(prisma, app.get(FileVerificationService), app.get(AuditLogService), () => new Date(Date.now() + offset));
      await scanner.processDue(100);
      const file = await prisma.fileObject.findUniqueOrThrow({ where: { id: upload.file.id } });
      expect(file).toMatchObject({ status: 'AVAILABLE', scanStatus: 'CLEAN', verifiedSha256: uploadInput.sha256, verifiedContentType: 'image/png' });
      expect(file.scannerEngine).toMatch(/^ClamAV /);
      const current = await f.target.read(f.id), document = f.target.draft();
      document.okFileIds = [file.id];
      await service.save(f.target.owner.actor, f.id, { expectedVersion: current.version, document }, randomUUID(), randomUUID());
      const workspace = `problem-index/${f.id}/workspace?organizationId=${f.target.organization.id}`;
      expect((await get(ownerCookie, workspace).expect(200)).body.evidence).toEqual(expect.arrayContaining([expect.objectContaining({ id: file.id, downloadable: true })]));
      console.info('REQ0030 real file READ fixture', { fileId: file.id, organizationId: file.organizationId, scannerEngine: file.scannerEngine,
        status: file.status, scanStatus: file.scanStatus, sha256: file.verifiedSha256, objectVersionId: file.objectVersionId });
      return { ...f, app, cookie, ownerCookie, adminCookie, get, post, file, uploadInput, workspace };
    } catch (error) { await app.close(); throw error; }
  }

  it.each(['WORKSPACE', 'METADATA', 'DOWNLOAD'] as const)('reads an actual CLEAN B attachment through public %s as platform administrator A without supplied scope', async route => {
    const f = await realFileReadFixture();
    try {
      if (route === 'WORKSPACE') {
        const response = await f.get(f.adminCookie, f.workspace).expect(200);
        expect(response.body).toMatchObject({ problem: { id: f.id, organizationId: f.target.organization.id }, evidence: expect.arrayContaining([
          expect.objectContaining({ id: f.file.id, downloadable: true }),
        ]) });
      } else if (route === 'METADATA') {
        await f.get(f.adminCookie, `files/${f.file.id}`).expect(200).expect(response => {
          expect(response.body).toMatchObject({ id: f.file.id, status: 'AVAILABLE', scanStatus: 'CLEAN' });
        });
      } else {
        const grant = (await f.post(f.adminCookie, `files/${f.file.id}/download`, {}).expect(201)).body;
        const response = await fetch(grant.url);
        expect(response.status).toBe(200);
        const bytes = Buffer.from(await response.arrayBuffer());
        expect(bytes).toEqual(png);
        expect(createHash('sha256').update(bytes).digest('hex')).toBe(f.file.sha256);
      }
      const user = await prisma.user.findUniqueOrThrow({ where: { id: f.home.issuer.user.id } });
      expect(user.organizationId).toBe(f.home.organization.id);
    } finally { await f.app.close(); }
  }, 120_000);

  it('denies real file reads to ungranted same-organization and ordinary cross-organization users and to a revoked platform administrator', async () => {
    const f = await realFileReadFixture();
    try {
      const ungranted = await f.target.person(f.target.section.id);
      await prisma.userRole.deleteMany({ where: { userId: ungranted.user.id } });
      for (const who of [await f.cookie(ungranted.user.id), await f.cookie(f.home.owner.user.id)]) {
        await f.get(who, f.workspace).expect(403);
        await f.get(who, `files/${f.file.id}`).expect(403);
        await f.post(who, `files/${f.file.id}/download`, {}).expect(403);
      }
      await f.get(f.adminCookie, `files/${f.file.id}`).expect(200);
      await prisma.userRole.delete({ where: { userId_roleId_organizationId: { userId: f.actor.id, roleId: f.role.id, organizationId: f.home.organization.id } } });
      await f.get(f.adminCookie, f.workspace).expect(403);
      await f.get(f.adminCookie, `files/${f.file.id}`).expect(403);
      await f.post(f.adminCookie, `files/${f.file.id}/download`, {}).expect(403);
    } finally { await f.app.close(); }
  }, 120_000);

  it('keeps actual archived attachment READ available but rejects upload, complete, attach and delete without mutating evidence', async () => {
    const f = await realFileReadFixture();
    try {
      const problem = await prisma.problemIndex.findUniqueOrThrow({ where: { id: f.id } });
      await prisma.$transaction(tx => problems.archive(tx, f.target.organization.id, f.id, problem.version, f.target.issuer.user.id));
      await f.get(f.adminCookie, f.workspace).expect(200);
      await f.get(f.adminCookie, `files/${f.file.id}`).expect(200);
      const grant = (await f.post(f.adminCookie, `files/${f.file.id}/download`, {}).expect(201)).body;
      const response = await fetch(grant.url);
      expect(response.status).toBe(200); expect(Buffer.from(await response.arrayBuffer())).toEqual(png);
      await f.post(f.ownerCookie, 'files/uploads', f.uploadInput).expect(404);
      await f.post(f.ownerCookie, `files/${f.file.id}/complete`, { expectedVersion: f.file.version }).expect(404);
      await f.post(f.ownerCookie, `files/${f.file.id}/delete`, { expectedVersion: f.file.version }).expect(404);
      await expect(prisma.$transaction(tx => f.app.get(FileLifecycleService).assertAttachable(tx, f.target.owner.actor,
        { resourceType: 'process-eight-d', resourceId: f.id }, [f.file.id]))).rejects.toMatchObject({ status: 404 });
      expect(await prisma.fileObject.findUniqueOrThrow({ where: { id: f.file.id } })).toEqual(f.file);
    } finally { await f.app.close(); }
  }, 120_000);

  it('manages target B binding GET, PUT and activation through real HTTP without changing administrator A identity or A configuration', async () => {
    const f = await legacyCrossOrganizationFixture();
    const beforeA = await service.binding(f.home.issuer.actor), beforeB = (await service.binding(f.target.issuer.actor))!;
    const app = (await Test.createTestingModule({ imports: [AppModule] }).compile()).createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new GlobalExceptionFilter());
    try {
      await app.init();
      const csrf = randomUUID(), token = await app.get(SessionService).create(f.home.issuer.user.id, app.get(PrismaService), { reauthenticated: true, mfaVerified: true });
      const cookie = `qms_session=${token}; qms_csrf=${csrf}`, bindKey = randomUUID(), activateKey = randomUUID();
      const beforeOutbox = await prisma.outboxEvent.count();
      const get = await request(app.getHttpServer()).get(`/api/v1/process-quality/eight-d/binding?organizationId=${f.target.organization.id}`).set('Cookie', cookie).expect(200);
      expect(get.body).toEqual(beforeB);
      const bound = await request(app.getHttpServer()).put('/api/v1/process-quality/eight-d/binding').set('Cookie', cookie).set('x-csrf-token', csrf).set('Idempotency-Key', bindKey)
        .send({ organizationId: f.target.organization.id, expectedVersion: beforeB.version, workflowDefinitionId: beforeB.workflowDefinitionId, workflowVersionId: beforeB.workflowVersionId }).expect(200);
      expect(bound.body).toMatchObject({ organizationId: f.target.organization.id, version: beforeB.version + 1, enabled: false });
      const active = await request(app.getHttpServer()).put('/api/v1/process-quality/eight-d/activation').set('Cookie', cookie).set('x-csrf-token', csrf).set('Idempotency-Key', activateKey)
        .send({ organizationId: f.target.organization.id, expectedVersion: bound.body.version, enabled: true }).expect(200);
      expect(active.body).toMatchObject({ organizationId: f.target.organization.id, version: beforeB.version + 2, enabled: true });
      expect(await service.binding(f.home.issuer.actor)).toEqual(beforeA);
      const [stored] = await prisma.$queryRaw<{ updatedBy: string }[]>`SELECT updated_by AS "updatedBy" FROM process_eight_d_bindings WHERE organization_id = ${f.target.organization.id}::uuid`;
      expect(stored!.updatedBy).toBe(f.home.issuer.user.id);
      const receipts = await prisma.$queryRaw<{ organizationId: string; responseOrganizationId: string }[]>`SELECT organization_id AS "organizationId", response->>'organizationId' AS "responseOrganizationId"
        FROM process_eight_d_receipts WHERE actor_user_id = ${f.home.issuer.user.id}::uuid AND key IN (${bindKey}, ${activateKey})`;
      expect(receipts).toHaveLength(2);
      expect(receipts.every(row => row.organizationId === f.target.organization.id && row.responseOrganizationId === f.target.organization.id)).toBe(true);
      expect(await prisma.auditEvent.count({ where: { organizationId: f.target.organization.id, actorUserId: f.home.issuer.user.id, resourceId: f.target.organization.id, action: 'PROCESS_EIGHT_D_BINDING_CHANGED' } })).toBe(2);
      expect(await prisma.outboxEvent.count()).toBe(beforeOutbox);
      expect((await app.get(SessionService).resolve(token))!.user.organizationId).toBe(f.home.organization.id);
    } finally { await app.close(); }
  }, 120_000);

  it.each(['MISSING', 'EXPIRED'] as const)('allows configuration with %s step-up and rejects writes and replays after the session is revoked', async state => {
    const f = await legacyCrossOrganizationFixture();
    const app = (await Test.createTestingModule({ imports: [AppModule] }).compile()).createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new GlobalExceptionFilter());
    try {
      await app.init();
      const sessions = app.get(SessionService);
      const token = await sessions.create(f.home.issuer.user.id, app.get(PrismaService), { reauthenticated: true, mfaVerified: true });
      const session = (await sessions.resolve(token))!;
      await prisma.session.update({ where: { id: session.id }, data: { reauthenticatedAt: state === 'MISSING' ? null : new Date(Date.now() - 6 * 60_000) } });
      const csrf = randomUUID(), cookie = `qms_session=${token}; qms_csrf=${csrf}`;
      const before = (await service.binding(f.target.issuer.actor))!;
      const bindKey = randomUUID(), activateKey = randomUUID();
      const bindBody = { organizationId: f.target.organization.id, expectedVersion: before.version, workflowDefinitionId: before.workflowDefinitionId, workflowVersionId: before.workflowVersionId };
      const bound = await request(app.getHttpServer()).put('/api/v1/process-quality/eight-d/binding').set('Cookie', cookie).set('x-csrf-token', csrf).set('Idempotency-Key', bindKey).send(bindBody).expect(200);
      const activateBody = { organizationId: f.target.organization.id, expectedVersion: bound.body.version, enabled: true };
      await request(app.getHttpServer()).put('/api/v1/process-quality/eight-d/activation').set('Cookie', cookie).set('x-csrf-token', csrf).set('Idempotency-Key', activateKey).send(activateBody).expect(200);
      const stable = (await service.binding(f.target.issuer.actor))!;
      const auditBefore = await prisma.auditEvent.count({ where: { organizationId: f.target.organization.id, action: 'PROCESS_EIGHT_D_BINDING_CHANGED', outcome: 'SUCCESS' } });
      const receiptBefore = await prisma.$queryRaw<{ count: number }[]>`SELECT count(*)::int AS count FROM process_eight_d_receipts WHERE organization_id = ${f.target.organization.id}::uuid AND actor_user_id = ${f.actor.id}::uuid`;
      const userBefore = await prisma.user.findUniqueOrThrow({ where: { id: f.actor.id } });
      await request(app.getHttpServer()).get(`/api/v1/process-quality/eight-d/binding?organizationId=${f.target.organization.id}`).set('Cookie', cookie).expect(200);
      await prisma.session.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
      for (const operation of [
        { path: 'binding', key: randomUUID(), body: { ...bindBody, expectedVersion: stable.version } },
        { path: 'activation', key: randomUUID(), body: { ...activateBody, expectedVersion: stable.version, enabled: false } },
        { path: 'binding', key: bindKey, body: bindBody },
        { path: 'activation', key: activateKey, body: activateBody },
      ]) {
        const rejected = await request(app.getHttpServer()).put(`/api/v1/process-quality/eight-d/${operation.path}`).set('Cookie', cookie)
          .set('x-csrf-token', csrf).set('Idempotency-Key', operation.key).send(operation.body).expect(401);
        expect(rejected.body.code).toBe('AUTH_SESSION_REQUIRED');
      }
      expect(await service.binding(f.target.issuer.actor)).toEqual(stable);
      expect(await prisma.$queryRaw<{ count: number }[]>`SELECT count(*)::int AS count FROM process_eight_d_receipts WHERE organization_id = ${f.target.organization.id}::uuid AND actor_user_id = ${f.actor.id}::uuid`).toEqual(receiptBefore);
      expect(await prisma.auditEvent.count({ where: { organizationId: f.target.organization.id, action: 'PROCESS_EIGHT_D_BINDING_CHANGED', outcome: 'SUCCESS' } })).toBe(auditBefore);
      expect(await prisma.user.findUniqueOrThrow({ where: { id: f.actor.id } })).toEqual(userBefore);
    } finally {
      await prisma.rolePermission.deleteMany({ where: { roleId: f.role.id } });
      await app.close();
    }
  }, 120_000);

  it('isolates configuration receipts for the same actor and key in A and B, preserves CAS and rejects foreign workflow bindings', async () => {
    const f = await legacyCrossOrganizationFixture(), a = (await service.binding(f.home.issuer.actor))!, b = (await service.binding(f.target.issuer.actor))!;
    const key = randomUUID(), input = { expectedVersion: b.version, enabled: false };
    expect(a.version).toBe(b.version);
    const bChanged = await service.activate(f.actor, input, key, randomUUID());
    expect(await service.binding(f.home.issuer.actor)).toEqual(a);
    const aChanged = await service.activate(f.home.issuer.actor, input, key, randomUUID());
    expect(bChanged).toMatchObject({ organizationId: f.target.organization.id, version: b.version + 1, enabled: false });
    expect(aChanged).toMatchObject({ organizationId: f.home.organization.id, version: a.version + 1, enabled: false });
    expect(await service.activate(f.actor, input, key, randomUUID())).toEqual(bChanged);
    expect(await service.activate(f.home.issuer.actor, input, key, randomUUID())).toEqual(aChanged);
    await expect(service.activate(f.actor, input, randomUUID(), randomUUID())).rejects.toMatchObject({ status: 409, response: { code: 'CONCURRENCY_CONFLICT' } });
    await expect(service.bind(f.actor, { expectedVersion: b.version + 1, workflowDefinitionId: a.workflowDefinitionId, workflowVersionId: a.workflowVersionId }, randomUUID(), randomUUID())).rejects.toMatchObject({ status: 409 });
    expect(await service.binding(f.actor)).toEqual(bChanged);
    const rows = await prisma.$queryRaw<{ organizationId: string }[]>`SELECT organization_id AS "organizationId" FROM process_eight_d_receipts
      WHERE actor_user_id = ${f.actor.id}::uuid AND key = ${key}`;
    expect(rows.map(row => row.organizationId).sort()).toEqual([f.home.organization.id, f.target.organization.id].sort());
  }, 120_000);

  it('revalidates cross-organization configuration MFA, internal active target and grants while denying ordinary users and suppliers', async () => {
    const f = await legacyCrossOrganizationFixture(), binding = (await service.binding(f.target.issuer.actor))!;
    const input = { expectedVersion: binding.version, enabled: false };
    await prisma.user.update({ where: { id: f.actor.id }, data: { mfaRequirementOverride: true } });
    await prisma.session.update({ where: { id: f.actor.sessionId }, data: { mfaVerifiedAt: null } });
    await expect(service.binding(f.actor)).rejects.toMatchObject({ status: 401, response: { code: 'AUTH_MFA_REQUIRED' } });
    await expect(service.activate(f.actor, input, randomUUID(), randomUUID())).rejects.toMatchObject({ status: 401 });
    await prisma.session.update({ where: { id: f.actor.sessionId }, data: { mfaVerifiedAt: new Date() } });
    const ordinary = { ...f.home.owner.actor, scopeOrganizationId: f.target.organization.id };
    await expect(service.binding(ordinary)).rejects.toMatchObject({ status: 403 });
    await expect(service.bind(ordinary, { expectedVersion: binding.version, workflowDefinitionId: binding.workflowDefinitionId, workflowVersionId: binding.workflowVersionId }, randomUUID(), randomUUID())).rejects.toMatchObject({ status: 403 });
    await expect(service.activate(ordinary, input, randomUUID(), randomUUID())).rejects.toMatchObject({ status: 403 });
    const organization = await prisma.organization.create({ data: { code: randomUUID(), name: 'Configuration supplier boundary', type: 'SUPPLIER' } });
    const user = await prisma.user.create({ data: { organizationId: organization.id, username: randomUUID(), passwordHash: 'unused', accountType: 'SUPPLIER' } });
    const session = await prisma.session.create({ data: { userId: user.id, tokenHash: randomUUID(), expiresAt: new Date(Date.now() + 3_600_000), securityVersion: user.securityVersion } });
    const supplier: ProcessEightDActor = { id: user.id, organizationId: organization.id, accountType: 'SUPPLIER', sessionId: session.id, scopeOrganizationId: f.target.organization.id };
    await expect(service.binding(supplier)).rejects.toMatchObject({ status: 403 });
    await expect(service.activate(supplier, input, randomUUID(), randomUUID())).rejects.toMatchObject({ status: 403 });
    await expect(service.binding({ ...f.actor, scopeOrganizationId: organization.id })).rejects.toMatchObject({ status: 403 });
    await prisma.organization.update({ where: { id: f.target.organization.id }, data: { status: 'DISABLED' } });
    await expect(service.binding(f.actor)).rejects.toMatchObject({ status: 403 });
    await expect(service.activate(f.actor, input, randomUUID(), randomUUID())).rejects.toMatchObject({ status: 403 });
    await prisma.organization.update({ where: { id: f.target.organization.id }, data: { status: 'ACTIVE' } });
    await prisma.userRole.delete({ where: { userId_roleId_organizationId: { userId: f.actor.id, roleId: f.role.id, organizationId: f.home.organization.id } } });
    await expect(service.binding(f.actor)).rejects.toMatchObject({ status: 403 });
    await expect(service.activate(f.actor, input, randomUUID(), randomUUID())).rejects.toMatchObject({ status: 403 });
    expect(await service.binding(f.target.issuer.actor)).toEqual(binding);
  }, 120_000);

  it('lists ordinary direct collaborators consistently with writes without widening section duties', async () => {
    const f = await fixture(), id = await f.issue(), direct = await f.person(f.section.id);
    await prisma.position.update({ where: { id: direct.position.id }, data: { departmentId: null } });
    await prisma.userRole.deleteMany({ where: { userId: direct.user.id } });
    const permissions = await prisma.permission.findMany({ where: { code: { in: ['process-quality:issues:read', 'process-quality:issues:work'] } } });
    expect(permissions).toHaveLength(2);
    const role = await prisma.role.create({ data: { organizationId: f.organization.id, code: randomUUID(), name: 'Ordinary direct collaborator', permissions: { create: permissions.map(({ id: permissionId }) => ({ permissionId })) } } });
    await prisma.positionRole.create({ data: { organizationId: f.organization.id, positionId: direct.position.id, roleId: role.id, isCanonical: true } });
    await service.collaborators(f.owner.actor, id, { expectedVersion: (await f.read(id)).version, userIds: [direct.user.id] }, randomUUID(), randomUUID());
    expect((await f.read(id)).collaboratorUserIds).toEqual([direct.user.id]);
    const app = (await Test.createTestingModule({ imports: [AppModule] }).compile()).createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new GlobalExceptionFilter());
    try {
      await app.init();
      const cookie = `qms_session=${await app.get(SessionService).create(f.owner.user.id, app.get(PrismaService), { reauthenticated: true, mfaVerified: true })}`;
      const options = async (action = 'COLLABORATORS', extra: Record<string, string> = {}) => (await request(app.getHttpServer())
        .get(`/api/v1/process-quality/eight-d/assignment-options?${new URLSearchParams({ action, ...(action === 'ISSUE' ? {} : { problemId: id }), search: direct.user.username, pageSize: '1', ...extra })}`)
        .set('Cookie', cookie).expect(200)).body;
      expect(await options()).toMatchObject({ users: [{ id: direct.user.id, username: direct.user.username, fullName: null }], userTotal: 1 });
      expect(await options('COLLABORATORS', { page: '2' })).toMatchObject({ users: [], userTotal: 1 });
      expect(await options('COLLABORATORS', { sectionDepartmentId: f.section.id })).toMatchObject({ users: [], userTotal: 0 });
      for (const action of ['ISSUE', 'REASSIGN']) expect(await options(action)).toMatchObject({ users: [], userTotal: 0 });
      await prisma.user.update({ where: { id: direct.user.id }, data: { status: 'DISABLED' } });
      expect((await options()).userTotal).toBe(0);
      await prisma.user.update({ where: { id: direct.user.id }, data: { status: 'ACTIVE' } });
      await prisma.userPosition.update({ where: { id: direct.assignment.id }, data: { startedAt: new Date(Date.now() + 60_000) } });
      expect((await options()).userTotal).toBe(0);
      await prisma.userPosition.update({ where: { id: direct.assignment.id }, data: { startedAt: direct.assignment.startedAt, endedAt: new Date() } });
      expect((await options()).userTotal).toBe(0);
      await prisma.userPosition.update({ where: { id: direct.assignment.id }, data: { endedAt: null } });
      await prisma.position.update({ where: { id: direct.position.id }, data: { status: 'DISABLED', configurationRequired: true } });
      expect((await options()).userTotal).toBe(0);
      await prisma.position.update({ where: { id: direct.position.id }, data: { status: 'ACTIVE', configurationRequired: false } });
      await prisma.rolePermission.deleteMany({ where: { roleId: role.id, permission: { code: 'process-quality:issues:work' } } });
      expect((await options()).userTotal).toBe(0);
      await expect(service.collaborators(f.owner.actor, id, { expectedVersion: (await f.read(id)).version, userIds: [direct.user.id] }, randomUUID(), randomUUID())).rejects.toMatchObject({ status: 400 });
    } finally { await app.close(); }
  }, 120_000);

  it('lists domain-authorized active assignment candidates without workflow/structure management grants', async () => {
    const f = await fixture(), other = await fixture();
    const workflowManage = await prisma.permission.findUniqueOrThrow({ where: { code: 'workflow:manage' } });
    await prisma.rolePermission.delete({ where: { roleId_permissionId: { roleId: f.role.id, permissionId: workflowManage.id } } });
    const query = (input: Partial<ProcessEightDAssignmentOptionsQueryDto>) => Object.assign(new ProcessEightDAssignmentOptionsQueryDto(), input);
    const selected = await service.assignmentOptions(f.issuer.actor, query({ sectionDepartmentId: f.section.id, search: f.owner.user.username }));
    expect(selected.users).toEqual([{ id: f.owner.user.id, username: f.owner.user.username, fullName: null, departmentName: f.section.name }]);
    expect(selected.userTotal).toBe(1);
    expect(Object.keys(selected.users[0]!).sort()).toEqual(['departmentName', 'fullName', 'id', 'username']);
    await prisma.user.update({ where: { id: f.owner.user.id }, data: { fullName: '张三' } });
    const named = await service.assignmentOptions(f.issuer.actor, query({ sectionDepartmentId: f.section.id, search: '张', pageSize: 1 }));
    expect(named).toMatchObject({ users: [{ id: f.owner.user.id, username: f.owner.user.username, fullName: '张三', departmentName: f.section.name }], userTotal: 1 });
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
    const facts = await prisma.$queryRaw<{ recurrence: string }[]>`SELECT recurrence FROM process_eight_d_source_confirmations
      WHERE problem_id = ${target}::uuid AND defect_id = ${a.id}::uuid`;
    expect(facts).toEqual([{ recurrence: 'RECURRENCE' }]);
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
    const followup = () => prisma.$transaction(async tx => {
      const problem = await tx.problemIndex.findUniqueOrThrow({ where: { id } });
      return (await readRegistry.forProblem(problem).readSummaries(tx, f.owner.actor, [problem])).get(id)!;
    });
    const closedSummary = await followup();
    expect(closedSummary.fields).toEqual(expect.arrayContaining([
      { key: 'stage', label: '当前阶段', value: '已关闭' },
      { key: 'ownerName', label: '负责人', value: f.owner.user.username },
      { key: 'analysisDueAt', label: '分析期限', value: closed.analysisDueAt },
      { key: 'submittedAt', label: '完整提交时间', value: closed.submittedAt },
    ]));
    const snapshot = await prisma.$transaction(tx => service.readReport(tx, f.owner.actor, id, closed.closedRevisionId!));
    const additional = await f.source();
    await service.sources(f.issuer.actor, id, { expectedVersion: closed.version, add: [{ defectId: additional.id, expectedVersion: additional.version }], removeDefectIds: [] }, randomUUID(), randomUUID());
    expect((await f.read(id)).contentVersion).toBe(closed.contentVersion);
    const historical = await prisma.$transaction(tx => service.readReport(tx, f.owner.actor, id, closed.closedRevisionId!));
    expect(historical.snapshot).toEqual(snapshot.snapshot);
    expect(await followup()).toEqual(closedSummary);
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
    expect(await service.flowRecords(f.owner.actor, id)).toEqual(expect.arrayContaining([
      { occurredAt: expect.any(String), person: f.owner.user.username, content: `关闭期限：申请延期至 ${requestedDueAt}：Keep the original deadline until both actual approvals` },
      { occurredAt: expect.any(String), person: f.manager.user.username, content: expect.stringContaining('关闭期限：管理审核通过') },
      { occurredAt: expect.any(String), person: f.issuer.user.username, content: expect.stringContaining('关闭期限：专业审核通过，延期生效') },
    ]));
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
    const f = await fixture(), id = await f.issue(), target = f.manager, actor = f[person].actor;
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
