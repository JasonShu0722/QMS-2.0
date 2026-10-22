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
import { AuditLogService } from '../../src/modules/audit-log/audit-log.service.js';
import { PasswordService } from '../../src/modules/identity/password.service.js';
import { OrganizationService } from '../../src/modules/organization/organization.service.js';

if (!process.env.DATABASE_URL) throw new Error('PostgreSQL integration requires DATABASE_URL; no skipping.');

describe('organization governance PostgreSQL', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let organizationId: string;
  let otherId: string;
  let userId: string;
  let cookie: string;
  let sessionId: string;
  const csrf = randomUUID();
  const codes = ['organization:read', 'organization:manage', 'organization:structure:read', 'organization:structure:manage', 'organization:positions:assign'];
  const send = (method: 'post' | 'patch' | 'put', path: string, body: object, key = randomUUID()) => request(app.getHttpServer())[method](`/api/v1/organizations${path}`).set('Cookie', cookie).set('x-csrf-token', csrf).set('Idempotency-Key', key).send(body);

  beforeAll(async () => {
    app = (await Test.createTestingModule({ imports: [AppModule] }).compile()).createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init();
    prisma = app.get(PrismaService);
    organizationId = (await prisma.organization.create({ data: { code: randomUUID(), name: 'Governance root', type: 'INTERNAL' } })).id;
    otherId = (await prisma.organization.create({ data: { code: randomUUID(), name: 'Other root', type: 'INTERNAL' } })).id;
    userId = (await prisma.user.create({ data: { organizationId, username: randomUUID(), accountType: 'INTERNAL', passwordHash: 'unused' } })).id;
    const permissions = await Promise.all(codes.map((code) => prisma.permission.upsert({ where: { code }, create: { code, name: code }, update: {} })));
    const role = await prisma.role.create({ data: { organizationId, code: randomUUID(), name: 'Governor', permissions: { create: permissions.map(({ id }) => ({ permissionId: id })) } } });
    await prisma.userRole.create({ data: { userId, organizationId, roleId: role.id } });
    const token = await app.get(SessionService).create(userId, prisma, { mfaVerified: true, reauthenticated: true });
    sessionId = (await app.get(SessionService).resolve(token))!.id;
    cookie = `qms_session=${token}; qms_csrf=${csrf}`;
  });

  afterAll(async () => { await app?.close(); });

  it('creates a child with explicit bounded grants, replays once, and prevents root creation', async () => {
    const key = randomUUID();
    const body = { code: randomUUID(), name: 'Child' };
    const child = (await send('post', `/${organizationId}/children`, body, key).expect(201)).body;
    expect((await send('post', `/${organizationId}/children`, body, key).expect(201)).body).toEqual(child);
    expect(child).toMatchObject({ parentId: organizationId, status: 'ACTIVE', version: 1 });
    const grants = await prisma.userRole.findMany({ where: { userId, organizationId: child.id }, include: { role: { include: { permissions: { include: { permission: true } } } } } });
    expect(grants).toHaveLength(1);
    expect(grants[0].role.permissions.map((entry) => entry.permission.code).sort()).toEqual(codes.slice().sort());
    await request(app.getHttpServer()).get(`/api/v1/organizations/tree?organizationId=${child.id}`).set('Cookie', cookie).expect(200);
    await send('post', '', body).expect(404);
    await send('post', `/${otherId}/children`, body).expect(403);
    expect(await prisma.auditEvent.count({ where: { action: 'ORGANIZATION_CREATED', resourceId: child.id } })).toBe(1);
  });

  it('enforces move authority, cycle detection and compare-and-swap', async () => {
    const child = (await send('post', `/${organizationId}/children`, { code: randomUUID(), name: 'Move child' }).expect(201)).body;
    await send('patch', `/${child.id}`, { parentId: otherId, expectedParentId: organizationId, expectedVersion: 1 }).expect(403);
    await send('patch', `/${organizationId}`, { parentId: child.id, expectedParentId: null, expectedVersion: 1 }).expect(409);
    await send('patch', `/${organizationId}`, { parentId: child.id, expectedVersion: 1 }).expect(400);
    await send('patch', `/${child.id}`, { parentId: organizationId, expectedParentId: null, expectedVersion: 1 }).expect(409);
    const results = await Promise.all(['First', 'Second'].map((name) => send('patch', `/${child.id}`, { name, expectedVersion: 1 })));
    expect(results.map((result) => result.status).sort()).toEqual([200, 409]);
    await send('patch', `/${child.id}`, { code: 'IMMUTABLE', expectedVersion: 2 }).expect(400);
    await send('patch', `/${child.id}`, { parentId: null, expectedVersion: 2 }).expect(400);
  });

  it('enforces composite foreign keys and keeps appointment history in its original organization', async () => {
    const department = await prisma.department.create({ data: { organizationId, code: randomUUID(), name: 'FK department' } });
    const position = await prisma.position.create({ data: { organizationId, departmentId: department.id, code: randomUUID(), name: 'FK position' } });
    const user = await prisma.user.create({ data: { organizationId, username: randomUUID(), accountType: 'INTERNAL', passwordHash: 'unused' } });
    await expect(prisma.department.create({ data: { organizationId: otherId, parentId: department.id, code: randomUUID(), name: 'Foreign' } })).rejects.toMatchObject({ code: 'P2003' });
    await expect(prisma.position.create({ data: { organizationId: otherId, departmentId: department.id, code: randomUUID(), name: 'Foreign' } })).rejects.toMatchObject({ code: 'P2003' });
    await expect(prisma.userPosition.create({ data: { organizationId: otherId, userId: user.id, positionId: position.id } })).rejects.toMatchObject({ code: 'P2003' });
    await prisma.userPosition.create({ data: { organizationId, userId: user.id, positionId: position.id, endedAt: new Date() } });
    await expect(prisma.user.update({ where: { id: user.id }, data: { organizationId: otherId } })).rejects.toMatchObject({ code: 'P2003' });
    expect(await prisma.userPosition.findFirst({ where: { userId: user.id } })).toMatchObject({ organizationId });
  });

  it('requires frozen old-parent authority for movement and every idempotent replay', async () => {
    const oldParent = (await send('post', `/${organizationId}/children`, { code: randomUUID(), name: 'Old parent' }).expect(201)).body;
    const newParent = (await send('post', `/${organizationId}/children`, { code: randomUUID(), name: 'New parent' }).expect(201)).body;
    const child = (await send('post', `/${oldParent.id}/children`, { code: randomUUID(), name: 'Movable child' }).expect(201)).body;
    const assignment = await prisma.userRole.findFirstOrThrow({ where: { organizationId: oldParent.id, userId } });
    const identity = { userId, roleId: assignment.roleId, organizationId: oldParent.id };
    await prisma.userRole.delete({ where: { userId_roleId_organizationId: identity } });
    const dto = { parentId: newParent.id, expectedParentId: oldParent.id, expectedVersion: 1 };
    const key = randomUUID();
    const service = app.get(OrganizationService);
    const actor = { id: userId, organizationId, sessionId, accountType: 'INTERNAL' as const };
    await expect(service.update(actor, child.id, dto, randomUUID(), key)).rejects.toMatchObject({ status: 403 });
    expect(await prisma.organization.findUniqueOrThrow({ where: { id: child.id } })).toMatchObject({ parentId: oldParent.id, version: 1 });
    expect(await prisma.adminMutation.count({ where: { actorUserId: userId, key } })).toBe(0);
    await prisma.userRole.create({ data: identity });
    const moved = await service.update(actor, child.id, dto, randomUUID(), key);
    expect(moved).toMatchObject({ parentId: newParent.id, version: 2 });
    await prisma.userRole.delete({ where: { userId_roleId_organizationId: identity } });
    await expect(service.update(actor, child.id, dto, randomUUID(), key)).rejects.toMatchObject({ status: 403 });
    await send('patch', `/${child.id}`, dto, key).expect(403);
    await prisma.userRole.create({ data: identity });
    expect((await send('patch', `/${child.id}`, dto, key).expect(200)).body).toEqual(moved);
    expect(await prisma.auditEvent.count({ where: { resourceId: child.id, action: 'ORGANIZATION_UPDATED' } })).toBe(1);
  });

  it('rejects cross-type movement even when the actor governs both endpoints', async () => {
    const supplier = await prisma.organization.create({ data: { code: randomUUID(), name: 'Supplier', type: 'SUPPLIER' } });
    const permission = await prisma.permission.findUniqueOrThrow({ where: { code: 'organization:manage' } });
    const role = await prisma.role.create({ data: { organizationId: supplier.id, code: randomUUID(), name: 'Explicit', permissions: { create: { permissionId: permission.id } } } });
    await prisma.userRole.create({ data: { organizationId: supplier.id, roleId: role.id, userId } });
    await send('patch', `/${organizationId}`, { parentId: supplier.id, expectedParentId: null, expectedVersion: 1 }).expect(409);
    await send('patch', `/${organizationId}`, { status: 'DISABLED', expectedVersion: 1 }).expect(409);
  });

  it('rejects missing CSRF, excessive pages and foreign structure references', async () => {
    await request(app.getHttpServer()).post(`/api/v1/organizations/${organizationId}/departments`).set('Cookie', cookie).send({ code: randomUUID(), name: 'Denied' }).expect(403);
    await request(app.getHttpServer()).get(`/api/v1/organizations/${organizationId}/departments?limit=101`).set('Cookie', cookie).expect(400);
    const department = (await send('post', `/${organizationId}/departments`, { code: randomUUID(), name: 'Engineering' }).expect(201)).body;
    await send('post', `/${organizationId}/departments`, { code: randomUUID(), name: 'Invalid', parentId: randomUUID() }).expect(404);
    await send('patch', `/${organizationId}/departments/${department.id}`, { parentId: department.id, expectedVersion: 1 }).expect(409);
    await send('post', `/${organizationId}/positions`, { departmentId: randomUUID(), code: randomUUID(), name: 'Invalid' }).expect(404);
  });

  it('requires role authority for canonical appointments and preserves replacement history', async () => {
    const department = (await send('post', `/${organizationId}/departments`, { code: randomUUID(), name: 'Quality' }).expect(201)).body;
    const position = (await send('post', `/${organizationId}/positions`, { departmentId: department.id, code: randomUUID(), name: 'Engineer' }).expect(201)).body;
    const target = await prisma.user.create({ data: { organizationId, username: randomUUID(), accountType: 'INTERNAL', passwordHash: 'unused' } });
    const rolesBefore = await prisma.userRole.count({ where: { userId: target.id } });
    const service = app.get(OrganizationService);
    let actor = { id: userId, organizationId, sessionId, accountType: 'INTERNAL' as const };
    await expect(service.replaceUserPositions(actor, organizationId, target.id, { positionIds: [position.id], expectedPositionIds: [] }, randomUUID(), randomUUID())).rejects.toMatchObject({ status: 403 });
    expect(await prisma.userPosition.count({ where: { userId: target.id } })).toBe(0);
    const assignment = await prisma.userRole.findFirstOrThrow({ where: { userId, organizationId } });
    for (const code of ['account:roles:read', 'account:roles:assign']) {
      const permission = await prisma.permission.upsert({ where: { code }, create: { code, name: code }, update: {} });
      await prisma.rolePermission.create({ data: { roleId: assignment.roleId, permissionId: permission.id } });
    }
    const token = await app.get(SessionService).create(userId, prisma, { mfaVerified: true, reauthenticated: true });
    cookie = `qms_session=${token}; qms_csrf=${csrf}`;
    sessionId = (await app.get(SessionService).resolve(token))!.id;
    actor = { ...actor, sessionId };
    await service.replaceUserPositions(actor, organizationId, target.id, { positionIds: [position.id], expectedPositionIds: [] }, randomUUID(), randomUUID());
    await expect(service.replaceUserPositions(actor, organizationId, target.id, { positionIds: [], expectedPositionIds: [] }, randomUUID(), randomUUID())).rejects.toMatchObject({ status: 409 });
    await service.replaceUserPositions(actor, organizationId, target.id, { positionIds: [], expectedPositionIds: [position.id] }, randomUUID(), randomUUID());
    const response = await request(app.getHttpServer()).get(`/api/v1/organizations/${organizationId}/users/${target.id}/positions`).set('Cookie', cookie).expect(200);
    expect(response.body).toHaveLength(1);
    expect(response.body[0].endedAt).toBeTruthy();
    expect(await prisma.userRole.count({ where: { userId: target.id } })).toBe(rolesBefore);
  });

  it('rolls back structure writes and idempotency when audit persistence fails', async () => {
    const code = randomUUID();
    const key = randomUUID();
    const audit = jest.spyOn(app.get(AuditLogService), 'record').mockRejectedValueOnce(new Error('audit unavailable'));
    await send('post', `/${organizationId}/departments`, { code, name: 'Rollback' }, key).expect(500);
    audit.mockRestore();
    const response = await request(app.getHttpServer()).get(`/api/v1/organizations/${organizationId}/departments`).set('Cookie', cookie).expect(200);
    expect(response.body.some((entry: { code: string }) => entry.code === code)).toBe(false);
    expect(await prisma.adminMutation.count({ where: { actorUserId: userId, key } })).toBe(0);
  });

  it('rejects existing sessions when the home organization is disabled', async () => {
    const child = (await send('post', `/${organizationId}/children`, { code: randomUUID(), name: 'Disabled home' }).expect(201)).body;
    const password = 'Organization-disabled-login-test';
    const user = await prisma.user.create({ data: { organizationId: child.id, username: randomUUID(), accountType: 'INTERNAL', passwordHash: await app.get(PasswordService).hash(password) } });
    const token = await app.get(SessionService).create(user.id);
    await send('patch', `/${child.id}`, { status: 'DISABLED', expectedVersion: 1 }).expect(200);
    expect(await app.get(SessionService).resolve(token)).toBeNull();
    await request(app.getHttpServer()).post('/api/v1/auth/login').set('Cookie', `qms_csrf=${csrf}`).set('x-csrf-token', csrf).send({ identifier: user.username, password }).expect(401);
    await request(app.getHttpServer()).get(`/api/v1/organizations/${child.id}/departments`).set('Cookie', cookie).expect(403);
    await send('patch', `/${child.id}`, { status: 'ACTIVE', expectedVersion: 2 }).expect(200);
  });

  it('does not inherit grants and rechecks explicit permission before replay', async () => {
    const key = randomUUID();
    const body = { code: randomUUID(), name: 'Explicit scope' };
    const child = (await send('post', `/${organizationId}/children`, body, key).expect(201)).body;
    const assignment = await prisma.userRole.findFirstOrThrow({ where: { organizationId: child.id, userId } });
    await prisma.userRole.delete({ where: { userId_roleId_organizationId: { userId, roleId: assignment.roleId, organizationId: child.id } } });
    await request(app.getHttpServer()).get(`/api/v1/organizations/${child.id}/departments`).set('Cookie', cookie).expect(403);
    const parentAssignment = await prisma.userRole.findFirstOrThrow({ where: { organizationId, userId } });
    const permission = await prisma.permission.findUniqueOrThrow({ where: { code: 'organization:manage' } });
    await prisma.rolePermission.delete({ where: { roleId_permissionId: { roleId: parentAssignment.roleId, permissionId: permission.id } } });
    await send('post', `/${organizationId}/children`, body, key).expect(403);
    await prisma.rolePermission.create({ data: { roleId: parentAssignment.roleId, permissionId: permission.id } });
  });

  it('hides disabled organizations from read-only tree users while explicit governors can see and restore them', async () => {
    const child = (await send('post', `/${organizationId}/children`, { code: randomUUID(), name: 'Governed disabled child' }).expect(201)).body;
    await send('patch', `/${child.id}`, { status: 'DISABLED', expectedVersion: 1 }).expect(200);
    const assignment = await prisma.userRole.findFirstOrThrow({ where: { userId, organizationId: child.id } });
    const manage = await prisma.permission.findUniqueOrThrow({ where: { code: 'organization:manage' } });
    await prisma.rolePermission.delete({ where: { roleId_permissionId: { roleId: assignment.roleId, permissionId: manage.id } } });
    const hidden = await request(app.getHttpServer()).get('/api/v1/organizations/tree').set('Cookie', cookie).expect(200);
    expect(hidden.body.some((organization: { id: string }) => organization.id === child.id)).toBe(false);
    expect(hidden.body.some((organization: { id: string }) => organization.id === organizationId)).toBe(true);
    await prisma.rolePermission.create({ data: { roleId: assignment.roleId, permissionId: manage.id } });
    const visible = await request(app.getHttpServer()).get('/api/v1/organizations/tree').set('Cookie', cookie).expect(200);
    expect(visible.body.find((organization: { id: string }) => organization.id === child.id)).toMatchObject({ status: 'DISABLED' });
    await send('patch', `/${child.id}`, { status: 'ACTIVE', expectedVersion: 2 }).expect(200);
    await prisma.rolePermission.delete({ where: { roleId_permissionId: { roleId: assignment.roleId, permissionId: manage.id } } });
    const restored = await request(app.getHttpServer()).get('/api/v1/organizations/tree').set('Cookie', cookie).expect(200);
    expect(restored.body.find((organization: { id: string }) => organization.id === child.id)).toMatchObject({ status: 'ACTIVE' });
  });

  it('rechecks actor identity and status for direct organization tree calls', async () => {
    const service = app.get(OrganizationService);
    const actor = { id: userId, organizationId, sessionId, accountType: 'INTERNAL' as const };
    await expect(service.tree({ ...actor, organizationId: otherId }, {})).rejects.toMatchObject({ status: 401 });
    await prisma.user.update({ where: { id: userId }, data: { status: 'DISABLED' } });
    try {
      await expect(service.tree(actor, {})).rejects.toMatchObject({ status: 401 });
    } finally {
      await prisma.user.update({ where: { id: userId }, data: { status: 'ACTIVE' } });
    }
  });
});
