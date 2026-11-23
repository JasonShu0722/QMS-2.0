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
const databaseUrl = process.env.DATABASE_URL;
const password = process.env.QMS_SEED_INTERNAL_PASSWORD;
const baseUrl = process.env.QMS_ACCEPTANCE_BASE_URL;
if (!databaseUrl || !password || !baseUrl || !process.env.QMS_ACCEPTANCE_MFA_CACHE_FILE || !process.env.QMS_BACKUP_KEY
  || process.env.QMS_DISPOSABLE_TEST_DB !== 'true' || process.env.QMS_ACCEPTANCE_DISPOSABLE_DATABASE !== 'true') {
  throw new Error('Ledger and user acceptance requires disposable PostgreSQL, real API and encrypted local MFA settings.');
}
for (const value of [databaseUrl, baseUrl]) {
  const url = new URL(value);
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.port === '55440' || url.search || url.hash) throw new Error('Only disposable loopback resources are allowed.');
}
const requireApi = createRequire(new URL('../../api/package.json', import.meta.url));
const { PrismaPg } = requireApi('@prisma/adapter-pg');
const { PrismaClient } = await import('../../api/dist/generated/prisma/client.js');
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
const suffix = randomUUID().replaceAll('-', '').slice(0, 10).toUpperCase();
let organizationId: string;
let roleId: string;
let addedPermissionId: string | undefined;
const runtimeErrors = new WeakMap<Page, string[]>();
test.setTimeout(120_000);
test.use({ trace: 'off', screenshot: 'off', video: 'off', actionTimeout: 15_000, navigationTimeout: 20_000 });
test.beforeEach(({ page }) => {
  const errors: string[] = [];
  runtimeErrors.set(page, errors);
  page.on('pageerror', error => errors.push(error.message));
});
test.afterEach(({ page }) => { expect(runtimeErrors.get(page)).toEqual([]); });
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

test('administrator manages one user through grouped tabs with no eager secret reads and bounded row height', async ({ page }) => {
  await login(page);
  await page.goto(`/console/users?organizationId=${organizationId}`);
  const row = page.getByRole('cell', { name: 'local.internal', exact: true }).locator('..');
  await expect(row.getByRole('button', { name: '管理用户', exact: true })).toBeVisible();
  await expect(row.getByRole('button')).toHaveCount(1);
  expect((await row.boundingBox())!.height).toBeLessThanOrEqual(90);
  const secretReads: string[] = [];
  page.on('request', request => { if (/temporary-password|password-reset|mfa-policy/.test(new URL(request.url()).pathname)) secretReads.push(new URL(request.url()).pathname); });
  await row.getByRole('button', { name: '管理用户', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '管理用户', exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('local.internal');
  for (const tab of ['基本资料', '任职与授权', '账号安全', '状态与删除']) {
    await dialog.getByRole('tab', { name: tab, exact: true }).click();
    await expect(dialog.getByRole('tab', { name: tab, exact: true })).toHaveAttribute('aria-selected', 'true');
  }
  expect(secretReads).toEqual([]);
  await dialog.getByRole('tab', { name: '基本资料', exact: true }).click();
  const name = dialog.getByLabel('姓名', { exact: true });
  const original = await name.inputValue();
  await name.fill(`未保存${suffix}`);
  await dialog.getByRole('tab', { name: '账号安全', exact: true }).click();
  const guard = page.getByRole('dialog').filter({ hasText: '未保存' }).last();
  await expect(guard).toBeVisible();
  await guard.getByRole('button', { name: /继续编辑/ }).click();
  await expect(name).toHaveValue(`未保存${suffix}`);
  await name.fill(original);
  await dialog.getByRole('tab', { name: '账号安全', exact: true }).click();
  await guard.getByRole('button', { name: '放弃修改', exact: true }).click();
  await expect(dialog.getByRole('tab', { name: '账号安全', exact: true })).toHaveAttribute('aria-selected', 'true');
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await expect.poll(() => dialog.locator('.ant-modal-body').evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
    if (process.env.QMS_ACCEPTANCE_ARTIFACT_DIRECTORY) await page.screenshot({ path: `${process.env.QMS_ACCEPTANCE_ARTIFACT_DIRECTORY}/user-management-${width}.png` });
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  const user = await prisma.user.findUniqueOrThrow({ where: { organizationId_username: { organizationId, username: 'local.internal' } } });
  await prisma.session.updateMany({ where: { userId: user.id, revokedAt: null }, data: { reauthenticatedAt: new Date(Date.now() - 600_000) } });
  await dialog.getByRole('button', { name: '签发重置凭证', exact: true }).click();
  const reset = page.getByRole('dialog', { name: '一次性重置凭证', exact: true });
  await reset.getByRole('button', { name: '确认签发', exact: true }).click();
  const reauthentication = page.getByRole('dialog', { name: '重新验证身份', exact: true });
  const passwordInput = reauthentication.getByLabel('当前密码', { exact: true });
  await expect(passwordInput).toBeVisible();
  await passwordInput.focus();
  await expect(passwordInput).toBeFocused();
  expect(await passwordInput.evaluate(element => {
    const bounds = element.getBoundingClientRect();
    return document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2) === element;
  })).toBe(true);
  await reauthentication.getByRole('button', { name: /^取\s*消$/ }).click();
  await expect(reauthentication).toHaveCount(0);
  await expect(reset).toBeVisible();
  await expect(dialog).toBeVisible();
  await expect.poll(() => reset.evaluate(element => element.contains(document.activeElement))).toBe(true);
});

test('administrator reads dedicated permissions and deletes a disposable ledger record through the protected API', async ({ page }) => {
  await login(page);
  const granted = await positionRead<Schema['PermissionsResponseDto']>(page.request, '/api/v1/system/my-permissions');
  for (const code of ['ai:connections:read', 'ai:credentials:manage', 'ai:applications:publish', 'process-quality:configuration:read', 'process-quality:defects:delete']) expect(granted.permissions).toContain(code);
  const catalog = await positionRead<Schema['PermissionCatalogGroupDto'][]>(page.request, '/api/v1/admin/permission-catalog');
  const ai = catalog.find(group => group.key === 'ai');
  expect(ai?.modules.flatMap(module => module.operations.map(operation => operation.code))).toEqual(expect.arrayContaining(['ai:connections:manage', 'ai:applications:publish']));
  const record = await positionWrite<Schema['ProcessDefectDto']>(page.request, '/api/v1/process-quality/defects', 'POST', {
    occurredAt: '2026-11-17T08:30:00+08:00', productCode: `PRODUCT_${suffix}`, traceCode: `TRACE_${suffix}`, description: `待删验收${suffix}`, factoryCode: 'FACTORY_1',
  }, 201);
  const selection = { sources: [{ defectId: record.id, expectedVersion: record.version }] };
  const preview = await positionWrite<Schema['ProcessDefectDeletionPreviewDto']>(page.request, '/api/v1/process-quality/defects/deletion-preview', 'POST', selection, 201);
  expect(preview).toMatchObject({ count: 1, canDelete: true, items: [{ defectId: record.id, blocked: false }] });
  const result = await positionWrite<Schema['ProcessDefectDeletionResultDto']>(page.request, '/api/v1/process-quality/defects/deletion', 'POST', { ...selection, reason: '一次性验收误录清理' }, 201);
  expect(result).toMatchObject({ count: 1, deletedIds: [record.id] });
  const rows = await positionRead<Schema['ProcessDefectPageDto']>(page.request, `/api/v1/process-quality/defects?page=1&pageSize=20&search=${suffix}`);
  expect(rows.items.some(item => item.id === record.id)).toBe(false);
  const worker = await promisify(execFile)(process.execPath, ['dist/worker.js', '--once'], {
    cwd: fileURLToPath(new URL('../../api/', import.meta.url)), windowsHide: true, timeout: 45_000,
    env: { ...process.env, NODE_ENV: 'test', QMS_WORKER_BATCH_SIZE: '100', NODE_OPTIONS: '--max-old-space-size=512' },
  });
  expect(worker.stdout).toContain('QMS_WORKER_READY');
  const retained = await prisma.processDefect.findUniqueOrThrow({ where: { id: record.id } });
  expect(retained.archivedAt).not.toBeNull();
  expect(retained.version).toBe(record.version + 1);
});

test('ledger shares selection for deletion and restores the approved registration columns', async ({ page }) => {
  await login(page);
  const record = await positionWrite<Schema['ProcessDefectDto']>(page.request, '/api/v1/process-quality/defects', 'POST', {
    occurredAt: '2026-11-17T20:30:00+08:00', productCode: `UI_PRODUCT_${suffix}`, traceCode: `UI_TRACE_${suffix}`, description: `界面删除${suffix}`, factoryCode: 'FACTORY_2',
  }, 201);
  await page.goto('/app/process-quality');
  await expect(page.getByRole('button', { name: '登记不良', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '列设置', exact: true }).click();
  await page.getByRole('button', { name: '恢复录单默认列', exact: true }).click();
  await page.keyboard.press('Escape');
  for (const title of ['班次', '项目号', '细分类型', '项目状态', '生产线名称', '工序名称', '板块', '追溯码', '不良数量']) {
    await expect(page.getByRole('columnheader', { name: title, exact: true })).toBeVisible();
  }
  const search = page.getByLabel('搜索制程不良', { exact: true });
  await search.fill(`UI_TRACE_${suffix}`);
  await search.press('Enter');
  const row = page.getByRole('row').filter({ hasText: `界面删除${suffix}` });
  await expect(row).toBeVisible();
  await page.getByRole('checkbox', { name: '选择当前页制程不良', exact: true }).check();
  await page.getByRole('button', { name: '删除所选', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '删除制程不良台账', exact: true });
  await expect(dialog).toContainText('1 条');
  await expect(dialog.getByRole('textbox')).toHaveCount(0);
  const response = page.waitForResponse(value => new URL(value.url()).pathname === '/api/v1/process-quality/defects/deletion' && value.request().method() === 'POST');
  await dialog.getByRole('button', { name: '确认删除', exact: true }).click();
  expect((await response).status()).toBe(201);
  await expect(dialog).toHaveCount(0);
  await expect(row).toHaveCount(0);
  expect((await positionRead<Schema['ProcessDefectPageDto']>(page.request, `/api/v1/process-quality/defects?page=1&pageSize=20&search=UI_TRACE_${suffix}`)).items.some(item => item.id === record.id)).toBe(false);
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.getByRole('button', { name: '筛选条件', exact: true })).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
    if (process.env.QMS_ACCEPTANCE_ARTIFACT_DIRECTORY) await page.screenshot({ path: `${process.env.QMS_ACCEPTANCE_ARTIFACT_DIRECTORY}/process-ledger-${width}.png` });
  }
});
