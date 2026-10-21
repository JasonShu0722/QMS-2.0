import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import type { components } from '@qms/contracts';
import { apiRequest, csrfToken } from '../../api/client';
import { CustomerComplaintProcessing } from './CustomerComplaintProcessing';
import { CustomerComplaintEntry } from './CustomerComplaintEntry';
import { MemoryRouter, Link } from 'react-router-dom';
import { UnsavedChangesProvider } from '../../layouts/UnsavedChanges';

vi.mock('../attachments/AttachmentPanel', () => ({ AttachmentPanel: ({ onReady, onFilesChanged, readOnly }: { onReady?: (file: { id: string; status: string; scanStatus: string }) => void; onFilesChanged?: (files: unknown[]) => void; readOnly?: boolean }) => readOnly ? null : <><button onClick={() => onReady?.({ id: 'scanned-file', status: 'AVAILABLE', scanStatus: 'CLEAN' })}>模拟扫描完成</button><button onClick={() => onFilesChanged?.([{ id: 'pending', originalName: '恢复附件.txt', status: 'AVAILABLE', scanStatus: 'CLEAN' }])}>恢复附件扫描完成</button></> }));

vi.mock('../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../api/client')>('../../api/client');
  return { ...actual, apiRequest: vi.fn(), csrfToken: vi.fn() };
});

const complaint = {
  id: 'complaint-1', organization_id: 'organization-1', complaint_number: 'CQ-1', status: 'IN_ANALYSIS', version: 2,
  category: 'PRODUCT_QUALITY', category_note: null, responsible_department_id: 'department-1', owner_user_id: 'user-1',
} as unknown as components['schemas']['CustomerComplaintDetailDto'];

beforeEach(() => {
  vi.mocked(apiRequest).mockReset();
  vi.mocked(csrfToken).mockReset().mockResolvedValue('csrf');
  vi.mocked(apiRequest).mockImplementation((path) => Promise.resolve(path.endsWith('/events') ? [{ id: 'event-1', seq: 1, event_type: 'TRIAGED', note: '已分诊' }] : path.endsWith('/issues') || path.endsWith('/attachments') ? [] : { departments: [{ id: 'department-1', name: '质量部' }], users: [{ id: 'user-1', username: '经办人' }] }));
});

it('shows the event history without write controls for readers', async () => {
  render(<CustomerComplaintProcessing complaint={complaint} canWrite={false} refresh={vi.fn()} />);
  expect(await screen.findByText(/已分诊/)).toBeVisible();
  expect(screen.queryByRole('button', { name: '记录进展' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '模拟扫描完成' })).not.toBeInTheDocument();
  expect(apiRequest).not.toHaveBeenCalledWith('/api/v1/customer-quality/complaints/assignees');
});

it('submits a versioned progress event and refreshes the complaint', async () => {
  const refresh = vi.fn().mockResolvedValue(undefined);
  render(<CustomerComplaintProcessing complaint={complaint} canWrite refresh={refresh} />);
  fireEvent.change(await screen.findByLabelText('处理说明'), { target: { value: '已确认现场样件' } });
  fireEvent.click(screen.getByRole('button', { name: '记录进展' }));
  await waitFor(() => expect(apiRequest).toHaveBeenCalledWith('/api/v1/customer-quality/complaints/complaint-1/progress', expect.objectContaining({ method: 'POST', body: JSON.stringify({ expectedVersion: 2, note: '已确认现场样件' }) })));
  await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
});

it('registers a complaint with the supplied severity policy snapshot', async () => {
  const created = vi.fn().mockResolvedValue(undefined);
  vi.mocked(apiRequest).mockImplementation((path) => Promise.resolve(path.endsWith('/customers') ? [{ id: 'customer-1', code: 'C-1', name: '客户一', active: true }] : { id: 'new-complaint' }));
  render(<CustomerComplaintEntry onCreated={created} />);
  fireEvent.click(screen.getByRole('button', { name: '人工登记客诉' }));
  fireEvent.mouseDown(await screen.findByLabelText('登记客户'));
  fireEvent.click(await screen.findByText('C-1 · 客户一'));
  fireEvent.change(screen.getByLabelText('不良描述'), { target: { value: '尺寸超差' } });
  fireEvent.change(screen.getByLabelText('严重度策略版本'), { target: { value: 'policy-1' } });
  fireEvent.change(screen.getByLabelText('严重度策略快照 JSON'), { target: { value: '{"level":"LOW","policyVersion":"policy-1"}' } });
  fireEvent.click(screen.getByRole('button', { name: '登 记' }));
  await waitFor(() => expect(apiRequest).toHaveBeenCalledWith('/api/v1/customer-quality/complaints', expect.objectContaining({ method: 'POST', body: expect.stringContaining('"severitySnapshot":{"level":"LOW","policyVersion":"policy-1"}') })));
  expect(created).toHaveBeenCalledWith('new-complaint');
});

it('protects an unsaved complaint entry when leaving through page navigation', async () => {
  render(<MemoryRouter><UnsavedChangesProvider><CustomerComplaintEntry onCreated={vi.fn()} /><Link to="/app/workbench">返回工作台</Link></UnsavedChangesProvider></MemoryRouter>);
  fireEvent.click(screen.getByRole('button', { name: '人工登记客诉' }));
  fireEvent.change(await screen.findByLabelText('不良描述'), { target: { value: '尚未登记的不良描述' } });
  fireEvent.click(screen.getByRole('link', { name: '返回工作台' }));
  await waitFor(() => expect(screen.getByText('当前草稿尚未保存，继续将放弃修改。')).toBeVisible());
  await waitFor(() => expect(screen.getByRole('button', { name: '继续编辑' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: '继续编辑' }));
  expect(screen.getByLabelText('不良描述')).toHaveValue('尚未登记的不良描述');
});

it('protects an unfinished complaint progress note when navigating away', async () => {
  render(<MemoryRouter><UnsavedChangesProvider><CustomerComplaintProcessing complaint={complaint} canWrite refresh={vi.fn()} /><Link to="/app/workbench">返回工作台</Link></UnsavedChangesProvider></MemoryRouter>);
  await screen.findByText(/已分诊/);
  fireEvent.change(screen.getByLabelText('处理说明'), { target: { value: '尚未提交的处理记录' } });
  fireEvent.click(screen.getByRole('link', { name: '返回工作台' }));
  await waitFor(() => expect(screen.getByText('当前草稿尚未保存，继续将放弃修改。')).toBeVisible());
  await waitFor(() => expect(screen.getByRole('button', { name: '继续编辑' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: '继续编辑' }));
  expect(screen.getByLabelText('处理说明')).toHaveValue('尚未提交的处理记录');
});

it('binds only a scanned complaint attachment to a progress event', async () => {
  const refresh = vi.fn().mockResolvedValue(undefined);
  render(<CustomerComplaintProcessing complaint={complaint} canWrite refresh={refresh} />);
  fireEvent.change(await screen.findByLabelText('处理说明'), { target: { value: '现场照片已核验' } });
  fireEvent.click(screen.getByRole('button', { name: '模拟扫描完成' }));
  fireEvent.click(screen.getByRole('button', { name: '记录进展' }));
  await waitFor(() => expect(apiRequest).toHaveBeenCalledWith('/api/v1/customer-quality/complaints/complaint-1/progress', expect.objectContaining({
    body: JSON.stringify({ expectedVersion: 2, note: '现场照片已核验', evidenceFileObjectId: 'scanned-file' }),
  })));
  expect(refresh).toHaveBeenCalledTimes(1);
});

it('recovers unbound attachments and requires an explicit single evidence selection', async () => {
  vi.mocked(apiRequest).mockImplementation((path) => Promise.resolve(path.endsWith('/attachments') ? [
    { id: 'ready-one', originalName: '照片一.txt', status: 'AVAILABLE', scanStatus: 'CLEAN' },
    { id: 'ready-two', originalName: '照片二.txt', status: 'AVAILABLE', scanStatus: 'CLEAN' },
    { id: 'pending', originalName: '待扫描.txt', status: 'QUARANTINED', scanStatus: 'PENDING' },
  ] : path.endsWith('/events') || path.endsWith('/issues') ? [] : { departments: [], users: [] }));
  render(<CustomerComplaintProcessing complaint={complaint} canWrite refresh={vi.fn()} />);
  fireEvent.mouseDown(await screen.findByLabelText('进展附件证据'));
  fireEvent.click(await screen.findByText('照片一.txt'));
  expect(screen.queryByText('待扫描.txt')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '模拟扫描完成' }));
  fireEvent.change(screen.getByLabelText('处理说明'), { target: { value: '证据确认' } });
  fireEvent.click(screen.getByRole('button', { name: '记录进展' }));
  await waitFor(() => expect(apiRequest).toHaveBeenCalledWith('/api/v1/customer-quality/complaints/complaint-1/progress', expect.objectContaining({ body: JSON.stringify({ expectedVersion: 2, note: '证据确认', evidenceFileObjectId: 'ready-one' }) })));
});

it('offers a restored file after polling observes a clean scan without a page refresh', async () => {
  const refresh = vi.fn();
  vi.mocked(apiRequest).mockImplementation((path) => Promise.resolve(path.endsWith('/attachments') ? [{ id: 'pending', originalName: '恢复附件.txt', status: 'QUARANTINED', scanStatus: 'PENDING' }] : path.endsWith('/events') || path.endsWith('/issues') ? [] : { departments: [], users: [] }));
  render(<CustomerComplaintProcessing complaint={complaint} canWrite refresh={refresh} />);
  fireEvent.click(await screen.findByRole('button', { name: '恢复附件扫描完成' }));
  fireEvent.mouseDown(screen.getByLabelText('进展附件证据'));
  fireEvent.click(await screen.findByText('恢复附件.txt'));
  fireEvent.change(screen.getByLabelText('处理说明'), { target: { value: '扫描恢复完成' } });
  fireEvent.click(screen.getByRole('button', { name: '记录进展' }));
  await waitFor(() => expect(apiRequest).toHaveBeenCalledWith('/api/v1/customer-quality/complaints/complaint-1/progress', expect.objectContaining({ body: JSON.stringify({ expectedVersion: 2, note: '扫描恢复完成', evidenceFileObjectId: 'pending' }) })));
});
