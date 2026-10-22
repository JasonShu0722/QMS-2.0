import { randomUUID } from 'node:crypto';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { test as base, expect, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import type { components } from '@qms/contracts';
import { completeMfa } from './mfa-login';
import { fillSecret } from './secret-input';
import { choosePosition, confirmPositionPreview, createPositionGrant, createPositionUser, replacePositionAppointments, retirePositionGrant, type PositionGrant } from './position-fixture';

// 仅供已启动的一次性真实网关；从 apps/web 使用既有 config，主代理以单 worker 执行。
// 必需：QMS_ACCEPTANCE_BASE_URL（或 PLAYWRIGHT_BASE_URL）、DATABASE_URL、两门户 seed 密码、Git 外加密 MFA cache 和密钥。
// 资料用例要求 seed 邮箱未确认；不能通过改邮箱后丢失确认状态来“恢复”账号。
const baseURL = process.env.QMS_ACCEPTANCE_BASE_URL ?? process.env.PLAYWRIGHT_BASE_URL;
const internalPassword = process.env.QMS_SEED_INTERNAL_PASSWORD;
const supplierPassword = process.env.QMS_SEED_SUPPLIER_PASSWORD;
const databaseURL = process.env.DATABASE_URL;
const cacheFile = process.env.QMS_ACCEPTANCE_MFA_CACHE_FILE;
const loopback = (hostname: string) => ['localhost', '127.0.0.1', '[::1]'].includes(hostname);
if (process.env.QMS_DISPOSABLE_TEST_DB !== 'true' || !baseURL || !databaseURL || !internalPassword || !supplierPassword) {
  throw new Error('REQ22/23 requires QMS_DISPOSABLE_TEST_DB=true, a live loopback gateway, disposable PostgreSQL and both seed passwords; no skip.');
}
function requireLocalURL(value: string, database: boolean) {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error('Invalid acceptance endpoint; value redacted.'); }
  if (!loopback(url.hostname) || url.port === '55440' || (url.username && !database) || (url.password && !database)
    || !(database ? ['postgres:', 'postgresql:'] : ['http:', 'https:']).includes(url.protocol)
    || (!database && (url.pathname !== '/' || !!url.search || !!url.hash))
    || (database && ['host', 'hostaddr', 'port', 'service'].some(key => url.searchParams.has(key)))) {
    throw new Error('Only loopback acceptance endpoints are allowed; reserved port 55440 and production are forbidden.');
  }
}
requireLocalURL(baseURL, false);
requireLocalURL(databaseURL, true);
if (!cacheFile || !isAbsolute(cacheFile) || Buffer.from(process.env.QMS_BACKUP_KEY ?? '', 'base64').length !== 32) {
  throw new Error('An absolute external encrypted MFA cache and a base64 32-byte QMS_BACKUP_KEY are required.');
}
const cacheLocation = relative(resolve(process.cwd(), '../../..'), cacheFile);
if (cacheLocation !== '..' && !cacheLocation.startsWith(`..${sep}`) && !isAbsolute(cacheLocation)) {
  throw new Error('MFA cache must be outside the checkout.');
}

type Schema = components['schemas'];
type Profile = Schema['AccountProfileDto'];
type Draft = Pick<Profile, 'fullName' | 'phone' | 'email'>;
const unique = (prefix: string) => `${prefix}_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
const pathFor = (path: string, organizationId: string) => `/api/v1/admin/${path}?organizationId=${organizationId}`;

async function read<T>(client: APIRequestContext, path: string): Promise<T> {
  const response = await client.get(path, { timeout: 15_000 });
  expect(response.status(), `GET ${path}`).toBe(200);
  return await response.json() as T;
}
async function write(client: APIRequestContext, path: string, method: string, data?: object) {
  const csrf = await read<Schema['CsrfResponseDto']>(client, '/api/v1/auth/csrf');
  return client.fetch(path, { timeout: 15_000, method, headers: { 'x-csrf-token': csrf.csrfToken, 'Idempotency-Key': randomUUID() }, data });
}
async function writeJSON<T>(client: APIRequestContext, path: string, method: string, data: object, status = 200): Promise<T> {
  const response = await write(client, path, method, data);
  expect(response.status(), `${method} ${path}`).toBe(status);
  return await response.json() as T;
}
async function login(page: Page, supplier = false, identifier = supplier ? 'local.supplier' : 'local.internal', password = supplier ? supplierPassword! : internalPassword!) {
  await page.goto('/login');
  // 使用全新 context 的默认中文；不依赖历史 Language 菜单。
  await page.getByLabel('账号', { exact: true }).fill(identifier);
  await fillSecret(page.getByLabel('密码', { exact: true }), password);
  const pending = page.waitForResponse(response => new URL(response.url()).pathname === '/api/v1/auth/login' && response.request().method() === 'POST');
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await completeMfa(page.request, await pending, identifier, page);
  await expect(page).toHaveURL(supplier ? /\/supplier\/inbox$/ : /\/app\/workbench$/);
}
async function rowWith(scope: Locator, page: Page, name: string) {
  const row = scope.getByRole('row').filter({ has: page.getByText(name, { exact: true }) });
  await expect(scope.locator('tbody .ant-table-row').first()).toBeVisible();
  // shortcut: 最多翻100页；一次性夹具超过此规模时改为受控筛选。
  for (let index = 0; index < 100; index++) {
    await expect(scope.locator('.ant-spin-spinning')).toHaveCount(0);
    if (await row.count()) return row;
    const next = scope.getByTitle('下一页', { exact: true });
    if (!await next.count() || (await next.getAttribute('class'))?.includes('ant-pagination-disabled')) break;
    const active = await scope.locator('.ant-pagination-item-active').getAttribute('title');
    await next.scrollIntoViewIfNeeded();
    await page.mouse.wheel(0, 180);
    await next.click();
    await expect(scope.locator('.ant-pagination-item-active')).not.toHaveAttribute('title', active!);
  }
  throw new Error('Disposable fixture row not found in the real table.');
}
async function settings(page: Page) {
  await expect(page.getByRole('region', { name: '账号与授权', exact: true }).getByText(/^有效角色 ·/)).toBeVisible();
  await page.getByRole('button', { name: '个人信息设置', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '个人信息设置', exact: true });
  await expect(dialog).toBeVisible();
  return dialog;
}
async function enterDraft(page: Page, draft: Draft) {
  const dialog = page.getByRole('dialog', { name: '个人信息设置', exact: true });
  await dialog.getByLabel('姓名', { exact: true }).fill(draft.fullName ?? '');
  await dialog.getByLabel('电话', { exact: true }).fill(draft.phone ?? '');
  await dialog.getByLabel('邮箱', { exact: true }).fill(draft.email ?? '');
}
async function saveProfile(page: Page, expectedStatus = 200) {
  const pending = page.waitForResponse(response => new URL(response.url()).pathname === '/api/v1/me' && response.request().method() === 'PATCH');
  await page.getByRole('dialog', { name: '个人信息设置', exact: true }).getByRole('button', { name: '保存资料', exact: true }).click();
  const response = await pending;
  expect(response.status()).toBe(expectedStatus);
  if (expectedStatus === 200) await expect(page.getByRole('dialog', { name: '个人信息设置', exact: true }).getByText('资料已保存', { exact: true })).toBeVisible();
  return response;
}
async function closeSettings(page: Page) {
  const dialog = page.getByRole('dialog', { name: '个人信息设置', exact: true });
  await dialog.getByRole('button', { name: '关闭个人信息设置', exact: true }).click();
  await expect(dialog).not.toBeVisible();
}

const test = base.extend<{ admin: Schema['AdminOrganizationDto'] }>({
  admin: async ({ page }, use) => {
    await login(page);
    const me = await read<Profile>(page.request, '/api/v1/me');
    const organizations = await read<Schema['AdminOrganizationDto'][]>(page.request, '/api/v1/admin/organizations');
    const organization = organizations.find(entry => entry.id === me.organization.id && entry.type === 'INTERNAL');
    const required = ['organization:structure:read', 'organization:structure:manage', 'organization:positions:assign',
      'account:users:read', 'account:users:create', 'account:users:status', 'account:roles:read', 'account:roles:update',
      'account:roles:assign', 'task:read'];
    if (!organization || required.some(code => !organization.permissions.includes(code))) {
      throw new Error('Internal seed must have the required same-organization structure, appointment, user and role permissions.');
    }
    await use(organization);
  },
});
test.setTimeout(120_000);
test.use({ trace: 'off', screenshot: 'off', video: 'off', actionTimeout: 10_000, navigationTimeout: 15_000 });
test.beforeEach(async ({ baseURL: configuredURL, browserName }, testInfo) => {
  if (configuredURL !== baseURL || browserName !== 'chromium' || testInfo.config.workers !== 1) {
    throw new Error('Use the existing config with this loopback baseURL, Chromium (fillSecret) and exactly one worker.');
  }
});

for (const supplier of [false, true]) {
  const portal = supplier ? 'supplier' : 'internal';
  const accountPath = supplier ? '/supplier/account' : '/app/account';
  test(`REQ22 ${portal}: real login; 1440/1024 equal regions; 390 stacked without page overflow`, async ({ page }) => {
    await login(page, supplier);
    await page.goto(accountPath);
    await expect(page.getByRole('heading', { name: '个人账号', exact: true })).toBeVisible();
    await read<Schema['AccountOverviewDto']>(page.request, '/api/v1/me/overview');
    await expect(page.getByText('正在加载任职与授权', { exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '个人信息设置', exact: true })).toBeEnabled();
    await expect(page.locator('.account-center input')).toHaveCount(0);
    for (const width of [1440, 1024, 390]) {
      await page.setViewportSize({ width, height: 900 });
      const identity = page.getByRole('region', { name: '身份资料', exact: true });
      const authorization = page.getByRole('region', { name: '账号与授权', exact: true });
      await expect(identity).toBeVisible();
      await expect(authorization).toBeVisible();
      await expect.poll(async () => {
        const a = await identity.boundingBox(); const b = await authorization.boundingBox();
        if (!a || !b) return false;
        return width === 390 ? b.y >= a.y + a.height - 1 && Math.abs(a.x - b.x) <= 1
          : Math.abs(a.y - b.y) <= 1 && Math.abs(a.height - b.height) <= 1 && b.x >= a.x + a.width - 1;
      }).toBe(true);
      expect(await page.evaluate(() => Math.max(document.body.scrollWidth, document.documentElement.scrollWidth) <= innerWidth + 1)).toBe(true);
      await page.screenshot({ path: test.info().outputPath(`account-${portal}-${width}.png`), fullPage: true });
    }
  });

  test(`REQ22 ${portal}: profile save/reload/restore; real CAS conflict retains draft; unsaved close protection`, async ({ page }) => {
    await login(page, supplier);
    const original = await read<Profile>(page.request, '/api/v1/me');
    if (original.emailVerifiedAt) throw new Error('Use a disposable seed with unverified email so restoration preserves email verification state.');
    const changed: Draft = { fullName: unique('Browser Profile'), phone: '+1 202 555 0144 ext 22', email: `${unique('profile')}@example.test` };
    let touched = false;
    try {
      await page.goto(accountPath);
      let dialog = await settings(page);
      await dialog.getByLabel('姓名', { exact: true }).fill('Unsaved browser draft');
      await dialog.getByRole('button', { name: '关闭个人信息设置', exact: true }).click();
      const warning = page.getByRole('dialog', { name: '当前草稿尚未保存，继续将放弃修改。', exact: true });
      await expect(warning).toBeVisible();
      await warning.getByRole('button', { name: '继续编辑', exact: true }).click();
      await expect(dialog.getByLabel('姓名', { exact: true })).toHaveValue('Unsaved browser draft');
      await dialog.getByRole('button', { name: '关闭个人信息设置', exact: true }).click();
      await warning.getByRole('button', { name: '放弃修改并关闭', exact: true }).click();
      await expect(dialog).not.toBeVisible();
      await expect(page.getByRole('button', { name: '个人信息设置', exact: true })).toBeFocused();
      expect((await read<Profile>(page.request, '/api/v1/me')).profileVersion).toBe(original.profileVersion);

      dialog = await settings(page);
      await expect(dialog.getByLabel('姓名', { exact: true })).toHaveValue(original.fullName ?? '');
      await enterDraft(page, changed);
      touched = true;
      const saved = await saveProfile(page);
      expect(saved.request().postDataJSON()).toEqual({ ...changed, expectedProfileVersion: original.profileVersion });
      expect(saved.request().headers()['idempotency-key']).toBeTruthy();
      const persisted = await read<Profile>(page.request, '/api/v1/me');
      expect(persisted).toMatchObject({ ...changed, profileVersion: original.profileVersion + 1 });
      await closeSettings(page);
      await page.reload();
      dialog = await settings(page);
      for (const [label, value] of [['姓名', changed.fullName!], ['电话', changed.phone!], ['邮箱', changed.email!]]) {
        await expect(dialog.getByLabel(label, { exact: true })).toHaveValue(value);
      }

      // 真实并发写使当前表单版本过期；不拦截或伪造 409。
      const remote = await writeJSON<Profile>(page.request, '/api/v1/me', 'PATCH', { phone: '+1 202 555 0199', expectedProfileVersion: persisted.profileVersion });
      await dialog.getByLabel('姓名', { exact: true }).fill('Browser conflict draft');
      await saveProfile(page, 409);
      await expect(dialog.getByLabel('姓名', { exact: true })).toHaveValue('Browser conflict draft');
      await expect(dialog.getByRole('button', { name: '保存资料', exact: true })).toBeDisabled();
      const baseline = page.waitForResponse(response => new URL(response.url()).pathname === '/api/v1/me' && response.request().method() === 'GET');
      await dialog.getByRole('button', { name: '读取最新资料基线', exact: true }).click();
      expect((await baseline).status()).toBe(200);
      await expect(dialog.getByLabel('姓名', { exact: true })).toHaveValue('Browser conflict draft');
      await expect(dialog.getByLabel('电话', { exact: true })).toHaveValue(remote.phone!);
      await expect(dialog.getByRole('button', { name: /保存资料$/ })).not.toHaveClass(/ant-btn-loading/);
      await expect(dialog.getByRole('button', { name: /保存资料$/ })).toBeEnabled();
      await enterDraft(page, original);
      await saveProfile(page);
      await closeSettings(page);
      await page.reload();
      dialog = await settings(page);
      for (const [label, value] of [['姓名', original.fullName ?? ''], ['电话', original.phone ?? ''], ['邮箱', original.email ?? '']]) {
        await expect(dialog.getByLabel(label, { exact: true })).toHaveValue(value);
      }
      await closeSettings(page);
    } finally {
      if (touched) {
        const current = await read<Profile>(page.request, '/api/v1/me');
        await writeJSON<Profile>(page.request, '/api/v1/me', 'PATCH', { fullName: original.fullName, phone: original.phone, email: original.email ?? null, expectedProfileVersion: current.profileVersion });
        expect(await read<Profile>(page.request, '/api/v1/me')).toMatchObject({ fullName: original.fullName, phone: original.phone, email: original.email ?? null, emailVerifiedAt: original.emailVerifiedAt });
      }
    }
  });
}

test('REQ22 internal: signature summary exposes label/status/times without fingerprint or source data', async ({ page, admin }) => {
  if (!['e-signature:signatures:read', 'e-signature:signatures:write'].every(code => admin.permissions.includes(code))) {
    throw new Error('Signature acceptance requires real signature read/write permissions.');
  }
  const material = unique('Disposable signature material');
  const signature = await writeJSON<Schema['ESignatureDto']>(page.request, '/api/v1/e-signatures', 'POST', { label: unique('Browser signature'), signatureData: material }, 201);
  try {
    await page.goto('/app/account');
    await expect(page.getByText('正在加载任职与授权', { exact: true })).toHaveCount(0);
    await expect(page.getByRole('region', { name: '账号与授权', exact: true }).getByText(/^有效角色 ·/)).toBeVisible();
    const pending = page.waitForResponse(response => new URL(response.url()).pathname === '/api/v1/e-signatures/mine/summary');
    await settings(page);
    const response = await pending;
    expect(response.status()).toBe(200);
    const summary = await response.json() as Schema['ESignatureSummaryDto'][];
    expect(summary.some(item => item.id === signature.id && item.label === signature.label && item.status === 'ACTIVE')).toBe(true);
    const keys = ['id', 'label', 'status', 'version', 'createdAt', 'revokedAt'].sort();
    for (const item of summary) expect(Object.keys(item).sort()).toEqual(keys);
    const serialized = JSON.stringify(summary);
    expect(serialized.includes(signature.fingerprint) || serialized.includes(material)).toBe(false);
    const region = page.getByRole('region', { name: '签名摘要', exact: true });
    await expect(region.getByText(signature.label, { exact: true })).toBeVisible();
    await expect(region.getByText('有效', { exact: true }).first()).toBeVisible();
    await expect(region.getByText('创建时间', { exact: true }).first()).toBeVisible();
    expect((await region.innerText()).includes(signature.fingerprint) || (await region.innerText()).includes(material)).toBe(false);
    await expect(region.getByLabel('签名原文', { exact: true })).toHaveValue('');
    await closeSettings(page);
  } finally {
    // 旧 controller 的 @Post 未设置 HttpCode，实际返回 201；Swagger 仍声明 200，待独立契约维护。
    expect((await write(page.request, `/api/v1/e-signatures/${signature.id}/revoke`, 'POST', { expectedVersion: signature.version })).status()).toBe(201);
  }
});

// 历史 DIRECT + POSITION 同角色去重/逐源撤销由真实 PG effective-role-consumers、position-role-governance 保留；不重开旧写 API。
test('REQ22/24 C2: UI position permissions and concurrent appointments; distinct POSITION sources, deduplicated permissions and session revocation', async ({ page, browser, admin }) => {
  test.setTimeout(240_000);
  const client = page.request;
  const organizationPath = `/api/v1/organizations/${admin.id}`;
  const secret = `${randomUUID()}Aa9!`;
  const created: { user?: Schema['AdminUserDto']; grants: PositionGrant[] } = { grants: [] };
  let hasPrimaryError = false;
  let phase = '准备真实部门和岗位自有权限';
  const probe = await browser.newContext({ baseURL });
  try {
    const [first, second] = await test.step(phase, async () => {
      const first = await createPositionGrant(client, admin.id, { name: unique('Browser Position A'), permissionCodes: [] });
      created.grants.push(first);
      const second = await createPositionGrant(client, admin.id, { name: unique('Browser Position B'), permissionCodes: ['task:read'] });
      created.grants.push(second);
      return [first, second] as const;
    });
    await test.step(phase = '通过岗位权限界面授予任务读取权限', async () => {
      await page.goto('/app/admin');
      await page.getByRole('tab', { name: '部门岗位', exact: true }).click();
      await page.getByRole('tab', { name: '岗位', exact: true }).click();
      const positionRow = await rowWith(page.getByRole('tabpanel', { name: '岗位', exact: true }), page, first.position.name);
      await positionRow.getByRole('button', { name: '岗位权限', exact: true }).click();
      const drawer = page.getByRole('dialog', { name: `${first.position.name} · 岗位权限`, exact: true });
      await expect(drawer.getByText('岗位权限保存后，当前有效任职会自动生效。', { exact: true })).toBeVisible();
      await drawer.getByRole('textbox', { name: '搜索权限', exact: true }).fill('task:read');
      await drawer.getByRole('checkbox', { name: /任务.*查看授权任务/ }).check();
      const permissionPath = `${organizationPath}/positions/${first.position.id}/permissions`;
      const pending = page.waitForResponse(response => new URL(response.url()).pathname === permissionPath && response.request().method() === 'PUT');
      await drawer.getByRole('button', { name: '保存', exact: true }).click();
      expect((await pending).status()).toBe(200);
      expect((await read<Schema['PositionPermissionsDto']>(client, permissionPath)).permissionCodes).toEqual(['task:read']);
      await drawer.getByRole('textbox', { name: '搜索权限', exact: true }).focus();
      await page.keyboard.press('Escape');
      await expect(drawer).not.toBeVisible();
    });
    const user = created.user = await createPositionUser(client, admin.id, [first.position.id], { username: unique('browser_user'), initialPassword: secret });
    await page.goto('/app/admin');
    await page.getByRole('tab', { name: '用户', exact: true }).click();
    await page.getByLabel('搜索用户', { exact: true }).fill(user.username);
    await page.getByLabel('搜索用户', { exact: true }).press('Enter');
    const userRow = page.getByRole('row').filter({ has: page.getByText(user.username, { exact: true }) });
    const openAppointments = async () => {
      await userRow.getByRole('button', { name: /^调\s*岗$/ }).click();
      const dialog = page.getByRole('dialog', { name: `${user.username} · 用户任职`, exact: true });
      await expect(dialog.getByRole('combobox', { name: '任职岗位', exact: true })).toBeEnabled();
      return dialog;
    };
    const saveAppointments = async (dialog: Locator, expectedPositionIds: string[], positionIds: string[]) => {
      await confirmPositionPreview(page, dialog, admin.id);
      const pending = page.waitForResponse(response => new URL(response.url()).pathname === `${organizationPath}/users/${user.id}/positions` && response.request().method() === 'PUT');
      await dialog.getByRole('button', { name: '保存任职', exact: true }).click();
      const saved = await pending;
      expect(saved.status()).toBe(200);
      const body = saved.request().postDataJSON() as Schema['ReplaceUserPositionsWithPreviewDto'];
      expect([...body.expectedPositionIds].sort()).toEqual([...expectedPositionIds].sort());
      expect([...body.positionIds].sort()).toEqual([...positionIds].sort());
      expect(body.authorizationBaseline).toBeTruthy();
      await expect(dialog).not.toBeVisible();
    };
    await test.step(phase = '通过管理界面兼岗并核对两岗位来源及权限去重', async () => {
      const dialog = await openAppointments();
      await choosePosition(page, dialog, second.position);
      await saveAppointments(dialog, [first.position.id], [first.position.id, second.position.id]);
      const roles = await read<Schema['AdminUserRolesDto']>(client, pathFor(`users/${user.id}/roles`, admin.id));
      expect(roles.roles).toEqual([]);
      expect(roles.permissions).toEqual(['task:read']);
      expect(roles.effectiveRoles).toHaveLength(2);
      for (const grant of [first, second]) {
        expect(roles.effectiveRoles.find(role => role.id === grant.role.id)?.sources).toEqual([expect.objectContaining({ kind: 'POSITION', positionId: grant.position.id })]);
      }
      await userRow.getByRole('button', { name: '查看授权来源', exact: true }).click();
      const sources = page.getByRole('dialog', { name: `${user.username} · 授权来源`, exact: true });
      await expect(sources.getByText('历史授权仅供查看，内部用户请通过调岗管理权限。', { exact: true })).toBeVisible();
      for (const grant of [first, second]) await expect(sources.getByText(`岗位继承 · ${grant.position.id}`, { exact: true })).toBeVisible();
      await expect(sources.getByText('task:read', { exact: true })).toHaveCount(1);
      await expect(sources.getByRole('combobox')).toHaveCount(0);
      await expect(sources.getByRole('button', { name: /保存|分配/ })).toHaveCount(0);
      await page.keyboard.press('Escape');
      await expect(sources).not.toBeVisible();
    });
    const target = await test.step(phase = '真实账号登录并核对两岗位来源和任务权限', async () => {
      const target = await probe.newPage();
      await login(target, false, user.username, secret);
      await target.goto('/app/account');
      const overview = await read<Schema['AccountOverviewDto']>(probe.request, '/api/v1/me/overview');
      expect(overview.permissions).toEqual(['task:read']);
      expect(overview.effectiveRoles).toHaveLength(2);
      const authorization = target.getByRole('region', { name: '账号与授权', exact: true });
      await authorization.getByText('角色与权限来源', { exact: true }).click();
      for (const grant of [first, second]) {
        await expect(authorization.getByText(grant.role.name, { exact: true })).toHaveCount(1);
        await expect(authorization.getByText(`岗位继承 · ${grant.position.name}`, { exact: true })).toBeVisible();
        expect(overview.effectiveRoles.find(role => role.id === grant.role.id)?.sources).toEqual([expect.objectContaining({ kind: 'POSITION', positionId: grant.position.id })]);
      }
      await expect(authorization.getByText('直接分配', { exact: true })).toHaveCount(0);
      await expect(authorization.getByText('task:read', { exact: true })).toHaveCount(1);
      expect((await probe.request.get(`/api/v1/tasks?organizationId=${admin.id}`, { timeout: 15_000 })).status()).toBe(200);
      return target;
    });
    await test.step(phase = '撤销一岗仍保留任务权限，撤销最后岗位失效旧会话并拒绝任务访问', async () => {
      const removePosition = async (grant: PositionGrant, expectedPositionIds: string[], remainingIds: string[]) => {
        const dialog = await openAppointments();
        await dialog.locator('.ant-select-selection-item').filter({ hasText: `${grant.position.name} · ${grant.position.code}` }).locator('.ant-select-selection-item-remove').click();
        await saveAppointments(dialog, expectedPositionIds, remainingIds);
      };
      await removePosition(first, [first.position.id, second.position.id], [second.position.id]);
      expect((await probe.request.get('/api/v1/me', { timeout: 15_000 })).status()).toBe(401);
      await login(target, false, user.username, secret);
      const remaining = await read<Schema['AccountOverviewDto']>(probe.request, '/api/v1/me/overview');
      expect(remaining.effectiveRoles).toHaveLength(1);
      expect(remaining.effectiveRoles[0]).toMatchObject({ id: second.role.id, sources: [expect.objectContaining({ kind: 'POSITION', positionId: second.position.id })] });
      expect(remaining.permissions).toEqual(['task:read']);
      expect((await probe.request.get(`/api/v1/tasks?organizationId=${admin.id}`, { timeout: 15_000 })).status()).toBe(200);
      await removePosition(second, [second.position.id], []);
      expect((await probe.request.get('/api/v1/me', { timeout: 15_000 })).status()).toBe(401);
      await login(target, false, user.username, secret);
      const revoked = await read<Schema['AccountOverviewDto']>(probe.request, '/api/v1/me/overview');
      expect(revoked.effectiveRoles).toEqual([]);
      expect(revoked.permissions).toEqual([]);
      expect((await probe.request.get(`/api/v1/tasks?organizationId=${admin.id}`, { timeout: 15_000 })).status()).toBe(403);
    });
  } catch (error) {
    hasPrimaryError = true;
    console.warn(`[REQ22/24 C2] ${phase} failed; details redacted.`);
    throw error;
  } finally {
    try {
      await test.step('清理一次性任职并停用账号、岗位和部门', async () => {
        await probe.close();
        // 一次性记录只撤任职并停用；canonical 角色和审计历史随整套一次性资源销毁。
        if (created.user) {
          await replacePositionAppointments(client, admin.id, created.user.id, []);
          await writeJSON<Schema['AdminUserDto']>(client, pathFor(`users/${created.user.id}`, admin.id), 'PATCH', { status: 'DISABLED' });
        }
        for (const grant of created.grants) await retirePositionGrant(client, admin.id, grant);
      }, { timeout: 60_000 });
    } catch (error) {
      if (!hasPrimaryError) throw error;
      console.warn('[REQ22/24 C2] 清理一次性任职并停用夹具失败；保留主错误，详情已脱敏。');
    }
  }
});

test('REQ23/24: existing legacy role count, searchable read-only permission Drawer and focus restoration without writes', async ({ page, admin }) => {
  const rolesPath = pathFor('roles', admin.id);
  const role = (await read<Schema['AdminRoleDto'][]>(page.request, rolesPath)).find(entry => entry.code === 'LOCAL_MEMBER' && entry.organizationId === admin.id);
  if (!role || !role.permissions.some(permission => permission.code === 'task:read')) throw new Error('Disposable seed must retain its existing LOCAL_MEMBER role with task:read; no legacy role writes are allowed.');
  const permissionCodes = [...new Set(role.permissions.map(permission => permission.code))];
  let writes = 0;
  const countWrites = (request: import('@playwright/test').Request) => {
    const path = new URL(request.url()).pathname;
    if ((path.startsWith('/api/v1/admin/') || path.startsWith('/api/v1/organizations/')) && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method())) writes++;
  };
  page.on('request', countWrites);
  try {
    await page.goto('/app/admin');
    await page.getByRole('tab', { name: '历史授权', exact: true }).click();
    const list = page.getByRole('tabpanel', { name: '历史授权', exact: true });
    await expect(list.getByText('新授权请在岗位中维护；历史记录仅供查看。', { exact: true })).toBeVisible();
    await expect(list.getByRole('button', { name: /创建角色|编辑角色|删除角色|复制模板/ })).toHaveCount(0);
    const row = await rowWith(list, page, role.name);
    await expect(row.getByText(new RegExp(`^权限 ${permissionCodes.length} 项`))).toBeVisible();
    const trigger = row.getByRole('button', { name: `${role.name} · 详情`, exact: true });
    await trigger.click();
    const drawer = page.getByRole('dialog', { name: `${role.name} · 详情`, exact: true });
    for (const code of permissionCodes) await expect(drawer.getByText(code, { exact: true })).toBeVisible();
    await expect(drawer.locator('.permission-operation')).toHaveCount(permissionCodes.length);
    await expect(drawer.getByRole('checkbox')).toHaveCount(0);
    await expect(drawer.getByRole('button', { name: /保存|编辑|删除/ })).toHaveCount(0);
    const search = drawer.getByRole('textbox', { name: '搜索权限', exact: true });
    await search.fill('no_matching_permission');
    await expect(drawer.getByText('无匹配权限', { exact: true })).toBeVisible();
    await search.fill('task:read');
    await expect(drawer.locator('.permission-operation')).toHaveCount(1);
    await expect(drawer.getByText('task:read', { exact: true })).toBeVisible();
    await search.focus();
    await page.keyboard.press('Escape');
    await expect(drawer).not.toBeVisible();
    await expect(trigger).toBeFocused();
    expect((await read<Schema['AdminRoleDto'][]>(page.request, rolesPath)).find(entry => entry.id === role.id)).toEqual(role);
    expect(writes).toBe(0);
  } finally { page.off('request', countWrites); }
});
