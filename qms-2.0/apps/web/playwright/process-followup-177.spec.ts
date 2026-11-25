import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { completeMfa } from './mfa-login';
import { fillSecret } from './secret-input';

const path = '/app/process-quality/problems';
const endpoint = '/api/v1/problem-index/process-followup';

function followupResponse(page: Page, matches: (query: URLSearchParams) => boolean) {
  return page.waitForResponse(response => {
    const url = new URL(response.url());
    return url.pathname === endpoint && response.request().method() === 'GET' && matches(url.searchParams);
  });
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

    const home = followupResponse(page, query => query.get('organizationId') === fixture.homeId);
    await page.goto(path);
    expect((await home).status()).toBe(200);
    await expect(page.getByRole('link', { name: 'A3-HOME-OLD', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'A3-FOREIGN-OLD', exact: true })).toHaveCount(0);
  });

  const toolbarFilter = page.getByRole('button', { name: '筛选条件', exact: true });
  const stageFilter = page.getByRole('button', { name: '按当前环节筛选', exact: true });
  const filter = page.getByRole('dialog', { name: '筛选面板', exact: true });
  const stage = filter.getByLabel('当前环节', { exact: true });
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
    await stage.selectOption('ANALYSIS');
    const response = followupResponse(page, query => query.get('stage') === 'ANALYSIS');
    await filter.getByRole('button', { name: '应用筛选', exact: true }).click();
    expect((await response).status()).toBe(200);
    await expect(stageFilter).toHaveAttribute('aria-pressed', 'true');
    await stageFilter.click();
    await expect(stage).toHaveValue('ANALYSIS');
    await expect(stage).toBeFocused();
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
    await stage.selectOption('ANALYSIS');
    await overdue.check();
    const filtered = followupResponse(page, query => query.get('organizationId') === fixture.targetId && query.get('stage') === 'ANALYSIS' && query.has('overdueAt'));
    await filter.getByRole('button', { name: '应用筛选', exact: true }).click();
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

  await test.step('Match partial owner and section names independently and together', async () => {
    const owner = filter.getByLabel('负责人', { exact: true });
    const section = filter.getByLabel('责任科室', { exact: true });
    const sectionPeer = page.getByRole('link', { name: 'A3-FOREIGN-SECTION-PEER', exact: true });
    const apply = async (ownerName: string | null, sectionName: string | null, expectedNumbers: string[]) => {
      const pending = followupResponse(page, query => query.get('organizationId') === fixture.targetId && !query.has('overdueAt')
        && query.get('ownerName') === ownerName && query.get('responsibleSectionName') === sectionName);
      await filter.getByRole('button', { name: '应用筛选', exact: true }).click();
      const response = await pending;
      expect(response.status()).toBe(200);
      const payload = await response.json();
      expect(payload.total).toBe(expectedNumbers.length);
      expect(payload.items.map((item: { reportNumber: string }) => item.reportNumber).sort()).toEqual(expectedNumbers);
    };

    await overdue.uncheck();
    await owner.fill('liang');
    await apply('liang', null, ['A3-FOREIGN-FUTURE', 'A3-FOREIGN-OLD']);
    await expect(futureReport).toBeVisible();
    await expect(sectionPeer).toHaveCount(0);

    await page.getByRole('button', { name: '按责任科室筛选', exact: true }).click();
    await expect(section).toBeFocused();
    await expect(owner).toHaveValue('liang');
    await owner.clear();
    await section.fill('machining');
    await apply(null, 'machining', ['A3-FOREIGN-OLD', 'A3-FOREIGN-SECTION-PEER']);
    await expect(sectionPeer).toBeVisible();
    await expect(futureReport).toHaveCount(0);

    await page.getByRole('button', { name: '按负责人筛选', exact: true }).click();
    await expect(owner).toBeFocused();
    await expect(section).toHaveValue('machining');
    await owner.fill('liang');
    await apply('liang', 'machining', ['A3-FOREIGN-OLD']);
    await expect(oldReport).toBeVisible();
    await expect(futureReport).toHaveCount(0);
    await expect(sectionPeer).toHaveCount(0);
  });
  console.log(`Chromium ${browser.version()}; real gateway and PostgreSQL, no request interception`);
});
