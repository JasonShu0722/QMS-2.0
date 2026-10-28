import type { components } from '@qms/contracts';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ConfigProvider } from 'antd';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ApiError, apiRequest, csrfToken, getSession } from '../../api/client';
import { LanguageProvider } from '../../i18n/Language';
import { UnsavedChangesProvider, useNavigationGuard } from '../../layouts/UnsavedChanges';
import { useWorkTabsStore } from '../../work-tabs/workTabsStore';
import { SupplierSourceCopyDialog } from './SupplierSourceCopyDialog';

vi.mock('../../api/client', async original => ({ ...await original<typeof import('../../api/client')>(), apiRequest: vi.fn(), csrfToken: vi.fn(), getSession: vi.fn() }));
const org = '22222222-2222-4222-8222-222222222222';
const profile = '33333333-3333-4333-8333-333333333333';
const enterprise = '44444444-4444-4444-8444-444444444444';
const sourceId = '11111111-1111-4111-8111-111111111111';
const draftId = '55555555-5555-4555-8555-555555555555';
const sources: components['schemas']['SupplierCopySourceDto'][] = [{ kind: 'PROCESS_LEDGER', sourceId, sourceVersion: 4, materialItemId: '66666666-6666-4666-8666-666666666666' }, { kind: 'CUSTOMER_LEDGER', sourceId, sourceVersion: 2 }, { kind: 'NEW_PRODUCT_SELECTION', sourceId, sourceVersion: 7 }];
const preview: components['schemas']['SupplierCopyPreviewDto'] = { token: '77777777-7777-4777-8777-777777777777', expiresAt: '2099-01-01T00:00:00Z', facts: [{ factKey: 'fact:1', defectDescription: '最小不良描述', defectQuantity: 9, materials: [{ id: 'unknown', materialCode: null, materialName: null, materialBatch: null }] }] };
const base = '/api/v1/supplier-quality/source-copies';
afterEach(() => vi.restoreAllMocks());
beforeEach(() => {
  vi.resetAllMocks(); useWorkTabsStore.getState().reset(); useWorkTabsStore.getState().bindSession(`INTERNAL:${org}:sqe`);
  vi.mocked(getSession).mockResolvedValue({ userId: 'sqe', organizationId: org, accountType: 'INTERNAL', landingPath: '/app/workbench' });
  vi.mocked(csrfToken).mockResolvedValue('csrf');
  vi.mocked(apiRequest).mockImplementation(async path => {
    if (path.includes('/reference-options')) return { items: [{ id: profile, label: '目标供应商档案', supplierOrganizationId: enterprise }], total: 1 };
    if (path === `${base}/preview`) return preview;
    if (path === `${base}/drafts`) return { id: draftId, version: 1, stage: 'DRAFT' };
    throw new Error(`Unexpected API: ${path}`);
  });
});
function RefreshProbe({ refresh }: { refresh: () => void }) {
  const leave = useNavigationGuard();
  return <button onClick={() => leave(refresh)}>刷新来源父页</button>;
}
function mount(onDenied = vi.fn(), onClose = vi.fn(), refresh?: () => void) {
  return render(<ConfigProvider theme={{ token: { motion: false } }}><MemoryRouter><LanguageProvider><UnsavedChangesProvider>{refresh && <RefreshProbe refresh={refresh} />}<SupplierSourceCopyDialog organizationId={org} sources={sources} onDenied={onDenied} onClose={onClose} /></UnsavedChangesProvider></LanguageProvider></MemoryRouter></ConfigProvider>);
}
async function openPreview() {
  fireEvent.mouseDown(screen.getByLabelText('目标供应商档案'));
  fireEvent.click(await screen.findByText('目标供应商档案', { selector: '.ant-select-item-option-content' }));
  fireEvent.click(screen.getByRole('button', { name: '读取受控预览' }));
  await screen.findByLabelText('草稿标题');
}
async function fillDraft() {
  fireEvent.change(screen.getByLabelText('不良物料号'), { target: { value: 'MANUAL-MATERIAL' } });
  fireEvent.change(screen.getByLabelText('不良数量'), { target: { value: '2' } });
  fireEvent.click(screen.getByLabelText('高'));
  fireEvent.click(screen.getByLabelText(/我已人工审核/));
}
const createCalls = () => vi.mocked(apiRequest).mock.calls.filter(([path]) => path === `${base}/drafts`);

it('blocks parent navigation while a copied draft request has an unknown outcome', async () => {
  const regular = vi.mocked(apiRequest).getMockImplementation()!;
  const refresh = vi.fn();
  vi.mocked(apiRequest).mockImplementation(async (path, init, options) => {
    if (path === `${base}/drafts`) throw new TypeError('Response lost');
    return regular(path, init, options);
  });
  mount(vi.fn(), vi.fn(), refresh); await openPreview(); await fillDraft();
  fireEvent.click(screen.getByRole('button', { name: '创建供应商草稿' }));
  await screen.findByRole('button', { name: '重试原创建请求' });
  fireEvent.click(screen.getByRole('button', { name: '刷新来源父页' }));
  expect(screen.queryByText('当前草稿尚未保存，继续将放弃修改。')).not.toBeInTheDocument();
  expect(refresh).not.toHaveBeenCalled();
  expect(createCalls()).toHaveLength(1);
});

it('previews exact source references with profile ID, requires manual quantity/risk/review, and creates only a draft', async () => {
  mount(); await openPreview();
  const request = vi.mocked(apiRequest).mock.calls.find(([path]) => path === `${base}/preview`)!;
  expect(JSON.parse(String(request[1]?.body))).toEqual({ organizationId: org, supplierProfileId: profile, sources });
  expect(screen.getByLabelText('不良物料号')).toHaveValue('');
  expect(screen.getByLabelText('不良数量')).toHaveValue('');
  expect(screen.getByLabelText('高')).not.toBeChecked();
  fireEvent.click(screen.getByRole('button', { name: '创建供应商草稿' }));
  await waitFor(() => expect(screen.getByText('请填写不良物料号')).toBeVisible());
  expect(createCalls()).toHaveLength(0);
  await fillDraft();
  fireEvent.change(screen.getByLabelText('草稿标题'), { target: { value: '人工审阅后标题' } });
  fireEvent.change(screen.getByLabelText('对外不良描述'), { target: { value: '已核查自由文本' } });
  fireEvent.click(screen.getByRole('button', { name: '创建供应商草稿' }));
  expect(await screen.findByRole('link', { name: '打开供应商草稿' })).toHaveAttribute('href', `/app/supplier-quality/problems/${draftId}?organizationId=${org}`);
  expect(JSON.parse(String(createCalls()[0][1]?.body))).toEqual({ organizationId: org, token: preview.token, draft: { organizationId: org, profileId: profile, title: '人工审阅后标题', materialCode: 'MANUAL-MATERIAL', defectDescription: '已核查自由文本', defectQuantity: 2, severity: 'HIGH', responseForm: 'EIGHT_D', replyMode: 'SUPPLIER' } });
  expect(vi.mocked(apiRequest).mock.calls.filter(([, init]) => init?.method).map(([path]) => path)).toEqual([`${base}/preview`, `${base}/drafts`]);
});
it('retains edits on 409 and allows explicit fresh preview without silently overwriting the draft', async () => {
  const read = vi.mocked(apiRequest).getMockImplementation()!;
  let token = preview.token;
  vi.mocked(apiRequest).mockImplementation(async (path, init) => {
    if (path === `${base}/drafts`) { token = '88888888-8888-4888-8888-888888888888'; throw new ApiError({ code: 'CONCURRENCY_CONFLICT', message: '' }, 409); }
    if (path === `${base}/preview`) return { ...preview, token, facts: [{ ...preview.facts[0], defectDescription: '服务端新事实' }] };
    return read(path, init);
  });
  mount(); await openPreview(); await fillDraft();
  fireEvent.change(screen.getByLabelText('对外不良描述'), { target: { value: '保留人工改稿' } });
  fireEvent.click(screen.getByRole('button', { name: '创建供应商草稿' }));
  const refresh = await screen.findByRole('button', { name: '重新读取受控预览' });
  expect(screen.getByLabelText('对外不良描述')).toHaveValue('保留人工改稿');
  fireEvent.click(refresh);
  await waitFor(() => expect(vi.mocked(apiRequest).mock.calls.filter(([path]) => path === `${base}/preview`)).toHaveLength(2));
  expect(screen.getByLabelText('对外不良描述')).toHaveValue('保留人工改稿');
  expect(screen.getByLabelText(/我已人工审核/)).not.toBeChecked();
  expect(createCalls()).toHaveLength(1);
});
it('freezes an unknown create and retries only the original body/key after an explicit click', async () => {
  const read = vi.mocked(apiRequest).getMockImplementation()!; let attempt = 0;
  vi.mocked(apiRequest).mockImplementation(async (path, init) => { if (path === `${base}/drafts` && attempt++ === 0) throw new TypeError('Network interrupted'); return read(path, init); });
  mount(); await openPreview(); await fillDraft();
  fireEvent.click(screen.getByRole('button', { name: '创建供应商草稿' }));
  const retry = await screen.findByRole('button', { name: '重试原创建请求' });
  expect(createCalls()).toHaveLength(1);
  expect(screen.getByLabelText('草稿标题')).toBeDisabled();
  expect(screen.getByRole('button', { name: '重新读取受控预览' })).toBeDisabled();
  vi.spyOn(Date, 'now').mockReturnValue(Date.parse(preview.expiresAt) + 1);
  fireEvent.click(retry);
  await screen.findByRole('link', { name: '打开供应商草稿' });
  expect(createCalls()).toHaveLength(2);
  expect(createCalls()[1][1]?.body).toBe(createCalls()[0][1]?.body);
  expect(createCalls()[1][1]?.headers).toEqual(createCalls()[0][1]?.headers);
});
it('rejects fractional quantity rather than silently rounding it into a different submitted value', async () => {
  mount(); await openPreview(); await fillDraft();
  fireEvent.change(screen.getByLabelText('不良数量'), { target: { value: '1.5' } });
  fireEvent.blur(screen.getByLabelText('不良数量'));
  fireEvent.click(screen.getByRole('button', { name: '创建供应商草稿' }));
  await screen.findByText('请输入1至2147483647的整数');
  expect(createCalls()).toHaveLength(0);
});
it.each([0, 2147483648])('rejects out-of-range quantity %s without clamping user input', async quantity => {
  mount(); await openPreview(); await fillDraft();
  fireEvent.change(screen.getByLabelText('不良数量'), { target: { value: String(quantity) } });
  fireEvent.blur(screen.getByLabelText('不良数量'));
  fireEvent.click(screen.getByRole('button', { name: '创建供应商草稿' }));
  await screen.findByText('请输入1至2147483647的整数');
  expect(screen.getByLabelText('不良数量')).toHaveValue(String(quantity));
  expect(createCalls()).toHaveLength(0);
});
it('locks duplicate create and dismissal while a write is in flight', async () => {
  const read = vi.mocked(apiRequest).getMockImplementation()!;
  let resolve: (value: components['schemas']['SupplierCopyDraftReceiptDto']) => void = () => {};
  vi.mocked(apiRequest).mockImplementation(async (path, init) => path === `${base}/drafts`
    ? new Promise<components['schemas']['SupplierCopyDraftReceiptDto']>(done => { resolve = done; }) : read(path, init));
  const close = vi.fn(); mount(vi.fn(), close); await openPreview(); await fillDraft();
  const create = screen.getByRole('button', { name: '创建供应商草稿' });
  fireEvent.click(create); fireEvent.click(create);
  await waitFor(() => expect(createCalls()).toHaveLength(1));
  expect(screen.getByLabelText('草稿标题')).toBeDisabled();
  expect(screen.getByRole('button', { name: '取消' })).toBeDisabled();
  const event = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(true);
  expect(close).not.toHaveBeenCalled();
  await act(async () => resolve({ id: draftId, version: 1, stage: 'DRAFT' }));
  await screen.findByRole('link', { name: '打开供应商草稿' });
});
it.each([401, 403])('clears target and aborts when server preview rejects access with %s', async status => {
  const read = vi.mocked(apiRequest).getMockImplementation()!; const denied = vi.fn();
  vi.mocked(apiRequest).mockImplementation(async (path, init) => { if (path === `${base}/preview`) throw new ApiError({ code: 'FEATURE_PERMISSION_DENIED', message: '' }, status); return read(path, init); });
  mount(denied);
  fireEvent.mouseDown(screen.getByLabelText('目标供应商档案'));
  fireEvent.click(await screen.findByText('目标供应商档案', { selector: '.ant-select-item-option-content' }));
  fireEvent.click(screen.getByRole('button', { name: '读取受控预览' }));
  await waitFor(() => expect(denied).toHaveBeenCalled());
  expect(screen.queryByLabelText('目标供应商档案')).not.toBeInTheDocument();
  expect(vi.mocked(apiRequest).mock.calls.find(([path]) => path === `${base}/preview`)?.[1]?.signal?.aborted).toBe(true);
});
it.each([401, 403])('clears sensitive inputs and aborts the writer after %s', async status => {
  const read = vi.mocked(apiRequest).getMockImplementation()!; const denied = vi.fn();
  vi.mocked(apiRequest).mockImplementation(async (path, init) => { if (path === `${base}/drafts`) throw new ApiError({ code: 'FEATURE_PERMISSION_DENIED', message: '' }, status); return read(path, init); });
  mount(denied); await openPreview(); await fillDraft();
  fireEvent.click(screen.getByRole('button', { name: '创建供应商草稿' }));
  await waitFor(() => expect(denied).toHaveBeenCalled());
  expect(screen.queryByLabelText('对外不良描述')).not.toBeInTheDocument();
  expect(screen.queryByText('最小不良描述')).not.toBeInTheDocument();
  expect(createCalls()[0][1]?.signal?.aborted).toBe(true);
});
it('protects all local dismissal paths and clears the component on session change', async () => {
  const denied = vi.fn(); const close = vi.fn(); mount(denied, close); await openPreview();
  fireEvent.click(screen.getByRole('button', { name: '取消' }));
  await waitFor(() => expect(screen.getByRole('button', { name: '继续编辑' })).toBeVisible(), { timeout: 5000 });
  expect(close).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '继续编辑' }));
  act(() => useWorkTabsStore.getState().bindSession(`INTERNAL:${org}:other`));
  await waitFor(() => expect(denied).toHaveBeenCalled());
  expect(screen.queryByLabelText('草稿标题')).not.toBeInTheDocument();
});

it.each([401, 403])('clears preview and edited inputs on current list GET %s', async status => {
  const read = vi.mocked(apiRequest).getMockImplementation()!; const denied = vi.fn();
  vi.mocked(apiRequest).mockImplementation(async (path, init) => {
    if (path.includes('/reference-options') && new URL(path, 'http://localhost').searchParams.get('search') === 'denied') throw new ApiError({ code: 'FEATURE_PERMISSION_DENIED', message: '' }, status);
    return read(path, init);
  });
  mount(denied); await openPreview(); await fillDraft();
  fireEvent.change(screen.getByLabelText('对外不良描述'), { target: { value: '敏感人工改稿' } });
  fireEvent.change(screen.getByLabelText('目标供应商档案', { selector: 'input[role="combobox"]' }), { target: { value: 'denied' } });
  await waitFor(() => expect(denied).toHaveBeenCalledTimes(1));
  expect(denied.mock.calls[0][0].status).toBe(status);
  expect(screen.queryByLabelText('目标供应商档案')).not.toBeInTheDocument();
  expect(screen.queryByLabelText('对外不良描述')).not.toBeInTheDocument();
  expect(screen.queryByText('最小不良描述')).not.toBeInTheDocument();
  expect(screen.queryByDisplayValue('敏感人工改稿')).not.toBeInTheDocument();
  expect(createCalls()).toHaveLength(0);
});

it.each([401, 403])('clears preview and edited inputs on current selectedId GET %s', async status => {
  const read = vi.mocked(apiRequest).getMockImplementation()!; const denied = vi.fn();
  let reject: (cause: unknown) => void = () => {};
  vi.mocked(apiRequest).mockImplementation(async (path, init) => {
    const url = new URL(path, 'http://localhost');
    if (url.pathname === '/api/v1/supplier-quality/reference-options' && url.searchParams.get('selectedId') === profile) return new Promise((_, fail) => { reject = fail; });
    return read(path, init);
  });
  mount(denied); await openPreview(); await fillDraft();
  fireEvent.change(screen.getByLabelText('对外不良描述'), { target: { value: '敏感人工改稿' } });
  await act(async () => reject(new ApiError({ code: 'FEATURE_PERMISSION_DENIED', message: '' }, status)));
  await waitFor(() => expect(denied).toHaveBeenCalledTimes(1));
  expect(denied.mock.calls[0][0].status).toBe(status);
  expect(screen.queryByLabelText('目标供应商档案')).not.toBeInTheDocument();
  expect(screen.queryByLabelText('对外不良描述')).not.toBeInTheDocument();
  expect(screen.queryByText('最小不良描述')).not.toBeInTheDocument();
  expect(screen.queryByDisplayValue('敏感人工改稿')).not.toBeInTheDocument();
  expect(createCalls()).toHaveLength(0);
});
