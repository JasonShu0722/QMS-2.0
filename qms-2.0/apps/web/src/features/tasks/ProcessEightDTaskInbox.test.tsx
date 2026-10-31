import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { transferableAbortController } from 'node:util';
import { createMemoryRouter, MemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { components } from '@qms/contracts';
import { ApiError, apiRequest, csrfToken } from '../../api/client';
import { LanguageProvider } from '../../i18n/Language';
import { useWorkTabsStore } from '../../work-tabs/workTabsStore';
import { UnsavedChangesProvider, useUnsavedChanges } from '../../layouts/UnsavedChanges';
import { MyTasksPage } from './MyTasksPage';
import { ProcessEightDTaskInbox } from './ProcessEightDTaskInbox';

vi.mock('../../api/client', async original => ({ ...await original<typeof import('../../api/client')>(), apiRequest: vi.fn(), csrfToken: vi.fn() }));
const task: components['schemas']['ProcessEightDTaskDto'] = {
  id: 'extension-task', problemId: 'problem', reportNumber: '8D-123', workflowVersionId: 'flow', kind: 'EXTENSION', stage: 'ANALYSIS', status: 'LEADER_PENDING', userId: 'leader',
  rowVersion: 3, contentVersion: 2, instanceVersion: 4, dueAt: '2026-10-25T00:00:00Z', overdue: true, extensionRequestId: 'request', extensionRequestVersion: 7,
  requestedDueAt: '2026-11-01T00:00:00Z', extensionStages: [], actions: ['OPEN_REPORT', 'DECIDE_EXTENSION'],
};
const extension: components['schemas']['WorkflowDeadlineExtensionDto'] = {
  id: 'request', problemId: 'problem', workflowVersionId: 'flow', stage: 'ANALYSIS', originalDueAt: task.dueAt!, requestedDueAt: task.requestedDueAt!, originallyOverdue: true,
  reason: '等待真实验证', applicantUserId: 'owner', leaderUserId: 'leader', professionalUserId: 'quality', leaderSkipped: false, status: 'LEADER_PENDING', version: 7, history: [], createdAt: task.dueAt!, updatedAt: task.dueAt!,
};
beforeEach(() => {
  vi.resetAllMocks(); localStorage.clear(); useWorkTabsStore.getState().reset(); useWorkTabsStore.getState().bindSession('INTERNAL:user:org');
  vi.mocked(csrfToken).mockResolvedValue('csrf');
  vi.mocked(apiRequest).mockImplementation(async path => {
    if (path.includes('/eight-d/tasks')) return { items: [task], total: 1 };
    if (path.includes('/eight-d/notifications')) return { items: [{ id: 'notice', problemId: 'problem', kind: 'EXTENSION_PENDING', subject: '真实延期通知', body: '原期限继续生效', deliveredAt: task.dueAt }], total: 1 };
    if (path.endsWith('/problems/problem/requests')) return [extension];
    return { items: [], total: 0 };
  });
});
afterEach(() => vi.unstubAllGlobals());
it.each([['客户8D', 'customer-quality'], ['新品8D', 'new-product-quality']])('connects %s to its own task endpoints and workspace links', async (label, domain) => {
  render(<MemoryRouter><LanguageProvider><UnsavedChangesProvider><MyTasksPage /></UnsavedChangesProvider></LanguageProvider></MemoryRouter>);
  fireEvent.click(screen.getByRole('tab', { name: label }));
  expect(await screen.findByText('8D-123')).toBeVisible();
  expect(apiRequest).toHaveBeenCalledWith(`/api/v1/${domain}/eight-d/tasks?pageSize=20&offset=0`, expect.anything());
  expect(apiRequest).toHaveBeenCalledWith(`/api/v1/${domain}/eight-d/notifications?pageSize=20&offset=0`, expect.anything());
  expect(screen.getByRole('link', { name: '打开8D报告' })).toHaveAttribute('href', '/app/problem-workspace/problem?view=report');
});
async function mount(page = false) {
  const view = render(<MemoryRouter><LanguageProvider><UnsavedChangesProvider>{page ? <MyTasksPage /> : <ProcessEightDTaskInbox />}</UnsavedChangesProvider></LanguageProvider></MemoryRouter>);
  if (page) fireEvent.click(screen.getByRole('tab', { name: '过程8D' }));
  await screen.findByText('8D-123'); return view;
}
it('loads independent real projections and never exposes generic claim or arbitrary completion', async () => {
  await mount(true);
  expect(await screen.findByText('真实延期通知')).toBeVisible();
  expect(screen.getByRole('link', { name: '打开8D报告' })).toHaveAttribute('href', '/app/problem-workspace/problem?view=report');
  expect(screen.queryByRole('button', { name: '领取' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '完成任务' })).not.toBeInTheDocument();
  expect(apiRequest).toHaveBeenCalledWith('/api/v1/process-quality/eight-d/tasks?pageSize=20&offset=0', expect.anything());
});

it('shows request-only extension eligibility without inventing handling or decision actions', async () => {
  const read = vi.mocked(apiRequest).getMockImplementation()!;
  vi.mocked(apiRequest).mockImplementation(async (path, init) => path.includes('/eight-d/tasks') ? {
    items: [{ ...task, kind: 'EXTENSION_REQUEST', status: 'AVAILABLE', stage: 'CLOSURE', extensionRequestId: null,
      extensionRequestVersion: null, actions: ['OPEN_REPORT', 'REQUEST_EXTENSION'], extensionStages: ['CLOSURE'] }], total: 1,
  } : read(path, init));
  await mount();
  expect(screen.getByText('可申请延期 · 关闭计划')).toBeVisible();
  expect(screen.getByRole('link', { name: '申请延期' })).toHaveAttribute('href', '/app/problem-workspace/problem');
  expect(screen.queryByRole('link', { name: '完整提交8D' })).not.toBeInTheDocument();
  expect(screen.queryByRole('link', { name: '确认分析完成' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '审核延期' })).not.toBeInTheDocument();
});

it('shows the new available extension status in English without leaking its Chinese label', async () => {
  localStorage.setItem('qms:locale:v1', 'en-US');
  const read = vi.mocked(apiRequest).getMockImplementation()!;
  vi.mocked(apiRequest).mockImplementation(async (path, init) => path.includes('/eight-d/tasks') ? {
    items: [{ ...task, kind: 'EXTENSION_REQUEST', status: 'AVAILABLE', stage: 'CLOSURE', actions: ['OPEN_REPORT', 'REQUEST_EXTENSION'], extensionStages: ['CLOSURE'] }], total: 1,
  } : read(path, init));
  await mount();
  expect(screen.getByText(/Extension available/)).toBeVisible();
  expect(screen.queryByText(/可申请延期/)).not.toBeInTheDocument();
});
it('checks the persisted extension and posts only the versioned decision with csrf and idempotency', async () => {
  await mount(); fireEvent.click(screen.getByRole('button', { name: '审核延期' }));
  await waitFor(() => expect(screen.getByText('等待真实验证')).toBeVisible());
  fireEvent.change(screen.getByLabelText('延期审核意见'), { target: { value: '同意验证计划' } });
  fireEvent.click(screen.getByRole('button', { name: '提交延期审核' }));
  await waitFor(() => expect(apiRequest).toHaveBeenCalledWith('/api/v1/workflow-deadline-extensions/requests/request/decide', expect.objectContaining({ method: 'POST', body: JSON.stringify({ expectedVersion: 7, decision: 'APPROVE', comment: '同意验证计划' }), headers: expect.objectContaining({ 'x-csrf-token': 'csrf', 'Idempotency-Key': expect.any(String) }) }), { replayAfterReauthentication: false }));
});
it('keeps the comment on conflict and requires a fresh task and request baseline', async () => {
  const read = vi.mocked(apiRequest).getMockImplementation()!;
  vi.mocked(apiRequest).mockImplementation(async (path, init) => {
    if (init?.method === 'POST') throw new ApiError({ code: 'CONCURRENCY_CONFLICT', message: 'unsafe' }, 409);
    return read(path, init);
  });
  await mount(); fireEvent.click(screen.getByRole('button', { name: '审核延期' })); await screen.findByText('等待真实验证');
  fireEvent.change(screen.getByLabelText('延期审核意见'), { target: { value: '保留意见' } }); fireEvent.click(screen.getByRole('button', { name: '提交延期审核' }));
  await waitFor(() => expect(screen.getByText('延期基线已变化，请重新核对；意见已保留。')).toBeVisible());
  expect(screen.getByLabelText('延期审核意见')).toHaveValue('保留意见');
  expect(screen.getByRole('button', { name: '提交延期审核' })).toBeDisabled();
});
it.each([403])('clears all scoped data on %s and ignores another projection arriving late', async status => {
  let finish!: (value: unknown) => void;
  vi.mocked(apiRequest).mockImplementation(async path => {
    if (path.includes('/eight-d/notifications')) return new Promise(resolve => { finish = resolve; });
    if (path.includes('/eight-d/tasks')) throw new ApiError({ code: status === 401 ? 'AUTH_SESSION_REQUIRED' : 'FEATURE_PERMISSION_DENIED', message: 'unsafe' }, status);
    return { items: [], total: 0 };
  });
  render(<MemoryRouter><LanguageProvider><ProcessEightDTaskInbox /></LanguageProvider></MemoryRouter>);
  expect(await screen.findByText(status === 401 ? '请先登录' : '无权执行此操作')).toBeVisible();
  await act(async () => finish({ items: [{ id: 'late', subject: '不可泄露', body: 'secret' }], total: 1 }));
  expect(screen.queryByText('不可泄露')).not.toBeInTheDocument();
});
it('completes extension decision 401 navigation past its busy guard and a parent dirty draft', async () => {
  vi.stubGlobal('AbortController', function () { return transferableAbortController(); });
  const read = vi.mocked(apiRequest).getMockImplementation()!;
  vi.mocked(apiRequest).mockImplementation(async (path, init) => {
    if (init?.method === 'POST') throw new ApiError({ code: 'AUTH_SESSION_REQUIRED', message: 'unsafe' }, 401);
    return read(path, init);
  });
  function Page() { useUnsavedChanges(true); return <ProcessEightDTaskInbox />; }
  const router = createMemoryRouter([
    { path: '/app/my-tasks', element: <LanguageProvider><UnsavedChangesProvider><Page /></UnsavedChangesProvider></LanguageProvider> },
    { path: '/login', element: <p>延期审核登录目的页</p> },
  ], { initialEntries: ['/app/my-tasks'] });
  render(<RouterProvider router={router} />);
  await screen.findByText('8D-123');
  fireEvent.click(await screen.findByRole('button', { name: '审核延期' }));
  await screen.findByText('等待真实验证');
  fireEvent.change(screen.getByLabelText('延期审核意见'), { target: { value: '不可带入其他会话' } });
  fireEvent.click(screen.getByRole('button', { name: '提交延期审核' }));
  await waitFor(() => expect(router.state.location.pathname).toBe('/login'));
  expect(await screen.findByText('延期审核登录目的页')).toBeVisible();
  expect(useWorkTabsStore.getState().sessionScope).toBeUndefined();
  expect(screen.queryByDisplayValue('不可带入其他会话')).not.toBeInTheDocument();
  expect(screen.queryByText('8D-123')).not.toBeInTheDocument();
});
it('ignores old-session responses after organization change', async () => {
  let finish!: (value: unknown) => void;
  vi.mocked(apiRequest).mockImplementation(async path => path.includes('/eight-d/tasks') ? new Promise(resolve => { finish = resolve; }) : { items: [], total: 0 });
  render(<MemoryRouter><LanguageProvider><ProcessEightDTaskInbox /></LanguageProvider></MemoryRouter>);
  const old = finish;
  act(() => useWorkTabsStore.getState().bindSession('INTERNAL:user:other-org'));
  await act(async () => old({ items: [task], total: 1 }));
  expect(screen.queryByText('8D-123')).not.toBeInTheDocument();
});
it('projects handling actions only as domain workspace links, never generic completion', async () => {
  const read = vi.mocked(apiRequest).getMockImplementation()!;
  vi.mocked(apiRequest).mockImplementation(async (path, init) => path.includes('/eight-d/tasks') ? { items: [{ ...task, kind: 'HANDLING', status: 'HANDLING', extensionRequestId: null, extensionRequestVersion: null, actions: ['ANALYSIS_COMPLETE', 'REQUEST_EXTENSION'], extensionStages: ['ANALYSIS'] }], total: 1 } : read(path, init));
  await mount();
  expect(screen.getByRole('link', { name: '确认分析完成' })).toHaveAttribute('href', '/app/problem-workspace/problem');
  expect(screen.getByRole('link', { name: '申请延期' })).toBeVisible();
  expect(screen.queryByRole('link', { name: '完整提交8D' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '审核延期' })).not.toBeInTheDocument();
});
it.each(['network', 'HTTP_408', 'HTTP_425'])('freezes an unknown write result and retries the same request key and body after %s', async failure => {
  const read = vi.mocked(apiRequest).getMockImplementation()!;
  let writes = 0;
  vi.mocked(apiRequest).mockImplementation(async (path, init) => {
    if (init?.method === 'POST') {
      writes++;
      if (writes === 1) throw failure === 'network' ? new TypeError('network') : new ApiError({ code: failure, message: 'unsafe' }, Number(failure.slice(5)));
      return extension;
    }
    return read(path, init);
  });
  await mount(); fireEvent.click(screen.getByRole('button', { name: '审核延期' })); await screen.findByText('等待真实验证');
  fireEvent.change(screen.getByLabelText('延期审核意见'), { target: { value: '原意见' } }); fireEvent.click(screen.getByRole('button', { name: '提交延期审核' }));
  await screen.findByText('延期审核结果未确认，输入已冻结，只能重试原请求。');
  expect(screen.getByLabelText('延期审核意见')).toBeDisabled();
  expect(screen.getByRole('button', { name: '关闭延期审核' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: '重试原延期请求' }));
  await waitFor(() => expect(writes).toBe(2));
  const calls = vi.mocked(apiRequest).mock.calls.filter(([, init]) => init?.method === 'POST');
  expect(calls[0]![1]!.body).toBe(calls[1]![1]!.body);
  expect(calls[0]![1]!.headers).toEqual(calls[1]![1]!.headers);
});
it('blocks an extension decision whose persisted request does not match the projected duty', async () => {
  const read = vi.mocked(apiRequest).getMockImplementation()!;
  vi.mocked(apiRequest).mockImplementation(async (path, init) => path.endsWith('/problems/problem/requests') ? [{ ...extension, version: 8 }] : read(path, init));
  await mount(); fireEvent.click(screen.getByRole('button', { name: '审核延期' }));
  await screen.findByText('延期基线已变化，请重新核对；意见已保留。');
  expect(screen.getByRole('button', { name: '提交延期审核' })).toBeDisabled();
  expect(vi.mocked(apiRequest).mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
});
it('aborts a decision awaiting CSRF when the organization changes', async () => {
  let finish!: (value: string) => void;
  vi.mocked(csrfToken).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  await mount(); fireEvent.click(screen.getByRole('button', { name: '审核延期' })); await screen.findByText('等待真实验证');
  fireEvent.click(screen.getByRole('button', { name: '提交延期审核' }));
  act(() => useWorkTabsStore.getState().bindSession('INTERNAL:user:new-org'));
  await act(async () => finish('csrf'));
  expect(vi.mocked(apiRequest).mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
});
it('guards a dirty extension review when changing task tabs', async () => {
  await mount(true); fireEvent.click(screen.getByRole('button', { name: '审核延期' })); await screen.findByText('等待真实验证');
  fireEvent.change(screen.getByLabelText('延期审核意见'), { target: { value: '不可丢失的意见' } });
  fireEvent.click(screen.getByText('关闭审核', { selector: '[role=tab]' }));
  expect(await screen.findByText('当前草稿尚未保存，继续将放弃修改。')).toBeInTheDocument();
  fireEvent.click(screen.getByText('继续编辑', { selector: 'button span' }));
  expect(screen.getByLabelText('延期审核意见')).toHaveValue('不可丢失的意见');
});
it('guards a dirty review on modal close without discarding the comment', async () => {
  await mount(); fireEvent.click(screen.getByText('审核延期', { selector: 'button span' })); await screen.findByText('等待真实验证');
  fireEvent.change(screen.getByLabelText('延期审核意见'), { target: { value: '不可丢失的意见' } });
  fireEvent.click(screen.getByText('关闭延期审核', { selector: 'button span' }));
  expect(await screen.findByText('放弃修改并关闭', { selector: 'button span' })).toBeInTheDocument();
  fireEvent.click(screen.getByText('继续编辑', { selector: 'button span' }));
  expect(screen.getByLabelText('延期审核意见')).toHaveValue('不可丢失的意见');
});

it.each([{ stage: 'CSRF', status: 429 }, { stage: 'POST', status: 400 }, { stage: 'POST', status: 422 }, { stage: 'POST', status: 429 }])('retains an unknown extension decision after retry $stage $status until the original request succeeds', async ({ stage, status }) => {
  const read = vi.mocked(apiRequest).getMockImplementation()!;
  let failure: 'network' | number | undefined = 'network';
  vi.mocked(apiRequest).mockImplementation(async (path, init) => {
    if (init?.method === 'POST') {
      if (failure === 'network') throw new TypeError('network');
      if (typeof failure === 'number') throw new ApiError({ code: `HTTP_${failure}`, message: 'refused' }, failure);
      return extension;
    }
    return read(path, init);
  });
  await mount();
  const inbox = within(screen.getByRole('region', { name: '过程8D正式待办' }));
  fireEvent.click(inbox.getByRole('button', { name: '审核延期' }));
  const dialog = within(await screen.findByRole('dialog'));
  await dialog.findByText('等待真实验证');
  fireEvent.change(dialog.getByLabelText('延期审核意见'), { target: { value: '原审核意见' } });
  fireEvent.click(dialog.getByRole('button', { name: '提交延期审核' }));
  await dialog.findByText('延期审核结果未确认，输入已冻结，只能重试原请求。');
  expect(dialog.getByLabelText('延期审核意见')).toBeDisabled();
  failure = status;
  if (stage === 'CSRF') vi.mocked(csrfToken).mockRejectedValueOnce(new ApiError({ code: 'HTTP_429', message: 'refused' }, 429));
  await act(async () => { fireEvent.click(dialog.getByRole('button', { name: '重试原延期请求' })); });
  expect(dialog.getByLabelText('延期审核意见')).toBeDisabled();
  expect(dialog.getByLabelText('延期审核意见')).toHaveValue('原审核意见');
  expect(dialog.getByLabelText('延期审核决定')).toBeDisabled();
  expect(dialog.getByRole('button', { name: '关闭延期审核' })).toBeDisabled();
  expect(dialog.getByRole('button', { name: '重试原延期请求' })).toBeEnabled();
  expect(vi.mocked(apiRequest).mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(stage === 'CSRF' ? 1 : 2);
  failure = undefined;
  fireEvent.click(dialog.getByRole('button', { name: '重试原延期请求' }));
  await waitFor(() => expect(screen.queryByLabelText('延期审核意见')).not.toBeInTheDocument());
  const calls = vi.mocked(apiRequest).mock.calls.filter(([, init]) => init?.method === 'POST');
  expect(calls).toHaveLength(stage === 'CSRF' ? 2 : 3);
  for (const call of calls.slice(1)) expect(call).toEqual(calls[0]);
  expect(inbox.getByRole('button', { name: '审核延期' })).toBeEnabled();
});

it.each([400, 422, 429])('keeps an extension decision editable after initial explicit %s rejection', async status => {
  const read = vi.mocked(apiRequest).getMockImplementation()!;
  vi.mocked(apiRequest).mockImplementation(async (path, init) => {
    if (init?.method === 'POST') throw new ApiError({ code: `HTTP_${status}`, message: 'refused' }, status);
    return read(path, init);
  });
  await mount();
  fireEvent.click(within(screen.getByRole('region', { name: '过程8D正式待办' })).getByRole('button', { name: '审核延期' }));
  const dialog = within(await screen.findByRole('dialog'));
  await dialog.findByText('等待真实验证');
  fireEvent.change(dialog.getByLabelText('延期审核意见'), { target: { value: '应保留的意见' } });
  fireEvent.click(dialog.getByRole('button', { name: '提交延期审核' }));
  await dialog.findByText('延期审核被拒，意见已保留。');
  expect(dialog.getByLabelText('延期审核意见')).toBeEnabled();
  expect(dialog.getByLabelText('延期审核意见')).toHaveValue('应保留的意见');
  expect(dialog.getByRole('button', { name: '提交延期审核' })).toBeEnabled();
  expect(dialog.queryByRole('button', { name: '重试原延期请求' })).not.toBeInTheDocument();
});
