import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import type { components } from '@qms/contracts';
import { completeMfa } from './mfa-login';
import { fillSecret } from './secret-input';

const baseURL = process.env.QMS_ACCEPTANCE_BASE_URL ?? process.env.PLAYWRIGHT_BASE_URL;
const internalPassword = process.env.QMS_SEED_INTERNAL_PASSWORD;
const databaseURL = process.env.DATABASE_URL;
if (!baseURL || !internalPassword || !databaseURL || !process.env.QMS_ACCEPTANCE_MFA_CACHE_FILE || !process.env.QMS_BACKUP_KEY) {
  throw new Error('Trial summary acceptance requires a real gateway, disposable PostgreSQL, internal account and external MFA credentials; skipping is forbidden.');
}
if (new URL(databaseURL).port === '55440' || process.env.QMS_ACCEPTANCE_DISPOSABLE_DATABASE !== 'true'
  || !['127.0.0.1', 'localhost', '[::1]', '::1'].includes(new URL(databaseURL).hostname)) {
  throw new Error('Trial summary acceptance requires a disposable PostgreSQL database outside the preserved preview port 55440.');
}

const requireApi = createRequire(new URL('../../api/package.json', import.meta.url));
const { PrismaPg } = requireApi('@prisma/adapter-pg');
const { hash } = requireApi('argon2');
const { PrismaClient } = await import('../../api/dist/generated/prisma/client.js');
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseURL }) });
type Schema = components['schemas'];
const unique = (prefix: string) => `${prefix}_${randomUUID().replaceAll('-', '').slice(0, 16)}`;
const authorName = unique('trial_author');
const approverName = unique('trial_approver');
let approverId: string;

test.beforeAll(async () => {
  const suffix = randomUUID().replaceAll('-', '').slice(0, 16);
  const organization = await prisma.organization.create({ data: { code: `NPTS-${suffix}`, name: '试产总结浏览器验收', type: 'INTERNAL' } });
  const role = await prisma.role.create({ data: { organizationId: organization.id, code: 'TRIAL_SUMMARY', name: '试产总结验收角色' } });
  const codes = ['workbench:read', 'new-product-quality:projects:read', 'new-product-quality:projects:write'];
  const permissions = await prisma.permission.findMany({ where: { code: { in: codes } } });
  expect(permissions).toHaveLength(codes.length);
  await prisma.rolePermission.createMany({ data: permissions.map((permission) => ({ roleId: role.id, permissionId: permission.id })) });
  const passwordHash = await hash(internalPassword!);
  for (const username of [authorName, approverName]) {
    const user = await prisma.user.create({ data: { organizationId: organization.id, username, passwordHash, accountType: 'INTERNAL' } });
    await prisma.userRole.create({ data: { organizationId: organization.id, userId: user.id, roleId: role.id } });
    if (username === approverName) approverId = user.id;
  }
});

test.afterAll(async () => prisma.$disconnect());

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

test('creates, submits and independently approves a trial summary with persisted report evidence', async ({ page, playwright }) => {
  await uiLogin(page, authorName, internalPassword!);

  const code = unique('TRIAL');
  const projectResponse = await write(page.request, '/api/v1/new-product-quality/projects', 'POST', { code, name: `试产验收 ${code}`, productCode: 'PART-ACCEPTANCE' } satisfies Schema['CreateNewProductProjectDto']);
  expect(projectResponse.status(), JSON.stringify(await projectResponse.json())).toBe(201);
  const project = await projectResponse.json() as Schema['NewProductProjectDto'];
  const batchCode = unique('RUN');
  const batchResponse = await write(page.request, `/api/v1/new-product-quality/projects/${project.id}/trial-batches`, 'POST', { code: batchCode } satisfies Schema['CreateNewProductTrialBatchDto']);
  expect(batchResponse.status()).toBe(201);
  const batch = await batchResponse.json() as Schema['NewProductTrialBatchDto'];
  const metricResponse = await write(page.request, `/api/v1/new-product-quality/trial-batches/${batch.id}/metrics`, 'POST', { code: 'CPK', target: 1.33, actual: 1.41, comparison: 'GTE', source: 'MANUAL' } satisfies Schema['RecordNewProductMetricDto']);
  expect(metricResponse.status()).toBe(201);
  const riskResponse = await write(page.request, `/api/v1/new-product-quality/projects/${project.id}/legacy-issues`, 'POST', { description: '夹具寿命尚需跟踪', riskLevel: 'HIGH' } satisfies Schema['CreateNewProductLegacyIssueDto']);
  expect(riskResponse.status()).toBe(201);

  await page.goto('/app/new-product-quality');
  await page.getByLabel('新产品项目 ID').fill(project.id);
  await page.getByRole('button', { name: '查看项目' }).click();
  await expect(page.getByText(project.name)).toBeVisible();
  await page.getByRole('button', { name: `查看试产报告 ${batchCode}` }).click();
  const report = page.locator('.new-product-quality-report');
  await expect(report.getByRole('heading', { name: `试产报告 · ${batchCode}` })).toBeVisible();
  await expect(report.getByText('CPK')).toBeVisible();
  await expect(report.getByText('达标')).toBeVisible();
  const conclusion = `工艺能力达到试产目标，夹具寿命风险纳入量产跟踪 ${code}`;
  await report.getByLabel('试产结论').fill(conclusion);
  const creation = page.waitForResponse((response) => response.url().endsWith(`/trial-batches/${batch.id}/summary`) && response.request().method() === 'POST');
  await report.getByRole('button', { name: '创建总结' }).click();
  expect((await creation).status()).toBe(201);
  await expect(report.getByText(conclusion)).toBeVisible();
  await expect(report.getByText('DRAFT')).toBeVisible();
  const submission = page.waitForResponse((response) => response.url().endsWith(`/trial-batches/${batch.id}/summary/submit`) && response.request().method() === 'PUT');
  await report.getByRole('button', { name: '提交审批' }).click();
  expect((await submission).status()).toBe(200);
  await expect(report.getByText('SUBMITTED')).toBeVisible();

  const summaryPath = `/api/v1/new-product-quality/trial-batches/${batch.id}/summary`;
  const storedResponse = await page.request.get(summaryPath);
  expect(storedResponse.status()).toBe(200);
  const stored = await storedResponse.json() as Schema['NewProductTrialSummaryDto'];
  expect(stored).toMatchObject({ status: 'SUBMITTED', conclusion, version: 2, metricSnapshot: [expect.objectContaining({ code: 'CPK', actual: 1.41, signal: 'GREEN' })], issueSnapshot: [expect.objectContaining({ description: '夹具寿命尚需跟踪' })] });
  expect(stored.sourceSha256).toMatch(/^[a-f0-9]{64}$/);
  const selfDecision = await write(page.request, `${summaryPath}/decision`, 'PUT', { expectedVersion: stored.version, decision: 'APPROVE', note: '应被拒绝' } satisfies Schema['DecideNewProductTrialSummaryDto']);
  expect(selfDecision.status()).toBe(409);

  const reviewer = await playwright.request.newContext({ baseURL });
  try {
    const login = await write(reviewer, '/api/v1/auth/login', 'POST', { identifier: approverName, password: internalPassword! } satisfies Schema['LoginDto']);
    await completeMfa(reviewer, login, approverName);
    const approval = await write(reviewer, `${summaryPath}/decision`, 'PUT', { expectedVersion: stored.version, decision: 'APPROVE', note: '独立审批通过，风险继续跟踪' } satisfies Schema['DecideNewProductTrialSummaryDto']);
    expect(approval.status(), JSON.stringify(await approval.json())).toBe(200);
    const approved = await approval.json() as Schema['NewProductTrialSummaryDto'];
    expect(approved).toMatchObject({ status: 'APPROVED', version: 3, approvedById: approverId, sourceSha256: stored.sourceSha256 });

    await page.reload();
    await page.getByLabel('新产品项目 ID').fill(project.id);
    await page.getByRole('button', { name: '查看项目' }).click();
    await page.getByRole('button', { name: `查看试产报告 ${batchCode}` }).click();
    await expect(report.locator('.ant-descriptions-item-content').filter({ hasText: conclusion })).toBeVisible();
    await expect(report.getByText('APPROVED')).toBeVisible();
    await expect(report.getByText(stored.sourceSha256!)).toBeVisible();
    await expect(report.getByRole('button', { name: '创建总结' })).toHaveCount(0);
    await expect(report.getByRole('button', { name: '提交审批' })).toHaveCount(0);
    const persisted = await page.request.get(summaryPath);
    expect(persisted.status()).toBe(200);
    expect(await persisted.json()).toMatchObject({ id: stored.id, status: 'APPROVED', approvedById: approverId, sourceSha256: stored.sourceSha256 });
  } finally {
    await reviewer.dispose();
  }
});
