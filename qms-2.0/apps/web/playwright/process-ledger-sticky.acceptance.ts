import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
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
test.use({ trace: 'off', screenshot: 'off', video: 'off', timezoneId: 'Asia/Shanghai', actionTimeout: 8_000, navigationTimeout: 20_000 });

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

test('visible cells and selections preserve position in the process ledger and console mappings', async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 740 });
  await login(page, 'local.internal', adminPassword!);
  const sample = `CLICK174-${randomUUID().slice(0, 8)}`;
  const mappingPath = '/api/v1/admin/configuration/component-project-mappings';
  const importResult = await positionWrite<Schema['ComponentProjectImportResultDto']>(page.request, `${mappingPath}/import`, 'POST', {
    rows: Array.from({ length: 18 }, (_, index) => ({ rowNumber: index + 1, componentCode: `${sample}-${index}`, componentName: `${sample} 组件 ${index}` })),
  }, 201);
  expect(importResult.created).toBe(18);
  for (let index = 0; index < 10; index++) {
    await positionWrite(page.request, defects, 'POST', {
      description: `${sample}-${index}`, productCode: sample, traceCode: `${sample}-${index}`, occurredAt: new Date().toISOString(),
      factoryCode: 'FACTORY_1', lineName: sample, operationName: sample,
    } satisfies Schema['CreateProcessDefectDto'], 201);
  }

  for (const target of [
    { path: route, cell: '班次', action: `${sample}-7`, dialog: '不良品详情', selection: '台账批量操作', selectRow: page.getByRole('row').filter({ has: page.getByRole('button', { name: `${sample}-7`, exact: true }) }) },
    { path: '/console/master-data/component-projects', cell: '组件名称', action: `编辑组件 ${sample}-3`, dialog: '组件映射', selection: '已选组件项目映射', selectRow: page.getByRole('row').filter({ has: page.getByRole('cell', { name: `${sample}-3`, exact: true }) }) },
  ]) {
    await test.step(target.path, async () => {
      await page.goto(target.path);
      await expect(target.selectRow).toHaveCount(1);
      const ledger = page.locator('.qms-ledger--sticky').filter({ has: target.selectRow });
      const body = ledger.locator('.ant-table-body');
      await expect(body).toHaveAttribute('tabindex', '0');
      const headings = await ledger.getByRole('columnheader').allTextContents();
      const cellIndex = headings.findIndex(text => text.trim() === target.cell);
      expect(cellIndex).toBeGreaterThanOrEqual(0);
      const cell = target.selectRow.getByRole('cell').nth(cellIndex);
      const checkbox = target.selectRow.getByRole('checkbox');
      await cell.evaluate(element => window.scrollBy(0, element.getBoundingClientRect().top - 320));

      async function clickAtCurrentPosition(control: Locator) {
        const before = await body.evaluate(element => [window.scrollY, element.scrollLeft, element.scrollTop]);
        await expect.poll(() => canClickWithoutScrolling(control)).toBe(true);
        const bounds = await getBox(control);
        await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        expect(await body.evaluate(element => [window.scrollY, element.scrollLeft, element.scrollTop])).toEqual(before);
      }
      await clickAtCurrentPosition(cell);
      await clickAtCurrentPosition(checkbox);
      await expect(checkbox).toBeChecked();
      await clickAtCurrentPosition(checkbox);
      await expect(checkbox).not.toBeChecked();

      const action = target.selectRow.getByRole('button', { name: target.action, exact: true });
      await action.evaluate(element => element.scrollIntoView({ block: 'nearest', inline: 'nearest' }));
      await clickAtCurrentPosition(action);
      const dialog = page.getByRole('dialog', { name: target.dialog });
      await expect(dialog).toBeVisible();
      await dialog.press('Escape');
      await expect(dialog).toBeHidden();
      await body.evaluate(element => { element.scrollLeft = 0; });

      const lastRow = ledger.locator('tbody tr[data-row-key]').last();
      const lastCheckbox = lastRow.getByRole('checkbox');
      const selectionBar = page.getByRole('toolbar', { name: target.selection, exact: true });
      const scrollToBottom = () => page.evaluate(() => window.scrollTo(0, document.scrollingElement!.scrollHeight));
      const maxScroll = () => page.evaluate(() => document.scrollingElement!.scrollHeight - document.scrollingElement!.clientHeight);
      await scrollToBottom();
      const bottom = await maxScroll();
      await clickAtCurrentPosition(lastCheckbox);
      await expect(lastCheckbox).toBeChecked();
      expect(await maxScroll()).toBe(bottom);
      await expect(selectionBar).toBeVisible();
      const lastBounds = await getBox(lastRow);
      expect(lastBounds.y + lastBounds.height).toBeLessThanOrEqual((await getBox(selectionBar)).y + 1);
      await clickAtCurrentPosition(lastCheckbox);
      await expect(lastCheckbox).not.toBeChecked();
      expect(await maxScroll()).toBe(bottom);
    });
  }
});

test('process defect detail keeps registration fields readable and refresh actions in their headings', async ({ page }, testInfo) => {
  const sample = `DETAIL174-${randomUUID().slice(0, 8)}`;
  const defectDescription = `${sample} 在线检测出现断续失效，需复查连接器和焊点。检测记录 ${'4030234000AB912C22611200485'.repeat(4)}`;
  const traceCode = `${sample}4030234000AB912C22611200485`;
  const workOrderCode = `4000030234-DIP-${sample}`;
  const productCode = `PCB-4030234000-${sample}`;
  const occurredAt = new Date().toISOString();
  const aiDirect = '工序名称：在线检测；不良名称：测试后断续失效，需复查连接器和焊点。'.repeat(3);
  await page.setViewportSize({ width: 1920, height: 872 });
  await login(page, 'local.internal', adminPassword!);
  const record = await positionWrite<Schema['ProcessDefectDto']>(page.request, defects, 'POST', {
    description: defectDescription, defectQuantity: 1, productCode, traceCode, workOrderCode,
    batchCode: `${sample}-BATCH`, occurredAt, factoryCode: 'FACTORY_1', lineName: '组装线 03', operationName: '在线检测',
  } satisfies Schema['CreateProcessDefectDto'], 201);
  const requireApi = createRequire(resolve(process.cwd(), '../api/package.json'));
  const { Client } = requireApi('pg') as typeof import('pg');
  const client = new Client({ connectionString: database });
  await client.connect();
  try {
    const seeded = await client.query(`UPDATE process_defects SET description_direct = $1, description_ai = $2,
      description_input = $3, description_ai_status = 'APPLIED', description_source = 'AI' WHERE id = $4`,
    [aiDirect, '已整理的不良说明', JSON.stringify([{ path: 'sample', label: '检测工序', value: '在线检测' }]), record.id]);
    expect(seeded.rowCount).toBe(1);
  } finally {
    await client.end();
  }

  await page.goto(route);
  await page.getByRole('button', { name: defectDescription, exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '不良品详情' });
  const registration = dialog.locator('section').filter({ has: page.getByText('表单登记', { exact: true }) }).first();
  const source = dialog.getByRole('region', { name: '描述来源' });
  await expect(registration.getByText('工单号', { exact: true })).toBeVisible();
  await expect(registration.getByText('成品编码', { exact: true })).toBeVisible();
  await expect(registration.getByText(/^(失效类型|完善情况|人工项目 \/ 映射建议|批次 \/ 工单|产品 \/ 物料)$/)).toHaveCount(0);
  await expect(registration.getByText(`${sample}-BATCH`, { exact: true })).toHaveCount(0);
  await expect(dialog.getByText('不良跟进状态', { exact: true })).toBeVisible();
  await expect(dialog.getByRole('button', { name: '问题关闭', exact: true })).toBeVisible();
  const refreshAi = registration.locator('header').filter({ hasText: '表单登记' }).getByRole('button', { name: '刷新整理状态' });
  await expect(source.getByRole('button', { name: '刷新整理状态' })).toHaveCount(0);
  const refreshAttachment = dialog.locator('.attachment-panel > .ant-card-head').getByRole('button', { name: '刷新附件' });
  await expect(refreshAttachment).toBeEnabled();
  await refreshAttachment.click();
  const refreshed = page.waitForResponse(response => new URL(response.url()).pathname === `${defects}/${record.id}` && response.request().method() === 'GET');
  await refreshAi.click();
  expect((await refreshed).status()).toBe(200);

  const textRects = (locator: Locator) => locator.evaluate(element => {
    const range = document.createRange();
    range.selectNodeContents(element);
    return Array.from(range.getClientRects(), rect => ({ left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom }));
  });
  const fields = registration.locator('dl').filter({ has: page.getByText('不良描述', { exact: true }) });
  const descriptionValue = fields.getByText(defectDescription, { exact: true });
  const dateTime = fields.getByText(/\d{4}[/-]\d{1,2}[/-]\d{1,2}\s+\d{1,2}:\d{2}:\d{2}/);
  const traceValue = fields.getByText(traceCode, { exact: true });
  const longValues = [dateTime, traceValue, ...[workOrderCode, productCode].map(value => fields.getByText(value, { exact: true }))];
  const lineCount = (lines: Awaited<ReturnType<typeof textRects>>) => new Set(lines.map(line => Math.round(line.top))).size;

  for (const width of [1920, 650, 390, 320]) {
    await page.setViewportSize({ width, height: 872 });
    await expect.poll(async () => Math.round((await getBox(dialog)).width)).toBe(Math.min(width, 760));
    await expect.poll(() => registration.evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
    const pairs = await fields.locator('dt').evaluateAll(labels => labels.map(label => {
      const cell = label.parentElement!.getBoundingClientRect();
      const labelBox = label.getBoundingClientRect();
      const value = label.nextElementSibling!;
      const valueBox = value.getBoundingClientRect();
      const range = document.createRange();
      range.selectNodeContents(value);
      return {
        label: label.textContent, left: cell.left, right: cell.right, top: cell.top, bottom: cell.bottom,
        labelLeft: labelBox.left, labelRight: labelBox.right, labelTop: labelBox.top, valueLeft: valueBox.left, valueTop: valueBox.top,
        overflow: Math.max(0, ...Array.from(range.getClientRects(), rect => rect.right - cell.right)),
      };
    }));
    const [descriptionPair, ...shortPairs] = pairs;
    expect(pairs).toHaveLength(17);
    for (const pair of pairs) {
      expect(Math.abs(pair.labelTop - pair.valueTop), `${width}px ${pair.label} label and value share a row`).toBeLessThanOrEqual(1);
      expect(pair.valueLeft, `${width}px ${pair.label} value starts after its label`).toBeGreaterThan(pair.labelRight);
      expect(pair.overflow, `${width}px ${pair.label} text stays inside its cell`).toBeLessThanOrEqual(1);
    }

    if (width === 1920) {
      const [leftColumn, rightColumn] = shortPairs;
      expect(rightColumn.left).toBeGreaterThanOrEqual(leftColumn.right);
      expect(descriptionPair.left).toBeCloseTo(leftColumn.left, 0);
      expect(descriptionPair.right).toBeCloseTo(rightColumn.right, 0);
      for (const [index, pair] of shortPairs.entries()) {
        const column = index % 2 === 0 ? leftColumn : rightColumn;
        expect(pair.labelLeft, `${pair.label} aligns with its column label`).toBeCloseTo(column.labelLeft, 0);
        expect(pair.valueLeft, `${pair.label} aligns with its column value`).toBeCloseTo(column.valueLeft, 0);
        expect(pair.top, `${pair.label} aligns with its row`).toBeCloseTo(shortPairs[index - index % 2].top, 0);
      }
      for (const field of longValues) {
        expect(lineCount(await textRects(field)), `${await field.textContent()} fits on one desktop line`).toBe(1);
      }
    } else {
      for (const [index, pair] of shortPairs.entries()) {
        expect(pair.left, `${width}px ${pair.label} aligns with the description`).toBeCloseTo(descriptionPair.left, 0);
        expect(pair.right, `${width}px ${pair.label} spans the full row`).toBeCloseTo(descriptionPair.right, 0);
        expect(pair.top, `${width}px ${pair.label} starts on its own row`).toBeGreaterThanOrEqual(pairs[index].bottom - 1);
      }
      expect(lineCount(await textRects(descriptionValue))).toBeGreaterThan(1);
      if (width <= 390) expect(lineCount(await textRects(traceValue))).toBeGreaterThan(1);
      for (const field of longValues) await expect(field).toBeVisible();
    }
    for (const [label, value] of [['直接组合', aiDirect], ['原始选定字段', '检测工序：在线检测'], ['AI结果', '已整理的不良说明']]) {
      const markers = await textRects(source.getByText(label, { exact: true }));
      const lines = await textRects(source.getByText(value, { exact: true }));
      expect(markers.length).toBeGreaterThan(0);
      expect(lines.length).toBeGreaterThan(0);
      const overlaps = markers.some(marker => lines.some(line => line.top < marker.bottom - 1 && line.bottom > marker.top + 1
        && line.left < marker.right - 1 && line.right > marker.left + 1));
      expect(overlaps, `${width}px ${label}`).toBe(false);
    }
    if (width === 1920 || width === 390) {
      await dialog.locator('.ant-drawer-body').evaluate(element => { element.scrollTop = 0; });
      await page.screenshot({ path: testInfo.outputPath(`registration-${width}.png`), animations: 'disabled' });
    }
  }
});

test('deletes a whole 1000-row page with a short confirmation and returns to a valid page', async ({ page: adminPage, browser }, testInfo) => {
  const admin = await login(adminPage, 'local.internal', adminPassword!);
  const label = `BULK163-${randomUUID().slice(0, 8)}`;
  const grant = await createPositionGrant(adminPage.request, admin.organizationId, {
    name: label, permissionCodes: ['workbench:read', 'process-quality:defects:read', 'process-quality:defects:delete'],
  });
  const actorName = `bulk163_${randomUUID().slice(0, 8)}`;
  const password = `Aa1!${randomUUID()}`;
  await createPositionUser(adminPage.request, admin.organizationId, [grant.position.id], { username: actorName, initialPassword: password });
  const context = await browser.newContext({ baseURL: gateway, locale: 'zh-CN', timezoneId: 'Asia/Shanghai' });
  const month = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit' }).format(new Date());
  const occurrence = new Date(`${month}-01T12:34:56+08:00`).toISOString();
  const requireApi = createRequire(resolve(process.cwd(), '../api/package.json'));
  const { Client } = requireApi('pg') as typeof import('pg');
  const client = new Client({ connectionString: database });
  try {
    const page = await context.newPage();
    const user = await login(page, actorName, password);
    await client.connect();
    await client.query(`INSERT INTO process_defects
      (id, organization_id, description, occurred_at, product_code, trace_code, factory_code, created_by_id, updated_by_id, updated_at)
      SELECT gen_random_uuid(), $1, $2 || '-' || ordinal, $3::timestamptz,
        $2, $2 || '-TRACE-' || ordinal, 'FACTORY_1', $4, $4, now()
      FROM generate_series(1, 2000) AS ordinal`, [user.organizationId, label, occurrence, user.id]);

    await page.setViewportSize({ width: 1440, height: 740 });
    await page.goto(route);
    const timings: Record<string, number> = {};
    const recordTiming = (stage: string, started: number) => {
      timings[stage] = Math.round(performance.now() - started);
      console.log(`1000-row ledger ${stage}: ${timings[stage]} ms`);
    };
    const ledger = page.locator('.process-quality-compact-ledger');
    const search = ledger.getByLabel('搜索制程不良');
    const pager = ledger.locator('.ant-pagination');
    const rows = ledger.locator('tbody tr[data-row-key]');
    await expect(ledger.getByRole('checkbox', { name: '选择当前页制程不良', exact: true })).toBeEnabled();
    await expect(rows.first().getByRole('button', { name: '删除台账', exact: true })).toBeEnabled();
    await search.fill(label);
    const searched = page.waitForResponse(response => {
      const url = new URL(response.url());
      return url.pathname === defects && url.searchParams.get('search') === label;
    });
    await ledger.getByRole('button', { name: 'search', exact: true }).click();
    expect((await searched).status()).toBe(200);
    await expect(pager.getByText('共 2000 条', { exact: true })).toBeVisible();
    await pager.getByRole('combobox').click();
    const firstPageStarted = performance.now();
    const requestedPage = page.waitForResponse(response => {
      const url = new URL(response.url());
      return url.pathname === defects && url.searchParams.get('pageSize') === '1000';
    }, { timeout: 15_000 });
    await page.getByRole('option', { name: /^1000\s*(?:条\s*)?\// }).click();
    expect((await requestedPage).status()).toBe(200);
    await expect(rows).toHaveCount(1000, { timeout: 15_000 });
    recordTiming('first page', firstPageStarted);
    const firstPageRecord = await rows.first().getAttribute('data-row-key');
    const date = new Date(occurrence).toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' });
    const dateCell = rows.first().getByRole('cell', { name: date, exact: true });
    await expect(dateCell).toBeVisible();
    await dateCell.hover();
    await expect(dateCell).toHaveAttribute('title', `${date} 12:34:56`);
    await expect(ledger.getByRole('slider', { name: '横向滚动台账' })).toBeInViewport();
    for (const [name, ceiling] of [['发生时间', 120], ['板块', 90], ['不良数量', 96]] as const) {
      const header = ledger.getByRole('columnheader', { name, exact: true });
      expect((await header.boundingBox())?.width).toBeLessThan(ceiling);
    }
    const quantityHeader = ledger.getByRole('columnheader', { name: '不良数量', exact: true });
    await expect(quantityHeader.getByRole('button').first()).toBeEnabled();

    const secondPageStarted = performance.now();
    const secondPage = page.waitForResponse(response => {
      const url = new URL(response.url());
      return url.pathname === defects && url.searchParams.get('pageSize') === '1000' && url.searchParams.get('page') === '2';
    }, { timeout: 15_000 });
    await pager.locator('.ant-pagination-next button').click({ timeout: 15_000 });
    expect((await secondPage).status()).toBe(200);
    await expect(rows.first()).not.toHaveAttribute('data-row-key', firstPageRecord!, { timeout: 15_000 });
    await expect(rows).toHaveCount(1000, { timeout: 15_000 });
    recordTiming('second page', secondPageStarted);
    const selectionStarted = performance.now();
    await ledger.getByRole('checkbox', { name: '选择当前页制程不良', exact: true }).check({ timeout: 15_000 });
    recordTiming('selection', selectionStarted);
    await ledger.getByRole('button', { name: '删除所选', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '删除制程不良台账' });
    await expect(dialog).toContainText(/1000\s*条/);
    await expect(dialog).not.toContainText(label);
    await expect(dialog.getByRole('textbox')).toHaveCount(0);
    const deletionStarted = performance.now();
    const submitted = page.waitForResponse(response => new URL(response.url()).pathname === `${defects}/deletion` && response.request().method() === 'POST');
    const reloaded = page.waitForResponse(response => {
      const url = new URL(response.url());
      return url.pathname === defects && url.searchParams.get('pageSize') === '1000' && url.searchParams.get('page') === '1';
    }, { timeout: 30_000 });
    await dialog.getByRole('button', { name: '确认删除', exact: true }).click();
    expect((await submitted).status()).toBe(201);
    recordTiming('delete response', deletionStarted);
    await expect(dialog).not.toBeVisible();
    expect((await reloaded).status()).toBe(200);
    recordTiming('reloaded response', deletionStarted);
    await expect(pager.getByText('共 1000 条', { exact: true })).toBeVisible();
    await expect(rows).toHaveCount(1000, { timeout: 15_000 });
    await expect(rows.first()).toHaveAttribute('data-row-key', firstPageRecord!);
    recordTiming('reloaded rows', deletionStarted);
    const archived = await client.query<{ count: number }>(`SELECT count(*)::int AS count FROM process_defects
      WHERE organization_id = $1 AND product_code = $2 AND archived_at IS NOT NULL`, [user.organizationId, label]);
    expect(archived.rows[0]?.count).toBe(1000);
    const audit = await client.query<{ count: number }>(`SELECT count(*)::int AS count FROM audit_events
      INNER JOIN process_defects ON audit_events.resource_id = process_defects.id::text
      WHERE audit_events.actor_user_id = $1 AND process_defects.product_code = $2
        AND audit_events.action = 'PROCESS_DEFECTS_DELETED'`, [user.id, label]);
    expect(audit.rows[0]?.count).toBe(1000);
    await testInfo.attach('1000-row interaction timings', { body: JSON.stringify(timings), contentType: 'application/json' });
  } finally {
    await client.end();
    await context.close();
  }
});

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
              if (width === 1440 && count === 100) {
                await scrollbar.press('End');
                const detailButton = row(count).getByRole('button', { name: '查看详情', exact: true });
                await expect.poll(() => canClickWithoutScrolling(detailButton)).toBe(true);
                await detailButton.focus();
                await expect(detailButton).toBeFocused();
                await expect(detailButton).toHaveCSS('outline-offset', '-2px');
                await detailButton.press('Enter');
                const drawer = ledgerPage.getByRole('dialog', { name: '不良品详情' });
                await expect(drawer).toBeVisible();
                await ledgerPage.keyboard.press('Escape');
                await expect(drawer).not.toBeVisible();
                await scrollbar.press('Home');
                await expect.poll(() => ledger.locator('.ant-table-body').evaluate(body => body.scrollLeft)).toBe(0);
              }
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
