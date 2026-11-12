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
  const marker = await prisma.permission.findUniqueOrThrow({ where: { code: 'platform:admin' } });
  const where = { roleId_permissionId: { roleId: fixtureRoleId, permissionId: marker.id } };
  if (!await prisma.rolePermission.findUnique({ where })) {
    await prisma.rolePermission.create({ data: where.roleId_permissionId });
    addedPermissionIds.push(marker.id);
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
  expect(response.status).toBe(201);
  return await response.json() as Schema['InboundReceiptDto'];
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

    const first = await sendMessage(endpoint.code, credential.secret!, bodyOne);
    const second = await sendMessage(endpoint.code, credential.secret!, bodyTwo);
    const third = await sendMessage(endpoint.code, credential.secret!, bodyThree);
    fixtureReceiptIds.push(first.receiptId, second.receiptId, third.receiptId);
    const stored = await prisma.integrationReceipt.findMany({ where: { id: { in: fixtureReceiptIds } }, orderBy: { receivedAt: 'asc' } });
    expect(stored).toHaveLength(3);
    firstPayloadBytes = stored.find(item => item.id === first.receiptId)!.payloadBytes;
    secondPayloadBytes = stored.find(item => item.id === second.receiptId)!.payloadBytes;
    thirdPayloadBytes = stored.find(item => item.id === third.receiptId)!.payloadBytes;
    const attemptsBefore = await prisma.integrationRequestAttempt.count({ where: { endpointId: endpoint.id, receiptId: { in: fixtureReceiptIds } } });
    expect(attemptsBefore).toBe(3);
    capacityBefore = (await positionRead<Schema['IntegrationOperationDto']>(page.request, `/api/v1/admin/integrations/status?organizationId=${endpoint.organizationId}`)).usedBodyBytes;

    await section.getByRole('tab', { name: '接收记录', exact: true }).click();
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
