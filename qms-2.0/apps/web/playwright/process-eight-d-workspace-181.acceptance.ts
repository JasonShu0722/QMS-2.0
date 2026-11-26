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
  for (const [index, name] of planNames.entries()) {
    const row = editableReport.document.correctiveActions.length + index + 1;
    await main.getByRole('button', { name: '增加永久措施', exact: true }).click();
    await planList.getByRole('textbox', { name: `措施 ${row} 对策`, exact: true }).fill(name);
  }
  const firstActionNumber = editableReport.document.correctiveActions.length + 1;
  const firstPlan = planList.getByRole('row').filter({ hasText: planNames[0] });
  await expect(firstPlan.getByText(/待填写.*验证方法/)).toBeVisible();
  await chapterSix.click();
  await expect(main.getByRole('heading', { name: /^D6 ·/ })).toBeVisible();
  const actionDetails = page.getByRole('button', { name: /^详情 措施 / });
  const resultRows = resultsList.getByRole('row').filter({ has: actionDetails });
  const firstResult = resultRows.filter({ hasText: planNames[0] });
  const secondResult = resultRows.filter({ hasText: planNames[1] });
  await expect(firstResult).toContainText('尚未判断');
  await expect(secondResult).toContainText('尚未判断');
  await expect(main.getByRole('button', { name: '增加永久措施', exact: true })).toBeHidden();
  await firstResult.getByRole('button', { name: `详情 措施 ${firstActionNumber}`, exact: true }).click();
  const comparison = resultsList.getByRole('group', { name: '改善前后对照', exact: true });
  const before = comparison.getByRole('textbox', { name: `措施 ${firstActionNumber} 改善前`, exact: true });
  const after = comparison.getByRole('textbox', { name: `措施 ${firstActionNumber} 改善后`, exact: true });
  await before.fill('抽检发现压装开裂');
  await after.fill('抽检仍有开裂');
  const beforeBox = await before.boundingBox();
  const afterBox = await after.boundingBox();
  if (!beforeBox || !afterBox) throw new Error('桌面须同时显示改善前和改善后字段。');
  expect(afterBox.x).toBeGreaterThan(beforeBox.x);
  expect(Math.abs(afterBox.y - beforeBox.y)).toBeLessThan(4);
  const effective = resultsList.getByRole('combobox', { name: `措施 ${firstActionNumber} 人工有效性结论`, exact: true });
  await effective.selectOption('false');
  await expect(firstResult.getByRole('cell', { name: '无效', exact: true })).toBeVisible();
  await chapterFive.click();
  await planList.getByRole('textbox', { name: `措施 ${firstActionNumber} 对策`, exact: true }).fill('调整压装参数与夹具');
  await chapterSix.click();
  await expect(resultRows.filter({ hasText: '调整压装参数与夹具' })).toHaveCount(1);
  await expect(secondResult).toContainText('尚未判断');
  await expect(before).toHaveValue('抽检发现压装开裂');
  await expect(after).toHaveValue('抽检仍有开裂');
  await expect(effective).toHaveValue('false');
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
  const mobileDetails = secondResult.getByRole('button', { name: `详情 措施 ${firstActionNumber + 1}`, exact: true });
  await mobileDetails.click();
  await expect(mobileDetails).toHaveAttribute('aria-expanded', 'true');
  const mobileComparison = comparison.filter({ has: page.getByRole('textbox', { name: `措施 ${firstActionNumber + 1} 改善前`, exact: true }) });
  await mobileComparison.scrollIntoViewIfNeeded();
  await expect(mobileComparison).toBeInViewport({ ratio: 0.9 });
  await directoryToggle.click();
  await chapterTwo.click();
  await expect(description).toHaveValue(unsavedDescription);
  await page.setViewportSize({ width: 1440, height: 960 });

  const currentPreview = readFromUi(page, `${editablePath}/report`, { view: 'CURRENT' });
  await main.getByRole('tab', { name: '报告', exact: true }).click();
  expect((await currentPreview).status()).toBe(200);
  await expect(description).toBeDisabled();
  await expect(description).toHaveValue(originalDescription);
  await main.getByRole('tab', { name: '工作区', exact: true }).click();
  await expect(description).toHaveValue(unsavedDescription);
  const back = main.getByRole('link', { name: '返回问题中心', exact: true });
  const leave = page.getByRole('dialog', { name: '当前草稿尚未保存，继续将放弃修改。' });
  await back.click();
  await leave.getByRole('button', { name: '继续编辑', exact: true }).click();
  await expect(description).toHaveValue(unsavedDescription);
  await back.click();
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
  await expect(main.getByText(preview.label, { exact: true })).toBeVisible();
  await expect(description).toBeDisabled();
  await expect(description).toHaveValue(preview.snapshot.document.description);
  await expect(main.getByRole('button', { name: '保存草稿', exact: true })).toHaveCount(0);
  await chapterFive.click();
  await expect(main.getByRole('heading', { name: /^D5 ·/ })).toBeVisible();
  await expect(description).toBeHidden();
  const historicalActions = preview.snapshot.document.correctiveActions;
  expect(historicalActions.length).toBeGreaterThanOrEqual(2);
  await expect(planList.getByRole('row').filter({ has: actionDetails })).toHaveCount(historicalActions.length);
  await chapterSix.click();
  await resultsList.getByRole('button', { name: '详情 措施 1', exact: true }).click();
  const historicalBefore = resultsList.getByRole('textbox', { name: '措施 1 改善前', exact: true });
  const historicalAfter = resultsList.getByRole('textbox', { name: '措施 1 改善后', exact: true });
  await expect(historicalBefore).toBeDisabled();
  await expect(historicalAfter).toBeDisabled();
  await expect(historicalBefore).toHaveValue(historicalActions[0].beforeState);
  await expect(historicalAfter).toHaveValue(historicalActions[0].afterState);

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
