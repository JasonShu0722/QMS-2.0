import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';
import { apiRequest, csrfToken } from '../../api/client';
import { SupplierPcnPage } from './SupplierPcnPage';
vi.mock('../../api/client', async () => { const actual = await vi.importActual<typeof import('../../api/client')>('../../api/client'); return { ...actual, apiRequest: vi.fn(), csrfToken: vi.fn().mockResolvedValue('csrf') }; });
vi.mock('../attachments/AttachmentPanel', () => ({ AttachmentPanel: () => null }));
beforeEach(() => vi.mocked(apiRequest).mockReset().mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 50 } as never));
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
