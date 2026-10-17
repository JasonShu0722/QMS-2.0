import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { TOTP } from 'otpauth';
import { accountDeliveryFixture, type AccountDeliveryFixture } from './account-delivery-fixture.js';
import { digest } from '../../src/common/security/session-security.js';
import { SessionService } from '../../src/modules/identity/session.service.js';

describe('remember login PostgreSQL boundaries', () => {
  let f: AccountDeliveryFixture;
  beforeAll(async () => { f = await accountDeliveryFixture(); });
  afterAll(async () => { await f?.close(); });

  function cookie(response: { headers: Record<string, unknown> }, name = 'qms_session') {
    const value = (response.headers['set-cookie'] as string[]).filter((entry) => entry.startsWith(`${name}=`)).at(-1);
    if (!value) throw new Error(`Missing ${name}`);
    return `${value.split(';')[0]}; qms_csrf=${f.csrf}`;
  }

  async function session(response: { headers: Record<string, unknown> }, hours: number, lifetimeType: string) {
    const token = cookie(response).split(';')[0]!.slice('qms_session='.length);
    const stored = await f.prisma.session.findUniqueOrThrow({ where: { tokenHash: digest(token) } });
    const remaining = stored.expiresAt.getTime() - Date.now();
    expect(remaining).toBeGreaterThan(hours * 3_600_000 - 10_000);
    expect(remaining).toBeLessThanOrEqual(hours * 3_600_000);
    const raw = await f.prisma.$queryRaw<{ lifetime_type: string }[]>`SELECT lifetime_type::text FROM sessions WHERE id = ${stored.id}::uuid`;
    expect(raw[0]!.lifetime_type).toBe(lifetimeType);
    const header = (response.headers['set-cookie'] as string[]).filter((entry) => entry.startsWith('qms_session=')).at(-1)!;
    const maxAge = Number(header.match(/Max-Age=(\d+)/)![1]);
    expect(Math.abs(maxAge * 1000 - remaining)).toBeLessThan(2000);
    expect(header).toMatch(/HttpOnly/);
    expect(header).toMatch(/SameSite=Lax/);
    return { stored, token, cookie: cookie(response) };
  }

  const login = (username: string, password: string, rememberMe?: boolean) => f.post('/auth/login', { identifier: username, password, ...(rememberMe === undefined ? {} : { rememberMe }) });

  async function role(userId: string, governance = false) {
    const created = await f.prisma.role.create({ data: { organizationId: f.organization.id, code: randomUUID(), name: 'Remember role', mfaRequired: !governance } });
    if (governance) {
      const permission = await f.prisma.permission.findUniqueOrThrow({ where: { code: 'account:users:reset' } });
      await f.prisma.rolePermission.create({ data: { roleId: created.id, permissionId: permission.id } });
    }
    await f.prisma.userRole.create({ data: { userId, roleId: created.id, organizationId: f.organization.id } });
    return created;
  }

  it('defaults to eight hours, accepts false/true, and rejects non-booleans', async () => {
    const target = await f.target();
    await session(await login(target.username, f.password, true).expect(200), 30 * 24, 'REMEMBERED_USER');
    await session(await login(target.username, f.password).expect(200), 8, 'STANDARD');
    await session(await login(target.username, f.password, false).expect(200), 8, 'STANDARD');
    await f.post('/auth/login', { identifier: target.username, password: f.password, rememberMe: 'true' }).expect(400);
  });

  it('returns server landing/security state, never slides, rejects expiry, disabling and reset', async () => {
    const target = await f.target();
    const result = await session(await login(target.username, f.password, true).expect(200), 30 * 24, 'REMEMBERED_USER');
    const current = () => request(f.app.getHttpServer()).get('/api/v1/auth/session').set('Cookie', result.cookie);
    expect((await current().expect(200)).body).toMatchObject({ landingPath: '/app/workbench', securityState: 'AUTHENTICATED', lifetimeType: 'REMEMBERED_USER', expiresAt: result.stored.expiresAt.toISOString() });
    await current().expect(200);
    expect((await f.prisma.session.findUniqueOrThrow({ where: { id: result.stored.id } })).expiresAt).toEqual(result.stored.expiresAt);
    await f.prisma.session.update({ where: { id: result.stored.id }, data: { expiresAt: new Date(Date.now() - 1) } });
    await current().expect(401);
    const next = await session(await login(target.username, f.password, true).expect(200), 30 * 24, 'REMEMBERED_USER');
    await f.prisma.user.update({ where: { id: target.id }, data: { status: 'DISABLED' } });
    await request(f.app.getHttpServer()).get('/api/v1/auth/session').set('Cookie', next.cookie).expect(401);
    await f.prisma.user.update({ where: { id: target.id }, data: { status: 'ACTIVE' } });
    await f.reset(target.id).expect(201);
    await request(f.app.getHttpServer()).get('/api/v1/auth/session').set('Cookie', next.cookie).expect(401);
  });

  it('carries remembered administrator intention through password change and MFA enrollment/verification', async () => {
    const target = await f.target();
    const reset = await f.reset(target.id).expect(201);
    const initial = await login(target.username, reset.body.temporaryPassword, true).expect(200);
    expect(initial.body.securityState).toBe('PASSWORD_CHANGE_REQUIRED');
    const passwordChallenge = await f.prisma.passwordChangeChallenge.findFirstOrThrow({ where: { userId: target.id, consumedAt: null } });
    expect(passwordChallenge.expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(300_000);
    await role(target.id, true);
    const changed = await f.post('/auth/password-change/complete', { newPassword: 'remember-permanent-password' }, undefined, cookie(initial, 'qms_password_change')).expect(200);
    expect(changed.body.securityState).toBe('MFA_ENROLLMENT_REQUIRED');
    expect(await f.prisma.session.count({ where: { userId: target.id } })).toBe(0);
    const challengeCookie = cookie(changed, 'qms_mfa_challenge');
    const challenge = await f.prisma.mfaChallenge.findFirstOrThrow({ where: { userId: target.id, consumedAt: null } });
    expect(challenge.expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(300_000);
    const enrollment = await f.post('/me/mfa/enrollment', {}, undefined, challengeCookie).expect(200);
    const confirmed = await f.post('/me/mfa/enrollment/confirm', { code: new TOTP({ secret: enrollment.body.secret }).generate() }, undefined, challengeCookie).expect(200);
    await session(confirmed, 7 * 24, 'REMEMBERED_ADMIN');
    const again = await login(target.username, 'remember-permanent-password', true).expect(200);
    expect(again.body.securityState).toBe('MFA_REQUIRED');
    const verified = await f.post('/auth/mfa/verify', { code: confirmed.body.recoveryCodes[0] }, undefined, cookie(again, 'qms_mfa_challenge')).expect(200);
    await session(verified, 7 * 24, 'REMEMBERED_ADMIN');
  });

  it('does not confuse a role MFA requirement with governance administrator status', async () => {
    const target = await f.target();
    await role(target.id);
    const initial = await login(target.username, f.password, true).expect(200);
    const challengeCookie = cookie(initial, 'qms_mfa_challenge');
    const enrollment = await f.post('/me/mfa/enrollment', {}, undefined, challengeCookie).expect(200);
    await session(await f.post('/me/mfa/enrollment/confirm', { code: new TOTP({ secret: enrollment.body.secret }).generate() }, undefined, challengeCookie).expect(200), 30 * 24, 'REMEMBERED_USER');
  });

  it.each([false, true])('preserves remember=%s on password-change completion without MFA', async (rememberMe) => {
    const target = await f.target();
    const reset = await f.reset(target.id).expect(201);
    const initial = await login(target.username, reset.body.temporaryPassword, rememberMe).expect(200);
    const complete = await f.post('/auth/password-change/complete', { newPassword: 'permanent-no-factor-password' }, undefined, cookie(initial, 'qms_password_change')).expect(200);
    expect(complete.body.securityState).toBe('AUTHENTICATED');
    await session(complete, rememberMe ? 30 * 24 : 8, rememberMe ? 'REMEMBERED_USER' : 'STANDARD');
  });

  it('routes supplier sessions from current server identity', async () => {
    const target = await f.prisma.user.create({ data: { organizationId: f.organization.id, username: randomUUID(), accountType: 'SUPPLIER', passwordHash: f.actor.passwordHash } });
    const result = await session(await login(target.username, f.password, true).expect(200), 30 * 24, 'REMEMBERED_USER');
    expect((await request(f.app.getHttpServer()).get('/api/v1/auth/session').set('Cookie', result.cookie).expect(200)).body).toMatchObject({ landingPath: '/supplier/inbox', securityState: 'AUTHENTICATED' });
  });

  it('does not extend a remembered authenticated session during enrollment rotation', async () => {
    const target = await f.target();
    const result = await session(await login(target.username, f.password, true).expect(200), 30 * 24, 'REMEMBERED_USER');
    const expiresAt = new Date(Date.now() + 120_000);
    await f.prisma.session.update({ where: { id: result.stored.id }, data: { expiresAt } });
    const enrollment = await f.post('/me/mfa/enrollment', {}, undefined, result.cookie).expect(200);
    const confirmed = await f.post('/me/mfa/enrollment/confirm', { code: new TOTP({ secret: enrollment.body.secret }).generate() }, undefined, result.cookie).expect(200);
    const rotatedToken = cookie(confirmed).split(';')[0]!.slice('qms_session='.length);
    const rotated = await f.prisma.session.findUniqueOrThrow({ where: { tokenHash: digest(rotatedToken) } });
    expect(rotated.expiresAt).toEqual(expiresAt);
    expect((confirmed.headers['set-cookie'] as unknown as string[]).filter((entry) => entry.startsWith('qms_session=')).at(-1)).toMatch(/Max-Age=1[01]\d;/);
  });

  it('keeps the token-string fixture API and resolves administrator status across current role grants', async () => {
    const target = await f.target();
    const sessions = f.app.get(SessionService);
    const token = await sessions.create(target.id);
    expect(typeof token).toBe('string');
    const elsewhere = await f.prisma.organization.create({ data: { code: randomUUID(), name: 'Other assignment', type: 'INTERNAL' } });
    try {
      const governance = await f.prisma.role.create({ data: { organizationId: elsewhere.id, code: randomUUID(), name: 'Cross organization governance' } });
      const permission = await f.prisma.permission.findUniqueOrThrow({ where: { code: 'account:users:reset' } });
      await f.prisma.rolePermission.create({ data: { roleId: governance.id, permissionId: permission.id } });
      await f.prisma.userRole.create({ data: { userId: target.id, roleId: governance.id, organizationId: elsewhere.id } });
      const issue = () => f.prisma.$transaction((transaction) => sessions.create(target.id, transaction, { mfaVerified: true, rememberMe: true }));
      const adminToken = await issue();
      const adminSession = await f.prisma.session.findUniqueOrThrow({ where: { tokenHash: digest(adminToken) } });
      expect(adminSession.expiresAt.getTime() - Date.now()).toBeGreaterThan(7 * 24 * 3_600_000 - 5000);
      expect(adminSession.expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(7 * 24 * 3_600_000);
      await f.prisma.rolePermission.deleteMany({ where: { roleId: governance.id } });
      const regularToken = await issue();
      const regularSession = await f.prisma.session.findUniqueOrThrow({ where: { tokenHash: digest(regularToken) } });
      expect(regularSession.expiresAt.getTime() - Date.now()).toBeGreaterThan(30 * 24 * 3_600_000 - 5000);
      expect((await f.prisma.session.findUniqueOrThrow({ where: { tokenHash: digest(token) } })).expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(8 * 3_600_000);
    } finally {
      await f.prisma.organization.delete({ where: { id: elsewhere.id } });
    }
  });
});
