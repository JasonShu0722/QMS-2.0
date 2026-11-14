import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { StrictMode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { ApiError, apiRequest } from '../../api/client';
import { LanguageProvider } from '../../i18n/Language';
import { UnsavedChangesProvider } from '../../layouts/UnsavedChanges';
import { getLedgerSessionEpoch } from '../../ui/ledger/preferences';
import { useWorkTabsStore } from '../../work-tabs/workTabsStore';
import { ConsoleTheme } from '../ConsoleTheme';
import { ReceiptList } from './ReceiptList';
import type { IntegrationScope } from './integration-ui';

const mutate = vi.hoisted(() => vi.fn());
vi.mock('../../api/client', async original => ({ ...await original<typeof import('../../api/client')>(), apiRequest: vi.fn(), createAdminMutation: () => mutate }));
const read = vi.mocked(apiRequest);
const clipboard = vi.fn(async (_value: string) => {});
const organizationId = '22222222-2222-4222-8222-222222222222';
const receiptId = '44444444-4444-4444-8444-444444444444';
const endpointId = '33333333-3333-4333-8333-333333333333';
const traceId = '55555555-5555-4555-8555-555555555555';
const receipt = { id: receiptId, organizationId, endpointId, endpointName: '物料成品信息', endpointCode: 'part', credentialId: traceId, messageId: 'message-001', sourceCode: 'MES', sourceName: '制造来源', configurationVersion: 2,
  receivedAt: '2026-11-09T03:00:00.000Z', bodyExpiresAt: '2026-11-16T03:00:00.000Z', metadataExpiresAt: '2027-02-07T03:00:00.000Z', bodyAvailable: true, payloadBytes: 20 };
const secondReceipt = { ...receipt, id: '66666666-6666-4666-8666-666666666666', messageId: 'message-002' };
let scope: IntegrationScope;
function page(path: string) {
  const query = new URL(path, 'http://localhost').searchParams;
  if (path.includes('/receipt-endpoints?')) return { items: [{ id: endpointId, name: receipt.endpointName, code: receipt.endpointCode }], total: 1, page: 1, limit: 20 };
  return { items: [receipt], total: 1, page: Number(query.get('page') ?? 1), limit: Number(query.get('limit') ?? 20), from: query.get('from'), to: query.get('to') };
}
function view() {
  return render(<LanguageProvider><ConsoleTheme><MemoryRouter><UnsavedChangesProvider><ReceiptList scope={scope} /></UnsavedChangesProvider></MemoryRouter></ConsoleTheme></LanguageProvider>);
}
function openFilters() {
  fireEvent.click(screen.getByRole('button', { name: '筛选条件' }));
}
beforeEach(() => {
  vi.stubEnv('NODE_ENV', 'development'); vi.clearAllMocks(); read.mockReset(); mutate.mockReset(); clipboard.mockReset(); localStorage.clear();
  clipboard.mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: clipboard } });
  const session = `INTERNAL:${organizationId}:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa`; useWorkTabsStore.getState().bindSession(session);
  scope = { organizationId, session, epoch: getLedgerSessionEpoch(), permissions: ['integration:receipts:read', 'integration:payload:read'], deny: vi.fn() };
  read.mockImplementation(async path => path.includes('/status') ? { usedBodyBytes: 20, capacityBytes: 1073741824, receiptCount: 1, receiptLimit: 100000, requestCollection: 'UNKNOWN' } : page(path));
});
afterEach(() => { vi.unstubAllEnvs(); localStorage.clear(); });

it('reads receipt metadata in the verified organization without requiring configuration access', async () => {
  scope.permissions = ['integration:receipts:read']; view();
  expect(await screen.findByText('message-001')).toBeVisible();
  const query = new URL(read.mock.calls.find(([path]) => path.includes('/receipts?'))![0], 'http://localhost').searchParams;
  expect(query.get('organizationId')).toBe(organizationId); expect(query.get('limit')).toBe('20');
  expect(read.mock.calls.some(([path]) => path.includes('/endpoints'))).toBe(false);
});

it('compact receiving controls combine capacity and actions and keep all six page sizes beside columns above the table', async () => {
  scope.permissions = ['integration:receipts:read', 'integration:manage'];
  read.mockImplementation(async path => path.includes('/status')
    ? { usedBodyBytes: 20, capacityBytes: 1073741824, receiptCount: 1, receiptLimit: 100000, requestCollection: 'UNKNOWN', lastCleanupSucceededAt: receipt.receivedAt, lastCleanupFailedAt: receipt.receivedAt }
    : { ...page(path), total: 1200 });
  const mounted = view(); await screen.findByText('message-001');
  const toolbar = screen.getByRole('toolbar', { name: '接收记录操作' });
  expect(within(toolbar).getByRole('button', { name: '设置组织正文容量' })).toBeEnabled();
  expect(within(toolbar).getByRole('combobox', { name: '记录视图' })).toBeInTheDocument();
  expect(within(toolbar).getByRole('button', { name: '刷新记录' })).toBeInTheDocument();
  expect(within(toolbar).getByRole('button', { name: '筛选条件' })).toBeInTheDocument();
  expect(screen.queryByText(/最近清理(成功|失败)/)).not.toBeInTheDocument();
  const pagination = screen.getByRole('navigation', { name: '接收记录分页' });
  expect(pagination.parentElement).toContainElement(screen.getByRole('button', { name: '列设置' }));
  expect(pagination.compareDocumentPosition(screen.getByRole('table')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(screen.getAllByRole('navigation', { name: '接收记录分页' })).toHaveLength(1);
  const sizes = within(pagination).getByRole('combobox', { name: '每页条数' });
  expect(sizes).toHaveValue('20');
  expect(within(sizes).getAllByRole('option').map(option => option.getAttribute('value'))).toEqual(['10', '20', '50', '100', '500', '1000']);
  expect(pagination).toHaveTextContent('共 1200 条');
  expect(pagination).toHaveTextContent('1 / 60');
  for (const size of [10, 20, 50, 100, 500, 1000]) {
    fireEvent.change(sizes, { target: { value: String(size) } });
    await waitFor(() => expect(new URL(read.mock.calls.filter(([path]) => path.includes('/receipts?')).at(-1)![0], 'http://localhost').searchParams.get('limit')).toBe(String(size)));
    await screen.findByText('message-001');
  }
  expect(mounted.container.querySelector('.ant-table-pagination')).toBeNull();
});

it('compact receiving selection clears before an asynchronous next page loads and remains page scoped after size and filter changes', async () => {
  scope.permissions = ['integration:receipts:read', 'integration:manage'];
  let resolveNext!: (value: unknown) => void;
  read.mockImplementation(async path => path.includes('/status')
    ? { usedBodyBytes: 40, capacityBytes: 1073741824, receiptCount: 21, receiptLimit: 100000, requestCollection: 'UNKNOWN' }
    : new URL(path, 'http://localhost').searchParams.get('page') === '2'
      ? new Promise(resolve => { resolveNext = resolve; }) : { ...page(path), total: 21 });
  view(); await screen.findByText('message-001');
  fireEvent.click(screen.getByRole('checkbox', { name: '选择当前页' }));
  const selection = screen.getByRole('toolbar', { name: '已选接收记录' });
  expect(within(selection).getByText('已选择 1 条')).toBeVisible();
  fireEvent.click(within(selection).getByRole('button', { name: '取消选择' }));
  expect(screen.queryByRole('toolbar', { name: '已选接收记录' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('checkbox', { name: '选择当前页' }));
  const pagination = screen.getByRole('navigation', { name: '接收记录分页' });
  fireEvent.click(within(pagination).getByRole('button', { name: '下一页' }));
  expect(screen.queryByRole('toolbar', { name: '已选接收记录' })).not.toBeInTheDocument();
  expect(screen.getByRole('checkbox', { name: '选择当前页' })).toBeDisabled();
  await act(async () => resolveNext({ ...page('/?page=2&limit=20'), items: [secondReceipt], total: 21 }));
  await screen.findByText('message-002');
  expect(screen.getByRole('checkbox', { name: '选择当前页' })).not.toBeChecked();
  fireEvent.click(screen.getByRole('checkbox', { name: '选择当前页' }));
  fireEvent.change(within(pagination).getByRole('combobox', { name: '每页条数' }), { target: { value: '50' } });
  await screen.findByText('message-001');
  expect(screen.queryByRole('toolbar', { name: '已选接收记录' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('checkbox', { name: '选择当前页' }));
  openFilters();
  fireEvent.change(screen.getByLabelText('来源系统编码', { selector: 'input' }), { target: { value: 'MES' } });
  fireEvent.click(screen.getByRole('button', { name: '应用筛选' }));
  expect(screen.queryByRole('toolbar', { name: '已选接收记录' })).not.toBeInTheDocument();
});

it('compact receiving deletion returns directly to the last valid page after removing the final page', async () => {
  scope.permissions = ['integration:receipts:read', 'integration:manage'];
  let deleted = false;
  read.mockImplementation(async path => {
    if (path.includes('/status')) return { usedBodyBytes: 20, capacityBytes: 1073741824, receiptCount: deleted ? 20 : 81, receiptLimit: 100000, requestCollection: 'UNKNOWN' };
    const result = page(path);
    return { ...result, items: result.page === 5 ? (deleted ? [] : [secondReceipt]) : [receipt], total: deleted ? 20 : 81 };
  });
  mutate.mockImplementation(async () => { deleted = true; return { deletedCount: 1, receiptIds: [secondReceipt.id] }; });
  view(); await screen.findByText('message-001');
  const pagination = screen.getByRole('navigation', { name: '接收记录分页' });
  fireEvent.change(within(pagination).getByRole('spinbutton', { name: '跳至页' }), { target: { value: '5' } });
  fireEvent.submit(within(pagination).getByRole('spinbutton', { name: '跳至页' }).closest('form')!);
  await screen.findByText('message-002');
  fireEvent.click(screen.getByRole('button', { name: '删除消息message-002' }));
  const dialog = within(await screen.findByRole('dialog', { name: '删除接收记录' }));
  fireEvent.click(dialog.getByRole('button', { name: '删除' }));
  await screen.findByText('message-001');
  expect(pagination).toHaveTextContent('1 / 1');
  expect(pagination).toHaveTextContent('共 20 条');
  const readsAfterDeletion = read.mock.calls.filter(([path]) => path.includes('/receipts?')).map(([path]) => Number(new URL(path, 'http://localhost').searchParams.get('page')));
  expect(readsAfterDeletion).not.toContain(4);
  expect(readsAfterDeletion).not.toContain(3);
  expect(readsAfterDeletion).not.toContain(2);
});

it('compact receiving freezes selected IDs and all related controls during submitting and unknown deletion before exact retry', async () => {
  scope.permissions = ['integration:receipts:read', 'integration:manage'];
  let rejectDelete!: (cause: unknown) => void;
  mutate.mockReturnValueOnce(new Promise((_resolve, reject) => { rejectDelete = reject; }));
  mutate.mockResolvedValueOnce({ deletedCount: 1, receiptIds: [receiptId] });
  view(); const message = await screen.findByText('message-001'); openFilters();
  const selectPage = screen.getByRole('checkbox', { name: '选择当前页' });
  fireEvent.click(selectPage);
  const selectedActions = within(screen.getByRole('toolbar', { name: '已选接收记录' }));
  const actions = within(screen.getByRole('toolbar', { name: '接收记录操作' }));
  const filters = within(screen.getByRole('form', { name: '接收记录筛选' }));
  const pagination = within(screen.getByRole('navigation', { name: '接收记录分页' }));
  const controls = [selectPage,
    actions.getByRole('button', { name: '清空筛选' }),
    selectedActions.getByRole('button', { name: '取消选择' }),
    within(message.closest('tr')!).getByRole('button', { name: '查看消息message-001' }),
    actions.getByRole('combobox', { name: '记录视图' }),
    actions.getByRole('button', { name: '设置组织正文容量' }),
    filters.getByRole('button', { name: '应用筛选' }),
    filters.getByRole('textbox', { name: '来源系统编码' }),
    pagination.getByRole('combobox', { name: '每页条数' }),
    pagination.getByRole('spinbutton', { name: '跳至页' }),
  ];
  fireEvent.click(selectedActions.getByRole('button', { name: '删除所选' }));
  const dialog = within(await screen.findByRole('dialog', { name: '删除接收记录' }));
  controls.push(dialog.getByRole('button', { name: '取消' }));
  fireEvent.click(dialog.getByRole('button', { name: '删除' }));
  const assertFrozen = () => {
    controls.forEach(control => expect(control).toBeDisabled());
  };
  assertFrozen();
  await act(async () => rejectDelete(new ApiError({ code: 'HTTP_500', message: 'unknown' }, 500)));
  await dialog.findByRole('button', { name: '重试删除' });
  assertFrozen();
  expect(selectPage).toBeChecked();
  fireEvent.click(dialog.getByRole('button', { name: '重试删除' }));
  await waitFor(() => expect(mutate).toHaveBeenCalledTimes(2));
  expect(mutate.mock.calls[1]![2]).toEqual(mutate.mock.calls[0]![2]);
  await waitFor(() => expect(screen.queryByRole('toolbar', { name: '已选接收记录' })).not.toBeInTheDocument());
});

it('keeps receipt filters collapsed until the operator opens them', async () => {
  view(); await screen.findByText('message-001');
  expect(screen.getByRole('button', { name: '筛选条件' })).toHaveAttribute('aria-expanded', 'false');
  expect(screen.queryByRole('combobox', { name: '接口名称或编码' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '筛选条件' }));
  expect(screen.getByRole('button', { name: '筛选条件' })).toHaveAttribute('aria-expanded', 'true');
  expect(screen.getByRole('combobox', { name: '接口名称或编码' })).toBeVisible();
});

it('clears applied and draft filters and reloads the default record list', async () => {
  scope.permissions = ['integration:receipts:read'];
  view(); await screen.findByText('message-001'); openFilters();
  fireEvent.change(screen.getByRole('textbox', { name: '来源系统编码' }), { target: { value: 'MES' } });
  fireEvent.click(screen.getByRole('button', { name: '应用筛选' }));
  await waitFor(() => expect(new URL(read.mock.calls.filter(([path]) => path.includes('/receipts?')).at(-1)![0], 'http://localhost').searchParams.get('sourceCode')).toBe('MES'));
  const readsBeforeClear = read.mock.calls.filter(([path]) => path.includes('/receipts?')).length;
  fireEvent.change(screen.getByRole('textbox', { name: '来源系统编码' }), { target: { value: 'STALE' } });
  fireEvent.click(screen.getByRole('button', { name: '清空筛选' }));
  await waitFor(() => expect(read.mock.calls.filter(([path]) => path.includes('/receipts?')).length).toBeGreaterThan(readsBeforeClear));
  const query = new URL(read.mock.calls.filter(([path]) => path.includes('/receipts?')).at(-1)![0], 'http://localhost').searchParams;
  expect(query.has('sourceCode')).toBe(false); expect(query.get('page')).toBe('1'); expect(screen.getByRole('textbox', { name: '来源系统编码' })).toHaveValue('');
});

it('clears both receipt and attempt filters without leaving the selected view or page size', async () => {
  scope.permissions = ['integration:receipts:read'];
  view(); await screen.findByText('message-001'); openFilters();
  fireEvent.mouseDown(screen.getByLabelText('记录视图', { selector: 'input' }));
  fireEvent.click(await screen.findByText('请求结果', { selector: '.ant-select-item-option-content' }));
  await screen.findByText('message-001');
  fireEvent.change(screen.getByLabelText('每页条数'), { target: { value: '50' } });
  await screen.findByText('message-001');
  const form = within(screen.getByRole('form', { name: '接收记录筛选' }));
  fireEvent.change(form.getByLabelText('来源系统编码', { selector: 'input' }), { target: { value: ' ERP ' } });
  fireEvent.change(form.getByLabelText('请求追踪号', { selector: 'input' }), { target: { value: traceId } });
  fireEvent.mouseDown(form.getByLabelText('查询时段', { selector: 'input' }));
  fireEvent.click(await screen.findByText('近1天', { selector: '.ant-select-item-option-content' }));
  fireEvent.click(form.getByRole('button', { name: '应用筛选' }));
  await waitFor(() => expect(read.mock.calls.some(([path]) => path.includes('/attempts?') && new URL(path, 'http://localhost').searchParams.get('sourceCode') === 'ERP')).toBe(true));
  const readsBeforeClear = read.mock.calls.filter(([path]) => path.includes('/attempts?')).length;
  fireEvent.click(within(screen.getByRole('toolbar', { name: '接收记录操作' })).getByRole('button', { name: '清空筛选' }));
  await waitFor(() => expect(read.mock.calls.filter(([path]) => path.includes('/attempts?')).length).toBeGreaterThan(readsBeforeClear));
  const query = new URL(read.mock.calls.filter(([path]) => path.includes('/attempts?')).at(-1)![0], 'http://localhost').searchParams;
  expect(query.has('sourceCode')).toBe(false); expect(query.has('traceId')).toBe(false); expect(query.get('page')).toBe('1'); expect(query.get('limit')).toBe('50');
  expect(new Date(query.get('to')!).getTime() - new Date(query.get('from')!).getTime()).toBe(7 * 86400000 - 60000);
  expect(form.getByLabelText('来源系统编码', { selector: 'input' })).toHaveValue('');
  expect(form.getByLabelText('请求追踪号', { selector: 'input' })).toHaveValue('');
  expect(form.getByLabelText('查询时段', { selector: 'input' }).closest('.ant-select')).toHaveTextContent('近7天');
  expect(screen.getByLabelText('记录视图', { selector: 'input' }).closest('.ant-select')).toHaveTextContent('请求结果');
  expect(screen.getByLabelText('每页条数')).toHaveValue('50');
});

it('clears validation, page jumps and selection without opening collapsed filters', async () => {
  scope.permissions = ['integration:receipts:read', 'integration:manage'];
  read.mockImplementation(async path => path.includes('/status') ? { usedBodyBytes: 20, capacityBytes: 1073741824, receiptCount: 81, receiptLimit: 100000, requestCollection: 'UNKNOWN' } : { ...page(path), total: 81 });
  view(); await screen.findByText('message-001'); openFilters();
  const form = within(screen.getByLabelText('接收记录筛选'));
  fireEvent.change(form.getByLabelText('接收编号', { selector: 'input' }), { target: { value: 'invalid' } });
  fireEvent.click(form.getByRole('button', { name: '应用筛选' }));
  expect(screen.getByText(/请检查标识格式/)).toBeVisible();
  openFilters();
  const paginationElement = screen.getByLabelText('接收记录分页');
  const pagination = within(paginationElement);
  fireEvent.click(pagination.getByRole('button', { name: '下一页' })); await screen.findByText('message-001');
  fireEvent.change(pagination.getByLabelText('跳至页'), { target: { value: '4' } });
  fireEvent.click(screen.getByRole('checkbox', { name: '选择当前页' }));
  const actions = within(screen.getByLabelText('接收记录操作'));
  fireEvent.click(actions.getByRole('button', { name: '清空筛选' })); await screen.findByText('message-001');
  expect(screen.queryByText(/请检查标识格式/)).not.toBeInTheDocument();
  expect(screen.queryByLabelText('已选接收记录')).not.toBeInTheDocument();
  expect(pagination.getByLabelText('跳至页')).toHaveValue(null);
  expect(paginationElement).toHaveTextContent('1 / 5');
  expect(actions.getByRole('button', { name: '筛选条件' })).toHaveAttribute('aria-expanded', 'false');
});

it('clears candidate errors and ignores stale candidates after clearing search', async () => {
  let resolveCandidates!: (value: unknown) => void;
  read.mockImplementation(async path => {
    if (path.includes('/receipt-endpoints?') && path.includes('search=failed')) throw new Error('candidate unavailable');
    if (path.includes('/receipt-endpoints?') && path.includes('search=stale')) return new Promise(resolve => { resolveCandidates = resolve; });
    return path.includes('/status') ? { usedBodyBytes: 20, capacityBytes: 1073741824, receiptCount: 1, receiptLimit: 100000, requestCollection: 'UNKNOWN' } : page(path);
  });
  view(); await screen.findByText('message-001'); openFilters();
  const selector = screen.getByLabelText('接口名称或编码', { selector: 'input' });
  const actions = within(screen.getByRole('toolbar', { name: '接收记录操作' }));
  fireEvent.change(selector, { target: { value: 'failed' } });
  await screen.findByText('接口候选加载失败，请重试');
  fireEvent.click(actions.getByRole('button', { name: '清空筛选' }));
  expect(screen.queryByText('接口候选加载失败，请重试')).not.toBeInTheDocument();
  expect(selector).toHaveValue('');
  fireEvent.change(selector, { target: { value: 'stale' } });
  await waitFor(() => expect(resolveCandidates).toBeTypeOf('function'));
  fireEvent.click(actions.getByRole('button', { name: '清空筛选' }));
  await act(async () => resolveCandidates({ items: [{ id: endpointId, name: 'STALE_CANDIDATE', code: 'stale' }], total: 1, page: 1, limit: 20 }));
  fireEvent.mouseDown(selector);
  expect(screen.queryByText(/STALE_CANDIDATE/)).not.toBeInTheDocument();
});

it('saves a ten GiB organization payload capacity from the facts button', async () => {
  scope.permissions = ['integration:receipts:read', 'integration:manage'];
  view(); await screen.findByText('message-001');
  fireEvent.click(screen.getByRole('button', { name: '设置组织正文容量' }));
  const dialog = within(screen.getByRole('dialog', { name: '设置组织正文容量' }));
  fireEvent.change(dialog.getByRole('spinbutton', { name: '组织容量GiB' }), { target: { value: '10' } });
  fireEvent.click(dialog.getByRole('button', { name: /保\s*存/ }));
  await waitFor(() => expect(mutate).toHaveBeenCalledWith('/api/v1/admin/integrations/status', 'PATCH', { organizationId, capacityBytes: 10737418240 }, expect.any(AbortSignal)));
});

it('does not submit an out of range organization capacity', async () => {
  scope.permissions = ['integration:receipts:read', 'integration:manage'];
  view(); await screen.findByText('message-001'); fireEvent.click(screen.getByRole('button', { name: '设置组织正文容量' }));
  const dialog = within(screen.getByRole('dialog', { name: '设置组织正文容量' }));
  fireEvent.change(dialog.getByRole('spinbutton', { name: '组织容量GiB' }), { target: { value: '' } });
  expect(dialog.getByRole('button', { name: /保\s*存/ })).toBeDisabled(); expect(mutate).not.toHaveBeenCalled();
});

it.each([403, 409])('keeps capacity input and original retry on %s', async status => {
  scope.permissions = ['integration:receipts:read', 'integration:manage'];
  mutate.mockRejectedValueOnce(new ApiError({ code: status === 409 ? 'CONCURRENCY_CONFLICT' : 'FEATURE_PERMISSION_DENIED', message: 'failed', traceId: 'capacity-trace' }, status));
  view(); await screen.findByText('message-001'); fireEvent.click(screen.getByRole('button', { name: '设置组织正文容量' }));
  const dialog = within(screen.getByRole('dialog', { name: '设置组织正文容量' }));
  fireEvent.change(dialog.getByRole('spinbutton', { name: '组织容量GiB' }), { target: { value: '5' } }); fireEvent.click(dialog.getByRole('button', { name: /保\s*存/ }));
  await waitFor(() => expect(dialog.getByRole('alert')).toBeVisible()); expect(dialog.getByRole('spinbutton', { name: '组织容量GiB' })).toHaveValue('5'); await waitFor(() => expect(dialog.getByRole('button', { name: /保\s*存/ })).toBeVisible());
});

it('keeps the original capacity request for an unknown result and offers retry', async () => {
  scope.permissions = ['integration:receipts:read', 'integration:manage'];
  mutate.mockRejectedValueOnce(new ApiError({ code: 'INTEGRATION_CONFIGURATION_UNAVAILABLE', message: 'failed', traceId: 'capacity-unknown' }, 503));
  view(); await screen.findByText('message-001'); fireEvent.click(screen.getByRole('button', { name: '设置组织正文容量' }));
  const dialog = within(screen.getByRole('dialog', { name: '设置组织正文容量' }));
  fireEvent.change(dialog.getByRole('spinbutton', { name: '组织容量GiB' }), { target: { value: '5' } }); fireEvent.click(dialog.getByRole('button', { name: /保\s*存/ }));
  await waitFor(() => expect(dialog.getByRole('button', { name: /重试\s*保存/ })).toBeVisible()); expect(dialog.getByRole('spinbutton', { name: '组织容量GiB' })).toBeDisabled();
  expect(within(screen.getByRole('toolbar', { name: '接收记录操作' })).getByRole('button', { name: '清空筛选' })).toBeDisabled();
  expect(mutate).toHaveBeenCalledTimes(1);
});

it('does not offer organization capacity editing without integration management', async () => {
  scope.permissions = ['integration:receipts:read']; view(); await screen.findByText('message-001');
  expect(screen.getByRole('button', { name: '设置组织正文容量' })).toBeDisabled();
});

it('does not close or refresh from a late capacity response after session ABA', async () => {
  scope.permissions = ['integration:receipts:read', 'integration:manage'];
  let resolve!: (value: unknown) => void;
  mutate.mockReturnValueOnce(new Promise(done => { resolve = done; }));
  view(); await screen.findByText('message-001'); fireEvent.click(screen.getByRole('button', { name: '设置组织正文容量' }));
  const dialog = within(screen.getByRole('dialog', { name: '设置组织正文容量' }));
  fireEvent.change(dialog.getByRole('spinbutton', { name: '组织容量GiB' }), { target: { value: '5' } }); fireEvent.click(dialog.getByRole('button', { name: /保\s*存/ }));
  act(() => { useWorkTabsStore.getState().bindSession(`INTERNAL:${organizationId}:other`); useWorkTabsStore.getState().bindSession(`INTERNAL:${organizationId}:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa`); });
  await act(async () => resolve({ usedBodyBytes: 20, capacityBytes: 5368709120, receiptCount: 1, receiptLimit: 100000, requestCollection: 'UNKNOWN' }));
  expect(screen.getByRole('dialog', { name: '设置组织正文容量' })).toBeInTheDocument();
});

it('does not disclose a payload or provide a payload action without its separate permission', async () => {
  scope.permissions = ['integration:receipts:read']; view(); await screen.findByText('message-001');
  fireEvent.click(screen.getByRole('button', { name: '查看消息message-001' }));
  const dialog = within(await screen.findByRole('dialog', { name: '接收详情' }));
  expect(dialog.queryByRole('button', { name: '查看接收正文' })).not.toBeInTheDocument();
  expect(read.mock.calls.some(([path]) => path.includes('/payload'))).toBe(false);
});

it('renders an authorized payload as text rather than executing markup', async () => {
  const payload = '<img src=x onerror=alert(1)><script>private()</script>';
  read.mockImplementation(async path => path.includes('/payload') ? { id: receiptId, text: payload, bodyExpiresAt: receipt.bodyExpiresAt }
    : path.includes('/status') ? { usedBodyBytes: 20, capacityBytes: 1073741824, receiptCount: 1, receiptLimit: 100000, requestCollection: 'UNKNOWN' } : page(path));
  view(); await screen.findByText('message-001'); fireEvent.click(screen.getByRole('button', { name: '查看消息message-001' }));
  const dialog = within(await screen.findByRole('dialog', { name: '接收详情' }));
  await waitFor(() => expect(dialog.getByText(payload)).toBeVisible());
  const body = dialog.getByLabelText('接收正文'); expect(body.tagName).toBe('PRE'); expect(body.querySelector('img,script')).toBeNull();
});

it('loads an authorized payload automatically and keeps it in a scrollable frame with copy action', async () => {
  const payload = '[{"MTRL_ID":"M20261109001"}]';
  read.mockImplementation(async path => path.includes('/payload') ? { id: receiptId, text: payload, bodyExpiresAt: receipt.bodyExpiresAt }
    : path.includes('/status') ? { usedBodyBytes: 20, capacityBytes: 1073741824, receiptCount: 1, receiptLimit: 100000, requestCollection: 'UNKNOWN' } : page(path));
  view(); await screen.findByText('message-001'); fireEvent.click(screen.getByRole('button', { name: '查看消息message-001' }));
  const dialog = within(await screen.findByRole('dialog', { name: '接收详情' }));
  const body = await dialog.findByLabelText('接收正文');
  expect(body).toHaveTextContent(payload); expect(body).toHaveClass('qms-integration-payload');
  const copy = await dialog.findByLabelText('复制接收正文');
  expect(copy).toHaveRole('button'); expect(copy).toHaveAccessibleName('复制接收正文');
  await waitFor(() => expect(copy).toBeVisible());
  fireEvent.click(copy);
  await waitFor(() => expect(clipboard).toHaveBeenCalledWith(payload));
  expect(await dialog.findByText('已复制接收正文')).toBeVisible();
});

it('keeps scrolling in the payload while the dialog title and footer stay outside it', async () => {
  read.mockImplementation(async path => path.includes('/payload') ? { id: receiptId, text: 'line\n'.repeat(500), bodyExpiresAt: receipt.bodyExpiresAt } : page(path));
  const style = document.createElement('style');
  style.textContent = readFileSync('src/console/api-integrations/api-integrations.css', 'utf8');
  document.head.append(style);
  try {
    view(); await screen.findByText('message-001'); fireEvent.click(await screen.findByLabelText('查看消息message-001'));
    const dialog = await screen.findByRole('dialog', { name: '接收详情' });
    const payload = await within(dialog).findByLabelText('接收正文');
    const body = payload.closest<HTMLElement>('.ant-modal-body')!;
    expect(getComputedStyle(payload).overflow).toBe('auto');
    expect(getComputedStyle(body).overflow).toBe('hidden');
    expect(getComputedStyle(dialog.closest<HTMLElement>('.ant-modal-wrap')!).overflow).toBe('hidden');
    expect(body.closest<HTMLElement>('.ant-modal-container')?.style.maxHeight).toContain('100dvh');
    expect(within(body).getByText(receipt.id)).toBeInTheDocument();
    expect(within(body).getByText(receipt.endpointName)).toBeInTheDocument();
    const fullReceiptId = within(body).getByLabelText(`接收编号：${receipt.id}`);
    expect(fullReceiptId).toHaveRole('button');
    expect(fullReceiptId).toHaveAccessibleName(`接收编号：${receipt.id}`);
    expect(fullReceiptId).toHaveAttribute('title', receipt.id);
    fireEvent.click(fullReceiptId);
    expect(await screen.findByText(receipt.id, { selector: '.qms-integration-detail-value-popover' })).toBeInTheDocument();
    expect(body).not.toContainElement(within(dialog).getByText('接收详情'));
    expect(body).not.toContainElement(within(dialog).getByRole('button', { name: '关闭' }));
  } finally { style.remove(); }
});

it('presents an inset, translucent copy icon with an accessible label', async () => {
  read.mockImplementation(async path => path.includes('/payload') ? { id: receiptId, text: 'payload', bodyExpiresAt: receipt.bodyExpiresAt } : page(path));
  const style = document.createElement('style');
  style.textContent = readFileSync('src/console/api-integrations/api-integrations.css', 'utf8');
  document.head.append(style);
  try {
    view(); await screen.findByText('message-001'); fireEvent.click(await screen.findByLabelText('查看消息message-001'));
    const dialog = within(await screen.findByRole('dialog', { name: '接收详情' }));
    const copy = await dialog.findByLabelText('复制接收正文');
    expect(copy).toHaveRole('button'); expect(copy).toHaveAccessibleName('复制接收正文');
    await waitFor(() => expect(copy).toBeVisible());
    expect(copy.querySelector('svg.lucide-copy')).toHaveAttribute('aria-hidden', 'true');
    expect(copy.textContent).toBe('');
    const copyStyle = getComputedStyle(copy);
    expect(Number(copyStyle.opacity)).toBeGreaterThan(0);
    expect(Number(copyStyle.opacity)).toBeLessThan(1);
    expect(Number.parseFloat(copyStyle.right)).toBeGreaterThanOrEqual(20);
  } finally { style.remove(); }
});

it('does not reopen a closed payload detail when its response arrives late', async () => {
  let resolve!: (value: unknown) => void;
  read.mockImplementation(async path => path.includes('/payload') ? new Promise(done => { resolve = done; })
    : path.includes('/status') ? { usedBodyBytes: 20, capacityBytes: 1073741824, receiptCount: 1, receiptLimit: 100000, requestCollection: 'UNKNOWN' } : page(path));
  view(); await screen.findByText('message-001'); fireEvent.click(screen.getByRole('button', { name: '查看消息message-001' }));
  const dialog = within(await screen.findByRole('dialog', { name: '接收详情' }));
  fireEvent.click(dialog.getByRole('button', { name: '关闭' }));
  await act(async () => resolve({ id: receiptId, text: 'OLD_PRIVATE_PAYLOAD', bodyExpiresAt: receipt.bodyExpiresAt }));
  expect(screen.queryByText('OLD_PRIVATE_PAYLOAD')).not.toBeInTheDocument();
});

it('rejects receipt metadata for another organization before displaying it', async () => {
  read.mockImplementation(async path => path.includes('/status') ? { usedBodyBytes: 20, capacityBytes: 1073741824, receiptCount: 1, receiptLimit: 100000, requestCollection: 'UNKNOWN' }
    : { ...page(path), items: [{ ...receipt, organizationId: endpointId }] });
  view(); await waitFor(() => expect(scope.deny).toHaveBeenCalled()); expect(screen.queryByText('message-001')).not.toBeInTheDocument();
});

it('queries request outcomes by their server trace ID and exposes collection gaps', async () => {
  read.mockImplementation(async path => path.includes('/attempts') ? { ...page(path), collectionStatus: 'UNAVAILABLE', items: [{ id: traceId, traceId, organizationId, endpointId, credentialId: receiptId,
    messageId: 'message-001', configurationVersion: 2, returnReceipt: false, statusCode: 409, outcome: 'REJECTED', reasonCode: 'INTEGRATION_MESSAGE_CONFLICT', durationMs: 4, observedAt: receipt.receivedAt }] }
    : path.includes('/status') ? { usedBodyBytes: 20, capacityBytes: 1073741824, receiptCount: 1, receiptLimit: 100000, requestCollection: 'UNAVAILABLE' } : page(path));
  view(); await screen.findByText('message-001'); openFilters();
  fireEvent.mouseDown(screen.getByLabelText('记录视图', { selector: 'input' })); fireEvent.click(await screen.findByText('请求结果', { selector: '.ant-select-item-option-content' }));
  expect(await screen.findByText('INTEGRATION_MESSAGE_CONFLICT')).toBeVisible(); expect(screen.getByText('请求明细采集不可用，部分请求可能没有记录')).toBeVisible();
  fireEvent.change(screen.getByLabelText('请求追踪号', { selector: 'input' }), { target: { value: traceId } }); fireEvent.click(screen.getByRole('button', { name: '应用筛选' }));
  await waitFor(() => expect(read.mock.calls.some(([path]) => path.includes(`traceId=${traceId}`))).toBe(true));
});

it('filters both receiving views by a trimmed source code and resets it when switching views', async () => {
  read.mockImplementation(async path => path.includes('/attempts') ? { ...page(path), items: [], total: 0, collectionStatus: 'UNKNOWN' }
    : path.includes('/status') ? { usedBodyBytes: 20, capacityBytes: 1073741824, receiptCount: 1, receiptLimit: 100000, requestCollection: 'UNKNOWN' } : page(path));
  view(); await screen.findByText('message-001'); openFilters();
  fireEvent.change(screen.getByLabelText('来源系统编码', { selector: 'input' }), { target: { value: ' MES ' } });
  fireEvent.click(screen.getByRole('button', { name: '应用筛选' }));
  await waitFor(() => expect(read.mock.calls.some(([path]) => path.includes('/receipts?') && new URL(path, 'http://localhost').searchParams.get('sourceCode') === 'MES')).toBe(true));
  fireEvent.mouseDown(screen.getByLabelText('记录视图', { selector: 'input' }));
  fireEvent.click(await screen.findByText('请求结果', { selector: '.ant-select-item-option-content' }));
  expect(screen.getByLabelText('来源系统编码', { selector: 'input' })).toHaveValue('');
  fireEvent.change(screen.getByLabelText('来源系统编码', { selector: 'input' }), { target: { value: ' ERP ' } });
  fireEvent.click(screen.getByRole('button', { name: '应用筛选' }));
  await waitFor(() => expect(read.mock.calls.some(([path]) => path.includes('/attempts?') && new URL(path, 'http://localhost').searchParams.get('sourceCode') === 'ERP')).toBe(true));
});

it('rejects malformed or oversized source codes without requesting records', async () => {
  view(); await screen.findByText('message-001'); openFilters();
  const callsBeforeInvalidInput = read.mock.calls.length;
  for (const sourceCode of ['invalid source', 'A'.repeat(65)]) {
    fireEvent.change(screen.getByLabelText('来源系统编码', { selector: 'input' }), { target: { value: sourceCode } });
    fireEvent.click(screen.getByRole('button', { name: '应用筛选' }));
    expect(screen.getByRole('alert')).toBeVisible();
    expect(read.mock.calls).toHaveLength(callsBeforeInvalidInput);
  }
});

it('supports selecting the current page and confirming a bulk receipt deletion', async () => {
  scope.permissions = ['integration:receipts:read', 'integration:manage'];
  read.mockImplementation(async path => path.includes('/status')
    ? { usedBodyBytes: 40, capacityBytes: 1073741824, receiptCount: 2, receiptLimit: 100000, requestCollection: 'UNKNOWN' }
    : { ...page(path), items: [receipt, secondReceipt], total: 2 });
  view(); await screen.findByText('message-002');
  const selectPage = screen.getByRole('checkbox', { name: '选择当前页' });
  expect(selectPage).not.toBeChecked();
  fireEvent.click(selectPage);
  expect(screen.getByText('已选择 2 条')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: '删除所选' }));
  const confirm = await screen.findByRole('dialog');
  expect(confirm).toHaveTextContent('确认删除选中的 2 条接收记录');
  await waitFor(() => expect(within(confirm).getByRole('button', { name: '删除' })).toBeVisible());
});

it('keeps receipt selection compact and allows widening it without changing the selected records', async () => {
  scope.permissions = ['integration:receipts:read', 'integration:manage'];
  view(); await screen.findByText('message-001');
  const selectPage = screen.getByRole('checkbox', { name: '选择当前页' });
  const column = screen.getByRole('table').querySelector<HTMLElement>('col.ant-table-selection-col');
  expect(column).toHaveStyle({ width: '44px' });
  fireEvent.click(selectPage);
  fireEvent.click(screen.getByRole('button', { name: '列设置' }));
  const width = screen.getByRole('spinbutton', { name: '列宽 选择' });
  fireEvent.change(width, { target: { value: '56' } });
  fireEvent.blur(width);
  expect(column).toHaveStyle({ width: '56px' });
  fireEvent.keyDown(screen.getByRole('separator', { name: '调整列宽 选择' }), { key: 'ArrowRight' });
  expect(column).toHaveStyle({ width: '66px' });
  expect(selectPage).toBeChecked();
  expect(screen.getByText('已选择 1 条')).toBeVisible();
});

it('distributes spare space among business columns without adding an empty trailing column', async () => {
  scope.permissions = ['integration:receipts:read', 'integration:manage'];
  view(); await screen.findByText('message-001');
  const table = screen.getByRole('table');
  expect(table).toHaveStyle({ minWidth: '100%' });
  expect(table.querySelectorAll('thead th')).toHaveLength(6);
  expect(table.querySelector('thead tr')?.lastElementChild).toHaveTextContent('详情');
  expect(table.querySelector('.qms-integration-table-fill')).toBeNull();
  const actionColumn = table.querySelectorAll('col')[5];
  expect(actionColumn?.getAttribute('style')).toContain('%');
  expect(screen.getByRole('separator', { name: '调整列宽 详情' })).toHaveAttribute('aria-valuenow', '170');
  const previousWidth = actionColumn?.getAttribute('style');
  fireEvent.keyDown(screen.getByRole('separator', { name: '调整列宽 详情' }), { key: 'ArrowRight' });
  expect(screen.getByRole('separator', { name: '调整列宽 详情' })).toHaveAttribute('aria-valuenow', '180');
  expect(actionColumn?.getAttribute('style')).not.toEqual(previousWidth);
  const css = readFileSync('src/console/api-integrations/api-integrations.css', 'utf8');
  expect(css).not.toMatch(/min-width:\s*0\s*!important/);
  expect(css).not.toMatch(/col:last-child/);
});

it('offers single receipt deletion only to integration managers', async () => {
  scope.permissions = ['integration:receipts:read'];
  view(); await screen.findByText('message-001');
  expect(screen.queryByRole('button', { name: '删除消息message-001' })).not.toBeInTheDocument();
});

it('deletes the confirmed IDs through the scoped writer and refreshes records and capacity', async () => {
  scope.permissions = ['integration:receipts:read', 'integration:manage'];
  mutate.mockResolvedValue({ deletedCount: 1, receiptIds: [receiptId] });
  view(); await screen.findByText('message-001');
  const recordReads = read.mock.calls.filter(([path]) => path.includes('/receipts?')).length;
  const statusReads = read.mock.calls.filter(([path]) => path.includes('/status?')).length;
  fireEvent.click(screen.getByRole('button', { name: '删除消息message-001' }));
  const dialog = within(await screen.findByRole('dialog', { name: '删除接收记录' }));
  fireEvent.click(dialog.getByRole('button', { name: '删除' }));
  await waitFor(() => expect(mutate).toHaveBeenCalledWith('/api/v1/admin/integrations/receipts', 'DELETE', { organizationId, receiptIds: [receiptId] }, expect.any(AbortSignal)));
  await waitFor(() => expect(read.mock.calls.filter(([path]) => path.includes('/receipts?')).length).toBeGreaterThan(recordReads));
  expect(read.mock.calls.filter(([path]) => path.includes('/status?')).length).toBeGreaterThan(statusReads);
  expect(screen.queryByRole('dialog', { name: '删除接收记录' })).not.toBeInTheDocument();
});

it('removes its delete confirmation when the receiving page unmounts', async () => {
  scope.permissions = ['integration:receipts:read', 'integration:manage'];
  const mounted = view(); await screen.findByText('message-001');
  fireEvent.click(screen.getByRole('button', { name: '删除消息message-001' }));
  await screen.findByRole('dialog', { name: '删除接收记录' });
  mounted.unmount();
  expect(screen.queryByRole('dialog', { name: '删除接收记录' })).not.toBeInTheDocument();
  expect(mutate).not.toHaveBeenCalled();
});

it('searches interface names and codes with receipt-read access and submits the selected UUID', async () => {
  scope.permissions = ['integration:receipts:read'];
  view(); await screen.findByText('message-001'); openFilters();
  const selector = screen.getByRole('combobox', { name: '接口名称或编码' });
  fireEvent.change(selector, { target: { value: '物料' } });
  await waitFor(() => expect(read.mock.calls.some(([path]) => path.includes('/receipt-endpoints?') && new URL(path, 'http://localhost').searchParams.get('search') === '物料')).toBe(true));
  fireEvent.mouseDown(selector);
  fireEvent.click(await screen.findByText(/物料成品信息 \(part\)/, { selector: '.ant-select-item-option-content' }));
  fireEvent.click(screen.getByRole('button', { name: '应用筛选' }));
  await waitFor(() => expect(read.mock.calls.some(([path]) => path.includes('/receipts?') && new URL(path, 'http://localhost').searchParams.get('endpointId') === endpointId)).toBe(true));
  expect(read.mock.calls.some(([path]) => path.includes('/endpoints?'))).toBe(false);
});

it('loads all 21 matching endpoints despite a retained selection and retries a failed second page', async () => {
  const candidates = Array.from({ length: 21 }, (_, index) => ({
    id: `${String(index + 1).padStart(8, '0')}-aaaa-4aaa-8aaa-aaaaaaaaaaaa`,
    name: `B接口${String(index + 1).padStart(2, '0')}`, code: `B${index + 1}`,
  }));
  const candidateRequests: Array<{ search: string; page: number }> = [];
  let rejectSecondPage!: (cause: Error) => void;
  let secondPageAttempts = 0;
  read.mockImplementation(async path => {
    if (path.includes('/receipt-endpoints?')) {
      const query = new URL(path, 'http://localhost').searchParams;
      const search = query.get('search') ?? '';
      const candidatePage = Number(query.get('page'));
      candidateRequests.push({ search, page: candidatePage });
      if (search === 'A') return { items: [{ id: endpointId, name: 'A旧接口', code: 'A' }], total: 1, page: 1, limit: 20 };
      if (search === 'B' && candidatePage === 2 && ++secondPageAttempts === 1) {
        return new Promise((_resolve, reject) => { rejectSecondPage = reject; });
      }
      return { items: candidates.slice((candidatePage - 1) * 20, candidatePage * 20), total: 21, page: candidatePage, limit: 20 };
    }
    return path.includes('/status') ? { usedBodyBytes: 20, capacityBytes: 1073741824, receiptCount: 1, receiptLimit: 100000, requestCollection: 'UNKNOWN' } : page(path);
  });
  view(); await screen.findByText('message-001'); openFilters();
  const selector = screen.getByRole('combobox', { name: '接口名称或编码' });
  fireEvent.change(selector, { target: { value: 'A' } });
  fireEvent.mouseDown(selector);
  const oldOption = await screen.findByText(`A旧接口 (A) · ${endpointId}`, { selector: '.ant-select-item-option-content' });
  await waitFor(() => expect(oldOption).toBeVisible());
  fireEvent.click(oldOption);
  fireEvent.change(selector, { target: { value: 'B' } });
  fireEvent.mouseDown(selector);
  const firstMatch = await screen.findByText(`B接口01 (B1) · ${candidates[0]!.id}`, { selector: '.ant-select-item-option-content' });
  await waitFor(() => expect(firstMatch).toBeVisible());
  const loadMore = await screen.findByRole('button', { name: '加载更多接口' });
  await waitFor(() => expect(loadMore).toBeEnabled());
  expect(loadMore).toHaveAttribute('type', 'button');
  const recordReads = read.mock.calls.filter(([path]) => path.includes('/receipts?')).length;
  fireEvent.click(loadMore);
  await waitFor(() => expect(candidateRequests.filter(request => request.search === 'B' && request.page === 2)).toHaveLength(1));
  expect(loadMore).toBeDisabled();
  await act(async () => rejectSecondPage(new Error('candidate page unavailable')));
  const failure = await screen.findByRole('alert');
  expect(failure).toHaveTextContent('接口候选加载失败，请重试');
  expect(firstMatch).toBeVisible();
  expect(screen.getByText(`A旧接口 (A) · ${endpointId}`, { selector: '.ant-select-item-option-content' })).toBeInTheDocument();
  const retry = within(failure).getByRole('button');
  await waitFor(() => expect(retry).toBeEnabled());
  fireEvent.click(retry);
  await waitFor(() => expect(candidateRequests.filter(request => request.search === 'B' && request.page === 2)).toHaveLength(2));
  expect(candidateRequests.at(-1)).toEqual({ search: 'B', page: 2 });
  await waitFor(() => expect(screen.queryByRole('button', { name: '加载更多接口' })).not.toBeInTheDocument());
  expect(candidateRequests.filter(request => request.search === 'B' && request.page === 2)).toHaveLength(2);
  expect(screen.queryByRole('button', { name: '加载更多接口' })).not.toBeInTheDocument();
  expect(read.mock.calls.filter(([path]) => path.includes('/receipts?'))).toHaveLength(recordReads);
}, 20_000);

it('reports clipboard failure without claiming that the payload was copied', async () => {
  clipboard.mockRejectedValue(new Error('clipboard denied'));
  read.mockImplementation(async path => path.includes('/payload') ? { id: receiptId, text: '[{}]', bodyExpiresAt: receipt.bodyExpiresAt }
    : path.includes('/status') ? { usedBodyBytes: 20, capacityBytes: 1073741824, receiptCount: 1, receiptLimit: 100000, requestCollection: 'UNKNOWN' } : page(path));
  view(); await screen.findByText('message-001'); fireEvent.click(screen.getByRole('button', { name: '查看消息message-001' }));
  const dialog = within(await screen.findByRole('dialog', { name: '接收详情' }));
  fireEvent.click(await dialog.findByRole('button', { name: '复制接收正文' }));
  expect(await dialog.findByRole('alert')).toHaveTextContent('复制失败，请重试');
  expect(dialog.queryByText('已复制接收正文')).not.toBeInTheDocument();
});

it('ignores the first StrictMode payload request and renders only the second response', async () => {
  const resolvers: Array<(value: unknown) => void> = [];
  read.mockImplementation(async (path) => path.includes('/payload')
    ? new Promise(resolve => { resolvers.push(resolve); })
    : path.includes('/status') ? { usedBodyBytes: 20, capacityBytes: 1073741824, receiptCount: 1, receiptLimit: 100000, requestCollection: 'UNKNOWN' } : page(path));
  render(<StrictMode><LanguageProvider><ConsoleTheme><MemoryRouter><UnsavedChangesProvider><ReceiptList scope={scope} /></UnsavedChangesProvider></MemoryRouter></ConsoleTheme></LanguageProvider></StrictMode>);
  await screen.findByText('message-001'); fireEvent.click(screen.getByRole('button', { name: '查看消息message-001' }));
  const dialog = within(await screen.findByRole('dialog', { name: '接收详情' }));
  await waitFor(() => expect(resolvers.length).toBe(2));
  const currentResolver = resolvers.at(-1)!;
  await act(async () => currentResolver({ id: receiptId, text: 'CURRENT_PAYLOAD', bodyExpiresAt: receipt.bodyExpiresAt }));
  await waitFor(() => expect(dialog.getByText('CURRENT_PAYLOAD')).toBeVisible());
  await act(async () => resolvers[0]!({ id: receiptId, text: 'OLD_PAYLOAD', bodyExpiresAt: receipt.bodyExpiresAt }));
  expect(dialog.queryByText('OLD_PAYLOAD')).not.toBeInTheDocument();
});

it('keeps a known delete failure visible after refreshing the record list', async () => {
  scope.permissions = ['integration:receipts:read', 'integration:manage'];
  mutate.mockRejectedValue(new ApiError({ code: 'INTEGRATION_RECEIPT_NOT_FOUND', message: 'missing' }, 404));
  view(); await screen.findByText('message-001'); fireEvent.click(screen.getByRole('button', { name: '删除消息message-001' }));
  const dialog = within(await screen.findByRole('dialog', { name: '删除接收记录' })); fireEvent.click(dialog.getByRole('button', { name: '删除' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('删除未完成，请检查后重试');
  const refresh = await screen.findByRole('button', { name: '刷新记录' });
  await waitFor(() => expect(refresh).toBeEnabled());
  fireEvent.click(refresh);
  expect(await screen.findByRole('alert')).toHaveTextContent('删除未完成，请检查后重试');
});

it.each([408, 500])('keeps the original delete request and navigation busy for an unknown %s result', async status => {
  scope.permissions = ['integration:receipts:read', 'integration:manage'];
  mutate.mockRejectedValue(new ApiError({ code: `HTTP_${status}`, message: 'unknown' }, status));
  view(); await screen.findByText('message-001'); fireEvent.click(screen.getByRole('button', { name: '删除消息message-001' }));
  const dialog = within(await screen.findByRole('dialog', { name: '删除接收记录' })); fireEvent.click(dialog.getByRole('button', { name: '删除' }));
  await waitFor(() => expect(screen.getAllByRole('alert').every(alert => alert.textContent?.includes('删除结果未确认'))).toBe(true));
  expect(await dialog.findByRole('button', { name: '重试删除' })).toBeVisible();
  expect(screen.getByRole('button', { name: '刷新记录' })).toBeDisabled();
  expect(dialog.getByRole('button', { name: '取消' })).toBeDisabled();
  const unload = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(unload);
  expect(unload.defaultPrevented).toBe(true);
  fireEvent.click(dialog.getByRole('button', { name: '重试删除' }));
  await waitFor(() => expect(mutate).toHaveBeenCalledTimes(2));
  expect(mutate.mock.calls[1]![2]).toEqual(mutate.mock.calls[0]![2]);
});
