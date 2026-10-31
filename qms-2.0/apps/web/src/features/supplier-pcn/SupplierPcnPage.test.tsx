import { act, fireEvent, render as renderView, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { apiRequest, csrfToken } from '../../api/client';
import { LanguageProvider } from '../../i18n/Language';
import { UnsavedChangesProvider } from '../../layouts/UnsavedChanges';
import { AttachmentPanel } from '../attachments/AttachmentPanel';
import { SupplierPcnPage } from './SupplierPcnPage';
vi.mock('../../api/client', async () => { const actual = await vi.importActual<typeof import('../../api/client')>('../../api/client'); return { ...actual, apiRequest: vi.fn(), csrfToken: vi.fn().mockResolvedValue('csrf') }; });
vi.mock('../attachments/AttachmentPanel', () => ({ AttachmentPanel: vi.fn(() => null) }));
const render = (ui: ReactElement) => renderView(ui, { wrapper: LanguageProvider });
beforeEach(() => {
  // Keep rc-component Drawer and Select IDs unique, as in existing admin tests.
  vi.stubEnv('NODE_ENV', 'development');
  localStorage.setItem('qms:locale:v1', 'zh-CN');
  vi.mocked(AttachmentPanel).mockReset().mockImplementation(() => <></>);
  vi.mocked(apiRequest).mockReset().mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 50 } as never);
});
afterEach(() => vi.unstubAllEnvs());

it.each([false, true])('keeps header guidance scoped to the portal (portal=%s)', async portal => {
  const view = render(<SupplierPcnPage portal={portal} />);
  await screen.findByText('暂无 PCN 变更');
  expect(view.container.querySelector('header > div.ant-typography-secondary') !== null).toBe(portal);
  expect(screen.getByRole('button', { name: /刷\s*新/ })).toBeEnabled();
  expect(apiRequest).toHaveBeenCalledWith(expect.stringContaining(portal ? '/supplier-portal/' : '/supplier-pcn/'));
});

it('keeps the selected PCN evidence when closing the draft is declined', async () => {
  const file = { id: 'f1', originalName: '变更验证.pdf', status: 'AVAILABLE', scanStatus: 'CLEAN' } as Parameters<NonNullable<Parameters<typeof AttachmentPanel>[0]['onReady']>>[0];
  vi.mocked(AttachmentPanel).mockImplementation(({ onReady }) => <button onClick={() => onReady?.(file)}>选择已扫描 PCN 证据</button>);
  const row = { id: 'p1', title: '待提交变更', status: 'DRAFT', version: 1, events: [], workflow: null };
  vi.mocked(apiRequest).mockImplementation(async (path) => String(path).endsWith('/p1') ? row as never : { items: [row], total: 1 } as never);
  render(<MemoryRouter><UnsavedChangesProvider><SupplierPcnPage portal /></UnsavedChangesProvider></MemoryRouter>);
  const ledger = within(screen.getByRole('region', { name: 'PCN 变更台账' }));
  await ledger.findByText('待提交变更');
  fireEvent.click(ledger.getByRole('button', { name: '待提交变更' }));
  const drawer = await screen.findByLabelText('待提交变更', { selector: '[role="dialog"]' });
  await waitFor(() => expect(drawer).toBeVisible());
  fireEvent.click(await within(drawer).findByText('选择已扫描 PCN 证据', { selector: 'button' }));
  fireEvent.click(within(drawer).getByLabelText('关闭', { selector: 'button' }));
  const confirmation = await screen.findByLabelText('当前草稿尚未保存，继续将放弃修改。', { selector: '[role="dialog"]' });
  await waitFor(() => expect(confirmation).toBeVisible());
  fireEvent.click(within(confirmation).getByRole('button', { name: '继续编辑' }));
  await waitFor(() => expect(confirmation).not.toBeVisible());
  expect(drawer).toBeVisible();
  const evidence = within(drawer).getByLabelText('提交证据');
  expect(evidence).toHaveAttribute('role', 'combobox');
  expect(evidence).toBeEnabled();
  expect(evidence.closest('.ant-select')).toHaveTextContent('变更验证.pdf');
  expect(apiRequest).not.toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ method: 'POST' }));
});

it.each([
  { field: '审批意见', workflow: { nodeType: 'APPROVAL' } },
  { field: '流程定义 ID', workflow: null },
  { field: '流程版本 ID', workflow: null },
])('keeps the PCN $field when closing is declined', async ({ field, workflow }) => {
  const row = { id: 'p1', title: '待审批变更', status: 'SUBMITTED', version: 2, events: [], workflow };
  vi.mocked(apiRequest).mockImplementation(async (path) => String(path).endsWith('/p1') ? row as never : { items: [row], total: 1 } as never);
  render(<MemoryRouter><UnsavedChangesProvider><SupplierPcnPage /></UnsavedChangesProvider></MemoryRouter>);
  fireEvent.click(await screen.findByRole('button', { name: '待审批变更' }));
  const drawer = await screen.findByRole('dialog', { name: '待审批变更' });
  const input = field === '审批意见' ? await within(drawer).findByLabelText(field) : await within(drawer).findByPlaceholderText(field);
  fireEvent.change(input, { target: { value: '尚未提交的处理输入' } });
  fireEvent.click(within(drawer).getByRole('button', { name: '关闭' }));
  fireEvent.click(await screen.findByRole('button', { name: '继续编辑' }));
  expect(input).toHaveValue('尚未提交的处理输入');
  expect(input).toBeInTheDocument();
  expect(apiRequest).not.toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ method: 'POST' }));
});

it('does not offer to discard the PCN while approval is pending', async () => {
  const row = { id: 'p1', title: '待审批变更', status: 'SUBMITTED', version: 2, events: [], workflow: { nodeType: 'APPROVAL', version: 1, problemVersion: 1, currentNodeId: 'n1' } };
  let finish!: () => void;
  const pending = new Promise<never>((resolve) => { finish = () => resolve(row as never); });
  vi.mocked(apiRequest).mockImplementation(async (path, init) => init?.method === 'POST' ? pending : String(path).endsWith('/p1') ? row as never : { items: [row], total: 1 } as never);
  render(<MemoryRouter><UnsavedChangesProvider><SupplierPcnPage /></UnsavedChangesProvider></MemoryRouter>);
  fireEvent.click(await screen.findByRole('button', { name: '待审批变更' }));
  const drawer = await screen.findByRole('dialog', { name: '待审批变更' });
  fireEvent.change(await screen.findByLabelText('审批意见'), { target: { value: '资料已核验' } });
  fireEvent.click(screen.getByRole('button', { name: '审批通过' }));
  await waitFor(() => expect(apiRequest).toHaveBeenCalledWith('/api/v1/supplier-pcn/requests/p1/review', expect.objectContaining({ method: 'POST' })));
  try {
    const close = within(drawer).queryByRole('button', { name: '关闭' });
    if (close) fireEvent.click(close);
    expect(screen.getByRole('dialog', { name: '待审批变更' })).toBeVisible();
    expect(screen.queryByRole('button', { name: '放弃修改并关闭' })).not.toBeInTheDocument();
  } finally { await act(async () => { finish(); await pending; }); }
});

it('renders the real PCN ledger with status and category', async () => {
  vi.mocked(apiRequest).mockResolvedValueOnce({ items: [{ id: 'p1', profileId: 'pr1', ownerOrganizationId: 'o1', supplierOrganizationId: 's1', supplierName: '供应商甲', changeType: 'PROCESS', title: '工艺变更', materialCode: 'M-1', beforeChange: '旧', afterChange: '新', reason: '优化', riskControl: '验证', plannedDate: '2026-10-15', status: 'SUBMITTED', version: 2, fileId: null, problemIndexId: null, reviewNote: null, createdAt: '2026-09-26T00:00:00Z', updatedAt: '2026-09-26T00:00:00Z' }], total: 1, page: 1, pageSize: 50 });
  render(<SupplierPcnPage />);
  expect(await screen.findByText('工艺变更')).toBeVisible(); expect(screen.getByText('工艺')).toBeVisible(); expect(screen.getByText('已提交')).toBeVisible();
});
it('submits a selected clean attachment from a supplier draft', async () => {
  const row = { id: 'p1', profileId: 'pr1', ownerOrganizationId: 'o1', supplierOrganizationId: 's1', supplierName: '供应商甲', changeType: 'PROCESS', title: '工艺变更', materialCode: 'M-1', beforeChange: '旧', afterChange: '新', reason: '优化', riskControl: '验证', plannedDate: '2026-10-15', status: 'DRAFT', version: 1, fileId: 'f1', problemIndexId: null, reviewNote: null, createdAt: '2026-09-26T00:00:00Z', updatedAt: '2026-09-26T00:00:00Z' };
  vi.mocked(apiRequest).mockImplementation(async (path) => { const url = String(path); return url.includes('/profiles') ? { items: [] } as never : url.endsWith('/p1') ? { ...row, events: [], workflow: null } as never : { items: [row], total: 1, page: 1, pageSize: 50 } as never; });
  render(<SupplierPcnPage portal />);
  await userEvent.click(await screen.findByText('工艺变更'));
  await userEvent.click(screen.getByRole('button', { name: '提交申报' }));
  expect(vi.mocked(apiRequest)).toHaveBeenCalledWith('/api/v1/supplier-portal/pcns/p1/submit', expect.objectContaining({ method: 'POST', body: JSON.stringify({ expectedVersion: 1, fileId: 'f1' }) }));
  expect(vi.mocked(csrfToken)).toHaveBeenCalled();
});
it('submits an approval opinion with workflow CAS fields', async () => {
  const row = { id: 'p2', profileId: 'pr1', ownerOrganizationId: 'o1', supplierOrganizationId: 's1', supplierName: '供应商甲', changeType: 'MATERIAL', title: '审批变更', materialCode: 'M-2', beforeChange: '旧', afterChange: '新', reason: '优化', riskControl: '验证', plannedDate: '2026-10-15', status: 'SUBMITTED', version: 3, fileId: 'f2', problemIndexId: 'i1', reviewNote: null, createdAt: '2026-09-26T00:00:00Z', updatedAt: '2026-09-26T00:00:00Z' };
  const detail = { ...row, events: [], workflow: { instanceId: 'w1', currentNodeId: 'n1', workflowVersionId: 'wv1', version: 2, problemVersion: 4, status: 'RUNNING', nodeType: 'APPROVAL' } };
  vi.mocked(apiRequest).mockImplementation(async (path, options) => {
    const url = String(path);
    if (options?.method === 'POST') return detail as never;
    return url.endsWith('/p2') ? detail as never : { items: [row], total: 1, page: 1, pageSize: 20 } as never;
  });
  render(<SupplierPcnPage />);
  await userEvent.click(await screen.findByText('审批变更'));
  await userEvent.type(await screen.findByLabelText('审批意见'), '验证方案满足要求');
  await userEvent.click(screen.getByRole('button', { name: '审批通过' }));
  expect(vi.mocked(apiRequest)).toHaveBeenCalledWith('/api/v1/supplier-pcn/requests/p2/review', expect.objectContaining({ method: 'POST', body: expect.stringContaining('APPROVE') }));
});
