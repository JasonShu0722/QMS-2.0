import request from 'supertest';
import { accountDeliveryFixture, type AccountDeliveryFixture } from './account-delivery-fixture.js';

describe('required password change PostgreSQL boundary', () => {
  let f: AccountDeliveryFixture;
  beforeAll(async () => { f = await accountDeliveryFixture(); });
  afterAll(async () => { await f?.close(); });

  it('issues a restricted challenge and rejects session, business, export, attachment and MFA access', async () => {
    const target = await f.target();
    const reset = await f.reset(target.id).expect(201);
    const login = await f.login(target.username, reset.body.temporaryPassword).expect(200);
    expect(login.body).toMatchObject({ securityState: 'PASSWORD_CHANGE_REQUIRED', landingPath: '/change-password' });
    expect(await f.prisma.session.count({ where: { userId: target.id } })).toBe(0);
    const cookie = f.challengeCookie(login);
    await request(f.app.getHttpServer()).get('/api/v1/auth/password-change').set('Cookie', cookie).expect(200);
    await f.post('/auth/password-change/complete', { newPassword: reset.body.temporaryPassword }, undefined, cookie).expect(400);
    for (const path of ['/auth/session', '/me/profile', '/admin/users', '/audit-events', '/files', '/me/security']) {
      await request(f.app.getHttpServer()).get(`/api/v1${path}`).set('Cookie', cookie).expect((response) => expect(response.status).toBeGreaterThanOrEqual(400));
    }
    await f.post('/me/security/mfa/verify', { code: '123456' }, undefined, cookie).expect((response) => expect(response.status).toBeGreaterThanOrEqual(400));
    const changed = await f.post('/auth/password-change/complete', { newPassword: 'my-permanent-new-password' }, undefined, cookie).expect(200);
    expect(changed.body.securityState).toBe('AUTHENTICATED');
    await f.post('/auth/password-change/complete', { newPassword: 'replayed-new-password' }, undefined, cookie).expect(401);
    await f.login(target.username, reset.body.temporaryPassword).expect(401);
    await f.login(target.username, 'my-permanent-new-password').expect(200);
    expect((await f.read(target.id).expect(201)).body).not.toHaveProperty('temporaryPassword');
    expect(await f.prisma.userTemporaryPassword.count({ where: { userId: target.id } })).toBe(0);
    expect((await f.prisma.user.findUniqueOrThrow({ where: { id: target.id } })).passwordHash).not.toContain('my-permanent-new-password');
  });

  it('cancels password challenges on logout and refuses expired temporary passwords mid-challenge', async () => {
    const target = await f.target();
    const reset = await f.reset(target.id).expect(201);
    const first = await f.login(target.username, reset.body.temporaryPassword).expect(200);
    const cookie = f.challengeCookie(first);
    await f.post('/auth/logout', {}, undefined, cookie).expect(204);
    await f.post('/auth/password-change/complete', { newPassword: 'new-permanent-password' }, undefined, cookie).expect(401);
    const second = await f.login(target.username, reset.body.temporaryPassword).expect(200);
    await f.prisma.$executeRaw`UPDATE user_temporary_passwords SET expires_at = NOW() - INTERVAL '1 second' WHERE user_id = ${target.id}::uuid`;
    await f.post('/auth/password-change/complete', { newPassword: 'new-permanent-password' }, undefined, f.challengeCookie(second)).expect(401);
  });

  it('rejects expired challenges and a challenge invalidated by a newer administrator reset', async () => {
    const target = await f.target();
    const reset = await f.reset(target.id).expect(201);
    const first = await f.login(target.username, reset.body.temporaryPassword).expect(200);
    await f.reset(target.id).expect(201);
    await f.post('/auth/password-change/complete', { newPassword: 'valid-permanent-password' }, undefined, f.challengeCookie(first)).expect(401);
    const current = await f.read(target.id).expect(201);
    const second = await f.login(target.username, current.body.temporaryPassword).expect(200);
    await f.prisma.$executeRaw`UPDATE password_change_challenges SET expires_at = NOW() - INTERVAL '1 second' WHERE user_id = ${target.id}::uuid`;
    await f.post('/auth/password-change/complete', { newPassword: 'valid-permanent-password' }, undefined, f.challengeCookie(second)).expect(401);
  });

  it('rejects disabled accounts and enforces MFA only after successful first password change', async () => {
    const target = await f.target();
    const role = await f.prisma.role.create({ data: { organizationId: f.organization.id, code: `MFA-${target.id}`, name: 'MFA required', mfaRequired: true } });
    await f.prisma.userRole.create({ data: { userId: target.id, roleId: role.id, organizationId: f.organization.id } });
    const reset = await f.reset(target.id).expect(201);
    const login = await f.login(target.username, reset.body.temporaryPassword).expect(200);
    expect(login.body.securityState).toBe('PASSWORD_CHANGE_REQUIRED');
    const cookie = f.challengeCookie(login);
    await f.prisma.user.update({ where: { id: target.id }, data: { status: 'DISABLED' } });
    await f.post('/auth/password-change/complete', { newPassword: 'my-permanent-password' }, undefined, cookie).expect(401);
    await f.prisma.user.update({ where: { id: target.id }, data: { status: 'ACTIVE' } });
    const changed = await f.post('/auth/password-change/complete', { newPassword: 'my-permanent-password' }, undefined, cookie).expect(200);
    expect(changed.body).toMatchObject({ securityState: 'MFA_ENROLLMENT_REQUIRED', landingPath: '/mfa' });
    expect(await f.prisma.session.count({ where: { userId: target.id, revokedAt: null } })).toBe(0);
  });
});
