import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { writeFile } from 'node:fs/promises';
import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test';
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
let ingestionRule: Schema['IngestionRuleDto'];
let ingestionJobIds: string[];
const browserObservations = new WeakMap<Page, object[]>();

test.use({ trace: 'off', screenshot: 'off', video: 'off' });
test.beforeEach(async ({ page }) => {
  const started = Date.now();
  const observations: object[] = [];
  browserObservations.set(page, observations);
  page.on('pageerror', error => observations.push({ type: 'pageerror', message: error.message, elapsed: Date.now() - started }));
  page.on('requestfailed', request => observations.push({ type: 'requestfailed', path: new URL(request.url()).pathname, failure: request.failure()?.errorText, elapsed: Date.now() - started }));
  page.on('response', response => {
    const path = new URL(response.url()).pathname;
    if (path.startsWith('/api/')) observations.push({ type: 'response', path, status: response.status(), elapsed: Date.now() - started });
  });
});
test.beforeAll(async ({ request }, testInfo) => {
  const fixtureStartedAt = new Date();
  const organization = await prisma.organization.findUniqueOrThrow({ where: { code: 'LOCAL-INTERNAL' } });
  const user = await prisma.user.findUniqueOrThrow({ where: { organizationId_username: { organizationId: organization.id, username: 'local.internal' } } });
  const sessionsBefore = await prisma.session.count({ where: { userId: user.id } });
  if (sessionsBefore + 3 > 20) {
    expect(new URL(databaseURL!).pathname).toBe('/qms_table_toolbar');
    const removed = await prisma.session.deleteMany({ where: { userId: user.id, createdAt: { lt: fixtureStartedAt } } });
    await writeFile(testInfo.outputPath('fixture-session-isolation.json'), JSON.stringify({ scope: 'LOCAL-INTERNAL/local.internal disposable sessions only', sessionsBefore, removed: removed.count, createdBefore: fixtureStartedAt.toISOString(), beforeApiLogin: true }, null, 2));
  }
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
      body: JSON.stringify(Array.from({ length: ordinal === 0 ? 2 : 1 }, (_, row) => ({ acceptance: 'table-top-pagination', ordinal, code: `TOP_${suffix}_${ordinal}_${row}`, name: `分页验收客户 ${ordinal} ${row}` }))),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toBe(true);
  }
  expect(await prisma.integrationReceipt.count({ where: { endpointId: endpoint.id } })).toBe(21);
  const ingestionPath = '/api/v1/admin/integrations/ingestion';
  ingestionRule = await positionWrite<Schema['IngestionRuleDto']>(request, `${ingestionPath}/rules`, 'POST', {
    name: `紧凑工具栏规则 ${suffix}`, endpointId: endpoint.id, target: 'CUSTOMER', enabled: false, match: 'ALL', conditions: [], mapping: { code: 'code', name: 'name' }, mode: 'INSERT_ONLY', updateFields: [],
  } satisfies Schema['SaveIngestionRuleDto'], 201);
  const receipt = await prisma.integrationReceipt.findFirstOrThrow({ where: { endpointId: endpoint.id }, orderBy: { receivedAt: 'asc' } });
  ingestionJobIds = [];
  for (const rowIndex of [0, 1]) {
    const preview = await positionWrite<Schema['IngestionPreviewDto']>(request, `${ingestionPath}/preview`, 'POST', { ruleId: ingestionRule.id, ruleVersion: ingestionRule.version, receiptId: receipt.id, rowIndex }, 201);
    const imported = await positionWrite<Schema['IngestionImportResultDto']>(request, `${ingestionPath}/imports`, 'POST', { previewId: preview.previewId, confirmed: true }, 201);
    expect(imported.jobIds).toHaveLength(1);
    ingestionJobIds.push(...imported.jobIds);
  }
  expect(new Set(ingestionJobIds).size).toBe(2);
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
  const diagnostic = await writeBrowserState(page, testInfo.outputPath('failure-browser-state.json'));
  await testInfo.attach('failure-browser-state', { body: diagnostic, contentType: 'application/json' });
  if (!page.isClosed() && (new URL(page.url()).pathname.startsWith('/app/') || new URL(page.url()).pathname.startsWith('/console'))) {
    await page.screenshot({ path: testInfo.outputPath('failure-page.png') });
  }
});

async function writeBrowserState(page: Page, path: string) {
  let state: unknown = { closed: page.isClosed() };
  if (!page.isClosed()) {
    try {
      state = await page.locator('body').evaluate(body => ({
        readyState: document.readyState, rootChildren: document.querySelector('#root')?.childElementCount, bodyChildren: body.childElementCount,
        regions: [...body.querySelectorAll('[role="region"], section[aria-label]')].map(element => ({ name: element.getAttribute('aria-label'), bounds: element.getBoundingClientRect().toJSON() })),
        headings: [...body.querySelectorAll('h1, h2, h3')].map(element => element.textContent),
        tabs: [...body.querySelectorAll('[role="tab"]')].map(element => ({ text: element.textContent, hidden: element.getAttribute('aria-hidden'), selected: element.getAttribute('aria-selected'), bounds: element.getBoundingClientRect().toJSON() })),
      }));
    } catch (error) { state = { diagnosticError: error instanceof Error ? error.message : String(error) }; }
  }
  const diagnostic = JSON.stringify({ url: page.url(), observations: browserObservations.get(page) ?? [], state }, null, 2);
  await writeFile(path, diagnostic);
  return diagnostic;
}

async function login(page: Page, testInfo: TestInfo) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/login');
  await writeBrowserState(page, testInfo.outputPath('login-navigation.json'));
  await page.getByLabel('账号', { exact: true }).fill('local.internal');
  await fillSecret(page.getByLabel('密码', { exact: true }), password!);
  const authenticated = page.waitForResponse(response => new URL(response.url()).pathname === '/api/v1/auth/login' && response.request().method() === 'POST');
  await page.getByRole('button', { name: /^登\s*录$/ }).click();
  await completeMfa(page.request, await authenticated, 'local.internal', page);
  await expect(page).toHaveURL(/\/app\/workbench$/);
  await writeBrowserState(page, testInfo.outputPath('login-complete.json'));
}

async function rowIds(ledger: Locator) {
  return ledger.locator('tbody tr[data-row-key]').evaluateAll(rows => rows.map(row => row.getAttribute('data-row-key')));
}

async function assertTopGeometry(page: Page, ledger: Locator, custom: boolean, evidencePath: string, paginated = true) {
  const columns = ledger.getByRole('button', { name: /^(列设置|Columns)$/ });
  await expect(columns).toBeVisible();
  const pager = custom ? ledger.getByRole('navigation', { name: '接收记录分页', exact: true }) : ledger.locator('.ant-pagination');
  await expect(pager).toHaveCount(paginated ? 1 : 0);
  if (paginated) await pager.scrollIntoViewIfNeeded();
  else await columns.scrollIntoViewIfNeeded();
  if (custom) await expect(ledger.locator('.ant-pagination')).toHaveCount(0);
  const geometry = await ledger.evaluate(element => {
    const bounds = element.getBoundingClientRect();
    const pager = element.querySelector<HTMLElement>('nav[aria-label="接收记录分页"], .ant-pagination');
    const pagination = pager?.getBoundingClientRect();
    const content = pager ? [...pager.children].map(child => child.getBoundingClientRect()).filter(rect => rect.width > 0 && rect.height > 0) : [];
    const heading = element.querySelector('.ant-table-thead')!.getBoundingClientRect();
    const toolsElement = element.querySelector('.qms-ledger__tools')!;
    const tools = toolsElement.getBoundingClientRect();
    const toolsStyle = getComputedStyle(toolsElement);
    const columns = [...element.querySelectorAll<HTMLElement>('.qms-ledger__tools button')].find(button => /^(列设置|Columns)$/.test(button.textContent?.trim() ?? ''))!.getBoundingClientRect();
    const total = pager?.querySelector('span')?.getBoundingClientRect();
    const toolbarTop = Math.min(tools.top, pagination?.top ?? tools.top);
    const toolbarBottom = Math.max(tools.bottom, pagination?.bottom ?? tools.bottom);
    return {
      left: content.length ? Math.min(...content.map(rect => rect.left)) - bounds.left : columns.left - bounds.left, right: content.length ? bounds.right - Math.max(...content.map(rect => rect.right)) : bounds.right - columns.right,
      pagerBottom: pagination?.bottom ?? tools.bottom, headingTop: heading.top, viewportHeight: innerHeight,
      toolsLeft: tools.left, toolsRight: tools.right, columnsLeft: columns.left, columnsRight: columns.right,
      width: innerWidth, pageWidth: document.documentElement.scrollWidth,
      totalLeft: total ? total.left - tools.left : undefined, totalRight: total ? tools.right - total.right : undefined,
      toolbarHeight: toolbarBottom - toolbarTop, headingGap: heading.top - toolbarBottom,
      columnsHeight: columns.height, toolsPaddingBlock: Number.parseFloat(toolsStyle.paddingTop) + Number.parseFloat(toolsStyle.paddingBottom),
      centerDifference: pagination ? Math.abs((pagination.top + pagination.bottom - columns.top - columns.bottom) / 2) : null,
      pagerRight: content.length ? Math.max(...content.map(rect => rect.right)) : null,
      controlsOverlap: content.some(rect => Math.min(rect.right, columns.right) - Math.max(rect.left, columns.left) > 0.5 && Math.min(rect.bottom, columns.bottom) - Math.max(rect.top, columns.top) > 0.5),
      controlsOutside: content.some(rect => rect.left < bounds.left + 11.5 || rect.right > bounds.right - 11.5),
    };
  });
  await writeFile(evidencePath, JSON.stringify(geometry, null, 2));
  await page.screenshot({ path: evidencePath.replace(/\.json$/, '.png') });
  expect(geometry.pagerBottom).toBeLessThanOrEqual(geometry.headingTop + 1);
  expect(geometry.pagerBottom).toBeLessThanOrEqual(geometry.viewportHeight);
  expect(geometry.left).toBeGreaterThanOrEqual(11.5);
  expect(geometry.right).toBeGreaterThanOrEqual(11.5);
  expect(geometry.columnsLeft - geometry.toolsLeft).toBeGreaterThanOrEqual(11.5);
  expect(geometry.toolsRight - geometry.columnsRight).toBeGreaterThanOrEqual(11.5);
  expect(geometry.columnsRight).toBeLessThanOrEqual(geometry.width);
  expect(geometry.pageWidth).toBeLessThanOrEqual(geometry.width + 1);
  expect(geometry.headingGap).toBeGreaterThanOrEqual(3.5);
  expect(geometry.headingGap).toBeLessThanOrEqual(8.5);
  expect(geometry.controlsOverlap).toBe(false);
  expect(geometry.controlsOutside).toBe(false);
  if (geometry.width === 1440 && paginated) {
    expect(geometry.centerDifference).toBeLessThanOrEqual(1.5);
    expect(geometry.toolbarHeight).toBeGreaterThanOrEqual(47.5);
    expect(geometry.toolbarHeight).toBeLessThanOrEqual(56.5);
    expect(geometry.columnsLeft - geometry.pagerRight!).toBeGreaterThanOrEqual(3.5);
  } else if (!paginated) {
    expect(geometry.toolsPaddingBlock).toBe(12);
    expect(Math.abs(geometry.toolbarHeight - geometry.columnsHeight - geometry.toolsPaddingBlock)).toBeLessThanOrEqual(0.5);
    expect(geometry.toolbarHeight).toBeLessThanOrEqual(geometry.width <= 760 ? 56.5 : 44.5);
    if (geometry.width <= 760) expect(geometry.columnsHeight).toBeGreaterThanOrEqual(43.5);
  }
  if (custom) {
    expect(geometry.totalLeft).toBeGreaterThanOrEqual(11.5);
    expect(geometry.totalRight).toBeGreaterThanOrEqual(11.5);
  }
  await columns.click();
  await expect(page.getByRole('button', { name: /^(恢复全部列|Reset all columns)$/ })).toBeVisible();
  await columns.click();
  return geometry;
}

for (const scenario of [
  { name: 'management audit external toolbar', route: '/console/audit-log', region: '管理审计', path: '/api/v1/admin/audit-events' },
  { name: 'failed outbox external toolbar', route: '/console/outbox', region: '失败队列', path: '/api/v1/outbox/failures' },
]) {
  test(`${scenario.name} stays compact beside real column settings at desktop, 390 and 320`, async ({ page }, testInfo) => {
    await login(page, testInfo);
    const loaded = page.waitForResponse(response => new URL(response.url()).pathname === scenario.path && response.request().method() === 'GET');
    await page.goto(scenario.route);
    await writeBrowserState(page, testInfo.outputPath('governance-navigation.json'));
    const response = await loaded;
    expect(response.status()).toBe(200);
    const result = await response.json() as Schema['AuditPageDto'] | Schema['OutboxFailurePageDto'];
    const section = page.getByRole('region', { name: scenario.region, exact: true });
    const ledger = section.locator('.qms-ledger');
    await expect(ledger.locator('.ant-spin-spinning')).toHaveCount(0);
    await expect.poll(() => rowIds(ledger)).toEqual(result.items.map(item => item.id));
    await expect(ledger.locator('.ant-pagination')).toHaveCount(0);
    const toolbar = ledger.locator('.qms-ledger__tools > .governance-toolbar');
    await expect(toolbar).toHaveCount(1);
    await expect(toolbar.getByRole('combobox', { name: '每页条数', exact: true })).toBeEnabled();
    const columns = ledger.getByRole('button', { name: '列设置', exact: true });
    const geometry: object[] = [];
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: width === 1440 ? 900 : 844 });
      await toolbar.scrollIntoViewIfNeeded();
      const measured = await ledger.evaluate(element => {
        const bounds = element.getBoundingClientRect();
        const tools = element.querySelector('.qms-ledger__tools')!.getBoundingClientRect();
        const toolbar = element.querySelector('.qms-ledger__tools > .governance-toolbar')!;
        const toolbarBounds = toolbar.getBoundingClientRect();
        const controls = [...toolbar.children].map(control => control.getBoundingClientRect()).filter(rect => rect.width > 0 && rect.height > 0);
        const columns = [...element.querySelectorAll('.qms-ledger__tools button')].find(button => button.textContent?.trim() === '列设置')!.getBoundingClientRect();
        const heading = element.querySelector('.ant-table-thead')!.getBoundingClientRect();
        const style = getComputedStyle(toolbar);
        return {
          width: innerWidth, pageWidth: document.documentElement.scrollWidth, height: tools.height, gap: heading.top - tools.bottom,
          centerDifference: Math.abs((toolbarBounds.top + toolbarBounds.bottom - columns.top - columns.bottom) / 2),
          left: Math.min(...controls.map(rect => rect.left)) - bounds.left, right: bounds.right - columns.right,
          lastControlRight: Math.max(...controls.map(rect => rect.right)), columnsLeft: columns.left,
          controlsOverlap: controls.some(rect => Math.min(rect.right, columns.right) - Math.max(rect.left, columns.left) > 0.5 && Math.min(rect.bottom, columns.bottom) - Math.max(rect.top, columns.top) > 0.5),
          controlsOutside: controls.some(rect => rect.left < bounds.left + 11.5 || rect.right > bounds.right - 11.5),
          nestedPadding: [style.paddingTop, style.paddingRight, style.paddingBottom, style.paddingLeft],
          nestedBorder: [style.borderTopWidth, style.borderRightWidth, style.borderBottomWidth, style.borderLeftWidth],
        };
      });
      geometry.push(measured);
      await writeFile(testInfo.outputPath(`governance-${width}-geometry.json`), JSON.stringify(measured, null, 2));
      await page.screenshot({ path: testInfo.outputPath(`governance-${width}.png`) });
      expect(measured.left).toBeGreaterThanOrEqual(11.5);
      expect(measured.right).toBeGreaterThanOrEqual(11.5);
      expect(measured.gap).toBeGreaterThanOrEqual(3.5);
      expect(measured.gap).toBeLessThanOrEqual(8.5);
      expect(measured.pageWidth).toBeLessThanOrEqual(width + 1);
      expect(measured.controlsOverlap).toBe(false);
      expect(measured.controlsOutside).toBe(false);
      expect(measured.nestedPadding).toEqual(['0px', '0px', '0px', '0px']);
      expect(measured.nestedBorder).toEqual(['0px', '0px', '0px', '0px']);
      if (width === 1440) {
        expect(measured.height).toBeGreaterThanOrEqual(47.5);
        expect(measured.height).toBeLessThanOrEqual(56.5);
        expect(measured.centerDifference).toBeLessThanOrEqual(1.5);
        expect(measured.columnsLeft - measured.lastControlRight).toBeGreaterThanOrEqual(3.5);
      }
      await columns.click();
      await expect(page.getByRole('button', { name: '恢复全部列', exact: true })).toBeVisible();
      await columns.click();
    }
    await testInfo.attach('governance-toolbar-geometry', { body: JSON.stringify({ path: scenario.path, total: result.total, geometry }, null, 2), contentType: 'application/json' });
  });
}

for (const scenario of [
  { name: 'ingestion rules', tab: '规则', ids: () => [ingestionRule.id], path: '/api/v1/admin/integrations/ingestion/rules' },
  { name: 'ingestion jobs', tab: '处理任务', ids: () => ingestionJobIds, path: '/api/v1/admin/integrations/ingestion/jobs' },
]) {
  test(`${scenario.name} keep real pagination and columns on one compact desktop row and wrap at 390 and 320`, async ({ page }, testInfo) => {
    await login(page, testInfo);
    await page.goto('/console/api-ingestion');
    await writeBrowserState(page, testInfo.outputPath('ingestion-navigation.json'));
    const section = page.getByRole('region', { name: 'API入库衔接', exact: true });
    await section.getByRole('tab', { name: scenario.tab, exact: true }).click();
    const ledger = section.getByRole('tabpanel', { name: scenario.tab, exact: true }).locator('.qms-ledger');
    await expect(ledger.locator('.ant-spin-spinning')).toHaveCount(0);
    const actual = await positionRead<Schema['IngestionRulePageDto'] | Schema['IngestionJobPageDto']>(page.request, `${scenario.path}?page=1&limit=20`);
    expect(actual.items.map(item => item.id)).toEqual(expect.arrayContaining(scenario.ids()));
    await expect.poll(() => rowIds(ledger)).toEqual(actual.items.map(item => item.id));
    const geometry: object[] = [];
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: width === 1440 ? 900 : 844 });
      geometry.push(await assertTopGeometry(page, ledger, false, testInfo.outputPath(`ingestion-${width}-geometry.json`)));
      await expect.poll(() => rowIds(ledger)).toEqual(actual.items.map(item => item.id));
    }
    await testInfo.attach('ingestion-geometry', { body: JSON.stringify(geometry, null, 2), contentType: 'application/json' });
  });
}

test('real rule refresh keeps compact geometry and reachable column settings under the loading mask', async ({ page }, testInfo) => {
  await login(page, testInfo);
  await page.goto('/console/api-ingestion');
  await writeBrowserState(page, testInfo.outputPath('ingestion-navigation.json'));
  const panel = page.getByRole('tabpanel', { name: '规则', exact: true });
  const ledger = panel.locator('.qms-ledger');
  await expect(ledger.locator(`tr[data-row-key="${ingestionRule.id}"]`)).toBeVisible();
  let releaseRequest!: () => void;
  const released = new Promise<void>(resolve => { releaseRequest = resolve; });
  const path = '/api/v1/admin/integrations/ingestion/rules';
  await page.route(url => url.pathname === path, async route => { await released; await route.continue(); });
  const response = page.waitForResponse(value => new URL(value.url()).pathname === path && value.request().method() === 'GET');
  try {
    await panel.getByRole('button', { name: '刷新规则', exact: true }).click();
    await expect(ledger.locator('.ant-spin-spinning')).toHaveCount(1);
    await expect(ledger.locator('.ant-spin-container')).toHaveCSS('pointer-events', 'none');
    await expect(ledger.locator('.ant-spin > .ant-spin-section')).toBeVisible();
    await assertTopGeometry(page, ledger, false, testInfo.outputPath('loading-geometry.json'), false);
  } finally { releaseRequest(); }
  expect((await response).status()).toBe(200);
  await expect(ledger.locator('.ant-spin-spinning')).toHaveCount(0);
  await expect(ledger.locator(`tr[data-row-key="${ingestionRule.id}"]`)).toBeVisible();
  await assertTopGeometry(page, ledger, false, testInfo.outputPath('loaded-geometry.json'));
});

test('real empty job filter keeps a compact toolbar without a blank pagination row at all widths', async ({ page }, testInfo) => {
  await login(page, testInfo);
  const receiptId = randomUUID();
  const actual = await positionRead<Schema['IngestionJobPageDto']>(page.request, `/api/v1/admin/integrations/ingestion/jobs?receiptId=${receiptId}&page=1&limit=20`);
  expect(actual.items).toHaveLength(0);
  expect(actual.total).toBe(0);
  await page.goto(`/console/api-ingestion?receiptId=${receiptId}`);
  await writeBrowserState(page, testInfo.outputPath('empty-jobs-navigation.json'));
  const ledger = page.getByRole('tabpanel', { name: '处理任务', exact: true }).locator('.qms-ledger');
  await expect(ledger.locator('.ant-spin-spinning')).toHaveCount(0);
  await expect(ledger.locator('.ant-empty')).toBeVisible();
  await expect(ledger.locator('tbody tr[data-row-key]')).toHaveCount(0);
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: width === 1440 ? 900 : 844 });
    await assertTopGeometry(page, ledger, false, testInfo.outputPath(`empty-${width}-geometry.json`), false);
  }
});

test('real account single-page session history hides pagination without leaving an empty row', async ({ page }, testInfo) => {
  await login(page, testInfo);
  const actual = await positionRead<Schema['AccountSessionHistoryPageDto']>(page.request, '/api/v1/me/sessions/history?page=1&pageSize=20');
  expect(actual.total).toBeGreaterThan(0);
  expect(actual.total).toBeLessThanOrEqual(actual.pageSize);
  await page.goto('/app/account');
  await writeBrowserState(page, testInfo.outputPath('account-navigation.json'));
  const section = page.getByRole('region', { name: '登录会话', exact: true });
  await expect(section.locator('.ant-spin-spinning')).toHaveCount(0);
  await expect(section.locator('tbody tr[data-row-key]')).toHaveCount(actual.items.length);
  await expect(section.locator('.ant-pagination')).toHaveCount(0);
  const table = section.locator('.ant-table-wrapper');
  await expect(table).toHaveCount(1);
  await expect(table.locator('.ant-table-header .ant-table-thead')).toHaveCount(1);
  const geometry: object[] = [];
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: width === 1440 ? 900 : 844 });
    await table.scrollIntoViewIfNeeded();
    const measured = await section.evaluate(element => {
      const wrapper = element.querySelector('.ant-table-wrapper')!.getBoundingClientRect();
      const heading = element.querySelector('.ant-table-header .ant-table-thead')!.getBoundingClientRect();
      return { width: innerWidth, pageWidth: document.documentElement.scrollWidth, emptyRowHeight: heading.top - wrapper.top };
    });
    geometry.push(measured);
    await writeFile(testInfo.outputPath(`hidden-single-${width}-geometry.json`), JSON.stringify(measured, null, 2));
    await page.screenshot({ path: testInfo.outputPath(`hidden-single-${width}.png`) });
    expect(measured.emptyRowHeight).toBeGreaterThanOrEqual(-0.5);
    expect(measured.emptyRowHeight).toBeLessThanOrEqual(1.5);
    expect(measured.pageWidth).toBeLessThanOrEqual(measured.width + 1);
  }
  await testInfo.attach('hidden-single-geometry', { body: JSON.stringify(geometry, null, 2), contentType: 'application/json' });
});

test('real notifications use a single pager above the business list at desktop and narrow widths', async ({ page }, testInfo) => {
  const started = Date.now();
  const observations: object[] = [];
  page.on('pageerror', error => observations.push({ type: 'pageerror', message: error.message, elapsed: Date.now() - started }));
  page.on('response', response => {
    const url = new URL(response.url());
    if (url.pathname.startsWith('/api/')) observations.push({ type: 'response', path: url.pathname, status: response.status(), elapsed: Date.now() - started });
  });
  page.on('requestfailed', request => observations.push({ type: 'requestfailed', path: new URL(request.url()).pathname, elapsed: Date.now() - started }));
  await login(page, testInfo);
  observations.push({ type: 'login-complete', elapsed: Date.now() - started });
  await page.goto('/app/my-tasks');
  await writeBrowserState(page, testInfo.outputPath('tasks-navigation.json'));
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
    await login(page, testInfo);
    const responses: { page: string | null; size: string | null; ids: string[] }[] = [];
    page.on('response', async response => {
      const url = new URL(response.url());
      if (url.pathname !== scenario.path || response.request().method() !== 'GET' || response.status() !== 200) return;
      const result = await response.json() as { items?: { id: string }[] } | { id: string }[];
      responses.push({ page: url.searchParams.get('page'), size: url.searchParams.get(scenario.custom ? 'limit' : 'pageSize'), ids: (Array.isArray(result) ? result : result.items!).map(item => item.id) });
    });
    await page.goto(scenario.route);
    await writeBrowserState(page, testInfo.outputPath('ledger-navigation.json'));
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
      geometry.push({ width, ...await assertTopGeometry(page, ledger, scenario.custom, testInfo.outputPath(`top-pagination-${width}-geometry.json`)) });
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
    await assertTopGeometry(page, ledger, scenario.custom, testInfo.outputPath('top-pagination-size20-geometry.json'));
    await testInfo.attach('pagination-geometry', { body: JSON.stringify(geometry, null, 2), contentType: 'application/json' });
    await writeFile(testInfo.outputPath('pagination-geometry.json'), JSON.stringify(geometry, null, 2));
  });
}
