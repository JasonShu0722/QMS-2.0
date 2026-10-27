import { randomUUID } from 'node:crypto';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import type { components } from '@qms/contracts';
import { completeMfa } from './mfa-login';
import { fillSecret } from './secret-input';
import { createPositionGrant, createPositionUser, positionWrite, replacePositionAppointments, retirePositionGrant, type PositionGrant } from './position-fixture';

const baseURL = process.env.QMS_ACCEPTANCE_BASE_URL ?? process.env.PLAYWRIGHT_BASE_URL;
const internalPassword = process.env.QMS_SEED_INTERNAL_PASSWORD;
const databaseURL = process.env.DATABASE_URL;
if (!baseURL || !internalPassword || !databaseURL || process.env.QMS_ACCEPTANCE_DISPOSABLE_DATABASE !== 'true' || new URL(databaseURL).port === '55440') {
  throw new Error('Customer complaint processing acceptance requires a real disposable gateway, PostgreSQL and internal credentials');
}

type Schema = components['schemas'];
const unique = (prefix: string) => `${prefix}_${randomUUID().replaceAll('-', '').slice(0, 16)}`;

async function write(client: APIRequestContext, path: string, method: 'POST' | 'PUT', data: object) {
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

test.setTimeout(120_000);

test('registers, processes, independently closes and archives a complaint through the gateway', async ({ page, browser }) => {
  await uiLogin(page, 'local.internal', internalPassword!);
  const session = await page.request.get('/api/v1/auth/session');
  expect(session.status()).toBe(200);
  const currentUser = (await session.json() as Schema['SessionResponseDto']).user;
  const customerResponse = await write(page.request, '/api/v1/customer-quality/customers', 'POST', { code: unique('D2C'), name: 'D2 验收客户' } satisfies Schema['CreateCustomerDto']);
  expect(customerResponse.status(), JSON.stringify(await customerResponse.json())).toBe(201);
  const customer = await customerResponse.json() as Schema['CustomerMasterDto'];
  const departmentName = unique('D2 验收部门');
  const departmentResponse = await write(page.request, `/api/v1/organizations/${currentUser.organizationId}/departments`, 'POST', { code: unique('D2_DEP'), name: departmentName } satisfies Schema['CreateDepartmentDto']);
  expect(departmentResponse.status(), JSON.stringify(await departmentResponse.json())).toBe(201);
  const available = await page.request.get('/api/v1/customer-quality/complaints/assignees');
  expect(available.status()).toBe(200);
  const assignees = await available.json() as Schema['CustomerComplaintAssigneesDto'];
  expect(assignees.departments.some((department) => department.name === departmentName)).toBe(true);
  expect(assignees.users.some((user) => user.id === currentUser.id)).toBe(true);

  await page.goto('/app/customer-quality');
  await page.getByRole('button', { name: '历史台账', exact: true }).click();
  await page.getByRole('button', { name: '人工登记客诉' }).click();
  await page.getByLabel('登记客户').click();
  await page.getByText(`${customer.code} · ${customer.name}`).click();
  const description = `D2 真实浏览器样件异常 ${unique('sample')}`;
  await page.getByLabel('不良描述').fill(description);
  await page.getByLabel('严重度策略版本').fill('acceptance-1');
  await page.getByLabel('严重度策略快照 JSON').fill('{"level":"LOW","policyVersion":"acceptance-1"}');
  await page.getByRole('button', { name: '登 记' }).click();
  const detail = page.getByRole('heading', { name: '客诉详情' }).locator('..');
  await expect(detail.getByText(description)).toBeVisible();
  const complaintNumber = await detail.locator('.ant-descriptions-item-content').first().textContent();
  expect(complaintNumber).toMatch(/^CQ-/);

  await page.getByLabel('责任部门').click();
  await page.getByText(departmentName, { exact: true }).last().click();
  await page.getByLabel('经办人').click();
  await page.getByText(assignees.users.find((user) => user.id === currentUser.id)!.username, { exact: true }).last().click();
  await page.getByLabel('处理说明').fill('质量部接收');
  await page.getByRole('button', { name: '分诊或改派' }).click();
  await expect(page.getByText('IN_ANALYSIS').first()).toBeVisible();
  await page.getByLabel('处理说明').fill('样件已确认');
  await page.getByRole('button', { name: '记录进展' }).click();
  await expect(page.getByText(/PROGRESS_RECORDED.*样件已确认/)).toBeVisible();
  await page.getByLabel('处理说明').fill('换件并确认客户反馈');
  await page.getByRole('button', { name: '标记解决' }).click();
  await expect(page.getByText('RESOLVED').first()).toBeVisible();
  await page.getByLabel('处理说明').fill('复核完成');
  await page.getByRole('button', { name: '复核关闭' }).click();
  await expect(page.getByText('RESOLVED').first()).toBeVisible();

  const reviewerName = unique('d2_reviewer');
  const reviewerPassword = `${randomUUID()}Aa9!`;
  let grant: PositionGrant | undefined;
  let reviewer: Schema['AdminUserDto'] | undefined;

  const reviewerContext = await browser.newContext({ baseURL });
  try {
    grant = await createPositionGrant(page.request, currentUser.organizationId, { name: 'D2 验收复核', permissionCodes: ['workbench:read', 'customer-quality:complaints:read', 'customer-quality:complaints:write'] });
    reviewer = await createPositionUser(page.request, currentUser.organizationId, [grant.position.id], { username: reviewerName, initialPassword: reviewerPassword });
    const reviewerPage = await reviewerContext.newPage();
    await uiLogin(reviewerPage, reviewerName, reviewerPassword);
    await reviewerPage.goto('/app/customer-quality');
    await reviewerPage.getByRole('button', { name: '历史台账', exact: true }).click();
    await reviewerPage.getByRole('button', { name: complaintNumber! }).click();
    await reviewerPage.getByLabel('处理说明').fill('独立复核通过');
    const closing = reviewerPage.waitForResponse((response) => response.url().endsWith('/close') && response.request().method() === 'PUT');
    await reviewerPage.getByRole('button', { name: '复核关闭' }).click();
    expect((await closing).status()).toBe(200);
    await reviewerPage.reload();
    await reviewerPage.getByRole('button', { name: '历史台账', exact: true }).click();
    await reviewerPage.getByRole('button', { name: complaintNumber! }).click();
    await expect(reviewerPage.getByRole('button', { name: /归\s*档/ })).toBeVisible();
    const archiving = reviewerPage.waitForResponse((response) => response.url().endsWith('/archive') && response.request().method() === 'PUT');
    await reviewerPage.getByRole('button', { name: /归\s*档/ }).click();
    expect((await archiving).status()).toBe(200);
  } finally {
    try {
      if (reviewer) {
        await replacePositionAppointments(page.request, currentUser.organizationId, reviewer.id, []);
        await positionWrite(page.request, `/api/v1/admin/users/${reviewer.id}?organizationId=${currentUser.organizationId}`, 'PATCH', { status: 'DISABLED' });
      }
      if (grant) await retirePositionGrant(page.request, currentUser.organizationId, grant);
    } finally { await reviewerContext.close(); }
  }
});
