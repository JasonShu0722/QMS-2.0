import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import type { components } from '@qms/contracts';
import { completeMfa } from './mfa-login';
import { positionWrite } from './position-fixture';
import { fillSecret } from './secret-input';

type Schema = components['schemas'];
const databaseUrl = process.env.DATABASE_URL;
const password = process.env.QMS_SEED_INTERNAL_PASSWORD;
const baseUrl = process.env.QMS_ACCEPTANCE_BASE_URL;
if (!databaseUrl || !password || !baseUrl || !process.env.QMS_ACCEPTANCE_MFA_CACHE_FILE || !process.env.QMS_BACKUP_KEY
  || process.env.QMS_DISPOSABLE_TEST_DB !== 'true' || process.env.QMS_ACCEPTANCE_DISPOSABLE_DATABASE !== 'true') throw new Error('Material snapshot acceptance requires disposable PostgreSQL, real API and encrypted MFA settings.');
for (const value of [databaseUrl, baseUrl]) {
  const location = new URL(value);
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(location.hostname) || location.port === '55440' || location.search || location.hash) throw new Error('Only disposable loopback resources are allowed.');
}
const requireApi = createRequire(new URL('../../api/package.json', import.meta.url));
const { PrismaPg } = requireApi('@prisma/adapter-pg');
const { PrismaClient } = await import('../../api/dist/generated/prisma/client.js');
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
const suffix = randomUUID().replaceAll('-', '').slice(0, 10).toUpperCase();
const root = '/api/v1/admin/integrations/ingestion';
let organizationId: string;
let roleId: string;
let addedPermissionId: string | undefined;
test.setTimeout(120_000);
test.use({ trace: 'off', screenshot: 'off', video: 'off', actionTimeout: 15_000, navigationTimeout: 20_000 });
test.beforeAll(async () => {
  organizationId = (await prisma.organization.findUniqueOrThrow({ where: { code: 'LOCAL-INTERNAL' } })).id;
  const user = await prisma.user.findUniqueOrThrow({ where: { organizationId_username: { organizationId, username: 'local.internal' } } });
  roleId = (await prisma.userRole.findFirstOrThrow({ where: { organizationId, userId: user.id, role: { code: 'LOCAL_MEMBER' } } })).roleId;
  const permission = await prisma.permission.findUniqueOrThrow({ where: { code: 'platform:admin' } });
  const where = { roleId_permissionId: { roleId, permissionId: permission.id } };
  if (!await prisma.rolePermission.findUnique({ where })) { await prisma.rolePermission.create({ data: where.roleId_permissionId }); addedPermissionId = permission.id; }
});
test.afterAll(async () => {
  try { if (addedPermissionId) await prisma.rolePermission.deleteMany({ where: { roleId, permissionId: addedPermissionId } }); }
  finally { await prisma.$disconnect(); }
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
    env: { ...process.env, QMS_WORKER_BATCH_SIZE: '100', NODE_OPTIONS: '--max-old-space-size=512' },
  });
  expect(result.stdout).toContain('QMS_WORKER_READY');
}
test('administrator binds material names in the rule and compiled Worker preserves snapshots and unmatched names', async ({ page }) => {
  await login(page);
  const code = `00042_${suffix}`;
  const missingCode = `00043_${suffix}`;
  let material = await positionWrite<Schema['MaterialMasterDto']>(page.request, '/api/v1/material-masters', 'POST', { materialCode: code, materialName: '控制器原名称' }, 201);
  let endpoint = await positionWrite<Schema['IntegrationEndpointDto']>(page.request, '/api/v1/admin/integrations/endpoints', 'POST', { code: `SNAP_${suffix}`, name: `快照验收${suffix}`, sourceCode: `SRC_${suffix}`, sourceName: '一次性快照验收', returnReceipt: true }, 201);
  const credential = await positionWrite<Schema['IntegrationCredentialDto']>(page.request, `/api/v1/admin/integrations/endpoints/${endpoint.id}/credentials`, 'POST', { name: '一次性凭据', validityDays: null }, 201);
  endpoint = await positionWrite<Schema['IntegrationEndpointDto']>(page.request, `/api/v1/admin/integrations/endpoints/${endpoint.id}`, 'PATCH', { expectedVersion: endpoint.version, status: 'ENABLED' });
  await page.goto('/console/api-ingestion');
  await page.getByRole('button', { name: '新增规则', exact: true }).click();
  const editor = page.getByRole('dialog', { name: '新增入库规则', exact: true });
  await editor.getByLabel('规则名称', { exact: true }).fill(`物料快照${suffix}`);
  await editor.getByLabel('接收接口', { exact: true }).click();
  await page.locator('.ant-select-dropdown:visible .ant-select-item-option').filter({ hasText: endpoint.name }).click();
  await editor.getByLabel('目标档案', { exact: true }).click();
  await page.locator('.ant-select-dropdown:visible .ant-select-item-option').filter({ hasText: '组件项目映射' }).click();
  await editor.getByLabel('编码来源字段', { exact: true }).fill('partCode');
  await editor.getByLabel('名称来源方式', { exact: true }).click();
  await page.locator('.ant-select-dropdown:visible .ant-select-item-option').filter({ hasText: '内部物料主数据' }).click();
  await expect(editor.getByLabel('名称来源字段', { exact: true })).toHaveCount(0);
  await expect(editor.getByText('物料名称', { exact: true }).last()).toBeVisible();
  await editor.getByRole('switch', { name: '启用自动入库', exact: true }).check();
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await expect.poll(() => editor.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    if (process.env.QMS_ACCEPTANCE_ARTIFACT_DIRECTORY) await page.screenshot({ path: `${process.env.QMS_ACCEPTANCE_ARTIFACT_DIRECTORY}/material-rule-${width}.png` });
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  const saving = page.waitForResponse(response => new URL(response.url()).pathname === `${root}/rules` && response.request().method() === 'POST');
  await editor.getByRole('button', { name: /^保\s*存$/ }).click();
  const response = await saving;
  expect(response.status()).toBe(201);
  const rule = await response.json() as Schema['IngestionRuleDto'];
  expect(rule).toMatchObject({ mapping: { code: 'partCode' }, componentNameLookup: { source: 'MATERIAL', field: 'materialName' } });
  expect(rule.mapping).not.toHaveProperty('name');
  await expect(editor).toHaveCount(0);
  async function send(partCode: string) {
    const received = await fetch(new URL(`/api/v1/integrations/inbound/${endpoint.code}/messages`, baseUrl), { method: 'POST', headers: { Authorization: `Bearer ${credential.secret!}`, 'Content-Type': 'application/json' }, body: JSON.stringify([{ partCode }]), signal: AbortSignal.timeout(15_000), redirect: 'error' });
    expect(received.status).toBe(200);
    expect(await received.json()).toBe(true);
    await worker();
  }
  await send(code);
  const [snapshot] = await prisma.$queryRaw<{ id: string; component_name: string | null }[]>`SELECT id, component_name FROM component_project_mappings WHERE organization_id=${organizationId}::uuid AND component_code=${code}`;
  expect(snapshot).toBeDefined();
  expect(snapshot!.component_name).toBe('控制器原名称');
  material = await positionWrite<Schema['MaterialMasterDto']>(page.request, `/api/v1/material-masters/${material.id}`, 'PATCH', { materialName: '物料后来改名', expectedVersion: material.version });
  expect(material.version).toBeGreaterThan(1);
  await worker();
  expect((await prisma.$queryRaw<{ component_name: string | null }[]>`SELECT component_name FROM component_project_mappings WHERE id=${snapshot!.id}::uuid`)[0]!.component_name).toBe('控制器原名称');
  await send(missingCode);
  const [unmatched] = await prisma.$queryRaw<{ id: string; component_name: string | null }[]>`SELECT id, component_name FROM component_project_mappings WHERE organization_id=${organizationId}::uuid AND component_code=${missingCode}`;
  expect(unmatched!.component_name).toBeNull();
  await prisma.$executeRaw`UPDATE component_project_mappings SET component_name='已有人工作为名称', version=version+1 WHERE id=${unmatched!.id}::uuid`;
  const updatedRule = await positionWrite<Schema['IngestionRuleDto']>(page.request, `${root}/rules/${rule.id}`, 'PATCH', {
    organizationId, name: rule.name, endpointId: rule.endpointId, target: rule.target, enabled: false, match: rule.match,
    conditions: rule.conditions, mapping: rule.mapping, componentNameLookup: rule.componentNameLookup,
    mode: 'UPDATE', updateFields: ['name'], expectedVersion: rule.version,
  });
  expect(updatedRule.mode).toBe('UPDATE');
  await send(missingCode);
  expect((await prisma.$queryRaw<{ component_name: string | null }[]>`SELECT component_name FROM component_project_mappings WHERE id=${unmatched!.id}::uuid`)[0]!.component_name).toBe('已有人工作为名称');
  await positionWrite(page.request, `${root}/rules/${rule.id}`, 'PATCH', {
    organizationId, name: updatedRule.name, endpointId: updatedRule.endpointId, target: updatedRule.target, enabled: false,
    match: updatedRule.match, conditions: updatedRule.conditions, mapping: updatedRule.mapping,
    componentNameLookup: updatedRule.componentNameLookup, mode: updatedRule.mode, updateFields: updatedRule.updateFields,
    expectedVersion: updatedRule.version,
  });
});
