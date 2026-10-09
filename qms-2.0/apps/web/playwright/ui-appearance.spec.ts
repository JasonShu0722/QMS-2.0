import { expect, test } from '@playwright/test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fillSecret } from './secret-input';
import { completeMfa } from './mfa-login';

test('shared appearance covers real internal pages and responsive navigation', async ({ page, context }) => {
  test.setTimeout(120_000);
  if (!process.env.QMS_SEED_INTERNAL_PASSWORD) throw new Error('Live UI verification requires disposable seed credentials');
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/login');
  await expect(page.getByRole('heading', { name: '账号登录' })).toBeVisible();
  const background = await page.locator('.login-container').evaluate(el => getComputedStyle(el).backgroundImage);
  expect(background).toMatch(/^url\(/);
  await page.getByLabel('账号', { exact: true }).fill('local.internal');
  await fillSecret(page.getByLabel('密码', { exact: true }), process.env.QMS_SEED_INTERNAL_PASSWORD);
  const login = page.waitForResponse(response => response.url().endsWith('/api/v1/auth/login'));
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await completeMfa(context.request, await login, 'local.internal', page);
  await expect(page.getByRole('navigation', { name: '内部领域导航', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: '知识与文件', exact: true })).toHaveCount(0);
  await expect(page.getByRole('link', { name: '体系文件', exact: true })).toHaveCount(0);
  await page.goto('/app/documents');
  await expect(page.locator('#main-content').getByRole('heading', { name: '体系文件', exact: true })).toBeVisible();
  await expect(page.locator('#main-content .empty-domain')).toBeVisible();
  await page.goto('/app/workbench');
  await expect(page.getByRole('navigation', { name: '内部领域导航', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '外观设置' })).toHaveCount(1);
  await page.screenshot({ path: join(tmpdir(), 'qms-ui-workbench-light.png') });
  await page.getByRole('button', { name: '外观设置' }).click();
  for (const mode of ['浅色', '深色']) {
    await page.getByRole('button', { name: mode, exact: true }).click();
    for (const [name, value] of [['晴空蓝', 'blue'], ['湖水青', 'teal'], ['鸢尾紫', 'purple']]) {
      await page.getByRole('button', { name, exact: true }).click();
      await expect(page.locator('html')).toHaveAttribute('data-qms-accent', value);
      await expect(page.locator('html')).toHaveAttribute('data-qms-appearance', mode === '浅色' ? 'light' : 'dark');
    }
  }
  await page.getByRole('button', { name: '晴空蓝', exact: true }).click();
  await page.getByRole('button', { name: '跟随系统', exact: true }).click();
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('html')).toHaveAttribute('data-qms-appearance', 'dark');
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(page.locator('html')).toHaveAttribute('data-qms-appearance', 'light');
  await page.getByRole('button', { name: '深色', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: /close|关闭/i }).click();
  for (const [domain, label, heading] of [['问题中心', '问题管理面板', '问题管理面板'], ['问题中心', '我的待办', '我的待办'], ['供应商质量', '供应商问题台账', '供应商问题台账'], ['供应商质量', '关键件条码校验', '关键件条码校验'], ['制程质量', '不良品台账', '不良品台账'], ['系统服务', '流程设计', '受控流程列表'], ['系统服务', '个人账号', '个人账号'], ['系统服务', '平台管理', '平台管理']]) {
    await page.getByRole('navigation', { name: /内部领域/ }).getByRole('link', { name: domain, exact: true }).click();
    await page.getByRole('navigation', { name: `${domain} 上下文菜单`, exact: true }).getByRole('link', { name: label, exact: true }).click();
    await expect(page.getByRole('navigation', { name: '内部领域图标导航', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '外观设置' })).toHaveCount(1);
    await expect(page.locator('html')).toHaveAttribute('data-qms-appearance', 'dark');
    await expect(page.locator('#main-content').getByRole('heading', { name: heading, exact: true })).toBeVisible();
    await expect(page.locator('#main-content .ant-spin-spinning')).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
  await page.screenshot({ path: join(tmpdir(), 'qms-ui-admin-dark.png') });
  await page.reload();
  await expect(page.getByRole('navigation', { name: '工作标签', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: '平台管理', exact: true })).toBeVisible();
  await expect(page.locator('#main-content .ant-spin-spinning')).toHaveCount(0);
  await expect(page.locator('html')).toHaveAttribute('data-qms-appearance', 'dark');
  for (const width of [1024, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 768 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
  await page.getByRole('button', { name: '打开导航' }).click();
  await expect(page.getByRole('dialog', { name: '业务导航' })).toBeVisible();
  await page.getByRole('dialog').getByRole('link', { name: '综合工作台', exact: true }).click();
  await expect(page.getByRole('heading', { name: '综合工作台' })).toBeVisible();
  await page.screenshot({ path: join(tmpdir(), 'qms-ui-mobile.png') });
});
