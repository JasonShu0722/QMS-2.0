import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { TOTP } from 'otpauth';
import { accountDeliveryFixture, type AccountDeliveryFixture } from './account-delivery-fixture.js';
import { digest, mfaPolicy } from '../../src/common/security/session-security.js';
import { SessionService } from '../../src/modules/identity/session.service.js';
import { MfaService } from '../../src/modules/identity/mfa.service.js';

describe('administrator account MFA policy PostgreSQL boundaries', () => {
  let f: AccountDeliveryFixture;
  beforeAll(async () => { f = await accountDeliveryFixture(); });
  afterAll(async () => { await f?.close(); });

  const read = (id: string, cookie = f.cookie, query = '') => request(f.app.getHttpServer()).get(`/api/v1/admin/users/${id}/mfa-policy${query}`).set('Cookie', cookie);
  const put = (id: string, required: boolean, version: number, key = randomUUID(), cookie = f.cookie, query = '') => request(f.app.getHttpServer()).put(`/api/v1/admin/users/${id}/mfa-policy${query}`)
    .set('Cookie', cookie).set('x-csrf-token', f.csrf).set('Idempotency-Key', key).send({ required, expectedSecurityVersion: version });

  async function role(userId: string, permissions: string[] = [], required = false, organizationId = f.organization.id) {
    const created = await f.prisma.role.create({ data: { organizationId, code: randomUUID(), name: 'MFA governance test', mfaRequired: required, permissions: { create: permissions.map((code) => ({ permission: { connect: { code } } })) } } });
    await f.prisma.userRole.create({ data: { userId, organizationId, roleId: created.id } });
    return created;
  }

  async function enrolled() {
    const user = await f.target();
    await role(user.id, [], true);
    const mfa = f.app.get(MfaService);
    const challenge = await f.prisma.$transaction((tx) => mfa.createChallenge(user, tx));
    const enrollment = await mfa.beginEnrollment({ challengeToken: challenge!.token }, randomUUID());
    const confirmed = await mfa.confirmEnrollment({ challengeToken: challenge!.token }, new TOTP({ secret: enrollment.secret }).generate(), randomUUID());
    return { user: await f.prisma.user.findUniqueOrThrow({ where: { id: user.id } }), confirmed };
  }

  it('lets an internal credential administrator enable an unbound account through account management', async () => {
    const user = await f.target();
    expect((await read(user.id).expect(200)).body).toMatchObject({ required: false, override: null });
    const response = await put(user.id, true, user.securityVersion).expect(200);
    expect(response.body).toMatchObject({ userId: user.id, required: true, bound: false, override: true, roleRequired: false, securityVersion: user.securityVersion + 1, selfSessionRevoked: false });
    expect((await f.login(user.username, f.password).expect(200)).body.securityState).toBe('MFA_ENROLLMENT_REQUIRED');
  });

  it('snapshots legacy ordinary binding requirements in the migration while retaining administrator disabled preference', async () => {
    const ordinary = await f.target();
    const administrator = await f.target();
    const roleRequired = await f.target();
    await role(administrator.id, ['account:users:reset']);
    await role(roleRequired.id, [], true);
    await f.prisma.user.updateMany({ where: { id: { in: [ordinary.id, administrator.id] } }, data: { mfaEnabled: true, mfaPreference: 'DISABLED' } });
    const rollback = new Error('rollback migration snapshot test');
    try {
      await f.prisma.$transaction(async (tx) => {
        const migration = readFileSync(new URL('../../prisma/migrations/20261018010000_admin_mfa_policy/migration.sql', import.meta.url), 'utf8');
        await tx.$executeRawUnsafe(migration.slice(migration.indexOf('UPDATE ')));
        expect((await tx.user.findUniqueOrThrow({ where: { id: ordinary.id } })).mfaRequirementOverride).toBe(true);
        expect((await tx.user.findUniqueOrThrow({ where: { id: administrator.id } })).mfaRequirementOverride).toBeNull();
        expect((await tx.user.findUniqueOrThrow({ where: { id: roleRequired.id } })).mfaRequirementOverride).toBeNull();
        expect(await mfaPolicy(tx, ordinary.id)).toMatchObject({ administrator: false, required: true });
        expect(await mfaPolicy(tx, administrator.id)).toMatchObject({ administrator: true, required: false });
        expect(await mfaPolicy(tx, roleRequired.id)).toMatchObject({ administrator: false, required: true });
        throw rollback;
      });
    } catch (error) { if (error !== rollback) throw error; }
  });

  it.each([null, false])('does not enable login MFA when an ordinary account binds a factor with override=%s', async (override) => {
    const user = await f.target();
    if (override === false) await put(user.id, false, user.securityVersion).expect(200);
    const sessions = f.app.get(SessionService);
    const token = await sessions.create(user.id, f.prisma, { reauthenticated: true });
    const mfa = f.app.get(MfaService);
    const enrollment = await mfa.beginEnrollment({ sessionToken: token }, randomUUID());
    const confirmed = await mfa.confirmEnrollment({ sessionToken: token }, new TOTP({ secret: enrollment.secret }).generate(), randomUUID());
    expect(await f.prisma.$transaction((tx) => mfaPolicy(tx, user.id))).toMatchObject({ required: false, administrator: false });
    expect((await f.prisma.user.findUniqueOrThrow({ where: { id: user.id } })).mfaRequirementOverride).toBe(override);
    expect(await sessions.resolve(confirmed.sessionToken)).not.toBeNull();
    expect((await f.login(user.username, f.password).expect(200)).body.securityState).toBe('AUTHENTICATED');
  });

  it('keeps binding and all recovery codes when an administrator overrides a required role off', async () => {
    const { user, confirmed } = await enrolled();
    const credential = await f.prisma.mfaCredential.findUniqueOrThrow({ where: { userId: user.id } });
    const mfa = f.app.get(MfaService);
    const pending = await f.prisma.$transaction((tx) => mfa.createChallenge(user, tx));
    const passwordChallenge = await f.prisma.passwordChangeChallenge.create({ data: { userId: user.id, organizationId: user.organizationId, credentialVersion: user.credentialVersion, tokenHash: digest(randomUUID()), expiresAt: new Date(Date.now() + 300_000) } });
    const response = await put(user.id, false, user.securityVersion).expect(200);
    expect(response.body).toMatchObject({ required: false, bound: true, override: false, roleRequired: true, selfSessionRevoked: false });
    expect(await f.prisma.mfaCredential.findUniqueOrThrow({ where: { userId: user.id } })).toEqual(credential);
    expect(await f.prisma.mfaRecoveryCode.count({ where: { userId: user.id, consumedAt: null } })).toBe(10);
    expect(await f.app.get(SessionService).resolve(confirmed.sessionToken)).toBeNull();
    expect((await f.prisma.mfaChallenge.findUniqueOrThrow({ where: { tokenHash: digest(pending!.token) } })).consumedAt).not.toBeNull();
    expect((await f.prisma.passwordChangeChallenge.findUniqueOrThrow({ where: { id: passwordChallenge.id } })).consumedAt).not.toBeNull();
    expect((await f.login(user.username, f.password).expect(200)).body.securityState).toBe('AUTHENTICATED');
    const stored = JSON.stringify({ receipts: await f.prisma.adminMutation.findMany({ where: { organizationId: f.organization.id, action: 'USER_MFA_POLICY_CHANGED' } }), audits: await f.prisma.auditEvent.findMany({ where: { resourceId: user.id } }) });
    for (const code of confirmed.recoveryCodes) expect(stored).not.toContain(code);
    expect(stored).not.toContain(credential.encryptedSecret!);
    expect((await f.prisma.auditEvent.findFirstOrThrow({ where: { resourceId: user.id, action: 'USER_MFA_POLICY_CHANGED' } })).metadata).toEqual({ targetUserId: user.id, status: 'DISABLED' });
  });

  it('replays one receipt without another version or success audit and rejects key collisions', async () => {
    const user = await f.target();
    const key = randomUUID();
    const first = await put(user.id, true, user.securityVersion, key).expect(200);
    expect((await put(user.id, true, user.securityVersion, key).expect(200)).body).toEqual(first.body);
    expect((await put(user.id, false, user.securityVersion, key).expect(409)).body.code).toBe('IDEMPOTENCY_REPLAY');
    expect(await f.prisma.adminMutation.count({ where: { actorUserId: f.actor.id, key } })).toBe(1);
    expect(await f.prisma.auditEvent.count({ where: { resourceId: user.id, action: 'USER_MFA_POLICY_CHANGED' } })).toBe(1);
    expect((await f.prisma.user.findUniqueOrThrow({ where: { id: user.id } })).securityVersion).toBe(user.securityVersion + 1);
  });

  it('configures a legacy default explicitly once and does not revoke again for the same value', async () => {
    const user = await f.target();
    const first = await put(user.id, false, user.securityVersion).expect(200);
    expect(first.body.securityVersion).toBe(user.securityVersion + 1);
    const token = await f.app.get(SessionService).create(user.id, f.prisma);
    const same = await put(user.id, false, first.body.securityVersion).expect(200);
    expect(same.body.securityVersion).toBe(first.body.securityVersion);
    expect(await f.app.get(SessionService).resolve(token)).not.toBeNull();
  });

  it('rejects stale security versions without partial changes', async () => {
    const user = await f.target();
    expect((await put(user.id, true, user.securityVersion + 1).expect(409)).body.code).toBe('CONCURRENCY_CONFLICT');
    expect(await f.prisma.user.findUniqueOrThrow({ where: { id: user.id } })).toEqual(user);
    expect(await f.prisma.adminMutation.count({ where: { action: 'USER_MFA_POLICY_CHANGED', response: { path: ['value', 'userId'], equals: user.id } } })).toBe(0);
  });

  it('requires current recent authentication even for a matching receipt', async () => {
    const user = await f.target();
    const sessions = f.app.get(SessionService);
    const token = await sessions.create(f.actor.id, f.prisma, { mfaVerified: true, reauthenticated: true });
    const cookie = `qms_session=${token}; qms_csrf=${f.csrf}`;
    const key = randomUUID();
    await put(user.id, true, user.securityVersion, key, cookie).expect(200);
    await f.prisma.session.update({ where: { tokenHash: digest(token) }, data: { reauthenticatedAt: new Date(Date.now() - 301_000) } });
    expect((await put(user.id, true, user.securityVersion, key, cookie).expect(403)).body.code).toBe('AUTH_REAUTHENTICATION_REQUIRED');
  });

  it('allows an internal read-only operator to inspect but rejects writes and ordinary self governance', async () => {
    const reader = await f.target();
    await role(reader.id, ['account:users:read']);
    const token = await f.app.get(SessionService).create(reader.id, f.prisma, { reauthenticated: true });
    const cookie = `qms_session=${token}; qms_csrf=${f.csrf}`;
    await read(f.actor.id, cookie).expect(200);
    await put(reader.id, true, reader.securityVersion, randomUUID(), cookie).expect(403);
    const ordinary = await f.target();
    const ordinaryToken = await f.app.get(SessionService).create(ordinary.id, f.prisma, { reauthenticated: true });
    const ordinaryCookie = `qms_session=${ordinaryToken}; qms_csrf=${f.csrf}`;
    await read(ordinary.id, ordinaryCookie).expect(403);
    await put(ordinary.id, true, ordinary.securityVersion, randomUUID(), ordinaryCookie).expect(403);
  });

  it('rejects targets with stronger permissions and targets controlled in an unauthorized organization', async () => {
    await f.prisma.permission.upsert({ where: { code: 'configuration:manage' }, create: { code: 'configuration:manage', name: 'Configuration' }, update: {} });
    const strong = await f.target();
    await role(strong.id, ['configuration:manage']);
    await put(strong.id, false, strong.securityVersion).expect(403);
    const foreign = await f.prisma.organization.create({ data: { code: randomUUID(), name: 'Other MFA scope', type: 'INTERNAL' } });
    const target = await f.target();
    const foreignRole = await role(target.id, [], false, foreign.id);
    try {
      await put(target.id, true, target.securityVersion).expect(403);
      await read(target.id, f.cookie, `?organizationId=${foreign.id}`).expect(403);
      await put(target.id, true, target.securityVersion, randomUUID(), f.cookie, `?organizationId=${foreign.id}`).expect(403);
    } finally {
      await f.prisma.userRole.deleteMany({ where: { roleId: foreignRole.id } });
      await f.prisma.role.delete({ where: { id: foreignRole.id } });
      await f.prisma.auditEvent.deleteMany({ where: { organizationId: foreign.id } });
      await f.prisma.organization.delete({ where: { id: foreign.id } });
    }
    expect((await f.prisma.user.findUniqueOrThrow({ where: { id: target.id } })).mfaRequirementOverride).toBeNull();
  });

  it('rejects supplier operators even when their own organization grants account permissions', async () => {
    const organization = await f.prisma.organization.create({ data: { code: randomUUID(), name: 'Supplier MFA scope', type: 'SUPPLIER' } });
    const supplier = await f.prisma.user.create({ data: { organizationId: organization.id, username: randomUUID(), accountType: 'SUPPLIER', passwordHash: f.actor.passwordHash } });
    const supplierRole = await role(supplier.id, ['account:users:read', 'account:users:reset'], false, organization.id);
    try {
      const token = await f.app.get(SessionService).create(supplier.id, f.prisma, { mfaVerified: true, reauthenticated: true });
      const cookie = `qms_session=${token}; qms_csrf=${f.csrf}`;
      await read(supplier.id, cookie).expect(403);
      await put(supplier.id, false, supplier.securityVersion, randomUUID(), cookie).expect(403);
    } finally {
      await f.prisma.auditEvent.deleteMany({ where: { organizationId: organization.id } });
      await f.prisma.user.delete({ where: { id: supplier.id } });
      await f.prisma.role.delete({ where: { id: supplierRole.id } });
      await f.prisma.organization.delete({ where: { id: organization.id } });
    }
  });

  it('enforces CSRF, idempotency and strict boolean/version input validation', async () => {
    const user = await f.target();
    const url = `/api/v1/admin/users/${user.id}/mfa-policy`;
    const body = { required: true, expectedSecurityVersion: user.securityVersion };
    await request(f.app.getHttpServer()).put(url).set('Cookie', f.cookie).send(body).expect(403);
    await request(f.app.getHttpServer()).put(url).set('Cookie', f.cookie).set('x-csrf-token', f.csrf).send(body).expect(400);
    for (const invalid of [{ required: 'false', expectedSecurityVersion: 0 }, { required: null, expectedSecurityVersion: 0 }, { required: false, expectedSecurityVersion: -1 }, { required: false, expectedSecurityVersion: 0.5 }, { required: false, expectedSecurityVersion: 0, userId: user.id }]) {
      await request(f.app.getHttpServer()).put(url).set('Cookie', f.cookie).set('x-csrf-token', f.csrf).set('Idempotency-Key', randomUUID()).send(invalid).expect(400);
    }
  });

  it('rolls back policy, security version, sessions, challenges and receipt if success audit fails', async () => {
    const { user, confirmed } = await enrolled();
    const mfa = f.app.get(MfaService);
    const pending = await f.prisma.$transaction((tx) => mfa.createChallenge(user, tx));
    await f.prisma.$executeRawUnsafe("CREATE FUNCTION test_admin_mfa_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action = 'USER_MFA_POLICY_CHANGED' THEN RAISE EXCEPTION 'test policy audit rejected'; END IF; RETURN NEW; END $$");
    await f.prisma.$executeRawUnsafe('CREATE TRIGGER test_admin_mfa_audit_failure BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION test_admin_mfa_audit_failure()');
    const key = randomUUID();
    try { await put(user.id, false, user.securityVersion, key).expect(500); }
    finally {
      await f.prisma.$executeRawUnsafe('DROP TRIGGER test_admin_mfa_audit_failure ON audit_events');
      await f.prisma.$executeRawUnsafe('DROP FUNCTION test_admin_mfa_audit_failure()');
    }
    expect(await f.prisma.user.findUniqueOrThrow({ where: { id: user.id } })).toEqual(user);
    expect((await f.prisma.mfaChallenge.findUniqueOrThrow({ where: { tokenHash: digest(pending!.token) } })).consumedAt).toBeNull();
    expect(await f.app.get(SessionService).resolve(confirmed.sessionToken)).not.toBeNull();
    expect(await f.prisma.adminMutation.count({ where: { actorUserId: f.actor.id, key } })).toBe(0);
    await put(user.id, false, user.securityVersion, key).expect(200);
  });

  it('lets administrators change their own policy, revokes their session, and preserves administrator seven-day lifetime', async () => {
    const user = await f.target();
    await role(user.id, ['account:users:create', 'account:users:read', 'account:users:reset'], true);
    const token = await f.app.get(SessionService).create(user.id, f.prisma, { mfaVerified: true, reauthenticated: true });
    const cookie = `qms_session=${token}; qms_csrf=${f.csrf}`;
    const response = await put(user.id, false, user.securityVersion, randomUUID(), cookie).expect(200);
    expect(response.body.selfSessionRevoked).toBe(true);
    expect(response.headers['set-cookie']).toEqual(expect.arrayContaining([expect.stringContaining('qms_session=;')]));
    expect(await f.app.get(SessionService).resolve(token)).toBeNull();
    expect(await f.prisma.$transaction((tx) => mfaPolicy(tx, user.id))).toMatchObject({ administrator: true, required: false });
    const login = await f.post('/auth/login', { identifier: user.username, password: f.password, rememberMe: true }).expect(200);
    expect(login.body.securityState).toBe('AUTHENTICATED');
    const remembered = await f.prisma.session.findFirstOrThrow({ where: { userId: user.id, revokedAt: null } });
    expect(remembered.lifetimeType).toBe('REMEMBERED_ADMIN');
    expect(remembered.expiresAt.getTime() - Date.now()).toBeGreaterThan(7 * 86_400_000 - 10_000);
    expect(remembered.expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(7 * 86_400_000);
  });
});
