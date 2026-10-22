import { randomUUID } from 'node:crypto';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import ExcelJS from 'exceljs';
import { test as base, expect, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import type { components } from '@qms/contracts';
import { completeMfa } from './mfa-login';
import { fillSecret } from './secret-input';

// Run only after the parent builds and starts the disposable gateway; never reuse stored browser state.
const baseURL = process.env.QMS_ACCEPTANCE_BASE_URL ?? process.env.PLAYWRIGHT_BASE_URL;
const password = process.env.QMS_SEED_INTERNAL_PASSWORD;
const databaseURL = process.env.DATABASE_URL;
const cacheFile = process.env.QMS_ACCEPTANCE_MFA_CACHE_FILE;
if (process.env.QMS_DISPOSABLE_TEST_DB !== 'true' || !baseURL || !databaseURL || !password || password.length < 16) {
  throw new Error('REQ24 requires disposable PostgreSQL, a live loopback gateway and a generated seed password; no skip.');
}
for (const [value, database] of [[databaseURL, true], [baseURL, false]] as const) {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error('Invalid acceptance endpoint; value redacted.'); }
  if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.port === '55440' || url.search || url.hash
    || !(database ? ['postgres:', 'postgresql:'] : ['http:', 'https:']).includes(url.protocol)
    || (database ? url.port !== '57624' || url.pathname === '/' : !!url.username || !!url.password || url.pathname !== '/')) {
    throw new Error('REQ24 requires its loopback 57624 PostgreSQL and a loopback gateway without URL overrides.');
  }
}
if (!cacheFile || !isAbsolute(cacheFile) || Buffer.from(process.env.QMS_BACKUP_KEY ?? '', 'base64').length !== 32) {
  throw new Error('REQ24 requires an external encrypted MFA cache and a base64 32-byte backup key.');
}
const cacheLocation = relative(resolve(process.cwd(), '../../..'), cacheFile);
if (cacheLocation !== '..' && !cacheLocation.startsWith(`..${sep}`) && !isAbsolute(cacheLocation)) {
  throw new Error('Acceptance MFA cache must remain outside the checkout.');
}

type Schema = components['schemas'];
const unique = (prefix: string) => `req24_${prefix}_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
async function read<T>(client: APIRequestContext, path: string): Promise<T> {
  const response = await client.get(path, { timeout: 10_000 });
  expect(response.status(), `GET ${path}`).toBe(200);
  return await response.json() as T;
}
async function write<T>(client: APIRequestContext, path: string, method: string, data: object, status = 200): Promise<T> {
  const csrf = await read<Schema['CsrfResponseDto']>(client, '/api/v1/auth/csrf');
  const response = await client.fetch(path, { method, timeout: 10_000, data, headers: { 'x-csrf-token': csrf.csrfToken, 'Idempotency-Key': randomUUID() } });
  expect(response.status(), `${method} ${path}`).toBe(status);
  return await response.json() as T;
}
function pending(page: Page, path: string, method: string) {
  return page.waitForResponse(response => new URL(response.url()).pathname === path && response.request().method() === method, { timeout: 10_000 });
}
async function selectPosition(page: Page, scope: Locator, position: Schema['PositionDto']) {
  const select = scope.getByRole('combobox', { name: '任职岗位', exact: true });
  await expect(select).toBeEnabled();
  await select.fill(position.code);
  await page.locator('.ant-select-dropdown:visible .ant-select-item-option').filter({ hasText: `${position.name} · ${position.code}` }).click();
  await select.press('Escape');
}
async function preview(page: Page, scope: Locator, organizationId: string) {
  const response = pending(page, `/api/v1/organizations/${organizationId}/position-authorization/preview`, 'POST');
  await scope.getByRole('button', { name: '预览授权', exact: true }).click();
  const result = await response;
  expect(result.status()).toBe(200);
  await expect(scope.getByRole('region', { name: '权限预览', exact: true })).toBeVisible();
  return await result.json() as Schema['PositionAuthorizationPreviewDto'];
}
async function prepare(client: APIRequestContext, organizationId: string) {
  const path = `/api/v1/organizations/${organizationId}`;
  const department = await write<Schema['DepartmentDto']>(client, `${path}/departments`, 'POST', { code: unique('dep'), name: unique('Department') }, 201);
  const position = await write<Schema['PositionDto']>(client, `${path}/positions`, 'POST', { code: unique('pos'), name: unique('Position'), departmentId: department.id }, 201);
  return { department, position, path };
}

const test = base.extend<{ admin: Schema['AdminOrganizationDto'] }>({
  admin: async ({ page }, use) => {
    await page.goto('/login');
    await page.getByLabel('账号', { exact: true }).fill('local.internal');
    await fillSecret(page.getByLabel('密码', { exact: true }), password!);
    const response = pending(page, '/api/v1/auth/login', 'POST');
    await page.getByRole('button', { name: '登录', exact: true }).click();
    const authentication = await response;
    expect(authentication.status()).toBe(200);
    expect(['MFA_ENROLLMENT_REQUIRED', 'MFA_REQUIRED']).toContain((await authentication.json() as Schema['LoginResponseDto']).securityState);
    await completeMfa(page.request, authentication, 'local.internal', page);
    await expect(page).toHaveURL(/\/app\/workbench$/);
    const me = await read<Schema['AccountProfileDto']>(page.request, '/api/v1/me');
    const organizations = await read<Schema['AdminOrganizationDto'][]>(page.request, '/api/v1/admin/organizations');
    const admin = organizations.find(item => item.id === me.organization.id && item.code === 'LOCAL-INTERNAL' && item.type === 'INTERNAL');
    const required = ['organization:structure:read', 'organization:structure:manage', 'organization:positions:assign', 'account:users:read', 'account:users:create', 'account:roles:read', 'account:roles:update', 'account:roles:assign'];
    if (!admin || required.some(code => !admin.permissions.includes(code))) throw new Error('Prepare the isolated LOCAL_MEMBER browser fixture first.');
    await use(admin);
  },
});
test.setTimeout(120_000);
test.use({ trace: 'off', screenshot: 'off', video: 'off', actionTimeout: 10_000, navigationTimeout: 15_000, viewport: { width: 1440, height: 900 } });
test.beforeEach(async ({ baseURL: configuredURL, browserName }, info) => {
  if (configuredURL !== baseURL || browserName !== 'chromium' || info.config.workers !== 1 || process.env.PLAYWRIGHT_NO_COPY_PROMPT !== '1') {
    throw new Error('Use the existing Chromium config, this baseURL and exactly one worker.');
  }
});

test('REQ24: position permission UI, atomic user appointment, previewed removal and read-only history', async ({ page, admin }) => {
  const { department, position, path } = await prepare(page.request, admin.id);
  const permissionPath = `${path}/positions/${position.id}/permissions`;
  await page.goto('/app/admin');
  await page.getByRole('tab', { name: '部门岗位', exact: true }).click();
  await page.getByRole('tab', { name: '岗位', exact: true }).click();
  const positions = page.getByRole('tabpanel', { name: '岗位', exact: true });
  const row = positions.getByRole('row').filter({ has: page.getByText(position.name, { exact: true }) });
  await row.getByRole('button', { name: '岗位权限', exact: true }).click();
  const drawer = page.getByRole('dialog', { name: `${position.name} · 岗位权限`, exact: true });
  await drawer.getByRole('textbox', { name: '搜索权限', exact: true }).fill('notification:read');
  await drawer.getByRole('checkbox', { name: '我的通知 · 查看和标记通知', exact: true }).check();
  const saved = pending(page, permissionPath, 'PUT');
  await drawer.getByRole('button', { name: '保存', exact: true }).click();
  expect((await saved).status()).toBe(200);
  expect((await read<Schema['PositionPermissionsDto']>(page.request, permissionPath)).permissionCodes).toEqual(['notification:read']);
  await drawer.getByRole('textbox', { name: '搜索权限', exact: true }).focus();
  await page.keyboard.press('Escape');
  await expect(drawer).not.toBeVisible();

  await page.getByRole('tab', { name: '用户', exact: true }).click();
  await page.getByRole('button', { name: '创建用户', exact: true }).click();
  const create = page.getByRole('dialog', { name: '创建用户', exact: true });
  const username = unique('user');
  await create.getByLabel('用户名', { exact: true }).fill(username);
  await fillSecret(create.getByLabel('初始密码', { exact: true }), `${randomUUID()}Aa9!`);
  await selectPosition(page, create, position);
  expect((await preview(page, create, admin.id)).effectivePermissionCodes).toEqual(['notification:read']);
  await expect(create.getByRole('region', { name: '权限预览', exact: true }).getByText('notification:read', { exact: true })).toBeVisible();
  const creation = pending(page, '/api/v1/admin/users', 'POST');
  await create.getByRole('button', { name: '保存用户', exact: true }).click();
  const createdResponse = await creation;
  expect(createdResponse.status()).toBe(201);
  const user = await createdResponse.json() as Schema['AdminUserDto'];
  await expect(create).not.toBeVisible();
  const summary = await read<Schema['AdminUserDto']>(page.request, `/api/v1/admin/users/${user.id}`);
  expect(summary).toMatchObject({ username, totalPositions: 1, positions: [expect.objectContaining({ id: position.id, department: expect.objectContaining({ id: department.id }) })] });
  const rolesPath = `/api/v1/admin/users/${user.id}/roles`;
  const roles = await read<Schema['AdminUserRolesDto']>(page.request, rolesPath);
  expect(roles.roles).toEqual([]);
  expect(roles.permissions).toEqual(['notification:read']);
  expect(roles.effectiveRoles).toHaveLength(1);
  expect(roles.effectiveRoles[0]!.sources).toEqual([expect.objectContaining({ kind: 'POSITION', positionId: position.id })]);

  const search = page.getByLabel('搜索用户', { exact: true });
  await search.fill(username); await search.press('Enter');
  const userRow = page.getByRole('row').filter({ has: page.getByText(username, { exact: true }) });
  await userRow.getByRole('button', { name: /^调\s*岗$/ }).click();
  const adjustment = page.getByRole('dialog', { name: `${username} · 用户任职`, exact: true });
  const select = adjustment.getByRole('combobox', { name: '任职岗位', exact: true });
  await expect(select).toBeEnabled();
  await select.focus(); await select.press('Backspace'); await select.press('Tab');
  const removal = await preview(page, adjustment, admin.id);
  expect(removal.positions).toEqual([]);
  expect(removal.effectivePermissionCodes).toEqual([]);
  await expect(adjustment.getByText('将撤销的权限：notification:read', { exact: true })).toBeVisible();
  const replaced = pending(page, `${path}/users/${user.id}/positions`, 'PUT');
  await adjustment.getByRole('button', { name: '保存任职', exact: true }).click();
  expect((await replaced).status()).toBe(200);
  await expect(adjustment).not.toBeVisible();
  expect(await read<Schema['AdminUserRolesDto']>(page.request, rolesPath)).toMatchObject({ roles: [], effectiveRoles: [], permissions: [] });
  expect(await read<Schema['AdminUserDto']>(page.request, `/api/v1/admin/users/${user.id}`)).toMatchObject({ positions: [], totalPositions: 0 });

  await page.getByRole('tab', { name: '历史授权', exact: true }).click();
  const history = page.getByRole('tabpanel', { name: '历史授权', exact: true });
  await expect(history.getByText('新授权请在岗位中维护；历史记录仅供查看。', { exact: true })).toBeVisible();
  await expect(history.getByRole('button', { name: /创建角色|复制模板|编辑角色|删除角色|保存/ })).toHaveCount(0);
  await expect(page.getByRole('tab', { name: '权限矩阵', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '分配角色', exact: true })).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 900 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
});

test('REQ24: real four-column XLSX keeps SUCCESS/ERROR/SUCCESS and original row numbers', async ({ page, admin }) => {
  const { position, path } = await prepare(page.request, admin.id);
  const permissionPath = `${path}/positions/${position.id}/permissions`;
  const baseline = await read<Schema['PositionPermissionsDto']>(page.request, permissionPath);
  await write(page.request, permissionPath, 'PUT', { permissionCodes: ['notification:read'], expectedPermissionCodes: baseline.permissionCodes, mfaRequired: false, expectedMfaRequired: baseline.mfaRequired, expectedRoleVersion: baseline.roleVersion });
  const usernames = [unique('batch_first'), unique('batch_invalid'), unique('batch_last')];
  const invalidCode = unique('missing');
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('账号');
  sheet.addRows([['用户名', '邮箱', '账号类型', '岗位代码'], ...usernames.map((username, index) => [username, '', 'INTERNAL', index === 1 ? invalidCode : position.code])]);
  await page.goto('/app/admin');
  await page.getByRole('tab', { name: '用户', exact: true }).click();
  await page.getByRole('button', { name: '批量创建账号', exact: true }).click();
  const batch = page.getByRole('dialog', { name: '批量创建账号', exact: true });
  const prepared = pending(page, `${path}/position-authorization/preview`, 'POST');
  await batch.getByLabel('账号清单文件', { exact: true }).setInputFiles({ name: 'req24-accounts.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: Buffer.from(await workbook.xlsx.writeBuffer()) });
  expect((await prepared).status()).toBe(200);
  await expect(batch.getByRole('region', { name: '权限预览', exact: true })).toContainText('notification:read');
  await expect(batch.getByText(`本地预检：岗位代码不存在或不可用 · ${invalidCode}`, { exact: true })).toBeVisible();
  const submitted = pending(page, '/api/v1/admin/users/batch', 'POST');
  await batch.getByRole('button', { name: '创建账号', exact: true }).click();
  const response = await submitted;
  expect(response.status()).toBe(201);
  expect(response.headers()['cache-control']).toContain('no-store');
  const result = await response.json() as Schema['AdminUserBatchResultDto'];
  // Project only non-secret fields: failed assertions must not print temporary passwords.
  expect(result.rows.map(({ rowNumber, username, status }) => ({ rowNumber, username, status }))).toEqual(usernames.map((username, index) => ({ rowNumber: index + 2, username, status: index === 1 ? 'ERROR' : 'SUCCESS' })));
  for (const [index, entry] of result.rows.entries()) {
    const row = batch.getByRole('row').filter({ has: page.getByText(usernames[index]!, { exact: true }) });
    await expect(row.getByRole('cell', { name: String(index + 2), exact: true })).toBeVisible();
    await expect(row.getByRole('cell', { name: index === 1 ? /^失败/ : '成功' })).toBeVisible();
    if (entry.status === 'SUCCESS') {
      expect(entry.temporaryPassword?.status).toBe('AVAILABLE');
      expect(typeof entry.temporaryPassword?.temporaryPassword === 'string' && entry.temporaryPassword.temporaryPassword.length >= 12).toBe(true);
      const authorization = await read<Schema['AdminUserRolesDto']>(page.request, `/api/v1/admin/users/${entry.userId}/roles`);
      expect(authorization.roles).toEqual([]);
      expect(authorization.permissions).toEqual(['notification:read']);
      expect(await read<Schema['AdminUserDto']>(page.request, `/api/v1/admin/users/${entry.userId}`)).toMatchObject({ totalPositions: 1, positions: [expect.objectContaining({ id: position.id })] });
    } else {
      expect(Boolean(entry.userId)).toBe(false);
    }
  }
  const users = await read<Schema['AdminUserDto'][]>(page.request, '/api/v1/admin/users');
  expect(users.some(user => user.username === usernames[1])).toBe(false);
  await page.keyboard.press('Escape');
  await expect(batch).not.toBeVisible();
});
