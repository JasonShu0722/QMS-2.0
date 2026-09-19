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
import { PasswordService } from '../../src/modules/identity/password.service.js';
import { AuditLogService } from '../../src/modules/audit-log/audit-log.service.js';
import { IdentityService } from '../../src/modules/identity/identity.service.js';

if (!process.env.DATABASE_URL) throw new Error('PostgreSQL integration requires DATABASE_URL; no skipping.');

describe('administrator security PostgreSQL regression', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let actor: { id: string; organizationId: string };
  let target: { id: string; organizationId: string };
  let otherOrganizationId: string;
  let cookie: string;
  const csrf = randomUUID();
  const suffix = randomUUID();
  const permissionCodes = ['account:users:read', 'account:users:manage', 'account:roles:read', 'account:roles:manage'];

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
    const token = await app.get(SessionService).create(actor.id);
    cookie = `qms_session=${token}; qms_csrf=${csrf}`;
  });

  afterAll(async () => {
    if (prisma && actor) {
      const organizations = [actor.organizationId, otherOrganizationId];
      await prisma.auditEvent.deleteMany({ where: { organizationId: { in: organizations } } });
      await prisma.user.deleteMany({ where: { organizationId: { in: organizations } } });
      await prisma.organization.deleteMany({ where: { id: { in: organizations } } });
    }
    await app?.close();
  });

  it('rejects home-org management permission used with an unrelated role in the selected organization', async () => {
    const response = await request(app.getHttpServer()).get(`/api/v1/admin/users?organizationId=${otherOrganizationId}`).set('Cookie', cookie).expect(403);
    expect(response.body.code).toBe('FEATURE_PERMISSION_DENIED');
  });

  it('rejects malformed organization IDs before PostgreSQL reads', async () => {
    await request(app.getHttpServer()).get('/api/v1/admin/roles?organizationId=not-a-uuid').set('Cookie', cookie).expect(400);
  });

  it('replays a creation once and rejects a changed payload for the same key', async () => {
    const key = randomUUID();
    const body = { organizationId: actor.organizationId, username: `new-${suffix}`, accountType: 'INTERNAL', initialPassword: 'initial-password-for-test' };
    const send = (payload: object) => request(app.getHttpServer()).post('/api/v1/admin/users').set('Cookie', cookie).set('x-csrf-token', csrf).set('Idempotency-Key', key).send(payload);
    const first = await send(body).expect(201);
    const second = await send(body).expect(201);
    expect(second.body).toEqual(first.body);
    await send({ ...body, username: `changed-${suffix}` }).expect(409);
    expect(await prisma.auditEvent.count({ where: { actorUserId: actor.id, resourceId: first.body.id, action: 'USER_CREATED' } })).toBe(1);
    const stored = await prisma.adminMutation.findFirstOrThrow({ where: { actorUserId: actor.id, key } });
    expect(stored.requestDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(stored).includes(body.initialPassword)).toBe(false);
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

  it('exposes only organizations with actual administration permissions', async () => {
    const response = await request(app.getHttpServer()).get('/api/v1/admin/organizations').set('Cookie', cookie).expect(200);
    expect(response.body).toEqual([expect.objectContaining({ id: actor.organizationId, type: 'INTERNAL', permissions: expect.arrayContaining(permissionCodes) })]);
  });

  it('does not clear global roles by moving a user through the lifecycle endpoint', async () => {
    const global = await prisma.role.create({ data: { code: `GLOBAL-${suffix}`, name: 'Global' } });
    const destination = await prisma.role.findFirstOrThrow({ where: { organizationId: otherOrganizationId } });
    const permission = await prisma.permission.findUniqueOrThrow({ where: { code: 'account:users:manage' } });
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

  it('invalidates issued reset codes when role assignments change', async () => {
    const temporaryCode = `${randomUUID()}${randomUUID()}`;
    const issued = await request(app.getHttpServer()).post(`/api/v1/admin/users/${target.id}/password-reset`).set('Cookie', cookie).set('x-csrf-token', csrf).set('Idempotency-Key', randomUUID()).send({ temporaryCode }).expect(201);
    const permission = await prisma.permission.findUniqueOrThrow({ where: { code: 'account:users:read' } });
    const role = await prisma.role.create({ data: { organizationId: actor.organizationId, code: 'RESET-CHANGE', name: 'Reset change', permissions: { create: { permissionId: permission.id } } } });
    await request(app.getHttpServer()).put(`/api/v1/admin/users/${target.id}/roles`).set('Cookie', cookie).set('x-csrf-token', csrf).set('Idempotency-Key', randomUUID()).send({ roleIds: [role.id] }).expect(200);
    await request(app.getHttpServer()).post('/api/v1/auth/password-reset/complete').set('Cookie', `qms_csrf=${csrf}`).set('x-csrf-token', csrf).send({ resetId: issued.body.resetId, temporaryCode, newPassword: 'new-password-after-roles' }).expect(400);
  });

  it('rolls back user creation and its replay entry when audit storage fails', async () => {
    const username = `rollback-${suffix}`;
    const key = randomUUID();
    const failure = jest.spyOn(app.get(AuditLogService), 'record').mockRejectedValueOnce(new Error('audit unavailable'));
    try {
      await request(app.getHttpServer()).post('/api/v1/admin/users').set('Cookie', cookie).set('x-csrf-token', csrf).set('Idempotency-Key', key).send({ organizationId: actor.organizationId, username, accountType: 'INTERNAL', initialPassword: 'initial-password-for-test' }).expect(500);
      expect(await prisma.user.count({ where: { username } })).toBe(0);
      expect(await prisma.adminMutation.count({ where: { actorUserId: actor.id, key } })).toBe(0);
    } finally { failure.mockRestore(); }
  });

  it('handles concurrent retries without duplicating the mutation or audit', async () => {
    const key = randomUUID();
    const username = `concurrent-${suffix}`;
    const send = () => request(app.getHttpServer()).post('/api/v1/admin/users').set('Cookie', cookie).set('x-csrf-token', csrf).set('Idempotency-Key', key).send({ organizationId: actor.organizationId, username, accountType: 'INTERNAL', initialPassword: 'initial-password-for-test' });
    const responses = await Promise.all([send(), send()]);
    expect(responses.map((response) => response.status)).toContain(201);
    expect(responses.every((response) => [201, 409].includes(response.status))).toBe(true);
    const replay = await send().expect(201);
    expect(await prisma.auditEvent.count({ where: { action: 'USER_CREATED', resourceId: replay.body.id } })).toBe(1);
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
    const permission = await prisma.permission.findUniqueOrThrow({ where: { code: 'account:users:manage' } });
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
    const permission = await prisma.permission.findUniqueOrThrow({ where: { code: 'account:users:manage' } });
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
      const edited = await request(app.getHttpServer()).patch(`/api/v1/admin/users/${user.id}?organizationId=${organizationId}`).set('Cookie', cookie).set('x-csrf-token', csrf).set('Idempotency-Key', randomUUID()).send({ organizationId, email: `transfer-${user.id}@example.test`, status: 'DISABLED' }).expect(200);
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
    const before = await prisma.user.findUniqueOrThrow({ where: { id: target.id }, select: { email: true } });
    const failure = jest.spyOn(app.get(AuditLogService), 'record').mockRejectedValueOnce(new Error('audit unavailable'));
    try { await expect(identity.updateProfile(target.id, { email: `profile-${suffix}@example.test` }, randomUUID())).rejects.toThrow('audit unavailable'); }
    finally { failure.mockRestore(); }
    expect((await prisma.user.findUniqueOrThrow({ where: { id: target.id }, select: { email: true } })).email).toBe(before.email);
    await identity.updateProfile(actor.id, { email: `admin-${suffix}@example.test` }, randomUUID());
    await expect(identity.updateProfile(target.id, { email: `ADMIN-${suffix}@example.test` }, randomUUID())).rejects.toMatchObject({ status: 409, response: { code: 'ADMIN_USER_DUPLICATE' } });
  });

  it('does not overwrite a concurrent password change after old-password verification', async () => {
    const passwords = app.get(PasswordService);
    const concurrentHash = await passwords.hash('concurrent-password');
    await prisma.user.update({ where: { id: target.id }, data: { passwordHash: await passwords.hash('before-concurrent-password') } });
    const originalHash = passwords.hash.bind(passwords);
    const paused = jest.spyOn(passwords, 'hash').mockImplementationOnce(async (value: string) => {
      await prisma.user.update({ where: { id: target.id }, data: { passwordHash: concurrentHash } });
      return originalHash(value);
    });
    try {
      await expect(app.get(IdentityService).changePassword({ userId: target.id, currentSessionId: randomUUID(), currentPassword: 'before-concurrent-password', newPassword: 'superseded-password', traceId: randomUUID() })).rejects.toMatchObject({ status: 409, response: { code: 'CONCURRENCY_CONFLICT' } });
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
    const current = await sessions.resolve(await sessions.create(target.id));
    const other = await sessions.resolve(await sessions.create(target.id));
    await prisma.session.create({ data: { userId: target.id, tokenHash: randomUUID(), expiresAt: new Date(0) } });
    await app.get(IdentityService).changePassword({ userId: target.id, currentSessionId: current!.id, currentPassword: 'before-self-change-password', newPassword: 'self-changed-password', traceId: randomUUID() });
    const active = await sessions.listForUser(target.id, current!.id);
    expect(active.map((session) => session.id)).toEqual([current!.id]);
    expect(active.some((session) => session.id === other!.id)).toBe(false);
    await request(app.getHttpServer()).post('/api/v1/auth/password-reset/complete').set('Cookie', `qms_csrf=${csrf}`).set('x-csrf-token', csrf).send({ resetId: issued.body.resetId, temporaryCode, newPassword: 'stale-reset-password' }).expect(400);
    expect(await prisma.auditEvent.count({ where: { actorUserId: target.id, organizationId: actor.organizationId, action: 'SESSION_REVOKED' } })).toBeGreaterThan(0);
  });

  it('invalidates reset codes when permissions of an assigned role change', async () => {
    const role = await prisma.role.create({ data: { organizationId: actor.organizationId, code: 'ROLE-RESET-CHANGE', name: 'Role reset' } });
    await prisma.userRole.create({ data: { userId: target.id, roleId: role.id, organizationId: actor.organizationId } });
    const temporaryCode = randomUUID();
    const issued = await request(app.getHttpServer()).post(`/api/v1/admin/users/${target.id}/password-reset`).set('Cookie', cookie).set('x-csrf-token', csrf).set('Idempotency-Key', randomUUID()).send({ temporaryCode }).expect(201);
    await request(app.getHttpServer()).patch(`/api/v1/admin/roles/${role.id}`).set('Cookie', cookie).set('x-csrf-token', csrf).set('Idempotency-Key', randomUUID()).send({ permissionCodes: ['account:users:read'] }).expect(200);
    await request(app.getHttpServer()).post('/api/v1/auth/password-reset/complete').set('Cookie', `qms_csrf=${csrf}`).set('x-csrf-token', csrf).send({ resetId: issued.body.resetId, temporaryCode, newPassword: 'stale-reset-password' }).expect(400);
  });
});
