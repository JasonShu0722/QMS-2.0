import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { expect, test, type Locator, type Page } from '@playwright/test';
import type { components } from '@qms/contracts';
import { completeMfa } from './mfa-login';
import { positionRead, positionWrite } from './position-fixture';
import { fillSecret } from './secret-input';

type Schema = components['schemas'];
const baseURL = process.env.QMS_ACCEPTANCE_BASE_URL ?? process.env.PLAYWRIGHT_BASE_URL;
const databaseURL = process.env.DATABASE_URL;
const password = process.env.QMS_SEED_INTERNAL_PASSWORD;
if (!baseURL || !databaseURL || !password || !process.env.QMS_ACCEPTANCE_MFA_CACHE_FILE || !process.env.QMS_BACKUP_KEY
  || process.env.QMS_DISPOSABLE_TEST_DB !== 'true' || process.env.QMS_ACCEPTANCE_DISPOSABLE_DATABASE !== 'true') {
  throw new Error('Receipt detail browser acceptance requires disposable PostgreSQL, a real gateway, seed credentials and external MFA credentials.');
}
for (const [value, database] of [[baseURL, false], [databaseURL, true]] as const) {
  const url = new URL(value);
  if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.port === '55440' || url.search || url.hash
    || !(database ? ['postgres:', 'postgresql:'] : ['http:', 'https:']).includes(url.protocol)
    || (!database && (url.username || url.password || url.pathname !== '/'))) {
    throw new Error('Receipt detail fixtures require loopback resources outside the preserved preview database.');
  }
}

const requireApi = createRequire(new URL('../../api/package.json', import.meta.url));
const { PrismaPg } = requireApi('@prisma/adapter-pg');
const { PrismaClient } = await import('../../api/dist/generated/prisma/client.js');
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseURL }) });
const endpoints = '/api/v1/admin/integrations/endpoints';
const receiptsPath = '/api/v1/admin/integrations/receipts';
const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
const permissions = ['integration:read', 'integration:manage', 'integration:credentials:manage', 'integration:receipts:read', 'integration:payload:read'];
const addedPermissionIds: string[] = [];
let fixtureRoleId: string | undefined;

test.setTimeout(240_000);
test.use({ trace: 'off', screenshot: 'off', video: 'off', actionTimeout: 15_000, navigationTimeout: 20_000 });

test.beforeAll(async () => {
  const organization = await prisma.organization.findUniqueOrThrow({ where: { code: 'LOCAL-INTERNAL' } });
  const user = await prisma.user.findUniqueOrThrow({ where: { organizationId_username: { organizationId: organization.id, username: 'local.internal' } } });
  const assignment = await prisma.userRole.findFirstOrThrow({ where: { organizationId: organization.id, userId: user.id, role: { code: 'LOCAL_MEMBER' } } });
  fixtureRoleId = assignment.roleId;
  const catalog = await prisma.permission.findMany({ where: { code: { in: permissions } } });
  expect(catalog).toHaveLength(permissions.length);
  expect(await prisma.rolePermission.count({ where: { roleId: fixtureRoleId, permission: { code: { in: permissions } } } })).toBe(0);
  for (const code of ['platform:admin', 'configuration:read']) {
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
    if (fixtureRoleId && addedPermissionIds.length) {
      await prisma.rolePermission.deleteMany({ where: { roleId: fixtureRoleId, permissionId: { in: addedPermissionIds } } });
    }
  } finally {
    await prisma.$disconnect();
  }
});

async function openIntegrations(page: Page) {
  await page.setViewportSize({ width: 1440, height: 800 });
  await page.goto('/login');
  await page.getByLabel('账号', { exact: true }).fill('local.internal');
  await fillSecret(page.getByLabel('密码', { exact: true }), password!);
  const login = page.waitForResponse(response => new URL(response.url()).pathname === '/api/v1/auth/login' && response.request().method() === 'POST');
  const [authenticated] = await Promise.all([login, page.getByRole('button', { name: '登录', exact: true }).click()]);
  await completeMfa(page.request, authenticated, 'local.internal', page);
  await expect(page).toHaveURL(/\/app\/workbench$/);
  await page.goto('/console');
  const entry = page.getByRole('link', { name: 'API接口管理', exact: true });
  await expect(entry).toBeVisible();
  await entry.click();
  await expect(page).toHaveURL(/\/console\/api-integrations(?:\?|$)/);
  const section = page.getByRole('region', { name: 'API接口管理', exact: true });
  await expect(section).toBeVisible();
  return section;
}

async function sendMessage(endpointCode: string, credential: string, body: string) {
  const response = await fetch(new URL(`/api/v1/integrations/inbound/${encodeURIComponent(endpointCode)}/messages`, baseURL), {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15_000),
    headers: { Authorization: `Bearer ${credential}`, 'Content-Type': 'application/json' }, body,
  });
  expect(response.status).toBe(200);
  expect(await response.json()).toBe(true);
  return response;
}

async function selectEndpoint(page: Page, section: Locator, search: string, endpointName: string, endpointCode: string, endpointId: string) {
  const filters = section.getByRole('form', { name: '接收记录筛选', exact: true });
  const selector = filters.getByRole('combobox', { name: '接口名称或编码', exact: true });
  const firstPage = page.waitForResponse(response => {
    const url = new URL(response.url());
    return url.pathname === '/api/v1/admin/integrations/receipt-endpoints' && response.request().method() === 'GET'
      && url.searchParams.get('page') === '1' && url.searchParams.get('search') === search;
  });
  await selector.click();
  await selector.fill(search);
  expect((await firstPage).status()).toBe(200);
  await expect(page.getByRole('button', { name: '加载更多接口', exact: true })).toBeVisible();
  const secondPage = page.waitForResponse(response => {
    const url = new URL(response.url());
    return url.pathname === '/api/v1/admin/integrations/receipt-endpoints' && response.request().method() === 'GET'
      && url.searchParams.get('page') === '2' && url.searchParams.get('search') === search;
  });
  await page.getByRole('button', { name: '加载更多接口', exact: true }).click();
  expect((await secondPage).status()).toBe(200);
  await selector.click();
  const dropdown = page.locator('.ant-select-dropdown:visible');
  const option = dropdown.locator('.ant-select-item-option').filter({ hasText: `${endpointName} (${endpointCode})` });
  await option.click();
  await expect(page.locator('.ant-select-dropdown:visible')).toHaveCount(0);
}

async function assertPayloadFrame(page: Page, detail: Locator, expected: string) {
  await expect(detail.getByText('接收详情', { exact: true })).toBeVisible();
  await expect(detail.getByRole('button', { name: '关闭', exact: true })).toBeVisible();
  const longValue = detail.getByRole('button', { name: /接收编号：/ }).first();
  await longValue.click();
  await expect(page.locator('.qms-integration-detail-value-popover:visible')).toBeVisible();
  const payload = detail.getByLabel('接收正文', { exact: true });
  await expect(payload).toHaveText(expected);
  const copy = detail.getByRole('button', { name: '复制接收正文', exact: true });
  await copy.click();
  await expect(detail.getByText('已复制接收正文', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(expected);
  const metrics = await detail.locator('.qms-integration-payload-frame').evaluate(frame => {
    const pre = frame.querySelector('pre');
    if (!pre) throw new Error('Payload frame is missing its preformatted body.');
    return { overflow: getComputedStyle(pre).overflow, scrollHeight: pre.scrollHeight, clientHeight: pre.clientHeight };
  });
  expect(metrics.overflow).toBe('auto');
  expect(metrics.scrollHeight).toBeGreaterThan(metrics.clientHeight);
  const geometry = await detail.evaluate(dialog => {
    const body = dialog.querySelector<HTMLElement>('.ant-modal-body')!;
    const pre = dialog.querySelector<HTMLElement>('pre')!;
    const button = dialog.querySelector<HTMLElement>('.qms-integration-payload-copy')!;
    const container = dialog.querySelector<HTMLElement>('.ant-modal-container')!;
    const title = dialog.querySelector<HTMLElement>('.ant-modal-header')!;
    const footer = dialog.querySelector<HTMLElement>('.ant-modal-footer')!;
    const payloadRect = pre.getBoundingClientRect(), copyRect = button.getBoundingClientRect();
    const before = { title: title.getBoundingClientRect().top, footer: footer.getBoundingClientRect().bottom };
    pre.scrollTop = pre.scrollHeight;
    return { overflow: getComputedStyle(body).overflow, bodyScrolls: body.scrollHeight > body.clientHeight + 1 && ['auto', 'scroll'].includes(getComputedStyle(body).overflowY), top: container.getBoundingClientRect().top, bottom: container.getBoundingClientRect().bottom, viewport: innerHeight, before, after: { title: title.getBoundingClientRect().top, footer: footer.getBoundingClientRect().bottom }, copyRight: copyRect.right, payloadContentRight: payloadRect.left + pre.clientLeft + pre.clientWidth, icon: !!button.querySelector('svg'), text: button.textContent, opacity: Number(getComputedStyle(button).opacity), payloadHeight: pre.clientHeight, tailVisible: pre.scrollTop + pre.clientHeight >= pre.scrollHeight };
  });
  expect(geometry.bodyScrolls).toBe(false);
  expect(geometry.payloadHeight).toBeGreaterThanOrEqual(50);
  expect(geometry.tailVisible).toBe(true);
  expect(geometry.top).toBeGreaterThanOrEqual(0);
  expect(geometry.bottom).toBeLessThanOrEqual(geometry.viewport);
  expect(geometry.before).toEqual(geometry.after);
  expect(geometry.copyRight).toBeLessThan(geometry.payloadContentRight - 3);
  expect(geometry.icon).toBe(true); expect(geometry.text).toBe('');
  expect(geometry.opacity).toBeGreaterThan(0);
}

test('real receipt detail UX, candidate pagination, scoped deletion and retained attempts', async ({ page }) => {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  const section = await openIntegrations(page);
  let endpoint: Schema['IntegrationEndpointDto'] | undefined;
  let credential: Schema['IntegrationCredentialDto'] | undefined;
  const fixtureEndpointIds: string[] = [];
  const fixtureReceiptIds: string[] = [];
  const candidateSearch = `浏览器接收验收 ${suffix}`;
  const endpointName = `${candidateSearch} 00`;
  const endpointCode = `UX_${suffix}_00`;
  const sourceCode = `UXSRC_${suffix}`;
  const bodyOne = JSON.stringify([{ acceptance: 'receipt-detail', ordinal: 1, text: `第一条可读长正文 ${'正文内容 '.repeat(500)}` }]);
  const bodyTwo = JSON.stringify([{ acceptance: 'receipt-detail', ordinal: 2, text: `第二条可读长正文 ${'正文内容 '.repeat(500)}` }]);
  const bodyThree = JSON.stringify([{ acceptance: 'receipt-detail', ordinal: 3, text: '第三条删除批量夹具' }]);
  let capacityBefore = 0;
  let firstPayloadBytes = 0;
  let secondPayloadBytes = 0;
  let thirdPayloadBytes = 0;
  try {
    endpoint = await positionWrite<Schema['IntegrationEndpointDto']>(page.request, endpoints, 'POST', {
      code: endpointCode, name: endpointName, sourceCode, sourceName: `${'长来源名称'.repeat(18)} ${suffix}`.slice(0, 120), returnReceipt: true,
    }, 201);
    fixtureEndpointIds.push(endpoint.id);
    credential = await positionWrite<Schema['IntegrationCredentialDto']>(page.request, `${endpoints}/${endpoint.id}/credentials`, 'POST', {
      organizationId: endpoint.organizationId, name: `浏览器接收凭据 ${suffix}`, validityDays: null,
    }, 201);
    endpoint = await positionWrite<Schema['IntegrationEndpointDto']>(page.request, `${endpoints}/${endpoint.id}`, 'PATCH', {
      organizationId: endpoint.organizationId, expectedVersion: endpoint.version, status: 'ENABLED',
    });
    await Promise.all(Array.from({ length: 20 }, (_, index) => {
      const ordinal = String(index + 1).padStart(2, '0');
      const code = `UX_${suffix}_${ordinal}`;
      return prisma.integrationEndpoint.create({ data: {
        organizationId: endpoint!.organizationId, code, name: `${candidateSearch} ${ordinal}`, sourceCode: `${sourceCode}_${ordinal}`, sourceName: `候选来源 ${ordinal}`,
      } });
    }));

    await sendMessage(endpoint.code, credential.secret!, bodyOne);
    const first = await prisma.integrationReceipt.findFirstOrThrow({ where: { endpointId: endpoint.id }, orderBy: { receivedAt: 'desc' } });
    await sendMessage(endpoint.code, credential.secret!, bodyTwo);
    const second = await prisma.integrationReceipt.findFirstOrThrow({ where: { endpointId: endpoint.id, id: { not: first.id } }, orderBy: { receivedAt: 'desc' } });
    await sendMessage(endpoint.code, credential.secret!, bodyThree);
    const third = await prisma.integrationReceipt.findFirstOrThrow({ where: { endpointId: endpoint.id, id: { notIn: [first.id, second.id] } }, orderBy: { receivedAt: 'desc' } });
    fixtureReceiptIds.push(first.id, second.id, third.id);
    const stored = await prisma.integrationReceipt.findMany({ where: { id: { in: fixtureReceiptIds } }, orderBy: { receivedAt: 'asc' } });
    expect(stored).toHaveLength(3);
    firstPayloadBytes = stored.find(item => item.id === first.id)!.payloadBytes;
    secondPayloadBytes = stored.find(item => item.id === second.id)!.payloadBytes;
    thirdPayloadBytes = stored.find(item => item.id === third.id)!.payloadBytes;
    const attemptsBefore = await prisma.integrationRequestAttempt.count({ where: { endpointId: endpoint.id, receiptId: { in: fixtureReceiptIds } } });
    expect(attemptsBefore).toBe(3);
    capacityBefore = (await positionRead<Schema['IntegrationOperationDto']>(page.request, `/api/v1/admin/integrations/status?organizationId=${endpoint.organizationId}`)).usedBodyBytes;

    await section.getByRole('tab', { name: '接收记录', exact: true }).click();
    await expect(section.getByText(/最近清理(成功|失败)/)).toHaveCount(0);
    const recordTools = section.getByRole('toolbar', { name: '接收记录操作', exact: true });
    await expect(recordTools.getByRole('button', { name: '设置组织正文容量', exact: true })).toBeVisible();
    const recordPagination = section.getByRole('navigation', { name: '接收记录分页', exact: true });
    await expect(recordPagination).toBeVisible();
    await expect(recordPagination.getByRole('combobox', { name: '每页条数', exact: true }).locator('option')).toHaveCount(6);
    const largePage = page.waitForResponse(response => {
      const url = new URL(response.url());
      return url.pathname === receiptsPath && url.searchParams.get('limit') === '1000';
    });
    await recordPagination.getByRole('combobox', { name: '每页条数', exact: true }).selectOption('1000');
    expect((await largePage).status()).toBe(200);
    const contentPadding = await page.locator('.qms-console-content').evaluate(element => parseFloat(getComputedStyle(element).paddingTop));
    expect(contentPadding).toBeGreaterThanOrEqual(12); expect(contentPadding).toBeLessThanOrEqual(16);
    const filters = section.getByRole('form', { name: '接收记录筛选', exact: true });
    await expect(filters).toHaveCount(0);
    await expect(section.getByRole('button', { name: '筛选条件', exact: true })).toHaveAttribute('aria-expanded', 'false');
    await section.getByRole('button', { name: '筛选条件', exact: true }).click();
    await expect(filters).toBeVisible();
    await selectEndpoint(page, section, candidateSearch, endpointName, endpointCode, endpoint.id);
    const listing = page.waitForResponse(response => {
      const url = new URL(response.url());
      return url.pathname === receiptsPath && response.request().method() === 'GET' && url.searchParams.get('endpointId') === endpoint!.id;
    });
    await filters.getByRole('button', { name: '应用筛选', exact: true }).click();
    expect((await listing).status()).toBe(200);
    await expect(section.getByRole('button', { name: `查看消息${first.messageId}`, exact: true })).toBeVisible();
    await expect(section.getByRole('button', { name: `查看消息${second.messageId}`, exact: true })).toBeVisible();
    await expect(section.getByRole('button', { name: `查看消息${third.messageId}`, exact: true })).toBeVisible();

    const selectPage = section.getByRole('checkbox', { name: '选择当前页', exact: true });
    await page.setViewportSize({ width: 1920, height: 900 });
    const tableContent = section.locator('.ant-table-content');
    const table = tableContent.locator('table');
    expect((await table.boundingBox())!.width).toBeGreaterThanOrEqual((await tableContent.boundingBox())!.width - 2);
    await expect(table.locator('thead th')).toHaveCount(6);
    await expect(table.locator('thead th').last()).toHaveText('详情');
    const selectionHeader = selectPage.locator('xpath=ancestor::th');
    expect((await selectionHeader.boundingBox())!.width).toBeCloseTo(44, 0);
    await section.getByRole('separator', { name: '调整列宽 选择', exact: true }).press('ArrowRight');
    expect((await selectionHeader.boundingBox())!.width).toBeCloseTo(54, 0);
    await section.getByRole('separator', { name: '调整列宽 选择', exact: true }).press('ArrowLeft');
    for (const name of ['消息编号', '来源 / 接口', '接收结果', '时间', '详情']) {
      const header = section.getByRole('columnheader', { name, exact: true });
      const widthBefore = (await header.boundingBox())!.width;
      await section.getByRole('separator', { name: `调整列宽 ${name}`, exact: true }).press('ArrowRight');
      await expect.poll(async () => (await header.boundingBox())!.width).toBeGreaterThan(widthBefore + 1);
      await section.getByRole('separator', { name: `调整列宽 ${name}`, exact: true }).press('ArrowLeft');
      await expect.poll(async () => (await header.boundingBox())!.width).toBeCloseTo(widthBefore, 0);
    }
    const lastHeader = (await table.locator('thead th').last().boundingBox())!;
    expect(lastHeader.x + lastHeader.width).toBeCloseTo((await table.boundingBox())!.x + (await table.boundingBox())!.width, 0);
    if (process.env.QMS_RECEIPT_VISUAL_SCREENSHOT) await page.screenshot({ path: process.env.QMS_RECEIPT_VISUAL_SCREENSHOT });
    await section.getByRole('button', { name: '列设置', exact: true }).click();
    const resultVisibility = page.getByRole('checkbox', { name: '显示 接收结果', exact: true });
    await resultVisibility.uncheck();
    await expect(table.locator('thead th')).toHaveCount(5);
    expect((await table.boundingBox())!.width).toBeGreaterThanOrEqual((await tableContent.boundingBox())!.width - 2);
    expect((await selectionHeader.boundingBox())!.width).toBeCloseTo(44, 0);
    await resultVisibility.check();
    await expect(table.locator('thead th')).toHaveCount(6);
    await section.getByRole('button', { name: '列设置', exact: true }).click();

    await page.setViewportSize({ width: 390, height: 700 });
    expect(await tableContent.evaluate(element => element.scrollWidth > element.clientWidth)).toBe(true);

    for (const viewport of [{ width: 390, height: 700 }, { width: 390, height: 500 }, { width: 667, height: 320 }, { width: 1024, height: 400 }]) {
      await page.setViewportSize(viewport);
      await section.getByRole('button', { name: `查看消息${first.messageId}`, exact: true }).click();
      const detail = page.getByRole('dialog', { name: '接收详情', exact: true });
      await expect(detail).toBeVisible();
      await assertPayloadFrame(page, detail, bodyOne);
      await detail.getByRole('button', { name: '关闭', exact: true }).click();
      await expect(detail).toHaveCount(0);
    }

    await page.setViewportSize({ width: 1440, height: 800 });
    await section.getByRole('button', { name: `查看消息${second.messageId}`, exact: true }).click();
    const detail = page.getByRole('dialog', { name: '接收详情', exact: true });
    await assertPayloadFrame(page, detail, bodyTwo);
    await detail.getByRole('button', { name: '关闭', exact: true }).click();
    await expect(detail).toHaveCount(0);

    await section.getByRole('button', { name: `删除消息${first.messageId}`, exact: true }).click();
    const singleConfirmation = page.getByRole('dialog', { name: '删除接收记录', exact: true });
    await expect(singleConfirmation).toContainText('确认删除选中的 1 条接收记录');
    const singleDelete = page.waitForResponse(response => new URL(response.url()).pathname === receiptsPath && response.request().method() === 'DELETE');
    const [singleResponse] = await Promise.all([singleDelete, singleConfirmation.getByRole('button', { name: '删除', exact: true }).click()]);
    expect(singleResponse.status()).toBe(200);
    await expect(section.getByRole('button', { name: `查看消息${first.messageId}`, exact: true })).toHaveCount(0);
    await expect(section.getByRole('button', { name: `查看消息${second.messageId}`, exact: true })).toBeVisible();
    await expect(section.getByRole('button', { name: `查看消息${third.messageId}`, exact: true })).toBeVisible();
    const afterSingle = await positionRead<Schema['IntegrationOperationDto']>(page.request, `/api/v1/admin/integrations/status?organizationId=${endpoint.organizationId}`);
    expect(afterSingle.usedBodyBytes).toBe(capacityBefore - firstPayloadBytes);

    const secondRow = section.locator('tbody tr').filter({ hasText: second.messageId });
    await secondRow.locator('input[type="checkbox"]').click();
    const thirdRow = section.locator('tbody tr').filter({ hasText: third.messageId });
    await thirdRow.locator('input[type="checkbox"]').click();
    await expect(section.getByText('已选择 2 条', { exact: true })).toBeVisible();
    const floatingActions = section.getByRole('toolbar', { name: '已选接收记录', exact: true });
    await expect(floatingActions).toBeVisible();
    expect(await floatingActions.evaluate(element => getComputedStyle(element).position)).toBe('fixed');
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await floatingActions.getByRole('button', { name: '取消选择', exact: true }).click();
    await expect(floatingActions).toHaveCount(0);
    await secondRow.locator('input[type="checkbox"]').click();
    await thirdRow.locator('input[type="checkbox"]').click();
    await section.getByRole('button', { name: '删除所选', exact: true }).click();
    const batchConfirmation = page.getByRole('dialog', { name: '删除接收记录', exact: true });
    await expect(batchConfirmation).toContainText('确认删除选中的 2 条接收记录');
    const batchDelete = page.waitForResponse(response => new URL(response.url()).pathname === receiptsPath && response.request().method() === 'DELETE');
    const [batchResponse] = await Promise.all([batchDelete, batchConfirmation.getByRole('button', { name: '删除', exact: true }).click()]);
    expect(batchResponse.status()).toBe(200);
    await expect(section.getByRole('button', { name: `查看消息${second.messageId}`, exact: true })).toHaveCount(0);
    await expect(section.getByRole('button', { name: `查看消息${third.messageId}`, exact: true })).toHaveCount(0);
    const afterBatch = await positionRead<Schema['IntegrationOperationDto']>(page.request, `/api/v1/admin/integrations/status?organizationId=${endpoint.organizationId}`);
    expect(afterBatch.usedBodyBytes).toBe(capacityBefore - firstPayloadBytes - secondPayloadBytes - thirdPayloadBytes);
    expect(await prisma.integrationReceipt.count({ where: { id: { in: fixtureReceiptIds } } })).toBe(0);

    await section.getByRole('combobox', { name: '记录视图', exact: true }).click();
    await page.getByText('请求结果', { exact: true }).click();
    const attemptFilters = section.getByRole('form', { name: '接收记录筛选', exact: true });
    const filterToggle = section.getByRole('button', { name: '筛选条件', exact: true });
    if (await filterToggle.getAttribute('aria-expanded') !== 'true') await filterToggle.click();
    await attemptFilters.getByLabel('来源系统编码', { exact: true }).fill(sourceCode);
    const attemptsListing = page.waitForResponse(response => {
      const url = new URL(response.url());
      return url.pathname === '/api/v1/admin/integrations/attempts' && response.request().method() === 'GET' && url.searchParams.get('sourceCode') === sourceCode;
    });
    await attemptFilters.getByRole('button', { name: '应用筛选', exact: true }).click();
    expect((await attemptsListing).status()).toBe(200);
    await expect(section.getByRole('button', { name: `查看消息${first.messageId}`, exact: true })).toBeVisible();
    await expect(section.getByRole('button', { name: `查看消息${second.messageId}`, exact: true })).toBeVisible();
    await expect(section.getByRole('button', { name: `查看消息${third.messageId}`, exact: true })).toBeVisible();
    expect(await prisma.integrationRequestAttempt.count({ where: { endpointId: endpoint.id, receiptId: { in: fixtureReceiptIds } } })).toBe(3);

    await page.goto('/console');
    await expect(page.getByRole('main')).toBeVisible();
    expect(await page.locator('main .qms-console-scope-details').count()).toBe(0);
  } finally {
    if (endpoint) {
      const remaining = await prisma.integrationReceipt.findMany({ where: { id: { in: fixtureReceiptIds } }, select: { id: true } });
      if (remaining.length) {
        await positionWrite(page.request, receiptsPath, 'DELETE', { organizationId: endpoint.organizationId, receiptIds: remaining.map(item => item.id) });
      }
      await prisma.integrationRequestAttempt.deleteMany({ where: { endpointId: { in: fixtureEndpointIds } } });
      await prisma.integrationRateWindow.deleteMany({ where: { endpointId: { in: fixtureEndpointIds } } });
      await prisma.integrationCredential.deleteMany({ where: { endpointId: { in: fixtureEndpointIds } } });
      await prisma.integrationEndpoint.deleteMany({ where: { id: { in: fixtureEndpointIds } } });
      await prisma.integrationEndpoint.deleteMany({ where: { organizationId: endpoint.organizationId, code: { startsWith: `UX_${suffix}_` } } });
    }
  }
});

test('real receipt filters contain long endpoints and clear applied and invalid draft values in both views', async ({ page }) => {
  const section = await openIntegrations(page);
  const endpointIds: string[] = [];
  const receiptIds: string[] = [];
  let organizationId = '';
  const search = `筛选验收 ${suffix}`;
  const name = `${search} ${'长接口名称'.repeat(20)}`.slice(0, 120);
  const code = `FILTER_${suffix}_${'LONGCODE'.repeat(6)}`.slice(0, 64);
  const sourceCode = `FILTERSRC_${suffix}`;
  const listResponse = (path: string, matches: (query: URLSearchParams) => boolean) => page.waitForResponse(response => {
    const url = new URL(response.url());
    return response.request().method() === 'GET' && url.pathname === path && matches(url.searchParams);
  });
  try {
    for (const [endpointName, endpointCode, source, count] of [[name, code, sourceCode, 11], [`${search} 第二接口`, `FILTER2_${suffix}`, `${sourceCode}_2`, 1]] as const) {
      const endpoint = await positionWrite<Schema['IntegrationEndpointDto']>(page.request, endpoints, 'POST', {
        code: endpointCode, name: endpointName, sourceCode: source, sourceName: endpointName, returnReceipt: true,
      }, 201);
      endpointIds.push(endpoint.id); organizationId = endpoint.organizationId;
      const credential = await positionWrite<Schema['IntegrationCredentialDto']>(page.request, `${endpoints}/${endpoint.id}/credentials`, 'POST', {
        organizationId, name: `筛选凭据 ${suffix}`, validityDays: null,
      }, 201);
      await positionWrite(page.request, `${endpoints}/${endpoint.id}`, 'PATCH', { organizationId, expectedVersion: endpoint.version, status: 'ENABLED' });
      for (let ordinal = 0; ordinal < count; ordinal++) await sendMessage(endpointCode, credential.secret!, JSON.stringify([{ acceptance: 'receipt-filter-reset', ordinal }]));
      receiptIds.push(...(await prisma.integrationReceipt.findMany({ where: { endpointId: endpoint.id }, select: { id: true } })).map(receipt => receipt.id));
    }
    expect(receiptIds).toHaveLength(12);
    await section.getByRole('tab', { name: '接收记录', exact: true }).click();
    const pagination = section.getByRole('navigation', { name: '接收记录分页', exact: true });
    const sized = listResponse(receiptsPath, query => query.get('limit') === '10');
    await pagination.getByRole('combobox', { name: '每页条数', exact: true }).selectOption('10');
    expect((await sized).status()).toBe(200);
    const filterToggle = section.getByRole('button', { name: '筛选条件', exact: true });
    await filterToggle.click();
    const filters = section.getByRole('form', { name: '接收记录筛选', exact: true });
    const selector = filters.getByRole('combobox', { name: '接口名称或编码', exact: true });
    const candidates = listResponse('/api/v1/admin/integrations/receipt-endpoints', query => query.get('search') === search);
    await selector.fill(search);
    expect((await candidates).status()).toBe(200);
    const label = `${name} (${code}) · ${endpointIds[0]}`;
    const dropdown = page.locator('.ant-select-dropdown:visible');
    await expect(dropdown.locator('.ant-select-item-option')).toHaveCount(2);
    const option = dropdown.locator('.ant-select-item-option').filter({ hasText: label });
    await expect(option).toContainText(label);
    await option.click();
    await expect(page.locator('.ant-select-dropdown:visible')).toHaveCount(0);
    const endpointField = selector.locator('xpath=ancestor::label');
    const selectedItem = endpointField.locator('.ant-select-content');
    await expect(selectedItem).toHaveAttribute('title', label);
    for (const viewport of [{ width: 1440, height: 800 }, { width: 1920, height: 900 }, { width: 390, height: 700 }, { width: 320, height: 700 }]) {
      await page.setViewportSize(viewport);
      const geometry = await endpointField.evaluate(field => {
        const select = field.querySelector<HTMLElement>('.ant-select')!;
        const item = field.querySelector<HTMLElement>('.ant-select-content')!;
        const source = field.nextElementSibling!;
        const fieldRect = field.getBoundingClientRect(), selectRect = select.getBoundingClientRect(), itemRect = item.getBoundingClientRect(), sourceRect = source.getBoundingClientRect();
        const overflowing = [...document.querySelectorAll<HTMLElement>('body *')].filter(element => {
          const rect = element.getBoundingClientRect();
          return rect.width > 0 && rect.right > innerWidth + 1 && !element.closest('.ant-table-content');
        }).slice(0, 12).map(element => ({ tag: element.tagName, className: String(element.className), right: element.getBoundingClientRect().right, width: element.clientWidth, scrollWidth: element.scrollWidth, ancestors: [element.parentElement, element.parentElement?.parentElement].filter(Boolean).map(parent => ({ className: String(parent!.className), display: getComputedStyle(parent!).display, overflowX: getComputedStyle(parent!).overflowX, visibility: getComputedStyle(parent!).visibility })) }));
        return { fieldRight: fieldRect.right, fieldBottom: fieldRect.bottom, selectRight: selectRect.right, itemRight: itemRect.right, sourceLeft: sourceRect.left, sourceTop: sourceRect.top, itemWidth: item.clientWidth, itemScrollWidth: item.scrollWidth, overflow: getComputedStyle(item).textOverflow, filterWidth: field.closest('fieldset')!.clientWidth, filterScrollWidth: field.closest('fieldset')!.scrollWidth, documentWidth: document.documentElement.scrollWidth, viewportWidth: innerWidth, overflowing };
      });
      expect(geometry.selectRight).toBeLessThanOrEqual(geometry.fieldRight + 1);
      expect(geometry.itemRight).toBeLessThanOrEqual(geometry.fieldRight + 1);
      if (viewport.width > 640) expect(geometry.selectRight).toBeLessThanOrEqual(geometry.sourceLeft);
      else expect(geometry.sourceTop).toBeGreaterThanOrEqual(geometry.fieldBottom);
      expect(geometry.itemScrollWidth).toBeGreaterThan(geometry.itemWidth);
      expect(geometry.overflow).toBe('ellipsis');
      expect(geometry.filterScrollWidth).toBeLessThanOrEqual(geometry.filterWidth + 1);
      expect(geometry.documentWidth, JSON.stringify(geometry.overflowing)).toBeLessThanOrEqual(geometry.viewportWidth);
    }
    await page.setViewportSize({ width: 1440, height: 800 });
    for (const mode of ['receipts', 'attempts'] as const) {
      const path = `/api/v1/admin/integrations/${mode}`;
      if (mode === 'attempts') {
        const switched = listResponse(path, query => query.get('page') === '1');
        await section.getByRole('combobox', { name: '记录视图', exact: true }).click();
        await page.getByText('请求结果', { exact: true }).click();
        expect((await switched).status()).toBe(200);
      }
      await filters.getByLabel('来源系统编码', { exact: true }).fill(sourceCode);
      await filters.getByRole('combobox', { name: '查询时段', exact: true }).click();
      await page.locator('.ant-select-dropdown:visible .ant-select-item-option').filter({ hasText: /^近1天$/ }).click();
      const applied = listResponse(path, query => query.get('sourceCode') === sourceCode && query.get('page') === '1');
      await filters.getByRole('button', { name: '应用筛选', exact: true }).click();
      expect((await applied).status()).toBe(200);
      const secondPage = listResponse(path, query => query.get('sourceCode') === sourceCode && query.get('page') === '2');
      await pagination.getByRole('button', { name: '下一页', exact: true }).click();
      expect((await secondPage).status()).toBe(200);
      if (mode === 'receipts') await section.getByRole('checkbox', { name: '选择当前页', exact: true }).check();
      await pagination.getByRole('spinbutton', { name: '跳至页', exact: true }).fill('2');
      await filters.getByLabel('来源系统编码', { exact: true }).fill('invalid source');
      await filters.getByLabel('消息编号', { exact: true }).fill('bad');
      await filters.getByLabel('接收编号', { exact: true }).fill('invalid-receipt');
      if (mode === 'attempts') {
        await filters.getByLabel('请求追踪号', { exact: true }).fill('invalid-trace');
        await filters.getByRole('combobox', { name: '请求结果', exact: true }).click();
        await page.locator('.ant-select-dropdown:visible .ant-select-item-option').filter({ hasText: /^失败$/ }).click();
      }
      await filters.getByRole('button', { name: '应用筛选', exact: true }).click();
      await expect(section.getByText('请检查标识格式；来源系统编码最多64位，消息编号为8～128位', { exact: true })).toBeVisible();
      const cleared = listResponse(path, query => query.get('page') === '1' && query.get('limit') === '10' && ['endpointId', 'sourceCode', 'messageId', 'receiptId', 'traceId', 'outcome'].every(key => !query.has(key)));
      await section.getByRole('button', { name: '清空筛选', exact: true }).click();
      const response = await cleared;
      expect(response.status()).toBe(200);
      const query = new URL(response.url()).searchParams;
      const rangeDays = (Date.parse(query.get('to')!) - Date.parse(query.get('from')!)) / 86400000;
      expect(rangeDays).toBeGreaterThan(6.99); expect(rangeDays).toBeLessThanOrEqual(7);
      const result = await response.json() as Schema['IntegrationReceiptPageDto'] | Schema['IntegrationAttemptPageDto'];
      const verified = await positionRead<Schema['IntegrationReceiptPageDto'] | Schema['IntegrationAttemptPageDto']>(page.request, `${path}?${query.toString()}`);
      expect(result.items.map(item => item.id)).toEqual(verified.items.map(item => item.id));
      expect(result.total).toBeGreaterThanOrEqual(12);
      await expect(pagination.getByRole('combobox', { name: '每页条数', exact: true })).toHaveValue('10');
      await expect(pagination.getByRole('spinbutton', { name: '跳至页', exact: true })).toHaveValue('');
      await expect(filterToggle).toHaveAttribute('aria-expanded', 'true');
      await expect(section.getByRole('toolbar', { name: '已选接收记录', exact: true })).toHaveCount(0);
      await expect(section.getByText('请检查标识格式；来源系统编码最多64位，消息编号为8～128位', { exact: true })).toHaveCount(0);
      await expect(section.getByRole('combobox', { name: '记录视图', exact: true }).locator('xpath=ancestor::div[contains(@class,"ant-select")]').first()).toContainText(mode === 'receipts' ? '已收数据' : '请求结果');
      await expect(filters).toBeVisible();
      for (const field of ['来源系统编码', '消息编号', '接收编号', ...(mode === 'attempts' ? ['请求追踪号'] : [])]) await expect(filters.getByLabel(field, { exact: true })).toHaveValue('');
      await expect(endpointField.locator('.ant-select-content')).not.toHaveAttribute('title', label);
      await expect(endpointField.locator('.ant-select-content')).not.toContainText(name);
      await expect(filters.getByRole('combobox', { name: '查询时段', exact: true }).locator('xpath=ancestor::div[contains(@class,"ant-select")]').first()).toContainText('近7天');
      if (mode === 'attempts') await expect(filters.getByRole('combobox', { name: '请求结果', exact: true }).locator('xpath=ancestor::div[contains(@class,"ant-select")]').first()).toContainText('全部结果');
    }
  } finally {
    const remaining = await prisma.integrationReceipt.findMany({ where: { endpointId: { in: endpointIds } }, select: { id: true } });
    if (remaining.length) await positionWrite(page.request, receiptsPath, 'DELETE', { organizationId, receiptIds: remaining.map(item => item.id) });
    await prisma.integrationRequestAttempt.deleteMany({ where: { endpointId: { in: endpointIds } } });
    await prisma.integrationRateWindow.deleteMany({ where: { endpointId: { in: endpointIds } } });
    await prisma.integrationCredential.deleteMany({ where: { endpointId: { in: endpointIds } } });
    await prisma.integrationEndpoint.deleteMany({ where: { id: { in: endpointIds } } });
  }
});

test('real thousand row receiving page keeps selection actions reachable and deletes the selected page', async ({ page }) => {
  const section = await openIntegrations(page);
  const organization = await prisma.organization.findUniqueOrThrow({ where: { code: 'LOCAL-INTERNAL' } });
  const sourceCode = `PAGE1000_${suffix}`;
  const endpoint = await prisma.integrationEndpoint.create({ data: { organizationId: organization.id, code: sourceCode, name: sourceCode, sourceCode, sourceName: sourceCode } });
  const credential = await prisma.integrationCredential.create({ data: { organizationId: organization.id, endpointId: endpoint.id, name: sourceCode, secretHash: 'a'.repeat(64), expiresAt: null } });
  let accounted = false;
  try {
    await prisma.$transaction(async transaction => {
      await transaction.integrationReceipt.createMany({ data: Array.from({ length: 1000 }, () => ({ organizationId: organization.id, endpointId: endpoint.id, credentialId: credential.id, messageId: randomUUID(), configurationVersion: 1, configurationSnapshot: {}, bodyExpiresAt: new Date(Date.now() + 86400000), metadataExpiresAt: new Date(Date.now() + 86400000), payloadBytes: 0 })) });
      await transaction.integrationScopeCapacity.upsert({ where: { organizationId: organization.id }, create: { organizationId: organization.id, receiptCount: 1000 }, update: { receiptCount: { increment: 1000 } } });
    });
    accounted = true;
    await section.getByRole('tab', { name: '接收记录', exact: true }).click();
    await section.getByRole('button', { name: '筛选条件', exact: true }).click();
    const filters = section.getByRole('form', { name: '接收记录筛选', exact: true });
    await filters.getByLabel('来源系统编码', { exact: true }).fill(sourceCode);
    await filters.getByRole('button', { name: '应用筛选', exact: true }).click();
    const pagination = section.getByRole('navigation', { name: '接收记录分页', exact: true });
    await pagination.getByRole('combobox', { name: '每页条数', exact: true }).selectOption('1000');
    await expect(section.locator('tbody tr[data-row-key]')).toHaveCount(1000);
    await section.getByRole('checkbox', { name: '选择当前页', exact: true }).check();
    const actions = section.getByRole('toolbar', { name: '已选接收记录', exact: true });
    await expect(actions).toContainText('1000');
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    const desktopBox = await actions.boundingBox();
    expect(desktopBox!.y + desktopBox!.height).toBeLessThanOrEqual(800);
    await page.setViewportSize({ width: 390, height: 700 });
    const mobileBox = await actions.boundingBox();
    expect(mobileBox!.x).toBeGreaterThanOrEqual(0);
    expect(mobileBox!.x + mobileBox!.width).toBeLessThanOrEqual(390);
    expect(mobileBox!.y + mobileBox!.height).toBeLessThanOrEqual(700);
    await actions.getByRole('button', { name: '删除所选', exact: true }).click();
    const confirmation = page.getByRole('dialog', { name: '删除接收记录', exact: true });
    await expect(confirmation).toContainText('1000');
    const removed = page.waitForResponse(response => new URL(response.url()).pathname === receiptsPath && response.request().method() === 'DELETE');
    await confirmation.getByRole('button', { name: '删除', exact: true }).click();
    expect((await removed).status()).toBe(200);
    await expect(actions).toHaveCount(0);
    expect(await prisma.integrationReceipt.count({ where: { endpointId: endpoint.id } })).toBe(0);
  } finally {
    await prisma.$transaction(async transaction => {
      const remaining = await transaction.integrationReceipt.count({ where: { endpointId: endpoint.id } });
      await transaction.integrationReceipt.deleteMany({ where: { endpointId: endpoint.id } });
      if (accounted && remaining) await transaction.integrationScopeCapacity.update({ where: { organizationId: organization.id }, data: { receiptCount: { decrement: remaining } } });
      await transaction.integrationCredential.delete({ where: { id: credential.id } });
      await transaction.integrationEndpoint.delete({ where: { id: endpoint.id } });
    });
  }
});

test('real management pages keep first content compact on desktop and narrow screens', async ({ page }) => {
  page.on('pageerror', error => console.error('Management page runtime error:', error.message));
  await openIntegrations(page);
  for (const viewport of [{ width: 1440, height: 800 }, { width: 390, height: 700 }]) {
    await page.setViewportSize(viewport);
    for (const path of ['/console/users', '/console/configuration']) {
      if (viewport.width <= 760) await page.getByRole('button', { name: '打开管理导航', exact: true }).click();
      const navigation = viewport.width <= 760 ? page.getByRole('dialog', { name: '管理导航', exact: true }) : page.locator('.qms-console-sidebar');
      await navigation.locator(`a[href="${path}"]`).click();
      await page.waitForURL(url => url.pathname === path);
      const firstContent = page.locator(path.endsWith('/users') ? 'main > .admin-toolbar' : 'main > .governance-panel').first();
      await expect(firstContent, `${path}: ${(await page.locator('body').innerText()).slice(0, 1200)}`).toBeVisible();
      const spacing = await firstContent.evaluate(element => ({ top: element.getBoundingClientRect().top, mainTop: element.closest('main')!.getBoundingClientRect().top, margin: getComputedStyle(element).marginTop, padding: getComputedStyle(element).paddingTop }));
      expect(spacing.top - spacing.mainTop).toBeGreaterThanOrEqual(12);
      expect(spacing.top - spacing.mainTop).toBeLessThanOrEqual(16);
      if (path.endsWith('/users')) expect(spacing.margin).toBe('0px');
      else expect(spacing.padding).toBe('0px');
    }
  }
});
