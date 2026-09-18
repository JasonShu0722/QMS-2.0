import { expect, test } from '@playwright/test';

const baseURL = process.env.QMS_ACCEPTANCE_BASE_URL ?? process.env.PLAYWRIGHT_BASE_URL;
if (!baseURL || !process.env.QMS_SEED_INTERNAL_PASSWORD || !process.env.QMS_SEED_SUPPLIER_PASSWORD) {
  throw new Error('Live acceptance requires the gateway URL and both QMS_SEED_*_PASSWORD values; skipping is forbidden.');
}

const accounts = [
  { identifier: 'local.internal', password: process.env.QMS_SEED_INTERNAL_PASSWORD,
    type: 'INTERNAL', landing: '/app/workbench', other: '/supplier/inbox', navigation: '内部领域导航' },
  { identifier: 'local.supplier', password: process.env.QMS_SEED_SUPPLIER_PASSWORD,
    type: 'SUPPLIER', landing: '/supplier/inbox', other: '/app/workbench', navigation: '供应商导航' },
] as const;
const organizationIds = new Map<string, string>();

test.beforeAll(async ({ playwright }) => {
  const client = await playwright.request.newContext({ baseURL });
  try {
    for (const account of accounts) {
      const protection = await client.get('/api/v1/auth/csrf');
      expect(protection.status()).toBe(200);
      const { csrfToken } = await protection.json();
      const response = await client.post('/api/v1/auth/login', {
        headers: { 'x-csrf-token': csrfToken }, data: { identifier: account.identifier, password: account.password },
      });
      expect(response.status()).toBe(200);
      const session = await client.get('/api/v1/auth/session');
      expect(session.status()).toBe(200);
      organizationIds.set(account.type, (await session.json()).user.organizationId);
      expect((await client.post('/api/v1/auth/logout', { headers: { 'x-csrf-token': csrfToken } })).status()).toBe(204);
    }
  } finally {
    await client.dispose();
  }
});

for (const account of accounts) {
  test(`real ${account.type} login, scope and revocation`, async ({ page, context }) => {
    await page.goto('/login');
    await expect(page.getByRole('heading', { name: 'QMS 2.0' })).toBeVisible();
    await page.getByLabel('账号', { exact: true }).fill(account.identifier);
    await page.getByLabel('密码', { exact: true }).fill(account.password!);
    const loginResponse = page.waitForResponse((response) => response.url().endsWith('/api/v1/auth/login'));
    await page.getByRole('button', { name: '登录', exact: true }).click();
    const response = await loginResponse;
    expect(response.status()).toBe(200);
    expect(await response.json()).toEqual({ accountType: account.type, landingPath: account.landing });
    await expect(page).toHaveURL(new URL(account.landing, baseURL!).href);
    await expect(page.getByRole('navigation', { name: account.navigation, exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('navigation', { name: account.navigation, exact: true })).toBeVisible();
    await page.goto(account.other);
    await expect(page).toHaveURL(new URL(account.landing, baseURL!).href);

    const cookies = await context.cookies();
    const sessionCookie = cookies.find((cookie) => cookie.name === 'qms_session');
    expect(sessionCookie).toMatchObject({ httpOnly: true, sameSite: 'Lax', path: '/' });
    if (new URL(baseURL!).protocol === 'https:') expect(sessionCookie?.secure).toBe(true);
    expect(await page.evaluate(() => document.cookie)).not.toContain('qms_session=');
    const browserStorage = await page.evaluate(() => JSON.stringify([localStorage, sessionStorage]));
    expect(browserStorage).not.toContain(sessionCookie!.value);
    expect(browserStorage).not.toMatch(/qms_session|refreshToken|accessToken/i);

    const session = await context.request.get('/api/v1/auth/session');
    expect(session.status()).toBe(200);
    const identity = (await session.json()).user;
    expect(identity.accountType).toBe(account.type);
    const own = await context.request.get('/api/v1/organizations/current');
    expect(own.status()).toBe(200);
    expect((await own.json()).organization.id).toBe(identity.organizationId);
    const otherOrganization = organizationIds.get(account.type === 'SUPPLIER' ? 'INTERNAL' : 'SUPPLIER');
    expect(otherOrganization).toBeDefined();
    expect(otherOrganization).not.toBe(identity.organizationId);
    const denied = await context.request.get(`/api/v1/organizations/current?organizationId=${otherOrganization}`);
    expect(denied.status()).toBe(403);
    expect((await denied.json()).code).toBe('ORGANIZATION_SCOPE_DENIED');

    const missingCsrf = await context.request.post('/api/v1/auth/logout');
    expect(missingCsrf.status()).toBe(403);
    expect((await missingCsrf.json()).code).toBe('CSRF_INVALID');
    const mismatchedCsrf = await context.request.post('/api/v1/auth/logout', { headers: { 'x-csrf-token': 'wrong-token' } });
    expect(mismatchedCsrf.status()).toBe(403);
    const csrfCookie = cookies.find((cookie) => cookie.name === 'qms_csrf');
    expect(csrfCookie).toBeDefined();
    const logout = await context.request.post('/api/v1/auth/logout', { headers: { 'x-csrf-token': csrfCookie!.value } });
    expect(logout.status()).toBe(204);
    const revoked = await context.request.get('/api/v1/auth/session', { headers: { Cookie: `qms_session=${sessionCookie!.value}` } });
    expect(revoked.status()).toBe(401);
    await page.goto(account.landing);
    await expect(page).toHaveURL(new URL('/login', baseURL!).href);
  });
}

test('gateway rejects forged forwarding headers as a rate-limit escape', async ({ request }) => {
  const protection = await request.get('/api/v1/auth/csrf');
  expect(protection.status()).toBe(200);
  const { csrfToken } = await protection.json();
  const identifier = `acceptance-missing-${crypto.randomUUID()}`;
  const statuses: number[] = [];
  for (let attempt = 0; attempt < 31; attempt += 1) {
    const response = await request.post('/api/v1/auth/login', {
      headers: { 'x-csrf-token': csrfToken, 'x-forwarded-for': `198.51.100.${attempt + 1}` },
      data: { identifier, password: 'deliberately-wrong' },
    });
    statuses.push(response.status());
    const body = await response.json();
    expect([401, 429]).toContain(response.status());
    expect(body.code).toBe(response.status() === 429 ? 'AUTH_RATE_LIMITED' : 'AUTH_INVALID_CREDENTIALS');
    expect(body.traceId).toEqual(expect.any(String));
    expect(body).toHaveProperty('fields');
    expect(JSON.stringify(body)).not.toMatch(/passwordHash|SELECT|stack/i);
  }
  expect(statuses).toContain(401);
  expect(statuses.at(-1)).toBe(429);
  const separate = await request.post('/api/v1/auth/login', {
    headers: { 'x-csrf-token': csrfToken },
    data: { identifier: `acceptance-other-${crypto.randomUUID()}`, password: 'deliberately-wrong' },
  });
  expect(separate.status()).toBe(401);
});
