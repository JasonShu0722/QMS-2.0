import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import type { components } from '@qms/contracts';
import { completeMfa } from './mfa-login';
import { fillSecret } from './secret-input';

if (!process.env.QMS_ACCEPTANCE_BASE_URL || !process.env.DATABASE_URL || process.env.QMS_ACCEPTANCE_DISPOSABLE_DATABASE !== 'true') {
  throw new Error('Real gateway and explicitly disposable PostgreSQL are required');
}
const database = new URL(process.env.DATABASE_URL);
if (!['postgres:', 'postgresql:'].includes(database.protocol) || !['localhost', '127.0.0.1'].includes(database.hostname) || database.port === '55440') {
  throw new Error('Workflow fixture requires a disposable loopback PostgreSQL database');
}
const endpoint = '/api/v1/process-quality/ledger-workflow-configuration';
const password = `${randomUUID()}Aa8!`;
type Configuration = components['schemas']['ProcessLedgerWorkflowConfigurationDto'];

function fixture(action: string, identifier?: string) {
  const result = spawnSync(process.execPath, ['test/fixtures/workflow-designer-browser.mjs', action, ...(identifier ? [identifier] : [])], {
    cwd: resolve(process.cwd(), '../api'), env: { ...process.env, QMS_DESIGNER_FIXTURE_PASSWORD: password }, encoding: 'utf8', timeout: 30000, windowsHide: true,
  });
  if (result.status !== 0) throw new Error(`Workflow configuration fixture ${action} failed: ${result.stderr}`);
  return result.stdout;
}

function createFixturePositions(organizationId: string): Configuration['positions'] {
  const result = spawnSync(process.execPath, ['--input-type=module', '-', organizationId], {
    cwd: resolve(process.cwd(), '../api'), encoding: 'utf8', timeout: 30000, windowsHide: true,
    input: `
      import 'reflect-metadata';
      import { PrismaService } from './dist/database/prisma.service.js';

      const organizationId = process.argv[2];
      const prisma = new PrismaService();
      try {
        const organization = await prisma.organization.findUniqueOrThrow({ where: { id: organizationId } });
        if (!organization.code.startsWith('DESIGNER_E2E_')) throw new Error('Not an owned fixture');
        const positions = await prisma.position.createManyAndReturn({
          data: [
            { organizationId, code: 'LEDGER_ANALYST', name: '台账分析岗位' },
            { organizationId, code: 'LEDGER_REVIEWER', name: '台账复核岗位' },
          ],
          select: { id: true, name: true },
        });
        process.stdout.write(JSON.stringify(positions));
      } finally {
        await prisma.$disconnect();
      }
    `,
  });
  if (result.status !== 0) throw new Error(`Workflow fixture position setup failed: ${result.error ?? result.stderr}`);
  return JSON.parse(result.stdout) as Configuration['positions'];
}

async function login(page: Page, username: string) {
  await page.goto('/login');
  await page.getByLabel('账号', { exact: true }).fill(username);
  await fillSecret(page.getByLabel('密码', { exact: true }), password);
  const pending = page.waitForResponse(entry => entry.url().endsWith('/auth/login'));
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await completeMfa(page.request, await pending, username, page);
  await expect(page).toHaveURL(/\/app\/workbench$/);
}

async function openConfiguration(page: Page) {
  const pending = page.waitForResponse(entry => new URL(entry.url()).pathname === endpoint && entry.request().method() === 'GET');
  await page.getByRole('button', { name: '制程不合格台账', exact: true }).click();
  const response = await pending;
  expect(response.status()).toBe(200);
  return await response.json() as Configuration;
}

async function selectPosition(page: Page, board: string, position: string) {
  const select = page.getByRole('combobox', { name: board, exact: true });
  await select.fill(position);
  await page.locator('.ant-select-dropdown:visible .ant-select-item-option').filter({ has: page.getByText(position, { exact: true }) }).click();
}

test('configures process ledger positions and returns not found for retired workflow editors', async ({ page, browser }) => {
  test.setTimeout(120000);
  page.setDefaultTimeout(15000);
  const data = JSON.parse(fixture('setup')) as { organizationId: string; users: { username: string }[] };
  const restrictedContext = await browser.newContext({ baseURL: process.env.QMS_ACCEPTANCE_BASE_URL });
  const restricted = await restrictedContext.newPage();
  try {
    const positions = createFixturePositions(data.organizationId);
    await login(restricted, data.users[2]!.username);
    expect((await restricted.request.get(endpoint)).status()).toBe(403);
    await restricted.goto('/console/workflows');
    await expect(restricted.getByText(/管理访问已失效或无权限|无权访问此管理模块/)).toBeVisible();
    await expect(restricted.getByRole('button', { name: '制程不合格台账', exact: true })).toHaveCount(0);

    await login(page, data.users[0]!.username);
    for (const path of ['/app/workflow-designer', `/app/workflow-designer/${randomUUID()}/${randomUUID()}`, `/console/workflows/${randomUUID()}/${randomUUID()}`]) {
      await page.goto(path);
      await expect(page.getByText('管理页面不存在', { exact: true })).toBeVisible();
      expect(new URL(page.url()).pathname).toBe(path);
    }

    await page.goto('/console');
    const navigation = page.getByRole('navigation', { name: '管理导航', exact: true });
    await navigation.getByRole('button', { name: '平台与流程配置', exact: true }).click();
    await navigation.getByRole('link', { name: '流程管理', exact: true }).click();
    await expect(page).toHaveURL(/\/console\/workflows$/);
    const initial = await openConfiguration(page);
    expect(initial.version).toBe(0);
    expect(positions).toHaveLength(2);
    expect(initial.positions).toEqual(expect.arrayContaining(positions));
    for (const board of ['表单登记', '分析进度维护', '责任判定', '处置维护', '台账关闭判定']) {
      await expect(page.getByRole('combobox', { name: board, exact: true })).toBeVisible();
    }
    for (const position of positions) await selectPosition(page, '分析进度维护', position.name);
    await page.getByRole('combobox', { name: '分析进度维护', exact: true }).press('Escape');
    const saving = page.waitForResponse(entry => new URL(entry.url()).pathname === endpoint && entry.request().method() === 'PUT');
    await page.getByRole('button', { name: '保存配置', exact: true }).click();
    const saved = await saving;
    expect(saved.status()).toBe(200);
    const savedRequest = saved.request();
    const headers = savedRequest.headers();
    expect(headers['x-csrf-token']).toBeTruthy();
    expect(headers['idempotency-key']).toBeTruthy();
    expect(savedRequest.postDataJSON()).toEqual({ expectedVersion: 0, boards: initial.boards.map(({ board }) => ({ board, positionIds: board === 'ANALYSIS' ? positions.map(position => position.id) : [] })) });
    await expect(page.getByRole('button', { name: '保存配置', exact: true })).toBeDisabled();
    await page.reload();
    const reloaded = await openConfiguration(page);
    expect(reloaded.version).toBe(1);
    expect(reloaded.boards.find(board => board.board === 'ANALYSIS')?.positionIds.toSorted()).toEqual(positions.map(position => position.id).toSorted());
    for (const position of positions) await expect(page.locator('.ant-select-selection-item-content').filter({ hasText: position.name })).toBeVisible();
  } finally {
    await restrictedContext.close();
    fixture('cleanup', data.organizationId);
  }
});
