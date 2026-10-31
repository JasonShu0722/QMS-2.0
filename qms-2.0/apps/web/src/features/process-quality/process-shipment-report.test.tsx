import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { Link, MemoryRouter } from 'react-router-dom';
import { UnsavedChangesProvider } from '../../layouts/UnsavedChanges';
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
  vi.mocked(apiRequest).mockImplementation(async (path) => path.startsWith('/api/v1/process-quality/shipment-reports?') ? { items: [report], total: 1, page: 1, pageSize: Number(new URL(path, 'http://localhost').searchParams.get('pageSize')) } : path === `/api/v1/process-quality/shipment-reports/${report.id}` ? report : path === '/api/v1/customer-quality/customers' ? [] : path === '/api/v1/system/my-permissions' ? { permissions: ['process-quality:defects:read', 'process-quality:defects:write', 'customer-quality:complaints:read'] } : { items: [], total: 0, page: 1, pageSize: 100 });
});

it('loads report pages from the server and resets to page one when changing twenty rows to fifty', async () => {
  const read = vi.mocked(apiRequest).getMockImplementation()!;
  vi.mocked(apiRequest).mockImplementation(async path => path.startsWith('/api/v1/process-quality/shipment-reports?') ? { items: [report], total: 101, page: Number(new URL(path, 'http://localhost').searchParams.get('page')), pageSize: Number(new URL(path, 'http://localhost').searchParams.get('pageSize')) } : read(path));
  render(<MemoryRouter><ProcessShipmentReportPanel /></MemoryRouter>);
  await screen.findByLabelText('查看出货报告 SHIP-001', { selector: 'button' });
  expect(apiRequest).toHaveBeenCalledWith('/api/v1/process-quality/shipment-reports?page=1&pageSize=20');
  fireEvent.click(screen.getByTitle('2'));
  await waitFor(() => expect(apiRequest).toHaveBeenCalledWith('/api/v1/process-quality/shipment-reports?page=2&pageSize=20'));
  await screen.findByLabelText('查看出货报告 SHIP-001', { selector: 'button' });
  fireEvent.mouseDown(document.querySelector('.ant-pagination-options-size-changer [role="combobox"]')!);
  fireEvent.click(await screen.findByText('50 / page', { selector: '.ant-select-item-option-content' }));
  await waitFor(() => expect(apiRequest).toHaveBeenCalledWith('/api/v1/process-quality/shipment-reports?page=1&pageSize=50'));
});

it('opens a report and shows its traceable source sections', async () => {
  render(<MemoryRouter><ProcessShipmentReportPanel /></MemoryRouter>);
  fireEvent.click(await screen.findByLabelText('查看出货报告 SHIP-001', { selector: 'button' }));
  expect(await screen.findByText('扫描文件')).toBeVisible();
  expect(screen.getByText('客户关联')).toBeVisible();
  expect(screen.getByText('正式问题')).toBeVisible();
  expect(apiRequest).toHaveBeenCalledWith(`/api/v1/process-quality/shipment-reports/${report.id}`);
});

it('protects an unfinished shipment report when navigating away', async () => {
  render(<MemoryRouter><UnsavedChangesProvider><ProcessShipmentReportPanel /><Link to="/app/workbench">返回工作台</Link></UnsavedChangesProvider></MemoryRouter>);
  fireEvent.click(await screen.findByRole('button', { name: '新建出货报告' }));
  fireEvent.change(screen.getByLabelText('报告编号', { selector: 'input' }), { target: { value: 'SHIP-DRAFT' } });
  fireEvent.click(screen.getByRole('link', { name: '返回工作台' }));
  await waitFor(() => expect(screen.getByText('当前草稿尚未保存，继续将放弃修改。')).toBeVisible());
  await waitFor(() => expect(screen.getByRole('button', { name: '继续编辑' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: '继续编辑' }));
  expect(screen.getByLabelText('报告编号', { selector: 'input' })).toHaveValue('SHIP-DRAFT');
});

it('archives using the current report version and an idempotency key', async () => {
  vi.mocked(apiRequest).mockImplementation(async (path, init) => path.endsWith('/archive') && init?.method === 'PUT' ? { ...report, status: 'ARCHIVED', version: 2 } : path === `/api/v1/process-quality/shipment-reports/${report.id}` ? report : path === '/api/v1/system/my-permissions' ? { permissions: ['process-quality:defects:read', 'process-quality:defects:write'] } : { items: [report], total: 1, page: 1, pageSize: 50 });
  render(<MemoryRouter><ProcessShipmentReportPanel /></MemoryRouter>);
  fireEvent.click(await screen.findByLabelText('查看出货报告 SHIP-001', { selector: 'button' }));
  fireEvent.click(await screen.findByLabelText('归档出货报告', { selector: 'button' }));
  await waitFor(() => expect(apiRequest).toHaveBeenCalledWith(`/api/v1/process-quality/shipment-reports/${report.id}/archive`, expect.objectContaining({ method: 'PUT', body: JSON.stringify({ expectedVersion: 1 }) })));
});
