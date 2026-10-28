import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { Link, MemoryRouter } from 'react-router-dom';
import { UnsavedChangesProvider } from '../../layouts/UnsavedChanges';
import { ApiError, apiRequest, csrfToken, getSession } from '../../api/client';
import { ProcessDefectLedgerPage } from './ProcessDefectLedgerPage';

vi.mock('../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../api/client')>('../../api/client');
  return { ...actual, apiRequest: vi.fn(), csrfToken: vi.fn(), getSession: vi.fn() };
});

const defect = {
  id: '11111111-1111-4111-8111-111111111111', organizationId: '22222222-2222-4222-8222-222222222222',
  defectTypeCode: 'SCRATCH', description: '表面划伤', defectQuantity: 3, occurredAt: '2026-09-24T10:00:00.000Z',
  batchCode: 'B-001', workOrderCode: 'WO-001', operationCode: 'OP-01', lineCode: 'L-01',
  responsibilityCategory: 'PROCESS' as const, sourceKind: 'MANUAL' as const, version: 2,
};
const page = { items: [defect], total: 1, page: 1, pageSize: 20 };

beforeEach(() => {
  vi.mocked(apiRequest).mockReset();
  vi.mocked(csrfToken).mockReset();
  vi.mocked(csrfToken).mockResolvedValue('csrf-token');
  vi.mocked(getSession).mockResolvedValue({ userId: 'user', organizationId: defect.organizationId, accountType: 'INTERNAL', landingPath: '/app/workbench' });
  vi.mocked(apiRequest).mockImplementation(async (path) => path === '/api/v1/system/my-permissions' ? { permissions: ['process-quality:defects:read', 'process-quality:defects:write'] } : path.endsWith('/issues') ? [] : path.endsWith(defect.id) ? { ...defect, evidence: [] } : page);
});

it('loads the defect ledger and opens source detail with linked issues', async () => {
  render(<MemoryRouter><ProcessDefectLedgerPage /></MemoryRouter>);
  expect(await screen.findByText('表面划伤')).toBeVisible();
  fireEvent.click(screen.getByText('查看详情'));
  expect(await screen.findByText('来源详情')).toBeVisible();
  expect(apiRequest).toHaveBeenCalledWith(`/api/v1/process-quality/defects/${defect.id}`, { signal: expect.any(AbortSignal) });
  expect(apiRequest).toHaveBeenCalledWith(`/api/v1/process-quality/defects/${defect.id}/issues`, { signal: expect.any(AbortSignal) });
});

it('keeps shipment requests out of the defect ledger and retains authorized registration in the heading', async () => {
  render(<MemoryRouter><ProcessDefectLedgerPage /></MemoryRouter>);
  const register = await screen.findByRole('button', { name: '登记不良' });
  expect(register.closest('header')).toHaveClass('process-quality-heading');
  expect(screen.queryByRole('region', { name: '出货报告台账' })).not.toBeInTheDocument();
  expect(vi.mocked(apiRequest).mock.calls.some(([path]) => path.includes('/shipment-reports'))).toBe(false);
});

it('does not expose registration to a read-only user', async () => {
  vi.mocked(apiRequest).mockImplementation(async path => path === '/api/v1/system/my-permissions' ? { permissions: ['process-quality:defects:read'] } : page);
  render(<MemoryRouter><ProcessDefectLedgerPage /></MemoryRouter>);
  await screen.findByText('表面划伤');
  expect(screen.queryByRole('button', { name: '登记不良' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '发起问题' })).not.toBeInTheDocument();
});

it('protects an unfinished process issue when navigating away', async () => {
  render(<MemoryRouter><UnsavedChangesProvider><ProcessDefectLedgerPage /><Link to="/app/workbench">返回工作台</Link></UnsavedChangesProvider></MemoryRouter>);
  await screen.findByText('表面划伤');
  fireEvent.click(screen.getByLabelText('选择制程不良 表面划伤'));
  fireEvent.click(screen.getByText('发起问题'));
  fireEvent.change(screen.getByLabelText('实例标识'), { target: { value: '尚未发单' } });
  fireEvent.click(screen.getByText('返回工作台'));
  const title = await screen.findByText('当前草稿尚未保存，继续将放弃修改。', { selector: '.ant-modal-title' });
  await waitFor(() => expect(title).toBeVisible());
  fireEvent.click(within(title.closest('[role="dialog"]') as HTMLElement).getByText('继续编辑'));
  expect(screen.getByLabelText('实例标识')).toHaveValue('尚未发单');
});

it('keeps selected sources and form entries after a version conflict, then reuses the idempotency key', async () => {
  let issueAttempts = 0;
  vi.mocked(apiRequest).mockImplementation(async (path, init) => {
    if (path === '/api/v1/system/my-permissions') return { permissions: ['process-quality:defects:read', 'process-quality:defects:write'] };
    if (path === '/api/v1/process-quality/issues' && init?.method === 'POST') {
      issueAttempts += 1;
      if (issueAttempts === 1) throw new ApiError({ code: 'CONCURRENCY_CONFLICT', message: 'conflict' }, 409);
      return { problem: { id: '33333333-3333-4333-8333-333333333333', reportNumber: 'PQ-001', workflowInstanceId: '44444444-4444-4444-8444-444444444444', version: 1 }, replayed: false };
    }
    return page;
  });
  render(<MemoryRouter><ProcessDefectLedgerPage /></MemoryRouter>);
  await screen.findByText('表面划伤');
  fireEvent.click(screen.getByLabelText('选择制程不良 表面划伤'));
  fireEvent.click(screen.getByText('发起问题'));
  fireEvent.change(screen.getByLabelText('严重度'), { target: { value: 'HIGH' } });
  fireEvent.change(screen.getByLabelText('流程定义 ID'), { target: { value: '55555555-5555-4555-8555-555555555555' } });
  fireEvent.change(screen.getByLabelText('流程版本 ID'), { target: { value: '66666666-6666-4666-8666-666666666666' } });
  fireEvent.change(screen.getByLabelText('实例标识'), { target: { value: 'process-issue-1' } });
  fireEvent.click(screen.getByRole('button', { name: '确认发单' }));
  expect(await screen.findByText('记录已被其他用户更新，请刷新后重试')).toBeVisible();
  expect(screen.getByLabelText('流程定义 ID')).toHaveValue('55555555-5555-4555-8555-555555555555');
  expect(screen.getByText('已选择 1 条来源')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: '确认发单' }));
  await screen.findByText(/PQ-001/);
  const requests = vi.mocked(apiRequest).mock.calls.filter(([path, init]) => path === '/api/v1/process-quality/issues' && init?.method === 'POST');
  expect(requests).toHaveLength(2);
  expect(JSON.parse(String(requests[0]?.[1]?.body))).toEqual({ sources: [{ defectId: defect.id, expectedVersion: 2 }], problemType: 'PROCESS_DEFECT', responseForm: 'BRIEF', responsibleScope: 'process-quality', severity: 'HIGH', workflowBinding: { workflowDefinitionId: '55555555-5555-4555-8555-555555555555', workflowVersionId: '66666666-6666-4666-8666-666666666666', instanceKey: 'process-issue-1' } });
  expect(requests[1]?.[1]?.body).toBe(requests[0]?.[1]?.body);
  expect(new Headers(requests[0]?.[1]?.headers).get('Idempotency-Key')).toBeTruthy();
  expect(new Headers(requests[0]?.[1]?.headers).get('Idempotency-Key')).toBe(new Headers(requests[1]?.[1]?.headers).get('Idempotency-Key'));
}, 20000);

it('shows permission denial separately from an empty ledger', async () => {
  vi.mocked(apiRequest).mockRejectedValue(new ApiError({ code: 'FEATURE_PERMISSION_DENIED', message: 'private' }, 403));
  render(<MemoryRouter><ProcessDefectLedgerPage /></MemoryRouter>);
  expect(await screen.findByText('暂无制程不良访问权限')).toBeVisible();
  await waitFor(() => expect(screen.queryByText('暂无不良记录')).not.toBeInTheDocument());
});
