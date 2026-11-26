import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module.js';
import { GlobalExceptionFilter } from '../../src/common/contracts/global-exception.filter.js';
import { PrismaService } from '../../src/database/prisma.service.js';
import { SessionService } from '../../src/modules/identity/session.service.js';
import { ProcessEightDWorkflowConfigurationService } from '../../src/modules/process-quality/process-eight-d-workflow-configuration.service.js';
import { WorkflowClosureTemplateService } from '../../src/modules/workflow/workflow-closure-template.service.js';
import { WorkflowDefinitionService } from '../../src/modules/workflow/workflow-definition.service.js';

const connection = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL) : undefined;
if (!connection || process.env.QMS_DISPOSABLE_TEST_DB !== 'true' || connection.port === '55440') {
  throw new Error('Process 8D workflow tests require disposable PostgreSQL');
}

const path = '/api/v1/process-quality/eight-d-workflow-configuration';
const stageNames = ['ISSUE'];

describe('process 8D managed workflow configuration', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    app = (await Test.createTestingModule({ imports: [AppModule] }).compile()).createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => { await app?.close(); });

  function organization(type: 'INTERNAL' | 'SUPPLIER' = 'INTERNAL') {
    return prisma.organization.create({ data: { code: randomUUID(), name: 'Process 8D configuration test', type } });
  }

  function position(organizationId: string) {
    return prisma.position.create({ data: { organizationId, code: randomUUID(), name: randomUUID() } });
  }

  async function person(organizationId: string, codes: string[], accountType: 'INTERNAL' | 'SUPPLIER' = 'INTERNAL') {
    const user = await prisma.user.create({ data: { organizationId, accountType, username: randomUUID(), passwordHash: 'unused' } });
    const permissions = await prisma.permission.findMany({ where: { code: { in: codes } } });
    expect(permissions).toHaveLength(codes.length);
    const role = await prisma.role.create({ data: { organizationId, code: randomUUID(), name: 'Process 8D test permissions',
      permissions: { create: permissions.map(({ id }) => ({ permissionId: id })) } } });
    await prisma.userRole.create({ data: { organizationId, userId: user.id, roleId: role.id } });
    const sessions = app.get(SessionService);
    const token = await sessions.create(user.id, prisma, { mfaVerified: true, reauthenticated: true });
    const session = (await sessions.resolve(token))!;
    const csrf = randomUUID();
    return { user, role, csrf, cookie: `qms_session=${token}; qms_csrf=${csrf}`,
      actor: { id: user.id, organizationId, accountType, sessionId: session.id } };
  }

  function get(who: { cookie: string }) {
    return request(app.getHttpServer()).get(path).set('Cookie', who.cookie);
  }

  function save(who: { cookie: string; csrf: string }, body: object, key = randomUUID()) {
    return request(app.getHttpServer()).put(path).set('Cookie', who.cookie).set('x-csrf-token', who.csrf).set('Idempotency-Key', key).send(body);
  }

  it('starts unready, and admits only authorized internal configuration managers', async () => {
    const org = await organization();
    const local = await position(org.id);
    const foreign = await position((await organization()).id);
    const administrator = await person(org.id, ['platform:admin']);
    const ordinary = await person(org.id, ['process-quality:issues:read']);
    const supplier = await person((await organization('SUPPLIER')).id, ['workflow:manage'], 'SUPPLIER');
    const stages = stageNames.map(stage => ({ stage, positionIds: [] }));

    await get(administrator).expect(200, { version: 0, stages, positions: [{ id: local.id, name: local.name }], missingStages: stageNames });
    await get(ordinary).expect(403);
    await get(supplier).expect(403);
    await save(ordinary, { expectedVersion: 0, stages }).expect(403);
    await save(administrator, { expectedVersion: 0, stages, organizationId: foreign.organizationId }).expect(400);
    await save(administrator, { expectedVersion: 0, stages: [{ stage: 'ISSUE', positionIds: [foreign.id] }] }).expect(400);
    await save(administrator, { expectedVersion: 0, stages: [{ stage: 'ANALYSIS', positionIds: [local.id] }] }).expect(400);
    await request(app.getHttpServer()).put(path).set('Cookie', administrator.cookie).set('Idempotency-Key', randomUUID())
      .send({ expectedVersion: 0, stages }).expect(403);
    await save(administrator, { expectedVersion: 0, stages }).expect(200, {
      version: 1, stages, positions: [{ id: local.id, name: local.name }], missingStages: stageNames,
    });
    await expect(prisma.$transaction(tx => app.get(ProcessEightDWorkflowConfigurationService).assertCanIssue(tx, administrator.actor, org.id)))
      .resolves.toEqual({ workflowDefinitionId: expect.any(String), workflowVersionId: expect.any(String) });
  });

  it('pins one published native closure template and never selects a legacy version', async () => {
    const org = await organization();
    const manager = await person(org.id, ['workflow:manage']);
    const issuer = await person(org.id, ['process-quality:issues:issue']);
    const issuePosition = await position(org.id);
    const workPosition = await position(org.id);
    const appointment = await prisma.userPosition.create({ data: { organizationId: org.id, userId: issuer.user.id, positionId: issuePosition.id } });
    const configuration = app.get(ProcessEightDWorkflowConfigurationService);
    const issueBinding = () => prisma.$transaction(tx => configuration.assertCanIssue(tx, issuer.actor, org.id));
    const traceId = randomUUID();
    const legacy = await app.get(WorkflowClosureTemplateService).initialize(manager.actor, { code: 'legacy-8d', name: 'Old process flow',
      policy: 'INTERNAL', domainCode: 'process-quality' }, randomUUID(), traceId);
    await app.get(WorkflowDefinitionService).publishDefinition({ organizationId: org.id, actor: manager.actor, userId: manager.user.id,
      definitionId: legacy.id, expectedRevision: legacy.revision, draftVersionId: legacy.version.id, traceId });
    await expect(issueBinding()).rejects.toMatchObject({ response: { code: 'PROCESS_EIGHT_D_WORKFLOW_NOT_READY' }, fields: {
      'stages.ISSUE': expect.any(Array),
    } });
    const stages = stageNames.map(stage => ({ stage, positionIds: [stage === 'ISSUE' ? issuePosition.id : workPosition.id] }));
    const body = { expectedVersion: 0, stages };
    const key = randomUUID();
    const otherKey = randomUUID();
    const attempts = await Promise.all([save(manager, body, key), save(manager, body, otherKey)]);
    expect(attempts.map(result => result.status).sort()).toEqual([200, 409]);
    const winningKey = attempts[0]!.status === 200 ? key : otherKey;
    await save(manager, body, winningKey).expect(200);

    const binding = await issueBinding();
    expect(binding.workflowVersionId).not.toBe(legacy.version.id);
    const version = await prisma.workflowVersion.findFirstOrThrow({ where: { id: binding.workflowVersionId }, include: { nodes: true } });
    expect(version).toMatchObject({ workflowDefinitionId: binding.workflowDefinitionId, organizationId: org.id, status: 'PUBLISHED' });
    expect(version.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ nodeKey: 'owner', config: expect.objectContaining({ processEightD: expect.objectContaining({ extensionPolicy: 'LEADER_THEN_PROFESSIONAL' }) }) }),
      expect.objectContaining({ nodeKey: 'closure', config: expect.objectContaining({ closureReview: { schemaVersion: 1, policy: 'INTERNAL', domainCode: 'process-quality' } }) }),
    ]));
    await prisma.$transaction(async tx => {
      await expect(configuration.isManagedVersion(tx, org.id, legacy.version.id)).resolves.toBe(false);
      await expect(configuration.isManagedVersion(tx, org.id, binding.workflowVersionId)).resolves.toBe(true);
    });
    await save(manager, { expectedVersion: 1, stages }).expect(200);
    await expect(issueBinding()).resolves.toEqual(binding);
    expect(await prisma.workflowVersion.count({ where: { organizationId: org.id } })).toBe(2);

    await prisma.userPosition.update({ where: { id: appointment.id }, data: { endedAt: new Date() } });
    await expect(issueBinding()).rejects.toMatchObject({ status: 403 });
    await prisma.position.update({ where: { id: issuePosition.id }, data: { status: 'DISABLED', deletedAt: new Date() } });
    await get(manager).expect(200).expect(({ body: current }) => {
      expect(current).toMatchObject({ version: 2, stages, missingStages: ['ISSUE'] });
      expect(current.positions).not.toContainEqual(expect.objectContaining({ id: issuePosition.id }));
    });
    await expect(issueBinding()).rejects.toMatchObject({ response: { code: 'PROCESS_EIGHT_D_WORKFLOW_NOT_READY' } });
    await prisma.rolePermission.deleteMany({ where: { roleId: manager.role.id } });
    await save(manager, body, winningKey).expect(403);
    const auditEvents = await prisma.auditEvent.findMany({ where: { organizationId: org.id, action: 'PROCESS_EIGHT_D_WORKFLOW_CONFIGURATION_UPDATED' }, orderBy: { createdAt: 'asc' } });
    expect(auditEvents.map(event => event.metadata)).toEqual([{ resourceVersion: 1 }, { resourceVersion: 2, previousResourceVersion: 1 }]);
  });
});
