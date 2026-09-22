import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { jest } from '@jest/globals';
import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module.js';
import { GlobalExceptionFilter } from '../../src/common/contracts/global-exception.filter.js';
import { SessionService } from '../../src/modules/identity/session.service.js';
import { PrismaService } from '../../src/database/prisma.service.js';
import { AuditLogService } from '../../src/modules/audit-log/audit-log.service.js';
import { WorkflowDefinitionService } from '../../src/modules/workflow/workflow-definition.service.js';
import { WorkflowValidationService } from '../../src/modules/workflow/workflow-validation.service.js';

if (!process.env.DATABASE_URL) throw new Error('Real PostgreSQL DATABASE_URL is required for workflow designer.');

function graph(label = 'Handle') {
  return {
    nodes: [
      { id: 'handle', type: 'ACTION', name: label, config: { isStart: true, assignment: { roleCode: 'DESIGNER' }, editorPosition: { x: 0, y: 0 } } },
      { id: 'close', type: 'CLOSE', name: 'Close', config: { isEnd: true, assignment: { roleCode: 'DESIGNER' } } },
    ],
    transitions: [{ id: 'finish', from: 'handle', to: 'close', action: 'SUBMIT' }],
  };
}

describe('workflow designer on PostgreSQL', () => {
  const prisma = new PrismaService();
  const audit = new AuditLogService(prisma);
  const validation = new WorkflowValidationService();
  const service = new WorkflowDefinitionService(prisma, validation, audit);
  const organizationIds: string[] = [];
  beforeAll(() => prisma.$connect());
  afterAll(async () => {
    await prisma.auditEvent.deleteMany({ where: { organizationId: { in: organizationIds } } });
    await prisma.workflowDefinition.deleteMany({ where: { organizationId: { in: organizationIds } } });
    await prisma.session.deleteMany({ where: { user: { organizationId: { in: organizationIds } } } });
    await prisma.userRole.deleteMany({ where: { organizationId: { in: organizationIds } } });
    await prisma.rolePermission.deleteMany({ where: { role: { organizationId: { in: organizationIds } } } });
    await prisma.role.deleteMany({ where: { organizationId: { in: organizationIds } } });
    await prisma.user.deleteMany({ where: { organizationId: { in: organizationIds } } });
    await prisma.organization.deleteMany({ where: { id: { in: organizationIds } } });
    await prisma.$disconnect();
  });

  async function fixture() {
    const organization = await prisma.organization.create({ data: { code: `designer-${randomUUID()}`, name: 'Designer fixture', type: 'INTERNAL' } });
    organizationIds.push(organization.id);
    const user = await prisma.user.create({ data: { organizationId: organization.id, username: `designer-${randomUUID()}`, passwordHash: 'fixture', accountType: 'INTERNAL' } });
    const role = await prisma.role.create({ data: { organizationId: organization.id, code: 'DESIGNER', name: 'Designer' } });
    const permission = await prisma.permission.upsert({ where: { code: 'workflow:manage' }, create: { code: 'workflow:manage', name: 'Workflow management' }, update: {} });
    await prisma.rolePermission.create({ data: { roleId: role.id, permissionId: permission.id } });
    await prisma.userRole.create({ data: { userId: user.id, roleId: role.id, organizationId: organization.id } });
    const session = await prisma.session.create({ data: { userId: user.id, tokenHash: randomUUID(), expiresAt: new Date(Date.now() + 3600000) } });
    const actor = { id: user.id, organizationId: organization.id, accountType: 'INTERNAL' as const, sessionId: session.id };
    const input = { organizationId: organization.id, userId: user.id, actor, code: randomUUID(), name: 'Designer flow', draft: graph() };
    const definition = await service.createDraft(input);
    const version = definition.version as { id: string; version: number };
    return { organization, user, role, actor, input, definition, version };
  }

  function update(context: Awaited<ReturnType<typeof fixture>>, expectedRevision: number, label = 'Updated') {
    return { ...context.input, definitionId: String(context.definition.id), draftVersionId: context.version.id, expectedRevision, draft: graph(label) };
  }

  function publication(context: Awaited<ReturnType<typeof fixture>>, expectedRevision = 1) {
    return { ...context.input, definitionId: String(context.definition.id), draftVersionId: context.version.id, expectedRevision };
  }

  async function holdVersion(versionId: string, publishBeforeRelease = false) {
    let unlock!: () => void;
    let acquired!: (pid: number) => void;
    const released = new Promise<void>((resolve) => { unlock = resolve; });
    const ready = new Promise<number>((resolve) => { acquired = resolve; });
    const holder = prisma.$transaction(async (tx) => {
      const [backend] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
      await tx.$queryRaw`SELECT id FROM workflow_versions WHERE id = ${versionId}::uuid FOR UPDATE`;
      acquired(backend!.pid);
      await released;
      if (publishBeforeRelease) await tx.workflowVersion.update({ where: { id: versionId }, data: { status: 'PUBLISHED' } });
    }, { timeout: 15000 });
    return { pid: await ready, release: async () => { unlock(); await holder; } };
  }

  async function waitForBlocked(pid: number) {
    const deadline = Date.now() + 3000;
    while (Date.now() < deadline) {
      const [row] = await prisma.$queryRaw<{ waiting: boolean }[]>`SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE ${pid}::int = ANY(pg_blocking_pids(pid))) AS waiting`;
      if (row!.waiting) return;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error('Designer request did not wait for its PostgreSQL row lock');
  }

  it.each(['save-first', 'publish-first'] as const)('serializes save and publish: %s', async (order) => {
    const context = await fixture();
    const held = await holdVersion(context.version.id);
    const save = () => service.updateDraft(update(context, 1, 'Saved winner'));
    const publish = () => service.publishDefinition(publication(context));
    const first = (order === 'save-first' ? save() : publish()).then((value) => ({ value }), (error: unknown) => ({ error }));
    let second!: Promise<unknown>;
    try {
      await waitForBlocked(held.pid);
      second = (order === 'save-first' ? publish() : save()).then((value) => ({ value }), (error: unknown) => ({ error }));
    } finally { await held.release(); }
    expect(await first).toHaveProperty('value');
    expect(await second).toMatchObject({ error: { status: 409 } });
    expect(await prisma.workflowDefinition.findUnique({ where: { id: context.definition.id } })).toMatchObject({ version: 2 });
    expect(await prisma.workflowVersion.findUnique({ where: { id: context.version.id } })).toMatchObject({ status: order === 'save-first' ? 'DRAFT' : 'PUBLISHED' });
  });

  it.each(['role', 'session', 'published-and-revoked'] as const)('rechecks %s authorization after waiting for the version lock', async (revocation) => {
    const context = await fixture();
    const held = await holdVersion(context.version.id, revocation === 'published-and-revoked');
    const saving = service.updateDraft(update(context, 1)).then((value) => ({ value }), (error: unknown) => ({ error }));
    try {
      await waitForBlocked(held.pid);
      if (revocation === 'role') await prisma.userRole.deleteMany({ where: { userId: context.user.id } });
      else await prisma.session.update({ where: { id: context.actor.sessionId }, data: { revokedAt: new Date() } });
    } finally { await held.release(); }
    expect(await saving).toMatchObject({ error: { status: revocation === 'role' ? 403 : 401 } });
    expect(await prisma.workflowDefinition.findUnique({ where: { id: context.definition.id } })).toMatchObject({ version: 1 });
  });

  it('normalizes historical assignments and empty conditions when reading and copying', async () => {
    const context = await fixture();
    await prisma.workflowNode.updateMany({ where: { workflowVersionId: context.version.id, nodeKey: 'handle' }, data: { config: { isStart: true, assignment: 'DESIGNER' } } });
    await prisma.workflowTransition.updateMany({ where: { workflowVersionId: context.version.id }, data: { condition: {} } });
    const historical = await service.version(context.actor, context.definition.id, context.version.id);
    expect(historical.version.structureSnapshot.nodes.find((node) => node.id === 'handle')?.config?.assignment).toEqual({ roleCode: 'DESIGNER' });
    expect(historical.version.structureSnapshot.transitions[0]).not.toHaveProperty('condition');
    await service.publishDefinition(publication(context));
    const copied = await service.copyPublishedVersion({ ...context.input, definitionId: context.definition.id, sourceVersionId: context.version.id, expectedRevision: 2 });
    expect(copied.version.structureSnapshot).toEqual(historical.version.structureSnapshot);
    await service.updateDraft({ ...update(context, 3), draftVersionId: copied.version.id, draft: copied.version.structureSnapshot as never });
  });

  it('keeps legacy standalone return nodes readable and rejects new executable drafts with them', async () => {
    const context = await fixture();
    await prisma.workflowNode.updateMany({ where: { workflowVersionId: context.version.id, nodeKey: 'handle' }, data: { type: 'RETURN' } });
    await prisma.workflowVersion.update({ where: { id: context.version.id }, data: { status: 'PUBLISHED' } });
    const historical = await service.version(context.actor, context.definition.id, context.version.id);
    expect(historical.version.structureSnapshot.nodes.find((node) => node.id === 'handle')?.type).toBe('RETURN');
    await expect(service.copyPublishedVersion({ ...context.input, definitionId: context.definition.id, sourceVersionId: context.version.id, expectedRevision: 1 })).rejects.toMatchObject({ status: 400 });
  });

  it('enforces a single draft through the deployed PostgreSQL partial unique index', async () => {
    const context = await fixture();
    await expect(prisma.workflowVersion.create({ data: { organizationId: context.organization.id, workflowDefinitionId: context.definition.id, version: 2, status: 'DRAFT' } })).rejects.toMatchObject({ code: 'P2002' });
  });

  it('preserves published versions and trusted internal callers without transport CAS', async () => {
    const context = await fixture();
    const trusted = { organizationId: context.organization.id, userId: context.user.id, definitionId: context.definition.id };
    const published = await service.publishVersion(trusted);
    await expect(service.updateDraft({ ...trusted, draft: graph('Cannot write') })).rejects.toMatchObject({ status: 409 });
    const copied = await service.copyPublishedVersion(trusted);
    expect(copied.version).toMatchObject({ version: 2, status: 'DRAFT' });
    await service.updateDraft({ ...trusted, draft: graph('New graph') });
    const unchanged = await service.version(context.actor, context.definition.id, published.id);
    expect(unchanged.version).toEqual(published);
    expect(unchanged.version.structureSnapshot.nodes.find((node) => node.id === 'handle')?.name).toBe('Handle');
    expect((await service.detail(context.actor, context.definition.id)).versions.map((version) => version.version)).toEqual([2, 1]);
  });

  it('filters before pagination, scopes options, and rejects another organization version', async () => {
    const context = await fixture();
    const other = await fixture();
    expect(await service.list(context.actor, { pageSize: 1 })).toMatchObject({ total: 1, items: [{ id: context.definition.id }] });
    expect(await service.list(context.actor, { offset: 5 })).toEqual({ total: 1, items: [] });
    expect(await service.list(context.actor, { search: other.input.code })).toEqual({ total: 0, items: [] });
    expect(await service.list(context.actor, { status: 'PUBLISHED' })).toEqual({ total: 0, items: [] });
    await expect(service.detail(context.actor, other.definition.id)).rejects.toMatchObject({ status: 404 });
    await expect(service.version(context.actor, context.definition.id, other.version.id)).rejects.toMatchObject({ status: 404 });
    const options = await service.options(context.actor, {});
    expect(options.users).toEqual([{ id: context.user.id, name: context.user.username }]);
    expect(options.roles).toContainEqual({ code: 'DESIGNER', name: 'Designer' });
    expect(options.permissions).toContainEqual({ code: 'workflow:manage', name: expect.any(String) });
    await prisma.userRole.deleteMany({ where: { userId: context.user.id } });
    await expect(service.list(context.actor, {})).rejects.toMatchObject({ status: 403 });
  });

  it('enforces actual HTTP sessions, CSRF, strict nested DTOs, and exact CAS baselines', async () => {
    const context = await fixture();
    const application = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(PrismaService).useValue(prisma).compile();
    const app = application.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init();
    try {
      const token = await app.get(SessionService).create(context.user.id, prisma, { mfaVerified: true });
      const cookie = `qms_session=${token}; qms_csrf=designer-csrf`;
      const path = `/api/v1/workflows/${context.definition.id}`;
      await request(app.getHttpServer()).get('/api/v1/workflows').expect(401);
      const options = await request(app.getHttpServer()).get('/api/v1/workflows/options').set('Cookie', cookie).expect(200);
      expect(Object.keys(options.body).sort()).toEqual(['permissions', 'roles', 'users']);
      await request(app.getHttpServer()).get('/api/v1/workflows?pageSize=101').set('Cookie', cookie).expect(400);
      await request(app.getHttpServer()).get('/api/v1/workflows?organizationId=forged').set('Cookie', cookie).expect(400);
      await request(app.getHttpServer()).patch(`${path}/draft`).set('Cookie', cookie).send(graph()).expect(403);
      for (const body of [graph(), { ...graph(), expectedRevision: 1 }, { ...graph(), expectedRevision: 1, draftVersionId: context.version.id, actor: context.user.id }]) {
        await request(app.getHttpServer()).patch(`${path}/draft`).set('Cookie', cookie).set('x-csrf-token', 'designer-csrf').send(body).expect(400);
      }
      for (const config of [{ script: 'return true' }, { assignment: { roleCode: 'DESIGNER', arbitrary: true } }, { isStart: 'true' }, { reminders: [{ offsetMinutes: 1, arbitrary: true }] }]) {
        const body = graph();
        Object.assign(body.nodes[0]!.config, config);
        await request(app.getHttpServer()).post('/api/v1/workflows/validate').set('Cookie', cookie).set('x-csrf-token', 'designer-csrf').send(body).expect(400);
      }
      for (const condition of [{ field: 'secret', operator: 'eq', value: 'x' }, { field: 'status', operator: 'eq', value: { script: true } }, { field: 'status', operator: 'eq', value: 'OPEN', arbitrary: true }]) {
        const body = graph();
        Object.assign(body.transitions[0]!, { condition });
        await request(app.getHttpServer()).post('/api/v1/workflows/validate').set('Cookie', cookie).set('x-csrf-token', 'designer-csrf').send(body).expect(400);
      }
      const saved = await request(app.getHttpServer()).patch(`${path}/draft`).set('Cookie', cookie).set('x-csrf-token', 'designer-csrf').send({ ...graph('HTTP saved'), expectedRevision: 1, draftVersionId: context.version.id }).expect(200);
      expect(saved.body).toMatchObject({ revision: 2, version: { id: context.version.id, status: 'DRAFT' } });
      await request(app.getHttpServer()).post(`${path}/publish`).set('Cookie', cookie).set('x-csrf-token', 'designer-csrf').send({ expectedRevision: 1, draftVersionId: context.version.id }).expect(409);
      await request(app.getHttpServer()).post(`${path}/publish`).set('Cookie', cookie).set('x-csrf-token', 'designer-csrf').send({ expectedRevision: 2, draftVersionId: context.version.id }).expect(201);
      await request(app.getHttpServer()).get(`${path}/versions/${context.version.id}`).set('Cookie', cookie).expect(200);
      await request(app.getHttpServer()).post(`${path}/copy`).set('Cookie', cookie).set('x-csrf-token', 'designer-csrf').send({ expectedRevision: 3 }).expect(400);
      const copied = await request(app.getHttpServer()).post(`${path}/copy`).set('Cookie', cookie).set('x-csrf-token', 'designer-csrf').send({ expectedRevision: 3, sourceVersionId: context.version.id }).expect(201);
      expect(copied.body).toMatchObject({ revision: 4, version: { version: 2, status: 'DRAFT' } });
    } finally { await app.close(); }
  });

  it('rejects a stale edit revision without replacing the saved graph', async () => {
    const context = await fixture();
    await service.updateDraft(update(context, 1, 'Winner'));
    await expect(service.updateDraft(update(context, 1, 'Loser'))).rejects.toMatchObject({ status: 409 });
    expect(await prisma.workflowDefinition.findUnique({ where: { id: String(context.definition.id) } })).toMatchObject({ version: 2 });
    expect(await prisma.workflowNode.findFirst({ where: { workflowVersionId: context.version.id, nodeKey: 'handle' } })).toMatchObject({ name: 'Winner' });
  });

  it('saves an unfinished safe draft but refuses publishing until it is executable', async () => {
    const context = await fixture();
    const incomplete = { nodes: [{ id: 'start', type: 'ACTION', name: 'Unfinished', config: {} }], transitions: [] };
    await service.updateDraft({ ...update(context, 1), draft: incomplete });
    await expect(service.publishVersion(publication(context, 2))).rejects.toMatchObject({ status: 400 });
    expect(await prisma.workflowVersion.findUnique({ where: { id: context.version.id } })).toMatchObject({ status: 'DRAFT' });
  });

  it.each([
    { hidden: 'unregistered property' },
    { isStart: 'yes' },
    { assignment: { roleCode: 'DESIGNER', hidden: true } },
    { editorPosition: { x: Infinity, y: 0 } },
  ])('refuses unknown or incorrectly typed graph configuration %j', async (config) => {
    const context = await fixture();
    const draft = graph();
    Object.assign(draft.nodes[0]!.config, config);
    await expect(service.updateDraft({ ...update(context, 1), draft })).rejects.toMatchObject({ status: 400 });
  });

  it('permits one concurrent edit and audits only the winning transaction', async () => {
    const context = await fixture();
    const results = await Promise.allSettled([service.updateDraft(update(context, 1, 'First')), service.updateDraft(update(context, 1, 'Second'))]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.find((result) => result.status === 'rejected')).toMatchObject({ reason: { status: 409 } });
    expect(await prisma.auditEvent.count({ where: { resourceId: String(context.definition.id), action: 'WORKFLOW_DRAFT_UPDATED' } })).toBe(1);
  });

  it('rejects an explicit unavailable copy source instead of falling back', async () => {
    const context = await fixture();
    await service.publishVersion(publication(context));
    await expect(service.copyPublishedVersion({ ...context.input, definitionId: String(context.definition.id), sourceVersionId: randomUUID(), expectedRevision: 2 } as never)).rejects.toMatchObject({ status: 404 });
    expect(await prisma.workflowVersion.count({ where: { workflowDefinitionId: String(context.definition.id) } })).toBe(1);
  });

  it('refuses a second draft while preserving the explicitly selected published graph', async () => {
    const context = await fixture();
    await service.publishVersion(publication(context));
    await service.copyPublishedVersion({ ...context.input, definitionId: String(context.definition.id), sourceVersionId: context.version.id, expectedRevision: 2 } as never);
    await expect(service.copyPublishedVersion({ ...context.input, definitionId: String(context.definition.id), sourceVersionId: context.version.id, expectedRevision: 3 } as never)).rejects.toMatchObject({ status: 409 });
    expect(await prisma.workflowVersion.count({ where: { workflowDefinitionId: String(context.definition.id), status: 'DRAFT' } })).toBe(1);
  });

  it.each(['create', 'update', 'publish', 'copy'] as const)('rolls back %s when its success audit cannot be written', async (operation) => {
    const context = await fixture();
    if (operation === 'copy') await service.publishVersion(publication(context));
    const before = {
      definitions: await prisma.workflowDefinition.findMany({ where: { organizationId: context.organization.id } }),
      versions: await prisma.workflowVersion.findMany({ where: { organizationId: context.organization.id }, orderBy: { id: 'asc' } }),
      nodes: await prisma.workflowNode.findMany({ where: { organizationId: context.organization.id }, orderBy: { id: 'asc' } }),
    };
    const failedAudit = { record: jest.fn(async () => { throw new Error('designer-audit-unavailable'); }) };
    const failing = new WorkflowDefinitionService(prisma, validation, failedAudit as never);
    const command = operation === 'create' ? failing.createDraft({ ...context.input, code: randomUUID() })
      : operation === 'update' ? failing.updateDraft(update(context, 1))
        : operation === 'publish' ? failing.publishVersion(publication(context))
          : failing.copyPublishedVersion({ ...context.input, definitionId: String(context.definition.id), sourceVersionId: context.version.id, expectedRevision: 2 } as never);
    await expect(command).rejects.toThrow('designer-audit-unavailable');
    expect({
      definitions: await prisma.workflowDefinition.findMany({ where: { organizationId: context.organization.id } }),
      versions: await prisma.workflowVersion.findMany({ where: { organizationId: context.organization.id }, orderBy: { id: 'asc' } }),
      nodes: await prisma.workflowNode.findMany({ where: { organizationId: context.organization.id }, orderBy: { id: 'asc' } }),
    }).toEqual(before);
  });
});
