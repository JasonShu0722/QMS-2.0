import { fireEvent, render as renderView, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { apiRequest } from '../../api/client';
import { LanguageProvider } from '../../i18n/Language';
import { UnsavedChangesProvider } from '../../layouts/UnsavedChanges';
import { SupplierConcessionPage } from './SupplierConcessionPage';

vi.setConfig({ testTimeout: 30_000 });

vi.mock('../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../api/client')>('../../api/client');
  return { ...actual, apiRequest: vi.fn() };
});

const render = (ui: ReactElement) => renderView(ui, { wrapper: LanguageProvider });
beforeEach(() => {
  // Match the existing admin test setup: rc-component test IDs collide across Modal and Select.
  vi.stubEnv('NODE_ENV', 'development');
  localStorage.setItem('qms:locale:v1', 'zh-CN');
  vi.mocked(apiRequest).mockReset();
});
afterEach(() => vi.unstubAllEnvs());

it('preserves a concession draft when cancelling discard and clears it only after confirmation', async () => {
  const user = userEvent.setup();
  vi.mocked(apiRequest).mockResolvedValue({ items: [], total: 0, canCreate: true } as never);
  render(<MemoryRouter><UnsavedChangesProvider><SupplierConcessionPage /></UnsavedChangesProvider></MemoryRouter>);
  await user.click(await screen.findByRole('button', { name: '发起特采申请' }));
  const modal = await screen.findByRole('dialog', { name: '发起特采申请' });
  await waitFor(() => expect(modal).toBeVisible());
  await user.click(within(modal).getByLabelText('偏差及风险评估依据'));
  await user.paste('尚未保存的偏差评估');
  expect(within(modal).getByLabelText('偏差及风险评估依据')).toHaveValue('尚未保存的偏差评估');
  await user.click(within(modal).getByRole('button', { name: /^取\s*消$/ }));
  const confirmation = await screen.findByRole('dialog', { name: '当前草稿尚未保存，继续将放弃修改。' });
  await waitFor(() => expect(confirmation).toBeVisible());
  await user.click(within(confirmation).getByRole('button', { name: '继续编辑' }));
  await waitFor(() => expect(confirmation).not.toBeVisible());
  expect(within(modal).getByLabelText('偏差及风险评估依据')).toHaveValue('尚未保存的偏差评估');
  await user.click(within(modal).getByRole('button', { name: /^取\s*消$/ }));
  await user.click(await screen.findByRole('button', { name: '放弃修改并关闭' }));
  await waitFor(() => expect(modal).not.toBeInTheDocument());
  await user.click(screen.getByRole('button', { name: '发起特采申请' }));
  const reopened = await screen.findByRole('dialog', { name: '发起特采申请' });
  await waitFor(() => expect(reopened).toBeVisible());
  expect(within(reopened).getByLabelText('偏差及风险评估依据')).toHaveValue('');
  expect(apiRequest).not.toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ method: 'POST' }));
});

it('shows the scoped concession ledger and hides create without permission', async () => {
  vi.mocked(apiRequest).mockResolvedValueOnce({ items: [{ id: 'request-1', supplierName: '供应商甲', materialCode: 'MAT-01', incomingBatch: 'B-01', quantity: 8, status: 'APPROVED', expiresAt: '2026-09-25T10:00:00Z' }], total: 1, page: 1, pageSize: 20, canCreate: false });
  render(<SupplierConcessionPage />);
  expect(await screen.findByText('供应商甲')).toBeVisible();
  expect(screen.getByText('MAT-01')).toBeVisible();
  expect(screen.queryByRole('button', { name: '发起特采申请' })).not.toBeInTheDocument();
});

it('keeps a concession decision note when cancelling the action is declined', async () => {
  const record = { id: 'request-1', supplierName: '供应商甲', status: 'SUBMITTED', expiresAt: '2026-10-30T10:00:00Z', events: [], canApprove: true };
  vi.mocked(apiRequest).mockImplementation(async (path) => String(path).endsWith('/request-1') ? record as never : { items: [record], total: 1, canCreate: false } as never);
  render(<MemoryRouter><UnsavedChangesProvider><SupplierConcessionPage /></UnsavedChangesProvider></MemoryRouter>);
  fireEvent.click(await screen.findByRole('button', { name: '供应商甲' }));
  const drawer = await screen.findByRole('dialog', { name: '特采申请详情' });
  fireEvent.click(await within(drawer).findByRole('button', { name: /^批\s*准$/ }));
  const modal = await screen.findByRole('dialog', { name: '批准特采申请' });
  fireEvent.change(within(modal).getByLabelText('处理意见'), { target: { value: '已核查批次风险，待补依据' } });
  fireEvent.click(within(modal).getByRole('button', { name: /^取\s*消$/ }));
  fireEvent.click(await screen.findByRole('button', { name: '继续编辑' }));
  expect(within(modal).getByLabelText('处理意见')).toHaveValue('已核查批次风险，待补依据');
  expect(apiRequest).not.toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ method: 'POST' }));
});

it('protects the decision note when closing the parent concession drawer', async () => {
  const record = { id: 'request-1', supplierName: '供应商甲', status: 'SUBMITTED', expiresAt: '2026-10-30T10:00:00Z', events: [], canApprove: true };
  vi.mocked(apiRequest).mockImplementation(async (path) => String(path).endsWith('/request-1') ? record as never : { items: [record], total: 1, canCreate: false } as never);
  render(<MemoryRouter><UnsavedChangesProvider><SupplierConcessionPage /></UnsavedChangesProvider></MemoryRouter>);
  fireEvent.click(await screen.findByRole('button', { name: '供应商甲' }));
  const drawer = await screen.findByRole('dialog', { name: '特采申请详情' });
  fireEvent.click(await within(drawer).findByRole('button', { name: /^批\s*准$/ }));
  fireEvent.change(screen.getByLabelText('处理意见'), { target: { value: '不能因父抽屉关闭丢失' } });
  fireEvent.click(within(drawer).getByRole('button', { name: '关闭' }));
  fireEvent.click(await screen.findByRole('button', { name: '继续编辑' }));
  expect(screen.getByLabelText('处理意见')).toHaveValue('不能因父抽屉关闭丢失');
});

it('distinguishes an empty ledger from a load failure', async () => {
  vi.mocked(apiRequest).mockRejectedValueOnce(new Error('offline'));
  render(<SupplierConcessionPage />);
  expect(await screen.findByText('特采台账加载失败，请重试')).toBeVisible();
  expect(screen.queryByText('暂无特采申请')).not.toBeInTheDocument();
});
