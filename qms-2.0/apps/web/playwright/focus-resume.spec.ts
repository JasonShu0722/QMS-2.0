import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { test, expect, type Page } from '@playwright/test';
import { completeMfa } from './mfa-login';
import { fillSecret } from './secret-input';

const baseURL = process.env.QMS_ACCEPTANCE_BASE_URL;
const databaseURL = process.env.DATABASE_URL;
const password = process.env.QMS_SEED_INTERNAL_PASSWORD;
if (!baseURL || !databaseURL || !password || process.env.QMS_DISPOSABLE_TEST_DB !== 'true' || process.env.QMS_ACCEPTANCE_DISPOSABLE_DATABASE !== 'true') throw new Error('Disposable real session acceptance prerequisites required');
for (const value of [baseURL, databaseURL]) { const url = new URL(value); if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.port === '55440' || url.search || url.hash) throw new Error('Loopback disposable targets required'); }
const requireApi = createRequire(new URL('../../api/package.json', import.meta.url));
const { PrismaPg } = requireApi('@prisma/adapter-pg');
const { PrismaClient } = await import('../../api/dist/generated/prisma/client.js');
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseURL }) });
let roleId: string, addedMarkerId: string | undefined;
test.setTimeout(120_000);
test.use({ trace: 'off', screenshot: 'off', video: 'off' });
test.beforeAll(async () => {
  const organization = await prisma.organization.findUniqueOrThrow({ where: { code: 'LOCAL-INTERNAL' } });
  const user = await prisma.user.findUniqueOrThrow({ where: { organizationId_username: { organizationId: organization.id, username: 'local.internal' } } });
  const assignment = await prisma.userRole.findFirstOrThrow({ where: { userId: user.id, organizationId: organization.id, role: { code: 'LOCAL_MEMBER' } } });
  roleId = assignment.roleId;
  const marker = await prisma.permission.findUniqueOrThrow({ where: { code: 'platform:admin' } });
  const identity = { roleId_permissionId: { roleId, permissionId: marker.id } };
  if (!await prisma.rolePermission.findUnique({ where: identity })) { await prisma.rolePermission.create({ data: identity.roleId_permissionId }); addedMarkerId = marker.id; }
});
test.afterAll(async () => { try { if (addedMarkerId) await prisma.rolePermission.deleteMany({ where: { roleId, permissionId: addedMarkerId } }); } finally { await prisma.$disconnect(); } });
async function login(page: Page) {
  await page.goto('/login'); await page.getByLabel('账号', { exact: true }).fill('local.internal'); await fillSecret(page.getByLabel('密码', { exact: true }), password!);
  const response = page.waitForResponse(result => new URL(result.url()).pathname === '/api/v1/auth/login' && result.request().method() === 'POST');
  const [authenticated] = await Promise.all([response, page.getByRole('button', { name: '登录', exact: true }).click()]); await completeMfa(page.request, authenticated, 'local.internal', page); await expect(page).toHaveURL(/\/app\/workbench$/);
}
async function resume(page: Page) {
  // Real requests/authentication; explicit browser events keep the trigger deterministic in headless Chromium.
  await page.evaluate(() => { window.dispatchEvent(new Event('focus')); document.dispatchEvent(new Event('visibilitychange')); });
}
test('keeps a real console draft interactive during delayed focus checks and a network retry', async ({ page }) => {
  await login(page); await page.goto('/console/api-integrations'); await page.getByRole('button', { name: '新增接收接口', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '新增接收接口', exact: true }); const input = dialog.getByLabel('接口名称', { exact: true });
  const draft = `未保存窗口草稿-${randomUUID()}`; await input.fill(draft); await input.focus();
  const state = await page.evaluate(() => ({ x: window.scrollX, y: window.scrollY, id: document.activeElement?.id }));
  let release!: () => void; const barrier = new Promise<void>(resolve => { release = resolve; });
  let sessionCalls = 0, contextCalls = 0, listCalls = 0;
  const requests = (request: { url(): string }) => { if (new URL(request.url()).pathname === '/api/v1/admin/integrations/endpoints') listCalls++; };
  page.on('request', requests);
  await page.route('**/api/v1/auth/session', async route => { sessionCalls++; const response = await route.fetch(); await barrier; await route.fulfill({ response }); });
  await page.route('**/api/v1/admin/console/context**', async route => { contextCalls++; const response = await route.fetch(); await barrier; await route.fulfill({ response }); });
  try {
    await resume(page); await expect.poll(() => sessionCalls).toBe(1); await expect.poll(() => contextCalls).toBe(1);
    await expect(page.locator('dialog.qms-session-verification[open]')).toHaveCount(0); await expect(dialog).toBeVisible(); await expect(input).toHaveValue(draft); await expect(input).toBeFocused();
    await input.press('End'); await input.press('!'); await expect(input).toHaveValue(`${draft}!`);
    await resume(page); await page.waitForTimeout(150); expect(sessionCalls).toBe(1); expect(contextCalls).toBe(1);
    const checkedSession = page.waitForResponse(result => new URL(result.url()).pathname === '/api/v1/auth/session');
    const checkedContext = page.waitForResponse(result => new URL(result.url()).pathname === '/api/v1/admin/console/context');
    release(); expect((await checkedSession).status()).toBe(200); expect((await checkedContext).status()).toBe(200);
    await expect.poll(() => page.evaluate(() => document.querySelectorAll('dialog.qms-session-verification[open]').length)).toBe(0);
    await expect(input).toHaveValue(`${draft}!`); await expect(input).toBeFocused(); expect(listCalls).toBe(0);
    expect(await page.evaluate(() => ({ x: window.scrollX, y: window.scrollY, id: document.activeElement?.id }))).toEqual(state);
  } finally { release(); await page.unroute('**/api/v1/auth/session'); await page.unroute('**/api/v1/admin/console/context**'); page.off('request', requests); }
  await page.route('**/api/v1/admin/console/context**', route => route.abort('failed'));
  await resume(page);
  await expect(page.getByRole('alert').filter({ hasText: '无法验证管理权限' })).toBeVisible(); await expect(page.locator('dialog.qms-session-verification[open]')).toHaveCount(0); await expect(input).toHaveValue(`${draft}!`);
  await page.unroute('**/api/v1/admin/console/context**');
  const retriedContext = page.waitForResponse(result => new URL(result.url()).pathname === '/api/v1/admin/console/context');
  await page.getByRole('alert').filter({ hasText: '无法验证管理权限' }).getByRole('button', { name: /重\s*试/ }).click();
  expect((await retriedContext).status()).toBe(200);
  await expect(page.getByRole('alert').filter({ hasText: '无法验证管理权限' })).toHaveCount(0); await expect(input).toHaveValue(`${draft}!`);
});
test('retains a real business portal during resume and clears it after server-side logout', async ({ page }) => {
  await login(page); await page.goto('/app/account'); await expect(page.getByRole('link', { name: '管理控制台', exact: true })).toBeVisible();
  let release!: () => void; const barrier = new Promise<void>(resolve => { release = resolve; }); let calls = 0;
  await page.route('**/api/v1/auth/session', async route => { calls++; const response = await route.fetch(); await barrier; await route.fulfill({ response }); });
  try {
    await resume(page); await expect.poll(() => calls).toBe(1); await expect(page.locator('dialog.qms-session-verification[open]')).toHaveCount(0); await expect(page.getByRole('link', { name: '管理控制台', exact: true })).toBeVisible();
  } finally {
    const checkedSession = page.waitForResponse(result => new URL(result.url()).pathname === '/api/v1/auth/session');
    release(); expect((await checkedSession).status()).toBe(200); await page.unroute('**/api/v1/auth/session');
  }
  const csrf = await page.request.get('/api/v1/auth/csrf'); expect(csrf.status()).toBe(200); const body = await csrf.json();
  const logout = await page.request.post('/api/v1/auth/logout', { headers: { 'x-csrf-token': body.csrfToken } }); expect(logout.ok()).toBe(true);
  await resume(page); await expect(page).toHaveURL(/\/login$/); await expect(page.getByRole('link', { name: '管理控制台', exact: true })).toHaveCount(0);
});
