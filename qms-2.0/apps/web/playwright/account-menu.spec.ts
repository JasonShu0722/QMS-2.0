import { expect, test } from '@playwright/test';
import { completeMfa } from './mfa-login';
import { fillSecret } from './secret-input';

const baseURL = process.env.QMS_ACCEPTANCE_BASE_URL ?? process.env.PLAYWRIGHT_BASE_URL;
if (!baseURL || !process.env.QMS_SEED_INTERNAL_PASSWORD || !process.env.QMS_SEED_SUPPLIER_PASSWORD) {
  throw new Error('Account menu acceptance requires a disposable live gateway and both seed passwords; skipping is forbidden.');
}

for (const supplier of [false, true]) {
  test(`${supplier ? 'supplier' : 'internal'} account menu keeps portal links, confirms logout and revokes session`, async ({ page, context }) => {
    test.setTimeout(120_000);
    const identifier = supplier ? 'local.supplier' : 'local.internal';
    const prefix = supplier ? '/supplier' : '/app';
    await page.goto('/login');
    await page.getByLabel('账号', { exact: true }).fill(identifier);
    await fillSecret(page.getByLabel('密码', { exact: true }), supplier ? process.env.QMS_SEED_SUPPLIER_PASSWORD! : process.env.QMS_SEED_INTERNAL_PASSWORD!);
    const login = page.waitForResponse(response => response.url().endsWith('/api/v1/auth/login'));
    await page.getByRole('button', { name: '登录', exact: true }).click();
    await completeMfa(context.request, await login, identifier, page);
    await expect(page).toHaveURL(supplier ? /\/supplier\/inbox$/ : /\/app\/workbench$/);
    const trigger = page.getByRole('button', { name: `个人菜单 · ${identifier}`, exact: true });
    await trigger.focus(); await page.keyboard.press('Enter');
    await expect(page.getByRole('menu')).toBeVisible();
    await page.keyboard.press('Escape'); await expect(trigger).toBeFocused();
    await trigger.click(); await page.getByRole('menuitem', { name: '个人设置', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`${prefix}/account$`));
    await expect(page.getByRole('heading', { name: '个人账号', exact: true })).toBeVisible();
    await trigger.click(); await page.getByRole('menuitem', { name: '修改密码', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`${prefix}/account#password$`));
    await expect(page.locator('#password')).toBeFocused();
    for (const width of [1440, 1024, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await expect(trigger).toBeVisible();
      await trigger.click(); await expect(page.getByRole('menuitem', { name: '退出登录', exact: true })).toBeVisible();
      await page.keyboard.press('Escape');
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
    let logoutRequests = 0;
    page.on('request', request => { if (new URL(request.url()).pathname === '/api/v1/auth/logout' && request.method() === 'POST') logoutRequests++; });
    await trigger.click(); await page.getByRole('menuitem', { name: '退出登录', exact: true }).click();
    const confirmation = page.getByRole('dialog', { name: '确认退出登录？', exact: true });
    await confirmation.getByRole('button', { name: /取.?消/ }).click();
    await expect(confirmation).not.toBeVisible(); await expect(trigger).toBeFocused();
    expect(logoutRequests).toBe(0);
    await trigger.click(); await page.getByRole('menuitem', { name: '退出登录', exact: true }).click();
    const logout = page.waitForResponse(response => response.url().endsWith('/api/v1/auth/logout'));
    await confirmation.getByRole('button', { name: '退出登录', exact: true }).click();
    expect((await logout).ok()).toBe(true);
    await expect(page).toHaveURL(/\/login$/);
    expect(logoutRequests).toBe(1);
    expect(await page.evaluate(() => sessionStorage.getItem('qms:work-pages:v1'))).toBeNull();
    await page.goBack();
    expect((await context.request.get(`${baseURL}/api/v1/me`)).status()).toBe(401);
    await page.goto(`${prefix}/account`);
    await expect(page).toHaveURL(/\/login$/);
  });
}
