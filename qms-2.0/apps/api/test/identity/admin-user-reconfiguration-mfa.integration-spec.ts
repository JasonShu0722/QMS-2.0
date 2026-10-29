import 'reflect-metadata';
import { randomBytes, randomUUID } from 'node:crypto';
import { jest } from '@jest/globals';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import type { Request } from 'express';
import { Secret, TOTP } from 'otpauth';
import { PrismaService } from '../../src/database/prisma.service.js';
import { AuditLogService } from '../../src/modules/audit-log/audit-log.service.js';
import { AdminMutationService, type AdminActor } from '../../src/common/security/admin-mutation.service.js';
import { AdministrativeLifecycleRegistry } from '../../src/common/security/administrative-lifecycle.registry.js';
import { AdminUserLifecycleService } from '../../src/modules/identity/admin-user-lifecycle.service.js';
import { AdminUserReconfigurationService } from '../../src/modules/identity/admin-user-reconfiguration.service.js';
import { OrganizationReconfigurationService } from '../../src/modules/organization/organization-reconfiguration.service.js';
import { AdminUserService } from '../../src/modules/identity/admin-user.service.js';
import { PasswordResetService } from '../../src/modules/identity/password-reset.service.js';
import { SessionService } from '../../src/modules/identity/session.service.js';
import { ESignatureService } from '../../src/modules/e-signature/e-signature.service.js';
import { encryptSecret } from '../../src/common/security/security-keyring.js';
import { digest } from '../../src/common/security/session-security.js';
import { PasswordHasherService } from '../../src/common/security/password-hasher.service.js';
import { PasswordService } from '../../src/modules/identity/password.service.js';
import { MfaService } from '../../src/modules/identity/mfa.service.js';
import { IdentityService } from '../../src/modules/identity/identity.service.js';
import { RateLimitService } from '../../src/modules/identity/rate-limit.guard.js';
import { PasswordChangeChallengeService } from '../../src/modules/identity/password-change-challenge.service.js';
import { isDisposableLoopbackPostgres } from '../disposable-postgres.js';

// Identity-owner command integration; full HTTP/other-owner assembly is verified separately by the parent.
describe('REQ0031 actual user reconfiguration preserves enrolled MFA in real PostgreSQL', () => {
  let app: INestApplication;
  let db: PrismaService;
  let sessions: SessionService;
  let lifecycle: AdminUserLifecycleService;
  let reconfiguration: AdminUserReconfigurationService;
  let users: AdminUserService;
  let resets: PasswordResetService;

  beforeAll(async () => {
    if (!isDisposableLoopbackPostgres(process.env.DATABASE_URL) || process.env.QMS_DISPOSABLE_TEST_DB !== 'true') {
      throw new Error('Requires explicitly disposable loopback PostgreSQL, never preview 55440.');
    }
    app = (await Test.createTestingModule({ providers: [
      PrismaService, AuditLogService, AdminMutationService, ESignatureService, AdministrativeLifecycleRegistry,
      AdminUserLifecycleService, AdminUserReconfigurationService, OrganizationReconfigurationService, SessionService,
      PasswordHasherService, PasswordService, MfaService, IdentityService, RateLimitService, PasswordChangeChallengeService,
      PasswordResetService,
    ] }).compile()).createNestApplication();
    await app.init();
    db = app.get(PrismaService);
    sessions = app.get(SessionService);
    lifecycle = app.get(AdminUserLifecycleService);
    reconfiguration = app.get(AdminUserReconfigurationService);
    resets = app.get(PasswordResetService);
    // Normal status update never invokes temporary-password or appointment onboarding collaborators.
    users = new AdminUserService(db, app.get(PasswordService), app.get(AuditLogService), app.get(AdminMutationService), resets, undefined!, undefined!);
    expect(await db.$queryRaw`SELECT COUNT(*)::int AS count FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`).toEqual([{ count: 134 }]);
  });
  afterAll(async () => { await app?.close(); });

  async function organization() {
    return db.organization.create({ data: { code: randomUUID(), name: 'MFA reconfiguration scope', type: 'INTERNAL' } });
  }
  async function grant(userId: string, organizationId: string, codes: string[]) {
    const permissions = await db.permission.findMany({ where: { code: { in: codes } } });
    expect(permissions).toHaveLength(codes.length);
    const role = await db.role.create({ data: { organizationId, code: randomUUID(), name: 'MFA reconfiguration role',
      permissions: { create: permissions.map(p => ({ permissionId: p.id })) } } });
    await db.userRole.create({ data: { userId, organizationId, roleId: role.id } });
    return role;
  }
  async function administrator() {
    const home = await organization();
    const subject = await db.user.create({ data: { organizationId: home.id, username: randomUUID(), accountType: 'INTERNAL', passwordHash: 'fixture-only' } });
    await grant(subject.id, home.id, ['platform:admin', 'organization:reconfigure', 'account:users:read', 'account:users:status']);
    const token = await sessions.create(subject.id, db, { mfaVerified: true, reauthenticated: true });
    const session = (await sessions.resolve(token))!;
    const actor: AdminActor = { id: subject.id, organizationId: home.id, accountType: 'INTERNAL', sessionId: session.id };
    return { home, actor };
  }
  async function enrolled(organizationId: string, bound = true) {
    const password = 'Reconfiguration original password 123!';
    const target = await db.user.create({ data: { organizationId, username: randomUUID(), accountType: 'INTERNAL',
      email: `${randomUUID()}@example.test`, passwordHash: await app.get(PasswordService).hash(password),
      mfaEnabled: bound, mfaRequirementOverride: true, mfaFailures: 3, mfaBlockedUntil: new Date(Date.now() - 60_000) } });
    const totp = new TOTP({ secret: new Secret({ size: 32 }), period: 30, digits: 6 });
    const credential = await db.mfaCredential.create({ data: { userId: target.id,
      encryptedSecret: bound ? encryptSecret(totp.secret.base32, `mfa:${target.id}`) : null,
      lastTimeStep: bound ? BigInt(Math.floor(Date.now() / 30_000) - 2) : null,
      pendingSecret: encryptSecret(new Secret({ size: 32 }).base32, `mfa:${target.id}`), pendingExpiresAt: new Date(Date.now() + 300_000) } });
    return { target, password, totp, credential };
  }
  function login(target: { username: string }, password: string) {
    return app.get(IdentityService).login({ identifier: target.username, password }, { ip: '127.0.0.1', headers: {} } as Request);
  }
  async function pending(kind: 'ORGANIZATION' | 'DEPARTMENT', actor: AdminActor, target: { id: string; organizationId: string }) {
    const department = await db.department.create({ data: { organizationId: target.organizationId, code: randomUUID(), name: 'Lost department' } });
    const position = await db.position.create({ data: { organizationId: target.organizationId, departmentId: department.id, code: randomUUID(), name: 'Lost appointment' } });
    const assignment = await db.userPosition.create({ data: { organizationId: target.organizationId, userId: target.id, positionId: position.id, startedAt: new Date(Date.now() - 60_000) } });
    await db.$transaction(tx => lifecycle.apply(tx, actor, { kind, entityId: kind === 'ORGANIZATION' ? target.organizationId : department.id,
      organizationId: target.organizationId, receiptOrganizationId: actor.organizationId, userIds: [target.id],
      organizationIds: kind === 'ORGANIZATION' ? [target.organizationId] : [], departmentIds: [department.id], positionIds: [position.id] }));
    expect(await db.user.findUniqueOrThrow({ where: { id: target.id } })).toMatchObject({ configurationRequired: true, status: 'DISABLED', deletedAt: null });
    return assignment;
  }
  async function restore(actor: AdminActor, id: string, targetOrganizationId?: string, key = randomUUID()) {
    const target = await db.user.findUniqueOrThrow({ where: { id } });
    return reconfiguration.restore(actor, id, { expectedVersion: target.securityVersion, ...(targetOrganizationId ? { targetOrganizationId } : {}) }, randomUUID(), key);
  }
  async function enable(actor: AdminActor, id: string, organizationId: string) {
    await users.update(actor, id, { status: 'ACTIVE' }, organizationId, randomUUID(), randomUUID());
  }

  it.each(['ORGANIZATION', 'DEPARTMENT'] as const)('%s pending -> actual restore -> normal enable still requires the original encrypted TOTP, never reenrollment', async kind => {
    const { home, actor } = await administrator();
    const { target, password, credential, totp } = await enrolled(home.id);
    const beforePending = await login(target, password);
    const beforeToken = await sessions.create(target.id, db, { mfaVerified: true });
    await pending(kind, actor, target);
    // Artifacts minted after structural invalidation prove restore itself also revokes them.
    const token = await sessions.create(target.id, db, { mfaVerified: true });
    const temporaryCode = randomUUID();
    const reset = await db.$transaction(tx => resets.issue(tx, target.id, temporaryCode));
    const recoveryCode = randomBytes(32).toString('base64url');
    await db.mfaRecoveryCode.create({ data: { userId: target.id, codeHash: digest(recoveryCode) } });
    const expiresAt = new Date(Date.now() + 300_000);
    await db.passwordChangeChallenge.create({ data: { userId: target.id, organizationId: home.id, tokenHash: digest(randomUUID()), credentialVersion: 2, expiresAt } });
    await db.userTemporaryPassword.create({ data: { userId: target.id, credentialVersion: 2, encryptedValue: encryptSecret('old temporary', `temporary:${target.id}`), expiresAt } });
    await db.mfaCredential.update({ where: { userId: target.id }, data: { pendingSecret: credential.pendingSecret, pendingExpiresAt: expiresAt } });
    const verification = await db.emailVerification.create({ data: { userId: target.id, email: target.email!, purpose: 'PASSWORD_RECOVERY',
      securityVersion: 2, tokenHash: digest(randomUUID()), expiresAt, delivery: { create: { encryptedPayload: 'task-only-recovery', keyId: 'test' } } } });
    const role = await grant(target.id, home.id, ['account:users:read']);
    const department = await db.department.create({ data: { organizationId: home.id, code: randomUUID(), name: 'Late department' } });
    const position = await db.position.create({ data: { organizationId: home.id, departmentId: department.id, code: randomUUID(), name: 'Late appointment' } });
    const appointment = await db.userPosition.create({ data: { organizationId: home.id, userId: target.id, positionId: position.id, startedAt: new Date(Date.now() - 60_000) } });
    const signatureId = randomUUID();
    await db.$executeRaw`INSERT INTO user_signatures(id, organization_id, user_id, label, fingerprint) VALUES (${signatureId}::uuid, ${home.id}::uuid, ${target.id}::uuid, 'Reconfiguration signature', ${'e'.repeat(64)})`;

    await restore(actor, target.id);
    await enable(actor, target.id, home.id);
    const challenge = await login(target, password);
    expect(challenge.response.securityState).toBe('MFA_REQUIRED');
    expect(challenge.sessionToken).toBeUndefined();
    expect(await db.user.findUniqueOrThrow({ where: { id: target.id } })).toMatchObject({ organizationId: home.id, configurationRequired: false,
      deletedAt: null, status: 'ACTIVE', mustChangePassword: false, passwordHash: target.passwordHash, mfaEnabled: true,
      mfaFailures: target.mfaFailures, mfaBlockedUntil: target.mfaBlockedUntil, securityVersion: 3, credentialVersion: 3 });
    expect(await db.mfaCredential.findUniqueOrThrow({ where: { userId: target.id } })).toMatchObject({
      encryptedSecret: credential.encryptedSecret, lastTimeStep: credential.lastTimeStep, pendingSecret: null, pendingExpiresAt: null });
    expect(await sessions.resolve(beforeToken)).toBeNull();
    expect(await sessions.resolve(token)).toBeNull();
    for (const model of [db.passwordReset, db.passwordChangeChallenge, db.mfaRecoveryCode, db.emailVerification]) {
      expect(await (model.count as (args: object) => Promise<number>)({ where: { userId: target.id, consumedAt: null } })).toBe(0);
    }
    expect(await db.userTemporaryPassword.count({ where: { userId: target.id } })).toBe(0);
    expect(await db.recoveryDelivery.findUniqueOrThrow({ where: { verificationId: verification.id } })).toMatchObject({ status: 'CANCELLED', encryptedPayload: null });
    expect((await db.userPosition.findUniqueOrThrow({ where: { id: appointment.id } })).endedAt).not.toBeNull();
    expect(await db.userRole.count({ where: { userId: target.id } })).toBe(0);
    expect(await db.role.count({ where: { id: role.id } })).toBe(1);
    expect(await db.$queryRaw`SELECT status FROM user_signatures WHERE id = ${signatureId}::uuid`).toEqual([{ status: 'REVOKED' }]);
    const mfa = app.get(MfaService);
    await expect(resets.complete({ resetId: reset.resetId, temporaryCode, newPassword: 'Not reusable after restore 123!' }, randomUUID())).rejects.toMatchObject({ response: { code: 'AUTH_PASSWORD_RESET_INVALID' } });
    await expect(mfa.verifyChallenge(beforePending.challengeToken, totp.generate(), randomUUID())).rejects.toMatchObject({ response: { code: 'AUTH_MFA_CHALLENGE_INVALID' } });
    await expect(mfa.beginEnrollment({ challengeToken: challenge.challengeToken }, randomUUID())).rejects.toMatchObject({ status: 409, response: { code: 'AUTH_MFA_ALREADY_ENABLED' } });
    await expect(mfa.verifyChallenge(challenge.challengeToken, recoveryCode, randomUUID())).rejects.toMatchObject({ response: { code: 'AUTH_MFA_CODE_INVALID' } });
    const verified = await mfa.verifyChallenge(challenge.challengeToken, totp.generate(), randomUUID());
    expect(verified.securityState).toBe('AUTHENTICATED');
    expect(await sessions.resolve(verified.sessionToken)).not.toBeNull();
  });

  it.each(['ORGANIZATION', 'DEPARTMENT'] as const)('preserves active MFA lockout through %s restore and enable', async kind => {
    const { home, actor } = await administrator();
    const { target, password, credential } = await enrolled(home.id);
    const blockedUntil = new Date(Date.now() + 900_000);
    await db.user.update({ where: { id: target.id }, data: { mfaFailures: 7, mfaBlockedUntil: blockedUntil } });
    await pending(kind, actor, target);
    await restore(actor, target.id);
    await enable(actor, target.id, home.id);
    expect(await db.user.findUniqueOrThrow({ where: { id: target.id } })).toMatchObject({ mfaEnabled: true, mfaFailures: 7, mfaBlockedUntil: blockedUntil });
    expect(await db.mfaCredential.findUniqueOrThrow({ where: { userId: target.id } })).toMatchObject({ encryptedSecret: credential.encryptedSecret, lastTimeStep: credential.lastTimeStep });
    await expect(login(target, password)).rejects.toMatchObject({ status: 429, response: { code: 'AUTH_MFA_RATE_LIMITED' } });
  });

  it('keeps an unbound identity unbound and discards only its pending enrollment on actual restore', async () => {
    const { home, actor } = await administrator();
    const { target, password, credential } = await enrolled(home.id, false);
    await pending('DEPARTMENT', actor, target);
    await db.mfaCredential.update({ where: { userId: target.id }, data: { pendingSecret: credential.pendingSecret, pendingExpiresAt: credential.pendingExpiresAt } });
    await restore(actor, target.id);
    await enable(actor, target.id, home.id);
    expect(await db.user.findUniqueOrThrow({ where: { id: target.id } })).toMatchObject({ mfaEnabled: false, mfaFailures: target.mfaFailures, mfaBlockedUntil: target.mfaBlockedUntil });
    expect(await db.mfaCredential.findUniqueOrThrow({ where: { userId: target.id } })).toMatchObject({ encryptedSecret: null, lastTimeStep: null, pendingSecret: null, pendingExpiresAt: null });
    expect((await login(target, password)).response.securityState).toBe('MFA_ENROLLMENT_REQUIRED');
  });

  it('randomizes a temporary password again on restore and never makes its plaintext reusable after enable', async () => {
    const { home, actor } = await administrator();
    const { target, password } = await enrolled(home.id);
    await db.user.update({ where: { id: target.id }, data: { mustChangePassword: true } });
    await pending('DEPARTMENT', actor, target);
    const before = await db.user.findUniqueOrThrow({ where: { id: target.id } });
    expect(before.passwordHash).not.toBe(target.passwordHash);
    await db.userTemporaryPassword.create({ data: { userId: target.id, credentialVersion: before.credentialVersion,
      encryptedValue: encryptSecret(password, `temporary:${target.id}`), expiresAt: new Date(Date.now() + 300_000) } });
    await restore(actor, target.id);
    await enable(actor, target.id, home.id);
    const after = await db.user.findUniqueOrThrow({ where: { id: target.id } });
    expect(after.mustChangePassword).toBe(true);
    expect(after.passwordHash).not.toBe(before.passwordHash);
    expect(await app.get(PasswordService).verify(after.passwordHash, password)).toBe(false);
    expect(await db.userTemporaryPassword.count({ where: { userId: target.id } })).toBe(0);
    await expect(login(target, password)).rejects.toMatchObject({ status: 401 });
  });

  it('restores into another active organization without moving historical appointments or discarding the original MFA factor', async () => {
    const { home, actor } = await administrator();
    const source = await organization();
    const { target, password, credential, totp } = await enrolled(source.id);
    const assignment = await pending('ORGANIZATION', actor, target);
    await db.organization.update({ where: { id: source.id }, data: { status: 'DISABLED' } });
    await restore(actor, target.id, home.id);
    await enable(actor, target.id, home.id);
    expect(await db.user.findUniqueOrThrow({ where: { id: target.id } })).toMatchObject({ organizationId: home.id, mfaEnabled: true, passwordHash: target.passwordHash });
    expect(await db.userPosition.findUniqueOrThrow({ where: { id: assignment.id } })).toMatchObject({ organizationId: source.id, endedAt: expect.any(Date) });
    expect(await db.mfaCredential.findUniqueOrThrow({ where: { userId: target.id } })).toMatchObject({ encryptedSecret: credential.encryptedSecret, lastTimeStep: credential.lastTimeStep });
    const challenge = await login(target, password);
    expect(challenge.response.securityState).toBe('MFA_REQUIRED');
    expect((await app.get(MfaService).verifyChallenge(challenge.challengeToken, totp.generate(), randomUUID())).securityState).toBe('AUTHENTICATED');
  });

  it('rejects stale CAS and concurrent duplicate configuration, replays the same key without a second revocation', async () => {
    const { home, actor } = await administrator();
    const { target, credential } = await enrolled(home.id);
    await pending('DEPARTMENT', actor, target);
    const before = await db.user.findUniqueOrThrow({ where: { id: target.id } });
    await expect(reconfiguration.restore(actor, target.id, { expectedVersion: 1 }, randomUUID(), randomUUID())).rejects.toMatchObject({ status: 409 });
    expect(await db.user.findUniqueOrThrow({ where: { id: target.id } })).toEqual(before);
    const key = randomUUID();
    const command = () => reconfiguration.restore(actor, target.id, { expectedVersion: before.securityVersion }, randomUUID(), key);
    const [first, second] = await Promise.all([command(), command()]);
    expect(second).toEqual(first);
    expect(await command()).toEqual(first);
    const current = await db.user.findUniqueOrThrow({ where: { id: target.id } });
    expect(current).toMatchObject({ securityVersion: before.securityVersion + 1, credentialVersion: before.credentialVersion + 1, mfaEnabled: true });
    expect(await db.mfaCredential.findUniqueOrThrow({ where: { userId: target.id } })).toMatchObject({ encryptedSecret: credential.encryptedSecret, lastTimeStep: credential.lastTimeStep });
    expect(await db.auditEvent.count({ where: { action: 'USER_RECONFIGURED', resourceId: target.id } })).toBe(1);
    await expect(restore(actor, target.id)).rejects.toMatchObject({ status: 409 });
  });

  it('rolls back the identity, encrypted factor, lockout and all revocations when the success audit fails', async () => {
    const { home, actor } = await administrator();
    const { target } = await enrolled(home.id);
    await pending('DEPARTMENT', actor, target);
    const token = await sessions.create(target.id, db, { mfaVerified: true });
    const reset = await db.$transaction(tx => resets.issue(tx, target.id, randomUUID()));
    await db.mfaRecoveryCode.create({ data: { userId: target.id, codeHash: digest(randomUUID()) } });
    const before = await db.user.findUniqueOrThrow({ where: { id: target.id } });
    const credential = await db.mfaCredential.findUniqueOrThrow({ where: { userId: target.id } });
    const audit = app.get(AuditLogService);
    const original = audit.record.bind(audit);
    const failure = jest.spyOn(audit, 'record').mockImplementation(async (event, tx) => {
      if (event.action === 'USER_RECONFIGURED') throw new Error('TEST_RECONFIGURATION_AUDIT_ROLLBACK');
      return original(event, tx);
    });
    const key = randomUUID();
    try { await expect(restore(actor, target.id, undefined, key)).rejects.toThrow('TEST_RECONFIGURATION_AUDIT_ROLLBACK'); }
    finally { failure.mockRestore(); }
    expect(await db.user.findUniqueOrThrow({ where: { id: target.id } })).toEqual(before);
    expect(await db.mfaCredential.findUniqueOrThrow({ where: { userId: target.id } })).toEqual(credential);
    expect(await db.session.findUniqueOrThrow({ where: { tokenHash: digest(token) } })).toHaveProperty('revokedAt', null);
    expect(await db.passwordReset.findUniqueOrThrow({ where: { id: reset.resetId } })).toHaveProperty('consumedAt', null);
    expect(await db.mfaRecoveryCode.count({ where: { userId: target.id, consumedAt: null } })).toBe(1);
    expect(await db.adminMutation.count({ where: { actorUserId: actor.id, key } })).toBe(0);
    expect(await db.auditEvent.count({ where: { action: 'USER_RECONFIGURED', resourceId: target.id } })).toBe(0);
  });
});
