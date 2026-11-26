import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { completeMfa } from './mfa-login';
import { fillSecret } from './secret-input';

const path = '/app/process-quality/problems';
const endpoint = '/api/v1/problem-index/process-followup';

function followupResponse(page: Page, matches: (query: URLSearchParams) => boolean) {
  const observed: string[] = [];
  return page.waitForResponse(response => {
    const url = new URL(response.url());
    if (url.pathname !== endpoint || response.request().method() !== 'GET') return false;
    observed.push(`${response.status()} ${url.searchParams}`);
    return matches(url.searchParams);
  }, { timeout: 25_000 }).catch(error => {
    throw new Error(`Expected follow-up request did not finish: ${observed.join('; ') || 'none seen'}`, { cause: error });
  });
}

function hasCondition(query: URLSearchParams, field: string, value: string) {
  const group = JSON.parse(query.get('filters') ?? '{"items":[]}') as { items: { field: string; value: string }[] };
  return group.items.some(item => item.field === field && item.value === value);
}

test.use({ viewport: { width: 1440, height: 900 }, actionTimeout: 10_000 });

test('#177: anchored follow-up filters, names, overdue organization scope and detail return', async ({ page, baseURL, browserName, browser }) => {
  test.setTimeout(90_000);
  const fixturePath = process.env.QMS_177_BROWSER_FIXTURE;
  const password = process.env.QMS_SEED_INTERNAL_PASSWORD;
  const gateway = baseURL && new URL(baseURL);
  if (!gateway || gateway.protocol !== 'http:' || gateway.hostname !== '127.0.0.1' || !gateway.port || gateway.port === '55440'
    || process.env.QMS_DISPOSABLE_TEST_DB !== 'true' || !fixturePath || !password || browserName !== 'chromium') {
    throw new Error('Use real Chromium with a disposable loopback gateway and external seeded fixture.');
  }
  const fixture = JSON.parse(readFileSync(fixturePath, 'utf8')) as { homeId: string; targetId: string };
  await test.step('Log in through the gateway and load the home organization', async () => {
    await page.goto('/login');
    await page.getByLabel('账号', { exact: true }).fill('local.internal');
    await fillSecret(page.getByLabel('密码', { exact: true }), password);
    const login = page.waitForResponse(response => new URL(response.url()).pathname === '/api/v1/auth/login' && response.request().method() === 'POST');
    await page.getByRole('button', { name: /^登\s*录$/ }).click();
    await completeMfa(page.request, await login, 'local.internal', page);
    await expect(page).toHaveURL(/\/app\/workbench$/);

    const [home] = await Promise.all([
      followupResponse(page, query => query.get('organizationId') === fixture.homeId),
      page.goto(`${path}?organizationId=${fixture.homeId}`),
    ]);
    expect(home.status()).toBe(200);
    await expect(page.getByRole('link', { name: 'A3-HOME-OLD', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'A3-FOREIGN-OLD', exact: true })).toHaveCount(0);
  });

  const toolbarFilter = page.getByRole('button', { name: '筛选条件', exact: true });
  const stageFilter = page.getByRole('button', { name: '按当前环节筛选', exact: true });
  const filter = page.getByRole('dialog', { name: '筛选面板', exact: true });
  const field = (index: number) => filter.getByLabel(`筛选字段 ${index}`, { exact: true });
  const value = (index: number) => filter.getByLabel(`筛选值 ${index}`, { exact: true });
  const stage = value(1);
  const add = () => filter.getByRole('button', { name: '添加筛选条件', exact: true }).click();
  const apply = () => filter.getByRole('button', { name: '应用筛选', exact: true }).click();
  const overdue = filter.getByRole('checkbox', { name: '仅看当前已逾期', exact: true });
  const homeReport = page.getByRole('link', { name: 'A3-HOME-OLD', exact: true });
  const oldReport = page.getByRole('link', { name: 'A3-FOREIGN-OLD', exact: true });
  const futureReport = page.getByRole('link', { name: 'A3-FOREIGN-FUTURE', exact: true });

  await test.step('Check floating geometry and shared header and toolbar filter state', async () => {
    const original = (await homeReport.boundingBox())!;
    await toolbarFilter.click();
    await expect(filter).toBeVisible();
    const anchor = (await toolbarFilter.boundingBox())!;
    const popup = (await filter.boundingBox())!;
    expect.soft(popup.y - (anchor.y + anchor.height)).toBeGreaterThanOrEqual(-2);
    expect.soft(popup.y - (anchor.y + anchor.height)).toBeLessThan(28);
    expect.soft(Math.abs((await homeReport.boundingBox())!.y - original.y)).toBeLessThanOrEqual(2);
    await expect(filter.getByLabel('搜索报告编号或问题标题', { exact: true })).toHaveCount(0);
    await add();
    await expect(field(1)).toHaveValue('stage');
    await stage.selectOption('ANALYSIS');
    const response = followupResponse(page, query => hasCondition(query, 'stage', 'ANALYSIS'));
    await apply();
    expect((await response).status()).toBe(200);
    await expect(stageFilter).toHaveAttribute('aria-pressed', 'true');
    await stageFilter.click();
    await expect(stage).toHaveValue('ANALYSIS');
    await expect(field(1)).toBeFocused();
  });

  await test.step('Use the real organization and overdue filters', async () => {
    await filter.getByLabel('组织上下文', { exact: true }).fill(fixture.targetId);
    const switched = followupResponse(page, query => query.get('organizationId') === fixture.targetId);
    await filter.getByRole('button', { name: '切换组织', exact: true }).click();
    expect((await switched).status()).toBe(200);
    await expect(oldReport).toBeVisible();
    await expect(futureReport).toBeVisible();
    await expect(homeReport).toHaveCount(0);
    await toolbarFilter.click();
    await add();
    await stage.selectOption('ANALYSIS');
    await overdue.check();
    const filtered = followupResponse(page, query => query.get('organizationId') === fixture.targetId && hasCondition(query, 'stage', 'ANALYSIS') && query.has('overdueAt'));
    await apply();
    const response = await filtered;
    expect(response.status()).toBe(200);
    expect(await response.json()).toMatchObject({ total: 1, items: [{ reportNumber: 'A3-FOREIGN-OLD', organizationId: fixture.targetId }] });
    await expect(futureReport).toHaveCount(0);
  });

  await test.step('Open the actual detail and return to the filtered list', async () => {
    const workspace = page.waitForResponse(response => /\/api\/v1\/problem-index\/[^/]+\/workspace$/.test(new URL(response.url()).pathname));
    await oldReport.click();
    await expect(page).toHaveURL(/\/app\/problem-workspace\//);
    expect((await workspace).status()).toBe(200);
    await page.getByRole('link', { name: '返回制程问题跟进', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/app/process-quality/problems\\?organizationId=${fixture.targetId}$`));
    await expect(oldReport).toBeVisible();
    await expect(futureReport).toHaveCount(0);
    await toolbarFilter.click();
    await expect(stage).toHaveValue('ANALYSIS');
    await expect(overdue).toBeChecked();
  });

  await test.step('Combine server-side owner and section conditions with toolbar search', async () => {
    const sectionPeer = page.getByRole('link', { name: 'A3-FOREIGN-SECTION-PEER', exact: true });
    const confirm = async (ownerName: string, sectionName: string | null, expectedNumbers: string[]) => {
      const pending = followupResponse(page, query => query.get('organizationId') === fixture.targetId && !query.has('overdueAt')
        && hasCondition(query, 'ownerName', ownerName) && (sectionName === null || hasCondition(query, 'responsibleSectionName', sectionName)));
      await apply();
      const response = await pending;
      expect(response.status()).toBe(200);
      const payload = await response.json();
      expect(payload.total).toBe(expectedNumbers.length);
      expect(payload.items.map((item: { reportNumber: string }) => item.reportNumber).sort()).toEqual(expectedNumbers);
    };

    await overdue.uncheck();
    await expect(overdue).not.toBeChecked();
    await field(1).selectOption('ownerName');
    await value(1).fill('liang');
    await expect(value(1)).toHaveValue('liang');
    await confirm('liang', null, ['A3-FOREIGN-FUTURE', 'A3-FOREIGN-OLD']);
    await expect(futureReport).toBeVisible();
    await expect(sectionPeer).toHaveCount(0);

    await page.getByRole('button', { name: '按责任科室筛选', exact: true }).click();
    await expect(field(2)).toBeFocused();
    await expect(field(2)).toHaveValue('responsibleSectionName');
    await expect(value(1)).toHaveValue('liang');
    await value(2).fill('machining');
    await confirm('liang', 'machining', ['A3-FOREIGN-OLD']);
    await expect(oldReport).toBeVisible();
    await expect(futureReport).toHaveCount(0);
    await expect(sectionPeer).toHaveCount(0);

    const search = page.getByLabel('搜索报告编号或问题标题', { exact: true });
    const searched = followupResponse(page, query => query.get('search') === 'A3-FOREIGN-FUTURE'
      && hasCondition(query, 'ownerName', 'liang') && hasCondition(query, 'responsibleSectionName', 'machining'));
    await search.fill('A3-FOREIGN-FUTURE');
    await search.press('Enter');
    const response = await searched;
    expect(response.status()).toBe(200);
    expect(await response.json()).toMatchObject({ total: 0, items: [] });
  });

  await test.step('Keep the filter usable on a narrow viewport', async () => {
    await page.setViewportSize({ width: 800, height: 900 });
    await toolbarFilter.click();
    await expect(filter).toBeVisible();
    await expect(field(1)).toHaveValue('ownerName');
    const popup = (await filter.boundingBox())!;
    expect(popup.x).toBeGreaterThanOrEqual(0);
    expect(popup.x + popup.width).toBeLessThanOrEqual(800);
  });
  console.log(`Chromium ${browser.version()}; real gateway and PostgreSQL, no request interception`);
});
