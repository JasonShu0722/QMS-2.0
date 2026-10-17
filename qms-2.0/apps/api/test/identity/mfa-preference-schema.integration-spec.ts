import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { TOTP } from 'otpauth';
import { accountDeliveryFixture, type AccountDeliveryFixture } from './account-delivery-fixture.js';
import { assertRecentAuthentication, digest, mfaPolicy } from '../../src/common/security/session-security.js';
import { MfaService } from '../../src/modules/identity/mfa.service.js';
import { SessionService } from '../../src/modules/identity/session.service.js';

describe('administrator own MFA preference PostgreSQL boundaries', () => {
  let f: AccountDeliveryFixture;
  let mfa: MfaService;
  let sessions: SessionService;
  beforeAll(async () => { f = await accountDeliveryFixture(); mfa = f.app.get(MfaService); sessions = f.app.get(SessionService); });
  afterAll(async () => { await f?.close(); });

  async function account(administrator = true, bound = true) {
    const user = await f.target();
    const role = await f.prisma.role.create({ data: { organizationId: f.organization.id, code: randomUUID(), name: 'MFA preference role', mfaRequired: true } });
    if (administrator) {
      const permission = await f.prisma.permission.findUniqueOrThrow({ where: { code: 'account:users:reset' } });
      await f.prisma.rolePermission.create({ data: { roleId: role.id, permissionId: permission.id } });
    }
    await f.prisma.userRole.create({ data: { userId: user.id, roleId: role.id, organizationId: f.organization.id } });
    let recoveryCodes: string[] = [];
    let token: string;
    if (bound) {
      const challenge = await f.prisma.$transaction((tx) => mfa.createChallenge(user, tx));
      const enrollment = await mfa.beginEnrollment({ challengeToken: challenge!.token }, randomUUID());
      const confirmed = await mfa.confirmEnrollment({ challengeToken: challenge!.token }, new TOTP({ secret: enrollment.secret }).generate(), randomUUID());
      token = confirmed.sessionToken;
      recoveryCodes = confirmed.recoveryCodes;
    } else token = await sessions.create(user.id, f.prisma, { mfaVerified: true, reauthenticated: true });
    return { user, role, recoveryCodes, token, cookie: `qms_session=${token}; qms_csrf=${f.csrf}` };
  }

  const status = (cookie: string) => request(f.app.getHttpServer()).get('/api/v1/me/security').set('Cookie', cookie);
  const change = (cookie: string, preference: 'ENABLED' | 'DISABLED', code?: string, key = randomUUID()) => f.post('/me/mfa/preference', { preference, ...(code === undefined ? {} : { code }) }, key, cookie);
  async function login(user: { username: string }) {
    const response = await f.post('/auth/login', { identifier: user.username, password: f.password, rememberMe: true }).expect(200);
    const token = (response.headers['set-cookie'] as unknown as string[]).filter((entry) => entry.startsWith('qms_session=')).at(-1)?.split(';')[0].slice('qms_session='.length);
    return { response, token, cookie: `qms_session=${token}; qms_csrf=${f.csrf}` };
  }

  it('migrates old identities to DEFAULT and projects binding separately from effective policy', async () => {
    const a = await account();
    expect((await status(a.cookie).expect(200)).body).toMatchObject({ isAdministrator: true, mfaPreference: 'DEFAULT', mfaEnabled: true, mfaRequired: true, canUnbindMfa: false });
  });

  it('preserves optional ordinary binding deletion but rejects role-required deletion independently of effective login policy', async () => {
    const a = await account(false);
    expect((await status(a.cookie).expect(200)).body.canUnbindMfa).toBe(false);
    await f.prisma.role.update({ where: { id: a.role.id }, data: { mfaRequired: false } });
    expect((await status(a.cookie).expect(200)).body).toMatchObject({ isAdministrator: false, mfaRequired: true, canUnbindMfa: true });
    await f.post('/me/mfa/disable', {}, undefined, a.cookie).expect(204);
    expect(await f.prisma.mfaCredential.count({ where: { userId: a.user.id } })).toBe(0);
  });

  it('denies non-administrators and rejects userId, DEFAULT, missing CSRF and missing idempotency key', async () => {
    const ordinary = await account(false);
    await change(ordinary.cookie, 'DISABLED', ordinary.recoveryCodes[0]).expect(403);
    const a = await account();
    await f.post('/me/mfa/preference', { preference: 'DISABLED', userId: ordinary.user.id, code: a.recoveryCodes[0] }, undefined, a.cookie).expect(400);
    await f.post('/me/mfa/preference', { preference: 'DEFAULT' }, undefined, a.cookie).expect(400);
    await request(f.app.getHttpServer()).post('/api/v1/me/mfa/preference').set('Cookie', a.cookie).send({ preference: 'DISABLED' }).expect(403);
    await request(f.app.getHttpServer()).post('/api/v1/me/mfa/preference').set('Cookie', a.cookie).set('x-csrf-token', f.csrf).send({ preference: 'DISABLED' }).expect(400);
    expect((await status(a.cookie).expect(200)).body.mfaPreference).toBe('DEFAULT');
  });

  it('requires recent complete authentication and an explicit current factor to disable', async () => {
    const a = await account();
    await change(a.cookie, 'DISABLED').expect(401);
    expect((await status(a.cookie).expect(200)).body.mfaPreference).toBe('DEFAULT');
    await f.prisma.session.update({ where: { tokenHash: digest(a.token) }, data: { reauthenticatedAt: new Date(Date.now() - 301_000) } });
    const denied = await change(a.cookie, 'DISABLED', a.recoveryCodes[0]).expect(403);
    expect(denied.body.code).toBe('AUTH_REAUTHENTICATION_REQUIRED');
    expect((await f.prisma.mfaRecoveryCode.findUniqueOrThrow({ where: { codeHash: digest(a.recoveryCodes[0]!) } })).consumedAt).toBeNull();
  });

  it('disables without deleting binding/codes, revokes all own sessions/challenges, preserves seven-day administrator lifetime and unbind safeguards', async () => {
    const a = await account();
    const credential = await f.prisma.mfaCredential.findUniqueOrThrow({ where: { userId: a.user.id } });
    const before = await f.prisma.user.findUniqueOrThrow({ where: { id: a.user.id } });
    await sessions.create(a.user.id, f.prisma, { mfaVerified: true });
    const challenge = await f.prisma.$transaction((tx) => mfa.createChallenge(before, tx, true));
    const passwordChallenge = await f.prisma.passwordChangeChallenge.create({ data: { userId: a.user.id, organizationId: f.organization.id, credentialVersion: before.credentialVersion, tokenHash: digest(randomUUID()), expiresAt: new Date(Date.now() + 300_000) } });
    const changed = await change(a.cookie, 'DISABLED', a.recoveryCodes[0]).expect(204);
    expect(changed.headers['set-cookie']).toEqual(expect.arrayContaining([expect.stringContaining('qms_session=;')]));
    expect((await f.prisma.user.findUniqueOrThrow({ where: { id: a.user.id } })).securityVersion).toBe(before.securityVersion + 1);
    expect(await f.prisma.mfaCredential.findUniqueOrThrow({ where: { userId: a.user.id } })).toEqual(credential);
    expect(await f.prisma.mfaRecoveryCode.count({ where: { userId: a.user.id } })).toBe(10);
    expect(await f.prisma.mfaRecoveryCode.count({ where: { userId: a.user.id, consumedAt: null } })).toBe(9);
    expect(await f.prisma.session.count({ where: { userId: a.user.id, revokedAt: null } })).toBe(0);
    expect((await f.prisma.mfaChallenge.findUniqueOrThrow({ where: { tokenHash: digest(challenge!.token) } })).consumedAt).not.toBeNull();
    expect((await f.prisma.passwordChangeChallenge.findUniqueOrThrow({ where: { id: passwordChallenge.id } })).consumedAt).not.toBeNull();
    expect(await sessions.resolve(a.token)).toBeNull();
    const logged = await login(a.user);
    expect(logged.response.body.securityState).toBe('AUTHENTICATED');
    const stored = await f.prisma.session.findUniqueOrThrow({ where: { tokenHash: digest(logged.token!) } });
    expect(stored.lifetimeType).toBe('REMEMBERED_ADMIN');
    expect(stored.expiresAt.getTime() - Date.now()).toBeGreaterThan(7 * 86_400_000 - 10_000);
    expect(stored.mfaVerifiedAt).toBeNull();
    expect((await status(logged.cookie).expect(200)).body).toMatchObject({ mfaEnabled: true, mfaRequired: false, mfaPreference: 'DISABLED', isAdministrator: true });
    await f.post('/me/reauthenticate', { password: f.password }, undefined, logged.cookie).expect(200);
    await f.prisma.$transaction((tx) => assertRecentAuthentication(tx, { id: a.user.id, sessionId: stored.id }));
    await f.post('/me/mfa/disable', {}, undefined, logged.cookie).expect(403);
  });

  it('requires a fresh valid factor to reenable even though the current disabled policy does not require MFA', async () => {
    const a = await account();
    await change(a.cookie, 'DISABLED', a.recoveryCodes[0]).expect(204);
    const logged = await login(a.user);
    await f.post('/me/reauthenticate', { password: f.password }, undefined, logged.cookie).expect(200);
    await change(logged.cookie, 'ENABLED', 'invalid').expect(401);
    expect((await f.prisma.user.findUniqueOrThrow({ where: { id: a.user.id } })).mfaFailures).toBe(1);
    expect((await status(logged.cookie).expect(200)).body.mfaPreference).toBe('DISABLED');
    await change(logged.cookie, 'ENABLED', a.recoveryCodes[0]).expect(401);
    await change(logged.cookie, 'ENABLED', a.recoveryCodes[1]).expect(204);
    expect(await sessions.resolve(logged.token!)).toBeNull();
    const after = await f.post('/auth/login', { identifier: a.user.username, password: f.password, rememberMe: true }).expect(200);
    expect(after.body.securityState).toBe('MFA_REQUIRED');
  });

  it('rejects reenable while unbound and ignores administrator-only preference after governance role loss', async () => {
    const unbound = await account(true, false);
    expect((await change(unbound.cookie, 'ENABLED', '123456').expect(409)).body.code).toBe('AUTH_MFA_NOT_ENABLED');
    const a = await account();
    await change(a.cookie, 'DISABLED', a.recoveryCodes[0]).expect(204);
    const logged = await login(a.user);
    const before = await f.prisma.$transaction((tx) => mfaPolicy(tx, a.user.id));
    await f.prisma.rolePermission.deleteMany({ where: { roleId: a.role.id } });
    const after = await f.prisma.$transaction((tx) => mfaPolicy(tx, a.user.id));
    expect(after).toMatchObject({ administrator: false, required: true });
    expect(after.digest).not.toBe(before.digest);
    expect(await sessions.resolve(logged.token!)).toBeNull();
    expect((await f.post('/auth/login', { identifier: a.user.username, password: f.password }).expect(200)).body.securityState).toBe('MFA_REQUIRED');
  });

  it('persists factor failure budget and never caches plaintext codes in mutation receipts or audit', async () => {
    const a = await account();
    for (let i = 0; i < 5; i += 1) await change(a.cookie, 'DISABLED', 'invalid').expect(401);
    expect((await change(a.cookie, 'DISABLED', a.recoveryCodes[0]).expect(429)).body.code).toBe('AUTH_MFA_RATE_LIMITED');
    expect((await status(a.cookie).expect(200)).body.mfaPreference).toBe('DEFAULT');
    expect(await f.prisma.adminMutation.count({ where: { actorUserId: a.user.id } })).toBe(0);
    const b = await account();
    await change(b.cookie, 'DISABLED', b.recoveryCodes[0]).expect(204);
    const persisted = JSON.stringify({ receipts: await f.prisma.adminMutation.findMany({ where: { actorUserId: b.user.id } }), audit: await f.prisma.auditEvent.findMany({ where: { actorUserId: b.user.id } }) });
    expect(persisted).not.toContain(b.recoveryCodes[0]);
    expect(await f.prisma.auditEvent.count({ where: { actorUserId: b.user.id, action: 'MFA_PREFERENCE_CHANGED', outcome: 'SUCCESS' } })).toBe(1);
    expect((await f.prisma.auditEvent.findFirstOrThrow({ where: { actorUserId: b.user.id, action: 'MFA_PREFERENCE_CHANGED' } })).metadata).toMatchObject({ status: 'DISABLED' });
  });

  it('requires authentication before replay and records one mutation only; rejects key content collisions after reauthentication', async () => {
    const a = await account();
    const key = randomUUID();
    await change(a.cookie, 'DISABLED', a.recoveryCodes[0], key).expect(204);
    await change(a.cookie, 'DISABLED', a.recoveryCodes[0], key).expect(401);
    const logged = await login(a.user);
    await f.post('/me/reauthenticate', { password: f.password }, undefined, logged.cookie).expect(200);
    const before = await f.prisma.user.findUniqueOrThrow({ where: { id: a.user.id } });
    await change(logged.cookie, 'DISABLED', a.recoveryCodes[0], key).expect(204);
    expect((await f.prisma.user.findUniqueOrThrow({ where: { id: a.user.id } })).securityVersion).toBe(before.securityVersion);
    expect(await f.prisma.adminMutation.count({ where: { actorUserId: a.user.id, key } })).toBe(1);
    const relogged = await login(a.user);
    await f.post('/me/reauthenticate', { password: f.password }, undefined, relogged.cookie).expect(200);
    expect((await change(relogged.cookie, 'ENABLED', a.recoveryCodes[1], key).expect(409)).body.code).toBe('IDEMPOTENCY_REPLAY');
  });

  it('serializes simultaneous preference requests and commits only one factor, version, success audit and receipt', async () => {
    const a = await account();
    const before = await f.prisma.user.findUniqueOrThrow({ where: { id: a.user.id } });
    const key = randomUUID();
    const results = await Promise.all([change(a.cookie, 'DISABLED', a.recoveryCodes[0], key), change(a.cookie, 'DISABLED', a.recoveryCodes[0], key)]);
    expect(results.map((result) => result.status).sort()).toEqual([204, 401]);
    expect((await f.prisma.user.findUniqueOrThrow({ where: { id: a.user.id } })).securityVersion).toBe(before.securityVersion + 1);
    expect(await f.prisma.mfaRecoveryCode.count({ where: { userId: a.user.id, consumedAt: null } })).toBe(9);
    expect(await f.prisma.adminMutation.count({ where: { actorUserId: a.user.id, key } })).toBe(1);
    expect(await f.prisma.auditEvent.count({ where: { actorUserId: a.user.id, action: 'MFA_PREFERENCE_CHANGED' } })).toBe(1);
  });

  it('invalidates in-flight challenges when binding/preference changes and enforces ordinary role policy despite a stale administrator preference', async () => {
    const a = await account(false);
    const current = await f.prisma.user.findUniqueOrThrow({ where: { id: a.user.id } });
    const challenge = await f.prisma.$transaction((tx) => mfa.createChallenge(current, tx));
    const before = await f.prisma.$transaction((tx) => mfaPolicy(tx, a.user.id));
    await f.prisma.user.update({ where: { id: a.user.id }, data: { mfaPreference: 'DISABLED' } });
    const after = await f.prisma.$transaction((tx) => mfaPolicy(tx, a.user.id));
    expect(after.required).toBe(true);
    expect(after.digest).not.toBe(before.digest);
    await expect(mfa.verifyChallenge(challenge!.token, a.recoveryCodes[0]!, randomUUID())).rejects.toMatchObject({ response: { code: 'AUTH_MFA_CHALLENGE_INVALID' } });
    await f.prisma.user.update({ where: { id: a.user.id }, data: { mfaEnabled: false } });
    const unbound = await f.prisma.$transaction((tx) => mfaPolicy(tx, a.user.id));
    expect(unbound.digest).not.toBe(after.digest);
    const unverified = await sessions.create(a.user.id, f.prisma, { reauthenticated: true });
    expect(await sessions.resolve(unverified)).toBeNull();
    expect((await f.post('/auth/login', { identifier: a.user.username, password: f.password }).expect(200)).body.securityState).toBe('MFA_ENROLLMENT_REQUIRED');
  });

  it('rolls back preference, factor consumption, version, challenges, sessions and receipt if the database rejects success audit', async () => {
    const a = await account();
    const before = await f.prisma.user.findUniqueOrThrow({ where: { id: a.user.id } });
    const challenge = await f.prisma.$transaction((tx) => mfa.createChallenge(before, tx));
    await f.prisma.$executeRawUnsafe(`CREATE FUNCTION test_mfa_preference_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action = 'MFA_PREFERENCE_CHANGED' THEN RAISE EXCEPTION 'test preference audit rejected'; END IF; RETURN NEW; END $$`);
    await f.prisma.$executeRawUnsafe('CREATE TRIGGER test_mfa_preference_audit_failure BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION test_mfa_preference_audit_failure()');
    try { await change(a.cookie, 'DISABLED', a.recoveryCodes[0]).expect(500); }
    finally {
      await f.prisma.$executeRawUnsafe('DROP TRIGGER test_mfa_preference_audit_failure ON audit_events');
      await f.prisma.$executeRawUnsafe('DROP FUNCTION test_mfa_preference_audit_failure()');
    }
    expect(await f.prisma.user.findUniqueOrThrow({ where: { id: a.user.id } })).toEqual(before);
    expect((await f.prisma.mfaRecoveryCode.findUniqueOrThrow({ where: { codeHash: digest(a.recoveryCodes[0]!) } })).consumedAt).toBeNull();
    expect((await f.prisma.mfaChallenge.findUniqueOrThrow({ where: { tokenHash: digest(challenge!.token) } })).consumedAt).toBeNull();
    expect(await sessions.resolve(a.token)).not.toBeNull();
    expect(await f.prisma.adminMutation.count({ where: { actorUserId: a.user.id } })).toBe(0);
    await change(a.cookie, 'DISABLED', a.recoveryCodes[0]).expect(204);
  });
});
