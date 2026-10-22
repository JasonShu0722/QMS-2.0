import 'reflect-metadata';
import { jest } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../../src/app.module.js';
import { PrismaService } from '../../src/database/prisma.service.js';
import { GlobalExceptionFilter } from '../../src/common/contracts/global-exception.filter.js';
import { SessionService } from '../../src/modules/identity/session.service.js';
import { AdminRoleService } from '../../src/modules/authorization/admin-role.service.js';
import { ADMIN_PERMISSIONS } from '../../src/modules/authorization/permission-catalog.js';
import { OrganizationService } from '../../src/modules/organization/organization.service.js';
import { WorkflowDefinitionService } from '../../src/modules/workflow/workflow-definition.service.js';

const connection = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL) : undefined;
if (!connection || process.env.QMS_DISPOSABLE_TEST_DB !== 'true'
  || !['postgres:', 'postgresql:'].includes(connection.protocol)
  || !['localhost', '127.0.0.1', '[::1]'].includes(connection.hostname)
  || connection.port === '55440' || connection.search || connection.hash) {
  throw new Error('Legacy role HTTP tests require explicitly disposable loopback PostgreSQL; preview 55440 is forbidden.');
}
jest.setTimeout(120_000);

describe('legacy role HTTP writes are read-only with real PostgreSQL', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const organizations: string[] = [];
  const csrf = randomUUID();
  const codes = [...new Set([...ADMIN_PERMISSIONS, 'organization:read', 'workbench:read', 'workflow:manage'])];

  beforeAll(async () => {
    app = (await Test.createTestingModule({ imports: [AppModule] }).compile()).createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    try {
      const where = { organizationId: { in: organizations } };
      await prisma.auditEvent.deleteMany({ where });
      await prisma.adminMutation.deleteMany({ where });
      await prisma.userPosition.deleteMany({ where });
      await prisma.positionRole.deleteMany({ where });
      await prisma.position.deleteMany({ where });
      await prisma.department.deleteMany({ where });
      await prisma.user.deleteMany({ where });
      await prisma.organization.deleteMany({ where: { id: { in: organizations } } });
    } finally { await app?.close(); }
  });

  async function fixture() {
    const org = await prisma.organization.create({ data: { code: randomUUID(), name: 'Legacy HTTP isolation', type: 'INTERNAL' } });
    organizations.push(org.id);
    const permissions = await Promise.all(codes.map((code) => prisma.permission.upsert({ where: { code }, create: { code, name: code }, update: {} })));
    const adminRole = await prisma.role.create({ data: { organizationId: org.id, code: `ADMIN_${randomUUID()}`, name: 'Administrator', permissions: { create: permissions.map(({ id }) => ({ permissionId: id })) } } });
    const admin = await prisma.user.create({ data: { organizationId: org.id, username: randomUUID(), accountType: 'INTERNAL', passwordHash: 'test-only' } });
    await prisma.userRole.create({ data: { organizationId: org.id, userId: admin.id, roleId: adminRole.id } });
    const sessions = app.get(SessionService);
    const token = await sessions.create(admin.id, prisma, { mfaVerified: true, reauthenticated: true });
    const actor = { ...admin, sessionId: (await sessions.resolve(token))!.id };
    const user = await prisma.user.create({ data: { organizationId: org.id, username: randomUUID(), accountType: 'INTERNAL', passwordHash: 'test-only' } });
    const role = await prisma.role.create({ data: { organizationId: org.id, code: `LEGACY_${randomUUID()}`, name: 'Legacy role' } });
    const department = await prisma.department.create({ data: { organizationId: org.id, code: randomUUID(), name: 'Department' } });
    const position = await prisma.position.create({ data: { organizationId: org.id, departmentId: department.id, code: randomUUID(), name: 'Legacy position' } });
    return { org, actor, user, role, position, cookie: `qms_session=${token}; qms_csrf=${csrf}` };
  }
  type Fixture = Awaited<ReturnType<typeof fixture>>;
  type Operation = 'create' | 'copy' | 'update' | 'delete' | 'assign' | 'mapping';
  const operations: Operation[] = ['create', 'copy', 'update', 'delete', 'assign', 'mapping'];

  function input(f: Fixture, operation: Operation) {
    switch (operation) {
      case 'create': return { organizationId: f.org.id, code: 'FROZEN_CREATE', name: 'Frozen create', permissionCodes: [] };
      case 'copy': return { code: 'FROZEN_COPY', name: 'Frozen copy' };
      case 'update': return { name: 'Frozen update' };
      case 'delete': return {};
      case 'assign': return { roleIds: [f.role.id] };
      case 'mapping': return { roleIds: [f.role.id], expectedRoleVersion: 1 };
    }
  }
  function send(f: Fixture, operation: Operation, key: string) {
    const http = request(app.getHttpServer());
    const write = operation === 'create' ? http.post('/api/v1/admin/roles')
      : operation === 'copy' ? http.post(`/api/v1/admin/roles/${f.role.id}/copy`)
        : operation === 'update' ? http.patch(`/api/v1/admin/roles/${f.role.id}`)
          : operation === 'delete' ? http.delete(`/api/v1/admin/roles/${f.role.id}`)
            : operation === 'assign' ? http.put(`/api/v1/admin/users/${f.user.id}/roles`)
              : http.put(`/api/v1/organizations/${f.org.id}/positions/${f.position.id}/roles`);
    return write.set('Cookie', f.cookie).set('x-csrf-token', csrf).set('Idempotency-Key', key).send(input(f, operation));
  }

  async function seedReceipt(f: Fixture, operation: Operation, key: string) {
    const roles = app.get(AdminRoleService);
    const trace = randomUUID();
    switch (operation) {
      case 'create': return roles.create(f.actor, { organizationId: f.org.id, code: 'FROZEN_CREATE', name: 'Frozen create', permissionCodes: [] }, trace, key);
      case 'copy': return roles.copy(f.actor, f.role.id, { code: 'FROZEN_COPY', name: 'Frozen copy' }, trace, key);
      case 'update': return roles.update(f.actor, f.role.id, { name: 'Frozen update' }, trace, key);
      case 'delete': return roles.remove(f.actor, f.role.id, trace, key);
      case 'assign': return roles.assign(f.actor, f.user.id, { roleIds: [f.role.id] }, trace, key);
      case 'mapping': return app.get(OrganizationService).replacePositionRoles(f.actor, f.org.id, f.position.id, { roleIds: [f.role.id], expectedRoleVersion: 1 }, trace, key);
    }
  }

  async function snapshot(f: Fixture) {
    const where = { organizationId: f.org.id };
    return {
      roles: await prisma.role.findMany({ where, include: { permissions: true }, orderBy: { id: 'asc' } }),
      users: await prisma.user.findMany({ where, select: { id: true, securityVersion: true }, orderBy: { id: 'asc' } }),
      direct: await prisma.userRole.findMany({ where, orderBy: [{ userId: 'asc' }, { roleId: 'asc' }] }),
      mapping: await prisma.positionRole.findMany({ where, orderBy: [{ positionId: 'asc' }, { roleId: 'asc' }] }),
      positions: await prisma.position.findMany({ where, orderBy: { id: 'asc' } }),
      receipts: await prisma.adminMutation.findMany({ where, orderBy: { id: 'asc' } }),
    };
  }

  it.each(operations)('rejects a new legacy %s write without changing persisted authorization', async (operation) => {
    const f = await fixture();
    const before = await snapshot(f);
    const response = await send(f, operation, randomUUID()).expect(403);
    expect(response.body.code).toBe('FEATURE_PERMISSION_DENIED');
    expect(await snapshot(f)).toEqual(before);
    const audit = await prisma.auditEvent.findMany({ where: { organizationId: f.org.id, traceId: response.body.traceId, action: 'ACTION_REJECTED', outcome: 'DENIED' } });
    expect(audit).toHaveLength(1);
    expect(audit[0]!.metadata).toMatchObject({ reasonCode: 'FEATURE_PERMISSION_DENIED' });
  });

  it.each(operations)('rejects an existing successful legacy %s receipt before replay, preserving its original facts', async (operation) => {
    const f = await fixture();
    const key = randomUUID();
    await seedReceipt(f, operation, key);
    const before = await snapshot(f);
    expect(before.receipts).toHaveLength(1);
    const response = await send(f, operation, key).expect(403);
    expect(response.body.code).toBe('FEATURE_PERMISSION_DENIED');
    expect(await snapshot(f)).toEqual(before);
    const audit = await prisma.auditEvent.findMany({ where: { organizationId: f.org.id, traceId: response.body.traceId, action: 'ACTION_REJECTED', outcome: 'DENIED' } });
    expect(audit).toHaveLength(1);
    expect(audit[0]!.metadata).toMatchObject({ reasonCode: 'FEATURE_PERMISSION_DENIED' });
  });

  it('retains legacy role, catalog and assignment reads without implicit conversion', async () => {
    const f = await fixture();
    await prisma.userRole.create({ data: { organizationId: f.org.id, userId: f.user.id, roleId: f.role.id } });
    await prisma.positionRole.create({ data: { organizationId: f.org.id, positionId: f.position.id, roleId: f.role.id } });
    const before = await snapshot(f);
    for (const path of ['/api/v1/admin/roles', `/api/v1/admin/roles/${f.role.id}`, '/api/v1/admin/permission-catalog', `/api/v1/admin/users/${f.user.id}/roles`, `/api/v1/organizations/${f.org.id}/positions/${f.position.id}/roles`]) {
      await request(app.getHttpServer()).get(path).set('Cookie', f.cookie).expect(200);
    }
    expect(await snapshot(f)).toEqual(before);
  });

  it.each([150, 151, 200])('projects all %s position-name codepoints without changing the workflow role code', async (length) => {
    const f = await fixture();
    const name = 'P'.repeat(length - 1) + '\u{1F600}';
    await prisma.position.update({ where: { id: f.position.id }, data: { name } });
    await prisma.role.update({ where: { id: f.role.id }, data: { name: [...name].slice(0, 150).join('') } });
    await prisma.positionRole.create({ data: { organizationId: f.org.id, positionId: f.position.id, roleId: f.role.id, isCanonical: true } });
    const directory = await request(app.getHttpServer()).get('/api/v1/admin/roles').query({ organizationId: f.org.id }).set('Cookie', f.cookie).expect(200);
    expect(directory.body.some((role: { id: string }) => role.id === f.role.id)).toBe(false);
    const options = await app.get(WorkflowDefinitionService).options(f.actor, {});
    expect(options.roles.find(({ code }) => code === f.role.code)).toEqual({ code: f.role.code, name });
  });

  it('searches full canonical names, retains independent role labels and isolates organizations and option domains', async () => {
    const f = await fixture();
    const foreign = await fixture();
    const name = 'P'.repeat(150) + 'FULL_NAME_SUFFIX';
    await prisma.position.update({ where: { id: f.position.id }, data: { name } });
    await prisma.role.update({ where: { id: f.role.id }, data: { name: 'P'.repeat(150) } });
    await prisma.positionRole.create({ data: { organizationId: f.org.id, positionId: f.position.id, roleId: f.role.id, isCanonical: true } });
    await prisma.role.update({ where: { id: foreign.role.id }, data: { name: 'FULL_NAME_SUFFIX' } });
    const legacy = await prisma.role.create({ data: { organizationId: f.org.id, code: `OLD_${randomUUID()}`, name: 'FULL_NAME_SUFFIX legacy' } });
    const service = app.get(WorkflowDefinitionService);
    const searched = await service.options(f.actor, { search: 'FULL_NAME_SUFFIX' });
    expect(searched.roles).toEqual(expect.arrayContaining([{ code: f.role.code, name }, { code: legacy.code, name: legacy.name }]));
    expect(searched.roles).toHaveLength(2);
    expect(searched.users).toEqual([]);
    expect(searched.permissions).toEqual([]);
    const limited = await service.options(f.actor, { search: 'FULL_NAME_SUFFIX', limit: 1 });
    expect(limited.roles).toHaveLength(1);
    expect(limited.roles[0]).toEqual([...searched.roles].sort((a, b) => a.code.localeCompare(b.code))[0]);
  });
});
