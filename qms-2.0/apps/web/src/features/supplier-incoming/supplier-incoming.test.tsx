import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { apiRequest, csrfToken } from '../../api/client';
import { SupplierIncomingPage } from './SupplierIncomingPage';
import { AttachmentPanel } from '../attachments/AttachmentPanel';

vi.mock('../attachments/AttachmentPanel', () => ({ AttachmentPanel: vi.fn(({ onReady }: { onReady?: (file: unknown) => void }) => <div>照片上传与扫描<button onClick={() => onReady?.({ id: 'photo-1', status: 'AVAILABLE', scanStatus: 'CLEAN' })}>模拟扫描通过</button></div>) }));

vi.mock('../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../api/client')>('../../api/client');
  return { ...actual, apiRequest: vi.fn(), csrfToken: vi.fn().mockResolvedValue('csrf-token') };
});

beforeEach(() => { vi.mocked(apiRequest).mockReset(); vi.mocked(csrfToken).mockResolvedValue('csrf-token'); });

const record = { id: 'inspection-1', organizationId: 'org-1', profileId: 'profile-1', supplierOrganizationId: 'supplier-1', supplierBusinessCode: 'SUP-01', supplierName: '测试供应商', materialCode: 'MAT-01', incomingBatch: 'B-01', receivedQuantity: 100, sampledQuantity: 10, conclusion: null, status: 'DRAFT', inspectorId: 'user-1', inspectedAt: null, sourceSystem: 'MANUAL', externalRecordKey: null, externalBatchKey: null, observedAt: null, correctionReason: null, version: 1, createdAt: '2026-09-24T00:00:00.000Z', updatedAt: '2026-09-24T00:00:00.000Z' } as const;

it('shows the ledger and opens an inspection detail', async () => {
  vi.mocked(apiRequest).mockResolvedValueOnce({ items: [record], total: 1, page: 1, pageSize: 20 }).mockResolvedValueOnce({ ...record, items: [], photos: [] });
  render(<SupplierIncomingPage />);
  expect(await screen.findByText('来料检验台账')).toBeVisible();
  fireEvent.click(await screen.findByRole('button', { name: '测试供应商' }));
  expect(await screen.findByText('检验项目')).toBeVisible();
  expect(screen.getByText('检验记录 ID')).toBeVisible();
  expect(screen.getByText('inspection-1')).toBeVisible();
  expect(apiRequest).toHaveBeenCalledWith('/api/v1/supplier-incoming/inspections/inspection-1');
});

it('creates a manual inspection draft', async () => {
  vi.mocked(apiRequest).mockResolvedValueOnce({ items: [], total: 0, page: 1, pageSize: 20 }).mockResolvedValueOnce(record);
  render(<SupplierIncomingPage />);
  fireEvent.click(await screen.findByRole('button', { name: '新建检验草稿' }));
  fireEvent.change(screen.getByLabelText('供应商资料 ID'), { target: { value: 'profile-1' } });
  fireEvent.change(screen.getByLabelText('物料编码'), { target: { value: 'MAT-01' } });
  fireEvent.change(screen.getByLabelText('来料批次'), { target: { value: 'B-01' } });
  fireEvent.change(screen.getByLabelText('收货数量'), { target: { value: '100' } });
  fireEvent.change(screen.getByLabelText('抽检数量'), { target: { value: '10' } });
  fireEvent.click(screen.getByRole('button', { name: '保存草稿' }));
  await waitFor(() => expect(apiRequest).toHaveBeenCalledWith('/api/v1/supplier-incoming/inspections', expect.objectContaining({ method: 'POST' })));
  expect(vi.mocked(apiRequest).mock.calls[1]?.[1]?.body).toContain('"sourceSystem":"MANUAL"');
});

it('keeps a failed ledger request distinct from an empty ledger', async () => {
  vi.mocked(apiRequest).mockRejectedValueOnce(new Error('offline'));
  render(<SupplierIncomingPage />);
  expect(await screen.findByText('IQC 台账加载失败，请重试。')).toBeVisible();
  expect(screen.queryByText('暂无来料检验记录')).not.toBeInTheDocument();
});

it('uses the file lifecycle panel for an IQC record instead of asking for a file UUID', async () => {
  vi.mocked(apiRequest).mockResolvedValueOnce({ items: [record], total: 1, page: 1, pageSize: 20 }).mockResolvedValueOnce({ ...record, items: [], photos: [] });
  render(<SupplierIncomingPage />);
  fireEvent.click(await screen.findByRole('button', { name: '测试供应商' }));
  expect(await screen.findByText('照片上传与扫描')).toBeVisible();
  expect(AttachmentPanel).toHaveBeenCalledWith(expect.objectContaining({ resource: { resourceType: 'supplier-incoming', resourceId: record.id }, fileIds: [] }), undefined);
  expect(screen.queryByLabelText('照片文件 ID')).not.toBeInTheDocument();
});

it('archives an uploaded photo only after the file lifecycle panel reports it clean', async () => {
  vi.mocked(apiRequest).mockResolvedValueOnce({ items: [record], total: 1, page: 1, pageSize: 20 })
    .mockResolvedValueOnce({ ...record, items: [], photos: [] })
    .mockResolvedValueOnce({ id: 'photo-link-1', file_id: 'photo-1' })
    .mockResolvedValueOnce({ ...record, version: 2, items: [], photos: [{ id: 'photo-link-1', file_id: 'photo-1' }] });
  render(<SupplierIncomingPage />);
  fireEvent.click(await screen.findByRole('button', { name: '测试供应商' }));
  expect(screen.queryByRole('button', { name: '归档已扫描照片' })).not.toBeInTheDocument();
  fireEvent.click(await screen.findByRole('button', { name: '模拟扫描通过' }));
  fireEvent.click(screen.getByRole('button', { name: '归档已扫描照片' }));
  await waitFor(() => expect(apiRequest).toHaveBeenCalledWith('/api/v1/supplier-incoming/inspections/inspection-1/photos', expect.objectContaining({ method: 'POST', body: JSON.stringify({ fileId: 'photo-1', expectedVersion: 1 }) })));
}, 30000);

it('offers an explicit NG problem draft trigger and preserves the link on reload', async () => {
  const ng = { ...record, conclusion: 'NG', status: 'COMPLETED', version: 2 };
  vi.mocked(apiRequest).mockResolvedValueOnce({ items: [ng], total: 1, page: 1, pageSize: 20 })
    .mockResolvedValueOnce({ ...ng, items: [], photos: [], problemLinks: [] })
    .mockResolvedValueOnce({ id: 'link-1', problem_id: 'problem-1' })
    .mockResolvedValueOnce({ ...ng, items: [], photos: [], problemLinks: [{ id: 'link-1', problem_id: 'problem-1' }] });
  render(<SupplierIncomingPage />);
  fireEvent.click(await screen.findByRole('button', { name: '测试供应商' }));
  fireEvent.click(await screen.findByRole('button', { name: '创建供应商问题草稿' }));
  fireEvent.change(await screen.findByLabelText('不良描述'), { target: { value: '外观缺陷' } });
  fireEvent.click(screen.getByRole('button', { name: '创建并关联' }));
  await waitFor(() => expect(apiRequest).toHaveBeenCalledWith('/api/v1/supplier-incoming/inspections/inspection-1/problem-links', expect.objectContaining({ method: 'POST', body: expect.stringContaining('"expectedVersion":2') })));
  expect(await screen.findByRole('link', { name: '查看供应商问题' })).toHaveAttribute('href', '/app/supplier-quality/problems/problem-1');
  expect(screen.queryByRole('button', { name: '创建供应商问题草稿' })).not.toBeInTheDocument();
}, 30000);
