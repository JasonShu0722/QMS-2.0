import { randomUUID } from 'node:crypto';
import { accountDeliveryFixture, type AccountDeliveryFixture } from '../identity/account-delivery-fixture.js';
import { isDisposableLoopbackPostgres } from '../disposable-postgres.js';
import { ADMIN_PERMISSIONS, INTERNAL_PLATFORM_PERMISSION_CODES } from '../../src/modules/authorization/permission-catalog.js';
import { jest } from '@jest/globals';
import request from 'supertest';
import { AuditLogService } from '../../src/modules/audit-log/audit-log.service.js';
import { SessionService } from '../../src/modules/identity/session.service.js';
import { effectiveRoleGrants, hasPlatformAdministrator } from '../../src/common/security/effective-role-grants.js';
import { encryptSecret } from '../../src/common/security/security-keyring.js';
import { Prisma } from '../../src/generated/prisma/client.js';
import { effectiveRoleMembershipSql } from '../../src/common/security/effective-role-membership.sql.js';
import { AdminRoleService } from '../../src/modules/authorization/admin-role.service.js';
import { OrganizationService } from '../../src/modules/organization/organization.service.js';
import { assignmentPredicate } from '../../src/modules/workflow/workflow-access-policy.js';

describe('controlled legacy authorization migration with real PostgreSQL and HTTP', () => {
  let f: AccountDeliveryFixture;
  beforeAll(async () => {
    if (!isDisposableLoopbackPostgres(process.env.DATABASE_URL) || process.env.QMS_DISPOSABLE_TEST_DB !== 'true') throw new Error('Disposable PostgreSQL required; preview 55440 forbidden.');
    f = await accountDeliveryFixture();
    await f.prisma.permission.createMany({ data: INTERNAL_PLATFORM_PERMISSION_CODES.map(code => ({ code, name: code })), skipDuplicates: true });
    const grant = await f.prisma.userRole.findFirstOrThrow({ where: { userId: f.actor.id } });
    for (const code of [...ADMIN_PERMISSIONS, 'organization:read', 'workbench:read', 'platform:admin']) {
      const permission = await f.prisma.permission.upsert({ where: { code }, create: { code, name: code }, update: {} });
      await f.prisma.rolePermission.upsert({ where: { roleId_permissionId: { roleId: grant.roleId, permissionId: permission.id } }, create: { roleId: grant.roleId, permissionId: permission.id }, update: {} });
    }
  });
  afterAll(async () => { await f?.app.close(); });
  const path = (roleId: string, action: string) => `/organizations/${f.organization.id}/legacy-authorizations/${roleId}/${action}`;
  async function source(codes = ['workbench:read'], code: string = randomUUID(), organizationId: string | null = f.organization.id) {
    const permissions = await Promise.all(codes.map(value => f.prisma.permission.upsert({ where: { code: value }, create: { code: value, name: value }, update: {} })));
    const role = await f.prisma.role.create({ data: { organizationId, code, name: 'Exact legacy role', mfaRequired: true, permissions: { create: permissions.map(permission => ({ permissionId: permission.id })) } } });
    const user = await f.target();
    await f.prisma.userRole.create({ data: { organizationId: f.organization.id, userId: user.id, roleId: role.id } });
    return { role, user, input: { operation: 'MIGRATE' as const, directUserIds: [user.id], sourcePositionIds: [] as string[], newPosition: { code: randomUUID(), name: 'Migrated direct position', departmentId: null } } };
  }
  async function preview(value: Awaited<ReturnType<typeof source>>, input: object = value.input) {
    return (await f.post(path(value.role.id, 'preview'), input, randomUUID(), f.cookie).expect(200)).body;
  }
  function commit(value: Awaited<ReturnType<typeof source>>, input: object = value.input, baseline?: Record<string, unknown>, key = randomUUID()) {
    return { expect: async (status: number) => {
      const p = baseline ?? await preview(value, input);
      const response = await f.post(path(value.role.id, 'commit'), { ...input, authorizationBaseline: p.authorizationBaseline, confirmedImpactUserIds: p.impactUserIds }, key, f.cookie);
      expect(response.status).toBe(status);
      return response;
    } };
  }

  it('previews exact direct sources and a new organization-direct target without writing authorization', async () => {
    const user = await f.target();
    const role = await f.prisma.role.create({ data: { organizationId: f.organization.id, code: randomUUID(), name: 'Legacy source', mfaRequired: true } });
    await f.prisma.userRole.create({ data: { userId: user.id, roleId: role.id, organizationId: f.organization.id } });
    const input = { operation: 'MIGRATE', directUserIds: [user.id], sourcePositionIds: [], newPosition: { code: randomUUID(), name: 'Direct position', departmentId: null } };
    const response = await f.post(`/organizations/${f.organization.id}/legacy-authorizations/${role.id}/preview`, input).expect(200);
    expect(response.body).toMatchObject({ role: { id: role.id, code: role.code, mfaRequired: true }, directSources: [expect.objectContaining({ userId: user.id })], authorizationBaseline: expect.any(String) });
    expect(await f.prisma.userRole.count({ where: { roleId: role.id } })).toBe(1);
    expect(await f.prisma.position.count({ where: { organizationId: f.organization.id, code: input.newPosition.code } })).toBe(0);
  });

  it('adopts the exact legacy identity, revokes old sessions and preserves password, enrolled MFA and lockout', async () => {
    const value = await source();
    const oldSession = await f.app.get(SessionService).create(value.user.id, f.prisma, { mfaVerified: true, reauthenticated: true });
    const blockedUntil = new Date(Date.now() + 60_000);
    await f.prisma.user.update({ where: { id: value.user.id }, data: { mfaEnabled: true, mfaFailures: 3, mfaBlockedUntil: blockedUntil } });
    const encryptedSecret = encryptSecret('JBSWY3DPEHPK3PXP', `mfa:${value.user.id}`);
    await f.prisma.mfaCredential.create({ data: { userId: value.user.id, encryptedSecret, lastTimeStep: 123n } });
    const reset = await f.prisma.passwordReset.create({ data: { userId: value.user.id, codeHash: randomUUID(), expiresAt: new Date(Date.now() + 60_000) } });
    const result = (await commit(value).expect(200)).body;
    expect(result).toMatchObject({ roleId: value.role.id, archived: false, deleted: false });
    expect(await f.prisma.positionRole.findFirst({ where: { positionId: result.targetPositionId, roleId: value.role.id } })).toMatchObject({ isCanonical: true });
    expect(await f.prisma.userRole.count({ where: { roleId: value.role.id } })).toBe(0);
    expect((await effectiveRoleGrants(f.prisma, value.user.id, f.organization.id)).map(grant => grant.role.code)).toEqual([value.role.code]);
    expect(await f.app.get(SessionService).resolve(oldSession)).toBeNull();
    expect(await f.prisma.user.findUniqueOrThrow({ where: { id: value.user.id } })).toMatchObject({ passwordHash: value.user.passwordHash, mfaEnabled: true, mfaFailures: 3, mfaBlockedUntil: blockedUntil, securityVersion: 2, credentialVersion: 2 });
    expect(await f.prisma.mfaCredential.findUniqueOrThrow({ where: { userId: value.user.id } })).toMatchObject({ encryptedSecret, lastTimeStep: 123n });
    expect((await f.prisma.passwordReset.findUniqueOrThrow({ where: { id: reset.id } })).consumedAt).not.toBeNull();
    const archive = await f.prisma.legacyAuthorizationArchive.findFirstOrThrow({ where: { roleId: value.role.id } });
    expect(JSON.stringify(archive.snapshot)).not.toMatch(/passwordHash|encryptedSecret|tokenHash|@example|JBSWY/);
  });

  it('shows complete existing-target diffusion, requires exact confirmation and preserves stable shared qualification explicitly', async () => {
    const value = await source();
    const retained = await f.target();
    await f.prisma.userRole.create({ data: { organizationId: f.organization.id, userId: retained.id, roleId: value.role.id } });
    const position = await f.prisma.position.create({ data: { organizationId: f.organization.id, departmentId: null, code: randomUUID(), name: 'Existing target' } });
    const original = await f.prisma.role.create({ data: { organizationId: f.organization.id, code: randomUUID(), name: 'Original canonical' } });
    await f.prisma.positionRole.create({ data: { organizationId: f.organization.id, positionId: position.id, roleId: original.id, isCanonical: true } });
    const member = await f.target();
    await f.prisma.userPosition.create({ data: { organizationId: f.organization.id, positionId: position.id, userId: member.id } });
    const { newPosition: _unused, ...selection } = value.input;
    const input = { ...selection, targetPositionId: position.id, preserveRoleCode: true };
    const p = await preview(value, input);
    expect(p.impactUserIds).toEqual([member.id, value.user.id].sort());
    expect(p.target).toMatchObject({ originalCanonical: { id: original.id }, strategy: 'MERGE_WITH_QUALIFICATION' });
    expect(p.affectedUsers.find((row: { userId: string }) => row.userId === member.id)).toMatchObject({ beforePermissionCodes: [], afterPermissionCodes: ['workbench:read'], afterMfaRequired: true });
    await f.post(path(value.role.id, 'commit'), { ...input, authorizationBaseline: p.authorizationBaseline, confirmedImpactUserIds: [value.user.id] }).expect(409);
    expect(await f.prisma.userRole.count({ where: { roleId: value.role.id } })).toBe(2);
    await commit(value, input, p).expect(200);
    expect(await f.prisma.userRole.findFirst({ where: { roleId: value.role.id, userId: retained.id } })).not.toBeNull();
    expect(await f.prisma.positionRole.findFirst({ where: { positionId: position.id, isCanonical: true } })).toMatchObject({ roleId: original.id });
    expect((await effectiveRoleGrants(f.prisma, value.user.id, f.organization.id)).map(grant => grant.role.code)).toContain(value.role.code);
  });

  it('copies original current and future windows and does not end original business appointments', async () => {
    const value = await source();
    const position = await f.prisma.position.create({ data: { organizationId: f.organization.id, code: randomUUID(), name: 'Original business position', departmentId: null } });
    await f.prisma.positionRole.create({ data: { organizationId: f.organization.id, positionId: position.id, roleId: value.role.id } });
    const futureUser = await f.target();
    const windows = [{ userId: value.user.id, startedAt: new Date(Date.now() - 60_000), endedAt: new Date(Date.now() + 120_000) }, { userId: futureUser.id, startedAt: new Date(Date.now() + 60_000), endedAt: new Date(Date.now() + 180_000) }];
    for (const window of windows) await f.prisma.userPosition.create({ data: { organizationId: f.organization.id, positionId: position.id, ...window } });
    const input = { ...value.input, directUserIds: [], sourcePositionIds: [position.id], preserveRoleCode: true };
    const p = await preview(value, input);
    expect(p.mappedSources[0].assignments.map((row: { temporalState: string }) => row.temporalState).sort()).toEqual(['CURRENT', 'FUTURE']);
    const result = (await commit(value, input, p).expect(200)).body;
    const moved = await f.prisma.userPosition.findMany({ where: { positionId: result.targetPositionId }, select: { userId: true, startedAt: true, endedAt: true } });
    expect(moved).toEqual(expect.arrayContaining(windows));
    expect(await f.prisma.userPosition.count({ where: { positionId: position.id, endedAt: { gt: new Date() } } })).toBe(2);
    expect(await f.prisma.positionRole.count({ where: { positionId: position.id, roleId: value.role.id } })).toBe(0);
  });

  it('rejects same-count direct source replacement and leaves the replacement intact', async () => {
    const value = await source();
    const p = await preview(value);
    const replacement = await f.target();
    await f.prisma.userRole.deleteMany({ where: { roleId: value.role.id } });
    await f.prisma.userRole.create({ data: { userId: replacement.id, roleId: value.role.id, organizationId: f.organization.id } });
    await commit(value, value.input, p).expect(409);
    expect(await f.prisma.userRole.findFirst({ where: { roleId: value.role.id } })).toMatchObject({ userId: replacement.id });
  });

  it('removes confirmed direct sources, archives stable identity and excludes archived roles from ordinary reads and runtime', async () => {
    const value = await source();
    const input = { operation: 'REMOVE', directUserIds: [value.user.id], sourcePositionIds: [] };
    const p = await preview(value, input);
    expect(p.affectedUsers[0]).toMatchObject({ beforePermissionCodes: ['workbench:read'], afterPermissionCodes: [] });
    await commit(value, input, p).expect(200);
    expect((await f.prisma.role.findUniqueOrThrow({ where: { id: value.role.id } })).archivedAt).not.toBeNull();
    expect(await effectiveRoleGrants(f.prisma, value.user.id, f.organization.id)).toEqual([]);
    // Defense against a stale internal writer accidentally recreating the old direct row.
    await f.prisma.userRole.create({ data: { userId: value.user.id, roleId: value.role.id, organizationId: f.organization.id } });
    expect(await effectiveRoleGrants(f.prisma, value.user.id, f.organization.id)).toEqual([]);
    const catalog = await request(f.app.getHttpServer()).get(`/api/v1/organizations/${f.organization.id}/legacy-authorizations`).set('Cookie', f.cookie).expect(200);
    expect(catalog.body.some((row: { id: string }) => row.id === value.role.id)).toBe(false);
  });

  it('deletes an unused empty role but keeps the immutable migration fact', async () => {
    const role = await f.prisma.role.create({ data: { organizationId: f.organization.id, code: randomUUID(), name: 'Unused' } });
    const value = { ...(await source()), role };
    const input = { operation: 'REMOVE', directUserIds: [], sourcePositionIds: [] };
    expect((await commit(value, input).expect(200)).body).toMatchObject({ deleted: true });
    expect(await f.prisma.role.findUnique({ where: { id: role.id } })).toBeNull();
    expect(await f.prisma.legacyAuthorizationArchive.count({ where: { roleId: role.id } })).toBe(1);
  });

  it('rolls back permissions, sources, appointments, receipts and security versions when success audit fails', async () => {
    const value = await source();
    const p = await preview(value);
    const audit = f.app.get(AuditLogService);
    const original = audit.record.bind(audit);
    const fail = jest.spyOn(audit, 'record').mockImplementation((input, tx) => input.action === 'LEGACY_AUTHORIZATION_MIGRATED' ? Promise.reject(new Error('injected audit failure')) : original(input, tx));
    try { await commit(value, value.input, p).expect(500); } finally { fail.mockRestore(); }
    expect(await f.prisma.userRole.count({ where: { roleId: value.role.id } })).toBe(1);
    expect(await f.prisma.position.count({ where: { code: value.input.newPosition.code, organizationId: f.organization.id } })).toBe(0);
    expect((await f.prisma.user.findUniqueOrThrow({ where: { id: value.user.id } })).securityVersion).toBe(1);
    expect(await f.prisma.legacyAuthorizationArchive.count({ where: { roleId: value.role.id } })).toBe(0);
  });

  it('replays a committed request once, rejects a changed body and never restores removed authorization', async () => {
    const value = await source();
    const p = await preview(value);
    const key = randomUUID();
    const first = await commit(value, value.input, p, key).expect(200);
    expect((await commit(value, value.input, p, key).expect(200)).body).toEqual(first.body);
    await commit(value, { ...value.input, preserveRoleCode: true }, p, key).expect(409);
    expect(await f.prisma.legacyAuthorizationArchive.count({ where: { roleId: value.role.id } })).toBe(1);
    expect(await f.prisma.userRole.count({ where: { roleId: value.role.id } })).toBe(0);
  });

  it('preserves a global QMS_ADMIN UUID/code/MFA/platform marker through an exact one-scope atomic replacement', async () => {
    const value = await source(['platform:admin'], `QMS_ADMIN_${randomUUID()}`, null);
    const before = await effectiveRoleGrants(f.prisma, value.user.id, f.organization.id);
    const result = (await commit(value).expect(200)).body;
    expect(await hasPlatformAdministrator(f.prisma, value.user.id)).toBe(true);
    const after = await effectiveRoleGrants(f.prisma, value.user.id, f.organization.id);
    expect(after.map(row => ({ code: row.role.code, id: row.role.id, mfa: row.role.mfaRequired, scope: row.platformScope }))).toEqual(before.map(row => ({ code: row.role.code, id: row.role.id, mfa: row.role.mfaRequired, scope: row.platformScope })));
    expect(await f.prisma.positionRole.findFirst({ where: { positionId: result.targetPositionId } })).toMatchObject({ roleId: value.role.id, isCanonical: true });
  });

  it('rejects actual appointment expiry without a database update, including after a real target lock wait', async () => {
    const value = await source();
    const position = await f.prisma.position.create({ data: { organizationId: f.organization.id, code: randomUUID(), name: 'Expiring source', departmentId: null } });
    await f.prisma.positionRole.create({ data: { organizationId: f.organization.id, positionId: position.id, roleId: value.role.id } });
    const endedAt = new Date(Date.now() + 1800);
    await f.prisma.userPosition.create({ data: { organizationId: f.organization.id, positionId: position.id, userId: value.user.id, startedAt: new Date(Date.now() - 1000), endedAt } });
    const input = { ...value.input, directUserIds: [], sourcePositionIds: [position.id], preserveRoleCode: true };
    const p = await preview(value, input);
    let locked!: () => void;
    const ready = new Promise<void>(resolve => { locked = resolve; });
    const blocker = f.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM positions WHERE id = ${position.id}::uuid FOR UPDATE`;
      locked();
      await new Promise(resolve => setTimeout(resolve, Math.max(0, endedAt.getTime() - Date.now() + 100)));
    });
    await ready;
    await commit(value, input, p).expect(409);
    await blocker;
    expect(await f.prisma.positionRole.count({ where: { positionId: position.id, roleId: value.role.id } })).toBe(1);
  });

  it('retains a fixed workflow identity and historic definition verbatim when removing its final sources', async () => {
    const value = await source();
    const definition = await f.prisma.workflowDefinition.create({ data: { organizationId: f.organization.id, code: randomUUID(), name: 'Stable reference' } });
    const version = await f.prisma.workflowVersion.create({ data: { organizationId: f.organization.id, workflowDefinitionId: definition.id, version: 1, status: 'PUBLISHED' } });
    const config = { assignment: { roleCode: value.role.code }, reason: 'immutable-business-text-not-for-archive' };
    const node = await f.prisma.workflowNode.create({ data: { organizationId: f.organization.id, workflowVersionId: version.id, nodeKey: 'review', name: 'Review', type: 'APPROVAL', config } });
    const input = { operation: 'REMOVE', directUserIds: [value.user.id], sourcePositionIds: [] };
    const p = await preview(value, input);
    expect(p.workflowReferences).toEqual([expect.objectContaining({ nodeId: node.id, versionId: version.id, roleCode: value.role.code })]);
    await commit(value, input, p).expect(200);
    expect((await f.prisma.role.findUniqueOrThrow({ where: { id: value.role.id } })).archivedAt).not.toBeNull();
    expect((await f.prisma.workflowNode.findUniqueOrThrow({ where: { id: node.id } })).config).toEqual(config);
    expect(JSON.stringify((await f.prisma.legacyAuthorizationArchive.findFirstOrThrow({ where: { roleId: value.role.id } })).snapshot)).not.toContain(config.reason);
  });

  it('keeps an otherwise empty UUID if an earlier audit references it', async () => {
    const role = await f.prisma.role.create({ data: { organizationId: f.organization.id, code: randomUUID(), name: 'Historic empty role' } });
    await f.app.get(AuditLogService).record({ actorUserId: f.actor.id, organizationId: f.organization.id, action: 'ROLE_CREATED', resourceType: 'Role', resourceId: role.id, traceId: randomUUID(), outcome: 'SUCCESS' });
    const value = { ...(await source()), role };
    const result = await commit(value, { operation: 'REMOVE', directUserIds: [], sourcePositionIds: [] }).expect(200);
    expect(result.body).toMatchObject({ archived: true, deleted: false });
  });

  it('requires CSRF, recent authentication, idempotency and exact scope before writes', async () => {
    const value = await source();
    const p = await preview(value);
    const body = { ...value.input, authorizationBaseline: p.authorizationBaseline, confirmedImpactUserIds: p.impactUserIds };
    const url = `/api/v1${path(value.role.id, 'commit')}`;
    await request(f.app.getHttpServer()).post(url).set('Cookie', `qms_csrf=${f.csrf}`).set('x-csrf-token', f.csrf).send(body).expect(401);
    await request(f.app.getHttpServer()).post(url).set('Cookie', f.cookie).send(body).expect(403);
    await request(f.app.getHttpServer()).post(url).set('Cookie', f.cookie).set('x-csrf-token', f.csrf).send(body).expect(400);
    const stale = await f.app.get(SessionService).create(f.actor.id, f.prisma, { mfaVerified: true, reauthenticated: false });
    await f.post(path(value.role.id, 'commit'), body, randomUUID(), `qms_session=${stale}; qms_csrf=${f.csrf}`).expect(403);
    await f.post(path(value.role.id, 'commit'), { ...body, permissionCodes: ['platform:admin'] }).expect(400);
    expect(await f.prisma.userRole.count({ where: { roleId: value.role.id } })).toBe(1);
  });

  it('fails the grant ceiling and rechecks lost authority even when replaying an already committed key', async () => {
    const admin = await source([...ADMIN_PERMISSIONS, 'organization:read']);
    const token = await f.app.get(SessionService).create(admin.user.id, f.prisma, { mfaVerified: true, reauthenticated: true });
    const cookie = `qms_session=${token}; qms_csrf=${f.csrf}`;
    const value = await source();
    const input = value.input;
    const p = (await f.post(path(value.role.id, 'preview'), input, randomUUID(), cookie).expect(200)).body;
    await f.post(path(value.role.id, 'commit'), { ...input, authorizationBaseline: p.authorizationBaseline, confirmedImpactUserIds: p.impactUserIds }, randomUUID(), cookie).expect(403);
    const permission = await f.prisma.permission.findUniqueOrThrow({ where: { code: 'workbench:read' } });
    await f.prisma.rolePermission.create({ data: { roleId: admin.role.id, permissionId: permission.id } });
    const fresh = (await f.post(path(value.role.id, 'preview'), input, randomUUID(), cookie).expect(200)).body;
    const key = randomUUID();
    const body = { ...input, authorizationBaseline: fresh.authorizationBaseline, confirmedImpactUserIds: fresh.impactUserIds };
    await f.post(path(value.role.id, 'commit'), body, key, cookie).expect(200);
    const assign = await f.prisma.permission.findUniqueOrThrow({ where: { code: 'account:roles:assign' } });
    await f.prisma.rolePermission.delete({ where: { roleId_permissionId: { roleId: admin.role.id, permissionId: assign.id } } });
    await f.post(path(value.role.id, 'commit'), body, key, cookie).expect(403);
  });

  it('blocks the actor from removing their final platform source and allows an atomic self replacement', async () => {
    const admin = await source(['platform:admin']);
    const token = await f.app.get(SessionService).create(admin.user.id, f.prisma, { mfaVerified: true, reauthenticated: true });
    const cookie = `qms_session=${token}; qms_csrf=${f.csrf}`;
    const input = { operation: 'REMOVE', directUserIds: [admin.user.id], sourcePositionIds: [] };
    const p = (await f.post(path(admin.role.id, 'preview'), input, randomUUID(), cookie).expect(200)).body;
    await f.post(path(admin.role.id, 'commit'), { ...input, authorizationBaseline: p.authorizationBaseline, confirmedImpactUserIds: p.impactUserIds }, randomUUID(), cookie).expect(409);
    const replacement = (await f.post(path(admin.role.id, 'preview'), admin.input, randomUUID(), cookie).expect(200)).body;
    await f.post(path(admin.role.id, 'commit'), { ...admin.input, authorizationBaseline: replacement.authorizationBaseline, confirmedImpactUserIds: replacement.impactUserIds }, randomUUID(), cookie).expect(200);
    expect(await hasPlatformAdministrator(f.prisma, admin.user.id)).toBe(true);
    expect(await f.app.get(SessionService).resolve(token)).toBeNull();
    const relogin = await f.app.get(SessionService).create(admin.user.id, f.prisma, { mfaVerified: true, reauthenticated: true });
    expect(await f.app.get(SessionService).resolve(relogin)).not.toBeNull();
  });

  it('serializes two administrators retiring each other so both last sources cannot disappear', async () => {
    const a = await source(['platform:admin']);
    const b = await source(['platform:admin']);
    const login = async (id: string) => `qms_session=${await f.app.get(SessionService).create(id, f.prisma, { mfaVerified: true, reauthenticated: true })}; qms_csrf=${f.csrf}`;
    const aCookie = await login(a.user.id);
    const bCookie = await login(b.user.id);
    const inputA = { operation: 'REMOVE', directUserIds: [b.user.id], sourcePositionIds: [] };
    const inputB = { operation: 'REMOVE', directUserIds: [a.user.id], sourcePositionIds: [] };
    const previewA = (await f.post(path(b.role.id, 'preview'), inputA, randomUUID(), aCookie).expect(200)).body;
    const previewB = (await f.post(path(a.role.id, 'preview'), inputB, randomUUID(), bCookie).expect(200)).body;
    const results = await Promise.all([
      f.post(path(b.role.id, 'commit'), { ...inputA, authorizationBaseline: previewA.authorizationBaseline, confirmedImpactUserIds: previewA.impactUserIds }, randomUUID(), aCookie),
      f.post(path(a.role.id, 'commit'), { ...inputB, authorizationBaseline: previewB.authorizationBaseline, confirmedImpactUserIds: previewB.impactUserIds }, randomUUID(), bCookie),
    ]);
    expect(results.map(result => result.status).sort()).toEqual([200, 409]);
    expect(Number(await hasPlatformAdministrator(f.prisma, a.user.id)) + Number(await hasPlatformAdministrator(f.prisma, b.user.id))).toBe(1);
  });

  it('keeps archived role defenses aligned in SQL, trusted assigns and workflow candidate lists', async () => {
    const value = await source();
    await commit(value, { operation: 'REMOVE', directUserIds: [value.user.id], sourcePositionIds: [] }).expect(200);
    await f.prisma.userRole.create({ data: { organizationId: f.organization.id, userId: value.user.id, roleId: value.role.id } });
    const memberships = await f.prisma.$queryRaw<{ role_id: string }[]>(effectiveRoleMembershipSql(Prisma.sql`${value.user.id}::uuid`, Prisma.sql`${f.organization.id}::uuid`));
    expect(memberships).toEqual([]);
    const actorSession = await f.app.get(SessionService).resolve(f.cookie.split(';')[0]!.split('=')[1]!);
    const actor = { ...f.actor, sessionId: actorSession!.id, scopeOrganizationId: f.organization.id };
    await expect(f.app.get(AdminRoleService).assign(actor, value.user.id, { roleIds: [value.role.id] }, randomUUID(), randomUUID())).rejects.toMatchObject({ status: 403 });
    const catalog = await request(f.app.getHttpServer()).get('/api/v1/workflows/options').set('Cookie', f.cookie).expect(200);
    expect(catalog.body.roles.some((row: { code: string }) => row.code === value.role.code)).toBe(false);
  });

  it('shows initialization provenance, permits cross-home removal and never replays its old grant into existence', async () => {
    const sessions = f.app.get(SessionService);
    const resolved = await sessions.resolve(f.cookie.split(';')[0]!.split('=')[1]!);
    const actor = { ...f.actor, sessionId: resolved!.id, scopeOrganizationId: f.organization.id };
    const key = randomUUID();
    const dto = { code: randomUUID(), name: 'Child with initialization' };
    const child = await f.app.get(OrganizationService).createChild(actor, f.organization.id, dto, randomUUID(), key);
    const role = await f.prisma.role.findFirstOrThrow({ where: { organizationId: child.id, code: 'ORGANIZATION_GOVERNOR' } });
    const base = `/organizations/${child.id}/legacy-authorizations/${role.id}`;
    const input = { operation: 'REMOVE', directUserIds: [actor.id], sourcePositionIds: [] };
    const p = (await f.post(`${base}/preview`, input).expect(200)).body;
    expect(p.directSources).toEqual([expect.objectContaining({ initialization: true, userId: actor.id })]);
    await f.post(`${base}/commit`, { ...input, authorizationBaseline: p.authorizationBaseline, confirmedImpactUserIds: p.impactUserIds }).expect(200);
    const fresh = await sessions.create(actor.id, f.prisma, { mfaVerified: true, reauthenticated: true });
    const current = (await sessions.resolve(fresh))!;
    f.cookie = `qms_session=${fresh}; qms_csrf=${f.csrf}`;
    await f.app.get(OrganizationService).createChild({ ...actor, sessionId: current.id }, f.organization.id, dto, randomUUID(), key);
    expect(await f.prisma.userRole.count({ where: { roleId: role.id } })).toBe(0);
    expect((await f.prisma.role.findUniqueOrThrow({ where: { id: role.id } })).archivedAt).not.toBeNull();
  });

  it('does not reveal another scope of a shared global role to a local-only administrator', async () => {
    const value = await source(['workbench:read'], randomUUID(), null);
    const other = await f.prisma.organization.create({ data: { code: randomUUID(), name: 'Hidden scope', type: 'INTERNAL' } });
    const otherUser = await f.prisma.user.create({ data: { organizationId: other.id, username: randomUUID(), accountType: 'INTERNAL', passwordHash: 'fixture-only' } });
    await f.prisma.userRole.create({ data: { organizationId: other.id, userId: otherUser.id, roleId: value.role.id } });
    const admin = await source([...ADMIN_PERMISSIONS, 'organization:read']);
    const token = await f.app.get(SessionService).create(admin.user.id, f.prisma, { mfaVerified: true, reauthenticated: true });
    const response = await f.post(path(value.role.id, 'preview'), { operation: 'REMOVE', directUserIds: [value.user.id], sourcePositionIds: [] }, randomUUID(), `qms_session=${token}; qms_csrf=${f.csrf}`).expect(403);
    expect(JSON.stringify(response.body)).not.toContain(otherUser.id);
  });

  it('confirms unknown-result receipts after archive or physical deletion without restoring sources', async () => {
    // Initialization removal intentionally revoked the shared fixture administrator's old session.
    const token = await f.app.get(SessionService).create(f.actor.id, f.prisma, { mfaVerified: true, reauthenticated: true });
    f.cookie = `qms_session=${token}; qms_csrf=${f.csrf}`;
    for (const empty of [false, true]) {
      const value = await source();
      if (empty) await f.prisma.userRole.deleteMany({ where: { roleId: value.role.id } });
      const input = { operation: 'REMOVE', directUserIds: empty ? [] : [value.user.id], sourcePositionIds: [] };
      const p = await preview(value, input);
      const key = randomUUID();
      const first = await commit(value, input, p, key).expect(200);
      expect((await commit(value, input, p, key).expect(200)).body).toEqual(first.body);
      expect(await f.prisma.userRole.count({ where: { roleId: value.role.id } })).toBe(0);
    }
  });

  it('explicitly moves a shared global subset to an independent stable-code canonical without touching other users or scopes', async () => {
    const value = await source(['platform:admin'], `QMS_ADMIN_${randomUUID()}`, null);
    const retainedLocal = await f.target();
    await f.prisma.userRole.create({ data: { userId: retainedLocal.id, roleId: value.role.id, organizationId: f.organization.id } });
    const other = await f.prisma.organization.create({ data: { code: randomUUID(), name: 'Untouched global scope', type: 'INTERNAL' } });
    const retainedOther = await f.prisma.user.create({ data: { organizationId: other.id, username: randomUUID(), accountType: 'INTERNAL', passwordHash: 'fixture-only' } });
    await f.prisma.userRole.create({ data: { userId: retainedOther.id, roleId: value.role.id, organizationId: other.id } });
    const localBefore = await effectiveRoleGrants(f.prisma, retainedLocal.id, f.organization.id);
    const otherBefore = await effectiveRoleGrants(f.prisma, retainedOther.id, other.id);
    const sourceBefore = await effectiveRoleGrants(f.prisma, value.user.id, f.organization.id);
    const input = { ...value.input, preserveRoleCode: true };
    const p = await preview(value, input);
    expect(p.target).toMatchObject({ strategy: 'INDEPENDENT_CANONICAL', roleCode: value.role.code, canonicalRoleId: expect.any(String) });
    const result = (await commit(value, input, p).expect(200)).body;
    expect(await f.prisma.role.findUniqueOrThrow({ where: { id: value.role.id } })).toMatchObject({ organizationId: null, archivedAt: null });
    const canonical = await f.prisma.positionRole.findFirstOrThrow({ where: { positionId: result.targetPositionId, isCanonical: true }, include: { role: true } });
    expect(canonical.role).toMatchObject({ id: p.target.canonicalRoleId, code: value.role.code, organizationId: f.organization.id, mfaRequired: true });
    expect(canonical.roleId).not.toBe(value.role.id);
    expect(await f.prisma.userRole.count({ where: { userId: value.user.id, roleId: value.role.id } })).toBe(0);
    expect(await effectiveRoleGrants(f.prisma, retainedLocal.id, f.organization.id)).toEqual(localBefore);
    expect(await effectiveRoleGrants(f.prisma, retainedOther.id, other.id)).toEqual(otherBefore);
    const moved = await effectiveRoleGrants(f.prisma, value.user.id, f.organization.id);
    expect(moved).toHaveLength(1);
    expect(moved[0]!.role.permissions.map(row => row.permission.code)).toEqual(sourceBefore[0]!.role.permissions.map(row => row.permission.code));
    expect(moved[0]!.platformScope).toEqual(sourceBefore[0]!.platformScope);
    const allowed = await f.prisma.$queryRaw<{ allowed: boolean }[]>(Prisma.sql`SELECT ${assignmentPredicate(Prisma.sql`${value.user.id}::uuid`, Prisma.sql`${f.organization.id}::uuid`, Prisma.sql`${JSON.stringify({ roleCode: value.role.code })}::jsonb`)} AS allowed`);
    expect(allowed).toEqual([{ allowed: true }]);
    expect(JSON.stringify((await f.prisma.legacyAuthorizationArchive.findFirstOrThrow({ where: { roleId: value.role.id } })).snapshot)).toContain(canonical.roleId);
    await f.post(path(value.role.id, 'preview'), { ...input, directUserIds: [retainedLocal.id], newPosition: { ...input.newPosition, code: randomUUID() } }, randomUUID(), f.cookie).expect(409);
  });

  it('binds all affected users future appointments, not only the selected role count', async () => {
    const value = await source();
    const other = await f.prisma.position.create({ data: { organizationId: f.organization.id, code: randomUUID(), name: 'Other future appointment', departmentId: null } });
    const appointment = await f.prisma.userPosition.create({ data: { organizationId: f.organization.id, userId: value.user.id, positionId: other.id, startedAt: new Date(Date.now() + 60_000), endedAt: new Date(Date.now() + 120_000) } });
    const p = await preview(value);
    await f.prisma.userPosition.update({ where: { id: appointment.id }, data: { startedAt: new Date(Date.now() + 70_000) } });
    await commit(value, value.input, p).expect(409);
    expect(await f.prisma.userRole.count({ where: { roleId: value.role.id } })).toBe(1);
  });

  it('rejects cross-home global migration, supplier scope and an unconfirmed same-code identity collision', async () => {
    const value = await source(['workbench:read'], randomUUID(), null);
    const other = await f.prisma.organization.create({ data: { code: randomUUID(), name: 'Other home', type: 'INTERNAL' } });
    const foreign = await f.prisma.user.create({ data: { organizationId: other.id, username: randomUUID(), passwordHash: 'fixture-only', accountType: 'INTERNAL' } });
    await f.prisma.userRole.create({ data: { organizationId: f.organization.id, userId: foreign.id, roleId: value.role.id } });
    await f.post(path(value.role.id, 'preview'), { ...value.input, directUserIds: [foreign.id], preserveRoleCode: true }, randomUUID(), f.cookie).expect(403);
    const supplier = await f.prisma.organization.create({ data: { code: randomUUID(), name: 'Supplier boundary', type: 'SUPPLIER' } });
    const supplierRole = await f.prisma.role.create({ data: { organizationId: supplier.id, code: randomUUID(), name: 'Supplier portal' } });
    await f.post(`/organizations/${supplier.id}/legacy-authorizations/${supplierRole.id}/preview`, { ...value.input }, randomUUID(), f.cookie).expect(403);
  });

  it('preserves initialization UUID provenance even when its direct row was already removed', async () => {
    const sessions = f.app.get(SessionService);
    const resolved = await sessions.resolve(f.cookie.split(';')[0]!.split('=')[1]!);
    const actor = { ...f.actor, sessionId: resolved!.id, scopeOrganizationId: f.organization.id };
    const child = await f.app.get(OrganizationService).createChild(actor, f.organization.id, { code: randomUUID(), name: 'Old initialization provenance' }, randomUUID(), randomUUID());
    const role = await f.prisma.role.findFirstOrThrow({ where: { organizationId: child.id, code: 'ORGANIZATION_GOVERNOR' } });
    await f.prisma.userRole.deleteMany({ where: { roleId: role.id } });
    const input = { operation: 'REMOVE', directUserIds: [], sourcePositionIds: [] };
    const base = `/organizations/${child.id}/legacy-authorizations/${role.id}`;
    const p = (await f.post(`${base}/preview`, input, randomUUID(), f.cookie).expect(200)).body;
    const result = await f.post(`${base}/commit`, { ...input, authorizationBaseline: p.authorizationBaseline, confirmedImpactUserIds: [] }, randomUUID(), f.cookie).expect(200);
    expect(result.body).toMatchObject({ archived: true, deleted: false });
    expect(await f.prisma.role.findUnique({ where: { id: role.id } })).not.toBeNull();
  });

  it('migrates a users overlapping direct and mapped sources without duplicate unbounded target appointments', async () => {
    const value = await source();
    const position = await f.prisma.position.create({ data: { organizationId: f.organization.id, code: randomUUID(), name: 'Concurrent old source', departmentId: null } });
    await f.prisma.positionRole.create({ data: { organizationId: f.organization.id, positionId: position.id, roleId: value.role.id } });
    const startedAt = new Date(Date.now() - 60_000);
    await f.prisma.userPosition.create({ data: { organizationId: f.organization.id, positionId: position.id, userId: value.user.id, startedAt } });
    const input = { ...value.input, sourcePositionIds: [position.id] };
    const result = (await commit(value, input).expect(200)).body;
    expect(await f.prisma.userRole.count({ where: { roleId: value.role.id } })).toBe(0);
    expect(await f.prisma.userPosition.findMany({ where: { positionId: result.targetPositionId }, select: { startedAt: true, endedAt: true } })).toEqual([{ startedAt, endedAt: null }]);
  });

  it('previews effective account MFA overrides rather than only the role required flag', async () => {
    const value = await source();
    await f.prisma.role.update({ where: { id: value.role.id }, data: { mfaRequired: false } });
    await f.prisma.user.update({ where: { id: value.user.id }, data: { mfaRequirementOverride: true } });
    const p = await preview(value);
    expect(p.affectedUsers[0]).toMatchObject({ beforeMfaRequired: true, afterMfaRequired: true });
    await commit(value, value.input, p).expect(200);
    expect((await f.prisma.user.findUniqueOrThrow({ where: { id: value.user.id } })).mfaRequirementOverride).toBe(true);
  });

  it.each(['SOURCE', 'TARGET', 'MARKER'] as const)('rechecks the original %s grant ceiling before returning an old successful receipt', async kind => {
    const admin = await source([]);
    const codes = [...new Set([...ADMIN_PERMISSIONS, 'organization:read', 'workbench:read', 'notification:read', ...(kind === 'MARKER' ? ['platform:admin', ...INTERNAL_PLATFORM_PERMISSION_CODES] : [])])];
    const permissions = await f.prisma.permission.findMany({ where: { code: { in: codes } }, select: { id: true, code: true } });
    expect(permissions.map(row => row.code).sort()).toEqual([...codes].sort());
    await f.prisma.rolePermission.createMany({ data: permissions.map(row => ({ roleId: admin.role.id, permissionId: row.id })) });
    const value = await source(kind === 'MARKER' ? ['platform:admin'] : ['workbench:read']);
    let input: object = value.input;
    if (kind === 'TARGET') {
      const position = await f.prisma.position.create({ data: { organizationId: f.organization.id, code: randomUUID(), name: 'Target ceiling', departmentId: null } });
      const target = await f.prisma.role.create({ data: { organizationId: f.organization.id, code: randomUUID(), name: 'Target own permissions', permissions: { create: [{ permissionId: permissions.find(row => row.code === 'notification:read')!.id }] } } });
      await f.prisma.positionRole.create({ data: { organizationId: f.organization.id, positionId: position.id, roleId: target.id, isCanonical: true } });
      input = { operation: 'MIGRATE', directUserIds: [value.user.id], sourcePositionIds: [], targetPositionId: position.id, preserveRoleCode: true };
    }
    const token = await f.app.get(SessionService).create(admin.user.id, f.prisma, { mfaVerified: true, reauthenticated: true });
    const cookie = `qms_session=${token}; qms_csrf=${f.csrf}`;
    const p = (await f.post(path(value.role.id, 'preview'), input, randomUUID(), cookie).expect(200)).body;
    const key = randomUUID();
    const body = { ...input, authorizationBaseline: p.authorizationBaseline, confirmedImpactUserIds: p.impactUserIds };
    const first = await f.post(path(value.role.id, 'commit'), body, key, cookie).expect(200);
    expect((await f.post(path(value.role.id, 'commit'), body, key, cookie).expect(200)).body).toEqual(first.body);
    const revokedCode = kind === 'MARKER' ? 'platform:admin' : kind === 'TARGET' ? 'notification:read' : 'workbench:read';
    await f.prisma.rolePermission.delete({ where: { roleId_permissionId: { roleId: admin.role.id, permissionId: permissions.find(row => row.code === revokedCode)!.id } } });
    const freshToken = await f.app.get(SessionService).create(admin.user.id, f.prisma, { mfaVerified: true, reauthenticated: true });
    await f.post(path(value.role.id, 'commit'), body, key, `qms_session=${freshToken}; qms_csrf=${f.csrf}`).expect(403);
    expect(await f.prisma.legacyAuthorizationArchive.count({ where: { roleId: value.role.id } })).toBe(1);
    expect(await f.prisma.userRole.count({ where: { roleId: value.role.id, userId: value.user.id } })).toBe(0);
  });

  it.each(['MISSING', 'DAMAGED'] as const)('fails closed for a successful receipt with %s server authorization facts', async kind => {
    const value = await source();
    const p = await preview(value);
    const key = randomUUID();
    await commit(value, value.input, p, key).expect(200);
    if (kind === 'MISSING') await f.prisma.legacyAuthorizationArchive.deleteMany({ where: { roleId: value.role.id } });
    else {
      const fact = await f.prisma.legacyAuthorizationArchive.findFirstOrThrow({ where: { roleId: value.role.id } });
      await f.prisma.legacyAuthorizationArchive.update({ where: { id: fact.id }, data: { snapshot: { actorId: f.actor.id, scopeOrganizationId: f.organization.id, preview: { authorizationBaseline: p.authorizationBaseline } } } });
    }
    await commit(value, value.input, p, key).expect(409);
    expect(await f.prisma.userRole.count({ where: { roleId: value.role.id } })).toBe(0);
  });

  describe('publicly adopted target marker ceiling', () => {
    let ordinary: Awaited<ReturnType<typeof source>>;
    let marker: Awaited<ReturnType<typeof source>>;
    let adopted: { targetPositionId: string };
    let token: string;
    let cookie: string;
    beforeEach(async () => {
      marker = await source(['platform:admin']);
      ordinary = await source([]);
      const codes = [...new Set([...ADMIN_PERMISSIONS, 'organization:read', 'workbench:read', ...INTERNAL_PLATFORM_PERMISSION_CODES])].filter(code => code !== 'platform:admin');
      const permissions = await f.prisma.permission.findMany({ where: { code: { in: codes } }, select: { id: true, code: true } });
      expect(permissions.map(row => row.code).sort()).toEqual([...codes].sort());
      await f.prisma.rolePermission.createMany({ data: permissions.map(row => ({ roleId: ordinary.role.id, permissionId: row.id })) });
      token = await f.app.get(SessionService).create(ordinary.user.id, f.prisma, { mfaVerified: true, reauthenticated: true });
      cookie = `qms_session=${token}; qms_csrf=${f.csrf}`;
    });
    beforeEach(async () => {
      adopted = (await commit(marker).expect(200)).body;
    });

    it('requires real platform authority when a plain legacy source targets a publicly adopted marker canonical', async () => {
    expect(await hasPlatformAdministrator(f.prisma, ordinary.user.id)).toBe(false);
    const input = { operation: 'MIGRATE', directUserIds: [ordinary.user.id], sourcePositionIds: [], targetPositionId: adopted.targetPositionId, preserveRoleCode: true };
    const p = (await f.post(path(ordinary.role.id, 'preview'), input, randomUUID(), cookie).expect(200)).body;
    expect(p.target.permissionCodes).toContain('platform:admin');
    const key = randomUUID();
    const body = { ...input, authorizationBaseline: p.authorizationBaseline, confirmedImpactUserIds: p.impactUserIds };
    const before = {
      role: await f.prisma.role.findUniqueOrThrow({ where: { id: ordinary.role.id }, include: { permissions: true } }),
      user: await f.prisma.user.findUniqueOrThrow({ where: { id: ordinary.user.id } }),
      position: await f.prisma.position.findUniqueOrThrow({ where: { id: adopted.targetPositionId } }),
      grants: await f.prisma.userRole.findMany({ where: { userId: ordinary.user.id } }),
      assignments: await f.prisma.userPosition.findMany({ where: { positionId: adopted.targetPositionId }, orderBy: { id: 'asc' } }),
      facts: await f.prisma.legacyAuthorizationArchive.count({ where: { roleId: ordinary.role.id } }),
      receipts: await f.prisma.adminMutation.count({ where: { actorUserId: ordinary.user.id } }),
    };
    await f.post(path(ordinary.role.id, 'commit'), body, key, cookie).expect(403);
    await f.post(path(ordinary.role.id, 'commit'), body, key, cookie).expect(403);
    expect(await hasPlatformAdministrator(f.prisma, ordinary.user.id)).toBe(false);
    expect(await f.prisma.role.findUniqueOrThrow({ where: { id: ordinary.role.id }, include: { permissions: true } })).toEqual(before.role);
    expect(await f.prisma.user.findUniqueOrThrow({ where: { id: ordinary.user.id } })).toEqual(before.user);
    expect(await f.prisma.position.findUniqueOrThrow({ where: { id: adopted.targetPositionId } })).toEqual(before.position);
    expect(await f.prisma.userRole.findMany({ where: { userId: ordinary.user.id } })).toEqual(before.grants);
    expect(await f.prisma.userPosition.findMany({ where: { positionId: adopted.targetPositionId }, orderBy: { id: 'asc' } })).toEqual(before.assignments);
    expect(await f.prisma.legacyAuthorizationArchive.count({ where: { roleId: ordinary.role.id } })).toBe(before.facts);
    expect(await f.prisma.adminMutation.count({ where: { actorUserId: ordinary.user.id } })).toBe(before.receipts);
    expect(await f.app.get(SessionService).resolve(token)).not.toBeNull();
    });

    it('allows a real platform administrator to migrate the same plain source into the adopted marker target', async () => {
      const input = { operation: 'MIGRATE', directUserIds: [ordinary.user.id], sourcePositionIds: [], targetPositionId: adopted.targetPositionId, preserveRoleCode: true };
      await commit(ordinary, input).expect(200);
      expect(await hasPlatformAdministrator(f.prisma, ordinary.user.id)).toBe(true);
    });
  });
});
