import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import type { components } from '@qms/contracts';
import { completeMfa } from './mfa-login';
import { fillSecret } from './secret-input';
import { mailCredential } from '../playwright-security/mail-credential.mjs';

type Schema = components['schemas'];
const baseURL = process.env.QMS_ACCEPTANCE_BASE_URL;
if (!baseURL || !process.env.QMS_SEED_INTERNAL_PASSWORD || !process.env.DATABASE_URL) throw new Error('Real disposable gateway, PostgreSQL and credentials are required');
const unique = () => randomUUID().replaceAll('-', '').slice(0, 20);
async function write(client: APIRequestContext, path: string, method: string, data?: object) {
  const csrf = await client.get('/api/v1/auth/csrf'); expect(csrf.status()).toBe(200);
  return client.fetch(`/api/v1/${path}`, { method, headers: { 'x-csrf-token': (await csrf.json()).csrfToken, 'Idempotency-Key': randomUUID() }, data });
}
async function login(page: Page, identifier: string, password: string) {
  await page.goto('/login'); await page.getByLabel('账号', { exact: true }).fill(identifier);
  await fillSecret(page.getByLabel('密码', { exact: true }), password);
  const response = page.waitForResponse((entry) => entry.url().endsWith('/auth/login'));
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await completeMfa(page.request, await response, identifier, page);
  await expect(page).toHaveURL(/\/app\/workbench$/);
}
async function admin(client: APIRequestContext) {
  await completeMfa(client, await write(client, 'auth/login', 'POST', { identifier: 'local.internal', password: process.env.QMS_SEED_INTERNAL_PASSWORD }), 'local.internal');
  const response = await client.get('/api/v1/admin/organizations'); expect(response.status()).toBe(200);
  const organizations = await response.json() as Schema['AdminOrganizationDto'][];
  const organization = organizations.find((entry) => entry.type === 'INTERNAL' && entry.permissions.includes('configuration:manage'));
  expect(Boolean(organization)).toBe(true); return organization!;
}
async function saveDialog(page: Page, urlPart: string) {
  const result = page.waitForResponse((entry) => entry.url().includes(urlPart) && entry.request().method() === 'POST');
  await page.getByRole('dialog').getByRole('button', { name: /^保\s*存$/ }).click();
  const response = await result; expect(response.status()).toBe(201);
  await expect(page.getByRole('dialog')).toHaveCount(0); return response.json();
}
test.setTimeout(120000);

test('D/F/H real configuration, position hierarchy, audit export and language navigation', async ({ page }) => {
  page.setDefaultTimeout(10000);
  await login(page, 'local.internal', process.env.QMS_SEED_INTERNAL_PASSWORD!);
  const response = await page.request.get('/api/v1/admin/organizations');
  const organization = (await response.json() as Schema['AdminOrganizationDto'][]).find((entry) => entry.type === 'INTERNAL' && entry.permissions.includes('configuration:manage'))!;
  const settingsPath = `admin/configuration/settings?organizationId=${organization.id}`;
  const original = await (await page.request.get(`/api/v1/${settingsPath}`)).json() as Schema['PlatformSettingsDto'];
  try {
    await page.goto('/app/admin'); await page.getByRole('tab', { name: '平台配置', exact: true }).click();
    await page.getByLabel('导出保留时间（分钟）').fill('31');
    const saved = page.waitForResponse((entry) => entry.url().includes('/configuration/settings?') && entry.request().method() === 'PATCH');
    await page.getByRole('tabpanel', { name: '平台配置', exact: true }).getByRole('button', { name: /^保\s*存$/ }).click();
    expect((await saved).status()).toBe(200);
    const categoryName = `Category ${unique()}`;
    await page.getByRole('button', { name: /^新\s*建$/ }).click();
    await page.getByRole('dialog').getByLabel('代码', { exact: true }).fill(`CAT_${unique()}`);
    await page.getByRole('dialog').getByLabel('名称', { exact: true }).fill(categoryName);
    await saveDialog(page, '/configuration/position-categories?');
    await expect(page.getByText(categoryName, { exact: true })).toBeVisible();
    await page.getByRole('tab', { name: '部门岗位', exact: true }).click();
    await page.getByRole('tabpanel', { name: '部门', exact: true }).getByRole('button', { name: /^新\s*建$/ }).click();
    const departmentName = `Department ${unique()}`;
    await page.getByRole('dialog').getByLabel('代码', { exact: true }).fill(`DEP_${unique()}`);
    await page.getByRole('dialog').getByLabel('名称', { exact: true }).fill(departmentName);
    const department = await saveDialog(page, '/departments') as Schema['DepartmentDto'];
    await page.getByRole('tab', { name: '岗位', exact: true }).click();
    await page.getByRole('tabpanel', { name: '岗位', exact: true }).getByRole('button', { name: /^新\s*建$/ }).click();
    await page.getByRole('dialog').getByLabel('代码', { exact: true }).fill(`POS_${unique()}`);
    await page.getByRole('dialog').getByLabel('名称', { exact: true }).fill(`Position ${unique()}`);
    await page.getByRole('dialog').getByLabel('部门', { exact: true }).click();
    await page.locator('.ant-select-item-option').filter({ hasText: departmentName }).click();
    await page.getByRole('dialog').getByLabel('岗位类别', { exact: true }).click();
    await page.locator('.ant-select-item-option').filter({ hasText: categoryName }).click();
    const position = await saveDialog(page, '/positions') as Schema['PositionDto']; expect(position.departmentId).toBe(department.id);
    await page.getByRole('tab', { name: '管理审计', exact: true }).click();
    await page.getByLabel('资源 ID', { exact: true }).fill(department.id);
    const filtered = page.waitForResponse((entry) => entry.url().includes('/audit-events?') && entry.url().includes(department.id));
    await page.getByRole('button', { name: /^查\s*询$/ }).click(); expect((await filtered).status()).toBe(200);
    await page.getByRole('button', { name: '导出筛选结果', exact: true }).click();
    const download = page.waitForEvent('download'); await page.getByRole('button', { name: '下载 CSV', exact: true }).click();
    const stream = await (await download).createReadStream(); expect(Boolean(stream)).toBe(true);
    const bytes: Buffer[] = []; for await (const chunk of stream!) bytes.push(Buffer.from(chunk));
    const csv = Buffer.concat(bytes).toString(); expect(csv).toContain(department.id); expect(csv).not.toMatch(/passwordHash|encryptedSecret|tokenHash/);
    await page.getByLabel('Language / 语言').selectOption('en-US');
    await expect(page.getByRole('tab', { name: 'Audit log', exact: true })).toBeVisible();
    await page.getByRole('tab', { name: 'Users', exact: true }).click(); await expect(page.getByRole('button', { name: 'Create user', exact: true })).toBeVisible();
    await page.getByLabel('Language / 语言').selectOption('zh-CN');
  } finally {
    const current = await (await page.request.get(`/api/v1/${settingsPath}`)).json() as Schema['PlatformSettingsDto'];
    expect((await write(page.request, settingsPath, 'PATCH', { notificationLocale: original.notificationLocale, exportRetentionMinutes: original.exportRetentionMinutes, expectedVersion: current.version })).status()).toBe(200);
  }
});

async function mailToken(email: string, subject: string) {
  const run = spawnSync(process.execPath, ['dist/worker.js', '--once'], { cwd: resolve(process.cwd(), '../api'), env: { ...process.env, QMS_RECOVERY_MAIL_ENABLED: 'true' }, encoding: 'utf8', timeout: 30000, windowsHide: true });
  expect(run.status).toBe(0);
  const endpoint = process.env.QMS_ACCEPTANCE_MAILPIT_URL;
  if (!endpoint || new URL(endpoint).hostname !== '127.0.0.1') throw new Error('Owned Mailpit receiver is required');
  const messages = await (await fetch(`${endpoint}/api/v1/messages`)).json() as { messages: { ID: string; Subject: string; To: { Address: string }[] }[] };
  const message = messages.messages.find((entry) => entry.Subject === subject && entry.To.some((recipient) => recipient.Address === email));
  expect(Boolean(message)).toBe(true);
  const body = await (await fetch(`${endpoint}/api/v1/message/${message!.ID}`)).json() as { Text: string };
  return mailCredential(body.Text);
}

test('E real MFA enrollment, verified email and SMTP password recovery preserve MFA', async ({ page, playwright }) => {
  const client = await playwright.request.newContext({ baseURL }); const organization = await admin(client);
  const username = `mail_${unique()}`; const email = `${username}@example.test`; const password = `${randomUUID()}Aa9!`;
  let user: Schema['AdminUserDto'] | undefined; let role: Schema['AdminRoleDto'] | undefined;
  try {
    const created = await write(client, 'admin/users', 'POST', { username, email, initialPassword: password, organizationId: organization.id, accountType: 'INTERNAL' }); expect(created.status()).toBe(201); user = await created.json();
    const roleResponse = await write(client, 'admin/roles', 'POST', { organizationId: organization.id, code: `MAIL_${unique()}`, name: username, mfaRequired: true, permissionCodes: [] }); expect(roleResponse.status()).toBe(201); role = await roleResponse.json();
    expect((await write(client, `admin/users/${user!.id}/roles?organizationId=${organization.id}`, 'PUT', { roleIds: [role!.id] })).status()).toBe(200);
    await login(page, username, password); await page.goto('/mfa');
    const requested = page.waitForResponse((entry) => entry.url().endsWith('/me/email-verification'));
    await page.getByRole('button', { name: '发送确认邮件', exact: true }).click(); expect((await requested).status()).toBe(202);
    await fillSecret(page.getByLabel('邮件凭证', { exact: true }), await mailToken(email, 'QMS 邮箱确认'));
    await page.getByRole('button', { name: '确认邮箱', exact: true }).click(); await expect(page.getByText('邮箱已确认', { exact: true }).first()).toBeVisible();
    expect((await write(page.request, 'auth/logout', 'POST')).status()).toBe(204);
    await page.goto('/password-recovery'); await page.getByLabel('账号或邮箱', { exact: true }).fill(username);
    const recovery = page.waitForResponse((entry) => entry.url().endsWith('/auth/password-recovery'));
    await page.getByRole('button', { name: '发送找回邮件', exact: true }).click(); expect((await recovery).status()).toBe(202);
    const token = await mailToken(email, 'QMS 密码找回');
    await page.getByRole('tab', { name: '使用邮件凭证', exact: true }).click(); await fillSecret(page.getByLabel('邮件凭证', { exact: true }), token);
    const replacement = `${randomUUID()}Bb8!`; await fillSecret(page.getByLabel('新密码', { exact: true }), replacement);
    await page.getByRole('button', { name: '重置密码', exact: true }).click(); await expect(page.getByText('密码已重置，请重新登录', { exact: true })).toBeVisible();
    await login(page, username, replacement);
    const status = await page.request.get('/api/v1/me/security'); expect(status.status()).toBe(200); expect((await status.json()).mfaEnabled).toBe(true);
    expect((await write(page.request, 'auth/password-recovery/complete', 'POST', { token, newPassword: `${randomUUID()}Cc7!` })).status()).toBe(400);
  } finally {
    if (user) { await write(client, `admin/users/${user.id}/roles?organizationId=${organization.id}`, 'PUT', { roleIds: [] }); await write(client, `admin/users/${user.id}?organizationId=${organization.id}`, 'PATCH', { status: 'DISABLED' }); }
    if (role) await write(client, `admin/roles/${role.id}?organizationId=${organization.id}`, 'DELETE'); await client.dispose();
  }
});
