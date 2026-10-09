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
  const result = spawnSync(process.execPath, ['test/fixtures/workflow-designer-browser.mjs', action, ...(identifier ? [identifier] : [])], {
    cwd: resolve(process.cwd(), '../api'), env: { ...process.env, QMS_ACCEPTANCE_DISPOSABLE_DATABASE: 'true', QMS_DESIGNER_FIXTURE_PASSWORD: password }, encoding: 'utf8', timeout: 30000, windowsHide: true,
  });
  if (result.status !== 0) throw new Error(`Designer fixture ${action} failed: ${result.stderr}`);
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
}
async function save(page: Page, expected = 200) {
  const pending = page.waitForResponse((entry) => entry.url().endsWith('/draft') && entry.request().method() === 'PATCH');
  await page.getByRole('button', { name: '保存草稿', exact: true }).click();
  const response = await pending;
  expect(response.status()).toBe(expected);
  return response;
}

test('design, validate, publish, copy and preserve conflicts using real restricted workflow permissions', async ({ page, browser }) => {
  test.setTimeout(120000);
  page.setDefaultTimeout(15000);
  const data = JSON.parse(fixture('setup')) as { organizationId: string; users: { username: string }[] };
  const peerContext = await browser.newContext({ baseURL: process.env.QMS_ACCEPTANCE_BASE_URL });
  const restrictedContext = await browser.newContext({ baseURL: process.env.QMS_ACCEPTANCE_BASE_URL });
  const peer = await peerContext.newPage();
  const restricted = await restrictedContext.newPage();
  peer.setDefaultTimeout(15000);
  restricted.setDefaultTimeout(15000);
  try {
    await login(page, data.users[0]!.username);
    await expect(page.getByRole('navigation', { name: '内部领域导航', exact: true }).getByRole('link', { name: '系统服务', exact: true })).toBeVisible();
    await page.getByRole('navigation', { name: '内部领域导航', exact: true }).getByRole('link', { name: '系统服务', exact: true }).click();
    const services = page.getByRole('navigation', { name: '系统服务 上下文菜单', exact: true });
    await expect(services.getByRole('link', { name: '平台管理', exact: true })).toHaveCount(0);
    await services.getByRole('link', { name: '流程设计', exact: true }).click();
    await page.getByRole('button', { name: '新建流程', exact: true }).click();
    await page.getByLabel('流程代码', { exact: true }).fill(`FLOW_${randomUUID()}`);
    await page.getByLabel('流程名称', { exact: true }).fill('浏览器受控流程');
    const created = page.waitForResponse((entry) => entry.url().endsWith('/api/v1/workflows') && entry.request().method() === 'POST');
    await page.getByRole('button', { name: '创建草稿', exact: true }).click();
    const creation = await created;
    expect(creation.status()).toBe(201);
    const original = await creation.json() as components['schemas']['WorkflowDefinitionResponseDto'];
    const path = `/app/workflow-designer/${original.id}/${original.version.id}`;
    await expect(page).toHaveURL(new RegExp(`${original.version.id}$`));
    await expect(page.getByRole('navigation', { name: '流程对象层级', exact: true })).toContainText('系统服务');
    await expect(page.getByRole('navigation', { name: '流程对象层级', exact: true })).toContainText(`草稿编辑 · 版本 ${original.version.version}`);
    await expect(page.getByRole('heading', { name: original.name, exact: true })).toBeVisible();
    await expect(page.locator('.qms-topbar-location')).toContainText(original.name);
    await expect(page.getByRole('navigation', { name: '系统服务 上下文菜单', exact: true }).getByRole('link', { name: '流程设计', exact: true })).toHaveAttribute('aria-current', 'page');
    await expect(page.getByRole('navigation', { name: '系统服务 上下文菜单', exact: true }).getByText('流程编辑', { exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: '全部标签', exact: true }).click();
    await expect(page.getByRole('dialog').getByText(`${original.name} · 编辑`, { exact: true })).toBeVisible();
    await page.getByRole('dialog').getByRole('button', { name: /^(close|关闭)$/i }).click();
    await page.getByRole('button', { name: '编辑节点 处理', exact: true }).click();
    await page.getByLabel('处理范围 角色', { exact: true }).selectOption('DESIGNER');
    await page.getByLabel('处理时限（分钟）', { exact: true }).fill('120');
    await page.getByRole('button', { name: '添加提醒', exact: true }).click();
    await page.getByLabel('提前分钟 1', { exact: true }).fill('15');
    await page.getByLabel('超时通知负责人 角色', { exact: true }).selectOption('DESIGNER');
    await page.getByRole('button', { name: '添加连线', exact: true }).click();
    await page.getByRole('button', { name: '编辑节点 关闭', exact: true }).click();
    await page.getByLabel('处理范围 角色', { exact: true }).selectOption('DESIGNER');
    await save(page);
    await login(peer, data.users[1]!.username);
    await peer.goto(path);
    await peer.getByRole('button', { name: '编辑节点 处理', exact: true }).click();
    await page.getByRole('button', { name: '编辑节点 处理', exact: true }).click();
    await page.getByLabel('节点名称', { exact: true }).fill('调查确认');
    await page.getByRole('navigation', { name: '系统服务 上下文菜单', exact: true }).getByRole('link', { name: '公告', exact: true }).click();
    await expect(page.getByRole('dialog', { name: '当前草稿尚未保存，继续将放弃修改。', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '继续编辑', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`${original.version.id}$`));
    await expect(page.getByLabel('节点名称', { exact: true })).toHaveValue('调查确认');
    await save(page);
    await peer.getByLabel('节点名称', { exact: true }).fill('保留的同事草稿');
    await save(peer, 409);
    await expect(peer.getByText('流程已被修改，本地草稿仍保留，请确认后重新加载。', { exact: true })).toBeVisible();
    await expect(peer.getByLabel('节点名称', { exact: true })).toHaveValue('保留的同事草稿');
    await page.getByLabel('发布说明', { exact: true }).fill('浏览器真实发布');
    const publishing = page.waitForResponse((entry) => entry.url().endsWith('/publish'));
    await page.getByRole('button', { name: '发布流程', exact: true }).click();
    const publishedResponse = await publishing;
    expect(publishedResponse.status()).toBe(201);
    const published = await publishedResponse.json() as components['schemas']['WorkflowDefinitionResponseDto'];
    await expect(page.getByRole('navigation', { name: '流程对象层级', exact: true })).toContainText(`已发布查看 · 版本 ${published.version.version}`);
    await expect(page.getByLabel('节点名称', { exact: true })).toBeDisabled();
    await expect(page.getByRole('button', { name: '添加节点', exact: true })).toBeDisabled();
    const copying = page.waitForResponse((entry) => entry.url().endsWith('/copy'));
    await page.getByRole('button', { name: '复制为新草稿', exact: true }).click();
    const copiedResponse = await copying;
    expect(copiedResponse.status()).toBe(201);
    const copied = await copiedResponse.json() as components['schemas']['WorkflowDefinitionResponseDto'];
    await expect(page).toHaveURL(new RegExp(`${copied.version.id}$`));
    await page.getByRole('button', { name: '编辑节点 调查确认', exact: true }).click();
    await page.getByLabel('节点名称', { exact: true }).fill('第二版调查');
    await save(page);
    const old = await page.request.get(`/api/v1/workflows/${original.id}/versions/${original.version.id}`);
    expect(old.status()).toBe(200);
    expect((await old.json()).version.structureSnapshot).toEqual(published.version.structureSnapshot);
    await page.getByRole('button', { name: 'Language / 语言' }).click();
    await page.getByRole('menuitemradio', { name: 'English' }).click();
    await expect(page.getByRole('button', { name: 'Save draft', exact: true })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Workflow hierarchy', exact: true })).toContainText(`Edit draft · Version ${copied.version.version}`);
    await expect(page.locator('.qms-topbar-location')).toContainText(copied.name);
    await login(restricted, data.users[2]!.username);
    await restricted.getByRole('navigation', { name: '内部领域导航', exact: true }).getByRole('link', { name: '系统服务', exact: true }).click();
    const personalServices = restricted.getByRole('navigation', { name: '系统服务 上下文菜单', exact: true });
    await expect(personalServices.getByRole('link', { name: '个人账号', exact: true })).toBeVisible();
    await expect(personalServices.getByRole('link', { name: '流程设计', exact: true })).toHaveCount(0);
    await expect(personalServices.getByRole('link', { name: '平台管理', exact: true })).toHaveCount(0);
    expect((await restricted.request.get('/api/v1/workflows')).status()).toBe(403);
    await restricted.goto('/app/workflow-designer');
    await expect(restricted.getByText('无权执行此操作', { exact: true })).toBeVisible();
    await expect(restricted.getByRole('button', { name: '新建流程', exact: true })).toBeDisabled();
  } finally { fixture('cleanup', data.organizationId); await Promise.allSettled([peerContext.close(), restrictedContext.close()]); }
});
