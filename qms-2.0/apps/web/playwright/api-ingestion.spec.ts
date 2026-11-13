import { randomUUID } from 'node:crypto';
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
