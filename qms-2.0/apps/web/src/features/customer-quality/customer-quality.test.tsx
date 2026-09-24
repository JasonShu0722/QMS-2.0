import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { apiRequest } from '../../api/client';
import { CustomerQualityPage } from './CustomerQualityPage';

vi.mock('../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../api/client')>('../../api/client');
  return { ...actual, apiRequest: vi.fn() };
});

beforeEach(() => vi.mocked(apiRequest).mockReset());

it('shows a read failure without claiming the ledger is empty', async () => {
  vi.mocked(apiRequest).mockRejectedValueOnce(new Error('offline'));
  render(<CustomerQualityPage />);
  expect(await screen.findByText('客诉台账加载失败，请重试。')).toBeVisible();
  expect(screen.queryByText('暂无客诉记录')).not.toBeInTheDocument();
});

it('opens a complaint detail from a successful ledger', async () => {
  const complaint = {
    id: 'complaint-1', complaint_number: 'CUS-2026-01', complaint_type: 'AFTER_SALES',
    product_code: 'P-01', vin: null, defect_description: '异响', severity: 'HIGH',
    status: 'OPEN', created_at: '2026-09-24T00:00:00.000Z',
  };
  vi.mocked(apiRequest).mockResolvedValueOnce([complaint]).mockResolvedValueOnce({ ...complaint, currentAnalysis: null, currentDisposition: null });
  render(<CustomerQualityPage />);
  fireEvent.click(await screen.findByRole('button', { name: 'CUS-2026-01' }));
  expect(await screen.findByText('异响')).toBeVisible();
  expect(apiRequest).toHaveBeenCalledWith('/api/v1/customer-quality/complaints/complaint-1');
});
