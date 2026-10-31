import { act, fireEvent, render as renderView, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { apiRequest } from '../../api/client';
import { LanguageProvider } from '../../i18n/Language';
import { UnsavedChangesProvider } from '../../layouts/UnsavedChanges';
import { AttachmentPanel } from '../attachments/AttachmentPanel';
import { SupplierAsnPage } from './SupplierAsnPage';

vi.setConfig({ testTimeout: 30_000 });

vi.mock('../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../api/client')>('../../api/client');
  return { ...actual, apiRequest: vi.fn(), csrfToken: vi.fn().mockResolvedValue('csrf') };
});
vi.mock('../attachments/AttachmentPanel', () => ({ AttachmentPanel: vi.fn(() => null) }));

const asn = { id: 'a1', asnNumber: 'ASN-1', materialCode: 'M-1', plannedArrivalDate: '2026-10-01', quantity: 5, status: 'DRAFT', version: 1, evidence: [] };
const page = { items: [asn], total: 1, page: 1, pageSize: 20 };
const render = (ui: ReactElement) => renderView(ui, { wrapper: LanguageProvider });
beforeEach(() => {
  // rc-component uses duplicate IDs in test mode, unlike the application.
  vi.stubEnv('NODE_ENV', 'development');
  localStorage.setItem('qms:locale:v1', 'zh-CN');
  vi.mocked(AttachmentPanel).mockReset().mockImplementation(() => <></>);
  vi.mocked(apiRequest).mockReset().mockImplementation(async (path) => String(path).includes('my-permissions') ? { permissions: ['supplier-asn:read', 'supplier-asn:write', 'supplier-asn:submit', 'supplier-quality:profiles:read'] } as never : String(path).includes('profiles') ? { items: [] } as never : String(path).endsWith('/a1') ? asn as never : page as never);
});
afterEach(() => vi.unstubAllEnvs());

it('keeps an unsaved ASN draft until discard is confirmed and clears it after closing', async () => {
  const user = userEvent.setup();
  render(<MemoryRouter><UnsavedChangesProvider><SupplierAsnPage /></UnsavedChangesProvider></MemoryRouter>);
  await user.click(await screen.findByRole('button', { name: '新建 ASN' }));
  const drawer = await screen.findByRole('dialog', { name: '新建 ASN' });
  await waitFor(() => expect(drawer).toBeVisible());
  await user.click(within(drawer).getByLabelText('ASN 编号'));
  await user.paste('ASN-UNSAVED');
  expect(within(drawer).getByLabelText('ASN 编号')).toHaveValue('ASN-UNSAVED');
  await user.click(within(drawer).getByRole('button', { name: '关闭' }));

  const confirmation = await screen.findByRole('dialog', { name: '当前草稿尚未保存，继续将放弃修改。' });
  await waitFor(() => expect(confirmation).toBeVisible());
  await user.click(within(confirmation).getByRole('button', { name: '继续编辑' }));
  await waitFor(() => expect(confirmation).not.toBeVisible());
  expect(within(drawer).getByLabelText('ASN 编号')).toHaveValue('ASN-UNSAVED');
  expect(apiRequest).not.toHaveBeenCalledWith('/api/v1/supplier-asn', expect.objectContaining({ method: 'POST' }));

  await user.click(within(drawer).getByRole('button', { name: '关闭' }));
  await user.click(await screen.findByRole('button', { name: '放弃修改并关闭' }));
  await waitFor(() => expect(screen.queryByRole('dialog', { name: '新建 ASN' })).not.toBeInTheDocument());
  await user.click(screen.getByRole('button', { name: '新建 ASN' }));
  const reopened = await screen.findByRole('dialog', { name: '新建 ASN' });
  await waitFor(() => expect(reopened).toBeVisible());
  expect(within(reopened).getByLabelText('ASN 编号')).toHaveValue('');
});

it('blocks closing an ASN creation in progress and retains the draft after failure', async () => {
  let rejectCreation!: (cause: Error) => void;
  const pending = new Promise<never>((_resolve, reject) => { rejectCreation = reject; });
  vi.mocked(apiRequest).mockImplementation(async (path, init) => {
    if (init?.method === 'POST') return pending;
    return String(path).includes('my-permissions') ? { permissions: ['supplier-asn:read', 'supplier-asn:write'] } as never
      : String(path).includes('profiles') ? { items: [{ id: 'pr1', displayName: '供应商甲' }] } as never : page as never;
  });
  const user = userEvent.setup();
  render(<MemoryRouter><UnsavedChangesProvider><SupplierAsnPage /></UnsavedChangesProvider></MemoryRouter>);
  await user.click(await screen.findByRole('button', { name: '新建 ASN' }));
  const drawer = await screen.findByRole('dialog', { name: '新建 ASN' });
  await waitFor(() => expect(drawer).toBeVisible());
  await user.click(within(drawer).getByRole('combobox', { name: '供应商资料' }));
  const supplier = await screen.findByText('供应商甲', { selector: '.ant-select-item-option-content' });
  await waitFor(() => expect(supplier).toBeVisible());
  await user.click(supplier);
  fireEvent.change(within(drawer).getByLabelText('ASN 编号'), { target: { value: 'ASN-PENDING' } });
  fireEvent.change(within(drawer).getByLabelText('物料编码'), { target: { value: 'MAT-01' } });
  fireEvent.change(within(drawer).getByLabelText('计划到货日期'), { target: { value: '2026-10-25' } });
  fireEvent.change(within(drawer).getByLabelText('数量'), { target: { value: '5' } });
  try {
    await user.click(within(drawer).getByRole('button', { name: /^创\s*建$/ }));
    await waitFor(() => expect(apiRequest).toHaveBeenCalledWith('/api/v1/supplier-asn', expect.objectContaining({ method: 'POST' })));
    expect(within(drawer).getByLabelText('ASN 编号')).toBeDisabled();
    const close = within(drawer).queryByRole('button', { name: '关闭' });
    if (close) fireEvent.click(close);
    fireEvent.keyDown(drawer, { key: 'Escape', code: 'Escape' });
    expect(screen.getByRole('dialog', { name: '新建 ASN' })).toBeVisible();
    expect(screen.queryByRole('button', { name: '放弃修改并关闭' })).not.toBeInTheDocument();
  } finally { await act(async () => { rejectCreation(new Error('offline')); await pending.catch(() => undefined); }); }
  expect(await within(drawer).findByText('ASN 创建失败，请重试')).toBeVisible();
  expect(within(drawer).getByLabelText('ASN 编号')).toHaveValue('ASN-PENDING');
  expect(within(drawer).getByLabelText('ASN 编号')).toBeEnabled();
});

it('prevents submission until scanned evidence has been bound to the ASN', async () => {
  render(<SupplierAsnPage />);
  await userEvent.click(await screen.findByRole('button', { name: '查看与提交' }));
  const drawer = await screen.findByRole('dialog', { name: 'ASN 详情' });
  expect(within(drawer).getByText('请先绑定已扫描通过的证据')).toBeVisible();
  expect(within(drawer).getByRole('button', { name: '提交 ASN' })).toBeDisabled();
});

it('keeps unbound ASN evidence when closing the detail is declined', async () => {
  const file = { id: 'f1', status: 'AVAILABLE', scanStatus: 'CLEAN' } as Parameters<NonNullable<Parameters<typeof AttachmentPanel>[0]['onReady']>>[0];
  vi.mocked(AttachmentPanel).mockImplementation(({ onReady }) => <button onClick={() => onReady?.(file)}>选择已扫描 ASN 证据</button>);
  const user = userEvent.setup();
  render(<MemoryRouter><UnsavedChangesProvider><SupplierAsnPage /></UnsavedChangesProvider></MemoryRouter>);
  await user.click(await screen.findByRole('button', { name: '查看与提交' }));
  const drawer = await screen.findByRole('dialog', { name: 'ASN 详情' });
  await waitFor(() => expect(drawer).toBeVisible());
  await user.click(await within(drawer).findByRole('button', { name: '选择已扫描 ASN 证据' }));
  expect(within(drawer).getByRole('button', { name: '绑定扫描证据' })).toBeEnabled();
  await user.click(within(drawer).getByRole('button', { name: '关闭' }));
  const confirmation = await screen.findByRole('dialog', { name: '当前草稿尚未保存，继续将放弃修改。' });
  await waitFor(() => expect(confirmation).toBeVisible());
  await user.click(within(confirmation).getByRole('button', { name: '继续编辑' }));
  await waitFor(() => expect(confirmation).not.toBeVisible());
  expect(drawer).toBeVisible();
  expect(within(drawer).getByText('证据选择已变化，请先绑定再提交')).toBeVisible();
  expect(within(drawer).getByRole('button', { name: '绑定扫描证据' })).toBeEnabled();
  expect(apiRequest).not.toHaveBeenCalledWith('/api/v1/supplier-asn/a1/evidence', expect.objectContaining({ method: 'POST' }));
});

it('keeps the ASN detail open while formal submission is pending', async () => {
  let finish!: () => void;
  const pending = new Promise<never>((resolve) => { finish = () => resolve(asn as never); });
  const bound = { ...asn, evidence: [{ fileId: 'f1', fileVersion: 1 }] };
  vi.mocked(apiRequest).mockImplementation(async (path, init) => {
    if (init?.method === 'POST') return pending;
    return String(path).includes('my-permissions') ? { permissions: ['supplier-asn:read', 'supplier-asn:submit'] } as never : String(path).endsWith('/a1') ? bound as never : page as never;
  });
  const user = userEvent.setup();
  render(<MemoryRouter><UnsavedChangesProvider><SupplierAsnPage /></UnsavedChangesProvider></MemoryRouter>);
  await user.click(await screen.findByRole('button', { name: '查看与提交' }));
  const drawer = await screen.findByRole('dialog', { name: 'ASN 详情' });
  await waitFor(() => expect(drawer).toBeVisible());
  try {
    await user.click(await within(drawer).findByRole('button', { name: '提交 ASN' }));
    await waitFor(() => expect(apiRequest).toHaveBeenCalledWith('/api/v1/supplier-asn/a1/submit', expect.objectContaining({ method: 'POST' })));
    const close = within(drawer).queryByRole('button', { name: '关闭' });
    if (close) fireEvent.click(close);
    expect(screen.getByRole('dialog', { name: 'ASN 详情' })).toBeVisible();
    expect(screen.queryByRole('button', { name: '放弃修改并关闭' })).not.toBeInTheDocument();
  } finally { await act(async () => { finish(); await pending; }); }
});

it('shows the single contracted material line and hides unauthorized submit', async () => {
  vi.mocked(apiRequest).mockImplementation(async (path) => String(path).includes('my-permissions') ? { permissions: ['supplier-asn:read'] } as never : String(path).endsWith('/a1') ? asn as never : page as never);
  render(<SupplierAsnPage />);
  expect(await screen.findByRole('button', { name: '查看与提交' })).toBeVisible();
  await userEvent.click(screen.getByRole('button', { name: '查看与提交' }));
  const drawer = await screen.findByRole('dialog', { name: 'ASN 详情' });
  expect(within(drawer).getByText('物料明细（1 项）')).toBeVisible();
  expect(within(drawer).getByText('M-1')).toBeVisible();
  expect(within(drawer).queryByRole('button', { name: '提交 ASN' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '新建 ASN' })).not.toBeInTheDocument();
});

it('submits bound evidence with the current ASN version', async () => {
  vi.mocked(apiRequest).mockImplementation(async (path, options) => {
    if (options?.method === 'POST') return { ...asn, status: 'SUBMITTED', version: 5 } as never;
    return String(path).includes('my-permissions') ? { permissions: ['supplier-asn:read', 'supplier-asn:submit'] } as never
      : String(path).endsWith('/a1') ? { ...asn, version: 4, evidence: [{ fileId: 'f1', fileVersion: 2, sha256: 'hash', scannedAt: '2026-09-27T00:00:00Z' }] } as never : page as never;
  });
  render(<SupplierAsnPage />);
  await userEvent.click(await screen.findByRole('button', { name: '查看与提交' }));
  await userEvent.click(await screen.findByRole('button', { name: '提交 ASN' }));
  expect(vi.mocked(apiRequest)).toHaveBeenCalledWith('/api/v1/supplier-asn/a1/submit', expect.objectContaining({ method: 'POST', body: JSON.stringify({ expectedVersion: 4 }) }));
});
it('requests real ASN pages and resets to page one when the page size changes', async () => {
  vi.mocked(apiRequest).mockImplementation(async path => String(path).includes('my-permissions') ? { permissions: ['supplier-asn:read'] } as never : { ...page, total: 125 } as never);
  render(<SupplierAsnPage />);
  await screen.findByRole('button', { name: '查看与提交' });
  expect(apiRequest).toHaveBeenCalledWith('/api/v1/supplier-asn?page=1&pageSize=20');
  expect(screen.getByRole('button', { name: '列设置' })).toBeEnabled();
  await userEvent.click(screen.getByTitle('2'));
  await waitFor(() => expect(apiRequest).toHaveBeenCalledWith('/api/v1/supplier-asn?page=2&pageSize=20'));
  await screen.findByRole('button', { name: '查看与提交' });
  await userEvent.click(screen.getByRole('combobox'));
  await userEvent.click(await screen.findByRole('option', { name: /50/ }));
  await waitFor(() => expect(apiRequest).toHaveBeenCalledWith('/api/v1/supplier-asn?page=1&pageSize=50'));
});
