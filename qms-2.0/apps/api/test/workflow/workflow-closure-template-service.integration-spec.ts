import 'reflect-metadata';
import { jest } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { Test, type TestingModule } from '@nestjs/testing';
import { DatabaseModule } from '../../src/database/database.module.js';
import { PrismaService } from '../../src/database/prisma.service.js';
import { AuditLogModule } from '../../src/modules/audit-log/audit-log.module.js';
import { AuditLogService } from '../../src/modules/audit-log/audit-log.service.js';
import { AdminMutationModule } from '../../src/common/security/admin-mutation.service.js';
import { SessionService } from '../../src/modules/identity/session.service.js';
import { WorkflowDefinitionService } from '../../src/modules/workflow/workflow-definition.service.js';
import { WorkflowValidationService, type WorkflowDraft } from '../../src/modules/workflow/workflow-validation.service.js';
import { WorkflowClosureTemplateService } from '../../src/modules/workflow/workflow-closure-template.service.js';
import { WorkflowClosureRegistry, WORKFLOW_CLOSURE_ADAPTERS } from '../../src/modules/workflow/workflow-closure-registry.js';

const connection = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL) : undefined;
if (!connection || process.env.QMS_DISPOSABLE_TEST_DB !== 'true' || !['postgres:', 'postgresql:'].includes(connection.protocol)
  || !['localhost', '127.0.0.1', '[::1]'].includes(connection.hostname) || connection.port === '55440' || connection.search || connection.hash) {
  throw new Error('B4 service fixtures require disposable loopback PostgreSQL, never preview 55440.');
}
jest.setTimeout(120_000);

describe('B4 isolated service fixture, not production module registration', () => {
  let module: TestingModule;
  let prisma: PrismaService;
  let templates: WorkflowClosureTemplateService;
  let definitions: WorkflowDefinitionService;
  beforeAll(async () => {
    module = await Test.createTestingModule({ imports: [DatabaseModule, AuditLogModule, AdminMutationModule],
      providers: [SessionService, WorkflowDefinitionService, WorkflowValidationService, WorkflowClosureTemplateService, WorkflowClosureRegistry,
        { provide: WORKFLOW_CLOSURE_ADAPTERS, useValue: [] }],
    }).compile();
    await module.init(); prisma = module.get(PrismaService); templates = module.get(WorkflowClosureTemplateService); definitions = module.get(WorkflowDefinitionService);
  });
  afterAll(async () => { await module?.close(); });

  async function fixture() {
    const org = await prisma.organization.create({ data: { code: randomUUID(), name: 'B4 isolated service fixture', type: 'INTERNAL' } });
    const user = await prisma.user.create({ data: { organizationId: org.id, username: randomUUID(), passwordHash: 'unused', accountType: 'INTERNAL' } });
    const permission = await prisma.permission.findUniqueOrThrow({ where: { code: 'workflow:manage' } });
    const role = await prisma.role.create({ data: { organizationId: org.id, code: randomUUID(), name: 'B4 manage only', permissions: { create: { permissionId: permission.id } } } });
    await prisma.userRole.create({ data: { organizationId: org.id, userId: user.id, roleId: role.id } });
    const sessions = module.get(SessionService);
    const token = await sessions.create(user.id, prisma, { mfaVerified: true, reauthenticated: true });
    const session = (await sessions.resolve(token))!;
    const actor = { id: user.id, organizationId: org.id, accountType: 'INTERNAL' as const, sessionId: session.id };
    return { org, actor, context: { actor, organizationId: org.id, userId: user.id, traceId: randomUUID() } };
  }

  it.each(['INTERNAL', 'SUPPLIER'] as const)('initializes a stable %s draft with atomic replay and no code overwrite', async policy => {
    const f = await fixture(); const key = randomUUID();
    const body = { policy, domainCode: 'B4_ISOLATED', code: randomUUID(), name: 'Candidate' };
    const created = await templates.initialize(f.actor, body, key, randomUUID());
    expect(created.version.status).toBe('DRAFT');
    expect(JSON.stringify(created.version.structureSnapshot)).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/i);
    expect(new WorkflowValidationService().validateDraft(created.version.structureSnapshot as unknown as WorkflowDraft)).toEqual({ valid: true, errors: [] });
    const results = await Promise.all([templates.initialize(f.actor, body, key, randomUUID()), templates.initialize(f.actor, body, key, randomUUID())]);
    expect(results).toEqual([created, created]);
    expect(await prisma.workflowDefinition.count({ where: { organizationId: f.org.id } })).toBe(1);
    expect(await prisma.auditEvent.count({ where: { organizationId: f.org.id } })).toBe(1);
    expect(await prisma.adminMutation.count({ where: { organizationId: f.org.id } })).toBe(1);
    await expect(templates.initialize(f.actor, { ...body, name: 'Changed' }, key, randomUUID())).rejects.toMatchObject({ status: 409 });
    await expect(templates.initialize(f.actor, body, randomUUID(), randomUUID())).rejects.toMatchObject({ status: 409 });
    expect((await definitions.version(f.actor, created.id, created.version.id)).version.structureSnapshot).toEqual(created.version.structureSnapshot);
  });

  it('fails closed without a real domain and permits an explicitly injected neutral fixture only', async () => {
    const f = await fixture();
    const created = await templates.initialize(f.actor, { policy: 'INTERNAL', domainCode: 'B4_ISOLATED', code: randomUUID(), name: 'Publish guard' }, randomUUID(), randomUUID());
    const input = { ...f.context, definitionId: created.id, draftVersionId: created.version.id, expectedRevision: created.revision };
    await expect(definitions.publishDefinition(input)).rejects.toMatchObject({ status: 409, response: { code: 'WORKFLOW_ACTION_INVALID' } });
    expect((await definitions.version(f.actor, created.id, created.version.id)).version.status).toBe('DRAFT');
    const neutral = new WorkflowClosureRegistry([{ domainCode: 'B4_ISOLATED',
      lockAndRead: async () => { throw new Error('Publication-only fixture'); }, complete: async () => {}, returnForChanges: async () => {},
    }]);
    const registered = new WorkflowDefinitionService(prisma, module.get(WorkflowValidationService), module.get(AuditLogService), neutral);
    const published = await registered.publishDefinition(input);
    expect(published.version.status).toBe('PUBLISHED');
    const copy = await definitions.copyPublishedVersion({ ...f.context, definitionId: created.id, sourceVersionId: created.version.id, expectedRevision: published.revision });
    expect(copy.version.status).toBe('DRAFT');
    expect(copy.version.structureSnapshot).toEqual(published.version.structureSnapshot);
  });

  it('rejects publication of a conditional bypass even with the domain adapter registered', async () => {
    const f = await fixture();
    const created = await templates.initialize(f.actor, { policy: 'INTERNAL', domainCode: 'B4_ISOLATED', code: randomUUID(), name: 'No approval bypass' }, randomUUID(), randomUUID());
    const graph = structuredClone(created.version.structureSnapshot) as WorkflowDraft;
    graph.transitions.find(edge => edge.from === 'owner' && edge.action === 'SUBMIT')!.condition = { field: 'severity', operator: 'ne', value: 'LOW' };
    graph.transitions.push({ id: 'bypass', from: 'owner', to: 'close', action: 'SUBMIT', condition: { field: 'severity', operator: 'eq', value: 'LOW' } });
    const changed = await definitions.updateDraft({ ...f.context, definitionId: created.id, draftVersionId: created.version.id, expectedRevision: created.revision, draft: graph });
    const registry = new WorkflowClosureRegistry([{ domainCode: 'B4_ISOLATED', lockAndRead: async () => { throw new Error('Publication fixture only'); }, complete: async () => {}, returnForChanges: async () => {} }]);
    const registered = new WorkflowDefinitionService(prisma, module.get(WorkflowValidationService), module.get(AuditLogService), registry);
    await expect(registered.publishDefinition({ ...f.context, definitionId: created.id, draftVersionId: changed.version.id, expectedRevision: changed.revision })).rejects.toMatchObject({ status: 400,
      response: { code: 'WORKFLOW_DRAFT_INVALID', errors: expect.arrayContaining(['WORKFLOW_CLOSURE_BYPASS_NOT_ALLOWED']) } });
    expect((await definitions.version(f.actor, created.id, changed.version.id)).version.status).toBe('DRAFT');
  });

  it.each(['INTERNAL', 'SUPPLIER'])('rejects a raw %s policy array at the definition create entrance before persistence', async (policy: string) => {
    const f = await fixture();
    const created = await templates.initialize(f.actor, { policy: 'INTERNAL', domainCode: 'B4_ISOLATED', code: randomUUID(), name: 'Valid source' }, randomUUID(), randomUUID());
    const draft = JSON.parse(JSON.stringify(created.version.structureSnapshot)) as WorkflowDraft;
    (draft.nodes.find(node => node.id === 'closure')!.config!.closureReview as Record<string, unknown>).policy = [policy];
    await expect(definitions.createDraft({ ...f.context, code: randomUUID(), name: 'Array must fail', draft }))
      .rejects.toMatchObject({ status: 400, response: { code: 'WORKFLOW_DRAFT_INVALID' } });
    expect(await prisma.workflowDefinition.count({ where: { organizationId: f.org.id } })).toBe(1);
    expect(await prisma.auditEvent.count({ where: { organizationId: f.org.id } })).toBe(1);
  });

  it('does not bypass organization authorization when createDraft receives an existing transaction', async () => {
    const f = await fixture(); const other = await fixture();
    const created = await templates.initialize(f.actor, { policy: 'INTERNAL', domainCode: 'B4_ISOLATED', code: randomUUID(), name: 'Authorized source' }, randomUUID(), randomUUID());
    const draft = JSON.parse(JSON.stringify(created.version.structureSnapshot)) as WorkflowDraft;
    await expect(prisma.$transaction(tx => definitions.createDraft({ ...f.context, organizationId: other.org.id, code: randomUUID(), name: 'Foreign', draft }, tx)))
      .rejects.toMatchObject({ status: 403, response: { code: 'ORGANIZATION_SCOPE_DENIED' } });
    expect(await prisma.workflowDefinition.count({ where: { organizationId: other.org.id } })).toBe(0);
    expect(await prisma.auditEvent.count({ where: { organizationId: other.org.id } })).toBe(0);
  });

  it('does not bypass revoked-session authorization when createDraft receives an existing transaction', async () => {
    const f = await fixture();
    const created = await templates.initialize(f.actor, { policy: 'INTERNAL', domainCode: 'B4_ISOLATED', code: randomUUID(), name: 'Active source' }, randomUUID(), randomUUID());
    const draft = JSON.parse(JSON.stringify(created.version.structureSnapshot)) as WorkflowDraft;
    await prisma.session.update({ where: { id: f.actor.sessionId }, data: { revokedAt: new Date() } });
    await expect(prisma.$transaction(tx => definitions.createDraft({ ...f.context, code: randomUUID(), name: 'Revoked', draft }, tx)))
      .rejects.toMatchObject({ status: 401, response: { code: 'AUTH_SESSION_REQUIRED' } });
    expect(await prisma.workflowDefinition.count({ where: { organizationId: f.org.id } })).toBe(1);
    expect(await prisma.auditEvent.count({ where: { organizationId: f.org.id } })).toBe(1);
  });

  it('keeps graph, audit and idempotency receipt in the same transaction', async () => {
    const f = await fixture(); const key = randomUUID();
    const body = { policy: 'INTERNAL' as const, domainCode: 'B4_ISOLATED', code: randomUUID(), name: 'Rollback' };
    const fail = jest.spyOn(module.get(AuditLogService), 'record').mockRejectedValueOnce(new Error('audit fixture failure'));
    try { await expect(templates.initialize(f.actor, body, key, randomUUID())).rejects.toThrow('audit fixture failure'); }
    finally { fail.mockRestore(); }
    expect(await prisma.workflowDefinition.count({ where: { organizationId: f.org.id } })).toBe(0);
    expect(await prisma.workflowNode.count({ where: { organizationId: f.org.id } })).toBe(0);
    expect(await prisma.adminMutation.count({ where: { organizationId: f.org.id } })).toBe(0);
    expect((await templates.initialize(f.actor, body, key, randomUUID())).version.status).toBe('DRAFT');
  });
});
