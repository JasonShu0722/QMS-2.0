import { createHash, randomUUID } from 'node:crypto';
import request from 'supertest';
import { accountDeliveryFixture, type AccountDeliveryFixture } from './account-delivery-fixture.js';
import { SessionService } from '../../src/modules/identity/session.service.js';

describe('本人会话历史 PostgreSQL 隔离与 HTTP 契约', () => {
  let f: AccountDeliveryFixture;
  const supplierOrganizationIds: string[] = [];
  const digest = (value: string) => createHash('sha256').update(value).digest('hex');
  const history = (cookie: string, query = '') => request(f.app.getHttpServer())
    .get(`/api/v1/me/sessions/history${query}`).set('Cookie', cookie);

  beforeAll(async () => { f = await accountDeliveryFixture(); });
  afterAll(async () => {
    if (!f) return;
    await f.prisma.user.deleteMany({ where: { organizationId: { in: supplierOrganizationIds } } });
    await f.prisma.organization.deleteMany({ where: { id: { in: supplierOrganizationIds } } });
    await f.close();
  });

  async function owner(userId: string) {
    const token = await f.app.get(SessionService).create(userId, f.prisma, { mfaVerified: true, reauthenticated: true });
    const session = await f.prisma.session.findUniqueOrThrow({ where: { tokenHash: digest(token) } });
    return { userId, token, session, cookie: `qms_session=${token}; qms_csrf=${f.csrf}` };
  }

  async function historical(userId: string, values: {
    id?: string; createdAt?: Date; expiresAt?: Date; revokedAt?: Date;
    lifetimeType?: 'STANDARD' | 'REMEMBERED_ADMIN' | 'REMEMBERED_USER';
  } = {}) {
    return f.prisma.session.create({ data: {
      userId, tokenHash: digest(randomUUID()), createdAt: new Date('2020-01-01T00:00:00Z'),
      expiresAt: new Date(Date.now() + 3_600_000), ...values,
    } });
  }

  it('returns only the owner safe history with all lifetime types and revoked-before-expired status', async () => {
    const account = await owner((await f.target()).id);
    const active = await historical(account.userId, { lifetimeType: 'REMEMBERED_ADMIN' });
    const expired = await historical(account.userId, { lifetimeType: 'REMEMBERED_USER', expiresAt: new Date(Date.now() - 60_000) });
    const revoked = await historical(account.userId, { revokedAt: new Date(), expiresAt: new Date(Date.now() - 60_000) });
    const revokedUnexpired = await historical(account.userId, { revokedAt: new Date() });
    const response = await history(account.cookie).expect(200);
    expect(response.body).toMatchObject({ total: 5, page: 1, pageSize: 20 });
    expect(response.body.items).toHaveLength(5);
    expect(response.body.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: account.session.id, lifetimeType: 'STANDARD', status: 'ACTIVE', isCurrent: true }),
      expect.objectContaining({ id: active.id, lifetimeType: 'REMEMBERED_ADMIN', status: 'ACTIVE', isCurrent: false }),
      expect.objectContaining({ id: expired.id, lifetimeType: 'REMEMBERED_USER', status: 'EXPIRED', isCurrent: false }),
      expect.objectContaining({ id: revoked.id, status: 'REVOKED', isCurrent: false }),
      expect.objectContaining({ id: revokedUnexpired.id, status: 'REVOKED', isCurrent: false }),
    ]));
    for (const item of response.body.items) {
      expect(Object.keys(item).sort()).toEqual(['id', 'createdAt', 'expiresAt', 'revokedAt', 'lifetimeType', 'status', 'isCurrent'].sort());
      expect(Number.isNaN(Date.parse(item.createdAt))).toBe(false);
      expect(Number.isNaN(Date.parse(item.expiresAt))).toBe(false);
    }
    expect(JSON.stringify(response.body)).not.toMatch(/tokenHash|passwordHash|securityVersion|mfaVerifiedAt|reauthenticatedAt|userId|organizationId/);
    expect(JSON.stringify(response.body)).not.toContain(account.token);
    expect(await f.prisma.session.count({ where: { userId: account.userId } })).toBe(5);
  });

  it('orders equal timestamps by descending ID and keeps pages disjoint with the same total', async () => {
    const account = await owner((await f.target()).id);
    const ids = [randomUUID(), randomUUID(), randomUUID()].sort().reverse();
    for (const id of ids) await historical(account.userId, { id });
    const first = await history(account.cookie, '?page=1&pageSize=2').expect(200);
    const second = await history(account.cookie, '?page=2&pageSize=2').expect(200);
    const repeat = await history(account.cookie, '?page=2&pageSize=2').expect(200);
    expect(first.body).toMatchObject({ total: 4, page: 1, pageSize: 2 });
    expect(second.body).toMatchObject({ total: 4, page: 2, pageSize: 2 });
    expect([...first.body.items, ...second.body.items].map((item: { id: string }) => item.id)).toEqual([account.session.id, ...ids]);
    expect(repeat.body).toEqual(second.body);
  });

  it('bounds actual result sizes, defaults to twenty and accepts maximum page and pageSize', async () => {
    const account = await owner((await f.target()).id);
    await f.prisma.session.createMany({ data: Array.from({ length: 24 }, () => ({
      userId: account.userId, tokenHash: digest(randomUUID()), expiresAt: new Date(Date.now() + 3_600_000),
    })) });
    const defaults = await history(account.cookie).expect(200);
    expect(defaults.body).toMatchObject({ total: 25, page: 1, pageSize: 20 });
    expect(defaults.body.items).toHaveLength(20);
    expect((await history(account.cookie, '?page=2').expect(200)).body.items).toHaveLength(5);
    expect((await history(account.cookie, '?page=1&pageSize=1').expect(200)).body.items).toHaveLength(1);
    expect((await history(account.cookie, '?pageSize=100').expect(200)).body.items).toHaveLength(25);
    expect((await history(account.cookie, '?page=1000000&pageSize=100').expect(200)).body)
      .toEqual({ items: [], total: 25, page: 1_000_000, pageSize: 100 });
  });

  it.each([
    'page=0', 'page=-1', 'page=1.5', 'page=1000001', 'page=no', 'page=Infinity', 'page=', 'page=1&page=2',
    'pageSize=0', 'pageSize=-1', 'pageSize=1.5', 'pageSize=101', 'pageSize=no', 'pageSize=', 'pageSize=1&pageSize=2',
    'userId=10000000-0000-4000-8000-000000000001', 'organizationId=20000000-0000-4000-8000-000000000001',
    'accountType=SUPPLIER', 'status=ACTIVE',
  ])('rejects out of contract query %s', async (query) => {
    await history(f.cookie, `?${query}`).expect(400);
  });

  it('isolates other users in the same organization and two distinct supplier organizations', async () => {
    const accounts = [await owner((await f.target()).id), await owner((await f.target()).id)];
    for (let index = 0; index < 2; index += 1) {
      const organization = await f.prisma.organization.create({ data: {
        code: `HISTORY-${randomUUID()}`, name: 'History supplier', type: 'SUPPLIER',
      } });
      supplierOrganizationIds.push(organization.id);
      const user = await f.prisma.user.create({ data: {
        organizationId: organization.id, username: `history-${randomUUID()}`,
        passwordHash: f.actor.passwordHash, accountType: 'SUPPLIER',
      } });
      accounts.push(await owner(user.id));
    }
    for (const account of accounts) {
      const response = await history(account.cookie).expect(200);
      expect(response.body.total).toBe(1);
      expect(response.body.items.map((item: { id: string }) => item.id)).toEqual([account.session.id]);
      const other = accounts.find((candidate) => candidate.userId !== account.userId)!;
      await history(account.cookie, `?userId=${other.userId}`).expect(400);
      await history(account.cookie, `?organizationId=${f.organization.id}`).expect(400);
    }
  });

  it('rejects unauthenticated, invalid, revoked and expired full-session credentials', async () => {
    await request(f.app.getHttpServer()).get('/api/v1/me/sessions/history').expect(401);
    await history('qms_session=invalid').expect(401);
    const account = await owner((await f.target()).id);
    await f.prisma.session.update({ where: { id: account.session.id }, data: { revokedAt: new Date() } });
    await history(account.cookie).expect(401);
    const expired = await owner(account.userId);
    await f.prisma.session.update({ where: { id: expired.session.id }, data: { expiresAt: new Date(Date.now() - 60_000) } });
    await history(expired.cookie).expect(401);
  });

  it('rejects genuine MFA and first-password-change challenges including misuse as a session', async () => {
    const mfa = await f.login(f.actor.username, f.password).expect(200);
    expect(mfa.body.securityState).toBe('MFA_ENROLLMENT_REQUIRED');
    const mfaCookie = (mfa.headers['set-cookie'] as unknown as string[])
      .find((value) => value.startsWith('qms_mfa_challenge='))!.split(';')[0]!;
    await history(mfaCookie).expect(401);
    await history(`qms_session=${mfaCookie.slice('qms_mfa_challenge='.length)}`).expect(401);
    const target = await f.target();
    const reset = await f.reset(target.id).expect(201);
    const password = await f.login(target.username, reset.body.temporaryPassword).expect(200);
    expect(password.body.securityState).toBe('PASSWORD_CHANGE_REQUIRED');
    await history(f.challengeCookie(password)).expect(401);
    const passwordCookie = (password.headers['set-cookie'] as unknown as string[])
      .find((value) => value.startsWith('qms_password_change='))!.split(';')[0]!;
    await history(`qms_session=${passwordCookie.slice('qms_password_change='.length)}`).expect(401);
  });

  it('keeps the active list and revocation semantics while retaining revoked history', async () => {
    const account = await owner((await f.target()).id);
    const other = await historical(account.userId);
    await historical(account.userId, { expiresAt: new Date(Date.now() - 60_000) });
    await historical(account.userId, { revokedAt: new Date() });
    const list = () => request(f.app.getHttpServer()).get('/api/v1/me/sessions').set('Cookie', account.cookie);
    const before = await list().expect(200);
    expect(before.body.map((item: { id: string }) => item.id).sort()).toEqual([account.session.id, other.id].sort());
    expect(before.body.find((item: { id: string }) => item.id === account.session.id).isCurrent).toBe(true);
    await f.post(`/me/sessions/${account.session.id}/revoke`, {}, undefined, account.cookie).expect(409);
    const foreign = await historical((await f.target()).id);
    await f.post(`/me/sessions/${foreign.id}/revoke`, {}, undefined, account.cookie).expect(404);
    await request(f.app.getHttpServer()).post(`/api/v1/me/sessions/${other.id}/revoke`).set('Cookie', account.cookie).expect(403);
    await f.post(`/me/sessions/${other.id}/revoke`, {}, undefined, account.cookie).expect(201);
    const after = await list().expect(200);
    expect(after.body.map((item: { id: string }) => item.id)).toEqual([account.session.id]);
    const retained = await history(account.cookie).expect(200);
    expect(retained.body.total).toBe(4);
    expect(retained.body.items).toContainEqual(expect.objectContaining({ id: other.id, status: 'REVOKED', isCurrent: false }));
    expect(await f.prisma.session.count({ where: { userId: account.userId } })).toBe(4);
    expect((await f.prisma.session.findUniqueOrThrow({ where: { id: foreign.id } })).revokedAt).toBeNull();
  });
});
