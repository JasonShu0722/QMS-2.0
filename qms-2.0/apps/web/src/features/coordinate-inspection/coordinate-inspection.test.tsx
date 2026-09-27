import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { apiRequest, csrfToken } from '../../api/client';
import { CoordinateInspectionPage } from './CoordinateInspectionPage';

vi.mock('../../api/client', async () => { const actual = await vi.importActual<typeof import('../../api/client')>('../../api/client'); return { ...actual, apiRequest: vi.fn(), csrfToken: vi.fn() }; });
beforeEach(() => { vi.mocked(apiRequest).mockReset(); });
it('shows coordinate inspection requests', async () => { vi.mocked(apiRequest).mockResolvedValueOnce({ items: [{ id: '1', requestNumber: 'CMM-1', partNumber: 'P-1', partName: '壳体', sampleQuantity: 2, purpose: 'PROCESS', priority: 'NORMAL', status: 'SUBMITTED', progressPercent: 0, version: 1, updatedAt: '2026-09-24T00:00:00Z' }], total: 1, page: 1, pageSize: 50 }); render(<CoordinateInspectionPage />); expect(await screen.findByText('三坐标检测')).toBeVisible(); expect(await screen.findByText('CMM-1')).toBeVisible(); });

it('submits a draft with its expected version', async () => {
  vi.mocked(csrfToken).mockResolvedValue('csrf-token');
  vi.mocked(apiRequest).mockResolvedValueOnce({ items: [{ id: '00000000-0000-4000-8000-000000000001', requestNumber: 'CMM-2', partNumber: 'P-2', partName: '端盖', sampleQuantity: 1, purpose: 'PROCESS', priority: 'NORMAL', status: 'DRAFT', progressPercent: 0, version: 3, updatedAt: '2026-09-24T00:00:00Z' }], total: 1, page: 1, pageSize: 20 }).mockResolvedValueOnce({}).mockResolvedValueOnce({ items: [], total: 0, page: 1, pageSize: 20 });
  render(<CoordinateInspectionPage />);
  fireEvent.click(await screen.findByRole('button', { name: 'CMM-2' }));
  fireEvent.click(screen.getByRole('button', { name: '提交审批' }));
  await waitFor(() => expect(vi.mocked(apiRequest)).toHaveBeenCalledWith('/api/v1/coordinate-inspection/requests/00000000-0000-4000-8000-000000000001/submit', expect.objectContaining({ method: 'PUT', body: JSON.stringify({ expectedVersion: 3 }) })));
});
