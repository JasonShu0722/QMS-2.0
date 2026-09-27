import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import type { components } from '@qms/contracts';
import { completeMfa } from './mfa-login';
import { fillSecret } from './secret-input';

const databaseUrl = process.env.DATABASE_URL;
const baseURL = process.env.QMS_ACCEPTANCE_BASE_URL ?? process.env.PLAYWRIGHT_BASE_URL;
const password = process.env.QMS_SEED_INTERNAL_PASSWORD;
if (!databaseUrl || !baseURL || !password || process.env.QMS_ACCEPTANCE_DISPOSABLE_DATABASE !== 'true'
  || !process.env.QMS_ACCEPTANCE_MFA_CACHE_FILE || !process.env.QMS_BACKUP_KEY
  || !['127.0.0.1', 'localhost', '[::1]', '::1'].includes(new URL(databaseUrl).hostname)
  || new URL(databaseUrl).port === '55440') {
  throw new Error('Audit import browser acceptance requires an owned disposable PostgreSQL, real gateway, and external MFA credentials.');
}

const requireApi = createRequire(new URL('../../api/package.json', import.meta.url));
const { PrismaPg } = requireApi('@prisma/adapter-pg');
const { hash } = requireApi('argon2');
const { PrismaClient } = await import('../../api/dist/generated/prisma/client.js');
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
type Schema = components['schemas'];
const suffix = randomUUID().replaceAll('-', '').slice(0, 16);
const externalKey = `F4-BROWSER-${suffix}`;
const writerName = `f4-writer-${suffix}`;
const readerName = `f4-reader-${suffix}`;
let organizationId: string;
let writerRoleId: string;

test.beforeAll(async () => {
  const organization = await prisma.organization.create({ data: { code: `F4-${suffix}`, name: 'F4 浏览器验收组织', type: 'INTERNAL' } });
  organizationId = organization.id;
  const passwordHash = await hash(password!);
  for (const [username, roleCode, codes] of [
    [writerName, 'F4_WRITER', ['workbench:read', 'audit-management:read', 'audit-management:write', 'workflow:manage', 'workflow:start', 'problem-index:read']],
    [readerName, 'F4_READER', ['workbench:read', 'audit-management:read']],
  ] as const) {
    const user = await prisma.user.create({ data: { organizationId, username, passwordHash, accountType: 'INTERNAL' } });
    const role = await prisma.role.create({ data: { organizationId, code: roleCode, name: roleCode } });
    if (username === writerName) writerRoleId = role.id;
    const permissions = await prisma.permission.findMany({ where: { code: { in: [...codes] } } });
    expect(permissions).toHaveLength(codes.length);
    await prisma.rolePermission.createMany({ data: permissions.map((permission) => ({ roleId: role.id, permissionId: permission.id })) });
    await prisma.userRole.create({ data: { organizationId, userId: user.id, roleId: role.id } });
    if (username === writerName) await prisma.numberRuleVersion.create({ data: { organizationId, ruleCode: 'PROBLEM', version: 1, pattern: '{CODE}-{YYMM}-{SEQ3}', active: true, createdById: user.id } });
  }
});

test.afterAll(async () => prisma.$disconnect());

async function login(page: Page, username: string) {
  await page.goto('/login');
  await page.getByLabel('账号', { exact: true }).fill(username);
  await fillSecret(page.getByLabel('密码', { exact: true }), password!);
  const pending = page.waitForResponse((response) => response.url().endsWith('/api/v1/auth/login'));
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await completeMfa(page.request, await pending, username, page);
  await expect(page).toHaveURL(/\/app\/workbench$/);
}

async function write(client: APIRequestContext, path: string, method: 'POST' | 'PUT', data: object) {
  const protection = await client.get('/api/v1/auth/csrf');
  expect(protection.status()).toBe(200);
  const csrf = (await protection.json() as Schema['CsrfResponseDto']).csrfToken;
  return client.fetch(path, { method, headers: { 'x-csrf-token': csrf, 'Idempotency-Key': randomUUID() }, data });
}

async function createWorkflow(client: APIRequestContext) {
  const created = await write(client, '/api/v1/workflows', 'POST', {
    code: `F4_${suffix}`, name: 'F4 审核问题流程',
    nodes: [
      { id: 'handle', type: 'ACTION', name: '处理', config: { isStart: true, assignment: { roleCode: 'F4_WRITER' } } },
      { id: 'verify', type: 'VERIFICATION', name: '验证', config: { assignment: { roleCode: 'F4_WRITER' } } },
      { id: 'close', type: 'CLOSE', name: '关闭', config: { isEnd: true, requireIndependentVerification: true, assignment: { roleCode: 'F4_WRITER' } } },
    ],
    transitions: [{ id: 'submit', from: 'handle', to: 'verify' }, { id: 'verify', from: 'verify', to: 'close' }],
  });
  expect(created.status(), await created.text()).toBe(201);
  const draft = await created.json() as Schema['WorkflowDefinitionResponseDto'];
  const published = await write(client, `/api/v1/workflows/${draft.id}/publish`, 'POST', { draftVersionId: draft.version.id, expectedRevision: draft.revision });
  expect(published.status(), await published.text()).toBe(201);
  return { workflowDefinitionId: draft.id, workflowVersionId: draft.version.id };
}

async function importRow(client: APIRequestContext, key: string) {
  const response = await write(client, '/api/v1/audit-management/imports', 'POST', { sourceSystem: 'CUSTOMER', externalKey: key, payload: { finding: '客户审核记录缺少复核证据', source: key } });
  expect(response.status(), await response.text()).toBe(201);
  return await response.json() as Schema['AuditImportRowResponseDto'];
}

test('real audit import review, issue, source link, read-only and revoked permission', async ({ page, browser }) => {
  test.setTimeout(180_000);
  await login(page, writerName);
  const workflow = await createWorkflow(page.request);
  const imported = await importRow(page.request, externalKey);

  await page.goto('/app/audits');
  const section = page.getByRole('region', { name: '审核导入行' });
  const row = section.locator('.ant-list-item').filter({ hasText: externalKey });
  await expect(row).toContainText('待复核');
  const permissionResponse = await page.request.get('/api/v1/system/my-permissions');
  expect(permissionResponse.status(), await permissionResponse.text()).toBe(200);
  const ownPermissions = await permissionResponse.json() as Schema['PermissionsResponseDto'];
  expect(ownPermissions).toMatchObject({ organizationId, permissions: expect.arrayContaining(['audit-management:write', 'workflow:start']) });
  await expect(row.getByRole('button', { name: /^接\s*受$/ })).toBeVisible();
  const reviewing = page.waitForResponse((response) => response.url().endsWith(`/imports/${imported.id}/review`) && response.request().method() === 'PUT');
  await row.getByRole('button', { name: /^接\s*受$/ }).click();
  expect((await reviewing).status()).toBe(200);
  await expect(row).toContainText('已接受');
  await row.getByRole('button', { name: '发起正式问题' }).click();
  const drawer = page.getByRole('dialog', { name: '审核导入行发单' });
  await drawer.getByLabel('问题类型').fill('AUDIT_FINDING');
  await drawer.getByLabel('责任范围').fill('audit-management');
  await drawer.getByLabel('严重度').fill('MAJOR');
  await drawer.getByLabel('流程定义 ID').fill(workflow.workflowDefinitionId);
  await drawer.getByLabel('流程版本 ID').fill(workflow.workflowVersionId);
  await drawer.getByLabel('实例标识').fill(`f4-instance-${suffix}`);
  const issuing = page.waitForResponse((response) => response.url().endsWith(`/imports/${imported.id}/issue`) && response.request().method() === 'POST');
  await drawer.getByRole('button', { name: '确认发单' }).click();
  const issuedResponse = await issuing;
  expect(issuedResponse.status(), await issuedResponse.text()).toBe(201);
  const issued = await issuedResponse.json() as Schema['AuditImportIssueResultDto'];
  expect(issued.replayed).toBe(false);
  expect(issued.problem.reportNumber).toMatch(/^AUDIT-/);
  await expect(section.getByText(`问题 ${issued.problem.reportNumber} 已发起`)).toBeVisible();
  await expect(row).toContainText('已发单');
  await expect(row.getByRole('link', { name: `已关联问题：${issued.problem.id}` })).toHaveAttribute('href', new RegExp(issued.problem.id));
  expect(await prisma.domainSourceIssueLink.count({ where: { organizationId, sourceId: imported.id, problemIndexId: issued.problem.id } })).toBe(1);

  const readerContext = await browser.newContext({ baseURL });
  try {
    const reader = await readerContext.newPage();
    await login(reader, readerName);
    await reader.goto('/app/audits');
    await expect(reader.getByRole('region', { name: '审核导入行' }).locator('.ant-list-item').filter({ hasText: externalKey })).toContainText('已发单');
    const second = await importRow(page.request, `F4-REVOKE-${suffix}`);
    await expect(reader.getByRole('region', { name: '审核导入行' }).getByRole('button', { name: '刷新导入' })).toBeVisible();
    await reader.getByRole('button', { name: '刷新导入' }).click();
    const readerRow = reader.locator('.audit-import-card .ant-list-item').filter({ hasText: second.external_key });
    await expect(readerRow).toContainText('待复核');
    await expect(readerRow.getByRole('button', { name: /^接\s*受$/ })).toHaveCount(0);
    await expect(readerRow.getByRole('button', { name: /^拒\s*绝$/ })).toHaveCount(0);
  } finally { await readerContext.close(); }

  const second = await importRow(page.request, `F4-DENIED-${suffix}`);
  const accepted = await write(page.request, `/api/v1/audit-management/imports/${second.id}/review`, 'PUT', { expectedVersion: second.version, decision: 'ACCEPTED' });
  expect(accepted.status(), await accepted.text()).toBe(200);
  await section.getByRole('button', { name: '刷新导入' }).click();
  const deniedRow = section.locator('.ant-list-item').filter({ hasText: second.external_key });
  await deniedRow.getByRole('button', { name: '发起正式问题' }).click();
  await drawer.getByLabel('问题类型').fill('AUDIT_FINDING');
  await drawer.getByLabel('责任范围').fill('audit-management');
  await drawer.getByLabel('严重度').fill('MAJOR');
  await drawer.getByLabel('流程定义 ID').fill(workflow.workflowDefinitionId);
  await drawer.getByLabel('流程版本 ID').fill(workflow.workflowVersionId);
  await drawer.getByLabel('实例标识').fill(`f4-denied-${suffix}`);
  const writePermission = await prisma.permission.findUniqueOrThrow({ where: { code: 'audit-management:write' } });
  await prisma.rolePermission.delete({ where: { roleId_permissionId: { roleId: writerRoleId, permissionId: writePermission.id } } });
  const denied = page.waitForResponse((response) => response.url().endsWith(`/imports/${second.id}/issue`) && response.request().method() === 'POST');
  await drawer.getByRole('button', { name: '确认发单' }).click();
  expect((await denied).status()).toBe(403);
  await expect(drawer).toHaveCount(0);
  await expect(section.getByText('暂无发单权限')).toBeVisible();
  await expect(section.locator('.ant-list-item')).toHaveCount(0);
  expect(await prisma.problemIndex.count({ where: { organizationId, sourceId: second.id } })).toBe(0);
});
