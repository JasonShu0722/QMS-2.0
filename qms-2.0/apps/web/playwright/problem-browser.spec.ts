import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { expect, test, type APIRequestContext, type BrowserContext, type Page } from '@playwright/test';
import type { components } from '@qms/contracts';
import type { components as problemBrowserComponents } from '@qms/contracts/testing/problem-browser';
import { completeMfa } from './mfa-login';
import { fillSecret } from './secret-input';

const baseURL = process.env.QMS_PROBLEM_BROWSER_BASE_URL;
const fixturePath = process.env.QMS_PROBLEM_BROWSER_FIXTURE_PATH;
const password = process.env.QMS_PROBLEM_BROWSER_PASSWORD;
const databaseURL = process.env.QMS_PROBLEM_BROWSER_DATABASE_URL;
if (!baseURL || !fixturePath || !password || !databaseURL) throw new Error('Real problem browser gateway, isolated database and external fixture credentials are required');
test.use({ baseURL });

type AccountFixture = { username: string; userId: string; organizationId: string };
type ProblemFixture = {
  id: string;
  sourceId: string;
  reportNumber: string;
  organizationId: string;
  instanceId: string;
  workflowVersionId: string;
  currentNodeId: string;
  problemVersion: number;
  instanceVersion: number;
  domainVersion: number;
  revisionId: string;
};
type Fixture = {
  owner: AccountFixture;
  outsider: AccountFixture;
  problem: ProblemFixture;
  task: { id: string; version: number };
  evidenceResource: { resourceType: string; resourceId: string };
  failedOutbox: { id: string; eventKey: string };
};
type ActionResponse = problemBrowserComponents['schemas']['NeutralProblemProcessResponseDto'];
type ProjectionStatus = problemBrowserComponents['schemas']['NeutralProblemProjectionStatusDto'];

async function login(page: Page, account: AccountFixture) {
  await page.goto('/playwright/fixtures/problem-browser.html');
  await expect(page).toHaveURL(/\/login$/);
  await page.getByLabel('账号', { exact: true }).fill(account.username);
  await fillSecret(page.getByLabel('密码', { exact: true }), password!);
  const response = page.waitForResponse((entry) => entry.url().endsWith('/auth/login'));
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await completeMfa(page.request, await response, account.username, page);
  await expect(page).toHaveURL(/\/app\/workbench$/);
}

async function csrf(client: APIRequestContext) {
  const response = await client.get('/api/v1/auth/csrf');
  expect(response.status()).toBe(200);
  return (await response.json() as components['schemas']['CsrfResponseDto']).csrfToken;
}

async function patch(client: APIRequestContext, path: string, body: unknown) {
  return client.patch(path, { headers: { 'x-csrf-token': await csrf(client) }, data: body });
}

async function post(client: APIRequestContext, path: string, body?: unknown, key?: string) {
  return client.post(path, { headers: { 'x-csrf-token': await csrf(client), ...(key ? { 'Idempotency-Key': key } : {}) }, ...(body === undefined ? {} : { data: body }) });
}

function scan() {
  const result = spawnSync(process.execPath, ['dist/worker.js', '--once'], {
    cwd: resolve(process.cwd(), '../api'),
    env: { ...process.env, DATABASE_URL: databaseURL!, QMS_RECOVERY_MAIL_ENABLED: 'false' },
    encoding: 'utf8',
    timeout: 60000,
    windowsHide: true,
  });
  expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
}

async function bytes(response: Awaited<ReturnType<APIRequestContext['get']>>) {
  return Buffer.from(await response.body());
}

test('real neutral problem supports saved views, evidence, immutable revisions, upgrade, history and isolation', async ({ page, browser }) => {
  test.setTimeout(180000);
  const fixture = JSON.parse(await readFile(fixturePath!, 'utf8')) as Fixture;
  const evidence = Buffer.from(`QMS neutral problem browser evidence ${Date.now()}`);
  let secondContext: BrowserContext | undefined;
  let outsiderContext: BrowserContext | undefined;
  try {
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    await login(page, fixture.owner);

    const projectionBeforeResponse = await page.request.get(`/api/v1/test/neutral-problems/${fixture.problem.id}/projection-status?organizationId=${fixture.owner.organizationId}`);
    expect(projectionBeforeResponse.status()).toBe(200);
    const projectionBefore = await projectionBeforeResponse.json() as ProjectionStatus;
    expect(projectionBefore).toMatchObject({ outboxEventId: fixture.failedOutbox.id, outboxStatus: 'FAILED' });
    await page.getByRole('link', { name: '系统管理', exact: true }).click();
    await page.getByRole('tab', { name: '失败队列', exact: true }).click();
    const failureRow = page.getByRole('row').filter({ hasText: fixture.problem.instanceId });
    await expect(failureRow).toContainText('5');
    await failureRow.getByRole('button', { name: '重试事件', exact: true }).click();
    const retried = page.waitForResponse((response) => new RegExp(`/api/v1/outbox/failures/${fixture.failedOutbox.id}/retry`).test(response.url()));
    await page.getByRole('dialog').getByRole('button', { name: /^重\s*试$/ }).click();
    expect((await retried).status()).toBe(201);
    scan();
    await page.getByRole('region', { name: '失败队列', exact: true }).getByRole('button', { name: /^刷\s*新$/ }).click();
    await expect(page.getByRole('region', { name: '失败队列', exact: true }).getByRole('button', { name: '重试事件', exact: true })).toHaveCount(0);
    const projectionAfterResponse = await page.request.get(`/api/v1/test/neutral-problems/${fixture.problem.id}/projection-status?organizationId=${fixture.owner.organizationId}`);
    expect(projectionAfterResponse.status()).toBe(200);
    const projectionAfter = await projectionAfterResponse.json() as ProjectionStatus;
    expect(projectionAfter).toMatchObject({ outboxEventId: fixture.failedOutbox.id, outboxStatus: 'PROCESSED' });
    expect(projectionAfter.taskCount).toBe(projectionBefore.taskCount);
    expect(projectionAfter.notificationCount).toBe(projectionBefore.notificationCount);

    await page.getByRole('link', { name: '问题中心', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/app/problem-center`));
    const queryButton = page.getByRole('button', { name: /^查\s*询$/ });
    await expect(queryButton).toBeVisible({ timeout: 15000 });
    await page.getByLabel('报告编号检索').fill(fixture.problem.reportNumber);
    await page.waitForTimeout(200);
    expect(pageErrors).toEqual([]);
    await expect(queryButton).toBeVisible({ timeout: 15000 });
    await queryButton.click();
    const problemLink = page.getByRole('link', { name: fixture.problem.reportNumber, exact: true });
    await expect(problemLink).toBeVisible();

    const viewName = `中性问题视图-${Date.now()}`;
    await page.getByLabel('视图名称').fill(viewName);
    await page.getByRole('button', { name: '保存新视图', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('视图已保存');
    const viewList = await page.request.get(`/api/v1/problem-views?organizationId=${fixture.owner.organizationId}&pageSize=100&offset=0`);
    expect(viewList.status()).toBe(200);
    const view = (await viewList.json() as components['schemas']['ProblemSavedViewPageDto']).items.find((entry) => entry.name === viewName);
    expect(view).toBeTruthy();

    secondContext = await browser.newContext({ baseURL });
    const secondPage = await secondContext.newPage();
    await login(secondPage, fixture.owner);
    const concurrentUpdate = await patch(secondPage.request, `/api/v1/problem-views/${view!.id}?organizationId=${fixture.owner.organizationId}`, {
      expectedVersion: view!.version,
      name: `${viewName}-并发`,
      configuration: view!.configuration,
    });
    expect(concurrentUpdate.status()).toBe(200);
    await page.getByRole('button', { name: '更新视图', exact: true }).click();
    await expect(page.getByRole('button', { name: '重新加载保存视图', exact: true })).toBeVisible();

    await problemLink.click();
    await expect(page).toHaveURL(new RegExp(`/app/problem-workspace/${fixture.problem.id}`));
    await expect(page.getByText(fixture.problem.reportNumber, { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '升级预览', exact: true })).toBeDisabled();
    await page.getByRole('button', { name: '领取任务', exact: true }).click();
    await expect(page.getByRole('button', { name: '释放任务', exact: true })).toBeVisible();

    const completed = page.waitForResponse((response) => /\/api\/v1\/files\/[^/]+\/complete$/.test(response.url()));
    await page.getByLabel('选择附件').setInputFiles({ name: 'neutral-evidence.txt', mimeType: 'text/plain', buffer: evidence });
    const completedResponse = await completed;
    expect(completedResponse.status()).toBe(202);
    const file = await completedResponse.json() as components['schemas']['FileDto'];
    expect(file.status).toBe('QUARANTINED');
    await expect(page.getByText('等待安全扫描', { exact: true })).toBeVisible();
    scan();
    await expect(page.getByText('扫描通过，可作为证据', { exact: true })).toBeVisible({ timeout: 20000 });

    await page.getByLabel('中性处理结论').fill('真实浏览器验收已完成并保留证据');
    const processed = page.waitForResponse((response) => new RegExp(`/api/v1/test/neutral-problems/${fixture.problem.id}/process`).test(response.url()));
    await page.getByRole('button', { name: '记录中性处理结果', exact: true }).click();
    const processedResponse = await processed;
    expect(processedResponse.status()).toBe(201);
    const processRequest = processedResponse.request();
    const processKey = await processRequest.headerValue('idempotency-key');
    const processBody = processRequest.postDataJSON();
    const processedBody = await processedResponse.json() as ActionResponse;
    expect(processKey).toBeTruthy();
    expect(processedBody.revisionId).toMatch(/^[0-9a-f-]{36}$/);
    expect(processedBody.domainVersion).toBe(fixture.problem.domainVersion + 1);
    await expect(page.getByRole('button', { name: '升级预览', exact: true })).toBeDisabled();

    scan();
    await page.getByRole('button', { name: '刷新工作空间', exact: true }).click();
    await expect(page.getByRole('button', { name: '通过审批', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '领取任务', exact: true }).click();
    await page.getByLabel('审批意见', { exact: true }).fill('审批确认处理结论与清洁证据');
    const approved = page.waitForResponse((response) => new RegExp(`/api/v1/test/neutral-problems/${fixture.problem.id}/approve`).test(response.url()));
    await page.getByRole('button', { name: '通过审批', exact: true }).click();
    const approvedResponse = await approved;
    expect(approvedResponse.status()).toBe(201);
    const approvedBody = await approvedResponse.json() as ActionResponse;
    expect(approvedBody.domainVersion).toBe(fixture.problem.domainVersion + 2);
    await expect(page.getByRole('button', { name: '升级预览', exact: true })).toBeDisabled();

    scan();
    await page.getByRole('button', { name: '刷新工作空间', exact: true }).click();
    await expect(page.getByRole('button', { name: '通过验证', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '领取任务', exact: true }).click();
    await page.getByLabel('验证意见', { exact: true }).fill('验证确认修订不可变且证据可下载');
    const verified = page.waitForResponse((response) => new RegExp(`/api/v1/test/neutral-problems/${fixture.problem.id}/verify`).test(response.url()));
    await page.getByRole('button', { name: '通过验证', exact: true }).click();
    const verifiedResponse = await verified;
    expect(verifiedResponse.status()).toBe(201);
    const verifiedBody = await verifiedResponse.json() as ActionResponse;
    expect(verifiedBody.domainVersion).toBe(fixture.problem.domainVersion + 3);

    scan();
    await page.getByRole('button', { name: '刷新工作空间', exact: true }).click();
    const resolvedReportResponse = await page.request.get(`/api/v1/reports/problems/${fixture.problem.id}?organizationId=${fixture.owner.organizationId}&instanceId=${fixture.problem.instanceId}`);
    expect(resolvedReportResponse.status()).toBe(200);
    expect((await resolvedReportResponse.json() as components['schemas']['ProblemReportDto']).snapshot?.status).toBe('RESOLVED');
    const upgradeButton = page.getByRole('button', { name: '升级预览', exact: true });
    await expect(upgradeButton).toBeEnabled({ timeout: 15000 });
    await upgradeButton.click();
    const preview = page.getByRole('region', { name: '升级预览', exact: true });
    await expect(preview).toContainText(fixture.problem.reportNumber);
    await expect(preview).toContainText('8D');
    await page.getByLabel('升级原因').fill('浏览器验收升级到 8D');
    const upgraded = page.waitForResponse((response) => new RegExp(`/api/v1/problem-index/${fixture.problem.id}/upgrade$`).test(response.url()));
    await page.getByRole('button', { name: '确认升级', exact: true }).click();
    expect((await upgraded).status()).toBe(201);
    await expect(page.getByLabel('流程实例').locator('option')).toHaveCount(2, { timeout: 15000 });
    await expect(page.getByText('8D', { exact: true }).first()).toBeVisible();
    const historicalReportResponse = await page.request.get(`/api/v1/reports/problems/${fixture.problem.id}?organizationId=${fixture.owner.organizationId}&instanceId=${fixture.problem.instanceId}`);
    expect(historicalReportResponse.status()).toBe(200);
    expect((await historicalReportResponse.json() as components['schemas']['ProblemReportDto']).snapshot?.status).toBe('RESOLVED');

    await page.getByRole('button', { name: '报告预览', exact: true }).click();
    const report = page.getByRole('region', { name: '报告预览', exact: true });
    await expect(report).toContainText('真实浏览器验收已完成并保留证据');
    await expect(report).toContainText('审批确认处理结论与清洁证据');
    await expect(report).toContainText('验证确认修订不可变且证据可下载');
    await expect(report).toContainText('neutral-evidence.txt');
    const downloadAuthorization = page.waitForResponse((response) => new RegExp(`/api/v1/files/${file.id}/download$`).test(response.url()));
    await report.getByRole('button', { name: '下载证据', exact: true }).click();
    const authorized = await downloadAuthorization;
    expect(authorized.status()).toBe(201);
    const downloadURL = (await authorized.json() as components['schemas']['FileDownloadDto']).url;
    const downloaded = await page.request.get(downloadURL);
    expect(downloaded.status()).toBe(200);
    expect(await bytes(downloaded)).toEqual(evidence);

    await page.getByRole('button', { name: /^追\s*溯$/ }).click();
    const audit = page.getByRole('region', { name: '追溯', exact: true });
    await expect(audit).toContainText('NEUTRAL_REVISION_RECORDED');
    await expect(audit).toContainText('WORKFLOW_UPGRADED');
    await expect(audit).toContainText('ATTACHMENT_SCAN_CLEAN');
    const auditResponse = await page.request.get(`/api/v1/problems/${fixture.problem.id}/audit-trail?organizationId=${fixture.owner.organizationId}&pageSize=100`);
    expect(auditResponse.status()).toBe(200);
    const auditBody = await auditResponse.json() as components['schemas']['ProblemAuditPageDto'];
    expect(auditBody.items.filter((entry) => entry.resourceType === 'NeutralProblemRevision' && entry.action === 'NEUTRAL_REVISION_RECORDED')).toHaveLength(4);
    expect(auditBody.items.some((entry) => entry.resourceType === 'FileObject' && entry.resourceId === file.id)).toBe(true);
    expect(auditBody.items.every((entry) => !Object.hasOwn(entry, 'metadata'))).toBe(true);

    await page.getByRole('button', { name: '问题概览', exact: true }).click();
    await page.getByLabel('流程实例').selectOption(fixture.problem.instanceId);
    await expect(page.getByText('历史实例只读', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '记录中性处理结果', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '升级预览', exact: true })).toHaveCount(0);

    const currentFileResponse = await page.request.get(`/api/v1/files/${file.id}`);
    expect(currentFileResponse.status()).toBe(200);
    const currentFile = await currentFileResponse.json() as components['schemas']['FileDto'];
    const deleted = await post(page.request, `/api/v1/files/${file.id}/delete`, { expectedVersion: currentFile.version });
    expect(deleted.status()).toBe(201);
    expect((await deleted.json() as components['schemas']['FileDto']).status).toBe('DELETED');
    expect((await post(page.request, `/api/v1/files/${file.id}/download`)).status()).toBe(409);
    const replay = await post(page.request, `/api/v1/test/neutral-problems/${fixture.problem.id}/process?organizationId=${fixture.problem.organizationId}`, processBody, processKey!);
    expect(replay.status()).toBe(201);
    expect(await replay.json()).toEqual(processedBody);

    outsiderContext = await browser.newContext({ baseURL });
    const outsiderPage = await outsiderContext.newPage();
    await login(outsiderPage, fixture.outsider);
    const hidden = await outsiderPage.request.get(`/api/v1/problem-index/${fixture.problem.id}/workspace?organizationId=${fixture.outsider.organizationId}`);
    expect(hidden.status()).toBe(404);
    const forbidden = await outsiderPage.request.get(`/api/v1/problem-index/${fixture.problem.id}/workspace?organizationId=${fixture.owner.organizationId}`);
    expect(forbidden.status()).toBe(403);
  } finally {
    await outsiderContext?.close();
    await secondContext?.close();
  }
});
