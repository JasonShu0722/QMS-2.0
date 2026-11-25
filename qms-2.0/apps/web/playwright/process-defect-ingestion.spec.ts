import { randomUUID } from 'node:crypto';
import { createServer, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import type { components } from '@qms/contracts';
import { completeMfa } from './mfa-login';
import { positionRead, positionWrite } from './position-fixture';
import { fillSecret } from './secret-input';

type Schema = components['schemas'];
const baseURL = process.env.QMS_ACCEPTANCE_BASE_URL;
const databaseURL = process.env.DATABASE_URL;
const password = process.env.QMS_SEED_INTERNAL_PASSWORD;
if (!baseURL || !databaseURL || !password || !process.env.QMS_ACCEPTANCE_MFA_CACHE_FILE || !process.env.QMS_BACKUP_KEY
  || process.env.QMS_DISPOSABLE_TEST_DB !== 'true' || process.env.QMS_ACCEPTANCE_DISPOSABLE_DATABASE !== 'true') {
  throw new Error('Process ingestion acceptance requires disposable PostgreSQL, gateway and external encrypted MFA credentials.');
}
for (const value of [baseURL, databaseURL]) {
  const url = new URL(value);
  if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.port === '55440' || url.search || url.hash) {
    throw new Error('Only disposable loopback resources outside preserved preview 55440 are allowed.');
  }
}
const requireApi = createRequire(new URL('../../api/package.json', import.meta.url));
const { PrismaPg } = requireApi('@prisma/adapter-pg');
const { PrismaClient } = await import('../../api/dist/generated/prisma/client.js');
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseURL }) });
const suffix = randomUUID().replaceAll('-', '').slice(0, 10).toUpperCase();
const ingestion = '/api/v1/admin/integrations/ingestion';
let fixtureRoleId: string;
let addedPermissionId: string | undefined;

test.setTimeout(240_000);
test.use({ trace: 'off', screenshot: 'off', video: 'off', actionTimeout: 15_000, navigationTimeout: 20_000 });
test.beforeAll(async () => {
  const organization = await prisma.organization.findUniqueOrThrow({ where: { code: 'LOCAL-INTERNAL' } });
  const user = await prisma.user.findUniqueOrThrow({ where: { organizationId_username: { organizationId: organization.id, username: 'local.internal' } } });
  fixtureRoleId = (await prisma.userRole.findFirstOrThrow({ where: { organizationId: organization.id, userId: user.id, role: { code: 'LOCAL_MEMBER' } } })).roleId;
  const permission = await prisma.permission.findUniqueOrThrow({ where: { code: 'platform:admin' } });
  const where = { roleId_permissionId: { roleId: fixtureRoleId, permissionId: permission.id } };
  if (!await prisma.rolePermission.findUnique({ where })) {
    await prisma.rolePermission.create({ data: where.roleId_permissionId });
    addedPermissionId = permission.id;
  }
});
test.afterAll(async () => {
  try {
    if (addedPermissionId) await prisma.rolePermission.deleteMany({ where: { roleId: fixtureRoleId, permissionId: addedPermissionId } });
  } finally { await prisma.$disconnect(); }
});

async function login(page: Page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/login');
  await page.getByLabel('账号', { exact: true }).fill('local.internal');
  await fillSecret(page.getByLabel('密码', { exact: true }), password!);
  const response = page.waitForResponse(entry => new URL(entry.url()).pathname === '/api/v1/auth/login' && entry.request().method() === 'POST');
  const [authenticated] = await Promise.all([response, page.getByRole('button', { name: '登录', exact: true }).click()]);
  await completeMfa(page.request, authenticated, 'local.internal', page);
  await expect(page).toHaveURL(/\/app\/workbench$/);
}

async function worker() {
  const result = await promisify(execFile)(process.execPath, ['dist/worker.js', '--once'], {
    cwd: fileURLToPath(new URL('../../api/', import.meta.url)), windowsHide: true, timeout: 45_000,
    env: { ...process.env, NODE_ENV: 'test', QMS_WORKER_BATCH_SIZE: '100', NODE_OPTIONS: '--max-old-space-size=512' },
  });
  expect(result.stdout).toContain('QMS_WORKER_READY');
  expect(result.stderr).not.toContain('QMS_WORKER_FAILED');
}

test('keeps the selection column fixed and shows named maintenance history in the defect drawer', async ({ page }) => {
  await login(page);
  const organization = await prisma.organization.findUniqueOrThrow({ where: { code: 'LOCAL-INTERNAL' } });
  const user = await prisma.user.findUniqueOrThrow({ where: { organizationId_username: { organizationId: organization.id, username: 'local.internal' } } });
  const description = `POLISH172-${suffix}`;
  await prisma.processDefect.create({ data: { organizationId: organization.id, occurredAt: new Date(), description, productCode: description,
    createdById: user.id, updatedById: user.id } });
  await page.goto('/app/process-quality');
  const ledger = page.locator('.process-quality-ledger');
  await page.getByLabel('搜索制程不良').fill(description);
  await page.getByLabel('搜索制程不良').press('Enter');
  const selected = ledger.getByRole('checkbox', { name: `选择制程不良 ${description}` });
  await expect(selected).toBeVisible();
  await expect(ledger.getByRole('columnheader', { name: '明细' })).toHaveCount(0);
  await expect(ledger.getByRole('columnheader', { name: '分析进度' })).toHaveCount(0);
  const initialX = (await selected.boundingBox())!.x;
  const scroll = ledger.locator('.ant-table-content, .ant-table-body').first();
  await scroll.evaluate(element => { element.scrollLeft = element.scrollWidth; });
  await expect.poll(() => scroll.evaluate(element => element.scrollLeft)).toBeGreaterThan(0);
  expect(Math.abs((await selected.boundingBox())!.x - initialX)).toBeLessThan(2);
  await selected.check();
  await selected.uncheck();
  await scroll.evaluate(element => { element.scrollLeft = 0; });
  await ledger.getByRole('button', { name: description, exact: true }).click();
  const detail = page.getByRole('dialog', { name: '不良品详情' });
  await expect(detail.getByText('附件', { exact: true })).toBeVisible();
  await expect(detail.getByRole('table', { name: '更新记录' })).toContainText('暂无更新记录');
  await detail.getByRole('button', { name: '分析进度维护', exact: true }).click();
  const analysis = page.getByRole('dialog', { name: '分析进度维护' });
  await analysis.getByRole('textbox').fill('已核对产线异常');
  await analysis.getByRole('button', { name: '保存维护' }).click();
  await expect(detail.getByText('已核对产线异常')).toBeVisible();
  await expect(detail.getByRole('table', { name: '更新记录' })).toContainText('更新分析进度');
  if (user.fullName) await expect(detail.getByRole('table', { name: '更新记录' })).toContainText(user.fullName);
});

test('centers filter labels and filters product type on the server', async ({ page }) => {
  await login(page);
  const organization = await prisma.organization.findUniqueOrThrow({ where: { code: 'LOCAL-INTERNAL' } });
  const user = await prisma.user.findUniqueOrThrow({ where: { organizationId_username: { organizationId: organization.id, username: 'local.internal' } } });
  const fixture = `FILTER165-${randomUUID().slice(0, 8)}`;
  await prisma.processDefect.createMany({ data: ['MCU', 'BMS'].map(productCategory => ({
    organizationId: organization.id, occurredAt: new Date(), description: `${fixture} ${productCategory}`,
    productCode: fixture, productCategory, defectQuantity: 1, createdById: user.id, updatedById: user.id,
  })) });
  await page.goto('/app/process-quality');
  const ledger = page.locator('.process-quality-ledger');
  const search = page.getByLabel('搜索制程不良');
  const rows = ledger.locator('tbody tr[data-row-key]');
  await search.fill(fixture);
  await search.press('Enter');
  await expect(rows).toHaveCount(2);

  const quantity = ledger.getByRole('columnheader', { name: '不良数量', exact: true });
  const measure = () => ledger.locator('th:has(.process-quality-filter-title)').evaluateAll(headers => headers.map(header => {
    const label = header.querySelector('.process-quality-filter-title > span')!;
    const filter = header.querySelector('.process-quality-filter-title > button')!;
    const cell = header.getBoundingClientRect();
    const text = label.getBoundingClientRect();
    const button = filter.getBoundingClientRect();
    return { label: label.textContent, offset: Math.abs((cell.left + cell.right - text.left - text.right) / 2),
      labelRight: text.right, buttonLeft: button.left, buttonRight: button.right, cellRight: cell.right };
  }));
  const assertAligned = async () => {
    await expect.poll(async () => (await measure()).filter(({ offset, labelRight, buttonLeft, buttonRight, cellRight }) =>
      offset > 1.5 || labelRight > buttonLeft + 0.5 || buttonRight > cellRight + 0.5).map(({ label, offset }) => ({ label, offset }))).toEqual([]);
  };
  await assertAligned();
  await expect.poll(async () => (await quantity.boundingBox())?.width ?? Infinity).toBeLessThan(96);
  const slider = page.getByRole('slider', { name: '横向滚动台账' });
  await expect(slider).toBeInViewport();
  await slider.press('End');
  const quantityFilter = quantity.getByRole('button', { name: '按不良数量筛选' });
  await quantityFilter.focus();
  await quantityFilter.press('Enter');
  const dialog = page.getByRole('dialog', { name: '筛选面板' });
  await expect(dialog.getByLabel('筛选字段 1')).toHaveValue('defectQuantity');
  await dialog.getByLabel('筛选字段 1').press('Escape');
  await expect(quantityFilter).toBeFocused();
  const grip = quantity.getByRole('separator');
  const original = await grip.getAttribute('aria-valuenow');
  await grip.press('ArrowRight');
  await expect(grip).not.toHaveAttribute('aria-valuenow', original!);
  await assertAligned();
  await slider.press('Home');

  const product = ledger.getByRole('button', { name: '按产品类型筛选' });
  await product.click();
  await expect(dialog.getByLabel('筛选字段 1')).toHaveValue('productCategory');
  await dialog.getByLabel('筛选运算符 1').selectOption('EQ');
  await dialog.getByLabel('筛选值 1').fill('MCU');
  await dialog.getByRole('button', { name: '应用筛选' }).click();
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText(`${fixture} MCU`);
  await expect(product).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: '筛选条件', exact: true }).click();
  await expect(dialog.getByLabel('筛选值 1')).toHaveValue('MCU');
  await dialog.getByRole('button', { name: '删除筛选条件 1' }).click();
  await dialog.getByRole('button', { name: '应用筛选' }).click();
  await expect(rows).toHaveCount(2);

  const chromium = await page.context().newCDPSession(page);
  await chromium.send('Emulation.setTouchEmulationEnabled', { enabled: true });
  await page.setViewportSize({ width: 390, height: 780 });
  await expect.poll(() => page.evaluate(() => matchMedia('(pointer: coarse)').matches)).toBe(true);
  await assertAligned();
  await expect(slider).toBeInViewport();
  await product.scrollIntoViewIfNeeded();
  await expect(product).toHaveCSS('opacity', '1');
  await product.click();
  await expect(dialog.getByLabel('筛选字段 1')).toHaveValue('productCategory');
});

test('administrator imports incomplete IMS rows and real Worker fills only missing mappings while preserving stage', async ({ page }) => {
  await login(page);
  await page.goto('/console/api-ingestion');
  await expect(page.getByRole('button', { name: '新增规则', exact: true })).toBeVisible();
  let endpoint = await positionWrite<Schema['IntegrationEndpointDto']>(page.request, '/api/v1/admin/integrations/endpoints', 'POST', {
    code: `PD_${suffix}`, name: `制程验收${suffix}`, sourceCode: 'IMS', sourceName: 'IMS一次性验收', returnReceipt: true,
  }, 201);
  const credential = await positionWrite<Schema['IntegrationCredentialDto']>(page.request, `/api/v1/admin/integrations/endpoints/${endpoint.id}/credentials`, 'POST', { name: '制程一次性凭据', validityDays: null }, 201);
  endpoint = await positionWrite<Schema['IntegrationEndpointDto']>(page.request, `/api/v1/admin/integrations/endpoints/${endpoint.id}`, 'PATCH', { expectedVersion: endpoint.version, status: 'ENABLED' });
  await page.reload();
  await page.getByRole('button', { name: '新增规则', exact: true }).click();
  const editor = page.getByRole('dialog', { name: '新增入库规则', exact: true });
  await editor.getByLabel('规则名称', { exact: true }).fill(`界面制程规则${suffix}`);
  await editor.getByLabel('接收接口', { exact: true }).click();
  await page.locator('.ant-select-dropdown:visible .ant-select-item-option').filter({ hasText: endpoint.name }).click();
  await editor.getByLabel('目标档案', { exact: true }).click();
  await page.locator('.ant-select-dropdown:visible .ant-select-item-option').filter({ hasText: '制程不良品台账' }).click();
  await editor.getByLabel('成品编码来源字段', { exact: true }).fill('PRODUCT');
  await editor.getByLabel('不良描述来源字段', { exact: true }).fill('FAULT');
  await editor.getByRole('button', { name: /^保\s*存$/ }).click();
  await expect(editor.getByLabel('工厂来源字段', { exact: true })).toBeVisible();
  await editor.getByLabel('工厂来源字段', { exact: true }).fill('source.plant');
  const ruleSaved = page.waitForResponse(response => new URL(response.url()).pathname === `${ingestion}/rules` && response.request().method() === 'POST');
  await editor.getByRole('button', { name: /^保\s*存$/ }).click();
  expect((await ruleSaved).status()).toBe(201);
  await expect(editor).toHaveCount(0);
  await positionWrite<Schema['IngestionRuleDto']>(page.request, `${ingestion}/rules`, 'POST', {
    name: `制程规则${suffix}`, endpointId: endpoint.id, target: 'PROCESS_DEFECT', enabled: true, match: 'ALL', conditions: [],
    mapping: { externalRecordKey: 'ID', occurredAt: 'TIME', productCode: 'PRODUCT', traceCode: 'TRACE', operationName: 'OPERATION', lineName: 'LINE', factoryCode: 'source.plant' },
    descriptionComposition: { fields: [{ path: 'FAULT', label: '现象：' }, { path: 'NOTE', label: '说明：' }], separator: '\n' },
    mode: 'UPDATE', updateFields: ['description'], sourceTimezone: 'Asia/Shanghai',
  } satisfies Schema['SaveIngestionRuleDto'], 201);
  async function send(rows: object[]) {
    const response = await fetch(new URL(`/api/v1/integrations/inbound/${endpoint.code}/messages`, baseURL), {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15_000),
      headers: { Authorization: `Bearer ${credential.secret}`, 'Content-Type': 'application/json' }, body: JSON.stringify(rows),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toBe(true);
  }
  const productCode = `CMP_${suffix}`;
  const month = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit' }).format(new Date());
  await send([
    { ID: `FIRST_${suffix}`, TIME: `${month}-01T08:30:00+08:00`, PRODUCT: productCode, TRACE: `T_${suffix}`, OPERATION: `焊接${suffix}`, FAULT: suffix, NOTE: '完整行', source: { plant: 1 } },
    { ID: `SECOND_${suffix}`, PRODUCT: productCode, OPERATION: `焊接${suffix}`, FAULT: suffix, source: { plant: 'unexpected' } },
  ]);
  await worker();
  const list = await positionRead<Schema['ProcessDefectPageDto']>(page.request, `/api/v1/process-quality/defects?page=1&pageSize=20&search=${suffix}`);
  expect(list.items).toHaveLength(2);
  const first = list.items.find(item => item.externalRecordKey === `FIRST_${suffix}`)!;
  const incomplete = list.items.find(item => item.externalRecordKey === `SECOND_${suffix}`)!;
  expect(first).toMatchObject({ sourceKind: 'IMS', factoryCode: 'FACTORY_1', defectQuantity: 1, shift: 'DAY', pendingConfiguration: true });
  expect(first.description).toBe(`现象：${suffix}\n说明：完整行`);
  expect(incomplete).toMatchObject({ pendingCompletion: true, occurredAt: null, traceCode: null, factoryCode: null });
  const partlyUpdated = await positionWrite<Schema['ProcessDefectDto']>(page.request, `/api/v1/process-quality/defects/${incomplete.id}`, 'PUT', { expectedVersion: incomplete.version, traceCode: `FIX_${suffix}` });
  expect(partlyUpdated.pendingCompletion).toBe(true);
  const project = await positionWrite<Schema['ComponentProjectRecordDto']>(page.request, '/api/v1/admin/configuration/component-project-records', 'POST', { code: `PROJECT_${suffix}`, name: '登记时新品项目', stage: 'NEW_PRODUCT' }, 201);
  await positionWrite(page.request, '/api/v1/admin/configuration/component-project-mappings', 'POST', { componentCode: productCode, componentName: '验收成品', projectRecordId: project.id, productCategory: '控制器', productSubcategory: '细分控制器' }, 201);
  await positionWrite(page.request, '/api/v1/process-quality/operation-sectors', 'POST', { operationCode: `OP_${suffix}`, operationName: `焊接${suffix}`, sectorName: '电子板块' }, 201);
  await expect.poll(async () => {
    await worker();
    return (await positionRead<Schema['ProcessDefectDto']>(page.request, `/api/v1/process-quality/defects/${first.id}`)).pendingConfiguration;
  }, { timeout: 80_000, intervals: [1000, 5000, 10000], message: 'The real completion Worker retries pending mappings within its one-minute scheduling interval' }).toBe(false);
  const associated = await positionRead<Schema['ProcessDefectDto']>(page.request, `/api/v1/process-quality/defects/${first.id}`);
  expect(associated).toMatchObject({ projectStage: 'NEW_PRODUCT', productSubcategory: '细分控制器', operationSector: '电子板块', pendingConfiguration: false });
  await positionWrite(page.request, `/api/v1/admin/configuration/component-project-records/${project.id}`, 'PATCH', { expectedVersion: project.version, stage: 'MASS_PRODUCTION' });
  await worker();
  expect(await positionRead<Schema['ProcessDefectDto']>(page.request, `/api/v1/process-quality/defects/${first.id}`)).toMatchObject({ projectStage: 'NEW_PRODUCT' });
  await page.goto('/app/process-quality');
  const toolbar = page.getByRole('group', { name: '台账工具栏' });
  await expect(toolbar.getByRole('button', { name: '登记不良', exact: true })).toBeVisible();
  await expect(toolbar.getByRole('button', { name: '发起 8D', exact: true })).toHaveCount(1);
  const search = toolbar.getByLabel('搜索制程不良');
  await search.fill(suffix);
  await search.press('Enter');
  const selected = page.getByRole('checkbox', { name: `选择制程不良 现象：${suffix} 说明：完整行` });
  await expect(selected).toBeVisible();
  await expect(page.getByRole('checkbox', { name: `选择制程不良 现象：${suffix}`, exact: true })).toHaveCount(0);
  const selectionBar = page.getByRole('toolbar', { name: '台账批量操作' });
  const shiftHeader = page.getByRole('columnheader', { name: '班次', exact: true });
  const factoryHeader = page.getByRole('columnheader', { name: '工厂', exact: true });
  await expect(factoryHeader).toBeVisible();
  expect((await factoryHeader.boundingBox())!.x).toBeLessThan((await shiftHeader.boundingBox())!.x);
  await expect(page.getByRole('row').filter({ has: selected }).getByRole('cell', { name: '一工厂', exact: true })).toBeVisible();
  const scrollbar = page.getByRole('slider', { name: '横向滚动台账' });
  const tableBody = page.locator('.process-quality-ledger .ant-table-body').first();
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 740 });
    await expect(scrollbar).toBeInViewport();
    await expect.poll(async () => {
      const box = await scrollbar.boundingBox();
      return box ? Math.abs(740 - box.y - box.height) : Infinity;
    }).toBeLessThanOrEqual(12);
    const start = await tableBody.evaluate(element => element.scrollLeft);
    await scrollbar.press('End');
    await expect.poll(() => tableBody.evaluate(element => element.scrollLeft)).toBeGreaterThan(start);
    await scrollbar.press('Home');
    await expect.poll(() => tableBody.evaluate(element => element.scrollLeft)).toBe(0);
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  const projectHeader = page.getByRole('columnheader', { name: '项目号', exact: true });
  await expect(shiftHeader.locator('.qms-ledger__grip')).toHaveCount(0);
  const shift = (await shiftHeader.boundingBox())!;
  const projectBox = (await projectHeader.boundingBox())!;
  await page.mouse.move(shift.x + 8, shift.y + shift.height / 2);
  await page.mouse.down();
  await page.mouse.move(projectBox.x + projectBox.width / 2, projectBox.y + projectBox.height / 2, { steps: 8 });
  await page.mouse.up();
  await expect.poll(async () => (await shiftHeader.boundingBox())!.x).toBeGreaterThan(projectBox.x);
  const narrow = shiftHeader.getByRole('separator');
  await narrow.focus();
  const minimum = await narrow.getAttribute('aria-valuemin');
  for (let i = 0; i < 12; i++) await narrow.press('ArrowLeft');
  await expect(narrow).toHaveAttribute('aria-valuenow', minimum!);
  const titleFits = await shiftHeader.locator('.process-quality-filter-title').evaluate(title => title.getBoundingClientRect().right <= title.closest('th')!.getBoundingClientRect().right);
  expect(titleFits).toBe(true);
  const headerTop = (await shiftHeader.boundingBox())!.y;
  await selected.check();
  await expect(selectionBar.getByRole('button', { name: '删除所选' })).toBeVisible();
  expect((await shiftHeader.boundingBox())!.y).toBe(headerTop);
  await search.fill(`${suffix}-draft`);
  await shiftHeader.getByRole('button', { name: '按班次筛选' }).click();
  const filter = page.getByRole('dialog', { name: '筛选面板' });
  await expect(filter.getByLabel('筛选字段 1')).toHaveValue('shift');
  await filter.getByLabel('筛选字段 1').press('Escape');
  await expect(filter).toHaveCount(0);
  await expect(selected).toBeChecked();
  await expect(search).toHaveValue(`${suffix}-draft`);
  await page.getByRole('button', { name: '按发生时间筛选' }).click();
  await expect(filter.getByLabel('筛选字段 1')).toBeFocused();
  await filter.getByLabel('筛选运算符 1').selectOption('EQ');
  await filter.getByLabel('筛选值 1').fill(`${month}-01`);
  await filter.getByRole('button', { name: '添加筛选条件' }).click();
  await filter.getByLabel('筛选值 2').fill('完整行');
  await shiftHeader.click({ position: { x: 5, y: 5 } });
  await expect(filter).toHaveCount(0);
  await expect(selected).toBeVisible();
  await expect(selectionBar).toHaveCount(0);
  await expect(search).toHaveValue(`${suffix}-draft`);
  await toolbar.getByRole('button', { name: '筛选条件' }).click();
  await filter.getByRole('button', { name: '添加筛选条件' }).click();
  await filter.getByLabel('筛选字段 3').selectOption('description');
  await filter.getByLabel('筛选值 3').fill('现象');
  const outsideResize = page.getByRole('columnheader', { name: '发生时间', exact: true }).getByRole('separator');
  const previousWidth = await outsideResize.getAttribute('aria-valuenow');
  const edge = (await outsideResize.boundingBox())!;
  expect(await outsideResize.evaluate(handle => {
    const bounds = handle.getBoundingClientRect();
    return handle.contains(document.elementFromPoint(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2));
  }), 'the column resize handle must be outside the open filter').toBe(true);
  await page.mouse.move(edge.x + edge.width / 2, edge.y + edge.height / 2);
  await page.mouse.down();
  await page.mouse.move(edge.x + edge.width / 2 + 25, edge.y + edge.height / 2, { steps: 4 });
  await page.mouse.up();
  await expect(filter).toHaveCount(0);
  await expect(outsideResize).not.toHaveAttribute('aria-valuenow', previousWidth!);
  await toolbar.getByRole('button', { name: '筛选条件' }).click();
  await expect(filter.getByLabel('筛选值 3')).toHaveValue('现象');
  await filter.getByRole('button', { name: '删除筛选条件 3' }).click();
  await filter.getByRole('button', { name: '关闭筛选' }).click();
  await page.reload();
  await expect(search).toHaveValue(suffix);
  await toolbar.getByRole('button', { name: '筛选条件' }).click();
  await expect(filter.getByLabel('筛选值 1')).toHaveValue(`${month}-01`);
  await expect(filter.getByLabel('筛选值 2')).toHaveValue('完整行');
  for (const width of [1440, 1024, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await expect.poll(() => page.evaluate(() => {
      const { clientWidth, scrollWidth } = document.documentElement;
      return scrollWidth <= clientWidth + 1 ? [] : [{ clientWidth, scrollWidth }, ...Array.from(document.querySelectorAll('.ant-popover, body > div, .process-quality-filter-panel, .process-quality-toolbar-main, .process-quality-compact-ledger')).flatMap(element => {
        const { left, right } = element.getBoundingClientRect();
        return right > clientWidth + 1 ? [{ className: element.className, left, right, clientWidth, scrollWidth }] : [];
      })];
    }), { message: `Filter must fit at ${width}px` }).toEqual([]);
    await expect(filter.getByRole('button', { name: '应用筛选' })).toBeInViewport();
    if (process.env.QMS_ACCEPTANCE_ARTIFACT_DIRECTORY) await page.screenshot({ path: `${process.env.QMS_ACCEPTANCE_ARTIFACT_DIRECTORY}/process-defects-${width}.png` });
  }
  await filter.getByRole('button', { name: '恢复系统默认筛选' }).click();
  await expect(search).toHaveValue('');
  await toolbar.getByRole('button', { name: '筛选条件' }).click();
  await expect(filter.getByLabel('仅当前自然月（北京时间）')).toBeChecked();
  await expect(filter.getByLabel('筛选字段 1')).toHaveCount(0);
  await filter.getByLabel('筛选逻辑').selectOption('ANY');
  await filter.getByRole('button', { name: '应用筛选' }).click();
  await expect(page.getByRole('checkbox', { name: '选择当前页制程不良' })).toBeEnabled();
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 780 });
    await selected.check();
    await expect(selectionBar.getByRole('button', { name: '取消选择' })).toBeInViewport();
    const pagination = page.locator('.process-quality-ledger .ant-pagination');
    await pagination.scrollIntoViewIfNeeded();
    expect((await pagination.boundingBox())!.y + (await pagination.boundingBox())!.height).toBeLessThan((await selectionBar.boundingBox())!.y);
    await selectionBar.getByRole('button', { name: '取消选择' }).click();
    await expect(selectionBar).toHaveCount(0);
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await toolbar.getByRole('button', { name: '筛选条件' }).click();
  await filter.getByRole('button', { name: '添加筛选条件' }).click();
  await filter.getByLabel('筛选值 1').fill(suffix);
  const workbench = page.getByRole('link', { name: '综合工作台', exact: true }).first();
  await workbench.focus();
  await expect(filter).toHaveCount(0);
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/app\/workbench$/);
  await page.goBack();
  await expect(toolbar.getByRole('button', { name: '筛选条件' })).toHaveAttribute('aria-expanded', 'false');
  await toolbar.getByRole('button', { name: '筛选条件' }).click();
  await expect(filter.getByLabel('筛选值 1')).toHaveValue(suffix);
  await filter.getByRole('button', { name: '关闭筛选' }).click();
  const descriptionFilter = page.getByRole('button', { name: '按不良描述筛选' });
  await descriptionFilter.click();
  await filter.getByLabel('筛选值 1').fill('有效但应放弃的条件');
  const restoreDefault = filter.getByRole('button', { name: '恢复系统默认筛选' });
  await restoreDefault.press('Enter');
  await expect(descriptionFilter).toBeFocused();
  await toolbar.getByRole('button', { name: '筛选条件' }).click();
  await expect(filter.getByLabel('仅当前自然月（北京时间）')).toBeChecked();
  await expect(filter.getByLabel('筛选字段 1')).toHaveCount(0);
});

test('manual registration retains the trace draft after closing the camera and saves the default quantity', async ({ page }) => {
  await login(page);
  await page.goto('/app/process-quality');
  await page.getByRole('button', { name: '登记不良', exact: true }).click();
  const drawer = page.getByRole('dialog', { name: '登记不良', exact: true });
  await expect(drawer.getByRole('spinbutton', { name: /不良数量$/ })).toHaveValue('1');
  await drawer.getByLabel(/发生时间$/).fill('2026-11-16T08:30');
  await drawer.getByLabel(/成品编码$/).fill(`MANUAL_${suffix}`);
  await drawer.getByLabel('追溯码', { exact: true }).fill(`SCAN_${suffix}`);
  await drawer.getByLabel(/不良描述$/).fill(`现场登记${suffix}`);
  await drawer.getByRole('button', { name: '手机扫码', exact: true }).click();
  const scanner = page.getByRole('dialog', { name: '扫描追溯码', exact: true });
  await expect(scanner).toBeVisible();
  await scanner.getByRole('button', { name: '返回手动输入', exact: true }).click();
  await expect(scanner).toHaveCount(0);
  await expect(drawer.getByLabel('追溯码', { exact: true })).toHaveValue(`SCAN_${suffix}`);
  await drawer.getByRole('button', { name: '保存登记', exact: true }).click();
  await expect(drawer.getByText('请选择工厂', { exact: true })).toBeVisible();
  await drawer.getByLabel('工厂', { exact: true }).click();
  await page.locator('.ant-select-dropdown:visible .ant-select-item-option').filter({ hasText: '二工厂' }).click();
  const saved = page.waitForResponse(response => new URL(response.url()).pathname === '/api/v1/process-quality/defects' && response.request().method() === 'POST');
  await drawer.getByRole('button', { name: '保存登记', exact: true }).click();
  const response = await saved;
  expect(response.status()).toBe(201);
  expect(await response.json()).toMatchObject({ sourceKind: 'MANUAL', factoryCode: 'FACTORY_2', defectQuantity: 1, shift: 'DAY' });
});

test('maintains a closed ledger through the disposition and analysis boards', async ({ page }) => {
  await login(page);
  await page.goto('/app/process-quality');
  const defects = '/api/v1/process-quality/defects';
  const description = `板块维护 ${suffix}`;
  const now = new Date();
  const localTime = new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
  await page.getByRole('button', { name: '登记不良', exact: true }).click();
  const registration = page.getByRole('dialog', { name: '登记不良', exact: true });
  await registration.getByLabel(/发生时间$/).fill(localTime);
  await registration.getByLabel(/成品编码$/).fill(`BOARD_${suffix}`);
  await registration.getByLabel('追溯码', { exact: true }).fill(`BOARD_TRACE_${suffix}`);
  await registration.getByLabel(/不良描述$/).fill(description);
  await registration.getByLabel('工厂', { exact: true }).click();
  await page.locator('.ant-select-dropdown:visible .ant-select-item-option').filter({ hasText: '一工厂' }).click();
  const creating = page.waitForResponse(response => new URL(response.url()).pathname === defects && response.request().method() === 'POST');
  await registration.getByRole('button', { name: '保存登记', exact: true }).click();
  const created = await creating;
  expect(created.status()).toBe(201);
  const requestBody = created.request().postDataJSON();
  for (const field of ['analysisProgress', 'responsibilityCategory', 'materials']) expect(requestBody).not.toHaveProperty(field);
  const record = await created.json() as Schema['ProcessDefectDto'];
  await registration.getByRole('button', { name: '关闭', exact: true }).click();

  async function saveBoard(name: string, board: Schema['BulkMaintainProcessDefectsDto']['board'], source: Schema['BulkMaintainProcessDefectsDto']['sources'][number]) {
    const saving = page.waitForResponse(response => new URL(response.url()).pathname === `${defects}/bulk-maintenance` && response.request().method() === 'PATCH');
    const dialog = page.getByRole('dialog', { name, exact: true });
    await dialog.getByRole('button', { name: '保存维护', exact: true }).click();
    const response = await saving;
    expect(response.status()).toBe(200);
    expect(response.request().postDataJSON()).toEqual({ organizationId: record.organizationId, board, sources: [source] });
    const result = await response.json() as Schema['BulkMaintainProcessDefectsResultDto'];
    await expect(dialog).toHaveCount(0);
    return result.items[0]!;
  }

  await page.getByRole('button', { name: description, exact: true }).click();
  const detail = page.getByRole('dialog', { name: '不良品详情', exact: true });
  await detail.getByRole('button', { name: '问题关闭', exact: true }).click();
  const closure = page.getByRole('dialog', { name: '关闭判定', exact: true });
  const reason = '现场确认可以关闭';
  await closure.getByLabel('关闭说明', { exact: true }).fill(reason);
  const closed = await saveBoard('关闭判定', 'CLOSURE', { defectId: record.id, expectedVersion: record.version, fields: { status: 'CLOSED', reason } });
  expect(closed).toMatchObject({ ledgerStatus: 'CLOSED', dispositionCompletedAt: null });

  await detail.getByRole('button', { name: '处置维护', exact: true }).click();
  const disposition = page.getByRole('dialog', { name: '处置维护', exact: true });
  await disposition.getByRole('radio', { name: '报废', exact: true }).check();
  await disposition.getByLabel('处置进度', { exact: true }).fill('已报废');
  await disposition.getByRole('button', { name: '填写完成时间', exact: true }).click();
  const completionTime = disposition.getByLabel('完成时间', { exact: true });
  await expect(completionTime).not.toHaveValue('');
  await completionTime.fill(localTime);
  const disposed = await saveBoard('处置维护', 'DISPOSITION', { defectId: record.id, expectedVersion: closed.version, fields: { dispositionPlan: 'SCRAP', dispositionProgress: '已报废', dispositionCompletedAt: new Date(localTime).toISOString() } });
  expect(disposed).toMatchObject({ ledgerStatus: 'CLOSED', dispositionPlan: 'SCRAP' });

  const materialBatch = `BATCH_${suffix}`;
  const materialCode = `MATERIAL_${suffix}`;
  const supplier = await prisma.supplierBusinessProfile.create({ data: { ownerOrganizationId: record.organizationId,
    businessCode: `SUP_${suffix}`, displayName: `制程测试供应商 ${suffix}` } });
  await page.reload();
  await page.getByRole('button', { name: description, exact: true }).click();
  const responsibility = page.getByRole('dialog', { name: '责任判定', exact: true });
  await detail.getByRole('button', { name: '责任判定', exact: true }).click();
  await responsibility.getByRole('radio', { name: '物料', exact: true }).check();
  await responsibility.getByRole('button', { name: '新增物料明细', exact: true }).click();
  await responsibility.getByLabel('物料编码 1', { exact: true }).fill(materialCode);
  await responsibility.getByRole('combobox', { name: '供应商名称 1' }).fill(supplier.displayName);
  await page.locator('.ant-select-dropdown:visible .ant-select-item-option').filter({ hasText: supplier.displayName }).click();
  await responsibility.getByLabel('物料批次 1', { exact: true }).fill(materialBatch);
  const added = await saveBoard('责任判定', 'RESPONSIBILITY', { defectId: record.id, expectedVersion: disposed.version,
    fields: { responsibilityCategory: 'MATERIAL', materials: [{ materialCode, materialBatch, supplierProfileId: supplier.id }] } });
  expect(added.materials).toHaveLength(1);
  const materialId = added.materials[0]!.id!;
  await detail.getByRole('button', { name: '责任判定', exact: true }).click();
  await responsibility.getByLabel(`移除物料 ${materialCode} / ${materialBatch}`, { exact: true }).check();
  const removed = await saveBoard('责任判定', 'RESPONSIBILITY', { defectId: record.id, expectedVersion: added.version, fields: { removedMaterialIds: [materialId] } });
  expect(removed.materials).toHaveLength(0);
  await detail.getByRole('button', { name: '关闭', exact: true }).click();

  await page.getByLabel(`选择制程不良 ${description}`, { exact: true }).check();
  await page.getByLabel('台账批量操作', { exact: true }).getByRole('button', { name: '分析进度维护', exact: true }).click();
  await page.getByRole('dialog', { name: '分析进度维护', exact: true }).getByLabel('分析进度', { exact: true }).fill('完成原因分析');
  const analyzed = await saveBoard('分析进度维护', 'ANALYSIS', { defectId: record.id, expectedVersion: removed.version, fields: { analysisProgress: '完成原因分析' } });
  expect(analyzed).toMatchObject({ ledgerStatus: 'CLOSED', dispositionPlan: 'SCRAP', analysisProgress: '完成原因分析' });
});

test('AI channels keep credentials private and real Worker applies structured descriptions with failure and manual fallback', async ({ page }) => {
  await login(page);
  const secret = `disposable-ai-${randomUUID()}`;
  const calls: Array<{ authorization?: string; body: string }> = [];
  let delayed: ServerResponse | undefined;
  const server = createServer((request, response) => {
    let body = '';
    request.on('data', chunk => { body += String(chunk); });
    request.on('end', () => {
      calls.push({ authorization: request.headers.authorization, body });
      if (body.includes('MANUAL_DELAY')) { delayed = response; return; }
      if (body.includes('VENDOR_FAIL')) { response.statusCode = 503; response.end(secret); return; }
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ defectSummary: `AI整理${suffix}` }) } }] }));
    });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const channel = await positionWrite<Schema['AiConnectionDto']>(page.request, '/api/v1/admin/ai-connections', 'POST', {
      name: `AI渠道${suffix}`, baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`,
      models: ['fixture-standard', 'fixture-summary'], defaultModel: 'fixture-standard', enabled: true, apiKey: secret,
    }, 201);
    const channels = await positionRead<Schema['AiConnectionDto'][]>(page.request, '/api/v1/admin/ai-connections');
    expect(JSON.stringify([channel, channels])).not.toContain(secret);
    expect(Object.keys(channel)).not.toEqual(expect.arrayContaining(['apiKey']));
    expect(channel).toMatchObject({ hasKey: true, models: ['fixture-standard', 'fixture-summary'] });
    const loadedChannels = page.waitForResponse(response => {
      const url = new URL(response.url());
      return url.pathname === '/api/v1/admin/ai-connections' && url.searchParams.get('organizationId') === channel.organizationId && response.request().method() === 'GET';
    });
    await page.goto(`/console/ai-connections?organizationId=${channel.organizationId}`);
    await expect(page.getByRole('button', { name: '新增AI连接', exact: true })).toBeVisible();
    const channelResponse = await loadedChannels;
    expect(channelResponse.status()).toBe(200);
    expect(await channelResponse.json()).toEqual(expect.arrayContaining([expect.objectContaining({ id: channel.id })]));
    const channelRow = page.getByRole('row').filter({ hasText: `AI渠道${suffix}` });
    await expect(channelRow).toBeVisible();
    await channelRow.getByRole('button', { name: /^编\s*辑$/ }).click();
    const editor = page.getByRole('dialog', { name: 'AI连接', exact: true });
    await expect(editor.getByLabel('API密钥', { exact: true })).toHaveValue('');
    await editor.getByLabel('渠道协议', { exact: true }).press('ArrowDown');
    const protocolOptions = page.locator('.ant-select-dropdown:visible .ant-select-item-option');
    for (const protocol of ['OpenAI Chat Completions', 'OpenAI Responses', 'Anthropic Messages', 'Gemini Generate Content']) {
      await expect(protocolOptions.filter({ hasText: protocol })).toBeVisible();
    }
    await page.keyboard.press('Escape');
    expect(await page.locator('body').innerText()).not.toContain(secret);
    await editor.getByRole('button', { name: /^取\s*消$/ }).click();
    let endpoint = await positionWrite<Schema['IntegrationEndpointDto']>(page.request, '/api/v1/admin/integrations/endpoints', 'POST', {
      code: `AI_${suffix}`, name: `AI不良验收${suffix}`, sourceCode: 'IMS', sourceName: 'IMS一次性AI验收', returnReceipt: true,
    }, 201);
    const credential = await positionWrite<Schema['IntegrationCredentialDto']>(page.request, `/api/v1/admin/integrations/endpoints/${endpoint.id}/credentials`, 'POST', { name: 'AI一次性凭据', validityDays: null }, 201);
    endpoint = await positionWrite<Schema['IntegrationEndpointDto']>(page.request, `/api/v1/admin/integrations/endpoints/${endpoint.id}`, 'PATCH', { expectedVersion: endpoint.version, status: 'ENABLED' });
    const aiRuleInput: Schema['SaveIngestionRuleDto'] = {
      name: `AI描述规则${suffix}`, endpointId: endpoint.id, target: 'PROCESS_DEFECT', enabled: true, match: 'ALL', conditions: [],
      mapping: { externalRecordKey: 'ID', productCode: 'PRODUCT', traceCode: 'TRACE', factoryCode: 'PLANT' },
      descriptionComposition: { fields: [{ path: 'FAULT', label: '现象：' }], separator: '\n' }, mode: 'INSERT_ONLY', updateFields: [],
      aiDescription: { connectionId: channel.id, model: 'fixture-summary', prompt: '整理{{fault}}，仅保留已给事实。',
        inputFields: [{ path: 'FAULT', label: '现象', variable: 'fault' }], output: { mode: 'JSON', field: 'defectSummary', target: 'description' } },
    };
    const aiRule = await positionWrite<Schema['IngestionRuleDto']>(page.request, `${ingestion}/rules`, 'POST', aiRuleInput, 201);
    expect(aiRule.aiApplication).toMatchObject({ publishedVersion: 1, inputFields: [{ path: 'FAULT', variable: 'fault' }] });
    const csrf = await positionRead<Schema['CsrfResponseDto']>(page.request, '/api/v1/auth/csrf');
    const rejectedModel = await page.request.patch(`${ingestion}/rules/${aiRule.id}`, {
      headers: { 'x-csrf-token': csrf.csrfToken, 'Idempotency-Key': randomUUID() },
      data: { ...aiRuleInput, expectedVersion: aiRule.version, aiDescription: { ...aiRuleInput.aiDescription, model: 'unapproved-model' } },
    });
    expect(rejectedModel.status()).toBe(400);
    expect((await rejectedModel.json()).code).toBe('INGESTION_RULE_INVALID');
    await page.goto('/console/api-ingestion');
    await page.getByRole('row').filter({ hasText: `AI描述规则${suffix}` }).getByRole('button', { name: `编辑AI描述规则${suffix}`, exact: true }).click();
    const ruleEditor = page.getByRole('dialog', { name: '编辑入库规则', exact: true });
    await expect(ruleEditor.getByLabel('已发布版本', { exact: true })).toHaveValue('1');
    await expect(ruleEditor.getByLabel('描述来源字段1', { exact: true })).toHaveValue('FAULT');
    await expect(ruleEditor.getByLabel('提示词变量1', { exact: true })).toHaveValue('fault');
    await expect(ruleEditor.getByLabel('有效提示词', { exact: true })).toHaveValue('整理{{fault}}，仅保留已给事实。');
    await expect(ruleEditor.getByLabel('有效输出字段', { exact: true })).toHaveValue('defectSummary');
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      await expect.poll(() => ruleEditor.locator('.ant-modal-body').evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
      if (process.env.QMS_ACCEPTANCE_ARTIFACT_DIRECTORY) await page.screenshot({ path: `${process.env.QMS_ACCEPTANCE_ARTIFACT_DIRECTORY}/process-ai-rule-${width}.png` });
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    await ruleEditor.getByLabel(/规则名称$/).fill(`AI规则已编辑${suffix}`);
    const updatedRuleResponse = page.waitForResponse(response => new URL(response.url()).pathname === `${ingestion}/rules/${aiRule.id}` && response.request().method() === 'PATCH');
    await ruleEditor.getByRole('button', { name: /^保\s*存$/ }).click();
    const savedRule = await updatedRuleResponse;
    expect(savedRule.status()).toBe(200);
    expect(savedRule.request().postDataJSON()).toHaveProperty('aiApplication');
    expect(savedRule.request().postDataJSON()).not.toHaveProperty('aiDescription');
    expect((await savedRule.json()).aiDescription).toMatchObject({ model: 'fixture-summary', inputFields: [{ path: 'FAULT', variable: 'fault' }], output: { mode: 'JSON', field: 'defectSummary' } });
    await expect(ruleEditor).toHaveCount(0);
    const send = async (id: string, fault: string) => {
      const response = await fetch(new URL(`/api/v1/integrations/inbound/${endpoint.code}/messages`, baseURL), {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15_000),
        headers: { Authorization: `Bearer ${credential.secret}`, 'Content-Type': 'application/json' },
        body: JSON.stringify([{ ID: id, PRODUCT: `AI_PRODUCT_${suffix}`, TRACE: id, FAULT: fault, PRIVATE_UNUSED: 'must-not-leave-qms' }]),
      });
      expect(response.status).toBe(200); expect(await response.json()).toBe(true);
    };
    const find = async (id: string) => {
      const result = await positionRead<Schema['ProcessDefectPageDto']>(page.request, `/api/v1/process-quality/defects?page=1&pageSize=20&search=${suffix}`);
      return result.items.find(item => item.externalRecordKey === id);
    };
    const successId = `AI_SUCCESS_${suffix}`;
    await send(successId, '焊点异常');
    await worker();
    const success = await find(successId);
    expect(success).toMatchObject({ description: `AI整理${suffix}`, descriptionSource: 'AI', descriptionDirect: '现象：焊点异常' });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.authorization).toBe(`Bearer ${secret}`);
    expect(JSON.parse(calls[0]!.body).model).toBe('fixture-summary');
    expect(calls[0]!.body).not.toContain('must-not-leave-qms');
    await worker(); expect(calls).toHaveLength(1);
    const failureId = `AI_FAILURE_${suffix}`;
    await send(failureId, 'VENDOR_FAIL'); await worker();
    const failure = await find(failureId);
    expect(failure).toMatchObject({ description: '现象：VENDOR_FAIL', descriptionSource: 'DIRECT' });
    expect(JSON.stringify(failure)).not.toContain(secret);
    const manualId = `AI_MANUAL_${suffix}`;
    await send(manualId, 'MANUAL_DELAY');
    const running = worker();
    try {
      await expect.poll(() => !!delayed, { timeout: 15_000 }).toBe(true);
      const current = (await find(manualId))!;
      await positionWrite<Schema['ProcessDefectDto']>(page.request, `/api/v1/process-quality/defects/${current.id}`, 'PUT', { expectedVersion: current.version, description: `人工确认${suffix}` });
    } finally {
      delayed?.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ defectSummary: '迟到AI建议' }) } }] }));
      await running;
    }
    expect(await find(manualId)).toMatchObject({ description: `人工确认${suffix}`, descriptionSource: 'MANUAL', descriptionAi: '迟到AI建议' });
  } finally {
    delayed?.end(); server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});

test('AI management separates configuration and publishes prompt applications across four native protocols', async ({ page }) => {
  await login(page);
  const secret = `disposable-center-${randomUUID()}`;
  const calls: Array<{ path: string; headers: Record<string, string | string[] | undefined>; body: Record<string, unknown> }> = [];
  const server = createServer((request, response) => {
    let body = '';
    request.on('data', chunk => { body += String(chunk); });
    request.on('end', () => {
      calls.push({ path: request.url!, headers: request.headers, body: JSON.parse(body) });
      response.setHeader('Content-Type', 'application/json');
      const text = `中心整理${suffix}`;
      const result = request.url?.endsWith('/responses')
        ? { status: 'completed', output: [{ type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text }] }] }
        : request.url?.endsWith('/messages')
          ? { type: 'message', role: 'assistant', stop_reason: 'end_turn', content: [{ type: 'text', text }] }
          : request.url?.endsWith(':generateContent')
            ? { candidates: [{ finishReason: 'STOP', content: { role: 'model', parts: [{ text }] } }] }
            : { choices: [{ finish_reason: 'stop', message: { content: text } }] };
      response.end(JSON.stringify(result));
    });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const protocols = ['OPENAI_CHAT_COMPLETIONS', 'OPENAI_RESPONSES', 'ANTHROPIC_MESSAGES', 'GEMINI_GENERATE_CONTENT'] as const;
    const channels: Schema['AiConnectionDto'][] = [];
    for (const protocol of protocols) {
      const channel = await positionWrite<Schema['AiConnectionDto']>(page.request, '/api/v1/admin/ai-connections', 'POST', {
        name: `${protocol}_${suffix}`, protocol, baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`,
        models: ['fixture-center'], defaultModel: 'fixture-center', enabled: true, apiKey: secret,
      }, 201);
      expect(channel.protocol).toBe(protocol);
      expect(JSON.stringify(channel)).not.toContain(secret);
      channels.push(channel);
    }
    const organizationId = channels[0]!.organizationId;
    const endpoint = await positionWrite<Schema['IntegrationEndpointDto']>(page.request, '/api/v1/admin/integrations/endpoints', 'POST', {
      code: `VAR_${suffix}`, name: `变量来源${suffix}`, sourceCode: 'IMS', sourceName: 'IMS一次性AI验收', returnReceipt: true,
    }, 201);
    const sourceRule = await positionWrite<Schema['IngestionRuleDto']>(page.request, `${ingestion}/rules`, 'POST', {
      name: `API变量规则${suffix}`, target: 'PROCESS_DEFECT', endpointId: endpoint.id, enabled: false, match: 'ALL', conditions: [], mapping: { factoryCode: 'PLANT' }, mode: 'INSERT_ONLY', updateFields: [],
      descriptionComposition: { fields: [{ path: 'FAULT', variable: 'fault', label: '现象样本' }], separator: '\n' },
    }, 201);
    expect(sourceRule.descriptionComposition?.fields).toEqual([{ path: 'FAULT', variable: 'fault', label: '现象样本' }]);
    async function checkActionRow(dialog: ReturnType<typeof page.getByRole>, saveName: RegExp) {
      const cancel = dialog.getByRole('button', { name: /^取\s*消$/ });
      const save = dialog.getByRole('button', { name: saveName });
      for (const width of [1440, 390, 320]) {
        await page.setViewportSize({ width, height: 900 });
        await save.scrollIntoViewIfNeeded();
        await expect(cancel).toBeInViewport();
        await expect(save).toBeInViewport();
        const [cancelBox, saveBox] = await Promise.all([cancel.boundingBox(), save.boundingBox()]);
        expect(Math.abs(cancelBox!.y + cancelBox!.height / 2 - saveBox!.y - saveBox!.height / 2)).toBeLessThan(2);
        expect(cancelBox!.x + cancelBox!.width).toBeLessThan(saveBox!.x);
        await expect.poll(() => dialog.locator('.ant-modal-body').evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
      }
      await page.setViewportSize({ width: 1440, height: 900 });
    }
    await page.goto(`/console/ai-connections?organizationId=${organizationId}`);
    await page.getByRole('button', { name: '新增AI连接', exact: true }).click();
    const connectionEditor = page.getByRole('dialog', { name: 'AI连接', exact: true });
    await checkActionRow(connectionEditor, /^保\s*存$/);
    await connectionEditor.getByRole('button', { name: /^取\s*消$/ }).click();
    await expect(connectionEditor).toHaveCount(0);
    await page.goto(`/console/ai-applications?organizationId=${organizationId}`);
    await expect(page.getByRole('button', { name: '新增应用', exact: true })).toBeVisible();
    await expect(page.getByText('AI管理', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: '新增应用', exact: true }).click();
    const editor = page.getByRole('dialog', { name: '提示词应用', exact: true });
    const name = `中心应用${suffix}`;
    await editor.getByLabel('应用名称', { exact: true }).fill(name);
    await editor.getByLabel('变量来源规则', { exact: true }).press('ArrowDown');
    await page.locator('.ant-select-dropdown:visible .ant-select-item-option').filter({ hasText: sourceRule.name }).click();
    await editor.getByLabel('模型渠道', { exact: true }).press('ArrowDown');
    await page.locator('.ant-select-dropdown:visible .ant-select-item-option').filter({ hasText: channels[0]!.name }).click();
    await editor.getByLabel('提示词', { exact: true }).fill('整理');
    await editor.getByRole('button', { name: '插入 fault', exact: true }).click();
    await expect(editor.getByLabel('提示词', { exact: true })).toHaveValue('整理{{fault}}');
    await checkActionRow(editor, /^保存草稿$/);
    const createdResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/api/v1/admin/ai-applications' && response.request().method() === 'POST');
    await editor.getByRole('button', { name: '保存草稿', exact: true }).click();
    const created = await createdResponse;
    expect(created.status()).toBe(201);
    const application = await created.json() as Schema['AiApplicationDto'];
    await expect(editor).toHaveCount(0);
    const row = page.getByRole('row').filter({ hasText: name });
    await row.getByRole('button', { name: '发布版本', exact: true }).click();
    const publishing = page.getByRole('dialog', { name: '发布应用版本', exact: true });
    const publishedResponse = page.waitForResponse(response => new URL(response.url()).pathname.endsWith(`/${application.id}/publish`) && response.request().method() === 'POST');
    await publishing.getByRole('button', { name: '确认发布', exact: true }).click();
    expect((await publishedResponse).status()).toBe(201);
    await expect(publishing).toHaveCount(0);
    await page.goto(`/console/api-ingestion?organizationId=${organizationId}`);
    const editRule = page.getByRole('button', { name: `编辑${sourceRule.name}`, exact: true });
    await editRule.click();
    const ruleEditor = page.getByRole('dialog', { name: '编辑入库规则', exact: true });
    await checkActionRow(ruleEditor, /^保\s*存$/);
    const toggle = ruleEditor.getByRole('switch', { name: 'AI整理', exact: true });
    await expect(toggle).toBeEnabled();
    await toggle.click();
    await ruleEditor.getByLabel('提示词应用', { exact: true }).press('ArrowDown');
    const revisionResponse = page.waitForResponse(response => new URL(response.url()).pathname.endsWith(`/ai-applications/${application.id}/revisions/1`) && response.request().method() === 'GET');
    await page.locator('.ant-select-dropdown:visible .ant-select-item-option').filter({ hasText: name }).click();
    expect((await revisionResponse).status()).toBe(200);
    await expect(ruleEditor.getByLabel('已发布版本', { exact: true })).toHaveValue('1');
    const savedRule = page.waitForResponse(response => new URL(response.url()).pathname.endsWith(`/rules/${sourceRule.id}`) && response.request().method() === 'PATCH');
    await ruleEditor.getByRole('button', { name: /^保\s*存$/ }).click();
    expect((await savedRule).status()).toBe(200);
    await expect(ruleEditor).toHaveCount(0);
    await editRule.click();
    await expect(toggle).toBeChecked();
    await expect(ruleEditor.getByLabel('已发布版本', { exact: true })).toHaveValue('1');
    await ruleEditor.getByRole('button', { name: /^取\s*消$/ }).click();
    await page.goto(`/console/ai-applications?organizationId=${organizationId}`);
    await row.getByRole('button', { name: '样本试运行', exact: true }).click();
    const trial = page.getByRole('dialog', { name: '样本试运行', exact: true });
    await trial.getByLabel('现象样本', { exact: true }).fill('焊点异常');
    await trial.getByRole('button', { name: '运行样本', exact: true }).click();
    await expect(trial.getByRole('region', { name: '样本结果', exact: true })).toContainText(`中心整理${suffix}`);
    await trial.getByRole('button', { name: '关闭', exact: true }).click();
    await expect(trial).toHaveCount(0);
    const original = await positionRead<Schema['AiApplicationRevisionDto']>(page.request, `/api/v1/admin/ai-applications/${application.id}/revisions/1`);
    let current = await positionRead<Schema['AiApplicationDto']>(page.request, `/api/v1/admin/ai-applications/${application.id}`);
    current = await positionWrite<Schema['AiApplicationDto']>(page.request, `/api/v1/admin/ai-applications/${application.id}`, 'PATCH', { ...original.configuration, prompt: '新提示词{{fault}}', expectedVersion: current.version });
    await positionWrite(page.request, `/api/v1/admin/ai-applications/${application.id}/publish`, 'POST', { expectedVersion: current.version }, 201);
    expect((await positionRead<Schema['AiApplicationRevisionDto']>(page.request, `/api/v1/admin/ai-applications/${application.id}/revisions/1`)).configuration).toEqual(original.configuration);
    for (const channel of channels.slice(1)) {
      const app = await positionWrite<Schema['AiApplicationDto']>(page.request, '/api/v1/admin/ai-applications', 'POST', { ...original.configuration, name: `${channel.protocol}_${suffix}`, connectionId: channel.id }, 201);
      const result = await positionWrite<Schema['AiApplicationTestResultDto']>(page.request, `/api/v1/admin/ai-applications/${app.id}/test`, 'POST', { expectedVersion: app.version, samples: [{ variable: 'fault', value: '焊点异常' }] }, 201);
      expect(result).toMatchObject({ status: 'SUCCESS', text: `中心整理${suffix}` });
    }
    expect(calls).toHaveLength(4);
    expect(calls.map(call => call.path)).toEqual(['/v1/chat/completions', '/v1/responses', '/v1/messages', '/v1/models/fixture-center:generateContent']);
    expect(calls[0]!.headers.authorization).toBe(`Bearer ${secret}`);
    expect(calls[1]!.body.store).toBe(false);
    expect(calls[2]!.headers['x-api-key']).toBe(secret);
    expect(calls[3]!.headers['x-goog-api-key']).toBe(secret);
    expect(calls.every(call => !call.path.includes(secret) && !JSON.stringify(call.body).includes('{{fault}}'))).toBe(true);
    await positionWrite(page.request, `/api/v1/admin/ai-connections/${channels[0]!.id}`, 'PATCH', {
      expectedVersion: channels[0]!.version, name: channels[0]!.name, baseUrl: channels[0]!.baseUrl,
      protocol: channels[0]!.protocol, models: ['fixture-other'], defaultModel: 'fixture-other', enabled: true,
    });
    await page.goto(`/console/ai-applications?organizationId=${organizationId}`);
    await page.getByRole('row').filter({ hasText: name }).getByRole('button', { name: /^编\s*辑$/ }).click();
    const disableEditor = page.getByRole('dialog', { name: '提示词应用', exact: true });
    await disableEditor.getByLabel('启用应用', { exact: true }).click();
    const disabledResponse = page.waitForResponse(response => new URL(response.url()).pathname.endsWith(`/ai-applications/${application.id}`) && response.request().method() === 'PATCH');
    await disableEditor.getByRole('button', { name: '保存草稿', exact: true }).click();
    const disabledResult = await disabledResponse;
    expect(disabledResult.status()).toBe(200);
    expect(await disabledResult.json()).toMatchObject({ enabled: false, model: 'fixture-center', connectionId: channels[0]!.id });
    await expect(disableEditor).toHaveCount(0);
    await page.goto(`/console/configuration?organizationId=${organizationId}`);
    await expect(page.getByRole('button', { name: '新增AI连接', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '新建板块规则', exact: true })).toBeVisible();
    for (const path of ['ai-connections', 'ai-applications']) {
      await page.goto(`/console/${path}?organizationId=${organizationId}`);
      const visibleRow = page.getByRole('row').filter({ hasText: path === 'ai-connections' ? channels[0]!.name : name });
      await expect(visibleRow).toBeVisible();
      for (const width of [1440, 390, 320]) {
        await page.setViewportSize({ width, height: 900 });
        await expect(visibleRow).toBeVisible();
        await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
        if (process.env.QMS_ACCEPTANCE_ARTIFACT_DIRECTORY) await page.screenshot({ path: `${process.env.QMS_ACCEPTANCE_ARTIFACT_DIRECTORY}/${path}-${width}.png` });
      }
    }
    expect(await page.locator('body').innerText()).not.toContain(secret);
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
