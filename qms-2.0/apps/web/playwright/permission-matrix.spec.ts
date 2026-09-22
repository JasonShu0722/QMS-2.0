import { randomBytes, randomUUID } from 'node:crypto';
import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import type { components } from '@qms/contracts';
import { fillSecret } from './secret-input';
import { completeMfa } from './mfa-login';

const baseURL = process.env.QMS_ACCEPTANCE_BASE_URL ?? process.env.PLAYWRIGHT_BASE_URL;
const internalPassword = process.env.QMS_SEED_INTERNAL_PASSWORD;
if (!baseURL || !internalPassword || !process.env.DATABASE_URL) throw new Error('Permission matrix acceptance requires a real gateway, disposable PostgreSQL DATABASE_URL and the internal seed password; skipping is forbidden.');

type Schema = components['schemas'];
type User = Schema['AdminUserDto'];
type Role = Schema['AdminRoleDto'];
type WriteBody = Schema['LoginDto'] | Schema['CreateAdminUserDto'] | Schema['UpdateAdminUserDto'] | Schema['CreateAdminRoleDto'] | Schema['AssignAdminRolesDto'] | Schema['ResetAdminUserPasswordDto'];
const unique = (prefix: string) => `${prefix}_${randomUUID().replaceAll('-', '').slice(0, 16)}`;
const password = () => `${randomUUID()}Aa9!`;
const scope = (path: string, organizationId: string) => `/api/v1/admin/${path}?organizationId=${organizationId}`;

async function write(client: APIRequestContext, path: string, method: string, data?: WriteBody) {
  const protection = await client.get('/api/v1/auth/csrf');
  expect(protection.status()).toBe(200);
  const token = await protection.json() as Schema['CsrfResponseDto'];
  return client.fetch(path, { method, headers: { 'x-csrf-token': token.csrfToken, 'Idempotency-Key': randomUUID() }, data });
}

async function uiLogin(page: Page, identifier: string, secret: string) {
  await page.goto('/login');
  await page.getByLabel('账号', { exact: true }).fill(identifier);
  await fillSecret(page.getByLabel('密码', { exact: true }), secret);
  const response = page.waitForResponse((entry) => entry.url().endsWith('/api/v1/auth/login'));
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await completeMfa(page.request, await response, identifier, page);
  await expect(page).toHaveURL(/\/app\/workbench$/);
}

async function searchUser(page: Page, username: string) {
  await page.getByLabel('搜索用户').fill(username);
  await page.getByLabel('搜索用户').press('Enter');
  const row = page.getByRole('row').filter({ has: page.getByText(username, { exact: true }) });
  await expect(row).toHaveCount(1);
  return row;
}

async function savePermissions(page: Page, role: Role, expectedPermissionCodes: string[], permissionCodes: string[]) {
  const response = page.waitForResponse((entry) => entry.url().includes(`/roles/${role.id}?`) && entry.request().method() === 'PATCH');
  await page.getByRole('button', { name: '保存权限', exact: true }).click();
  const saved = await response;
  expect(saved.status()).toBe(200);
  const body = saved.request().postDataJSON() as Schema['UpdateAdminRoleDto'];
  expect(Object.keys(body).sort()).toEqual(['expectedPermissionCodes', 'permissionCodes']);
  expect(body.expectedPermissionCodes?.slice().sort()).toEqual(expectedPermissionCodes.slice().sort());
  expect(body.permissionCodes?.slice().sort()).toEqual(permissionCodes.slice().sort());
  const updated = await saved.json() as Role;
  expect(updated.permissions.map((permission) => permission.code).sort()).toEqual(permissionCodes.slice().sort());
  await expect(page.getByText('权限已保存', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '保存权限', exact: true })).toBeDisabled();
}

test.setTimeout(120_000);

test('grouped matrix grants only selected user operations and revokes them on live sessions', async ({ page, browser, playwright }) => {
  const client = await playwright.request.newContext({ baseURL });
  const restricted = await browser.newContext({ baseURL });
  const restrictedPage = await restricted.newPage();
  const users: User[] = [];
  let role: Role | undefined;
  let organizationId: string | undefined;
  try {
    await completeMfa(client, await write(client, '/api/v1/auth/login', 'POST', { identifier: 'local.internal', password: internalPassword! }), 'local.internal');
    const directory = await client.get('/api/v1/admin/organizations');
    expect(directory.status()).toBe(200);
    const organizations = await directory.json() as Schema['AdminOrganizationDto'][];
    const organization = organizations.find((entry) => entry.type === 'INTERNAL' && entry.permissions.includes('account:users:create'));
    expect(!!organization).toBe(true);
    organizationId = organization!.id;
    const secret = password();
    const userResponse = await write(client, '/api/v1/admin/users', 'POST', { username: unique('matrix_actor'), initialPassword: secret, organizationId, accountType: 'INTERNAL' });
    expect(userResponse.status()).toBe(201);
    const actor = await userResponse.json() as User;
    users.push(actor);
    const roleResponse = await write(client, '/api/v1/admin/roles', 'POST', { organizationId, code: unique('matrix_role'), name: unique('Matrix role'), permissionCodes: [] });
    expect(roleResponse.status()).toBe(201);
    role = await roleResponse.json() as Role;
    expect(role.permissions).toEqual([]);
    expect((await write(client, scope(`users/${actor.id}/roles`, organizationId), 'PUT', { roleIds: [role.id] })).status()).toBe(200);
    await uiLogin(restrictedPage, actor.username, secret);
    await restrictedPage.goto('/app/admin');
    await expect(restrictedPage.getByText('无系统管理访问权限')).toBeVisible();

    await uiLogin(page, 'local.internal', internalPassword!);
    await page.goto('/app/admin');
    await page.getByRole('tab', { name: '权限矩阵', exact: true }).click();
    const matrix = page.getByRole('tabpanel', { name: '权限矩阵', exact: true });
    await page.getByLabel('选择角色', { exact: true }).click();
    await page.locator('.ant-select-item-option').filter({ hasText: role.name }).click();
    await expect(page.getByRole('button', { name: '保存权限', exact: true })).toBeDisabled();
    for (const groupName of ['供应商质量', '制程质量', '客户质量', '新品质量', '审核管理']) {
      await page.getByLabel('板块筛选', { exact: true }).click();
      await page.locator('.ant-select-item-option').filter({ hasText: groupName }).click();
      await expect(matrix.getByRole('heading', { name: groupName, exact: true })).toBeVisible();
      await expect(matrix.getByText('待接入', { exact: true }).first()).toBeVisible();
      await expect(matrix.getByRole('checkbox')).toHaveCount(0);
    }
    await page.getByLabel('板块筛选', { exact: true }).click();
    await page.locator('.ant-select-item-option').filter({ hasText: '系统管理' }).click();
    await expect(matrix.getByRole('heading', { name: '系统管理', exact: true })).toBeVisible();
    const read = matrix.getByRole('checkbox', { name: '用户管理 · 查看用户', exact: true });
    const create = matrix.getByRole('checkbox', { name: '用户管理 · 创建用户', exact: true });
    const update = matrix.getByRole('checkbox', { name: '用户管理 · 编辑邮箱', exact: true });
    await expect(read).not.toBeChecked();
    await expect(create).not.toBeChecked();
    await expect(update).not.toBeChecked();
    await read.check();
    await create.check();
    const createPermissions = ['account:users:read', 'account:users:create'];
    await savePermissions(page, role, [], createPermissions);

    expect((await restricted.request.get('/api/v1/me')).status()).toBe(401);
    await uiLogin(restrictedPage, actor.username, secret);
    await restrictedPage.goto('/app/admin');
    await restrictedPage.getByRole('button', { name: '创建用户', exact: true }).click();
    const dialog = restrictedPage.getByRole('dialog');
    const username = unique('matrix_created');
    const createdSecret = password();
    await dialog.getByLabel('用户名', { exact: true }).fill(username);
    await fillSecret(dialog.getByLabel('初始密码', { exact: true }), createdSecret);
    const created = restrictedPage.waitForResponse((response) => response.url().endsWith('/api/v1/admin/users') && response.request().method() === 'POST');
    await dialog.getByRole('button', { name: '保存用户', exact: true }).click();
    const createdResponse = await created;
    expect(createdResponse.status()).toBe(201);
    const target = await createdResponse.json() as User;
    users.push(target);
    await expect(dialog).toHaveCount(0);
    const row = await searchUser(restrictedPage, username);
    await expect(row.getByRole('button', { name: /^编\s*辑$/ })).toHaveCount(0);
    await expect(row.getByRole('button', { name: /^停\s*用$/ })).toHaveCount(0);
    await expect(row.getByRole('button', { name: '签发重置凭证' })).toHaveCount(0);
    expect((await write(restricted.request, scope(`users/${target.id}`, organizationId), 'PATCH', { email: 'denied@example.test' })).status()).toBe(403);
    expect((await write(restricted.request, scope(`users/${target.id}`, organizationId), 'PATCH', { status: 'DISABLED' })).status()).toBe(403);
    expect((await write(restricted.request, scope(`users/${target.id}/password-reset`, organizationId), 'POST', { temporaryCode: randomBytes(32).toString('base64url') })).status()).toBe(403);

    await update.check();
    const updatePermissions = [...createPermissions, 'account:users:update'];
    await savePermissions(page, role, createPermissions, updatePermissions);
    expect((await restricted.request.get('/api/v1/me')).status()).toBe(401);
    await uiLogin(restrictedPage, actor.username, secret);
    await restrictedPage.goto('/app/admin');
    await (await searchUser(restrictedPage, username)).getByRole('button', { name: /^编\s*辑$/ }).click();
    const editor = restrictedPage.getByRole('dialog');
    await expect(editor.getByLabel('主组织', { exact: true })).toHaveCount(0);
    await expect(editor.getByLabel('账号类型', { exact: true })).toHaveCount(0);
    await expect(editor.getByLabel('状态', { exact: true })).toHaveCount(0);
    const email = `${username}@example.test`;
    await editor.getByLabel('邮箱', { exact: true }).fill(email);
    const edited = restrictedPage.waitForResponse((response) => response.url().includes(`/users/${target.id}?`) && response.request().method() === 'PATCH');
    await editor.getByRole('button', { name: '保存用户', exact: true }).click();
    const editedResponse = await edited;
    expect(editedResponse.status()).toBe(200);
    expect(editedResponse.request().postDataJSON()).toEqual({ email });
    expect((await editedResponse.json() as User).email).toBe(email);
    await expect(editor).toHaveCount(0);
    await expect(row.getByRole('button', { name: /^停\s*用$/ })).toHaveCount(0);
    await expect(row.getByRole('button', { name: '签发重置凭证' })).toHaveCount(0);
    expect((await write(restricted.request, scope(`users/${target.id}`, organizationId), 'PATCH', { status: 'DISABLED' })).status()).toBe(403);

    await update.uncheck();
    await savePermissions(page, role, updatePermissions, createPermissions);
    expect((await write(restricted.request, scope(`users/${target.id}`, organizationId), 'PATCH', { email: 'revoked@example.test' })).status()).toBe(401);
    await uiLogin(restrictedPage, actor.username, secret);
    expect((await write(restricted.request, scope(`users/${target.id}`, organizationId), 'PATCH', { email: 'revoked@example.test' })).status()).toBe(403);
    await restrictedPage.goto('/app/admin');
    const afterRevocation = await searchUser(restrictedPage, username);
    await expect(afterRevocation.getByRole('button', { name: /^编\s*辑$/ })).toHaveCount(0);
    await expect(afterRevocation.getByText(email, { exact: true })).toBeVisible();
    await expect(restrictedPage.getByRole('button', { name: '创建用户', exact: true })).toBeVisible();
  } finally {
    await restricted.close();
    for (const user of users) {
      expect((await write(client, scope(`users/${user.id}/roles`, user.organizationId), 'PUT', { roleIds: [] })).status()).toBe(200);
      expect((await write(client, scope(`users/${user.id}`, user.organizationId), 'PATCH', { status: 'DISABLED' })).status()).toBe(200);
    }
    if (role && organizationId) expect((await write(client, scope(`roles/${role.id}`, organizationId), 'DELETE')).status()).toBe(204);
    await client.dispose();
  }
});
