import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import type { components } from '@qms/contracts';
import { completeMfa, takeMfaRecoveryCode } from './mfa-login';
import { positionRead, positionWrite } from './position-fixture';
import { fillSecret } from './secret-input';

type Schema = components['schemas'];
const baseURL = process.env.QMS_ACCEPTANCE_BASE_URL;
const databaseURL = process.env.DATABASE_URL;
const password = process.env.QMS_SEED_INTERNAL_PASSWORD;
if (!baseURL || !databaseURL || !password || !process.env.QMS_ACCEPTANCE_MFA_CACHE_FILE || !process.env.QMS_BACKUP_KEY
  || process.env.QMS_DISPOSABLE_TEST_DB !== 'true' || process.env.QMS_ACCEPTANCE_DISPOSABLE_DATABASE !== 'true') {
  throw new Error('Ingestion browser acceptance requires disposable PostgreSQL, a real gateway and external encrypted MFA credentials.');
}
for (const value of [baseURL, databaseURL]) {
  const url = new URL(value);
  if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.port === '55440' || url.search || url.hash) {
    throw new Error('Ingestion browser acceptance requires loopback resources outside preserved preview 55440.');
  }
}
const requireApi = createRequire(new URL('../../api/package.json', import.meta.url));
const { PrismaPg } = requireApi('@prisma/adapter-pg');
const { PrismaClient } = await import('../../api/dist/generated/prisma/client.js');
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseURL }) });
const root = '/api/v1/admin/integrations/ingestion';
const suffix = randomUUID().replaceAll('-', '').slice(0, 10).toUpperCase();
let fixtureRoleId: string;
let administratorPermissionId: string | undefined;

test.setTimeout(240_000);
test.use({ trace: 'off', screenshot: 'off', video: 'off', actionTimeout: 15_000, navigationTimeout: 20_000 });
test.beforeAll(async () => {
  const organization = await prisma.organization.findUniqueOrThrow({ where: { code: 'LOCAL-INTERNAL' } });
  const user = await prisma.user.findUniqueOrThrow({ where: { organizationId_username: { organizationId: organization.id, username: 'local.internal' } } });
  const assignment = await prisma.userRole.findFirstOrThrow({ where: { organizationId: organization.id, userId: user.id, role: { code: 'LOCAL_MEMBER' } } });
  fixtureRoleId = assignment.roleId;
  expect(await prisma.rolePermission.count({ where: { roleId: fixtureRoleId, permission: { code: { startsWith: 'ingestion:' } } } })).toBe(0);
  const permission = await prisma.permission.findUniqueOrThrow({ where: { code: 'platform:admin' } });
  const where = { roleId_permissionId: { roleId: fixtureRoleId, permissionId: permission.id } };
  if (!await prisma.rolePermission.findUnique({ where })) {
    await prisma.rolePermission.create({ data: where.roleId_permissionId });
    administratorPermissionId = permission.id;
  }
});
test.afterAll(async () => {
  try {
    if (administratorPermissionId) await prisma.rolePermission.deleteMany({ where: { roleId: fixtureRoleId, permissionId: administratorPermissionId } });
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
  await page.goto('/console');
  await page.getByRole('link', { name: 'API入库衔接', exact: true }).click();
  await expect(page).toHaveURL(/\/console\/api-ingestion/);
  await expect(page.getByRole('button', { name: '新增规则', exact: true })).toBeVisible();
}
async function worker() {
  const result = await promisify(execFile)(process.execPath, ['dist/worker.js', '--once'], {
    cwd: fileURLToPath(new URL('../../api/', import.meta.url)), windowsHide: true, timeout: 45_000,
    env: { ...process.env, QMS_WORKER_BATCH_SIZE: '100', NODE_OPTIONS: '--max-old-space-size=512' },
  });
  expect(result.stdout).toContain('QMS_WORKER_READY');
  expect(result.stderr).not.toContain('QMS_WORKER_FAILED');
}

test('administrator configures ingestion and real compiled Worker imports four targets with receipt-linked confirmation', async ({ page }) => {
  await login(page);
  const organization = await prisma.organization.findUniqueOrThrow({ where: { code: 'LOCAL-INTERNAL' } });
  async function endpoint(code: string) {
    let configured = await positionWrite<Schema['IntegrationEndpointDto']>(page.request, '/api/v1/admin/integrations/endpoints', 'POST', {
      code: `${code}_${suffix}`, name: `${code}验收${suffix}`, sourceCode: `ING_${suffix}`, sourceName: '入库浏览器一次性来源', returnReceipt: true,
    }, 201);
    const credential = await positionWrite<Schema['IntegrationCredentialDto']>(page.request, `/api/v1/admin/integrations/endpoints/${configured.id}/credentials`, 'POST', { name: '一次性入库验收', validityDays: null }, 201);
    configured = await positionWrite<Schema['IntegrationEndpointDto']>(page.request, `/api/v1/admin/integrations/endpoints/${configured.id}`, 'PATCH', { expectedVersion: configured.version, status: 'ENABLED' });
    return { ...configured, secret: credential.secret! };
  }
  const external = await endpoint('EXT'), parts = await endpoint('PART');
  async function send(selected: typeof external, rows: object[]) {
    const response = await fetch(new URL(`/api/v1/integrations/inbound/${selected.code}/messages`, baseURL), {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15_000), headers: { Authorization: `Bearer ${selected.secret}`, 'Content-Type': 'application/json' }, body: JSON.stringify(rows),
    });
    expect(response.status).toBe(200); expect(await response.json()).toBe(true);
    return prisma.integrationReceipt.findFirstOrThrow({ where: { endpointId: selected.id }, orderBy: { receivedAt: 'desc' } });
  }
  const ruleName = `供应商验收${suffix}`;
  await page.reload();
  await page.getByRole('button', { name: '新增规则', exact: true }).click();
  const editor = page.getByRole('dialog', { name: '新增入库规则', exact: true });
  await editor.getByLabel('规则名称', { exact: true }).fill(ruleName);
  await editor.getByLabel('接收接口', { exact: true }).click();
  await page.locator('.ant-select-dropdown:visible .ant-select-item-option').filter({ hasText: external.name }).click();
  await editor.getByLabel('编码来源字段', { exact: true }).fill('code');
  await editor.getByLabel('名称来源字段', { exact: true }).fill('name');
  await editor.getByRole('button', { name: '添加条件', exact: true }).click();
  await editor.getByLabel('判断字段1', { exact: true }).fill('kind');
  await editor.getByLabel('比较值', { exact: true }).fill('supplier');
  await editor.getByLabel('已有记录处理', { exact: true }).click();
  await page.locator('.ant-select-dropdown:visible .ant-select-item-option').filter({ hasText: '新增，变更人工确认' }).click();
  await editor.getByRole('checkbox', { name: '名称', exact: true }).check();
  const saved = page.waitForResponse(response => new URL(response.url()).pathname === `${root}/rules` && response.request().method() === 'POST');
  await editor.getByRole('button', { name: /^保\s*存$/ }).click();
  const savedResponse = await saved; expect(savedResponse.status()).toBe(201);
  const supplierRule = await savedResponse.json() as Schema['IngestionRuleDto'];
  await expect(editor).toHaveCount(0);
  const rules: Schema['IngestionRuleDto'][] = [supplierRule];
  for (const [target, kind, selected] of [['CUSTOMER', 'customer', external], ['MATERIAL', 'material', parts], ['COMPONENT', 'component', parts]] as const) {
    rules.push(await positionWrite<Schema['IngestionRuleDto']>(page.request, `${root}/rules`, 'POST', {
      name: `${target}${suffix}`, endpointId: selected.id, target, enabled: false, match: 'ALL', conditions: [{ path: 'kind', operator: 'EQ', value: kind }], mapping: { code: 'code', name: 'name' }, mode: 'UPDATE', updateFields: ['name'],
    } satisfies Schema['SaveIngestionRuleDto'], 201));
  }
  const supplierCode = `SUP_${suffix}`;
  const initial = await send(external, [{ kind: 'supplier', code: supplierCode, name: '供应商初始名称' }, { kind: 'customer', code: `CUS_${suffix}`, name: '客户初始名称' }]);
  const supplierRow = page.getByRole('row').filter({ hasText: ruleName });
  await supplierRow.getByRole('button', { name: '单条试处理', exact: true }).click();
  const previewDialog = page.getByRole('dialog', { name: `单条试处理 · ${ruleName}`, exact: true });
  await previewDialog.getByLabel('接收记录', { exact: true }).click();
  await page.locator('.ant-select-dropdown:visible .ant-select-item-option').filter({ hasText: initial.messageId }).click();
  await previewDialog.getByRole('button', { name: '生成预览', exact: true }).click();
  await expect(previewDialog.getByRole('region', { name: '入库预览', exact: true })).toBeVisible();
  expect(await prisma.supplierBusinessProfile.count({ where: { ownerOrganizationId: organization.id, businessCode: supplierCode } })).toBe(0);
  await previewDialog.getByRole('button', { name: '确认导入', exact: true }).click();
  await expect(previewDialog.getByRole('status')).toContainText('已提交处理任务');
  await previewDialog.getByRole('button', { name: '关闭', exact: true }).click();
  const customerRule = rules[1]!;
  const history = await positionWrite<Schema['IngestionPreviewDto']>(page.request, `${root}/imports/preview`, 'POST', { ruleId: customerRule.id, ruleVersion: customerRule.version, from: new Date(Date.now() - 60_000).toISOString(), to: new Date().toISOString() }, 201);
  await positionWrite(page.request, `${root}/imports`, 'POST', { previewId: history.previewId, confirmed: true }, 201);
  await worker();
  expect(await prisma.supplierBusinessProfile.findFirst({ where: { ownerOrganizationId: organization.id, businessCode: supplierCode } })).toMatchObject({ displayName: '供应商初始名称' });
  expect(await prisma.customerQualityCustomer.findFirst({ where: { organizationId: organization.id, code: `CUS_${suffix}` } })).toMatchObject({ name: '客户初始名称' });
  for (const rule of rules) {
    const { name, endpointId, target, match, conditions, mapping, mode, updateFields, sourceUpdatedAtField } = rule;
    await positionWrite<Schema['IngestionRuleDto']>(page.request, `${root}/rules/${rule.id}`, 'PATCH', { name, endpointId, target, match, conditions, mapping, mode, updateFields, sourceUpdatedAtField, expectedVersion: rule.version, enabled: true } satisfies Schema['UpdateIngestionRuleDto']);
  }
  const changed = await send(external, [{ kind: 'supplier', code: supplierCode, name: '供应商确认后名称' }, { kind: 'customer', code: `CUS_${suffix}`, name: '客户最新名称' }]);
  await send(parts, [{ kind: 'material', code: `MAT_${suffix}`, name: '物料名称' }, { kind: 'component', code: `CMP_${suffix}`, name: '组件名称' }, { kind: 'material', code: `MAT_${suffix}`, name: '物料最终名称' }]);
  await worker();
  expect(await prisma.materialMaster.findFirst({ where: { organizationId: organization.id, materialCode: `MAT_${suffix}` } })).toMatchObject({ materialName: '物料最终名称' });
  const componentsPage = await positionRead<Schema['ComponentProjectMappingsPageDto']>(page.request, `/api/v1/admin/configuration/component-project-mappings?configuration=PENDING&search=${suffix}`);
  expect(componentsPage.items.some(item => item.componentCode === `CMP_${suffix}`)).toBe(true);
  await page.goto(`/console/api-ingestion?receiptId=${changed.id}`);
  await expect(page.getByRole('tab', { name: '处理任务' })).toHaveAttribute('aria-selected', 'true');
  const jobs = await positionRead<Schema['IngestionJobPageDto']>(page.request, `${root}/jobs?receiptId=${changed.id}`);
  expect(jobs.items.length).toBeGreaterThan(0);
  expect(jobs.items.every(job => job.receiptId === changed.id)).toBe(true);
  const waiting = jobs.items.find(job => job.target === 'SUPPLIER')!;
  expect(waiting).toBeDefined();
  expect(waiting.awaitingConfirmation).toBe(1);
  await page.getByRole('button', { name: `查看任务${waiting.sequence}`, exact: true }).click();
  await page.getByRole('button', { name: '查看差异', exact: true }).first().click();
  const detail = page.getByRole('dialog', { name: '数组第1行', exact: true });
  await expect(detail.getByText('供应商确认后名称', { exact: true }).first()).toBeVisible();
  await detail.getByLabel('确认 / 跳过原因', { exact: true }).fill('浏览器实际确认差异');
  await detail.getByRole('button', { name: '确认更新', exact: true }).click();
  await expect(detail).toHaveCount(0);
  expect(await prisma.supplierBusinessProfile.findFirst({ where: { ownerOrganizationId: organization.id, businessCode: supplierCode } })).toMatchObject({ displayName: '供应商确认后名称' });
  await page.goto('/console/api-ingestion');
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('button', { name: '新增规则', exact: true })).toBeVisible();
  await expect(page.locator('.qms-ingestion-page .ant-spin-spinning')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
});

test('historical imports accept more than 100 receipts and 10000 rows with real background processing', async ({ page }) => {
  await login(page);
  const organization = await prisma.organization.findUniqueOrThrow({ where: { code: 'LOCAL-INTERNAL' } });
  const user = await prisma.user.findUniqueOrThrow({ where: { organizationId_username: { organizationId: organization.id, username: 'local.internal' } } });
  const recoverySuffix = randomUUID().replaceAll('-', '').slice(0, 12);
  let endpoint = await positionWrite<Schema['IntegrationEndpointDto']>(page.request, '/api/v1/admin/integrations/endpoints', 'POST', {
    code: `RECOVERY_${recoverySuffix}`, name: `预览恢复${recoverySuffix}`, sourceCode: `RECOVERY_${recoverySuffix}`, sourceName: '真实预览恢复验收', returnReceipt: true, ratePerMinute: 300,
  }, 201);
  const credential = await positionWrite<Schema['IntegrationCredentialDto']>(page.request, `/api/v1/admin/integrations/endpoints/${endpoint.id}/credentials`, 'POST', { name: '预览恢复凭据', validityDays: null }, 201);
  endpoint = await positionWrite<Schema['IntegrationEndpointDto']>(page.request, `/api/v1/admin/integrations/endpoints/${endpoint.id}`, 'PATCH', { expectedVersion: endpoint.version, status: 'ENABLED' });
  const rule = await positionWrite<Schema['IngestionRuleDto']>(page.request, `${root}/rules`, 'POST', {
    name: `预览恢复规则${recoverySuffix}`, endpointId: endpoint.id, target: 'CUSTOMER', enabled: false, match: 'ALL', conditions: [], mapping: { code: 'code', name: 'name' }, mode: 'INSERT_ONLY', updateFields: [],
  } satisfies Schema['SaveIngestionRuleDto'], 201);
  for (let ordinal = 0; ordinal < 101; ordinal++) {
    const response = await fetch(new URL(`/api/v1/integrations/inbound/${endpoint.code}/messages`, baseURL), {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15_000), headers: { Authorization: `Bearer ${credential.secret!}`, 'Content-Type': 'application/json' },
      body: JSON.stringify([{ code: `RC_${recoverySuffix}_${ordinal}`, name: `真实恢复客户${ordinal}` }]),
    });
    expect(response.status).toBe(200); expect(await response.json()).toBe(true);
  }
  const receipts = await prisma.integrationReceipt.findMany({ where: { endpointId: endpoint.id }, orderBy: { receivedAt: 'asc' } });
  expect(receipts).toHaveLength(101);
  const normal = receipts[0]!;
  await prisma.integrationReceipt.updateMany({ where: { endpointId: endpoint.id }, data: { receivedAt: new Date(Date.now() - 3_600_000) } });
  await prisma.integrationReceipt.update({ where: { id: normal.id }, data: { receivedAt: new Date(Date.now() - 120_000) } });
  await prisma.$executeRaw`UPDATE integration_receipts SET row_count=NULL WHERE endpoint_id=${endpoint.id}::uuid`;
  const activeSession = await prisma.session.findFirstOrThrow({ where: { userId: user.id, revokedAt: null, expiresAt: { gt: new Date() } }, orderBy: { createdAt: 'desc' } });
  const oldReauthenticatedAt = activeSession.reauthenticatedAt;
  const reauthRequests: string[] = [];
  page.on('request', request => { if (new URL(request.url()).pathname === '/api/v1/me/reauthenticate') reauthRequests.push(request.url()); });
  try {
    await prisma.session.update({ where: { id: activeSession.id }, data: { reauthenticatedAt: new Date(Date.now() - 600_000) } });
    await page.goto(`/console/api-ingestion?receiptId=${receipts[1]!.id}`);
    await page.getByRole('tab', { name: '规则', exact: true }).click();
    const row = page.getByRole('row').filter({ hasText: rule.name });
    await row.getByRole('button', { name: '单条试处理', exact: true }).click();
    const single = page.getByRole('dialog', { name: `单条试处理 · ${rule.name}`, exact: true });
    await single.getByLabel('接收记录', { exact: true }).click();
    await page.locator('.ant-select-dropdown:visible .ant-select-item-option').filter({ hasText: normal.messageId }).click();
    const singlePreview = page.waitForResponse(response => new URL(response.url()).pathname === `${root}/preview` && response.request().method() === 'POST');
    await single.getByRole('button', { name: '生成预览', exact: true }).click();
    expect((await singlePreview).status()).toBe(201);
    await expect(single.getByRole('region', { name: '入库预览', exact: true })).toBeVisible();
    await single.getByRole('button', { name: '关闭', exact: true }).click();
    await page.getByRole('dialog', { name: '当前草稿尚未保存，继续将放弃修改。', exact: true }).getByRole('button', { name: '放弃修改并关闭', exact: true }).click();
    await expect(single).toHaveCount(0);

    await row.getByRole('button', { name: '历史批量导入', exact: true }).click();
    const history = page.getByRole('dialog', { name: `历史批量导入 · ${rule.name}`, exact: true });
    const localTime = (date: Date) => new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
    await history.getByLabel('接收时间起', { exact: true }).fill(localTime(new Date(Date.now() - 7_200_000)));
    await history.getByLabel('接收时间止', { exact: true }).fill(localTime(new Date(Date.now() - 1_000)));
    const historicalPreview = page.waitForResponse(response => new URL(response.url()).pathname === `${root}/imports/preview` && response.request().method() === 'POST');
    await history.getByRole('button', { name: '生成预览', exact: true }).click();
    const previewResponse = await historicalPreview;
    expect(previewResponse.status()).toBe(201);
    expect(await previewResponse.json()).toMatchObject({ receiptCount: 101, rowCount: null });
    await expect(history.getByText('数据条数: 后台统计', { exact: true })).toBeVisible();
    await expect(history.getByRole('button', { name: '确认导入', exact: true })).toBeEnabled();
    const imported = page.waitForResponse(response => new URL(response.url()).pathname === `${root}/imports` && response.request().method() === 'POST');
    await history.getByRole('button', { name: '确认导入', exact: true }).click();
    const importResponse = await imported;
    expect(importResponse.status()).toBe(201);
    const result = await importResponse.json() as Schema['IngestionImportResultDto'];
    expect(result.jobIds).toHaveLength(1);
    expect(result.receiptCount).toBe(101);
    await history.getByRole('button', { name: '查看处理任务', exact: true }).click();
    await expect(page.getByRole('tab', { name: '处理任务', exact: true })).toHaveAttribute('aria-selected', 'true');
    await expect(page).toHaveURL(/\/console\/api-ingestion$/);
    const jobs = await positionRead<Schema['IngestionJobPageDto']>(page.request, `${root}/jobs?receiptId=${normal.id}`);
    expect(jobs.items.map(job => job.id)).toEqual(result.jobIds);
    await expect(page.getByRole('row').filter({ hasText: endpoint.name }).getByRole('button', { name: `查看任务${jobs.items[0]!.sequence}`, exact: true })).toBeVisible();
    let batch = await positionRead<Schema['IngestionJobDto']>(page.request, `${root}/jobs/${result.jobIds[0]}`);
    for (let cycle = 0; cycle < 4 && batch.status !== 'COMPLETED'; cycle++) {
      await worker();
      batch = await positionRead<Schema['IngestionJobDto']>(page.request, `${root}/jobs/${result.jobIds[0]}`);
    }
    expect(batch).toMatchObject({ status: 'COMPLETED', total: 101, succeeded: 101, expansionComplete: true });
    expect(await prisma.customerQualityCustomer.count({ where: { organizationId: organization.id, code: { startsWith: `RC_${recoverySuffix.toUpperCase()}_` } } })).toBe(101);
    await page.getByRole('button', { name: '刷新任务', exact: true }).click();
    await page.getByRole('row').filter({ hasText: endpoint.name }).getByRole('button', { name: `查看任务${batch.sequence}`, exact: true }).click();
    const batchDetail = page.getByRole('dialog', { name: `${endpoint.name} · #${batch.sequence}`, exact: true });
    await expect(batchDetail.getByRole('button', { name: '查看差异', exact: true }).first()).toBeVisible();
    await expect(batchDetail.getByText('历史接收集合', { exact: true })).toBeVisible();
    await batchDetail.getByRole('button', { name: '关闭', exact: true }).click();

    const largeBody = JSON.stringify(Array.from({ length: 10001 }, (_, ordinal) => ({ code: `BIG_${recoverySuffix}_${ordinal}`, name: `历史大数组${ordinal}` })));
    const largeResponse = await fetch(new URL(`/api/v1/integrations/inbound/${endpoint.code}/messages`, baseURL), {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15_000), headers: { Authorization: `Bearer ${credential.secret!}`, 'Content-Type': 'application/json' }, body: largeBody,
    });
    expect(largeResponse.status).toBe(200);
    expect(await largeResponse.json()).toBe(true);
    const largeReceipt = await prisma.integrationReceipt.findFirstOrThrow({ where: { endpointId: endpoint.id }, orderBy: { receivedAt: 'desc' } });
    const largePreview = await positionWrite<Schema['IngestionPreviewDto']>(page.request, `${root}/imports/preview`, 'POST', {
      ruleId: rule.id, ruleVersion: rule.version, from: new Date(largeReceipt.receivedAt.getTime() - 1).toISOString(), to: new Date().toISOString(),
    }, 201);
    expect(largePreview).toMatchObject({ receiptCount: 1, rowCount: 10001 });
    const largeImport = await positionWrite<Schema['IngestionImportResultDto']>(page.request, `${root}/imports`, 'POST', { previewId: largePreview.previewId, confirmed: true }, 201);
    expect(largeImport.jobIds).toHaveLength(1);
    expect(largeImport).toMatchObject({ receiptCount: 1, rowCount: 10001 });
    await worker();
    const largeTask = await positionRead<Schema['IngestionJobDto']>(page.request, `${root}/jobs/${largeImport.jobIds[0]}`);
    expect(largeTask.status).toBe('PENDING');
    expect(largeTask.pending + largeTask.succeeded).toBeGreaterThan(0);
    expect(reauthRequests).toHaveLength(0);
    expect((await prisma.session.findUniqueOrThrow({ where: { id: activeSession.id } })).reauthenticatedAt!.getTime()).toBeLessThan(Date.now() - 540_000);
    await prisma.session.update({ where: { id: activeSession.id }, data: { reauthenticatedAt: oldReauthenticatedAt } });
    const cancelled = await positionWrite<Schema['IngestionJobDto']>(page.request, `${root}/jobs/${largeImport.jobIds[0]}/control`, 'POST', { action: 'CANCEL', reason: '浏览器验收核对大数组分段推进后主动取消余量' }, 201);
    expect(cancelled.status).toBe('CANCELLED');
  } finally {
    await prisma.session.update({ where: { id: activeSession.id }, data: { reauthenticatedAt: oldReauthenticatedAt } });
  }
});

test('nested ingestion pause keeps real reauthentication reachable and resumes after cancellation and verification', async ({ page }) => {
  await login(page);
  const organization = await prisma.organization.findUniqueOrThrow({ where: { code: 'LOCAL-INTERNAL' } });
  const user = await prisma.user.findUniqueOrThrow({ where: { organizationId_username: { organizationId: organization.id, username: 'local.internal' } } });
  const reauthSuffix = randomUUID().replaceAll('-', '').slice(0, 12);
  let endpoint = await positionWrite<Schema['IntegrationEndpointDto']>(page.request, '/api/v1/admin/integrations/endpoints', 'POST', {
    code: `REAUTH_${reauthSuffix}`, name: `嵌套认证${reauthSuffix}`, sourceCode: `REAUTH_${reauthSuffix}`, sourceName: '嵌套认证一次性验收', returnReceipt: true,
  }, 201);
  const credential = await positionWrite<Schema['IntegrationCredentialDto']>(page.request, `/api/v1/admin/integrations/endpoints/${endpoint.id}/credentials`, 'POST', { name: '嵌套认证凭据', validityDays: null }, 201);
  endpoint = await positionWrite<Schema['IntegrationEndpointDto']>(page.request, `/api/v1/admin/integrations/endpoints/${endpoint.id}`, 'PATCH', { expectedVersion: endpoint.version, status: 'ENABLED' });
  const rule = await positionWrite<Schema['IngestionRuleDto']>(page.request, `${root}/rules`, 'POST', {
    name: `嵌套认证规则${reauthSuffix}`, endpointId: endpoint.id, target: 'CUSTOMER', enabled: false, match: 'ALL', conditions: [], mapping: { code: 'code', name: 'name' }, mode: 'INSERT_ONLY', updateFields: [],
  } satisfies Schema['SaveIngestionRuleDto'], 201);
  const inbound = await fetch(new URL(`/api/v1/integrations/inbound/${endpoint.code}/messages`, baseURL), {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15_000), headers: { Authorization: `Bearer ${credential.secret!}`, 'Content-Type': 'application/json' },
    body: JSON.stringify([{ code: `AUTH_${reauthSuffix}`, name: '嵌套认证客户' }]),
  });
  expect(inbound.status).toBe(200); expect(await inbound.json()).toBe(true);
  const receipt = await prisma.integrationReceipt.findFirstOrThrow({ where: { endpointId: endpoint.id }, orderBy: { receivedAt: 'desc' } });
  const preview = await positionWrite<Schema['IngestionPreviewDto']>(page.request, `${root}/preview`, 'POST', { ruleId: rule.id, ruleVersion: rule.version, receiptId: receipt.id, rowIndex: 0 }, 201);
  const imported = await positionWrite<Schema['IngestionImportResultDto']>(page.request, `${root}/imports`, 'POST', { previewId: preview.previewId, confirmed: true }, 201);
  expect(imported.jobIds).toHaveLength(1);
  const job = await positionRead<Schema['IngestionJobDto']>(page.request, `${root}/jobs/${imported.jobIds[0]}`);
  expect(job.status).toBe('PENDING');
  const activeSession = await prisma.session.findFirstOrThrow({ where: { userId: user.id, revokedAt: null, expiresAt: { gt: new Date() } }, orderBy: { createdAt: 'desc' } });
  const oldReauthenticatedAt = activeSession.reauthenticatedAt;
  const controlPath = `${root}/jobs/${job.id}/control`;
  const controlRequests: string[] = [];
  page.on('request', request => { if (new URL(request.url()).pathname === controlPath && request.method() === 'POST') controlRequests.push(request.url()); });
  try {
    await page.goto(`/console/api-ingestion?receiptId=${receipt.id}`);
    const detail = page.getByRole('dialog', { name: `${endpoint.name} · #${job.sequence}`, exact: true });
    const pause = page.getByRole('dialog', { name: '暂停', exact: true });
    const authentication = page.getByRole('dialog', { name: '重新验证身份', exact: true });
    await page.getByRole('button', { name: `查看任务${job.sequence}`, exact: true }).click();
    await detail.getByRole('button', { name: /^暂\s*停$/ }).click();
    await pause.getByLabel('操作原因', { exact: true }).fill('取消认证后重新操作');
    await prisma.session.update({ where: { id: activeSession.id }, data: { reauthenticatedAt: new Date(Date.now() - 600_000) } });
    const firstRefusal = page.waitForResponse(response => new URL(response.url()).pathname === controlPath && response.request().method() === 'POST');
    await pause.getByRole('button', { name: '确认操作', exact: true }).click();
    expect(await (await firstRefusal).json()).toMatchObject({ code: 'AUTH_REAUTHENTICATION_REQUIRED' });
    await expect(authentication).toBeVisible();
    await authentication.getByRole('button', { name: /^取\s*消$/ }).click();
    await expect(authentication).toHaveCount(0);
    await expect(pause.getByRole('button', { name: /^返\s*回$/ })).toBeEnabled();
    expect((await positionRead<Schema['IngestionJobDto']>(page.request, `${root}/jobs/${job.id}`)).status).toBe('PENDING');
    await pause.getByRole('button', { name: /^返\s*回$/ }).click();
    await page.getByRole('dialog', { name: '当前草稿尚未保存，继续将放弃修改。', exact: true }).getByRole('button', { name: '放弃修改并关闭', exact: true }).click();
    await expect(pause).toHaveCount(0);
    await detail.locator('.ant-modal-body').getByRole('button', { name: /^关\s*闭$/ }).click();
    await expect(detail).toHaveCount(0);
    await page.getByRole('button', { name: `查看任务${job.sequence}`, exact: true }).click();
    await detail.getByRole('button', { name: /^暂\s*停$/ }).click();
    await pause.getByLabel('操作原因', { exact: true }).fill('真实密码与MFA重认证后暂停');
    const secondRefusal = page.waitForResponse(response => new URL(response.url()).pathname === controlPath && response.request().method() === 'POST');
    await pause.getByRole('button', { name: '确认操作', exact: true }).click();
    expect(await (await secondRefusal).json()).toMatchObject({ code: 'AUTH_REAUTHENTICATION_REQUIRED' });
    await expect(authentication).toBeVisible();
    const passwordField = authentication.getByLabel('当前密码', { exact: true });
    await expect(passwordField).toBeVisible();
    await expect.poll(() => passwordField.evaluate(element => {
      const bounds = element.getBoundingClientRect();
      return document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2) === element;
    })).toBe(true);
    await passwordField.click();
    await expect(passwordField).toBeFocused();
    await fillSecret(passwordField, password!);
    await fillSecret(authentication.getByLabel('验证码或恢复码', { exact: true }), takeMfaRecoveryCode('local.internal'));
    const verified = page.waitForResponse(response => new URL(response.url()).pathname === '/api/v1/me/reauthenticate' && response.request().method() === 'POST');
    await authentication.getByRole('button', { name: /^验\s*证$/ }).click();
    expect((await verified).status()).toBe(200);
    await expect(authentication).toHaveCount(0);
    await expect(pause.getByRole('button', { name: '确认操作', exact: true })).toBeEnabled();
    expect(controlRequests).toHaveLength(2);
    expect((await positionRead<Schema['IngestionJobDto']>(page.request, `${root}/jobs/${job.id}`)).status).toBe('PENDING');
    const paused = page.waitForResponse(response => new URL(response.url()).pathname === controlPath && response.request().method() === 'POST');
    await pause.getByRole('button', { name: '确认操作', exact: true }).click();
    const pausedResponse = await paused;
    expect(pausedResponse.status()).toBe(201);
    expect(await pausedResponse.json()).toMatchObject({ id: job.id, status: 'PAUSED' });
    await expect(pause).toHaveCount(0);
    await expect(detail.getByText('已暂停', { exact: true })).toBeVisible();
    expect(controlRequests).toHaveLength(3);
    expect((await positionRead<Schema['IngestionJobDto']>(page.request, `${root}/jobs/${job.id}`)).status).toBe('PAUSED');
  } finally {
    await prisma.session.update({ where: { id: activeSession.id }, data: { reauthenticatedAt: oldReauthenticatedAt } });
  }
});

test('administrator bulk deletes four master data lists with partial reference protection and reachable narrow-screen controls', async ({ page }) => {
  await login(page);
  const organization = await prisma.organization.findUniqueOrThrow({ where: { code: 'LOCAL-INTERNAL' } });
  const bulkSuffix = randomUUID().replaceAll('-', '').slice(0, 12);
  const suppliers: { id: string; code: string }[] = [], customers: { id: string; code: string }[] = [], materials: { id: string; code: string }[] = [];
  const mappingPath = '/api/v1/admin/configuration/component-project-mappings';
  for (const ordinal of [1, 2]) {
    const supplier = await positionWrite<Schema['SupplierProfileDto']>(page.request, '/api/v1/supplier-quality/profiles', 'POST', { businessCode: `SUP_${bulkSuffix}_${ordinal}`, displayName: `批量删除供应商${ordinal}` }, 201);
    suppliers.push({ id: supplier.id, code: supplier.businessCode });
    const customer = await positionWrite<Schema['CustomerMasterDto']>(page.request, '/api/v1/customer-quality/customers', 'POST', { code: `CUS_${bulkSuffix}_${ordinal}`, name: `批量删除客户${ordinal}` }, 201);
    customers.push({ id: customer.id, code: customer.code });
    const material = await positionWrite<Schema['MaterialMasterDto']>(page.request, '/api/v1/material-masters', 'POST', { materialCode: `MAT_${bulkSuffix}_${ordinal}`, materialName: `批量删除物料${ordinal}` }, 201);
    materials.push({ id: material.id, code: material.materialCode });
  }
  const imported = await positionWrite<Schema['ComponentProjectImportResultDto']>(page.request, `${mappingPath}/import`, 'POST', {
    rows: [1, 2].map(rowNumber => ({ rowNumber, componentCode: `CMP_${bulkSuffix}_${rowNumber}`, componentName: `批量删除组件${rowNumber}` })),
  }, 201);
  expect(imported).toMatchObject({ created: 2, skipped: 0, failed: 0 });
  const mappingPage = await positionRead<Schema['ComponentProjectMappingsPageDto']>(page.request, `${mappingPath}?search=${bulkSuffix}`);
  expect(mappingPage.items).toHaveLength(2);
  const mappings = mappingPage.items.map(row => ({ id: row.id, code: row.componentCode }));
  const relation = await positionWrite<Schema['CustomerRelationDto']>(page.request, `/api/v1/customer-quality/customers/${customers[0]!.id}/relations`, 'POST', {
    relationType: 'PRODUCT', relatedCode: `PRODUCT_${bulkSuffix}`, relatedName: '必须保留的客户产品关系',
  }, 201);
  const domains = [
    { link: '供应商档案', noun: '供应商档案', path: '/api/v1/supplier-quality/profiles/bulk-delete', records: suppliers, referenced: undefined,
      remaining: () => prisma.supplierBusinessProfile.findMany({ where: { ownerOrganizationId: organization.id, id: { in: suppliers.map(row => row.id) } }, select: { id: true } }) },
    { link: '客户档案', noun: '客户档案', path: '/api/v1/customer-quality/customers/bulk-delete', records: customers, referenced: customers[0]!.id,
      remaining: () => prisma.customerQualityCustomer.findMany({ where: { organizationId: organization.id, id: { in: customers.map(row => row.id) } }, select: { id: true } }) },
    { link: '物料主数据', noun: '物料', path: '/api/v1/material-masters/bulk-delete', records: materials, referenced: undefined,
      remaining: () => prisma.materialMaster.findMany({ where: { organizationId: organization.id, id: { in: materials.map(row => row.id) } }, select: { id: true } }) },
    { link: '组件项目映射', noun: '组件项目映射', path: `${mappingPath}/bulk-delete`, records: mappings, referenced: undefined,
      remaining: () => prisma.$queryRaw<{ id: string }[]>`SELECT id FROM component_project_mappings WHERE organization_id=${organization.id}::uuid AND id IN (${mappings[0]!.id}::uuid,${mappings[1]!.id}::uuid)` },
  ];
  for (const domain of domains) {
    await page.getByRole('link', { name: domain.link, exact: true }).click();
    const row = (code: string) => page.getByRole('row').filter({ has: page.getByText(code, { exact: true }) });
    const toolbar = page.getByRole('toolbar', { name: `已选${domain.noun}`, exact: true });
    await expect(toolbar).toHaveCount(0);
    for (const record of domain.records) await row(record.code).getByRole('checkbox').check();
    await expect(toolbar).toContainText('已选择 2 条');
    const confirmation = page.getByRole('dialog', { name: `删除${domain.noun}`, exact: true });
    if (domain.link === '供应商档案') {
      await toolbar.getByRole('button', { name: '删除所选', exact: true }).click();
      await confirmation.getByRole('button', { name: '取消', exact: true }).click();
      await expect(confirmation).toHaveCount(0);
      expect(await domain.remaining()).toHaveLength(2);
      await page.locator('.ant-pagination-options .ant-select').click();
      await page.locator('.ant-select-dropdown:visible .ant-select-item-option').filter({ hasText: /^50 条\/页$/ }).click();
      await expect(toolbar).toHaveCount(0);
      for (const record of domain.records) {
        await expect(row(record.code).getByRole('checkbox')).not.toBeChecked();
        await row(record.code).getByRole('checkbox').check();
      }
      await page.setViewportSize({ width: 390, height: 844 });
      await expect(toolbar).toBeVisible();
      const geometry = await toolbar.evaluate(element => {
        const bounds = element.getBoundingClientRect();
        const feedback = document.querySelector('.qms-feedback-button')!.getBoundingClientRect();
        const style = getComputedStyle(element);
        const probe = document.createElement('span'); probe.style.backgroundColor = 'var(--qms-surface)'; element.append(probe);
        const themed = style.getPropertyValue('--qms-surface').trim().length > 0 && style.backgroundColor === getComputedStyle(probe).backgroundColor;
        probe.remove();
        return { fixed: style.position === 'fixed', inViewport: bounds.left >= 0 && bounds.right <= innerWidth && bounds.top >= 0 && bounds.bottom <= innerHeight,
          overlapsFeedback: bounds.left < feedback.right && bounds.right > feedback.left && bounds.top < feedback.bottom && bounds.bottom > feedback.top, themed };
      });
      expect(geometry).toEqual({ fixed: true, inViewport: true, overlapsFeedback: false, themed: true });
      await page.setViewportSize({ width: 1440, height: 900 });
    }
    await toolbar.getByRole('button', { name: '删除所选', exact: true }).click();
    await expect(confirmation).toContainText(`确认删除选中的 2 条${domain.noun}`);
    const deleted = page.waitForResponse(response => new URL(response.url()).pathname === domain.path && response.request().method() === 'POST');
    await confirmation.getByRole('button', { name: '删除', exact: true }).click();
    const deletedResponse = await deleted;
    expect(deletedResponse.status()).toBe(201);
    const result = await deletedResponse.json() as Schema['MasterDataBulkDeleteResultDto'];
    expect(result).toMatchObject({ deleted: domain.referenced ? 1 : 2, referenced: domain.referenced ? 1 : 0, conflicted: 0, notFound: 0 });
    expect(result.items).toHaveLength(2);
    for (const record of domain.records) expect(result.items).toContainEqual({ id: record.id, status: record.id === domain.referenced ? 'REFERENCED' : 'DELETED' });
    const results = page.getByRole('status').filter({ hasText: '删除结果' });
    for (const record of domain.records) await expect(results.getByRole('listitem').filter({ hasText: record.code })).toContainText(record.id === domain.referenced ? '仍有业务引用，不能删除' : '已删除');
    await expect(confirmation).toHaveCount(0);
    expect(await domain.remaining()).toEqual(domain.referenced ? [{ id: domain.referenced }] : []);
    if (domain.referenced) {
      await expect(toolbar).toContainText('已选择 1 条');
      await expect(row(customers[0]!.code).getByRole('checkbox')).toBeChecked();
      expect(await prisma.customerQualityCustomerRelation.findUniqueOrThrow({ where: { id: relation.id } })).toMatchObject({ customerId: domain.referenced, relationType: 'PRODUCT', relatedCode: `PRODUCT_${bulkSuffix}` });
      await page.getByRole('link', { name: 'API入库衔接', exact: true }).click();
      await expect(page.getByRole('toolbar', { name: '已选客户档案', exact: true })).toHaveCount(0);
      await page.getByRole('link', { name: domain.link, exact: true }).click();
      await expect(row(customers[0]!.code).getByRole('checkbox')).not.toBeChecked();
    }
    await expect(toolbar).toHaveCount(0);
  }
});
