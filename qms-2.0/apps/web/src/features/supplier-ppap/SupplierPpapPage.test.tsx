import { act, fireEvent, render as renderView, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConfigProvider } from 'antd';
import type { ReactElement } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { apiRequest } from '../../api/client';
import { LanguageProvider } from '../../i18n/Language';
import { UnsavedChangesProvider } from '../../layouts/UnsavedChanges';
import { AttachmentPanel } from '../attachments/AttachmentPanel';
import { SupplierPpapPage } from './SupplierPpapPage';

vi.setConfig({ testTimeout: 30_000 });

vi.mock('../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../api/client')>('../../api/client');
  return { ...actual, apiRequest: vi.fn(), csrfToken: vi.fn().mockResolvedValue('csrf') };
});
vi.mock('../attachments/AttachmentPanel', () => ({ AttachmentPanel: vi.fn(() => null) }));

const pack = { id: 'p1', title: '控制计划', partNumber: 'M-1', level: 3, status: 'DRAFT', version: 1, items: [{ id: 'i1', packageId: 'p1', itemCode: 'CP', title: '控制计划', required: true, status: 'PENDING', evidenceFileIds: [], version: 1 }] };
const page = { items: [pack], total: 1, page: 1, pageSize: 20 };
const permissions = { permissions: ['supplier-ppap:read', 'supplier-ppap:write', 'supplier-ppap:review', 'supplier-quality:profiles:read'] };
const render = (ui: ReactElement) => renderView(<LanguageProvider><ConfigProvider theme={{ token: { motion: false } }}>{ui}</ConfigProvider></LanguageProvider>);

beforeEach(() => {
  // Keep rc-component Modal and Select IDs unique, as in existing admin tests.
  vi.stubEnv('NODE_ENV', 'development');
  localStorage.setItem('qms:locale:v1', 'zh-CN');
  vi.mocked(AttachmentPanel).mockReset().mockImplementation(() => <></>);
  vi.mocked(apiRequest).mockReset().mockImplementation(async (path) => String(path).includes('my-permissions') ? permissions as never : String(path).includes('profiles') ? { items: [] } as never : String(path).endsWith('/p1') ? pack as never : page as never);
});
afterEach(() => vi.unstubAllEnvs());

it('keeps unbound PPAP item evidence when closing the package is declined', async () => {
  const file = { id: 'f1', status: 'AVAILABLE', scanStatus: 'CLEAN' } as Parameters<NonNullable<Parameters<typeof AttachmentPanel>[0]['onReady']>>[0];
  vi.mocked(AttachmentPanel).mockImplementation(({ onReady }) => <button onClick={() => onReady?.(file)}>选择已扫描 PPAP 证据</button>);
  const user = userEvent.setup();
  render(<MemoryRouter><UnsavedChangesProvider><SupplierPpapPage /></UnsavedChangesProvider></MemoryRouter>);
  await user.click(await screen.findByRole('button', { name: '查看与审核' }));
  const drawer = await screen.findByRole('dialog', { name: 'PPAP 资料包详情' });
  await waitFor(() => expect(drawer).toBeVisible());
  await user.click(await within(drawer).findByRole('button', { name: '选择已扫描 PPAP 证据' }));
  expect(within(drawer).getByRole('button', { name: '绑定扫描证据' })).toBeEnabled();
  await user.click(within(drawer).getByRole('button', { name: '关闭' }));
  await user.click(await screen.findByRole('button', { name: '继续编辑' }));
  expect(within(drawer).getByRole('button', { name: '绑定扫描证据' })).toBeEnabled();
  expect(apiRequest).not.toHaveBeenCalledWith('/api/v1/supplier-ppap/p1/items/i1/evidence', expect.objectContaining({ method: 'POST' }));
});

it('keeps the PPAP package open while formal submission is pending', async () => {
  const ready = { ...pack, items: [{ ...pack.items[0], status: 'PROVIDED', evidenceFileIds: ['f1'] }] };
  let finish!: () => void;
  const pending = new Promise<never>((resolve) => { finish = () => resolve(ready as never); });
  vi.mocked(apiRequest).mockImplementation(async (path, init) => {
    if (init?.method === 'POST') return pending;
    return String(path).includes('my-permissions') ? permissions as never : String(path).includes('profiles') ? { items: [] } as never : String(path).endsWith('/p1') ? ready as never : page as never;
  });
  render(<MemoryRouter><UnsavedChangesProvider><SupplierPpapPage /></UnsavedChangesProvider></MemoryRouter>);
  fireEvent.click(await screen.findByRole('button', { name: '查看与审核' }));
  const drawer = await screen.findByRole('dialog', { name: 'PPAP 资料包详情' });
  fireEvent.click(await screen.findByRole('button', { name: '提交审核' }));
  await waitFor(() => expect(apiRequest).toHaveBeenCalledWith('/api/v1/supplier-ppap/p1/submit', expect.objectContaining({ method: 'POST' })));
  try {
    const close = within(drawer).queryByRole('button', { name: '关闭' });
    if (close) fireEvent.click(close);
    expect(screen.getByRole('dialog', { name: 'PPAP 资料包详情' })).toBeVisible();
    expect(screen.queryByRole('button', { name: '放弃修改并关闭' })).not.toBeInTheDocument();
  } finally { await act(async () => { finish(); await pending; }); }
});

it('preserves a PPAP draft when closing is cancelled and clears it after discard', async () => {
  const user = userEvent.setup();
  render(<MemoryRouter><UnsavedChangesProvider><SupplierPpapPage /></UnsavedChangesProvider></MemoryRouter>);
  await user.click(await screen.findByRole('button', { name: '新建 PPAP' }));
  const modal = await screen.findByRole('dialog', { name: '新建 PPAP 资料包' });
  await waitFor(() => expect(modal).toBeVisible());
  await user.click(within(modal).getByLabelText('资料包名称'));
  await user.paste('待提交资料包');
  expect(within(modal).getByLabelText('资料包名称')).toHaveValue('待提交资料包');
  await user.click(within(modal).getByRole('button', { name: /^取\s*消$/ }));
  const confirmation = await screen.findByRole('dialog', { name: '当前草稿尚未保存，继续将放弃修改。' });
  await waitFor(() => expect(confirmation).toBeVisible());
  await user.click(within(confirmation).getByRole('button', { name: '继续编辑' }));
  await waitFor(() => expect(confirmation).not.toBeVisible());
  expect(within(modal).getByLabelText('资料包名称')).toHaveValue('待提交资料包');
  await user.click(within(modal).getByRole('button', { name: /^取\s*消$/ }));
  await user.click(await screen.findByRole('button', { name: '放弃修改并关闭' }));
  await waitFor(() => expect(modal).not.toBeVisible());
  await user.click(screen.getByRole('button', { name: '新建 PPAP' }));
  const reopened = await screen.findByRole('dialog', { name: '新建 PPAP 资料包' });
  await waitFor(() => expect(reopened).toBeVisible());
  expect(within(reopened).getByLabelText('资料包名称')).toHaveValue('');
  expect(apiRequest).not.toHaveBeenCalledWith('/api/v1/supplier-ppap', expect.objectContaining({ method: 'POST' }));
});

it('adds a custom checklist item through the contracted item endpoint', async () => {
  const user = userEvent.setup();
  render(<SupplierPpapPage />);
  await user.click(await screen.findByRole('button', { name: '查看与审核' }));
  const drawer = await screen.findByRole('dialog', { name: 'PPAP 资料包详情' });
  await waitFor(() => expect(drawer).toBeVisible());
  await user.click(await within(drawer).findByRole('button', { name: '新增检查项' }));
  const modal = await screen.findByRole('dialog', { name: '新增检查项' });
  await waitFor(() => expect(modal).toBeVisible());
  const code = within(modal).getByLabelText('检查项编码');
  const title = within(modal).getByLabelText('检查项名称');
  await user.click(code);
  await user.paste('CUSTOM');
  await user.click(title);
  await user.paste('补充验证');
  expect(code).toHaveValue('CUSTOM');
  expect(title).toHaveValue('补充验证');
  await user.click(within(modal).getByRole('button', { name: '保存检查项' }));
  await waitFor(() => expect(apiRequest).toHaveBeenCalledWith('/api/v1/supplier-ppap/p1/items', expect.objectContaining({ method: 'POST', body: expect.stringContaining('"itemCode":"CUSTOM"') })));
}, 30_000);

it('keeps a new PPAP checklist item when closing is declined', async () => {
  const user = userEvent.setup();
  render(<MemoryRouter><UnsavedChangesProvider><SupplierPpapPage /></UnsavedChangesProvider></MemoryRouter>);
  await user.click(await screen.findByRole('button', { name: '查看与审核' }));
  const drawer = await screen.findByRole('dialog', { name: 'PPAP 资料包详情' });
  await waitFor(() => expect(drawer).toBeVisible());
  await user.click(await within(drawer).findByRole('button', { name: '新增检查项' }));
  const modal = await screen.findByRole('dialog', { name: '新增检查项' });
  await waitFor(() => expect(modal).toBeVisible());
  await user.click(within(modal).getByLabelText('检查项编码'));
  await user.paste('CUSTOM');
  expect(within(modal).getByLabelText('检查项编码')).toHaveValue('CUSTOM');
  await user.click(within(modal).getByRole('button', { name: '关闭' }));
  const confirmation = await screen.findByRole('dialog', { name: '当前草稿尚未保存，继续将放弃修改。' });
  await waitFor(() => expect(confirmation).toBeVisible());
  await user.click(within(confirmation).getByRole('button', { name: '继续编辑' }));
  await waitFor(() => expect(confirmation).not.toBeVisible());
  expect(modal).toBeVisible();
  expect(within(modal).getByLabelText('检查项编码')).toHaveValue('CUSTOM');
  expect(apiRequest).not.toHaveBeenCalledWith('/api/v1/supplier-ppap/p1/items', expect.objectContaining({ method: 'POST' }));
});

it('keeps the item review opinion when closing is declined', async () => {
  vi.mocked(apiRequest).mockImplementation(async (path) => String(path).includes('my-permissions') ? permissions as never : String(path).endsWith('/p1') ? { ...pack, status: 'SUBMITTED' } as never : page as never);
  const user = userEvent.setup();
  render(<MemoryRouter><UnsavedChangesProvider><SupplierPpapPage /></UnsavedChangesProvider></MemoryRouter>);
  await user.click(await screen.findByRole('button', { name: '查看与审核' }));
  const drawer = await screen.findByRole('dialog', { name: 'PPAP 资料包详情' });
  await waitFor(() => expect(drawer).toBeVisible());
  await user.click(await within(drawer).findByRole('button', { name: /^审\s*核$/ }));
  const modal = await screen.findByRole('dialog', { name: '审核检查项：控制计划' });
  await waitFor(() => expect(modal).toBeVisible());
  await user.click(within(modal).getByLabelText('检查项审核意见'));
  await user.paste('证据待复核');
  expect(within(modal).getByLabelText('检查项审核意见')).toHaveValue('证据待复核');
  await user.click(within(modal).getByRole('button', { name: '关闭' }));
  const confirmation = await screen.findByRole('dialog', { name: '当前草稿尚未保存，继续将放弃修改。' });
  await waitFor(() => expect(confirmation).toBeVisible());
  await user.click(within(confirmation).getByRole('button', { name: '继续编辑' }));
  await waitFor(() => expect(confirmation).not.toBeVisible());
  expect(modal).toBeVisible();
  expect(within(modal).getByLabelText('检查项审核意见')).toHaveValue('证据待复核');
  expect(apiRequest).not.toHaveBeenCalledWith('/api/v1/supplier-ppap/p1/items/i1/review', expect.objectContaining({ method: 'POST' }));
});

it.each([
  { status: 'SUBMITTED', field: '审核意见', title: 'PPAP 资料包详情' },
  { status: 'APPROVED', field: '年度再鉴定意见', title: '完成年度再鉴定' },
])('protects the $field when closing its editor', async ({ status, field, title }) => {
  const user = userEvent.setup();
  vi.mocked(apiRequest).mockImplementation(async (path) => String(path).includes('my-permissions') ? permissions as never : String(path).endsWith('/p1') ? { ...pack, status } as never : page as never);
  render(<MemoryRouter><UnsavedChangesProvider><SupplierPpapPage /></UnsavedChangesProvider></MemoryRouter>);
  await user.click(await screen.findByRole('button', { name: '查看与审核' }));
  const drawer = await screen.findByRole('dialog', { name: 'PPAP 资料包详情' });
  await waitFor(() => expect(drawer).toBeVisible());
  if (status === 'APPROVED') await user.click(await within(drawer).findByRole('button', { name: '完成年度再鉴定' }));
  const input = await screen.findByLabelText(field);
  const editor = input.closest('[role="dialog"]') as HTMLElement;
  await waitFor(() => expect(editor).toBeVisible());
  expect(within(editor).getByText(title, { selector: status === 'APPROVED' ? '.ant-modal-title' : '.ant-drawer-title' })).toBeVisible();
  await user.click(input);
  await user.paste('尚未保存的审核依据');
  expect(input).toHaveValue('尚未保存的审核依据');
  await user.click(within(editor).getByRole('button', { name: '关闭' }));
  const confirmation = await screen.findByRole('dialog', { name: '当前草稿尚未保存，继续将放弃修改。' });
  await waitFor(() => expect(confirmation).toBeVisible());
  await user.click(within(confirmation).getByRole('button', { name: '继续编辑' }));
  await waitFor(() => expect(confirmation).not.toBeVisible());
  expect(editor).toBeVisible();
  expect(within(editor).getByLabelText(field)).toHaveValue('尚未保存的审核依据');
  expect(apiRequest).not.toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ method: 'POST' }));
});

it('hides write and review actions without their permissions', async () => {
  vi.mocked(apiRequest).mockImplementation(async (path) => String(path).includes('my-permissions') ? { permissions: ['supplier-ppap:read'] } as never : String(path).endsWith('/p1') ? { ...pack, status: 'SUBMITTED' } as never : page as never);
  render(<SupplierPpapPage />);
  expect(await screen.findByRole('button', { name: '查看与审核' })).toBeVisible();
  await userEvent.click(screen.getByRole('button', { name: '查看与审核' }));
  expect(await screen.findByRole('dialog', { name: 'PPAP 资料包详情' })).toBeVisible();
  expect(screen.queryByRole('button', { name: '新建 PPAP' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '提交审核结论' })).not.toBeInTheDocument();
});

it('shows missing required evidence before offering submission', async () => {
  render(<SupplierPpapPage />);
  await userEvent.click(await screen.findByRole('button', { name: '查看与审核' }));
  const drawer = await screen.findByRole('dialog', { name: 'PPAP 资料包详情' });
  expect(within(drawer).getByText('1 个必需检查项缺少扫描证据')).toBeVisible();
  expect(within(drawer).getByRole('button', { name: '提交审核' })).toBeDisabled();
});

it('sends a mandatory review note and version with the package decision', async () => {
  vi.mocked(apiRequest).mockImplementation(async (path, options) => options?.method === 'POST' ? { ...pack, status: 'APPROVED', version: 3 } as never : String(path).includes('my-permissions') ? permissions as never : String(path).includes('profiles') ? { items: [] } as never : String(path).endsWith('/p1') ? { ...pack, status: 'SUBMITTED', version: 2 } as never : page as never);
  const user = userEvent.setup();
  render(<SupplierPpapPage />);
  await user.click(await screen.findByRole('button', { name: '查看与审核' }));
  await user.type(await screen.findByLabelText('审核意见'), '文件有效');
  await user.click(screen.getByRole('button', { name: '提交审核结论' }));
  await user.click(await screen.findByRole('button', { name: /^确\s*定$/ }));
  expect(vi.mocked(apiRequest)).toHaveBeenCalledWith('/api/v1/supplier-ppap/p1/review', expect.objectContaining({ method: 'POST', body: JSON.stringify({ expectedVersion: 2, decision: 'APPROVED', note: '文件有效' }) }));
}, 30_000);
