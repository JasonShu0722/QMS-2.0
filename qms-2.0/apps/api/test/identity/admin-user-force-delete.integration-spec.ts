import 'reflect-metadata';
import { createHash, randomUUID } from 'node:crypto';
import { jest } from '@jest/globals';
import { Test } from '@nestjs/testing';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import request from 'supertest';
import { PrismaService } from '../../src/database/prisma.service.js';
import { AuditLogService } from '../../src/modules/audit-log/audit-log.service.js';
import { AdminMutationService, type AdminActor } from '../../src/common/security/admin-mutation.service.js';
import { AdministrativeLifecycleRegistry } from '../../src/common/security/administrative-lifecycle.registry.js';
import type { AdministrativeLifecycleImpact } from '../../src/common/security/administrative-lifecycle.types.js';
import { AdminUserLifecycleService } from '../../src/modules/identity/admin-user-lifecycle.service.js';
import { AdminUserLifecycleController } from '../../src/modules/identity/admin-user-lifecycle.controller.js';
import { AdminUserService } from '../../src/modules/identity/admin-user.service.js';
import { PasswordResetService } from '../../src/modules/identity/password-reset.service.js';
import { SessionService } from '../../src/modules/identity/session.service.js';
import { AuthenticatedGuard } from '../../src/common/guards/authenticated.guard.js';
import { CsrfGuard } from '../../src/modules/identity/csrf.guard.js';
import { AuthorizationService } from '../../src/modules/authorization/authorization.service.js';
import { OrganizationScopeService } from '../../src/modules/organization/organization-scope.service.js';
import { GlobalExceptionFilter } from '../../src/common/contracts/global-exception.filter.js';
import { createObjectStorage } from '../../src/modules/file-management/object-storage.service.js';
import { isDisposableLoopbackPostgres } from '../disposable-postgres.js';
import { ESignatureService } from '../../src/modules/e-signature/e-signature.service.js';

if (!isDisposableLoopbackPostgres(process.env.DATABASE_URL) || process.env.QMS_DISPOSABLE_TEST_DB !== 'true') {
  throw new Error('User lifecycle tests require explicitly disposable loopback PostgreSQL, never preview 55440.');
}

// These neutral ports verify dispatch/atomicity only, never final workflow/configuration acceptance.
describe('REQ0031 unit D: real identity lifecycle, HTTP and PostgreSQL with neutral sibling effects', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let service: AdminUserLifecycleService;
  let sessions: SessionService;
  let registry: AdministrativeLifecycleRegistry;
  let rejectConfiguration = false;
  const impacts: AdministrativeLifecycleImpact[] = [];

  beforeAll(async () => {
    registry = new AdministrativeLifecycleRegistry();
    registry.register({ module: 'workflow', async apply(_tx, _actor, impact) {
      impacts.push(impact);
      return { module: 'workflow', changed: 0, pendingConfiguration: 0 };
    } });
    registry.register({ module: 'platform-configuration', async apply() {
      if (rejectConfiguration) throw new Error('TEST_CONFIGURATION_ROLLBACK');
      return { module: 'platform-configuration', changed: 0, pendingConfiguration: 0 };
    } });
    app = (await Test.createTestingModule({
      controllers: [AdminUserLifecycleController],
      providers: [PrismaService, AuditLogService, AdminMutationService, ESignatureService, AdminUserLifecycleService, SessionService,
        AuthorizationService, OrganizationScopeService,
        { provide: AdministrativeLifecycleRegistry, useValue: registry },
        { provide: APP_GUARD, useClass: AuthenticatedGuard }, { provide: APP_GUARD, useClass: CsrfGuard }],
    }).compile()).createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new GlobalExceptionFilter());
    registry.seal();
    await app.init();
    prisma = app.get(PrismaService);
    service = app.get(AdminUserLifecycleService);
    sessions = app.get(SessionService);
    expect(await prisma.$queryRaw`SELECT 1 FROM _prisma_migrations WHERE migration_name = '20261028230000_administrative_lifecycle' AND finished_at IS NOT NULL`).toHaveLength(1);
  });
  // Immutable tombstones, signatures and receipts stay in the task-owned disposable database.
  afterAll(async () => { await app?.close(); });

  async function organization(type: 'INTERNAL' | 'SUPPLIER' = 'INTERNAL') {
    return prisma.organization.create({ data: { code: randomUUID(), name: 'Lifecycle fixture', type } });
  }
  async function user(organizationId: string, accountType: 'INTERNAL' | 'SUPPLIER' = 'INTERNAL') {
    return prisma.user.create({ data: { organizationId, accountType, username: randomUUID(), passwordHash: 'old-private-password-hash', fullName: 'Historical owner', email: `${randomUUID()}@example.test` } });
  }
  async function grant(userId: string, organizationId: string, codes: string[]) {
    const permissions = await prisma.permission.findMany({ where: { code: { in: codes } } });
    expect(permissions).toHaveLength(codes.length);
    const role = await prisma.role.create({ data: { organizationId, code: randomUUID(), name: 'Shared lifecycle role', permissions: { create: permissions.map(({ id }) => ({ permissionId: id })) } } });
    await prisma.userRole.create({ data: { userId, organizationId, roleId: role.id } });
    return role;
  }
  async function actor(codes = ['platform:admin', 'account:users:read', 'account:users:delete']) {
    const home = await organization();
    const subject = await user(home.id);
    const role = await grant(subject.id, home.id, codes);
    const token = await sessions.create(subject.id, prisma, { mfaVerified: true, reauthenticated: true });
    const session = await sessions.resolve(token);
    const identity: AdminActor = { id: subject.id, organizationId: home.id, accountType: 'INTERNAL', sessionId: session!.id };
    return { home, subject, role, token, identity };
  }
  async function position(userId: string, organizationId: string, departmentId?: string) {
    const department = departmentId ? { id: departmentId } : await prisma.department.create({ data: { organizationId, code: randomUUID(), name: 'Lifecycle department' } });
    const position = await prisma.position.create({ data: { organizationId, departmentId: department.id, code: randomUUID(), name: 'Lifecycle position' } });
    const assignment = await prisma.userPosition.create({ data: { organizationId, userId, positionId: position.id, startedAt: new Date(Date.now() - 60_000) } });
    return { department, position, assignment };
  }
  function remove(f: Awaited<ReturnType<typeof actor>>, target: { id: string; organizationId: string; securityVersion: number }, key = randomUUID()) {
    return request(app.getHttpServer()).delete(`/api/v1/admin/users/${target.id}`)
      .query({ organizationId: target.organizationId }).set('Cookie', [`qms_session=${f.token}`, 'qms_csrf=lifecycle'])
      .set('x-csrf-token', 'lifecycle').set('Idempotency-Key', key).send({ expectedSecurityVersion: target.securityVersion });
  }
  function impact(kind: AdministrativeLifecycleImpact['kind'], entityId: string, organizationId: string, userIds: string[], positionIds: string[] = []): AdministrativeLifecycleImpact {
    return { kind, entityId, organizationId, receiptOrganizationId: organizationId, userIds, departmentIds: kind === 'DEPARTMENT' ? [entityId] : [], positionIds, organizationIds: kind === 'ORGANIZATION' ? [entityId] : [] };
  }

  it('deletes a historical user, invalidates every reusable credential and preserves files, actors, shared roles and signed approvals', async () => {
    const f = await actor();
    const target = await user(f.home.id);
    const other = await user(f.home.id);
    const role = await grant(target.id, f.home.id, ['account:users:read']);
    await prisma.userRole.create({ data: { userId: other.id, organizationId: f.home.id, roleId: role.id } });
    const membership = await position(target.id, f.home.id);
    const token = await sessions.create(target.id, prisma, { mfaVerified: true });
    const expiresAt = new Date(Date.now() + 60_000);
    await prisma.passwordReset.create({ data: { userId: target.id, codeHash: 'a'.repeat(64), expiresAt } });
    await prisma.passwordChangeChallenge.create({ data: { userId: target.id, organizationId: f.home.id, credentialVersion: target.credentialVersion, tokenHash: randomUUID().replaceAll('-', '').repeat(2), expiresAt } });
    await prisma.mfaChallenge.create({ data: { userId: target.id, organizationId: f.home.id, tokenHash: randomUUID().replaceAll('-', '').repeat(2), securityVersion: target.securityVersion, passwordDigest: 'c'.repeat(64), policyDigest: 'd'.repeat(64), enrollment: true, expiresAt } });
    await prisma.mfaCredential.create({ data: { userId: target.id, encryptedSecret: 'PRIVATE_MFA', pendingSecret: 'PRIVATE_PENDING_MFA', pendingExpiresAt: expiresAt } });
    await prisma.mfaRecoveryCode.create({ data: { userId: target.id, codeHash: randomUUID().replaceAll('-', '').repeat(2) } });
    await prisma.userTemporaryPassword.create({ data: { userId: target.id, credentialVersion: target.credentialVersion, encryptedValue: 'PRIVATE_TEMP_PASSWORD', expiresAt } });
    const verification = await prisma.emailVerification.create({ data: { userId: target.id, email: target.email!, purpose: 'PASSWORD_RECOVERY', securityVersion: target.securityVersion, tokenHash: randomUUID().replaceAll('-', '').repeat(2), expiresAt,
      delivery: { create: { encryptedPayload: 'PRIVATE_RECOVERY', keyId: 'test' } } } });
    const storage = createObjectStorage();
    const objectKey = randomUUID();
    const bytes = Buffer.from('Real historical file retained by user deletion.');
    const upload = await storage.createUploadUrl(objectKey, 'text/plain');
    const uploaded = await fetch(upload.url, { method: 'PUT', headers: upload.headers, body: bytes, signal: AbortSignal.timeout(2000) });
    expect(uploaded.ok).toBe(true);
    const storedBefore = await storage.head(objectKey);
    const file = await prisma.fileObject.create({ data: { organizationId: f.home.id, uploadedById: target.id, objectKey, objectVersionId: storedBefore.versionId, originalName: 'retained.txt', contentType: 'text/plain', sizeBytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') } });
    const history = await prisma.auditEvent.create({ data: { organizationId: f.home.id, actorUserId: target.id, action: 'HISTORY', resourceType: 'User', outcome: 'SUCCESS', traceId: randomUUID() } });
    const signatureId = randomUUID(), approvalId = randomUUID();
    await prisma.$executeRaw`INSERT INTO user_signatures(id, organization_id, user_id, label, fingerprint) VALUES (${signatureId}::uuid, ${f.home.id}::uuid, ${target.id}::uuid, 'Historical signature', ${'e'.repeat(64)})`;
    await prisma.$executeRaw`INSERT INTO approval_signatures(id, organization_id, signature_id, signer_user_id, resource_type, resource_id, resource_version, signature_fingerprint, signed_digest) VALUES (${approvalId}::uuid, ${f.home.id}::uuid, ${signatureId}::uuid, ${target.id}::uuid, 'REPORT', 'old-report', 1, ${'e'.repeat(64)}, ${'b'.repeat(64)})`;
    const signedBefore = await prisma.$queryRaw`SELECT * FROM approval_signatures WHERE id = ${approvalId}::uuid`;
    const key = randomUUID();
    const response = await remove(f, target, key).expect(200);
    expect(response.body).toMatchObject({ userId: target.id, deleted: true, effects: [{ module: 'workflow' }, { module: 'platform-configuration' }, { module: 'identity', changed: 1, pendingConfiguration: 0 }] });
    const deleted = await prisma.user.findUniqueOrThrow({ where: { id: target.id } });
    expect(deleted).toMatchObject({ username: `deleted.${target.id.replaceAll('-', '')}`, email: null, fullName: target.fullName, organizationId: target.organizationId, status: 'DISABLED', configurationRequired: false, securityVersion: target.securityVersion + 1, credentialVersion: target.credentialVersion + 1, mfaEnabled: false });
    expect(deleted.deletedAt).toBeInstanceOf(Date);
    expect(deleted.passwordHash).not.toBe(target.passwordHash);
    expect(await sessions.resolve(token)).toBeNull();
    for (const model of [prisma.passwordReset, prisma.passwordChangeChallenge, prisma.mfaChallenge, prisma.mfaRecoveryCode, prisma.emailVerification]) {
      expect(await (model.count as (args: object) => Promise<number>)({ where: { userId: target.id, consumedAt: null } })).toBe(0);
    }
    expect(await prisma.mfaCredential.count({ where: { userId: target.id } })).toBe(0);
    expect(await prisma.userTemporaryPassword.count({ where: { userId: target.id } })).toBe(0);
    expect(await prisma.recoveryDelivery.findUniqueOrThrow({ where: { verificationId: verification.id } })).toMatchObject({ status: 'CANCELLED', encryptedPayload: null, claimId: null });
    expect((await prisma.userPosition.findUniqueOrThrow({ where: { id: membership.assignment.id } })).endedAt).not.toBeNull();
    expect(await prisma.userRole.count({ where: { userId: target.id } })).toBe(0);
    expect(await prisma.userRole.count({ where: { userId: other.id, roleId: role.id } })).toBe(1);
    expect(await prisma.role.count({ where: { id: role.id } })).toBe(1);
    expect(await prisma.fileObject.findUniqueOrThrow({ where: { id: file.id } })).toEqual(file);
    expect(await storage.head(objectKey)).toEqual(storedBefore);
    const retainedBytes = [];
    for await (const chunk of storage.readVersion(objectKey, storedBefore.versionId, bytes.length)) retainedBytes.push(chunk);
    expect(Buffer.concat(retainedBytes)).toEqual(bytes);
    expect(await prisma.auditEvent.findUniqueOrThrow({ where: { id: history.id } })).toEqual(history);
    expect(await prisma.$queryRaw`SELECT * FROM approval_signatures WHERE id = ${approvalId}::uuid`).toEqual(signedBefore);
    expect(await prisma.$queryRaw`SELECT status FROM user_signatures WHERE id = ${signatureId}::uuid`).toEqual([{ status: 'REVOKED' }]);
    const [receipt] = await prisma.$queryRaw<{ original_identity: Record<string, unknown> }[]>`SELECT original_identity FROM administrative_deletions WHERE entity_kind = 'USER' AND entity_id = ${target.id}::uuid`;
    expect(receipt!.original_identity).toMatchObject({ username: target.username, fullName: target.fullName, email: target.email, organizationId: target.organizationId });
    expect(JSON.stringify(receipt)).not.toMatch(/password|mfa|secret|PRIVATE/i);
    expect(await prisma.adminMutation.findUnique({ where: { actorUserId_organizationId_key: { actorUserId: f.subject.id, organizationId: f.home.id, key } } })).not.toBeNull();
    expect((await remove(f, target, key).expect(200)).body).toEqual(response.body);
    expect(await prisma.auditEvent.count({ where: { action: 'USER_FORCE_DELETED', resourceId: target.id } })).toBe(1);
    const replacement = await prisma.user.create({ data: { organizationId: f.home.id, accountType: 'INTERNAL', username: target.username, email: target.email, passwordHash: 'new-private-hash' } });
    expect(replacement.id).not.toBe(target.id);
    expect(await prisma.userRole.count({ where: { userId: replacement.id } })).toBe(0);
    expect(await remove(f, target).expect(404)).toBeDefined();
  });

  it('stores cross-organization receipts in actor home and rejects wrong-scope targets without exposing identity', async () => {
    const f = await actor();
    const scope = await organization();
    const target = await user(scope.id);
    const wrong = await remove(f, { ...target, organizationId: f.home.id }).expect(404);
    expect(JSON.stringify(wrong.body)).not.toContain(target.username);
    const key = randomUUID();
    await remove(f, target, key).expect(200);
    const receipt = await prisma.adminMutation.findFirstOrThrow({ where: { actorUserId: f.subject.id, key } });
    expect(receipt.organizationId).toBe(f.home.id);
    expect(impacts.at(-1)).toMatchObject({ kind: 'USER', entityId: target.id, organizationId: scope.id, receiptOrganizationId: f.home.id, userIds: [target.id] });
  });

  it.each([false, true])('deletes a pending user in an inactive original organization (deleted=%s) without changing scope or replay rules', async deleted => {
    const f = await actor();
    const scope = await organization();
    const original = await user(scope.id);
    await prisma.$transaction(tx => service.apply(tx, f.identity, impact('ORGANIZATION', scope.id, scope.id, [original.id])));
    const archived = await prisma.organization.update({ where: { id: scope.id }, data: { status: 'DISABLED', ...(deleted ? { deletedAt: new Date() } : {}) } });
    const target = await prisma.user.findUniqueOrThrow({ where: { id: original.id } });
    expect(target).toMatchObject({ configurationRequired: true, status: 'DISABLED', organizationId: scope.id, deletedAt: null });
    const ordinary = await actor(['account:users:read', 'account:users:delete']);
    await grant(ordinary.subject.id, scope.id, ['account:users:read', 'account:users:delete']);
    for (const subject of [f.subject, ordinary.subject]) {
      await expect(app.get(AuthorizationService).assertFeature(subject.id, scope.id, 'account:users:delete')).rejects.toMatchObject({ status: 403 });
    }
    await remove(ordinary, target).expect(403);
    await expect(service.deleteUser(ordinary.identity, target.id, { expectedSecurityVersion: target.securityVersion }, scope.id, randomUUID(), randomUUID())).rejects.toMatchObject({ status: 403 });
    await remove(f, { ...target, organizationId: f.home.id }).expect(404);
    const key = randomUUID();
    await remove(f, { ...target, securityVersion: target.securityVersion - 1 }, key).expect(409);
    expect(await prisma.user.findUniqueOrThrow({ where: { id: target.id } })).toEqual(target);
    expect(await prisma.adminMutation.count({ where: { actorUserId: f.subject.id, key } })).toBe(0);
    const response = await remove(f, target, key).expect(200);
    expect(response.body).toMatchObject({ userId: target.id, deleted: true });
    expect(await prisma.user.findUniqueOrThrow({ where: { id: target.id } })).toMatchObject({ organizationId: scope.id, configurationRequired: false, status: 'DISABLED', deletedAt: expect.any(Date) });
    expect(await prisma.organization.findUniqueOrThrow({ where: { id: scope.id } })).toEqual(archived);
    expect((await prisma.adminMutation.findFirstOrThrow({ where: { actorUserId: f.subject.id, key } })).organizationId).toBe(f.home.id);
    expect((await remove(f, target, key).expect(200)).body).toEqual(response.body);
    await remove(f, { ...target, organizationId: f.home.id }, key).expect(404);
    await remove(f, { ...target, securityVersion: target.securityVersion + 1 }, key).expect(409);
    expect(await prisma.auditEvent.count({ where: { action: 'USER_FORCE_DELETED', resourceId: target.id } })).toBe(1);
    await prisma.userRole.deleteMany({ where: { userId: f.subject.id, roleId: f.role.id } });
    await remove(f, target, key).expect(403);
  });

  it.each(['ACTIVE', 'DISABLED'] as const)('does not expand platform lifecycle access to a %s supplier organization', async status => {
    const f = await actor();
    const scope = await organization('SUPPLIER');
    const target = await user(scope.id, 'SUPPLIER');
    await prisma.organization.update({ where: { id: scope.id }, data: { status } });
    await remove(f, target).expect(403);
    expect(await prisma.user.findUniqueOrThrow({ where: { id: target.id } })).toEqual(target);
  });

  it('takes the shared administrative lifecycle lock before locking the target user', async () => {
    const f = await actor();
    const target = await user(f.home.id);
    let unlock!: () => void;
    let locked!: () => void;
    const acquired = new Promise<void>(resolve => { locked = resolve; });
    const release = new Promise<void>(resolve => { unlock = resolve; });
    const holder = prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended('administrative-lifecycle', 0))::text`;
      locked();
      await release;
    });
    await acquired;
    const command = service.deleteUser(f.identity, target.id, { expectedSecurityVersion: target.securityVersion }, target.organizationId, randomUUID(), randomUUID());
    const settled = command.then(value => ({ value }), error => ({ error }));
    try {
      let waiting = false;
      for (let attempt = 0; attempt < 100; attempt++) {
        const rows = await prisma.$queryRaw<{ waiting: boolean }[]>`SELECT EXISTS(SELECT 1 FROM pg_stat_activity
          WHERE datname = current_database() AND pid <> pg_backend_pid() AND wait_event_type = 'Lock'
          AND query LIKE '%pg_advisory_xact_lock%' AND query LIKE '%administrative-lifecycle%') AS waiting`;
        if (rows[0]?.waiting) { waiting = true; break; }
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      expect(waiting).toBe(true);
      await prisma.$transaction(async tx => {
        expect(await tx.$queryRaw`SELECT id FROM users WHERE id = ${target.id}::uuid FOR UPDATE NOWAIT`).toHaveLength(1);
      });
    } finally { unlock(); await holder; await settled; }
    expect(await settled).toMatchObject({ value: { userId: target.id, deleted: true } });
  });

  it('rejects username-admin without explicit platform identity even with delete permission', async () => {
    const f = await actor(['account:users:read', 'account:users:delete']);
    await prisma.user.update({ where: { id: f.subject.id }, data: { username: `admin.${randomUUID()}` } });
    const target = await user(f.home.id);
    await remove(f, target).expect(403);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: target.id } })).deletedAt).toBeNull();
  });

  it('requires explicit delete capability even for platform identity', async () => {
    const f = await actor();
    const target = await user(f.home.id);
    await prisma.permission.update({ where: { code: 'account:users:delete' }, data: { code: 'test:reserved-delete' } });
    try { await remove(f, target).expect(403); }
    finally { await prisma.permission.update({ where: { code: 'test:reserved-delete' }, data: { code: 'account:users:delete' } }); }
  });

  it('rejects stale versions, absent idempotency, malformed input, self deletion and stale recent authentication', async () => {
    const f = await actor();
    const target = await user(f.home.id);
    await remove(f, { ...target, securityVersion: target.securityVersion + 1 }).expect(409);
    await remove(f, f.subject).expect(409);
    await request(app.getHttpServer()).delete(`/api/v1/admin/users/${target.id}`).set('Cookie', [`qms_session=${f.token}`, 'qms_csrf=lifecycle']).set('x-csrf-token', 'lifecycle').send({ expectedSecurityVersion: 1 }).expect(400);
    await remove(f, target).send({ expectedSecurityVersion: 0, actorUserId: f.subject.id }).expect(400);
    await prisma.session.update({ where: { id: f.identity.sessionId }, data: { reauthenticatedAt: new Date(Date.now() - 6 * 60_000) } });
    await remove(f, target).expect(403);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: target.id } })).deletedAt).toBeNull();
  });

  it('reauthorizes a legal replay after target deletion and refuses revoked platform grants or changed payload', async () => {
    const f = await actor();
    const target = await user(f.home.id);
    const key = randomUUID();
    await remove(f, target, key).expect(200);
    await remove(f, { ...target, securityVersion: target.securityVersion + 1 }, key).expect(409);
    await prisma.userRole.deleteMany({ where: { userId: f.subject.id, roleId: f.role.id } });
    await remove(f, target, key).expect(403);
  });

  it('rolls back the complete command if any registered effect fails', async () => {
    const f = await actor();
    const target = await user(f.home.id);
    const key = randomUUID();
    rejectConfiguration = true;
    try { await expect(service.deleteUser(f.identity, target.id, { expectedSecurityVersion: target.securityVersion }, target.organizationId, randomUUID(), key)).rejects.toThrow('TEST_CONFIGURATION_ROLLBACK'); }
    finally { rejectConfiguration = false; }
    expect(await prisma.user.findUniqueOrThrow({ where: { id: target.id } })).toEqual(target);
    expect(await prisma.adminMutation.count({ where: { key } })).toBe(0);
    expect(await prisma.$queryRaw`SELECT id FROM administrative_deletions WHERE entity_id = ${target.id}::uuid`).toHaveLength(0);
  });

  it('rolls back invalidation, deletion and receipt when transactional success audit fails', async () => {
    const f = await actor();
    const target = await user(f.home.id);
    const member = await position(target.id, f.home.id);
    const key = randomUUID();
    const audit = app.get(AuditLogService);
    const original = audit.record.bind(audit);
    const failure = jest.spyOn(audit, 'record').mockImplementation(async (event: Parameters<AuditLogService['record']>[0], tx: Parameters<AuditLogService['record']>[1]) => {
      if (event.action === 'USER_FORCE_DELETED') throw new Error('TEST_AUDIT_ROLLBACK');
      return original(event, tx);
    });
    try { await expect(service.deleteUser(f.identity, target.id, { expectedSecurityVersion: 1 }, target.organizationId, randomUUID(), key)).rejects.toThrow('TEST_AUDIT_ROLLBACK'); }
    finally { failure.mockRestore(); }
    expect(await prisma.user.findUniqueOrThrow({ where: { id: target.id } })).toEqual(target);
    expect((await prisma.userPosition.findUniqueOrThrow({ where: { id: member.assignment.id } })).endedAt).toBeNull();
    expect(await prisma.adminMutation.count({ where: { actorUserId: f.subject.id, key } })).toBe(0);
    expect(await prisma.$queryRaw`SELECT id FROM administrative_deletions WHERE entity_id = ${target.id}::uuid`).toHaveLength(0);
    expect(await prisma.auditEvent.count({ where: { action: 'USER_FORCE_DELETED', resourceId: target.id } })).toBe(0);
  });

  it('serializes two administrators deleting one another so at least one login survives', async () => {
    const first = await actor();
    const second = await actor();
    const results = await Promise.all([remove(first, second.subject), remove(second, first.subject)]);
    expect(results.filter(result => result.status === 200)).toHaveLength(1);
    expect(results.every(result => [200, 401, 409].includes(result.status))).toBe(true);
    expect(await prisma.user.count({ where: { id: { in: [first.subject.id, second.subject.id] }, deletedAt: null, status: 'ACTIVE' } })).toBe(1);
  });

  it('invalidates organization users without deleting them, changing their historical tenant or removing direct roles', async () => {
    const f = await actor();
    const scope = await organization();
    const target = await user(scope.id);
    const role = await grant(target.id, scope.id, ['account:users:read']);
    const membership = await position(target.id, scope.id);
    const token = await sessions.create(target.id, prisma, { mfaVerified: true });
    const result = await prisma.$transaction(tx => service.apply(tx, f.identity, impact('ORGANIZATION', scope.id, scope.id, [target.id], [membership.position.id])));
    expect(result).toMatchObject({ module: 'identity', changed: 1, pendingConfiguration: 1 });
    expect(await prisma.user.findUniqueOrThrow({ where: { id: target.id } })).toMatchObject({ deletedAt: null, configurationRequired: true, status: 'DISABLED', organizationId: scope.id, username: target.username });
    expect(await prisma.userRole.count({ where: { userId: target.id, roleId: role.id } })).toBe(1);
    expect(await sessions.resolve(token)).toBeNull();
  });

  it('ends only affected department appointments and keeps another valid department appointment and usable identity', async () => {
    const f = await actor();
    const target = await user(f.home.id);
    const affected = await position(target.id, f.home.id);
    const retained = await position(target.id, f.home.id);
    const token = await sessions.create(target.id, prisma, { mfaVerified: true });
    const result = await prisma.$transaction(tx => service.apply(tx, f.identity, impact('DEPARTMENT', affected.department.id, f.home.id, [target.id], [affected.position.id])));
    expect(result).toEqual({ module: 'identity', changed: 1, pendingConfiguration: 0 });
    expect((await prisma.userPosition.findUniqueOrThrow({ where: { id: affected.assignment.id } })).endedAt).not.toBeNull();
    expect((await prisma.userPosition.findUniqueOrThrow({ where: { id: retained.assignment.id } })).endedAt).toBeNull();
    expect(await prisma.user.findUniqueOrThrow({ where: { id: target.id } })).toMatchObject({ deletedAt: null, configurationRequired: false, status: 'ACTIVE', username: target.username });
    expect(await sessions.resolve(token)).toBeNull();
  });

  it('marks a department user awaiting configuration only when no valid appointment remains', async () => {
    const f = await actor();
    const target = await user(f.home.id);
    const affected = await position(target.id, f.home.id);
    const result = await prisma.$transaction(tx => service.apply(tx, f.identity, impact('DEPARTMENT', affected.department.id, f.home.id, [target.id], [affected.position.id])));
    expect(result.pendingConfiguration).toBe(1);
    expect(await prisma.user.findUniqueOrThrow({ where: { id: target.id } })).toMatchObject({ deletedAt: null, configurationRequired: true, status: 'DISABLED' });
  });

  it('excludes deleted users from existing read projections and rejects updates, policy changes and temporary credential access', async () => {
    const f = await actor();
    const scope = await organization();
    const target = await user(scope.id);
    await remove(f, target).expect(200);
    // Deleted-target guards must run before any password or onboarding collaborators are invoked.
    const users = new AdminUserService(prisma, undefined!, app.get(AuditLogService), app.get(AdminMutationService), undefined!, undefined!, undefined!);
    expect(await users.list(f.identity, { organizationId: scope.id })).toEqual([]);
    await expect(users.detail(f.identity, target.id, scope.id)).rejects.toMatchObject({ status: 404 });
    await expect(users.getMfaPolicy(f.identity, target.id, scope.id)).rejects.toMatchObject({ status: 404 });
    await expect(users.update(f.identity, target.id, { status: 'ACTIVE' }, scope.id, randomUUID(), randomUUID())).rejects.toMatchObject({ status: 404 });
    await expect(users.setMfaPolicy(f.identity, target.id, { required: false, expectedSecurityVersion: 2 }, scope.id, randomUUID(), randomUUID())).rejects.toMatchObject({ status: 404 });
    await expect(users.readTemporaryPassword(f.identity, target.id, scope.id, randomUUID())).rejects.toMatchObject({ status: 404 });
    await expect(users.resetTemporaryPassword(f.identity, target.id, undefined, scope.id, randomUUID(), randomUUID())).rejects.toMatchObject({ status: 404 });
    await expect(users.resetPassword(f.identity, target.id, 'NotAReusableReset1!', scope.id, randomUUID(), randomUUID())).rejects.toMatchObject({ status: 404 });
  });

  it('refuses a stale server impact whose locked user has moved outside its target scope', async () => {
    const f = await actor();
    const otherScope = await organization();
    const target = await user(otherScope.id);
    await expect(prisma.$transaction(tx => service.apply(tx, f.identity, impact('USER', target.id, f.home.id, [target.id])))).rejects.toMatchObject({ status: 409 });
    expect(await prisma.user.findUniqueOrThrow({ where: { id: target.id } })).toEqual(target);
  });

  it('rechecks platform identity after waiting for a locked target and leaves all target credentials intact when revoked', async () => {
    const f = await actor();
    const target = await user(f.home.id);
    let unlock!: () => void;
    let locked!: () => void;
    const acquired = new Promise<void>(resolve => { locked = resolve; });
    const release = new Promise<void>(resolve => { unlock = resolve; });
    const holder = prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${target.id}::uuid FOR UPDATE`;
      locked();
      await release;
    });
    await acquired;
    const command = service.deleteUser(f.identity, target.id, { expectedSecurityVersion: 1 }, target.organizationId, randomUUID(), randomUUID());
    const settled = command.then(() => ({ status: 200 }), error => ({ status: error.getStatus?.(), code: error.getResponse?.().code }));
    try {
      // Wait for an observed PostgreSQL lock wait, not an arbitrary sleep that could miss the race.
      let waiting = false;
      for (let attempt = 0; attempt < 100; attempt++) {
        const rows = await prisma.$queryRaw<{ waiting: boolean }[]>`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE '%FROM users WHERE id = $1%') AS waiting`;
        if (rows[0]?.waiting) { waiting = true; break; }
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      expect(waiting).toBe(true);
      await prisma.userRole.deleteMany({ where: { userId: f.subject.id, roleId: f.role.id } });
    } finally { unlock(); await holder; }
    expect(await settled).toMatchObject({ status: 403, code: 'FEATURE_PERMISSION_DENIED' });
    expect(await prisma.user.findUniqueOrThrow({ where: { id: target.id } })).toEqual(target);
  });

  it('fails closed if a sibling lifecycle effect has not been registered', async () => {
    const f = await actor();
    const target = await user(f.home.id);
    const incomplete = new AdminUserLifecycleService(new AdministrativeLifecycleRegistry(), app.get(AdminMutationService), app.get(AuditLogService), app.get(ESignatureService));
    await expect(incomplete.deleteUser(f.identity, target.id, { expectedSecurityVersion: 1 }, target.organizationId, randomUUID(), randomUUID())).rejects.toThrow('ADMIN_LIFECYCLE_EFFECTS_INCOMPLETE');
    expect(await prisma.user.findUniqueOrThrow({ where: { id: target.id } })).toEqual(target);
  });

  it('requires a real session and CSRF, rejects scope spoofing and never promotes a supplier marker to platform identity', async () => {
    const f = await actor();
    const target = await user(f.home.id);
    await request(app.getHttpServer()).delete(`/api/v1/admin/users/${target.id}`).send({ expectedSecurityVersion: 1 }).expect(401);
    await request(app.getHttpServer()).delete(`/api/v1/admin/users/${target.id}`).set('Cookie', `qms_session=${f.token}`).set('Idempotency-Key', randomUUID()).send({ expectedSecurityVersion: 1 }).expect(403);
    await remove(f, target).query({ actorUserId: f.subject.id }).expect(400);
    const supplierHome = await organization('SUPPLIER');
    const supplier = await user(supplierHome.id, 'SUPPLIER');
    const supplierTarget = await user(supplierHome.id, 'SUPPLIER');
    await grant(supplier.id, supplierHome.id, ['platform:admin', 'account:users:read', 'account:users:delete']);
    const token = await sessions.create(supplier.id, prisma, { mfaVerified: true, reauthenticated: true });
    await remove({ ...f, token }, supplierTarget).expect(403);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: supplierTarget.id } })).deletedAt).toBeNull();
  });

  it('rejects old password-reset mutation replays and consumed reset tokens after deletion', async () => {
    const f = await actor();
    const target = await user(f.home.id);
    const audit = app.get(AuditLogService);
    const resets = new PasswordResetService(prisma, undefined!, audit);
    const users = new AdminUserService(prisma, undefined!, audit, app.get(AdminMutationService), resets, undefined!, undefined!);
    const key = randomUUID();
    const temporaryCode = 'NotAReusableReset1!';
    const issued = await users.resetPassword(f.identity, target.id, temporaryCode, target.organizationId, randomUUID(), key);
    await remove(f, target).expect(200);
    await expect(users.resetPassword(f.identity, target.id, temporaryCode, target.organizationId, randomUUID(), key)).rejects.toMatchObject({ status: 404 });
    await expect(resets.complete({ resetId: issued.resetId, temporaryCode, newPassword: 'NewPasswordAfterDelete1!' }, randomUUID())).rejects.toMatchObject({ status: 400 });
  });

  it('also destroys a temporary login password hash so reconfiguration cannot make an old plaintext temporary password reusable', async () => {
    const f = await actor();
    const target = await user(f.home.id);
    await prisma.user.update({ where: { id: target.id }, data: { mustChangePassword: true } });
    await prisma.userTemporaryPassword.create({ data: { userId: target.id, credentialVersion: 1, encryptedValue: 'PRIVATE_OLD_TEMP', expiresAt: new Date(Date.now() + 60_000) } });
    await prisma.$transaction(tx => service.apply(tx, f.identity, impact('ORGANIZATION', f.home.id, f.home.id, [target.id])));
    expect((await prisma.user.findUniqueOrThrow({ where: { id: target.id } })).passwordHash).not.toBe(target.passwordHash);
    expect(await prisma.userTemporaryPassword.count({ where: { userId: target.id } })).toBe(0);
  });
});
