import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { apiRequest, csrfToken } from '../../api/client';
import { SupplierPerformancePortalPage } from './SupplierPerformancePortalPage';

vi.mock('../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../api/client')>('../../api/client');
  return { ...actual, apiRequest: vi.fn(), csrfToken: vi.fn() };
});

beforeEach(() => { vi.mocked(apiRequest).mockReset(); vi.mocked(csrfToken).mockReset(); vi.mocked(csrfToken).mockResolvedValue('csrf-test'); });

it('shows published cards and submits a supplier appeal with CSRF', async () => {
  vi.mocked(apiRequest).mockImplementation(async (path) => {
    if (String(path).startsWith('/api/v1/supplier-portal/performance/cards?')) return { items: [{ id: 'card-1', supplierName: '本企业', month: '2026-09', status: 'PUBLISHED', totalScore: 82, incomingScore: 80, cooperationScore: 85, inspectionCount: 5, passCount: 4, incomingWeight: 60, cooperationWeight: 40, cooperationNote: '待核实', sourceInspections: [] }], total: 1 } as never;
    if (path === '/api/v1/supplier-portal/performance/appeals') return { items: [], total: 0 } as never;
    throw new Error(String(path));
  });
  render(<SupplierPerformancePortalPage />);
  expect(await screen.findByText('2026-09')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: '提出申诉' }));
  fireEvent.change(screen.getByRole('textbox', { name: '申诉说明' }), { target: { value: '本月来料批次结论需复核' } });
  fireEvent.click(screen.getByRole('button', { name: '保存申诉草稿' }));
  await waitFor(() => expect(vi.mocked(apiRequest)).toHaveBeenCalledWith('/api/v1/supplier-portal/performance/appeals', expect.objectContaining({ method: 'POST', headers: expect.objectContaining({ 'x-csrf-token': 'csrf-test', 'Idempotency-Key': expect.any(String) }), body: JSON.stringify({ cardId: 'card-1', reason: '本月来料批次结论需复核' }) })));
});
