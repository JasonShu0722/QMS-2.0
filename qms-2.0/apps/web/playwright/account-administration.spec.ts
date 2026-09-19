import { randomUUID } from 'node:crypto';
import { test as base, expect, type APIRequestContext, type Page } from '@playwright/test';
import type { components } from '@qms/contracts';

const baseURL = process.env.QMS_ACCEPTANCE_BASE_URL ?? process.env.PLAYWRIGHT_BASE_URL;
const internalPassword = process.env.QMS_SEED_INTERNAL_PASSWORD;
const supplierPassword = process.env.QMS_SEED_SUPPLIER_PASSWORD;
process.env.PLAYWRIGHT_NO_COPY_PROMPT = '1';
if (!baseURL || !internalPassword || !supplierPassword || !process.env.DATABASE_URL) throw new Error('ABC acceptance requires a real gateway, disposable PostgreSQL DATABASE_URL and both seed passwords; skipping is forbidden.');

type Schema = components['schemas'];
type User = Schema['AdminUserDto'];
type Role = Schema['AdminRoleDto'];
type Organization = Schema['AdminOrganizationDto'];
type WriteBody = Schema['CreateAdminUserDto'] | Schema['UpdateAdminUserDto'] | Schema['CreateAdminRoleDto'] | Schema['UpdateAdminRoleDto'] | Schema['AssignAdminRolesDto'] | Schema['CopyAdminRoleDto'] | Schema['LoginDto'] | Schema['UpdateAccountProfileDto'] | Schema['CompletePasswordResetDto'];
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
  return write(client, '/api/v1/auth/login', 'POST', { identifier, password: secret });
}
async function uiLogin(page: Page, identifier: string, secret: string) {
  await page.goto('/login');
  await page.getByLabel('账号', { exact: true }).fill(identifier);
  await page.getByLabel('密码', { exact: true }).fill(secret);
  const response = page.waitForResponse((entry) => entry.url().endsWith('/api/v1/auth/login'));
  await page.getByRole('button', { name: '登录', exact: true }).click();
  expect((await response).status()).toBe(200);
  await expect(page).toHaveURL(/\/(app\/workbench|supplier\/inbox)$/);
}
async function searchUser(page: Page, username: string) {
  await page.getByLabel('搜索用户').fill(username);
  await page.getByLabel('搜索用户').press('Enter');
  const row = page.getByRole('row').filter({ has: page.getByText(username, { exact: true }) });
  await expect(row).toHaveCount(1);
  return row;
}

const test = base.extend<{ admin: { client: APIRequestContext; organization: Organization; users: User[]; roles: Role[]; createUser: () => Promise<{ user: User; secret: string }> } }>({
  admin: async ({ playwright }, use) => {
    const client = await playwright.request.newContext({ baseURL });
    expect((await apiLogin(client, 'local.internal', internalPassword!)).status()).toBe(200);
    const directory = await client.get('/api/v1/admin/organizations');
    expect(directory.status()).toBe(200);
    const organizations = await directory.json() as Organization[];
    const organization = organizations.find((entry) => entry.type === 'INTERNAL' && entry.permissions.includes('account:users:manage'));
    expect(!!organization).toBe(true);
    const users: User[] = [];
    const roles: Role[] = [];
    async function createUser() {
      const secret = password();
      const response = await write(client, '/api/v1/admin/users', 'POST', { username: unique('abc_user'), initialPassword: secret, organizationId: organization!.id, accountType: 'INTERNAL' });
      expect(response.status()).toBe(201);
      const user = await response.json() as User;
      users.push(user);
      return { user, secret };
    }
    try { await use({ client, organization: organization!, users, roles, createUser }); }
    finally {
      for (const user of users) {
        await write(client, scope(`users/${user.id}/roles`, user.organizationId), 'PUT', { roleIds: [] });
        await write(client, scope(`users/${user.id}`, user.organizationId), 'PATCH', { status: 'DISABLED' });
      }
      for (const role of roles.reverse()) await write(client, scope(`roles/${role.id}`, organization!.id), 'DELETE');
      await client.dispose();
    }
  },
});
test.setTimeout(90_000);

test('A internal profile, other-session revocation and password rotation use real sessions', async ({ browser, page, admin }) => {
  const fixture = await admin.createUser();
  const other = await browser.newContext({ baseURL });
  const otherPage = await other.newPage();
  const probe = await browser.newContext({ baseURL });
  try {
    await uiLogin(page, fixture.user.username, fixture.secret);
    await uiLogin(otherPage, fixture.user.username, fixture.secret);
    await page.goto('/app/account');
    await page.getByLabel('邮箱', { exact: true }).fill(`${fixture.user.username}@example.test`);
    await page.getByRole('button', { name: '保存资料' }).click();
    await expect(page.getByText('资料已保存')).toBeVisible();
    const profile = await page.request.get('/api/v1/me');
    expect((await profile.json() as Schema['AccountProfileDto']).email).toBe(`${fixture.user.username}@example.test`);
    await page.getByRole('button', { name: '撤销', exact: true }).click();
    await expect(page.getByText('会话已撤销')).toBeVisible();
    expect((await other.request.get('/api/v1/auth/session')).status()).toBe(401);
    expect((await apiLogin(other.request, fixture.user.username, fixture.secret)).status()).toBe(200);
    const replacement = password();
    await page.getByLabel('当前密码').fill(fixture.secret);
    await page.getByLabel('新密码').fill(replacement);
    await page.getByRole('button', { name: '修改密码', exact: true }).click();
    await expect(page.getByText('密码已修改，其他会话已撤销')).toBeVisible();
    expect((await apiLogin(probe.request, fixture.user.username, fixture.secret)).status()).toBe(401);
    expect((await apiLogin(probe.request, fixture.user.username, replacement)).status()).toBe(200);
    expect((await other.request.get('/api/v1/auth/session')).status()).toBe(401);
    await page.goto('/app/admin');
    await expect(page.getByText('无系统管理访问权限')).toBeVisible();
    await expect(page.getByRole('link', { name: '系统管理' })).toHaveCount(0);
  } finally { await other.close(); await probe.close(); }
});

test('A supplier profile restores email and cannot enter internal administration', async ({ page }) => {
  await uiLogin(page, 'local.supplier', supplierPassword!);
  const original = await (await page.request.get('/api/v1/me')).json() as Schema['AccountProfileDto'];
  try {
    await page.goto('/supplier/account');
    await page.getByLabel('邮箱', { exact: true }).fill(`${unique('supplier')}@example.test`);
    await page.getByRole('button', { name: '保存资料' }).click();
    await expect(page.getByText('资料已保存')).toBeVisible();
    await expect(page.getByRole('link', { name: '系统管理' })).toHaveCount(0);
    await page.getByLabel('邮箱', { exact: true }).fill(original.email ?? '');
    const restored = page.waitForResponse((response) => response.url().endsWith('/api/v1/me') && response.request().method() === 'PATCH');
    await page.getByRole('button', { name: '保存资料' }).click();
    expect((await restored).status()).toBe(200);
    await page.goto('/app/admin');
    await expect(page).toHaveURL(/\/supplier\/inbox$/);
  } finally { expect((await write(page.request, '/api/v1/me', 'PATCH', { email: original.email ?? null })).status()).toBe(200); }
});

test('B UI creates, searches, edits, disables and re-enables a user', async ({ page, browser, admin }) => {
  await uiLogin(page, 'local.internal', internalPassword!);
  await page.goto('/app/admin');
  await page.getByRole('button', { name: '创建用户', exact: true }).click();
  const dialog = page.getByRole('dialog');
  const username = unique('abc_ui');
  const secret = password();
  await dialog.getByLabel('用户名', { exact: true }).fill(username);
  await dialog.getByLabel('邮箱', { exact: true }).fill(`${username}@example.test`);
  await dialog.getByLabel('初始密码').fill(secret);
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
  expect(update.request().postDataJSON()).toEqual({ email: `${username}.edited@example.test` });
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

test('C role CRUD, template copy, assignments and matrix reflect real authorization', async ({ page, admin }) => {
  const fixture = await admin.createUser();
  await uiLogin(page, 'local.internal', internalPassword!);
  await page.goto('/app/admin');
  await page.getByRole('tab', { name: '角色', exact: true }).click();
  await page.getByRole('button', { name: '创建角色', exact: true }).click();
  const code = unique('abc_role');
  await page.getByLabel('角色代码', { exact: true }).fill(code);
  await page.getByLabel('角色名称', { exact: true }).fill(code);
  await page.getByLabel('角色权限', { exact: true }).click();
  await page.locator('.ant-select-item-option').filter({ hasText: 'account:users:read' }).click();
  await page.getByLabel('角色名称', { exact: true }).click();
  const created = page.waitForResponse((response) => response.url().endsWith('/admin/roles') && response.request().method() === 'POST');
  await page.getByRole('button', { name: '保存角色', exact: true }).click();
  const roleResponse = await created;
  expect(roleResponse.status()).toBe(201);
  const role = await roleResponse.json() as Role;
  admin.roles.push(role);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  let roleRow = page.getByRole('row').filter({ has: page.getByText(code, { exact: true }).first() });
  await roleRow.getByRole('button', { name: '编辑角色' }).click();
  await page.getByLabel('角色名称', { exact: true }).fill(`${code} edited`);
  await page.getByRole('button', { name: '保存角色', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  roleRow = page.getByRole('row').filter({ has: page.getByText(`${code} edited`, { exact: true }) });
  await roleRow.getByRole('button', { name: '复制模板' }).click();
  await page.getByLabel('角色代码', { exact: true }).fill(`${code}_copy`);
  await page.getByLabel('角色名称', { exact: true }).fill(`${code} copy`);
  const copied = page.waitForResponse((response) => response.url().includes(`/roles/${role.id}/copy`) && response.request().method() === 'POST');
  await page.getByRole('button', { name: '保存角色', exact: true }).click();
  const copiedResponse = await copied;
  expect(copiedResponse.status()).toBe(201);
  admin.roles.push(await copiedResponse.json() as Role);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('tab', { name: '用户', exact: true }).click();
  const userRow = await searchUser(page, fixture.user.username);
  await userRow.getByRole('button', { name: '分配角色' }).click();
  await page.getByLabel('组织角色', { exact: true }).click();
  await page.locator('.ant-select-item-option').filter({ hasText: `${code} edited` }).click();
  await page.getByRole('dialog').locator('.ant-modal-title').click();
  await page.getByRole('button', { name: '保存角色分配' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const assigned = await (await admin.client.get(scope(`users/${fixture.user.id}/roles`, admin.organization.id))).json() as Schema['AdminUserRolesDto'];
  expect(assigned.roles.some((entry) => entry.id === role.id)).toBe(true);
  await page.getByRole('tab', { name: '权限矩阵' }).click();
  const header = page.getByRole('columnheader', { name: `${code} edited`, exact: true });
  await expect(header).toBeVisible();
  const index = await header.evaluate((element) => Array.from(element.parentElement!.children).indexOf(element));
  const permissionRow = page.getByRole('row').filter({ has: page.locator('code').filter({ hasText: /^account:users:read$/ }) });
  await expect(permissionRow.getByRole('cell').nth(index)).toHaveText('已授权');
  await page.getByRole('tab', { name: '角色', exact: true }).click();
  const inUse = page.waitForResponse((response) => response.url().includes(`/roles/${role.id}?`) && response.request().method() === 'DELETE');
  await page.getByRole('row').filter({ has: page.getByText(`${code} edited`, { exact: true }) }).getByRole('button', { name: '删除角色' }).click();
  expect((await inUse).status()).toBe(409);
  await expect(page.getByText('角色仍在使用，请先解除用户分配')).toBeVisible();
  await page.getByRole('tab', { name: '用户', exact: true }).click();
  await (await searchUser(page, fixture.user.username)).getByRole('button', { name: '分配角色' }).click();
  await page.getByRole('dialog').locator('.ant-select-selection-item-remove').click();
  await page.getByRole('dialog').locator('.ant-modal-title').click();
  await page.getByRole('button', { name: '保存角色分配' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('tab', { name: '角色', exact: true }).click();
  await page.getByRole('row').filter({ has: page.getByText(`${code} edited`, { exact: true }) }).getByRole('button', { name: '删除角色' }).click();
  await expect(page.getByText('角色已删除')).toBeVisible();
});

test('B/C read-only fixture sees lists but writes are forbidden in UI and API', async ({ page, admin }) => {
  const fixture = await admin.createUser();
  const roleResponse = await write(admin.client, '/api/v1/admin/roles', 'POST', { organizationId: admin.organization.id, code: unique('abc_reader'), name: unique('reader'), permissionCodes: ['account:users:read', 'account:roles:read'] });
  expect(roleResponse.status()).toBe(201);
  const role = await roleResponse.json() as Role;
  admin.roles.push(role);
  expect((await write(admin.client, scope(`users/${fixture.user.id}/roles`, admin.organization.id), 'PUT', { roleIds: [role.id] })).status()).toBe(200);
  await uiLogin(page, fixture.user.username, fixture.secret);
  await page.goto('/app/admin');
  await searchUser(page, fixture.user.username);
  await expect(page.getByRole('button', { name: '创建用户', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^编\s*辑$/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '签发重置凭证' })).toHaveCount(0);
  await page.getByRole('tab', { name: '角色', exact: true }).click();
  await expect(page.getByRole('button', { name: '创建角色', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '编辑角色' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '删除角色' })).toHaveCount(0);
  expect((await write(page.request, '/api/v1/admin/users', 'POST', { username: unique('denied'), initialPassword: password(), accountType: 'INTERNAL', organizationId: admin.organization.id })).status()).toBe(403);
  expect((await write(page.request, scope(`users/${fixture.user.id}`, admin.organization.id), 'PATCH', { email: 'denied@example.test' })).status()).toBe(403);
  expect((await write(page.request, scope(`users/${fixture.user.id}/roles`, admin.organization.id), 'PUT', { roleIds: [] })).status()).toBe(403);
  expect((await write(page.request, scope(`roles/${role.id}`, admin.organization.id), 'DELETE')).status()).toBe(403);
});

test('B UI issues a memory-only credential and anonymous reset exchanges it once', async ({ page, browser, admin }) => {
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
  const anonymous = await browser.newContext({ baseURL });
  const resetPage = await anonymous.newPage();
  const replacement = password();
  try {
    await resetPage.goto('/reset-password');
    await resetPage.getByLabel('重置凭证', { exact: true }).fill(credential);
    await resetPage.getByLabel('新密码', { exact: true }).fill(replacement);
    await resetPage.getByRole('button', { name: '重置密码', exact: true }).click();
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
