import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import type { components } from '@qms/contracts';
import { completeMfa } from './mfa-login';
import { fillSecret } from './secret-input';

type Schema = components['schemas'];
const baseURL = process.env.QMS_ACCEPTANCE_BASE_URL ?? process.env.PLAYWRIGHT_BASE_URL;
const databaseURL = process.env.DATABASE_URL;
const password = process.env.QMS_SEED_INTERNAL_PASSWORD;
if (!baseURL || !databaseURL || !password || !process.env.QMS_ACCEPTANCE_MFA_CACHE_FILE || !process.env.QMS_BACKUP_KEY
  || process.env.QMS_DISPOSABLE_TEST_DB !== 'true' || process.env.QMS_ACCEPTANCE_DISPOSABLE_DATABASE !== 'true') {
  throw new Error('Control containment browser acceptance requires disposable PostgreSQL, a real gateway, seed credentials and external MFA credentials.');
}
for (const [value, database] of [[baseURL, false], [databaseURL, true]] as const) {
  const url = new URL(value);
  if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.port === '55440' || url.search || url.hash
    || !(database ? ['postgres:', 'postgresql:'] : ['http:', 'https:']).includes(url.protocol)
    || (!database && (url.username || url.password || url.pathname !== '/'))) {
    throw new Error('Control containment fixtures require loopback resources outside the preserved preview database.');
  }
}

const endpointPath = '/api/v1/admin/integrations/endpoints';
const requireApi = createRequire(new URL('../../api/package.json', import.meta.url));
const { PrismaPg } = requireApi('@prisma/adapter-pg');
const { PrismaClient } = await import('../../api/dist/generated/prisma/client.js');
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseURL }) });
const addedPermissionIds: string[] = [];
let fixtureRoleId: string | undefined;
test.setTimeout(120_000);
test.use({ trace: 'off', screenshot: 'off', video: 'off', actionTimeout: 15_000, navigationTimeout: 20_000 });

test.beforeAll(async () => {
  const organization = await prisma.organization.findUniqueOrThrow({ where: { code: 'LOCAL-INTERNAL' } });
  const user = await prisma.user.findUniqueOrThrow({ where: { organizationId_username: { organizationId: organization.id, username: 'local.internal' } } });
  const assignment = await prisma.userRole.findFirstOrThrow({ where: { organizationId: organization.id, userId: user.id, role: { code: 'LOCAL_MEMBER' } } });
  fixtureRoleId = assignment.roleId;
  for (const code of ['platform:admin', 'configuration:read', 'process-quality:defects:read', 'process-quality:defects:write']) {
    const permission = await prisma.permission.findUniqueOrThrow({ where: { code } });
    const where = { roleId_permissionId: { roleId: fixtureRoleId, permissionId: permission.id } };
    if (!await prisma.rolePermission.findUnique({ where })) {
      await prisma.rolePermission.create({ data: where.roleId_permissionId });
      addedPermissionIds.push(permission.id);
    }
  }
});

test.afterAll(async () => {
  try {
    if (fixtureRoleId && addedPermissionIds.length) await prisma.rolePermission.deleteMany({ where: { roleId: fixtureRoleId, permissionId: { in: addedPermissionIds } } });
  } finally { await prisma.$disconnect(); }
});

async function login(page: Page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await loginAs(page, 'local.internal', password!);
  await page.goto('/console/api-integrations');
  await expect(page.getByRole('region', { name: 'API接口管理', exact: true })).toBeVisible();
}

async function loginAs(page: Page, username: string, loginPassword: string, expectedPath = /\/app\/workbench$/) {
  await page.goto('/login');
  await page.getByLabel('账号', { exact: true }).fill(username);
  await fillSecret(page.getByLabel('密码', { exact: true }), loginPassword);
  const response = page.waitForResponse(entry => new URL(entry.url()).pathname === '/api/v1/auth/login' && entry.request().method() === 'POST');
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await completeMfa(page.request, await response, username, page);
  await expect(page).toHaveURL(expectedPath);
}

function workflowFixture(action: string, fixturePassword: string, organizationId?: string) {
  const result = spawnSync(process.execPath, ['test/fixtures/workflow-designer-browser.mjs', action, ...(organizationId ? [organizationId] : [])], {
    cwd: resolve(process.cwd(), '../api'), env: { ...process.env, QMS_ACCEPTANCE_DISPOSABLE_DATABASE: 'true', QMS_DESIGNER_FIXTURE_PASSWORD: fixturePassword }, encoding: 'utf8', timeout: 30_000, windowsHide: true,
  });
  if (result.status !== 0) throw new Error(`Workflow fixture ${action} failed: ${result.stderr}`);
  return result.stdout;
}

async function assertControlsFit(dialog: Locator) {
  const geometry = await dialog.evaluate(element => {
    const boundary = element.getBoundingClientRect();
    return [...element.querySelectorAll<HTMLElement>('.ant-input, textarea, .ant-select, .ant-input-number')].filter(control => control.getBoundingClientRect().width > 0).map(control => {
      const rect = control.getBoundingClientRect();
      return { label: control.getAttribute('aria-label') ?? control.className, constrained: control.matches('.ant-select, .ant-input-number, textarea'), right: rect.right, boundaryRight: boundary.right, width: rect.width, maxWidth: getComputedStyle(control).maxWidth, boxSizing: getComputedStyle(control).boxSizing };
    });
  });
  expect(geometry.length).toBeGreaterThan(0);
  for (const control of geometry) {
    expect(control.right, JSON.stringify(control)).toBeLessThanOrEqual(control.boundaryRight + 1);
    if (control.constrained) expect(control.maxWidth, JSON.stringify(control)).toBe('100%');
    expect(control.boxSizing, JSON.stringify(control)).toBe('border-box');
  }
}

async function deleteEndpoint(page: Page, endpoint: Schema['IntegrationEndpointDto']) {
  const csrf = await page.request.get('/api/v1/auth/csrf');
  expect(csrf.status()).toBe(200);
  const { csrfToken } = await csrf.json() as Schema['CsrfResponseDto'];
  const response = await page.request.fetch(`${endpointPath}/${endpoint.id}`, {
    method: 'DELETE', headers: { 'x-csrf-token': csrfToken, 'Idempotency-Key': randomUUID() },
    data: { organizationId: endpoint.organizationId, expectedVersion: endpoint.version },
  });
  expect([200, 204]).toContain(response.status());
}

test('real management controls stay contained through modal, drawer and resizable table paths', async ({ page }) => {
  await login(page);
  await page.getByRole('button', { name: '管理外观', exact: true }).click();
  await page.getByRole('menuitem', { name: '深色', exact: true }).click();
  const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
  let created: Schema['IntegrationEndpointDto'] | undefined;
  try {
    for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 760 }, { width: 320, height: 760 }]) {
      await page.setViewportSize(viewport);
      if (viewport.width <= 760) {
        await page.getByRole('button', { name: '打开管理导航', exact: true }).click();
        const drawer = page.getByRole('dialog', { name: '管理导航', exact: true });
        await expect(drawer).toBeVisible();
        await expect.poll(async () => (await drawer.boundingBox())!.x).toBeGreaterThanOrEqual(0);
        await expect.poll(async () => { const box = (await drawer.boundingBox())!; return box.x + box.width; }).toBeLessThanOrEqual(viewport.width);
        await drawer.locator('.ant-drawer-close').click();
        await expect(drawer).toHaveCount(0);
      }
      await page.getByRole('button', { name: '新增接收接口', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: '新增接收接口', exact: true });
      await expect(dialog).toBeVisible();
      await dialog.getByLabel('接口编码', { exact: true }).fill(`CTRL_${suffix}`);
      await dialog.getByLabel('接口名称', { exact: true }).fill(`控件包含验收 ${'长名称'.repeat(12)}`);
      await dialog.getByLabel('来源系统编码', { exact: true }).fill(`CTRLSRC_${suffix}`);
      await dialog.getByLabel('来源系统名称', { exact: true }).fill(`来源系统 ${'名称'.repeat(12)}`);
      const description = dialog.getByLabel('用途说明', { exact: true });
      await description.fill(`长文本 ${'说明内容 '.repeat(80)}`);
      const allowedIps = dialog.getByLabel('允许来源IP / CIDR', { exact: true });
      await allowedIps.fill('10.0.0.0/8\n192.168.0.0/16');
      await assertControlsFit(dialog);
      const textareaGeometry = await description.evaluate(element => ({ resize: getComputedStyle(element).resize, width: element.getBoundingClientRect().width, maxWidth: getComputedStyle(element).maxWidth, scrollHeight: element.scrollHeight, clientHeight: element.clientHeight }));
      expect(textareaGeometry.resize).toBe('none');
      expect(textareaGeometry.maxWidth).toBe('100%');
      expect(textareaGeometry.width).toBeGreaterThan(0);
      if (viewport.width === 1440) {
        const saved = page.waitForResponse(response => new URL(response.url()).pathname === endpointPath && response.request().method() === 'POST');
        await dialog.getByRole('button', { name: /^保\s*存$/ }).click();
        const savedResponse = await saved;
        expect(savedResponse.status()).toBe(201);
        created = await savedResponse.json() as Schema['IntegrationEndpointDto'];
      } else {
        await dialog.getByRole('button', { name: /^取\s*消$/ }).click();
        await page.getByRole('dialog', { name: '当前草稿尚未保存，继续将放弃修改。', exact: true }).getByRole('button', { name: '放弃修改并关闭', exact: true }).click();
      }
      await expect(dialog).toHaveCount(0);
    }

    await page.setViewportSize({ width: 1440, height: 900 });
    const row = page.locator('tbody tr').filter({ hasText: created!.code });
    await expect(row).toBeVisible();
    const header = page.getByRole('columnheader', { name: '接收接口', exact: true });
    const before = (await header.boundingBox())!.width;
    await page.getByRole('separator', { name: '调整列宽 接收接口', exact: true }).press('ArrowRight');
    await expect.poll(async () => (await header.boundingBox())!.width).toBeGreaterThan(before + 1);
    await page.getByRole('separator', { name: '调整列宽 接收接口', exact: true }).press('ArrowLeft');
    const edit = row.getByRole('button', { name: `编辑${created!.name}`, exact: true });
    await edit.click();
    const editor = page.getByRole('dialog', { name: '编辑接收接口', exact: true });
    await expect(editor).toBeVisible();
    const status = editor.getByRole('combobox', { name: '接口状态', exact: true });
    await status.click();
    await page.locator('.ant-select-dropdown:visible .ant-select-item-option').filter({ hasText: /^启用$/ }).click();
    await assertControlsFit(editor);
    await status.click();
    await page.locator('.ant-select-dropdown:visible .ant-select-item-option').filter({ hasText: /^草稿$/ }).click();
    await editor.getByRole('button', { name: /^取\s*消$/ }).click();
    await page.getByRole('dialog', { name: '当前草稿尚未保存，继续将放弃修改。', exact: true }).getByRole('button', { name: '放弃修改并关闭', exact: true }).click();
  } finally {
    if (created) await deleteEndpoint(page, created);
  }
});

test('real workflow native textarea stays within its column when manually resized', async ({ page }) => {
  const fixturePassword = `${randomUUID()}Aa8!`;
  const data = JSON.parse(workflowFixture('setup', fixturePassword)) as { organizationId: string; users: { username: string }[] };
  try {
    await loginAs(page, data.users[0]!.username, fixturePassword);
    await page.goto('/console/workflows');
    await page.getByRole('button', { name: '新建流程', exact: true }).click();
    const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
    await page.getByLabel('流程代码', { exact: true }).fill(`CTRL_${suffix}`);
    await page.getByLabel('流程名称', { exact: true }).fill(`控件尺寸原生文本 ${suffix}`);
    const creating = page.waitForResponse(response => new URL(response.url()).pathname === '/api/v1/workflows' && response.request().method() === 'POST');
    await page.getByRole('button', { name: '创建草稿', exact: true }).click();
    const created = await creating;
    expect(created.status()).toBe(201);
    const workflow = await created.json() as Schema['WorkflowDefinitionResponseDto'];
    await expect(page).toHaveURL(new RegExp(`/console/workflows/${workflow.id}/${workflow.version.id}$`));
    const description = page.getByRole('textbox', { name: '流程说明', exact: true });
    const next = page.getByRole('textbox', { name: '发布说明', exact: true });
    for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 760 }, { width: 320, height: 760 }]) {
      await page.setViewportSize(viewport);
      await description.scrollIntoViewIfNeeded();
      const before = await description.boundingBox();
      const nextBefore = await next.boundingBox();
      expect(await description.evaluate(element => getComputedStyle(element).resize)).toMatch(/vertical|both/);
      await page.mouse.move(before!.x + before!.width - 3, before!.y + before!.height - 3);
      await page.mouse.down();
      await page.mouse.move(before!.x + before!.width + 120, before!.y + before!.height + 70, { steps: 8 });
      await page.mouse.up();
      const after = await description.boundingBox();
      const nextAfter = await next.boundingBox();
      const parent = await description.locator('xpath=..').boundingBox();
      expect(after!.height).toBeGreaterThan(before!.height + 20);
      expect(after!.x + after!.width).toBeLessThanOrEqual(parent!.x + parent!.width + 1);
      if (viewport.width <= 640) expect(nextAfter!.y).toBeGreaterThan(nextBefore!.y + 20);
      await description.evaluate(element => { element.style.height = ''; element.style.width = ''; });
    }
  } finally {
    workflowFixture('cleanup', fixturePassword, data.organizationId);
  }
});

test('real business drawer keeps number, native date and growing textarea inside its form', async ({ page }) => {
  await login(page);
  await page.goto('/app/process-quality');
  await page.getByRole('button', { name: '登记不良', exact: true }).click();
  const drawer = page.getByRole('dialog', { name: '登记不良', exact: true });
  await expect(drawer).toBeVisible();
  const description = drawer.getByRole('textbox', { name: '失效现象', exact: true });
  await description.fill(`真实业务草稿 ${'长中英文 ABCDEFGHIJKLMNOP '.repeat(60)}`);
  await drawer.getByRole('spinbutton', { name: '不良数量', exact: true }).fill('123');
  await drawer.getByLabel('发生时间', { exact: true }).fill('2026-11-14T10:00');
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 760 }, { width: 320, height: 760 }]) {
    await page.setViewportSize(viewport);
    await assertControlsFit(drawer);
    const geometry = await drawer.evaluate(element => {
      const form = element.querySelector('form')!.getBoundingClientRect();
      return [...element.querySelectorAll<HTMLElement>('input[type="datetime-local"], textarea, .ant-input-number')].map(control => ({ right: control.getBoundingClientRect().right, formRight: form.right, width: control.getBoundingClientRect().width }));
    });
    for (const control of geometry) {
      expect(control.width).toBeGreaterThan(0);
      expect(control.right).toBeLessThanOrEqual(control.formRight + 1);
    }
  }
  await drawer.locator('.ant-drawer-close').click();
  await page.getByRole('dialog', { name: '当前草稿尚未保存，继续将放弃修改。', exact: true }).getByRole('button', { name: '放弃修改并关闭', exact: true }).click();
  await expect(drawer).toHaveCount(0);
});
