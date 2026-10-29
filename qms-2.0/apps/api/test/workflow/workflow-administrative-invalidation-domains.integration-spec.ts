import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { AppModule } from '../../src/app.module.js';
import { PrismaService } from '../../src/database/prisma.service.js';
import { Prisma } from '../../src/generated/prisma/client.js';
import { GlobalExceptionFilter } from '../../src/common/contracts/global-exception.filter.js';
import { AdministrativeLifecycleRegistry } from '../../src/common/security/administrative-lifecycle.registry.js';
import type { AdministrativeLifecycleImpact } from '../../src/common/security/administrative-lifecycle.types.js';
import { INTERNAL_EIGHT_D_DOMAINS, internalEightDSql } from '../../src/common/eight-d/internal-eight-d-domain.js';
import { AuditLogService } from '../../src/modules/audit-log/audit-log.service.js';
import { ProblemIndexService } from '../../src/modules/problem-index/problem-index.service.js';
import { OutboxService } from '../../src/modules/task-notification/outbox.service.js';
import { SessionService } from '../../src/modules/identity/session.service.js';
import { OrganizationForceDeleteService } from '../../src/modules/organization/organization-force-delete.service.js';
import { emptyProcessEightDDocument } from '../../src/modules/process-quality/process-eight-d-document.js';
import { AdministrativeProblemReconfigurationService } from '../../src/administrative-problem-reconfiguration.service.js';
import { AdministrativeProblemDomain } from '../../src/administrative-problem-reconfiguration.dto.js';
import { WorkflowAdministrativeInvalidationService } from '../../src/modules/workflow/workflow-administrative-invalidation.service.js';
import { WorkflowClosureRegistry } from '../../src/modules/workflow/workflow-closure-registry.js';
import { WorkflowClosureRoundService } from '../../src/modules/workflow/workflow-closure-round.service.js';
import { createWorkflowClosureFixture } from './workflow-closure-round.fixture.js';
import { supplierEightDDocument, supplierEightDFixture } from '../supplier-quality/supplier-eight-d.fixture.js';
import { isDisposableLoopbackPostgres } from '../disposable-postgres.js';

if (process.env.QMS_DISPOSABLE_TEST_DB !== 'true' || !isDisposableLoopbackPostgres(process.env.DATABASE_URL)) throw new Error('Leased disposable PostgreSQL required, never 55440.');

describe('registered four-domain administrative hooks / real PostgreSQL (not delete-command acceptance)', () => {
  let app: INestApplication, db: PrismaService, engine: WorkflowAdministrativeInvalidationService, rounds: WorkflowClosureRoundService;
  let admin: Awaited<ReturnType<typeof createWorkflowClosureFixture>>;
  const impact = (organizationId: string, userId: string): AdministrativeLifecycleImpact => ({
    kind: 'USER', entityId: userId, organizationId, receiptOrganizationId: admin.org.id,
    userIds: [userId], departmentIds: [], positionIds: [], organizationIds: [],
  });
  const apply = (input: AdministrativeLifecycleImpact) => db.$transaction(tx => engine.apply(tx, admin.owner.actor, input), { isolationLevel: 'ReadCommitted', timeout: 30_000 });
  beforeAll(async () => {
    app = (await Test.createTestingModule({ imports: [AppModule] }).compile()).createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init(); db = app.get(PrismaService); rounds = app.get(WorkflowClosureRoundService);
    engine = new WorkflowAdministrativeInvalidationService(new AdministrativeLifecycleRegistry(), app.get(WorkflowClosureRegistry),
      app.get(ProblemIndexService), app.get(AuditLogService), app.get(OutboxService));
    admin = await createWorkflowClosureFixture(db, rounds);
    await db.rolePermission.create({ data: { roleId: admin.role.id,
      permissionId: (await db.permission.findUniqueOrThrow({ where: { code: 'platform:admin' } })).id } });
  }, 120_000);
  afterAll(() => app?.close());

  it.each([['DEPARTMENT', 'SQE'], ['DEPARTMENT', 'MANAGER'], ['ORGANIZATION', 'SQE']] as const)('preserves supplier requests with unrelated %s appointments, but cancels the actual %s source', async (kind, source) => {
    const f = await supplierEightDFixture(app, 'HIGH', false, 'INTERNAL');
    const unrelated = await db.department.create({ data: { organizationId: f.f.org.id, code: randomUUID(), name: 'Unrelated A' } });
    const position = await db.position.create({ data: { organizationId: f.f.org.id, departmentId: unrelated.id, code: randomUUID(), name: 'A appointment' } });
    for (const userId of [f.outsider.actor.id, f.sqe.actor.id, f.manager.actor.id]) {
      await db.userPosition.create({ data: { organizationId: f.f.org.id, userId, positionId: position.id } });
    }
    await db.$executeRaw`INSERT INTO department_management_bindings
      (id,organization_id,department_id,responsibility,position_id,status,created_by,updated_by)
      VALUES (${randomUUID()}::uuid,${f.f.org.id}::uuid,${f.f.section.id}::uuid,'SECTION_MANAGER',${position.id}::uuid,'DISABLED',
      ${f.sqe.actor.id}::uuid,${f.sqe.actor.id}::uuid)`;
    let row = await f.read();
    row = (await f.http(f.sqe.cookie, 'put', `${f.prefix}/deadlines`, { ...f.version(row), analysisDueAt: '2026-10-01T00:00:00Z' }).expect(200)).body;
    const pending = (await f.http(f.outsider.cookie, 'post', `${f.prefix}/deadline-extensions`, { ...f.version(row), expectedContentVersion: row.contentVersion,
      stage: 'ANALYSIS', requestedDueAt: '2026-12-01T00:00:00Z', reason: 'Internal applicant in surviving B' }).expect(201)).body;
    const progressed = (await f.http(f.sqe.cookie, 'post', `${f.prefix}/deadline-extensions/${pending.id}/decide`, {
      expectedVersion: pending.version, duty: 'SQE', decision: 'APPROVE', comment: 'Keep the actual SQE opinion' }).expect(200)).body;
    const decisions = await db.$queryRaw`SELECT * FROM supplier_eight_d_deadline_decisions WHERE request_id=${pending.id}::uuid`;
    const before = await db.$queryRaw`SELECT * FROM supplier_eight_d_deadline_requests WHERE id=${pending.id}::uuid`;
    const controlBefore = await db.$queryRaw`SELECT * FROM supplier_eight_d_controls WHERE supplier_problem_id=${f.draft.id}::uuid`;
    const input: AdministrativeLifecycleImpact = { ...impact(f.f.org.id, f.outsider.actor.id), kind, entityId: unrelated.id,
      userIds: [f.outsider.actor.id, f.sqe.actor.id, f.manager.actor.id],
      departmentIds: [unrelated.id], positionIds: [position.id], organizationIds: kind === 'ORGANIZATION' ? [admin.org.id] : [] };
    expect(await apply(input)).toEqual({ module: 'workflow', changed: 0, pendingConfiguration: 0 });
    expect(await db.$queryRaw`SELECT * FROM supplier_eight_d_deadline_requests WHERE id=${pending.id}::uuid`).toEqual(before);
    expect(await db.$queryRaw`SELECT * FROM supplier_eight_d_controls WHERE supplier_problem_id=${f.draft.id}::uuid`).toEqual(controlBefore);
    // Only the actual saved SQE or section-manager source qualifies, not their unrelated A appointments.
    const sourcePosition = source === 'SQE' ? f.f.owner.position.id : f.f.manager.position.id;
    expect(await apply({ ...input, kind: 'DEPARTMENT', organizationIds: [], departmentIds: [], positionIds: [sourcePosition] })).toMatchObject({ changed: 1 });
    expect(await db.$queryRaw`SELECT status,version FROM supplier_eight_d_deadline_requests WHERE id=${pending.id}::uuid`)
      .toEqual([{ status: 'CANCELLED', version: progressed.version + 1 }]);
    expect(await db.$queryRaw`SELECT * FROM supplier_eight_d_deadline_decisions WHERE request_id=${pending.id}::uuid`).toEqual(decisions);
    await f.http(f.sqe.cookie, 'post', `${f.prefix}/deadline-extensions/${pending.id}/decide`, {
      expectedVersion: pending.version, duty: 'SQE', decision: 'APPROVE', comment: 'Late decision' }).expect(409);
  }, 30_000);

  it('cancels a supplier request whose applicant becomes unavailable without matching an unrelated saved management source', async () => {
    const f = await supplierEightDFixture(app, 'HIGH', false, 'INTERNAL');
    let row = await f.read();
    row = (await f.http(f.sqe.cookie, 'put', `${f.prefix}/deadlines`, { ...f.version(row), analysisDueAt: '2026-10-01T00:00:00Z' }).expect(200)).body;
    const pending = (await f.http(f.outsider.cookie, 'post', `${f.prefix}/deadline-extensions`, { ...f.version(row), expectedContentVersion: row.contentVersion,
      stage: 'ANALYSIS', requestedDueAt: '2026-12-01T00:00:00Z', reason: 'Applicant loses their final appointment' }).expect(201)).body;
    const input = { ...impact(f.f.org.id, f.outsider.actor.id), kind: 'DEPARTMENT' as const, entityId: randomUUID(), unavailableUserIds: [f.outsider.actor.id] };
    expect(await apply(input)).toMatchObject({ changed: 1 });
    expect(await db.$queryRaw`SELECT status FROM supplier_eight_d_deadline_requests WHERE id=${pending.id}::uuid`).toEqual([{ status: 'CANCELLED' }]);
    expect(await db.supplierResponseRevision.count({ where: { problemId: f.draft.id } })).toBe(0);
  }, 30_000);

  it('actual department force deletion cancels A but preserves same-user B round, duties, deadline and domain versions', async () => {
    const f = await createWorkflowClosureFixture(db, rounds), domain = INTERNAL_EIGHT_D_DOMAINS.PROCESS, tables = internalEightDSql(domain);
    const a = await db.department.create({ data: { organizationId: f.org.id, parentId: f.dept.id, code: randomUUID(), name: 'Sibling A' } });
    const position = await db.position.create({ data: { organizationId: f.org.id, departmentId: a.id, code: randomUUID(), name: 'Same manager in A' } });
    const assignmentA = await db.userPosition.create({ data: { organizationId: f.org.id, userId: f.manager.user.id, positionId: position.id } });
    const ownerA = await f.person(a.id);
    await db.$executeRaw`INSERT INTO department_management_bindings (id,organization_id,department_id,responsibility,position_id,created_by,updated_by)
      VALUES (${randomUUID()}::uuid,${f.org.id}::uuid,${a.id}::uuid,'SECTION_MANAGER',${position.id}::uuid,${f.owner.user.id}::uuid,${f.owner.user.id}::uuid)`;
    for (const code of [`${domain.permissionPrefix}:read`, `${domain.permissionPrefix}:work`]) await db.rolePermission.create({ data: {
      roleId: f.role.id, permissionId: (await db.permission.findUniqueOrThrow({ where: { code } })).id } });
    await db.workflowNode.update({ where: { id: f.node.id }, data: { config: { closureReview: { schemaVersion: 1, policy: 'INTERNAL', domainCode: domain.domainCode } } } });
    const ownerNode = await db.workflowNode.create({ data: { organizationId: f.org.id, workflowVersionId: f.instance.workflowVersionId,
      nodeKey: 'owner', name: 'Handling', type: 'ACTION', config: { isStart: true,
        processEightD: { schemaVersion: 1, extensionPolicy: 'LEADER_THEN_PROFESSIONAL', reminderEveryHours: 24 } } } });
    await db.workflowTransition.create({ data: { organizationId: f.org.id, workflowVersionId: f.instance.workflowVersionId,
      fromNodeId: f.node.id, toNodeId: ownerNode.id, action: 'RETURN', transitionKey: 'return-owner' } });
    await db.problemIndex.update({ where: { id: f.problem.id }, data: { domainCode: domain.domainCode, sourceType: domain.sourceType, problemType: 'EIGHT_D' } });
    const problemA = await db.problemIndex.create({ data: { organizationId: f.org.id, reportNumber: randomUUID(), domainCode: domain.domainCode,
      problemType: 'EIGHT_D', sourceType: domain.sourceType, severity: 'LOW', ownerId: ownerA.user.id } });
    const instanceA = await db.workflowInstance.create({ data: { organizationId: f.org.id, problemIndexId: problemA.id,
      workflowDefinitionId: f.instance.workflowDefinitionId, workflowVersionId: f.instance.workflowVersionId, instanceKey: randomUUID(), currentNodeId: f.node.id } });
    await db.problemIndex.update({ where: { id: problemA.id }, data: { workflowInstanceId: instanceA.id } });
    for (const [problemId, sectionId] of [[f.problem.id, f.section.id], [problemA.id, a.id]]) {
      await db.$executeRaw`INSERT INTO ${tables.reports} (problem_id,organization_id,responsible_section_department_id,professional_user_id,document,submitted_at,created_by,updated_by)
        VALUES (${problemId}::uuid,${f.org.id}::uuid,${sectionId}::uuid,${f.professional.user.id}::uuid,
        ${JSON.stringify(emptyProcessEightDDocument())}::jsonb,CURRENT_TIMESTAMP,${f.professional.user.id}::uuid,${f.professional.user.id}::uuid)`;
    }
    const roundA = await rounds.start(ownerA.actor, problemA.id, { expectedContentVersion: 1, expectedInstanceVersion: 1 }, randomUUID(), randomUUID());
    const b = await rounds.start(f.owner.actor, f.problem.id, { expectedContentVersion: 1, expectedInstanceVersion: 1 }, randomUUID(), randomUUID());
    const roundB = await rounds.decide(f.professional.actor, b.id, { expectedRoundVersion: b.version, duties: ['PROFESSIONAL'], decision: 'APPROVE', comment: 'Retained approval' }, randomUUID(), randomUUID());
    await db.$executeRaw`UPDATE workflow_closure_rounds SET created_by=${f.manager.user.id}::uuid WHERE id=${roundB.id}::uuid`;
    const deadlineId = randomUUID();
    await db.$executeRaw`INSERT INTO workflow_deadline_extensions
      (id,organization_id,problem_id,workflow_version_id,stage,original_due_at,requested_due_at,originally_overdue,reason,applicant_user_id,context,participants,status,history)
      VALUES (${deadlineId}::uuid,${f.org.id}::uuid,${f.problem.id}::uuid,${f.instance.workflowVersionId}::uuid,'ANALYSIS',CURRENT_TIMESTAMP,
      CURRENT_TIMESTAMP + INTERVAL '1 day',false,'B applicant also appointed in A',${f.manager.user.id}::uuid,${JSON.stringify(roundB.context)}::jsonb,
      ${JSON.stringify({ leader: roundB.duties[1]!.participant, professional: roundB.duties[0]!.participant })}::jsonb,'QUALITY_PENDING','[]'::jsonb)`;
    const beforeB = await rounds.readProjection(db, f.org.id, f.problem.id);
    const beforeDeadline = await db.$queryRaw`SELECT * FROM workflow_deadline_extensions WHERE id=${deadlineId}::uuid`;
    const beforeDomain = await db.$queryRaw`SELECT * FROM ${tables.reports} WHERE problem_id=${f.problem.id}::uuid`;
    const beforeInstance = await db.workflowInstance.findUniqueOrThrow({ where: { id: f.instance.id } });
    const projectA = randomUUID(), projectB = randomUUID();
    for (const [projectId, assignmentId] of [[projectA, assignmentA.id], [projectB, f.manager.assignment.id]]) {
      await db.$executeRaw`INSERT INTO component_project_records
        (id,organization_id,code,name,stage,customer_engineer_assignment_id,project_engineer_assignment_id,created_by_user_id,updated_by_user_id,updated_at)
        VALUES (${projectId}::uuid,${f.org.id}::uuid,${projectId},'Saved engineer suggestion','MASS_PRODUCTION',${assignmentId}::uuid,${assignmentId}::uuid,
        ${f.owner.user.id}::uuid,${f.owner.user.id}::uuid,CURRENT_TIMESTAMP)`;
    }
    const beforeProjectB = await db.$queryRaw`SELECT * FROM component_project_records WHERE id=${projectB}::uuid`;
    const token = await app.get(SessionService).create(admin.owner.user.id, db, { mfaVerified: true, reauthenticated: true });
    const session = (await app.get(SessionService).resolve(token))!;
    const actor = { ...admin.owner.actor, sessionId: session.id };
    const commands = app.get(OrganizationForceDeleteService), preview = await commands.previewDepartment(actor, f.org.id, a.id);
    const result = await commands.forceDeleteDepartment(actor, f.org.id, a.id, { expectedVersion: preview.version, previewToken: preview.previewToken, confirmed: true }, randomUUID(), randomUUID());
    expect(result.effects.find(effect => effect.module === 'workflow')).toMatchObject({ changed: 1, pendingConfiguration: 1 });
    expect((await rounds.readProjection(db, f.org.id, problemA.id))!.status).toBe('CANCELLED');
    expect(await rounds.readProjection(db, f.org.id, f.problem.id)).toEqual(beforeB);
    expect(await db.$queryRaw`SELECT * FROM workflow_deadline_extensions WHERE id=${deadlineId}::uuid`).toEqual(beforeDeadline);
    expect(await db.$queryRaw`SELECT * FROM ${tables.reports} WHERE problem_id=${f.problem.id}::uuid`).toEqual(beforeDomain);
    expect(await db.workflowInstance.findUniqueOrThrow({ where: { id: f.instance.id } })).toEqual(beforeInstance);
    expect(await db.$queryRaw`SELECT * FROM component_project_records WHERE id=${projectB}::uuid`).toEqual(beforeProjectB);
    expect(await db.$queryRaw`SELECT customer_engineer_assignment_id,project_engineer_assignment_id FROM component_project_records WHERE id=${projectA}::uuid`)
      .toEqual([{ customer_engineer_assignment_id: null, project_engineer_assignment_id: null }]);
    expect(await db.$queryRaw`SELECT impact->'userIds' AS users FROM administrative_deletions WHERE entity_id=${a.id}::uuid`)
      .toEqual([{ users: expect.arrayContaining([f.manager.user.id, ownerA.user.id]) }]);
    const managerToken = await app.get(SessionService).create(f.manager.user.id, db, { mfaVerified: true, reauthenticated: true });
    const managerSession = (await app.get(SessionService).resolve(managerToken))!;
    await expect(rounds.decide({ ...f.manager.actor, sessionId: managerSession.id }, roundA.id, { expectedRoundVersion: roundA.version, duties: ['SECTION_MANAGER'], decision: 'APPROVE', comment: 'Late A' }, randomUUID(), randomUUID()))
      .rejects.toMatchObject({ status: 409 });
  }, 30_000);

  it.each(Object.values(INTERNAL_EIGHT_D_DOMAINS).flatMap(domain => ['DIRECT', 'CHILD_ONLY', 'PARENT_AND_CHILD'].map(appointment => ({ ...domain, appointment, domain }))))('$domainCode cancels a submitted review when the professional loses $appointment appointments', async ({ domain, appointment }) => {
    const f = await createWorkflowClosureFixture(db, rounds), tables = internalEightDSql(domain);
    for (const code of [`${domain.permissionPrefix}:read`, `${domain.permissionPrefix}:work`, `${domain.permissionPrefix}:issue`]) {
      await db.rolePermission.create({ data: { roleId: f.role.id, permissionId: (await db.permission.findUniqueOrThrow({ where: { code } })).id } });
    }
    const removed = await db.department.create({ data: { organizationId: f.org.id, code: randomUUID(), name: 'Only professional appointment' } });
    const detached = appointment === 'DIRECT' ? removed : await db.department.create({ data: { organizationId: f.org.id, parentId: removed.id, code: randomUUID(), name: 'Detached child professional appointment' } });
    await db.position.update({ where: { id: f.professional.position.id }, data: { departmentId: detached.id } });
    if (appointment === 'PARENT_AND_CHILD') {
      const position = await db.position.create({ data: { organizationId: f.org.id, departmentId: removed.id, code: randomUUID(), name: 'Additional parent appointment' } });
      await db.userPosition.create({ data: { organizationId: f.org.id, userId: f.professional.user.id, positionId: position.id, startedAt: new Date(Date.now() - 60_000) } });
    }
    await db.problemIndex.update({ where: { id: f.problem.id }, data: { domainCode: domain.domainCode, sourceType: domain.sourceType, problemType: 'EIGHT_D' } });
    await db.workflowNode.update({ where: { id: f.node.id }, data: { config: { closureReview: { schemaVersion: 1, policy: 'INTERNAL', domainCode: domain.domainCode } } } });
    const ownerNode = await db.workflowNode.create({ data: { organizationId: f.org.id, workflowVersionId: f.instance.workflowVersionId,
      nodeKey: 'owner', name: 'Actual owner handling', type: 'ACTION', config: { isStart: true, processEightD: { schemaVersion: 1, extensionPolicy: 'LEADER_THEN_PROFESSIONAL', reminderEveryHours: 24 } } } });
    await db.workflowTransition.create({ data: { organizationId: f.org.id, workflowVersionId: f.instance.workflowVersionId,
      fromNodeId: f.node.id, toNodeId: ownerNode.id, action: 'RETURN', transitionKey: 'return-owner' } });
    await db.$executeRaw`INSERT INTO ${tables.reports} (problem_id,organization_id,responsible_section_department_id,professional_user_id,document,submitted_at,created_by,updated_by)
      VALUES (${f.problem.id}::uuid,${f.org.id}::uuid,${f.section.id}::uuid,${f.professional.user.id}::uuid,
      ${JSON.stringify(emptyProcessEightDDocument())}::jsonb,CURRENT_TIMESTAMP,${f.professional.user.id}::uuid,${f.professional.user.id}::uuid)`;
    const round = await rounds.start(f.owner.actor, f.problem.id, { expectedContentVersion: 1, expectedInstanceVersion: 1 }, randomUUID(), randomUUID());
    const approved = await rounds.decide(f.manager.actor, round.id, { expectedRoundVersion: round.version, duties: ['SECTION_MANAGER'], decision: 'APPROVE', comment: 'Preserve actual manager opinion' }, randomUUID(), randomUUID());
    expect(approved.duties.find(duty => duty.duty === 'PROFESSIONAL')!.participant).toMatchObject({ departmentId: null, positionId: null });
    const token = await app.get(SessionService).create(admin.owner.user.id, db, { mfaVerified: true, reauthenticated: true });
    const session = (await app.get(SessionService).resolve(token))!, actor = { ...admin.owner.actor, sessionId: session.id };
    const commands = app.get(OrganizationForceDeleteService), preview = await commands.previewDepartment(actor, f.org.id, removed.id);
    await commands.forceDeleteDepartment(actor, f.org.id, removed.id, { expectedVersion: preview.version, previewToken: preview.previewToken, confirmed: true }, randomUUID(), randomUUID());
    expect((await rounds.readProjection(db, f.org.id, f.problem.id))!.status).toBe('CANCELLED');
    expect((await rounds.readProjection(db, f.org.id, f.problem.id))!.duties.find(duty => duty.duty === 'SECTION_MANAGER')).toMatchObject({ status: 'APPROVED', comment: 'Preserve actual manager opinion' });
    expect(await db.user.findUniqueOrThrow({ where: { id: f.professional.user.id } })).toMatchObject({ status: 'DISABLED', configurationRequired: true });
    expect(await db.user.findUniqueOrThrow({ where: { id: f.manager.user.id } })).toMatchObject({ status: 'ACTIVE', configurationRequired: false });
    const [report] = await db.$queryRaw<{ version: number; submitted_at: Date | null }[]>`SELECT version,submitted_at FROM ${tables.reports} WHERE problem_id=${f.problem.id}::uuid`;
    expect(report!.submitted_at).toBeNull();
    const domainKey = domain === INTERNAL_EIGHT_D_DOMAINS.PROCESS ? AdministrativeProblemDomain.PROCESS : domain === INTERNAL_EIGHT_D_DOMAINS.CUSTOMER ? AdministrativeProblemDomain.CUSTOMER : AdministrativeProblemDomain.NEW_PRODUCT;
    const recovery = app.get(AdministrativeProblemReconfigurationService);
    const pending = await recovery.pending(actor, domainKey, { pageSize: 100, offset: 0 });
    expect(pending.items.some(item => item.problemId === f.problem.id)).toBe(true);
    await recovery.reconfigure(actor, domainKey, f.problem.id, { expectedVersion: report!.version, professionalAssignmentId: f.manager.assignment.id }, randomUUID(), randomUUID());
    expect(await db.$queryRaw`SELECT professional_user_id FROM ${tables.reports} WHERE problem_id=${f.problem.id}::uuid`)
      .toEqual([{ professional_user_id: f.manager.user.id }]);
    await expect(rounds.decide(f.professional.actor, round.id, { expectedRoundVersion: approved.version, duties: ['PROFESSIONAL'], decision: 'APPROVE', comment: 'Late old factor' }, randomUUID(), randomUUID())).rejects.toMatchObject({ status: 401 });
  }, 30_000);

  it.each(Object.values(INTERNAL_EIGHT_D_DOMAINS))('$domainCode unwinds its actual submitted report with a real cross-organization platform actor', async domain => {
    const f = await createWorkflowClosureFixture(db, rounds), tables = internalEightDSql(domain);
    for (const code of [`${domain.permissionPrefix}:read`, `${domain.permissionPrefix}:work`]) {
      await db.rolePermission.create({ data: { roleId: f.role.id, permissionId: (await db.permission.findUniqueOrThrow({ where: { code } })).id } });
    }
    await db.problemIndex.update({ where: { id: f.problem.id }, data: { domainCode: domain.domainCode, sourceType: domain.sourceType, problemType: 'EIGHT_D' } });
    await db.workflowNode.update({ where: { id: f.node.id }, data: { config: { closureReview: { schemaVersion: 1, policy: 'INTERNAL', domainCode: domain.domainCode } } } });
    const ownerNode = await db.workflowNode.create({ data: { organizationId: f.org.id, workflowVersionId: f.instance.workflowVersionId,
      nodeKey: 'owner', name: 'Actual owner handling', type: 'ACTION', config: { isStart: true, processEightD: { schemaVersion: 1, extensionPolicy: 'LEADER_THEN_PROFESSIONAL', reminderEveryHours: 24 } } } });
    await db.workflowTransition.create({ data: { organizationId: f.org.id, workflowVersionId: f.instance.workflowVersionId,
      fromNodeId: f.node.id, toNodeId: ownerNode.id, action: 'RETURN', transitionKey: 'return-owner' } });
    await db.$executeRaw`INSERT INTO ${tables.reports} (problem_id,organization_id,responsible_section_department_id,professional_user_id,document,submitted_at,created_by,updated_by)
      VALUES (${f.problem.id}::uuid,${f.org.id}::uuid,${f.section.id}::uuid,${f.professional.user.id}::uuid,
      ${JSON.stringify(emptyProcessEightDDocument())}::jsonb,CURRENT_TIMESTAMP,${f.professional.user.id}::uuid,${f.professional.user.id}::uuid)`;
    const r = await rounds.start(f.owner.actor, f.problem.id, { expectedContentVersion: 1, expectedInstanceVersion: 1 }, randomUUID(), randomUUID());
    await expect(db.$transaction(tx => engine.apply(tx, f.owner.actor, impact(f.org.id, f.manager.user.id)), { isolationLevel: 'ReadCommitted' }))
      .rejects.toMatchObject({ status: 403 });
    expect((await rounds.readProjection(db, f.org.id, f.problem.id))!.status).toBe('PENDING');
    await expect(apply(impact(f.org.id, f.manager.user.id))).resolves.toMatchObject({ changed: 1 });
    expect(await db.$queryRaw(Prisma.sql`SELECT submitted_at,version,updated_by FROM ${tables.reports} WHERE problem_id=${f.problem.id}::uuid`))
      .toEqual([{ submitted_at: null, version: 2, updated_by: admin.owner.user.id }]);
    expect(await db.workflowInstance.findUniqueOrThrow({ where: { id: f.instance.id } })).toMatchObject({ currentNodeId: ownerNode.id, version: 2, updatedById: admin.owner.user.id });
    await expect(rounds.decide(f.manager.actor, r.id, { expectedRoundVersion: r.version, duties: ['SECTION_MANAGER'], decision: 'APPROVE', comment: 'Late' }, randomUUID(), randomUUID()))
      .rejects.toMatchObject({ status: 409 });
  }, 30_000);

  it('discovers and precisely cancels supplier-only pending requests without claiming the real applicant duty', async () => {
    const f = await supplierEightDFixture(app, 'HIGH');
    let row = await f.read();
    row = (await f.http(f.sqe.cookie, 'put', `${f.prefix}/deadlines`, { ...f.version(row), analysisDueAt: '2026-10-01T00:00:00Z', closureDueAt: '2026-11-01T00:00:00Z' }).expect(200)).body;
    const preview = (await f.http(f.sqe.cookie, 'post', `${f.prefix}/disclosure-preview`, { expectedRowVersion: row.rowVersion, selectedFileIds: [] }).expect(200)).body;
    await f.http(f.sqe.cookie, 'post', `${f.prefix}/release`, { expectedRowVersion: preview.rowVersion, previewToken: preview.previewToken, confirmed: true, selectedFileIds: [] }).expect(200);
    row = await f.read();
    const pending = (await f.http(f.vendor.cookie, 'post', `${f.portal}/deadline-extensions`, { ...f.version(row), expectedContentVersion: row.contentVersion,
      stage: 'ANALYSIS', requestedDueAt: '2026-12-01T00:00:00Z', reason: 'Actual applicant needs time' }).expect(201)).body;
    const progressed = (await f.http(f.sqe.cookie, 'post', `${f.prefix}/deadline-extensions/${pending.id}/decide`, {
      expectedVersion: pending.version, duty: 'SQE', decision: 'APPROVE', comment: 'Actual SQE approval before identity deletion',
    }).expect(200)).body;
    const decisionsBefore = await db.$queryRaw`SELECT * FROM supplier_eight_d_deadline_decisions WHERE request_id=${pending.id}::uuid`;
    const otherUser = await db.user.create({ data: { organizationId: f.vendor.org.id, username: randomUUID(), passwordHash: 'unused', accountType: 'SUPPLIER',
      userRoles: { create: { organizationId: f.vendor.org.id, roleId: f.vendor.role.id } } } });
    const otherToken = await app.get(SessionService).create(otherUser.id, db, { mfaVerified: true, reauthenticated: true });
    const unrelated = (await f.http(`qms_session=${otherToken}`, 'post', `${f.portal}/deadline-extensions`, { ...f.version(row), expectedContentVersion: row.contentVersion,
      stage: 'CLOSURE', requestedDueAt: '2026-12-01T00:00:00Z', reason: 'Different actual applicant on the same case' }).expect(201)).body;
    const unrelatedBefore = await db.$queryRaw`SELECT * FROM supplier_eight_d_deadline_requests WHERE id=${unrelated.id}::uuid`;
    expect(await apply(impact(f.f.org.id, f.vendor.user.id))).toMatchObject({ changed: 1 });
    expect(await f.db.$queryRaw`SELECT status,version FROM supplier_eight_d_deadline_requests WHERE id=${pending.id}::uuid`).toEqual([{ status: 'CANCELLED', version: progressed.version + 1 }]);
    expect(await f.db.$queryRaw`SELECT * FROM supplier_eight_d_deadline_decisions WHERE request_id=${pending.id}::uuid`).toEqual(decisionsBefore);
    expect(await db.$queryRaw`SELECT * FROM supplier_eight_d_deadline_requests WHERE id=${unrelated.id}::uuid`).toEqual(unrelatedBefore);
    expect((await f.read()).analysisDueAt).toBe('2026-10-01T00:00:00.000Z');
    await f.http(f.sqe.cookie, 'post', `${f.prefix}/deadline-extensions/${pending.id}/decide`, { expectedVersion: pending.version, duty: 'SQE', decision: 'APPROVE', comment: 'Late' }).expect(409);
  }, 30_000);

  it('returns a submitted supplier report to handling without synthesizing an SQE or rewriting its immutable response', async () => {
    const f = await supplierEightDFixture(app, 'LOW', false, 'INTERNAL');
    let row = await f.read();
    row = (await f.http(f.outsider.cookie, 'put', f.prefix, { ...f.version(row), document: supplierEightDDocument() }).expect(200)).body;
    row = (await f.http(f.outsider.cookie, 'post', `${f.prefix}/analysis-complete`, { ...f.version(row), submissionDueAt: '2026-11-03T00:00:00Z' }).expect(201)).body;
    row = (await f.http(f.outsider.cookie, 'post', `${f.prefix}/submit`, f.version(row)).expect(201)).body;
    const revision = await db.supplierResponseRevision.findUniqueOrThrow({ where: { id: row.submittedRevisionId } });
    expect(await apply(impact(f.f.org.id, f.manager.actor.id))).toMatchObject({ changed: 1 });
    expect(await f.read()).toMatchObject({ submittedRevisionId: null, closedAt: null, instanceVersion: row.instanceVersion + 1 });
    expect(await db.supplierResponseRevision.findUniqueOrThrow({ where: { id: row.submittedRevisionId } })).toEqual(revision);
  }, 30_000);
});
