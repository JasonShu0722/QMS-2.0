import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { apiRequest, csrfToken } from '../../api/client';
import { SupplierPerformancePage } from './SupplierPerformancePage';

vi.mock('../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../api/client')>('../../api/client');
  return { ...actual, apiRequest: vi.fn(), csrfToken: vi.fn() };
});

beforeEach(() => { vi.mocked(apiRequest).mockReset(); vi.mocked(csrfToken).mockReset(); vi.mocked(csrfToken).mockResolvedValue('csrf-test'); });

it('shows a source-backed monthly card and its scoring policy', async () => {
  vi.mocked(apiRequest)
    .mockResolvedValueOnce({ items: [{ id: 'card-1', supplierName: '供应商甲', month: '2026-09', inspectionCount: 4, passCount: 3, incomingScore: 75, cooperationScore: 90, incomingWeight: 60, cooperationWeight: 40, totalScore: 81, sourceInspections: [], cooperationNote: '按期回复' }], total: 1 })
    .mockResolvedValueOnce({ items: [], total: 0, canManage: false })
    .mockResolvedValueOnce({ items: [], total: 0 });
  render(<SupplierPerformancePage />);
  const ledger = await screen.findByRole('region', { name: '月度绩效卡台账' });
  expect(within(ledger).getByText('供应商甲')).toBeVisible();
  expect(within(ledger).getByText('4 / 3')).toBeVisible();
  expect(within(ledger).getByText('81')).toBeVisible();
  expect(screen.getByText(/评分权重由建卡人填写/)).toBeVisible();
});

it('distinguishes no cards from loading failure', async () => {
  vi.mocked(apiRequest).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ items: [], total: 0, canManage: false }).mockResolvedValueOnce({ items: [], total: 0 });
  render(<SupplierPerformancePage />);
  expect(await screen.findByText('绩效卡加载失败，请重试')).toBeVisible();
  expect(screen.queryByText('暂无月度绩效卡')).not.toBeInTheDocument();
});

it('publishes a draft card with CAS and a stable idempotency key', async () => {
  vi.mocked(apiRequest).mockImplementation(async (path) => {
    if (path === '/api/v1/supplier-performance/cards?page=1&pageSize=20') return { items: [{ id: 'card-1', supplierName: '供应商甲', month: '2026-09', status: 'DRAFT', version: 2, inspectionCount: 4, passCount: 3, incomingScore: 75, cooperationScore: 90, incomingWeight: 60, cooperationWeight: 40, totalScore: 81, sourceInspections: [], cooperationNote: '按期回复' }], total: 1 } as never;
    if (path === '/api/v1/supplier-quality/profiles?page=1&pageSize=100') return { items: [], total: 0 } as never;
    if (path === '/api/v1/supplier-performance/cards/card-1/publish') return { id: 'card-1', status: 'PUBLISHED', version: 3 } as never;
    throw new Error(String(path));
  });
  render(<SupplierPerformancePage />);
  fireEvent.click(await screen.findByRole('button', { name: '发布绩效卡' }));
  await waitFor(() => expect(vi.mocked(apiRequest)).toHaveBeenCalledWith('/api/v1/supplier-performance/cards/card-1/publish', expect.objectContaining({ method: 'PUT', headers: expect.objectContaining({ 'Idempotency-Key': expect.any(String), 'x-csrf-token': 'csrf-test' }), body: JSON.stringify({ expectedVersion: 2 }) })));
});

it('reviews a submitted supplier appeal from the internal page', async () => {
  vi.mocked(apiRequest).mockImplementation(async (path) => {
    if (String(path).startsWith('/api/v1/supplier-performance/cards?')) return { items: [], total: 0 } as never;
    if (path === '/api/v1/supplier-quality/profiles?page=1&pageSize=100') return { items: [], total: 0 } as never;
    if (path === '/api/v1/supplier-performance/appeals') return { items: [{ id: 'appeal-1', cardId: 'card-1', reason: '检验批次有误', status: 'SUBMITTED', version: 2 }], total: 1 } as never;
    if (path === '/api/v1/supplier-performance/appeals/appeal-1/review') return { id: 'appeal-1', status: 'ACCEPTED', version: 3 } as never;
    throw new Error(String(path));
  });
  render(<SupplierPerformancePage />);
  expect(await screen.findByText('检验批次有误')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: '复核申诉' }));
  fireEvent.change(screen.getByRole('textbox', { name: '复核说明' }), { target: { value: '核实检验记录，确认需要更正' } });
  fireEvent.click(screen.getByRole('button', { name: '采纳申诉' }));
  await waitFor(() => expect(vi.mocked(apiRequest)).toHaveBeenCalledWith('/api/v1/supplier-performance/appeals/appeal-1/review', expect.objectContaining({ method: 'PUT', body: JSON.stringify({ expectedVersion: 2, decision: 'ACCEPTED', note: '核实检验记录，确认需要更正' }) })));
});
