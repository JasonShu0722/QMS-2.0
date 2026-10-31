import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ConfigProvider } from 'antd';
import { MemoryRouter } from 'react-router-dom';
import { UnsavedChangesProvider } from '../../layouts/UnsavedChanges';
import { beforeEach, expect, it, vi } from 'vitest';
import { apiRequest, csrfToken } from '../../api/client';
import { CoordinateInspectionPage } from './CoordinateInspectionPage';

vi.mock('../../api/client', async () => { const actual = await vi.importActual<typeof import('../../api/client')>('../../api/client'); return { ...actual, apiRequest: vi.fn(), csrfToken: vi.fn() }; });
beforeEach(() => { vi.mocked(apiRequest).mockReset(); });
it('shows coordinate inspection requests', async () => { vi.mocked(apiRequest).mockResolvedValueOnce({ items: [{ id: '1', requestNumber: 'CMM-1', partNumber: 'P-1', partName: '壳体', sampleQuantity: 2, purpose: 'PROCESS', priority: 'NORMAL', status: 'SUBMITTED', progressPercent: 0, version: 1, updatedAt: '2026-09-24T00:00:00Z' }], total: 1, page: 1, pageSize: 50 }); render(<CoordinateInspectionPage />); expect(await screen.findByText('三坐标检测')).toBeVisible(); expect(await screen.findByText('CMM-1')).toBeVisible(); });

it('submits a draft with its expected version', async () => {
  vi.mocked(csrfToken).mockResolvedValue('csrf-token');
  vi.mocked(apiRequest).mockResolvedValueOnce({ items: [{ id: '00000000-0000-4000-8000-000000000001', requestNumber: 'CMM-2', partNumber: 'P-2', partName: '端盖', sampleQuantity: 1, purpose: 'PROCESS', priority: 'NORMAL', status: 'DRAFT', progressPercent: 0, version: 3, updatedAt: '2026-09-24T00:00:00Z' }], total: 1, page: 1, pageSize: 20 }).mockResolvedValueOnce({}).mockResolvedValueOnce({ items: [], total: 0, page: 1, pageSize: 20 });
  render(<ConfigProvider theme={{ token: { motion: false } }}><CoordinateInspectionPage /></ConfigProvider>);
  fireEvent.click(await screen.findByRole('button', { name: 'CMM-2' }));
  const dialog = screen.getByText('检测申请 CMM-2', { selector: '.ant-modal-title' }).closest('[role="dialog"]') as HTMLElement;
  fireEvent.click(within(dialog).getByRole('button', { name: '提交审批' }));
  await waitFor(() => expect(vi.mocked(apiRequest)).toHaveBeenCalledWith('/api/v1/coordinate-inspection/requests/00000000-0000-4000-8000-000000000001/submit', expect.objectContaining({ method: 'PUT', body: JSON.stringify({ expectedVersion: 3 }) })));
});

it.each([
  ['零件号', 'P-CHANGED'],
  ['零件名称', '修改后的端盖'],
  ['批次号', 'BATCH-CHANGED'],
  ['样品数量', '2'],
])('blocks submitting the saved draft while %s has unsaved changes', async (label, value) => {
  vi.mocked(csrfToken).mockResolvedValue('csrf-token');
  vi.mocked(apiRequest).mockResolvedValueOnce({ items: [{ id: '00000000-0000-4000-8000-000000000001', requestNumber: 'CMM-DIRTY', partNumber: 'P-2', partName: '端盖', batchNumber: 'BATCH-1', sampleQuantity: 1, purpose: 'PROCESS', priority: 'NORMAL', status: 'DRAFT', progressPercent: 0, version: 3, updatedAt: '2026-09-24T00:00:00Z' }], total: 1, page: 1, pageSize: 20 });
  render(<ConfigProvider theme={{ token: { motion: false } }}><CoordinateInspectionPage /></ConfigProvider>);
  fireEvent.click(await screen.findByRole('button', { name: 'CMM-DIRTY' }));
  const dialog = screen.getByText('检测申请 CMM-DIRTY', { selector: '.ant-modal-title' }).closest('[role="dialog"]') as HTMLElement;
  const submit = within(dialog).getByRole('button', { name: '提交审批' });
  expect(submit).toBeEnabled();
  const input = screen.getByLabelText(label);
  const originalValue = (input as HTMLInputElement).value;
  fireEvent.change(input, { target: { value } });
  expect(screen.getByLabelText(label)).toHaveValue(value);
  await waitFor(() => expect(submit).toBeDisabled());
  fireEvent.click(submit);
  expect(vi.mocked(apiRequest).mock.calls.some(([path, init]) => String(path).endsWith('/submit') && init?.method === 'PUT')).toBe(false);
  await waitFor(() => expect(dialog).toBeVisible());
  fireEvent.change(input, { target: { value: originalValue } });
  await waitFor(() => expect(submit).toBeEnabled());
});

it('retains an unsaved application when modal closing is declined', async () => {
  vi.mocked(apiRequest).mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 });
  render(<ConfigProvider theme={{ token: { motion: false } }}><MemoryRouter><UnsavedChangesProvider><CoordinateInspectionPage /></UnsavedChangesProvider></MemoryRouter></ConfigProvider>);
  fireEvent.click(await screen.findByRole('button', { name: '新建申请' }));
  const dialog = screen.getByText('新建三坐标检测申请', { selector: '.ant-modal-title' }).closest('[role="dialog"]') as HTMLElement;
  fireEvent.change(screen.getByLabelText('零件号'), { target: { value: 'KEEP-DRAFT' } });
  fireEvent.click(within(dialog).getByRole('button', { name: /取\s*消/ }));
  const confirmation = screen.getByText('当前草稿尚未保存，继续将放弃修改。', { selector: '.ant-modal-title' }).closest('[role="dialog"]') as HTMLElement;
  await waitFor(() => expect(within(confirmation).getByRole('button', { name: '继续编辑' })).toBeVisible(), { timeout: 5000 });
  fireEvent.click(within(confirmation).getByRole('button', { name: '继续编辑' }));
  expect(screen.getByLabelText('零件号')).toHaveValue('KEEP-DRAFT');
  expect(apiRequest).toHaveBeenCalledTimes(1);
});
