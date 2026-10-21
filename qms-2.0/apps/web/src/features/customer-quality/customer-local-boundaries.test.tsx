import { LanguageProvider } from '../../i18n/Language';
import { act, fireEvent, render as testingRender, screen, waitFor, within } from '@testing-library/react';
import { ConfigProvider } from 'antd';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { apiRequest, csrfToken } from '../../api/client';
import { UnsavedChangesProvider } from '../../layouts/UnsavedChanges';
import { CustomerMasterSection } from './CustomerMasterSection';
import { CustomerQualityPage } from './CustomerQualityPage';
import { CustomerComplaintEntry } from './CustomerComplaintEntry';

vi.setConfig({ testTimeout: 60_000 });
const render = (children: ReactNode) => testingRender(<ConfigProvider theme={{ token: { motion: false } }}>{children}</ConfigProvider>);

vi.mock('../../api/client', async () => ({ ...(await vi.importActual<typeof import('../../api/client')>('../../api/client')), apiRequest: vi.fn(), csrfToken: vi.fn() }));
vi.mock('../attachments/AttachmentPanel', () => ({ AttachmentPanel: () => null }));

const customers = [{ id: 'c1', code: 'C-1', name: '客户一', active: true, version: 1 }, { id: 'c2', code: 'C-2', name: '客户二', active: true, version: 1 }];
const complaint = { id: 'complaint-1', complaint_number: 'CQ-1', complaint_type: 'ZERO_KM', defect_description: '第一条客诉', severity: 'LOW', status: 'IN_ANALYSIS', version: 1, created_at: '2026-10-01', organization_id: 'org', category: 'PRODUCT_QUALITY', responsible_department_id: 'dept', owner_user_id: 'owner' };
const other = { ...complaint, id: 'complaint-2', complaint_number: 'CQ-2' };

beforeEach(() => {
  vi.mocked(csrfToken).mockReset().mockResolvedValue('csrf');
  vi.mocked(apiRequest).mockReset().mockImplementation(async (url) => {
    if (url.includes('/my-permissions')) return { organizationId: 'org', permissions: ['customer-quality:complaints:read', 'customer-quality:complaints:write'] };
    if (url.endsWith('/customers')) return customers;
    if (url.endsWith('/complaints')) return [complaint, other];
    if (url.endsWith('/complaint-1')) return complaint;
    if (url.endsWith('/complaint-2')) return other;
    if (url.endsWith('/assignees')) return { departments: [], users: [] };
    return [];
  });
});

async function selectCustomer(label: string) {
  fireEvent.mouseDown(await screen.findByLabelText('选择客户'));
  fireEvent.click(await screen.findByText(label));
}

it.each(['cancel', 'close', 'mask', 'escape'] as const)('protects an edited customer name on %s', async (action) => {
  render(<LanguageProvider><MemoryRouter><UnsavedChangesProvider><CustomerMasterSection /></UnsavedChangesProvider></MemoryRouter></LanguageProvider>);
  await selectCustomer('C-1 · 客户一');
  fireEvent.click(screen.getByRole('button', { name: '编辑客户' }));
  fireEvent.change(screen.getByLabelText('编辑名称'), { target: { value: '未保存名称' } });
  const dialog = screen.getByRole('dialog', { name: '编辑客户' });
  if (action === 'cancel') fireEvent.click(within(dialog).getByRole('button', { name: /取\s*消/ }));
  if (action === 'close') fireEvent.click(within(dialog).getByRole('button', { name: /close|关闭/i }));
  const wrap = dialog.closest('.ant-modal-wrap')!;
  if (action === 'mask') { fireEvent.mouseDown(wrap); fireEvent.mouseUp(wrap); fireEvent.click(wrap); }
  if (action === 'escape') fireEvent.keyDown(wrap, { key: 'Escape', keyCode: 27 });
  await waitFor(() => expect(screen.getByText('当前草稿尚未保存，继续将放弃修改。')).toBeVisible(), { timeout: 5000 });
  fireEvent.click(screen.getByRole('button', { name: '继续编辑' }));
  expect(screen.getByLabelText('编辑名称')).toHaveValue('未保存名称');
});

it.each(['cancel', 'close', 'mask', 'escape'] as const)('protects a complaint entry on %s', async (action) => {
  render(<LanguageProvider><MemoryRouter><UnsavedChangesProvider><CustomerComplaintEntry onCreated={vi.fn()} /></UnsavedChangesProvider></MemoryRouter></LanguageProvider>);
  fireEvent.click(screen.getByRole('button', { name: '人工登记客诉' }));
  fireEvent.change(screen.getByLabelText('不良描述'), { target: { value: '未登记的现象' } });
  const dialog = screen.getByRole('dialog', { name: '人工登记客诉' });
  if (action === 'cancel') fireEvent.click(within(dialog).getByRole('button', { name: /取\s*消/ }));
  if (action === 'close') fireEvent.click(within(dialog).getByRole('button', { name: /close|关闭/i }));
  const wrap = dialog.closest('.ant-modal-wrap')!;
  if (action === 'mask') { fireEvent.mouseDown(wrap); fireEvent.mouseUp(wrap); fireEvent.click(wrap); }
  if (action === 'escape') fireEvent.keyDown(wrap, { key: 'Escape', keyCode: 27 });
  await waitFor(() => expect(screen.getByText('当前草稿尚未保存，继续将放弃修改。')).toBeVisible(), { timeout: 5000 });
  fireEvent.click(screen.getByRole('button', { name: '继续编辑' }));
  expect(screen.getByLabelText('不良描述')).toHaveValue('未登记的现象');
});

it.each(['refresh', 'switch'] as const)('protects a new relation on customer %s', async (action) => {
  render(<LanguageProvider><MemoryRouter><UnsavedChangesProvider><CustomerMasterSection /></UnsavedChangesProvider></MemoryRouter></LanguageProvider>);
  await selectCustomer('C-1 · 客户一');
  fireEvent.change(screen.getByLabelText('关系代码'), { target: { value: 'UNSAVED' } });
  if (action === 'refresh') fireEvent.click(screen.getByRole('button', { name: '刷新客户' }));
  else await selectCustomer('C-2 · 客户二');
  await waitFor(() => expect(screen.getByText('当前草稿尚未保存，继续将放弃修改。')).toBeVisible(), { timeout: 5000 });
  fireEvent.click(screen.getByRole('button', { name: '继续编辑' }));
  expect(screen.getByLabelText('关系代码')).toHaveValue('UNSAVED');
});

it.each(['switch', 'refresh'] as const)('preserves an unfinished complaint progress note on %s', async (action) => {
  render(<LanguageProvider><MemoryRouter><UnsavedChangesProvider><CustomerQualityPage /></UnsavedChangesProvider></MemoryRouter></LanguageProvider>);
  fireEvent.click(await screen.findByRole('button', { name: 'CQ-1' }));
  fireEvent.change(await screen.findByLabelText('处理说明'), { target: { value: '未保存的进展' } });
  if (action === 'switch') {
    fireEvent.click(screen.getByRole('button', { name: 'CQ-2' }));
    await waitFor(() => expect(screen.getByText('当前草稿尚未保存，继续将放弃修改。')).toBeVisible(), { timeout: 5000 });
    fireEvent.click(screen.getByRole('button', { name: '继续编辑' }));
  } else {
    fireEvent.click(screen.getByRole('button', { name: /^刷\s*新$/ }));
    await screen.findByRole('button', { name: 'CQ-1' });
  }
  expect(screen.getByLabelText('处理说明')).toHaveValue('未保存的进展');
});

async function registerNewComplaint() {
  fireEvent.click(screen.getByRole('button', { name: '人工登记客诉' }));
  const dialog = screen.getByRole('dialog', { name: '人工登记客诉' });
  fireEvent.mouseDown(within(dialog).getByLabelText('登记客户'));
  fireEvent.click(await screen.findByText('C-1 · 客户一'));
  fireEvent.change(within(dialog).getByLabelText('不良描述'), { target: { value: '新登记的客诉' } });
  fireEvent.change(within(dialog).getByLabelText('严重度策略版本'), { target: { value: 'policy-1' } });
  fireEvent.change(within(dialog).getByLabelText('严重度策略快照 JSON'), { target: { value: '{"level":"LOW"}' } });
  fireEvent.click(within(dialog).getByRole('button', { name: /^登\s*记$/ }));
  await waitFor(() => expect(apiRequest).toHaveBeenCalledWith('/api/v1/customer-quality/complaints', expect.objectContaining({ method: 'POST' })));
  await waitFor(() => expect(screen.queryByRole('dialog', { name: '人工登记客诉' })).not.toBeInTheDocument());
}

function mockNewComplaint() {
  const previous = vi.mocked(apiRequest).getMockImplementation()!;
  const created = { ...complaint, id: 'complaint-new', complaint_number: 'CQ-NEW', defect_description: '新登记的客诉' };
  let registered = false;
  vi.mocked(apiRequest).mockImplementation(async (url, init) => {
    if (url.endsWith('/complaints') && init?.method === 'POST') { registered = true; return created; }
    if (url.endsWith('/complaints') && registered) return [complaint, other, created];
    if (url.endsWith('/complaint-new')) return created;
    return previous(url, init);
  });
}

it.each(['keep', 'discard'] as const)('guards the old complaint draft after successful registration: %s', async (choice) => {
  mockNewComplaint();
  render(<LanguageProvider><MemoryRouter><UnsavedChangesProvider><CustomerQualityPage /></UnsavedChangesProvider></MemoryRouter></LanguageProvider>);
  fireEvent.click(await screen.findByRole('button', { name: 'CQ-1' }));
  fireEvent.change(await screen.findByLabelText('处理说明'), { target: { value: '旧客诉尚未保存的进展' } });
  await registerNewComplaint();
  await waitFor(() => expect(screen.getByText('当前草稿尚未保存，继续将放弃修改。')).toBeVisible());
  expect(screen.getByLabelText('处理说明')).toHaveValue('旧客诉尚未保存的进展');
  expect(vi.mocked(apiRequest).mock.calls.some(([url]) => url.endsWith('/complaint-new'))).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: choice === 'keep' ? '继续编辑' : '放弃修改' }));
  if (choice === 'keep') {
    expect(screen.getByLabelText('处理说明')).toHaveValue('旧客诉尚未保存的进展');
    fireEvent.click(await screen.findByRole('button', { name: 'CQ-NEW' }));
    fireEvent.click(await screen.findByRole('button', { name: '放弃修改' }));
  }
  await waitFor(() => expect(apiRequest).toHaveBeenCalledWith('/api/v1/customer-quality/complaints/complaint-new'));
  await waitFor(() => expect(screen.getByLabelText('处理说明')).toHaveValue(''));
  expect(vi.mocked(apiRequest).mock.calls.filter(([url, init]) => url.endsWith('/complaints') && init?.method === 'POST')).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: 'CQ-2' }));
  await waitFor(() => expect(apiRequest).toHaveBeenCalledWith('/api/v1/customer-quality/complaints/complaint-2'));
  expect(screen.queryByRole('dialog', { name: '当前草稿尚未保存，继续将放弃修改。' })).not.toBeInTheDocument();
});

it('opens the new complaint once registration busy clears when there is no old draft', async () => {
  mockNewComplaint();
  render(<LanguageProvider><MemoryRouter><UnsavedChangesProvider><CustomerQualityPage /></UnsavedChangesProvider></MemoryRouter></LanguageProvider>);
  await screen.findByRole('button', { name: '人工登记客诉' });
  await registerNewComplaint();
  await waitFor(() => expect(apiRequest).toHaveBeenCalledWith('/api/v1/customer-quality/complaints/complaint-new'));
  expect(await screen.findByLabelText('处理说明')).toHaveValue('');
  expect(screen.queryByRole('dialog', { name: '当前草稿尚未保存，继续将放弃修改。' })).not.toBeInTheDocument();
});

it('unmounts the old draft after confirmed registration navigation even if the new detail fails', async () => {
  mockNewComplaint();
  const previous = vi.mocked(apiRequest).getMockImplementation()!;
  let rejectDetail!: (cause: Error) => void;
  const detail = new Promise<never>((_, reject) => { rejectDetail = reject; });
  vi.mocked(apiRequest).mockImplementation((url, init) => url.endsWith('/complaint-new') ? detail : previous(url, init));
  render(<LanguageProvider><MemoryRouter><UnsavedChangesProvider><CustomerQualityPage /></UnsavedChangesProvider></MemoryRouter></LanguageProvider>);
  fireEvent.click(await screen.findByRole('button', { name: 'CQ-1' }));
  fireEvent.change(await screen.findByLabelText('处理说明'), { target: { value: '确认后应卸载的旧草稿' } });
  await registerNewComplaint();
  fireEvent.click(await screen.findByRole('button', { name: '放弃修改' }));
  await waitFor(() => expect(apiRequest).toHaveBeenCalledWith('/api/v1/customer-quality/complaints/complaint-new'));
  const oldDraftStillMounted = screen.queryByLabelText('处理说明') !== null;
  await act(async () => { rejectDetail(new Error('offline')); });
  await screen.findByText('客诉详情加载失败，请重试。');
  expect(oldDraftStillMounted).toBe(false);
  expect(screen.queryByLabelText('处理说明')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'CQ-2' }));
  await waitFor(() => expect(apiRequest).toHaveBeenCalledWith('/api/v1/customer-quality/complaints/complaint-2'));
  expect(screen.queryByRole('dialog', { name: '当前草稿尚未保存，继续将放弃修改。' })).not.toBeInTheDocument();
});

beforeEach(() => { localStorage.clear(); vi.stubEnv('NODE_ENV', 'development'); });
afterEach(() => vi.unstubAllEnvs());
