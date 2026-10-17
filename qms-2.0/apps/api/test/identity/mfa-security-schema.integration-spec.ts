import 'reflect-metadata';
import { jest } from '@jest/globals';
import { randomBytes, randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import request from 'supertest';
import { TOTP } from 'otpauth';
import { AppModule } from '../../src/app.module.js';
import { PrismaService } from '../../src/database/prisma.service.js';
import { GlobalExceptionFilter } from '../../src/common/contracts/global-exception.filter.js';
import { MfaService } from '../../src/modules/identity/mfa.service.js';
import { SessionService } from '../../src/modules/identity/session.service.js';
import { PasswordService } from '../../src/modules/identity/password.service.js';
import { IdentityService } from '../../src/modules/identity/identity.service.js';
import { AdminMutationService } from '../../src/common/security/admin-mutation.service.js';
import { AuditLogService } from '../../src/modules/audit-log/audit-log.service.js';
import { digest } from '../../src/common/security/session-security.js';

if (!process.env.DATABASE_URL) throw new Error('PostgreSQL integration requires DATABASE_URL; no skipping.');

describe('MFA PostgreSQL security boundaries', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let mfa: MfaService;
  let sessions: SessionService;
  let organizationId: string;
  let passwordHash: string;
  const password = 'Security integration password 123!';
  const originalKeys = process.env.QMS_SECURITY_KEYRING;
  const originalKeyId = process.env.QMS_SECURITY_CURRENT_KEY_ID;

  beforeAll(async () => {
    process.env.QMS_SECURITY_CURRENT_KEY_ID = 'test-key';
    process.env.QMS_SECURITY_KEYRING = JSON.stringify({ 'test-key': randomBytes(32).toString('base64') });
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init();
    prisma = app.get(PrismaService);
    mfa = app.get(MfaService);
    sessions = app.get(SessionService);
    organizationId = (await prisma.organization.create({ data: { code: randomUUID(), name: 'Security test', type: 'INTERNAL' } })).id;
    passwordHash = await app.get(PasswordService).hash(password);
  });

  afterAll(async () => {
    if (organizationId) {
      await prisma.auditEvent.deleteMany({ where: { organizationId } });
      await prisma.user.deleteMany({ where: { organizationId } });
      await prisma.organization.delete({ where: { id: organizationId } });
    }
    await app?.close();
    if (originalKeys === undefined) delete process.env.QMS_SECURITY_KEYRING;
    else process.env.QMS_SECURITY_KEYRING = originalKeys;
    if (originalKeyId === undefined) delete process.env.QMS_SECURITY_CURRENT_KEY_ID;
    else process.env.QMS_SECURITY_CURRENT_KEY_ID = originalKeyId;
  });

  async function user(required = true) {
    const created = await prisma.user.create({ data: { organizationId, username: randomUUID(), accountType: 'INTERNAL', passwordHash } });
    if (required) {
      const role = await prisma.role.create({ data: { organizationId, code: randomUUID(), name: 'MFA role', mfaRequired: true } });
      await prisma.userRole.create({ data: { userId: created.id, organizationId, roleId: role.id } });
    }
    return created;
  }

  async function challenge(userId: string) {
    const current = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    return (await prisma.$transaction(async (transaction) => mfa.createChallenge(current, transaction)))!.token;
  }

  async function enrolled() {
    const account = await user();
    const token = await challenge(account.id);
    const enrollment = await mfa.beginEnrollment({ challengeToken: token }, randomUUID());
    const totp = new TOTP({ secret: enrollment.secret });
    const result = await mfa.confirmEnrollment({ challengeToken: token }, totp.generate(), randomUUID());
    return { account, totp, ...result };
  }

  it('issues only an HttpOnly enrollment challenge after a forced user password succeeds and enforces CSRF', async () => {
    const account = await user();
    const csrf = 'csrf-security-test';
    const login = await request(app.getHttpServer()).post('/api/v1/auth/login').set('Cookie', `qms_csrf=${csrf}`).set('x-csrf-token', csrf).send({ identifier: account.username, password }).expect(200);
    expect(login.body).toMatchObject({ securityState: 'MFA_ENROLLMENT_REQUIRED', landingPath: '/mfa' });
    const cookies = login.headers['set-cookie'] as unknown as string[];
    const challengeCookie = cookies.find((cookie) => cookie.startsWith('qms_mfa_challenge='))!;
    expect(challengeCookie).toContain('HttpOnly');
    expect(cookies.some((cookie) => /^qms_session=[^;]/.test(cookie))).toBe(false);
    expect(await prisma.session.count({ where: { userId: account.id } })).toBe(0);
    await request(app.getHttpServer()).get('/api/v1/me').set('Cookie', challengeCookie.split(';')[0]).expect(401);
    await request(app.getHttpServer()).post('/api/v1/me/mfa/enrollment').set('Cookie', challengeCookie.split(';')[0]).expect(403);
    await request(app.getHttpServer()).get('/api/v1/me/security').set('Cookie', challengeCookie.split(';')[0]).expect(200);
  });

  it('encrypts pending and active secrets and only returns recovery codes once', async () => {
    const account = await user();
    const token = await challenge(account.id);
    const enrollment = await mfa.beginEnrollment({ challengeToken: token }, randomUUID());
    expect((await prisma.user.findUniqueOrThrow({ where: { id: account.id } })).mfaEnabled).toBe(false);
    expect(JSON.stringify(await prisma.mfaCredential.findUnique({ where: { userId: account.id } }))).not.toContain(enrollment.secret);
    const result = await mfa.confirmEnrollment({ challengeToken: token }, new TOTP({ secret: enrollment.secret }).generate(), randomUUID());
    expect(result.recoveryCodes).toHaveLength(10);
    expect(new Set(result.recoveryCodes).size).toBe(10);
    expect(result.recoveryCodes.every((code) => /^[\w-]{43}$/.test(code))).toBe(true);
    const stored = JSON.stringify(await prisma.mfaRecoveryCode.findMany({ where: { userId: account.id } }));
    const audit = JSON.stringify(await prisma.auditEvent.findMany({ where: { actorUserId: account.id } }));
    for (const code of result.recoveryCodes) { expect(stored).not.toContain(code); expect(audit).not.toContain(code); }
    expect(audit).not.toContain(enrollment.secret);
    expect(await sessions.resolve(result.sessionToken)).not.toBeNull();
    await expect(mfa.confirmEnrollment({ challengeToken: token }, '123456', randomUUID())).rejects.toMatchObject({ status: 401 });
    expect(await prisma.adminMutation.count({ where: { actorUserId: account.id } })).toBe(0);
  });

  it('atomically consumes a recovery code across different simultaneous challenges', async () => {
    const account = await enrolled();
    const first = await challenge(account.account.id);
    const second = await challenge(account.account.id);
    const results = await Promise.allSettled([mfa.verifyChallenge(first, account.recoveryCodes[0], randomUUID()), mfa.verifyChallenge(second, account.recoveryCodes[0], randomUUID())]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect(await prisma.auditEvent.count({ where: { actorUserId: account.account.id, action: 'MFA_VERIFICATION_REJECTED' } })).toBe(1);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: account.account.id } })).mfaFailures).toBe(1);
  });

  it('rejects enrollment TOTP replay and atomically rejects the second future-window TOTP', async () => {
    const account = await enrolled();
    await expect(mfa.verifyChallenge(await challenge(account.account.id), account.totp.generate(), randomUUID())).rejects.toMatchObject({ response: { code: 'AUTH_MFA_CODE_INVALID' } });
    const code = account.totp.generate({ timestamp: Date.now() + 30_000 });
    const results = await Promise.allSettled([mfa.verifyChallenge(await challenge(account.account.id), code, randomUUID()), mfa.verifyChallenge(await challenge(account.account.id), code, randomUUID())]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
  });

  it('persists per-user failures across challenge rotation and enforces the fifth-failure budget', async () => {
    const account = await enrolled();
    const tokens = await Promise.all(Array.from({ length: 6 }, () => challenge(account.account.id)));
    for (const token of tokens.slice(0, 5)) await expect(mfa.verifyChallenge(token, 'invalid', randomUUID())).rejects.toMatchObject({ response: { code: 'AUTH_MFA_CODE_INVALID' } });
    await expect(mfa.verifyChallenge(tokens[5], account.recoveryCodes[0], randomUUID())).rejects.toMatchObject({ response: { code: 'AUTH_MFA_RATE_LIMITED' } });
    await expect(challenge(account.account.id)).rejects.toMatchObject({ status: 429 });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: account.account.id } })).mfaFailures).toBe(5);
    expect(await prisma.mfaRecoveryCode.count({ where: { userId: account.account.id, consumedAt: null } })).toBe(10);
  });

  it('rejects expired challenges, password changes, disabled identities and role policy changes', async () => {
    const account = await enrolled();
    const expired = await challenge(account.account.id);
    await prisma.mfaChallenge.update({ where: { tokenHash: digest(expired) }, data: { expiresAt: new Date(Date.now() - 1) } });
    await expect(mfa.verifyChallenge(expired, account.recoveryCodes[0], randomUUID())).rejects.toMatchObject({ status: 401 });
    const passwordChanged = await challenge(account.account.id);
    await prisma.user.update({ where: { id: account.account.id }, data: { passwordHash: 'changed' } });
    await expect(mfa.verifyChallenge(passwordChanged, account.recoveryCodes[0], randomUUID())).rejects.toMatchObject({ status: 401 });
    await prisma.user.update({ where: { id: account.account.id }, data: { passwordHash, status: 'DISABLED' } });
    await expect(mfa.verifyChallenge(await challenge(account.account.id), account.recoveryCodes[0], randomUUID())).rejects.toMatchObject({ status: 401 });
    await prisma.user.update({ where: { id: account.account.id }, data: { status: 'ACTIVE' } });
    const policyChanged = await challenge(account.account.id);
    await prisma.role.updateMany({ where: { userRoles: { some: { userId: account.account.id } } }, data: { mfaRequired: false } });
    await expect(mfa.verifyChallenge(policyChanged, account.recoveryCodes[0], randomUUID())).rejects.toMatchObject({ status: 401 });
  });

  it('invalidates unverified old sessions as soon as an assigned role requires MFA', async () => {
    const account = await user(false);
    const sessionToken = await sessions.create(account.id);
    expect(await sessions.resolve(sessionToken)).not.toBeNull();
    const role = await prisma.role.create({ data: { organizationId, code: randomUUID(), name: 'New mandatory role', mfaRequired: true } });
    await prisma.userRole.create({ data: { userId: account.id, roleId: role.id, organizationId } });
    expect(await sessions.resolve(sessionToken)).toBeNull();
  });

  it('requires recent verification before idempotent replay and never bypasses missing session ownership', async () => {
    const account = await enrolled();
    const session = (await sessions.resolve(account.sessionToken))!;
    const permission = await prisma.permission.upsert({ where: { code: 'configuration:manage' }, create: { code: 'configuration:manage', name: 'Configuration' }, update: {} });
    const role = await prisma.role.findFirstOrThrow({ where: { userRoles: { some: { userId: account.account.id } } } });
    await prisma.rolePermission.create({ data: { roleId: role.id, permissionId: permission.id } });
    const input = { actor: { ...account.account, sessionId: session.id }, organizationId, key: randomUUID(), action: 'TEST_SECURITY', payload: {}, permission: 'configuration:manage', traceId: randomUUID() };
    const mutations = app.get(AdminMutationService);
    const work = jest.fn(async () => ({ done: true }));
    await mutations.run(input, work);
    await prisma.session.update({ where: { id: session.id }, data: { reauthenticatedAt: new Date(Date.now() - 301_000) } });
    await expect(mutations.run(input, work)).rejects.toMatchObject({ response: { code: 'AUTH_REAUTHENTICATION_REQUIRED' } });
    expect(work).toHaveBeenCalledTimes(1);
    await mfa.reauthenticate({ sessionToken: account.sessionToken }, password, account.recoveryCodes[0], randomUUID());
    await expect(mutations.run(input, work)).resolves.toEqual({ done: true });
    await expect(mutations.run({ ...input, actor: { ...input.actor, sessionId: randomUUID() } }, work)).rejects.toMatchObject({ status: 401 });
  });

  it('rolls back successful factor consumption and session creation if the success audit fails', async () => {
    const account = await enrolled();
    const token = await challenge(account.account.id);
    const audit = app.get(AuditLogService);
    const original = audit.record.bind(audit);
    const mock = jest.spyOn(audit, 'record').mockImplementation(async (input, transaction) => { if (input.action === 'MFA_LOGIN_SUCCEEDED') throw new Error('simulated audit failure'); return original(input, transaction); });
    try { await expect(mfa.verifyChallenge(token, account.recoveryCodes[0], randomUUID())).rejects.toThrow('simulated audit failure'); }
    finally { mock.mockRestore(); }
    expect((await prisma.mfaChallenge.findUniqueOrThrow({ where: { tokenHash: digest(token) } })).consumedAt).toBeNull();
    expect((await prisma.mfaRecoveryCode.findUniqueOrThrow({ where: { codeHash: digest(account.recoveryCodes[0]) } })).consumedAt).toBeNull();
    await expect(mfa.verifyChallenge(token, account.recoveryCodes[0], randomUUID())).resolves.toMatchObject({ securityState: 'AUTHENTICATED' });
  });

  it('supports optional enrollment and code regeneration but rejects all personal unbinding', async () => {
    const mandatory = await enrolled();
    await expect(mfa.disable({ sessionToken: mandatory.sessionToken }, randomUUID())).rejects.toMatchObject({ response: { code: 'FEATURE_PERMISSION_DENIED' } });
    const account = await user(false);
    const token = await sessions.create(account.id, prisma, { reauthenticated: true });
    const enrollment = await mfa.beginEnrollment({ sessionToken: token }, randomUUID());
    const confirmed = await mfa.confirmEnrollment({ sessionToken: token }, new TOTP({ secret: enrollment.secret }).generate(), randomUUID());
    const codes = await mfa.regenerateCodes({ sessionToken: confirmed.sessionToken }, randomUUID());
    expect(codes.recoveryCodes).toHaveLength(10);
    expect(await prisma.mfaRecoveryCode.findUnique({ where: { codeHash: digest(confirmed.recoveryCodes[0]) } })).toBeNull();
    await expect(mfa.disable({ sessionToken: confirmed.sessionToken }, randomUUID())).rejects.toMatchObject({ response: { code: 'FEATURE_PERMISSION_DENIED' } });
    expect(await sessions.resolve(confirmed.sessionToken)).not.toBeNull();
    expect(await prisma.mfaCredential.count({ where: { userId: account.id } })).toBe(1);
  });

  it('rejects canceled challenges and revoked or expired reauthentication sessions', async () => {
    const account = await enrolled();
    const token = await challenge(account.account.id);
    await mfa.cancelChallenge(token);
    await expect(mfa.verifyChallenge(token, account.recoveryCodes[0], randomUUID())).rejects.toMatchObject({ response: { code: 'AUTH_MFA_CHALLENGE_INVALID' } });
    const session = (await sessions.resolve(account.sessionToken))!;
    await prisma.session.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
    await expect(mfa.reauthenticate({ sessionToken: account.sessionToken }, password, account.recoveryCodes[0], randomUUID())).rejects.toMatchObject({ response: { code: 'AUTH_SESSION_REQUIRED' } });
    await prisma.session.update({ where: { id: session.id }, data: { revokedAt: null, expiresAt: new Date(0) } });
    await expect(mfa.reauthenticate({ sessionToken: account.sessionToken }, password, account.recoveryCodes[0], randomUUID())).rejects.toMatchObject({ response: { code: 'AUTH_SESSION_REQUIRED' } });
    expect(await prisma.mfaRecoveryCode.count({ where: { userId: account.account.id, consumedAt: null } })).toBe(10);
  });

  it.each(['stale', 'revoked', 'missing-mfa', 'foreign-owner'] as const)('rejects session revocation with a %s current session and persists denial', async (state) => {
    const account = await enrolled();
    const current = (await sessions.resolve(account.sessionToken))!;
    const target = (await sessions.resolve(await sessions.create(account.account.id, prisma, { mfaVerified: true, reauthenticated: true })))!;
    const expectedCode = state === 'stale' ? 'AUTH_REAUTHENTICATION_REQUIRED' : state === 'missing-mfa' ? 'AUTH_MFA_REQUIRED' : 'AUTH_SESSION_REQUIRED';
    let currentSessionId = current.id;
    if (state === 'foreign-owner') {
      const foreign = await user(false);
      currentSessionId = (await sessions.resolve(await sessions.create(foreign.id, prisma, { reauthenticated: true })))!.id;
    } else {
      await prisma.session.update({ where: { id: current.id }, data: state === 'stale' ? { reauthenticatedAt: new Date(Date.now() - 301_000) } : state === 'revoked' ? { revokedAt: new Date() } : { mfaVerifiedAt: null } });
    }
    const traceId = randomUUID();
    await expect(sessions.revokeSession(account.account.id, target.id, currentSessionId, traceId)).rejects.toMatchObject({ response: { code: expectedCode } });
    expect((await prisma.session.findUniqueOrThrow({ where: { id: target.id } })).revokedAt).toBeNull();
    expect(await prisma.auditEvent.findMany({ where: { traceId } })).toMatchObject([{ action: 'ACTION_REJECTED', outcome: 'DENIED', metadata: { reasonCode: expectedCode } }]);
  });

  it('audits profile, password, and missing-session denials after rollback without recording credentials', async () => {
    const account = await enrolled();
    const current = (await sessions.resolve(account.sessionToken))!;
    const identity = app.get(IdentityService);
    const staleProfile = randomUUID();
    const stalePassword = randomUUID();
    const wrongPassword = randomUUID();
    const missingTarget = randomUUID();
    await prisma.session.update({ where: { id: current.id }, data: { reauthenticatedAt: new Date(Date.now() - 301_000) } });
    await expect(identity.updateProfile(account.account.id, { email: 'rejected@example.test' }, staleProfile, current.id)).rejects.toMatchObject({ status: 403 });
    await expect(identity.changePassword({ userId: account.account.id, currentSessionId: current.id, currentPassword: password, newPassword: 'Rejected replacement password 123!', traceId: stalePassword })).rejects.toMatchObject({ status: 403 });
    await expect(identity.changePassword({ userId: account.account.id, currentSessionId: current.id, currentPassword: 'wrong-secret-123', newPassword: 'Rejected replacement password 123!', traceId: wrongPassword })).rejects.toMatchObject({ status: 401 });
    await prisma.session.update({ where: { id: current.id }, data: { reauthenticatedAt: new Date() } });
    await expect(sessions.revokeSession(account.account.id, randomUUID(), current.id, missingTarget)).rejects.toMatchObject({ status: 404 });
    const events = await prisma.auditEvent.findMany({ where: { traceId: { in: [staleProfile, stalePassword, wrongPassword, missingTarget] } } });
    expect(events).toHaveLength(4);
    expect(events.every((event) => event.action === 'ACTION_REJECTED' && event.outcome === 'DENIED')).toBe(true);
    const serialized = JSON.stringify(events);
    expect(serialized).not.toContain(password);
    expect(serialized).not.toContain('wrong-secret-123');
    expect(serialized).not.toContain('Rejected replacement password 123!');
    expect(serialized).not.toContain('rejected@example.test');
    expect((await prisma.user.findUniqueOrThrow({ where: { id: account.account.id } })).email).toBeNull();
    expect(await app.get(PasswordService).verify((await prisma.user.findUniqueOrThrow({ where: { id: account.account.id } })).passwordHash, password)).toBe(true);
  });

  it('audits a password concurrency conflict after rolling back the attempted change', async () => {
    const account = await enrolled();
    const current = (await sessions.resolve(account.sessionToken))!;
    const passwords = app.get(PasswordService);
    const hash = passwords.hash.bind(passwords);
    const replacementHash = await hash('Concurrent winner password 123!');
    const race = jest.spyOn(passwords, 'hash').mockImplementationOnce(async (candidate) => {
      await prisma.user.update({ where: { id: account.account.id }, data: { passwordHash: replacementHash } });
      return hash(candidate);
    });
    const traceId = randomUUID();
    try {
      await expect(app.get(IdentityService).changePassword({ userId: account.account.id, currentSessionId: current.id, currentPassword: password, newPassword: 'Concurrent rejected password 123!', traceId })).rejects.toMatchObject({ response: { code: 'CONCURRENCY_CONFLICT' } });
    } finally { race.mockRestore(); }
    expect(await prisma.auditEvent.findMany({ where: { traceId } })).toMatchObject([{ action: 'ACTION_REJECTED', metadata: { reasonCode: 'CONCURRENCY_CONFLICT' } }]);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: account.account.id } })).passwordHash).toBe(replacementHash);
  });

  it('audits correct-password login rejected by the persistent MFA user block', async () => {
    const account = await user();
    await prisma.user.update({ where: { id: account.id }, data: { mfaFailures: 5, mfaBlockedUntil: new Date(Date.now() + 900_000) } });
    const response = await request(app.getHttpServer()).post('/api/v1/auth/login').set('Cookie', 'qms_csrf=blocked-login').set('x-csrf-token', 'blocked-login').send({ identifier: account.username, password }).expect(429);
    expect(response.body.code).toBe('AUTH_MFA_RATE_LIMITED');
    expect(await prisma.auditEvent.findMany({ where: { actorUserId: account.id, traceId: response.body.traceId } })).toMatchObject([{ action: 'LOGIN_FAILED', outcome: 'FAILURE', metadata: { reasonCode: 'AUTH_MFA_RATE_LIMITED' } }]);
    expect(await prisma.session.count({ where: { userId: account.id } })).toBe(0);
    expect(await prisma.mfaChallenge.count({ where: { userId: account.id } })).toBe(0);
  });

  it('rechecks identity version after waiting for the account lock', async () => {
    const account = await enrolled();
    const token = await challenge(account.account.id);
    let locked!: () => void;
    let release!: () => void;
    const acquired = new Promise<void>((resolve) => { locked = resolve; });
    const released = new Promise<void>((resolve) => { release = resolve; });
    const mutation = prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`SELECT id FROM users WHERE id = ${account.account.id}::uuid FOR UPDATE`;
      locked();
      await released;
      await transaction.user.update({ where: { id: account.account.id }, data: { securityVersion: { increment: 1 } } });
    });
    await acquired;
    const verification = mfa.verifyChallenge(token, account.recoveryCodes[0], randomUUID());
    const observed = verification.catch((error: unknown) => error);
    try {
      let waiting = false;
      for (let attempt = 0; attempt < 100 && !waiting; attempt += 1) {
        const result = await prisma.$queryRaw<{ waiting: boolean }[]>`SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE 'SELECT id FROM users%') AS waiting`;
        waiting = result[0].waiting;
        if (!waiting) await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(waiting).toBe(true);
    } finally { release(); }
    await mutation;
    expect(await observed).toMatchObject({ response: { code: 'AUTH_MFA_CHALLENGE_INVALID' } });
    expect(await prisma.mfaRecoveryCode.count({ where: { userId: account.account.id, consumedAt: null } })).toBe(10);
  });
});
