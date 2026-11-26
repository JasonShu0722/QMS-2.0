import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module.js';
import { GlobalExceptionFilter } from '../../src/common/contracts/global-exception.filter.js';
import { PrismaService } from '../../src/database/prisma.service.js';
import { SessionService } from '../../src/modules/identity/session.service.js';
import { isDisposableLoopbackPostgres } from '../disposable-postgres.js';

if (!isDisposableLoopbackPostgres(process.env.DATABASE_URL) || process.env.QMS_DISPOSABLE_TEST_DB !== 'true') {
  throw new Error('Workflow definition deletion tests require explicitly disposable loopback PostgreSQL.');
}

describe('workflow definition user references on PostgreSQL', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let organizationId: string;
  let cookie: string;

  beforeAll(async () => {
    app = (await Test.createTestingModule({ imports: [AppModule] }).compile()).createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init();
    prisma = app.get(PrismaService);
    const organization = await prisma.organization.create({ data: { code: randomUUID(), name: 'Workflow publication fixture', type: 'INTERNAL' } });
    organizationId = organization.id;
    const administrator = await createUser();
    const codes = ['workflow:manage', 'platform:admin', 'account:users:read', 'account:users:delete'];
    const permissions = await prisma.permission.findMany({ where: { code: { in: codes } } });
    expect(permissions).toHaveLength(codes.length);
    const role = await prisma.role.create({ data: { organizationId, code: randomUUID(), name: 'Workflow publication administrator',
      permissions: { create: permissions.map(({ id }) => ({ permissionId: id })) } } });
    await prisma.userRole.create({ data: { userId: administrator.id, roleId: role.id, organizationId } });
    const token = await app.get(SessionService).create(administrator.id, prisma, { mfaVerified: true, reauthenticated: true });
    cookie = `qms_session=${token}; qms_csrf=workflow-publication`;
  });

  afterAll(async () => { await app?.close(); });

  function createUser() {
    return prisma.user.create({ data: { organizationId, username: randomUUID(), passwordHash: 'fixture', accountType: 'INTERNAL' } });
  }

  async function saveDraft(config: Record<string, unknown>) {
    const saved = await request(app.getHttpServer()).post('/api/v1/workflows').set('Cookie', cookie).set('x-csrf-token', 'workflow-publication').send({
      code: randomUUID(), name: 'Workflow with a direct reference',
      nodes: [
        { id: 'handle', type: 'ACTION', name: 'Handle', config: { isStart: true, assignment: { permission: 'workflow:act' }, ...config } },
        { id: 'close', type: 'CLOSE', name: 'Close', config: { isEnd: true, assignment: { permission: 'workflow:act' } } },
      ],
      transitions: [{ id: 'finish', from: 'handle', to: 'close', action: 'SUBMIT' }],
    }).expect(201);
    expect(saved.body.version.status).toBe('DRAFT');
    return saved.body as { id: string; revision: number; version: { id: string } };
  }

  function publish(draft: Awaited<ReturnType<typeof saveDraft>>) {
    return request(app.getHttpServer()).post(`/api/v1/workflows/${draft.id}/publish`).set('Cookie', cookie)
      .set('x-csrf-token', 'workflow-publication').send({ draftVersionId: draft.version.id, expectedRevision: draft.revision });
  }

  function forceDelete(assignee: Awaited<ReturnType<typeof createUser>>) {
    return request(app.getHttpServer()).delete(`/api/v1/admin/users/${assignee.id}`).set('Cookie', cookie)
      .set('x-csrf-token', 'workflow-publication').set('Idempotency-Key', randomUUID())
      .send({ mode: 'FORCE', expectedSecurityVersion: assignee.securityVersion }).expect(200);
  }

  it.each(['assignment', 'escalation'] as const)('keeps a draft unpublished when its direct %s target is force-deleted', async (field) => {
    const assignee = await createUser();
    const draft = await saveDraft({ slaMinutes: 60, [field]: { assigneeUserId: assignee.id } });
    await forceDelete(assignee);
    const rejected = await publish(draft).expect(409);
    expect(rejected.body.code).toBe('WORKFLOW_DRAFT_INVALID');
    expect(await prisma.workflowVersion.findUniqueOrThrow({ where: { id: draft.version.id } })).toMatchObject({ status: 'DRAFT', publishedAt: null });
    expect(await prisma.workflowDefinition.findUniqueOrThrow({ where: { id: draft.id } })).toMatchObject({ version: draft.revision });
    expect(await prisma.auditEvent.count({ where: { resourceId: draft.version.id, action: 'WORKFLOW_VERSION_PUBLISHED' } })).toBe(0);
  });

  it('publishes a draft with a living direct assignment and escalation target', async () => {
    const assignee = await createUser();
    const direct = { assigneeUserId: assignee.id };
    const draft = await saveDraft({ assignment: direct, slaMinutes: 60, escalation: direct });
    const published = await publish(draft).expect(201);
    expect(published.body).toMatchObject({ revision: draft.revision + 1, version: { id: draft.version.id, status: 'PUBLISHED' } });
  });

  it('copies a published version with deleted direct targets into an editable draft and publishes its repair', async () => {
    const assignee = await createUser();
    const replacement = await createUser();
    const direct = { assigneeUserId: assignee.id };
    const original = await saveDraft({ assignment: direct, slaMinutes: 60, escalation: direct });
    const historical = (await publish(original).expect(201)).body;
    await forceDelete(assignee);

    const path = `/api/v1/workflows/${original.id}`;
    const { body: copied } = await request(app.getHttpServer()).post(`${path}/copy`).set('Cookie', cookie)
      .set('x-csrf-token', 'workflow-publication').send({ sourceVersionId: original.version.id, expectedRevision: historical.revision }).expect(201);
    expect(copied).toMatchObject({ id: original.id, revision: historical.revision + 1, version: { version: 2, status: 'DRAFT' } });
    expect(copied.version.id).not.toBe(original.version.id);
    expect(copied.version.structureSnapshot).toEqual(historical.version.structureSnapshot);
    expect((await publish(copied).expect(409)).body.code).toBe('WORKFLOW_DRAFT_INVALID');

    const graph = copied.version.structureSnapshot;
    const replacementDirect = { assigneeUserId: replacement.id };
    const nodes = graph.nodes.map((node: { id: string; config: Record<string, unknown> }) => node.id === 'handle'
      ? { ...node, config: { ...node.config, assignment: replacementDirect, escalation: replacementDirect } } : node);
    const { body: saved } = await request(app.getHttpServer()).patch(`${path}/draft`).set('Cookie', cookie)
      .set('x-csrf-token', 'workflow-publication').send({ nodes, transitions: graph.transitions, draftVersionId: copied.version.id, expectedRevision: copied.revision }).expect(200);
    const { body: published } = await publish(saved).expect(201);
    expect(published.version).toMatchObject({ id: copied.version.id, version: 2, status: 'PUBLISHED', structureSnapshot: { nodes } });
    const { body: readOriginal } = await request(app.getHttpServer()).get(`${path}/versions/${original.version.id}`).set('Cookie', cookie).expect(200);
    expect(readOriginal.version).toEqual(historical.version);
  });
});
