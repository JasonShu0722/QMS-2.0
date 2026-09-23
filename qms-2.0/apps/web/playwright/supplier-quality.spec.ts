import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { expect, test, type Page } from '@playwright/test';
import { fillSecret } from './secret-input';

const databaseUrl = process.env.DATABASE_URL;
const password = process.env.QMS_SEED_INTERNAL_PASSWORD;
const baseURL = process.env.QMS_ACCEPTANCE_BASE_URL ?? process.env.PLAYWRIGHT_BASE_URL;
if (!databaseUrl || !password || !baseURL || process.env.QMS_SUPPLIER_E2E_DISPOSABLE !== 'true'
  || new URL(databaseUrl).port === '55440' || !new URL(databaseUrl).pathname.includes('supplier')) {
  throw new Error('Supplier browser tests require an explicitly disposable supplier PostgreSQL database, a live URL and a password; skipping is forbidden.');
}
const requireApi = createRequire(new URL('../../api/package.json', import.meta.url));
const { PrismaPg } = requireApi('@prisma/adapter-pg');
const { hash } = requireApi('argon2');
const { PrismaClient } = await import('../../api/dist/generated/prisma/client.js');
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
const suffix = randomUUID();
const organizations: string[] = [];
const usernames: string[] = [];

test.beforeAll(async () => {
  const passwordHash = await hash(password);
  for (const [index, type] of (['INTERNAL', 'SUPPLIER', 'SUPPLIER'] as const).entries()) {
    const organization = await prisma.organization.create({ data: { code: `BROWSER-${index}-${suffix}`, name: `浏览器验证企业 ${index}`, type } });
    organizations.push(organization.id);
    const username = `sq-browser-${index}-${suffix}`;
    usernames.push(username);
    const user = await prisma.user.create({ data: { username, passwordHash, accountType: type, organizationId: organization.id } });
    const role = await prisma.role.create({ data: { code: 'SQ_BROWSER', name: '供应商浏览器验证', organizationId: organization.id } });
    const grants = await prisma.permission.findMany({ where: { code: { startsWith: 'supplier-quality:' } } });
    expect(grants).toHaveLength(6);
    await prisma.rolePermission.createMany({ data: grants.map((permission) => ({ roleId: role.id, permissionId: permission.id })) });
    await prisma.userRole.create({ data: { userId: user.id, roleId: role.id, organizationId: organization.id } });
  }
});

test.afterAll(async () => {
  try {
    await prisma.supplierQualityProblem.deleteMany({ where: { ownerOrganizationId: { in: organizations } } });
    await prisma.supplierBusinessProfile.deleteMany({ where: { ownerOrganizationId: { in: organizations } } });
    await prisma.problemIndex.deleteMany({ where: { organizationId: { in: organizations } } });
    await prisma.auditEvent.deleteMany({ where: { organizationId: { in: organizations } } });
    await prisma.user.deleteMany({ where: { organizationId: { in: organizations } } });
    await prisma.organization.deleteMany({ where: { id: { in: organizations } } });
  } finally { await prisma.$disconnect(); }
});

async function login(page: Page, index: number) {
  await page.goto('/login');
  await page.getByLabel('账号', { exact: true }).fill(usernames[index]!);
  await fillSecret(page.getByLabel('密码', { exact: true }), password!);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(index === 0 ? '/app/workbench$' : '/supplier/inbox$'));
}

async function select(page: Page, label: string, option: string) {
  const input = page.getByLabel(label, { exact: true });
  await input.click();
  if (label === '供应商企业' || label === '责任供应商') await input.fill(option);
  await page.locator('.ant-select-dropdown:visible .ant-select-item-option-content').filter({ hasText: option }).click();
}

test('internal draft forms and supplier replies use live HTTP with isolated fixture release', async ({ page, browser }) => {
  test.setTimeout(120000);
  await login(page, 0);
  await page.goto('/app/supplier-quality/profiles');
  await select(page, '供应商企业', `BROWSER-1-${suffix}`);
  await page.getByLabel('业务编码', { exact: true }).fill('SQ-BROWSER-001');
  await page.getByLabel('联系人', { exact: true }).fill('测试联系人');
  await page.getByRole('button', { name: '登记供应商', exact: true }).click();
  await expect(page.getByRole('cell', { name: 'SQ-BROWSER-001', exact: true })).toBeVisible();
  await page.goto('/app/supplier-quality/new');
  await page.getByLabel('问题标题', { exact: true }).fill('浏览器来料质量验证');
  await select(page, '责任供应商', 'SQ-BROWSER-001');
  await page.getByLabel('物料号', { exact: true }).fill('MAT-BROWSER');
  await page.getByLabel('不良数量', { exact: true }).fill('12');
  await select(page, '严重度', '高');
  await select(page, '回复形式', '简报');
  await page.getByLabel('不良描述', { exact: true }).fill('测试夹具：端子表面氧化');
  await page.getByRole('button', { name: '保存问题草稿', exact: true }).click();
  await expect(page).toHaveURL(/\/app\/supplier-quality\/problems\/[0-9a-f-]+$/);
  const problemId = new URL(page.url()).pathname.split('/').at(-1)!;
  await expect(page.getByRole('button', { name: '正式发单暂未开放' })).toBeDisabled();
  await page.getByLabel('问题标题', { exact: true }).fill('浏览器来料质量验证（已修改）');
  await page.getByRole('button', { name: '保存问题草稿', exact: true }).click();
  await expect(page.getByText('草稿已保存', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('问题标题', { exact: true })).toHaveValue('浏览器来料质量验证（已修改）');
  expect(await prisma.problemIndex.count({ where: { sourceId: problemId } })).toBe(0);

  const supplierContext = await browser.newContext({ baseURL });
  const otherContext = await browser.newContext({ baseURL });
  try {
    const supplierPage = await supplierContext.newPage();
    await login(supplierPage, 1);
    await supplierPage.goto('/supplier/corrections');
    await expect(supplierPage.getByText('尚未收到问题单', { exact: true })).toBeVisible();
    const index = await prisma.problemIndex.create({ data: { organizationId: organizations[0]!, reportNumber: `FIXTURE-${suffix}`, domainCode: 'supplier-quality', problemType: 'MATERIAL', sourceType: 'supplier-quality', sourceId: problemId, severity: 'HIGH' } });
    await prisma.supplierQualityProblem.update({ where: { id: problemId }, data: { problemIndexId: index.id, releasedToSupplierAt: new Date() } });
    await supplierPage.reload();
    await supplierPage.getByRole('link', { name: '浏览器来料质量验证（已修改）' }).click();
    await expect(supplierPage.getByRole('button', { name: '提交回复暂未开放' })).toBeDisabled();
    await expect(supplierPage.getByRole('button', { name: '证据上传暂未开放' })).toBeDisabled();
    await supplierPage.getByLabel('根本原因', { exact: true }).fill('测试夹具：包装密封不足');
    await supplierPage.getByLabel('纠正措施', { exact: true }).fill('测试夹具：更换密封包装');
    await supplierPage.getByLabel('完成时间', { exact: true }).fill('2026-09-21T17:30');
    await supplierPage.getByRole('button', { name: '保存回复草稿', exact: true }).click();
    await expect(supplierPage.getByText('草稿已保存', { exact: true })).toBeVisible();
    await supplierPage.reload();
    await expect(supplierPage.getByLabel('根本原因', { exact: true })).toHaveValue('测试夹具：包装密封不足');
    await expect(supplierPage.getByLabel('完成时间', { exact: true })).toHaveValue(/^2026-09-21T17:30/);
    if (process.env.QMS_SUPPLIER_SCREENSHOT) await supplierPage.screenshot({ path: process.env.QMS_SUPPLIER_SCREENSHOT, fullPage: true });

    const secondPage = await supplierContext.newPage();
    await secondPage.goto(supplierPage.url());
    await expect(secondPage.getByLabel('根本原因', { exact: true })).toHaveValue('测试夹具：包装密封不足');
    await supplierPage.getByLabel('根本原因', { exact: true }).fill('先保存的版本');
    await supplierPage.getByRole('button', { name: '保存回复草稿', exact: true }).click();
    await expect(supplierPage.getByText('草稿已保存', { exact: true })).toBeVisible();
    await secondPage.getByLabel('根本原因', { exact: true }).fill('需要保留的冲突输入');
    await secondPage.getByRole('button', { name: '保存回复草稿', exact: true }).click();
    await expect(secondPage.getByText(/内容已被其他人修改/)).toBeVisible();
    await expect(secondPage.getByLabel('根本原因', { exact: true })).toHaveValue('需要保留的冲突输入');
    const otherPage = await otherContext.newPage();
    await login(otherPage, 2);
    await otherPage.goto(supplierPage.url());
    await expect(otherPage.getByText('记录不存在或当前账号无权查看', { exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByLabel('根本原因', { exact: true })).toHaveValue('先保存的版本');
    await expect(page.getByRole('button', { name: '保存回复草稿', exact: true })).toHaveCount(0);
  } finally { await supplierContext.close(); await otherContext.close(); }
});

test('profile conflict recovery, internal 8D and ledger filters preserve editable content', async ({ page }) => {
  test.setTimeout(120000);
  const code = `INTERNAL-${suffix}`;
  const profile = await prisma.supplierBusinessProfile.upsert({ where: { ownerOrganizationId_supplierOrganizationId: { ownerOrganizationId: organizations[0]!, supplierOrganizationId: organizations[2]! } }, create: { ownerOrganizationId: organizations[0]!, supplierOrganizationId: organizations[2]!, businessCode: code, displayName: '内部 8D 测试供应商' }, update: {} });
  await login(page, 0);
  await page.goto('/app/supplier-quality/profiles');
  await page.getByRole('row').filter({ hasText: code }).getByRole('button', { name: '编辑资料' }).click();
  const editor = page.getByRole('dialog', { name: '编辑供应商资料' });
  await editor.getByLabel('联系人', { exact: true }).fill('新联系人');
  await editor.getByLabel('联系邮箱', { exact: true }).fill('quality@example.test');
  await editor.getByRole('button', { name: '保存供应商资料' }).click();
  await expect(editor).not.toBeVisible();
  await expect(page.getByRole('row').filter({ hasText: code })).toContainText('新联系人');
  await page.getByRole('row').filter({ hasText: code }).getByRole('button', { name: '编辑资料' }).click();
  await editor.getByLabel('联系人', { exact: true }).fill('冲突时保留的联系人');
  const protection = await page.context().request.get('/api/v1/auth/csrf');
  const csrfToken = (await protection.json()).csrfToken;
  const current = (await (await page.context().request.get(`/api/v1/supplier-quality/profiles/${profile.id}`)).json());
  const competing = await page.context().request.put(`/api/v1/supplier-quality/profiles/${profile.id}`, { headers: { 'x-csrf-token': csrfToken, 'Idempotency-Key': randomUUID() }, data: { businessCode: code, expectedVersion: current.version, contactName: '其他编辑者' } });
  expect(competing.status()).toBe(200);
  await editor.getByRole('button', { name: '保存供应商资料' }).click();
  await expect(editor.getByText(/内容已被其他人修改/)).toBeVisible();
  await expect(editor.getByLabel('联系人', { exact: true })).toHaveValue('冲突时保留的联系人');
  await editor.getByRole('button', { name: '重新加载资料' }).click();
  await page.getByRole('button', { name: '重新加载', exact: true }).click();
  await expect(editor.getByLabel('联系人', { exact: true })).toHaveValue('其他编辑者');
  await editor.getByLabel('联系人', { exact: true }).fill('');
  await editor.getByRole('button', { name: '保存供应商资料' }).click();
  await expect(editor).not.toBeVisible();
  expect((await prisma.supplierBusinessProfile.findUniqueOrThrow({ where: { id: profile.id } })).contactName).toBeNull();

  await page.goto('/app/supplier-quality/new');
  await page.getByLabel('问题标题', { exact: true }).fill('内部 8D 问题');
  await page.getByLabel('责任供应商', { exact: true }).fill(code);
  await page.locator('.ant-select-item-option-content').filter({ hasText: code }).click();
  await page.getByLabel('物料号', { exact: true }).fill('MAT-INTERNAL');
  await page.getByLabel('不良数量', { exact: true }).fill('5');
  await select(page, '严重度', '低');
  await select(page, '回复形式', '8D');
  await select(page, '回复方', '内部指定人员');
  await page.getByLabel('内部回复人', { exact: true }).fill(usernames[0]!);
  await page.locator('.ant-select-item-option-content').filter({ hasText: usernames[0]! }).click();
  await page.getByLabel('不良描述', { exact: true }).fill('内部验证用夹具');
  await page.getByRole('button', { name: '保存问题草稿', exact: true }).click();
  await expect(page).toHaveURL(/\/problems\/[0-9a-f-]+$/);
  for (const label of ['问题描述', '围堵措施', '临时措施', '根本原因', '纠正措施', '预防措施', '整改自验结果']) await page.getByLabel(label, { exact: true }).fill(`夹具：${label}`);
  await page.getByLabel('问题标题', { exact: true }).fill('内部 8D 问题（修改）');
  const factsSaved = page.waitForResponse((response) => response.request().method() === 'PUT' && response.url().includes('/drafts/'));
  await page.getByRole('button', { name: '保存问题草稿', exact: true }).click();
  expect((await factsSaved).status()).toBe(200);
  await expect(page.getByLabel('根本原因', { exact: true })).toHaveValue('夹具：根本原因');
  await page.getByLabel('物料号', { exact: true }).fill('MAT-UNSAVED');
  const responseSaved = page.waitForResponse((response) => response.request().method() === 'PUT' && response.url().includes('/response-draft'));
  await page.getByRole('button', { name: '保存回复草稿', exact: true }).click();
  expect((await responseSaved).status()).toBe(200);
  await expect(page.getByLabel('物料号', { exact: true })).toHaveValue('MAT-UNSAVED');
  await page.reload();
  await expect(page.getByLabel('根本原因', { exact: true })).toHaveValue('夹具：根本原因');
  await expect(page.getByLabel('物料号', { exact: true })).toHaveValue('MAT-INTERNAL');
  await page.goto('/app/supplier-quality');
  await select(page, '筛选回复形式', '8D');
  await select(page, '筛选严重度', '低');
  await select(page, '筛选发单状态', '草稿');
  await expect(page.getByRole('link', { name: '内部 8D 问题（修改）' })).toBeVisible();
  await select(page, '筛选发单状态', '已发单');
  await expect(page.getByRole('link', { name: '内部 8D 问题（修改）' })).toHaveCount(0);
});
