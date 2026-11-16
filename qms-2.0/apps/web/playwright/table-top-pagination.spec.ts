import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { writeFile } from 'node:fs/promises';
import { expect, test, type Locator, type Page } from '@playwright/test';
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
  throw new Error('Table pagination acceptance requires a real disposable gateway, PostgreSQL and external encrypted MFA credentials.');
}
for (const [value, database] of [[baseURL, false], [databaseURL, true]] as const) {
  const resource = new URL(value);
  if (!['localhost', '127.0.0.1', '[::1]'].includes(resource.hostname) || resource.port === '55440' || resource.search || resource.hash
    || !(database ? ['postgres:', 'postgresql:'] : ['http:', 'https:']).includes(resource.protocol)
    || (!database && (resource.username || resource.password || resource.pathname !== '/'))) {
    throw new Error('Table pagination acceptance only supports loopback resources outside preserved preview 55440.');
  }
}
const requireApi = createRequire(new URL('../../api/package.json', import.meta.url));
const { PrismaPg } = requireApi('@prisma/adapter-pg');
const { PrismaClient } = await import('../../api/dist/generated/prisma/client.js');
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseURL }) });
const suffix = randomUUID().replaceAll('-', '').slice(0, 10);
let fixtureRoleId: string;
let administratorPermissionId: string | undefined;

test.use({ trace: 'off', screenshot: 'off', video: 'off' });
test.beforeAll(async ({ request }) => {
  const organization = await prisma.organization.findUniqueOrThrow({ where: { code: 'LOCAL-INTERNAL' } });
  const user = await prisma.user.findUniqueOrThrow({ where: { organizationId_username: { organizationId: organization.id, username: 'local.internal' } } });
  fixtureRoleId = (await prisma.userRole.findFirstOrThrow({ where: { organizationId: organization.id, userId: user.id, role: { code: 'LOCAL_MEMBER' } } })).roleId;
  const permission = await prisma.permission.findUniqueOrThrow({ where: { code: 'platform:admin' } });
  const where = { roleId_permissionId: { roleId: fixtureRoleId, permissionId: permission.id } };
  if (!await prisma.rolePermission.findUnique({ where })) {
    await prisma.rolePermission.create({ data: where.roleId_permissionId });
    administratorPermissionId = permission.id;
  }
  const csrf = await positionRead<Schema['CsrfResponseDto']>(request, '/api/v1/auth/csrf');
  const authenticated = await request.post('/api/v1/auth/login', {
    headers: { 'x-csrf-token': csrf.csrfToken }, data: { identifier: 'local.internal', password },
  });
  await completeMfa(request, authenticated, 'local.internal');
  for (let ordinal = 0; ordinal < 21; ordinal++) {
    const code = `TOP_${suffix}_${String(ordinal).padStart(2, '0')}`;
    await positionWrite<Schema['SupplierProfileDto']>(request, '/api/v1/supplier-quality/profiles', 'POST', {
      businessCode: code, displayName: `顶部分页供应商 ${ordinal}`,
    } satisfies Schema['CreateSupplierProfileDto'], 201);
    await positionWrite<Schema['MaterialMasterDto']>(request, '/api/v1/material-masters', 'POST', {
      materialCode: code, materialName: `顶部分页物料 ${ordinal}`,
    } satisfies Schema['CreateMaterialMasterDto'], 201);
  }
  const endpoints = '/api/v1/admin/integrations/endpoints';
  let endpoint = await positionWrite<Schema['IntegrationEndpointDto']>(request, endpoints, 'POST', {
    code: `TOP_${suffix}`, name: `顶部分页接收 ${suffix}`, sourceCode: `TOP_${suffix}`, sourceName: '一次性分页验收', returnReceipt: true,
  }, 201);
  const credential = await positionWrite<Schema['IntegrationCredentialDto']>(request, `${endpoints}/${endpoint.id}/credentials`, 'POST', { name: '一次性分页凭据', validityDays: null }, 201);
  endpoint = await positionWrite<Schema['IntegrationEndpointDto']>(request, `${endpoints}/${endpoint.id}`, 'PATCH', { expectedVersion: endpoint.version, status: 'ENABLED' });
  for (let ordinal = 0; ordinal < 21; ordinal++) {
    const response = await fetch(new URL(`/api/v1/integrations/inbound/${endpoint.code}/messages`, baseURL), {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15_000),
      headers: { Authorization: `Bearer ${credential.secret!}`, 'Content-Type': 'application/json' },
      body: JSON.stringify([{ acceptance: 'table-top-pagination', ordinal }]),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toBe(true);
  }
  expect(await prisma.integrationReceipt.count({ where: { endpointId: endpoint.id } })).toBe(21);
  await prisma.$transaction(async transaction => {
    const definition = await transaction.workflowDefinition.create({ data: { organizationId: organization.id, code: `TOP_${suffix}`, name: '分页通知夹具' } });
    const version = await transaction.workflowVersion.create({ data: { organizationId: organization.id, workflowDefinitionId: definition.id, version: 1, status: 'PUBLISHED' } });
    const node = await transaction.workflowNode.create({ data: { organizationId: organization.id, workflowVersionId: version.id, nodeKey: 'notice', type: 'ACTION', name: '分页通知节点', config: { assignment: { assigneeUserId: user.id } } } });
    const problem = await transaction.problemIndex.create({ data: { organizationId: organization.id, reportNumber: `TOP_${suffix}`, domainCode: 'neutral-test', problemType: 'test', sourceType: 'neutral', severity: 'LOW' } });
    const instance = await transaction.workflowInstance.create({ data: { organizationId: organization.id, problemIndexId: problem.id, workflowDefinitionId: definition.id, workflowVersionId: version.id, instanceKey: `TOP_${suffix}`, currentNodeId: node.id } });
    await transaction.problemIndex.update({ where: { id: problem.id }, data: { workflowInstanceId: instance.id } });
    const task = await transaction.workflowTask.create({ data: { organizationId: organization.id, workflowInstanceId: instance.id, workflowVersionId: version.id, workflowNodeId: node.id, entryInstanceVersion: instance.version, assigneeUserId: user.id } });
    await transaction.notification.createMany({ data: Array.from({ length: 21 }, (_, ordinal) => ({
      organizationId: organization.id, workflowTaskId: task.id, recipientUserId: user.id, channel: 'IN_APP', kind: 'TASK_ASSIGNED', status: 'DELIVERED',
      subject: `顶部分页通知 ${suffix} ${String(ordinal).padStart(2, '0')}`, body: '一次性真实通知分页验收', createdAt: new Date(Date.now() - ordinal * 1000),
    })) });
  });
});
test.afterAll(async () => {
  try {
    if (administratorPermissionId) await prisma.rolePermission.deleteMany({ where: { roleId: fixtureRoleId, permissionId: administratorPermissionId } });
  } finally { await prisma.$disconnect(); }
});
test.afterEach(async ({ page }, testInfo) => {
  if (testInfo.status === testInfo.expectedStatus) return;
  await testInfo.attach('failure-browser-state', { body: JSON.stringify({ url: page.url(), state: await page.locator('body').evaluate(body => ({
    headings: [...body.querySelectorAll('h1, h2, h3')].map(element => element.textContent),
    tabs: [...body.querySelectorAll('[role="tab"]')].map(element => ({ text: element.textContent, hidden: element.getAttribute('aria-hidden') })),
  })) }, null, 2), contentType: 'application/json' });
  if (new URL(page.url()).pathname.startsWith('/app/') || new URL(page.url()).pathname.startsWith('/console')) {
    await page.screenshot({ path: testInfo.outputPath('failure-page.png') });
  }
});

async function login(page: Page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/login');
  await page.getByLabel('账号', { exact: true }).fill('local.internal');
  await fillSecret(page.getByLabel('密码', { exact: true }), password!);
  const authenticated = page.waitForResponse(response => new URL(response.url()).pathname === '/api/v1/auth/login' && response.request().method() === 'POST');
  await page.getByRole('button', { name: /^登\s*录$/ }).click();
  await completeMfa(page.request, await authenticated, 'local.internal', page);
  await expect(page).toHaveURL(/\/app\/workbench$/);
}

async function rowIds(ledger: Locator) {
  return ledger.locator('tbody tr[data-row-key]').evaluateAll(rows => rows.map(row => row.getAttribute('data-row-key')));
}

async function assertTopGeometry(page: Page, ledger: Locator, custom: boolean) {
  const columns = ledger.getByRole('button', { name: /^(列设置|Columns)$/ });
  await expect(columns).toBeVisible();
  const pager = custom ? ledger.getByRole('navigation', { name: '接收记录分页', exact: true }) : ledger.locator('.ant-pagination');
  await expect(pager).toHaveCount(1);
  await pager.scrollIntoViewIfNeeded();
  if (custom) await expect(ledger.locator('.ant-pagination')).toHaveCount(0);
  const geometry = await ledger.evaluate(element => {
    const bounds = element.getBoundingClientRect();
    const pager = element.querySelector<HTMLElement>('nav[aria-label="接收记录分页"], .ant-pagination')!;
    const pagination = pager.getBoundingClientRect();
    const content = pager.tagName === 'UL' ? [...pager.children].map(child => child.getBoundingClientRect()).filter(rect => rect.width > 0 && rect.height > 0) : [pagination];
    const heading = element.querySelector('.ant-table-thead')!.getBoundingClientRect();
    const tools = element.querySelector('.qms-ledger__tools')!.getBoundingClientRect();
    const columns = [...element.querySelectorAll<HTMLElement>('.qms-ledger__tools button')].find(button => /^(列设置|Columns)$/.test(button.textContent?.trim() ?? ''))!.getBoundingClientRect();
    const total = pager.querySelector('span')?.getBoundingClientRect();
    return {
      left: Math.min(...content.map(rect => rect.left)) - bounds.left, right: bounds.right - Math.max(...content.map(rect => rect.right)),
      pagerBottom: pagination.bottom, headingTop: heading.top, viewportHeight: innerHeight,
      toolsLeft: tools.left, toolsRight: tools.right, columnsLeft: columns.left, columnsRight: columns.right,
      width: innerWidth, pageWidth: document.documentElement.scrollWidth,
      totalLeft: total ? total.left - tools.left : undefined, totalRight: total ? tools.right - total.right : undefined,
    };
  });
  expect(geometry.pagerBottom).toBeLessThanOrEqual(geometry.headingTop + 1);
  expect(geometry.pagerBottom).toBeLessThanOrEqual(geometry.viewportHeight);
  expect(geometry.left).toBeGreaterThanOrEqual(11.5);
  expect(geometry.right).toBeGreaterThanOrEqual(11.5);
  expect(geometry.columnsLeft - geometry.toolsLeft).toBeGreaterThanOrEqual(11.5);
  expect(geometry.toolsRight - geometry.columnsRight).toBeGreaterThanOrEqual(11.5);
  expect(geometry.columnsRight).toBeLessThanOrEqual(geometry.width);
  expect(geometry.pageWidth).toBeLessThanOrEqual(geometry.width + 1);
  if (custom) {
    expect(geometry.totalLeft).toBeGreaterThanOrEqual(11.5);
    expect(geometry.totalRight).toBeGreaterThanOrEqual(11.5);
  }
  await columns.click();
  await expect(page.getByRole('button', { name: /^(恢复全部列|Reset all columns)$/ })).toBeVisible();
  await columns.click();
  return geometry;
}

test('real notifications use a single pager above the business list at desktop and narrow widths', async ({ page }, testInfo) => {
  const started = Date.now();
  const observations: object[] = [];
  page.on('pageerror', error => observations.push({ type: 'pageerror', message: error.message, elapsed: Date.now() - started }));
  page.on('response', response => {
    const url = new URL(response.url());
    if (url.pathname.startsWith('/api/')) observations.push({ type: 'response', path: url.pathname, status: response.status(), elapsed: Date.now() - started });
  });
  page.on('requestfailed', request => observations.push({ type: 'requestfailed', path: new URL(request.url()).pathname, elapsed: Date.now() - started }));
  await login(page);
  observations.push({ type: 'login-complete', elapsed: Date.now() - started });
  await page.goto('/app/my-tasks');
  observations.push({ type: 'navigation-complete', url: page.url(), elapsed: Date.now() - started });
  try {
    await expect(page.getByRole('tab', { name: '我的通知', exact: true })).toBeVisible();
  } finally {
    await writeFile(testInfo.outputPath('notification-navigation.json'), JSON.stringify({ observations, url: page.url(), tabs: await page.getByRole('tab').evaluateAll(tabs => tabs.map(tab => ({ text: tab.textContent, bounds: tab.getBoundingClientRect().toJSON(), selected: tab.getAttribute('aria-selected') }))) }, null, 2));
    await testInfo.attach('notification-navigation', { body: JSON.stringify(observations, null, 2), contentType: 'application/json' });
  }
  await page.getByRole('tab', { name: '我的通知', exact: true }).click();
  const panel = page.getByRole('tabpanel', { name: '我的通知', exact: true });
  const pager = panel.locator('.ant-pagination');
  await expect(pager).toHaveCount(1);
  await changeSize(page, pager, false, 10);
  const titles = panel.locator('.ant-list-item .ant-card-head-title');
  await expect(titles).toHaveCount(10);
  const first = await titles.allTextContents();
  const firstPage = await positionRead<Schema['NotificationPageDto']>(page.request, '/api/v1/notifications?pageSize=10&offset=0');
  expect(firstPage.total).toBeGreaterThanOrEqual(21);
  expect(first).toEqual(firstPage.items.map(item => item.subject));
  const geometry: object[] = [];
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: width === 1440 ? 900 : 844 });
    await pager.scrollIntoViewIfNeeded();
    const measured = await panel.evaluate(element => {
      const pager = element.querySelector('.ant-pagination')!.getBoundingClientRect();
      const list = element.querySelector('.ant-list')!.getBoundingClientRect();
      const bounds = element.getBoundingClientRect();
      return { pagerBottom: pager.bottom, listTop: list.top, pagerLeft: pager.left - bounds.left, pagerRight: bounds.right - pager.right, viewportHeight: innerHeight, viewportWidth: innerWidth, pageWidth: document.documentElement.scrollWidth };
    });
    expect(measured.pagerBottom).toBeLessThanOrEqual(measured.listTop + 1);
    expect(measured.pagerBottom).toBeLessThanOrEqual(measured.viewportHeight);
    expect(measured.pageWidth).toBeLessThanOrEqual(measured.viewportWidth + 1);
    geometry.push({ width, ...measured });
    const nextResponse = page.waitForResponse(response => {
      const url = new URL(response.url());
      return url.pathname === '/api/v1/notifications' && url.searchParams.get('pageSize') === '10' && url.searchParams.get('offset') === '10';
    });
    await pager.locator('.ant-pagination-next button').click();
    const next = await nextResponse;
    expect(next.status()).toBe(200);
    const secondPage = await next.json() as Schema['NotificationPageDto'];
    await expect.poll(() => titles.allTextContents()).toEqual(secondPage.items.map(item => item.subject));
    expect(secondPage.items.filter(item => firstPage.items.some(original => original.id === item.id))).toHaveLength(0);
    await pager.locator('.ant-pagination-prev button').click();
    await expect.poll(() => titles.allTextContents()).toEqual(first);
    await page.screenshot({ path: testInfo.outputPath(`notification-pagination-${width}.png`) });
  }
  await changeSize(page, pager, false, 20);
  await expect(titles).toHaveCount(20);
  const larger = await positionRead<Schema['NotificationPageDto']>(page.request, '/api/v1/notifications?pageSize=20&offset=0');
  await expect.poll(() => titles.allTextContents()).toEqual(larger.items.map(item => item.subject));
  expect(larger.items.slice(0, 10).map(item => item.id)).toEqual(firstPage.items.map(item => item.id));
  await testInfo.attach('notification-pagination-geometry', { body: JSON.stringify(geometry, null, 2), contentType: 'application/json' });
  await writeFile(testInfo.outputPath('notification-pagination-geometry.json'), JSON.stringify(geometry, null, 2));
});

async function changeSize(page: Page, pager: Locator, custom: boolean, size: number) {
  if (custom) await pager.getByRole('combobox', { name: '每页条数', exact: true }).selectOption(String(size));
  else {
    await pager.getByRole('combobox').click();
    await page.locator('.ant-select-dropdown:visible .ant-select-item-option').filter({ hasText: new RegExp(`^${size}\\s*(条\\s*)?/[页a-z ]+$`, 'i') }).click();
  }
}

for (const scenario of [
  { name: 'supplier server pagination', route: '/console/master-data/suppliers', region: '供应商档案', path: '/api/v1/supplier-quality/profiles', custom: false },
  { name: 'material client pagination', route: '/console/master-data/materials', region: '物料主数据', path: '/api/v1/material-masters', custom: false },
  { name: 'receipt custom pagination', route: '/console/api-integrations', region: 'API接口管理', path: '/api/v1/admin/integrations/receipts', custom: true },
]) {
  test(`${scenario.name} stays above real data at desktop, 390 and 320 widths`, async ({ page }, testInfo) => {
    await login(page);
    const responses: { page: string | null; size: string | null; ids: string[] }[] = [];
    page.on('response', async response => {
      const url = new URL(response.url());
      if (url.pathname !== scenario.path || response.request().method() !== 'GET' || response.status() !== 200) return;
      const result = await response.json() as { items?: { id: string }[] } | { id: string }[];
      responses.push({ page: url.searchParams.get('page'), size: url.searchParams.get(scenario.custom ? 'limit' : 'pageSize'), ids: (Array.isArray(result) ? result : result.items!).map(item => item.id) });
    });
    await page.goto(scenario.route);
    const section = page.getByRole('region', { name: scenario.region, exact: true });
    if (scenario.custom) await section.getByRole('tab', { name: '接收记录', exact: true }).click();
    const ledger = section.locator('.qms-ledger');
    await expect(ledger).toHaveCount(1);
    await expect(ledger.locator('.ant-spin-spinning')).toHaveCount(0);
    const pager = scenario.custom ? ledger.getByRole('navigation', { name: '接收记录分页', exact: true }) : ledger.locator('.ant-pagination');
    await changeSize(page, pager, scenario.custom, 10);
    await expect(ledger.locator('tbody tr[data-row-key]')).toHaveCount(10);
    await expect(ledger.locator('.ant-spin-spinning')).toHaveCount(0);
    const first = await rowIds(ledger);
    if (scenario.path !== '/api/v1/material-masters') {
      await expect.poll(() => responses.some(response => response.page === '1' && response.size === '10' && JSON.stringify(response.ids) === JSON.stringify(first))).toBe(true);
    }
    const materialRequests = responses.length;
    const geometry: object[] = [];
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: width === 1440 ? 900 : 844 });
      geometry.push({ width, ...await assertTopGeometry(page, ledger, scenario.custom) });
      const next = scenario.custom ? pager.getByRole('button', { name: '下一页', exact: true }) : pager.locator('.ant-pagination-next button');
      const previous = scenario.custom ? pager.getByRole('button', { name: '上一页', exact: true }) : pager.locator('.ant-pagination-prev button');
      await expect(next).toBeEnabled();
      await next.click();
      await expect.poll(async () => {
        const identifiers = await rowIds(ledger);
        return identifiers.length === 10 && JSON.stringify(identifiers) !== JSON.stringify(first);
      }).toBe(true);
      const second = await rowIds(ledger);
      expect(second).toHaveLength(10);
      expect(second.filter(identifier => first.includes(identifier))).toHaveLength(0);
      if (scenario.path !== '/api/v1/material-masters') {
        await expect.poll(() => responses.some(response => response.page === '2' && response.size === '10' && JSON.stringify(response.ids) === JSON.stringify(second))).toBe(true);
      }
      await expect(previous).toBeEnabled();
      await previous.click();
      await expect.poll(() => rowIds(ledger)).toEqual(first);
      await page.screenshot({ path: testInfo.outputPath(`top-pagination-${width}.png`) });
    }
    await changeSize(page, pager, scenario.custom, 20);
    await expect(ledger.locator('tbody tr[data-row-key]')).toHaveCount(20);
    const larger = await rowIds(ledger);
    expect(larger.slice(0, 10)).toEqual(first);
    if (scenario.path === '/api/v1/material-masters') expect(responses).toHaveLength(materialRequests);
    else await expect.poll(() => responses.some(response => response.page === '1' && response.size === '20' && JSON.stringify(response.ids) === JSON.stringify(larger))).toBe(true);
    await assertTopGeometry(page, ledger, scenario.custom);
    await testInfo.attach('pagination-geometry', { body: JSON.stringify(geometry, null, 2), contentType: 'application/json' });
    await writeFile(testInfo.outputPath('pagination-geometry.json'), JSON.stringify(geometry, null, 2));
  });
}
