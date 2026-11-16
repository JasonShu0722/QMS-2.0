import { randomUUID } from 'node:crypto';
import { createServer, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import type { components } from '@qms/contracts';
import { completeMfa } from './mfa-login';
import { positionRead, positionWrite } from './position-fixture';
import { fillSecret } from './secret-input';

type Schema = components['schemas'];
const baseURL = process.env.QMS_ACCEPTANCE_BASE_URL;
const databaseURL = process.env.DATABASE_URL;
const password = process.env.QMS_SEED_INTERNAL_PASSWORD;
if (!baseURL || !databaseURL || !password || !process.env.QMS_ACCEPTANCE_MFA_CACHE_FILE || !process.env.QMS_BACKUP_KEY
  || process.env.QMS_DISPOSABLE_TEST_DB !== 'true' || process.env.QMS_ACCEPTANCE_DISPOSABLE_DATABASE !== 'true') {
  throw new Error('Process ingestion acceptance requires disposable PostgreSQL, gateway and external encrypted MFA credentials.');
}
for (const value of [baseURL, databaseURL]) {
  const url = new URL(value);
  if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.port === '55440' || url.search || url.hash) {
    throw new Error('Only disposable loopback resources outside preserved preview 55440 are allowed.');
  }
}
const requireApi = createRequire(new URL('../../api/package.json', import.meta.url));
const { PrismaPg } = requireApi('@prisma/adapter-pg');
const { PrismaClient } = await import('../../api/dist/generated/prisma/client.js');
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseURL }) });
const suffix = randomUUID().replaceAll('-', '').slice(0, 10).toUpperCase();
const ingestion = '/api/v1/admin/integrations/ingestion';
let fixtureRoleId: string;
let addedPermissionId: string | undefined;

test.setTimeout(240_000);
test.use({ trace: 'off', screenshot: 'off', video: 'off', actionTimeout: 15_000, navigationTimeout: 20_000 });
test.beforeAll(async () => {
  const organization = await prisma.organization.findUniqueOrThrow({ where: { code: 'LOCAL-INTERNAL' } });
  const user = await prisma.user.findUniqueOrThrow({ where: { organizationId_username: { organizationId: organization.id, username: 'local.internal' } } });
  fixtureRoleId = (await prisma.userRole.findFirstOrThrow({ where: { organizationId: organization.id, userId: user.id, role: { code: 'LOCAL_MEMBER' } } })).roleId;
  const permission = await prisma.permission.findUniqueOrThrow({ where: { code: 'platform:admin' } });
  const where = { roleId_permissionId: { roleId: fixtureRoleId, permissionId: permission.id } };
  if (!await prisma.rolePermission.findUnique({ where })) {
    await prisma.rolePermission.create({ data: where.roleId_permissionId });
    addedPermissionId = permission.id;
  }
});
test.afterAll(async () => {
  try {
    if (addedPermissionId) await prisma.rolePermission.deleteMany({ where: { roleId: fixtureRoleId, permissionId: addedPermissionId } });
  } finally { await prisma.$disconnect(); }
});

async function login(page: Page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/login');
  await page.getByLabel('账号', { exact: true }).fill('local.internal');
  await fillSecret(page.getByLabel('密码', { exact: true }), password!);
  const response = page.waitForResponse(entry => new URL(entry.url()).pathname === '/api/v1/auth/login' && entry.request().method() === 'POST');
  const [authenticated] = await Promise.all([response, page.getByRole('button', { name: '登录', exact: true }).click()]);
  await completeMfa(page.request, authenticated, 'local.internal', page);
  await expect(page).toHaveURL(/\/app\/workbench$/);
}

async function worker() {
  const result = await promisify(execFile)(process.execPath, ['dist/worker.js', '--once'], {
    cwd: fileURLToPath(new URL('../../api/', import.meta.url)), windowsHide: true, timeout: 45_000,
    env: { ...process.env, NODE_ENV: 'test', QMS_WORKER_BATCH_SIZE: '100', NODE_OPTIONS: '--max-old-space-size=512' },
  });
  expect(result.stdout).toContain('QMS_WORKER_READY');
  expect(result.stderr).not.toContain('QMS_WORKER_FAILED');
}

test('administrator imports incomplete IMS rows and real Worker fills only missing mappings while preserving stage', async ({ page }) => {
  await login(page);
  await page.goto('/console/api-ingestion');
  await expect(page.getByRole('button', { name: '新增规则', exact: true })).toBeVisible();
  let endpoint = await positionWrite<Schema['IntegrationEndpointDto']>(page.request, '/api/v1/admin/integrations/endpoints', 'POST', {
    code: `PD_${suffix}`, name: `制程验收${suffix}`, sourceCode: 'IMS', sourceName: 'IMS一次性验收', returnReceipt: true,
  }, 201);
  const credential = await positionWrite<Schema['IntegrationCredentialDto']>(page.request, `/api/v1/admin/integrations/endpoints/${endpoint.id}/credentials`, 'POST', { name: '制程一次性凭据', validityDays: null }, 201);
  endpoint = await positionWrite<Schema['IntegrationEndpointDto']>(page.request, `/api/v1/admin/integrations/endpoints/${endpoint.id}`, 'PATCH', { expectedVersion: endpoint.version, status: 'ENABLED' });
  await page.reload();
  await page.getByRole('button', { name: '新增规则', exact: true }).click();
  const editor = page.getByRole('dialog', { name: '新增入库规则', exact: true });
  await editor.getByLabel('规则名称', { exact: true }).fill(`界面制程规则${suffix}`);
  await editor.getByLabel('接收接口', { exact: true }).click();
  await page.locator('.ant-select-dropdown:visible .ant-select-item-option').filter({ hasText: endpoint.name }).click();
  await editor.getByLabel('目标档案', { exact: true }).click();
  await page.locator('.ant-select-dropdown:visible .ant-select-item-option').filter({ hasText: '制程不良品台账' }).click();
  await editor.getByLabel('成品编码来源字段', { exact: true }).fill('PRODUCT');
  await editor.getByLabel('不良描述来源字段', { exact: true }).fill('FAULT');
  const ruleSaved = page.waitForResponse(response => new URL(response.url()).pathname === `${ingestion}/rules` && response.request().method() === 'POST');
  await editor.getByRole('button', { name: /^保\s*存$/ }).click();
  expect((await ruleSaved).status()).toBe(201);
  await expect(editor).toHaveCount(0);
  await positionWrite<Schema['IngestionRuleDto']>(page.request, `${ingestion}/rules`, 'POST', {
    name: `制程规则${suffix}`, endpointId: endpoint.id, target: 'PROCESS_DEFECT', enabled: true, match: 'ALL', conditions: [],
    mapping: { externalRecordKey: 'ID', occurredAt: 'TIME', productCode: 'PRODUCT', traceCode: 'TRACE', operationName: 'OPERATION', lineName: 'LINE' },
    descriptionComposition: { fields: [{ path: 'FAULT', label: '现象：' }, { path: 'NOTE', label: '说明：' }], separator: '\n' },
    mode: 'UPDATE', updateFields: ['description'], sourceTimezone: 'Asia/Shanghai',
  } satisfies Schema['SaveIngestionRuleDto'], 201);
  async function send(rows: object[]) {
    const response = await fetch(new URL(`/api/v1/integrations/inbound/${endpoint.code}/messages`, baseURL), {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15_000),
      headers: { Authorization: `Bearer ${credential.secret}`, 'Content-Type': 'application/json' }, body: JSON.stringify(rows),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toBe(true);
  }
  const productCode = `CMP_${suffix}`;
  await send([
    { ID: `FIRST_${suffix}`, TIME: '2026-11-16T08:30:00+08:00', PRODUCT: productCode, TRACE: `T_${suffix}`, OPERATION: `焊接${suffix}`, FAULT: suffix, NOTE: '完整行' },
    { ID: `SECOND_${suffix}`, PRODUCT: productCode, OPERATION: `焊接${suffix}`, FAULT: suffix },
  ]);
  await worker();
  const list = await positionRead<Schema['ProcessDefectPageDto']>(page.request, `/api/v1/process-quality/defects?page=1&pageSize=20&search=${suffix}`);
  expect(list.items).toHaveLength(2);
  const first = list.items.find(item => item.externalRecordKey === `FIRST_${suffix}`)!;
  const incomplete = list.items.find(item => item.externalRecordKey === `SECOND_${suffix}`)!;
  expect(first).toMatchObject({ sourceKind: 'IMS', defectQuantity: 1, shift: 'DAY', pendingConfiguration: true });
  expect(first.description).toBe(`现象：${suffix}\n说明：完整行`);
  expect(incomplete).toMatchObject({ pendingCompletion: true, occurredAt: null, traceCode: null });
  const partlyUpdated = await positionWrite<Schema['ProcessDefectDto']>(page.request, `/api/v1/process-quality/defects/${incomplete.id}`, 'PUT', { expectedVersion: incomplete.version, traceCode: `FIX_${suffix}` });
  expect(partlyUpdated.pendingCompletion).toBe(true);
  const project = await positionWrite<Schema['ComponentProjectRecordDto']>(page.request, '/api/v1/admin/configuration/component-project-records', 'POST', { code: `PROJECT_${suffix}`, name: '登记时新品项目', stage: 'NEW_PRODUCT' }, 201);
  await positionWrite(page.request, '/api/v1/admin/configuration/component-project-mappings', 'POST', { componentCode: productCode, componentName: '验收成品', projectRecordId: project.id, productCategory: '控制器', productSubcategory: '细分控制器' }, 201);
  await positionWrite(page.request, '/api/v1/process-quality/operation-sectors', 'POST', { operationName: `焊接${suffix}`, sectorName: '电子板块' }, 201);
  await expect.poll(async () => {
    await worker();
    return (await positionRead<Schema['ProcessDefectDto']>(page.request, `/api/v1/process-quality/defects/${first.id}`)).pendingConfiguration;
  }, { timeout: 80_000, intervals: [1000, 5000, 10000], message: 'The real completion Worker retries pending mappings within its one-minute scheduling interval' }).toBe(false);
  const associated = await positionRead<Schema['ProcessDefectDto']>(page.request, `/api/v1/process-quality/defects/${first.id}`);
  expect(associated).toMatchObject({ projectStage: 'NEW_PRODUCT', productSubcategory: '细分控制器', operationSector: '电子板块', pendingConfiguration: false });
  await positionWrite(page.request, `/api/v1/admin/configuration/component-project-records/${project.id}`, 'PATCH', { expectedVersion: project.version, stage: 'MASS_PRODUCTION' });
  await worker();
  expect(await positionRead<Schema['ProcessDefectDto']>(page.request, `/api/v1/process-quality/defects/${first.id}`)).toMatchObject({ projectStage: 'NEW_PRODUCT' });
  await page.goto('/app/process-quality');
  await expect(page.getByRole('button', { name: '登记不良', exact: true })).toBeVisible();
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
    if (process.env.QMS_ACCEPTANCE_ARTIFACT_DIRECTORY) await page.screenshot({ path: `${process.env.QMS_ACCEPTANCE_ARTIFACT_DIRECTORY}/process-defects-${width}.png` });
  }
});

test('manual registration retains the trace draft after closing the camera and saves the default quantity', async ({ page }) => {
  await login(page);
  await page.goto('/app/process-quality');
  await page.getByRole('button', { name: '登记不良', exact: true }).click();
  const drawer = page.getByRole('dialog', { name: '登记不良', exact: true });
  await expect(drawer.getByRole('spinbutton', { name: /不良数量$/ })).toHaveValue('1');
  await drawer.getByLabel(/发生时间$/).fill('2026-11-16T08:30');
  await drawer.getByLabel(/成品编码$/).fill(`MANUAL_${suffix}`);
  await drawer.getByLabel('追溯码', { exact: true }).fill(`SCAN_${suffix}`);
  await drawer.getByLabel(/不良描述$/).fill(`现场登记${suffix}`);
  await drawer.getByRole('button', { name: '手机扫码', exact: true }).click();
  const scanner = page.getByRole('dialog', { name: '扫描追溯码', exact: true });
  await expect(scanner).toBeVisible();
  await scanner.getByRole('button', { name: '返回手动输入', exact: true }).click();
  await expect(scanner).toHaveCount(0);
  await expect(drawer.getByLabel('追溯码', { exact: true })).toHaveValue(`SCAN_${suffix}`);
  const saved = page.waitForResponse(response => new URL(response.url()).pathname === '/api/v1/process-quality/defects' && response.request().method() === 'POST');
  await drawer.getByRole('button', { name: '保存登记', exact: true }).click();
  const response = await saved;
  expect(response.status()).toBe(201);
  expect(await response.json()).toMatchObject({ sourceKind: 'MANUAL', defectQuantity: 1, shift: 'DAY' });
});

test('AI channels keep credentials private and real Worker applies structured descriptions with failure and manual fallback', async ({ page }) => {
  await login(page);
  const secret = `disposable-ai-${randomUUID()}`;
  const calls: Array<{ authorization?: string; body: string }> = [];
  let delayed: ServerResponse | undefined;
  const server = createServer((request, response) => {
    let body = '';
    request.on('data', chunk => { body += String(chunk); });
    request.on('end', () => {
      calls.push({ authorization: request.headers.authorization, body });
      if (body.includes('MANUAL_DELAY')) { delayed = response; return; }
      if (body.includes('VENDOR_FAIL')) { response.statusCode = 503; response.end(secret); return; }
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ defectSummary: `AI整理${suffix}` }) } }] }));
    });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const channel = await positionWrite<Schema['AiConnectionDto']>(page.request, '/api/v1/admin/ai-connections', 'POST', {
      name: `AI渠道${suffix}`, baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`,
      models: ['fixture-standard', 'fixture-summary'], defaultModel: 'fixture-standard', enabled: true, apiKey: secret,
    }, 201);
    const channels = await positionRead<Schema['AiConnectionDto'][]>(page.request, '/api/v1/admin/ai-connections');
    expect(JSON.stringify([channel, channels])).not.toContain(secret);
    expect(Object.keys(channel)).not.toEqual(expect.arrayContaining(['apiKey']));
    expect(channel).toMatchObject({ hasKey: true, models: ['fixture-standard', 'fixture-summary'] });
    const loadedChannels = page.waitForResponse(response => {
      const url = new URL(response.url());
      return url.pathname === '/api/v1/admin/ai-connections' && url.searchParams.get('organizationId') === channel.organizationId && response.request().method() === 'GET';
    });
    await page.goto(`/console/configuration?organizationId=${channel.organizationId}`);
    await expect(page.getByRole('button', { name: '新增AI连接', exact: true })).toBeVisible();
    const channelResponse = await loadedChannels;
    expect(channelResponse.status()).toBe(200);
    expect(await channelResponse.json()).toEqual(expect.arrayContaining([expect.objectContaining({ id: channel.id })]));
    const channelRow = page.getByRole('row').filter({ hasText: `AI渠道${suffix}` });
    await expect(channelRow).toBeVisible();
    await channelRow.getByRole('button', { name: /^编\s*辑$/ }).click();
    const editor = page.getByRole('dialog', { name: 'AI连接', exact: true });
    await expect(editor.getByLabel('API密钥', { exact: true })).toHaveValue('');
    expect(await page.locator('body').innerText()).not.toContain(secret);
    await editor.getByRole('button', { name: /^取\s*消$/ }).click();
    let endpoint = await positionWrite<Schema['IntegrationEndpointDto']>(page.request, '/api/v1/admin/integrations/endpoints', 'POST', {
      code: `AI_${suffix}`, name: `AI不良验收${suffix}`, sourceCode: 'IMS', sourceName: 'IMS一次性AI验收', returnReceipt: true,
    }, 201);
    const credential = await positionWrite<Schema['IntegrationCredentialDto']>(page.request, `/api/v1/admin/integrations/endpoints/${endpoint.id}/credentials`, 'POST', { name: 'AI一次性凭据', validityDays: null }, 201);
    endpoint = await positionWrite<Schema['IntegrationEndpointDto']>(page.request, `/api/v1/admin/integrations/endpoints/${endpoint.id}`, 'PATCH', { expectedVersion: endpoint.version, status: 'ENABLED' });
    const aiRuleInput: Schema['SaveIngestionRuleDto'] = {
      name: `AI描述规则${suffix}`, endpointId: endpoint.id, target: 'PROCESS_DEFECT', enabled: true, match: 'ALL', conditions: [],
      mapping: { externalRecordKey: 'ID', productCode: 'PRODUCT', traceCode: 'TRACE' },
      descriptionComposition: { fields: [{ path: 'FAULT', label: '现象：' }], separator: '\n' }, mode: 'INSERT_ONLY', updateFields: [],
      aiDescription: { connectionId: channel.id, model: 'fixture-summary', prompt: '整理{{fault}}，仅保留已给事实。',
        inputFields: [{ path: 'FAULT', label: '现象', variable: 'fault' }], output: { mode: 'JSON', field: 'defectSummary', target: 'description' } },
    };
    const aiRule = await positionWrite<Schema['IngestionRuleDto']>(page.request, `${ingestion}/rules`, 'POST', aiRuleInput, 201);
    const csrf = await positionRead<Schema['CsrfResponseDto']>(page.request, '/api/v1/auth/csrf');
    const rejectedModel = await page.request.patch(`${ingestion}/rules/${aiRule.id}`, {
      headers: { 'x-csrf-token': csrf.csrfToken, 'Idempotency-Key': randomUUID() },
      data: { ...aiRuleInput, expectedVersion: aiRule.version, aiDescription: { ...aiRuleInput.aiDescription, model: 'unapproved-model' } },
    });
    expect(rejectedModel.status()).toBe(400);
    expect((await rejectedModel.json()).code).toBe('INGESTION_RULE_INVALID');
    await page.goto('/console/api-ingestion');
    await page.getByRole('row').filter({ hasText: `AI描述规则${suffix}` }).getByRole('button', { name: `编辑AI描述规则${suffix}`, exact: true }).click();
    const ruleEditor = page.getByRole('dialog', { name: '编辑入库规则', exact: true });
    await expect(ruleEditor.getByLabel(/描述提示词$/)).toHaveValue('整理{{fault}}，仅保留已给事实。');
    await expect(ruleEditor.getByLabel(/提取输出字段$/)).toHaveValue('defectSummary');
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      await expect.poll(() => ruleEditor.locator('.ant-modal-body').evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
      if (process.env.QMS_ACCEPTANCE_ARTIFACT_DIRECTORY) await page.screenshot({ path: `${process.env.QMS_ACCEPTANCE_ARTIFACT_DIRECTORY}/process-ai-rule-${width}.png` });
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    await ruleEditor.getByLabel(/规则名称$/).fill(`AI规则已编辑${suffix}`);
    const updatedRuleResponse = page.waitForResponse(response => new URL(response.url()).pathname === `${ingestion}/rules/${aiRule.id}` && response.request().method() === 'PATCH');
    await ruleEditor.getByRole('button', { name: /^保\s*存$/ }).click();
    const savedRule = await updatedRuleResponse;
    expect(savedRule.status()).toBe(200);
    expect((await savedRule.json()).aiDescription).toMatchObject({ model: 'fixture-summary', inputFields: [{ path: 'FAULT', variable: 'fault' }], output: { mode: 'JSON', field: 'defectSummary' } });
    await expect(ruleEditor).toHaveCount(0);
    const send = async (id: string, fault: string) => {
      const response = await fetch(new URL(`/api/v1/integrations/inbound/${endpoint.code}/messages`, baseURL), {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15_000),
        headers: { Authorization: `Bearer ${credential.secret}`, 'Content-Type': 'application/json' },
        body: JSON.stringify([{ ID: id, PRODUCT: `AI_PRODUCT_${suffix}`, TRACE: id, FAULT: fault, PRIVATE_UNUSED: 'must-not-leave-qms' }]),
      });
      expect(response.status).toBe(200); expect(await response.json()).toBe(true);
    };
    const find = async (id: string) => {
      const result = await positionRead<Schema['ProcessDefectPageDto']>(page.request, `/api/v1/process-quality/defects?page=1&pageSize=20&search=${suffix}`);
      return result.items.find(item => item.externalRecordKey === id);
    };
    const successId = `AI_SUCCESS_${suffix}`;
    await send(successId, '焊点异常');
    await worker();
    const success = await find(successId);
    expect(success).toMatchObject({ description: `AI整理${suffix}`, descriptionSource: 'AI', descriptionDirect: '现象：焊点异常' });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.authorization).toBe(`Bearer ${secret}`);
    expect(JSON.parse(calls[0]!.body).model).toBe('fixture-summary');
    expect(calls[0]!.body).not.toContain('must-not-leave-qms');
    await worker(); expect(calls).toHaveLength(1);
    const failureId = `AI_FAILURE_${suffix}`;
    await send(failureId, 'VENDOR_FAIL'); await worker();
    const failure = await find(failureId);
    expect(failure).toMatchObject({ description: '现象：VENDOR_FAIL', descriptionSource: 'DIRECT' });
    expect(JSON.stringify(failure)).not.toContain(secret);
    const manualId = `AI_MANUAL_${suffix}`;
    await send(manualId, 'MANUAL_DELAY');
    const running = worker();
    try {
      await expect.poll(() => !!delayed, { timeout: 15_000 }).toBe(true);
      const current = (await find(manualId))!;
      await positionWrite<Schema['ProcessDefectDto']>(page.request, `/api/v1/process-quality/defects/${current.id}`, 'PUT', { expectedVersion: current.version, description: `人工确认${suffix}` });
    } finally {
      delayed?.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ defectSummary: '迟到AI建议' }) } }] }));
      await running;
    }
    expect(await find(manualId)).toMatchObject({ description: `人工确认${suffix}`, descriptionSource: 'MANUAL', descriptionAi: '迟到AI建议' });
  } finally {
    delayed?.end(); server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
