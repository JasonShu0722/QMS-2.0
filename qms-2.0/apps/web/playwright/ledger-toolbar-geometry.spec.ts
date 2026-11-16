import { writeFile } from 'node:fs/promises';
import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test';

test.use({ trace: 'off', screenshot: 'off', video: 'off' });

async function measure(page: Page, ledger: Locator, testInfo: TestInfo, state: string, paginated = true) {
  const columns = ledger.getByRole('button', { name: '列设置', exact: true });
  await expect(columns).toBeVisible();
  await expect(ledger.locator('.ant-pagination')).toHaveCount(paginated ? 1 : 0);
  await columns.scrollIntoViewIfNeeded();
  const geometry = await ledger.evaluate(element => {
    const bounds = element.getBoundingClientRect();
    const tools = element.querySelector('.qms-ledger__tools')!.getBoundingClientRect();
    const columns = [...element.querySelectorAll('button')].find(button => button.textContent?.trim() === '列设置')!.getBoundingClientRect();
    const heading = element.querySelector('.ant-table-thead')!.getBoundingClientRect();
    const pagination = element.querySelector('.ant-pagination')?.getBoundingClientRect();
    const controls = [...element.querySelectorAll('.ant-pagination > li')].map(control => control.getBoundingClientRect()).filter(rect => rect.width > 0 && rect.height > 0);
    const toolbarTop = Math.min(tools.top, pagination?.top ?? tools.top);
    const toolbarBottom = Math.max(tools.bottom, pagination?.bottom ?? tools.bottom);
    return {
      width: innerWidth, pageWidth: document.documentElement.scrollWidth,
      height: toolbarBottom - toolbarTop, headingGap: heading.top - toolbarBottom,
      columnsLeftPadding: columns.left - bounds.left, columnsRightPadding: bounds.right - columns.right,
      centerDifference: pagination ? Math.abs((pagination.top + pagination.bottom - columns.top - columns.bottom) / 2) : null,
      pagerLeftPadding: controls.length ? Math.min(...controls.map(rect => rect.left)) - bounds.left : null,
      pagerRight: controls.length ? Math.max(...controls.map(rect => rect.right)) : null,
      columnsLeft: columns.left,
      controlsOutside: controls.some(rect => rect.left < bounds.left + 11.5 || rect.right > bounds.right - 11.5),
      controlsOverlap: controls.some(rect => Math.min(rect.right, columns.right) - Math.max(rect.left, columns.left) > 0.5 && Math.min(rect.bottom, columns.bottom) - Math.max(rect.top, columns.top) > 0.5),
      loading: element.querySelector('.ant-spin')?.getAttribute('aria-busy'),
    };
  });
  await writeFile(testInfo.outputPath(`${state}-geometry.json`), JSON.stringify(geometry, null, 2));
  await page.screenshot({ path: testInfo.outputPath(`${state}.png`) });
  expect(geometry.pageWidth).toBeLessThanOrEqual(geometry.width + 1);
  expect(geometry.columnsLeftPadding).toBeGreaterThanOrEqual(11.5);
  expect(geometry.columnsRightPadding).toBeGreaterThanOrEqual(11.5);
  expect(geometry.headingGap).toBeGreaterThanOrEqual(3.5);
  expect(geometry.headingGap).toBeLessThanOrEqual(8.5);
  expect(geometry.controlsOverlap).toBe(false);
  expect(geometry.controlsOutside).toBe(false);
  if (paginated) {
    expect(geometry.pagerLeftPadding).toBeGreaterThanOrEqual(11.5);
    if (geometry.width === 1440) {
      expect(geometry.centerDifference).toBeLessThanOrEqual(1.5);
      expect(geometry.height).toBeGreaterThanOrEqual(47.5);
      expect(geometry.height).toBeLessThanOrEqual(56.5);
      expect(geometry.columnsLeft - geometry.pagerRight!).toBeGreaterThanOrEqual(3.5);
    }
  } else expect(geometry.height).toBeLessThanOrEqual(44.5);
  await columns.click();
  await expect(page.getByRole('button', { name: '恢复全部列', exact: true })).toBeVisible();
  await columns.click();
  return geometry;
}

test('shared native toolbar geometry covers desktop, loading and dynamic single-page hiding before 390 and 320 wrapping', async ({ page }, testInfo) => {
  const errors: string[] = [];
  const apiRequests: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (new URL(request.url()).pathname.startsWith('/api/')) apiRequests.push(new URL(request.url()).pathname); });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/playwright/ledger-fixture.html?toolbar');
  await writeFile(testInfo.outputPath('navigation.json'), JSON.stringify({ url: page.url(), rootChildren: await page.locator('#root').evaluate(root => root.childElementCount), errors, apiRequests }, null, 2));
  const section = page.getByRole('region', { name: '共享工具栏组件验证', exact: true });
  const ledger = section.locator('.qms-ledger');
  await expect(ledger.locator('tbody tr[data-row-key]')).toHaveCount(10);
  await measure(page, ledger, testInfo, 'desktop-many');
  await section.getByRole('button', { name: '开始加载', exact: true }).click();
  await expect(ledger.locator('.ant-spin')).toHaveAttribute('aria-busy', 'true');
  await expect(ledger.locator('.ant-spin-container')).toHaveCSS('pointer-events', 'none');
  await expect(ledger.locator('.ant-spin > .ant-spin-section')).toBeVisible();
  await measure(page, ledger, testInfo, 'desktop-loading');
  await section.getByRole('button', { name: '结束加载', exact: true }).click();
  await expect(ledger.locator('.ant-spin')).toHaveAttribute('aria-busy', 'false');
  for (const [button, state, paginated] of [['单页数据', 'desktop-hidden-first', false], ['多页数据', 'desktop-visible-again', true], ['单页数据', 'desktop-hidden-again', false], ['空数据', 'desktop-empty', false]] as const) {
    await section.getByRole('button', { name: button, exact: true }).click();
    await measure(page, ledger, testInfo, state, paginated);
  }
  await expect(ledger.locator('.ant-empty')).toBeVisible();
  await section.getByRole('button', { name: '多页数据', exact: true }).click();
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await measure(page, ledger, testInfo, `narrow-${width}`);
    await expect(ledger.locator('tbody tr[data-row-key]')).toHaveCount(10);
  }
  await writeFile(testInfo.outputPath('component-observations.json'), JSON.stringify({ errors, apiRequests, scope: 'real shared component with simulated fixture data; no authenticated business acceptance' }, null, 2));
  expect(errors).toEqual([]);
  expect(apiRequests).toEqual([]);
});
