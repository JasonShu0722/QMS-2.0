import 'reflect-metadata';
import { createHash, randomUUID } from 'node:crypto';
import { setTimeout } from 'node:timers/promises';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Client } from 'pg';
import request from 'supertest';
import { AppModule } from '../../src/app.module.js';
import { GlobalExceptionFilter } from '../../src/common/contracts/global-exception.filter.js';
import { INTERNAL_EIGHT_D_DOMAINS, internalEightDSql } from '../../src/common/eight-d/internal-eight-d-domain.js';
import { PrismaService } from '../../src/database/prisma.service.js';
import { SessionService } from '../../src/modules/identity/session.service.js';
import { NumberingService } from '../../src/modules/problem-index/numbering.service.js';
import { ProcessEightDClosureAdapter } from '../../src/modules/process-quality/process-eight-d-closure.adapter.js';
import { emptyProcessEightDDocument } from '../../src/modules/process-quality/process-eight-d-document.js';
import { ProcessEightDReminderService } from '../../src/modules/process-quality/process-eight-d-reminder.service.js';
import { WorkflowClosureRoundService } from '../../src/modules/workflow/workflow-closure-round.service.js';
import { isDisposableLoopbackPostgres } from '../disposable-postgres.js';
import { createWorkflowClosureFixture } from '../workflow/workflow-closure-round.fixture.js';

if (process.env.QMS_DISPOSABLE_TEST_DB !== 'true' || !isDisposableLoopbackPostgres(process.env.DATABASE_URL)) {
  throw new Error('Requires disposable loopback PostgreSQL, never preview 55440.');
}

describe('REQ-0045 position deletion through the actual app and PostgreSQL', () => {
  let app: INestApplication;
  let db: PrismaService;
  let sessions: SessionService;
  const csrf = randomUUID();
  const permission = 'organization:positions:force-delete';

  beforeAll(async () => {
    app = (await Test.createTestingModule({ imports: [AppModule] }).compile()).createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init();
    db = app.get(PrismaService);
    sessions = app.get(SessionService);
  }, 120_000);
  afterAll(async () => { await app?.close(); });

  const path = (organizationId: string, positionId: string) => `/api/v1/organizations/${organizationId}/positions/${positionId}`;
  const write = (cookie: string, method: 'delete' | 'post' | 'patch' | 'put', route: string, body: object, key = randomUUID()) =>
    request(app.getHttpServer())[method](route).set('Cookie', cookie).set('x-csrf-token', csrf).set('Idempotency-Key', key).send(body);
  const get = (cookie: string, route: string) => request(app.getHttpServer()).get(route).set('Cookie', cookie);
  const cookie = (token: string) => `qms_session=${token}; qms_csrf=${csrf}`;
  const confirmation = (preview: { version: number; previewToken: string }) =>
    ({ expectedVersion: preview.version, previewToken: preview.previewToken, confirmed: true });

  async function organization(parentId?: string) {
    return db.organization.create({ data: { code: randomUUID(), name: 'Position deletion organization', type: 'INTERNAL', parentId } });
  }
  async function position(organizationId: string, name = 'Position to remove') {
    return db.position.create({ data: { organizationId, code: randomUUID(), name } });
  }
  async function person(organizationId: string, fullName: string) {
    return db.user.create({ data: { organizationId, username: randomUUID(), fullName, accountType: 'INTERNAL', passwordHash: 'fixture-only' } });
  }
  async function role(organizationId: string, code: string) {
    const entry = await db.permission.findUniqueOrThrow({ where: { code } });
    return db.role.create({ data: { organizationId, code: randomUUID(), name: 'Position deletion role', permissions: { create: { permissionId: entry.id } } } });
  }
  async function appoint(organizationId: string, userId: string, positionId: string) {
    return db.userPosition.create({ data: { organizationId, userId, positionId, startedAt: new Date(Date.now() - 60_000) } });
  }
  async function fixture() {
    const home = await organization();
    const target = await organization(home.id);
    const actor = await person(home.id, 'Platform administrator');
    const marker = await role(home.id, 'platform:admin');
    await db.userRole.create({ data: { organizationId: home.id, userId: actor.id, roleId: marker.id } });
    const admin = cookie(await sessions.create(actor.id, db, { mfaVerified: true, reauthenticated: true }));
    return { home, target, actor, admin };
  }

  it('ordinary deletion tombstones an unused position, supports exact replay, and blocks appointment or configuration references', async () => {
    const { admin, target, actor } = await fixture();
    const unused = await position(target.id);
    const used = await position(target.id);
    const configured = await position(target.id);
    const member = await person(target.id, 'Referenced member');
    await appoint(target.id, member.id, used.id);
    const boards = JSON.stringify({ REGISTRATION: [configured.id] });
    await db.$executeRaw`INSERT INTO process_ledger_workflow_configuration_revisions (organization_id, version, boards, updated_by_id)
      VALUES (${target.id}::uuid, 1, ${boards}::jsonb, ${actor.id}::uuid)`;
    const key = randomUUID();
    const route = path(target.id, unused.id);
    const body = { expectedVersion: unused.version };
    for (const reference of [used, configured]) {
      const blocked = await write(admin, 'delete', path(target.id, reference.id), { expectedVersion: reference.version }).expect(409);
      expect(blocked.body.code).toBe('STRUCTURE_REFERENCE_INVALID');
    }
    const response = await write(admin, 'delete', route, body, key).expect(200);
    expect(response.body).toEqual({ id: unused.id, deleted: true });
    expect((await write(admin, 'delete', route, body, key).expect(200)).body).toEqual(response.body);
    await write(admin, 'delete', route, body).expect(404);
    await write(admin, 'patch', route, { expectedVersion: unused.version + 1, name: 'Cannot revive' }).expect(404);
    expect(await db.position.findUniqueOrThrow({ where: { id: unused.id } })).toMatchObject({ status: 'DISABLED', deletedAt: expect.any(Date) });
    expect(await db.auditEvent.count({ where: { resourceId: unused.id, action: 'POSITION_DELETED' } })).toBe(1);
  });

  it('revalidates preview, revokes just target appointments, keeps other access, and preserves configuration and history', async () => {
    const { admin, target, home, actor } = await fixture();
    const removed = await position(target.id, 'admin');
    const survivor = await position(target.id, 'Other effective position');
    const single = await person(target.id, 'Single position');
    const multi = await person(target.id, 'Multiple positions');
    const singleAssignment = await appoint(target.id, single.id, removed.id);
    const multiAssignment = await appoint(target.id, multi.id, removed.id);
    const survivingAssignment = await appoint(target.id, multi.id, survivor.id);
    const history = await db.userPosition.create({ data: { organizationId: target.id, userId: multi.id, positionId: removed.id,
      startedAt: new Date(Date.now() - 180_000), endedAt: new Date(Date.now() - 120_000) } });
    const read = await role(target.id, 'organization:read');
    const deletedRole = await role(target.id, 'organization:structure:read');
    await db.positionRole.create({ data: { organizationId: target.id, positionId: survivor.id, roleId: read.id } });
    await db.positionRole.create({ data: { organizationId: target.id, positionId: removed.id, roleId: deletedRole.id } });
    const member = cookie(await sessions.create(multi.id, db, { mfaVerified: true }));
    const route = `${path(target.id, removed.id)}/force-delete`;
    const directory = `/api/v1/organizations/${target.id}/positions`;
    await get(member, directory).expect(200);
    await get(member, route).expect(403);
    await get(admin, `${path(home.id, removed.id)}/force-delete`).expect(404);
    const first = (await get(admin, route).expect(200)).body;
    const context = await get(admin, `/api/v1/admin/organizations/context?organizationId=${target.id}`).expect(200);
    expect(context.body.permissions).toContain(permission);
    expect(first).toMatchObject({ kind: 'POSITION', counts: { users: 2, assignments: 2, positions: 1, departments: 0 } });
    const boards = { REGISTRATION: [removed.id] };
    const stages = { ISSUE: [removed.id] };
    await db.$executeRaw`INSERT INTO process_ledger_workflow_configuration_revisions (organization_id, version, boards, updated_by_id)
      VALUES (${target.id}::uuid, 1, ${JSON.stringify(boards)}::jsonb, ${actor.id}::uuid)`;
    await db.$executeRaw`INSERT INTO process_eight_d_workflow_configuration_revisions (organization_id, version, stages, updated_by_id)
      VALUES (${target.id}::uuid, 1, ${JSON.stringify(stages)}::jsonb, ${actor.id}::uuid)`;
    const key = randomUUID();
    const stale = await write(admin, 'post', route, confirmation(first), key).expect(409);
    expect(stale.body.code).toBe('CONCURRENCY_CONFLICT');
    expect(await db.adminMutation.count({ where: { key } })).toBe(0);
    const preview = (await get(admin, route).expect(200)).body;
    expect(preview.positionImpact).toMatchObject({ users: expect.arrayContaining([
      { id: single.id, name: single.fullName, pendingConfiguration: true },
      { id: multi.id, name: multi.fullName, pendingConfiguration: false },
    ]), responsibilities: [], configurations: [{ source: 'PROCESS_EIGHT_D', count: 1 }, { source: 'PROCESS_LEDGER', count: 1 }] });
    const [result, concurrent] = await Promise.all([write(admin, 'post', route, confirmation(preview), key).expect(201),
      write(admin, 'post', route, confirmation(preview), key).expect(201)]);
    expect(concurrent.body).toEqual(result.body);
    expect(result.body.effects).toContainEqual({ module: 'identity', changed: 2, pendingConfiguration: 1 });
    expect((await write(admin, 'post', route, confirmation(preview), key).expect(201)).body).toEqual(result.body);
    await get(admin, route).expect(404);
    await get(member, '/api/v1/organizations/current').expect(401);
    const freshMember = cookie(await sessions.create(multi.id, db, { mfaVerified: true }));
    await get(freshMember, '/api/v1/organizations/current').expect(200);
    await get(freshMember, directory).expect(403);
    expect(await db.user.findUniqueOrThrow({ where: { id: single.id } })).toMatchObject({ status: 'DISABLED', configurationRequired: true, deletedAt: null });
    expect(await db.user.findUniqueOrThrow({ where: { id: multi.id } })).toMatchObject({ status: multi.status, configurationRequired: false, credentialVersion: multi.credentialVersion });
    for (const ended of [singleAssignment, multiAssignment]) expect(await db.userPosition.findUniqueOrThrow({ where: { id: ended.id } })).toMatchObject({ positionId: removed.id, endedAt: expect.any(Date) });
    for (const preserved of [survivingAssignment, history]) expect(await db.userPosition.findUniqueOrThrow({ where: { id: preserved.id } })).toEqual(preserved);
    expect(await db.$queryRaw`SELECT boards FROM process_ledger_workflow_configuration_revisions WHERE organization_id = ${target.id}::uuid`).toEqual([{ boards }]);
    expect(await db.$queryRaw`SELECT stages FROM process_eight_d_workflow_configuration_revisions WHERE organization_id = ${target.id}::uuid`).toEqual([{ stages }]);
    expect(await db.$queryRaw`SELECT entity_kind FROM administrative_deletions WHERE entity_id = ${removed.id}::uuid`).toEqual([{ entity_kind: 'POSITION' }]);
    expect(await db.auditEvent.count({ where: { resourceId: removed.id, action: 'POSITION_FORCE_DELETED' } })).toBe(1);
    await db.userRole.deleteMany({ where: { userId: actor.id } });
    const freshFormerAdmin = cookie(await sessions.create(actor.id, db, { mfaVerified: true, reauthenticated: true }));
    await write(freshFormerAdmin, 'post', route, confirmation(preview), key).expect(403);
  });

  it('rolls back a force delete that would remove the actor’s only effective platform source', async () => {
    const home = await organization();
    const actor = await person(home.id, 'Position-based platform administrator');
    const source = await position(home.id, 'Administrator source');
    const survivor = await position(home.id);
    const assignment = await appoint(home.id, actor.id, source.id);
    await appoint(home.id, actor.id, survivor.id);
    const marker = await role(home.id, 'platform:admin');
    await db.positionRole.create({ data: { organizationId: home.id, positionId: source.id, roleId: marker.id } });
    const token = await sessions.create(actor.id, db, { mfaVerified: true, reauthenticated: true });
    const route = `${path(home.id, source.id)}/force-delete`;
    const preview = (await get(cookie(token), route).expect(200)).body;
    const key = randomUUID();
    const rejected = await write(cookie(token), 'post', route, confirmation(preview), key).expect(409);
    expect(rejected.body.code).toBe('ADMIN_SELF_LOCK_FORBIDDEN');
    expect(await db.position.findUniqueOrThrow({ where: { id: source.id } })).toEqual(source);
    expect(await db.userPosition.findUniqueOrThrow({ where: { id: assignment.id } })).toEqual(assignment);
    expect(await sessions.resolve(token)).not.toBeNull();
    expect(await db.adminMutation.count({ where: { key } })).toBe(0);
    expect(await db.$queryRaw`SELECT id FROM administrative_deletions WHERE entity_id = ${source.id}::uuid`).toEqual([]);
  });

  it('recollects appointment impact after waiting for a conflicting PostgreSQL lifecycle transaction', async () => {
    const { admin, target } = await fixture();
    const removed = await position(target.id);
    const member = await person(target.id, 'Appointment committed while waiting');
    const route = `${path(target.id, removed.id)}/force-delete`;
    const preview = (await get(admin, route).expect(200)).body;
    const blocker = new Client({ connectionString: process.env.DATABASE_URL });
    await blocker.connect();
    const key = randomUUID();
    let pending: PromiseLike<{ status: number; body: Record<string, unknown> }> | undefined;
    try {
      await blocker.query('BEGIN');
      await blocker.query("SELECT pg_advisory_xact_lock(hashtextextended('administrative-lifecycle', 0))");
      pending = write(admin, 'post', route, confirmation(preview), key).then(response => ({ status: response.status, body: response.body }));
      let waiting = false;
      const deadline = Date.now() + 2500;
      while (Date.now() < deadline && !waiting) {
        await blocker.query('SELECT pg_stat_clear_snapshot()');
        const active = await blocker.query("SELECT 1 FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid() AND wait_event = 'advisory' AND query LIKE '%administrative-lifecycle%'");
        waiting = Boolean(active.rowCount);
        if (!waiting) await setTimeout(20);
      }
      expect(waiting).toBe(true);
      const assignment = await appoint(target.id, member.id, removed.id);
      await blocker.query('COMMIT');
      expect(await pending).toMatchObject({ status: 409, body: { code: 'CONCURRENCY_CONFLICT' } });
      expect(await db.position.findUniqueOrThrow({ where: { id: removed.id } })).toEqual(removed);
      expect(await db.userPosition.findUniqueOrThrow({ where: { id: assignment.id } })).toEqual(assignment);
      expect(await db.adminMutation.count({ where: { key } })).toBe(0);
    } finally {
      await blocker.query('ROLLBACK');
      await blocker.end();
      await pending;
    }
  });

  it('blocks ordinary process 8D issuance after deleting the only issuance position and recovers with a new configuration revision', async () => {
    const { org, professional, owner, manager, section, role: workflowRole } = await createWorkflowClosureFixture(db, app.get(WorkflowClosureRoundService));
    const marker = await role(org.id, 'platform:admin');
    await db.userRole.create({ data: { organizationId: org.id, userId: professional.user.id, roleId: marker.id } });
    for (const code of ['process-quality:defects:read', 'process-quality:issues:read', 'process-quality:issues:work', 'process-quality:issues:issue', 'workflow:start']) {
      const entry = await db.permission.findUniqueOrThrow({ where: { code } });
      await db.rolePermission.create({ data: { roleId: workflowRole.id, permissionId: entry.id } });
    }
    const admin = cookie(await sessions.create(professional.user.id, db, { mfaVerified: true, reauthenticated: true }));
    await app.get(NumberingService).publishRuleVersion({ organizationId: org.id, ruleCode: 'PROBLEM', pattern: '{CODE}-{YYMM}-{SEQ3}' });
    const removed = await position(org.id, 'Only configured issuance position');
    await appoint(org.id, manager.user.id, removed.id);
    const base = '/api/v1/process-quality';
    const configuration = `${base}/eight-d-workflow-configuration`;
    const initial = [{ stage: 'ISSUE', positionIds: [removed.id] }];
    expect((await write(admin, 'put', configuration, { expectedVersion: 0, stages: initial }).expect(200)).body)
      .toMatchObject({ version: 1, missingStages: [], stages: initial });
    const revisions = () => db.$queryRaw<{ version: number; stages: Record<string, string[]> }[]>`
      SELECT * FROM process_eight_d_workflow_configuration_revisions WHERE organization_id = ${org.id}::uuid ORDER BY version`;
    const history = await revisions();
    expect(history).toEqual([expect.objectContaining({ version: 1, stages: { ISSUE: [removed.id] } })]);
    const source = (await write(admin, 'post', `${base}/defects`, {
      occurredAt: '2026-10-20T08:30:00+08:00', factoryCode: 'FACTORY_1', productCode: `HTTP-${randomUUID()}`,
      traceCode: `TRACE-${randomUUID()}`, description: '岗位删除后制程 8D 发单回归',
    }).expect(201)).body;
    const issue = {
      sources: [{ defectId: source.id, expectedVersion: source.version }], processBoardCode: '0',
      sourceConfirmations: [{ defectId: source.id, recurrence: 'NOT_RECURRENCE', relatedProblemIds: [] }],
      severity: 'LOW', responsibleSectionDepartmentId: section.id, ownerUserId: owner.user.id,
      analysisDueAt: '2026-11-01T00:00:00Z', closureDueAt: '2026-12-01T00:00:00Z',
    };

    const route = `${path(org.id, removed.id)}/force-delete`;
    const preview = (await get(admin, route).expect(200)).body;
    expect(preview.positionImpact.configurations).toContainEqual({ source: 'PROCESS_EIGHT_D', count: 1 });
    await write(admin, 'post', route, confirmation(preview)).expect(201);
    const missing = (await get(admin, configuration).expect(200)).body;
    expect(missing).toMatchObject({ version: 1, missingStages: ['ISSUE'] });
    expect(missing.positions).not.toContainEqual(expect.objectContaining({ id: removed.id }));
    expect(await revisions()).toEqual(history);
    const issuer = cookie(await sessions.create(manager.user.id, db, { mfaVerified: true, reauthenticated: true }));
    const key = randomUUID();
    const blocked = await write(issuer, 'post', `${base}/eight-d`, issue, key).expect(400);
    expect(blocked.body).toMatchObject({ code: 'PROCESS_EIGHT_D_WORKFLOW_NOT_READY', fields: { 'stages.ISSUE': expect.any(Array) } });

    const replacement = [{ stage: 'ISSUE', positionIds: [manager.position.id] }];
    expect((await write(admin, 'put', configuration, { expectedVersion: 1, stages: replacement }).expect(200)).body)
      .toMatchObject({ version: 2, missingStages: [], stages: replacement });
    const issued = await write(issuer, 'post', `${base}/eight-d`, issue, key);
    expect(issued).toMatchObject({ status: 201, body: { problem: { id: expect.any(String) }, replayed: false } });
    expect(await revisions()).toEqual([...history, expect.objectContaining({ version: 2,
      stages: { ISSUE: [manager.position.id] } })]);
  });

  it.each([
    ['LEGACY', 'PENDING_CONFIGURATION', true],
    ['LEGACY', 'LOSES_CLOSURE', true],
    ['LEGACY', 'LOSES_DEPARTMENT', true],
    ['LEGACY', 'KEEPS_CLOSURE', false],
    ['LEGACY', 'LOSES_MANAGEMENT_APPOINTMENT', false],
    ['PROCESS_MANAGED', 'LOSES_CLOSURE', false],
    ['PROCESS_MANAGED', 'LOSES_DEPARTMENT', false],
    ['PROCESS_MANAGED', 'LOSES_WORKFLOW_PERMISSION', true],
    ['PROCESS_MANAGED', 'LOSES_ISSUE_READ_PERMISSION', true],
    ['PROCESS_MANAGED', 'PENDING_CONFIGURATION', true],
    ['PROCESS_MANAGED', 'LOSES_MANAGEMENT_APPOINTMENT', false],
    ['PROCESS_MANAGED', 'ISSUER_LOSES_LAST_MANAGEMENT_APPOINTMENT', false],
  ] as const)('handles %s %s review eligibility and preserves the existing approval', async (mode, eligibility, invalidates) => {
    const { admin } = await fixture();
    const rounds = app.get(WorkflowClosureRoundService);
    const issuerLosesLastPosition = eligibility === 'ISSUER_LOSES_LAST_MANAGEMENT_APPOINTMENT';
    const losesManagement = eligibility === 'LOSES_MANAGEMENT_APPOINTMENT' || issuerLosesLastPosition;
    const fallsBack = losesManagement && mode === 'PROCESS_MANAGED';
    const flow = await createWorkflowClosureFixture(db, rounds, 'INTERNAL', fallsBack ? 'HIGH' : 'LOW');
    const affected = issuerLosesLastPosition ? flow.professional : fallsBack ? flow.minister : losesManagement ? flow.manager : flow.professional;
    const fallback = fallsBack ? await flow.person(flow.dept.id) : null;
    const domain = INTERNAL_EIGHT_D_DOMAINS.PROCESS;
    const { reports } = internalEightDSql(domain);
    const readPermission = `${domain.permissionPrefix}:read`;
    const workPermission = `${domain.permissionPrefix}:work`;
    for (const code of [readPermission, workPermission]) {
      await db.rolePermission.create({ data: { roleId: flow.role.id, permissionId: (await db.permission.findUniqueOrThrow({ where: { code } })).id } });
    }
    await db.problemIndex.update({ where: { id: flow.problem.id }, data: { domainCode: domain.domainCode, sourceType: domain.sourceType, problemType: 'EIGHT_D' } });
    await db.workflowNode.update({ where: { id: flow.node.id }, data: { config: { closureReview: { schemaVersion: 1, policy: 'INTERNAL', domainCode: domain.domainCode } } } });
    const handling = await db.workflowNode.create({ data: { organizationId: flow.org.id, workflowVersionId: flow.instance.workflowVersionId,
      nodeKey: 'owner', name: 'Handling', type: 'ACTION', config: { isStart: true, processEightD: { schemaVersion: 1, extensionPolicy: 'LEADER_THEN_PROFESSIONAL', reminderEveryHours: 24 } } } });
    await db.workflowTransition.create({ data: { organizationId: flow.org.id, workflowVersionId: flow.instance.workflowVersionId,
      fromNodeId: flow.node.id, toNodeId: handling.id, action: 'RETURN', transitionKey: 'return-owner' } });
    await db.$executeRaw`INSERT INTO ${reports} (problem_id,organization_id,responsible_section_department_id,professional_user_id,document,submitted_at,created_by,updated_by)
      VALUES (${flow.problem.id}::uuid,${flow.org.id}::uuid,${flow.section.id}::uuid,${flow.professional.user.id}::uuid,
        ${JSON.stringify(emptyProcessEightDDocument())}::jsonb,CURRENT_TIMESTAMP,${flow.professional.user.id}::uuid,${flow.professional.user.id}::uuid)`;
    if (mode === 'PROCESS_MANAGED') {
      await db.$executeRaw`INSERT INTO department_responsible_appointments (organization_id, department_id, assignment_ids, primary_assignment_id, version)
        VALUES (${flow.org.id}::uuid, ${flow.section.id}::uuid, ARRAY[${flow.manager.assignment.id}::uuid], ${flow.manager.assignment.id}::uuid, 1)`;
    }
    if (losesManagement) {
      if (fallback) {
        if (!issuerLosesLastPosition) {
          const survivor = await position(flow.org.id, 'Unlisted management appointment');
          await appoint(flow.org.id, affected.user.id, survivor.id);
        }
        const workflowAction = await role(flow.org.id, 'workflow:act');
        const reportRead = await role(flow.org.id, readPermission);
        await db.userRole.deleteMany({ where: { userId: affected.user.id } });
        await db.positionRole.create({ data: { organizationId: flow.org.id, positionId: affected.position.id, roleId: workflowAction.id } });
        await db.userRole.create({ data: { organizationId: flow.org.id, userId: affected.user.id, roleId: reportRead.id } });
        await db.$executeRaw`INSERT INTO department_responsible_appointments (organization_id, department_id, assignment_ids, primary_assignment_id, version)
          VALUES (${flow.org.id}::uuid, ${flow.dept.id}::uuid, ${[affected.assignment.id, fallback.assignment.id]}::uuid[], ${fallback.assignment.id}::uuid, 1)`;
        await db.$executeRaw`UPDATE department_minister_scopes SET department_leadership = true,
          minister_assignment_id = ${affected.assignment.id}::uuid WHERE id = ${flow.scopeId}::uuid`;
      } else {
        const end = await db.workflowNode.create({ data: { organizationId: flow.org.id, workflowVersionId: flow.instance.workflowVersionId,
          nodeKey: 'end', name: 'Closed', type: 'CLOSE', config: { isEnd: true } } });
        await db.workflowTransition.create({ data: { organizationId: flow.org.id, workflowVersionId: flow.instance.workflowVersionId,
          fromNodeId: flow.node.id, toNodeId: end.id, action: 'APPROVE', transitionKey: 'close-report' } });
      }
    } else if (eligibility !== 'PENDING_CONFIGURATION') {
      const survivor = await db.position.create({ data: { organizationId: flow.org.id, code: randomUUID(), name: 'Second professional appointment',
        departmentId: eligibility === 'LOSES_DEPARTMENT' ? null : flow.dept.id } });
      await appoint(flow.org.id, flow.professional.user.id, survivor.id);
      const lostPermission = eligibility === 'LOSES_WORKFLOW_PERMISSION' ? 'workflow:act'
        : eligibility === 'LOSES_ISSUE_READ_PERMISSION' ? readPermission : undefined;
      if (lostPermission || eligibility === 'KEEPS_CLOSURE') {
        await db.userRole.delete({ where: { userId_roleId_organizationId: { userId: flow.professional.user.id, roleId: flow.role.id, organizationId: flow.org.id } } });
        if (lostPermission) {
          for (const code of ['workflow:act', readPermission, workPermission]) {
            const grant = await role(flow.org.id, code);
            if (code === lostPermission) await db.positionRole.create({ data: { organizationId: flow.org.id, positionId: flow.professional.position.id, roleId: grant.id } });
            else await db.userRole.create({ data: { organizationId: flow.org.id, userId: flow.professional.user.id, roleId: grant.id } });
          }
        } else await db.positionRole.create({ data: { organizationId: flow.org.id, positionId: survivor.id, roleId: flow.role.id } });
      }
      const stages = { IMPLEMENTATION: [flow.owner.position.id], CLOSURE: [flow.professional.position.id, flow.manager.position.id] };
      if (eligibility === 'KEEPS_CLOSURE' || lostPermission) stages.CLOSURE.push(survivor.id);
      if (eligibility === 'LOSES_DEPARTMENT') stages.CLOSURE[0] = survivor.id;
      await db.$executeRaw`INSERT INTO process_eight_d_workflow_configuration_revisions (organization_id,version,stages,workflow_version_id,updated_by_id)
        VALUES (${flow.org.id}::uuid,1,${JSON.stringify(stages)}::jsonb,${flow.instance.workflowVersionId}::uuid,${flow.professional.user.id}::uuid)`;
    }
    const round = mode === 'LEGACY' ? await db.$transaction(async tx => {
      const context = await app.get(ProcessEightDClosureAdapter).lockAndRead(tx, flow.owner.actor, flow.problem.id, 'SUBMIT');
      expect(context.processManagement).toBe(true);
      delete context.processManagement;
      const legacyPlan = await rounds.plan(tx, context);
      const roundId = randomUUID();
      await tx.$executeRaw`INSERT INTO workflow_closure_rounds
        (id, organization_id, problem_id, instance_id, workflow_version_id, node_id, content_version, content_snapshot, context, round_number, created_by, creator_organization_id)
        VALUES (${roundId}::uuid, ${context.organizationId}::uuid, ${context.problemId}::uuid, ${context.instanceId}::uuid,
          ${context.workflowVersionId}::uuid, ${context.currentNodeId}::uuid, ${context.contentVersion}, ${JSON.stringify(context.content)}::jsonb,
          ${JSON.stringify(context)}::jsonb, 1, ${flow.owner.user.id}::uuid, ${context.organizationId}::uuid)`;
      for (const { duty, status, participant } of legacyPlan.duties) {
        if (!participant) throw new Error(`Missing legacy closure participant for ${duty}`);
        await tx.$executeRaw`INSERT INTO workflow_closure_duties (id, organization_id, round_id, duty, status, user_id, participant)
          VALUES (${randomUUID()}::uuid, ${context.organizationId}::uuid, ${roundId}::uuid, ${duty}, ${status},
            ${participant.userId}::uuid, ${JSON.stringify(participant)}::jsonb)`;
      }
      return (await rounds.readProjection(tx, context.organizationId, context.problemId))!;
    }) : await flow.start();
    if (mode === 'LEGACY') {
      expect(round.context).not.toHaveProperty('processManagement');
      expect(round.duties).toEqual([
        expect.objectContaining({ duty: 'PROFESSIONAL', status: 'PENDING', userId: flow.professional.user.id }),
        expect.objectContaining({ duty: 'SECTION_MANAGER', status: 'PENDING', userId: flow.manager.user.id,
          participant: expect.objectContaining({ bindingId: flow.managerBinding }) }),
      ]);
      await expect(flow.decide(flow.owner.actor, round, ['SECTION_MANAGER'])).rejects.toMatchObject({
        status: 403, response: { code: 'WORKFLOW_NODE_FORBIDDEN' },
      });
    } else expect(round.context.processManagement).toBe(true);
    const approvedDuty = losesManagement ? 'PROFESSIONAL' : 'SECTION_MANAGER';
    const before = await flow.decide(losesManagement ? flow.professional.actor : flow.manager.actor, round, [approvedDuty]);
    const approved = before.duties.find(duty => duty.duty === approvedDuty);
    expect(approved).toMatchObject({ status: 'APPROVED', comment: 'Verified' });
    if (losesManagement) expect(before.duties[1]).toMatchObject({ status: 'PENDING', userId: affected.user.id });
    const signatureId = randomUUID(), approvalId = randomUUID();
    const fingerprint = createHash('sha256').update(signatureId).digest('hex');
    const signedDigest = createHash('sha256').update(flow.problem.id).digest('hex');
    await db.$executeRaw`INSERT INTO user_signatures (id,organization_id,user_id,label,fingerprint)
      VALUES (${signatureId}::uuid,${flow.org.id}::uuid,${flow.professional.user.id}::uuid,'Historical approval',${fingerprint})`;
    await db.$executeRaw`INSERT INTO approval_signatures
      (id,organization_id,signature_id,signer_user_id,resource_type,resource_id,resource_version,signature_fingerprint,signed_digest)
      VALUES (${approvalId}::uuid,${flow.org.id}::uuid,${signatureId}::uuid,${flow.professional.user.id}::uuid,
        'EIGHT_D_REPORT',${flow.problem.id},1,${fingerprint},${signedDigest})`;
    const historicalApproval = await db.$queryRaw`SELECT * FROM approval_signatures WHERE id = ${approvalId}::uuid`;
    const unrelated = await position(flow.org.id, 'Unrelated appointment of the same reviewer');
    await appoint(flow.org.id, losesManagement ? affected.user.id : flow.manager.user.id, unrelated.id);
    const unrelatedRoute = `${path(flow.org.id, unrelated.id)}/force-delete`;
    const unrelatedPreview = (await get(admin, unrelatedRoute).expect(200)).body;
    expect(unrelatedPreview.positionImpact.responsibilities).toEqual([]);
    const unrelatedDelete = await write(admin, 'post', unrelatedRoute, confirmation(unrelatedPreview)).expect(201);
    expect(unrelatedDelete.body.effects).toContainEqual({ module: 'workflow', changed: 0, pendingConfiguration: 0 });
    expect(await rounds.readProjection(db, flow.org.id, flow.problem.id)).toEqual(before);
    const route = `${path(flow.org.id, affected.position.id)}/force-delete`;
    const submission = () => db.$queryRaw`SELECT submitted_at, professional_user_id FROM ${reports} WHERE problem_id = ${flow.problem.id}::uuid`;
    const preview = (await get(admin, route).expect(200)).body;
    expect(preview.positionImpact.users).toEqual([
      expect.objectContaining({ id: affected.user.id, pendingConfiguration: eligibility === 'PENDING_CONFIGURATION'
        || issuerLosesLastPosition || (losesManagement && !fallback) }),
    ]);
    if (losesManagement) {
      expect(preview.positionImpact.responsibilities).toEqual([{ source: 'WORKFLOW_CLOSURE', count: 1 }]);
      const submitted = await submission();
      expect(submitted).toEqual([{ submitted_at: expect.any(Date), professional_user_id: flow.professional.user.id }]);
      const result = await write(admin, 'post', route, confirmation(preview)).expect(201);
      if (issuerLosesLastPosition) {
        expect(await db.user.findUniqueOrThrow({ where: { id: affected.user.id } })).toMatchObject({ status: 'DISABLED', configurationRequired: true });
      }
      expect(await rounds.readProjection(db, flow.org.id, flow.problem.id)).toEqual(before);
      expect(await submission()).toEqual(submitted);
      expect(result.body.effects).toContainEqual({ module: 'workflow', changed: 0, pendingConfiguration: 0 });
      const reminder = app.get(ProcessEightDReminderService);
      const [{ total }] = await db.$queryRaw<{ total: number }[]>`SELECT count(*)::int AS total FROM ${reports}`;
      for (let page = 0; page <= Math.ceil(total / 100); page++) await reminder.poll(100);
      const after = await rounds.readProjection(db, flow.org.id, flow.problem.id);
      expect(after).toMatchObject({ id: before.id, version: before.version + 1, status: fallback ? 'PENDING' : 'APPROVED',
        duties: fallback ? [approved, { id: before.duties[1]!.id, duty: 'MINISTER', status: 'PENDING', userId: fallback.user.id }] : [approved] });
      expect(after?.duties[0]).toEqual(approved);
      expect(await submission()).toEqual(submitted);
      expect(await db.problemIndex.findUniqueOrThrow({ where: { id: flow.problem.id } })).toMatchObject({
        status: mode === 'LEGACY' ? 'CLOSED' : flow.problem.status,
      });
      expect(await db.$queryRaw`SELECT * FROM approval_signatures WHERE id = ${approvalId}::uuid`).toEqual(historicalApproval);
      return;
    }
    if (!invalidates) {
      expect(preview.positionImpact.responsibilities).toEqual([]);
      const result = await write(admin, 'post', route, confirmation(preview)).expect(201);
      expect(result.body.effects).toContainEqual({ module: 'workflow', changed: 0, pendingConfiguration: 0 });
      expect(await rounds.readProjection(db, flow.org.id, flow.problem.id)).toEqual(before);
      expect(await db.$queryRaw`SELECT * FROM approval_signatures WHERE id = ${approvalId}::uuid`).toEqual(historicalApproval);
      return;
    }
    expect(preview.positionImpact.responsibilities).toEqual([{ source: 'WORKFLOW_CLOSURE', count: 1 }]);
    const result = await write(admin, 'post', route, confirmation(preview)).expect(201);
    expect(result.body.effects).toContainEqual({ module: 'workflow', changed: 1, pendingConfiguration: 1 });
    const after = await rounds.readProjection(db, flow.org.id, flow.problem.id);
    expect(after).toMatchObject({ status: 'CANCELLED', duties: expect.arrayContaining([approved]) });
    expect(await db.workflowInstance.findUniqueOrThrow({ where: { id: flow.instance.id } })).toMatchObject({ currentNodeId: handling.id });
    expect(await submission()).toEqual([{ submitted_at: null, professional_user_id: flow.professional.user.id }]);
    expect(await db.$queryRaw`SELECT * FROM approval_signatures WHERE id = ${approvalId}::uuid`).toEqual(historicalApproval);
  }, 30_000);

});
