import { render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { apiRequest } from '../../api/client';
import { SupplierConcessionPage } from './SupplierConcessionPage';

vi.mock('../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../api/client')>('../../api/client');
  return { ...actual, apiRequest: vi.fn() };
});

beforeEach(() => vi.mocked(apiRequest).mockReset());

it('shows the scoped concession ledger and hides create without permission', async () => {
  vi.mocked(apiRequest).mockResolvedValueOnce({ items: [{ id: 'request-1', supplierName: '供应商甲', materialCode: 'MAT-01', incomingBatch: 'B-01', quantity: 8, status: 'APPROVED', expiresAt: '2026-09-25T10:00:00Z' }], total: 1, page: 1, pageSize: 20, canCreate: false });
  render(<SupplierConcessionPage />);
  expect(await screen.findByText('供应商甲')).toBeVisible();
  expect(screen.getByText('MAT-01')).toBeVisible();
  expect(screen.queryByRole('button', { name: '发起特采申请' })).not.toBeInTheDocument();
});

it('distinguishes an empty ledger from a load failure', async () => {
  vi.mocked(apiRequest).mockRejectedValueOnce(new Error('offline'));
  render(<SupplierConcessionPage />);
  expect(await screen.findByText('特采台账加载失败，请重试')).toBeVisible();
  expect(screen.queryByText('暂无特采申请')).not.toBeInTheDocument();
});
