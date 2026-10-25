import 'reflect-metadata';
import { jest } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../../src/app.module.js';
import { PrismaService } from '../../src/database/prisma.service.js';
import { AuditLogService } from '../../src/modules/audit-log/audit-log.service.js';
import { WorkflowDefinitionService } from '../../src/modules/workflow/workflow-definition.service.js';
import { WorkflowValidationService, type WorkflowDraft } from '../../src/modules/workflow/workflow-validation.service.js';
import { WorkflowClosureRegistry } from '../../src/modules/workflow/workflow-closure-registry.js';
import { WorkflowClosureTemplateService } from '../../src/modules/workflow/workflow-closure-template.service.js';
import { SessionService } from '../../src/modules/identity/session.service.js';
import { GlobalExceptionFilter } from '../../src/common/contracts/global-exception.filter.js';

const connection = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL) : undefined;
if (!connection || process.env.QMS_DISPOSABLE_TEST_DB !== 'true' || !['postgres:', 'postgresql:'].includes(connection.protocol)
  || !['localhost', '127.0.0.1', '[::1]'].includes(connection.hostname) || connection.port === '55440' || connection.search || connection.hash) {
  throw new Error('B4 closure templates require disposable loopback PostgreSQL, never preview 55440.');
}
jest.setTimeout(120_000);

describe('B4 closure publication with real PostgreSQL', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let definitions: WorkflowDefinitionService;
  beforeAll(async () => {
    app = (await Test.createTestingModule({ imports: [AppModule] }).compile()).createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init(); prisma = app.get(PrismaService); definitions = app.get(WorkflowDefinitionService);
  });
  afterAll(async () => { await app?.close(); });

  async function fixture(accountType: 'INTERNAL' | 'SUPPLIER' = 'INTERNAL') {
    const org = await prisma.organization.create({ data: { code: randomUUID(), name: 'B4 template fixture', type: accountType } });
    const user = await prisma.user.create({ data: { organizationId: org.id, accountType, username: randomUUID(), passwordHash: 'unused' } });
    const permission = await prisma.permission.findUniqueOrThrow({ where: { code: 'workflow:manage' } });
    const role = await prisma.role.create({ data: { organizationId: org.id, code: randomUUID(), name: 'B4 manager', permissions: { create: { permissionId: permission.id } } } });
    await prisma.userRole.create({ data: { organizationId: org.id, userId: user.id, roleId: role.id } });
    const token = await app.get(SessionService).create(user.id, prisma, { mfaVerified: true, reauthenticated: true });
    const session = (await app.get(SessionService).resolve(token))!;
    const actor = { id: user.id, organizationId: org.id, accountType, sessionId: session.id };
    const csrf = randomUUID();
    const cookie = `qms_session=${token}; qms_csrf=${csrf}`;
    const context = { organizationId: org.id, userId: user.id, actor, traceId: randomUUID() };
    return { org, user, role, actor, session, context, csrf, cookie };
  }

  const graph = (): WorkflowDraft => ({
    nodes: [
      { id: 'owner', type: 'ACTION', name: 'Owner', config: { isStart: true, assignment: { permission: 'workflow:act' } } },
      { id: 'closure', type: 'APPROVAL', name: 'Closure', config: { closureReview: { schemaVersion: 1, policy: 'INTERNAL', domainCode: 'B4_NEUTRAL' } } },
      { id: 'close', type: 'CLOSE', name: 'Close', config: { isEnd: true, assignment: { permission: 'workflow:act' } } },
    ],
    transitions: [
      { id: 'submit', from: 'owner', to: 'closure', action: 'SUBMIT' },
      { id: 'approve', from: 'closure', to: 'close', action: 'APPROVE' },
      { id: 'return', from: 'closure', to: 'owner', action: 'RETURN' },
    ],
  });

  it('fails closed with no registered real domain and keeps the draft and audit unchanged', async () => {
    const f = await fixture();
    const created = await definitions.createDraft({ ...f.context, code: randomUUID(), name: 'Unsupported', draft: graph() });
    const before = await prisma.auditEvent.count({ where: { organizationId: f.org.id } });
    await expect(definitions.publishDefinition({ ...f.context, definitionId: created.id, draftVersionId: created.version.id, expectedRevision: created.revision }))
      .rejects.toMatchObject({ status: 409, response: { code: 'WORKFLOW_ACTION_INVALID' } });
    expect((await definitions.version(f.actor, created.id, created.version.id)).version.status).toBe('DRAFT');
    expect(await prisma.auditEvent.count({ where: { organizationId: f.org.id } })).toBe(before);
  });

  it('also fails closed for legacy three-argument service construction and actorless closure publication', async () => {
    const f = await fixture();
    const service = new WorkflowDefinitionService(prisma, app.get(WorkflowValidationService), app.get(AuditLogService));
    const created = await service.createDraft({ ...f.context, code: randomUUID(), name: 'No registry', draft: graph() });
    await expect(service.publishDefinition({ ...f.context, definitionId: created.id, draftVersionId: created.version.id, expectedRevision: created.revision }))
      .rejects.toMatchObject({ status: 409, response: { code: 'WORKFLOW_ACTION_INVALID' } });
    await expect(service.publishDefinition({ organizationId: f.org.id, definitionId: created.id }))
      .rejects.toMatchObject({ status: 409, response: { code: 'WORKFLOW_ACTION_INVALID' } });
  });

  it('publishes only with an explicitly registered neutral test adapter, preserving historical reads and copies', async () => {
    const f = await fixture();
    const registry = new WorkflowClosureRegistry([{
      domainCode: 'B4_NEUTRAL',
      lockAndRead: async () => { throw new Error('This fixture tests publication, not domain execution'); },
      complete: async () => { throw new Error('Not an execution fixture'); },
      returnForChanges: async () => { throw new Error('Not an execution fixture'); },
    }]);
    const service = new WorkflowDefinitionService(prisma, app.get(WorkflowValidationService), app.get(AuditLogService), registry);
    const multiple = graph();
    multiple.nodes.push({ id: 'other-review', type: 'APPROVAL', name: 'Other domain', config: { closureReview: { schemaVersion: 1, policy: 'INTERNAL', domainCode: 'UNREGISTERED' } } });
    multiple.transitions.push({ id: 'other-submit', from: 'owner', to: 'other-review', action: 'SUBMIT' },
      { id: 'other-approve', from: 'other-review', to: 'close', action: 'APPROVE' }, { id: 'other-return', from: 'other-review', to: 'owner', action: 'RETURN' });
    const unsupported = await service.createDraft({ ...f.context, code: randomUUID(), name: 'Every closure domain must be trusted', draft: multiple });
    await expect(service.publishDefinition({ ...f.context, definitionId: unsupported.id, draftVersionId: unsupported.version.id, expectedRevision: unsupported.revision }))
      .rejects.toMatchObject({ status: 409, response: { code: 'WORKFLOW_ACTION_INVALID' } });
    const external = await fixture('SUPPLIER');
    const externalDraft = await service.createDraft({ ...external.context, code: randomUUID(), name: 'Supplier account cannot publish closure', draft: graph() });
    await expect(service.publishDefinition({ ...external.context, definitionId: externalDraft.id, draftVersionId: externalDraft.version.id, expectedRevision: externalDraft.revision }))
      .rejects.toMatchObject({ status: 409, response: { code: 'WORKFLOW_ACTION_INVALID' } });
    const created = await service.createDraft({ ...f.context, code: randomUUID(), name: 'Registered', draft: graph() });
    const published = await service.publishDefinition({ ...f.context, definitionId: created.id, draftVersionId: created.version.id, expectedRevision: created.revision });
    expect(published.version.status).toBe('PUBLISHED');
    // The default service has no neutral production adapter; reading/copying must not reinterpret published history.
    expect((await definitions.version(f.actor, created.id, created.version.id)).version).toEqual(published.version);
    const copied = await definitions.copyPublishedVersion({ ...f.context, definitionId: created.id, sourceVersionId: created.version.id, expectedRevision: published.revision });
    expect(copied.version.status).toBe('DRAFT');
    expect(copied.version.structureSnapshot).toEqual(published.version.structureSnapshot);
    await expect(definitions.publishDefinition({ ...f.context, definitionId: copied.id, draftVersionId: copied.version.id, expectedRevision: copied.revision }))
      .rejects.toMatchObject({ status: 409, response: { code: 'WORKFLOW_ACTION_INVALID' } });
  });

  it('preserves actorless legacy publication without closure metadata', async () => {
    const f = await fixture(); const draft = graph();
    draft.nodes.splice(1, 1); draft.transitions = [{ id: 'finish', from: 'owner', to: 'close' }];
    const created = await definitions.createDraft({ ...f.context, code: randomUUID(), name: 'Legacy', draft });
    expect((await definitions.publishDefinition({ organizationId: f.org.id, definitionId: created.id })).version.status).toBe('PUBLISHED');
  });

  const path = '/api/v1/workflows/closure-templates';
  it('lists exactly two pure candidate policies with no UUIDs and no database writes', async () => {
    const f = await fixture();
    const before = await prisma.workflowDefinition.count({ where: { organizationId: f.org.id } });
    const result = (await request(app.getHttpServer()).get(path).set('Cookie', f.cookie).expect(200)).body;
    expect(result.items.map((item: { policy: string }) => item.policy)).toEqual(['INTERNAL', 'SUPPLIER']);
    expect(JSON.stringify(result)).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/i);
    expect(await prisma.workflowDefinition.count({ where: { organizationId: f.org.id } })).toBe(before);
  });

  it.each(['INTERNAL', 'SUPPLIER'])('initializes only a %s draft, replays atomically and never publishes or binds it', async policy => {
    const f = await fixture(); const key = randomUUID();
    const body = { policy, domainCode: 'B4_NEUTRAL', code: randomUUID(), name: 'Candidate' };
    const post = (payload = body, idempotencyKey = key) => request(app.getHttpServer()).post(path).set('Cookie', f.cookie).set('x-csrf-token', f.csrf).set('Idempotency-Key', idempotencyKey).send(payload);
    const created = (await post().expect(201)).body;
    expect(created).toMatchObject({ code: body.code, revision: 1, version: { status: 'DRAFT', version: 1 } });
    const draft = created.version.structureSnapshot;
    expect(new WorkflowValidationService().validateDraft(draft)).toEqual({ valid: true, errors: [] });
    expect(JSON.stringify(draft)).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/i);
    expect(draft.nodes.find((node: { id: string }) => node.id === 'owner').config.assignment).toEqual({ permission: 'workflow:act' });
    expect(draft.nodes.find((node: { id: string }) => node.id === 'closure').config).toEqual({ closureReview: { schemaVersion: 1, policy, domainCode: body.domainCode } });
    const counts = async () => Promise.all([
      prisma.workflowDefinition.count({ where: { organizationId: f.org.id } }),
      prisma.auditEvent.count({ where: { organizationId: f.org.id } }),
      prisma.adminMutation.count({ where: { organizationId: f.org.id } }),
    ]);
    const before = await counts();
    expect((await post().expect(201)).body).toEqual(created); expect(await counts()).toEqual(before);
    await post({ ...body, name: 'Changed' }).expect(409);
    await post(body, randomUUID()).expect(409);
    expect(await prisma.workflowDefinition.count({ where: { organizationId: f.org.id } })).toBe(1);
    expect((await definitions.version(f.actor, created.id, created.version.id)).version.structureSnapshot).toEqual(draft);
    expect(await prisma.workflowVersion.count({ where: { organizationId: f.org.id, status: 'PUBLISHED' } })).toBe(0);
    expect(await prisma.workflowInstance.count({ where: { organizationId: f.org.id } })).toBe(0);
  });

  it('does not overwrite an existing non-template definition or its published graph', async () => {
    const f = await fixture(); const draft = graph(); const code = randomUUID();
    draft.nodes.splice(1, 1); draft.transitions = [{ id: 'finish', from: 'owner', to: 'close' }];
    const created = await definitions.createDraft({ ...f.context, code, name: 'Existing custom workflow', draft });
    const published = await definitions.publishDefinition({ ...f.context, definitionId: created.id, draftVersionId: created.version.id, expectedRevision: created.revision });
    await request(app.getHttpServer()).post(path).set('Cookie', f.cookie).set('x-csrf-token', f.csrf).set('Idempotency-Key', randomUUID())
      .send({ policy: 'INTERNAL', domainCode: 'B4_NEUTRAL', code, name: 'Do not replace' }).expect(409);
    expect(await definitions.version(f.actor, created.id, created.version.id)).toEqual(published);
    expect(await prisma.workflowDefinition.count({ where: { organizationId: f.org.id } })).toBe(1);
    expect(await prisma.adminMutation.count({ where: { organizationId: f.org.id } })).toBe(0);
  });

  it('serializes concurrent identical initialization into one draft, audit and receipt', async () => {
    const f = await fixture(); const key = randomUUID();
    const body = { policy: 'SUPPLIER', domainCode: 'B4_NEUTRAL', code: randomUUID(), name: 'Concurrent' };
    const post = () => request(app.getHttpServer()).post(path).set('Cookie', f.cookie).set('x-csrf-token', f.csrf).set('Idempotency-Key', key).send(body);
    const results = await Promise.all([post().expect(201), post().expect(201)]);
    expect(results[0]!.body).toEqual(results[1]!.body);
    expect(await prisma.workflowDefinition.count({ where: { organizationId: f.org.id } })).toBe(1);
    expect(await prisma.auditEvent.count({ where: { organizationId: f.org.id, action: 'WORKFLOW_DRAFT_CREATED' } })).toBe(1);
    expect(await prisma.adminMutation.count({ where: { organizationId: f.org.id } })).toBe(1);
  });

  it('rolls graph and receipt back if the creation audit fails, allowing a clean retry', async () => {
    const f = await fixture(); const key = randomUUID();
    const body = { policy: 'INTERNAL' as const, domainCode: 'B4_NEUTRAL', code: randomUUID(), name: 'Atomic' };
    const templates = app.get(WorkflowClosureTemplateService);
    const auditFailure = jest.spyOn(app.get(AuditLogService), 'record').mockRejectedValueOnce(new Error('B4 audit failure fixture'));
    try { await expect(templates.initialize(f.actor, body, key, randomUUID())).rejects.toThrow('B4 audit failure fixture'); }
    finally { auditFailure.mockRestore(); }
    expect(await prisma.workflowDefinition.count({ where: { organizationId: f.org.id } })).toBe(0);
    expect(await prisma.workflowVersion.count({ where: { organizationId: f.org.id } })).toBe(0);
    expect(await prisma.workflowNode.count({ where: { organizationId: f.org.id } })).toBe(0);
    expect(await prisma.adminMutation.count({ where: { organizationId: f.org.id } })).toBe(0);
    expect((await templates.initialize(f.actor, body, key, randomUUID())).version.status).toBe('DRAFT');
  });

  it('rejects unauthenticated, missing CSRF, foreign scope, invalid payload and missing idempotency key', async () => {
    const f = await fixture(); const other = await fixture();
    const body = { policy: 'INTERNAL', domainCode: 'B4_NEUTRAL', code: randomUUID(), name: 'Candidate' };
    await request(app.getHttpServer()).get(path).expect(401);
    await request(app.getHttpServer()).post(path).set('Cookie', `qms_csrf=${f.csrf}`).set('x-csrf-token', f.csrf).set('Idempotency-Key', randomUUID()).send(body).expect(401);
    await request(app.getHttpServer()).post(path).set('Cookie', f.cookie).send(body).expect(403);
    const post = (payload: object, cookie = f.cookie, key?: string) => {
      const query = request(app.getHttpServer()).post(path).set('Cookie', cookie).set('x-csrf-token', f.csrf);
      if (key) query.set('Idempotency-Key', key);
      return query.send(payload);
    };
    await post(body).expect(400);
    for (const payload of [{ ...body, organizationId: other.org.id }, { ...body, policy: 'OTHER' }, { ...body, domainCode: null }, { ...body, code: '' }, { ...body, userId: other.user.id }]) {
      await post(payload, f.cookie, randomUUID()).expect(400);
    }
    await prisma.rolePermission.deleteMany({ where: { roleId: f.role.id } });
    await prisma.userRole.create({ data: { organizationId: other.org.id, userId: f.user.id, roleId: other.role.id } });
    await request(app.getHttpServer()).get(path).set('Cookie', f.cookie).expect(403);
    await post(body, f.cookie, randomUUID()).expect(403);
    expect(await prisma.workflowDefinition.count({ where: { organizationId: f.org.id } })).toBe(0);
  });

  it('requires an internal actor and recent active authentication including on replay', async () => {
    const supplier = await fixture('SUPPLIER'); const f = await fixture();
    const body = { policy: 'INTERNAL', domainCode: 'B4_NEUTRAL', code: randomUUID(), name: 'Candidate' };
    const post = (target: typeof f, key: string) => request(app.getHttpServer()).post(path).set('Cookie', target.cookie).set('x-csrf-token', target.csrf).set('Idempotency-Key', key).send(body);
    await post(supplier, randomUUID()).expect(403);
    const key = randomUUID(); await post(f, key).expect(201);
    await prisma.session.update({ where: { id: f.session.id }, data: { reauthenticatedAt: new Date(Date.now() - 10 * 60_000) } });
    expect((await post(f, key).expect(403)).body.code).toBe('AUTH_REAUTHENTICATION_REQUIRED');
    await prisma.session.update({ where: { id: f.session.id }, data: { revokedAt: new Date() } });
    await post(f, key).expect(401);
  });
});
