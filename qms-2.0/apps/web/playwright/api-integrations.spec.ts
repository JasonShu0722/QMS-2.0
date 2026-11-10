import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import type { components } from '@qms/contracts';
import { completeMfa } from './mfa-login';
import { positionRead, positionWrite } from './position-fixture';
import { fillSecret } from './secret-input';

type Schema = components['schemas'];
const baseURL = process.env.QMS_ACCEPTANCE_BASE_URL ?? process.env.PLAYWRIGHT_BASE_URL;
const databaseURL = process.env.DATABASE_URL;
const password = process.env.QMS_SEED_INTERNAL_PASSWORD;
const artifactDirectory = process.env.QMS_ACCEPTANCE_ARTIFACT_DIRECTORY;
if (!baseURL || !databaseURL || !password || !process.env.QMS_ACCEPTANCE_MFA_CACHE_FILE || !process.env.QMS_BACKUP_KEY
  || process.env.QMS_DISPOSABLE_TEST_DB !== 'true' || process.env.QMS_ACCEPTANCE_DISPOSABLE_DATABASE !== 'true') {
  throw new Error('API integration acceptance requires disposable PostgreSQL, a real gateway, seed credentials and an external encrypted MFA cache.');
}
for (const [value, database] of [[baseURL, false], [databaseURL, true]] as const) {
  const url = new URL(value);
  if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.port === '55440' || url.search || url.hash
    || !(database ? ['postgres:', 'postgresql:'] : ['http:', 'https:']).includes(url.protocol)
    || (!database && (url.username || url.password || url.pathname !== '/'))) {
    throw new Error('API integration fixtures require loopback resources outside the preserved preview database.');
  }
}
if (artifactDirectory) {
  const location = relative(resolve(process.cwd(), '../../..'), artifactDirectory);
  if (!isAbsolute(artifactDirectory) || location !== '..' && !location.startsWith(`..${sep}`) && !isAbsolute(location)) {
    throw new Error('Browser acceptance artifacts must remain outside the checkout.');
  }
}

const requireApi = createRequire(new URL('../../api/package.json', import.meta.url));
const { PrismaPg } = requireApi('@prisma/adapter-pg');
const { PrismaClient } = await import('../../api/dist/generated/prisma/client.js');
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseURL }) });
const permissions = ['integration:read', 'integration:manage', 'integration:credentials:manage', 'integration:receipts:read', 'integration:payload:read'];
const addedPermissionIds: string[] = [];
let fixtureRoleId: string;
const endpoints = '/api/v1/admin/integrations/endpoints';
const suffix = randomUUID().replaceAll('-', '').slice(0, 12);

test.setTimeout(240_000);
test.use({ trace: 'off', screenshot: 'off', video: 'off', actionTimeout: 15_000, navigationTimeout: 20_000 });

test.beforeAll(async () => {
  const organization = await prisma.organization.findUniqueOrThrow({ where: { code: 'LOCAL-INTERNAL' } });
  const user = await prisma.user.findUniqueOrThrow({ where: { organizationId_username: { organizationId: organization.id, username: 'local.internal' } } });
  const assignment = await prisma.userRole.findFirstOrThrow({ where: { organizationId: organization.id, userId: user.id, role: { code: 'LOCAL_MEMBER' } } });
  fixtureRoleId = assignment.roleId;
  const catalog = await prisma.permission.findMany({ where: { code: { in: permissions } } });
  expect(catalog).toHaveLength(permissions.length);
  expect(await prisma.rolePermission.count({ where: { roleId: fixtureRoleId, permission: { code: { in: permissions } } } })).toBe(0);
  const marker = await prisma.permission.findUniqueOrThrow({ where: { code: 'platform:admin' } });
  const where = { roleId_permissionId: { roleId: fixtureRoleId, permissionId: marker.id } };
  if (!await prisma.rolePermission.findUnique({ where })) {
    await prisma.rolePermission.create({ data: where.roleId_permissionId });
    addedPermissionIds.push(marker.id);
  }
});

test.afterAll(async () => {
  try {
    if (fixtureRoleId && addedPermissionIds.length) {
      await prisma.rolePermission.deleteMany({ where: { roleId: fixtureRoleId, permissionId: { in: addedPermissionIds } } });
    }
  } finally {
    await prisma.$disconnect();
  }
});

async function saveEndpoint(page: Page, endpointId?: string) {
  const pending = page.waitForResponse(response => new URL(response.url()).pathname === (endpointId ? `${endpoints}/${endpointId}` : endpoints)
    && response.request().method() === (endpointId ? 'PATCH' : 'POST'));
  const [response] = await Promise.all([
    pending,
    page.getByRole('dialog').getByRole('button', { name: /^保\s*存$/ }).click(),
  ]);
  expect(response.status()).toBe(endpointId ? 200 : 201);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  return await response.json() as Schema['IntegrationEndpointDto'];
}

async function sendMessage(endpointId: string, credential: string, messageId: string, body: string) {
  try {
    return await fetch(new URL(`/api/v1/integrations/inbound/${endpointId}/messages`, baseURL), {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15_000),
      headers: { Authorization: `Bearer ${credential}`, 'Idempotency-Key': messageId, 'Content-Type': 'application/json' }, body,
    });
  } catch {
    throw new Error('Disposable machine HTTP request failed; authentication details redacted.');
  }
}

async function openIntegrations(page: Page) {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/login');
  await page.getByLabel('账号', { exact: true }).fill('local.internal');
  await fillSecret(page.getByLabel('密码', { exact: true }), password!);
  const login = page.waitForResponse(response => new URL(response.url()).pathname === '/api/v1/auth/login' && response.request().method() === 'POST');
  const [authenticated] = await Promise.all([login, page.getByRole('button', { name: '登录', exact: true }).click()]);
  await completeMfa(page.request, authenticated, 'local.internal', page);
  await expect(page).toHaveURL(/\/app\/workbench$/);
  await page.goto('/console');
  const entry = page.getByRole('link', { name: 'API接口管理', exact: true });
  await expect(entry).toBeVisible();
  await entry.click();
  await expect(page).toHaveURL(/\/console\/api-integrations(?:\?|$)/);
  const section = page.getByRole('region', { name: 'API接口管理', exact: true });
  await expect(section).toBeVisible();
  return section;
}

test('real receiving configuration, permanent reusable connection copy, receipts and plain text', async ({ page }) => {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  const section = await openIntegrations(page);
  await section.getByRole('button', { name: '新增接收接口', exact: true }).click();
  const editor = page.getByRole('dialog', { name: '新增接收接口', exact: true });
  const name = `浏览器技术验收 ${suffix}`;
  const sourceCode = `BROWSER_${suffix}`;
  await editor.getByLabel('接口编码', { exact: true }).fill(`IN_${suffix}`);
  await editor.getByLabel('接口名称', { exact: true }).fill(name);
  await editor.getByLabel('来源系统编码', { exact: true }).fill(sourceCode);
  await editor.getByLabel('来源系统名称', { exact: true }).fill(`技术来源 ${suffix}`);
  await expect(editor.getByRole('switch', { name: '返回接收回执', exact: true })).toBeChecked();
  let endpoint = await saveEndpoint(page);
  expect(endpoint.status).toBe('DRAFT');
  expect(endpoint.returnReceipt).toBe(true);
  let credentialId: string | undefined;
  let deleted = false;
  try {
    await section.getByRole('button', { name: `管理${name}凭据`, exact: true }).click();
    const credentials = page.getByRole('dialog', { name: `${name}凭据`, exact: true });
    await expect(credentials.getByRole('radio', { name: '永久有效', exact: true })).toBeChecked();
    await credentials.getByLabel('凭据名称', { exact: true }).fill(`技术凭据 ${suffix}`);
    const issuing = page.waitForResponse(response => new URL(response.url()).pathname === `${endpoints}/${endpoint.id}/credentials` && response.request().method() === 'POST');
    const [issued] = await Promise.all([issuing, credentials.getByRole('button', { name: '创建凭据', exact: true }).click()]);
    expect(issued.status()).toBe(201);
    const credential = await issued.json() as Schema['IntegrationCredentialDto'];
    credentialId = credential.id;
    expect(credential.expiresAt).toBeNull();
    expect(typeof credential.secret === 'string' && credential.secret.length > 40).toBe(true);
    await credentials.getByRole('button', { name: '复制对接配置', exact: true }).click();
    await expect(credentials.getByText('已复制对接配置', { exact: true })).toBeVisible();
    const initialCopy = await page.evaluate(() => navigator.clipboard.readText());
    expect(initialCopy.includes(`Authorization: Bearer ${credential.secret}`)).toBe(true);
    expect(initialCopy.includes(endpoint.publicUrl)).toBe(true);
    expect(initialCopy.includes('每条新消息生成唯一编号')).toBe(true);
    expect(initialCopy.includes('永久有效')).toBe(true);
    await credentials.getByRole('button', { name: '关闭', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await section.getByRole('button', { name: `管理${name}凭据`, exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: `复制技术凭据 ${suffix}对接配置`, exact: true }).click();
    await expect(page.getByRole('dialog').getByText('已复制对接配置', { exact: true })).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText()) === initialCopy).toBe(true);
    const listed = await positionRead<Schema['IntegrationCredentialPageDto']>(page.request, `${endpoints}/${endpoint.id}/credentials?organizationId=${endpoint.organizationId}`);
    expect(listed.items.every(item => !Object.hasOwn(item, 'secret'))).toBe(true);
    await page.getByRole('dialog').getByRole('button', { name: '关闭', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);

    await section.getByRole('button', { name: `编辑${name}`, exact: true }).click();
    await page.getByRole('dialog').getByLabel('接口状态', { exact: true }).click();
    await page.locator('.ant-select-dropdown:visible .ant-select-item-option').filter({ hasText: '启用' }).click();
    endpoint = await saveEndpoint(page, endpoint.id);
    expect(endpoint.status).toBe('ENABLED');
    await section.getByRole('button', { name: `查看${name}调用说明`, exact: true }).click();
    const instructions = section.getByRole('region', { name: '调用说明', exact: true });
    await instructions.getByRole('button', { name: '复制对接配置', exact: true }).click();
    await expect(instructions.getByText('已复制对接配置', { exact: true })).toBeVisible();
    const activeCopy = await page.evaluate(() => navigator.clipboard.readText());
    const copiedAuthorization = /^Authorization: Bearer (.+)$/m.exec(activeCopy)?.[1];
    expect(copiedAuthorization === credential.secret).toBe(true);
    expect(new URL(endpoint.publicUrl).pathname.endsWith(`/inbound/${encodeURIComponent(endpoint.code)}/messages`)).toBe(true);
    const messageId = `browser-${suffix}-receipt`;
    const body = JSON.stringify({ technicalAcceptance: true, text: '<img src=x onerror="window.__qmsInboundExecuted=true"><script>window.__qmsInboundExecuted=true</script>' });
    const received = await sendMessage(encodeURIComponent(endpoint.code), copiedAuthorization!, messageId, body);
    expect(received.status).toBe(201);
    const receipt = await received.json() as Schema['InboundReceiptDto'];
    expect(receipt.duplicate).toBe(false);
    const repeated = await sendMessage(endpoint.id, credential.secret!, messageId, body);
    expect(repeated.status).toBe(200);
    const duplicate = await repeated.json() as Schema['InboundReceiptDto'];
    expect(duplicate.receiptId).toBe(receipt.receiptId);
    expect(duplicate.duplicate).toBe(true);

    await section.getByRole('button', { name: `编辑${name}`, exact: true }).click();
    await page.getByRole('dialog').getByRole('switch', { name: '返回接收回执', exact: true }).uncheck();
    endpoint = await saveEndpoint(page, endpoint.id);
    expect(endpoint.returnReceipt).toBe(false);
    const silentMessageId = `browser-${suffix}-silent`;
    for (const identifier of [silentMessageId, silentMessageId, messageId]) {
      const response = await sendMessage(endpoint.id, credential.secret!, identifier, body);
      expect(response.status).toBe(204);
      expect((await response.arrayBuffer()).byteLength).toBe(0);
    }

    await section.getByRole('tab', { name: '接收记录', exact: true }).click();
    const filters = section.getByRole('form', { name: '接收记录筛选', exact: true });
    await filters.getByLabel('来源系统编码', { exact: true }).fill(`ABSENT_${suffix}`);
    const emptyResults = page.waitForResponse(response => {
      const url = new URL(response.url());
      return url.pathname === '/api/v1/admin/integrations/receipts' && url.searchParams.get('sourceCode') === `ABSENT_${suffix}`;
    });
    const [emptyResponse] = await Promise.all([emptyResults, filters.getByRole('button', { name: '应用筛选', exact: true }).click()]);
    expect(emptyResponse.status()).toBe(200);
    await expect(section.locator('.ant-spin-spinning')).toHaveCount(0);
    await expect(section.getByRole('button', { name: `查看消息${messageId}`, exact: true })).toHaveCount(0);
    await filters.getByLabel('来源系统编码', { exact: true }).fill(sourceCode);
    await filters.getByRole('button', { name: '应用筛选', exact: true }).click();
    await expect(section.getByRole('button', { name: `查看消息${silentMessageId}`, exact: true })).toBeVisible();
    await section.getByRole('button', { name: `查看消息${messageId}`, exact: true }).click();
    const detail = page.getByRole('dialog', { name: '接收详情', exact: true });
    await detail.getByRole('button', { name: '查看接收正文', exact: true }).click();
    await expect(detail.getByLabel('接收正文', { exact: true })).toHaveText(body);
    await expect(detail.getByLabel('接收正文', { exact: true }).locator('img, script')).toHaveCount(0);
    expect(await page.evaluate(() => Object.hasOwn(window, '__qmsInboundExecuted'))).toBe(false);
    await detail.getByRole('button', { name: '关闭', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await positionWrite(page.request, `${endpoints}/${endpoint.id}/credentials/${credential.id}/revoke`, 'POST', { organizationId: endpoint.organizationId }, 201);
    const revoked = await sendMessage(encodeURIComponent(endpoint.code), copiedAuthorization!, `browser-${suffix}-revoked`, body);
    expect(revoked.status).toBe(401);
    const deletionCredential = await positionWrite<Schema['IntegrationCredentialDto']>(page.request, `${endpoints}/${endpoint.id}/credentials`, 'POST', { organizationId: endpoint.organizationId, name: 'Deletion fixture', validityDays: null }, 201);
    await section.getByRole('tab', { name: '接收接口', exact: true }).click();
    await section.getByRole('button', { name: `删除${name}`, exact: true }).click();
    const confirmation = page.getByRole('tooltip');
    await expect(confirmation).toContainText('历史');
    const removing = page.waitForResponse(response => new URL(response.url()).pathname === `${endpoints}/${endpoint.id}` && response.request().method() === 'DELETE');
    const [removed] = await Promise.all([removing, confirmation.getByRole('button', { name: '确认删除', exact: true }).click()]);
    expect(removed.status()).toBe(204); deleted = true;
    await expect(section.getByRole('button', { name: `删除${name}`, exact: true })).toHaveCount(0);
    expect((await sendMessage(encodeURIComponent(endpoint.code), deletionCredential.secret!, `browser-${suffix}-deleted`, body)).status).toBe(401);
    const preserved = await positionRead<Schema['IntegrationPayloadDto']>(page.request, `/api/v1/admin/integrations/receipts/${receipt.receiptId}/payload?organizationId=${endpoint.organizationId}`);
    expect(preserved.text === body).toBe(true);
    const replacement = await positionWrite<Schema['IntegrationEndpointDto']>(page.request, endpoints, 'POST', { organizationId: endpoint.organizationId, code: endpoint.code, name: `${name}替代`, sourceCode, sourceName: `技术来源 ${suffix}` }, 201);
    expect(replacement.id).not.toBe(endpoint.id);
    expect((await sendMessage(encodeURIComponent(endpoint.code), deletionCredential.secret!, `browser-${suffix}-replacement`, body)).status).toBe(401);

  } finally {
    await page.goto('about:blank');
    if (!deleted) {
      const current = await positionRead<Schema['IntegrationEndpointDto']>(page.request, `${endpoints}/${endpoint.id}?organizationId=${endpoint.organizationId}`);
      await positionWrite(page.request, `${endpoints}/${endpoint.id}`, 'PATCH', { organizationId: endpoint.organizationId, expectedVersion: current.version, status: 'DISABLED' });
      if (credentialId) await positionWrite(page.request, `${endpoints}/${endpoint.id}/credentials/${credentialId}/revoke`, 'POST', { organizationId: endpoint.organizationId }, 201);
    }
  }
});

test('responsive receiving records cover light and dark themes and reserved outbound', async ({ page }) => {
  const section = await openIntegrations(page);
  await section.getByRole('tab', { name: '接收记录', exact: true }).click();
  await expect(section.getByRole('form', { name: '接收记录筛选', exact: true })).toBeVisible();
  await expect(section.locator('.ant-spin-spinning')).toHaveCount(0);
  if (artifactDirectory) mkdirSync(artifactDirectory, { recursive: true });
  for (const [label, theme] of [['浅色', 'light'], ['深色', 'dark']] as const) {
    await page.getByRole('button', { name: '管理外观', exact: true }).click();
    await page.getByRole('menuitem', { name: label, exact: true }).click();
    await expect(page.locator('.qms-console-theme')).toHaveAttribute('data-console-theme', theme);
    for (const width of [320, 390, 1440]) {
      await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 });
      await expect(section.getByRole('tab', { name: '接收记录', exact: true })).toBeVisible();
      try {
        await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      } catch (error) {
        if (artifactDirectory) {
          await page.screenshot({ path: join(artifactDirectory, `overflow-${width}.png`), fullPage: true });
          const geometry = await page.evaluate(() => {
            const measure = (element: Element) => {
              const bounds = element.getBoundingClientRect();
              const style = getComputedStyle(element);
              return { tag: element.tagName, className: element.getAttribute('class') ?? '', left: bounds.left, right: bounds.right, width: bounds.width,
                overflowX: style.overflowX, minWidth: style.minWidth, display: style.display };
            };
            return {
              viewport: { width: window.innerWidth, height: window.innerHeight },
              documentWidth: document.documentElement.scrollWidth,
              elements: [...document.querySelectorAll('body, body *')].filter(element => {
                const bounds = element.getBoundingClientRect();
                const style = getComputedStyle(element);
                return bounds.width > 0 && bounds.height > 0 && bounds.right > window.innerWidth + 1 && style.visibility === 'visible' && style.display !== 'none';
              }).map(measure),
              surfaces: [...document.querySelectorAll('.qms-console-topbar, .ant-dropdown, .ant-select-dropdown, .ant-tooltip, .ant-drawer')].map(measure),
            };
          });
          writeFileSync(join(artifactDirectory, `overflow-${width}.json`), JSON.stringify(geometry, null, 2));
        }
        throw error;
      }
      if (artifactDirectory) await page.screenshot({ path: join(artifactDirectory, `api-integrations-${theme}-${width}-${suffix}.png`), fullPage: true });
    }
  }
  await section.getByRole('tab', { name: '发出接口', exact: true }).click();
  await expect(section.getByText('后续开放', { exact: true })).toBeVisible();
  await expect(section.getByRole('tabpanel').getByRole('button')).toHaveCount(0);
});
