import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import type { components } from '@qms/contracts';
import { completeMfa } from './mfa-login';
import { fillSecret } from './secret-input';

const baseURL = process.env.QMS_FILE_BROWSER_BASE_URL;
const fixturePath = process.env.QMS_FILE_BROWSER_FIXTURE_PATH;
if (!baseURL || !fixturePath || !process.env.QMS_FILE_BROWSER_PASSWORD || !process.env.QMS_FILE_BROWSER_DATABASE_URL) throw new Error('Real attachment browser gateway, isolated database and external fixture credentials are required');
test.use({ baseURL });
type Fixture = { username: string; accountType: string; resource: Pick<components['schemas']['FileDto'], 'resourceType' | 'resourceId'> };
async function login(page: Page, fixture: Fixture) {
  await page.goto('/login');
  await page.getByLabel('账号', { exact: true }).fill(fixture.username);
  await fillSecret(page.getByLabel('密码', { exact: true }), process.env.QMS_FILE_BROWSER_PASSWORD!);
  const response = page.waitForResponse((entry) => entry.url().endsWith('/auth/login'));
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await completeMfa(page.request, await response, fixture.username, page);
  await expect(page).toHaveURL(fixture.accountType === 'INTERNAL' ? /\/app\/workbench$/ : /\/supplier\/inbox$/);
  await page.goto(`/playwright/fixtures/attachments.html?${new URLSearchParams(fixture.resource)}`);
}
async function post(client: APIRequestContext, path: string) {
  const csrf = await client.get('/api/v1/auth/csrf');
  expect(csrf.status()).toBe(200);
  return client.post(path, { headers: { 'x-csrf-token': (await csrf.json()).csrfToken } });
}
function scan() {
  const result = spawnSync(process.execPath, ['dist/worker.js', '--once'], { cwd: resolve(process.cwd(), '../api'), env: { ...process.env, DATABASE_URL: process.env.QMS_FILE_BROWSER_DATABASE_URL!, QMS_RECOVERY_MAIL_ENABLED: 'false' }, encoding: 'utf8', timeout: 60000, windowsHide: true });
  expect(result.status, result.stderr).toBe(0);
}

test('real internal and supplier uploads remain isolated until scanned, download exact bytes and reject foreign evidence', async ({ page, browser }) => {
  test.setTimeout(120000);
  const { fixtures } = JSON.parse(await readFile(fixturePath!, 'utf8')) as { fixtures: Fixture[] };
  const supplierContext = await browser.newContext({ baseURL });
  const supplierPage = await supplierContext.newPage();
  try {
    const clean = Buffer.from('QMS real browser evidence sample');
    const completedFiles = [];
    for (const [position, currentPage] of [page, supplierPage].entries()) {
      await login(currentPage, fixtures[position]!);
      const completion = currentPage.waitForResponse((response) => /\/api\/v1\/files\/[^/]+\/complete$/.test(response.url()));
      await currentPage.getByLabel('选择附件').setInputFiles({ name: `evidence-${position}.txt`, mimeType: 'text/plain', buffer: clean });
      const response = await completion;
      expect(response.status()).toBe(202);
      const file = await response.json() as components['schemas']['FileDto'];
      expect(file.status).toBe('QUARANTINED');
      completedFiles.push(file);
      await expect(currentPage.getByText('等待安全扫描', { exact: true })).toBeVisible();
      await expect(currentPage.getByRole('button', { name: '下载附件', exact: true })).toHaveCount(0);
      expect((await post(currentPage.request, `/api/v1/files/${file.id}/download`)).status()).toBe(409);
    }
    expect((await supplierPage.request.get(`/api/v1/files/${completedFiles[0]!.id}`)).status()).toBe(403);
    expect((await post(supplierPage.request, `/api/v1/files/${completedFiles[0]!.id}/download`)).status()).toBe(403);
    scan();
    for (const currentPage of [page, supplierPage]) {
      await expect(currentPage.getByRole('button', { name: '下载附件', exact: true })).toBeVisible({ timeout: 20000 });
      const pending = currentPage.waitForEvent('download');
      await currentPage.getByRole('button', { name: '下载附件', exact: true }).click();
      const stream = await (await pending).createReadStream();
      expect(stream).toBeTruthy();
      const chunks: Buffer[] = [];
      for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
      expect(Buffer.concat(chunks)).toEqual(clean);
    }
    await page.getByRole('button', { name: '删除附件', exact: true }).click();
    await page.getByRole('button', { name: '确认删除附件', exact: true }).click();
    await expect(page.getByText('已删除，保留历史记录', { exact: true })).toBeVisible();
    expect((await post(page.request, `/api/v1/files/${completedFiles[0]!.id}/download`)).status()).toBe(409);
    const harmlessSignature = Buffer.from(['X5O!P%@AP[4', '\\PZX54(P^)7CC)7}', '$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*'].join(''));
    const completion = page.waitForResponse((response) => /\/api\/v1\/files\/[^/]+\/complete$/.test(response.url()));
    await page.getByLabel('选择附件').setInputFiles({ name: 'scanner-test.txt', mimeType: 'text/plain', buffer: harmlessSignature });
    expect((await completion).status()).toBe(202);
    scan();
    await expect(page.getByText('扫描未通过，附件已隔离', { exact: true })).toBeVisible({ timeout: 20000 });
    await expect(page.getByRole('button', { name: '下载附件', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Language / 语言' }).click();
    await page.getByRole('menuitemradio', { name: 'English' }).click();
    await expect(page.getByText('Scan rejected; quarantined', { exact: true })).toBeVisible();
  } finally { await supplierContext.close(); }
});
