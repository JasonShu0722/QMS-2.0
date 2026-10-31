import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Link, MemoryRouter } from 'react-router-dom';
import { beforeEach, expect, it, vi } from 'vitest';
import { apiRequest } from '../../api/client';
import { UnsavedChangesProvider } from '../../layouts/UnsavedChanges';
import { SupplierAdmissionPage } from './SupplierAdmissionPage';

vi.mock('../../api/client', async () => { const actual = await vi.importActual<typeof import('../../api/client')>('../../api/client'); return { ...actual, apiRequest: vi.fn() }; });

beforeEach(() => vi.mocked(apiRequest).mockReset());

it('resets document pagination to page one when the status filter changes', async () => {
  vi.mocked(apiRequest).mockResolvedValue({ items: [], total: 125 } as never);
  render(<SupplierAdmissionPage />);
  await screen.findByText('暂无质量资料');
  await userEvent.click(screen.getByTitle('2'));
  await waitFor(() => expect(apiRequest).toHaveBeenCalledWith('/api/v1/supplier-admission/quality-documents?page=2&pageSize=20'));
  await screen.findByText('暂无质量资料');
  await userEvent.click(screen.getByRole('combobox', { name: '按状态筛选' }));
  await userEvent.click(await screen.findByText('待审核', { selector: '.ant-select-item-option-content' }));
  await waitFor(() => expect(apiRequest).toHaveBeenCalledWith('/api/v1/supplier-admission/quality-documents?page=1&pageSize=20&status=SUBMITTED'));
});

it.each([false, true])('uses real document pagination and a local column settings entry (portal=%s)', async portal => {
  vi.mocked(apiRequest).mockResolvedValue({ items: [], total: 125 } as never);
  render(<SupplierAdmissionPage portal={portal} />);
  const base = portal ? '/api/v1/supplier-portal/quality-documents' : '/api/v1/supplier-admission/quality-documents';
  await screen.findByText('暂无质量资料');
  expect(apiRequest).toHaveBeenCalledWith(`${base}?page=1&pageSize=20`);
  const ledger = screen.getByRole('region', { name: '质量资料台账' });
  expect(within(ledger).getByRole('button', { name: '列设置' })).toBeEnabled();
  await userEvent.click(within(ledger).getByTitle('2'));
  await waitFor(() => expect(apiRequest).toHaveBeenCalledWith(`${base}?page=2&pageSize=20`));
  await screen.findByText('暂无质量资料');
  await userEvent.click(within(ledger).getByRole('combobox'));
  await userEvent.click(await screen.findByRole('option', { name: /50/ }));
  await waitFor(() => expect(apiRequest).toHaveBeenCalledWith(`${base}?page=1&pageSize=50`));
});

it.each([false, true])('keeps header guidance scoped to the portal (portal=%s)', async portal => {
  vi.mocked(apiRequest).mockResolvedValue({ items: [], total: 0 } as never);
  const view = render(<SupplierAdmissionPage portal={portal} />);
  await screen.findByText('暂无质量资料');
  expect(view.container.querySelector('header > div.ant-typography-secondary') !== null).toBe(portal);
  expect(screen.getByRole('heading', { name: portal ? '质量资料提交' : '供应商质量资料审核' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /刷\s*新/ })).toBeEnabled();
});

it.each([
  { field: '资料标题', value: '尚未保存的质量资料' },
  { field: '质量手册附件 ID', value: 'pending-evidence-id' },
])('protects the admission $field when navigating away', async ({ field, value }) => {
  vi.mocked(apiRequest).mockResolvedValue({ items: [{ id: 'd1', documentType: 'QUALITY_MANUAL', title: '质量手册', status: 'DRAFT', version: 1 }], total: 1 } as never);
  render(<MemoryRouter><UnsavedChangesProvider><SupplierAdmissionPage portal /><Link to="/other">离开供应商资料页</Link></UnsavedChangesProvider></MemoryRouter>);
  await screen.findByRole('button', { name: '提交审核' });
  fireEvent.change(screen.getByLabelText(field), { target: { value } });
  fireEvent.click(screen.getByRole('link', { name: '离开供应商资料页' }));
  fireEvent.click(await screen.findByRole('button', { name: '继续编辑' }));
  expect(screen.getByLabelText(field)).toHaveValue(value);
  expect(apiRequest).not.toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ method: 'POST' }));
});

it('shows the real supplier document ledger and scan-bound submission affordance', async () => {
  vi.mocked(apiRequest).mockResolvedValueOnce({ items: [{ id: 'd1', profileId: 'p1', ownerOrganizationId: 'o1', supplierOrganizationId: 's1', documentType: 'QUALITY_MANUAL', title: '质量手册', status: 'DRAFT', version: 1, fileId: null, reviewNote: null, createdAt: '2026-09-24T00:00:00Z', updatedAt: '2026-09-24T00:00:00Z' }], total: 1, page: 1, pageSize: 50 });
  render(<SupplierAdmissionPage portal />);
  expect((await screen.findAllByText('质量手册'))[0]).toBeVisible();
  expect(screen.queryByText('请输入已扫描通过的附件 ID')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: '提交审核' })).toBeEnabled();
});
