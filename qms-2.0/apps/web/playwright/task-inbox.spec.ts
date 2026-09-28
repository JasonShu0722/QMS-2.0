import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import type { components } from '@qms/contracts';
import { completeMfa } from './mfa-login';
import { fillSecret } from './secret-input';

if (!process.env.QMS_ACCEPTANCE_BASE_URL || !process.env.DATABASE_URL) throw new Error('Real gateway and disposable PostgreSQL are required');
const password = `${randomUUID()}Aa8!`;
function fixture(action: string, identifier?: string) {
  const result = spawnSync(process.execPath, ['test/fixtures/task-inbox-browser.mjs', action, ...(identifier ? [identifier] : [])], {
    cwd: resolve(process.cwd(), '../api'), env: { ...process.env, QMS_ACCEPTANCE_DISPOSABLE_DATABASE: 'true', QMS_INBOX_FIXTURE_PASSWORD: password }, encoding: 'utf8', timeout: 30000, windowsHide: true,
  });
  if (result.status !== 0) throw new Error(`Inbox fixture ${action} failed: ${result.stderr}`);
  return result.stdout;
}
async function login(page: Page, username: string) {
  await page.goto('/login');
  await page.getByLabel('账号', { exact: true }).fill(username);
  await fillSecret(page.getByLabel('密码', { exact: true }), password);
  const response = page.waitForResponse((entry) => entry.url().endsWith('/auth/login'));
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await completeMfa(page.request, await response, username, page);
  await expect(page).toHaveURL(/\/app\/workbench$/);
  await page.goto('/app/my-tasks');
}

test('real task claims, conflict refresh, release, eligibility loss and notification reading', async ({ page, browser }) => {
  test.setTimeout(120000);
  const data = JSON.parse(fixture('setup')) as { organizationId: string; users: { id: string; username: string }[]; taskId: string; reportNumber: string };
  const peerContext = await browser.newContext({ baseURL: process.env.QMS_ACCEPTANCE_BASE_URL });
  const peer = await peerContext.newPage();
  try {
    await login(page, data.users[0]!.username);
    await login(peer, data.users[1]!.username);
    await expect(page.getByText(data.reportNumber, { exact: true })).toBeVisible();
    await expect(peer.getByRole('button', { name: '领取', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '领取', exact: true }).click();
    await expect(page.getByRole('button', { name: '释放', exact: true })).toBeVisible();
    const conflict = peer.waitForResponse((response) => response.url().endsWith('/claim'));
    await peer.getByRole('button', { name: '领取', exact: true }).click();
    expect((await conflict).status()).toBe(409);
    await expect(peer.getByText('已由其他人领取', { exact: true })).toBeVisible();
    await expect(peer.getByRole('button', { name: '释放', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: '释放', exact: true }).click();
    await expect(page.getByRole('button', { name: '领取', exact: true })).toBeVisible();
    await peer.getByRole('tabpanel', { name: '我的待办' }).getByRole('button', { name: /^刷\s*新$/ }).click();
    await peer.getByRole('button', { name: '领取', exact: true }).click();
    await expect(peer.getByRole('button', { name: '释放', exact: true })).toBeVisible();
    fixture('revoke', data.users[1]!.id);
    expect((await peer.request.get('/api/v1/tasks')).status()).toBe(403);
    await page.getByRole('tabpanel', { name: '我的待办' }).getByRole('button', { name: /^刷\s*新$/ }).click();
    await page.getByRole('button', { name: '重新领取', exact: true }).click();
    await expect(page.getByRole('button', { name: '释放', exact: true })).toBeVisible();
    const tasks = await (await page.request.get('/api/v1/tasks')).json() as components['schemas']['TaskPageDto'];
    expect(tasks.items[0]).toMatchObject({ id: data.taskId, version: 5, claimedByUserId: data.users[0]!.id });
    await page.getByRole('tab', { name: '我的通知', exact: true }).click();
    await page.getByRole('button', { name: '标为已读', exact: true }).click();
    await expect(page.getByText('已读', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Language / 语言' }).click();
    await page.getByRole('menuitemradio', { name: 'English' }).click();
    await expect(page.getByRole('tab', { name: 'My notifications', exact: true })).toBeVisible();
    await page.reload();
    await page.getByRole('tab', { name: 'My notifications', exact: true }).click();
    await expect(page.getByText('Read', { exact: true })).toBeVisible();
  } finally {
    await peerContext.close();
    fixture('cleanup', data.organizationId);
  }
});
