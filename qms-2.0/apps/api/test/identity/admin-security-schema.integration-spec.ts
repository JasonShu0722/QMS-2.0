import 'reflect-metadata';
import { jest } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { Client } from 'pg';
import { Test } from '@nestjs/testing';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../../src/app.module.js';
import { PrismaService } from '../../src/database/prisma.service.js';
import { GlobalExceptionFilter } from '../../src/common/contracts/global-exception.filter.js';
import { SessionService } from '../../src/modules/identity/session.service.js';
import { PasswordService } from '../../src/modules/identity/password.service.js';
import { AuditLogService } from '../../src/modules/audit-log/audit-log.service.js';
import { IdentityService } from '../../src/modules/identity/identity.service.js';
import { RateLimitService } from '../../src/modules/identity/rate-limit.guard.js';
import { AdminUserService } from '../../src/modules/identity/admin-user.service.js';
import { AdminRoleService } from '../../src/modules/authorization/admin-role.service.js';
import type { UpdateAdminRoleDto } from '../../src/modules/authorization/admin-role.dto.js';

if (!process.env.DATABASE_URL) throw new Error('PostgreSQL integration requires DATABASE_URL; no skipping.');

describe('granular permission PostgreSQL migration', () => {
  it('expands existing global and scoped manage grants without adding reads or changing assignments', async () => {
    const client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    const schema = `matrix_${randomUUID().replaceAll('-', '')}`;
    const migration = 'prisma/migrations/20260919020000_granular_account_permissions/migration.sql';
    try {
      await client.query(`CREATE SCHEMA "${schema}"; SET search_path TO "${schema}"; CREATE TABLE permissions (LIKE public.permissions INCLUDING ALL); CREATE TABLE role_permissions (LIKE public.role_permissions INCLUDING ALL); CREATE TABLE roles (LIKE public.roles INCLUDING ALL); CREATE TABLE user_roles (LIKE public.user_roles INCLUDING ALL)`);
      const globalRole = randomUUID();
      const scopedRole = randomUUID();
      const organizationId = randomUUID();
      const userId = randomUUID();
      const userManage = randomUUID();
      const roleManage = randomUUID();
      const existingWrite = randomUUID();
      const existingRead = randomUUID();
      await client.query('INSERT INTO roles (id, organization_id, code, name) VALUES ($1, NULL, $3, $3), ($2, $4, $3, $3)', [globalRole, scopedRole, 'MIGRATION', organizationId]);
      await client.query('INSERT INTO permissions (id, code, name) VALUES ($1, $2, $2), ($3, $4, $4), ($5, $6, $6)', [userManage, 'account:users:manage', roleManage, 'account:roles:manage', existingWrite, 'account:users:update']);
      await client.query('INSERT INTO permissions (id, code, name) VALUES ($1, $2, $2)', [existingRead, 'account:roles:read']);
      await client.query('INSERT INTO role_permissions (role_id, permission_id) VALUES ($1, $2), ($1, $3), ($1, $4), ($5, $3)', [globalRole, userManage, roleManage, existingWrite, scopedRole]);
      await client.query('INSERT INTO role_permissions (role_id, permission_id) VALUES ($1, $2)', [scopedRole, existingRead]);
      await client.query('INSERT INTO user_roles (user_id, role_id, organization_id) VALUES ($1, $2, $3), ($1, $4, $3)', [userId, globalRole, organizationId, scopedRole]);
      const before = (await client.query('SELECT * FROM user_roles ORDER BY role_id')).rows;
      if (existsSync(migration)) await client.query(readFileSync(migration, 'utf8'));
      const grants = (await client.query('SELECT role_id, code FROM role_permissions JOIN permissions ON id = permission_id')).rows;
      expect(grants.filter((grant) => grant.role_id === globalRole).map((grant) => grant.code).sort()).toEqual([
        'account:users:create', 'account:users:update', 'account:users:status', 'account:users:transfer', 'account:users:reset',
        'account:roles:create', 'account:roles:update', 'account:roles:delete', 'account:roles:assign',
      ].sort());
      expect(grants.filter((grant) => grant.role_id === scopedRole).map((grant) => grant.code).sort()).toEqual(['account:roles:read', 'account:roles:create', 'account:roles:update', 'account:roles:delete', 'account:roles:assign'].sort());
      expect((await client.query('SELECT * FROM permissions WHERE code LIKE $1', ['%:manage'])).rows).toEqual([]);
      expect((await client.query('SELECT id FROM permissions WHERE code LIKE $1', ['%:read'])).rows).toEqual([{ id: existingRead }]);
      expect((await client.query('SELECT * FROM user_roles ORDER BY role_id')).rows).toEqual(before);
      expect((await client.query('SELECT organization_id FROM roles WHERE id = $1', [globalRole])).rows[0].organization_id).toBeNull();
    } finally {
      await client.query('ROLLBACK');
      await client.query(`SET search_path TO public; DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await client.end();
    }
  });
});

describe('administrator security PostgreSQL regression', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let actor: { id: string; organizationId: string; sessionId?: string };
  let target: { id: string; organizationId: string };
  let otherOrganizationId: string;
  let cookie: string;
  const csrf = randomUUID();
  const suffix = randomUUID();
  const permissionCodes = ['account:users:read', 'account:users:create', 'account:users:update', 'account:users:status', 'account:users:transfer', 'account:users:reset', 'account:roles:read', 'account:roles:create', 'account:roles:update', 'account:roles:delete', 'account:roles:assign'];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init();
    prisma = app.get(PrismaService);
    const organization = await prisma.organization.create({ data: { code: `SEC-${suffix}`, name: 'Security A', type: 'INTERNAL' } });
    const other = await prisma.organization.create({ data: { code: `SEC-B-${suffix}`, name: 'Security B', type: 'INTERNAL' } });
    otherOrganizationId = other.id;
    const passwordHash = await app.get(PasswordService).hash('original-password-for-test');
    actor = await prisma.user.create({ data: { organizationId: organization.id, username: `admin-${suffix}`, accountType: 'INTERNAL', passwordHash } });
    target = await prisma.user.create({ data: { organizationId: organization.id, username: `target-${suffix}`, accountType: 'INTERNAL', passwordHash } });
    const permissions = await Promise.all(permissionCodes.map((code) => prisma.permission.upsert({ where: { code }, create: { code, name: code }, update: {} })));
    const role = await prisma.role.create({ data: { organizationId: organization.id, code: 'security-admin', name: 'Security admin', permissions: { create: permissions.map((permission) => ({ permissionId: permission.id })) } } });
    const otherRole = await prisma.role.create({ data: { organizationId: other.id, code: 'security-reader', name: 'Reader' } });
    await prisma.userRole.createMany({ data: [{ userId: actor.id, organizationId: organization.id, roleId: role.id }, { userId: actor.id, organizationId: other.id, roleId: otherRole.id }] });
    const token = await app.get(SessionService).create(actor.id, prisma, { mfaVerified: true, reauthenticated: true });
    actor.sessionId = (await app.get(SessionService).resolve(token))!.id;
    cookie = `qms_session=${token}; qms_csrf=${csrf}`;
  });

  afterAll(async () => {
    if (prisma && actor) {
      const organizations = [actor.organizationId, otherOrganizationId];
      await prisma.auditEvent.deleteMany({ where: { organizationId: { in: organizations } } });
      await prisma.userPosition.deleteMany({ where: { organizationId: { in: organizations } } });
      await prisma.position.deleteMany({ where: { organizationId: { in: organizations } } });
      await prisma.department.deleteMany({ where: { organizationId: { in: organizations } } });
      await prisma.user.deleteMany({ where: { organizationId: { in: organizations } } });
      await prisma.organization.deleteMany({ where: { id: { in: organizations } } });
    }
    await app?.close();
  });

  const trustedActor = () => ({ ...actor, sessionId: actor.sessionId!, accountType: 'INTERNAL' as const });

  async function creationFixture(userId: string, authCookie: string) {
    const assignment = await prisma.userRole.findFirstOrThrow({ where: { userId, organizationId: actor.organizationId } });
    const support = await Promise.all(['organization:structure:read', 'organization:positions:assign'].map((code) => prisma.permission.upsert({ where: { code }, create: { code, name: code }, update: {} })));
    const existing = await prisma.rolePermission.findMany({ where: { roleId: assignment.roleId } });
    const additions = support.filter(({ id }) => !existing.some(({ permissionId }) => permissionId === id));
    await prisma.rolePermission.createMany({ data: additions.map(({ id: permissionId }) => ({ roleId: assignment.roleId, permissionId })) });
    // Historical empty-role position isolates account security from granting new role authority.
    const department = await prisma.department.create({ data: { organizationId: actor.organizationId, code: randomUUID(), name: 'Creation security fixture' } });
    const position = await prisma.position.create({ data: { organizationId: actor.organizationId, departmentId: department.id, code: randomUUID(), name: 'Empty legacy position' } });
    const preview = await request(app.getHttpServer()).post(`/api/v1/organizations/${actor.organizationId}/position-authorization/preview`).set('Cookie', authCookie).set('x-csrf-token', csrf).send({ positionIds: [position.id] }).expect(200);
    return {
      input: { positionIds: [position.id], authorizationBaseline: preview.body.authorizationBaseline as string },
      cleanup: () => prisma.rolePermission.deleteMany({ where: { roleId: assignment.roleId, permissionId: { in: additions.map(({ id }) => id) } } }),
    };
  }

  it.each(['users:create', 'users:update', 'users:status', 'users:transfer', 'users:reset', 'roles:create', 'roles:update', 'roles:delete', 'roles:assign'])('enforces isolated account:%s authority; legacy role HTTP stays frozen and trusted service keeps domain checks', async (operation) => {
    const organizationId = actor.organizationId;
    const permission = await prisma.permission.findUniqueOrThrow({ where: { code: `account:${operation}` } });
    const limited = await prisma.user.create({ data: { organizationId, username: `isolated-${randomUUID()}`, accountType: 'INTERNAL', passwordHash: 'unused-test-hash' } });
    const subject = await prisma.user.create({ data: { organizationId, username: `subject-${randomUUID()}`, accountType: 'INTERNAL', passwordHash: 'unused-test-hash' } });
    const limitedRole = await prisma.role.create({ data: { organizationId, code: randomUUID(), name: 'Isolated', permissions: { create: { permissionId: permission.id } } } });
    const editableRole = await prisma.role.create({ data: { organizationId, code: randomUUID(), name: 'Editable' } });
    await prisma.userRole.create({ data: { userId: limited.id, organizationId, roleId: limitedRole.id } });
    const token = await app.get(SessionService).create(limited.id, prisma, { mfaVerified: true, reauthenticated: true });
    const limitedActor = { ...limited, accountType: 'INTERNAL' as const, sessionId: (await app.get(SessionService).resolve(token))!.id };
    const limitedCookie = `qms_session=${token}; qms_csrf=${csrf}`;
    const initial = operation === 'users:create' ? await creationFixture(limited.id, limitedCookie) : undefined;
    const send = (method: 'post' | 'patch' | 'delete' | 'put', path: string, body: object) => request(app.getHttpServer())[method](`/api/v1/admin${path}`).set('Cookie', limitedCookie).set('x-csrf-token', csrf).set('Idempotency-Key', randomUUID()).send(body);
    try {
      const actions = [
        { permission: 'users:create', status: 201, run: () => send('post', '/users', { organizationId, username: `created-${randomUUID()}`, accountType: 'INTERNAL', initialPassword: 'isolated-initial-password', ...initial?.input }) },
        { permission: 'users:update', status: 200, run: () => send('patch', `/users/${subject.id}`, { email: `isolated-${subject.id}@example.test`, expectedProfileVersion: 1 }) },
        { permission: 'users:status', status: 200, run: () => send('patch', `/users/${subject.id}`, { status: 'DISABLED' }) },
        { permission: 'users:transfer', status: 200, run: () => send('patch', `/users/${subject.id}`, { accountType: 'INTERNAL' }) },
        { permission: 'users:reset', status: 201, run: () => send('post', `/users/${subject.id}/password-reset`, { temporaryCode: randomUUID() }) },
      ];
      for (const action of actions) await action.run().expect(action.permission === operation ? action.status : 403);
      const roles = app.get(AdminRoleService);
      const create = { organizationId, code: `ROLE-${randomUUID()}`, name: 'Created', permissionCodes: [] };
      const roleActions = [
        { permission: 'roles:create', http: () => send('post', '/roles', create), trusted: () => roles.create(limitedActor, create, randomUUID(), randomUUID()) },
        { permission: 'roles:update', http: () => send('patch', `/roles/${editableRole.id}`, { name: 'Renamed' }), trusted: () => roles.update(limitedActor, editableRole.id, { name: 'Renamed' }, randomUUID(), randomUUID()) },
        { permission: 'roles:delete', http: () => send('delete', `/roles/${editableRole.id}`, {}), trusted: () => roles.remove(limitedActor, editableRole.id, randomUUID(), randomUUID()) },
        { permission: 'roles:assign', http: () => send('put', `/users/${subject.id}/roles`, { roleIds: [] }), trusted: () => roles.assign(limitedActor, subject.id, { roleIds: [] }, randomUUID(), randomUUID()) },
      ];
      for (const action of roleActions) {
        const before = await prisma.role.findMany({ where: { organizationId }, include: { permissions: true }, orderBy: { id: 'asc' } });
        const userBefore = await prisma.user.findUniqueOrThrow({ where: { id: subject.id } });
        const assignmentsBefore = await prisma.userRole.findMany({ where: { userId: subject.id } });
        await action.http().expect(403);
        expect(await prisma.role.findMany({ where: { organizationId }, include: { permissions: true }, orderBy: { id: 'asc' } })).toEqual(before);
        expect(await prisma.user.findUniqueOrThrow({ where: { id: subject.id } })).toEqual(userBefore);
        expect(await prisma.userRole.findMany({ where: { userId: subject.id } })).toEqual(assignmentsBefore);
        if (action.permission === operation) {
          await action.trusted();
          if (operation === 'roles:create') expect(await prisma.role.count({ where: { organizationId, code: create.code } })).toBe(1);
          if (operation === 'roles:update') expect(await prisma.role.findUniqueOrThrow({ where: { id: editableRole.id } })).toMatchObject({ name: 'Renamed' });
          if (operation === 'roles:delete') expect(await prisma.role.findUnique({ where: { id: editableRole.id } })).toBeNull();
          if (operation === 'roles:assign') expect(await prisma.userRole.count({ where: { userId: subject.id } })).toBe(0);
        } else await expect(action.trusted()).rejects.toMatchObject({ status: 403 });
      }
      await request(app.getHttpServer()).get('/api/v1/admin/users').set('Cookie', limitedCookie).expect(403);
      await request(app.getHttpServer()).get('/api/v1/admin/permission-catalog').set('Cookie', limitedCookie).expect(403);
      const copy = { code: `COPY-${randomUUID()}`, name: 'Copied' };
      await send('post', `/roles/${editableRole.id}/copy`, copy).expect(403);
      if (operation === 'roles:create') {
        const copied = await roles.copy(limitedActor, editableRole.id, copy, randomUUID(), randomUUID());
        expect(await prisma.role.findUnique({ where: { id: copied.id } })).toMatchObject({ code: copy.code });
      } else await expect(roles.copy(limitedActor, editableRole.id, copy, randomUUID(), randomUUID())).rejects.toMatchObject({ status: 403 });
    } finally { await initial?.cleanup(); }
  });

  it.each(permissionCodes)('trusted role service rolls back self-lock when removing %s', async (permissionCode) => {
    const role = await prisma.role.findFirstOrThrow({ where: { organizationId: actor.organizationId, code: 'security-admin' }, include: { permissions: { include: { permission: true } } } });
    const key = randomUUID();
    await expect(app.get(AdminRoleService).update(trustedActor(), role.id, { permissionCodes: permissionCodes.filter((code) => code !== permissionCode), expectedPermissionCodes: permissionCodes }, randomUUID(), key)).rejects.toMatchObject({ status: 409, response: { code: 'ADMIN_SELF_LOCK_FORBIDDEN' } });
    const after = await prisma.role.findUniqueOrThrow({ where: { id: role.id }, include: { permissions: { include: { permission: true } } } });
    expect(after.permissions.map((entry) => entry.permission.code).sort()).toEqual(permissionCodes.slice().sort());
    expect(await prisma.adminMutation.count({ where: { actorUserId: actor.id, key } })).toBe(0);
  });

  it('rejects mixed PATCH atomically and rechecks every permission before replay', async () => {
    const organizationId = actor.organizationId;
    const permissions = await prisma.permission.findMany({ where: { code: { in: ['account:users:update', 'account:users:status'] } } });
    const limited = await prisma.user.create({ data: { organizationId, username: `mixed-${randomUUID()}`, accountType: 'INTERNAL', passwordHash: 'unused-test-hash' } });
    const subject = await prisma.user.create({ data: { organizationId, username: `mixed-subject-${randomUUID()}`, accountType: 'INTERNAL', passwordHash: 'unused-test-hash' } });
    const updatePermission = permissions.find((permission) => permission.code === 'account:users:update')!;
    const statusPermission = permissions.find((permission) => permission.code === 'account:users:status')!;
    const role = await prisma.role.create({ data: { organizationId, code: randomUUID(), name: 'Mixed', permissions: { create: { permissionId: updatePermission.id } } } });
    await prisma.userRole.create({ data: { userId: limited.id, roleId: role.id, organizationId } });
    const limitedSession = (await app.get(SessionService).resolve(await app.get(SessionService).create(limited.id, prisma, { mfaVerified: true, reauthenticated: true })))!;
    const limitedActor = { id: limited.id, sessionId: limitedSession.id, organizationId, accountType: 'INTERNAL' as const };
    const service = app.get(AdminUserService);
    const body = { email: `mixed-${subject.id}@example.test`, status: 'DISABLED' as const, expectedProfileVersion: 1 };
    const key = randomUUID();
    await expect(service.update(limitedActor, subject.id, body, organizationId, randomUUID(), key)).rejects.toMatchObject({ status: 403 });
    expect(await prisma.user.findUniqueOrThrow({ where: { id: subject.id } })).toMatchObject({ email: null, status: 'ACTIVE' });
    expect(await prisma.adminMutation.count({ where: { actorUserId: limited.id, key } })).toBe(0);
    await prisma.rolePermission.create({ data: { roleId: role.id, permissionId: statusPermission.id } });
    await service.update(limitedActor, subject.id, body, organizationId, randomUUID(), key);
    await prisma.rolePermission.delete({ where: { roleId_permissionId: { roleId: role.id, permissionId: statusPermission.id } } });
    await expect(service.update(limitedActor, subject.id, body, organizationId, randomUUID(), key)).rejects.toMatchObject({ status: 403 });
    expect(await prisma.auditEvent.count({ where: { actorUserId: limited.id, action: 'USER_UPDATED' } })).toBe(1);
  });

  it('trusted role service rejects absent and stale role baselines without changing names, permissions or reset codes', async () => {
    const organizationId = actor.organizationId;
    const permission = await prisma.permission.findUniqueOrThrow({ where: { code: 'account:users:read' } });
    const role = await prisma.role.create({ data: { organizationId, code: randomUUID(), name: 'Original', permissions: { create: { permissionId: permission.id } } } });
    await prisma.userRole.create({ data: { userId: target.id, roleId: role.id, organizationId } });
    const reset = await prisma.passwordReset.create({ data: { userId: target.id, codeHash: '0'.repeat(64), expiresAt: new Date(Date.now() + 60_000) } });
    const update = (body: UpdateAdminRoleDto) => app.get(AdminRoleService).update(trustedActor(), role.id, body, randomUUID(), randomUUID());
    await expect(update({ name: 'Wrong', permissionCodes: [] })).rejects.toMatchObject({ status: 400 });
    await expect(update({ name: 'Wrong', permissionCodes: [], expectedPermissionCodes: [] })).rejects.toMatchObject({ status: 409, response: { code: 'CONCURRENCY_CONFLICT' } });
    expect(await prisma.role.findUniqueOrThrow({ where: { id: role.id }, include: { permissions: true } })).toMatchObject({ name: 'Original', permissions: [{ permissionId: permission.id }] });
    expect((await prisma.passwordReset.findUniqueOrThrow({ where: { id: reset.id } })).consumedAt).toBeNull();
    await update({ name: 'Renamed' });
    await update({ permissionCodes: [], expectedPermissionCodes: ['account:users:read'] });
    expect(await prisma.rolePermission.count({ where: { roleId: role.id } })).toBe(0);
  });

  it('rechecks destination transfer authority before replaying a successful transfer', async () => {
    const destination = await prisma.role.findFirstOrThrow({ where: { organizationId: otherOrganizationId } });
    const permission = await prisma.permission.findUniqueOrThrow({ where: { code: 'account:users:transfer' } });
    const subject = await prisma.user.create({ data: { organizationId: actor.organizationId, username: `replay-transfer-${randomUUID()}`, accountType: 'INTERNAL', passwordHash: 'unused-test-hash' } });
    await prisma.rolePermission.create({ data: { roleId: destination.id, permissionId: permission.id } });
    const service = app.get(AdminUserService);
    const key = randomUUID();
    const body = { organizationId: otherOrganizationId };
    const currentActor = { ...actor, sessionId: actor.sessionId!, accountType: 'INTERNAL' as const };
    try {
      await service.update(currentActor, subject.id, body, actor.organizationId, randomUUID(), key);
      await prisma.rolePermission.delete({ where: { roleId_permissionId: { roleId: destination.id, permissionId: permission.id } } });
      await expect(service.update(currentActor, subject.id, body, actor.organizationId, randomUUID(), key)).rejects.toMatchObject({ status: 403 });
    } finally { await prisma.rolePermission.deleteMany({ where: { roleId: destination.id } }); }
  });

  it('trusted role service rejects database-inserted planned permissions even when the acting administrator holds them', async () => {
    const permission = await prisma.permission.create({ data: { code: `supplier:planned:${suffix}`, name: 'Forged planned operation' } });
    const role = await prisma.role.findFirstOrThrow({ where: { organizationId: actor.organizationId, code: 'security-admin' } });
    await prisma.rolePermission.create({ data: { roleId: role.id, permissionId: permission.id } });
    try {
      await expect(app.get(AdminRoleService).create(trustedActor(), { organizationId: actor.organizationId, code: `FORGED-${suffix}`, name: 'Forged', permissionCodes: [permission.code] }, randomUUID(), randomUUID())).rejects.toMatchObject({ status: 400, response: { code: 'ADMIN_PERMISSION_NOT_FOUND' } });
      const catalog = await request(app.getHttpServer()).get('/api/v1/admin/permission-catalog').set('Cookie', cookie).expect(200);
      expect(JSON.stringify(catalog.body)).not.toContain(permission.code);
    } finally { await prisma.permission.delete({ where: { id: permission.id } }); }
  });

  it('rejects home-org management permission used with an unrelated role in the selected organization', async () => {
    const response = await request(app.getHttpServer()).get(`/api/v1/admin/users?organizationId=${otherOrganizationId}`).set('Cookie', cookie).expect(403);
    expect(response.body.code).toBe('FEATURE_PERMISSION_DENIED');
  });

  it('rejects malformed organization IDs before PostgreSQL reads', async () => {
    await request(app.getHttpServer()).get('/api/v1/admin/roles?organizationId=not-a-uuid').set('Cookie', cookie).expect(400);
  });

  it('rejects an internal creation without initial positions and preview before any account write', async () => {
    const username = `missing-position-${suffix}`;
    const key = randomUUID();
    await request(app.getHttpServer()).post('/api/v1/admin/users').set('Cookie', cookie).set('x-csrf-token', csrf).set('Idempotency-Key', key).send({ organizationId: actor.organizationId, username, accountType: 'INTERNAL', initialPassword: 'initial-password-for-test' }).expect(400);
    expect(await prisma.user.count({ where: { username } })).toBe(0);
    expect(await prisma.adminMutation.count({ where: { actorUserId: actor.id, key } })).toBe(0);
  });

  it('replays a creation once and rejects a changed payload for the same key', async () => {
    const initial = await creationFixture(actor.id, cookie);
    try {
      const key = randomUUID();
      const body = { organizationId: actor.organizationId, username: `new-${suffix}`, accountType: 'INTERNAL', initialPassword: 'initial-password-for-test', ...initial.input };
      const send = (payload: object) => request(app.getHttpServer()).post('/api/v1/admin/users').set('Cookie', cookie).set('x-csrf-token', csrf).set('Idempotency-Key', key).send(payload);
      const first = await send(body).expect(201);
      const second = await send(body).expect(201);
      expect(second.body).toEqual(first.body);
      expect(await prisma.userPosition.count({ where: { userId: first.body.id, positionId: initial.input.positionIds[0] } })).toBe(1);
      await send({ ...body, username: `changed-${suffix}` }).expect(409);
      expect(await prisma.auditEvent.count({ where: { actorUserId: actor.id, resourceId: first.body.id, action: 'USER_CREATED' } })).toBe(1);
      const stored = await prisma.adminMutation.findFirstOrThrow({ where: { actorUserId: actor.id, key } });
      expect(stored.requestDigest).toMatch(/^[a-f0-9]{64}$/);
      expect(JSON.stringify(stored).includes(body.initialPassword)).toBe(false);
    } finally { await initial.cleanup(); }
  });

  it('issues a one-time code without changing the password and atomically consumes it', async () => {
    const temporaryCode = `${randomUUID()}${randomUUID()}`;
    const issued = await request(app.getHttpServer()).post(`/api/v1/admin/users/${target.id}/password-reset`).set('Cookie', cookie).set('x-csrf-token', csrf).set('Idempotency-Key', randomUUID()).send({ temporaryCode }).expect(201);
    const passwords = app.get(PasswordService);
    expect(await passwords.verify((await prisma.user.findUniqueOrThrow({ where: { id: target.id } })).passwordHash, 'original-password-for-test')).toBe(true);
    const token = await app.get(SessionService).create(target.id);
    const body = { resetId: issued.body.resetId, temporaryCode, newPassword: 'replacement-password-for-test' };
    const complete = () => request(app.getHttpServer()).post('/api/v1/auth/password-reset/complete').set('Cookie', `qms_csrf=${csrf}`).set('x-csrf-token', csrf).send(body);
    await complete().expect(204);
    await complete().expect(400);
    expect(await passwords.verify((await prisma.user.findUniqueOrThrow({ where: { id: target.id } })).passwordHash, body.newPassword)).toBe(true);
    expect(await app.get(SessionService).resolve(token)).toBeNull();
  });

  it('enforces global case-insensitive username uniqueness across organizations', async () => {
    const current = await prisma.user.findUniqueOrThrow({ where: { id: actor.id } });
    await expect(prisma.user.create({ data: { organizationId: otherOrganizationId, username: current.username.toUpperCase(), accountType: 'INTERNAL', passwordHash: current.passwordHash }, select: { id: true } })).rejects.toMatchObject({ code: 'P2002' });
  });

  it.each(['reset', 'password change', 'disable', 'organization', 'account type'] as const)('rejects a verified login when %s commits before session creation', async (mutation) => {
    const passwords = app.get(PasswordService);
    const sessions = app.get(SessionService);
    const password = 'login-race-original-password';
    const user = await prisma.user.create({ data: { organizationId: actor.organizationId, username: `login-race-${randomUUID()}`, accountType: 'INTERNAL', passwordHash: await passwords.hash(password) } });
    const current = mutation === 'password change' ? await sessions.resolve(await sessions.create(user.id, prisma, { reauthenticated: true })) : null;
    const temporaryCode = randomUUID();
    const issued = mutation === 'reset' ? await request(app.getHttpServer()).post(`/api/v1/admin/users/${user.id}/password-reset`).set('Cookie', cookie).set('x-csrf-token', csrf).set('Idempotency-Key', randomUUID()).send({ temporaryCode }).expect(201) : null;
    let signalVerified!: () => void;
    let releaseLogin!: () => void;
    const verified = new Promise<void>((resolve) => { signalVerified = resolve; });
    const released = new Promise<void>((resolve) => { releaseLogin = resolve; });
    const verify = passwords.verify.bind(passwords);
    const paused = jest.spyOn(passwords, 'verify').mockImplementationOnce(async (hash, candidate) => {
      const matches = await verify(hash, candidate);
      signalVerified();
      await released;
      return matches;
    });
    const success = jest.spyOn(app.get(RateLimitService), 'recordSuccess');
    const login = request(app.getHttpServer()).post('/api/v1/auth/login').set('Cookie', `qms_csrf=${csrf}`).set('x-csrf-token', csrf).send({ identifier: user.username, password }).then((response) => response);
    try {
      await verified;
      if (mutation === 'reset') {
        await request(app.getHttpServer()).post('/api/v1/auth/password-reset/complete').set('Cookie', `qms_csrf=${csrf}`).set('x-csrf-token', csrf).send({ resetId: issued!.body.resetId, temporaryCode, newPassword: 'login-race-replacement-password' }).expect(204);
      } else if (mutation === 'password change') {
        await app.get(IdentityService).changePassword({ userId: user.id, currentSessionId: current!.id, currentPassword: password, newPassword: 'login-race-replacement-password', traceId: randomUUID() });
      } else if (mutation === 'disable') {
        await request(app.getHttpServer()).patch(`/api/v1/admin/users/${user.id}`).set('Cookie', cookie).set('x-csrf-token', csrf).set('Idempotency-Key', randomUUID()).send({ status: 'DISABLED' }).expect(200);
      } else {
        await prisma.$transaction(async (transaction) => {
          await transaction.user.update({ where: { id: user.id }, data: mutation === 'organization' ? { organizationId: otherOrganizationId } : { accountType: 'SUPPLIER' } });
          await transaction.session.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } });
        });
      }
      releaseLogin();
      const response = await login;
      expect(response.status).toBe(401);
      expect(response.body.code).toBe('AUTH_INVALID_CREDENTIALS');
      expect(response.headers['set-cookie']).toBeUndefined();
      expect(success).not.toHaveBeenCalled();
      expect(await prisma.session.count({ where: { userId: user.id, revokedAt: null } })).toBe(current ? 1 : 0);
      expect(await prisma.auditEvent.count({ where: { resourceId: user.id, action: 'LOGIN_FAILED', traceId: response.body.traceId } })).toBe(1);
    } finally {
      releaseLogin();
      await login;
      paused.mockRestore();
      success.mockRestore();
    }
  });

  it('revokes a login session that commits before password reset completes', async () => {
    const password = 'login-before-reset-password';
    const user = await prisma.user.create({ data: { organizationId: actor.organizationId, username: `login-first-${randomUUID()}`, accountType: 'INTERNAL', passwordHash: await app.get(PasswordService).hash(password) } });
    const temporaryCode = randomUUID();
    const issued = await request(app.getHttpServer()).post(`/api/v1/admin/users/${user.id}/password-reset`).set('Cookie', cookie).set('x-csrf-token', csrf).set('Idempotency-Key', randomUUID()).send({ temporaryCode }).expect(201);
    const login = await request(app.getHttpServer()).post('/api/v1/auth/login').set('Cookie', `qms_csrf=${csrf}`).set('x-csrf-token', csrf).send({ identifier: user.username, password }).expect(200);
    const sessionCookie = (login.headers['set-cookie'] as unknown as string[]).find((entry) => entry.startsWith('qms_session='))!.split(';', 1)[0];
    await request(app.getHttpServer()).get('/api/v1/auth/session').set('Cookie', sessionCookie).expect(200);
    await request(app.getHttpServer()).post('/api/v1/auth/password-reset/complete').set('Cookie', `qms_csrf=${csrf}`).set('x-csrf-token', csrf).send({ resetId: issued.body.resetId, temporaryCode, newPassword: 'login-first-replacement-password' }).expect(204);
    await request(app.getHttpServer()).get('/api/v1/auth/session').set('Cookie', sessionCookie).expect(401);
    expect(await prisma.session.count({ where: { userId: user.id, revokedAt: null } })).toBe(0);
  });

  it('holds the user lock until the verified login session is committed', async () => {
    const password = 'login-lock-original-password';
    const passwords = app.get(PasswordService);
    const replacementHash = await passwords.hash('login-lock-replacement-password');
    const user = await prisma.user.create({ data: { organizationId: actor.organizationId, username: `login-lock-${randomUUID()}`, accountType: 'INTERNAL', passwordHash: await passwords.hash(password) } });
    const sessions = app.get(SessionService);
    const create = sessions.createWithMetadata.bind(sessions);
    let signalCreating!: () => void;
    let releaseLogin!: () => void;
    const creating = new Promise<void>((resolve) => { signalCreating = resolve; });
    const released = new Promise<void>((resolve) => { releaseLogin = resolve; });
    const paused = jest.spyOn(sessions, 'createWithMetadata').mockImplementationOnce(async (...args) => {
      signalCreating();
      await released;
      return create(...args);
    });
    const login = request(app.getHttpServer()).post('/api/v1/auth/login').set('Cookie', `qms_csrf=${csrf}`).set('x-csrf-token', csrf).send({ identifier: user.username, password }).then((response) => response);
    try {
      await creating;
      await expect(prisma.$transaction(async (transaction) => {
        await transaction.$executeRaw`SET LOCAL lock_timeout = '100ms'`;
        await transaction.$executeRaw`UPDATE users SET password_hash = ${replacementHash} WHERE id = ${user.id}::uuid`;
      })).rejects.toThrow('canceling statement due to lock timeout');
      releaseLogin();
      expect((await login).status).toBe(200);
      expect(await prisma.session.count({ where: { userId: user.id, revokedAt: null } })).toBe(1);
      await prisma.user.update({ where: { id: user.id }, data: { passwordHash: replacementHash } });
    } finally {
      releaseLogin();
      await login;
      paused.mockRestore();
    }
  });

  it('exposes only organizations with actual administration permissions', async () => {
    const response = await request(app.getHttpServer()).get('/api/v1/admin/organizations').set('Cookie', cookie).expect(200);
    expect(response.body).toEqual([expect.objectContaining({ id: actor.organizationId, type: 'INTERNAL', permissions: expect.arrayContaining(permissionCodes) })]);
  });

  it.each(['organization:read', 'organization:structure:read'])('exposes read-only organization structure for %s without granting management', async (code) => {
    const role = await prisma.role.findFirstOrThrow({ where: { organizationId: otherOrganizationId, code: 'security-reader' } });
    const permission = await prisma.permission.upsert({ where: { code }, create: { code, name: code }, update: {} });
    await prisma.rolePermission.create({ data: { roleId: role.id, permissionId: permission.id } });
    try {
      const response = await request(app.getHttpServer()).get('/api/v1/admin/organizations').set('Cookie', cookie).expect(200);
      expect(response.body.find((entry: { id: string }) => entry.id === otherOrganizationId)).toMatchObject({ id: otherOrganizationId, permissions: [code] });
      await request(app.getHttpServer()).get(`/api/v1/organizations/${otherOrganizationId}/lifecycle`).set('Cookie', cookie).expect(403);
      await request(app.getHttpServer()).post(`/api/v1/organizations/${otherOrganizationId}/children`).set('Cookie', cookie).set('x-csrf-token', csrf).set('Idempotency-Key', randomUUID()).send({ code: randomUUID(), name: 'Forbidden child' }).expect(403);
    } finally {
      await prisma.rolePermission.delete({ where: { roleId_permissionId: { roleId: role.id, permissionId: permission.id } } });
    }
  });

  it('exposes customer master organizations without granting platform administration tabs', async () => {
    const role = await prisma.role.findFirstOrThrow({ where: { organizationId: otherOrganizationId, code: 'security-reader' } });
    const permission = await prisma.permission.findUniqueOrThrow({ where: { code: 'customer-quality:complaints:read' } });
    await prisma.rolePermission.create({ data: { roleId: role.id, permissionId: permission.id } });
    try {
      const response = await request(app.getHttpServer()).get('/api/v1/admin/organizations').set('Cookie', cookie).expect(200);
      const other = response.body.find((entry: { id: string }) => entry.id === otherOrganizationId);
      expect(other).toMatchObject({ id: otherOrganizationId, type: 'INTERNAL', permissions: ['customer-quality:complaints:read'] });
      expect(other.permissions).not.toContain('account:users:read');
    } finally {
      await prisma.rolePermission.delete({ where: { roleId_permissionId: { roleId: role.id, permissionId: permission.id } } });
    }
  });

  it('does not expose a supplier customer-read organization as a domain directory', async () => {
    const supplierOrganization = await prisma.organization.create({ data: { code: `SEC-SUP-${suffix}`, name: 'Supplier customer reader', type: 'SUPPLIER' } });
    const supplierUser = await prisma.user.create({ data: { organizationId: supplierOrganization.id, username: `supplier-reader-${suffix}`, accountType: 'SUPPLIER', passwordHash: 'unused-test-hash' } });
    const supplierRole = await prisma.role.create({ data: { organizationId: supplierOrganization.id, code: `SUPPLIER-READER-${suffix}`, name: 'Supplier reader' } });
    const permission = await prisma.permission.findUniqueOrThrow({ where: { code: 'customer-quality:complaints:read' } });
    await prisma.rolePermission.create({ data: { roleId: supplierRole.id, permissionId: permission.id } });
    await prisma.userRole.create({ data: { userId: supplierUser.id, organizationId: supplierOrganization.id, roleId: supplierRole.id } });
    const token = await app.get(SessionService).create(supplierUser.id, prisma, { reauthenticated: true });
    try {
      const response = await request(app.getHttpServer()).get('/api/v1/admin/organizations').set('Cookie', `qms_session=${token}`).expect(200);
      expect(response.body).toEqual([]);
    } finally {
      await prisma.session.deleteMany({ where: { userId: supplierUser.id } });
      await prisma.userRole.deleteMany({ where: { userId: supplierUser.id } });
      await prisma.rolePermission.deleteMany({ where: { roleId: supplierRole.id } });
      await prisma.role.delete({ where: { id: supplierRole.id } });
      await prisma.user.delete({ where: { id: supplierUser.id } });
      await prisma.organization.delete({ where: { id: supplierOrganization.id } });
    }
  });

  it('does not clear global roles by moving a user through the lifecycle endpoint', async () => {
    const global = await prisma.role.create({ data: { code: `GLOBAL-${suffix}`, name: 'Global' } });
    const destination = await prisma.role.findFirstOrThrow({ where: { organizationId: otherOrganizationId } });
    const permission = await prisma.permission.findUniqueOrThrow({ where: { code: 'account:users:transfer' } });
    await prisma.rolePermission.create({ data: { roleId: destination.id, permissionId: permission.id } });
    await prisma.userRole.create({ data: { userId: target.id, roleId: global.id, organizationId: actor.organizationId } });
    try {
      const response = await request(app.getHttpServer()).patch(`/api/v1/admin/users/${target.id}?organizationId=${actor.organizationId}`).set('Cookie', cookie).set('x-csrf-token', csrf).set('Idempotency-Key', randomUUID()).send({ organizationId: otherOrganizationId }).expect(409);
      expect(response.body.code).toBe('ADMIN_GLOBAL_ROLE_IMMUTABLE');
      expect(await prisma.userRole.count({ where: { userId: target.id, roleId: global.id } })).toBe(1);
    } finally {
      await prisma.user.update({ where: { id: target.id }, data: { organizationId: actor.organizationId } });
      await prisma.role.delete({ where: { id: global.id } });
      await prisma.rolePermission.deleteMany({ where: { roleId: destination.id } });
    }
  });

  it('trusted role assignment invalidates issued reset codes when assignments change', async () => {
    const temporaryCode = `${randomUUID()}${randomUUID()}`;
    const issued = await request(app.getHttpServer()).post(`/api/v1/admin/users/${target.id}/password-reset`).set('Cookie', cookie).set('x-csrf-token', csrf).set('Idempotency-Key', randomUUID()).send({ temporaryCode }).expect(201);
    const permission = await prisma.permission.findUniqueOrThrow({ where: { code: 'account:users:read' } });
    const role = await prisma.role.create({ data: { organizationId: actor.organizationId, code: 'RESET-CHANGE', name: 'Reset change', permissions: { create: { permissionId: permission.id } } } });
    await app.get(AdminRoleService).assign(trustedActor(), target.id, { roleIds: [role.id] }, randomUUID(), randomUUID());
    await request(app.getHttpServer()).post('/api/v1/auth/password-reset/complete').set('Cookie', `qms_csrf=${csrf}`).set('x-csrf-token', csrf).send({ resetId: issued.body.resetId, temporaryCode, newPassword: 'new-password-after-roles' }).expect(400);
  });

  it('rolls back user creation and its replay entry when audit storage fails', async () => {
    const initial = await creationFixture(actor.id, cookie);
    try {
      const username = `rollback-${suffix}`;
      const key = randomUUID();
      const failure = jest.spyOn(app.get(AuditLogService), 'record').mockRejectedValueOnce(new Error('audit unavailable'));
      try {
        await request(app.getHttpServer()).post('/api/v1/admin/users').set('Cookie', cookie).set('x-csrf-token', csrf).set('Idempotency-Key', key).send({ organizationId: actor.organizationId, username, accountType: 'INTERNAL', initialPassword: 'initial-password-for-test', ...initial.input }).expect(500);
        expect(await prisma.user.count({ where: { username } })).toBe(0);
        expect(await prisma.userPosition.count({ where: { positionId: initial.input.positionIds[0] } })).toBe(0);
        expect(await prisma.adminMutation.count({ where: { actorUserId: actor.id, key } })).toBe(0);
      } finally { failure.mockRestore(); }
    } finally { await initial.cleanup(); }
  });

  it('handles concurrent retries without duplicating the mutation or audit', async () => {
    const initial = await creationFixture(actor.id, cookie);
    try {
      const key = randomUUID();
      const username = `concurrent-${suffix}`;
      const send = () => request(app.getHttpServer()).post('/api/v1/admin/users').set('Cookie', cookie).set('x-csrf-token', csrf).set('Idempotency-Key', key).send({ organizationId: actor.organizationId, username, accountType: 'INTERNAL', initialPassword: 'initial-password-for-test', ...initial.input });
      const responses = await Promise.all([send(), send()]);
      expect(responses.map((response) => response.status)).toContain(201);
      expect(responses.every((response) => [201, 409].includes(response.status))).toBe(true);
      const replay = await send().expect(201);
      expect(await prisma.auditEvent.count({ where: { action: 'USER_CREATED', resourceId: replay.body.id } })).toBe(1);
      expect(await prisma.userPosition.count({ where: { userId: replay.body.id, positionId: initial.input.positionIds[0] } })).toBe(1);
    } finally { await initial.cleanup(); }
  });

  it('requires Idempotency-Key and rejects null account fields and ambiguous usernames', async () => {
    await request(app.getHttpServer()).post(`/api/v1/admin/users/${target.id}/password-reset`).set('Cookie', cookie).set('x-csrf-token', csrf).send({ temporaryCode: randomUUID() }).expect(400);
    for (const body of [{ accountType: null }, { status: null }, { organizationId: null }]) {
      await request(app.getHttpServer()).patch(`/api/v1/admin/users/${target.id}`).set('Cookie', cookie).set('x-csrf-token', csrf).set('Idempotency-Key', randomUUID()).send(body).expect(400);
    }
    await request(app.getHttpServer()).post('/api/v1/admin/users').set('Cookie', cookie).set('x-csrf-token', csrf).set('Idempotency-Key', randomUUID()).send({ organizationId: actor.organizationId, username: 'someone@example.test', accountType: 'INTERNAL', initialPassword: 'initial-password-for-test' }).expect(400);
  });

  it('moves users from query scope to body scope and clears sessions and old roles', async () => {
    const destination = await prisma.role.findFirstOrThrow({ where: { organizationId: otherOrganizationId } });
    const permission = await prisma.permission.findUniqueOrThrow({ where: { code: 'account:users:transfer' } });
    await prisma.rolePermission.create({ data: { roleId: destination.id, permissionId: permission.id } });
    const token = await app.get(SessionService).create(target.id);
    try {
      const moved = await request(app.getHttpServer()).patch(`/api/v1/admin/users/${target.id}?organizationId=${actor.organizationId}`).set('Cookie', cookie).set('x-csrf-token', csrf).set('Idempotency-Key', randomUUID()).send({ organizationId: otherOrganizationId }).expect(200);
      expect(moved.body.organizationId).toBe(otherOrganizationId);
      expect(await prisma.userRole.count({ where: { userId: target.id } })).toBe(0);
      expect(await app.get(SessionService).resolve(token)).toBeNull();
    } finally {
      await prisma.user.update({ where: { id: target.id }, data: { organizationId: actor.organizationId } });
      await prisma.rolePermission.deleteMany({ where: { roleId: destination.id } });
    }
  });

  it('rejects reset or lifecycle changes of a more privileged user and records rejection', async () => {
    const permission = await prisma.permission.create({ data: { code: `test:secret:${suffix}`, name: 'Secret' } });
    const role = await prisma.role.create({ data: { organizationId: actor.organizationId, code: 'HIGHER-PRIVILEGE', name: 'Higher', permissions: { create: { permissionId: permission.id } } } });
    await prisma.userRole.create({ data: { userId: target.id, roleId: role.id, organizationId: actor.organizationId } });
    try {
      const rejected = await request(app.getHttpServer()).post(`/api/v1/admin/users/${target.id}/password-reset`).set('Cookie', cookie).set('x-csrf-token', csrf).set('Idempotency-Key', randomUUID()).send({ temporaryCode: randomUUID() }).expect(403);
      await request(app.getHttpServer()).patch(`/api/v1/admin/users/${target.id}`).set('Cookie', cookie).set('x-csrf-token', csrf).set('Idempotency-Key', randomUUID()).send({ status: 'DISABLED' }).expect(403);
      expect(await prisma.auditEvent.count({ where: { traceId: rejected.body.traceId, action: 'ACTION_REJECTED' } })).toBe(1);
    } finally { await prisma.role.delete({ where: { id: role.id } }); await prisma.permission.delete({ where: { id: permission.id } }); }
  });

  it.each(['problem', 'task', 'notification'] as const)('preserves user and business state when a %s references a requested organization transfer', async (reference) => {
    const organizationId = actor.organizationId;
    const destination = await prisma.role.findFirstOrThrow({ where: { organizationId: otherOrganizationId } });
    const permission = await prisma.permission.findUniqueOrThrow({ where: { code: 'account:users:transfer' } });
    await prisma.rolePermission.create({ data: { roleId: destination.id, permissionId: permission.id } });
    const user = await prisma.user.create({ data: { organizationId, username: `transfer-${randomUUID()}`, accountType: 'INTERNAL', passwordHash: 'unused-test-hash' } });
    const role = await prisma.role.create({ data: { organizationId, code: `TRANSFER-${reference}`, name: 'Transfer fixture' } });
    await prisma.userRole.create({ data: { userId: user.id, roleId: role.id, organizationId } });
    await app.get(SessionService).create(user.id);
    await prisma.passwordReset.create({ data: { userId: user.id, codeHash: '0'.repeat(64), expiresAt: new Date(Date.now() + 60_000) } });
    let definitionId: string | undefined;
    if (reference === 'problem') await prisma.problemIndex.create({ data: { organizationId, reportNumber: `TRANSFER-${suffix}`, domainCode: 'test', problemType: 'test', sourceType: 'test', severity: 'LOW', ownerId: user.id } });
    if (reference === 'notification') await prisma.notification.create({ data: { organizationId, recipientUserId: user.id, channel: 'test', body: 'Transfer fixture' } });
    if (reference === 'task') {
      const definition = await prisma.workflowDefinition.create({ data: { organizationId, code: `TRANSFER-${suffix}`, name: 'Transfer fixture' } });
      definitionId = definition.id;
      const version = await prisma.workflowVersion.create({ data: { organizationId, workflowDefinitionId: definition.id, version: 1 } });
      const node = await prisma.workflowNode.create({ data: { organizationId, workflowVersionId: version.id, nodeKey: 'start', type: 'ACTION', name: 'Start' } });
      const instance = await prisma.workflowInstance.create({ data: { organizationId, workflowDefinitionId: definition.id, workflowVersionId: version.id, instanceKey: `TRANSFER-${suffix}` } });
      await prisma.$executeRaw`INSERT INTO workflow_tasks (id, organization_id, workflow_instance_id, workflow_node_id, workflow_version_id, assignee_user_id, updated_at) VALUES (${randomUUID()}::uuid, ${organizationId}::uuid, ${instance.id}::uuid, ${node.id}::uuid, ${version.id}::uuid, ${user.id}::uuid, CURRENT_TIMESTAMP)`;
    }
    const snapshot = async () => ({
      user: await prisma.user.findUniqueOrThrow({ where: { id: user.id } }),
      roles: await prisma.userRole.findMany({ where: { userId: user.id } }),
      sessions: await prisma.session.findMany({ where: { userId: user.id } }),
      resets: await prisma.passwordReset.findMany({ where: { userId: user.id } }),
      problems: await prisma.problemIndex.findMany({ where: { ownerId: user.id } }),
      tasks: await prisma.workflowTask.findMany({ where: { assigneeUserId: user.id } }),
      notifications: await prisma.notification.findMany({ where: { recipientUserId: user.id } }),
    });
    const before = await snapshot();
    const key = randomUUID();
    try {
      const response = await request(app.getHttpServer()).patch(`/api/v1/admin/users/${user.id}?organizationId=${organizationId}`).set('Cookie', cookie).set('x-csrf-token', csrf).set('Idempotency-Key', key).send({ organizationId: otherOrganizationId }).expect(409);
      expect(response.body.code).toBe('ADMIN_USER_ORGANIZATION_IN_USE');
      expect(await snapshot()).toEqual(before);
      expect(await prisma.adminMutation.count({ where: { actorUserId: actor.id, key } })).toBe(0);
      expect(await prisma.auditEvent.count({ where: { resourceId: user.id, action: 'USER_UPDATED', outcome: 'SUCCESS' } })).toBe(0);
      expect(await prisma.auditEvent.count({ where: { traceId: response.body.traceId, action: 'ACTION_REJECTED' } })).toBe(1);
      await expect(prisma.$executeRaw`UPDATE users SET organization_id = ${otherOrganizationId}::uuid WHERE id = ${user.id}::uuid`).rejects.toThrow();
      expect(await snapshot()).toEqual(before);
      const edited = await request(app.getHttpServer()).patch(`/api/v1/admin/users/${user.id}?organizationId=${organizationId}`).set('Cookie', cookie).set('x-csrf-token', csrf).set('Idempotency-Key', randomUUID()).send({ organizationId, email: `transfer-${user.id}@example.test`, status: 'DISABLED', expectedProfileVersion: 1 }).expect(200);
      expect(edited.body).toMatchObject({ organizationId, status: 'DISABLED', email: `transfer-${user.id}@example.test` });
      const afterEdit = await snapshot();
      expect(afterEdit.problems).toEqual(before.problems);
      expect(afterEdit.tasks).toEqual(before.tasks);
      expect(afterEdit.notifications).toEqual(before.notifications);
    } finally {
      await prisma.notification.deleteMany({ where: { recipientUserId: user.id } });
      await prisma.problemIndex.deleteMany({ where: { ownerId: user.id } });
      await prisma.workflowTask.deleteMany({ where: { assigneeUserId: user.id } });
      if (definitionId) {
        await prisma.workflowInstance.deleteMany({ where: { workflowDefinitionId: definitionId } });
        await prisma.workflowDefinition.delete({ where: { id: definitionId } });
      }
      await prisma.user.delete({ where: { id: user.id } });
      await prisma.role.delete({ where: { id: role.id } });
      await prisma.rolePermission.deleteMany({ where: { roleId: destination.id } });
    }
  });

  it('uses restrictive update actions for every business user organization foreign key', async () => {
    const constraints = await prisma.$queryRaw<{ conname: string; confupdtype: string; confdeltype: string }[]>`SELECT conname, confupdtype::text, confdeltype::text FROM pg_constraint WHERE conname IN ('problem_indexes_organization_id_owner_id_fkey', 'workflow_tasks_organization_id_assignee_user_id_fkey', 'notifications_organization_id_recipient_user_id_fkey')`;
    expect(constraints).toHaveLength(3);
    for (const constraint of constraints) expect(constraint).toMatchObject({ confupdtype: 'r', confdeltype: 'r' });
  });

  it('rejects self migration and disabling without changing the active administrator', async () => {
    for (const body of [{ status: 'DISABLED' }, { organizationId: otherOrganizationId }, { accountType: 'SUPPLIER' }]) {
      await request(app.getHttpServer()).patch(`/api/v1/admin/users/${actor.id}`).set('Cookie', cookie).set('x-csrf-token', csrf).set('Idempotency-Key', randomUUID()).send(body).expect(409);
    }
    expect((await prisma.user.findUniqueOrThrow({ where: { id: actor.id }, select: { status: true } })).status).toBe('ACTIVE');
  });

  it('rolls back reset consumption on audit failure and permits exactly one concurrent completion', async () => {
    const before = await prisma.auditEvent.count({ where: { action: 'PASSWORD_RESET', resourceId: target.id } });
    const temporaryCode = randomUUID();
    const issued = await request(app.getHttpServer()).post(`/api/v1/admin/users/${target.id}/password-reset`).set('Cookie', cookie).set('x-csrf-token', csrf).set('Idempotency-Key', randomUUID()).send({ temporaryCode }).expect(201);
    const complete = () => request(app.getHttpServer()).post('/api/v1/auth/password-reset/complete').set('Cookie', `qms_csrf=${csrf}`).set('x-csrf-token', csrf).send({ resetId: issued.body.resetId, temporaryCode, newPassword: 'atomic-reset-password' });
    const failure = jest.spyOn(app.get(AuditLogService), 'record').mockRejectedValueOnce(new Error('audit unavailable'));
    try {
      await complete().expect(500);
      expect((await prisma.passwordReset.findUniqueOrThrow({ where: { id: issued.body.resetId }, select: { consumedAt: true } })).consumedAt).toBeNull();
    } finally { failure.mockRestore(); }
    const responses = await Promise.all([complete(), complete()]);
    expect(responses.map((response) => response.status).sort()).toEqual([204, 400]);
    expect(await prisma.auditEvent.count({ where: { action: 'PASSWORD_RESET', resourceId: target.id } })).toBe(before + 1);
  });

  it('returns the same controlled rejection for wrong and expired reset codes', async () => {
    const temporaryCode = randomUUID();
    const issued = await request(app.getHttpServer()).post(`/api/v1/admin/users/${target.id}/password-reset`).set('Cookie', cookie).set('x-csrf-token', csrf).set('Idempotency-Key', randomUUID()).send({ temporaryCode }).expect(201);
    const send = (code: string) => request(app.getHttpServer()).post('/api/v1/auth/password-reset/complete').set('Cookie', `qms_csrf=${csrf}`).set('x-csrf-token', csrf).send({ resetId: issued.body.resetId, temporaryCode: code, newPassword: 'another-reset-password' });
    const wrong = await send(randomUUID()).expect(400);
    await prisma.passwordReset.update({ where: { id: issued.body.resetId }, data: { expiresAt: new Date(0) } });
    const expired = await send(temporaryCode).expect(400);
    expect(wrong.body.code).toBe('AUTH_PASSWORD_RESET_INVALID');
    expect(expired.body.code).toBe(wrong.body.code);
  });

  it('keeps profile unchanged when its audit fails and reports duplicate emails as conflicts', async () => {
    const identity = app.get(IdentityService);
    const targetSession = (await app.get(SessionService).resolve(await app.get(SessionService).create(target.id, prisma, { mfaVerified: true, reauthenticated: true })))!;
    const before = await prisma.user.findUniqueOrThrow({ where: { id: target.id }, select: { email: true, profileVersion: true } });
    const failure = jest.spyOn(app.get(AuditLogService), 'record').mockRejectedValueOnce(new Error('audit unavailable'));
    try { await expect(identity.updateProfile(target.id, { email: `profile-${suffix}@example.test`, expectedProfileVersion: before.profileVersion }, randomUUID(), targetSession.id, randomUUID())).rejects.toThrow('audit unavailable'); }
    finally { failure.mockRestore(); }
    expect((await prisma.user.findUniqueOrThrow({ where: { id: target.id }, select: { email: true } })).email).toBe(before.email);
    const adminVersion = (await prisma.user.findUniqueOrThrow({ where: { id: actor.id }, select: { profileVersion: true } })).profileVersion;
    await identity.updateProfile(actor.id, { email: `admin-${suffix}@example.test`, expectedProfileVersion: adminVersion }, randomUUID(), actor.sessionId!, randomUUID());
    await expect(identity.updateProfile(target.id, { email: `ADMIN-${suffix}@example.test`, expectedProfileVersion: before.profileVersion }, randomUUID(), targetSession.id, randomUUID())).rejects.toMatchObject({ status: 409, response: { code: 'ADMIN_USER_DUPLICATE' } });
  });

  it('does not overwrite a concurrent password change after old-password verification', async () => {
    const passwords = app.get(PasswordService);
    const concurrentHash = await passwords.hash('concurrent-password');
    await prisma.user.update({ where: { id: target.id }, data: { passwordHash: await passwords.hash('before-concurrent-password') } });
    const targetSession = (await app.get(SessionService).resolve(await app.get(SessionService).create(target.id, prisma, { mfaVerified: true, reauthenticated: true })))!;
    const originalHash = passwords.hash.bind(passwords);
    const paused = jest.spyOn(passwords, 'hash').mockImplementationOnce(async (value: string) => {
      await prisma.user.update({ where: { id: target.id }, data: { passwordHash: concurrentHash } });
      return originalHash(value);
    });
    try {
      await expect(app.get(IdentityService).changePassword({ userId: target.id, currentSessionId: targetSession.id, currentPassword: 'before-concurrent-password', newPassword: 'superseded-password', traceId: randomUUID() })).rejects.toMatchObject({ status: 409, response: { code: 'CONCURRENCY_CONFLICT' } });
      expect(await passwords.verify((await prisma.user.findUniqueOrThrow({ where: { id: target.id } })).passwordHash, 'concurrent-password')).toBe(true);
    } finally { paused.mockRestore(); }
  });

  it('allows authority in the selected organization without requiring the home permission', async () => {
    const homeRole = await prisma.role.findFirstOrThrow({ where: { organizationId: actor.organizationId, code: 'security-admin' } });
    const destination = await prisma.role.findFirstOrThrow({ where: { organizationId: otherOrganizationId } });
    const permission = await prisma.permission.findUniqueOrThrow({ where: { code: 'account:users:read' } });
    await prisma.rolePermission.delete({ where: { roleId_permissionId: { roleId: homeRole.id, permissionId: permission.id } } });
    await prisma.rolePermission.create({ data: { roleId: destination.id, permissionId: permission.id } });
    try {
      await request(app.getHttpServer()).get(`/api/v1/admin/users?organizationId=${otherOrganizationId}`).set('Cookie', cookie).expect(200);
    } finally {
      await prisma.rolePermission.create({ data: { roleId: homeRole.id, permissionId: permission.id } });
      await prisma.rolePermission.deleteMany({ where: { roleId: destination.id } });
    }
  });

  it('invalidates outstanding reset codes on self password change and lists only active sessions', async () => {
    await prisma.user.update({ where: { id: target.id }, data: { passwordHash: await app.get(PasswordService).hash('before-self-change-password') } });
    const temporaryCode = randomUUID();
    const issued = await request(app.getHttpServer()).post(`/api/v1/admin/users/${target.id}/password-reset`).set('Cookie', cookie).set('x-csrf-token', csrf).set('Idempotency-Key', randomUUID()).send({ temporaryCode }).expect(201);
    const sessions = app.get(SessionService);
    const current = await sessions.resolve(await sessions.create(target.id, prisma, { mfaVerified: true, reauthenticated: true }));
    const other = await sessions.resolve(await sessions.create(target.id, prisma, { mfaVerified: true, reauthenticated: true }));
    await prisma.session.create({ data: { userId: target.id, tokenHash: randomUUID(), expiresAt: new Date(0) } });
    await app.get(IdentityService).changePassword({ userId: target.id, currentSessionId: current!.id, currentPassword: 'before-self-change-password', newPassword: 'self-changed-password', traceId: randomUUID() });
    const active = await sessions.listForUser(target.id, current!.id);
    expect(active.map((session) => session.id)).toEqual([current!.id]);
    expect(active.some((session) => session.id === other!.id)).toBe(false);
    await request(app.getHttpServer()).post('/api/v1/auth/password-reset/complete').set('Cookie', `qms_csrf=${csrf}`).set('x-csrf-token', csrf).send({ resetId: issued.body.resetId, temporaryCode, newPassword: 'stale-reset-password' }).expect(400);
    expect(await prisma.auditEvent.count({ where: { actorUserId: target.id, organizationId: actor.organizationId, action: 'SESSION_REVOKED' } })).toBeGreaterThan(0);
  });

  it('trusted role update invalidates reset codes when permissions of an assigned role change', async () => {
    const role = await prisma.role.create({ data: { organizationId: actor.organizationId, code: 'ROLE-RESET-CHANGE', name: 'Role reset' } });
    await prisma.userRole.create({ data: { userId: target.id, roleId: role.id, organizationId: actor.organizationId } });
    const temporaryCode = randomUUID();
    const issued = await request(app.getHttpServer()).post(`/api/v1/admin/users/${target.id}/password-reset`).set('Cookie', cookie).set('x-csrf-token', csrf).set('Idempotency-Key', randomUUID()).send({ temporaryCode }).expect(201);
    await app.get(AdminRoleService).update(trustedActor(), role.id, { permissionCodes: ['account:users:read'], expectedPermissionCodes: [] }, randomUUID(), randomUUID());
    await request(app.getHttpServer()).post('/api/v1/auth/password-reset/complete').set('Cookie', `qms_csrf=${csrf}`).set('x-csrf-token', csrf).send({ resetId: issued.body.resetId, temporaryCode, newPassword: 'stale-reset-password' }).expect(400);
  });
});
