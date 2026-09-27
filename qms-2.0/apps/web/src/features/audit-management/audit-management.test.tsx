import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { ApiError, apiRequest, csrfToken } from '../../api/client';
import { AuditManagementPage } from './AuditManagementPage';

vi.mock('../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../api/client')>('../../api/client');
  return { ...actual, apiRequest: vi.fn(), csrfToken: vi.fn() };
});

const plan = {
  id: 'plan-1', organization_id: 'org-1', year: 2026, title: '年度体系审核', audit_type: 'SYSTEM' as const,
  planned_start: '2026-10-01T08:00:00.000Z', planned_end: '2026-10-02T17:00:00.000Z', status: 'PLANNED' as const, version: 1,
};

const importPage = {
  items: [{ id: 'import-1', organization_id: 'org-1', source_system: 'CUSTOMER' as const, external_key: 'cust-001', payload: { title: '客户审核问题' }, status: 'PENDING_REVIEW' as const, version: 3, review_note: null, problem_index_id: null, created_at: '2026-09-25T08:00:00.000Z' }],
  total: 1, page: 1, pageSize: 20,
};
const acceptedPage = { ...importPage, items: [{ ...importPage.items[0], status: 'ACCEPTED' as const, version: 4 }] };
const issuedPage = { ...importPage, items: [{ ...importPage.items[0], status: 'ISSUED' as const, version: 5, problem_index_id: '11111111-1111-4111-8111-111111111111' }] };
const workflowDefinitionId = '22222222-2222-4222-8222-222222222222';
const workflowVersionId = '33333333-3333-4333-8333-333333333333';
const issuePermissions = { organizationId: 'org-1', permissions: ['audit-management:write', 'workflow:start'] };

function mockWithIssuePermissions(...responses: unknown[]) {
  let index = 0;
  vi.mocked(apiRequest).mockImplementation((path) => {
    if (String(path).includes('/my-permissions')) return Promise.resolve(issuePermissions) as never;
    const response = responses[index++];
    return response instanceof Error ? Promise.reject(response) : Promise.resolve(response) as never;
  });
}

function fillIssueForm() {
  fireEvent.change(screen.getByLabelText('问题类型'), { target: { value: 'AUDIT_FINDING' } });
  fireEvent.change(screen.getByLabelText('责任范围'), { target: { value: 'audit-management' } });
  fireEvent.change(screen.getByLabelText('严重度'), { target: { value: 'HIGH' } });
  fireEvent.change(screen.getByLabelText('流程定义 ID'), { target: { value: workflowDefinitionId } });
  fireEvent.change(screen.getByLabelText('流程版本 ID'), { target: { value: workflowVersionId } });
  fireEvent.change(screen.getByLabelText('实例标识'), { target: { value: 'audit-import-cust-001' } });
}

beforeEach(() => { vi.mocked(apiRequest).mockReset(); vi.mocked(csrfToken).mockReset().mockResolvedValue('csrf-token'); });

it('loads a plan after the user enters its identifier', async () => {
  vi.mocked(apiRequest).mockResolvedValue(plan);
  render(<AuditManagementPage />);
  fireEvent.change(screen.getByLabelText('审核计划 ID'), { target: { value: plan.id } });
  fireEvent.click(screen.getByRole('button', { name: '查看计划' }));
  expect(await screen.findByText('年度体系审核')).toBeVisible();
  expect(apiRequest).toHaveBeenCalledWith(`/api/v1/audit-management/plans/${plan.id}`);
  expect(screen.getByText('已计划')).toBeVisible();
});

it('shows an explicit empty state after a successful lookup with no plan', async () => {
  vi.mocked(apiRequest).mockResolvedValue(undefined as never);
  render(<AuditManagementPage planId="missing-plan" />);
  expect(await screen.findByText('未找到审核计划')).toBeVisible();
});

it('offers a retry action for transient failures', async () => {
  vi.mocked(apiRequest).mockImplementation((path) => {
    if (String(path).includes('/imports')) return Promise.resolve(importPage) as never;
    return Promise.reject(new Error('offline'));
  });
  render(<AuditManagementPage planId={plan.id} />);
  expect(await screen.findByText('审计计划加载失败，请重试。')).toBeVisible();
  vi.mocked(apiRequest).mockImplementation((path) => String(path).includes('/imports') ? Promise.resolve(importPage) as never : Promise.resolve(plan) as never);
  fireEvent.click(screen.getAllByRole('button', { name: /重\s*试/ })[0]!);
  await waitFor(() => expect(screen.getByText('年度体系审核')).toBeVisible());
});

it('lists imported rows with source and review status', async () => {
  vi.mocked(apiRequest).mockResolvedValue(importPage);
  render(<AuditManagementPage />);
  expect(await screen.findByText('cust-001')).toBeVisible();
  expect(screen.getByText('客户')).toBeVisible();
  expect(screen.getByText('待复核')).toBeVisible();
  expect(screen.getByText(/版本 v3/)).toBeVisible();
});

it('loads organization permissions and keeps Excel import available when the ledger is empty', async () => {
  const emptyPage = { items: [], total: 0, page: 1, pageSize: 20 };
  vi.mocked(apiRequest).mockImplementation((path) => String(path).includes('/my-permissions')
    ? Promise.resolve({ organizationId: 'org-1', permissions: ['audit-management:write'] }) as never
    : Promise.resolve(emptyPage) as never);
  render(<AuditManagementPage />);
  expect(await screen.findByText('Excel 逐行导入')).toBeVisible();
  expect(apiRequest).toHaveBeenCalledWith('/api/v1/system/my-permissions', expect.objectContaining({ signal: expect.any(AbortSignal) }));
});

it('submits a version-checked review decision', async () => {
  let index = 0;
  vi.mocked(apiRequest).mockImplementation((path) => String(path).includes('/my-permissions') ? Promise.resolve(issuePermissions) as never : Promise.resolve([importPage, { ...importPage.items[0], status: 'ACCEPTED', version: 4 }, importPage][index++]) as never);
  render(<AuditManagementPage />);
  await screen.findByText('cust-001');
  fireEvent.click(await screen.findByRole('button', { name: /接\s*受/ }));
  await waitFor(() => expect(apiRequest).toHaveBeenCalledWith('/api/v1/audit-management/imports/import-1/review', expect.objectContaining({ method: 'PUT', headers: { 'x-csrf-token': 'csrf-token', 'Idempotency-Key': expect.any(String) }, body: JSON.stringify({ expectedVersion: 3, decision: 'ACCEPTED' }) })));
});

it('shows permission failures separately from import failures', async () => {
  const error = new ApiError({ code: 'FEATURE_PERMISSION_DENIED', message: 'denied' }, 403);
  vi.mocked(apiRequest).mockRejectedValue(error);
  render(<AuditManagementPage />);
  expect(await screen.findByText('暂无导入行访问或复核权限')).toBeVisible();
  expect(screen.queryByRole('button', { name: '重试' })).toBeNull();
});

it('issues an accepted row with CSRF, a stable idempotency key and a problem link', async () => {
  const problem = { id: issuedPage.items[0].problem_index_id, reportNumber: 'QMS-2026-001', workflowInstanceId: '44444444-4444-4444-8444-444444444444', version: 1 };
  const source = { organizationId: 'org-1', createdBy: 'user-1', sourceVersion: 4, sourceSnapshot: {} };
  mockWithIssuePermissions(acceptedPage, { problem, source, sources: [source], replayed: false }, issuedPage);
  render(<MemoryRouter><AuditManagementPage /></MemoryRouter>);
  await screen.findByText('cust-001');
  fireEvent.click(await screen.findByRole('button', { name: '发起正式问题' }));
  fireEvent.click(screen.getByRole('button', { name: '确认发单' }));
  expect(await screen.findByText('请输入流程定义 ID')).toBeVisible();
  expect(vi.mocked(apiRequest).mock.calls.filter(([path]) => String(path).endsWith('/issue'))).toHaveLength(0);
  fillIssueForm();
  fireEvent.click(screen.getByRole('button', { name: '确认发单' }));
  await waitFor(() => expect(apiRequest).toHaveBeenCalledWith('/api/v1/audit-management/imports/import-1/issue', expect.objectContaining({
    method: 'POST', headers: { 'x-csrf-token': 'csrf-token', 'Idempotency-Key': expect.any(String) },
    body: JSON.stringify({ expectedVersion: 4, problemType: 'AUDIT_FINDING', responseForm: 'BRIEF', responsibleScope: 'audit-management', severity: 'HIGH', workflowBinding: { workflowDefinitionId, workflowVersionId, instanceKey: 'audit-import-cust-001' } }),
  })));
  expect(await screen.findByRole('link', { name: '查看问题 QMS-2026-001' })).toHaveAttribute('href', `/app/problem-workspace/${problem.id}?organizationId=org-1`);
  await waitFor(() => expect(vi.mocked(apiRequest).mock.calls.filter(([path]) => String(path).startsWith('/api/v1/audit-management/imports?'))).toHaveLength(2));
  expect(await screen.findByText('已发单')).toBeVisible();
});

it('keeps issue inputs but requires a fresh row after a 409 conflict', async () => {
  const conflict = new ApiError({ code: 'CONCURRENCY_CONFLICT', message: 'conflict' }, 409);
  mockWithIssuePermissions(acceptedPage, conflict);
  render(<AuditManagementPage />);
  await screen.findByText('cust-001');
  fireEvent.click(await screen.findByRole('button', { name: '发起正式问题' }));
  fillIssueForm();
  fireEvent.click(screen.getByRole('button', { name: '确认发单' }));
  expect(await screen.findByText(/来源版本已变化/)).toBeVisible();
  expect(screen.getByLabelText('严重度')).toHaveValue('HIGH');
  expect(screen.getByRole('button', { name: '确认发单' })).toBeDisabled();
  const firstCall = vi.mocked(apiRequest).mock.calls.filter(([path]) => String(path).endsWith('/issue'))[0];
  fireEvent.click(screen.getByRole('button', { name: '确认发单' }));
  expect(vi.mocked(apiRequest).mock.calls.filter(([path]) => String(path).endsWith('/issue'))).toHaveLength(1);
  expect(firstCall?.[1]?.headers).toEqual({ 'x-csrf-token': 'csrf-token', 'Idempotency-Key': expect.any(String) });
  fireEvent.click(screen.getByRole('button', { name: '关闭并刷新导入行' }));
  expect(screen.queryByRole('button', { name: '确认发单' })).toBeNull();
});

it('does not reopen a stale accepted row when an older list response arrives after issue 409', async () => {
  const conflict = new ApiError({ code: 'CONCURRENCY_CONFLICT', message: 'conflict' }, 409);
  let resolveRefresh!: (page: typeof acceptedPage) => void;
  const pendingRefresh = new Promise<typeof acceptedPage>((resolve) => { resolveRefresh = resolve; });
  let rejectIssue!: (cause: unknown) => void;
  const pendingIssue = new Promise((_, reject) => { rejectIssue = reject; });
  let listCalls = 0;
  vi.mocked(apiRequest).mockImplementation((path, init) => {
    if (String(path).includes('/my-permissions')) return Promise.resolve(issuePermissions) as never;
    if (init?.method === 'POST') return pendingIssue as never;
    return ++listCalls === 1 ? Promise.resolve(acceptedPage) as never : pendingRefresh as never;
  });
  render(<AuditManagementPage />);
  await screen.findByText('cust-001');
  fireEvent.click(await screen.findByRole('button', { name: '发起正式问题' }));
  fillIssueForm();
  fireEvent.click(screen.getByRole('button', { name: '确认发单' }));
  await waitFor(() => expect(vi.mocked(apiRequest).mock.calls.some(([path]) => String(path).endsWith('/issue'))).toBe(true));
  fireEvent.click(screen.getByRole('button', { name: '刷新导入' }));
  await waitFor(() => expect(vi.mocked(apiRequest).mock.calls.filter(([path]) => String(path).includes('/imports?'))).toHaveLength(2));
  await act(async () => { rejectIssue(conflict); });
  expect(await screen.findByText(/来源版本已变化/)).toBeVisible();
  await act(async () => { resolveRefresh(acceptedPage); });
  expect(screen.queryByText('cust-001')).toBeNull();
  expect(screen.queryByRole('button', { name: '发起正式问题' })).toBeNull();
  expect(screen.getByRole('button', { name: '确认发单' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: '确认发单' }));
  expect(vi.mocked(apiRequest).mock.calls.filter(([path]) => String(path).endsWith('/issue'))).toHaveLength(1);
});

it('removes imported row details after issue permission is revoked', async () => {
  const denied = new ApiError({ code: 'FEATURE_PERMISSION_DENIED', message: 'denied' }, 403);
  mockWithIssuePermissions(acceptedPage, denied);
  render(<AuditManagementPage />);
  await screen.findByText('cust-001');
  fireEvent.click(await screen.findByRole('button', { name: '发起正式问题' }));
  fillIssueForm();
  fireEvent.click(screen.getByRole('button', { name: '确认发单' }));
  expect(await screen.findByText('暂无发单权限')).toBeVisible();
  expect(screen.queryByText('cust-001')).toBeNull();
  expect(screen.queryByRole('button', { name: '确认发单' })).toBeNull();
});

it('does not offer issue action for pending, rejected or already issued rows', async () => {
  const mixed = { ...importPage, items: [importPage.items[0], { ...importPage.items[0], id: 'import-2', external_key: 'cust-002', status: 'REJECTED' }, { ...issuedPage.items[0], id: 'import-3', external_key: 'cust-003' }] };
  vi.mocked(apiRequest).mockImplementation((path) => String(path).includes('/my-permissions') ? Promise.resolve(issuePermissions) as never : Promise.resolve(mixed) as never);
  render(<MemoryRouter><AuditManagementPage /></MemoryRouter>);
  await screen.findByText('cust-003');
  await screen.findByRole('button', { name: /接\s*受/ });
  expect(screen.queryByRole('button', { name: '发起正式问题' })).toBeNull();
});

it('hides review actions for a read-only user', async () => {
  const readOnly = { organizationId: 'org-1', permissions: ['audit-management:read'] };
  vi.mocked(apiRequest).mockImplementation((path) => String(path).includes('/my-permissions') ? Promise.resolve(readOnly) as never : Promise.resolve(importPage) as never);
  render(<AuditManagementPage />);
  await screen.findByText('cust-001');
  await waitFor(() => expect(apiRequest).toHaveBeenCalledWith('/api/v1/system/my-permissions', expect.any(Object)));
  expect(screen.queryByRole('button', { name: /接\s*受/ })).toBeNull();
  expect(screen.queryByRole('button', { name: /拒\s*绝/ })).toBeNull();
});

it('clears an open issue form when an import refresh loses read permission', async () => {
  const denied = new ApiError({ code: 'ORGANIZATION_SCOPE_DENIED', message: 'denied' }, 403);
  mockWithIssuePermissions(acceptedPage, denied, acceptedPage);
  render(<AuditManagementPage />);
  await screen.findByText('cust-001');
  fireEvent.click(await screen.findByRole('button', { name: '发起正式问题' }));
  fillIssueForm();
  fireEvent.click(screen.getByRole('button', { name: '刷新导入' }));
  expect(await screen.findByText('暂无导入行访问或复核权限')).toBeVisible();
  expect(screen.queryByText('cust-001')).toBeNull();
  expect(screen.queryByRole('button', { name: '确认发单' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '刷新导入' }));
  await screen.findByText('cust-001');
  fireEvent.click(await screen.findByRole('button', { name: '发起正式问题' }));
  expect(screen.getByLabelText('严重度')).toHaveValue('');
});

it('removes a prior issue success link when import read permission is revoked', async () => {
  const denied = new ApiError({ code: 'FEATURE_PERMISSION_DENIED', message: 'denied' }, 403);
  const source = { organizationId: 'org-1', createdBy: 'user-1', sourceVersion: 4, sourceSnapshot: {} };
  mockWithIssuePermissions(acceptedPage, { problem: { id: '11111111-1111-4111-8111-111111111111', reportNumber: 'QMS-2026-001', workflowInstanceId: '44444444-4444-4444-8444-444444444444', version: 1 }, source, sources: [source], replayed: false }, denied);
  render(<MemoryRouter><AuditManagementPage /></MemoryRouter>);
  await screen.findByText('cust-001');
  fireEvent.click(await screen.findByRole('button', { name: '发起正式问题' }));
  fillIssueForm();
  fireEvent.click(screen.getByRole('button', { name: '确认发单' }));
  expect(await screen.findByText('暂无导入行访问或复核权限')).toBeVisible();
  expect(screen.queryByRole('link', { name: '查看问题 QMS-2026-001' })).toBeNull();
  expect(screen.queryByText('cust-001')).toBeNull();
});

it('ignores an older import refresh that resolves after issue permission is revoked', async () => {
  const denied = new ApiError({ code: 'FEATURE_PERMISSION_DENIED', message: 'denied' }, 403);
  let resolveRefresh!: (page: typeof acceptedPage) => void;
  const pendingRefresh = new Promise<typeof acceptedPage>((resolve) => { resolveRefresh = resolve; });
  let rejectIssue!: (cause: unknown) => void;
  const pendingIssue = new Promise((_, reject) => { rejectIssue = reject; });
  let listCalls = 0;
  vi.mocked(apiRequest).mockImplementation((path, init) => {
    if (String(path).includes('/my-permissions')) return Promise.resolve(issuePermissions) as never;
    if (init?.method === 'POST') return pendingIssue as never;
    return ++listCalls === 1 ? Promise.resolve(acceptedPage) as never : pendingRefresh as never;
  });
  render(<AuditManagementPage />);
  await screen.findByText('cust-001');
  fireEvent.click(await screen.findByRole('button', { name: '发起正式问题' }));
  fillIssueForm();
  fireEvent.click(screen.getByRole('button', { name: '确认发单' }));
  await waitFor(() => expect(vi.mocked(apiRequest).mock.calls.some(([path]) => String(path).endsWith('/issue'))).toBe(true));
  fireEvent.click(screen.getByRole('button', { name: '刷新导入' }));
  rejectIssue(denied);
  expect(await screen.findByText('暂无发单权限')).toBeVisible();
  resolveRefresh(acceptedPage);
  await waitFor(() => expect(screen.queryByText('cust-001')).toBeNull());
  expect(screen.queryByRole('button', { name: '确认发单' })).toBeNull();
});

it('hides issue action until both current-organization permissions are known', async () => {
  let resolvePermissions!: (value: typeof issuePermissions) => void;
  const pendingPermissions = new Promise<typeof issuePermissions>((resolve) => { resolvePermissions = resolve; });
  vi.mocked(apiRequest).mockImplementation((path) => String(path).includes('/my-permissions') ? pendingPermissions as never : Promise.resolve(acceptedPage) as never);
  render(<AuditManagementPage />);
  await screen.findByText('cust-001');
  expect(screen.queryByRole('button', { name: '发起正式问题' })).toBeNull();
  resolvePermissions(issuePermissions);
  expect(await screen.findByRole('button', { name: '发起正式问题' })).toBeVisible();
});

it.each([
  { organizationId: 'org-1', permissions: ['audit-management:write'] },
  { organizationId: 'org-1', permissions: ['workflow:start'] },
  { organizationId: 'org-other', permissions: ['audit-management:write', 'workflow:start'] },
])('hides issue action without both permissions in the row organization: %j', async (permissions) => {
  vi.mocked(apiRequest).mockImplementation((path) => String(path).includes('/my-permissions') ? Promise.resolve(permissions) as never : Promise.resolve(acceptedPage) as never);
  render(<AuditManagementPage />);
  await screen.findByText('cust-001');
  await waitFor(() => expect(apiRequest).toHaveBeenCalledWith('/api/v1/system/my-permissions', expect.any(Object)));
  expect(screen.queryByRole('button', { name: '发起正式问题' })).toBeNull();
});
