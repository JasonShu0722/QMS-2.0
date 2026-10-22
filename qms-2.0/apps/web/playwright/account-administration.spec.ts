import { randomBytes, randomUUID } from 'node:crypto';
import { test as base, expect, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import type { components } from '@qms/contracts';
import { fillSecret } from './secret-input';
import { completeMfa } from './mfa-login';
import { changePositionPermissions, choosePosition, confirmPositionPreview, createPositionGrant, createPositionUser, positionRead, replacePositionAppointments, retirePositionGrant, type PositionGrant } from './position-fixture';

const baseURL = process.env.QMS_ACCEPTANCE_BASE_URL ?? process.env.PLAYWRIGHT_BASE_URL;
const internalPassword = process.env.QMS_SEED_INTERNAL_PASSWORD;
const supplierPassword = process.env.QMS_SEED_SUPPLIER_PASSWORD;
if (!baseURL || !internalPassword || !supplierPassword || !process.env.DATABASE_URL) throw new Error('ABC acceptance requires a real gateway, disposable PostgreSQL DATABASE_URL and both seed passwords; skipping is forbidden.');

type Schema = components['schemas'];
type User = Schema['AdminUserDto'];
type Organization = Schema['AdminOrganizationDto'];
type WriteBody = object;
const unique = (prefix: string) => `${prefix}_${randomUUID().replaceAll('-', '').slice(0, 16)}`;
const password = () => `${randomUUID()}Aa9!`;
const scope = (path: string, organization: string) => `/api/v1/admin/${path}?organizationId=${organization}`;

async function write(client: APIRequestContext, path: string, method: string, data?: WriteBody) {
  const protection = await client.get('/api/v1/auth/csrf');
  expect(protection.status()).toBe(200);
  const token = await protection.json() as Schema['CsrfResponseDto'];
  return client.fetch(path, { method, headers: { 'x-csrf-token': token.csrfToken, 'Idempotency-Key': randomUUID() }, data });
}
async function apiLogin(client: APIRequestContext, identifier: string, secret: string) {
  const response = await write(client, '/api/v1/auth/login', 'POST', { identifier, password: secret });
  if (response.status() === 200) await completeMfa(client, response, identifier);
  return response;
}
async function uiLogin(page: Page, identifier: string, secret: string) {
  await page.goto('/login');
  await page.getByLabel('账号', { exact: true }).fill(identifier);
  await fillSecret(page.getByLabel('密码', { exact: true }), secret);
  const response = page.waitForResponse((entry) => entry.url().endsWith('/api/v1/auth/login'));
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await completeMfa(page.request, await response, identifier, page);
  await expect(page).toHaveURL(/\/(app\/workbench|supplier\/inbox)$/);
}
async function searchUser(page: Page, username: string) {
  await page.getByLabel('搜索用户').fill(username);
  await page.getByLabel('搜索用户').press('Enter');
  const row = page.getByRole('row').filter({ has: page.getByText(username, { exact: true }) });
  await expect(row).toHaveCount(1);
  return row;
}
async function settings(page: Page) {
  await page.getByRole('button', { name: '个人信息设置', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '个人信息设置', exact: true });
  await expect(dialog).toBeVisible();
  return dialog;
}

const test = base.extend<{ admin: { client: APIRequestContext; organization: Organization; users: User[]; grants: PositionGrant[]; createUser: () => Promise<{ user: User; secret: string; grant: PositionGrant }> } }>({
  admin: async ({ playwright }, use) => {
    const client = await playwright.request.newContext({ baseURL });
    expect((await apiLogin(client, 'local.internal', internalPassword!)).status()).toBe(200);
    const directory = await client.get('/api/v1/admin/organizations');
    expect(directory.status()).toBe(200);
    const organizations = await directory.json() as Organization[];
    const organization = organizations.find((entry) => entry.type === 'INTERNAL' && entry.permissions.includes('account:users:create'));
    expect(!!organization).toBe(true);
    const users: User[] = [];
    const grants: PositionGrant[] = [];
    async function createUser() {
      const secret = password();
      const grant = await createPositionGrant(client, organization!.id, { name: unique('abc_empty'), permissionCodes: [] });
      grants.push(grant);
      const user = await createPositionUser(client, organization!.id, [grant.position.id], { username: unique('abc_user'), initialPassword: secret });
      users.push(user);
      return { user, secret, grant };
    }
    try { await use({ client, organization: organization!, users, grants, createUser }); }
    finally {
      for (const user of users) {
        await replacePositionAppointments(client, user.organizationId, user.id, []);
        expect((await write(client, scope(`users/${user.id}`, user.organizationId), 'PATCH', { status: 'DISABLED' })).status()).toBe(200);
      }
      for (const grant of grants.reverse()) await retirePositionGrant(client, organization!.id, grant);
      await client.dispose();
    }
  },
});
test.setTimeout(90_000);
test.use({ trace: 'off', screenshot: 'off', video: 'off', actionTimeout: 10_000, navigationTimeout: 15_000 });

async function positionRow(page: Page, name: string): Promise<Locator> {
  const table = page.locator('.position-structure-table');
  const row = table.getByRole('row').filter({ has: page.getByText(name, { exact: true }) });
  await expect(table.locator('tbody .ant-table-row').first()).toBeVisible();
  // shortcut: At most 100 fixture pages; add filtering if the disposable directory grows larger.
  for (let index = 0; index < 100; index++) {
    await expect(table.locator('.ant-spin-spinning')).toHaveCount(0);
    if (await row.count()) return row;
    const next = table.getByTitle('下一页', { exact: true });
    if (!await next.count() || (await next.getAttribute('class'))?.includes('ant-pagination-disabled')) break;
    const active = await table.locator('.ant-pagination-item-active').getAttribute('title');
    await next.click();
    await expect(table.locator('.ant-pagination-item-active')).not.toHaveAttribute('title', active!);
  }
  throw new Error('Disposable position row not found.');
}

async function openPositions(page: Page) {
  await page.getByRole('tab', { name: '部门岗位', exact: true }).click();
  await page.getByRole('tab', { name: '岗位', exact: true }).click();
}

test('A internal profile, other-session revocation and password rotation use real sessions', async ({ browser, page, admin }) => {
  const fixture = await admin.createUser();
  const other = await browser.newContext({ baseURL });
  const otherPage = await other.newPage();
  const probe = await browser.newContext({ baseURL });
  try {
    await uiLogin(page, fixture.user.username, fixture.secret);
    await uiLogin(otherPage, fixture.user.username, fixture.secret);
    await page.goto('/app/account');
    const editor = await settings(page);
    await editor.getByLabel('邮箱', { exact: true }).fill(`${fixture.user.username}@example.test`);
    await editor.getByRole('button', { name: '保存资料' }).click();
    await expect(editor.getByText('资料已保存')).toBeVisible();
    const profile = await page.request.get('/api/v1/me');
    expect((await profile.json() as Schema['AccountProfileDto']).email).toBe(`${fixture.user.username}@example.test`);
    await editor.getByRole('button', { name: '关闭个人信息设置', exact: true }).click();
    await expect(editor).toHaveCount(0);
    await page.getByRole('button', { name: '撤销', exact: true }).click();
    await expect(page.getByText('会话已撤销')).toBeVisible();
    expect((await other.request.get('/api/v1/auth/session')).status()).toBe(401);
    expect((await apiLogin(other.request, fixture.user.username, fixture.secret)).status()).toBe(200);
    const replacement = password();
    await page.getByRole('button', { name: '账号安全', exact: true }).click();
    const security = page.getByRole('dialog', { name: '账号安全', exact: true });
    await expect(security.getByRole('region', { name: '登录验证', exact: true })).toBeVisible();
    await security.getByRole('button', { name: '关闭账号安全', exact: true }).click();
    await expect(security).toHaveCount(0);
    await page.getByRole('button', { name: `个人菜单 · ${fixture.user.username}`, exact: true }).click();
    await page.getByRole('menuitem', { name: '修改密码', exact: true }).click();
    const passwordDialog = page.getByRole('dialog', { name: '修改密码', exact: true });
    await fillSecret(passwordDialog.getByLabel('当前密码'), fixture.secret);
    await fillSecret(passwordDialog.getByLabel('新密码'), replacement);
    await passwordDialog.getByRole('button', { name: '修改密码', exact: true }).click();
    await expect(page.getByText('密码已修改，其他会话已撤销')).toBeVisible();
    expect((await apiLogin(probe.request, fixture.user.username, fixture.secret)).status()).toBe(401);
    expect((await apiLogin(probe.request, fixture.user.username, replacement)).status()).toBe(200);
    expect((await other.request.get('/api/v1/auth/session')).status()).toBe(401);
    await page.goto('/app/admin');
    await expect(page.getByText('无系统管理访问权限')).toBeVisible();
    await expect(page.getByRole('link', { name: '平台管理' })).toHaveCount(0);
  } finally { await other.close(); await probe.close(); }
});

test('A supplier profile restores email and cannot enter internal administration', async ({ page }) => {
  await uiLogin(page, 'local.supplier', supplierPassword!);
  const original = await (await page.request.get('/api/v1/me')).json() as Schema['AccountProfileDto'];
  expect(original.emailVerifiedAt).toBeNull();
  try {
    await page.goto('/supplier/account');
    const editor = await settings(page);
    await editor.getByLabel('邮箱', { exact: true }).fill(`${unique('supplier')}@example.test`);
    await editor.getByRole('button', { name: '保存资料' }).click();
    await expect(editor.getByText('资料已保存')).toBeVisible();
    await expect(page.getByRole('link', { name: '平台管理' })).toHaveCount(0);
    await editor.getByLabel('邮箱', { exact: true }).fill(original.email ?? '');
    const restored = page.waitForResponse((response) => response.url().endsWith('/api/v1/me') && response.request().method() === 'PATCH');
    await editor.getByRole('button', { name: '保存资料' }).click();
    expect((await restored).status()).toBe(200);
    await expect(editor.getByText('资料已保存')).toBeVisible();
    await editor.getByRole('button', { name: '关闭个人信息设置', exact: true }).click();
    await expect(editor).toHaveCount(0);
    await page.goto('/app/admin');
    await expect(page).toHaveURL(/\/supplier\/inbox$/);
  } finally {
    const current = await positionRead<Schema['AccountProfileDto']>(page.request, '/api/v1/me');
    if (current.email !== original.email) expect((await write(page.request, '/api/v1/me', 'PATCH', { email: original.email ?? null, expectedProfileVersion: current.profileVersion })).status()).toBe(200);
  }
});

test('B UI creates, searches, edits, disables and re-enables a user', async ({ page, browser, admin }) => {
  await uiLogin(page, 'local.internal', internalPassword!);
  await page.goto('/app/admin');
  const grant = await createPositionGrant(admin.client, admin.organization.id, { name: unique('abc_ui_empty'), permissionCodes: [] });
  admin.grants.push(grant);
  await page.getByRole('button', { name: '创建用户', exact: true }).click();
  const dialog = page.getByRole('dialog');
  const username = unique('abc_ui');
  const secret = password();
  await dialog.getByLabel('用户名', { exact: true }).fill(username);
  await dialog.getByLabel('邮箱', { exact: true }).fill(`${username}@example.test`);
  await fillSecret(dialog.getByLabel('初始密码'), secret);
  await choosePosition(page, dialog, grant.position);
  await confirmPositionPreview(page, dialog, admin.organization.id);
  const created = page.waitForResponse((response) => response.url().endsWith('/api/v1/admin/users') && response.request().method() === 'POST');
  await dialog.getByRole('button', { name: '保存用户' }).click();
  const result = await created;
  expect(result.status()).toBe(201);
  const user = await result.json() as User;
  admin.users.push(user);
  const storage = await page.evaluate(() => JSON.stringify([localStorage, sessionStorage]));
  expect(storage.includes(secret)).toBe(false);
  await expect(dialog).toHaveCount(0);
  const row = await searchUser(page, username);
  await row.getByRole('button', { name: /^编\s*辑$/ }).click();
  await page.getByRole('dialog').getByLabel('邮箱').fill(`${username}.edited@example.test`);
  const patched = page.waitForResponse((response) => response.url().includes(`/users/${user.id}?`) && response.request().method() === 'PATCH');
  await page.getByRole('button', { name: '保存用户' }).click();
  const update = await patched;
  expect(update.status()).toBe(200);
  expect(update.request().postDataJSON()).toEqual({ email: `${username}.edited@example.test`, expectedProfileVersion: user.profileVersion });
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const session = await browser.newContext({ baseURL });
  const loginProbe = await browser.newContext({ baseURL });
  try {
    expect((await apiLogin(session.request, username, secret)).status()).toBe(200);
    await row.getByRole('button', { name: /^停\s*用$/ }).click();
    await expect(page.getByText('用户已停用')).toBeVisible();
    expect((await session.request.get('/api/v1/auth/session')).status()).toBe(401);
    expect((await apiLogin(loginProbe.request, username, secret)).status()).toBe(401);
    await row.getByRole('button', { name: /^启\s*用$/ }).click();
    await expect(page.getByText('用户已启用')).toBeVisible();
    expect((await apiLogin(loginProbe.request, username, secret)).status()).toBe(200);
  } finally { await session.close(); await loginProbe.close(); }
});

test('C position permissions and appointments grant access while all six legacy writes stay frozen', async ({ page, browser, admin }) => {
  const fixture = await admin.createUser();
  const grant = await createPositionGrant(admin.client, admin.organization.id, { name: unique('abc_position'), permissionCodes: [] });
  admin.grants.push(grant);
  const organizationPath = `/api/v1/organizations/${admin.organization.id}`;
  await uiLogin(page, 'local.internal', internalPassword!);
  await page.goto('/app/admin');
  await openPositions(page);
  await (await positionRow(page, grant.position.name)).getByRole('button', { name: '岗位权限', exact: true }).click();
  const drawer = page.getByRole('dialog', { name: `${grant.position.name} · 岗位权限`, exact: true });
  await drawer.getByRole('checkbox', { name: '用户管理 · 查看用户', exact: true }).check();
  const saved = page.waitForResponse(response => new URL(response.url()).pathname === `${organizationPath}/positions/${grant.position.id}/permissions` && response.request().method() === 'PUT');
  await drawer.getByRole('button', { name: '保存', exact: true }).click();
  expect((await saved).status()).toBe(200);
  await drawer.getByRole('textbox', { name: '搜索权限', exact: true }).press('Escape');
  await expect(drawer).toHaveCount(0);
  await page.getByRole('tab', { name: '用户', exact: true }).click();
  await (await searchUser(page, fixture.user.username)).getByRole('button', { name: /^调\s*岗$/ }).click();
  const appointments = page.getByRole('dialog');
  await appointments.locator('.ant-select-selection-item-remove').click();
  await choosePosition(page, appointments, grant.position);
  await confirmPositionPreview(page, appointments, admin.organization.id);
  const appointed = page.waitForResponse(response => new URL(response.url()).pathname === `${organizationPath}/users/${fixture.user.id}/positions` && response.request().method() === 'PUT');
  await appointments.getByRole('button', { name: '保存任职', exact: true }).click();
  expect((await appointed).status()).toBe(200);
  await expect(appointments).toHaveCount(0);
  const actor = await browser.newContext({ baseURL });
  try {
    expect((await apiLogin(actor.request, fixture.user.username, fixture.secret)).status()).toBe(200);
    expect((await actor.request.get(scope('users', admin.organization.id))).status()).toBe(200);
    const roleBefore = await positionRead<Schema['AdminRoleDto']>(admin.client, scope(`roles/${grant.role.id}`, admin.organization.id));
    const sourcesBefore = await positionRead<Schema['AdminUserRolesDto']>(admin.client, scope(`users/${fixture.user.id}/roles`, admin.organization.id));
    const mappingBefore = await positionRead<Schema['PositionRolesDto']>(admin.client, `${organizationPath}/positions/${grant.position.id}/roles`);
    const rolesBefore = await positionRead<Schema['AdminRoleDto'][]>(admin.client, scope('roles', admin.organization.id));
    const rejectedTraces: string[] = [];
    for (const [path, method, data] of [
      ['/api/v1/admin/roles', 'POST', { organizationId: admin.organization.id, code: unique('denied_role'), name: 'Denied', permissionCodes: [] }],
      [scope(`roles/${grant.role.id}/copy`, admin.organization.id), 'POST', { code: unique('denied_copy'), name: 'Denied copy' }],
      [scope(`roles/${grant.role.id}`, admin.organization.id), 'PATCH', { name: 'Denied rename' }],
      [scope(`roles/${grant.role.id}`, admin.organization.id), 'DELETE', undefined],
      [scope(`users/${fixture.user.id}/roles`, admin.organization.id), 'PUT', { roleIds: [] }],
      [`${organizationPath}/positions/${grant.position.id}/roles`, 'PUT', { roleIds: [], expectedRoleVersion: mappingBefore.roleVersion }],
    ] as const) {
      const denied = await write(admin.client, path, method, data);
      expect(denied.status(), `${method} legacy write`).toBe(403);
      const error = await denied.json() as Schema['ErrorResponse'];
      expect(error.code).toBe('FEATURE_PERMISSION_DENIED');
      rejectedTraces.push(error.traceId);
    }
    expect(await positionRead(admin.client, scope(`roles/${grant.role.id}`, admin.organization.id))).toEqual(roleBefore);
    expect(await positionRead(admin.client, scope(`users/${fixture.user.id}/roles`, admin.organization.id))).toEqual(sourcesBefore);
    expect(await positionRead(admin.client, `${organizationPath}/positions/${grant.position.id}/roles`)).toEqual(mappingBefore);
    expect(await positionRead(admin.client, scope('roles', admin.organization.id))).toEqual(rolesBefore);
    const audit = await positionRead<Schema['AuditPageDto']>(admin.client, `/api/v1/admin/audit-events?organizationId=${admin.organization.id}&action=ACTION_REJECTED&outcome=DENIED&pageSize=100`);
    for (const traceId of rejectedTraces) expect(audit.items.some(entry => entry.traceId === traceId)).toBe(true);
    await page.getByRole('tab', { name: '历史授权', exact: true }).click();
    for (const name of ['创建角色', '复制模板', '编辑角色', '删除角色']) await expect(page.getByRole('button', { name, exact: true })).toHaveCount(0);
    await replacePositionAppointments(admin.client, admin.organization.id, fixture.user.id, []);
    expect((await actor.request.get('/api/v1/me')).status()).toBe(401);
    expect((await apiLogin(actor.request, fixture.user.username, fixture.secret)).status()).toBe(200);
    expect((await actor.request.get(scope('users', admin.organization.id))).status()).toBe(403);
    const retained = await positionRead<Schema['PositionRolesDto']>(admin.client, `${organizationPath}/positions/${grant.position.id}/roles`);
    expect(retained.roles).toEqual(mappingBefore.roles);
    expect(retained.roleVersion).toBe(mappingBefore.roleVersion);
    expect(retained.effectiveAssigneeCount).toBe(0);
  } finally { await actor.close(); }
});

test('B/C read-only fixture sees lists but writes are forbidden in UI and API', async ({ page, admin }) => {
  const fixture = await admin.createUser();
  await changePositionPermissions(admin.client, admin.organization.id, fixture.grant.position.id, ['account:users:read', 'account:roles:read', 'organization:structure:read']);
  await uiLogin(page, fixture.user.username, fixture.secret);
  await page.goto('/app/admin');
  await searchUser(page, fixture.user.username);
  await expect(page.getByRole('button', { name: '创建用户', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^编\s*辑$/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '签发重置凭证' })).toHaveCount(0);
  await page.getByRole('tab', { name: '历史授权', exact: true }).click();
  await expect(page.getByRole('button', { name: '创建角色', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '编辑角色' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '删除角色' })).toHaveCount(0);
  expect((await write(page.request, '/api/v1/admin/users', 'POST', { username: unique('denied'), initialPassword: password(), accountType: 'INTERNAL', organizationId: admin.organization.id })).status()).toBe(403);
  expect((await write(page.request, scope(`users/${fixture.user.id}`, admin.organization.id), 'PATCH', { email: 'denied@example.test' })).status()).toBe(403);
  expect((await write(page.request, scope(`users/${fixture.user.id}/roles`, admin.organization.id), 'PUT', { roleIds: [] })).status()).toBe(403);
  expect((await write(page.request, scope(`roles/${fixture.grant.role.id}`, admin.organization.id), 'DELETE')).status()).toBe(403);
  expect((await write(page.request, scope(`users/${fixture.user.id}`, admin.organization.id), 'PATCH', { status: 'DISABLED' })).status()).toBe(403);
  expect((await write(page.request, scope(`users/${fixture.user.id}/password-reset`, admin.organization.id), 'POST', { temporaryCode: randomBytes(32).toString('base64url') })).status()).toBe(403);
  const positionPath = `/api/v1/organizations/${admin.organization.id}`;
  const baseline = await positionRead<Schema['PositionPermissionsDto']>(page.request, `${positionPath}/positions/${fixture.grant.position.id}/permissions`);
  expect((await write(page.request, `${positionPath}/positions/${fixture.grant.position.id}/permissions`, 'PUT', { permissionCodes: [], mfaRequired: baseline.mfaRequired, expectedPermissionCodes: baseline.permissionCodes, expectedMfaRequired: baseline.mfaRequired, expectedRoleVersion: baseline.roleVersion })).status()).toBe(403);
  // A reader cannot obtain a signed preview; the write guard must reject before DTO validation.
  expect((await write(page.request, `${positionPath}/users/${fixture.user.id}/positions`, 'PUT', { positionIds: [], expectedPositionIds: [fixture.grant.position.id] })).status()).toBe(403);
  await openPositions(page);
  await (await positionRow(page, fixture.grant.position.name)).getByRole('button', { name: '岗位权限', exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('button', { name: '保存', exact: true })).toHaveCount(0);
});

test('B/C UI position-only rename preserves a memory-only credential for one anonymous reset exchange', async ({ page, browser, admin }) => {
  const fixture = await admin.createUser();
  await uiLogin(page, 'local.internal', internalPassword!);
  await page.goto('/app/admin');
  await (await searchUser(page, fixture.user.username)).getByRole('button', { name: '签发重置凭证' }).click();
  const issued = page.waitForResponse((response) => response.url().includes(`/users/${fixture.user.id}/password-reset`));
  await page.getByRole('button', { name: '确认签发' }).click();
  expect((await issued).status()).toBe(201);
  const credential = await page.getByRole('textbox', { name: '一次性重置凭证', exact: true }).inputValue();
  const [resetId, temporaryCode] = credential.split('.');
  expect(temporaryCode.length >= 43).toBe(true);
  const storage = await page.evaluate(() => JSON.stringify([localStorage, sessionStorage]));
  expect(storage.includes(temporaryCode)).toBe(false);
  expect(page.url().includes(temporaryCode)).toBe(false);
  await page.getByRole('button', { name: '关闭并清除' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await openPositions(page);
  await (await positionRow(page, fixture.grant.position.name)).getByRole('button', { name: /^编\s*辑$/ }).click();
  const editor = page.getByRole('dialog');
  const name = `${fixture.grant.position.name} renamed`;
  await editor.getByLabel('名称', { exact: true }).fill(name);
  const renamed = page.waitForResponse(response => new URL(response.url()).pathname === `/api/v1/organizations/${admin.organization.id}/positions/${fixture.grant.position.id}` && response.request().method() === 'PATCH');
  await editor.getByRole('button', { name: '保存', exact: true }).click();
  const renameResponse = await renamed;
  expect(renameResponse.status()).toBe(200);
  expect(renameResponse.request().postDataJSON()).toEqual({ name, departmentId: fixture.grant.department.id, categoryId: null, status: 'ACTIVE', expectedVersion: fixture.grant.position.version });
  await expect(editor).toHaveCount(0);
  const anonymous = await browser.newContext({ baseURL });
  const resetPage = await anonymous.newPage();
  const replacement = password();
  try {
    await resetPage.goto('/reset-password');
    await fillSecret(resetPage.getByLabel('重置凭证', { exact: true }), credential);
    await fillSecret(resetPage.getByLabel('新密码', { exact: true }), replacement);
    const completed = resetPage.waitForResponse((response) => response.url().endsWith('/auth/password-reset/complete'));
    await resetPage.getByRole('button', { name: '重置密码', exact: true }).click();
    expect((await completed).status()).toBe(204);
    await expect(resetPage.getByText('密码已重置，请重新登录')).toBeVisible();
    expect((await resetPage.getByLabel('重置凭证', { exact: true }).inputValue()).length === 0).toBe(true);
    expect((await resetPage.getByLabel('新密码', { exact: true }).inputValue()).length === 0).toBe(true);
    const resetStorage = await resetPage.evaluate(() => JSON.stringify([localStorage, sessionStorage]));
    expect(resetStorage.includes(temporaryCode) || resetStorage.includes(replacement)).toBe(false);
    expect(resetPage.url().includes(temporaryCode) || resetPage.url().includes(replacement)).toBe(false);
    expect((await apiLogin(anonymous.request, fixture.user.username, replacement)).status()).toBe(200);
    const replay = await write(anonymous.request, '/api/v1/auth/password-reset/complete', 'POST', { resetId, temporaryCode, newPassword: password() });
    expect(replay.status()).toBe(400);
    expect((await replay.json() as Schema['ErrorResponse']).code).toBe('AUTH_PASSWORD_RESET_INVALID');
  } finally { await anonymous.close(); }
});
