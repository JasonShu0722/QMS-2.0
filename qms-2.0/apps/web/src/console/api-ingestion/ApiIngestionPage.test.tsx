import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { transferableAbortController } from 'node:util';
import { createMemoryRouter, MemoryRouter, RouterProvider } from 'react-router-dom';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ApiError, apiRequest } from '../../api/client';
import { LanguageProvider } from '../../i18n/Language';
import { UnsavedChangesProvider, useUnsavedChanges } from '../../layouts/UnsavedChanges';
import { useWorkTabsStore } from '../../work-tabs/workTabsStore';
import { getLedgerSessionEpoch } from '../../ui/ledger/preferences';
import { ConsoleTheme } from '../ConsoleTheme';
import type { ConsoleContext } from '../console-navigation';
import { ApiIngestionPage } from './ApiIngestionPage';
import { ImportPreview } from './ImportPreview';
import { RuleEditor } from './RuleEditor';
import { JobList } from './JobList';
import { IngestionError, ingestionIssue, type Rule } from './ingestion-ui';
import type { IntegrationScope } from '../api-integrations/integration-ui';

const mocks = vi.hoisted(() => ({ context: {} as ConsoleContext, invalidate: vi.fn(), mutate: vi.fn() }));
vi.mock('../ConsoleLayout', () => ({ useConsoleContext: () => mocks }));
vi.mock('../../api/client', async original => ({ ...await original<typeof import('../../api/client')>(), apiRequest: vi.fn(), createAdminMutation: vi.fn(() => mocks.mutate) }));
const read = vi.mocked(apiRequest);
const homeId = '11111111-1111-4111-8111-111111111111';
const actorId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const endpointId = '33333333-3333-4333-8333-333333333333';
const ruleId = '44444444-4444-4444-8444-444444444444';
const receiptId = '55555555-5555-4555-8555-555555555555';
const home = { id: homeId, code: 'HOME', name: '组织', type: 'INTERNAL', status: 'ACTIVE', configurationRequired: false } as const;
const rule: Rule = { organizationId: homeId, id: ruleId, name: '供应商规则', endpointId, target: 'SUPPLIER', enabled: false, match: 'ALL', conditions: [], mapping: { code: 'code', name: 'name' }, mode: 'CONFIRM', updateFields: ['name'], version: 2, creatorId: actorId, updatedAt: '2026-11-14T02:00:00Z' };
function context(permissions = ['ingestion:read', 'ingestion:manage', 'ingestion:run'], materialPermissions: string[] = []): ConsoleContext {
  const materialModules: ConsoleContext['modules'] = materialPermissions.length ? [{ key: 'master-data', scope: 'TARGET', coverage: 'ORGANIZATION', organizationId: homeId, permissions: materialPermissions }] : [];
  return { actor: { id: actorId, accountType: 'INTERNAL', homeOrganization: home }, targetOrganization: home, organizations: [home], hasPlatformAdministrator: true,
    modules: [{ key: 'api-ingestion', scope: 'TARGET', coverage: 'ORGANIZATION', organizationId: homeId, permissions }, ...materialModules, { key: 'api-integrations', scope: 'TARGET', coverage: 'ORGANIZATION', organizationId: homeId, permissions: ['integration:receipts:read', 'integration:payload:read'] }] };
}
function view(initialEntry = '/console/api-ingestion') {
  const tree = () => <LanguageProvider><ConsoleTheme><MemoryRouter initialEntries={[initialEntry]}><UnsavedChangesProvider><ApiIngestionPage /></UnsavedChangesProvider></MemoryRouter></ConsoleTheme></LanguageProvider>;
  const result = render(tree()); return { ...result, update: () => result.rerender(tree()) };
}
function componentView(children: ReactNode) {
  return render(<LanguageProvider><ConsoleTheme><MemoryRouter><UnsavedChangesProvider>{children}</UnsavedChangesProvider></MemoryRouter></ConsoleTheme></LanguageProvider>);
}
function verifiedScope(extraPermissions: string[] = []): IntegrationScope {
  return { organizationId: homeId, session: `INTERNAL:${homeId}:${actorId}`, epoch: getLedgerSessionEpoch(), permissions: ['ingestion:read', 'ingestion:manage', 'ingestion:run', ...extraPermissions], deny: mocks.invalidate };
}
function previewView(history = false, viewJobs = vi.fn()) {
  componentView(<ImportPreview scope={verifiedScope()} rule={rule} history={history} canReceipts close={vi.fn()} viewJobs={viewJobs} />);
  return within(screen.getByRole('dialog', { name: `${history ? '历史批量导入' : '单条试处理'} · ${rule.name}` }));
}
function editorView(existing = rule) {
  componentView(<RuleEditor scope={verifiedScope(existing.target === 'COMPONENT' ? ['material-master:read'] : [])} rule={existing} endpoints={[{ id: endpointId, name: '供应商接收', code: 'SUP', status: 'ENABLED' }]} endpointsLoading={false} close={vi.fn()} saved={vi.fn()} />);
  return within(screen.getByRole('dialog', { name: '编辑入库规则' }));
}
function jobsView() {
  return componentView(<JobList scope={verifiedScope()} endpoints={[{ id: endpointId, name: '供应商接收', code: 'SUP', status: 'ENABLED' }]} canReceipts clearReceipt={vi.fn()} />);
}
function pageTab(name: string) { return screen.getByText(name, { selector: '[role="tab"]' }); }
function OtherDraft() { useUnsavedChanges(true); return null; }
function resultsView(initialEntry: string, otherDraft = false) {
  vi.stubGlobal('AbortController', function () { return transferableAbortController(); });
  const router = createMemoryRouter([{ path: '*', element: <UnsavedChangesProvider><ApiIngestionPage />{otherDraft && <OtherDraft />}</UnsavedChangesProvider> }], { initialEntries: [initialEntry] });
  render(<LanguageProvider><ConsoleTheme><RouterProvider router={router} /></ConsoleTheme></LanguageProvider>); return router;
}
beforeEach(() => {
  vi.stubEnv('NODE_ENV', 'development'); vi.clearAllMocks(); read.mockReset(); mocks.mutate.mockReset(); mocks.context = context(); localStorage.clear();
  useWorkTabsStore.getState().bindSession(`INTERNAL:${homeId}:${actorId}`);
  read.mockImplementation(async path => {
    if (path.includes('/ingestion/endpoints')) return { items: [{ id: endpointId, name: '供应商接收', code: 'SUP', status: 'ENABLED' }], total: 1, page: 1, limit: 100 } as never;
    if (path.includes('/ingestion/rules')) return { items: [rule], total: 1, page: 1, limit: 20 } as never;
    if (path.includes('/receipts?')) return { items: [{ id: receiptId, organizationId: homeId, endpointId, endpointName: '供应商接收', messageId: 'MSG001', receivedAt: '2026-11-14T02:00:00Z', bodyAvailable: true }], total: 1, page: 1, limit: 20 } as never;
    return { items: [], total: 0, page: 1, limit: 20 } as never;
  });
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); localStorage.clear(); });
it('binds operation code and name and updates only the name on repeat ingestion', async () => {
  mocks.mutate.mockResolvedValue({});
  const dialog = editorView({ ...rule, target: 'OPERATION', mapping: { operationCode: 'step.code', operationName: 'step.name' }, mode: 'UPDATE', updateFields: ['operationName'] } as Rule);
  expect(dialog.getByLabelText('工序编码来源字段')).toHaveValue('step.code');
  fireEvent.change(dialog.getByLabelText('工序名称来源字段'), { target: { value: 'step.label' } });
  expect(dialog.queryByLabelText('板块名称来源字段')).not.toBeInTheDocument();
  fireEvent.click(dialog.getByRole('button', { name: /^保\s*存$/ }));
  await waitFor(() => expect(mocks.mutate).toHaveBeenCalled());
  expect(mocks.mutate.mock.calls[0][2]).toMatchObject({ target: 'OPERATION', mapping: { operationCode: 'step.code', operationName: 'step.label' }, mode: 'UPDATE', updateFields: ['operationName'] });
});
it('edits process source fields and ordered description composition without exposing derived update fields', async () => {
  mocks.mutate.mockResolvedValue({});
  const processRule = { ...rule, target: 'PROCESS_DEFECT', mapping: { productCode: 'product', traceCode: 'barcode' }, updateFields: ['description'], sourceTimezone: 'Asia/Shanghai', descriptionComposition: { fields: [{ path: 'fault', label: '现象' }, { path: 'position', label: '位置' }], separator: '\n' } } as Rule;
  const dialog = editorView(processRule);
  expect(dialog.getByLabelText('成品编码来源字段')).toHaveValue('product');
  expect(dialog.queryByLabelText('编码来源字段')).not.toBeInTheDocument();
  expect(dialog.getByLabelText('描述来源字段1')).toHaveValue('fault');
  expect(dialog.getByLabelText('描述标签2')).toHaveValue('位置');
  expect(dialog.getByRole('switch', { name: 'AI整理' })).not.toBeChecked();
  fireEvent.change(dialog.getByLabelText('提示词变量2'), { target: { value: 'position' } });
  const factory = dialog.getByLabelText('工厂来源字段');
  expect(factory).toHaveValue('');
  expect(dialog.getByText(/1 → 一工厂；2 → 二工厂/)).toBeInTheDocument();
  fireEvent.change(factory, { target: { value: '   ' } });
  fireEvent.click(dialog.getByRole('button', { name: /^保\s*存$/ }));
  await dialog.findByText('请填写工厂来源字段');
  expect(mocks.mutate).not.toHaveBeenCalled();
  fireEvent.change(factory, { target: { value: ' source.plant ' } });
  fireEvent.click(dialog.getByRole('checkbox', { name: '工厂' }));
  expect(dialog.queryByLabelText('班次')).not.toBeInTheDocument();
  fireEvent.click(dialog.getByRole('button', { name: '下移描述字段1' }));
  fireEvent.click(dialog.getByRole('button', { name: /^保\s*存$/ }));
  await waitFor(() => expect(mocks.mutate).toHaveBeenCalled());
  expect(mocks.mutate.mock.calls[0][2]).toMatchObject({ target: 'PROCESS_DEFECT', mapping: { productCode: 'product', traceCode: 'barcode', factoryCode: 'source.plant' }, updateFields: ['factoryCode', 'description'], descriptionComposition: { fields: [{ path: 'position', label: '位置', variable: 'position' }, { path: 'fault', label: '现象' }], separator: '\n' }, sourceTimezone: 'Asia/Shanghai' });
  expect(mocks.mutate.mock.calls[0][2].mapping).not.toHaveProperty('code');
  expect(mocks.mutate.mock.calls[0][2]).not.toHaveProperty('aiApplication');
});
it('configures component names from the internal material master snapshot', async () => {
  mocks.mutate.mockResolvedValue({});
  const componentRule = { ...rule, name: '组件规则', target: 'COMPONENT', mapping: { code: 'partCode' }, componentNameLookup: { source: 'MATERIAL', field: 'materialName' } } as Rule;
  const dialog = editorView(componentRule);
  expect(dialog.queryByLabelText('工厂来源字段')).not.toBeInTheDocument();
  expect(dialog.getByRole('combobox', { name: '名称来源方式' })).toBeInTheDocument();
  await waitFor(() => expect(dialog.getByText('内部物料主数据', { selector: '.ant-select-content' })).toBeVisible());
  expect(dialog.getByText('物料名称', { selector: '.ant-select-content' })).toBeVisible();
  fireEvent.click(dialog.getByRole('button', { name: /^保\s*存$/ }));
  await waitFor(() => expect(mocks.mutate).toHaveBeenCalled());
  expect(mocks.mutate.mock.calls[0][2]).toMatchObject({ target: 'COMPONENT', mapping: { code: 'partCode' }, componentNameLookup: { source: 'MATERIAL', field: 'materialName' } });
  expect(mocks.mutate.mock.calls[0][2].mapping).not.toHaveProperty('name');
});
it('previews incomplete process facts as an importable ledger result and shows safe plain text', async () => {
  mocks.mutate.mockResolvedValueOnce({ previewId: 'preview-process', receiptCount: 1, rowCount: 1, expiresAt: '2099-11-14T03:00:00Z', action: 'INSERTED', fields: { description: '<b>松脱</b>\n位置：0 / false' }, differences: [], pendingCompletion: true, pendingConfiguration: true, registrationIssues: ['OCCURRED_AT_REQUIRED'], defectQuantity: 1 });
  componentView(<ImportPreview scope={verifiedScope()} rule={{ ...rule, target: 'PROCESS_DEFECT' } as Rule} history canReceipts close={vi.fn()} />);
  const dialog = within(screen.getByRole('dialog'));
  fireEvent.change(dialog.getByLabelText('接收时间起'), { target: { value: '2026-11-01T00:00' } });
  fireEvent.change(dialog.getByLabelText('接收时间止'), { target: { value: '2026-11-13T12:00' } });
  fireEvent.click(dialog.getByRole('button', { name: '生成预览' }));
  const preview = within(await dialog.findByRole('region', { name: '入库预览' }));
  await waitFor(() => expect(preview.getByText('待完善')).toBeVisible());
  expect(preview.getByText('待补配')).toBeVisible();
  expect(preview.getByText('不良数量: 1')).toBeVisible();
  expect(preview.getByText(/<b>松脱<\/b>/)).toBeVisible();
  expect(preview.getByRole('button', { name: '确认导入' })).toBeEnabled();
});
it.each([
  ['FACTORY_1', [], '一工厂', undefined],
  ['FACTORY_2', [], '二工厂', undefined],
  [null, ['factory:EMPTY'], '/', '工厂来源值为空'],
  [null, ['factory:INVALID'], '/', '工厂来源值无效'],
] as const)('previews factory %s as an importable result (%j)', async (factoryCode, registrationIssues, factoryLabel, issue) => {
  mocks.mutate.mockResolvedValueOnce({ previewId: 'preview-factory', receiptCount: 1, rowCount: 1, expiresAt: '2099-11-14T03:00:00Z', action: 'INSERTED', fields: { factoryCode }, differences: [], pendingCompletion: !!issue, registrationIssues });
  componentView(<ImportPreview scope={verifiedScope()} rule={{ ...rule, target: 'PROCESS_DEFECT', mapping: { factoryCode: 'source.plant' } }} history={false} canReceipts close={vi.fn()} />);
  const dialog = within(screen.getByRole('dialog'));
  fireEvent.mouseDown(dialog.getByRole('combobox', { name: '接收记录' }));
  fireEvent.click(await screen.findByText(/MSG001/, { selector: '.ant-select-item-option-content' }));
  fireEvent.click(dialog.getByRole('button', { name: '生成预览' }));
  const preview = within(await dialog.findByRole('region', { name: '入库预览' }));
  expect(preview.getByText('工厂').closest('tr')?.querySelector('td')).toHaveTextContent(factoryLabel);
  if (issue) await waitFor(() => expect(preview.getByText(issue)).toBeVisible());
  expect(preview.queryByText('该行未通过校验')).not.toBeInTheDocument();
  expect(preview.getByRole('button', { name: '确认导入' })).toBeEnabled();
});
it('requires the scoped ingestion capability even for a platform administrator', () => {
  mocks.context = { ...context(), modules: [] }; view();
  expect(screen.getByRole('alert')).toHaveTextContent('无权访问API入库衔接'); expect(read).not.toHaveBeenCalled();
});
it('shows named endpoints and keeps mutation controls absent for readers', async () => {
  mocks.context = context(['ingestion:read']); view(); await screen.findByText('供应商规则');
  expect(screen.getByText('供应商接收')).toBeVisible(); expect(screen.queryByRole('button', { name: '新增规则' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '单条试处理' })).not.toBeInTheDocument();
});
it.each([homeId, endpointId, undefined])('allows a first AI binding only with prompt read access for target organization (%s)', async permissionOrg => {
  const processRule: Rule = { ...rule, name: '制程规则', target: 'PROCESS_DEFECT', mapping: { traceCode: 'barcode' }, mode: 'INSERT_ONLY', updateFields: [], descriptionComposition: { fields: [{ path: 'BAD_ITEM_NAME', variable: 'fault' }], separator: '\n' } };
  if (permissionOrg) mocks.context.modules.push({ key: 'ai-applications', scope: 'TARGET', coverage: 'ORGANIZATION', organizationId: permissionOrg, permissions: ['ai:applications:read'] });
  const baselineRead = read.getMockImplementation()!;
  read.mockImplementation(async (path, ...options) => {
    if (path.includes('/ingestion/rules')) return { items: [processRule], total: 1, page: 1, limit: 20 } as never;
    return baselineRead(path, ...options);
  });
  view();
  fireEvent.click(await screen.findByLabelText('编辑制程规则'));
  const toggle = screen.getByLabelText('AI整理');
  if (permissionOrg !== homeId) {
    expect(toggle).toBeDisabled();
    fireEvent.click(toggle);
    expect(read.mock.calls.some(([path]) => path.includes('/ai-applications'))).toBe(false);
    return;
  }
  expect(toggle).toBeEnabled();
  fireEvent.click(toggle);
  expect(await screen.findByLabelText('提示词应用')).toBeEnabled();
  expect(read.mock.calls.some(([path]) => path.includes('/ai-applications') && path.includes(`organizationId=${homeId}`))).toBe(true);
});
it('projects material master read permission into the component rule editor', async () => {
  const componentRule = { ...rule, name: '组件规则', target: 'COMPONENT', mapping: { code: 'partCode', name: 'name' } } as Rule;
  mocks.context = context(['ingestion:read', 'ingestion:manage', 'ingestion:run'], ['material-master:read']);
  read.mockImplementation(async path => {
    if (path.includes('/ingestion/rules')) return { items: [componentRule], total: 1, page: 1, limit: 20 } as never;
    if (path.includes('/ingestion/endpoints')) return { items: [{ id: endpointId, name: '供应商接收', code: 'SUP', status: 'ENABLED' }], total: 1, page: 1, limit: 100 } as never;
    return { items: [], total: 0, page: 1, limit: 20 } as never;
  });
  view();
  const row = (await screen.findByText('组件规则')).closest('tr')!;
  fireEvent.click(within(row).getByRole('button', { name: '编辑组件规则' }));
  const dialog = within(await screen.findByRole('dialog', { name: '编辑入库规则' }));
  fireEvent.mouseDown(dialog.getByRole('combobox', { name: '名称来源方式' }));
  const option = await screen.findByText('内部物料主数据', { selector: '.ant-select-item-option-content' });
  expect(option.closest('.ant-select-item-option')).not.toHaveAttribute('aria-disabled', 'true');
});
it('opens receipt-linked processing jobs and clears the controlled receipt filter', async () => {
  view(`/console/api-ingestion?receiptId=${receiptId}`);
  await waitFor(() => expect(read.mock.calls.some(call => call[0].includes('/ingestion/jobs?') && new URL(call[0], 'http://localhost').searchParams.get('receiptId') === receiptId)).toBe(true));
  const selectedTab = pageTab('处理任务');
  expect(selectedTab).toHaveAttribute('aria-selected', 'true');
  const jobs = within(document.getElementById(selectedTab.getAttribute('aria-controls')!)!);
  fireEvent.click(jobs.getByRole('button', { name: '清除接收记录筛选' })); await screen.findByText('供应商规则');
  expect(jobs.queryByRole('button', { name: '清除接收记录筛选' })).not.toBeInTheDocument();
  fireEvent.click(pageTab('处理任务'));
  await waitFor(() => expect(read.mock.calls.some(call => call[0].includes('/ingestion/jobs?') && !new URL(call[0], 'http://localhost').searchParams.has('receiptId'))).toBe(true));
});
it.each(['not-a-receipt', `${receiptId}&receiptId=${receiptId}`])('refuses an invalid or ambiguous receipt filter %s', value => {
  view(`/console/api-ingestion?receiptId=${value}`); expect(screen.getByRole('alert')).toHaveTextContent('接收记录筛选无效'); expect(read).not.toHaveBeenCalled();
});
it('retires late private results across an A to B to A session change', async () => {
  let resolve!: (value: unknown) => void;
  read.mockReturnValue(new Promise(done => { resolve = done; })); view();
  act(() => { useWorkTabsStore.getState().bindSession(`INTERNAL:${homeId}:other`); useWorkTabsStore.getState().bindSession(`INTERNAL:${homeId}:${actorId}`); });
  await act(async () => resolve({ items: [rule], total: 1, page: 1, limit: 20 }));
  expect(screen.queryByText('供应商规则')).not.toBeInTheDocument(); expect(mocks.invalidate).toHaveBeenCalled();
});
it('previews a selected receipt without submitting an import until explicit confirmation', async () => {
  mocks.mutate.mockResolvedValue({ previewId: 'preview-one', receiptCount: 1, rowCount: 1, expiresAt: '2099-11-14T03:00:00Z', action: 'INSERTED', fields: { code: '001', name: '供应商' }, differences: [] });
  const dialog = previewView();
  fireEvent.mouseDown(dialog.getByRole('combobox', { name: '接收记录' })); fireEvent.click(await screen.findByText(/MSG001/, { selector: '.ant-select-item-option-content' }));
  fireEvent.click(dialog.getByRole('button', { name: '生成预览' }));
  await dialog.findByText('001'); expect(mocks.mutate).toHaveBeenCalledTimes(1);
  expect(mocks.mutate.mock.calls[0]?.slice(0, 3)).toEqual(['/api/v1/admin/integrations/ingestion/preview', 'POST', { organizationId: homeId, ruleId, ruleVersion: 2, receiptId, rowIndex: 0 }]);
  expect(mocks.mutate.mock.calls.some(call => call[0].endsWith('/imports'))).toBe(false);
  mocks.mutate.mockResolvedValueOnce({ jobIds: ['job-one'], reused: false, receiptCount: 1, rowCount: 1 });
  fireEvent.click(dialog.getByRole('button', { name: '确认导入' })); await dialog.findByText(/已提交/);
  expect(mocks.mutate.mock.calls[1]?.[2]).toEqual({ organizationId: homeId, previewId: 'preview-one', confirmed: true });
});
it.each([
  { materialMatched: true, targetId: undefined, status: '物料已匹配' },
  { materialMatched: false, targetId: undefined, status: '物料未匹配，名称将留空' },
  { materialMatched: false, targetId: '66666666-6666-4666-8666-666666666666', status: '物料未匹配，保留已有名称' },
])('shows the material name source status without treating an unmatched item as a failure ($status)', async ({ materialMatched, targetId, status }) => {
  mocks.mutate.mockResolvedValueOnce({ previewId: 'preview-component', receiptCount: 1, rowCount: 1, expiresAt: '2099-11-14T03:00:00Z', action: 'INSERTED', fields: { code: '00042', name: materialMatched ? '控制器A' : targetId ? '人工名称' : '' }, differences: [], materialMatched, ...(targetId ? { targetId } : {}), materialNameSource: 'MATERIAL_MASTER' });
  const componentRule = { ...rule, name: '组件规则', target: 'COMPONENT', mapping: { code: 'partCode' }, componentNameLookup: { source: 'MATERIAL', field: 'materialName' } } as Rule;
  componentView(<ImportPreview scope={verifiedScope()} rule={componentRule} history={false} canReceipts close={vi.fn()} />);
  const dialog = within(screen.getByRole('dialog', { name: `单条试处理 · ${componentRule.name}` }));
  fireEvent.mouseDown(dialog.getByRole('combobox', { name: '接收记录' })); fireEvent.click(await screen.findByText(/MSG001/, { selector: '.ant-select-item-option-content' }));
  fireEvent.click(dialog.getByRole('button', { name: '生成预览' }));
  const source = within(await dialog.findByRole('region', { name: '名称来源' }));
  await waitFor(() => {
    expect(source.getByText('名称来源：内部物料主数据')).toBeVisible();
    expect(source.getByText(status)).toBeVisible();
  });
  expect(dialog.getByRole('button', { name: '确认导入' })).toBeEnabled();
  expect(dialog.queryByRole('alert')).not.toBeInTheDocument();
});
it('keeps a failed preview editable and retries the changed preview request', async () => {
  const failure = new ApiError({ code: 'HTTP_502', message: 'Unknown', fields: {}, traceId: 'trace' }, 502);
  mocks.mutate.mockRejectedValueOnce(failure).mockResolvedValueOnce({ previewId: 'preview-retry', receiptCount: 1, rowCount: 1, expiresAt: '2099-11-14T03:00:00Z', action: 'INSERTED', fields: { code: '002' }, differences: [] });
  const dialog = previewView(true);
  fireEvent.change(dialog.getByLabelText('接收时间起'), { target: { value: '2026-11-01T00:00' } }); fireEvent.change(dialog.getByLabelText('接收时间止'), { target: { value: '2026-11-13T12:00' } });
  fireEvent.click(dialog.getByRole('button', { name: '生成预览' })); await dialog.findByRole('alert');
  expect(dialog.getByLabelText('接收时间起')).toBeEnabled(); expect(dialog.getByRole('button', { name: /^关\s+闭$/ })).toBeEnabled();
  fireEvent.change(dialog.getByLabelText('接收时间止'), { target: { value: '2026-11-13T13:00' } }); fireEvent.click(dialog.getByRole('button', { name: '生成预览' }));
  await dialog.findByText('002'); expect(mocks.mutate.mock.calls[1]?.[2]).toMatchObject({ to: new Date('2026-11-13T13:00').toISOString() });
});
it('confirms a historical receipt snapshot while its row count is still being counted in the background', async () => {
  mocks.mutate.mockResolvedValueOnce({ previewId: 'preview-counting', receiptCount: 101, rowCount: null, expiresAt: '2099-11-14T03:00:00Z' }).mockResolvedValueOnce({ jobIds: ['job-counting'], reused: false, receiptCount: 101, rowCount: null });
  const dialog = previewView(true);
  fireEvent.change(dialog.getByLabelText('接收时间起'), { target: { value: '2026-11-01T00:00' } }); fireEvent.change(dialog.getByLabelText('接收时间止'), { target: { value: '2026-11-13T12:00' } });
  fireEvent.click(dialog.getByRole('button', { name: '生成预览' }));
  const preview = within(await dialog.findByRole('region', { name: '入库预览' }));
  await waitFor(() => expect(preview.getByText('数据条数: 后台统计')).toBeVisible()); expect(preview.getByText('接收份数: 101')).toBeVisible(); expect(preview.getByRole('button', { name: '确认导入' })).toBeEnabled();
  fireEvent.click(preview.getByRole('button', { name: '确认导入' }));
  const submitted = await dialog.findByRole('status'); expect(submitted).toHaveTextContent('数据条数: 后台统计'); expect(submitted).toHaveTextContent('任务数: 1');
  expect(mocks.mutate.mock.calls[1]?.[2]).toEqual({ organizationId: homeId, previewId: 'preview-counting', confirmed: true });
});
it('keeps a historical preview with no matching receipts unavailable for confirmation', async () => {
  mocks.mutate.mockResolvedValueOnce({ previewId: 'preview-empty', receiptCount: 0, rowCount: null, expiresAt: '2099-11-14T03:00:00Z' });
  const dialog = previewView(true);
  fireEvent.change(dialog.getByLabelText('接收时间起'), { target: { value: '2026-11-01T00:00' } }); fireEvent.change(dialog.getByLabelText('接收时间止'), { target: { value: '2026-11-13T12:00' } });
  fireEvent.click(dialog.getByRole('button', { name: '生成预览' }));
  expect(await dialog.findByRole('button', { name: '确认导入' })).toBeDisabled(); expect(mocks.mutate).toHaveBeenCalledTimes(1);
});
it('lets a single preview close after a failed request while keeping an in-flight request protected', async () => {
  let reject!: (cause: unknown) => void; const close = vi.fn();
  mocks.mutate.mockImplementationOnce(() => new Promise((_, fail) => { reject = fail; }));
  componentView(<ImportPreview scope={verifiedScope()} rule={rule} history={false} canReceipts close={close} />);
  const dialog = within(screen.getByRole('dialog', { name: `单条试处理 · ${rule.name}` }));
  fireEvent.mouseDown(dialog.getByRole('combobox', { name: '接收记录' })); fireEvent.click(await screen.findByText(/MSG001/, { selector: '.ant-select-item-option-content' }));
  fireEvent.click(dialog.getByRole('button', { name: '生成预览' })); await waitFor(() => expect(mocks.mutate).toHaveBeenCalledTimes(1)); expect(dialog.getByRole('button', { name: /^关\s+闭$/ })).toBeDisabled();
  await act(async () => reject(new ApiError({ code: 'HTTP_502', message: 'Unknown', fields: {}, traceId: 'trace' }, 502)));
  expect(dialog.getByRole('button', { name: /^关\s+闭$/ })).toBeEnabled(); fireEvent.click(dialog.getByRole('button', { name: /^关\s+闭$/ }));
  fireEvent.click(await screen.findByRole('button', { name: '放弃修改并关闭' })); expect(close).toHaveBeenCalledTimes(1); expect(mocks.mutate).toHaveBeenCalledTimes(1);
});
it('offers a safe task-list exit after an unknown submit without clearing its retry state', async () => {
  const failure = new ApiError({ code: 'HTTP_502', message: 'Unknown', fields: {}, traceId: 'trace' }, 502); const viewJobs = vi.fn(); let reject!: (cause: unknown) => void;
  mocks.mutate.mockResolvedValueOnce({ previewId: 'preview-exit', receiptCount: 1, rowCount: 1, expiresAt: '2099-11-14T03:00:00Z' }).mockRejectedValueOnce(failure).mockImplementationOnce(() => new Promise((_, fail) => { reject = fail; }));
  const dialog = previewView(true, viewJobs);
  fireEvent.change(dialog.getByLabelText('接收时间起'), { target: { value: '2026-11-01T00:00' } }); fireEvent.change(dialog.getByLabelText('接收时间止'), { target: { value: '2026-11-13T12:00' } });
  fireEvent.click(dialog.getByRole('button', { name: '生成预览' })); await dialog.findByRole('button', { name: '确认导入' }); fireEvent.click(dialog.getByRole('button', { name: '确认导入' }));
  const exit = await dialog.findByRole('button', { name: '关闭并查看处理任务' }); expect(exit).toBeEnabled(); expect(dialog.getByRole('alert')).toHaveTextContent('可能已经提交');
  fireEvent.click(dialog.getByRole('button', { name: '重试原请求' })); await waitFor(() => expect(mocks.mutate).toHaveBeenCalledTimes(3)); expect(exit).toBeDisabled(); fireEvent.click(exit); expect(viewJobs).not.toHaveBeenCalled();
  await act(async () => reject(failure)); expect(exit).toBeEnabled(); fireEvent.click(exit); expect(viewJobs).toHaveBeenCalledTimes(1); expect(mocks.mutate.mock.calls[2]?.slice(0, 3)).toEqual(mocks.mutate.mock.calls[1]?.slice(0, 3));
});
it.each([
  { outcome: 'success', receiptFilter: false, otherDraft: false }, { outcome: 'unknown', receiptFilter: false, otherDraft: false },
  { outcome: 'success', receiptFilter: true, otherDraft: false }, { outcome: 'unknown', receiptFilter: true, otherDraft: false },
  { outcome: 'unknown', receiptFilter: false, otherDraft: true },
])('opens fresh jobs after $outcome import, old receiving filter=$receiptFilter, other draft=$otherDraft', async ({ outcome, receiptFilter, otherDraft }) => {
  const job = { id: '66666666-6666-4666-8666-666666666666', endpointId, receiptId: '99999999-9999-4999-8999-999999999999', ruleId, ruleVersion: 2, target: 'SUPPLIER', source: 'HISTORY', status: 'PENDING', sequence: 1, total: 1, pending: 1, succeeded: 0, skipped: 0, failed: 0, awaitingConfirmation: 0, errorCode: null, createdAt: '2026-11-14T02:00:00Z' };
  let resolveOldReceipt!: (page: unknown) => void;
  const original = read.getMockImplementation()!;
  read.mockImplementation(async (path, ...args) => {
    if (path.includes('/ingestion/jobs?')) return new URL(path, 'http://localhost').searchParams.has('receiptId') ? new Promise(done => { resolveOldReceipt = done; }) as never : { items: [job], total: 1, page: 1, limit: 20 } as never;
    return original(path, ...args);
  });
  mocks.mutate.mockResolvedValueOnce({ previewId: 'preview-tasks', receiptCount: 1, rowCount: 1, expiresAt: '2099-11-14T03:00:00Z' });
  if (outcome === 'success') mocks.mutate.mockResolvedValueOnce({ jobIds: [job.id], reused: false, receiptCount: 1, rowCount: 1 });
  else mocks.mutate.mockRejectedValueOnce(new ApiError({ code: 'HTTP_502', message: 'Unknown', fields: {}, traceId: 'trace' }, 502));
  const router = resultsView(`/console/api-ingestion${receiptFilter ? `?receiptId=${receiptId}` : ''}`, otherDraft);
  if (receiptFilter) { await waitFor(() => expect(read.mock.calls.some(call => call[0].includes('/ingestion/jobs?') && new URL(call[0], 'http://localhost').searchParams.get('receiptId') === receiptId)).toBe(true)); fireEvent.click(pageTab('规则')); expect(router.state.location.search).toBe(`?receiptId=${receiptId}`); }
  const row = (await screen.findByText('供应商规则')).closest('tr')!; fireEvent.click(within(row).getByText('历史批量导入', { selector: 'button span' }));
  const dialog = within(screen.getByRole('dialog', { name: `历史批量导入 · ${rule.name}` }));
  fireEvent.change(dialog.getByLabelText('接收时间起'), { target: { value: '2026-11-01T00:00' } }); fireEvent.change(dialog.getByLabelText('接收时间止'), { target: { value: '2026-11-13T12:00' } });
  fireEvent.click(dialog.getByText('生成预览', { selector: 'button span' })); fireEvent.click(await dialog.findByText('确认导入', { selector: 'button span' }));
  fireEvent.click(await dialog.findByText(outcome === 'success' ? '查看处理任务' : '关闭并查看处理任务', { selector: 'button span' }));
  if (otherDraft) { const discard = await screen.findByText('放弃修改', { selector: 'button span' }); expect(pageTab('规则')).toHaveAttribute('aria-selected', 'true'); expect(read.mock.calls.some(call => call[0].includes('/ingestion/jobs?'))).toBe(false); fireEvent.click(discard); }
  await waitFor(() => expect(router.state.location.search).toBe('')); await screen.findByLabelText('查看任务1'); expect(pageTab('处理任务')).toHaveAttribute('aria-selected', 'true'); await waitFor(() => expect(screen.queryByText(`历史批量导入 · ${rule.name}`)).not.toBeInTheDocument());
  const jobsReads = read.mock.calls.filter(call => call[0].includes('/ingestion/jobs?')); expect(new URL(jobsReads.at(-1)![0], 'http://localhost').searchParams.has('receiptId')).toBe(false); expect(mocks.mutate).toHaveBeenCalledTimes(2);
  if (receiptFilter) { await act(async () => resolveOldReceipt({ items: [{ ...job, id: 'old-job', receiptId, sequence: 99 }], total: 1, page: 1, limit: 20 })); expect(screen.queryByLabelText('查看任务99')).not.toBeInTheDocument(); expect(screen.getByLabelText('查看任务1')).toBeVisible(); }
  if (!otherDraft) { fireEvent.click(pageTab('规则')); await screen.findByText('供应商规则'); expect(pageTab('规则')).toHaveAttribute('aria-selected', 'true'); }
});
it.each([
  ['INGESTION_HISTORY_LIMIT_EXCEEDED', 422, '请重新生成历史预览'],
  ['INGESTION_PREVIEW_LIMIT_EXCEEDED', 429, '临时预览已达上限，请稍后重试'],
] as const)('explains the controlled %s failure without locking preview inputs', async (code, status, message) => {
  mocks.mutate.mockRejectedValueOnce(new ApiError({ code, message: 'Limit', fields: {}, traceId: 'trace' }, status));
  const dialog = previewView(true); fireEvent.change(dialog.getByLabelText('接收时间起'), { target: { value: '2026-11-01T00:00' } }); fireEvent.change(dialog.getByLabelText('接收时间止'), { target: { value: '2026-11-13T12:00' } }); fireEvent.click(dialog.getByRole('button', { name: '生成预览' }));
  await dialog.findByText(message); expect(dialog.getByLabelText('接收时间起')).toBeEnabled(); expect(dialog.getByRole('button', { name: /^关\s+闭$/ })).toBeEnabled();
});
it.each([
  ['INGESTION_HISTORY_LIMIT_EXCEEDED', 'Generate a new historical preview.'],
  ['INGESTION_PREVIEW_LIMIT_EXCEEDED', 'Temporary preview capacity is full. Retry later.'],
] as const)('explains the controlled %s failure in English', (code, message) => {
  localStorage.setItem('qms:locale:v1', 'en-US'); componentView(<IngestionError error={new ApiError({ code, message: 'Limit', fields: {}, traceId: 'trace' }, 429)} />);
  expect(screen.getByRole('alert')).toHaveTextContent(message); expect(screen.getByRole('alert')).toHaveTextContent(code);
});
it.each([
  ['INGESTION_FIELD_TYPE', '来源字段类型与规则不符', 'A source field has an unexpected type'],
  ['PROCESS_DEFECT_EXTERNAL_IDENTITY_CONFLICT', '来源明细编号已关联其他不良记录', 'The source detail ID is linked to another defect record'],
  ['INGESTION_NOT_FOUND', '入库记录不存在或不可访问', 'The ingestion record does not exist or is unavailable'],
  ['AI_APPLICATION_NOT_FOUND', '提示词应用或已发布版本不存在', 'The prompt application or its published revision does not exist'],
  ['AI_CONNECTION_TIMEOUT', 'AI 服务请求超时', 'The AI service request timed out'],
] as const)('uses the same bilingual catalog for persisted and request code %s', (code, zh, en) => {
  localStorage.setItem('qms:locale:v1', 'en-US');
  componentView(<><div>{ingestionIssue(code, false)}</div><IngestionError error={new ApiError({ code, message: 'private server diagnostic' }, 400)} /></>);
  expect(screen.getByText(zh)).toBeVisible();
  expect(screen.getByRole('alert')).toHaveTextContent(en);
  expect(screen.getByRole('alert')).toHaveTextContent(code);
  expect(screen.queryByText('private server diagnostic')).not.toBeInTheDocument();
});
it('shows request field names and a trace ID without disclosing field values or unsafe metadata', () => {
  const traceId = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
  const fields = { 'conditions[0].path': ['private value'], api_token: ['private token'], 'payload=private-data': ['private payload'] };
  componentView(<IngestionError error={new ApiError({ code: 'INGESTION_RULE_INVALID', message: 'private server diagnostic', fields, traceId }, 400)} />);
  const alert = screen.getByRole('alert');
  expect(alert).toHaveTextContent('conditions[0].path');
  expect(alert).toHaveTextContent(traceId);
  expect(alert).not.toHaveTextContent(/private|api_token/);
});
it.each([
  { error: new ApiError({ code: 'constructor', message: 'private diagnostic', traceId: 'private-trace' }, 409), reason: '配置或档案已变化', status: 'HTTP_409' },
  { error: new ApiError({ code: 'UNRECOGNIZED_PRIVATE_CODE', message: 'private diagnostic', fields: { privateKeyName: ['private value'] } }, 502), reason: '服务暂时不可用', status: 'HTTP_502' },
  { error: new TypeError('Failed to fetch: private diagnostic'), reason: '请检查网络连接' },
  { error: new SyntaxError('private diagnostic'), reason: '无法确定请求失败原因' },
])('uses a safe fallback for $reason', ({ error, reason, status }) => {
  componentView(<IngestionError error={error} />);
  const alert = screen.getByRole('alert');
  expect(alert).toHaveTextContent(reason);
  if (status) expect(alert).toHaveTextContent(status);
  expect(alert).not.toHaveTextContent(/private|constructor/i);
});
it('keeps the unknown import recovery wording ahead of transport diagnostics', () => {
  componentView(<IngestionError unknown unknownTitle="请核对处理任务后再导入" error={new ApiError({ code: 'HTTP_504', message: 'private diagnostic' }, 504)} />);
  const alert = screen.getByRole('alert');
  expect(alert).toHaveTextContent('请核对处理任务后再导入');
  expect(alert).toHaveTextContent('HTTP_504');
  expect(alert).not.toHaveTextContent('private diagnostic');
});
it('explains an AI timeout returned in a successful trial response and retains the direct fallback', async () => {
  const processRule = { ...rule, target: 'PROCESS_DEFECT', aiDescription: { connectionId: 'ai-1', prompt: '整理事实' } } as Rule;
  mocks.mutate.mockResolvedValueOnce({ previewId: 'preview', receiptCount: 1, rowCount: 1, expiresAt: '2099-11-16T00:00:00Z', action: 'INSERTED', fields: { description: '直接组合结果' }, differences: [] })
    .mockResolvedValueOnce({ directDescription: '直接组合结果', inputFields: [], aiDescription: null, status: 'FAILED', errorCode: 'AI_CONNECTION_TIMEOUT', message: 'private provider diagnostic' });
  componentView(<ImportPreview scope={verifiedScope()} rule={processRule} history={false} canReceipts close={vi.fn()} />);
  const dialog = within(screen.getByRole('dialog'));
  fireEvent.mouseDown(dialog.getByRole('combobox', { name: '接收记录' }));
  fireEvent.click(await screen.findByText(/MSG001/, { selector: '.ant-select-item-option-content' }));
  fireEvent.click(dialog.getByRole('button', { name: '生成预览' }));
  const preview = within(await dialog.findByRole('region', { name: '入库预览' }));
  fireEvent.click(preview.getByRole('button', { name: '试运行AI整理' }));
  await dialog.findByText('AI 服务请求超时');
  expect(dialog.getByText('AI_CONNECTION_TIMEOUT')).toBeVisible();
  expect(within(dialog.getByRole('region', { name: '描述试运行结果' })).getByText('直接组合结果')).toBeVisible();
  expect(dialog.queryByText('private provider diagnostic')).not.toBeInTheDocument();
  expect(preview.getByRole('button', { name: '确认导入' })).toBeEnabled();
});
it.each([502, 408, 425])('freezes an unknown import command across repeated %s outcomes', async status => {
  const failure = new ApiError({ code: `HTTP_${status}`, message: 'Unknown', fields: {}, traceId: 'trace' }, status);
  mocks.mutate.mockResolvedValueOnce({ previewId: 'preview-frozen', receiptCount: 1, rowCount: 1, expiresAt: '2099-11-14T03:00:00Z' }).mockRejectedValueOnce(failure).mockRejectedValueOnce(failure).mockResolvedValueOnce({ jobIds: [], reused: true, receiptCount: 1, rowCount: 1 });
  const dialog = previewView(true);
  fireEvent.change(dialog.getByLabelText('接收时间起'), { target: { value: '2026-11-01T00:00' } }); fireEvent.change(dialog.getByLabelText('接收时间止'), { target: { value: '2026-11-13T12:00' } });
  fireEvent.click(dialog.getByRole('button', { name: '生成预览' })); await dialog.findByRole('button', { name: '确认导入' });
  fireEvent.click(dialog.getByRole('button', { name: '确认导入' })); const retry = await dialog.findByRole('button', { name: '重试原请求' });
  expect(dialog.getByLabelText('接收时间起')).toBeDisabled(); expect(dialog.getByRole('button', { name: /^关\s+闭$/ })).toBeDisabled(); expect(dialog.getByRole('button', { name: '生成预览' })).toBeDisabled();
  fireEvent.click(retry); await waitFor(() => expect(mocks.mutate).toHaveBeenCalledTimes(3));
  await waitFor(() => expect(dialog.getByRole('button', { name: '重试原请求' })).not.toHaveClass('ant-btn-loading'));
  expect(dialog.getByLabelText('接收时间起')).toBeDisabled(); fireEvent.click(dialog.getByRole('button', { name: '重试原请求' }));
  await dialog.findByText(/已复用/); expect(mocks.mutate.mock.calls[2]?.slice(0, 3)).toEqual(mocks.mutate.mock.calls[1]?.slice(0, 3)); expect(mocks.mutate.mock.calls[3]?.slice(0, 3)).toEqual(mocks.mutate.mock.calls[1]?.slice(0, 3));
  expect(mocks.mutate.mock.calls[0]?.[2]).toMatchObject({ from: new Date('2026-11-01T00:00').toISOString(), to: new Date('2026-11-13T12:00').toISOString(), ruleVersion: 2 });
});
it('requires receipt and payload permissions for single and history previews', async () => {
  mocks.context.modules = mocks.context.modules.map(module => module.key === 'api-integrations' ? { ...module, permissions: ['integration:receipts:read'] } : module);
  view(); await screen.findByText('供应商规则');
  expect(screen.getByRole('button', { name: '单条试处理' })).toBeDisabled(); expect(screen.getByRole('button', { name: '历史批量导入' })).toBeDisabled();
  expect(mocks.mutate).not.toHaveBeenCalled();
});
it('resolves interface names beyond the first lookup page', async () => {
  const original = read.getMockImplementation()!;
  read.mockImplementation(async (path, ...args) => {
    if (path.includes('/ingestion/endpoints')) {
      const page = Number(new URL(path, 'http://localhost').searchParams.get('page'));
      return { items: page === 1 ? Array.from({ length: 100 }, (_, index) => ({ id: `endpoint-${index}`, name: `接收接口${index}`, code: `E${index}`, status: 'ENABLED' })) : [{ id: endpointId, name: '第二页供应商接收', code: 'SUP', status: 'ENABLED' }], total: 101, page, limit: 100 } as never;
    }
    return original(path, ...args);
  });
  view(); expect(await screen.findByText('第二页供应商接收')).toBeVisible();
  expect(read.mock.calls.some(call => call[0].includes('/ingestion/endpoints?') && call[0].includes('page=2'))).toBe(true);
});
it('keeps the scoped ingestion form editable and retryable after reauthentication is cancelled', async () => {
  let reject!: (cause: unknown) => void;
  mocks.mutate.mockImplementationOnce(() => new Promise((_, fail) => { reject = fail; })).mockResolvedValueOnce({ previewId: 'preview-after-cancel', receiptCount: 1, rowCount: 1, expiresAt: '2099-11-14T03:00:00Z', fields: { code: 'RETRIED' } });
  view(); const row = (await screen.findByText('供应商规则')).closest('tr')!; fireEvent.click(within(row).getByRole('button', { name: '历史批量导入' }));
  const dialog = within(screen.getByRole('dialog', { name: `历史批量导入 · ${rule.name}` }));
  fireEvent.change(dialog.getByLabelText('接收时间起'), { target: { value: '2026-11-01T00:00' } }); fireEvent.change(dialog.getByLabelText('接收时间止'), { target: { value: '2026-11-13T12:00' } });
  fireEvent.click(dialog.getByRole('button', { name: '生成预览' })); await waitFor(() => expect(mocks.mutate).toHaveBeenCalledTimes(1));
  await act(async () => reject(new ApiError({ code: 'CLIENT_REAUTHENTICATION_CANCELLED', message: 'Reauthentication cancelled' }, 400)));
  expect(mocks.invalidate).not.toHaveBeenCalled(); expect(screen.queryByText('无权访问API入库衔接')).not.toBeInTheDocument();
  expect(dialog.getByLabelText('接收时间止')).toBeEnabled(); expect(dialog.getByRole('button', { name: /^关\s+闭$/ })).toBeEnabled(); expect(dialog.queryByRole('button', { name: '重试原请求' })).not.toBeInTheDocument();
  fireEvent.change(dialog.getByLabelText('接收时间止'), { target: { value: '2026-11-13T13:00' } }); fireEvent.click(dialog.getByRole('button', { name: '生成预览' }));
  await dialog.findByText('RETRIED'); expect(mocks.mutate).toHaveBeenCalledTimes(2); expect(mocks.mutate.mock.calls[1]?.[2]).toMatchObject({ to: new Date('2026-11-13T13:00').toISOString() });
});
it.each([401, 403])('clears the page when a preview receives a permission refusal %s', async status => {
  mocks.mutate.mockRejectedValueOnce(new ApiError({ code: 'INGESTION_AUTHORIZATION_REVOKED', message: 'Denied', fields: {}, traceId: 'trace' }, status));
  view(); const row = (await screen.findByText('供应商规则')).closest('tr')!; fireEvent.click(within(row).getByRole('button', { name: '历史批量导入' }));
  const dialog = within(screen.getByRole('dialog', { name: `历史批量导入 · ${rule.name}` }));
  fireEvent.change(dialog.getByLabelText('接收时间起'), { target: { value: '2026-11-01T00:00' } }); fireEvent.change(dialog.getByLabelText('接收时间止'), { target: { value: '2026-11-13T12:00' } });
  fireEvent.click(dialog.getByRole('button', { name: '生成预览' }));
  await screen.findByText('无权访问API入库衔接'); expect(screen.queryByText('供应商规则')).not.toBeInTheDocument(); expect(mocks.invalidate).toHaveBeenCalled();
});
it('invalidates the preview when the selected array row changes', async () => {
  mocks.mutate.mockResolvedValue({ previewId: 'preview-one', receiptCount: 1, rowCount: 1, expiresAt: '2099-11-14T03:00:00Z', fields: { code: '001', name: '供应商' } });
  const dialog = previewView();
  fireEvent.mouseDown(dialog.getByRole('combobox', { name: '接收记录' })); fireEvent.click(await screen.findByText(/MSG001/, { selector: '.ant-select-item-option-content' }));
  fireEvent.click(dialog.getByRole('button', { name: '生成预览' })); await dialog.findByRole('button', { name: '确认导入' });
  fireEvent.change(dialog.getByRole('spinbutton', { name: '数组行号' }), { target: { value: '2' } });
  await waitFor(() => expect(dialog.queryByRole('button', { name: '确认导入' })).not.toBeInTheDocument()); expect(mocks.mutate).toHaveBeenCalledTimes(1);
});
it('edits structured numeric conditions and preserves the expected rule version', async () => {
  mocks.mutate.mockResolvedValue(rule); const editor = editorView();
  expect(editor.getByLabelText('接收接口')).toBeDisabled(); expect(editor.getByLabelText('目标档案')).toBeDisabled();
  fireEvent.change(editor.getByLabelText('来源更新时间字段'), { target: { value: 'modifiedAt' } });
  fireEvent.click(editor.getByRole('button', { name: '添加条件' })); fireEvent.change(editor.getByLabelText('判断字段1'), { target: { value: 'kind' } });
  fireEvent.mouseDown(editor.getByLabelText('值类型')); fireEvent.click(await screen.findByText('数字', { selector: '.ant-select-item-option-content' }));
  fireEvent.change(editor.getByLabelText('比较值'), { target: { value: '3' } });
  fireEvent.click(editor.getByRole('button', { name: /保\s*存/ })); await waitFor(() => expect(mocks.mutate).toHaveBeenCalled());
  expect(mocks.mutate.mock.calls[0]?.[2]).toMatchObject({ expectedVersion: 2, enabled: false, sourceUpdatedAtField: 'modifiedAt', conditions: [{ path: 'kind', operator: 'EQ', value: 3 }] });
});
it('loads and explicitly clears the optional source update time mapping', async () => {
  mocks.mutate.mockResolvedValue(rule); const editor = editorView({ ...rule, sourceUpdatedAtField: 'modifiedAt' });
  expect(editor.getByLabelText('来源更新时间字段')).toHaveValue('modifiedAt'); fireEvent.change(editor.getByLabelText('来源更新时间字段'), { target: { value: '' } });
  fireEvent.click(editor.getByRole('button', { name: /保\s*存/ })); await waitFor(() => expect(mocks.mutate).toHaveBeenCalled());
  expect(mocks.mutate.mock.calls[0]?.[2]).not.toHaveProperty('sourceUpdatedAtField'); expect(mocks.mutate.mock.calls[0]?.[2]).toMatchObject({ expectedVersion: 2, endpointId, target: 'SUPPLIER' });
});
it('keeps stale item differences visible while disabling confirmation', async () => {
  const jobId = '66666666-6666-4666-8666-666666666666'; const itemId = '77777777-7777-4777-8777-777777777777';
  const job = { id: jobId, endpointId, receiptId, ruleId, ruleVersion: 2, target: 'SUPPLIER', source: 'SINGLE', status: 'COMPLETED', sequence: 1, total: 1, pending: 0, succeeded: 0, skipped: 0, failed: 0, awaitingConfirmation: 1, errorCode: null, createdAt: '2026-11-14T02:00:00Z' };
  const item = { id: itemId, jobId, receiptId, rowIndex: 0, status: 'AWAITING_CONFIRMATION', errorCode: null, targetId: 'target', targetVersion: 1, version: 3 };
  const original = read.getMockImplementation()!;
  read.mockImplementation(async (path, ...args) => {
    if (path.includes(`/items/${itemId}`)) return { ...item, stale: true, fields: { code: '001', name: '新供应商' }, differences: [{ field: 'name', before: '旧供应商', after: '新供应商' }] } as never;
    if (path.includes(`/jobs/${jobId}/items`)) return { items: [item], total: 1, page: 1, limit: 20 } as never;
    if (path.includes(`/jobs/${jobId}?`)) return job as never;
    if (path.includes('/ingestion/jobs?')) return { items: [job], total: 1, page: 1, limit: 20 } as never;
    return original(path, ...args);
  });
  jobsView(); const openJob = await screen.findByLabelText('查看任务1'); await act(async () => { fireEvent.click(openJob); });
  const jobDialog = within((await screen.findByText('供应商接收 · #1')).closest('[role="dialog"]')!);
  const viewDifferences = await jobDialog.findByText('查看差异', { selector: 'button span' });
  await act(async () => { fireEvent.click(viewDifferences); });
  const detail = within((await screen.findByText('数组第1行')).closest('[role="dialog"]')!);
  const stale = await detail.findByText('当前档案已变化，旧差异不可确认覆盖');
  await waitFor(() => expect(stale).toBeVisible());
  expect(detail.getByRole('button', { name: '确认更新' })).toBeDisabled(); expect(detail.getByText('旧供应商')).toBeVisible(); expect(mocks.mutate).not.toHaveBeenCalled();
});
it.each([
  { jobReceipt: null, parent: false, code: 'INTEGRATION_RECEIPT_NOT_FOUND', status: 404, reason: '原始接收记录已清理，无法计算差异' },
  { jobReceipt: receiptId, parent: false, code: 'INTEGRATION_RECEIPT_NOT_FOUND', status: 404, reason: '原始接收记录不可用，可能已清理，无法计算差异' },
  { jobReceipt: null, parent: true, code: 'INTEGRATION_RECEIPT_NOT_FOUND', status: 404, reason: '原始接收记录不可用，可能已清理，无法计算差异' },
  { jobReceipt: receiptId, parent: false, code: 'INTEGRATION_PAYLOAD_EXPIRED', status: 410, reason: '原始接收正文已清理，无法计算差异' },
] as const)('explains why completed process differences are unavailable ($code, receipt=$jobReceipt, parent=$parent)', async ({ jobReceipt, parent, code, status, reason }) => {
  const jobId = '66666666-6666-4666-8666-666666666666'; const itemId = '77777777-7777-4777-8777-777777777777';
  const job = { id: jobId, endpointId, receiptId: jobReceipt, parentJobId: null, planningPreviewId: parent ? 'preview-parent' : null, ruleId, ruleVersion: 2, target: 'PROCESS_DEFECT', source: parent ? 'HISTORY' : 'SINGLE', status: 'COMPLETED', sequence: 1, total: 1, pending: 0, succeeded: 1, skipped: 0, failed: 0, awaitingConfirmation: 0, errorCode: null, createdAt: '2026-11-14T02:00:00Z' };
  const item = { id: itemId, jobId: parent ? '88888888-8888-4888-8888-888888888888' : jobId, receiptId, rowIndex: 0, status: 'INSERTED', errorCode: null, targetId: 'defect-one', targetVersion: 1, version: 3 };
  read.mockImplementation(async path => {
    if (path.includes(`/items/${itemId}?`)) throw new ApiError({ code, message: 'private receipt diagnostic' }, status);
    if (path.includes(`/jobs/${jobId}/items`)) return { items: [item], total: 1, page: 1, limit: 20 } as never;
    if (path.includes(`/jobs/${jobId}?`)) return job as never;
    if (path.includes('/ingestion/jobs?')) return { items: [job], total: 1, page: 1, limit: 20 } as never;
    throw new Error(`Unexpected read ${path}`);
  });
  jobsView(); fireEvent.click(await screen.findByLabelText('查看任务1'));
  const jobDialog = within(await screen.findByRole('dialog', { name: '供应商接收 · #1' }));
  await jobDialog.findByText('接收编号');
  expect(await jobDialog.findByRole('link', { name: '查看台账' })).toHaveAttribute('href', `/app/process-quality?organizationId=${homeId}&defectId=defect-one`);
  fireEvent.click(jobDialog.getByRole('button', { name: '查看差异' }));
  const detail = within(await screen.findByRole('dialog', { name: '数组第1行' }));
  const alert = await detail.findByRole('alert');
  expect(alert).toHaveTextContent(reason);
  expect(alert).toHaveTextContent(code);
  expect(alert).not.toHaveTextContent('private receipt diagnostic');
  expect(detail.getByRole('link', { name: '查看台账' })).toHaveAttribute('href', `/app/process-quality?organizationId=${homeId}&defectId=defect-one`);
  expect(detail.queryByRole('button', { name: '确认更新' })).not.toBeInTheDocument();
  expect(mocks.invalidate).not.toHaveBeenCalled();
});
it('allows retrying a blocked job even when failure occurred before selecting an item', async () => {
  const jobId = '66666666-6666-4666-8666-666666666666';
  const job = { id: jobId, endpointId, receiptId, ruleId, ruleVersion: 2, target: 'SUPPLIER', source: 'AUTO', status: 'BLOCKED', sequence: 1, total: 1, pending: 1, succeeded: 0, skipped: 0, failed: 0, awaitingConfirmation: 0, errorCode: 'INGESTION_AUTHORIZATION_REVOKED', createdAt: '2026-11-14T02:00:00Z' };
  const original = read.getMockImplementation()!;
  read.mockImplementation(async (path, ...args) => {
    if (path.includes(`/jobs/${jobId}/items`)) return { items: [], total: 0, page: 1, limit: 20 } as never;
    if (path.includes(`/jobs/${jobId}?`)) return job as never;
    if (path.includes('/ingestion/jobs?')) return { items: [job], total: 1, page: 1, limit: 20 } as never;
    return original(path, ...args);
  });
  mocks.mutate.mockResolvedValue({ ...job, status: 'PENDING', errorCode: null });
  jobsView(); const openJob = await screen.findByLabelText('查看任务1'); await act(async () => { fireEvent.click(openJob); });
  const jobDialog = within(await screen.findByRole('dialog', { name: '供应商接收 · #1' }));
  const retry = await jobDialog.findByRole('button', { name: '重试处理' }); await waitFor(() => expect(retry).toBeEnabled()); await act(async () => { fireEvent.click(retry); });
  const control = within(await screen.findByRole('dialog', { name: '重试处理' }));
  fireEvent.change(control.getByLabelText('操作原因'), { target: { value: '接口和配置授权已恢复' } }); fireEvent.click(control.getByRole('button', { name: '确认操作' }));
  await waitFor(() => expect(mocks.mutate).toHaveBeenCalled());
  expect(mocks.mutate.mock.calls[0]?.slice(0, 3)).toEqual([`/api/v1/admin/integrations/ingestion/jobs/${jobId}/control`, 'POST', { organizationId: homeId, action: 'RETRY', reason: '接口和配置授权已恢复' }]);
});
it.each([null, 12000])('shows an unexpanded historical job as preparing with total %s and allows cancellation before items exist', async total => {
  const jobId = '66666666-6666-4666-8666-666666666666';
  const job = { id: jobId, endpointId, receiptId: null, parentJobId: null, planningPreviewId: 'preview-planning', planned: 98, receiptCount: 101, ruleId, ruleVersion: 2, target: 'SUPPLIER', source: 'HISTORY', status: 'PENDING', sequence: 1, total, expansionComplete: false, pending: 0, succeeded: 0, skipped: 0, failed: 0, awaitingConfirmation: 0, errorCode: null, createdAt: '2026-11-14T02:00:00Z' };
  const original = read.getMockImplementation()!;
  read.mockImplementation(async (path, ...args) => {
    if (path.includes(`/jobs/${jobId}/items`)) return { items: [], total: 0, page: 1, limit: 20 } as never;
    if (path.includes(`/jobs/${jobId}?`)) return job as never;
    if (path.includes('/ingestion/jobs?')) return { items: [job], total: 1, page: 1, limit: 20 } as never;
    return original(path, ...args);
  });
  mocks.mutate.mockResolvedValue({ ...job, status: 'CANCELLED' });
  jobsView(); const openJob = await screen.findByLabelText('查看任务1'); const row = within(openJob.closest('tr')!);
  expect(row.getByText('准备中')).toBeVisible(); expect(row.getByText('接收准备进度 98/101')).toBeVisible(); expect(row.getByText(total === null ? '总数 后台统计' : '总数 12000')).toBeVisible(); expect(row.queryByText('已完成')).not.toBeInTheDocument();
  await act(async () => { fireEvent.click(openJob); });
  const jobDialog = within(await screen.findByRole('dialog', { name: '供应商接收 · #1' }));
  await waitFor(() => expect(jobDialog.getByText('准备中')).toBeVisible());
  const cancel = jobDialog.getByText('取消任务', { selector: 'button span' }).closest('button')!; await waitFor(() => expect(cancel).toBeEnabled()); fireEvent.click(cancel);
  const controlDialog = within(await screen.findByRole('dialog', { name: '取消任务' }));
  fireEvent.change(controlDialog.getByLabelText('操作原因'), { target: { value: '停止尚未展开的历史导入' } }); fireEvent.click(controlDialog.getByText('确认操作', { selector: 'button span' }).closest('button')!);
  await waitFor(() => expect(mocks.mutate).toHaveBeenCalledTimes(1));
  expect(mocks.mutate.mock.calls[0]?.slice(0, 3)).toEqual([`/api/v1/admin/integrations/ingestion/jobs/${jobId}/control`, 'POST', { organizationId: homeId, action: 'CANCEL', reason: '停止尚未展开的历史导入' }]);
});
it('opens child item differences from a historical parent job without treating its receiving snapshot as removed', async () => {
  const jobId = '66666666-6666-4666-8666-666666666666'; const childJobId = '88888888-8888-4888-8888-888888888888'; const itemId = '77777777-7777-4777-8777-777777777777';
  const job = { id: jobId, endpointId, receiptId: null, parentJobId: null, planningPreviewId: 'preview-parent', planned: 1, receiptCount: 101, ruleId, ruleVersion: 2, target: 'SUPPLIER', source: 'HISTORY', status: 'PENDING', sequence: 1, total: null, expansionComplete: false, pending: 0, succeeded: 0, skipped: 0, failed: 0, awaitingConfirmation: 1, errorCode: null, createdAt: '2026-11-14T02:00:00Z' };
  const item = { id: itemId, jobId: childJobId, receiptId, rowIndex: 0, status: 'AWAITING_CONFIRMATION', errorCode: null, targetId: 'target', targetVersion: 1, version: 3 };
  const original = read.getMockImplementation()!;
  read.mockImplementation(async (path, ...args) => {
    if (path.includes(`/items/${itemId}`)) return { ...item, stale: false, differences: [{ field: 'name', before: '旧名称', after: '新名称' }] } as never;
    if (path.includes(`/jobs/${jobId}/items`)) return { items: [item], total: 1, page: 1, limit: 20 } as never;
    if (path.includes(`/jobs/${jobId}?`)) return job as never;
    if (path.includes('/ingestion/jobs?')) return { items: [job], total: 1, page: 1, limit: 20 } as never;
    return original(path, ...args);
  });
  jobsView(); fireEvent.click(await screen.findByLabelText('查看任务1'));
  const dialog = within(await screen.findByRole('dialog', { name: '供应商接收 · #1' }));
  const viewDifferences = (await dialog.findByText('查看差异', { selector: 'button span' })).closest('button')!;
  expect(dialog.queryByText('接收记录已清理')).not.toBeInTheDocument(); await waitFor(() => expect(dialog.getByText('历史接收集合')).toBeVisible()); expect(mocks.invalidate).not.toHaveBeenCalled();
  await act(async () => { fireEvent.click(viewDifferences); }); const detail = within((await screen.findByText('数组第1行', { selector: '.ant-modal-title' })).closest('[role="dialog"]')!);
  const updatedName = await detail.findByText('新名称');
  await waitFor(() => expect(updatedName).toBeVisible()); expect(detail.getByText('确认更新', { selector: 'button span' }).closest('button')).toBeEnabled(); expect(mocks.invalidate).not.toHaveBeenCalled();
});
it('renders factory changes and field issues in a process job item without reporting row failure', async () => {
  const jobId = '66666666-6666-4666-8666-666666666666'; const itemId = '77777777-7777-4777-8777-777777777777';
  const job = { id: jobId, endpointId, receiptId, ruleId, ruleVersion: 2, target: 'PROCESS_DEFECT', source: 'AUTO', status: 'COMPLETED', sequence: 1, total: 1, pending: 0, succeeded: 1, skipped: 0, failed: 0, awaitingConfirmation: 0, createdAt: '2026-11-14T02:00:00Z' };
  const item = { id: itemId, jobId, receiptId, rowIndex: 0, status: 'UPDATED', targetId: 'defect-one', targetVersion: 2, version: 3, pendingCompletion: true };
  read.mockImplementation(async path => {
    if (path.includes(`/items/${itemId}?`)) return { ...item, fields: { factoryCode: null }, differences: [{ field: 'factoryCode', before: 'FACTORY_2', after: null }, { field: 'registrationIssues', before: 'factory:EMPTY', after: 'factory:INVALID' }], registrationIssues: ['factory:INVALID'] };
    if (path.includes(`/jobs/${jobId}/items`)) return { items: [item], total: 1, page: 1, limit: 20 };
    if (path.includes(`/jobs/${jobId}?`)) return job;
    return { items: [job], total: 1, page: 1, limit: 20 };
  });
  jobsView(); fireEvent.click(await screen.findByLabelText('查看任务1'));
  const dialog = within(await screen.findByRole('dialog', { name: '供应商接收 · #1' }));
  fireEvent.click(await dialog.findByRole('button', { name: '查看差异' }));
  const detail = within(await screen.findByRole('dialog', { name: '数组第1行' }));
  const difference = (await detail.findByText('二工厂')).closest('tr')!;
  await waitFor(() => expect(within(difference).getByText('/')).toBeVisible());
  expect(detail.getByText('工厂来源值为空')).toBeVisible();
  expect(detail.getAllByText('工厂来源值无效')).toHaveLength(2);
  expect(detail.getByText('待完善')).toBeVisible();
  expect(detail.queryByText('条目处理异常')).not.toBeInTheDocument();
});
it.each([
  { status: 'COMPLETED', expansionComplete: false }, { status: 'CANCELLED', expansionComplete: false },
  { status: 'COMPLETED', expansionComplete: undefined }, { status: 'PENDING', expansionComplete: undefined },
])('does not prepare or cancel a zero-item $status job with expansionComplete=$expansionComplete', async ({ status, expansionComplete }) => {
  const jobId = '66666666-6666-4666-8666-666666666666';
  const job = { id: jobId, endpointId, receiptId, ruleId, ruleVersion: 2, target: 'SUPPLIER', source: 'HISTORY', status, sequence: 1, total: 0, expansionComplete, pending: 0, succeeded: 0, skipped: 0, failed: 0, awaitingConfirmation: 0, errorCode: null, createdAt: '2026-11-14T02:00:00Z' };
  const original = read.getMockImplementation()!;
  read.mockImplementation(async (path, ...args) => {
    if (path.includes(`/jobs/${jobId}/items`)) return { items: [], total: 0, page: 1, limit: 20 } as never;
    if (path.includes(`/jobs/${jobId}?`)) return job as never;
    if (path.includes('/ingestion/jobs?')) return { items: [job], total: 1, page: 1, limit: 20 } as never;
    return original(path, ...args);
  });
  jobsView(); const openJob = await screen.findByLabelText('查看任务1'); expect(within(openJob.closest('tr')!).queryByText('准备中')).not.toBeInTheDocument();
  fireEvent.click(openJob); const dialog = within(await screen.findByRole('dialog', { name: '供应商接收 · #1' }));
  await dialog.findByText('接收编号'); expect(dialog.queryByText('准备中')).not.toBeInTheDocument(); expect(dialog.getByText('取消任务', { selector: 'button span' }).closest('button')).toBeDisabled();
});
it('locates a failed preview using its controlled source field without displaying raw error codes', async () => {
  mocks.mutate.mockResolvedValue({ previewId: 'preview-invalid', receiptCount: 1, rowCount: 1, expiresAt: '2099-11-14T03:00:00Z', action: 'VALIDATION_FAILED', errorCode: 'INGESTION_FIELD_MISSING', errorField: 'supplier.code', differences: [] });
  const dialog = previewView();
  fireEvent.mouseDown(dialog.getByRole('combobox', { name: '接收记录' })); fireEvent.click(await screen.findByText(/MSG001/, { selector: '.ant-select-item-option-content' })); fireEvent.click(dialog.getByRole('button', { name: '生成预览' }));
  const preview = within(await dialog.findByRole('region', { name: '入库预览' }));
  expect(preview.getByText('supplier.code')).toBeVisible(); expect(preview.getByText('缺少必需来源字段')).toBeVisible(); expect(preview.getByText('INGESTION_FIELD_MISSING')).toBeVisible();
  expect(preview.getByRole('button', { name: '确认导入' })).toBeDisabled(); expect(mocks.mutate).toHaveBeenCalledTimes(1);
});
it.each(['validation', 'duplicate'])('shows the %s item location or existing confirmation link without creating another confirmation', async kind => {
  const jobId = '66666666-6666-4666-8666-666666666666'; const itemId = '77777777-7777-4777-8777-777777777777'; const originalItemId = '88888888-8888-4888-8888-888888888888';
  const job = { id: jobId, endpointId, receiptId, ruleId, ruleVersion: 2, target: 'SUPPLIER', source: 'AUTO', status: 'COMPLETED', sequence: 1, total: 1, pending: 0, succeeded: 0, skipped: kind === 'duplicate' ? 1 : 0, failed: kind === 'validation' ? 1 : 0, awaitingConfirmation: 0, errorCode: null, createdAt: '2026-11-14T02:00:00Z' };
  const item = { id: itemId, jobId, receiptId, rowIndex: 0, status: kind === 'validation' ? 'VALIDATION_FAILED' : 'SKIPPED', errorCode: kind === 'validation' ? 'INGESTION_FIELD_TYPE' : null, errorField: kind === 'validation' ? 'supplier.name' : null, duplicateOfItemId: kind === 'duplicate' ? originalItemId : null, targetId: null, targetVersion: null, version: 3 };
  const original = read.getMockImplementation()!;
  read.mockImplementation(async (path, ...args) => {
    if (path.includes(`/items/${itemId}`)) return { ...item, stale: false, differences: [] } as never;
    if (path.includes(`/jobs/${jobId}/items`)) return { items: [item], total: 1, page: 1, limit: 20 } as never;
    if (path.includes(`/jobs/${jobId}?`)) return job as never;
    if (path.includes('/ingestion/jobs?')) return { items: [job], total: 1, page: 1, limit: 20 } as never;
    return original(path, ...args);
  });
  jobsView(); const openJob = await screen.findByLabelText('查看任务1'); await act(async () => { fireEvent.click(openJob); });
  const jobDialog = within(await screen.findByRole('dialog', { name: '供应商接收 · #1' }));
  const summary = await jobDialog.findByText(kind === 'validation' ? 'supplier.name' : '已关联既有待确认项');
  await waitFor(() => expect(summary).toBeVisible());
  await act(async () => { fireEvent.click(jobDialog.getByRole('button', { name: '查看差异' })); }); const detail = within(await screen.findByRole('dialog', { name: '数组第1行' }));
  if (kind === 'validation') { const field = await detail.findByText('supplier.name'); await waitFor(() => expect(field).toBeVisible()); expect(detail.getByText('来源字段类型与规则不符')).toBeVisible(); expect(detail.getByText('INGESTION_FIELD_TYPE')).toBeVisible(); }
  else { const linked = await detail.findByText('已关联既有待确认项'); await waitFor(() => expect(linked).toBeVisible()); expect(detail.getByText(originalItemId)).toBeVisible(); expect(detail.queryByRole('button', { name: '确认更新' })).not.toBeInTheDocument(); expect(detail.queryByRole('button', { name: '跳过此项' })).not.toBeInTheDocument(); }
  expect(mocks.mutate).not.toHaveBeenCalled();
});
