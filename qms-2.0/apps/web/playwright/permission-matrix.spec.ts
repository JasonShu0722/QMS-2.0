import { randomBytes, randomUUID } from 'node:crypto';
import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import type { components } from '@qms/contracts';
import { fillSecret } from './secret-input';
import { completeMfa } from './mfa-login';
import { changePositionPermissions, choosePosition, confirmPositionPreview, createPositionGrant, createPositionUser, positionRead, replacePositionAppointments, retirePositionGrant, type PositionGrant } from './position-fixture';

const baseURL = process.env.QMS_ACCEPTANCE_BASE_URL ?? process.env.PLAYWRIGHT_BASE_URL;
const internalPassword = process.env.QMS_SEED_INTERNAL_PASSWORD;
if (!baseURL || !internalPassword || !process.env.DATABASE_URL) throw new Error('Permission matrix acceptance requires a real gateway, disposable PostgreSQL DATABASE_URL and the internal seed password; skipping is forbidden.');

type Schema = components['schemas'];
type User = Schema['AdminUserDto'];
type WriteBody = object;
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

async function openPermissions(page: Page, grant: PositionGrant) {
  await page.getByRole('tab', { name: '部门岗位', exact: true }).click();
  await page.getByRole('tab', { name: '岗位', exact: true }).click();
  const table = page.locator('.position-structure-table');
  const row = table.getByRole('row').filter({ has: page.getByText(grant.position.name, { exact: true }) });
  await expect(table.locator('tbody .ant-table-row').first()).toBeVisible();
  // shortcut: At most 100 fixture pages; add filtering if the disposable directory grows larger.
  for (let index = 0; index < 100; index++) {
    await expect(table.locator('.ant-spin-spinning')).toHaveCount(0);
    if (await row.count()) break;
    const next = table.getByTitle('下一页', { exact: true });
    if (!await next.count() || (await next.getAttribute('class'))?.includes('ant-pagination-disabled')) break;
    const active = await table.locator('.ant-pagination-item-active').getAttribute('title');
    await next.click();
    await expect(table.locator('.ant-pagination-item-active')).not.toHaveAttribute('title', active!);
  }
  await expect(row).toHaveCount(1);
  await row.getByRole('button', { name: '岗位权限', exact: true }).click();
  return page.getByRole('dialog', { name: `${grant.position.name} · 岗位权限`, exact: true });
}

async function savePermissions(page: Page, organizationId: string, grant: PositionGrant, expectedPermissionCodes: string[], permissionCodes: string[]) {
  const path = `/api/v1/organizations/${organizationId}/positions/${grant.position.id}/permissions`;
  const baseline = await positionRead<Schema['PositionPermissionsDto']>(page.request, path);
  expect(baseline.permissionCodes.slice().sort()).toEqual(expectedPermissionCodes.slice().sort());
  const response = page.waitForResponse(entry => new URL(entry.url()).pathname === path && entry.request().method() === 'PUT');
  await page.getByRole('dialog').getByRole('button', { name: '保存', exact: true }).click();
  const saved = await response;
  expect(saved.status()).toBe(200);
  const body = saved.request().postDataJSON() as Schema['UpdatePositionPermissionsDto'];
  expect(Object.keys(body).sort()).toEqual(['expectedMfaRequired', 'expectedPermissionCodes', 'expectedRoleVersion', 'mfaRequired', 'permissionCodes']);
  expect(body.expectedPermissionCodes.slice().sort()).toEqual(expectedPermissionCodes.slice().sort());
  expect(body.permissionCodes.slice().sort()).toEqual(permissionCodes.slice().sort());
  expect(body.expectedRoleVersion).toBe(baseline.roleVersion);
  expect(body.expectedMfaRequired).toBe(baseline.mfaRequired);
  expect(body.mfaRequired).toBe(baseline.mfaRequired);
  const updated = await saved.json() as Schema['PositionPermissionsDto'];
  expect(updated.permissionCodes.slice().sort()).toEqual(permissionCodes.slice().sort());
  expect(updated.roleVersion).toBeGreaterThan(baseline.roleVersion);
}

test.setTimeout(120_000);
test.use({ trace: 'off', screenshot: 'off', video: 'off', actionTimeout: 10_000, navigationTimeout: 15_000 });

test('grouped matrix grants only selected user operations and revokes them on live sessions', async ({ page, browser, playwright }) => {
  const client = await playwright.request.newContext({ baseURL });
  const restricted = await browser.newContext({ baseURL });
  const restrictedPage = await restricted.newPage();
  const users: User[] = [];
  let grant: PositionGrant | undefined;
  let emptyGrant: PositionGrant | undefined;
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
    grant = await createPositionGrant(client, organizationId, { name: unique('Matrix position'), permissionCodes: [] });
    emptyGrant = await createPositionGrant(client, organizationId, { name: unique('Matrix empty target'), permissionCodes: [] });
    const actor = await createPositionUser(client, organizationId, [grant.position.id], { username: unique('matrix_actor'), initialPassword: secret });
    users.push(actor);
    await uiLogin(restrictedPage, actor.username, secret);
    await restrictedPage.goto('/app/admin');
    await expect(restrictedPage.getByText('无系统管理访问权限')).toBeVisible();

    await uiLogin(page, 'local.internal', internalPassword!);
    await page.goto('/app/admin');
    const matrix = await openPermissions(page, grant);
    const catalog = await positionRead<Schema['PermissionCatalogGroupDto'][]>(page.request, scope('permission-catalog', organizationId));
    // Check the live grant ceiling, including reserved and planned catalog entries.
    for (const group of catalog) {
      for (const module of group.modules) {
        if (group.status === 'planned' || module.status === 'planned') {
          const planned = matrix.getByRole('region', { name: module.name, exact: true });
          await expect(planned.getByText('待接入', { exact: true })).toBeVisible();
          await expect(planned.getByRole('checkbox')).toHaveCount(0);
          continue;
        }
        for (const operation of module.operations) {
          const entry = matrix.locator('.permission-operation').filter({ has: page.getByText(operation.code, { exact: true }) });
          const checkbox = entry.getByRole('checkbox');
          if (operation.grantable) await expect(checkbox).toBeEnabled();
          else await expect(checkbox).toBeDisabled();
          if (operation.enforcement === 'reserved') await expect(entry.getByText('预留权限', { exact: true })).toBeVisible();
        }
      }
    }
    await expect(matrix.getByText('预留权限', { exact: true }).first()).toBeVisible();
    await page.getByLabel('板块筛选', { exact: true }).click();
    await page.locator('.ant-select-item-option').filter({ hasText: '供应商质量' }).click();
    await expect(matrix.getByRole('heading', { name: '供应商质量', exact: true })).toBeVisible();
    await expect(matrix.getByRole('checkbox', { name: '供应商资料 · 查看业务资料', exact: true })).toBeVisible();
    await expect(matrix.getByText('待接入', { exact: true }).first()).toBeVisible();
    const activeModules = new Map([
      ['制程质量', '制程不良品台账 · 查看制程不良品台账'],
      ['客户质量', '客户客诉台账 · 查看客户客诉台账'],
      ['新品质量', '新品质量管理 · 查看新品质量项目'],
      ['审核管理', '审核计划与整改 · 查看审核管理'],
    ]);
    for (const [groupName, checkboxName] of activeModules) {
      await page.getByLabel('板块筛选', { exact: true }).click();
      await page.locator('.ant-select-item-option').filter({ hasText: groupName }).click();
      await expect(matrix.getByRole('heading', { name: groupName, exact: true })).toBeVisible();
      await expect(matrix.getByRole('checkbox', { name: checkboxName, exact: true })).toBeVisible();
      await expect(matrix.getByText('待接入', { exact: true }).first()).toBeVisible();
    }
    await page.getByLabel('板块筛选', { exact: true }).click();
    await page.locator('.ant-select-item-option').filter({ hasText: '系统管理' }).click();
    await expect(matrix.getByRole('heading', { name: '系统管理', exact: true })).toBeVisible();
    const read = matrix.getByRole('checkbox', { name: '用户管理 · 查看用户', exact: true });
    const create = matrix.getByRole('checkbox', { name: '用户管理 · 创建用户', exact: true });
    const update = matrix.getByRole('checkbox', { name: '用户管理 · 编辑姓名、电话和邮箱', exact: true });
    await expect(read).not.toBeChecked();
    await expect(create).not.toBeChecked();
    await expect(update).not.toBeChecked();
    await read.check();
    await create.check();
    const createPermissions = ['account:users:read', 'account:users:create'];
    await savePermissions(page, organizationId, grant, [], createPermissions);

    expect((await restricted.request.get('/api/v1/me')).status()).toBe(401);
    await uiLogin(restrictedPage, actor.username, secret);
    await restrictedPage.goto('/app/admin');
    const previewPath = `/api/v1/organizations/${organizationId}/position-authorization/preview`;
    expect((await write(restricted.request, previewPath, 'POST', { positionIds: [emptyGrant.position.id] })).status()).toBe(403);
    await restrictedPage.getByRole('button', { name: '创建用户', exact: true }).click();
    await expect(restrictedPage.getByText('缺少岗位授权所需权限，无法创建内部账号', { exact: true })).toBeVisible();
    await expect(restrictedPage.getByRole('button', { name: '保存用户', exact: true })).toBeDisabled();
    await restrictedPage.getByRole('dialog').press('Escape');
    const creationPermissions = [...createPermissions, 'organization:structure:read', 'organization:positions:assign', 'account:roles:read', 'account:roles:assign'];
    await changePositionPermissions(client, organizationId, grant.position.id, creationPermissions);
    expect((await restricted.request.get('/api/v1/me')).status()).toBe(401);
    await uiLogin(restrictedPage, actor.username, secret);
    await restrictedPage.goto('/app/admin');
    await restrictedPage.getByRole('button', { name: '创建用户', exact: true }).click();
    const dialog = restrictedPage.getByRole('dialog');
    const username = unique('matrix_created');
    const createdSecret = password();
    await dialog.getByLabel('用户名', { exact: true }).fill(username);
    await fillSecret(dialog.getByLabel('初始密码', { exact: true }), createdSecret);
    await choosePosition(restrictedPage, dialog, emptyGrant.position);
    await confirmPositionPreview(restrictedPage, dialog, organizationId);
    await expect(dialog.getByText('该岗位未配置系统权限', { exact: true })).toBeVisible();
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

    const updatePermissions = [...creationPermissions, 'account:users:update'];
    await changePositionPermissions(client, organizationId, grant.position.id, updatePermissions);
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
    expect(editedResponse.request().postDataJSON()).toEqual({ email, expectedProfileVersion: target.profileVersion });
    expect((await editedResponse.json() as User).email).toBe(email);
    await expect(editor).toHaveCount(0);
    await expect(row.getByRole('button', { name: /^停\s*用$/ })).toHaveCount(0);
    await expect(row.getByRole('button', { name: '签发重置凭证' })).toHaveCount(0);
    expect((await write(restricted.request, scope(`users/${target.id}`, organizationId), 'PATCH', { status: 'DISABLED' })).status()).toBe(403);

    await changePositionPermissions(client, organizationId, grant.position.id, creationPermissions);
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
      await replacePositionAppointments(client, user.organizationId, user.id, []);
      expect((await write(client, scope(`users/${user.id}`, user.organizationId), 'PATCH', { status: 'DISABLED' })).status()).toBe(200);
    }
    if (organizationId) {
      if (grant) await retirePositionGrant(client, organizationId, grant);
      if (emptyGrant) await retirePositionGrant(client, organizationId, emptyGrant);
    }
    await client.dispose();
  }
});
