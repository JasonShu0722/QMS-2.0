import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import request from 'supertest';
import { jest } from '@jest/globals';
import { AppModule } from '../../src/app.module.js';
import { PrismaService } from '../../src/database/prisma.service.js';
import { SessionService } from '../../src/modules/identity/session.service.js';
import { AuditLogService } from '../../src/modules/audit-log/audit-log.service.js';
import { WorkflowDefinitionService } from '../../src/modules/workflow/workflow-definition.service.js';
import { GlobalExceptionFilter } from '../../src/common/contracts/global-exception.filter.js';
import { SupplierWorkflowBindingService } from '../../src/modules/supplier-quality/supplier-workflow-binding.service.js';

if (!process.env.DATABASE_URL) throw new Error('Workflow binding tests require real PostgreSQL; no skipping.');

describe('supplier workflow configuration with real HTTP and PostgreSQL', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const csrf = randomUUID();
  beforeAll(async () => {
    app = (await Test.createTestingModule({ imports: [AppModule] }).compile()).createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init(); prisma = app.get(PrismaService);
  });
  afterAll(async () => app?.close());

  async function identity(type: 'INTERNAL' | 'SUPPLIER' = 'INTERNAL', permissions = ['configuration:read', 'configuration:manage']) {
    const organization = await prisma.organization.create({ data: { code: randomUUID(), name: 'Binding fixture', type } });
    const user = await prisma.user.create({ data: { organizationId: organization.id, username: randomUUID(), passwordHash: 'unused', accountType: type } });
    const role = await prisma.role.create({ data: { organizationId: organization.id, code: randomUUID(), name: 'Configuration fixture' } });
    for (const code of permissions) {
      const permission = await prisma.permission.upsert({ where: { code }, create: { code, name: code }, update: {} });
      await prisma.rolePermission.create({ data: { roleId: role.id, permissionId: permission.id } });
    }
    await prisma.userRole.create({ data: { userId: user.id, roleId: role.id, organizationId: organization.id } });
    const token = await app.get(SessionService).create(user.id, prisma, { mfaVerified: true, reauthenticated: true });
    return { organization, user, role, cookie: `qms_session=${token}; qms_csrf=${csrf}` };
  }

  async function flow(owner: Awaited<ReturnType<typeof identity>>, options: { sla?: number | null; independent?: boolean; published?: boolean; marked?: boolean } = {}) {
    const service = app.get(WorkflowDefinitionService);
    const definition = await service.createDraft({ organizationId: owner.organization.id, userId: owner.user.id, code: randomUUID(), name: 'Supplier flow binding fixture', draft: {
      nodes: [
        { id: 'reply', name: '回复', type: 'ACTION', config: { isStart: true, assignment: { permission: options.marked === false ? 'workflow:act' : 'supplier-quality:responses:write' }, ...(options.sla === null ? {} : { slaMinutes: options.sla ?? 90 }) } },
        { id: 'verify', name: '验证', type: 'VERIFICATION', config: { assignment: { permission: 'supplier-quality:problems:write' } } },
        { id: 'close', name: '关闭', type: 'CLOSE', config: { isEnd: true, requireIndependentVerification: options.independent ?? true, assignment: { permission: 'supplier-quality:problems:write' } } },
      ], transitions: [{ id: 'reply', from: 'reply', to: 'verify', action: 'SUBMIT' }, { id: 'verify', from: 'verify', to: 'close', action: 'VERIFY' }],
    } });
    if (options.published === false) return (await prisma.workflowVersion.findFirstOrThrow({ where: { workflowDefinitionId: definition.id } })).id;
    return (await service.publishVersion({ organizationId: owner.organization.id, userId: owner.user.id, definitionId: definition.id })).id;
  }

  function put(owner: Awaited<ReturnType<typeof identity>>, versionId: string, changes = {}, key = randomUUID(), organizationId?: string) {
    return request(app.getHttpServer()).put(`/api/v1/supplier-quality/workflow-bindings${organizationId ? `?organizationId=${organizationId}` : ''}`)
      .set('Cookie', owner.cookie).set('x-csrf-token', csrf).set('Idempotency-Key', key)
      .send({ severity: 'HIGH', responseForm: 'BRIEF', replyMode: 'SUPPLIER', expectedVersion: 0, workflowVersionId: versionId, enabled: true, ...changes });
  }
  function get(owner: Awaited<ReturnType<typeof identity>>) { return request(app.getHttpServer()).get('/api/v1/supplier-quality/workflow-bindings').set('Cookie', owner.cookie); }

  it('returns no configured defaults and binds an explicitly published SLA version', async () => {
    const owner = await identity();
    expect((await get(owner).expect(200)).body.items).toEqual([]);
    const versionId = await flow(owner, { sla: 75 });
    const response = await put(owner, versionId).expect(200);
    expect(response.body).toMatchObject({ version: 1, severity: 'HIGH', responseForm: 'BRIEF', replyMode: 'SUPPLIER', workflowVersionId: versionId, responseSlaMinutes: 75, enabled: true });
    expect((await get(owner).expect(200)).body.items).toEqual([response.body]);
    expect(await prisma.workflowInstance.count({ where: { organizationId: owner.organization.id } })).toBe(0);
    expect(await prisma.auditEvent.count({ where: { organizationId: owner.organization.id, action: 'SUPPLIER_WORKFLOW_BINDING_CREATED' } })).toBe(1);
  });

  it('preserves immutable history, replaces current selection and disables without fallback', async () => {
    const owner = await identity();
    const first = await put(owner, await flow(owner, { sla: 60 })).expect(200);
    const nextVersion = await flow(owner, { sla: 120 });
    const next = await put(owner, nextVersion, { expectedVersion: 1 }).expect(200);
    expect(next.body).toMatchObject({ version: 2, responseSlaMinutes: 120 });
    const disabled = await put(owner, nextVersion, { expectedVersion: 2, enabled: false }).expect(200);
    expect((await get(owner).expect(200)).body.items).toEqual([disabled.body]);
    const history = await prisma.$queryRaw<{ version: number }[]>`SELECT version FROM supplier_workflow_bindings WHERE organization_id = ${owner.organization.id}::uuid ORDER BY version`;
    expect(history.map((row) => row.version)).toEqual([1, 2, 3]);
    await expect(prisma.$executeRaw`UPDATE supplier_workflow_bindings SET enabled = false WHERE id = ${first.body.id}::uuid`).rejects.toThrow('SUPPLIER_BINDING_IMMUTABLE');
    await expect(prisma.$executeRaw`DELETE FROM supplier_workflow_bindings WHERE id = ${first.body.id}::uuid`).rejects.toThrow('SUPPLIER_BINDING_IMMUTABLE');
  });

  it.each([{ sla: null }, { independent: false }, { published: false }, { marked: false }])('rejects an unusable workflow %j', async (options) => {
    const owner = await identity();
    const response = await put(owner, await flow(owner, options)).expect(409);
    expect(response.body.code).toBe('SUPPLIER_WORKFLOW_CONFIGURATION_INVALID');
    expect((await get(owner).expect(200)).body.items).toEqual([]);
  });

  it('denies supplier configuration and foreign workflow versions/organization scopes', async () => {
    const owner = await identity(); const other = await identity(); const supplier = await identity('SUPPLIER');
    const version = await flow(owner);
    await put(other, version).expect(409);
    await put(other, version, {}, randomUUID(), owner.organization.id).expect(403);
    await put(supplier, version).expect(403);
    await get(supplier).expect(403);
  });

  it('enforces read/manage separation, CSRF, recent authentication and validation', async () => {
    const owner = await identity(); const reader = await identity('INTERNAL', ['configuration:read']);
    const version = await flow(owner);
    await get(reader).expect(200);
    await put(reader, version).expect(403);
    await request(app.getHttpServer()).get('/api/v1/supplier-quality/workflow-bindings').expect(401);
    await request(app.getHttpServer()).put('/api/v1/supplier-quality/workflow-bindings').set('Cookie', owner.cookie).send({}).expect(403);
    await put(owner, version, { severity: 'UNKNOWN' }).expect(400);
    await put(owner, version, { slaMinutes: 1 }).expect(400);
    await put(owner, version, { expectedVersion: -1 }).expect(400);
    await prisma.session.updateMany({ where: { userId: owner.user.id }, data: { reauthenticatedAt: null } });
    await put(owner, version).expect(403);
  });

  it('allows explicitly authorized internal scopes but rejects supplier-owned configuration', async () => {
    const actor = await identity(); const owner = await identity(); const supplier = await identity('SUPPLIER');
    for (const target of [owner, supplier]) await prisma.userRole.create({ data: { userId: actor.user.id, roleId: target.role.id, organizationId: target.organization.id } });
    const version = await flow(owner);
    await put(actor, version, {}, randomUUID(), owner.organization.id).expect(200);
    await request(app.getHttpServer()).get(`/api/v1/supplier-quality/workflow-bindings?organizationId=${supplier.organization.id}`).set('Cookie', actor.cookie).expect(403);
    await put(actor, version, {}, randomUUID(), supplier.organization.id).expect(403);
  });

  it('replays exactly once and rejects changed payload or revoked management permission', async () => {
    const owner = await identity(); const version = await flow(owner); const key = randomUUID();
    const first = await put(owner, version, {}, key).expect(200);
    expect((await put(owner, version, {}, key).expect(200)).body).toEqual(first.body);
    await put(owner, version, { enabled: false }, key).expect(409);
    const permission = await prisma.permission.findUniqueOrThrow({ where: { code: 'configuration:manage' } });
    await prisma.rolePermission.delete({ where: { roleId_permissionId: { roleId: owner.role.id, permissionId: permission.id } } });
    await put(owner, version, {}, key).expect(403);
    expect(await prisma.auditEvent.count({ where: { organizationId: owner.organization.id, action: 'SUPPLIER_WORKFLOW_BINDING_CREATED' } })).toBe(1);
  });

  it('allows one concurrent CAS writer and rejects stale configuration changes', async () => {
    const owner = await identity(); const version = await flow(owner);
    const results = await Promise.all([put(owner, version), put(owner, version)]);
    expect(results.map((result) => result.status).sort()).toEqual([200, 409]);
    await put(owner, version).expect(409);
  });

  it('rolls back configuration when audit fails and permits the same-key retry', async () => {
    const owner = await identity(); const version = await flow(owner); const key = randomUUID();
    const spy = jest.spyOn(app.get(AuditLogService), 'record').mockRejectedValueOnce(new Error('binding audit failure'));
    try { await put(owner, version, {}, key).expect(500); } finally { spy.mockRestore(); }
    expect((await get(owner).expect(200)).body.items).toEqual([]);
    expect((await put(owner, version, {}, key).expect(200)).body.version).toBe(1);
  });

  it('resolves only the current exact selector and never substitutes a disabled or retired binding', async () => {
    const owner = await identity();
    const service = app.get(SupplierWorkflowBindingService);
    const selector = { severity: 'HIGH', responseForm: 'BRIEF', replyMode: 'SUPPLIER' } as const;
    const resolve = (changes = {}) => prisma.$transaction((tx) => service.resolve(tx, owner.organization.id, { ...selector, ...changes }));
    await expect(resolve()).rejects.toMatchObject({ status: 409, response: { code: 'SUPPLIER_WORKFLOW_CONFIGURATION_REQUIRED' } });
    const version = await flow(owner, { sla: 135 });
    const first = await put(owner, version).expect(200);
    expect(await resolve()).toMatchObject({ bindingId: first.body.id, bindingVersion: 1, workflowVersionId: version, responseSlaMinutes: 135 });
    for (const changes of [{ severity: 'LOW' }, { responseForm: 'EIGHT_D' }, { replyMode: 'INTERNAL' }]) await expect(resolve(changes)).rejects.toMatchObject({ status: 409 });
    await put(owner, version, { expectedVersion: 1, enabled: false }).expect(200);
    await expect(resolve()).rejects.toMatchObject({ status: 409, response: { code: 'SUPPLIER_WORKFLOW_CONFIGURATION_REQUIRED' } });
    await put(owner, version, { expectedVersion: 2 }).expect(200);
    await prisma.workflowVersion.update({ where: { id: version }, data: { status: 'RETIRED' } });
    await expect(resolve()).rejects.toMatchObject({ status: 409, response: { code: 'SUPPLIER_WORKFLOW_CONFIGURATION_INVALID' } });
    await put(owner, version, { expectedVersion: 3 }).expect(409);
    await put(owner, version, { expectedVersion: 3, enabled: false }).expect(200);
    expect((await get(owner).expect(200)).body.items[0]).toMatchObject({ version: 4, enabled: false, workflowStatus: 'RETIRED' });
  });

  it('binds distinct severity, form and reply-mode combinations independently', async () => {
    const owner = await identity(); const version = await flow(owner);
    const keys = [{}, { severity: 'LOW' }, { responseForm: 'EIGHT_D' }, { replyMode: 'INTERNAL' }];
    for (const key of keys) expect((await put(owner, version, key).expect(200)).body.version).toBe(1);
    expect((await get(owner).expect(200)).body.items).toHaveLength(4);
  });

  it('enforces database selector and organization constraints without relying on the HTTP layer', async () => {
    const owner = await identity(); const other = await identity(); const supplier = await identity('SUPPLIER');
    const version = await flow(owner);
    const data = { organizationId: owner.organization.id, severity: 'HIGH', responseForm: 'BRIEF', replyMode: 'SUPPLIER', version: 1, workflowVersionId: version, enabled: true, createdById: owner.user.id };
    await expect(prisma.supplierWorkflowBinding.create({ data: { ...data, severity: 'UNKNOWN' } })).rejects.toThrow();
    await expect(prisma.supplierWorkflowBinding.create({ data: { ...data, organizationId: other.organization.id } })).rejects.toThrow();
    await expect(prisma.supplierWorkflowBinding.create({ data: { ...data, organizationId: supplier.organization.id } })).rejects.toThrow('SUPPLIER_BINDING_OWNER_INVALID');
    await put(owner, version).expect(200);
    await expect(prisma.supplierWorkflowBinding.create({ data })).rejects.toThrow();
    await expect(prisma.organization.update({ where: { id: owner.organization.id }, data: { type: 'SUPPLIER' } })).rejects.toThrow();
    await expect(prisma.workflowVersion.delete({ where: { id: version } })).rejects.toThrow();
  });
});
