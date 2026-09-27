import { expect, it, vi, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SupplierAuditPage } from './SupplierAuditPage';
import * as client from '../../api/client';

vi.mock('../../api/client', async (importOriginal) => ({ ...(await importOriginal<typeof client>()), apiRequest: vi.fn(), csrfToken: vi.fn().mockResolvedValue('csrf') }));
const request = vi.mocked(client.apiRequest);
const plan = { id: 'plan-1', profileId: 'profile-1', auditYear: 2026, auditType: 'ANNUAL', title: '年度审核', plannedStart: '2026-09-01T00:00:00Z', plannedEnd: '2026-09-02T00:00:00Z', status: 'PLANNED', version: 1 };
const record = { id: 'record-1', planId: 'plan-1', auditDate: '2026-09-01', auditor: '张三', summary: '现场审核', status: 'SUBMITTED', version: 3, conclusion: null };
function server(permissions: string[]) {
  request.mockImplementation(async (path, init) => {
    if (path === '/api/v1/system/my-permissions') return { permissions, organizationId: 'org-1' } as never;
    if (path.includes('/plans') && init?.method === 'POST') return plan as never;
    if (path.includes('/plans')) return { items: [plan], total: 1 } as never;
    if (path.endsWith('/checklist')) return { recordId: record.id, recordVersion: 3, items: [] } as never;
    if (path.endsWith('/close')) return { ...record, status: 'CLOSED' } as never;
    return { items: [record], total: 1 } as never;
  });
}
afterEach(() => vi.clearAllMocks());

it('shows the plan workflow and uses the audit conclusion contract', async () => {
  server(['supplier-audit:plans:read', 'supplier-audit:plans:write', 'supplier-audit:records:read', 'supplier-audit:records:write', 'supplier-audit:records:close']);
  render(<SupplierAuditPage />);
  expect(await screen.findByText('年度审核')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '新建审核计划' })).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: '检查项与动作' }));
  await userEvent.click(await screen.findByRole('combobox', { name: '关闭结论' }));
  expect(await screen.findByText('有条件通过')).toBeInTheDocument();
  expect(screen.queryByText('轻微不符合')).not.toBeInTheDocument();
});

it('hides mutation controls without write and close permissions', async () => {
  server(['supplier-audit:plans:read', 'supplier-audit:records:read']);
  render(<SupplierAuditPage />);
  expect(await screen.findByText('年度审核')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '新建审核计划' })).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: '检查项与动作' }));
  await waitFor(() => expect(screen.queryByRole('button', { name: '关闭审核' })).not.toBeInTheDocument());
});

it('submits a planned audit with its current version', async () => {
  server(['supplier-audit:plans:read', 'supplier-audit:plans:write', 'supplier-audit:records:read']);
  render(<SupplierAuditPage />);
  await screen.findByText('年度审核');
  await userEvent.click(await screen.findByRole('button', { name: '提交计划' }));
  await waitFor(() => expect(request).toHaveBeenCalledWith('/api/v1/supplier-audit/plans/plan-1/submit', expect.objectContaining({ method: 'PUT', body: JSON.stringify({ expectedVersion: 1 }) })));
}, 30000);

it('loads a submitted plan beyond the ledger page when creating a record', async () => {
  const olderPlan = { ...plan, id: 'plan-older', title: '上年度专项审核', status: 'SUBMITTED', auditYear: 2025 };
  request.mockImplementation(async (path, init) => {
    if (path === '/api/v1/system/my-permissions') return { permissions: ['supplier-audit:plans:read', 'supplier-audit:records:read', 'supplier-audit:records:write'], organizationId: 'org-1' } as never;
    if (path === '/api/v1/supplier-audit/records' && init?.method === 'POST') return record as never;
    if (path.includes('/plans?page=2')) return { items: [olderPlan], total: 21, page: 2, pageSize: 20 } as never;
    if (path.includes('/plans')) return { items: [plan], total: 21, page: 1, pageSize: 20 } as never;
    return { items: [], total: 0, page: 1, pageSize: 20 } as never;
  });
  render(<SupplierAuditPage />);
  await userEvent.click(await screen.findByRole('button', { name: '新建审核记录' }));
  await userEvent.click(screen.getByRole('combobox', { name: '已提交计划' }));
  await userEvent.click(await screen.findByRole('button', { name: '加载更多计划' }));
  await userEvent.click(await screen.findByText('上年度专项审核 · 2025'));
  fireEvent.change(screen.getByLabelText('审核日期'), { target: { value: '2026-09-27' } });
  fireEvent.change(screen.getByLabelText('审核员'), { target: { value: '张三' } });
  fireEvent.change(screen.getByLabelText('审核摘要'), { target: { value: '现场审核' } });
  await userEvent.click(screen.getByRole('button', { name: /保\s*存/ }));
  await waitFor(() => expect(request).toHaveBeenCalledWith('/api/v1/supplier-audit/records', expect.objectContaining({ method: 'POST', body: JSON.stringify({ planId: 'plan-older', auditDate: '2026-09-27', auditor: '张三', summary: '现场审核' }) })));
}, 20000);
