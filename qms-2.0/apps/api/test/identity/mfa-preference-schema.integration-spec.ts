import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { accountDeliveryFixture, type AccountDeliveryFixture } from './account-delivery-fixture.js';
import { digest, mfaPolicy } from '../../src/common/security/session-security.js';
import { SessionService } from '../../src/modules/identity/session.service.js';

describe('legacy personal MFA endpoints PostgreSQL boundaries', () => {
  let f: AccountDeliveryFixture;
  beforeAll(async () => { f = await accountDeliveryFixture(); });
  afterAll(async () => { await f?.close(); });

  it.each([true, false])('denies personal preference and unbinding for administrator=%s without modifying security state', async (administrator) => {
    const user = administrator ? f.actor : await f.target();
    const token = await f.app.get(SessionService).create(user.id, f.prisma, { mfaVerified: true, reauthenticated: true });
    const cookie = `qms_session=${token}; qms_csrf=${f.csrf}`;
    const before = await f.prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    for (const path of ['/me/mfa/preference', '/me/mfa/disable']) {
      const result = await f.post(path, path.endsWith('preference') ? { preference: 'DISABLED' } : {}, randomUUID(), cookie).expect(403);
      expect(result.body.code).toBe('FEATURE_PERMISSION_DENIED');
    }
    expect(await f.prisma.user.findUniqueOrThrow({ where: { id: user.id } })).toEqual(before);
    expect((await f.prisma.session.findUniqueOrThrow({ where: { tokenHash: digest(token) } })).revokedAt).toBeNull();
    expect(await f.prisma.adminMutation.count({ where: { actorUserId: user.id, action: 'MFA_PREFERENCE_CHANGED' } })).toBe(0);
    const status = await request(f.app.getHttpServer()).get('/api/v1/me/security').set('Cookie', cookie).expect(200);
    expect(status.body.canUnbindMfa).toBe(false);
  });

  it('preserves legacy administrator preference and role defaults until an account policy is explicitly configured', async () => {
    await f.prisma.user.update({ where: { id: f.actor.id }, data: { mfaPreference: 'DISABLED' } });
    expect(await f.prisma.$transaction((tx) => mfaPolicy(tx, f.actor.id))).toMatchObject({ administrator: true, required: false });
    const user = await f.target();
    const role = await f.prisma.role.create({ data: { organizationId: f.organization.id, code: randomUUID(), name: 'Required legacy role', mfaRequired: true } });
    await f.prisma.userRole.create({ data: { userId: user.id, organizationId: f.organization.id, roleId: role.id } });
    await f.prisma.user.update({ where: { id: user.id }, data: { mfaPreference: 'DISABLED' } });
    expect(await f.prisma.$transaction((tx) => mfaPolicy(tx, user.id))).toMatchObject({ administrator: false, required: true });
  });
});
