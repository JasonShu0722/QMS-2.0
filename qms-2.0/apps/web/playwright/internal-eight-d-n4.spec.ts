import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { expect, test, type Locator, type Page, type Response, type TestInfo } from '@playwright/test';
import type { components } from '@qms/contracts';
import { completeMfa } from './mfa-login';
import { fillSecret } from './secret-input';

type Schema = components['schemas'];
type Domain = 'customer-quality' | 'new-product-quality';
type Report = Schema['CustomerEightDReportDto'] | Schema['NewProductEightDReportDto'];
type Fixture = { domain: Domain; organizationId: string; projectId: string; sectionName: string; sectionId: string;
  password: string; people: Record<'owner' | 'professional' | 'manager' | 'minister', { id: string; username: string; name: string }>;
  sources: { sourceId: string; factId: string; expectedVersion: number; sourceType: string;
    snapshot: Record<string, unknown>; complaintNumber?: string }[] };

test.setTimeout(120_000);
test.use({ trace: 'off', screenshot: 'off', video: 'off' });
let fixtures: Fixture[];

test.beforeAll(() => {
  const directory = process.env.QMS_N4_BROWSER_HELPER_DIR;
  const file = process.env.QMS_N4_BROWSER_FIXTURE_FILE;
  if (process.env.QMS_N4_BROWSER_FREEZE_ACK !== 'true' || process.env.QMS_N4_BROWSER_DATABASE_READY !== 'true'
    || !directory || !file || !process.env.QMS_ACCEPTANCE_MFA_CACHE_FILE || !process.env.QMS_BACKUP_KEY
    || process.env.QMS_DISPOSABLE_TEST_DB !== 'true' || process.env.QMS_ACCEPTANCE_DISPOSABLE_DATABASE !== 'true') {
    throw new Error('N4 browser stories require parent freeze/database ACKs and external disposable fixture/MFA configuration; no skips.');
  }
  for (const path of [directory, file, process.env.QMS_ACCEPTANCE_MFA_CACHE_FILE]) {
    const location = relative(resolve(process.cwd(), '../../..'), path);
    if (!isAbsolute(path) || !(location === '..' || location.startsWith(`..${sep}`) || isAbsolute(location))) {
      throw new Error('N4 acceptance artifacts must remain outside the checkout.');
    }
  }
  // Fixture output can contain secrets on setup failure; never forward child stdout/stderr to Playwright reports.
  try { execFileSync(process.execPath, [join(directory, 'fixture.mjs')], { windowsHide: true, stdio: 'pipe', timeout: 110_000 }); }
  catch (error) {
    const output = error as { stderr?: Buffer; stdout?: Buffer };
    writeFileSync(join(directory, 'fixture.private.stderr.log'), output.stderr ?? Buffer.from('Fixture subprocess failed before stderr was captured.'));
    writeFileSync(join(directory, 'fixture.private.stdout.log'), output.stdout ?? Buffer.alloc(0));
    throw new Error('Real N4 fixture setup failed; inspect the private helper logs without publishing secrets. No browser acceptance ran.');
  }
  fixtures = JSON.parse(readFileSync(file, 'utf8')) as Fixture[];
  expect(fixtures.map(f => f.domain)).toEqual(['customer-quality', 'new-product-quality']);
});

async function login(page: Page, f: Fixture, duty: 'professional' | 'owner') {
  const person = f.people[duty];
  await page.goto('/login');
  await page.getByLabel('账号', { exact: true }).fill(person.username);
  await fillSecret(page.getByLabel('密码', { exact: true }), f.password);
  const pending = page.waitForResponse(response => new URL(response.url()).pathname === '/api/v1/auth/login' && response.request().method() === 'POST');
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await completeMfa(page.request, await pending, person.username, page);
  await expect(page).toHaveURL(/\/app\/workbench$/);
  const response = await page.request.get('/api/v1/auth/session');
  expect(response.status()).toBe(200);
  const session = await response.json() as Schema['SessionResponseDto'];
  expect(session.user).toMatchObject({ id: person.id, organizationId: f.organizationId, accountType: 'INTERNAL' });
}

async function uiResponse(page: Page, method: string, path: string, action: () => Promise<void>, status = 200): Promise<Response> {
  const pending = page.waitForResponse(response => response.request().method() === method && new URL(response.url()).pathname === path);
  await action();
  const response = await pending;
  expect(response.status(), `${method} ${path}`).toBe(status);
  return response;
}

async function selectOption(page: Page, field: Locator, label: string) {
  await expect(field).toBeEnabled();
  await field.click();
  await page.locator('.ant-select-dropdown:visible .ant-select-item-option-content').filter({ hasText: new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) }).click();
  await expect(page.locator('.ant-select-dropdown:visible')).toHaveCount(0);
}

async function readReport(page: Page, path: string) {
  const response = await page.request.get(path);
  expect(response.status()).toBe(200);
  return await response.json() as Report;
}

async function evidence(info: TestInfo, name: string, data: unknown) {
  const path = info.outputPath(name);
  writeFileSync(path, JSON.stringify(data, null, 2));
  await info.attach(name, { path, contentType: 'application/json' });
}

async function geometry(page: Page, info: TestInfo, stage: string, target: Locator) {
  for (const width of [1440, 375]) {
    await page.setViewportSize({ width, height: 960 });
    await expect(target).toBeVisible();
    const dimensions = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth,
      body: document.body.scrollWidth, overflowing: [...document.querySelectorAll('body *')].flatMap(element => {
        const rect = element.getBoundingClientRect();
        const css = getComputedStyle(element);
        if (!rect.width || !rect.height || css.display === 'none' || css.visibility === 'hidden' || css.opacity === '0'
          || rect.right <= innerWidth + 1 && rect.left >= -1) return [];
        return [{ tag: element.tagName, id: element.id, className: element.getAttribute('class'),
          rect: { x: rect.x, y: rect.y, width: rect.width, right: rect.right }, width: css.width, minWidth: css.minWidth,
          overflowX: css.overflowX, position: css.position, transform: css.transform }];
      }).sort((a, b) => b.rect.right - a.rect.right).slice(0, 16) }));
    await evidence(info, `${stage}-${width}-geometry.json`, dimensions);
    expect.soft(dimensions.document, `${stage} must contain horizontal scrolling locally at ${width}px`).toBeLessThanOrEqual(width + 1);
    expect.soft(dimensions.body).toBeLessThanOrEqual(width + 1);
    await target.scrollIntoViewIfNeeded();
    const box = await target.boundingBox();
    expect(box).not.toBeNull();
    expect.soft(box!.x).toBeGreaterThanOrEqual(-1);
    expect.soft(box!.x + box!.width).toBeLessThanOrEqual(width + 1);
  }
  await page.setViewportSize({ width: 1440, height: 960 });
}

for (const domain of ['customer-quality', 'new-product-quality'] as const) {
  test(`${domain}: real UI issue, saved workspace/report, declared fields, source change and task deep links`, async ({ page, browser }, info) => {
    const f = fixtures.find(item => item.domain === domain)!;
    const base = `/api/v1/${domain}/eight-d`;
    const label = domain === 'customer-quality' ? '客户' : '新品';
    const [original, extra] = f.sources;
    await login(page, f, 'professional');
    if (domain === 'customer-quality') {
      await page.goto('/app/customer-quality');
      await page.getByRole('checkbox', { name: `选择客诉 ${original.complaintNumber}`, exact: true }).check();
      await page.getByRole('button', { name: '发起客户8D', exact: true }).click();
    } else {
      await page.goto('/app/new-product-quality');
      await page.getByRole('textbox', { name: '新产品项目 ID', exact: true }).fill(f.projectId);
      await page.getByRole('button', { name: '查看项目', exact: true }).click();
      await page.getByRole('button', { name: '新品同源8D', exact: true }).click();
      await page.getByRole('checkbox', { name: `选择新品来源 ${original.sourceId}`, exact: true }).check();
      await page.getByRole('button', { name: '发起新品8D', exact: true }).click();
    }
    const drawer = page.getByRole('dialog', { name: '发起正式内部8D', exact: true });
    await expect(drawer.getByRole('radio', { name: '非复发', exact: true })).toBeEnabled();
    await drawer.getByRole('radio', { name: '非复发', exact: true }).check();
    await drawer.getByRole('textbox', { name: `判定说明 ${original.sourceId}`, exact: true }).fill('Same original fact reviewed; this issue has a different verified cause, not recurrence.');
    await selectOption(page, drawer.getByLabel('风险等级', { exact: true }), '低');
    await selectOption(page, drawer.getByLabel('责任科室', { exact: true }), f.sectionName);
    await selectOption(page, drawer.getByLabel('负责人', { exact: true }), f.people.owner.name);
    await drawer.getByLabel('分析/对策期限', { exact: true }).fill('2026-11-01');
    await drawer.getByLabel('关闭计划', { exact: true }).fill('2026-12-01');
    const issueButton = drawer.getByRole('button', { name: '确认发起8D', exact: true });
    await geometry(page, info, 'issue-drawer', issueButton);
    const issuedResponse = await uiResponse(page, 'POST', base, () => issueButton.click(), 201);
    const issued = await issuedResponse.json() as Schema['ProcessIssueResultDto'];
    const id = issued.problem.id;
    const path = `${base}/${id}`;
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    await expect(page.getByRole('link', { name: '查看问题', exact: true })).toHaveAttribute('href', `/app/problem-workspace/${id}`);
    await page.getByRole('link', { name: '查看问题', exact: true }).click();
    await expect(page.getByRole('region', { name: `正式${label} 8D 工作区`, exact: true })).toBeVisible();
    const initial = await readReport(page, path);
    expect(initial).toMatchObject({ problemId: id, ownerUserId: f.people.owner.id, professionalUserId: f.people.professional.id });
    expect(initial.sources).toMatchObject([{ sourceId: original.sourceId, sourceVersion: original.expectedVersion }]);

    const ownerContext = await browser.newContext({ baseURL: process.env.QMS_ACCEPTANCE_BASE_URL, viewport: { width: 1440, height: 960 } });
    try {
      const owner = await ownerContext.newPage();
      await login(owner, f, 'owner');
      await owner.goto(`/app/problem-workspace/${id}`);
      const workspace = owner.getByRole('region', { name: `正式${label} 8D 工作区`, exact: true });
      const description = workspace.getByRole('textbox', { name: 'D2 问题描述', exact: true });
      await expect(description).toBeEnabled();
      const text = `N4 ${domain} saved by the actual appointed owner ${id}`;
      await description.fill(text);
      const saved = await (await uiResponse(owner, 'PUT', path, () => workspace.getByRole('button', { name: '保存草稿', exact: true }).click())).json() as Report;
      expect(saved.document.description).toBe(text);
      expect(saved.contentVersion).toBeGreaterThan(initial.contentVersion);
      await owner.reload();
      await expect(description).toHaveValue(text);
      await geometry(owner, info, 'saved-workspace', workspace.getByRole('button', { name: '保存草稿', exact: true }));

      await workspace.getByRole('button', { name: '完整提交', exact: true }).click();
      const submission = owner.getByRole('dialog', { name: `${issued.problem.reportNumber} · 完整提交`, exact: true });
      const rejected = await (await uiResponse(owner, 'POST', `${path}/submit`, () => submission.getByRole('button', { name: '确认提交', exact: true }).click(), 400)).json() as Schema['ErrorResponse'];
      expect(rejected.code).toContain('EIGHT_D_SUBMISSION_INCOMPLETE');
      expect(Object.keys(rejected.fields)).toContain('analysisCompletedAt');
      expect(Object.keys(rejected.fields).length).toBeGreaterThan(1);
      for (const field of Object.keys(rejected.fields)) await expect(submission.locator('code').filter({ hasText: new RegExp(`^${field.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) })).toBeVisible();
      await evidence(info, 'server-declared-fields.json', { domain, problemId: id, code: rejected.code, fields: rejected.fields, traceId: rejected.traceId });
      await submission.getByRole('button', { name: '取消', exact: true }).click();

      await workspace.getByRole('button', { name: '调整来源', exact: true }).click();
      const adjustment = owner.getByRole('dialog', { name: `${issued.problem.reportNumber} · 调整来源`, exact: true });
      const picker = adjustment.getByRole('region', { name: '调整内部8D来源', exact: true });
      if (domain === 'customer-quality') {
        await picker.getByRole('checkbox', { name: new RegExp(extra.complaintNumber!) }).check();
      } else {
        const response = await owner.request.get(`/api/v1/new-product-quality/projects/${f.projectId}/defect-selections?organizationId=${f.organizationId}`);
        expect(response.status()).toBe(200);
        const rows = await response.json() as Schema['NewProductDefectSelectionDto'][];
        const available = rows.filter(row => row.id !== original.sourceId);
        const index = available.findIndex(row => row.id === extra.sourceId);
        expect(index).toBeGreaterThanOrEqual(0);
        await expect(picker.getByRole('checkbox')).toHaveCount(available.length + 1);
        // Available selections have identical original descriptions; index is derived from the real ordered response, never a fixture position.
        await picker.getByRole('checkbox').nth(index).check();
      }
      await picker.getByRole('radio', { name: `主来源 ${extra.sourceId}`, exact: true }).check();
      await picker.getByRole('button', { name: '预览并核对来源关联', exact: true }).click();
      await expect(picker.getByText('未发现其他关联', { exact: true })).toBeVisible();
      await adjustment.getByLabel('变更 / 申请理由', { exact: true }).fill('Actual UI source addition and explicit primary change');
      const changed = await (await uiResponse(owner, 'PUT', `${path}/sources`, () => adjustment.getByRole('button', { name: '确认提交', exact: true }).click())).json() as Report;
      expect(changed.sources).toHaveLength(2);
      expect(changed.sources).toEqual(expect.arrayContaining([
        expect.objectContaining({ sourceId: original.sourceId, primary: false, sourceVersion: original.expectedVersion, snapshot: original.snapshot }),
        expect.objectContaining({ sourceId: extra.sourceId, primary: true, sourceVersion: extra.expectedVersion, snapshot: extra.snapshot }),
      ]));

      const controlledPath = `${path}/report`;
      const controlled = await (await uiResponse(owner, 'GET', controlledPath, () => workspace.getByRole('tab', { name: '报告', exact: true }).click())).json() as Schema['ProcessEightDControlledReportDto'];
      expect(controlled).toMatchObject({ problemId: id, contentVersion: changed.contentVersion, snapshot: { document: { description: text } } });
      expect(controlled.snapshot.sources.map(source => [source.sourceId, source.sourceVersion]).sort()).toEqual(
        f.sources.map(source => [source.sourceId, source.expectedVersion]).sort());
      await expect(workspace.getByRole('textbox', { name: 'D2 问题描述', exact: true })).toHaveValue(text);
      const pdfButton = workspace.getByRole('button', { name: '授权下载 PDF', exact: true });
      await geometry(owner, info, 'controlled-report', pdfButton);
      const downloading = owner.waitForEvent('download');
      const pdf = await uiResponse(owner, 'GET', `${path}/report/pdf`, () => pdfButton.click());
      expect(pdf.headers()['content-type']).toContain('application/pdf');
      const download = await downloading;
      expect(await download.failure()).toBeNull();
      const stream = await download.createReadStream();
      expect(stream).not.toBeNull();
      const chunks: Buffer[] = [];
      for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
      const bytes = Buffer.concat(chunks);
      await evidence(info, 'pdf-delivery.json', { status: pdf.status(), contentType: pdf.headers()['content-type'],
        contentLength: pdf.headers()['content-length'], responseBodyBytes: (await pdf.body()).length,
        downloadedBytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
      expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
      await evidence(info, 'domain-story.json', { domain, problemId: id, reportNumber: issued.problem.reportNumber,
        sourceVersions: changed.sources.map(source => ({ sourceId: source.sourceId, sourceVersion: source.sourceVersion, primary: source.primary })),
        initialVersion: initial.version, savedVersion: saved.version, changedVersion: changed.version,
        controlledVersion: controlled.contentVersion, pdf: { bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') } });

      await owner.goto('/app/my-tasks');
      await owner.getByRole('tab', { name: `${label}8D`, exact: true }).click();
      const tasks = owner.getByRole('region', { name: `${label}8D正式待办`, exact: true });
      const row = tasks.getByRole('row').filter({ hasText: issued.problem.reportNumber });
      await expect(row).toHaveCount(1);
      const reportLink = row.getByRole('link', { name: '打开8D报告', exact: true });
      await expect(reportLink).toHaveAttribute('href', `/app/problem-workspace/${id}?view=report`);
      await geometry(owner, info, 'task-inbox', tasks.getByRole('button', { name: '刷新8D待办', exact: true }));
      await reportLink.click();
      await expect(owner).toHaveURL(new RegExp(`/app/problem-workspace/${id}\\?view=report$`));
      await expect(owner.getByRole('tab', { name: '报告预览', exact: true })).toHaveAttribute('aria-selected', 'true');
      await owner.goto('/app/my-tasks');
      await owner.getByRole('tab', { name: `${label}8D`, exact: true }).click();
      const workLink = tasks.getByRole('row').filter({ hasText: issued.problem.reportNumber }).getByRole('link', { name: '确认分析完成', exact: true });
      await expect(workLink).toHaveAttribute('href', `/app/problem-workspace/${id}`);
      await workLink.click();
      await expect(description).toHaveValue(text);
    } finally { await ownerContext.close(); }
  });
}
