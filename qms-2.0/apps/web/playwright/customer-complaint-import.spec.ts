import { randomUUID } from 'node:crypto';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import type { components } from '@qms/contracts';
import ExcelJS from 'exceljs';
import { completeMfa } from './mfa-login';
import { fillSecret } from './secret-input';

const baseURL = process.env.QMS_ACCEPTANCE_BASE_URL ?? process.env.PLAYWRIGHT_BASE_URL;
const internalPassword = process.env.QMS_SEED_INTERNAL_PASSWORD;
const databaseURL = process.env.DATABASE_URL;
if (!baseURL || !internalPassword || !databaseURL || !process.env.QMS_ACCEPTANCE_MFA_CACHE_FILE || !process.env.QMS_BACKUP_KEY) {
  throw new Error('Complaint import acceptance requires a real gateway, disposable PostgreSQL, internal seed password and external MFA credentials; skipping is forbidden.');
}
if (new URL(databaseURL).port === '55440') throw new Error('Complaint import acceptance must not use the preserved preview PostgreSQL on port 55440.');

type Schema = components['schemas'];
type WriteBody = Schema['LoginDto'] | Schema['CreateCustomerDto'] | Schema['CreateAdminUserDto'] | Schema['CreateAdminRoleDto'] | Schema['AssignAdminRolesDto'];
const unique = (prefix: string) => `${prefix}_${randomUUID().replaceAll('-', '').slice(0, 16)}`;

async function write(client: APIRequestContext, path: string, method: string, data: WriteBody) {
  const protection = await client.get('/api/v1/auth/csrf');
  expect(protection.status()).toBe(200);
  const { csrfToken } = await protection.json() as Schema['CsrfResponseDto'];
  return client.fetch(path, { method, headers: { 'x-csrf-token': csrfToken, 'Idempotency-Key': randomUUID() }, data });
}

async function uiLogin(page: Page, identifier: string, password: string) {
  await page.goto('/login');
  await page.getByLabel('账号', { exact: true }).fill(identifier);
  await fillSecret(page.getByLabel('密码', { exact: true }), password);
  const pending = page.waitForResponse((response) => response.url().endsWith('/api/v1/auth/login'));
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await completeMfa(page.request, await pending, identifier, page);
  await expect(page).toHaveURL(/\/app\/workbench$/);
}

async function workbook(customerId: string, recordKey: string, observedAt: string) {
  const document = new ExcelJS.Workbook();
  const sheet = document.addWorksheet('客诉');
  sheet.addRow(['customerId', 'complaintType', 'defectDescription', 'severity', 'severityPolicyVersion', 'severitySnapshot', 'externalSourceSystem', 'externalRecordKey', 'sourceObservedAt']);
  sheet.addRow([customerId, 'ZERO_KM', '真实浏览器 Excel 导入验收', 'LOW', 'policy-1', '{"level":"LOW","policyVersion":"policy-1"}', 'IMS', recordKey, observedAt]);
  return { name: 'customer-complaints.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: Buffer.from(await document.xlsx.writeBuffer()) };
}

test.setTimeout(120_000);

test('previews Excel errors and creates a complaint with a row result through the gateway', async ({ page }) => {
  await uiLogin(page, 'local.internal', internalPassword!);
  const code = unique('complaint_customer');
  const created = await write(page.request, '/api/v1/customer-quality/customers', 'POST', { code, name: `验收客户 ${code}` });
  expect(created.status(), JSON.stringify(await created.json())).toBe(201);
  const customer = await created.json() as Schema['CustomerMasterDto'];
  const recordKey = unique('complaint_source');

  await page.goto('/app/customer-quality');
  const section = page.locator('.customer-quality-import');
  await expect(section.getByRole('heading', { name: 'Excel 批量导入' })).toBeVisible();
  const picker = section.getByLabel('选择客诉 Excel 文件');
  await picker.setInputFiles(await workbook(customer.id, recordKey, '2026-09-25'));
  await expect(section.getByText('第 2 行 sourceObservedAt：需要带时区的 ISO 日期时间')).toBeVisible();
  await expect(section.getByRole('button', { name: '导入 1 条' })).toBeDisabled();

  await picker.setInputFiles(await workbook(customer.id, recordKey, '2026-09-25T02:00:00Z'));
  await expect(section.getByText('当前文件：customer-complaints.xlsx；数据行：1')).toBeVisible();
  await expect(section.getByText('第 2 行 sourceObservedAt：需要带时区的 ISO 日期时间')).toHaveCount(0);
  await expect(section.getByRole('table').first().getByRole('row').filter({ hasText: '真实浏览器 Excel 导入验收' })).toHaveCount(1);

  const pending = page.waitForResponse((response) => response.url().endsWith('/api/v1/customer-quality/complaints/import') && response.request().method() === 'POST');
  await section.getByRole('button', { name: '导入 1 条' }).click();
  const response = await pending;
  expect(response.status()).toBe(201);
  const body = response.request().postDataJSON() as Schema['ImportCustomerComplaintsDto'];
  expect(body.rows).toMatchObject([{ rowNumber: 2, customerId: customer.id, externalRecordKey: recordKey }]);
  const result = await response.json() as Schema['CustomerComplaintImportResultDto'];
  expect(result).toMatchObject({ created: 1, duplicates: 0, rejected: 0, items: [{ rowNumber: 2, status: 'CREATED', errorCode: null }] });
  expect(typeof result.items[0]?.complaintNumber).toBe('string');
  const complaintNumber = String(result.items[0]!.complaintNumber);
  expect(complaintNumber).toMatch(/^CQ-/);
  await expect(section.getByText('已创建 1 条，重复 0 条，拒绝 0 条。')).toBeVisible();
  await expect(section.getByRole('row').filter({ hasText: complaintNumber })).toHaveCount(1);
  await expect(page.getByRole('button', { name: complaintNumber })).toBeVisible();
});

test('hides Excel import from a business role with complaint read access only', async ({ browser, playwright }) => {
  const admin = await playwright.request.newContext({ baseURL });
  const reader = await browser.newContext({ baseURL });
  try {
    const login = await write(admin, '/api/v1/auth/login', 'POST', { identifier: 'local.internal', password: internalPassword! });
    await completeMfa(admin, login, 'local.internal');
    const session = await admin.get('/api/v1/auth/session');
    expect(session.status()).toBe(200);
    const organizationId = (await session.json() as Schema['SessionResponseDto']).user.organizationId;
    const roleResponse = await write(admin, '/api/v1/admin/roles', 'POST', { organizationId, code: unique('complaint_reader'), name: '客诉只读验收', permissionCodes: ['customer-quality:complaints:read'] });
    expect(roleResponse.status(), JSON.stringify(await roleResponse.json())).toBe(201);
    const role = await roleResponse.json() as Schema['AdminRoleDto'];
    const username = unique('complaint_reader');
    const password = `${randomUUID()}Aa9!`;
    const userResponse = await write(admin, '/api/v1/admin/users', 'POST', { username, initialPassword: password, organizationId, accountType: 'INTERNAL' });
    expect(userResponse.status()).toBe(201);
    const user = await userResponse.json() as Schema['AdminUserDto'];
    expect((await write(admin, `/api/v1/admin/users/${user.id}/roles?organizationId=${organizationId}`, 'PUT', { roleIds: [role.id] })).status()).toBe(200);

    const page = await reader.newPage();
    await uiLogin(page, username, password);
    await page.goto('/app/customer-quality');
    await expect(page.getByRole('heading', { name: '客诉台账' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Excel 批量导入' })).toHaveCount(0);
    await expect(page.getByLabel('选择客诉 Excel 文件')).toHaveCount(0);
  } finally {
    await reader.close();
    await admin.dispose();
  }
});
