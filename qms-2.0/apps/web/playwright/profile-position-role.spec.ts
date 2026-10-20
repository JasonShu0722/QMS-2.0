import { randomUUID } from 'node:crypto';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { test as base, expect, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import type { components } from '@qms/contracts';
import { completeMfa } from './mfa-login';
import { fillSecret } from './secret-input';

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
      'account:users:read', 'account:users:create', 'account:users:status', 'account:roles:read', 'account:roles:create',
      'account:roles:delete', 'account:roles:assign', 'task:read'];
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

test('REQ22 C2: save position roles and appointments in UI; direct/position sources; revoke old session', async ({ page, browser, admin }) => {
  test.setTimeout(240_000);
  const client = page.request;
  const organizationPath = `/api/v1/organizations/${admin.id}`;
  const secret = `${randomUUID()}Aa9!`;
  const created: { user?: Schema['AdminUserDto']; department?: Schema['DepartmentDto']; position?: Schema['PositionDto']; role?: Schema['AdminRoleDto'] } = {};
  let hasPrimaryError = false;
  let phase = '准备真实角色、账号、部门和岗位';
  const probe = await browser.newContext({ baseURL });
  try {
    const { role, user, position } = await test.step(phase, async () => {
      const role = created.role = await writeJSON<Schema['AdminRoleDto']>(client, '/api/v1/admin/roles', 'POST', { organizationId: admin.id, code: unique('BrowserRole'), name: unique('Browser Role'), permissionCodes: ['task:read'], mfaRequired: false }, 201);
      const user = created.user = await writeJSON<Schema['AdminUserDto']>(client, '/api/v1/admin/users', 'POST', { organizationId: admin.id, username: unique('browser_user'), initialPassword: secret, accountType: 'INTERNAL' }, 201);
      const department = created.department = await writeJSON<Schema['DepartmentDto']>(client, `${organizationPath}/departments`, 'POST', { code: unique('BDEP'), name: unique('Browser Department') }, 201);
      const position = created.position = await writeJSON<Schema['PositionDto']>(client, `${organizationPath}/positions`, 'POST', { code: unique('BPOS'), name: unique('Browser Position'), departmentId: department.id }, 201);
      await writeJSON<Schema['AdminUserRolesDto']>(client, pathFor(`users/${user.id}/roles`, admin.id), 'PUT', { roleIds: [role.id] });
      return { role, user, position };
    });
    const mappingPath = `${organizationPath}/positions/${position.id}/roles`;
    const openMapping = async () => {
      const positionRow = await rowWith(page.getByRole('tabpanel', { name: '岗位', exact: true }), page, position.name);
      await positionRow.getByRole('button', { name: '岗位角色', exact: true }).click();
      const drawer = page.getByRole('dialog', { name: `${position.name} · 岗位角色`, exact: true });
      await expect(drawer.getByRole('combobox', { name: '岗位角色', exact: true })).toBeEnabled();
      return drawer;
    };
    await test.step(phase = '通过管理界面保存岗位角色映射', async () => {
      await page.goto('/app/admin');
      await page.getByRole('tab', { name: '部门岗位', exact: true }).click();
      await page.getByRole('tab', { name: '岗位', exact: true }).click();
      const drawer = await openMapping();
      await expect(drawer.getByText('岗位角色保存后，当前有效任职会自动生效。', { exact: true })).toBeVisible();
      await drawer.getByRole('combobox', { name: '岗位角色', exact: true }).click();
      await page.locator('.ant-select-dropdown:visible .ant-select-item-option').filter({ hasText: role.name }).click();
      await drawer.getByText('岗位角色保存后，当前有效任职会自动生效。', { exact: true }).click();
      const pending = page.waitForResponse(response => new URL(response.url()).pathname === mappingPath && response.request().method() === 'PUT');
      await drawer.getByRole('button', { name: '保存', exact: true }).click();
      expect((await pending).status()).toBe(200);
      const configuration = await read<Schema['PositionRolesDto']>(client, mappingPath);
      expect(configuration.roles.map(entry => entry.id)).toEqual([role.id]);
      await drawer.getByRole('combobox', { name: '岗位角色', exact: true }).focus();
      await page.keyboard.press('Escape');
      await expect(drawer).not.toBeVisible();
    });
    await test.step(phase = '通过管理界面保存任职并核对双来源', async () => {
      await page.getByRole('tab', { name: '用户任职', exact: true }).click();
      const userSelect = page.getByRole('combobox', { name: '用户', exact: true });
      await userSelect.fill(user.username);
      await page.locator('.ant-select-dropdown:visible .ant-select-item-option').filter({ hasText: user.username }).click();
      await page.getByRole('button', { name: '查看任职', exact: true }).click();
      await page.getByRole('combobox', { name: '岗位', exact: true }).click();
      await page.locator('.ant-select-dropdown:visible .ant-select-item-option').filter({ hasText: position.name }).click();
      await page.getByRole('combobox', { name: '岗位', exact: true }).press('Escape');
      const assignmentPath = `${organizationPath}/users/${user.id}/positions`;
      const pending = page.waitForResponse(response => new URL(response.url()).pathname === assignmentPath && response.request().method() === 'PUT');
      await page.getByRole('button', { name: '保存任职', exact: true }).click();
      expect((await pending).status()).toBe(200);
      await expect(page.getByRole('tabpanel', { name: '用户任职', exact: true }).getByRole('row').filter({ has: page.getByText(position.name, { exact: true }) })).toBeVisible();
      const roles = await read<Schema['AdminUserRolesDto']>(client, pathFor(`users/${user.id}/roles`, admin.id));
      expect(roles.roles.map(entry => entry.id)).toEqual([role.id]);
      expect(roles.effectiveRoles.filter(entry => entry.id === role!.id)).toHaveLength(1);
      expect(roles.effectiveRoles.find(entry => entry.id === role!.id)?.sources).toEqual(expect.arrayContaining([{ kind: 'DIRECT' }, expect.objectContaining({ kind: 'POSITION', positionId: position.id })]));
    });
    await test.step(phase = '核对管理页直接与岗位继承来源', async () => {
      // 管理页也须显示继承来源，并明确继承不写入直接角色选择器。
      await page.getByRole('tab', { name: '用户', exact: true }).click();
      await page.getByLabel('搜索用户', { exact: true }).fill(user.username);
      await page.getByLabel('搜索用户', { exact: true }).press('Enter');
      const userRow = page.getByRole('row').filter({ has: page.getByText(user.username, { exact: true }) });
      await userRow.getByRole('button', { name: '分配角色', exact: true }).click();
      const sources = page.getByRole('dialog', { name: `${user.username} · 组织角色`, exact: true });
      await expect(sources.getByText('岗位继承角色只读，不会保存为直接分配。', { exact: true })).toBeVisible();
      await expect(sources.getByText('直接分配', { exact: true })).toBeVisible();
      await expect(sources.getByText(`岗位继承 · ${position.id}`, { exact: true })).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(sources).not.toBeVisible();
      await page.getByRole('tab', { name: '部门岗位', exact: true }).click();
    });
    const target = await test.step(phase = '真实账号登录并核对来源和任务权限', async () => {
      const target = await probe.newPage();
      await login(target, false, user.username, secret);
      await target.goto('/app/account');
      const authorization = target.getByRole('region', { name: '账号与授权', exact: true });
      await authorization.getByText('角色与权限来源', { exact: true }).click();
      await expect(authorization.getByText(role.name, { exact: true })).toHaveCount(1);
      await expect(authorization.getByText('直接分配', { exact: true })).toBeVisible();
      await expect(authorization.getByText(`岗位继承 · ${position.name}`, { exact: true })).toBeVisible();
      expect((await probe.request.get(`/api/v1/tasks?organizationId=${admin.id}`, { timeout: 15_000 })).status()).toBe(200);
      return target;
    });
    await test.step(phase = '撤销岗位映射及直接角色并核对旧会话失效', async () => {
      await page.getByRole('tab', { name: '岗位', exact: true }).click();
      const drawer = await openMapping();
      await expect(drawer.getByText('当前有效任职人数：1', { exact: true })).toBeVisible();
      await drawer.getByRole('combobox', { name: '岗位角色', exact: true }).focus();
      await page.keyboard.press('Backspace');
      await expect(drawer.locator('.ant-select-selection-item')).toHaveCount(0);
      const pending = page.waitForResponse(response => new URL(response.url()).pathname === mappingPath && response.request().method() === 'PUT');
      await drawer.getByRole('button', { name: '保存', exact: true }).click();
      expect((await pending).status()).toBe(200);
      expect((await read<Schema['PositionRolesDto']>(client, mappingPath)).roles).toHaveLength(0);
      expect((await probe.request.get('/api/v1/me', { timeout: 15_000 })).status()).toBe(401);
      await login(target, false, user.username, secret);
      const remaining = await read<Schema['AccountOverviewDto']>(probe.request, '/api/v1/me/overview');
      expect(remaining.effectiveRoles.find(entry => entry.id === role!.id)?.sources).toEqual([{ kind: 'DIRECT' }]);
      expect((await probe.request.get(`/api/v1/tasks?organizationId=${admin.id}`, { timeout: 15_000 })).status()).toBe(200);
      await writeJSON<Schema['AdminUserRolesDto']>(client, pathFor(`users/${user.id}/roles`, admin.id), 'PUT', { roleIds: [] });
      expect((await probe.request.get('/api/v1/me', { timeout: 15_000 })).status()).toBe(401);
      await login(target, false, user.username, secret);
      expect((await probe.request.get(`/api/v1/tasks?organizationId=${admin.id}`, { timeout: 15_000 })).status()).toBe(403);
    });
  } catch (error) {
    hasPrimaryError = true;
    console.warn(`[REQ22 C2] ${phase} failed; details redacted.`);
    throw error;
  } finally {
    try {
      await test.step('清理一次性授权并停用夹具', async () => {
        const { role, user, position, department } = created;
        await probe.close();
        // 一次性记录只撤销授权并停用；结构/审计历史由主代理销毁整套一次性资源。
        if (position) {
          const mapping = await read<Schema['PositionRolesDto']>(client, `${organizationPath}/positions/${position.id}/roles`);
          await writeJSON<Schema['PositionRolesDto']>(client, `${organizationPath}/positions/${position.id}/roles`, 'PUT', { roleIds: [], expectedRoleVersion: mapping.roleVersion });
        }
        if (user) {
          const appointments = await read<Schema['UserPositionDto'][]>(client, `${organizationPath}/users/${user.id}/positions`);
          const now = Date.now();
          const activeIds = [...new Set(appointments.filter(entry => Date.parse(entry.startedAt) <= now && (!entry.endedAt || Date.parse(entry.endedAt) > now)).map(entry => entry.positionId))];
          await writeJSON<Schema['UserPositionDto'][]>(client, `${organizationPath}/users/${user.id}/positions`, 'PUT', { positionIds: [], expectedPositionIds: activeIds });
          await writeJSON<Schema['AdminUserRolesDto']>(client, pathFor(`users/${user.id}/roles`, admin.id), 'PUT', { roleIds: [] });
          await writeJSON<Schema['AdminUserDto']>(client, pathFor(`users/${user.id}`, admin.id), 'PATCH', { status: 'DISABLED' });
        }
        if (role) expect((await write(client, pathFor(`roles/${role.id}`, admin.id), 'DELETE')).status()).toBe(204);
        if (position) await writeJSON<Schema['PositionDto']>(client, `${organizationPath}/positions/${position.id}`, 'PATCH', { status: 'DISABLED', expectedVersion: position.version });
        if (department) await writeJSON<Schema['DepartmentDto']>(client, `${organizationPath}/departments/${department.id}`, 'PATCH', { status: 'DISABLED', expectedVersion: department.version });
      }, { timeout: 60_000 });
    } catch (error) {
      if (!hasPrimaryError) throw error;
      console.warn('[REQ22 C2] 清理一次性授权并停用夹具失败；保留主错误，详情已脱敏。');
    }
  }
});

test('REQ23: real role count, searchable read-only permission Drawer and focus restoration', async ({ page, admin }) => {
  const role = await writeJSON<Schema['AdminRoleDto']>(page.request, '/api/v1/admin/roles', 'POST', { organizationId: admin.id, code: unique('DetailRole'), name: unique('Browser Details'), permissionCodes: ['task:read'], mfaRequired: false }, 201);
  try {
    await page.goto('/app/admin');
    await page.getByRole('tab', { name: '角色', exact: true }).click();
    const row = await rowWith(page.getByRole('tabpanel', { name: '角色', exact: true }), page, role.name);
    await expect(row.getByText(/^权限 1 项/)).toBeVisible();
    const trigger = row.getByRole('button', { name: `${role.name} · 详情`, exact: true });
    let writes = 0;
    const countWrites = (request: import('@playwright/test').Request) => {
      if (new URL(request.url()).pathname.startsWith('/api/v1/admin/') && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method())) writes++;
    };
    page.on('request', countWrites);
    try {
      await trigger.click();
      const drawer = page.getByRole('dialog', { name: `${role.name} · 详情`, exact: true });
      await expect(drawer.getByText('task:read', { exact: true })).toBeVisible();
      await expect(drawer.locator('.permission-operation')).toHaveCount(1);
      await expect(drawer.getByRole('checkbox')).toHaveCount(0);
      await expect(drawer.getByRole('button', { name: /保存|编辑|删除/ })).toHaveCount(0);
      const search = drawer.getByRole('textbox', { name: '搜索权限', exact: true });
      await search.fill('no_matching_permission');
      await expect(drawer.getByText('无匹配权限', { exact: true })).toBeVisible();
      await search.fill('task:read');
      await expect(drawer.locator('.permission-operation')).toHaveCount(1);
      await drawer.getByRole('textbox', { name: '搜索权限', exact: true }).focus();
      await page.keyboard.press('Escape');
      await expect(drawer).not.toBeVisible();
      await expect(trigger).toBeFocused();
      expect(writes).toBe(0);
    } finally { page.off('request', countWrites); }
    expect((await read<Schema['AdminRoleDto'][]>(page.request, pathFor('roles', admin.id))).find(entry => entry.id === role.id)).toEqual(role);
  } finally { expect((await write(page.request, pathFor(`roles/${role.id}`, admin.id), 'DELETE')).status()).toBe(204); }
});
