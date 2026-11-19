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
  fireEvent.click(screen.getByLabelText('查看详情', { selector: 'button' }));
  const title = await screen.findByText('不良品详情', { selector: '.ant-drawer-title' });
  expect(title.closest('[role="dialog"]')).toHaveAccessibleName('不良品详情');
  expect(title).toBeVisible();
  expect(apiRequest).toHaveBeenCalledWith(`/api/v1/process-quality/defects/${defect.id}`, { signal: expect.any(AbortSignal) });
  expect(apiRequest).toHaveBeenCalledWith(`/api/v1/process-quality/defects/${defect.id}/issues`, { signal: expect.any(AbortSignal) });
});

it('keeps shipment requests out of the defect ledger and retains authorized registration in the toolbar', async () => {
  vi.mocked(apiRequest).mockImplementation(async path => path === '/api/v1/system/my-permissions' ? { permissions: ['process-quality:defects:read', 'process-quality:defects:write'] } : { ...page, items: [], total: 0 });
  render(<MemoryRouter><ProcessDefectLedgerPage /></MemoryRouter>);
  const toolbar = within(screen.getByLabelText('台账工具栏'));
  expect(await toolbar.findByText('登记不良')).toBeVisible();
  expect(screen.queryByRole('region', { name: '出货报告台账' })).not.toBeInTheDocument();
  expect(vi.mocked(apiRequest).mock.calls.some(([path]) => path.includes('/shipment-reports'))).toBe(false);
});

it('does not expose registration to a read-only user', async () => {
  vi.mocked(apiRequest).mockImplementation(async path => path === '/api/v1/system/my-permissions' ? { permissions: ['process-quality:defects:read'] } : page);
  render(<MemoryRouter><ProcessDefectLedgerPage /></MemoryRouter>);
  await screen.findByText('表面划伤');
  const toolbar = within(screen.getByLabelText('台账工具栏'));
  expect(toolbar.queryByRole('button', { name: '登记不良' })).not.toBeInTheDocument();
  expect(toolbar.queryByRole('button', { name: '发起问题' })).not.toBeInTheDocument();
});

it('protects an unfinished formal 8D when navigating away', async () => {
  vi.mocked(apiRequest).mockImplementation(async path => path.includes('/my-permissions') ? { permissions: ['process-quality:defects:read', 'process-quality:issues:issue'] } : path.endsWith('/sources/preview') ? [{ defectId: defect.id, relatedProblems: [], hasHiddenRelations: false, relatedSetToken: 'token' }] : path.includes('/assignment-options') ? { departments: [], users: [], departmentTotal: 0, userTotal: 0 } : page);
  render(<MemoryRouter><UnsavedChangesProvider><ProcessDefectLedgerPage /><Link to="/app/workbench">返回工作台</Link></UnsavedChangesProvider></MemoryRouter>);
  await screen.findByText('表面划伤');
  fireEvent.click(screen.getByLabelText('选择制程不良 表面划伤'));
  fireEvent.click(within(screen.getByLabelText('台账工具栏')).getByRole('button', { name: '发起 8D' }));
  fireEvent.change(await screen.findByLabelText('分析/对策期限'), { target: { value: '2026-11-10' } });
  fireEvent.click(screen.getByText('返回工作台'));
  const title = await screen.findByText('当前草稿尚未保存，继续将放弃修改。', { selector: '.ant-modal-title' });
  await waitFor(() => expect(title).toBeVisible());
  fireEvent.click(within(title.closest('[role="dialog"]') as HTMLElement).getByText('继续编辑'));
  expect(screen.getByLabelText('分析/对策期限')).toHaveValue('2026-11-10');
});

it('shows permission denial separately from an empty ledger', async () => {
  vi.mocked(apiRequest).mockRejectedValue(new ApiError({ code: 'FEATURE_PERMISSION_DENIED', message: 'private' }, 403));
  render(<MemoryRouter><ProcessDefectLedgerPage /></MemoryRouter>);
  expect(await screen.findByText('暂无制程不良访问权限')).toBeVisible();
  expect(screen.queryByText('没有匹配的不良记录')).not.toBeInTheDocument();
});
