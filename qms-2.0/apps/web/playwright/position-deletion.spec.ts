import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import type { components } from '@qms/contracts';
import { completeMfa } from './mfa-login';
import { changePositionPermissions, createPositionUser, positionRead, positionWrite } from './position-fixture';
import { fillSecret } from './secret-input';

type Schema = components['schemas'];
const gateway = process.env.QMS_ACCEPTANCE_BASE_URL ?? process.env.PLAYWRIGHT_BASE_URL;
const password = process.env.QMS_SEED_INTERNAL_PASSWORD;

test.use({ viewport: { width: 1440, height: 900 }, actionTimeout: 10_000, navigationTimeout: 15_000 });

test('#178: console position layout and explicit ordinary versus force deletion', async ({ page, baseURL, browser, browserName }, info) => {
  test.setTimeout(120_000);
  if (!gateway || baseURL !== gateway || !password || password.length < 16 || browserName !== 'chromium' || info.config.workers !== 1) {
    throw new Error('Use one Chromium worker with the disposable gateway and a generated seed password.');
  }
  await page.goto('/login');
  await page.getByLabel('账号', { exact: true }).fill('local.internal');
  await fillSecret(page.getByLabel('密码', { exact: true }), password);
  const login = page.waitForResponse(response => new URL(response.url()).pathname === '/api/v1/auth/login' && response.request().method() === 'POST');
  await page.getByRole('button', { name: /^登\s*录$/ }).click();
  await completeMfa(page.request, await login, 'local.internal', page);
  await expect(page).toHaveURL(/\/app\/workbench$/);

  const me = await positionRead<Schema['AccountProfileDto']>(page.request, '/api/v1/me');
  expect(me.organization.code).toBe('LOCAL-INTERNAL');
  const permissions = await positionRead<Schema['PermissionsResponseDto']>(page.request, '/api/v1/system/my-permissions');
  expect(permissions.permissions).toContain('organization:positions:force-delete');
  const org = `/api/v1/organizations/${me.organization.id}`;
  const suffix = randomUUID().slice(0, 8);
  const department = await positionWrite<Schema['DepartmentDto']>(page.request, `${org}/departments`, 'POST', {
    code: `B${suffix}`, name: `制程与供应商质量改进联合管理部门 ${suffix}`,
  }, 201);
  const createPosition = (code: string, name: string) => positionWrite<Schema['PositionDto']>(page.request, `${org}/positions`, 'POST', { code, name, departmentId: department.id }, 201);
  const target = await createPosition(`D${suffix}`, `制程不良与供应商改善专项质量工程师 ${suffix}`);
  const retained = await createPosition(`K${suffix}`, `保留岗位 ${suffix}`);
  const occupied = await createPosition(`F${suffix}`, `在用岗位 ${suffix}`);
  await changePositionPermissions(page.request, me.organization.id, retained.id, ['workbench:read']);
  await changePositionPermissions(page.request, me.organization.id, occupied.id, ['organization:structure:read']);
  const member = await createPositionUser(page.request, me.organization.id, [occupied.id, retained.id], {
    username: `b178_${suffix}`, fullName: `双岗位验收 ${suffix}`, initialPassword: `Aa9!${randomUUID()}`,
  });
  const appointments = () => positionRead<Schema['UserPositionDto'][]>(page.request, `${org}/users/${member.id}/positions?limit=100&offset=0`);
  const before = await appointments();
  expect(before.filter(entry => entry.endedAt === null).map(entry => entry.positionId).sort()).toEqual([occupied.id, retained.id].sort());
  const targetPath = `${org}/positions/${target.id}`;

  await page.goto('/console');
  const menu = page.getByRole('navigation', { name: '管理导航', exact: true });
  const group = menu.getByRole('button', { name: '组织与授权', exact: true });
  await expect(group).toBeVisible();
  if (await group.getAttribute('aria-expanded') !== 'true') await group.click();
  const organizations = menu.getByRole('link', { name: '组织与岗位', exact: true });
  await organizations.click();
  await expect(page).toHaveURL(/\/console\/organizations(?:\?|$)/);
  const tree = page.getByRole('complementary', { name: '组织架构导航', exact: true });
  const departmentNode = tree.getByRole('button', { name: `${department.name} · 部门/科室`, exact: true });
  await departmentNode.click();
  await expect(departmentNode).toHaveAttribute('aria-pressed', 'true');
  const positionTab = page.getByRole('tab', { name: '岗位', exact: true });
  await positionTab.click();
  const panel = page.getByRole('tabpanel', { name: '岗位', exact: true });
  const row = panel.getByRole('row').filter({ has: page.getByRole('cell', { name: target.name, exact: true }) });
  const peer = panel.getByRole('row').filter({ has: page.getByRole('cell', { name: retained.name, exact: true }) });
  const remove = row.getByRole('button', { name: `删除岗位 · ${target.name}`, exact: true });
  const scroll = panel.locator('.position-structure-table :is(.ant-table-body, .ant-table-content):visible');
  await expect(row.getByRole('cell', { name: department.name, exact: true })).toBeVisible();
  await expect(peer).toBeVisible();
  await expect(organizations).toHaveAttribute('aria-current', 'page');
  await expect(menu).toBeVisible();
  await expect(tree).toBeVisible();

  const geometry = [];
  for (const width of [1440, 1024, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    const metrics = await scroll.evaluate(element => {
      element.scrollLeft = 0;
      const clip = element.getBoundingClientRect();
      const root = document.documentElement;
      return { left: clip.left, right: clip.right, clientWidth: element.clientWidth, scrollWidth: element.scrollWidth, documentWidth: root.scrollWidth, overflow: getComputedStyle(element).overflowX };
    });
    const actions = await row.getByRole('button').evaluateAll(buttons => buttons.map(button => {
      const { left, right, top } = button.getBoundingClientRect();
      return { left, right, top };
    }));
    geometry.push({ width, ...metrics, actions });
    expect.soft(metrics.documentWidth, `${width}px document width`).toBeLessThanOrEqual(width + 1);
    expect.soft(metrics.left, `${width}px table left edge`).toBeGreaterThanOrEqual(-1);
    expect.soft(metrics.right, `${width}px table right edge`).toBeLessThanOrEqual(width + 1);
    expect.soft(actions, `${width}px position action count`).toHaveLength(3);
    if (width === 1440) {
      expect.soft(Math.max(...actions.map(action => action.right)), '1440px actions fit without horizontal scrolling').toBeLessThanOrEqual(metrics.right + 1);
      expect.soft(new Set(actions.map(action => Math.round(action.top))).size, '1440px actions share a row').toBe(1);
    } else if (metrics.scrollWidth > metrics.clientWidth) {
      expect.soft(metrics.overflow, `${width}px local horizontal scrolling`).toMatch(/^(auto|scroll)$/);
    }
    await remove.scrollIntoViewIfNeeded();
    await remove.click({ trial: true });
  }
  console.log(JSON.stringify({ chromium: browser.version(), geometry }));
  await info.attach('position-list-geometry', { body: JSON.stringify({ chromium: browser.version(), geometry }, null, 2), contentType: 'application/json' });

  const deleteRequests: string[] = [];
  page.on('request', request => {
    if (request.method() === 'DELETE' && new URL(request.url()).pathname === targetPath) deleteRequests.push(request.method());
  });
  await remove.focus();
  await expect(remove).toBeFocused();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: `删除岗位 · ${target.name} · ${target.code}`, exact: true });
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect.soft(remove).toBeFocused();
  expect(deleteRequests).toHaveLength(0);
  await expect(row).toBeVisible();

  await remove.press('Enter');
  await expect(dialog).toBeVisible();
  const deleted = page.waitForResponse(response => new URL(response.url()).pathname === targetPath && response.request().method() === 'DELETE');
  const reloaded = page.waitForResponse(response => new URL(response.url()).pathname === `${org}/positions` && response.request().method() === 'GET');
  await dialog.getByRole('button', { name: '确认删除', exact: true }).press('Enter');
  expect((await deleted).status()).toBe(200);
  expect((await reloaded).status()).toBe(200);
  await expect(dialog).toBeHidden();
  await expect(departmentNode).toHaveAttribute('aria-pressed', 'true');
  if (await positionTab.getAttribute('aria-selected') !== 'true') await positionTab.click();
  await expect(peer).toBeVisible();
  await expect(row).toHaveCount(0);
  expect(deleteRequests).toHaveLength(1);

  await test.step('occupied position requires a separate preview and explicit force confirmation', async () => {
    const occupiedPath = `${org}/positions/${occupied.id}`;
    const forcePath = `${occupiedPath}/force-delete`;
    const forceRequests: string[] = [];
    page.on('request', request => {
      if (new URL(request.url()).pathname === forcePath) forceRequests.push(request.method());
    });
    const receive = (path: string, method: string) => page.waitForResponse(response => new URL(response.url()).pathname === path && response.request().method() === method);
    const occupiedRow = panel.getByRole('row').filter({ has: page.getByRole('cell', { name: occupied.name, exact: true }) });
    const open = occupiedRow.getByRole('button', { name: `删除岗位 · ${occupied.name}`, exact: true });
    const ordinary = page.getByRole('dialog', { name: `删除岗位 · ${occupied.name} · ${occupied.code}`, exact: true });
    await page.setViewportSize({ width: 1440, height: 900 });
    await open.click();
    const blocked = receive(occupiedPath, 'DELETE');
    await ordinary.getByRole('button', { name: '确认删除', exact: true }).click();
    const rejection = await blocked;
    expect(rejection.status()).toBe(409);
    expect((await rejection.json()).code).toBe('STRUCTURE_REFERENCE_INVALID');
    await expect(occupiedRow).toBeVisible();
    expect(forceRequests).toEqual([]);
    expect(await appointments()).toEqual(before);

    const inspect = async () => {
      const response = receive(forcePath, 'GET');
      await ordinary.getByRole('button', { name: '查看强制删除影响', exact: true }).click();
      const result = await response;
      expect(result.status()).toBe(200);
      return await result.json() as Schema['OrganizationForceDeletePreviewDto'];
    };
    const force = page.getByRole('dialog', { name: `强制删除 · ${occupied.name} · ${occupied.code}`, exact: true });
    const first = await inspect();
    expect(first).toMatchObject({ id: occupied.id, kind: 'POSITION', counts: { assignments: 1, users: 1 }, positionImpact: { users: [{ id: member.id, pendingConfiguration: false }] } });
    await expect(force.getByText(`${member.fullName} · 保留其他任职`, { exact: true })).toBeVisible();
    await force.getByRole('button', { name: /^取\s*消$/ }).click();
    await expect(force).toBeHidden();
    await expect(occupiedRow).toBeVisible();
    expect(forceRequests).toEqual(['GET']);
    expect(await appointments()).toEqual(before);

    await open.click();
    const preview = await inspect();
    const committed = receive(forcePath, 'POST');
    const refreshed = receive(`${org}/positions`, 'GET');
    await force.getByRole('button', { name: '确认强制删除', exact: true }).click();
    const result = await committed;
    expect(result.status()).toBe(201);
    const confirmation = result.request().postDataJSON() as Schema['OrganizationForceDeleteDto'];
    expect(confirmation.confirmed).toBe(true);
    expect(confirmation.expectedVersion).toBe(preview.version);
    expect(confirmation.previewToken === preview.previewToken).toBe(true);
    expect((await refreshed).status()).toBe(200);
    await expect(force).toBeHidden();
    await expect(departmentNode).toHaveAttribute('aria-pressed', 'true');
    if (await positionTab.getAttribute('aria-selected') !== 'true') await positionTab.click();
    await expect(peer).toBeVisible();
    await expect(occupiedRow).toHaveCount(0);
    expect(forceRequests).toEqual(['GET', 'GET', 'POST']);
    const after = await appointments();
    expect(after.find(entry => entry.positionId === retained.id)).toEqual(before.find(entry => entry.positionId === retained.id));
    expect(after.find(entry => entry.positionId === occupied.id)?.endedAt).toEqual(expect.any(String));
  });
});
