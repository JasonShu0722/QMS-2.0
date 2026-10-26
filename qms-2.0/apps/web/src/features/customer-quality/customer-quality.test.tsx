import { fireEvent, render, screen } from '@testing-library/react';
import ExcelJS from 'exceljs';
import { beforeEach, expect, it, vi } from 'vitest';
import { apiRequest, csrfToken } from '../../api/client';
import { CustomerLegacyQualityPage as CustomerQualityPage } from './CustomerLegacyQualityPage';

vi.mock('../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../api/client')>('../../api/client');
  return { ...actual, apiRequest: vi.fn(), csrfToken: vi.fn() };
});

beforeEach(() => { vi.mocked(apiRequest).mockReset(); vi.mocked(csrfToken).mockReset().mockResolvedValue('csrf-token'); });
const permissions = { organizationId: 'org-1', permissions: ['customer-quality:complaints:read', 'customer-quality:complaints:write'] };

async function importFile(values: unknown[]) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('客诉');
  sheet.addRow(['customerId', 'complaintType', 'defectDescription', 'severity', 'severityPolicyVersion', 'severitySnapshot', 'externalSourceSystem', 'externalRecordKey', 'sourceObservedAt']);
  sheet.addRow(values);
  const bytes = await workbook.xlsx.writeBuffer();
  const file = new File([bytes], 'complaints.xlsx');
  Object.defineProperty(file, 'arrayBuffer', { value: async () => new Uint8Array(bytes as unknown as ArrayBuffer).buffer });
  fireEvent.change(screen.getByLabelText('选择客诉 Excel 文件'), { target: { files: [file] } });
}

it('shows a read failure without claiming the ledger is empty', async () => {
  vi.mocked(apiRequest).mockImplementation((path) => path === '/api/v1/system/my-permissions' ? Promise.resolve(permissions) : Promise.reject(new Error('offline')));
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
  vi.mocked(apiRequest).mockImplementation((path) => Promise.resolve(path === '/api/v1/system/my-permissions' ? permissions : path.endsWith('/complaint-1') ? { ...complaint, currentAnalysis: null, currentDisposition: null } : [complaint]));
  render(<CustomerQualityPage />);
  fireEvent.click(await screen.findByRole('button', { name: 'CUS-2026-01' }));
  expect(await screen.findByText('异响')).toBeVisible();
  expect(apiRequest).toHaveBeenCalledWith('/api/v1/customer-quality/complaints/complaint-1');
});

it('allows a complaint writer without system permissions to preview and import with CSRF and idempotency', async () => {
  vi.mocked(apiRequest).mockImplementation((path) => Promise.resolve(path === '/api/v1/system/my-permissions' ? permissions : path.endsWith('/import') ? { created: 1, duplicates: 0, rejected: 0, items: [{ rowNumber: 2, status: 'CREATED', complaintNumber: 'CQ-001', errorCode: null }] } : []));
  render(<CustomerQualityPage />);
  await screen.findByText('暂无客诉记录');
  await importFile(['11111111-1111-4111-8111-111111111111', 'ZERO_KM', '真实客诉', 'HIGH', 'policy-1', '{"level":"HIGH"}', 'IMS', 'IMS-001', '2026-09-24T02:00:00Z']);
  expect(await screen.findByText('真实客诉')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: '导入 1 条' }));
  expect(await screen.findByText('CQ-001')).toBeVisible();
  const [path, options] = vi.mocked(apiRequest).mock.calls.find(([requestPath]) => requestPath.endsWith('/import'))!;
  expect(path).toBe('/api/v1/customer-quality/complaints/import');
  expect(options).toMatchObject({ method: 'POST', headers: { 'x-csrf-token': 'csrf-token', 'Idempotency-Key': expect.any(String) } });
  expect(JSON.parse(String(options?.body))).toEqual({ rows: [expect.objectContaining({ rowNumber: 2, defectDescription: '真实客诉', externalRecordKey: 'IMS-001' })] });
  expect(vi.mocked(csrfToken)).toHaveBeenCalledOnce();
  expect(permissions.permissions).not.toContain('system:permissions:read');
  expect(apiRequest).toHaveBeenCalledWith('/api/v1/system/my-permissions');
});

it('blocks invalid rows and shows field-level errors', async () => {
  vi.mocked(apiRequest).mockImplementation((path) => Promise.resolve(path === '/api/v1/system/my-permissions' ? permissions : []));
  render(<CustomerQualityPage />);
  await screen.findByText('暂无客诉记录');
  await importFile(['bad-id', 'ZERO_KM', '', 'HIGH', 'policy-1', '{}', 'IMS', '', 'bad-date']);
  expect(await screen.findByText(/第 2 行.*customerId/)).toBeVisible();
  expect(screen.getByRole('button', { name: /导入 1 条/ })).toBeDisabled();
  expect(vi.mocked(apiRequest).mock.calls.some(([path]) => path.endsWith('/import'))).toBe(false);
});

it('retries the same batch with the same idempotency key after a request failure', async () => {
  let attempts = 0;
  vi.mocked(apiRequest).mockImplementation((path) => {
    if (path === '/api/v1/system/my-permissions') return Promise.resolve(permissions);
    if (path.endsWith('/import')) return ++attempts === 1 ? Promise.reject(new Error('offline')) : Promise.resolve({ created: 0, duplicates: 0, rejected: 1, items: [{ rowNumber: 2, status: 'REJECTED', complaintNumber: null, errorCode: 'CUSTOMER_MASTER_NOT_FOUND' }] });
    return Promise.resolve([]);
  });
  render(<CustomerQualityPage />);
  await screen.findByText('暂无客诉记录');
  await importFile(['11111111-1111-4111-8111-111111111111', 'ZERO_KM', '待处理客诉', 'HIGH', 'policy-1', '{}', 'IMS', 'IMS-004', '2026-09-24T02:00:00Z']);
  await screen.findByText('待处理客诉');
  fireEvent.click(await screen.findByRole('button', { name: '导入 1 条' }));
  expect(await screen.findByText('offline')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: '导入 1 条' }));
  expect(await screen.findByText('CUSTOMER_MASTER_NOT_FOUND')).toBeVisible();
  const requests = vi.mocked(apiRequest).mock.calls.filter(([path]) => path.endsWith('/import'));
  expect(requests[1][1]?.headers).toMatchObject({ 'Idempotency-Key': (requests[0][1]?.headers as Record<string, string>)['Idempotency-Key'] });
}, 30000);

it('hides the import control for a read-only permission context', async () => {
  vi.mocked(apiRequest).mockImplementation((path) => Promise.resolve(path === '/api/v1/system/my-permissions' ? { organizationId: 'org-1', permissions: ['customer-quality:complaints:read'] } : []));
  render(<CustomerQualityPage />);
  await screen.findByText('暂无客诉记录');
  expect(screen.queryByLabelText('选择客诉 Excel 文件')).not.toBeInTheDocument();
  expect(apiRequest).toHaveBeenCalledWith('/api/v1/system/my-permissions');
});
