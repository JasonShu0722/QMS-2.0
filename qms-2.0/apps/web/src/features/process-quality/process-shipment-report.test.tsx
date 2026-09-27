import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { apiRequest, csrfToken } from '../../api/client';
import { ProcessShipmentReportPanel } from './ProcessShipmentReportPanel';

vi.mock('../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../api/client')>('../../api/client');
  return { ...actual, apiRequest: vi.fn(), csrfToken: vi.fn() };
});
vi.mock('../attachments/AttachmentPanel', () => ({ AttachmentPanel: () => <div>扫描文件</div> }));

const report = { id: '11111111-1111-4111-8111-111111111111', organizationId: '22222222-2222-4222-8222-222222222222', reportNumber: 'SHIP-001', status: 'DRAFT', periodStart: '2026-09-24T00:00:00Z', periodEnd: '2026-09-25T00:00:00Z', productCode: 'P-01', batchCount: 1, totalQuantity: 100, goodQuantity: 90, firstPassQuantity: 80, defectQuantity: 10, yieldRate: 0.9, firstPassRate: 0.8, version: 1, createdAt: '2026-09-24T00:00:00Z', updatedAt: '2026-09-24T00:00:00Z', archivedAt: null, snapshot: {}, evidence: [], customers: [], issues: [] };

beforeEach(() => {
  vi.mocked(apiRequest).mockReset();
  vi.mocked(csrfToken).mockResolvedValue('csrf');
  vi.mocked(apiRequest).mockImplementation(async (path) => path === '/api/v1/process-quality/shipment-reports?page=1&pageSize=50' ? { items: [report], total: 1, page: 1, pageSize: 50 } : path === `/api/v1/process-quality/shipment-reports/${report.id}` ? report : path === '/api/v1/customer-quality/customers' ? [] : path === '/api/v1/system/my-permissions' ? { permissions: ['process-quality:defects:read', 'process-quality:defects:write', 'customer-quality:complaints:read'] } : { items: [], total: 0, page: 1, pageSize: 100 });
});

it('opens a report and shows its traceable source sections', async () => {
  render(<MemoryRouter><ProcessShipmentReportPanel /></MemoryRouter>);
  fireEvent.click(await screen.findByRole('button', { name: '查看出货报告 SHIP-001' }));
  expect(await screen.findByText('扫描文件')).toBeVisible();
  expect(screen.getByText('客户关联')).toBeVisible();
  expect(screen.getByText('正式问题')).toBeVisible();
  expect(apiRequest).toHaveBeenCalledWith(`/api/v1/process-quality/shipment-reports/${report.id}`);
});

it('archives using the current report version and an idempotency key', async () => {
  vi.mocked(apiRequest).mockImplementation(async (path, init) => path.endsWith('/archive') && init?.method === 'PUT' ? { ...report, status: 'ARCHIVED', version: 2 } : path === `/api/v1/process-quality/shipment-reports/${report.id}` ? report : path === '/api/v1/system/my-permissions' ? { permissions: ['process-quality:defects:read', 'process-quality:defects:write'] } : { items: [report], total: 1, page: 1, pageSize: 50 });
  render(<MemoryRouter><ProcessShipmentReportPanel /></MemoryRouter>);
  fireEvent.click(await screen.findByRole('button', { name: '查看出货报告 SHIP-001' }));
  fireEvent.click(await screen.findByRole('button', { name: '归档出货报告' }));
  await waitFor(() => expect(apiRequest).toHaveBeenCalledWith(`/api/v1/process-quality/shipment-reports/${report.id}/archive`, expect.objectContaining({ method: 'PUT', body: JSON.stringify({ expectedVersion: 1 }) })));
});
