import { expect, test, type Page } from '@playwright/test';
import { completeMfa } from './mfa-login';
import { fillSecret } from './secret-input';

const baseURL = process.env.QMS_ACCEPTANCE_BASE_URL ?? process.env.PLAYWRIGHT_BASE_URL;
if (!baseURL || !process.env.QMS_SEED_INTERNAL_PASSWORD || !process.env.QMS_SEED_SUPPLIER_PASSWORD) {
  throw new Error('Compact shell acceptance requires a disposable live gateway and both seed passwords; skipping is forbidden.');
}

async function checkRow(page: Page, width: number) {
  await page.setViewportSize({ width, height: width === 390 ? 844 : width === 1024 ? 768 : 1000 });
  const header = page.locator('.qms-topbar');
  await expect(header).toHaveCount(1);
  await expect(header).toBeVisible();
  await expect(header.getByRole('button', { name: '外观设置', exact: true })).toHaveCount(1);
  await expect(header.getByRole('button', { name: 'Language / 语言' })).toBeVisible();
  await expect(page.locator('.qms-main > .qms-work-tabs')).toHaveCount(0);
  await expect(page.locator('.qms-topbar-location')).toHaveCount(0);
  await expect(async () => {
    const bounds = await header.boundingBox();
    expect(bounds).not.toBeNull();
    if (!bounds) throw new Error('Visible compact header has no layout bounds');
    expect(bounds.height).toBeLessThanOrEqual(72);
    for (const control of await header.locator('button:visible, a:visible').all()) {
      const box = await control.boundingBox();
      expect(box).not.toBeNull();
      if (!box) throw new Error('Visible header control has no layout bounds');
      expect(box.x).toBeGreaterThanOrEqual(bounds.x - 1);
      expect(box.x + box.width).toBeLessThanOrEqual(bounds.x + bounds.width + 1);
      expect(box.y).toBeGreaterThanOrEqual(bounds.y);
      expect(box.y + box.height).toBeLessThanOrEqual(bounds.y + bounds.height);
    }
  }).toPass();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: '需求反馈', exact: true }).click({ trial: true });
  test.info().annotations.push({ type: 'layout', description: `${width}px: header at most 72px, no page overflow` });
}

for (const supplier of [false, true]) {
  test(`compact ${supplier ? 'supplier' : 'internal'} shell preserves tabs across desktop, tablet and mobile`, async ({ page, context }) => {
    test.setTimeout(120_000);
    const runtimeErrors: string[] = [];
    page.on('pageerror', error => runtimeErrors.push(error.message));
    const identifier = supplier ? 'local.supplier' : 'local.internal';
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto('/login');
    await page.getByLabel('账号', { exact: true }).fill(identifier);
    await fillSecret(page.getByLabel('密码', { exact: true }), supplier ? process.env.QMS_SEED_SUPPLIER_PASSWORD! : process.env.QMS_SEED_INTERNAL_PASSWORD!);
    const pending = page.waitForResponse(response => response.url().endsWith('/api/v1/auth/login'));
    await page.getByRole('button', { name: '登录', exact: true }).click();
    await completeMfa(context.request, await pending, identifier, page);
    await expect(page).toHaveURL(supplier ? /\/supplier\/inbox$/ : /\/app\/workbench$/);
    const header = page.locator('.qms-topbar');
    if (supplier) {
      await header.getByRole('button', { name: '全部标签' }).click();
      await page.getByRole('dialog').getByRole('button', { name: '关闭 待办', exact: true }).click();
    }
    for (const width of [1440, 1024, 390]) {
      await checkRow(page, width);
      await expect(header.getByRole('button', { name: '全部标签' })).toHaveCount(0);
      await expect(header.getByRole('link', { name: supplier ? '供应商门户' : '综合工作台', exact: true })).toBeVisible();
    }
    const prefix = supplier ? '/supplier' : '/app';
    await page.goto(`${prefix}/account`);
    await expect(page.getByRole('heading', { name: '个人账号', exact: true })).toBeVisible();
    for (const width of [1440, 1024, 390]) {
      await checkRow(page, width);
      await header.getByRole('button', { name: '全部标签' }).click();
      const drawer = page.getByRole('dialog');
      await expect(drawer.getByRole('button', { name: supplier ? '账号' : '个人账号', exact: true })).toBeVisible();
      await drawer.getByRole('button', { name: '关闭', exact: true }).click();
    }
    await page.goto(supplier ? '/supplier/documents' : '/app/announcements');
    await page.goto(supplier ? '/supplier/performance' : '/app/my-tasks');
    await page.reload();
    for (const width of [1440, 1024, 390]) {
      await checkRow(page, width);
      await expect(header.getByRole('navigation', { name: '工作标签', exact: true })).toHaveCount(1);
      const all = header.getByRole('button', { name: '全部标签' });
      await all.focus(); await page.keyboard.press('Enter');
      const drawer = page.getByRole('dialog');
      await drawer.getByRole('textbox', { name: '查找已打开工作页' }).fill(supplier ? '账号' : '个人账号');
      await drawer.getByRole('button', { name: supplier ? '账号' : '个人账号', exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`${prefix}/account$`));
    }
    await header.getByRole('button', { name: '打开导航' }).click();
    const navigation = page.getByRole('dialog', { name: supplier ? '供应商导航' : '业务导航', exact: true });
    await expect(navigation.getByRole('link', { name: supplier ? '资料' : '个人账号', exact: true })).toBeVisible();
    if (supplier) {
      await expect(navigation.locator('a[href^="/app/"]')).toHaveCount(0);
      await expect(header.locator('a[href="/app/announcements"]')).toHaveCount(0);
    }
    await navigation.getByRole('button', { name: '关闭', exact: true }).click();
    await expect(navigation).not.toBeVisible();
    await header.getByRole('button', { name: '外观设置' }).click();
    for (const mode of ['浅色', '深色']) {
      await page.getByRole('button', { name: mode, exact: true }).click();
      for (const accent of ['晴空蓝', '湖水青', '鸢尾紫']) {
        await page.getByRole('button', { name: accent, exact: true }).click();
        await page.getByRole('dialog').getByRole('button', { name: '关闭', exact: true }).click();
        await checkRow(page, 390);
        await header.getByRole('button', { name: '外观设置' }).click();
      }
    }
    await page.getByRole('dialog').getByRole('button', { name: '关闭', exact: true }).click();
    await header.getByRole('button', { name: 'Language / 语言' }).click();
    await page.getByRole('menuitemradio', { name: 'English', exact: true }).click();
    await expect(header.getByRole('button', { name: 'Appearance settings', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Requirement feedback', exact: true })).toBeVisible();
    await header.getByRole('button', { name: 'Language / 语言' }).click();
    await page.getByRole('menuitemradio', { name: '简体中文', exact: true }).click();
    if (!supplier) {
      await page.goto('/app/problem-workspace/00000000-0000-4000-8000-000000000001');
      await page.getByRole('button', { name: '专注处理', exact: true }).click();
      await expect(page.locator('.problem-workspace.is-focused')).toBeVisible();
      await checkRow(page, 390);
      await page.getByRole('button', { name: '退出专注', exact: true }).click();
      await checkRow(page, 390);
      await page.setViewportSize({ width: 1440, height: 1000 });
      await page.goto('/app/workflow-designer');
      await page.getByRole('button', { name: '新建流程', exact: true }).click();
      const name = `compact-shell-${Date.now()}`;
      await page.getByLabel('流程代码', { exact: true }).fill(name);
      await page.getByLabel('流程名称', { exact: true }).fill(name);
      await page.getByRole('button', { name: '创建草稿', exact: true }).click();
      await page.getByLabel('流程说明', { exact: true }).fill('unsaved shell acceptance');
      await page.setViewportSize({ width: 390, height: 844 });
      await header.getByRole('button', { name: '全部标签' }).click();
      await page.getByRole('dialog').getByRole('button', { name: `关闭 ${name} · 编辑`, exact: true }).click();
      await page.getByRole('button', { name: '继续编辑', exact: true }).click();
      await expect(page.getByLabel('流程说明', { exact: true })).toHaveValue('unsaved shell acceptance');
      await page.getByRole('dialog').getByRole('button', { name: `关闭 ${name} · 编辑`, exact: true }).click();
      await page.getByRole('button', { name: '放弃修改并关闭', exact: true }).click();
      await expect(page).toHaveURL(/\/app\/workflow-designer$/);
    }
    expect(runtimeErrors).toEqual([]);
  });
}
