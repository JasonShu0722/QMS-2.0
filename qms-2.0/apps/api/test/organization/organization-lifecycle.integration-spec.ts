import 'reflect-metadata';
import { jest } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { Client } from 'pg';
import { Test } from '@nestjs/testing';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../../src/app.module.js';
import { PrismaService } from '../../src/database/prisma.service.js';
import { Prisma } from '../../src/generated/prisma/client.js';
import { GlobalExceptionFilter } from '../../src/common/contracts/global-exception.filter.js';
import { SessionService } from '../../src/modules/identity/session.service.js';
import { AuditLogService } from '../../src/modules/audit-log/audit-log.service.js';
import { ADMIN_PERMISSIONS } from '../../src/modules/authorization/permission-catalog.js';
import { OrganizationService } from '../../src/modules/organization/organization.service.js';
import { ComponentProjectService } from '../../src/modules/platform-configuration/component-project.service.js';
import { structureReferenceLiveCondition } from '../../src/modules/organization/organization-lifecycle.read-model.js';
import { SupplierConcessionService } from '../../src/modules/supplier-concession/supplier-concession.service.js';
import { SupplierMeetingsService } from '../../src/modules/supplier-meetings/supplier-meetings.service.js';
import { CustomerQualityService } from '../../src/modules/customer-quality/customer-quality.service.js';
import { CustomerComplaintProcessingService } from '../../src/modules/customer-quality/customer-complaint-processing.service.js';

const connection = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL) : undefined;
if (!connection || process.env.QMS_DISPOSABLE_TEST_DB !== 'true'
  || !['postgres:', 'postgresql:'].includes(connection.protocol)
  || !['localhost', '127.0.0.1', '[::1]'].includes(connection.hostname)
  || connection.port === '55440' || connection.search || connection.hash) {
  throw new Error('Organization lifecycle requires disposable loopback PostgreSQL, never preview 55440.');
}
jest.setTimeout(120_000);

describe('N1 organization lifecycle with real PostgreSQL', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let exceptions: GlobalExceptionFilter;
  const failures: unknown[] = [];
  const csrf = randomUUID();
  beforeAll(async () => {
    app = (await Test.createTestingModule({ imports: [AppModule] }).compile()).createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    exceptions = new GlobalExceptionFilter();
    const originalCatch = exceptions.catch.bind(exceptions);
    exceptions.catch = (error, host) => { failures.push(error); originalCatch(error, host); };
    app.useGlobalFilters(exceptions);
    await app.init();
    prisma = app.get(PrismaService);
  });
  afterAll(async () => { await app?.close(); });

  async function legacyInitialization(organizationId: string) {
    // Model the old transaction-default timestamps explicitly; current creation has independent statement timestamps.
    const { createdAt } = await prisma.organization.findUniqueOrThrow({ where: { id: organizationId } });
    await prisma.$executeRaw`DELETE FROM organization_initializations WHERE organization_id = ${organizationId}::uuid`;
    await prisma.role.updateMany({ where: { organizationId }, data: { createdAt } });
    await prisma.auditEvent.updateMany({ where: { resourceId: organizationId, action: 'ORGANIZATION_CREATED' }, data: { createdAt, metadata: { resourceVersion: 1 } } });
    await prisma.adminMutation.updateMany({ where: { action: 'ORGANIZATION_CREATED', response: { path: ['value', 'id'], equals: organizationId } }, data: { createdAt } });
  }

  async function fixture(codes = [...new Set([...ADMIN_PERMISSIONS, 'organization:read'])]) {
    const root = await prisma.organization.create({ data: { code: randomUUID(), name: 'N1 root', type: 'INTERNAL' } });
    const actor = await prisma.user.create({ data: { organizationId: root.id, username: randomUUID(), accountType: 'INTERNAL', passwordHash: 'test-only' } });
    const permissions = await Promise.all(codes.map((code) => prisma.permission.upsert({ where: { code }, create: { code, name: code }, update: {} })));
    const role = await prisma.role.create({ data: { organizationId: root.id, code: randomUUID(), name: 'N1 governor', permissions: { create: permissions.map(({ id }) => ({ permissionId: id })) } } });
    await prisma.userRole.create({ data: { userId: actor.id, organizationId: root.id, roleId: role.id } });
    const token = await app.get(SessionService).create(actor.id, prisma, { mfaVerified: true, reauthenticated: true });
    const cookie = `qms_session=${token}; qms_csrf=${csrf}`;
    const send = (method: 'get' | 'post' | 'patch' | 'delete', path: string, body = {}, key = randomUUID()) =>
      request(app.getHttpServer())[method](`/api/v1/organizations${path}`).set('Cookie', cookie).set('x-csrf-token', csrf).set('Idempotency-Key', key).send(body);
    const child = async () => (await send('post', `/${root.id}/children`, { code: randomUUID(), name: 'N1 empty child' }).expect(201)).body as { id: string; code: string; name: string; version: number };
    const department = async (organizationId = root.id) => (await send('post', `/${organizationId}/departments`, { code: randomUUID(), name: 'N1 empty department' }).expect(201)).body as { id: string; code: string; name: string; version: number };
    const sessionId = (await app.get(SessionService).resolve(token))!.id;
    return { root, actor, role, send, child, department, cookie, sessionId };
  }

  async function manager(f: Awaited<ReturnType<typeof fixture>>, platform: boolean, targetId?: string) {
    const user = await prisma.user.create({ data: { organizationId: f.root.id, username: randomUUID(), accountType: 'INTERNAL', passwordHash: 'test-only' } });
    const codes = platform ? ['platform:admin'] : ['organization:read', 'organization:manage'];
    const permissions = await Promise.all(codes.map(code => prisma.permission.upsert({ where: { code }, create: { code, name: code }, update: {} })));
    const role = await prisma.role.create({ data: { organizationId: f.root.id, code: randomUUID(), name: 'REQ0030 manager', permissions: { create: permissions.map(({ id }) => ({ permissionId: id })) } } });
    await prisma.userRole.create({ data: { userId: user.id, organizationId: f.root.id, roleId: role.id } });
    if (targetId) await prisma.userRole.create({ data: { userId: user.id, organizationId: targetId, roleId: role.id } });
    const token = await app.get(SessionService).create(user.id, prisma, { mfaVerified: true, reauthenticated: true });
    const send = (method: 'get' | 'delete', targetId: string, body = {}, key = randomUUID()) => request(app.getHttpServer())[method](`/api/v1/organizations/${targetId}${method === 'get' ? '/lifecycle' : ''}`)
      .set('Cookie', `qms_session=${token}; qms_csrf=${csrf}`).set('x-csrf-token', csrf).set('Idempotency-Key', key).send(body);
    return { user, role, send };
  }

  it.each([false, true])('REQ0030 deletes verified old/new initialization by another explicit platform admin (legacy=%s)', async legacy => {
    const f = await fixture();
    const org = await f.child();
    if (legacy) await legacyInitialization(org.id);
    await f.send('patch', `/${org.id}`, { expectedVersion: 1, name: 'Creator corrected typo' }).expect(200);
    const before = await prisma.auditEvent.findMany({ where: { organizationId: org.id } });
    const originalReceipt = await prisma.adminMutation.findFirstOrThrow({ where: { organizationId: f.root.id, action: 'ORGANIZATION_CREATED', response: { path: ['value', 'id'], equals: org.id } } });
    const admin = await manager(f, true);
    expect((await admin.send('get', org.id).expect(200)).body.deleteBlockers).toEqual([]);
    const key = randomUUID();
    await admin.send('delete', org.id, { expectedVersion: 2 }, key).expect(200);
    await admin.send('delete', org.id, { expectedVersion: 2 }, key).expect(200);
    expect(await prisma.organization.findUnique({ where: { id: org.id } })).toBeNull();
    expect(await prisma.userRole.count({ where: { organizationId: org.id } })).toBe(0);
    expect(await prisma.role.count({ where: { organizationId: org.id } })).toBe(0);
    expect(await prisma.userRole.count({ where: { userId: admin.user.id, roleId: admin.role.id } })).toBe(1);
    expect(await prisma.adminMutation.findUniqueOrThrow({ where: { id: originalReceipt.id } })).toEqual(originalReceipt);
    for (const event of before) expect(await prisma.auditEvent.findUniqueOrThrow({ where: { id: event.id } })).toMatchObject({ ...event, organizationId: f.root.id, metadata: { ...event.metadata as object, organizationId: org.id } });
    expect(await prisma.auditEvent.count({ where: { resourceId: org.id, action: 'ORGANIZATION_DELETED', actorUserId: admin.user.id } })).toBe(1);
  });

  it('REQ0030 permits the original creator with legacy provenance without any platform marker', async () => {
    const f = await fixture();
    const org = await f.child();
    await legacyInitialization(org.id);
    await f.send('delete', `/${org.id}`, { expectedVersion: 1 }).expect(200);
    expect(await prisma.auditEvent.findFirstOrThrow({ where: { resourceId: org.id, action: 'ORGANIZATION_CREATED' } })).toMatchObject({ organizationId: f.root.id, actorUserId: f.actor.id, metadata: { resourceVersion: 1, organizationId: org.id } });
  });

  it('REQ0030 rejects an ordinary other manager and preserves the original creator grant', async () => {
    const f = await fixture();
    const org = await f.child();
    const admin = await manager(f, false, org.id);
    const before = await prisma.userRole.findMany({ where: { organizationId: org.id }, orderBy: [{ userId: 'asc' }, { roleId: 'asc' }] });
    const lifecycle = (await admin.send('get', org.id).expect(200)).body;
    expect(lifecycle.deleteBlockers).toContain('存在无法识别为初始化的实际角色或授权');
    expect(lifecycle.deleteBlockerDetails).toContainEqual(expect.objectContaining({ code: 'NON_INITIALIZATION_GRANTS', count: 1 }));
    await admin.send('delete', org.id, { expectedVersion: 1 }).expect(409);
    expect(await prisma.userRole.findMany({ where: { organizationId: org.id }, orderBy: [{ userId: 'asc' }, { roleId: 'asc' }] })).toEqual(before);
  });

  it.each(['missing-receipt', 'partial-modern', 'changed-permissions'] as const)('REQ0030 refuses legacy initialization with %s even for explicit platform admins', async kind => {
    const f = await fixture();
    const org = await f.child();
    await legacyInitialization(org.id);
    if (kind === 'partial-modern') await prisma.auditEvent.updateMany({ where: { resourceId: org.id, action: 'ORGANIZATION_CREATED' }, data: { metadata: { resourceVersion: 1, organizationId: org.id } } });
    if (kind === 'missing-receipt') await prisma.adminMutation.deleteMany({ where: { organizationId: f.root.id, action: 'ORGANIZATION_CREATED', response: { path: ['value', 'id'], equals: org.id } } });
    if (kind === 'changed-permissions') {
      const governor = await prisma.role.findFirstOrThrow({ where: { organizationId: org.id } });
      const permission = await prisma.permission.findUniqueOrThrow({ where: { code: 'organization:structure:read' } });
      await prisma.rolePermission.delete({ where: { roleId_permissionId: { roleId: governor.id, permissionId: permission.id } } });
    }
    const admin = await manager(f, true);
    const reason = kind === 'changed-permissions' ? 'INITIALIZATION_PERMISSIONS_CHANGED' : 'NON_INITIALIZATION_ROLES';
    expect((await admin.send('get', org.id).expect(200)).body.deleteBlockerDetails).toContainEqual(expect.objectContaining({ code: reason, count: 1 }));
    await admin.send('delete', org.id, { expectedVersion: 1 }).expect(409);
    expect(await prisma.organization.findUniqueOrThrow({ where: { id: org.id } })).toMatchObject({ version: 1 });
  });

  it('REQ0030 reports exact business reference counts while keeping real usage undeletable', async () => {
    const f = await fixture();
    const org = await f.child();
    await prisma.materialMaster.create({ data: { organizationId: org.id, materialCode: randomUUID(), materialName: 'Retained material', createdById: f.actor.id, updatedById: f.actor.id } });
    const lifecycle = (await f.send('get', `/${org.id}/lifecycle`).expect(200)).body;
    expect(lifecycle.deleteBlockers).toContain('存在业务、配置或历史引用');
    expect(lifecycle.deleteBlockerDetails).toContainEqual(expect.objectContaining({ code: 'REFERENCE:material_masters.organization_id', count: 1 }));
    await f.send('delete', `/${org.id}`, { expectedVersion: 1 }).expect(409);
    expect(await prisma.materialMaster.count({ where: { organizationId: org.id } })).toBe(1);
  });

  it('REQ0030 rolls back a noncreator platform-admin deletion if audit persistence fails', async () => {
    const f = await fixture();
    const org = await f.child();
    const admin = await manager(f, true);
    const before = await prisma.auditEvent.findMany({ where: { organizationId: org.id }, orderBy: { id: 'asc' } });
    const key = randomUUID();
    const failure = jest.spyOn(app.get(AuditLogService), 'record').mockRejectedValueOnce(new Error('REQ0030 archive rollback'));
    try { await admin.send('delete', org.id, { expectedVersion: 1 }, key).expect(500); } finally { failure.mockRestore(); }
    expect(await prisma.organization.findUniqueOrThrow({ where: { id: org.id } })).toMatchObject({ version: 1 });
    expect(await prisma.userRole.count({ where: { organizationId: org.id, userId: f.actor.id } })).toBe(1);
    expect(await prisma.auditEvent.findMany({ where: { organizationId: org.id }, orderBy: { id: 'asc' } })).toEqual(before);
    expect(await prisma.adminMutation.count({ where: { key } })).toBe(0);
    await admin.send('delete', org.id, { expectedVersion: 1 }, key).expect(200);
  });

  it('REQ0030 rejects a waiting noncreator deletion after its explicit platform grant is revoked', async () => {
    const f = await fixture();
    const org = await f.child();
    const admin = await manager(f, true);
    const key = randomUUID();
    const blocker = new Client({ connectionString: process.env.DATABASE_URL });
    await blocker.connect();
    let deletion: Promise<request.Response> | undefined;
    try {
      await blocker.query('BEGIN');
      const { rows: [{ pid }] } = await blocker.query('SELECT pg_backend_pid() AS pid');
      await blocker.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [admin.user.id]);
      deletion = admin.send('delete', org.id, { expectedVersion: 1 }, key).then(response => response);
      await waitBlocked(pid);
      await blocker.query('DELETE FROM user_roles WHERE user_id = $1', [admin.user.id]);
      await blocker.query('UPDATE users SET security_version = security_version + 1 WHERE id = $1', [admin.user.id]);
      await blocker.query('COMMIT');
      expect([401, 403, 409]).toContain((await deletion).status);
      expect(await prisma.organization.findUniqueOrThrow({ where: { id: org.id } })).toMatchObject({ version: 1 });
      expect(await prisma.userRole.count({ where: { organizationId: org.id, userId: f.actor.id } })).toBe(1);
      expect(await prisma.adminMutation.count({ where: { key } })).toBe(0);
      expect(await prisma.auditEvent.count({ where: { resourceId: org.id, action: 'ORGANIZATION_DELETED' } })).toBe(0);
    } finally { await blocker.query('ROLLBACK'); await blocker.end(); await deletion; }
  });

  it('edits organization and department code on the original ID, audits old/new values and enforces version/uniqueness', async () => {
    const f = await fixture();
    const org = await f.child();
    const dep = await f.department(org.id);
    const other = await f.child();
    const orgCode = `ORG-${randomUUID()}`;
    const depCode = `DEP-${randomUUID()}`;
    expect((await f.send('patch', `/${org.id}`, { expectedVersion: 1, code: orgCode, name: 'Corrected organization' }).expect(200)).body).toMatchObject({ id: org.id, code: orgCode, version: 2 });
    expect((await f.send('patch', `/${org.id}/departments/${dep.id}`, { expectedVersion: 1, code: depCode, name: 'Corrected department' }).expect(200)).body).toMatchObject({ id: dep.id, code: depCode, version: 2 });
    await f.send('patch', `/${org.id}`, { expectedVersion: 1, code: randomUUID() }).expect(409);
    expect((await f.send('patch', `/${org.id}`, { expectedVersion: 2, code: other.code }).expect(409)).body.code).toBe('STRUCTURE_DUPLICATE');
    const sibling = await f.department(org.id);
    expect((await f.send('patch', `/${org.id}/departments/${dep.id}`, { expectedVersion: 2, code: sibling.code }).expect(409)).body.code).toBe('STRUCTURE_DUPLICATE');
    const events = await prisma.auditEvent.findMany({ where: { resourceId: { in: [org.id, dep.id] }, action: { in: ['ORGANIZATION_UPDATED', 'DEPARTMENT_UPDATED'] } } });
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ resourceId: org.id, metadata: expect.objectContaining({ structurePreviousCode: org.code, structureCode: orgCode, structurePreviousName: org.name, structureName: 'Corrected organization', resourceVersion: 2 }) }),
      expect.objectContaining({ resourceId: dep.id, metadata: expect.objectContaining({ structurePreviousCode: dep.code, structureCode: depCode, structurePreviousName: dep.name, structureName: 'Corrected department', resourceVersion: 2 }) }),
    ]));
    expect(await prisma.department.findUniqueOrThrow({ where: { id: dep.id } })).toMatchObject({ organizationId: org.id, code: depCode, version: 2 });
  });

  it('physically deletes an empty department, preserves audit and replays exactly once', async () => {
    const f = await fixture();
    const dep = await f.department();
    expect((await f.send('get', `/${f.root.id}/departments/${dep.id}/lifecycle`).expect(200)).body).toEqual({ deleteBlockers: [], disableBlockers: [] });
    const key = randomUUID();
    const path = `/${f.root.id}/departments/${dep.id}`;
    const deleted = (await f.send('delete', path, { expectedVersion: 1 }, key).expect(200)).body;
    expect(deleted).toEqual({ id: dep.id, deleted: true });
    expect(await prisma.department.findUnique({ where: { id: dep.id } })).toBeNull();
    expect((await f.send('delete', path, { expectedVersion: 1 }, key).expect(200)).body).toEqual(deleted);
    await f.send('delete', path, { expectedVersion: 2 }, key).expect(409);
    await f.send('delete', path, { expectedVersion: 1 }).expect(404);
    const events = await prisma.auditEvent.findMany({ where: { resourceId: dep.id } });
    expect(events.some(({ action }) => action === 'DEPARTMENT_CREATED')).toBe(true);
    expect(events.filter(({ action }) => action === 'DEPARTMENT_DELETED')).toHaveLength(1);
    expect(events.find(({ action }) => action === 'DEPARTMENT_DELETED')).toMatchObject({ organizationId: f.root.id, metadata: { structureCode: dep.code, structureName: dep.name, resourceVersion: 1 } });
  });

  it('quality P2 rejects replaying a department creation receipt after that department was deleted', async () => {
    const f = await fixture();
    const key = randomUUID();
    const dto = { code: randomUUID(), name: 'Department creation replay' };
    const path = `/${f.root.id}/departments`;
    const department = (await f.send('post', path, dto, key).expect(201)).body;
    expect((await f.send('post', path, dto, key).expect(201)).body).toEqual(department);
    await f.send('delete', `${path}/${department.id}`, { expectedVersion: 1 }).expect(200);
    await f.send('post', path, dto, key).expect(409);
    expect(await prisma.department.count({ where: { organizationId: f.root.id, code: dto.code } })).toBe(0);
    expect(await prisma.auditEvent.count({ where: { resourceId: department.id, action: 'DEPARTMENT_CREATED' } })).toBe(1);
  });

  it('quality P2 excludes withdrawn supplier concessions from live references while retaining other organization blockers', async () => {
    const f = await fixture([...ADMIN_PERMISSIONS, 'organization:read', 'supplier-concession:requests:write', 'supplier-incoming:inspections:read']);
    const org = await f.child();
    const governor = await prisma.role.findFirstOrThrow({ where: { organizationId: org.id, code: 'ORGANIZATION_GOVERNOR' } });
    const permissions = await prisma.permission.findMany({ where: { code: { in: ['supplier-concession:requests:write', 'supplier-incoming:inspections:read'] } } });
    await prisma.rolePermission.createMany({ data: permissions.map(({ id }) => ({ roleId: governor.id, permissionId: id })) });
    const profile = await prisma.supplierBusinessProfile.create({ data: { ownerOrganizationId: org.id, businessCode: randomUUID(), displayName: 'Independent concession supplier' } });
    const inspectionId = randomUUID();
    await prisma.$executeRaw`
      INSERT INTO supplier_incoming_inspections (id, owner_organization_id, profile_id, supplier_organization_id,
        supplier_business_code, supplier_name, material_code, incoming_batch, received_quantity, sampled_quantity,
        conclusion, status, inspector_id, source_system, source_snapshot, inspected_at, created_by_id)
      VALUES (${inspectionId}::uuid, ${org.id}::uuid, ${profile.id}::uuid, NULL,
        ${profile.businessCode}, ${profile.displayName}, 'N1-CONCESSION', 'N1-BATCH', 100, 10,
        'NG', 'COMPLETED', ${f.actor.id}::uuid, 'MANUAL', '{}'::jsonb, CURRENT_TIMESTAMP, ${f.actor.id}::uuid)`;
    const actor = { id: f.actor.id, organizationId: f.root.id, scopeOrganizationId: org.id, accountType: 'INTERNAL' as const, sessionId: f.sessionId };
    const service = app.get(SupplierConcessionService);
    const concession = await service.create(actor, { inspectionId, quantity: 10, reason: 'Lifecycle regression', expiresAt: new Date(Date.now() + 86400000) }, randomUUID(), randomUUID());
    const approver = await prisma.user.create({ data: { organizationId: f.root.id, username: randomUUID(), accountType: 'INTERNAL', passwordHash: 'test-only' } });
    // The real profile remains live, so test the same SQL predicate per request without hiding dependencies.
    const reference = () => prisma.$queryRaw<{ id: string; status: string; live: boolean }[]>`
      SELECT t.id, t.status, (${structureReferenceLiveCondition('supplier_concession_requests')}) AS live
      FROM supplier_concession_requests t WHERE t.id = ${concession.id}::uuid`;
    for (const status of ['DRAFT', 'SUBMITTED', 'APPROVED', 'RELEASED', 'REJECTED']) {
      await prisma.$executeRaw`
        UPDATE supplier_concession_requests SET status = ${status}, approved_by_id = ${approver.id}::uuid,
          approved_at = CURRENT_TIMESTAMP, released_by_id = ${approver.id}::uuid, released_at = CURRENT_TIMESTAMP
        WHERE id = ${concession.id}::uuid`;
      expect(await reference()).toEqual([{ id: concession.id, status, live: status !== 'REJECTED' }]);
    }
    await prisma.$executeRaw`
      UPDATE supplier_concession_requests SET status = 'DRAFT', approved_by_id = NULL, approved_at = NULL,
        released_by_id = NULL, released_at = NULL WHERE id = ${concession.id}::uuid`;
    expect(await service.withdraw(actor, concession.id, { expectedVersion: 1 }, randomUUID(), randomUUID())).toMatchObject({ id: concession.id, status: 'WITHDRAWN', version: 2 });
    expect(await reference()).toEqual([{ id: concession.id, status: 'WITHDRAWN', live: false }]);
    const retained = await prisma.$queryRaw`SELECT * FROM supplier_concession_requests WHERE id = ${concession.id}::uuid`;
    const lifecycle = (await f.send('get', `/${org.id}/lifecycle`).expect(200)).body;
    expect(lifecycle.disableBlockers).toContain('存在有效配置或在途业务引用');
    expect(lifecycle.deleteBlockers).toContain('存在业务、配置或历史引用');
    await f.send('patch', `/${org.id}`, { expectedVersion: 1, status: 'DISABLED' }).expect(409);
    await f.send('delete', `/${org.id}`, { expectedVersion: 1 }).expect(409);
    expect(await prisma.organization.findUniqueOrThrow({ where: { id: org.id } })).toMatchObject({ status: 'ACTIVE', version: 1 });
    expect(await prisma.$queryRaw`SELECT * FROM supplier_concession_requests WHERE id = ${concession.id}::uuid`).toEqual(retained);
    expect(await prisma.supplierBusinessProfile.findUniqueOrThrow({ where: { id: profile.id } })).toEqual(profile);
    expect(await prisma.$queryRaw`SELECT id, status FROM supplier_incoming_inspections WHERE id = ${inspectionId}::uuid`).toEqual([{ id: inspectionId, status: 'COMPLETED' }]);
    expect(await prisma.$queryRaw`SELECT event_type, request_version FROM supplier_concession_events WHERE request_id = ${concession.id}::uuid ORDER BY request_version`).toEqual([{ event_type: 'CREATED', request_version: 1 }, { event_type: 'WITHDRAWN', request_version: 2 }]);
  });

  it('fix3 treats completed and corrected incoming inspections as history while keeping drafts live', async () => {
    const f = await fixture();
    const org = await f.child();
    const supplier = await prisma.organization.create({ data: { code: randomUUID(), name: 'Inspection supplier', type: 'SUPPLIER' } });
    const profile = await prisma.supplierBusinessProfile.create({ data: { ownerOrganizationId: org.id, supplierOrganizationId: supplier.id, businessCode: randomUUID(), displayName: 'Inspection history supplier' } });
    const id = randomUUID();
    await prisma.$executeRaw`
      INSERT INTO supplier_incoming_inspections (id, owner_organization_id, profile_id, supplier_organization_id,
        supplier_business_code, supplier_name, material_code, incoming_batch, received_quantity, sampled_quantity,
        inspector_id, created_by_id)
      VALUES (${id}::uuid, ${org.id}::uuid, ${profile.id}::uuid, ${supplier.id}::uuid,
        ${profile.businessCode}, ${profile.displayName}, 'N1-INCOMING', 'N1-BATCH', 100, 10,
        ${f.actor.id}::uuid, ${f.actor.id}::uuid)`;
    for (const status of ['DRAFT', 'COMPLETED', 'CORRECTED']) {
      await prisma.$executeRaw`
        UPDATE supplier_incoming_inspections SET status = ${status}, conclusion = 'PASS',
          inspected_at = CURRENT_TIMESTAMP, correction_reason = 'Lifecycle correction'
        WHERE id = ${id}::uuid`;
      expect(await prisma.$queryRaw`
        SELECT t.status, (${structureReferenceLiveCondition('supplier_incoming_inspections')}) AS live
        FROM supplier_incoming_inspections t WHERE t.id = ${id}::uuid`
      ).toEqual([{ status, live: status === 'DRAFT' }]);
      if (status === 'DRAFT') await f.send('patch', `/${org.id}`, { expectedVersion: 1, status: 'DISABLED' }).expect(409);
    }
    const retained = await prisma.$queryRaw`SELECT * FROM supplier_incoming_inspections WHERE id = ${id}::uuid`;
    // The valid supplier profile remains an independent live dependency.
    expect((await f.send('get', `/${org.id}/lifecycle`).expect(200)).body).toMatchObject({
      disableBlockers: expect.arrayContaining(['存在有效配置或在途业务引用']),
      deleteBlockers: expect.arrayContaining(['存在业务、配置或历史引用']),
    });
    await f.send('patch', `/${org.id}`, { expectedVersion: 1, status: 'DISABLED' }).expect(409);
    await f.send('delete', `/${org.id}`, { expectedVersion: 1 }).expect(409);
    expect(await prisma.$queryRaw`SELECT * FROM supplier_incoming_inspections WHERE id = ${id}::uuid`).toEqual(retained);
    expect(await prisma.supplierBusinessProfile.findUniqueOrThrow({ where: { id: profile.id } })).toEqual(profile);
  });

  it('fix3 treats accepted and rejected performance appeals as history while keeping undecided appeals live', async () => {
    const f = await fixture();
    const org = await f.child();
    const supplier = await prisma.organization.create({ data: { code: randomUUID(), name: 'Appeal supplier', type: 'SUPPLIER' } });
    const profile = await prisma.supplierBusinessProfile.create({ data: { ownerOrganizationId: org.id, supplierOrganizationId: supplier.id, businessCode: randomUUID(), displayName: 'Appeal history supplier' } });
    const cardId = randomUUID();
    await prisma.$executeRaw`
      INSERT INTO supplier_performance_cards (id, owner_organization_id, profile_id, supplier_organization_id,
        supplier_name, score_month, inspection_count, pass_count, incoming_score, cooperation_score,
        incoming_weight, cooperation_weight, cooperation_note, total_score, source_inspections, created_by_id,
        status, published_by_id, published_at)
      VALUES (${cardId}::uuid, ${org.id}::uuid, ${profile.id}::uuid, ${supplier.id}::uuid,
        ${profile.displayName}, '2026-10-01'::date, 1, 1, 100, 100, 50, 50, 'Lifecycle score', 100, '[]'::jsonb,
        ${f.actor.id}::uuid, 'PUBLISHED', ${f.actor.id}::uuid, CURRENT_TIMESTAMP)`;
    const id = randomUUID();
    await prisma.$executeRaw`
      INSERT INTO supplier_performance_appeals (id, owner_organization_id, card_id, supplier_organization_id, reason, created_by_id)
      VALUES (${id}::uuid, ${org.id}::uuid, ${cardId}::uuid, ${supplier.id}::uuid, 'Lifecycle appeal', ${f.actor.id}::uuid)`;
    for (const status of ['DRAFT', 'SUBMITTED', 'REJECTED', 'ACCEPTED']) {
      await prisma.$executeRaw`
        UPDATE supplier_performance_appeals SET status = ${status}, decision_note = 'Lifecycle decision',
          decided_by_id = ${f.actor.id}::uuid, decided_at = CURRENT_TIMESTAMP WHERE id = ${id}::uuid`;
      expect(await prisma.$queryRaw`
        SELECT t.status, (${structureReferenceLiveCondition('supplier_performance_appeals')}) AS live
        FROM supplier_performance_appeals t WHERE t.id = ${id}::uuid`
      ).toEqual([{ status, live: ['DRAFT', 'SUBMITTED'].includes(status) }]);
      if (['DRAFT', 'SUBMITTED'].includes(status)) await f.send('patch', `/${org.id}`, { expectedVersion: 1, status: 'DISABLED' }).expect(409);
    }
    const retained = await prisma.$queryRaw`SELECT * FROM supplier_performance_appeals WHERE id = ${id}::uuid`;
    const card = await prisma.$queryRaw`SELECT * FROM supplier_performance_cards WHERE id = ${cardId}::uuid`;
    expect((await f.send('get', `/${org.id}/lifecycle`).expect(200)).body).toMatchObject({
      disableBlockers: expect.arrayContaining(['存在有效配置或在途业务引用']),
      deleteBlockers: expect.arrayContaining(['存在业务、配置或历史引用']),
    });
    await f.send('patch', `/${org.id}`, { expectedVersion: 1, status: 'DISABLED' }).expect(409);
    await f.send('delete', `/${org.id}`, { expectedVersion: 1 }).expect(409);
    expect(await prisma.$queryRaw`SELECT * FROM supplier_performance_appeals WHERE id = ${id}::uuid`).toEqual(retained);
    expect(await prisma.$queryRaw`SELECT * FROM supplier_performance_cards WHERE id = ${cardId}::uuid`).toEqual(card);
    expect(await prisma.supplierBusinessProfile.findUniqueOrThrow({ where: { id: profile.id } })).toEqual(profile);
  });

  it.each(['PASSED', 'REJECTED'])('fix3 keeps %s stage review history without hiding open stages or active projects', async (status) => {
    const f = await fixture();
    const org = await f.child();
    const projectId = randomUUID();
    const id = randomUUID();
    await prisma.$executeRaw`
      INSERT INTO new_product_projects (id, organization_id, code, name, product_code, created_by_id)
      VALUES (${projectId}::uuid, ${org.id}::uuid, ${randomUUID()}, 'Lifecycle project', 'N1-PRODUCT', ${f.actor.id}::uuid)`;
    await prisma.$executeRaw`
      INSERT INTO new_product_stages (id, organization_id, project_id, code, name, created_by_id)
      VALUES (${id}::uuid, ${org.id}::uuid, ${projectId}::uuid, 'REVIEW', 'Lifecycle review', ${f.actor.id}::uuid)`;
    const reference = () => prisma.$queryRaw`
      SELECT t.status, (${structureReferenceLiveCondition('new_product_stages')}) AS live
      FROM new_product_stages t WHERE t.id = ${id}::uuid`;
    expect(await reference()).toEqual([{ status: 'OPEN', live: true }]);
    await f.send('patch', `/${org.id}`, { expectedVersion: 1, status: 'DISABLED' }).expect(409);
    await prisma.$executeRaw`
      UPDATE new_product_stages SET status = ${status}, reviewed_by_id = ${f.actor.id}::uuid,
        reviewed_at = CURRENT_TIMESTAMP, version = 2 WHERE id = ${id}::uuid`;
    expect(await reference()).toEqual([{ status, live: false }]);
    const retained = await prisma.$queryRaw`SELECT * FROM new_product_stages WHERE id = ${id}::uuid`;
    // Finishing the stage does not finish the independently active project.
    expect((await f.send('get', `/${org.id}/lifecycle`).expect(200)).body.disableBlockers).toContain('存在有效配置或在途业务引用');
    await f.send('patch', `/${org.id}`, { expectedVersion: 1, status: 'DISABLED' }).expect(409);
    await prisma.$executeRaw`UPDATE new_product_projects SET status = 'ARCHIVED' WHERE id = ${projectId}::uuid`;
    expect((await f.send('get', `/${org.id}/lifecycle`).expect(200)).body).toEqual({
      disableBlockers: [], deleteBlockers: ['存在业务、配置或历史引用'],
      deleteBlockerDetails: ['new_product_projects', 'new_product_stages'].map(table => ({ code: `REFERENCE:${table}.organization_id`, count: 1, message: expect.any(String) })),
    });
    await f.send('patch', `/${org.id}`, { expectedVersion: 1, status: 'DISABLED' }).expect(200);
    await f.send('delete', `/${org.id}`, { expectedVersion: 2 }).expect(409);
    expect(await prisma.$queryRaw`SELECT * FROM new_product_stages WHERE id = ${id}::uuid`).toEqual(retained);
    expect(await prisma.$queryRaw`SELECT status FROM new_product_projects WHERE id = ${projectId}::uuid`).toEqual([{ status: 'ARCHIVED' }]);
  });

  it.each([
    ['customer_quality_physical_dispositions', ['PENDING', 'RECEIVED', 'REPAIRED', 'SCRAPPED'], 'CLOSED'],
    ['customer_quality_physical_analyses', ['MISSING', 'IN_PROGRESS'], 'COMPLETED'],
  ] as const)('fix3 evaluates only the latest %s version per organization and complaint while retaining all history', async (tableName, activeStatuses, terminal) => {
    const f = await fixture();
    const org = await f.child();
    const otherOrg = await f.child();
    const table = Prisma.raw(`"${tableName}"`);
    const complaint = async (organizationId: string) => {
      const customer = await prisma.customerQualityCustomer.create({ data: { organizationId, code: randomUUID(), name: 'Historical customer', active: false, createdById: f.actor.id, updatedById: f.actor.id } });
      return prisma.customerQualityComplaint.create({ data: { organizationId, customerId: customer.id, complaintNumber: randomUUID(), complaintType: 'ZERO_KM', defectDescription: 'Version history', severity: 'LOW', severityPolicyVersion: 'v1', severitySnapshot: {}, status: 'ARCHIVED', archivedAt: new Date(), createdById: f.actor.id, updatedById: f.actor.id } });
    };
    const append = async (record: { id: string; organizationId: string }, status: string, version: number) => {
      const content = tableName === 'customer_quality_physical_dispositions'
        ? Prisma.sql`action, notes` : Prisma.sql`summary, evidence_summary`;
      const value = tableName === 'customer_quality_physical_dispositions'
        ? status === 'SCRAPPED' ? 'SCRAP' : 'REPAIR' : 'Lifecycle physical analysis';
      await prisma.$executeRaw(Prisma.sql`
        INSERT INTO ${table} (id, organization_id, complaint_id, status, version, created_by_id, updated_at, ${content})
        VALUES (${randomUUID()}::uuid, ${record.organizationId}::uuid, ${record.id}::uuid, ${status}, ${version},
          ${f.actor.id}::uuid, CURRENT_TIMESTAMP, ${value}, 'Retain this version')`);
    };
    const projection = (record: { id: string; organizationId: string }) => prisma.$queryRaw<{ version: number; status: string; live: boolean }[]>(Prisma.sql`
      SELECT t.version, t.status, (${structureReferenceLiveCondition(tableName)}) AS live
      FROM ${table} t WHERE t.organization_id = ${record.organizationId}::uuid AND t.complaint_id = ${record.id}::uuid
      ORDER BY t.version`);
    const first = await complaint(org.id);
    await append(first, activeStatuses[0], 1);
    expect(await projection(first)).toEqual([{ version: 1, status: activeStatuses[0], live: true }]);
    await f.send('patch', `/${org.id}`, { expectedVersion: 1, status: 'DISABLED' }).expect(409);
    for (const [index, status] of activeStatuses.entries()) {
      if (index > 0) await append(first, status, index + 1);
      expect((await projection(first)).at(-1)).toEqual({ version: index + 1, status, live: true });
    }
    await append(first, terminal, activeStatuses.length + 1);
    expect(await projection(first)).toEqual([...activeStatuses, terminal].map((status, index) => ({ version: index + 1, status, live: false })));
    // A different organization's higher, still-active version must not block this organization.
    const external = await complaint(otherOrg.id);
    await append(external, activeStatuses[0], 20);
    expect(await projection(external)).toEqual([{ version: 20, status: activeStatuses[0], live: true }]);
    expect((await f.send('get', `/${org.id}/lifecycle`).expect(200)).body).toEqual({
      disableBlockers: [], deleteBlockers: ['存在业务、配置或历史引用'],
      deleteBlockerDetails: ['customer_quality_complaints', 'customer_quality_customers', tableName].map(table => ({ code: `REFERENCE:${table}.organization_id`, count: table === tableName ? activeStatuses.length + 1 : 1, message: expect.any(String) })),
    });
    // A lower-version pending complaint in the same organization must not be shadowed.
    const second = await complaint(org.id);
    const pending = tableName === 'customer_quality_physical_dispositions' ? 'PENDING' : 'IN_PROGRESS';
    await append(second, pending, 1);
    expect(await projection(second)).toEqual([{ version: 1, status: pending, live: true }]);
    expect((await f.send('get', `/${org.id}/lifecycle`).expect(200)).body.disableBlockers).toContain('存在有效配置或在途业务引用');
    await f.send('patch', `/${org.id}`, { expectedVersion: 1, status: 'DISABLED' }).expect(409);
    await append(second, terminal, 2);
    expect(await projection(second)).toEqual([{ version: 1, status: pending, live: false }, { version: 2, status: terminal, live: false }]);
    const retained = await prisma.$queryRaw(Prisma.sql`SELECT * FROM ${table} WHERE organization_id = ${org.id}::uuid ORDER BY id`);
    expect(retained).toHaveLength(activeStatuses.length + 3);
    await f.send('patch', `/${org.id}`, { expectedVersion: 1, status: 'DISABLED' }).expect(200);
    await f.send('delete', `/${org.id}`, { expectedVersion: 2 }).expect(409);
    expect(await prisma.$queryRaw(Prisma.sql`SELECT * FROM ${table} WHERE organization_id = ${org.id}::uuid ORDER BY id`)).toEqual(retained);
    expect(await prisma.customerQualityComplaint.findUniqueOrThrow({ where: { id: first.id } })).toEqual(first);
    expect(await prisma.customerQualityComplaint.findUniqueOrThrow({ where: { id: second.id } })).toEqual(second);
  });

  it('fix3 excludes concluded meeting topics without hiding open topics, independent actions or other organization blockers', async () => {
    const codes = ['supplier-meetings:write', 'supplier-meetings:conclude', 'supplier-meetings:actions'];
    const f = await fixture([...ADMIN_PERMISSIONS, 'organization:read', ...codes]);
    const org = await f.child();
    const governor = await prisma.role.findFirstOrThrow({ where: { organizationId: org.id, code: 'ORGANIZATION_GOVERNOR' } });
    const permissions = await prisma.permission.findMany({ where: { code: { in: codes } } });
    await prisma.rolePermission.createMany({ data: permissions.map(({ id }) => ({ roleId: governor.id, permissionId: id })) });
    const supplier = await prisma.organization.create({ data: { code: randomUUID(), name: 'Meeting supplier', type: 'SUPPLIER' } });
    const profile = await prisma.supplierBusinessProfile.create({ data: { ownerOrganizationId: org.id, supplierOrganizationId: supplier.id, businessCode: randomUUID(), displayName: 'Lifecycle meeting supplier' } });
    const assignee = await prisma.user.create({ data: { organizationId: org.id, username: randomUUID(), accountType: 'INTERNAL', passwordHash: 'test-only' } });
    const actor = { id: f.actor.id, organizationId: f.root.id, scopeOrganizationId: org.id, accountType: 'INTERNAL' as const, sessionId: f.sessionId };
    const service = app.get(SupplierMeetingsService);
    const meeting = await service.create(actor, { profileId: profile.id, title: 'Lifecycle meeting', scheduledStart: '2026-11-01T09:00:00.000Z', scheduledEnd: '2026-11-01T10:00:00.000Z' }, randomUUID(), randomUUID());
    const topic = await service.createTopic(actor, meeting.id, { title: 'Concluded topic' }, randomUUID(), randomUUID());
    const openTopic = await service.createTopic(actor, meeting.id, { title: 'Independent open topic' }, randomUUID(), randomUUID());
    const action = await service.createAction(actor, meeting.id, { title: 'Independent action', assigneeUserId: assignee.id, dueDate: '2026-11-15' }, randomUUID(), randomUUID());
    await service.start(actor, meeting.id, { expectedVersion: 1 }, randomUUID(), randomUUID());
    expect(await service.complete(actor, meeting.id, { expectedVersion: 2 }, randomUUID(), randomUUID())).toMatchObject({ status: 'COMPLETED', version: 3 });
    // The legal profile stays live; isolate the production SQL predicate without removing its FKs.
    const topics = () => prisma.$queryRaw<{ id: string; status: string; live: boolean }[]>`
      SELECT t.id, t.status, (${structureReferenceLiveCondition('supplier_meeting_topics')}) AS live
      FROM supplier_meeting_topics t WHERE t.meeting_id = ${meeting.id}::uuid ORDER BY t.sequence`;
    const actions = () => prisma.$queryRaw<{ id: string; status: string; live: boolean }[]>`
      SELECT t.id, t.status, (${structureReferenceLiveCondition('supplier_meeting_actions')}) AS live
      FROM supplier_meeting_actions t WHERE t.id = ${action.id}::uuid`;
    expect(await topics()).toEqual([{ id: topic.id, status: 'OPEN', live: true }, { id: openTopic.id, status: 'OPEN', live: true }]);
    expect(await actions()).toEqual([{ id: action.id, status: 'OPEN', live: true }]);
    expect(await service.concludeTopic(actor, meeting.id, topic.id, { expectedVersion: 1, conclusion: 'Retain this conclusion' }, randomUUID(), randomUUID())).toMatchObject({ id: topic.id, status: 'CONCLUDED', conclusion: 'Retain this conclusion', version: 2 });
    expect(await topics()).toEqual([{ id: topic.id, status: 'CONCLUDED', live: false }, { id: openTopic.id, status: 'OPEN', live: true }]);
    await service.concludeTopic(actor, meeting.id, openTopic.id, { expectedVersion: 1, conclusion: 'Second conclusion' }, randomUUID(), randomUUID());
    expect(await topics()).toEqual([{ id: topic.id, status: 'CONCLUDED', live: false }, { id: openTopic.id, status: 'CONCLUDED', live: false }]);
    expect(await actions()).toEqual([{ id: action.id, status: 'OPEN', live: true }]);
    await service.completeAction(actor, meeting.id, action.id, { expectedVersion: 1 }, randomUUID(), randomUUID());
    expect(await actions()).toEqual([{ id: action.id, status: 'COMPLETED', live: false }]);
    const retainedTopics = await prisma.$queryRaw`SELECT * FROM supplier_meeting_topics WHERE meeting_id = ${meeting.id}::uuid ORDER BY sequence`;
    const retainedActions = await prisma.$queryRaw`SELECT * FROM supplier_meeting_actions WHERE meeting_id = ${meeting.id}::uuid ORDER BY id`;
    const retainedMeeting = await prisma.$queryRaw`SELECT * FROM supplier_meetings WHERE id = ${meeting.id}::uuid`;
    const retainedEvents = await prisma.$queryRaw<{ entity_id: string; event_type: string; entity_version: number; note: string | null }[]>`
      SELECT entity_id, event_type, entity_version, note FROM supplier_meeting_events WHERE meeting_id = ${meeting.id}::uuid ORDER BY id`;
    expect(retainedEvents).toEqual(expect.arrayContaining([
      expect.objectContaining({ entity_id: topic.id, event_type: 'TOPIC_CREATED', entity_version: 1 }),
      { entity_id: topic.id, event_type: 'TOPIC_CONCLUDED', entity_version: 2, note: 'Retain this conclusion' },
      { entity_id: openTopic.id, event_type: 'TOPIC_CONCLUDED', entity_version: 2, note: 'Second conclusion' },
    ]));
    const lifecycle = (await f.send('get', `/${org.id}/lifecycle`).expect(200)).body;
    expect(lifecycle.disableBlockers).toContain('存在有效配置或在途业务引用');
    expect(lifecycle.deleteBlockers).toContain('存在业务、配置或历史引用');
    await f.send('patch', `/${org.id}`, { expectedVersion: 1, status: 'DISABLED' }).expect(409);
    await f.send('delete', `/${org.id}`, { expectedVersion: 1 }).expect(409);
    expect(await prisma.organization.findUniqueOrThrow({ where: { id: org.id } })).toMatchObject({ status: 'ACTIVE', version: 1 });
    expect(await prisma.supplierBusinessProfile.findUniqueOrThrow({ where: { id: profile.id } })).toEqual(profile);
    expect(await prisma.$queryRaw`SELECT * FROM supplier_meeting_topics WHERE meeting_id = ${meeting.id}::uuid ORDER BY sequence`).toEqual(retainedTopics);
    expect(await prisma.$queryRaw`SELECT * FROM supplier_meeting_actions WHERE meeting_id = ${meeting.id}::uuid ORDER BY id`).toEqual(retainedActions);
    expect(await prisma.$queryRaw`SELECT * FROM supplier_meetings WHERE id = ${meeting.id}::uuid`).toEqual(retainedMeeting);
    expect(await prisma.$queryRaw`SELECT entity_id, event_type, entity_version, note FROM supplier_meeting_events WHERE meeting_id = ${meeting.id}::uuid ORDER BY id`).toEqual(retainedEvents);
    expect(await prisma.auditEvent.count({ where: { organizationId: org.id, resourceId: { in: [topic.id, openTopic.id] }, action: 'SUPPLIER_MEETING_TOPIC_CONCLUDED' } })).toBe(2);
  });

  it.each(['PENDING_REVIEW', 'ACCEPTED'])('quality P2 treats %s audit import rows as live work before issue creation', async (status) => {
    const f = await fixture();
    const org = await f.child();
    const row = await prisma.auditImportRow.create({ data: { organizationId: org.id, sourceSystem: 'CUSTOMER', externalKey: randomUUID(), payload: {}, status, importedById: f.actor.id } });
    await f.send('patch', `/${org.id}`, { expectedVersion: 1, status: 'DISABLED' }).expect(409);
    expect((await f.send('get', `/${org.id}/lifecycle`).expect(200)).body.disableBlockers.length).toBeGreaterThan(0);
    await prisma.auditImportRow.update({ where: { id: row.id }, data: { status: 'REJECTED' } });
    await f.send('patch', `/${org.id}`, { expectedVersion: 1, status: 'DISABLED' }).expect(200);
    await f.send('delete', `/${org.id}`, { expectedVersion: 2 }).expect(409);
    expect(await prisma.auditImportRow.findUnique({ where: { id: row.id } })).not.toBeNull();
  });

  it('quality P2 follows issued audit import work through the linked problem and retains closed history', async () => {
    const f = await fixture();
    const org = await f.child();
    const problem = await prisma.problemIndex.create({ data: { organizationId: org.id, reportNumber: randomUUID(), domainCode: 'audit-management', problemType: 'AUDIT_NC', sourceType: 'audit-import', severity: 'LOW', status: 'OPEN' } });
    const row = await prisma.auditImportRow.create({ data: { organizationId: org.id, sourceSystem: 'CUSTOMER', externalKey: randomUUID(), payload: {}, status: 'ISSUED', importedById: f.actor.id, problemIndexId: problem.id } });
    await f.send('patch', `/${org.id}`, { expectedVersion: 1, status: 'DISABLED' }).expect(409);
    await prisma.problemIndex.update({ where: { id: problem.id }, data: { status: 'CLOSED' } });
    await f.send('patch', `/${org.id}`, { expectedVersion: 1, status: 'DISABLED' }).expect(200);
    await f.send('delete', `/${org.id}`, { expectedVersion: 2 }).expect(409);
    expect(await prisma.auditImportRow.findUnique({ where: { id: row.id } })).not.toBeNull();
  });

  it.each([
    ['COMPLETED', 'APPROVED'], ['CANCELLED', 'APPROVED'],
    ['COMPLETED', 'REJECTED'], ['CANCELLED', 'REJECTED'],
  ])('quality P2 keeps %s plan postponement %s as history, not permanently live work', async (planStatus, decision) => {
    const f = await fixture();
    const org = await f.child();
    const date = new Date('2026-10-24T00:00:00Z');
    const plan = await prisma.auditPlan.create({ data: { organizationId: org.id, year: 2026, title: 'Completed audit planning', auditType: 'SYSTEM', plannedStart: date, plannedEnd: date, status: planStatus, createdById: f.actor.id, updatedById: f.actor.id } });
    const request = await prisma.auditPostponement.create({ data: { organizationId: org.id, planId: plan.id, originalStart: date, originalEnd: date, proposedStart: date, proposedEnd: date, reason: 'Historical request', planVersion: 1, requestedById: f.actor.id } });
    await f.send('patch', `/${org.id}`, { expectedVersion: 1, status: 'DISABLED' }).expect(409);
    await prisma.auditPostponement.update({ where: { id: request.id }, data: { status: decision, decidedById: f.actor.id, decidedAt: date } });
    await f.send('patch', `/${org.id}`, { expectedVersion: 1, status: 'DISABLED' }).expect(200);
    expect((await f.send('get', `/${org.id}/lifecycle`).expect(200)).body.disableBlockers).toEqual([]);
    await f.send('delete', `/${org.id}`, { expectedVersion: 2 }).expect(409);
    expect(await prisma.auditPostponement.findUnique({ where: { id: request.id } })).not.toBeNull();
  });

  it('deletes only the exact initialization grants of a newly created organization and retains parent-scoped evidence', async () => {
    const f = await fixture();
    const org = await f.child();
    expect((await f.send('get', `/${org.id}/lifecycle`).expect(200)).body).toEqual({ deleteBlockers: [], disableBlockers: [] });
    const createEvent = await prisma.auditEvent.findFirstOrThrow({ where: { resourceId: org.id, action: 'ORGANIZATION_CREATED' } });
    const key = randomUUID();
    expect((await f.send('delete', `/${org.id}`, { expectedVersion: 1 }, key).expect(200)).body).toEqual({ id: org.id, deleted: true });
    expect(await prisma.organization.findUnique({ where: { id: org.id } })).toBeNull();
    expect(await prisma.role.count({ where: { organizationId: org.id } })).toBe(0);
    expect(await prisma.userRole.count({ where: { organizationId: org.id } })).toBe(0);
    expect(await prisma.auditEvent.findUniqueOrThrow({ where: { id: createEvent.id } })).toEqual({ ...createEvent, organizationId: f.root.id,
      metadata: { ...createEvent.metadata as object, originalOrganizationId: org.id, originalOrganizationCode: org.code, originalOrganizationName: org.name } });
    const deleted = await prisma.auditEvent.findFirstOrThrow({ where: { resourceId: org.id, action: 'ORGANIZATION_DELETED' } });
    expect(deleted).toMatchObject({ organizationId: f.root.id, metadata: { organizationId: org.id, structureCode: org.code, structureName: org.name, resourceVersion: 1 } });
    expect(await prisma.adminMutation.findFirstOrThrow({ where: { actorUserId: f.actor.id, key } })).toMatchObject({ organizationId: f.root.id });
    await f.send('delete', `/${org.id}`, { expectedVersion: 1 }, key).expect(200);
    const queried = await request(app.getHttpServer()).get(`/api/v1/admin/audit-events?organizationId=${f.root.id}&resourceId=${org.id}`).set('Cookie', f.cookie).expect(200);
    expect(queried.body.items.map((event: { action: string }) => event.action).sort()).toEqual(['ORGANIZATION_CREATED', 'ORGANIZATION_DELETED']);
    expect(queried.body.items.every((event: { metadata: Record<string, unknown> }) => event.metadata.structureCode === org.code && event.metadata.structureName === org.name)).toBe(true);
    await f.send('delete', `/${org.id}`, { expectedVersion: 2 }, key).expect(409);
    await f.send('delete', `/${randomUUID()}`, { expectedVersion: 1 }, key).expect(404);
    const manage = await prisma.permission.findUniqueOrThrow({ where: { code: 'organization:manage' } });
    await prisma.rolePermission.delete({ where: { roleId_permissionId: { roleId: f.role.id, permissionId: manage.id } } });
    await f.send('delete', `/${org.id}`, { expectedVersion: 1 }, key).expect(403);
  });

  it('never recreates or reports a vanished child when its original creation key is retried', async () => {
    const f = await fixture();
    const key = randomUUID();
    const dto = { code: randomUUID(), name: 'Deleted creation receipt' };
    const org = (await f.send('post', `/${f.root.id}/children`, dto, key).expect(201)).body;
    await f.send('delete', `/${org.id}`, { expectedVersion: 1 }).expect(200);
    await f.send('post', `/${f.root.id}/children`, dto, key).expect(409);
    expect(await prisma.organization.count({ where: { code: dto.code } })).toBe(0);
  });

  it('verifies real database references rather than assuming relation-less Prisma fields have no FK', async () => {
    const unprotected = await prisma.$queryRaw<{ tableName: string; columnName: string }[]>`
      SELECT c.relname AS "tableName", a.attname AS "columnName" FROM pg_attribute a
      JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = current_schema() AND c.relkind IN ('r', 'p') AND NOT a.attisdropped
        AND a.atttypid = 'uuid'::regtype AND a.attname ~ '(^|_)(organization|department)_id$'
        AND NOT EXISTS (SELECT 1 FROM pg_constraint fk WHERE fk.contype = 'f' AND fk.conrelid = c.oid AND a.attnum = ANY(fk.conkey))
      ORDER BY c.relname, a.attname`;
    expect(unprotected).toEqual([
      { tableName: 'mfa_challenges', columnName: 'organization_id' },
      { tableName: 'organization_initializations', columnName: 'organization_id' },
      { tableName: 'organization_mutation_archives', columnName: 'organization_id' },
      { tableName: 'password_change_challenges', columnName: 'organization_id' },
    ]);
  });

  it.each(['extra-role', 'extra-grant', 'changed-permissions', 'foreign-grant', 'mutation-history'] as const)('does not mistake %s for initialization', async (kind) => {
    const f = await fixture();
    const org = await f.child();
    const governor = await prisma.role.findFirstOrThrow({ where: { organizationId: org.id } });
    if (kind === 'extra-role') await prisma.role.create({ data: { organizationId: org.id, code: randomUUID(), name: 'Not initialization' } });
    if (kind === 'extra-grant') {
      const person = await prisma.user.create({ data: { organizationId: f.root.id, username: randomUUID(), accountType: 'INTERNAL', passwordHash: 'test-only' } });
      await prisma.userRole.create({ data: { userId: person.id, organizationId: org.id, roleId: governor.id } });
    }
    if (kind === 'changed-permissions') {
      const permission = await prisma.permission.upsert({ where: { code: 'audit:read' }, create: { code: 'audit:read', name: 'audit:read' }, update: {} });
      await prisma.rolePermission.create({ data: { roleId: governor.id, permissionId: permission.id } });
    }
    if (kind === 'foreign-grant') await prisma.userRole.create({ data: { userId: f.actor.id, organizationId: f.root.id, roleId: governor.id } });
    if (kind === 'mutation-history') await f.department(org.id);
    const version = 1;
    expect((await f.send('get', `/${org.id}/lifecycle`).expect(200)).body.deleteBlockers.length).toBeGreaterThan(0);
    await f.send('delete', `/${org.id}`, { expectedVersion: version }).expect(409);
    expect(await prisma.organization.findUnique({ where: { id: org.id } })).not.toBeNull();
    expect(await prisma.role.findUnique({ where: { id: governor.id } })).not.toBeNull();
  });

  it('requires target AND parent authority, protects roots and the actor home, and hides lifecycle from ordinary readers', async () => {
    const f = await fixture();
    const org = await f.child();
    const manage = await prisma.permission.findUniqueOrThrow({ where: { code: 'organization:manage' } });
    await prisma.rolePermission.delete({ where: { roleId_permissionId: { roleId: f.role.id, permissionId: manage.id } } });
    await f.send('delete', `/${org.id}`, { expectedVersion: 1 }).expect(403);
    await prisma.rolePermission.create({ data: { roleId: f.role.id, permissionId: manage.id } });
    await f.send('delete', `/${f.root.id}`, { expectedVersion: 1 }).expect(409);
    await f.send('patch', `/${f.root.id}`, { expectedVersion: 1, status: 'DISABLED' }).expect(409);
    const governor = await prisma.role.findFirstOrThrow({ where: { organizationId: org.id } });
    await prisma.rolePermission.delete({ where: { roleId_permissionId: { roleId: governor.id, permissionId: manage.id } } });
    await f.send('get', `/${org.id}/lifecycle`).expect(403);
    await f.send('delete', `/${org.id}`, { expectedVersion: 1 }).expect(403);
  });

  it('does not delete descendants, positions or historical appointments and permits disabling history only after live references are resolved', async () => {
    const f = await fixture();
    const dep = await f.department();
    const position = await prisma.position.create({ data: { organizationId: f.root.id, departmentId: dep.id, code: randomUUID(), name: 'Historical job' } });
    await prisma.userPosition.create({ data: { organizationId: f.root.id, positionId: position.id, userId: f.actor.id, endedAt: new Date(Date.now() - 1000) } });
    await f.send('delete', `/${f.root.id}/departments/${dep.id}`, { expectedVersion: 1 }).expect(409);
    await f.send('patch', `/${f.root.id}/positions/${position.id}`, { expectedVersion: 1, status: 'DISABLED' }).expect(200);
    expect((await f.send('get', `/${f.root.id}/departments/${dep.id}/lifecycle`).expect(200)).body.disableBlockers).toEqual([]);
    await f.send('patch', `/${f.root.id}/departments/${dep.id}`, { expectedVersion: 1, status: 'DISABLED' }).expect(200);
    expect(await prisma.userPosition.count({ where: { positionId: position.id } })).toBe(1);
  });

  it('D66 permits typo correction and status maintenance of an unused initialized organization, archives every original governance event', async () => {
    const f = await fixture();
    const org = await f.child();
    await f.send('patch', `/${org.id}`, { expectedVersion: 1, code: `EDIT-${randomUUID()}`, name: 'Corrected unused organization' }).expect(200);
    await f.send('patch', `/${org.id}`, { expectedVersion: 2, status: 'DISABLED' }).expect(200);
    await f.send('patch', `/${org.id}`, { expectedVersion: 1, name: 'Stale rejection' }).expect(409);
    const before = await prisma.auditEvent.findMany({ where: { organizationId: org.id }, orderBy: { id: 'asc' } });
    expect(before.some(({ outcome }) => outcome === 'DENIED')).toBe(true);
    expect((await f.send('get', `/${org.id}/lifecycle`).expect(200)).body.deleteBlockers).toEqual([]);
    await f.send('delete', `/${org.id}`, { expectedVersion: 3 }).expect(200);
    for (const original of before) {
      const archived = await prisma.auditEvent.findUniqueOrThrow({ where: { id: original.id } });
      expect(archived).toMatchObject({ ...original, organizationId: f.root.id, metadata: { ...(original.metadata as object), organizationId: org.id } });
    }
    expect(await prisma.adminMutation.count({ where: { organizationId: org.id } })).toBe(0);
    const queried = await request(app.getHttpServer()).get(`/api/v1/admin/audit-events?organizationId=${f.root.id}&pageSize=100`).set('Cookie', f.cookie).expect(200);
    expect(queried.body.items.filter((event: { metadata: { organizationId?: string } }) => event.metadata.organizationId === org.id)).toHaveLength(before.length + 1);
  });

  it('D67 blocks disabling a department containing an enabled but unoccupied position', async () => {
    const f = await fixture();
    const dep = await f.department();
    await prisma.position.create({ data: { organizationId: f.root.id, departmentId: dep.id, code: randomUUID(), name: 'Enabled empty job' } });
    expect((await f.send('get', `/${f.root.id}/departments/${dep.id}/lifecycle`).expect(200)).body.disableBlockers.length).toBeGreaterThan(0);
    await f.send('patch', `/${f.root.id}/departments/${dep.id}`, { expectedVersion: 1, status: 'DISABLED' }).expect(409);
  });

  it('completed task notifications remain historical references, not permanent disable blockers', async () => {
    const f = await fixture();
    const org = await f.child();
    const definition = await prisma.workflowDefinition.create({ data: { organizationId: org.id, code: randomUUID(), name: 'Historical notices' } });
    const version = await prisma.workflowVersion.create({ data: { organizationId: org.id, workflowDefinitionId: definition.id, version: 1, status: 'RETIRED' } });
    const node = await prisma.workflowNode.create({ data: { organizationId: org.id, workflowVersionId: version.id, nodeKey: 'done', name: 'Done', type: 'ACTION' } });
    const instance = await prisma.workflowInstance.create({ data: { organizationId: org.id, workflowDefinitionId: definition.id, workflowVersionId: version.id, instanceKey: randomUUID(), status: 'COMPLETED' } });
    const task = await prisma.workflowTask.create({ data: { organizationId: org.id, workflowInstanceId: instance.id, workflowVersionId: version.id, workflowNodeId: node.id, status: 'COMPLETED' } });
    await prisma.notification.create({ data: { organizationId: org.id, workflowTaskId: task.id, channel: 'IN_APP', body: 'Historical delivery', status: 'DELIVERED', readAt: new Date() } });
    expect((await f.send('get', `/${org.id}/lifecycle`).expect(200)).body.disableBlockers).toEqual([]);
    await f.send('patch', `/${org.id}`, { expectedVersion: 1, status: 'DISABLED' }).expect(200);
    await f.send('delete', `/${org.id}`, { expectedVersion: 2 }).expect(409);
  });

  it('different-actor customer triage rechecks the shared department lock after a concurrent disable', async () => {
    const f = await fixture([...ADMIN_PERMISSIONS, 'organization:read', 'customer-quality:complaints:read', 'customer-quality:complaints:write']);
    const dep = await f.department();
    const second = await prisma.user.create({ data: { organizationId: f.root.id, username: randomUUID(), accountType: 'INTERNAL', passwordHash: 'test-only' } });
    await prisma.userRole.create({ data: { organizationId: f.root.id, roleId: f.role.id, userId: second.id } });
    const token = await app.get(SessionService).create(second.id, prisma, { mfaVerified: true, reauthenticated: true });
    const actor = { id: second.id, organizationId: f.root.id, accountType: 'INTERNAL' as const, sessionId: (await app.get(SessionService).resolve(token))!.id };
    const ledger = app.get(CustomerQualityService);
    const customer = await ledger.createCustomer(actor, { code: randomUUID(), name: 'Triage race customer' }, randomUUID(), randomUUID());
    const complaint = await ledger.createComplaint(actor, { customerId: customer.id, complaintType: 'ZERO_KM', defectDescription: 'Triage race', severity: 'LOW', severityPolicyVersion: 'v1', severitySnapshot: { level: 'LOW' } }, randomUUID(), randomUUID());
    const blocker = new Client({ connectionString: process.env.DATABASE_URL });
    await blocker.connect();
    let disable: Promise<number> | undefined;
    let triage: Promise<number> | undefined;
    const key = randomUUID();
    try {
      await blocker.query('BEGIN');
      const { rows: [{ pid }] } = await blocker.query('SELECT pg_backend_pid() AS pid');
      await blocker.query('SELECT id FROM departments WHERE id = $1 FOR UPDATE', [dep.id]);
      disable = f.send('patch', `/${f.root.id}/departments/${dep.id}`, { expectedVersion: 1, status: 'DISABLED' }).then(({ status }) => status);
      await waitBlocked(pid);
      triage = app.get(CustomerComplaintProcessingService).triage(actor, complaint.id, { expectedVersion: 1, category: 'PRODUCT_QUALITY', responsibleDepartmentId: dep.id, ownerUserId: second.id, note: 'Concurrent triage' }, randomUUID(), key).then(() => 200, (error: { status: number }) => error.status);
      let waiting = false;
      for (let attempt = 0; attempt < 150 && !waiting; attempt++) {
        const [row] = await prisma.$queryRaw<{ waiting: boolean }[]>`SELECT count(*) >= 2 AS waiting FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND (query LIKE 'SELECT id FROM departments%' OR query LIKE 'UPDATE customer_quality_complaints SET category%')`;
        waiting = row!.waiting;
        if (!waiting) await delay(10);
      }
      expect(waiting).toBe(true);
      await blocker.query('COMMIT');
      expect(await Promise.all([disable, triage])).toEqual([200, 400]);
      expect(await prisma.customerQualityComplaint.findUniqueOrThrow({ where: { id: complaint.id } })).toMatchObject({ version: 1, status: 'OPEN', responsibleDepartmentId: null });
      expect(await prisma.adminMutation.count({ where: { key } })).toBe(0);
    } finally { await blocker.query('ROLLBACK'); await blocker.end(); await Promise.allSettled([disable, triage].filter(Boolean)); }
  });

  it.each(['appointment', 'future-appointment', 'child'] as const)('rechecks %s inside the disable transaction rather than trusting lifecycle GET', async (kind) => {
    const f = await fixture();
    const dep = await f.department();
    expect((await f.send('get', `/${f.root.id}/departments/${dep.id}/lifecycle`).expect(200)).body.disableBlockers).toEqual([]);
    if (kind === 'child') await f.send('post', `/${f.root.id}/departments`, { code: randomUUID(), name: 'Live child', parentId: dep.id }).expect(201);
    else {
      const position = await prisma.position.create({ data: { organizationId: f.root.id, departmentId: dep.id, code: randomUUID(), name: 'Live job' } });
      await prisma.userPosition.create({ data: { organizationId: f.root.id, positionId: position.id, userId: f.actor.id, ...(kind === 'future-appointment' ? { startedAt: new Date(Date.now() + 3600000) } : {}) } });
    }
    await f.send('patch', `/${f.root.id}/departments/${dep.id}`, { expectedVersion: 1, status: 'DISABLED' }).expect(409);
    expect(await prisma.department.findUniqueOrThrow({ where: { id: dep.id } })).toMatchObject({ status: 'ACTIVE', version: 1 });
  });

  it.each(['current', 'future'] as const)('rejects stopping a position with a %s appointment without batch revocation or session changes', async (kind) => {
    const f = await fixture();
    const dep = await f.department();
    const position = await prisma.position.create({ data: { organizationId: f.root.id, departmentId: dep.id, code: randomUUID(), name: 'Controlled position' } });
    const employee = await prisma.user.create({ data: { organizationId: f.root.id, username: randomUUID(), accountType: 'INTERNAL', passwordHash: 'test-only' } });
    await prisma.userPosition.create({ data: { organizationId: f.root.id, userId: employee.id, positionId: position.id, ...(kind === 'future' ? { startedAt: new Date(Date.now() + 3600000) } : {}) } });
    const token = await app.get(SessionService).create(employee.id);
    const key = randomUUID();
    await f.send('patch', `/${f.root.id}/positions/${position.id}`, { expectedVersion: 1, status: 'DISABLED' }, key).expect(409);
    expect(await prisma.position.findUniqueOrThrow({ where: { id: position.id } })).toMatchObject({ version: 1, status: 'ACTIVE' });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: employee.id } })).securityVersion).toBe(1);
    expect(await app.get(SessionService).resolve(token)).not.toBeNull();
    expect(await prisma.adminMutation.count({ where: { key } })).toBe(0);
  });

  it('preserves organization children, user accounts, enabled configuration and in-flight workflow references', async () => {
    const f = await fixture();
    const org = await f.child();
    await f.send('post', `/${org.id}/children`, { code: randomUUID(), name: 'Live child' }).expect(201);
    await f.send('patch', `/${org.id}`, { expectedVersion: 1, status: 'DISABLED' }).expect(409);
    await f.send('delete', `/${org.id}`, { expectedVersion: 1 }).expect(409);
    const configured = await f.child();
    await prisma.notificationRule.create({ data: { organizationId: configured.id, kind: 'TASK_ASSIGNED', enabled: true, subjectTemplate: 'Task', bodyTemplate: 'Task body' } });
    await f.send('patch', `/${configured.id}`, { expectedVersion: 1, status: 'DISABLED' }).expect(409);
  });

  it('D67 prevents organization disable from revoking ACTIVE legacy direct-role users without positions', async () => {
    const f = await fixture();
    const org = await f.child();
    const user = await prisma.user.create({ data: { organizationId: org.id, username: randomUUID(), accountType: 'INTERNAL', passwordHash: 'test-only' } });
    const role = await prisma.role.findFirstOrThrow({ where: { organizationId: org.id, code: 'ORGANIZATION_GOVERNOR' } });
    await prisma.userRole.create({ data: { organizationId: org.id, roleId: role.id, userId: user.id } });
    const token = await app.get(SessionService).create(user.id, prisma, { mfaVerified: true, reauthenticated: true });
    expect(await prisma.userPosition.count({ where: { userId: user.id } })).toBe(0);
    const key = randomUUID();
    await f.send('patch', `/${org.id}`, { expectedVersion: 1, status: 'DISABLED' }, key).expect(409);
    expect((await f.send('get', `/${org.id}/lifecycle`).expect(200)).body.disableBlockers).toContain('存在启用的用户账号');
    expect(await prisma.organization.findUniqueOrThrow({ where: { id: org.id } })).toMatchObject({ version: 1, status: 'ACTIVE' });
    expect(await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).toMatchObject({ status: 'ACTIVE', securityVersion: user.securityVersion });
    expect(await app.get(SessionService).resolve(token)).not.toBeNull();
    expect(await prisma.adminMutation.count({ where: { key } })).toBe(0);
    expect(await prisma.userRole.count({ where: { organizationId: org.id, userId: user.id } })).toBe(1);
    await prisma.user.update({ where: { id: user.id }, data: { status: 'DISABLED' } });
    expect((await f.send('get', `/${org.id}/lifecycle`).expect(200)).body.disableBlockers).toEqual([]);
    await f.send('patch', `/${org.id}`, { expectedVersion: 1, status: 'DISABLED' }).expect(200);
    expect(await prisma.user.findUnique({ where: { id: user.id } })).not.toBeNull();
  });

  it('D67 blocks ACTIVE positions even under an inconsistently disabled department', async () => {
    const f = await fixture();
    const org = await f.child();
    const department = await prisma.department.create({ data: { organizationId: org.id, code: randomUUID(), name: 'Disabled imported department', status: 'DISABLED' } });
    const position = await prisma.position.create({ data: { organizationId: org.id, departmentId: department.id, code: randomUUID(), name: 'Enabled imported position' } });
    await f.send('patch', `/${org.id}`, { expectedVersion: 1, status: 'DISABLED' }).expect(409);
    expect((await f.send('get', `/${org.id}/lifecycle`).expect(200)).body.disableBlockers).toContain('存在启用的岗位');
    expect(await prisma.organization.findUniqueOrThrow({ where: { id: org.id } })).toMatchObject({ version: 1, status: 'ACTIVE' });
    expect(await prisma.position.findUniqueOrThrow({ where: { id: position.id } })).toMatchObject({ version: 1, status: 'ACTIVE' });
    await prisma.position.update({ where: { id: position.id }, data: { status: 'DISABLED' } });
    await f.send('patch', `/${org.id}`, { expectedVersion: 1, status: 'DISABLED' }).expect(200);
    expect(await prisma.position.findUnique({ where: { id: position.id } })).not.toBeNull();
  });

  it('treats platform settings without a status column as effective configuration', async () => {
    const f = await fixture();
    const org = await f.child();
    await prisma.platformSettings.create({ data: { organizationId: org.id } });
    expect((await f.send('get', `/${org.id}/lifecycle`).expect(200)).body.disableBlockers.length).toBeGreaterThan(0);
    await f.send('patch', `/${org.id}`, { expectedVersion: 1, status: 'DISABLED' }).expect(409);
    await f.send('delete', `/${org.id}`, { expectedVersion: 1 }).expect(409);
  });

  it.each(['material', 'process'] as const)('rejects %s references present in real PG even where Prisma omits the Organization relation', async (kind) => {
    const f = await fixture();
    const org = await f.child();
    if (kind === 'material') await prisma.materialMaster.create({ data: { organizationId: org.id, materialCode: randomUUID(), materialName: 'Referenced material', createdById: f.actor.id, updatedById: f.actor.id } });
    else await prisma.processDefectType.create({ data: { organizationId: org.id, code: 'PROCESS', name: 'Process reference', createdById: f.actor.id } });
    expect((await f.send('get', `/${org.id}/lifecycle`).expect(200)).body.deleteBlockers).toContain('存在业务、配置或历史引用');
    await f.send('delete', `/${org.id}`, { expectedVersion: 1 }).expect(409);
    expect(await prisma.organization.findUnique({ where: { id: org.id } })).not.toBeNull();
  });

  it('blocks published workflows and running instances, but allows disabling retained retired workflow history', async () => {
    const f = await fixture();
    const org = await f.child();
    const definition = await prisma.workflowDefinition.create({ data: { organizationId: org.id, code: randomUUID(), name: 'Lifecycle workflow' } });
    const version = await prisma.workflowVersion.create({ data: { organizationId: org.id, workflowDefinitionId: definition.id, version: 1, status: 'PUBLISHED' } });
    await f.send('patch', `/${org.id}`, { expectedVersion: 1, status: 'DISABLED' }).expect(409);
    await prisma.workflowVersion.update({ where: { id: version.id }, data: { status: 'RETIRED' } });
    const instance = await prisma.workflowInstance.create({ data: { organizationId: org.id, workflowDefinitionId: definition.id, workflowVersionId: version.id, instanceKey: randomUUID(), status: 'RUNNING' } });
    await f.send('patch', `/${org.id}`, { expectedVersion: 1, status: 'DISABLED' }).expect(409);
    await prisma.workflowInstance.update({ where: { id: instance.id }, data: { status: 'COMPLETED' } });
    await f.send('patch', `/${org.id}`, { expectedVersion: 1, status: 'DISABLED' }).expect(200);
    expect(await prisma.workflowInstance.findUnique({ where: { id: instance.id } })).not.toBeNull();
    await f.send('delete', `/${org.id}`, { expectedVersion: 2 }).expect(409);
  });

  async function waitBlocked(pid: number) {
    for (let attempt = 0; attempt < 150; attempt++) {
      const [row] = await prisma.$queryRaw<{ waiting: boolean }[]>`SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE datname = current_database() AND ${pid}::int = ANY(pg_blocking_pids(pid))) AS waiting`;
      if (row?.waiting) return;
      await delay(10);
    }
    throw new Error('Expected real PostgreSQL lock contention was not observed');
  }

  it('serializes delegated mapping reactivation against stopping its target organization', async () => {
    const f = await fixture([...ADMIN_PERMISSIONS, 'organization:read', 'component-project:read', 'component-project:manage']);
    const org = await f.child();
    const governor = await prisma.role.findFirstOrThrow({ where: { organizationId: org.id, code: 'ORGANIZATION_GOVERNOR' } });
    const permissions = await prisma.permission.findMany({ where: { code: { in: ['component-project:read', 'component-project:manage'] } } });
    await prisma.rolePermission.createMany({ data: permissions.map(({ id }) => ({ roleId: governor.id, permissionId: id })) });
    const second = await prisma.user.create({ data: { organizationId: f.root.id, username: randomUUID(), accountType: 'INTERNAL', passwordHash: 'test-only' } });
    await prisma.userRole.create({ data: { organizationId: org.id, roleId: governor.id, userId: second.id } });
    const token = await app.get(SessionService).create(second.id, prisma, { mfaVerified: true, reauthenticated: true });
    const actor = { id: f.actor.id, organizationId: f.root.id, scopeOrganizationId: org.id, accountType: 'INTERNAL' as const, sessionId: f.sessionId };
    const delegated = { ...actor, id: second.id, sessionId: (await app.get(SessionService).resolve(token))!.id };
    const service = app.get(ComponentProjectService);
    const project = await service.createProject(actor, org.id, { code: randomUUID(), name: 'Concurrent mapping', stage: 'NEW_PRODUCT', status: 'DISABLED' }, randomUUID(), randomUUID());
    expect((await f.send('get', `/${org.id}/lifecycle`).expect(200)).body.disableBlockers).toEqual([]);
    const blocker = new Client({ connectionString: process.env.DATABASE_URL });
    await blocker.connect();
    let activation: Promise<number> | undefined;
    try {
      await blocker.query('BEGIN');
      const { rows: [{ pid }] } = await blocker.query('SELECT pg_backend_pid() AS pid');
      await blocker.query('SELECT id FROM component_project_records WHERE id = $1 FOR UPDATE', [project.id]);
      activation = service.updateProject(delegated, org.id, project.id, { expectedVersion: 1, status: 'ACTIVE' }, randomUUID(), randomUUID())
        .then(() => 200, (error: { status: number }) => error.status);
      await waitBlocked(pid);
      await f.send('patch', `/${org.id}`, { expectedVersion: 1, status: 'DISABLED' }).expect(200);
      await blocker.query('COMMIT');
      expect(await activation).toBe(409);
      expect(await prisma.organization.findUniqueOrThrow({ where: { id: org.id } })).toMatchObject({ status: 'DISABLED', version: 2 });
      expect(await prisma.$queryRaw`SELECT status, version FROM component_project_records WHERE id = ${project.id}::uuid`).toEqual([{ status: 'DISABLED', version: 1 }]);
    } finally {
      await blocker.query('ROLLBACK');
      await blocker.end();
      await activation;
    }
  });

  it('requires releasing an active management binding before disabling or moving its position', async () => {
    const f = await fixture();
    const department = await f.department();
    const other = await f.department();
    const position = await prisma.position.create({ data: { organizationId: f.root.id, departmentId: department.id, code: randomUUID(), name: 'Configured manager' } });
    const binding = (await f.send('post', `/${f.root.id}/management-bindings`, { departmentId: department.id, responsibility: 'SECTION_MANAGER', positionId: position.id }).expect(201)).body;
    await f.send('patch', `/${f.root.id}/positions/${position.id}`, { expectedVersion: 1, status: 'DISABLED' }).expect(409);
    await f.send('patch', `/${f.root.id}/positions/${position.id}`, { expectedVersion: 1, departmentId: other.id }).expect(409);
    expect(await prisma.position.findUniqueOrThrow({ where: { id: position.id } })).toMatchObject({ status: 'ACTIVE', departmentId: department.id, version: 1 });
    await f.send('patch', `/${f.root.id}/management-bindings/${binding.id}`, { expectedVersion: 1, status: 'DISABLED' }).expect(200);
    await f.send('patch', `/${f.root.id}/positions/${position.id}`, { expectedVersion: 1, status: 'DISABLED' }).expect(200);
    expect(await prisma.$queryRaw`SELECT id, status FROM department_management_bindings WHERE id = ${binding.id}::uuid`).toEqual([{ id: binding.id, status: 'DISABLED' }]);
  });

  it('requires releasing a minister scope before ending its referenced appointment', async () => {
    const f = await fixture();
    const department = await f.department();
    const section = await f.department();
    await prisma.department.update({ where: { id: section.id }, data: { parentId: department.id } });
    const position = await prisma.position.create({ data: { organizationId: f.root.id, departmentId: department.id, code: randomUUID(), name: 'Assigned minister' } });
    const employee = await prisma.user.create({ data: { organizationId: f.root.id, username: randomUUID(), accountType: 'INTERNAL', passwordHash: 'test-only' } });
    const appointment = await prisma.userPosition.create({ data: { organizationId: f.root.id, userId: employee.id, positionId: position.id, startedAt: new Date(Date.now() - 3600000) } });
    await f.send('post', `/${f.root.id}/management-bindings`, { departmentId: department.id, responsibility: 'MINISTER', positionId: position.id }).expect(201);
    const scope = (await f.send('post', `/${f.root.id}/minister-scopes`, { departmentId: department.id, sectionDepartmentId: section.id, ministerAssignmentId: appointment.id }).expect(201)).body;
    const actor = { id: f.actor.id, sessionId: f.sessionId, organizationId: f.root.id, accountType: 'INTERNAL' as const };
    const replace = () => app.get(OrganizationService).replaceUserPositions(actor, f.root.id, employee.id,
      { positionIds: [], expectedPositionIds: [position.id] }, randomUUID(), randomUUID());
    await expect(replace()).rejects.toMatchObject({ status: 409 });
    expect(await prisma.userPosition.findUniqueOrThrow({ where: { id: appointment.id } })).toMatchObject({ endedAt: null });
    expect(await prisma.user.findUniqueOrThrow({ where: { id: employee.id } })).toMatchObject({ securityVersion: 1 });
    await f.send('patch', `/${f.root.id}/minister-scopes/${scope.id}`, { expectedVersion: 1, status: 'DISABLED' }).expect(200);
    expect(await replace()).toEqual([]);
    expect((await prisma.userPosition.findUniqueOrThrow({ where: { id: appointment.id } })).endedAt).not.toBeNull();
  });

  it('serializes organization deletion against a concurrent new department without orphaning or partial cleanup', async () => {
    const f = await fixture();
    const org = await f.child();
    const blocker = new Client({ connectionString: process.env.DATABASE_URL });
    await blocker.connect();
    let deletion: Promise<request.Response> | undefined;
    let creation: Promise<request.Response> | undefined;
    const code = randomUUID();
    failures.length = 0;
    try {
      await blocker.query('BEGIN');
      const { rows: [{ pid }] } = await blocker.query('SELECT pg_backend_pid() AS pid');
      await blocker.query('SELECT id FROM organizations WHERE id = $1 FOR UPDATE', [org.id]);
      deletion = f.send('delete', `/${org.id}`, { expectedVersion: 1 }).then((response) => response);
      await waitBlocked(pid);
      creation = f.send('post', `/${org.id}/departments`, { code, name: 'Concurrent child' }).then((response) => response);
      await blocker.query('COMMIT');
      const responses = await Promise.all([deletion, creation]);
      const unexpected = responses.filter(({ status }) => ![200, 201, 403, 404, 409].includes(status));
      expect({ statuses: unexpected.map(({ status }) => status), errors: unexpected.length ? failures.map((error) => ({ code: (error as { code?: string }).code, message: String(error).slice(-500) })) : [] }).toEqual({ statuses: [], errors: [] });
      expect(responses.filter(({ status }) => status < 300)).toHaveLength(1);
      const current = await prisma.organization.findUnique({ where: { id: org.id } });
      expect(await prisma.department.count({ where: { organizationId: org.id, code } })).toBe(current ? 1 : 0);
      expect(await prisma.role.count({ where: { organizationId: org.id } })).toBe(current ? 1 : 0);
    } finally {
      await blocker.query('ROLLBACK'); await blocker.end();
      await Promise.allSettled([deletion, creation].filter(Boolean));
    }
  });

  it('serializes department disable against a different actor assigning a new appointment', async () => {
    const f = await fixture();
    const dep = await f.department();
    const position = await prisma.position.create({ data: { organizationId: f.root.id, departmentId: dep.id, code: randomUUID(), name: 'Concurrent position' } });
    const second = await prisma.user.create({ data: { organizationId: f.root.id, username: randomUUID(), accountType: 'INTERNAL', passwordHash: 'test-only' } });
    const employee = await prisma.user.create({ data: { organizationId: f.root.id, username: randomUUID(), accountType: 'INTERNAL', passwordHash: 'test-only' } });
    await prisma.userRole.create({ data: { organizationId: f.root.id, roleId: f.role.id, userId: second.id } });
    const token = await app.get(SessionService).create(second.id, prisma, { mfaVerified: true, reauthenticated: true });
    const sessionId = (await app.get(SessionService).resolve(token))!.id;
    const blocker = new Client({ connectionString: process.env.DATABASE_URL });
    await blocker.connect();
    let disable: Promise<number> | undefined;
    let appointment: Promise<number> | undefined;
    try {
      await blocker.query('BEGIN');
      const { rows: [{ pid }] } = await blocker.query('SELECT pg_backend_pid() AS pid');
      await blocker.query('SELECT id FROM departments WHERE id = $1 FOR UPDATE', [dep.id]);
      disable = f.send('patch', `/${f.root.id}/departments/${dep.id}`, { expectedVersion: 1, status: 'DISABLED' }).then(({ status }) => status);
      await waitBlocked(pid);
      appointment = app.get(OrganizationService).replaceUserPositions({ id: second.id, organizationId: f.root.id, accountType: 'INTERNAL', sessionId }, f.root.id, employee.id, { positionIds: [position.id], expectedPositionIds: [] }, randomUUID(), randomUUID()).then(() => 200, (error: { status: number }) => error.status);
      await blocker.query('COMMIT');
      const statuses = await Promise.all([disable, appointment]);
      expect(statuses.sort()).toEqual([200, 409]);
      const current = await prisma.department.findUniqueOrThrow({ where: { id: dep.id } });
      expect(await prisma.userPosition.count({ where: { positionId: position.id, endedAt: null } })).toBe(current.status === 'DISABLED' ? 0 : 1);
    } finally {
      await blocker.query('ROLLBACK'); await blocker.end();
      await Promise.allSettled([disable, appointment].filter(Boolean));
    }
  });

  it('rejects a deletion that passed the HTTP guard before waiting on actor revocation', async () => {
    const f = await fixture();
    const dep = await f.department();
    const blocker = new Client({ connectionString: process.env.DATABASE_URL });
    await blocker.connect();
    let deletion: Promise<request.Response> | undefined;
    const key = randomUUID();
    try {
      await blocker.query('BEGIN');
      const { rows: [{ pid }] } = await blocker.query('SELECT pg_backend_pid() AS pid');
      await blocker.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [f.actor.id]);
      deletion = f.send('delete', `/${f.root.id}/departments/${dep.id}`, { expectedVersion: 1 }, key).then((response) => response);
      await waitBlocked(pid);
      await blocker.query('DELETE FROM user_roles WHERE user_id = $1', [f.actor.id]);
      await blocker.query('UPDATE users SET security_version = security_version + 1 WHERE id = $1', [f.actor.id]);
      await blocker.query('COMMIT');
      expect([401, 403, 409]).toContain((await deletion).status);
      expect(await prisma.department.findUnique({ where: { id: dep.id } })).not.toBeNull();
      expect(await prisma.adminMutation.count({ where: { key } })).toBe(0);
    } finally { await blocker.query('ROLLBACK'); await blocker.end(); await deletion; }
  });

  it('keeps both deletion and code edits atomic if audit persistence fails', async () => {
    const f = await fixture();
    const org = await f.child();
    const key = randomUUID();
    let fail = jest.spyOn(app.get(AuditLogService), 'record').mockRejectedValueOnce(new Error('N1 audit failure'));
    try { await f.send('delete', `/${org.id}`, { expectedVersion: 1 }, key).expect(500); } finally { fail.mockRestore(); }
    expect(await prisma.organization.findUniqueOrThrow({ where: { id: org.id } })).toMatchObject({ version: 1 });
    expect(await prisma.userRole.count({ where: { organizationId: org.id } })).toBe(1);
    expect(await prisma.adminMutation.count({ where: { key } })).toBe(0);
    fail = jest.spyOn(app.get(AuditLogService), 'record').mockRejectedValueOnce(new Error('N1 audit failure'));
    try { await f.send('patch', `/${org.id}`, { expectedVersion: 1, code: randomUUID() }).expect(500); } finally { fail.mockRestore(); }
    expect(await prisma.organization.findUniqueOrThrow({ where: { id: org.id } })).toMatchObject({ version: 1, code: org.code });
    await f.send('delete', `/${org.id}`, { expectedVersion: 1 }, key).expect(200);
  });

  it('requires CSRF, idempotency, version and department scope', async () => {
    const f = await fixture();
    const dep = await f.department();
    const other = await f.child();
    const path = `/${f.root.id}/departments/${dep.id}`;
    await request(app.getHttpServer()).delete(`/api/v1/organizations${path}`).set('Cookie', f.cookie).send({ expectedVersion: 1 }).expect(403);
    await request(app.getHttpServer()).delete(`/api/v1/organizations${path}`).set('Cookie', f.cookie).set('x-csrf-token', csrf).send({ expectedVersion: 1 }).expect(400);
    await f.send('delete', path, {}).expect(400);
    await f.send('delete', path, { expectedVersion: 2 }).expect(409);
    await f.send('delete', `/${other.id}/departments/${dep.id}`, { expectedVersion: 1 }).expect(404);
    await f.send('get', `/${other.id}/departments/${dep.id}/lifecycle`).expect(404);
  });
});
