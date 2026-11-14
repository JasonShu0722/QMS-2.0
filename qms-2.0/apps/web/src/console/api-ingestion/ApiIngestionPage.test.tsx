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
import { IngestionError, type Rule } from './ingestion-ui';
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
function context(permissions = ['ingestion:read', 'ingestion:manage', 'ingestion:run']): ConsoleContext {
  return { actor: { id: actorId, accountType: 'INTERNAL', homeOrganization: home }, targetOrganization: home, organizations: [home], hasPlatformAdministrator: true,
    modules: [{ key: 'api-ingestion', scope: 'TARGET', coverage: 'ORGANIZATION', organizationId: homeId, permissions }, { key: 'api-integrations', scope: 'TARGET', coverage: 'ORGANIZATION', organizationId: homeId, permissions: ['integration:receipts:read', 'integration:payload:read'] }] };
}
function view(initialEntry = '/console/api-ingestion') {
  const tree = () => <LanguageProvider><ConsoleTheme><MemoryRouter initialEntries={[initialEntry]}><UnsavedChangesProvider><ApiIngestionPage /></UnsavedChangesProvider></MemoryRouter></ConsoleTheme></LanguageProvider>;
  const result = render(tree()); return { ...result, update: () => result.rerender(tree()) };
}
function componentView(children: ReactNode) {
  return render(<LanguageProvider><ConsoleTheme><MemoryRouter><UnsavedChangesProvider>{children}</UnsavedChangesProvider></MemoryRouter></ConsoleTheme></LanguageProvider>);
}
function verifiedScope(): IntegrationScope {
  return { organizationId: homeId, session: `INTERNAL:${homeId}:${actorId}`, epoch: getLedgerSessionEpoch(), permissions: ['ingestion:read', 'ingestion:manage', 'ingestion:run'], deny: mocks.invalidate };
}
function previewView(history = false, viewJobs = vi.fn()) {
  componentView(<ImportPreview scope={verifiedScope()} rule={rule} history={history} canReceipts close={vi.fn()} viewJobs={viewJobs} />);
  return within(screen.getByRole('dialog', { name: `${history ? '历史批量导入' : '单条试处理'} · ${rule.name}` }));
}
function editorView(existing = rule) {
  componentView(<RuleEditor scope={verifiedScope()} rule={existing} endpoints={[{ id: endpointId, name: '供应商接收', code: 'SUP', status: 'ENABLED' }]} endpointsLoading={false} close={vi.fn()} saved={vi.fn()} />);
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
it('requires the scoped ingestion capability even for a platform administrator', () => {
  mocks.context = { ...context(), modules: [] }; view();
  expect(screen.getByRole('alert')).toHaveTextContent('无权访问API入库衔接'); expect(read).not.toHaveBeenCalled();
});
it('shows named endpoints and keeps mutation controls absent for readers', async () => {
  mocks.context = context(['ingestion:read']); view(); await screen.findByText('供应商规则');
  expect(screen.getByText('供应商接收')).toBeVisible(); expect(screen.queryByRole('button', { name: '新增规则' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '单条试处理' })).not.toBeInTheDocument();
});
it('opens receipt-linked processing jobs and clears the controlled receipt filter', async () => {
  view(`/console/api-ingestion?receiptId=${receiptId}`);
  await waitFor(() => expect(read.mock.calls.some(call => call[0].includes('/ingestion/jobs?') && new URL(call[0], 'http://localhost').searchParams.get('receiptId') === receiptId)).toBe(true));
  expect(pageTab('处理任务')).toHaveAttribute('aria-selected', 'true');
  fireEvent.click(screen.getByRole('button', { name: '清除接收记录筛选' })); await screen.findByText('供应商规则');
  expect(screen.queryByRole('button', { name: '清除接收记录筛选' })).not.toBeInTheDocument();
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
  expect(screen.getByRole('alert')).toHaveTextContent(message); expect(screen.getByRole('alert')).not.toHaveTextContent(code);
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
it('clears the page when a preview receives a permission refusal', async () => {
  mocks.mutate.mockRejectedValueOnce(new ApiError({ code: 'INGESTION_AUTHORIZATION_REVOKED', message: 'Denied', fields: {}, traceId: 'trace' }, 403));
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
  fireEvent.click(viewDifferences); const detail = within((await screen.findByText('数组第1行', { selector: '.ant-modal-title' })).closest('[role="dialog"]')!);
  await waitFor(() => expect(detail.getByText('新名称')).toBeVisible()); expect(detail.getByText('确认更新', { selector: 'button span' }).closest('button')).toBeEnabled(); expect(mocks.invalidate).not.toHaveBeenCalled();
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
  expect(preview.getByText('supplier.code')).toBeVisible(); expect(preview.getByText('缺少必需来源字段')).toBeVisible(); expect(preview.queryByText('INGESTION_FIELD_MISSING')).not.toBeInTheDocument();
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
  if (kind === 'validation') { const field = await detail.findByText('supplier.name'); await waitFor(() => expect(field).toBeVisible()); expect(detail.getByText('来源字段类型与规则不符')).toBeVisible(); }
  else { const linked = await detail.findByText('已关联既有待确认项'); await waitFor(() => expect(linked).toBeVisible()); expect(detail.getByText(originalItemId)).toBeVisible(); expect(detail.queryByRole('button', { name: '确认更新' })).not.toBeInTheDocument(); expect(detail.queryByRole('button', { name: '跳过此项' })).not.toBeInTheDocument(); }
  expect(mocks.mutate).not.toHaveBeenCalled();
});
