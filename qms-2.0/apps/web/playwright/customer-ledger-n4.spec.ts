import { createHash, randomUUID } from 'node:crypto';
import { appendFileSync, writeFileSync } from 'node:fs';
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import type { components } from '@qms/contracts';
import { completeMfa } from './mfa-login';
import { fillSecret } from './secret-input';
import { createPositionGrant, createPositionUser, positionRead, positionWrite, replacePositionAppointments, type PositionGrant } from './position-fixture';

type Schema = components['schemas'];
const baseURL = process.env.QMS_ACCEPTANCE_BASE_URL ?? process.env.PLAYWRIGHT_BASE_URL;
const internalPassword = process.env.QMS_SEED_INTERNAL_PASSWORD;
const databaseURL = process.env.DATABASE_URL;
if (!baseURL || !databaseURL || !internalPassword || !process.env.QMS_ACCEPTANCE_MFA_CACHE_FILE || !process.env.QMS_BACKUP_KEY
  || process.env.QMS_DISPOSABLE_TEST_DB !== 'true' || process.env.QMS_ACCEPTANCE_DISPOSABLE_DATABASE !== 'true') {
  throw new Error('N4 regression requires an explicitly disposable gateway/PostgreSQL, seed credentials and external encrypted MFA cache; no skips.');
}
const gateway = new URL(baseURL);
const database = new URL(databaseURL);
if (!['localhost', '127.0.0.1', '[::1]'].includes(gateway.hostname) || !['http:', 'https:'].includes(gateway.protocol)
  || gateway.pathname !== '/' || gateway.username || gateway.password || gateway.search || gateway.hash
  || !['localhost', '127.0.0.1', '[::1]'].includes(database.hostname) || !['postgres:', 'postgresql:'].includes(database.protocol)
  || database.port === '55440' || database.search || database.hash) {
  throw new Error('N4 regression requires a loopback gateway without URL overrides and disposable loopback PostgreSQL outside preserved preview port 55440.');
}

const ledger = '/api/v1/customer-quality/ledger';
const analysis = '/api/v1/customer-quality/analysis';
const configuration = '/api/v1/admin/configuration';
const unique = (prefix: string) => `${prefix}_${randomUUID().replaceAll('-', '').slice(0, 16)}`;

test.setTimeout(120_000);
test.use({ trace: 'off', screenshot: 'off', video: 'off' });

async function uiLogin(page: Page, identifier: string, password: string) {
  const bodyEvidence = test.info().outputPath('n4-business-body-bytes.ndjson');
  page.on('request', request => {
    const path = new URL(request.url()).pathname;
    if (['POST', 'PUT'].includes(request.method()) && (path === ledger || path.startsWith(`${ledger}/`) || path.startsWith(`${analysis}/`)
      || path === '/api/v1/files/uploads' || /^\/api\/v1\/files\/[^/]+\/complete$/.test(path))) {
      appendFileSync(bodyEvidence, `${JSON.stringify({ path, bytes: request.postDataBuffer()?.byteLength ?? 0 })}\n`);
    }
  });
  await page.goto('/login');
  await page.getByLabel('账号', { exact: true }).fill(identifier);
  await fillSecret(page.getByLabel('密码', { exact: true }), password);
  const pending = page.waitForResponse(response => new URL(response.url()).pathname === '/api/v1/auth/login' && response.request().method() === 'POST');
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await completeMfa(page.request, await pending, identifier, page);
  await expect(page).toHaveURL(/\/app\/workbench$/);
  const session = await positionRead<Schema['SessionResponseDto']>(page.request, '/api/v1/auth/session');
  expect(session.user.accountType).toBe('INTERNAL');
  return session.user;
}

async function uiWrite<T>(page: Page, path: string, method: 'POST' | 'PUT', status: number, submit: () => Promise<void>) {
  const pending = page.waitForResponse(response => new URL(response.url()).pathname === path && response.request().method() === method);
  await submit();
  const response = await pending;
  expect(response.status(), `${method} ${path}`).toBe(status);
  return await response.json() as T;
}

async function attachJson(testInfo: TestInfo, name: string, value: unknown) {
  const path = testInfo.outputPath(name);
  writeFileSync(path, JSON.stringify(value, null, 2));
  await testInfo.attach(name, { path, contentType: 'application/json' });
}

test('registers the formal ledger and follows real CQE, FAE and SQE appointments through the gateway', async ({ page, browser }, testInfo) => {
  const admin = await uiLogin(page, 'local.internal', internalPassword!);
  const organizationId = admin.organizationId;
  const grants: PositionGrant[] = [];
  const users: Schema['AdminUserDto'][] = [];
  const contexts: Awaited<ReturnType<typeof browser.newContext>>[] = [];
  let project: Schema['ComponentProjectRecordDto'] | undefined;
  let mapping: Schema['ComponentProjectMappingDto'] | undefined;
  let primaryFailed = false;
  let stage = 'arrange real duties and mapping';

  async function duty(permissionCodes: string[]) {
    // Qualification comes from effective permissions and appointments, never CQE/FAE/SQE names.
    const grant = await createPositionGrant(page.request, organizationId, { name: unique('N4_duty'), permissionCodes });
    grants.push(grant);
    const password = `${randomUUID()}Aa9!`;
    const user = await createPositionUser(page.request, organizationId, [grant.position.id], { username: unique('n4_actor'), initialPassword: password });
    users.push(user);
    const context = await browser.newContext({ baseURL });
    contexts.push(context);
    return { user, password, page: await context.newPage() };
  }

  try {
    const common = ['workbench:read', 'customer-quality:complaints:read', 'customer-quality:complaints:write'];
    const qe = await duty([...common, 'customer-quality:complaints:close']);
    const fae = await duty([...common, 'customer-quality:analyses:fae']);
    const sqe = await duty([...common, 'customer-quality:analyses:supplier']);
    const candidates = await positionRead<Schema['CustomerLedgerCandidatesDto']>(page.request, `${ledger}/candidates`);
    const qeAssignment = candidates.items.find(candidate => candidate.userId === qe.user.id);
    expect(qeAssignment, 'Actual CQE appointment must be eligible').toBeDefined();
    const componentCode = unique('N4_component');
    project = await positionWrite<Schema['ComponentProjectRecordDto']>(page.request, `${configuration}/component-project-records`, 'POST', {
      code: unique('N4_project'), name: 'N4 一次性客户项目', stage: 'MASS_PRODUCTION', customerEngineerAssignmentId: qeAssignment!.assignmentId,
    } satisfies Schema['CreateComponentProjectRecordDto'], 201);
    mapping = await positionWrite<Schema['ComponentProjectMappingDto']>(page.request, `${configuration}/component-project-mappings`, 'POST', {
      componentCode, projectRecordId: project.id, productCategory: 'N4 回归大类', productSubcategory: 'N4 回归细分',
    } satisfies Schema['CreateComponentProjectMappingDto'], 201);

    stage = 'manual UI registration and unique dialog ID';
    await page.goto('/app/customer-quality');
    await expect(page.getByRole('group', { name: '台账视图' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Excel 批量导入', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: '人工登记客诉', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(1);
    const dialogIds = await page.getByRole('dialog').evaluate(element => {
      const labelledby = element.getAttribute('aria-labelledby');
      const targets = Array.from(document.querySelectorAll('[id]')).filter(target => target.id === labelledby);
      return { labelledby, targetCount: targets.length, title: targets[0]?.textContent ?? null };
    });
    await attachJson(testInfo, 'n4-dialog-id-probe.json', dialogIds);
    expect(dialogIds.labelledby).toBeTruthy();
    expect(dialogIds.labelledby).not.toBe('test-id');
    expect(dialogIds).toMatchObject({ targetCount: 1, title: '人工登记客诉' });
    const editor = page.getByRole('dialog', { name: '人工登记客诉', exact: true });
    const customerName = unique('N4未建档客户');
    const description = unique('N4单件真实客诉');
    await expect(editor.getByLabel('关联客户主数据', { exact: true })).toHaveValue('');
    await editor.getByLabel('客户', { exact: true }).fill(customerName);
    await editor.getByLabel('客诉类型', { exact: true }).selectOption('AFTER_SALES');
    await editor.getByLabel('组件号', { exact: true }).fill(componentCode);
    await editor.getByLabel('件数', { exact: true }).fill('1');
    await editor.getByLabel('详细故障描述', { exact: true }).fill(description);
    await editor.getByLabel('生产日期', { exact: true }).fill('2026-01-31');
    await editor.getByLabel('发生日期', { exact: true }).fill('2026-04-30');
    await editor.getByLabel('故障里程', { exact: true }).fill('5000');
    await expect(editor.getByLabel('服务方式', { exact: true })).toHaveValue('');
    await expect(editor.getByLabel('拦截状态', { exact: true })).toHaveValue('');
    const created = await uiWrite<Schema['CustomerLedgerItemDto']>(page, ledger, 'POST', 201,
      () => editor.getByRole('button', { name: '登记', exact: true }).click());
    expect(created).toMatchObject({ organizationId, customerId: null, status: 'FOLLOWING', registeredByUserId: admin.id,
      qualityEngineerId: qe.user.id, qualityEngineerAssignmentId: qeAssignment!.assignmentId, qualityEngineerSource: 'MAPPING', stage: 'MASS_PRODUCTION',
      normalized: { customerName, complaintType: 'AFTER_SALES', quantity: 1, serviceMode: null, interceptionStatus: null },
      serviceMonths: 3, misTag: '3MIS', mileageBand: '≤5000', mapping: { project: { id: project.id }, mapping: { id: mapping.id } } });
    expect(created.warnings).toContainEqual({ field: 'customerName', code: 'CUSTOMER_UNRESOLVED' });
    await expect(editor).toBeHidden();
    const href = `/app/customer-quality?${new URLSearchParams({ complaintId: created.id, organizationId })}`;
    const qeSession = await uiLogin(qe.page, qe.user.username, qe.password);
    expect(qeSession).toMatchObject({ id: qe.user.id, organizationId });
    await qe.page.goto(href);
    const detail = qe.page.getByRole('region', { name: '客诉详情', exact: true });
    await expect(detail.getByRole('heading', { name: created.complaintNumber, exact: true })).toBeVisible();
    await expect(detail.getByText('3MIS', { exact: true })).toBeVisible();

    stage = 'CQE uploads original customer list and awaits real storage/scan persistence';
    const sourcePanel = detail.getByRole('region', { name: '客诉来源附件', exact: true });
    await expect(sourcePanel.getByLabel('选择附件', { exact: true })).toBeEnabled();
    const sourceName = `${unique('n4-original-customer-list')}.txt`;
    const sourceBytes = Buffer.from('客户原始清单，仅作为来源附件，不自动拆行或计算件数。\n行号\t描述\n1\t合成条目甲\n2\t合成条目乙\n', 'utf8');
    const sourceHash = createHash('sha256').update(sourceBytes).digest('hex');
    const initialization = qe.page.waitForResponse(response => new URL(response.url()).pathname === '/api/v1/files/uploads' && response.request().method() === 'POST', { timeout: 15_000 });
    const completion = qe.page.waitForResponse(response => /^\/api\/v1\/files\/[^/]+\/complete$/.test(new URL(response.url()).pathname) && response.request().method() === 'POST', { timeout: 15_000 });
    await sourcePanel.getByLabel('选择附件', { exact: true }).setInputFiles({ name: sourceName, mimeType: 'text/plain', buffer: sourceBytes });
    const initialized = await initialization;
    expect(initialized.status()).toBe(201);
    const reservation = await initialized.json() as Schema['FileUploadDto'];
    expect(reservation.file).toMatchObject({ resourceType: 'CustomerComplaint', resourceId: created.id, originalName: sourceName, sizeBytes: sourceBytes.byteLength, sha256: sourceHash });
    const completed = await completion;
    expect(completed.status()).toBe(202);
    const pendingFile = await completed.json() as Schema['FileDto'];
    expect(pendingFile).toMatchObject({ id: reservation.file.id, resourceType: 'CustomerComplaint', resourceId: created.id });
    await expect(sourcePanel.getByText('扫描通过，可作为证据', { exact: true })).toBeVisible({ timeout: 20_000 });
    const cleanFile = await positionRead<Schema['FileDto']>(qe.page.request, `/api/v1/files/${pendingFile.id}`);
    expect(cleanFile).toMatchObject({ status: 'AVAILABLE', scanStatus: 'CLEAN', resourceType: 'CustomerComplaint', resourceId: created.id,
      originalName: sourceName, sizeBytes: sourceBytes.byteLength, sha256: sourceHash });
    expect(cleanFile.scannedAt).not.toBeNull();
    const reloadingFiles = qe.page.waitForResponse(response => new URL(response.url()).pathname === `${ledger}/${created.id}/attachments` && response.request().method() === 'GET', { timeout: 15_000 });
    await qe.page.reload();
    const reloaded = await reloadingFiles;
    expect(reloaded.status()).toBe(200);
    const persistedFiles = await reloaded.json() as Schema['FileDto'][];
    expect(persistedFiles).toHaveLength(1);
    expect(persistedFiles[0]).toMatchObject({ id: cleanFile.id, status: 'AVAILABLE', scanStatus: 'CLEAN', resourceType: 'CustomerComplaint', resourceId: created.id });
    await expect(sourcePanel.getByText(sourceName, { exact: true })).toBeVisible();
    await expect(sourcePanel.getByText('扫描通过，可作为证据', { exact: true })).toBeVisible();
    stage = 'CQE downloads persisted original customer list and verifies exact bytes';
    const downloading = qe.page.waitForEvent('download', { timeout: 15_000 });
    await sourcePanel.getByRole('button', { name: '下载附件', exact: true }).click();
    const download = await downloading;
    expect(download.suggestedFilename()).toBe(sourceName);
    const stream = await download.createReadStream();
    expect(stream).not.toBeNull();
    const chunks: Buffer[] = [];
    for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
    const downloadedBytes = Buffer.concat(chunks);
    expect(downloadedBytes).toEqual(sourceBytes);
    const downloadedHash = createHash('sha256').update(downloadedBytes).digest('hex');
    expect(downloadedHash).toBe(sourceHash);
    const afterSourceUpload = await positionRead<Schema['CustomerLedgerDetailDto']>(qe.page.request, `${ledger}/${created.id}`);
    expect(afterSourceUpload).toMatchObject({ id: created.id, raw: { quantity: '1' }, normalized: { quantity: 1 }, misTag: '3MIS' });
    await attachJson(testInfo, 'n4-source-attachment.json', { file: cleanFile, persistedFiles, downloadedBytes: downloadedBytes.byteLength, downloadedSha256: downloadedHash,
      quantityBefore: created.normalized.quantity, quantityAfter: afterSourceUpload.normalized.quantity });

    stage = 'CQE receiving, close and reopen';
    await detail.getByRole('button', { name: '维护收件', exact: true }).click();
    const receiving = qe.page.getByRole('dialog', { name: '维护收件', exact: true });
    const courierNumber = unique('N4_courier');
    await receiving.getByLabel('快递单号', { exact: true }).fill(courierNumber);
    await receiving.getByLabel('收件日期', { exact: true }).fill('2026-10-27');
    const received = await uiWrite<Schema['CustomerLedgerItemDto']>(qe.page, `${ledger}/${created.id}/receiving`, 'PUT', 200,
      () => receiving.getByRole('button', { name: '保存台账动作', exact: true }).click());
    expect(received).toMatchObject({ courierNumber, receivedOn: '2026-10-27', normalized: { quantity: 1 } });
    await expect(receiving).toBeHidden();
    await expect(detail.getByText(courierNumber, { exact: true })).toBeVisible();

    await detail.getByRole('button', { name: '关闭台账', exact: true }).click();
    const closing = qe.page.getByRole('dialog', { name: '关闭台账', exact: true });
    await closing.getByLabel('调查结论 / 关闭结果', { exact: true }).fill('仅关闭台账，不以解析或 8D 为前置。');
    const closed = await uiWrite<Schema['CustomerLedgerItemDto']>(qe.page, `${ledger}/${created.id}/close`, 'POST', 201,
      () => closing.getByRole('button', { name: '保存台账动作', exact: true }).click());
    expect(closed).toMatchObject({ status: 'CLOSED', closedByUserId: qe.user.id });
    expect(closed.closedAt).not.toBeNull();
    await expect(closing).toBeHidden();
    await detail.getByRole('button', { name: '恢复跟进', exact: true }).click();
    const reopening = qe.page.getByRole('dialog', { name: '恢复跟进', exact: true });
    await reopening.getByLabel('恢复原因', { exact: true }).fill('追加解析跟进，保留既有关闭事实。');
    const reopened = await uiWrite<Schema['CustomerLedgerItemDto']>(qe.page, `${ledger}/${created.id}/reopen`, 'POST', 201,
      () => reopening.getByRole('button', { name: '保存台账动作', exact: true }).click());
    expect(reopened).toMatchObject({ status: 'FOLLOWING', closedByUserId: qe.user.id, closedAt: closed.closedAt });
    await expect(reopening).toBeHidden();

    async function assign(section: 'FAE' | 'SUPPLIER', user: Schema['AdminUserDto']) {
      const title = section === 'FAE' ? '指定 FAE' : '指定 SQE';
      const pending = qe.page.waitForResponse(response => new URL(response.url()).pathname === `${analysis}/complaints/${created.id}/candidates/${section}` && response.request().method() === 'GET');
      await detail.getByRole('button', { name: title, exact: true }).click();
      const response = await pending;
      expect(response.status()).toBe(200);
      const eligible = await response.json() as Schema['CustomerAnalysisCandidateDto'][];
      const target = eligible.find(candidate => candidate.userId === user.id);
      expect(target, 'Assignee must have a real eligible appointment').toBeDefined();
      const dialog = qe.page.getByRole('dialog', { name: title, exact: true });
      await dialog.getByRole('combobox', { name: '解析人及有效任职', exact: true }).click();
      await qe.page.getByText(`${user.username} · 任职 ${target!.assignmentId}`, { exact: true }).click();
      const assigned = await uiWrite<Schema['CustomerAnalysisDto']>(qe.page, `${analysis}/complaints/${created.id}/assign/${section}`, 'POST', 201,
        () => dialog.getByRole('button', { name: '确认指定', exact: true }).click());
      expect(assigned).toMatchObject({ complaintId: created.id, organizationId, section, assigneeUserId: user.id,
        assigneeAssignmentId: target!.assignmentId, departmentId: target!.departmentId, version: 1, fileIds: [] });
      await expect(dialog).toBeHidden();
      return assigned;
    }
    stage = 'CQE assigns actual FAE and SQE';
    const assignedFae = await assign('FAE', fae.user);
    expect(assignedFae.faeStatus).toBe('NOT_ANALYSED');
    const assignedSqe = await assign('SUPPLIER', sqe.user);
    expect(assignedSqe.faeStatus).toBeNull();

    stage = 'FAE My Tasks deep link and text save';
    const faeSession = await uiLogin(fae.page, fae.user.username, fae.password);
    expect(faeSession).toMatchObject({ id: fae.user.id, organizationId });
    await fae.page.goto('/app/my-tasks');
    await fae.page.getByRole('tab', { name: '客诉FAE解析', exact: true }).click();
    const inbox = fae.page.getByRole('tabpanel', { name: '客诉FAE解析', exact: true });
    const taskLink = inbox.getByRole('link', { name: '查看客诉并解析', exact: true });
    await expect(taskLink).toHaveCount(1);
    await expect(taskLink).toHaveAttribute('href', href);
    await taskLink.click();
    await expect(fae.page).toHaveURL(new URL(href, baseURL).href);
    const faeDetail = fae.page.getByRole('region', { name: '客诉详情', exact: true });
    await expect(faeDetail.getByRole('heading', { name: created.complaintNumber, exact: true })).toBeVisible();
    const faeSection = faeDetail.getByRole('region', { name: 'FAE 解析', exact: true });
    const text = '真实 FAE 复核：接插件松脱，仅保存文字，不伪造附件或完成日期。';
    await faeSection.getByLabel('FAE 解析文字', { exact: true }).fill(text);
    const savedFae = await uiWrite<Schema['CustomerAnalysisDto']>(fae.page, `${analysis}/${assignedFae.id}/fae`, 'PUT', 200,
      () => faeSection.getByRole('button', { name: '保存 FAE 解析', exact: true }).click());
    expect(savedFae).toMatchObject({ assigneeUserId: fae.user.id, assigneeAssignmentId: assignedFae.assigneeAssignmentId,
      text, faeStatus: 'ANALYSED', completedOn: null, failedPart: null, failedMaterialCode: null, fileIds: [] });
    await expect(faeSection.getByText('已解析', { exact: true })).toBeVisible();
    await expect(faeSection.getByText('当前内容已保存', { exact: true })).toBeVisible();

    stage = 'SQE independent content save';
    const sqeSession = await uiLogin(sqe.page, sqe.user.username, sqe.password);
    expect(sqeSession).toMatchObject({ id: sqe.user.id, organizationId });
    await sqe.page.goto(href);
    const supplierSection = sqe.page.getByRole('region', { name: '供应商分析', exact: true });
    await supplierSection.getByLabel('供应商分析进度', { exact: true }).fill('已联系供应商，独立记录进度。');
    await supplierSection.getByLabel('供应商分析结果', { exact: true }).fill('待进一步复核，不自动发供应商问题单。');
    const savedSqe = await uiWrite<Schema['CustomerAnalysisDto']>(sqe.page, `${analysis}/${assignedSqe.id}/supplier`, 'PUT', 200,
      () => supplierSection.getByRole('button', { name: '保存供应商分析', exact: true }).click());
    expect(savedSqe).toMatchObject({ assigneeUserId: sqe.user.id, section: 'SUPPLIER', faeStatus: null, text: null, fileIds: [],
      progress: '已联系供应商，独立记录进度。', result: '待进一步复核，不自动发供应商问题单。' });
    await expect(supplierSection.getByText('当前内容已保存', { exact: true })).toBeVisible();

    stage = 'persisted business facts and history';
    const persisted = await positionRead<Schema['CustomerLedgerDetailDto']>(qe.page.request, `${ledger}/${created.id}`);
    expect(persisted).toMatchObject({ customerId: null, courierNumber, receivedOn: '2026-10-27', status: 'FOLLOWING', serviceMonths: 3, misTag: '3MIS' });
    expect(persisted.history.map(event => event.eventType)).toEqual(['PROGRESS_RECORDED', 'CLOSED', 'REOPENED']);
    expect(persisted.history.every(event => event.actorUserId === qe.user.id)).toBe(true);
    const summary = await positionRead<Schema['CustomerAnalysisSummaryDto']>(qe.page.request, `${analysis}/complaints/${created.id}`);
    expect(summary.fae).toMatchObject({ id: savedFae.id, text, faeStatus: 'ANALYSED', fileIds: [] });
    expect(summary.supplier).toMatchObject({ id: savedSqe.id, progress: savedSqe.progress, result: savedSqe.result, fileIds: [] });
    await attachJson(testInfo, 'n4-ledger-cooperation.json', { ledger: persisted, analyses: summary });
    const originalViewport = qe.page.viewportSize();
    try {
      for (const width of [1440, 375]) {
        stage = `geometry ${width}: resize`;
        appendFileSync(testInfo.outputPath('n4-geometry-progress.ndjson'), `${JSON.stringify({ width, step: 'resize' })}\n`);
        await qe.page.setViewportSize({ width, height: 900 });
        const ledgerPage = qe.page.locator('.customer-quality-page');
        const table = ledgerPage.locator('.customer-quality-card .ant-table-content').first();
        await expect(table).toBeVisible();
        for (const name of ['人工登记客诉', /^刷\s*新$/]) {
          stage = `geometry ${width}: ${String(name)}`;
          appendFileSync(testInfo.outputPath('n4-geometry-progress.ndjson'), `${JSON.stringify({ width, step: String(name) })}\n`);
          const button = ledgerPage.getByRole('button', { name, exact: true });
          await expect(button).toBeVisible();
          await button.scrollIntoViewIfNeeded();
          await expect(button).toBeEnabled();
          await expect(button).toBeInViewport({ ratio: 1 });
        }
        const heading = ledgerPage.getByRole('heading', { name: '客诉台账', exact: true });
        await expect(heading).toBeVisible();
        await heading.scrollIntoViewIfNeeded();
        const geometry = await table.evaluate(element => ({
          viewport: window.innerWidth, body: document.body.scrollWidth, document: document.documentElement.scrollWidth,
          tableLeft: element.getBoundingClientRect().left, tableRight: element.getBoundingClientRect().right,
          tableClient: element.clientWidth, tableScroll: element.scrollWidth, overflowX: getComputedStyle(element).overflowX,
        }));
        const screenshot = testInfo.outputPath(`n4-ledger-default-${width}.jpg`);
        stage = `geometry ${width}: screenshot and assertions`;
        appendFileSync(testInfo.outputPath('n4-geometry-progress.ndjson'), `${JSON.stringify({ width, step: 'screenshot', geometry })}\n`);
        await qe.page.screenshot({ path: screenshot, type: 'jpeg', quality: 90, fullPage: false });
        await testInfo.attach(`n4-ledger-default-${width}`, { path: screenshot, contentType: 'image/jpeg' });
        await attachJson(testInfo, `n4-geometry-${width}.json`, geometry);
        if (width === 1440) {
          stage = 'geometry 1440: quantity header width';
          const header = table.getByRole('columnheader', { name: '登记件数', exact: true });
          await expect(header).toBeVisible();
          const bounds = await header.boundingBox();
          await attachJson(testInfo, 'n4-desktop-quantity-header.json', { minimumWidth: 76, bounds });
          expect(bounds).not.toBeNull();
          expect(bounds!.width).toBeGreaterThanOrEqual(76);
        }
        expect(geometry.viewport).toBe(width);
        expect(Math.max(geometry.body, geometry.document)).toBeLessThanOrEqual(width + 1);
        expect(geometry.tableLeft).toBeGreaterThanOrEqual(-1);
        expect(geometry.tableRight).toBeLessThanOrEqual(width + 1);
        expect(['auto', 'scroll']).toContain(geometry.overflowX);
        if (width === 375) expect(geometry.tableScroll).toBeGreaterThan(geometry.tableClient);
      }
    } finally { if (originalViewport) await qe.page.setViewportSize(originalViewport); }
  } catch (cause) {
    primaryFailed = true;
    await attachJson(testInfo, 'n4-primary-failure.json', { stage, businessPaths: contexts.flatMap(context => context.pages().map(entry => new URL(entry.url()).pathname)),
      name: cause instanceof Error ? cause.name : 'UnknownError', message: cause instanceof Error ? cause.message : String(cause) });
    throw cause;
  } finally {
    try {
      try {
        if (mapping) await positionWrite(page.request, `${configuration}/component-project-mappings/${mapping.id}`, 'PATCH', { expectedVersion: mapping.version, status: 'DISABLED' } satisfies Schema['UpdateComponentProjectMappingDto']);
        if (project) await positionWrite(page.request, `${configuration}/component-project-records/${project.id}`, 'PATCH', { expectedVersion: project.version, status: 'DISABLED' } satisfies Schema['UpdateComponentProjectRecordDto']);
        for (const user of users) {
          await replacePositionAppointments(page.request, organizationId, user.id, []);
          await positionWrite(page.request, `/api/v1/admin/users/${user.id}?organizationId=${organizationId}`, 'PATCH', { status: 'DISABLED' });
        }
        // Analysis history retains departments; only the parent may dispose of their dedicated database.
        for (const grant of grants) await positionWrite(page.request, `/api/v1/organizations/${organizationId}/positions/${grant.position.id}`, 'PATCH', { status: 'DISABLED', expectedVersion: grant.position.version } satisfies Schema['UpdatePositionDto']);
      } finally { await Promise.all(contexts.map(context => context.close())); }
    } catch (cause) {
      await attachJson(testInfo, 'n4-cleanup-failure.json', { message: cause instanceof Error ? cause.message : String(cause), primaryFailed });
      if (!primaryFailed) throw cause;
    }
  }
});

test('previews Chinese TSV and CONTINUE persists a bad quantity as warned raw text, not a fabricated number', async ({ page }, testInfo) => {
  await uiLogin(page, 'local.internal', internalPassword!);
  const pageErrors: string[] = [];
  page.on('pageerror', error => pageErrors.push(error.message.replaceAll(internalPassword!, '[REDACTED]')));
  await page.goto('/app/customer-quality');
  await expect(page.getByRole('heading', { name: '客诉台账', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '粘贴 / Excel 导入', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '粘贴 / Excel 导入', exact: true });
  try { await expect(dialog).toBeVisible(); }
  catch (cause) {
    const dom = await page.evaluate(() => ({ path: location.pathname,
      dialogs: Array.from(document.querySelectorAll('[role="dialog"]'), element => ({ label: element.getAttribute('aria-label'), labelledby: element.getAttribute('aria-labelledby'), text: element.querySelector('.ant-modal-title')?.textContent })),
      textareas: Array.from(document.querySelectorAll('textarea'), element => ({ label: element.getAttribute('aria-label'), disabled: element.disabled })),
    }));
    await attachJson(testInfo, 'n4-import-open-diagnostic.json', { dom, pageErrors });
    throw cause;
  }
  const customerName = unique('N4导入待匹配客户');
  const description = unique('N4保留异常件数');
  const quantity = '两件待核';
  await dialog.getByLabel('中文 TSV 粘贴', { exact: true }).fill(`客户\t客诉类型\t件数\t详细故障描述\n${customerName}\t售后\t${quantity}\t${description}`);
  const preview = await uiWrite<Schema['CustomerLedgerImportResultDto']>(page, `${ledger}/import/preview`, 'POST', 201,
    () => dialog.getByRole('button', { name: '预览', exact: true }).click());
  expect(preview.created).toBe(0);
  expect(preview.items).toHaveLength(1);
  expect(preview.items[0]).toMatchObject({ rowNumber: 2, outcome: 'PREVIEW', complaintId: null, errorCode: null, record: null });
  expect(preview.items[0]!.warnings).toContainEqual({ field: 'quantity', code: 'INVALID_VALUE' });
  const beforeCommit = await positionRead<Schema['CustomerLedgerPageDto']>(page.request, `${ledger}?search=${encodeURIComponent(description)}`);
  expect(beforeCommit.total, 'Preview must not persist a complaint').toBe(0);
  await dialog.getByRole('button', { name: '第 2 行 待补正说明', exact: true }).focus();
  const tooltip = page.getByRole('tooltip');
  await expect(tooltip).toContainText('件数：原填写不符合规范');
  await expect(tooltip).toContainText(`原填写：${quantity}`);
  await expect(dialog.getByLabel('第 2 行操作', { exact: true })).toHaveValue('ADD');
  const committed = await uiWrite<Schema['CustomerLedgerImportResultDto']>(page, `${ledger}/import/commit`, 'POST', 201,
    () => dialog.getByRole('button', { name: '继续，保留原文', exact: true }).click());
  expect(committed).toMatchObject({ created: 1, supplemented: 0, skipped: 0, failed: 0, pendingCorrection: 1 });
  expect(committed.items).toHaveLength(1);
  expect(committed.items[0]).toMatchObject({ rowNumber: 2, outcome: 'CREATED', errorCode: null,
    record: { customerId: null, raw: { quantity, customerName, defectDescription: description }, normalized: { quantity: null, customerName, complaintType: 'AFTER_SALES' }, misTag: null, serviceMonths: null } });
  expect(committed.items[0]!.warnings).toContainEqual({ field: 'quantity', code: 'INVALID_VALUE' });
  await expect(dialog.getByText('实际新增 1 条；补充 0 条；待补正 1 条；跳过 0 条；失败 0 条。', { exact: true })).toBeVisible();
  const complaintId = committed.items[0]!.complaintId!;
  const persisted = await positionRead<Schema['CustomerLedgerDetailDto']>(page.request, `${ledger}/${complaintId}`);
  expect(persisted).toMatchObject({ raw: { quantity, customerName, defectDescription: description }, normalized: { quantity: null }, customerId: null });
  expect(persisted.warnings).toContainEqual({ field: 'quantity', code: 'INVALID_VALUE' });
  await dialog.getByRole('button', { name: '关闭导入窗口', exact: true }).click();
  await expect(dialog).toBeHidden();
  await page.getByLabel('搜索客诉', { exact: true }).fill(persisted.complaintNumber);
  await page.getByLabel('搜索客诉', { exact: true }).press('Enter');
  const row = page.getByRole('row').filter({ hasText: persisted.complaintNumber });
  await expect(row).toContainText(description);
  await row.getByRole('button', { name: persisted.complaintNumber, exact: true }).click();
  const detail = page.getByRole('region', { name: '客诉详情', exact: true });
  await detail.locator('summary').filter({ hasText: '登记事实与原填写' }).click();
  await expect(detail.getByText(`原填写：${quantity}`, { exact: true })).toBeVisible();
  await attachJson(testInfo, 'n4-tsv-continue.json', { preview, committed, persisted });
});
