import { randomUUID } from 'node:crypto';
import { expect, test, type Locator, type Page } from '@playwright/test';
import type { components } from '@qms/contracts';
import { completeMfa } from './mfa-login';
import { createPositionGrant, createPositionUser, positionRead, positionWrite } from './position-fixture';
import { fillSecret } from './secret-input';

type Schema = components['schemas'];
const gateway = process.env.QMS_ACCEPTANCE_BASE_URL;
const database = process.env.DATABASE_URL;
const adminPassword = process.env.QMS_SEED_INTERNAL_PASSWORD;
if (!gateway || !database || !adminPassword || !process.env.QMS_ACCEPTANCE_MFA_CACHE_FILE || !process.env.QMS_BACKUP_KEY
  || process.env.QMS_DISPOSABLE_TEST_DB !== 'true' || process.env.QMS_ACCEPTANCE_DISPOSABLE_DATABASE !== 'true'
  || !/^\/qms_ledger_sticky_[a-f0-9]{8}$/.test(new URL(database).pathname)) {
  throw new Error('Issue #159 requires an isolated ledger-sticky PostgreSQL database, loopback gateway, fresh seed credentials and encrypted MFA cache.');
}

const defects = '/api/v1/process-quality/defects';
const route = '/app/process-quality';
const total = 105;
const tag = `STICKY159-${randomUUID().slice(0, 8)}`;
const description = (ordinal: number) => `${tag}-${String(ordinal).padStart(3, '0')}`;
const username = `sticky159_${randomUUID().slice(0, 8)}`;
const actorPassword = `Aa1!${randomUUID()}`;

test.setTimeout(240_000);
test.use({ trace: 'off', screenshot: 'off', video: 'off', actionTimeout: 8_000, navigationTimeout: 20_000 });

async function login(page: Page, identifier: string, password: string) {
  await page.goto('/login');
  await page.getByLabel('账号', { exact: true }).fill(identifier);
  await fillSecret(page.getByLabel('密码', { exact: true }), password);
  const response = page.waitForResponse(entry => new URL(entry.url()).pathname === '/api/v1/auth/login' && entry.request().method() === 'POST');
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await completeMfa(page.request, await response, identifier, page);
  await expect(page).toHaveURL(/\/app\/workbench$/);
  const { user } = await positionRead<Schema['SessionResponseDto']>(page.request, '/api/v1/auth/session');
  expect(user.accountType).toBe('INTERNAL');
  return user;
}

async function readLayout(ledger: Locator) {
  return ledger.evaluate(element => {
    const root = document.scrollingElement!;
    const active = (axis: 'x' | 'y') => [element, ...element.querySelectorAll('*')].filter(node => {
      const { width, height } = node.getBoundingClientRect();
      return width > 0 && height > 0 && (axis === 'x'
        ? node.scrollWidth - node.clientWidth > 2 && /^(auto|scroll)$/.test(getComputedStyle(node).overflowX)
        : node.scrollHeight - node.clientHeight > 2 && /^(auto|scroll)$/.test(getComputedStyle(node).overflowY));
    }).map(node => ({ className: node.getAttribute('class'), offset: axis === 'x' ? node.scrollLeft : node.scrollTop }));
    return {
      y: root.scrollTop, remaining: Math.max(0, root.scrollHeight - root.clientHeight - root.scrollTop),
      pageOverflowX: Math.max(0, root.scrollWidth - root.clientWidth), horizontal: active('x'), vertical: active('y'),
    };
  });
}

async function getBox(locator: Locator) {
  const box = await locator.boundingBox();
  if (!box) throw new Error('Expected a rendered ledger control or cell');
  return box;
}

async function canClickWithoutScrolling(locator: Locator) {
  return locator.evaluate(element => {
    const rect = element.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    return element.contains(document.elementFromPoint(x, y));
  });
}

test('authenticated process defect ledger keeps controls and aligned columns on one page scroll', async ({ page, browser }, testInfo) => {
  const admin = await login(page, 'local.internal', adminPassword!);
  const grant = await createPositionGrant(page.request, admin.organizationId, {
    name: tag, permissionCodes: ['workbench:read', 'process-quality:defects:read', 'process-quality:defects:write', 'process-quality:defects:delete'],
  });
  const actor = await createPositionUser(page.request, admin.organizationId, [grant.position.id], { username, initialPassword: actorPassword });
  const context = await browser.newContext({ baseURL: gateway, locale: 'zh-CN', timezoneId: 'Asia/Shanghai' });
  try {
    const ledgerPage = await context.newPage();
    const device = await context.newCDPSession(ledgerPage);
    const session = await login(ledgerPage, username, actorPassword);
    expect(session.id).toBe(actor.id);
    const month = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit' }).format(new Date());
    const start = new Date(`${month}-01T00:00:00+08:00`).getTime();
    for (let ordinal = 1; ordinal <= total; ordinal++) {
      await positionWrite(ledgerPage.request, defects, 'POST', {
        description: description(ordinal), productCode: `${tag}-PRODUCT`, traceCode: `${tag}-TRACE-${ordinal}`, factoryCode: 'FACTORY_1',
        occurredAt: new Date(start + (total - ordinal)).toISOString(), lineName: `${tag}-LINE`, operationName: `${tag}-OPERATION`,
      } satisfies Schema['CreateProcessDefectDto'], 201);
    }
    const seeded = await positionRead<Schema['ProcessDefectPageDto']>(ledgerPage.request, `${defects}?page=1&pageSize=100&search=${tag}`);
    expect(seeded.total).toBe(total);
    expect(seeded.items.map(item => item.description)).toEqual(Array.from({ length: 100 }, (_, index) => description(index + 1)));

    for (const width of [1440, 390]) {
      const height = 740;
      await device.send('Emulation.setTouchEmulationEnabled', { enabled: width === 390 });
      await ledgerPage.setViewportSize({ width, height });
      await ledgerPage.goto(route);
      const ledger = ledgerPage.locator('.process-quality-compact-ledger');
      const toolbar = ledger.getByRole('group', { name: '台账工具栏' });
      const search = toolbar.getByLabel('搜索制程不良');
      const register = toolbar.getByRole('button', { name: '登记不良', exact: true });
      const filter = toolbar.getByRole('button', { name: '筛选条件' });
      const settings = ledger.getByRole('button', { name: '列设置', exact: true });
      const pager = ledger.locator('.ant-pagination');
      const sizePicker = pager.getByRole('combobox');
      const next = pager.locator('.ant-pagination-next button');
      const header = ledger.getByRole('columnheader', { name: '发生时间', exact: true });
      const shift = ledger.getByRole('columnheader', { name: '班次', exact: true });
      const scrollbar = ledger.getByRole('slider', { name: '横向滚动台账' });
      const row = (ordinal: number) => ledger.getByRole('row').filter({ has: ledgerPage.getByRole('button', { name: description(ordinal), exact: true }) });
      const rows = ledger.locator('tbody tr[data-row-key]');

      await expect(ledgerPage).toHaveURL(new RegExp(`${route}$`));
      await expect(register).toBeVisible();
      await search.fill(tag);
      await search.press('Enter');
      await expect(row(1)).toHaveCount(1);
      await expect(pager).toHaveCount(1);
      await expect(pager.getByText(`共 ${total} 条`, { exact: true })).toBeVisible();
      expect(await ledgerPage.evaluate(() => matchMedia('(pointer: coarse)').matches)).toBe(width === 390);

      for (const count of [10, 50, 100]) {
        await test.step(`${width}px / ${count} rows`, async () => {
          await ledgerPage.evaluate(() => window.scrollTo(0, 0));
          if (await rows.count() !== count) {
            await sizePicker.click();
            await ledgerPage.getByRole('option', { name: new RegExp(`^${count}\\s*(?:条\\s*)?/`) }).click();
          }
          await expect(rows).toHaveCount(count);
          await expect(rows.first()).toHaveAttribute('data-row-key', seeded.items[0]!.id);
          await expect(rows.last()).toHaveAttribute('data-row-key', seeded.items[count - 1]!.id);
          const initial = await readLayout(ledger);
          if (count > 10) expect(initial.remaining, 'A long page must scroll in the document').toBeGreaterThan(height);
          const samples = [];
          for (const [phase, offset] of [['top', 0], ['mid', initial.remaining / 2], ['end', initial.remaining]] as const) {
            if (phase === 'end') {
              await expect.poll(async () => {
                await ledgerPage.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
                return (await readLayout(ledger)).remaining;
              }).toBeLessThanOrEqual(2);
            } else {
              await ledgerPage.evaluate(y => window.scrollTo(0, y), offset);
              await expect.poll(async () => Math.abs((await readLayout(ledger)).y - offset)).toBeLessThanOrEqual(2);
            }
            const layout = await readLayout(ledger);
            const [queryBox, actionBox, pagerBox, settingsBox, headerBox] = await Promise.all([search, register, pager, settings, header].map(getBox));
            const clickable = await Promise.all([filter, settings, next].map(canClickWithoutScrolling));
            const scrollbarBox = await getBox(scrollbar);
            const scope = `${width}px / ${count} rows / ${phase}`;
            samples.push({ phase, layout, queryBox, actionBox, pagerBox, settingsBox, headerBox, clickable });
            expect.soft(layout.vertical, `${scope}: no active nested vertical track`).toEqual([]);
            expect.soft(layout.pageOverflowX, `${scope}: no page-level horizontal overflow`).toBeLessThanOrEqual(1);
            expect.soft(layout.horizontal, `${scope}: exactly one horizontally scrollable table body`).toHaveLength(1);
            await expect(scrollbar).toHaveCount(1);
            expect(await ledger.locator('.ant-table-body').evaluate(body => getComputedStyle(body).scrollbarWidth)).toBe('none');
            expect.soft(Math.abs(scrollbarBox.y + scrollbarBox.height - height), `${scope}: scrollbar remains at the viewport edge`).toBeLessThanOrEqual(2);
            expect.soft(await canClickWithoutScrolling(scrollbar), `${scope}: scrollbar remains hit-testable`).toBe(true);
            expect.soft(Math.min(queryBox.y, actionBox.y, pagerBox.y, settingsBox.y, headerBox.y), `${scope}: sticky controls remain onscreen`).toBeGreaterThanOrEqual(-1);
            expect.soft(Math.max(queryBox.y + queryBox.height, actionBox.y + actionBox.height), `${scope}: query/actions precede pagination/settings`).toBeLessThanOrEqual(Math.min(pagerBox.y, settingsBox.y) + 2);
            expect.soft(Math.max(pagerBox.y + pagerBox.height, settingsBox.y + settingsBox.height), `${scope}: pagination/settings precede the header`).toBeLessThanOrEqual(headerBox.y + 2);
            expect.soft(headerBox.y + headerBox.height, `${scope}: leave room for usable rows`).toBeLessThan(height - 100);
            expect.soft(clickable, `${scope}: filter, column settings and next page are hit-testable`).toEqual([true, true, true]);

            if (phase === 'mid' && count === 100) {
              const body = row(50).getByRole('cell', { name: /白班|夜班/ });
              const aligned = async () => Math.abs((await getBox(shift)).x - (await getBox(body)).x);
              const before = (await getBox(body)).x;
              const card = await getBox(ledger);
              await ledgerPage.mouse.move(card.x + Math.min(180, card.width / 2), Math.max(height / 2, headerBox.y + headerBox.height + 32));
              await ledgerPage.mouse.wheel(180, 0);
              await expect.poll(async () => Math.abs((await getBox(body)).x - before)).toBeGreaterThan(30);
              expect.soft(await aligned(), `${scope}: heading/body stay aligned after horizontal scroll`).toBeLessThanOrEqual(2);
              await ledgerPage.mouse.wheel(-180, 0);
              await expect.poll(async () => Math.abs((await getBox(body)).x - before)).toBeLessThanOrEqual(2);
            }

            if (phase === 'end') {
              await expect.soft(row(count)).toBeInViewport();
              if (clickable[0]) {
                await filter.click();
                await expect(ledgerPage.getByRole('dialog', { name: '筛选面板' })).toBeVisible();
                await ledgerPage.keyboard.press('Escape');
                await expect(ledgerPage.getByRole('dialog', { name: '筛选面板' })).toHaveCount(0);
              }
              if (clickable[1]) {
                await settings.click();
                await expect(ledgerPage.getByRole('button', { name: '恢复录单默认列', exact: true })).toBeVisible();
                await settings.click();
              }
              expect.soft(Math.abs((await readLayout(ledger)).y - layout.y), `${scope}: opening controls must not scroll back`).toBeLessThanOrEqual(2);
              const checkbox = row(count).getByRole('checkbox', { name: `选择制程不良 ${description(count)}` });
              expect.soft(await canClickWithoutScrolling(checkbox), `${scope}: the last row can be selected above the scrollbar`).toBe(true);
              await checkbox.check();
              const batch = ledger.getByRole('toolbar', { name: '台账批量操作' });
              const cancel = batch.getByRole('button', { name: '取消选择' });
              await expect(batch.getByRole('button', { name: '删除所选' })).toBeInViewport();
              expect.soft(await canClickWithoutScrolling(cancel), `${scope}: selected-row actions stay hit-testable`).toBe(true);
              expect.soft(await canClickWithoutScrolling(scrollbar), `${scope}: selected-row actions leave the scrollbar hit-testable`).toBe(true);
              const track = await getBox(scrollbar);
              const center = { x: track.x + track.width / 2, y: track.y + track.height / 2 };
              if (width === 390) {
                await device.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [center] });
                await device.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
              } else await ledgerPage.mouse.click(center.x, center.y);
              await expect.poll(() => ledger.locator('.ant-table-body').evaluate(body => body.scrollLeft)).toBeGreaterThan(30);
              await scrollbar.press('Home');
              await expect.poll(() => ledger.locator('.ant-table-body').evaluate(body => body.scrollLeft)).toBe(0);
              await cancel.click();
              await expect(checkbox).not.toBeChecked();
            }
          }
          await testInfo.attach(`layout-${width}-${count}`, { body: JSON.stringify(samples, null, 2), contentType: 'application/json' });
          if (!await canClickWithoutScrolling(next)) await ledgerPage.evaluate(() => window.scrollTo(0, 0));
          await next.click();
          await expect(rows).toHaveCount(Math.min(count, total - count));
          await expect(rows.first().getByRole('button', { name: description(count + 1), exact: true })).toHaveCount(1);
          if (count === 100) await expect(rows.last().getByRole('button', { name: description(total), exact: true })).toHaveCount(1);
          await ledgerPage.evaluate(() => window.scrollTo(0, 0));
          await pager.locator('.ant-pagination-prev button').click();
          await expect(rows.first()).toHaveAttribute('data-row-key', seeded.items[0]!.id);
        });
      }
    }
  } finally {
    await context.close();
  }
});
