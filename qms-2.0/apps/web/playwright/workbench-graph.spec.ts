import { expect, test, type Page } from '@playwright/test';
import type { components } from '@qms/contracts';
import { completeMfa } from './mfa-login';
import { fillSecret } from './secret-input';

const baseURL = process.env.QMS_ACCEPTANCE_BASE_URL;
const databaseURL = process.env.DATABASE_URL;
const password = process.env.QMS_SEED_INTERNAL_PASSWORD;
if (!baseURL || !databaseURL || !password || !process.env.QMS_ACCEPTANCE_MFA_CACHE_FILE || !process.env.QMS_BACKUP_KEY
  || process.env.QMS_DISPOSABLE_TEST_DB !== 'true' || process.env.QMS_ACCEPTANCE_DISPOSABLE_DATABASE !== 'true') {
  throw new Error('Workbench graph acceptance requires a disposable PostgreSQL, local gateway and external encrypted MFA cache.');
}
for (const value of [baseURL, databaseURL]) {
  const url = new URL(value);
  if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.port === '55440' || url.hash || url.search) {
    throw new Error('Only disposable loopback resources outside preserved preview 55440 are allowed.');
  }
}

async function login(page: Page, target = '/app/workbench') {
  await page.goto(target);
  await page.getByLabel('账号', { exact: true }).fill('local.internal');
  await fillSecret(page.getByLabel('密码', { exact: true }), password!);
  const response = page.waitForResponse(entry => new URL(entry.url()).pathname === '/api/v1/auth/login' && entry.request().method() === 'POST');
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await completeMfa(page.request, await response, 'local.internal', page);
  await expect(page).toHaveURL(new URL(target, baseURL).href);
}

type Graph = components['schemas']['WorkbenchGraphDto'];

const graphPath = '/api/v1/workbench/graph';
const ingestionName = 'API入库衔接';
const ingestionTargets = [
  ['supplier-profiles', '供应商档案'],
  ['customer-profiles', '客户档案'],
  ['material-master', '物料主数据'],
  ['component-project-mapping', '组件项目映射'],
  ['operation-master', '工序主数据'],
  ['process-defect-ledger', '不良品台账'],
] as const;
const searchBox = (page: Page) => page.getByRole('searchbox', { name: '搜索功能与联动' });
const directory = (page: Page) => page.getByRole('region', { name: '图谱目录' });
const graphCanvas = (page: Page) => page.locator('.qms-graph-scene canvas');

function syntheticGrowth(graph: Graph): Graph {
  expect(graph.nodes.length).toBeGreaterThan(0);
  const grown = { ...graph, version: `${graph.version} · 合成扩容`, nodes: [...graph.nodes], relations: [...graph.relations] };
  for (let copy = 1; grown.nodes.length < 320; copy++) {
    const suffix = ` · 扩容样本 ${copy}`;
    const nodes = graph.nodes.slice(0, 320 - grown.nodes.length);
    const ids = new Set(nodes.map(node => node.id));
    const copyId = (id: string) => `${id}-synthetic-${copy}`;
    grown.nodes.push(...nodes.map(node => ({ ...node, id: copyId(node.id), name: node.name + suffix })));
    grown.relations.push(...graph.relations.filter(edge => ids.has(edge.from) && ids.has(edge.to))
      .map(edge => ({ ...edge, id: copyId(edge.id), name: edge.name + suffix, from: copyId(edge.from), to: copyId(edge.to) })));
  }
  expect(grown.nodes.length).toBeGreaterThan(graph.nodes.length);
  return grown;
}

async function dragCanvas(page: Page) {
  const canvas = graphCanvas(page);
  const bounds = (await canvas.boundingBox())!;
  expect(bounds.width).toBeGreaterThan(300);
  await canvas.hover({ position: { x: 28, y: 28 } });
  await page.mouse.down();
  await page.mouse.move(bounds.x + 150, bounds.y + 77, { steps: 12 });
  await page.mouse.up();
}

async function measureInputToDetails(page: Page, graph: Graph, queries: readonly string[], catalog: string) {
  const search = searchBox(page);
  const samples: number[] = [];
  const searchSamples: number[] = [];
  const detailsSamples: number[] = [];
  const dispatchInclusiveSamples: number[] = [];
  for (let sample = 0; sample < 22; sample++) {
    const name = queries[sample % queries.length];
    const heading = page.getByRole('complementary', { name, exact: true }).getByRole('heading', { name, exact: true });
    await expect(heading).toHaveCount(0);
    await search.evaluate((input, name) => {
      const marks = ['search-input', 'search-result', 'select-keydown', 'details-focused'];
      for (const mark of marks) performance.clearMarks(`qms-graph-${mark}`);
      input.addEventListener('input', () => {
        performance.mark('qms-graph-search-input');
        input.addEventListener('keydown', () => performance.mark('qms-graph-select-keydown'), { capture: true, once: true });
        const observer = new MutationObserver(() => {
          const firstResult = document.querySelector('.qms-workbench-graph__results button');
          if (firstResult?.getAttribute('aria-label') === name && !performance.getEntriesByName('qms-graph-search-result').length) {
            performance.mark('qms-graph-search-result');
          }
          const heading = document.getElementById('workbench-graph-detail-heading');
          if (heading?.textContent === name && document.activeElement === heading) {
            performance.mark('qms-graph-details-focused');
            observer.disconnect();
          }
        });
        observer.observe(document.querySelector('.qms-workbench-graph')!, { childList: true, subtree: true, characterData: true });
      }, { capture: true, once: true });
    }, name);
    await search.fill(name);
    await page.keyboard.press('Enter');
    await expect(heading).toBeVisible();
    await expect(heading).toBeFocused();
    const [input, result, keydown, focused] = await page.evaluate(() =>
      ['search-input', 'search-result', 'select-keydown', 'details-focused']
        .map(mark => performance.getEntriesByName(`qms-graph-${mark}`, 'mark')[0]?.startTime ?? -1));
    expect(input, `input mark for ${name}`).toBeGreaterThan(0);
    expect(result).toBeGreaterThanOrEqual(input);
    expect(keydown).toBeGreaterThanOrEqual(result);
    expect(focused).toBeGreaterThanOrEqual(keydown);
    if (sample >= 2) {
      const searchMs = result - input;
      const detailsMs = focused - keydown;
      searchSamples.push(searchMs);
      detailsSamples.push(detailsMs);
      samples.push(searchMs + detailsMs);
      dispatchInclusiveSamples.push(focused - input);
    }
  }
  const p95 = (values: number[]) => values.sort((first, second) => first - second)[Math.ceil(values.length * 0.95) - 1];
  const browserP95 = p95(samples);
  console.log(JSON.stringify({ catalog, version: graph.version, nodes: graph.nodes.length, relations: graph.relations.length,
    viewport: page.viewportSize(), chromium: page.context().browser()?.version(), samples: samples.length, warmups: 2,
    metric: 'input → ranked result DOM + Enter → focused details DOM (excludes inter-action gap)', p95Ms: browserP95,
    searchP95Ms: p95(searchSamples), detailsP95Ms: p95(detailsSamples),
    dispatchInclusiveP95Ms: p95(dispatchInclusiveSamples), referenceP95Ms: 300, meetsReference: browserP95 <= 300 }));
}

test.use({ actionTimeout: 10_000, launchOptions: { args: ['--enable-unsafe-swiftshader'] } });
test.setTimeout(120_000);

test('workbench graph traces all six direct API ingestion edges from both ends', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 900 });
  await login(page);
  const response = page.waitForResponse(entry => new URL(entry.url()).pathname === graphPath && entry.status() === 200);
  await page.getByRole('button', { name: '功能图谱', exact: true }).click();
  const graph = await (await response).json() as Graph;
  await expect(directory(page).getByRole('status')).toHaveText(`${graph.nodes.length + graph.relations.length} 项`);
  const canvas = graphCanvas(page);
  await expect(canvas).toBeVisible({ timeout: 25_000 });
  await dragCanvas(page);

  const search = searchBox(page);
  await search.fill(ingestionName);
  await search.press('Enter');
  const details = page.getByRole('complementary', { name: ingestionName, exact: true });
  await expect(details).toBeVisible();
  await canvas.click({ position: { x: 8, y: 8 } });
  await expect(details).toHaveCount(0);
  await search.press('Enter');
  await expect(details.getByRole('heading', { name: '使用指南' })).toBeVisible();
  const downstream = details.getByRole('list', { name: '直接下游' });
  for (const [targetId, target] of ingestionTargets) {
    await test.step(`${ingestionName} → ${target} and back`, async () => {
      const edge = graph.relations.find(relation => relation.from === 'api-ingestion' && relation.to === targetId);
      expect(edge, `authenticated catalog must include a direct edge to ${target}`).toBeDefined();
      const direction = `${ingestionName} → ${target}`;
      const relation = page.getByRole('complementary', { name: edge!.name, exact: true });
      await downstream.getByRole('button', { name: edge!.name, exact: true }).filter({ hasText: direction }).click();
      await expect(page).toHaveURL(new URL(`/app/workbench?graphRelation=${edge!.id}`, baseURL).href);
      await expect(relation.getByRole('img', { name: '流向' })).toBeVisible();
      await expect(relation.getByText(edge!.content, { exact: true })).toBeVisible();
      await expect(relation.getByRole('heading', { name: '关联使用指南' })).toBeVisible();
      const labels = page.locator('.qms-graph-scene__labels');
      await expect(labels.getByText(ingestionName, { exact: true })).toBeVisible();
      await expect(labels.getByText(target, { exact: true })).toBeVisible();
      await relation.getByRole('button', { name: target, exact: true }).click();
      await expect(page).toHaveURL(new URL(`/app/workbench?graphNode=${targetId}`, baseURL).href);
      const upstream = page.getByRole('complementary', { name: target, exact: true }).getByRole('list', { name: '直接上游' });
      await upstream.getByRole('button', { name: edge!.name, exact: true }).filter({ hasText: direction }).click();
      await expect(page).toHaveURL(new URL(`/app/workbench?graphRelation=${edge!.id}`, baseURL).href);
      await relation.getByRole('button', { name: ingestionName, exact: true }).click();
      await expect(details).toBeVisible();
    });
  }
  await page.getByRole('button', { name: '复位', exact: true }).click();
  await expect(details).toHaveCount(0);
  await expect(search).toBeFocused();
  await expect(search).toHaveValue('');
  await expect(page).not.toHaveURL(/graphNode|graphRelation/);
  await measureInputToDetails(page, graph, [ingestionName, '工序主数据'], 'authenticated HTTP catalog');
  await page.getByRole('button', { name: '复位', exact: true }).click();
  for (const width of [1024, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await search.fill('制程问题跟进');
    await expect(page.getByRole('region', { name: '图谱目录' }).getByRole('button', { name: '制程问题跟进', exact: true })).toBeVisible();
    await search.press('ArrowDown');
    await expect(page.getByRole('button', { name: '制程问题跟进', exact: true })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('complementary', { name: '制程问题跟进' }).getByRole('list', { name: '直接上游' })).toContainText('不良品台账 → 制程问题跟进');
    await page.getByRole('button', { name: '复位', exact: true }).click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width + 1);
  }
  expect(errors).toEqual([]);
});

test('synthetic growth from authenticated HTTP retains canvas, theme and reset behavior with reduced motion', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await login(page);
  const response = await page.request.get(graphPath, { maxRedirects: 0 });
  expect(response.status()).toBe(200);
  const graph = syntheticGrowth(await response.json() as Graph);
  await page.route(new URL(graphPath, baseURL).href, route => route.fulfill({ json: graph }));
  await page.getByRole('button', { name: '功能图谱', exact: true }).click();
  await expect(directory(page).getByText(`目录版本 ${graph.version}`, { exact: true })).toBeVisible();
  const count = directory(page).getByRole('status');
  await expect(count).toHaveText(`${graph.nodes.length + graph.relations.length} 项`);
  const canvas = graphCanvas(page);
  await expect(canvas).toBeVisible({ timeout: 25_000 });
  const originalCanvas = await canvas.elementHandle();
  const labels = page.locator('.qms-graph-scene__labels span');
  const labelPositions = () => labels.evaluateAll(elements => elements.flatMap(element => {
    const style = getComputedStyle(element);
    if (style.visibility !== 'visible' || style.transform === 'none') return [];
    const transform = new DOMMatrixReadOnly(style.transform);
    return [{ label: element.textContent, x: Math.round(transform.m41), y: Math.round(transform.m42) }];
  }));
  await expect.poll(async () => (await labelPositions()).length).toBeGreaterThan(1);
  const initialPositions = await labelPositions();
  await dragCanvas(page);
  await expect.poll(labelPositions).not.toEqual(initialPositions);
  await expect(page.locator('.qms-workbench-graph__detail')).toHaveCount(0);

  const search = searchBox(page);
  const filters = [['领域', 'API 接入'], ['功能状态', 'development'], ['联动类型', 'data']] as const;
  const filterControl = (name: string) => page.getByRole('group', { name: '目录筛选' })
    .locator('label').filter({ hasText: new RegExp(`^${name}`) }).getByRole('combobox');
  const reset = page.getByRole('button', { name: '复位', exact: true });
  await expect(reset).toHaveCSS('transition-property', 'none');
  await search.fill('API入库衔接 · 扩容样本 1');
  await search.press('Enter');
  const expanded = page.getByRole('complementary', { name: 'API入库衔接 · 扩容样本 1', exact: true });
  await expect(expanded).toBeVisible();
  await expanded.getByRole('button', { name: '展开第二跳' }).click();
  await expect(expanded.getByRole('list', { name: '第二跳联动' })).toBeVisible();
  for (const [filter, value] of filters) await filterControl(filter).selectOption(value);
  await expect(count).not.toHaveText(`${graph.nodes.length + graph.relations.length} 项`);
  await reset.press('Enter');
  await expect(expanded).toHaveCount(0);
  await expect(search).toBeFocused();
  await expect(search).toHaveValue('');
  for (const [filter] of filters) await expect(filterControl(filter)).toHaveValue('');
  await expect(page).toHaveURL(new URL('/app/workbench', baseURL).href);
  await expect(count).toHaveText(`${graph.nodes.length + graph.relations.length} 项`);
  await expect.poll(labelPositions).toEqual(initialPositions);

  const directoryBorder = () => directory(page).evaluate(element => getComputedStyle(element).borderTopColor);
  await expect(page.locator('html')).toHaveAttribute('data-qms-appearance', 'light');
  const lightBorder = await directoryBorder();
  await page.getByRole('button', { name: '外观设置', exact: true }).click();
  await page.getByRole('radio', { name: '深色', exact: true }).press('Space');
  await page.getByRole('dialog', { name: '外观设置' }).getByRole('button', { name: /close|关闭/i }).click();
  await expect(page.locator('html')).toHaveAttribute('data-qms-appearance', 'dark');
  await expect.poll(directoryBorder).not.toEqual(lightBorder);
  await expect.poll(labelPositions).toEqual(initialPositions);
  await measureInputToDetails(page, graph, ['API入库衔接 · 扩容样本 1', '工序主数据 · 扩容样本 1'], 'synthetic growth (browser only)');
  expect(await canvas.evaluate((element, initial) => element === initial, originalCanvas)).toBe(true);
  expect(errors).toEqual([]);
});

test('no WebGL keeps workbench graph deep links, relations and guides available', async ({ page }) => {
  await page.addInitScript(() => {
    const native = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...args: unknown[]) {
      return type.startsWith('webgl') ? null : Reflect.apply(native, this, [type, ...args]);
    } as typeof native;
  });
  await login(page, '/app/workbench?graphNode=process-defect-ledger');
  await expect(page.getByText('三维视图不可用，请使用图谱目录。')).toBeVisible();
  await expect(page.locator('.qms-graph-scene canvas')).toHaveCount(0);
  const detail = page.getByRole('complementary', { name: '不良品台账' });
  await expect(detail.getByRole('heading', { name: '使用指南' })).toBeVisible();
  await expect(detail.getByRole('list', { name: '直接下游' })).toContainText('不良品台账 → 制程问题跟进');
});
