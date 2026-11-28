import { readFileSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import type { components } from '@qms/contracts';

type Schema = components['schemas'];
type ReportFixture = { id: string; reportNumber: string; title: string };
type Fixture = { organizationId: string; userId: string; editable: ReportFixture; historical: ReportFixture };

const fixturePath = process.env.QMS_181_BROWSER_FIXTURE_FILE;
const storageState = process.env.QMS_181_BROWSER_STORAGE_STATE;
const reportPath = (id: string) => `/api/v1/process-quality/eight-d/${id}`;
const workspacePath = (id: string) => `/app/problem-workspace/${id}`;
const descriptionLabel = 'D2 问题描述';
const unsavedDescription = '未保存草稿 · #181 浏览器回归';
let fixture: Fixture;

test.use({ storageState, viewport: { width: 1440, height: 960 }, actionTimeout: 12_000, trace: 'off', screenshot: 'off', video: 'off' });
test.setTimeout(75_000);

test.beforeAll(() => {
  if (!(process.env.QMS_ACCEPTANCE_BASE_URL ?? process.env.PLAYWRIGHT_BASE_URL) || !fixturePath || !storageState) {
    throw new Error('复用一次性网关须提供 QMS_ACCEPTANCE_BASE_URL、QMS_181_BROWSER_FIXTURE_FILE 和 QMS_181_BROWSER_STORAGE_STATE。');
  }
  for (const path of [fixturePath, storageState]) {
    const location = relative(resolve(process.cwd(), '../../..'), path);
    if (!isAbsolute(path) || !(location.startsWith(`..${sep}`) || isAbsolute(location))) {
      throw new Error('8D 浏览器 fixture 和已认证 storageState 必须使用仓库外的绝对路径。');
    }
  }
  fixture = JSON.parse(readFileSync(fixturePath, 'utf8')) as Fixture;
  if (!fixture.organizationId || !fixture.userId || !fixture.editable?.id || !fixture.historical?.id
      || fixture.editable.id === fixture.historical.id || !fixture.editable.title || !fixture.historical.title
      || fixture.editable.title === fixture.historical.title || !fixture.editable.reportNumber || !fixture.historical.reportNumber
      || fixture.editable.title === fixture.editable.reportNumber || fixture.historical.title === fixture.historical.reportNumber) {
    throw new Error('8D fixture 须提供 organizationId、userId，以及标题不同的 editable 和 historical 单据（id、reportNumber、title）。');
  }
});

function readFromUi(page: Page, path: string, query?: Record<string, string>) {
  return page.waitForResponse(response => {
    const url = new URL(response.url());
    return response.request().method() === 'GET' && url.pathname === path
      && Object.entries(query ?? {}).every(([key, value]) => url.searchParams.get(key) === value);
  });
}

test('#181 制程 8D 保留章节草稿、收纳工作标签并只读预览历史版', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('qms:locale:v1', 'zh-CN'));
  const sessionResponse = await page.request.get('/api/v1/auth/session');
  expect(sessionResponse.status()).toBe(200);
  const session = await sessionResponse.json() as Schema['SessionResponseDto'];
  expect(session.user).toMatchObject({ id: fixture.userId, organizationId: fixture.organizationId, accountType: 'INTERNAL' });

  const editablePath = reportPath(fixture.editable.id);
  const editableRead = readFromUi(page, editablePath);
  await page.goto(`${workspacePath(fixture.editable.id)}?organizationId=${encodeURIComponent(fixture.organizationId)}`);
  const editableResponse = await editableRead;
  expect(editableResponse.status()).toBe(200);
  const editableReport = await editableResponse.json() as Schema['ProcessEightDReportDto'];
  const main = page.locator('main.problem-workspace');
  await expect(main.getByRole('heading', { name: fixture.editable.title, exact: true })).toBeVisible();
  const description = main.getByRole('textbox', { name: descriptionLabel, exact: true });
  const directory = main.getByRole('navigation', { name: '8D 内容分区' });
  const chapterTwo = directory.getByRole('button', { name: /^D2 ·/ });
  const chapterFive = directory.getByRole('button', { name: /^D5 ·/ });
  const chapterSix = directory.getByRole('button', { name: /^D6 ·/ });
  const directoryToggle = main.getByRole('button', { name: '章节目录', exact: true });
  await expect(description).toBeEditable();
  const originalDescription = await description.inputValue();
  expect(originalDescription).not.toBe(unsavedDescription);
  await description.fill(unsavedDescription);
  await chapterFive.click();
  await expect(chapterFive).toHaveAttribute('aria-current', 'step');
  await expect(main.getByRole('heading', { name: /^D5 ·/ })).toBeVisible();
  await expect(main.getByRole('heading', { name: /^D6 ·/ })).toBeHidden();
  await expect(description).toBeHidden();
  const planList = main.getByRole('region', { name: '措施计划清单', exact: true });
  const resultsList = main.getByRole('region', { name: '措施实绩清单', exact: true });
  const planNames = ['复查压装参数', '验证检验覆盖'];
  const firstActionNumber = editableReport.document.correctiveActions.length + 1;
  const actionCount = editableReport.document.correctiveActions.length + planNames.length;
  for (const [index, name] of planNames.entries()) {
    const row = firstActionNumber + index;
    await main.getByRole('button', { name: '增加永久措施', exact: true }).click();
    await planList.getByRole('textbox', { name: `措施 ${row} 对策`, exact: true }).fill(name);
  }
  const firstPlan = planList.getByRole('textbox', { name: `措施 ${firstActionNumber} 对策`, exact: true });
  await expect(planList.getByRole('columnheader')).toHaveText(['对策', '原因类型', '责任人', '计划完成日期', '操作']);
  await expect(planList.getByLabel(/验证方法/)).toHaveCount(0);
  await expect(planList.getByText(/验证方法/)).toHaveCount(0);
  await expect(planList.getByRole('button', { name: /^详情 措施 / })).toHaveCount(0);
  await chapterSix.click();
  await expect(main.getByRole('heading', { name: /^D6 ·/ })).toBeVisible();
  await expect(resultsList.getByRole('columnheader')).toHaveText(['对策', '实施人', '验证人', '实施日期', '有效性结论', '操作']);
  const actionDetails = page.getByRole('button', { name: /^详情 措施 / });
  const resultRows = resultsList.getByRole('row').filter({ has: actionDetails });
  const firstDetails = page.getByRole('button', { name: `详情 措施 ${firstActionNumber}`, exact: true });
  const secondDetails = page.getByRole('button', { name: `详情 措施 ${firstActionNumber + 1}`, exact: true });
  const firstResult = resultRows.filter({ has: firstDetails });
  const secondResult = resultRows.filter({ has: secondDetails });
  await expect(resultRows).toHaveCount(actionCount);
  await expect(firstResult).toContainText(planNames[0]);
  await expect(secondResult).toContainText(planNames[1]);
  const effective = firstResult.getByRole('combobox', { name: `措施 ${firstActionNumber} 人工有效性结论`, exact: true });
  const secondEffective = secondResult.getByRole('combobox', { name: `措施 ${firstActionNumber + 1} 人工有效性结论`, exact: true });
  await expect(effective).toHaveValue('');
  await expect(secondEffective).toHaveValue('');
  await expect(main.getByRole('button', { name: '增加永久措施', exact: true })).toBeHidden();
  await firstResult.getByRole('textbox', { name: `措施 ${firstActionNumber} 实施人`, exact: true }).fill('实施人员');
  await firstResult.getByRole('textbox', { name: `措施 ${firstActionNumber} 验证人`, exact: true }).fill('验证人员');
  await firstResult.getByLabel(`措施 ${firstActionNumber} 实施日期`, { exact: true }).fill('2026-11-27');
  const tracking = main.getByRole('heading', { name: '效果跟踪', exact: true }).locator('..');
  await expect(tracking.getByText(/持续监控三个月/)).toBeVisible();
  const trackingOrder = tracking.getByRole('textbox', { name: '开始订单号', exact: true });
  const trackingQuantity = tracking.getByRole('spinbutton', { name: '生产数量', exact: true });
  await expect(tracking.getByLabel('开始日期', { exact: true })).toHaveValue('');
  await expect(trackingOrder).toHaveValue('');
  await expect(trackingQuantity).toHaveValue('');
  await trackingOrder.fill('ORDER-181');
  await trackingQuantity.fill('120');
  await expect(effective).toHaveValue('');
  await firstDetails.click();
  const comparison = resultsList.getByRole('region', { name: `措施 ${firstActionNumber}`, exact: true })
    .getByRole('group', { name: '改善前后对照', exact: true });
  const before = comparison.getByRole('textbox', { name: `措施 ${firstActionNumber} 改善前`, exact: true });
  const after = comparison.getByRole('textbox', { name: `措施 ${firstActionNumber} 改善后`, exact: true });
  await before.fill('抽检发现压装开裂');
  await after.fill('抽检仍有开裂');
  const beforeBox = await before.boundingBox();
  const afterBox = await after.boundingBox();
  if (!beforeBox || !afterBox) throw new Error('桌面须同时显示改善前和改善后字段。');
  expect(afterBox.x).toBeGreaterThan(beforeBox.x);
  expect(Math.abs(afterBox.y - beforeBox.y)).toBeLessThan(4);
  await effective.selectOption('false');
  await expect(effective.getByRole('option', { name: '无效', exact: true })).toHaveJSProperty('selected', true);
  await chapterFive.click();
  await expect(firstPlan).toHaveValue(planNames[0]);
  await firstPlan.fill('调整压装参数与夹具');
  await chapterSix.click();
  await expect(resultRows).toHaveCount(actionCount);
  await expect(firstResult).toContainText('调整压装参数与夹具');
  await expect(secondResult).toContainText(planNames[1]);
  await expect(secondEffective).toHaveValue('');
  await expect(firstResult.getByRole('textbox', { name: `措施 ${firstActionNumber} 实施人`, exact: true })).toHaveValue('实施人员');
  await expect(firstResult.getByRole('textbox', { name: `措施 ${firstActionNumber} 验证人`, exact: true })).toHaveValue('验证人员');
  await expect(firstResult.getByLabel(`措施 ${firstActionNumber} 实施日期`, { exact: true })).toHaveValue('2026-11-27');
  await expect(before).toHaveValue('抽检发现压装开裂');
  await expect(after).toHaveValue('抽检仍有开裂');
  await expect(effective).toHaveValue('false');
  await expect(trackingOrder).toHaveValue('ORDER-181');
  await expect(trackingQuantity).toHaveValue('120');
  await chapterTwo.click();
  await expect(description).toHaveValue(unsavedDescription);

  await page.setViewportSize({ width: 375, height: 812 });
  await expect(directoryToggle).toHaveAttribute('aria-expanded', 'false');
  await expect(directory).toBeHidden();
  await directoryToggle.click();
  await expect(directory).toBeVisible();
  await directory.getByRole('button', { name: /^D1 ·/ }).click();
  await expect(main.getByRole('heading', { name: /^D1 ·/ })).toBeVisible();
  await expect(directory).toBeHidden();
  await directoryToggle.click();
  await chapterSix.click();
  await secondDetails.click();
  await expect(secondDetails).toHaveAttribute('aria-expanded', 'true');
  const mobileComparison = resultsList.getByRole('region', { name: `措施 ${firstActionNumber + 1}`, exact: true })
    .getByRole('group', { name: '改善前后对照', exact: true });
  await mobileComparison.scrollIntoViewIfNeeded();
  await expect(mobileComparison).toBeInViewport({ ratio: 0.9 });
  await directoryToggle.click();
  await chapterTwo.click();
  await expect(description).toHaveValue(unsavedDescription);
  await page.setViewportSize({ width: 1440, height: 960 });

  const currentPreview = readFromUi(page, `${editablePath}/report`, { view: 'CURRENT' });
  await main.getByRole('tab', { name: '报告', exact: true }).click();
  expect((await currentPreview).status()).toBe(200);
  const currentArticle = main.getByRole('article', { name: fixture.editable.reportNumber, exact: true });
  const currentDescription = currentArticle.locator('section').filter({ has: page.getByRole('heading', { name: /^D2 ·/ }) });
  await expect(currentDescription.locator('dd').first()).toHaveText(originalDescription || '未记录');
  await expect(currentArticle.getByRole('textbox')).toHaveCount(0);
  await main.getByRole('tab', { name: '工作区', exact: true }).click();
  await expect(description).toHaveValue(unsavedDescription);
  await expect(main.getByRole('link', { name: '返回问题中心', exact: true })).toHaveCount(0);
  const problemCenter = page.getByRole('navigation', { name: '问题中心 上下文菜单', exact: true })
    .getByRole('link', { name: '问题管理面板', exact: true });
  const leave = page.getByRole('dialog', { name: '当前草稿尚未保存，继续将放弃修改。' });
  await problemCenter.click();
  await leave.getByRole('button', { name: '继续编辑', exact: true }).click();
  await expect(description).toHaveValue(unsavedDescription);
  await problemCenter.click();
  await leave.getByRole('button', { name: '放弃修改', exact: true }).click();

  const problemList = page.getByRole('region', { name: '问题列表', exact: true });
  await problemList.getByLabel('报告编号检索', { exact: true }).fill(fixture.historical.reportNumber);
  await problemList.getByRole('button', { name: /^查\s*询$/ }).click();
  const historicalPath = reportPath(fixture.historical.id);
  const historicalRead = readFromUi(page, historicalPath);
  await problemList.getByRole('link', { name: fixture.historical.reportNumber, exact: true }).click();
  const historicalResponse = await historicalRead;
  expect(historicalResponse.status()).toBe(200);
  const historicalReport = await historicalResponse.json() as Schema['ProcessEightDReportDto'];
  expect(historicalReport.status).toBe('CLOSED');
  const revision = historicalReport.revisions.find(item => item.id === historicalReport.closedRevisionId);
  if (!revision) throw new Error('fixture 须含可选择的关闭版次。');
  await expect(main.getByRole('heading', { name: fixture.historical.title, exact: true })).toBeVisible();
  await main.getByRole('tab', { name: '报告', exact: true }).click();
  const versions = main.getByRole('combobox', { name: '报告版本', exact: true });
  await expect(versions.getByRole('option', { name: /^历史版 ·/ }).filter({ hasText: revision.recordedAt })).toHaveAttribute('value', revision.id);
  const historicalPreview = readFromUi(page, `${historicalPath}/report`, { revisionId: revision.id });
  await versions.selectOption(revision.id);
  const previewResponse = await historicalPreview;
  expect(previewResponse.status()).toBe(200);
  const preview = await previewResponse.json() as Schema['ProcessEightDControlledReportDto'];
  expect(preview).toMatchObject({ problemId: fixture.historical.id, view: 'HISTORICAL', revisionId: revision.id });
  const historicalArticle = main.getByRole('article', { name: fixture.historical.reportNumber, exact: true });
  const reportChapter = (chapter: number) => historicalArticle.locator('section')
    .filter({ has: page.getByRole('heading', { name: new RegExp(`^D${chapter} ·`) }) });
  await expect(historicalArticle.getByText(preview.label, { exact: true })).toBeVisible();
  await expect(reportChapter(2).getByText(preview.snapshot.document.description, { exact: true })).toBeVisible();
  await expect(historicalArticle.getByRole('textbox')).toHaveCount(0);
  await expect(main.getByRole('button', { name: '保存草稿', exact: true })).toHaveCount(0);
  const historicalActions = preview.snapshot.document.correctiveActions;
  expect(historicalActions.length).toBeGreaterThanOrEqual(2);
  const reportDirectory = historicalArticle.getByRole('navigation', { name: '8D 内容分区', exact: true });
  const reportPlans = reportChapter(5).getByRole('row').filter({ has: page.getByRole('cell', { name: /.+/ }) });
  const reportResults = reportChapter(6).locator('section');
  await reportDirectory.getByRole('link', { name: 'D5', exact: true }).click();
  await expect(reportChapter(5).getByRole('heading', { name: /^D5 ·/ })).toBeInViewport();
  await expect(reportChapter(2)).toBeVisible();
  await expect(reportPlans).toHaveCount(historicalActions.length);
  await reportDirectory.getByRole('link', { name: 'D6', exact: true }).click();
  await expect(reportChapter(6).getByRole('heading', { name: /^D6 ·/ })).toBeInViewport();
  await expect(reportPlans).toHaveCount(historicalActions.length);
  await expect(reportResults).toHaveCount(historicalActions.length);
  for (const [index, action] of historicalActions.entries()) {
    await expect(reportPlans.nth(index).getByText(action.action, { exact: true })).toBeVisible();
    const result = reportResults.nth(index);
    await expect(result.locator('dl > div').filter({ hasText: /^改善前/ }).locator('dd')).toHaveText(action.beforeState);
    await expect(result.locator('dl > div').filter({ hasText: /^改善后/ }).locator('dd')).toHaveText(action.afterState);
  }

  const header = page.getByRole('banner');
  const allTabs = header.getByRole('button', { name: '全部标签', exact: true });
  const openedPages = page.getByRole('dialog', { name: /全部已打开/ });
  await allTabs.click();
  await openedPages.getByRole('button', { name: '关闭 问题管理面板', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(openedPages).toBeHidden();
  await page.getByRole('link', { name: '综合工作台', exact: true }).click();
  await expect(page).toHaveURL(/\/app\/workbench$/);
  const tabs = header.getByRole('navigation', { name: '工作标签' });
  const historicalTab = tabs.getByRole('link', { name: fixture.historical.title, exact: true });
  const editableTab = tabs.getByRole('link', { name: fixture.editable.title, exact: true });
  await expect(historicalTab).toBeVisible();
  await expect(editableTab).toBeVisible();
  await expect(tabs.locator('[aria-current]')).toHaveCount(0);
  const workbenchBox = await header.getByText('综合工作台', { exact: true }).boundingBox();
  const firstTabBox = await tabs.getByRole('link').first().boundingBox();
  if (!workbenchBox || !firstTabBox) throw new Error('桌面页头须显示工作台名称和第一个工作标签。');
  const gap = firstTabBox.x - workbenchBox.x - workbenchBox.width;
  expect(gap).toBeGreaterThanOrEqual(0);
  expect(gap).toBeLessThanOrEqual(32);

  await page.setViewportSize({ width: 375, height: 812 });
  await expect(allTabs).toBeVisible();
  await expect(header.getByRole('link', { name: fixture.editable.title, exact: true })).toBeHidden();
  await allTabs.click();
  await expect(openedPages.getByRole('button', { name: fixture.historical.title, exact: true })).toBeVisible();
  await expect(openedPages.locator('[aria-current]')).toHaveCount(0);
  await openedPages.getByRole('button', { name: fixture.editable.title, exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/app/problem-workspace/${fixture.editable.id}(?:\\?|$)`));
  await expect(description).toBeEditable();
  await expect(description).toHaveValue(originalDescription);
});
