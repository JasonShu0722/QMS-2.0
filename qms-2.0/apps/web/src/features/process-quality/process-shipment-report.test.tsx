import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ComponentProps } from 'react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';
import { Link, MemoryRouter } from 'react-router-dom';
import { UnsavedChangesProvider } from '../../layouts/UnsavedChanges';
import { apiRequest, csrfToken } from '../../api/client';
import { AttachmentPanel } from '../attachments/AttachmentPanel';
import { ProcessShipmentReportPanel } from './ProcessShipmentReportPanel';

vi.mock('../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../api/client')>('../../api/client');
  return { ...actual, apiRequest: vi.fn(), csrfToken: vi.fn() };
});
vi.mock('../attachments/AttachmentPanel', () => ({
  AttachmentPanel: vi.fn(({ fileIds }: ComponentProps<typeof AttachmentPanel>) => <div>扫描文件{fileIds.map(id => <span key={id}>{id}</span>)}</div>),
}));

const report = { id: '11111111-1111-4111-8111-111111111111', organizationId: '22222222-2222-4222-8222-222222222222', reportNumber: 'SHIP-001', status: 'DRAFT', periodStart: '2026-09-24T00:00:00Z', periodEnd: '2026-09-25T00:00:00Z', productCode: 'P-01', batchCount: 1, totalQuantity: 100, goodQuantity: 90, firstPassQuantity: 80, defectQuantity: 10, yieldRate: 0.9, firstPassRate: 0.8, version: 1, createdAt: '2026-09-24T00:00:00Z', updatedAt: '2026-09-24T00:00:00Z', archivedAt: null, snapshot: {}, evidence: [], customers: [], issues: [] };

beforeEach(() => {
  vi.mocked(AttachmentPanel).mockClear();
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
  const warning = vi.spyOn(console, 'error');
  try {
    render(<MemoryRouter><ProcessShipmentReportPanel /></MemoryRouter>);
    fireEvent.click(await screen.findByLabelText('查看出货报告 SHIP-001', { selector: 'button' }));
    expect(await screen.findByText('扫描文件')).toBeVisible();
    expect(screen.getByText('客户关联')).toBeVisible();
    expect(screen.getByText('正式问题')).toBeVisible();
    expect(screen.getByText('尚未绑定扫描文件')).toBeVisible();
    expect(screen.getByText('尚未关联客户')).toBeVisible();
    expect(screen.getByText('尚未关联正式问题')).toBeVisible();
    expect(apiRequest).toHaveBeenCalledWith(`/api/v1/process-quality/shipment-reports/${report.id}`);
    expect(warning.mock.calls.flat().join('\n')).not.toMatch(/\[antd: (List|Drawer)\].*deprecated/i);
  } finally { warning.mockRestore(); }
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

it('confirms the named shipment report before archiving with the current version and idempotency key', async () => {
  const read = vi.mocked(apiRequest).getMockImplementation()!;
  const archivePath = `/api/v1/process-quality/shipment-reports/${report.id}/archive`;
  const archivedReport = { ...report, status: 'ARCHIVED', version: 2 };
  let archived = false;
  vi.mocked(apiRequest).mockImplementation(async (path, init) => {
    if (path === '/api/v1/customer-quality/customers') return [{ id: 'customer-1', code: 'C01', name: '客户一', active: true }];
    if (path === archivePath && init?.method === 'PUT') { archived = true; return archivedReport; }
    if (archived && path.endsWith(report.id)) return archivedReport;
    if (archived && path.includes('shipment-reports?')) return { items: [], total: 0, page: 1, pageSize: 20 };
    return read(path, init);
  });
  render(<MemoryRouter><UnsavedChangesProvider><ProcessShipmentReportPanel /></UnsavedChangesProvider></MemoryRouter>);
  fireEvent.click(await screen.findByLabelText('查看出货报告 SHIP-001', { selector: 'button' }));
  const drawer = await screen.findByRole('dialog', { name: 'SHIP-001' });
  fireEvent.mouseDown(within(drawer).getByLabelText('选择出货客户'));
  fireEvent.click(await screen.findByText('C01 · 客户一'));
  const issue = within(drawer).getByLabelText('正式问题 ID');
  fireEvent.change(issue, { target: { value: 'issue-draft' } });
  const archive = await screen.findByLabelText('归档出货报告', { selector: 'button' });
  archive.focus();
  await userEvent.keyboard('{Enter}');
  const dialog = await screen.findByRole('dialog', { name: '归档出货报告 · SHIP-001' });
  await waitFor(() => expect(dialog).toContainElement(document.activeElement as HTMLElement), { container: dialog });
  expect(within(dialog).getByText('移出默认列表，报告及关联记录保留。未保存的更改不会归档。')).toBeVisible();
  await userEvent.keyboard('{Escape}');
  await waitFor(() => expect(archive).toHaveFocus());
  expect(issue).toHaveValue('issue-draft');
  expect(within(drawer).getByText('C01 · 客户一')).toBeVisible();
  expect(apiRequest).not.toHaveBeenCalledWith(expect.stringMatching(/\/archive$/), expect.anything());
  await userEvent.keyboard('{Enter}');
  fireEvent.click(within(await screen.findByRole('dialog', { name: '归档出货报告 · SHIP-001' })).getByRole('button', { name: '确认归档' }));
  await within(drawer).findByText('已归档');
  expect(apiRequest).toHaveBeenCalledWith(archivePath, expect.objectContaining({ method: 'PUT', body: JSON.stringify({ expectedVersion: 1 }), headers: expect.objectContaining({ 'Idempotency-Key': expect.any(String) }) }));
  fireEvent.click(within(drawer).getByRole('button', { name: 'Close' }));
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'SHIP-001' })).not.toBeInTheDocument());
  expect(screen.queryByText('当前草稿尚未保存，继续将放弃修改。')).not.toBeInTheDocument();
});

it('ignores a late attachment scan after archive succeeds while the detail refresh is pending', async () => {
  const read = vi.mocked(apiRequest).getMockImplementation()!;
  const detailPath = `/api/v1/process-quality/shipment-reports/${report.id}`;
  const archivedReport = { ...report, status: 'ARCHIVED', version: 2 };
  const detailRefresh = new Promise<typeof archivedReport>(() => {});
  let archived = false;
  vi.mocked(apiRequest).mockImplementation(async (path, init) => {
    if (path === `${detailPath}/archive` && init?.method === 'PUT') { archived = true; return archivedReport; }
    if (archived && path === detailPath) return detailRefresh;
    return read(path, init);
  });
  render(<MemoryRouter><UnsavedChangesProvider><ProcessShipmentReportPanel /></UnsavedChangesProvider></MemoryRouter>);
  fireEvent.click(await screen.findByLabelText('查看出货报告 SHIP-001', { selector: 'button' }));
  const drawer = await screen.findByRole('dialog', { name: 'SHIP-001' });
  const onReady = vi.mocked(AttachmentPanel).mock.lastCall![0].onReady!;
  const readyFile = { id: 'draft-scan', status: 'AVAILABLE', scanStatus: 'CLEAN' } as Parameters<typeof onReady>[0];
  act(() => { onReady(readyFile); });
  expect(within(drawer).getByText('draft-scan')).toBeVisible();

  fireEvent.click(within(drawer).getByRole('button', { name: '归档出货报告' }));
  const dialog = await screen.findByRole('dialog', { name: '归档出货报告 · SHIP-001' });
  fireEvent.click(within(dialog).getByRole('button', { name: '确认归档' }));
  await waitFor(() => expect(vi.mocked(apiRequest).mock.calls.filter(([path]) => path === detailPath)).toHaveLength(2));
  expect(within(drawer).queryByText('draft-scan')).not.toBeInTheDocument();

  act(() => { onReady({ ...readyFile, id: 'late-scan' }); });
  expect(within(drawer).queryByText('late-scan')).not.toBeInTheDocument();
  fireEvent.click(within(drawer).getByRole('button', { name: 'Close' }));
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'SHIP-001' })).not.toBeInTheDocument());
  expect(screen.queryByText('当前草稿尚未保存，继续将放弃修改。')).not.toBeInTheDocument();
});
