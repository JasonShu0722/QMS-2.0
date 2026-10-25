import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import request from 'supertest';
import { Prisma } from '../../src/generated/prisma/client.js';
import { PrismaService } from '../../src/database/prisma.service.js';
import { AppModule } from '../../src/app.module.js';
import { AuditLogService } from '../../src/modules/audit-log/audit-log.service.js';
import { AdminMutationService } from '../../src/common/security/admin-mutation.service.js';
import { OrganizationResponsibilityService } from '../../src/modules/organization/organization-responsibility.service.js';
import { WorkflowClosureRoundService } from '../../src/modules/workflow/workflow-closure-round.service.js';
import { WORKFLOW_CLOSURE_ADAPTERS, WorkflowClosureRegistry } from '../../src/modules/workflow/workflow-closure-registry.js';
import type { WorkflowActor } from '../../src/modules/workflow/workflow-access-policy.js';
import type { WorkflowClosureAdapter, WorkflowClosureContext, WorkflowClosureDuty, WorkflowClosureRound } from '../../src/modules/workflow/workflow-closure-round.types.js';
import { ClosureInboxService } from '../../src/modules/task-notification/closure-inbox.service.js';
import { ClosureEventHandler } from '../../src/modules/task-notification/closure-event.handler.js';
import { APPLICATION_OUTBOX_HANDLER, OutboxWorkerService, type AtomicOutboxHandler } from '../../src/modules/task-notification/outbox-worker.service.js';
import { ClosureInboxController, ClosureNotificationController } from '../../src/modules/workflow/workflow-closure-inbox.controller.js';
import { AuthenticatedGuard } from '../../src/common/guards/authenticated.guard.js';
import { GlobalExceptionFilter } from '../../src/common/contracts/global-exception.filter.js';
import { SessionService } from '../../src/modules/identity/session.service.js';
import { OrganizationScopeService } from '../../src/modules/organization/organization-scope.service.js';
import { AuthorizationService } from '../../src/modules/authorization/authorization.service.js';
import { mfaPolicy } from '../../src/common/security/session-security.js';

const url = process.env.DATABASE_URL && new URL(process.env.DATABASE_URL);
if (!url || process.env.QMS_DISPOSABLE_TEST_DB !== 'true' || !['postgres:', 'postgresql:'].includes(url.protocol)
  || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.port === '55440' || url.search || url.hash) {
  throw new Error('Closure inbox requires disposable loopback PostgreSQL, never preview 55440');
}

describe('closure duties inbox and atomic worker on PostgreSQL', () => {
  const prisma = new PrismaService();
  const createdOrganizations: string[] = [];
  const audit = new AuditLogService(prisma);
  let engine: WorkflowClosureRoundService;
  let inbox: ClosureInboxService;
  let handler: ClosureEventHandler;
  let app: INestApplication;
  const sessions = new SessionService(prisma, audit);
  const adapter: WorkflowClosureAdapter = {
    domainCode: 'CLOSURE_INBOX_FIXTURE',
    async canNotifyRecipient(tx, context, userId) {
      const problem = await tx.problemIndex.findFirst({ where: { id: context.problemId, organizationId: context.organizationId, version: context.contentVersion, workflowInstanceId: context.instanceId, ownerId: context.ownerUserId } });
      const node = await tx.workflowNode.findUniqueOrThrow({ where: { id: context.currentNodeId } });
      const config = node.config as Prisma.JsonObject;
      return !!problem && config.sectionId === context.responsibleSectionDepartmentId && config.professionalId === context.professionalUserId
        && !!await tx.user.findFirst({ where: { id: userId, organizationId: context.organizationId, status: 'ACTIVE' } });
    },
    async lockAndRead(tx, actor, problemId, operation) {
      const before = await tx.problemIndex.findFirstOrThrow({ where: { id: problemId, organizationId: actor.organizationId } });
      await tx.$queryRaw`SELECT id FROM problem_indexes WHERE id = ${problemId}::uuid FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM workflow_instances WHERE id = ${before.workflowInstanceId}::uuid FOR UPDATE`;
      const problem = await tx.problemIndex.findUniqueOrThrow({ where: { id: problemId } });
      const instance = await tx.workflowInstance.findUniqueOrThrow({ where: { id: problem.workflowInstanceId! }, include: { currentNode: true } });
      const config = instance.currentNode!.config as Prisma.JsonObject;
      if (operation === 'CANCEL' && actor.id !== problem.ownerId) throw Object.assign(new Error('Scope denied'), { status: 403 });
      return { organizationId: problem.organizationId, problemId, instanceId: instance.id, workflowVersionId: instance.workflowVersionId,
        currentNodeId: instance.currentNodeId!, instanceVersion: instance.version, contentVersion: problem.version,
        content: { revision: problem.version }, policy: (config.closureReview as { policy: 'INTERNAL' | 'SUPPLIER' }).policy,
        severity: problem.severity as WorkflowClosureContext['severity'], responsibleSectionDepartmentId: String(config.sectionId),
        ownerUserId: problem.ownerId!, professionalUserId: String(config.professionalId) };
    },
    async complete(tx, context) {
      await tx.problemIndex.update({ where: { id: context.problemId }, data: { status: 'CLOSED', closedAt: new Date(), version: { increment: 1 } } });
      await tx.workflowInstance.update({ where: { id: context.instanceId }, data: { status: 'COMPLETED', version: { increment: 1 } } });
    },
    async returnForChanges(tx, context) {
      await tx.problemIndex.update({ where: { id: context.problemId }, data: { status: 'IN_PROGRESS', version: { increment: 1 } } });
    },
  };
  beforeAll(async () => {
    await prisma.$connect();
    engine = new WorkflowClosureRoundService(prisma, audit, new OrganizationResponsibilityService(prisma, new AdminMutationService(prisma, audit), audit), new WorkflowClosureRegistry([adapter]));
    inbox = new ClosureInboxService(prisma, engine);
    handler = new ClosureEventHandler(engine);
    const module = await Test.createTestingModule({ controllers: [ClosureInboxController, ClosureNotificationController],
      providers: [{ provide: ClosureInboxService, useValue: inbox }] }).compile();
    app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
    app.useGlobalFilters(new GlobalExceptionFilter());
    app.useGlobalGuards(new AuthenticatedGuard(new Reflector(), sessions, new OrganizationScopeService(prisma), new AuthorizationService(prisma), audit));
    await app.init();
  });
  afterAll(async () => { await app?.close(); await prisma.$disconnect(); });
  afterEach(async () => {
    const rounds = await prisma.$queryRaw<{ id: string }[]>`SELECT id FROM workflow_closure_rounds WHERE organization_id = ANY(${createdOrganizations}::uuid[])`;
    await prisma.outboxEvent.deleteMany({ where: { eventType: 'WORKFLOW_CLOSURE_CHANGED', aggregateId: { in: rounds.map(round => round.id) } } });
  });

  async function fixture(policy: 'INTERNAL' | 'SUPPLIER' = 'INTERNAL', dual = false) {
    const organization = await prisma.organization.create({ data: { code: randomUUID(), name: 'Closure inbox fixture', type: 'INTERNAL' } });
    createdOrganizations.push(organization.id);
    const department = await prisma.department.create({ data: { organizationId: organization.id, code: randomUUID(), name: 'Department' } });
    const section = await prisma.department.create({ data: { organizationId: organization.id, parentId: department.id, code: randomUUID(), name: 'Section' } });
    const role = await prisma.role.create({ data: { organizationId: organization.id, code: randomUUID(), name: 'Closure inbox role' } });
    for (const code of ['workflow:act', 'task:read', 'notification:read']) {
      const permission = await prisma.permission.upsert({ where: { code }, update: {}, create: { code, name: code } });
      await prisma.rolePermission.create({ data: { roleId: role.id, permissionId: permission.id } });
    }
    async function person(departmentId: string) {
      const position = await prisma.position.create({ data: { organizationId: organization.id, departmentId, code: randomUUID(), name: 'Fixture appointment' } });
      const user = await prisma.user.create({ data: { organizationId: organization.id, username: randomUUID(), passwordHash: 'not-for-login', accountType: 'INTERNAL' } });
      const assignment = await prisma.userPosition.create({ data: { organizationId: organization.id, userId: user.id, positionId: position.id, startedAt: new Date(Date.now() - 60_000) } });
      await prisma.userRole.create({ data: { organizationId: organization.id, userId: user.id, roleId: role.id } });
      const session = await prisma.session.create({ data: { userId: user.id, tokenHash: randomUUID(), expiresAt: new Date(Date.now() + 3600_000), securityVersion: user.securityVersion, mfaVerifiedAt: new Date() } });
      const actor: WorkflowActor = { id: user.id, organizationId: organization.id, accountType: 'INTERNAL', sessionId: session.id };
      return { user, position, assignment, actor };
    }
    const owner = await person(section.id);
    const professional = await person(department.id);
    const manager = await person(section.id);
    const minister = await person(department.id);
    if (dual) await prisma.userPosition.update({ where: { id: minister.assignment.id }, data: { userId: manager.user.id } });
    for (const [duty, departmentId, positionId] of [['SECTION_MANAGER', section.id, manager.position.id], ['MINISTER', department.id, minister.position.id]]) {
      await prisma.$executeRaw`INSERT INTO department_management_bindings (id, organization_id, department_id, responsibility, position_id, created_by, updated_by)
        VALUES (${randomUUID()}::uuid, ${organization.id}::uuid, ${departmentId}::uuid, ${duty}, ${positionId}::uuid, ${owner.user.id}::uuid, ${owner.user.id}::uuid)`;
    }
    await prisma.$executeRaw`INSERT INTO department_minister_scopes (id, organization_id, department_id, section_department_id, minister_assignment_id, valid_from, created_by, updated_by)
      VALUES (${randomUUID()}::uuid, ${organization.id}::uuid, ${department.id}::uuid, ${section.id}::uuid, ${minister.assignment.id}::uuid, CURRENT_TIMESTAMP - INTERVAL '1 minute', ${owner.user.id}::uuid, ${owner.user.id}::uuid)`;
    const definition = await prisma.workflowDefinition.create({ data: { organizationId: organization.id, code: randomUUID(), name: 'Inbox fixture flow' } });
    const version = await prisma.workflowVersion.create({ data: { organizationId: organization.id, workflowDefinitionId: definition.id, version: 1, status: 'PUBLISHED' } });
    const node = await prisma.workflowNode.create({ data: { organizationId: organization.id, workflowVersionId: version.id, nodeKey: 'closure', type: 'APPROVAL', name: 'Closure', config: {
      closureReview: { schemaVersion: 1, policy, domainCode: adapter.domainCode }, sectionId: section.id, professionalId: professional.user.id,
    } } });
    const problem = await prisma.problemIndex.create({ data: { organizationId: organization.id, ownerId: owner.user.id, reportNumber: randomUUID(), domainCode: adapter.domainCode, problemType: 'FIXTURE', sourceType: 'FIXTURE', severity: dual ? 'HIGH' : 'LOW' } });
    const instance = await prisma.workflowInstance.create({ data: { organizationId: organization.id, problemIndexId: problem.id, workflowDefinitionId: definition.id, workflowVersionId: version.id, instanceKey: randomUUID(), currentNodeId: node.id } });
    await prisma.problemIndex.update({ where: { id: problem.id }, data: { workflowInstanceId: instance.id } });
    const start = () => engine.start(owner.actor, problem.id, { expectedContentVersion: 1, expectedInstanceVersion: 1 }, randomUUID(), randomUUID());
    const decide = (actor: WorkflowActor, round: WorkflowClosureRound, duties: WorkflowClosureDuty[], decision: 'APPROVE' | 'RETURN' = 'APPROVE') => engine.decide(actor, round.id, { expectedRoundVersion: round.version, duties, decision, comment: 'Fixture verified' }, randomUUID(), randomUUID());
    return { organization, department, section, role, owner, professional, manager, minister, problem, instance, version, start, decide };
  }

  it('returns actual pending duties with fixed identity, round and content versions, without extra problem index rows', async () => {
    const f = await fixture(); const round = await f.start();
    const page = await inbox.list(f.professional.actor, {});
    expect(page).toEqual({ total: 1, items: [expect.objectContaining({ id: round.duties[0].id, roundId: round.id, roundVersion: 1,
      problemId: f.problem.id, reportNumber: f.problem.reportNumber, workflowVersionId: f.version.id, contentVersion: 1,
      userId: f.professional.user.id, duty: 'PROFESSIONAL', status: 'PENDING', canAct: true, requiresJointConfirmation: false, jointDuties: [], createdAt: round.createdAt })] });
    expect((await inbox.list(f.manager.actor, {})).items).toHaveLength(1);
    expect((await inbox.list(f.owner.actor, {})).items).toEqual([]);
    expect(await prisma.problemIndex.count({ where: { organizationId: f.organization.id } })).toBe(1);
    expect(await prisma.workflowTask.count({ where: { organizationId: f.organization.id } })).toBe(0);
  });

  it('hides WAITING duties and requires both same-person management approvals, then leaves no stale pending', async () => {
    const f = await fixture('SUPPLIER', true); const round = await f.start();
    expect(await inbox.list(f.manager.actor, {})).toEqual({ items: [], total: 0 });
    const ready = await f.decide(f.professional.actor, round, ['PROFESSIONAL']);
    const page = await inbox.list(f.manager.actor, {});
    expect(page.total).toBe(2);
    for (const item of page.items) expect(item).toMatchObject({ requiresJointConfirmation: true, jointDuties: ['SECTION_MANAGER', 'MINISTER'], roundVersion: ready.version });
    await expect(f.decide(f.manager.actor, ready, ['SECTION_MANAGER'])).rejects.toMatchObject({ status: 409 });
    await f.decide(f.manager.actor, ready, ['SECTION_MANAGER', 'MINISTER']);
    expect(await inbox.list(f.manager.actor, {})).toEqual({ items: [], total: 0 });
    expect(await inbox.list(f.professional.actor, {})).toEqual({ items: [], total: 0 });
  });

  it.each(['task:read', 'workflow:act'])('rechecks %s on every list', async code => {
    const f = await fixture(); await f.start();
    const permission = await prisma.permission.findUniqueOrThrow({ where: { code } });
    await prisma.rolePermission.delete({ where: { roleId_permissionId: { roleId: f.role.id, permissionId: permission.id } } });
    await expect(inbox.list(f.professional.actor, {})).rejects.toMatchObject({ status: 403 });
  });

  it('rejects revoked sessions, MFA requirements, and foreign organization scope', async () => {
    const f = await fixture(); await f.start();
    await expect(inbox.list(f.professional.actor, { organizationId: randomUUID() })).rejects.toMatchObject({ status: 403 });
    await prisma.session.update({ where: { id: f.professional.actor.sessionId }, data: { mfaVerifiedAt: null } });
    await prisma.role.update({ where: { id: f.role.id }, data: { mfaRequired: true } });
    await expect(inbox.list(f.professional.actor, {})).rejects.toMatchObject({ status: 401 });
    await prisma.session.update({ where: { id: f.professional.actor.sessionId }, data: { revokedAt: new Date() } });
    await expect(inbox.list(f.professional.actor, {})).rejects.toMatchObject({ status: 401 });
  });

  const readExits = ['list', 'notifications', 'empty notifications'] as const;
  const exitChanges = ['session revocation', 'natural session expiry', 'workflow:act', 'time-activated MFA'] as const;
  it.each(readExits.flatMap(exit => exitChanges.map(change => ({ exit, change }))))(
    'revalidates $change at the $exit exit after real eligibleDuties returns', async ({ exit, change }) => {
      const f = await fixture(); const round = await f.start();
      if (exit === 'notifications') await deliver(round);
      const actor = f.professional.actor;
      const query = exit === 'empty notifications' ? { roundId: randomUUID() } : {};
      const read = (service: ClosureInboxService) => exit === 'list' ? service.list(actor, query) : service.notifications(actor, query);
      expect((await read(inbox)).total).toBe(exit === 'empty notifications' ? 0 : 1);
      let boundary: Date | undefined;
      if (change === 'natural session expiry') {
        boundary = new Date(Date.now() + 1_500);
        await prisma.session.update({ where: { id: actor.sessionId }, data: { expiresAt: boundary } });
      }
      if (change === 'time-activated MFA') {
        await prisma.session.update({ where: { id: actor.sessionId }, data: { mfaVerifiedAt: null } });
        const role = await prisma.role.create({ data: { organizationId: f.organization.id, code: randomUUID(), name: 'Future MFA', mfaRequired: true } });
        const position = await prisma.position.create({ data: { organizationId: f.organization.id, departmentId: f.department.id, code: randomUUID(), name: 'Future MFA appointment' } });
        await prisma.positionRole.create({ data: { organizationId: f.organization.id, positionId: position.id, roleId: role.id } });
        boundary = new Date(Date.now() + 1_500);
        await prisma.userPosition.create({ data: { organizationId: f.organization.id, userId: actor.id, positionId: position.id, startedAt: boundary } });
        expect((await mfaPolicy(prisma, actor.id)).required).toBe(false);
      }
      let resolved = false;
      class QueryBoundaryEngine extends WorkflowClosureRoundService {
        override async eligibleDuties(reader: WorkflowActor, tx?: Prisma.TransactionClient) {
          const duties = await super.eligibleDuties(reader, tx);
          expect(duties).toHaveLength(1);
          resolved = true;
          if (change === 'session revocation') {
            await prisma.session.update({ where: { id: actor.sessionId }, data: { revokedAt: new Date() } });
          } else if (change === 'workflow:act') {
            await prisma.rolePermission.deleteMany({ where: { roleId: f.role.id, permission: { code: 'workflow:act' } } });
          } else {
            expect(Date.now()).toBeLessThan(boundary!.getTime());
            if (change === 'time-activated MFA') expect((await mfaPolicy(tx!, actor.id)).required).toBe(false);
            await new Promise(resolve => setTimeout(resolve, Math.max(0, boundary!.getTime() - Date.now() + 30)));
            expect(Date.now()).toBeGreaterThanOrEqual(boundary!.getTime());
            if (change === 'time-activated MFA') expect((await mfaPolicy(tx!, actor.id)).required).toBe(true);
          }
          return duties;
        }
      }
      const boundaryEngine = new QueryBoundaryEngine(prisma, audit, new OrganizationResponsibilityService(prisma, new AdminMutationService(prisma, audit), audit), new WorkflowClosureRegistry([adapter]));
      await expect(read(new ClosureInboxService(prisma, boundaryEngine))).rejects.toMatchObject({
        status: change === 'workflow:act' ? 403 : 401,
        response: { code: change === 'workflow:act' ? 'FEATURE_PERMISSION_DENIED' : change === 'time-activated MFA' ? 'AUTH_MFA_REQUIRED' : 'AUTH_SESSION_REQUIRED' },
      });
      expect(resolved).toBe(true);
    }, 15_000,
  );

  it.each(readExits.flatMap(exit => (exit === 'list' ? ['task:read'] : ['task:read', 'notification:read']).map(permission => ({ exit, permission }))))(
    'revalidates $permission at the $exit exit without replacing its read permission', async ({ exit, permission }) => {
      const f = await fixture(); await f.start();
      let resolved = false;
      class ReadPermissionBoundaryEngine extends WorkflowClosureRoundService {
        override async eligibleDuties(actor: WorkflowActor, tx?: Prisma.TransactionClient) {
          const duties = await super.eligibleDuties(actor, tx);
          expect(duties).toHaveLength(1);
          resolved = true;
          await prisma.rolePermission.deleteMany({ where: { roleId: f.role.id, permission: { code: permission } } });
          return duties;
        }
      }
      const boundaryEngine = new ReadPermissionBoundaryEngine(prisma, audit, new OrganizationResponsibilityService(prisma, new AdminMutationService(prisma, audit), audit), new WorkflowClosureRegistry([adapter]));
      const service = new ClosureInboxService(prisma, boundaryEngine);
      const read = exit === 'list' ? service.list(f.professional.actor, {})
        : service.notifications(f.professional.actor, exit === 'empty notifications' ? { roundId: randomUUID() } : {});
      await expect(read).rejects.toMatchObject({ status: 403, response: { code: 'FEATURE_PERMISSION_DENIED' } });
      expect(resolved).toBe(true);
    },
  );

  it('serves authenticated real HTTP reads, validates filters, and rechecks workflow permissions at the guard', async () => {
    const f = await fixture(); await f.start();
    const cookie = `qms_session=${await sessions.create(f.professional.user.id)}`;
    const unauthorized = await request(app.getHttpServer()).get('/api/v1/tasks/closure').expect(401);
    expect(unauthorized.body).toMatchObject({ code: 'AUTH_SESSION_REQUIRED', fields: {}, traceId: expect.any(String) });
    const response = await request(app.getHttpServer()).get('/api/v1/tasks/closure').set('Cookie', cookie).expect(200);
    expect(response.body.items).toEqual([expect.objectContaining({ problemId: f.problem.id, duty: 'PROFESSIONAL' })]);
    const invalid = await request(app.getHttpServer()).get('/api/v1/tasks/closure?roundId=invalid').set('Cookie', cookie).expect(400);
    expect(invalid.body).toMatchObject({ code: 'HTTP_400', fields: {}, traceId: expect.any(String) });
    await request(app.getHttpServer()).get('/api/v1/notifications/closure').set('Cookie', cookie).expect(200, { items: [], total: 0 });
    await prisma.rolePermission.deleteMany({ where: { roleId: f.role.id, permission: { code: 'workflow:act' } } });
    const denied = await request(app.getHttpServer()).get('/api/v1/tasks/closure').set('Cookie', cookie).expect(403);
    expect(denied.body).toMatchObject({ code: 'FEATURE_PERMISSION_DENIED', fields: {}, traceId: expect.any(String) });
  });

  it('hides all pending duties after a real source appointment changes', async () => {
    const f = await fixture(); await f.start();
    await prisma.userPosition.update({ where: { id: f.manager.assignment.id }, data: { endedAt: new Date() } });
    expect(await inbox.list(f.professional.actor, {})).toEqual({ items: [], total: 0 });
    expect(await inbox.list(f.manager.actor, {})).toEqual({ items: [], total: 0 });
  });

  async function deliver(round: WorkflowClosureRound, selected: AtomicOutboxHandler = handler, eventKey = `closure:${round.id}:${round.version}`) {
    const event = await prisma.outboxEvent.update({ where: { eventKey }, data: {
      status: 'PENDING', availableAt: new Date(0), createdAt: new Date(0), processingAt: null, processedAt: null,
    } });
    // Own event sorts first without mutating any other worker's fixtures.
    const result = await new OutboxWorkerService(prisma).processAtomicDue(1, selected);
    await prisma.outboxEvent.updateMany({ where: { id: event.id, status: { not: 'PROCESSED' } }, data: { availableAt: new Date(Date.now() + 86_400_000) } });
    return { result, event: await prisma.outboxEvent.findUniqueOrThrow({ where: { id: event.id } }) };
  }

  it('does not invent delivery from pending; a real worker persists once and duplicate delivery stays unique', async () => {
    const f = await fixture(); const round = await f.start();
    expect(await inbox.notifications(f.professional.actor, {})).toEqual({ items: [], total: 0 });
    expect((await deliver(round)).result).toEqual({ processed: 1, failed: 0, retried: 0 });
    const page = await inbox.notifications(f.professional.actor, {});
    expect(page.total).toBe(1);
    expect(page.items[0]).toMatchObject({ roundId: round.id, roundVersion: 1, problemId: f.problem.id, kind: 'CLOSURE_PENDING', duties: ['PROFESSIONAL'] });
    await deliver(round);
    expect(await inbox.notifications(f.professional.actor, {})).toEqual(page);
  });

  it.each(['/api/v1/tasks/closure', '/api/v1/notifications/closure'])('treats valid UUID query casing identically on %s and still rejects another organization', async path => {
    const f = await fixture(); const round = await f.start(); await deliver(round);
    const cookie = `qms_session=${await sessions.create(f.professional.user.id)}`;
    const query = new URLSearchParams({ problemId: f.problem.id, roundId: round.id });
    const lower = (await request(app.getHttpServer()).get(`${path}?${query}`).set('Cookie', cookie).expect(200)).body;
    expect(lower.total).toBe(1);
    const upper = new URLSearchParams({ problemId: f.problem.id.toUpperCase(), roundId: round.id.toUpperCase() });
    expect((await request(app.getHttpServer()).get(`${path}?${upper}`).set('Cookie', cookie).expect(200)).body).toEqual(lower);
    upper.set('organizationId', f.organization.id.toUpperCase());
    expect((await request(app.getHttpServer()).get(`${path}?${upper}`).set('Cookie', cookie).expect(200)).body).toEqual(lower);
    upper.set('organizationId', randomUUID());
    await request(app.getHttpServer()).get(`${path}?${upper}`).set('Cookie', cookie).expect(403);
    const anonymous = await request(app.getHttpServer()).get(path).expect(401);
    expect(JSON.stringify(anonymous.body)).not.toContain(f.problem.reportNumber);
  });

  it('uses the application aggregate token to route real closure events alongside the legacy workflow handler', async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(WORKFLOW_CLOSURE_ADAPTERS).useValue([adapter]).compile();
    try {
      await module.init();
      const rootHandler = module.get<AtomicOutboxHandler>(APPLICATION_OUTBOX_HANDLER);
      expect(rootHandler.eventTypes).toEqual(expect.arrayContaining(['WORKFLOW_CLOSURE_CHANGED', 'WORKFLOW_STARTED', 'WORKFLOW_ACTION_COMPLETED']));
      const f = await fixture(); const round = await f.start();
      expect((await deliver(round, rootHandler)).result).toEqual({ processed: 1, failed: 0, retried: 0 });
      expect((await inbox.notifications(f.professional.actor, {})).total).toBe(1);
    } finally { await module.close(); }
  });

  it('delivers to eligible offline recipients without requiring or fabricating a login session', async () => {
    const f = await fixture(); const round = await f.start();
    await prisma.session.deleteMany({ where: { userId: { in: [f.professional.user.id, f.manager.user.id] } } });
    expect((await deliver(round)).result.processed).toBe(1);
    expect(await prisma.$queryRaw<{ count: number }[]>`SELECT count(*)::int AS count FROM closure_notifications WHERE round_id = ${round.id}::uuid`).toEqual([{ count: 2 }]);
    const response = await request(app.getHttpServer()).get('/api/v1/notifications/closure')
      .set('Cookie', `qms_session=${await sessions.create(f.professional.user.id)}`).expect(200);
    expect(response.body).toMatchObject({ total: 1, items: [expect.objectContaining({ roundId: round.id, duties: ['PROFESSIONAL'] })] });
  });

  it('fails closed when the trusted adapter has not implemented recipient notification scope', async () => {
    const f = await fixture(); const round = await f.start();
    const withoutNotificationScope: WorkflowClosureAdapter = { ...adapter, canNotifyRecipient: undefined };
    const closedEngine = new WorkflowClosureRoundService(prisma, audit, new OrganizationResponsibilityService(prisma, new AdminMutationService(prisma, audit), audit), new WorkflowClosureRegistry([withoutNotificationScope]));
    expect((await deliver(round, new ClosureEventHandler(closedEngine))).result.processed).toBe(1);
    expect(await prisma.$queryRaw<{ count: number }[]>`SELECT count(*)::int AS count FROM closure_notifications WHERE round_id = ${round.id}::uuid`).toEqual([{ count: 0 }]);
  });

  it('does not deliver to a recipient explicitly denied by canNotifyRecipient', async () => {
    const f = await fixture(); const round = await f.start();
    const checked: string[] = [];
    const scopedAdapter: WorkflowClosureAdapter = { ...adapter, async canNotifyRecipient(tx, context, userId) {
      const allowed = await adapter.canNotifyRecipient!(tx, context, userId);
      checked.push(userId);
      return allowed && userId !== f.manager.user.id;
    } };
    const scopedEngine = new WorkflowClosureRoundService(prisma, audit, new OrganizationResponsibilityService(prisma, new AdminMutationService(prisma, audit), audit), new WorkflowClosureRegistry([scopedAdapter]));
    expect((await deliver(round, new ClosureEventHandler(scopedEngine))).result).toEqual({ processed: 1, failed: 0, retried: 0 });
    expect(checked.sort()).toEqual([f.professional.user.id, f.manager.user.id].sort());
    expect(await prisma.$queryRaw`SELECT recipient_user_id AS "recipientId" FROM closure_notifications WHERE round_id = ${round.id}::uuid`)
      .toEqual([{ recipientId: f.professional.user.id }]);
  });

  it('rolls back a thrown canNotifyRecipient check without partial delivery and retries the real outbox', async () => {
    const f = await fixture(); const round = await f.start();
    const checked: string[] = [];
    const throwingAdapter: WorkflowClosureAdapter = { ...adapter, async canNotifyRecipient(tx, context, userId) {
      const allowed = await adapter.canNotifyRecipient!(tx, context, userId);
      expect(allowed).toBe(true);
      checked.push(userId);
      if (checked.length === 2) throw new Error('CLOSURE_SCOPE_FAULT');
      return allowed;
    } };
    const throwingEngine = new WorkflowClosureRoundService(prisma, audit, new OrganizationResponsibilityService(prisma, new AdminMutationService(prisma, audit), audit), new WorkflowClosureRegistry([throwingAdapter]));
    const failed = await deliver(round, new ClosureEventHandler(throwingEngine));
    expect(checked).toHaveLength(2);
    expect(failed.result).toEqual({ processed: 0, failed: 0, retried: 1 });
    expect(failed.event).toMatchObject({ status: 'PENDING', attempts: 1, lastError: 'CLOSURE_SCOPE_FAULT', processedAt: null, processingAt: null });
    expect(await prisma.$queryRaw`SELECT id FROM closure_notifications WHERE round_id = ${round.id}::uuid`).toEqual([]);
    const retried = await deliver(round);
    expect(retried.result).toEqual({ processed: 1, failed: 0, retried: 0 });
    expect(retried.event).toMatchObject({ status: 'PROCESSED', attempts: 1, lastError: null });
    expect(await prisma.outboxDeliveryAttempt.findMany({ where: { outboxEventId: failed.event.id }, orderBy: { attemptNumber: 'asc' }, select: { attemptNumber: true, outcome: true } }))
      .toEqual([{ attemptNumber: 1, outcome: 'FAILED' }, { attemptNumber: 2, outcome: 'PROCESSED' }]);
    expect(await prisma.$queryRaw`SELECT recipient_user_id AS "recipientId" FROM closure_notifications WHERE round_id = ${round.id}::uuid ORDER BY recipient_user_id`)
      .toEqual([f.professional.user.id, f.manager.user.id].sort().map(recipientId => ({ recipientId })));
  });

  it.each(['appointment', 'minister scope'])('hides an already persisted notice after its %s expires without erasing delivery history', async source => {
    const f = await fixture('INTERNAL', true); const round = await f.start();
    expect(round.duties.find(duty => duty.duty === 'MINISTER')?.participant.assignmentId).toBe(f.minister.assignment.id);
    expect((await deliver(round)).result.processed).toBe(1);
    expect((await inbox.notifications(f.professional.actor, {})).total).toBe(1);
    if (source === 'appointment') {
      await prisma.userPosition.update({ where: { id: f.minister.assignment.id }, data: { endedAt: new Date() } });
    } else {
      await prisma.$executeRaw`UPDATE department_minister_scopes SET valid_to = statement_timestamp()
        WHERE organization_id = ${f.organization.id}::uuid AND minister_assignment_id = ${f.minister.assignment.id}::uuid`;
    }
    expect(await inbox.notifications(f.professional.actor, {})).toEqual({ items: [], total: 0 });
    expect(await inbox.list(f.professional.actor, {})).toEqual({ items: [], total: 0 });
    expect(await prisma.$queryRaw`SELECT round_id AS "roundId" FROM closure_notifications
      WHERE round_id = ${round.id}::uuid AND recipient_user_id = ${f.professional.user.id}::uuid`).toEqual([{ roundId: round.id }]);
  });

  it('does not revive a superseded round from a late event after return and resubmission', async () => {
    const f = await fixture(); const old = await f.start();
    expect((await deliver(old)).result.processed).toBe(1);
    expect((await inbox.notifications(f.professional.actor, {})).total).toBe(1);
    const returned = await f.decide(f.professional.actor, old, ['PROFESSIONAL'], 'RETURN');
    const problem = await prisma.problemIndex.findUniqueOrThrow({ where: { id: f.problem.id } });
    const instance = await prisma.workflowInstance.findUniqueOrThrow({ where: { id: f.instance.id } });
    const current = await engine.start(f.owner.actor, f.problem.id, { expectedContentVersion: problem.version, expectedInstanceVersion: instance.version }, randomUUID(), randomUUID());
    expect(current.id).not.toBe(old.id);
    const before = await prisma.$queryRaw`SELECT id, round_version FROM closure_notifications WHERE round_id = ${old.id}::uuid ORDER BY id`;
    expect((await deliver(old)).result.processed).toBe(1);
    expect((await deliver(returned)).result.processed).toBe(1);
    expect(await prisma.$queryRaw`SELECT id, round_version FROM closure_notifications WHERE round_id = ${old.id}::uuid ORDER BY id`).toEqual(before);
    expect(await inbox.notifications(f.professional.actor, {})).toEqual({ items: [], total: 0 });
    expect((await inbox.list(f.professional.actor, {})).items).toEqual([expect.objectContaining({ roundId: current.id })]);
    expect((await deliver(current)).result.processed).toBe(1);
    expect((await inbox.notifications(f.professional.actor, {})).items).toEqual([expect.objectContaining({ roundId: current.id, roundVersion: current.version })]);
  });

  it('ignores late old versions and does not renotify an approved professional', async () => {
    const f = await fixture(); const round = await f.start();
    const next = await f.decide(f.professional.actor, round, ['PROFESSIONAL']);
    expect((await deliver(round)).result.processed).toBe(1);
    expect(await inbox.notifications(f.manager.actor, {})).toEqual({ items: [], total: 0 });
    expect((await deliver(next)).result.processed).toBe(1);
    expect(await inbox.notifications(f.professional.actor, {})).toEqual({ items: [], total: 0 });
    expect((await inbox.notifications(f.manager.actor, {})).total).toBe(1);
  });

  it('never notifies WAITING management, groups dual duties once, and hides notifications after completion', async () => {
    const f = await fixture('SUPPLIER', true); const round = await f.start();
    expect((await deliver(round)).result.processed).toBe(1);
    expect(await inbox.notifications(f.manager.actor, {})).toEqual({ items: [], total: 0 });
    const next = await f.decide(f.professional.actor, round, ['PROFESSIONAL']);
    expect((await deliver(next)).result.processed).toBe(1);
    const page = await inbox.notifications(f.manager.actor, {});
    expect(page.total).toBe(1);
    expect(page.items[0]).toMatchObject({ duties: ['SECTION_MANAGER', 'MINISTER'], requiresJointConfirmation: true, jointDuties: ['SECTION_MANAGER', 'MINISTER'] });
    const done = await f.decide(f.manager.actor, next, ['SECTION_MANAGER', 'MINISTER']);
    await deliver(done);
    expect(await inbox.notifications(f.manager.actor, {})).toEqual({ items: [], total: 0 });
  });

  it('does not deliver a cancelled round', async () => {
    const f = await fixture(); const round = await f.start();
    await engine.cancel(f.owner.actor, round.id, { expectedRoundVersion: 1, reason: 'Cancelled fixture' }, randomUUID(), randomUUID());
    expect((await deliver(round)).result.processed).toBe(1);
    expect(await inbox.notifications(f.professional.actor, {})).toEqual({ items: [], total: 0 });
  });

  it.each(['schemaVersion', 'roundVersion', 'organizationId', 'problemId', 'roundId', 'aggregateType', 'aggregateId', 'eventKey'])('records malformed closure event %s as an outbox failure, never a silent success', async field => {
    const f = await fixture(); const round = await f.start();
    const event = await prisma.outboxEvent.findUniqueOrThrow({ where: { eventKey: `closure:${round.id}:1` } });
    const invalidKey = `invalid:${randomUUID()}`;
    const replacement = field === 'schemaVersion' ? 2 : field === 'roundVersion' ? '1' : field === 'eventKey' ? invalidKey : 'invalid';
    await prisma.outboxEvent.update({ where: { id: event.id }, data: ['aggregateType', 'aggregateId', 'eventKey'].includes(field)
      ? { [field]: replacement } : { payload: { ...(event.payload as Prisma.JsonObject), [field]: replacement } } });
    const outcome = await deliver(round, handler, field === 'eventKey' ? invalidKey : event.eventKey);
    expect(outcome.result).toEqual({ processed: 0, failed: 0, retried: 1 });
    expect(outcome.event.lastError).toBe('WORKFLOW_CLOSURE_EVENT_INVALID');
    expect(await prisma.$queryRaw<{ count: number }[]>`SELECT count(*)::int AS count FROM closure_notifications WHERE round_id = ${round.id}::uuid`).toEqual([{ count: 0 }]);
  });

  it.each([0, -1, 1.5, 2_147_483_648])('rejects malformed event round version %s through the real outbox', async roundVersion => {
    const f = await fixture(); const round = await f.start();
    const event = await prisma.outboxEvent.findUniqueOrThrow({ where: { eventKey: `closure:${round.id}:1` } });
    await prisma.outboxEvent.update({ where: { id: event.id }, data: { payload: { ...(event.payload as Prisma.JsonObject), roundVersion } } });
    const outcome = await deliver(round);
    expect(outcome.result).toEqual({ processed: 0, failed: 0, retried: 1 });
    expect(outcome.event).toMatchObject({ status: 'PENDING', attempts: 1, lastError: 'WORKFLOW_CLOSURE_EVENT_INVALID' });
    expect(await prisma.$queryRaw`SELECT id FROM closure_notifications WHERE round_id = ${round.id}::uuid`).toEqual([]);
  });

  it('does not notify a changed responsibility source or a recipient with revoked workflow permission', async () => {
    const f = await fixture(); const round = await f.start();
    const restricted = await prisma.role.create({ data: { organizationId: f.organization.id, code: randomUUID(), name: 'Read without action' } });
    for (const code of ['task:read', 'notification:read']) {
      const permission = await prisma.permission.findUniqueOrThrow({ where: { code } });
      await prisma.rolePermission.create({ data: { roleId: restricted.id, permissionId: permission.id } });
    }
    await prisma.userRole.deleteMany({ where: { userId: f.manager.user.id } });
    await prisma.userRole.create({ data: { userId: f.manager.user.id, roleId: restricted.id, organizationId: f.organization.id } });
    expect((await deliver(round)).result.processed).toBe(1);
    expect(await prisma.$queryRaw<{ recipientUserId: string }[]>`SELECT recipient_user_id AS "recipientUserId" FROM closure_notifications WHERE round_id = ${round.id}::uuid`)
      .toEqual([{ recipientUserId: f.professional.user.id }]);
    const changed = await fixture(); const stale = await changed.start();
    await prisma.userPosition.update({ where: { id: changed.manager.assignment.id }, data: { endedAt: new Date() } });
    expect((await deliver(stale)).result.processed).toBe(1);
    expect(await prisma.$queryRaw<{ count: number }[]>`SELECT count(*)::int AS count FROM closure_notifications WHERE round_id = ${stale.id}::uuid`).toEqual([{ count: 0 }]);
  });

  it('rolls back notification delivery with outbox completion failure and records the real error for retry', async () => {
    const f = await fixture(); const round = await f.start();
    const event = await prisma.outboxEvent.findUniqueOrThrow({ where: { eventKey: `closure:${round.id}:1` } });
    const name = `closure_fault_${randomUUID().replaceAll('-', '')}`;
    await prisma.$executeRawUnsafe(`CREATE FUNCTION ${name}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.id = '${event.id}'::uuid AND NEW.status = 'PROCESSED' THEN RAISE EXCEPTION 'closure completion fault'; END IF; RETURN NEW; END $$`);
    await prisma.$executeRawUnsafe(`CREATE TRIGGER ${name} BEFORE UPDATE ON outbox_events FOR EACH ROW EXECUTE FUNCTION ${name}()`);
    try {
      const outcome = await deliver(round);
      expect(outcome.result).toEqual({ processed: 0, failed: 0, retried: 1 });
      expect(outcome.event.lastError).toContain('closure completion fault');
      expect(await inbox.notifications(f.professional.actor, {})).toEqual({ items: [], total: 0 });
      expect(await prisma.$queryRaw<{ count: number }[]>`SELECT count(*)::int AS count FROM closure_notifications WHERE round_id = ${round.id}::uuid`).toEqual([{ count: 0 }]);
    } finally {
      await prisma.$executeRawUnsafe(`DROP TRIGGER ${name} ON outbox_events`);
      await prisma.$executeRawUnsafe(`DROP FUNCTION ${name}()`);
    }
    expect((await deliver(round)).result.processed).toBe(1);
    expect((await inbox.notifications(f.professional.actor, {})).total).toBe(1);
  });
});
