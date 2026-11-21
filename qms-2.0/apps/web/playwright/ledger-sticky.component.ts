import { expect, test } from '@playwright/test';

test('reverse Tab reveals a card action that starts behind the sticky toolbar', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 720 });
  await page.goto('/playwright/ledger-fixture.html?cards');
  const list = page.getByRole('region', { name: '卡片清单吸顶验证' });
  const toolbar = list.locator('.qms-list-toolbar');
  const covered = list.getByRole('button', { name: '查看版本 5', exact: true });
  const next = list.getByRole('button', { name: '查看版本 6', exact: true });
  await covered.evaluate(button => window.scrollBy(0, button.getBoundingClientRect().top - 8));
  await expect.poll(async () => (await covered.boundingBox())!.y + (await covered.boundingBox())!.height).toBeLessThan((await toolbar.boundingBox())!.height);
  await next.evaluate(button => button.focus({ preventScroll: true }));
  await page.keyboard.press('Shift+Tab');
  await expect(covered).toBeFocused();
  await expect.poll(() => covered.evaluate(button => {
    const bounds = button.getBoundingClientRect();
    return button.contains(document.elementFromPoint(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2));
  })).toBe(true);
});

test('shared ledger keeps native controls and aligned columns during document scrolling', async ({ page }) => {
  for (const width of [1024, 320]) {
    await test.step(`${width}px viewport`, async () => {
      const height = 720;
      await page.setViewportSize({ width, height });
      await page.goto('/playwright/ledger-fixture.html?sticky');
      const ledger = page.getByRole('region', { name: '共享台账吸顶验证' });
      const settings = ledger.getByRole('button', { name: '列设置', exact: true });
      const query = ledger.getByRole('textbox', { name: '查询说明' });
      const pagination = ledger.locator('.ant-pagination');
      const next = pagination.locator('.ant-pagination-next button');
      const number = ledger.getByRole('columnheader').filter({ hasText: /^编号$/ });
      const title = ledger.getByRole('columnheader').filter({ hasText: /^问题说明$/ });
      const rows = ledger.locator('tbody tr[data-row-key]');
      const firstTitle = rows.first().getByRole('cell', { name: '模拟问题 1', exact: true });
      const position = () => ledger.evaluate(element => ({
        documentY: window.scrollY,
        remainingY: document.scrollingElement!.scrollHeight - innerHeight - window.scrollY,
        pageOverflowX: document.scrollingElement!.scrollWidth - document.documentElement.clientWidth,
        tableY: Math.max(0, ...Array.from(element.querySelectorAll('*'), child => child.scrollTop)),
      }));
      const controls = async () => {
        const [pager, columns, heading] = await Promise.all([pagination.boundingBox(), settings.boundingBox(), title.boundingBox()]);
        if (!pager || !columns || !heading) throw new Error('Expected one visible pager, settings button, and table header');
        expect(Math.max(pager.y + pager.height, columns.y + columns.height)).toBeLessThanOrEqual(heading.y + 1);
        expect(heading.y + heading.height).toBeLessThan(height / 2);
        return [pager.y, columns.y, heading.y];
      };

      await expect(rows).toHaveCount(50);
      const accessibleTable = ledger.getByRole('table');
      await expect(accessibleTable).toHaveCount(1);
      await expect(accessibleTable.getByRole('columnheader', { name: '编号', exact: true })).toBeVisible();
      await expect(accessibleTable.getByRole('cell', { name: '模拟问题 1', exact: true })).toBeVisible();
      await expect(pagination).toHaveCount(1);
      await expect(rows.first()).toBeInViewport();
      expect((await position()).documentY).toBe(0);
      expect(Math.min(...await controls())).toBeGreaterThan(16);

      await page.mouse.move(width / 2, height / 2);
      await page.mouse.wheel(0, 600);
      await expect.poll(async () => (await position()).documentY).toBeGreaterThanOrEqual(550);
      const sticky = await controls();
      expect(Math.min(...sticky), 'pagination, column settings and header stay in the viewport during document scroll').toBeGreaterThanOrEqual(-1);
      await expect(query).toBeInViewport({ ratio: 1 });
      expect((await query.boundingBox())!.y).toBeLessThan(Math.min(...sticky));
      const actionBar = await ledger.locator('.qms-ledger__action-bar').boundingBox();
      expect(actionBar?.y).toBe(0);
      expect(Math.abs(Math.min(...sticky) - actionBar!.height)).toBeLessThanOrEqual(1);
      expect(await position()).toMatchObject({ tableY: 0, pageOverflowX: 0 });
      expect((await position()).remainingY).toBeGreaterThan(50);
      await expect(rows.first()).not.toBeInViewport();
      const focusRow = rows.nth(4).getByRole('button');
      await focusRow.evaluate(element => element.focus({ preventScroll: true }));
      await page.keyboard.press('Shift+Tab');
      const previousRow = rows.nth(3).getByRole('button');
      await expect(previousRow).toBeFocused();
      expect((await previousRow.boundingBox())!.y).toBeGreaterThanOrEqual((await number.boundingBox())!.y + (await number.boundingBox())!.height - 1);
      await page.keyboard.press('Tab');
      await expect(focusRow).toBeFocused();
      await page.mouse.move(width / 2, height / 2);

      const scrollable = await ledger.locator('*:visible').evaluateAll(elements => elements.filter(element =>
        element.scrollWidth > element.clientWidth + 1 && /^(auto|scroll)$/.test(getComputedStyle(element).overflowX),
      ).length);
      expect(scrollable, 'only one native horizontal scroll track').toBe(1);
      await expect(ledger.locator('.ant-table-sticky-scroll:visible')).toHaveCount(0);
      const body = ledger.locator('.ant-table-body');
      await expect(body).toHaveAttribute('tabindex', '0');
      await body.evaluate(element => element.focus({ preventScroll: true }));
      await expect(body).toBeFocused();
      await page.keyboard.press('ArrowRight');
      await expect.poll(() => body.evaluate(element => element.scrollLeft)).toBeGreaterThan(0);
      await page.keyboard.press('ArrowLeft');
      await expect.poll(() => body.evaluate(element => element.scrollLeft)).toBe(0);
      const left = (locator: typeof title) => locator.evaluate(element => element.getBoundingClientRect().left);
      const before = await left(firstTitle);
      const fixedLeft = await left(number);
      const misalignment = async () => Math.abs(await left(title) - await left(firstTitle));
      expect(await misalignment()).toBeLessThanOrEqual(1);
      await page.mouse.wheel(220, 0);
      await expect.poll(async () => before - await left(firstTitle)).toBeGreaterThanOrEqual(200);
      await expect.poll(misalignment).toBeLessThanOrEqual(1);
      expect(Math.abs(await left(number) - fixedLeft)).toBeLessThanOrEqual(1);
      await page.mouse.wheel(-220, 0);
      await expect.poll(async () => Math.abs(await left(firstTitle) - before)).toBeLessThanOrEqual(1);

      await page.mouse.wheel(0, 10_000);
      await expect.poll(async () => (await position()).remainingY).toBeLessThanOrEqual(1);
      expect(await position()).toMatchObject({ tableY: 0, pageOverflowX: 0 });
      await expect(rows.last()).toBeInViewport();
      const endControls = await controls();
      expect(Math.max(...endControls.map((value, index) => Math.abs(value - sticky[index]!)))).toBeLessThanOrEqual(1);
      await expect(next).toBeInViewport({ ratio: 1 });
      await expect(settings).toBeInViewport({ ratio: 1 });
      await expect(number).toBeInViewport({ ratio: 1 });
      await expect(query).toBeInViewport({ ratio: 1 });
      const end = (await position()).documentY;
      await query.fill('筛选草稿');
      await settings.click();
      await expect(page.getByRole('button', { name: '恢复全部列', exact: true })).toBeVisible();
      await settings.click();
      await number.click({ trial: true });
      expect((await position()).documentY).toBe(end);
      await next.click();
      await expect(rows.first()).toHaveAttribute('data-row-key', '51');
      await expect(query).toHaveValue('筛选草稿');
      await number.click();
      await expect(number).toHaveAttribute('aria-sort', 'ascending');
    });
  }
});
