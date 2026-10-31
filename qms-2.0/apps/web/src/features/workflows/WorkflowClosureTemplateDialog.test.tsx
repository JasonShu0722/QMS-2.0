import { transferableAbortController } from 'node:util';
import { useState } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConfigProvider } from 'antd';
import { createMemoryRouter, Link, RouterProvider } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ApiError, apiRequest, csrfToken } from '../../api/client';
import { LanguageProvider } from '../../i18n/Language';
import { UnsavedChangesProvider, useUnsavedChanges } from '../../layouts/UnsavedChanges';
import { useWorkTabsStore } from '../../work-tabs/workTabsStore';
import { WorkflowClosureTemplateDialog } from './WorkflowClosureTemplateDialog';
import type { WorkflowDefinition } from './workflow-api';

vi.mock('../../api/client', async importOriginal => ({ ...await importOriginal<typeof import('../../api/client')>(), apiRequest: vi.fn(), csrfToken: vi.fn() }));
const candidates = { items: [{ policy: 'INTERNAL', name: '内部关闭审核' }, { policy: 'SUPPLIER', name: '供应商关闭审核' }] };
const draft = { id: 'definition', version: { id: 'version', status: 'DRAFT' } } as WorkflowDefinition;
const writes = () => vi.mocked(apiRequest).mock.calls.filter(([, init]) => init?.method === 'POST');
const failure = (status: number) => new ApiError({ code: `HTTP_${status}`, message: 'unsafe raw message', traceId: `trace-${status}` }, status);
function deferred<T>() { let resolve!: (result: T) => void; let reject!: (cause: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function mount(parentDirty = false) {
  const created = vi.fn(); const closed = vi.fn();
  function Page() {
    const [open, setOpen] = useState(true);
    useUnsavedChanges(parentDirty);
    return <><Link to="/elsewhere">Leave list</Link>{open && <WorkflowClosureTemplateDialog onCreated={created} onClose={() => { closed(); setOpen(false); }} />}</>;
  }
  const router = createMemoryRouter([
    { path: '/console/workflows', element: <LanguageProvider><UnsavedChangesProvider><Page /></UnsavedChangesProvider></LanguageProvider> },
    { path: '/elsewhere', element: <p>Elsewhere</p> },
    { path: '/login', element: <p>Login destination</p> },
  ], { initialEntries: ['/console/workflows'] });
  return { ...render(<ConfigProvider theme={{ token: { motion: false } }}><RouterProvider router={router} /></ConfigProvider>), created, closed, router };
}
async function fill() {
  await screen.findByRole('option', { name: '供应商关闭审核' });
  await waitFor(() => expect(screen.getByLabelText('模板流程代码')).toBeVisible());
  fireEvent.change(screen.getByLabelText('模板策略'), { target: { value: 'SUPPLIER' } });
  fireEvent.change(screen.getByLabelText('模板领域代码'), { target: { value: ' SUPPLIER_QUALITY ' } });
  fireEvent.change(screen.getByLabelText('模板流程代码'), { target: { value: ' SUPPLIER-CLOSE ' } });
  fireEvent.change(screen.getByLabelText('模板流程名称'), { target: { value: ' 供应商关闭流程 ' } });
}
beforeEach(() => {
  vi.resetAllMocks(); localStorage.clear();
  vi.stubGlobal('AbortController', function () { return transferableAbortController(); });
  useWorkTabsStore.getState().reset(); useWorkTabsStore.getState().bindSession('INTERNAL:organization:one');
  vi.mocked(csrfToken).mockResolvedValue('csrf-token');
  vi.mocked(apiRequest).mockImplementation(async (_path, init) => init?.method === 'POST' ? draft : candidates);
});
afterEach(() => vi.unstubAllGlobals());

it('loads server candidates and sends an explicit draft-only body with CSRF and idempotency', async () => {
  const view = mount(); await fill();
  fireEvent.click(screen.getByRole('button', { name: '创建模板草稿' }));
  await waitFor(() => expect(view.created).toHaveBeenCalledWith(draft));
  const [path, init, options] = writes()[0]!;
  expect(path).toBe('/api/v1/workflows/closure-templates');
  expect(JSON.parse(init!.body as string)).toEqual({ policy: 'SUPPLIER', domainCode: 'SUPPLIER_QUALITY', code: 'SUPPLIER-CLOSE', name: '供应商关闭流程' });
  expect(init!.headers).toEqual({ 'x-csrf-token': 'csrf-token', 'Idempotency-Key': expect.any(String) });
  expect(options).toEqual({ replayAfterReauthentication: false });
  expect(csrfToken).toHaveBeenCalledWith(expect.objectContaining({ aborted: false }));
  expect(vi.mocked(apiRequest).mock.calls.every(([url]) => !url.includes('/publish') && !url.includes('/bind'))).toBe(true);
});

it('requires policy, domain code, code and name without pre-filling business identifiers', async () => {
  mount(); await screen.findByRole('option', { name: '供应商关闭审核' });
  for (const label of ['模板领域代码', '模板流程代码', '模板流程名称']) expect(screen.getByLabelText(label)).toHaveValue('');
  expect(screen.getByRole('button', { name: '创建模板草稿' })).toBeDisabled();
  await fill(); fireEvent.change(screen.getByLabelText('模板领域代码'), { target: { value: '   ' } });
  expect(screen.getByRole('button', { name: '创建模板草稿' })).toBeDisabled();
  expect(writes()).toHaveLength(0);
});

it.each([new TypeError('network disconnected'), failure(503), failure(408), failure(425), new ApiError({ code: 'CLIENT_REAUTHENTICATION_COMPLETED', message: 'reauthenticated' })])('freezes unknown results and replays exactly the original body and key: %s', async cause => {
  vi.mocked(apiRequest).mockImplementation(async (_path, init) => { if (init?.method !== 'POST') return candidates; if (writes().length === 1) throw cause; return draft; });
  mount(); await fill(); fireEvent.click(screen.getByRole('button', { name: '创建模板草稿' }));
  const retry = await screen.findByRole('button', { name: '重试原请求' });
  expect(screen.getByLabelText('模板流程代码')).toBeDisabled(); expect(writes()).toHaveLength(1);
  fireEvent.click(retry);
  await waitFor(() => expect(writes()).toHaveLength(2));
  expect(writes()[1]![1]!.body).toBe(writes()[0]![1]!.body);
  expect(writes()[1]![1]!.headers).toEqual(writes()[0]![1]!.headers);
  expect(screen.queryByText('network disconnected')).not.toBeInTheDocument();
});

it('locks unknown inputs and prevents sending an edited request before original reconciliation', async () => {
  vi.mocked(apiRequest).mockImplementation(async (_path, init) => { if (init?.method === 'POST') throw failure(500); return candidates; });
  mount(); await fill(); fireEvent.click(screen.getByRole('button', { name: '创建模板草稿' }));
  await screen.findByRole('button', { name: '重试原请求' });
  expect(screen.getByLabelText('模板策略')).toBeDisabled();
  expect(screen.getByLabelText('模板领域代码')).toBeDisabled();
  expect(screen.getByLabelText('模板流程代码')).toBeDisabled();
  expect(screen.getByLabelText('模板流程名称')).toBeDisabled();
  expect(screen.getByRole('button', { name: '创建模板草稿' })).toBeDisabled();
  expect(screen.getByText('trace-500')).toBeVisible();
});

it.each([400, 422])('keeps unknown template frozen across retry CSRF 429 and write %s until exact replay succeeds', async status => {
  vi.mocked(csrfToken).mockResolvedValueOnce('csrf-token').mockRejectedValueOnce(failure(429)).mockResolvedValue('csrf-token');
  vi.mocked(apiRequest).mockImplementation(async (_path, init) => {
    if (init?.method !== 'POST') return candidates;
    if (writes().length === 1) throw new TypeError('response lost');
    if (writes().length === 2) throw failure(status);
    return draft;
  });
  const view = mount(); await fill(); fireEvent.click(screen.getByRole('button', { name: '创建模板草稿' }));
  fireEvent.click(await screen.findByRole('button', { name: '重试原请求' }));
  expect(await screen.findByText('trace-429')).toBeVisible();
  expect(writes()).toHaveLength(1); expect(csrfToken).toHaveBeenCalledTimes(2);
  expect(screen.getByLabelText('模板流程代码')).toBeDisabled(); expect(screen.getByRole('button', { name: '重试原请求' })).toBeEnabled();
  fireEvent.click(screen.getByRole('button', { name: '重试原请求' }));
  expect(await screen.findByText(`trace-${status}`)).toBeVisible();
  expect(writes()).toHaveLength(2);
  for (const label of ['模板策略', '模板领域代码', '模板流程代码', '模板流程名称']) expect(screen.getByLabelText(label)).toBeDisabled();
  expect(screen.getByRole('button', { name: '创建模板草稿' })).toBeDisabled();
  fireEvent.change(screen.getByLabelText('模板流程代码'), { target: { value: 'CHANGED' } });
  fireEvent.submit(screen.getByLabelText('模板流程代码').closest('form')!);
  expect(writes()).toHaveLength(2); expect(csrfToken).toHaveBeenCalledTimes(3);
  fireEvent.click(screen.getByRole('button', { name: '重试原请求' }));
  await waitFor(() => expect(view.created).toHaveBeenCalledOnce());
  expect(view.created).toHaveBeenCalledWith(draft); expect(writes()).toHaveLength(3);
  const first = writes()[0]![1]!;
  expect(JSON.parse(first.body as string)).toEqual({ policy: 'SUPPLIER', domainCode: 'SUPPLIER_QUALITY', code: 'SUPPLIER-CLOSE', name: '供应商关闭流程' });
  expect((first.headers as Record<string, string>)['Idempotency-Key']).toBeTruthy();
  for (const [path, init] of writes()) {
    expect(path).toBe('/api/v1/workflows/closure-templates'); expect(init!.body).toBe(first.body); expect(init!.headers).toEqual(first.headers);
  }
});

it('keeps template editable after first 400 without claiming an unknown result', async () => {
  vi.mocked(apiRequest).mockImplementation(async (_path, init) => { if (init?.method === 'POST') throw failure(400); return candidates; });
  mount(); await fill(); fireEvent.click(screen.getByRole('button', { name: '创建模板草稿' }));
  expect(await screen.findByText('trace-400')).toBeVisible();
  expect(screen.getByLabelText('模板流程代码')).toBeEnabled(); expect(screen.getByRole('button', { name: '创建模板草稿' })).toBeEnabled();
  expect(screen.queryByRole('button', { name: '重试原请求' })).not.toBeInTheDocument(); expect(writes()).toHaveLength(1);
});

it.each([401, 403])('revokes an unknown template retry on %s instead of retaining its attempt', async status => {
  vi.mocked(apiRequest).mockImplementation(async (_path, init) => {
    if (init?.method !== 'POST') return candidates;
    throw writes().length === 1 ? new TypeError('response lost') : failure(status);
  });
  const view = mount(true); await fill(); fireEvent.click(screen.getByRole('button', { name: '创建模板草稿' }));
  fireEvent.click(await screen.findByRole('button', { name: '重试原请求' }));
  if (status === 401) {
    expect(await screen.findByText('Login destination')).toBeVisible(); expect(useWorkTabsStore.getState().sessionScope).toBeUndefined();
  } else {
    expect(await screen.findByText('trace-403')).toBeVisible();
    expect(screen.getByLabelText('模板流程代码')).toBeDisabled(); expect(screen.getByRole('button', { name: '创建模板草稿' })).toBeDisabled();
  }
  expect(screen.queryByRole('button', { name: '重试原请求' })).not.toBeInTheDocument();
  expect(writes()).toHaveLength(2); expect(view.created).not.toHaveBeenCalled();
});

it.each([409])('restores original inputs after unknown retry is explicitly rejected with %s without changing body or key', async status => {
  vi.mocked(apiRequest).mockImplementation(async (_path, init) => {
    if (init?.method !== 'POST') return candidates;
    throw writes().length === 1 ? new TypeError('network disconnected') : failure(status);
  });
  mount(); await fill(); fireEvent.click(screen.getByRole('button', { name: '创建模板草稿' }));
  fireEvent.click(await screen.findByRole('button', { name: '重试原请求' }));
  await screen.findByText(`trace-${status}`);
  await waitFor(() => expect(screen.getByLabelText('模板流程代码')).toBeEnabled());
  expect(screen.queryByRole('button', { name: '重试原请求' })).not.toBeInTheDocument();
  expect(screen.getByLabelText('模板策略')).toHaveValue('SUPPLIER');
  expect(screen.getByLabelText('模板领域代码')).toHaveValue(' SUPPLIER_QUALITY ');
  expect(screen.getByLabelText('模板流程代码')).toHaveValue(' SUPPLIER-CLOSE ');
  expect(screen.getByLabelText('模板流程名称')).toHaveValue(' 供应商关闭流程 ');
  expect(writes()).toHaveLength(2);
  expect(writes()[1]![1]!.body).toBe(writes()[0]![1]!.body);
  expect(writes()[1]![1]!.headers).toEqual(writes()[0]![1]!.headers);
  fireEvent.click(screen.getByRole('button', { name: '创建模板草稿' }));
  await waitFor(() => expect(writes()).toHaveLength(3));
  await waitFor(() => expect(screen.getByLabelText('模板流程代码')).toBeEnabled());
  expect(writes()[2]![1]!.body).toBe(writes()[0]![1]!.body);
  expect(writes()[2]![1]!.headers).toEqual(writes()[0]![1]!.headers);
  fireEvent.change(screen.getByLabelText('模板流程代码'), { target: { value: 'CHANGED-BY-USER' } });
  fireEvent.click(screen.getByRole('button', { name: '创建模板草稿' }));
  await waitFor(() => expect(writes()).toHaveLength(4));
  expect(JSON.parse(writes()[3]![1]!.body as string).code).toBe('CHANGED-BY-USER');
  expect(writes()[3]![1]!.headers).not.toEqual(writes()[0]![1]!.headers);
});

it('retains readable errors and input, reuses same-payload key, and changes key only with payload', async () => {
  vi.mocked(apiRequest).mockImplementation(async (_path, init) => { if (init?.method === 'POST') throw failure(409); return candidates; });
  mount(); await fill(); fireEvent.click(screen.getByRole('button', { name: '创建模板草稿' }));
  await screen.findByText('trace-409');
  expect(screen.queryByText('unsafe raw message')).not.toBeInTheDocument();
  expect(screen.getByLabelText('模板流程名称')).toHaveValue(' 供应商关闭流程 ');
  expect(screen.getByLabelText('模板流程代码')).toBeEnabled();
  fireEvent.click(screen.getByRole('button', { name: '创建模板草稿' }));
  await waitFor(() => expect(writes()).toHaveLength(2));
  await waitFor(() => expect(screen.getByLabelText('模板流程代码')).toBeEnabled());
  expect(writes()[1]![1]!.headers).toEqual(writes()[0]![1]!.headers);
  fireEvent.change(screen.getByLabelText('模板流程代码'), { target: { value: 'DIFFERENT' } });
  fireEvent.click(screen.getByRole('button', { name: '创建模板草稿' }));
  await waitFor(() => expect(writes()).toHaveLength(3));
  expect(writes()[2]![1]!.headers).not.toEqual(writes()[0]![1]!.headers);
});

it('synchronously prevents duplicate submits and holds navigation while CSRF is pending', async () => {
  const csrf = deferred<string>(); vi.mocked(csrfToken).mockReturnValue(csrf.promise);
  const view = mount(); await fill();
  const submit = screen.getByRole('button', { name: '创建模板草稿' });
  fireEvent.click(submit); fireEvent.click(submit);
  fireEvent.submit(submit.closest('form')!); fireEvent.submit(submit.closest('form')!);
  expect(csrfToken).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('button', { name: '取消' })).toBeDisabled();
  fireEvent.click(screen.getByRole('link', { name: 'Leave list' }));
  expect(view.router.state.location.pathname).toBe('/console/workflows');
  await act(async () => csrf.resolve('csrf-token'));
  await waitFor(() => expect(writes()).toHaveLength(1));
});

it('submits only once on repeated Enter while CSRF is pending', async () => {
  const user = userEvent.setup(); const csrf = deferred<string>();
  vi.mocked(csrfToken).mockReturnValue(csrf.promise);
  const view = mount(); await fill();
  screen.getByLabelText('模板流程名称').focus();
  await user.keyboard('{Enter}{Enter}');
  expect(csrfToken).toHaveBeenCalledTimes(1);
  expect(writes()).toHaveLength(0);
  await act(async () => csrf.resolve('csrf-token'));
  await waitFor(() => expect(view.created).toHaveBeenCalledOnce());
  expect(writes()).toHaveLength(1);
});

it.each(['csrf', 'post'] as const)('blocks mask, close icon and Escape throughout pending %s and releases busy after rejection', async stage => {
  const csrf = deferred<string>(); const write = deferred<WorkflowDefinition>();
  if (stage === 'csrf') vi.mocked(csrfToken).mockReturnValue(csrf.promise);
  else vi.mocked(apiRequest).mockImplementation((_path, init) => init?.method === 'POST' ? write.promise : Promise.resolve(candidates));
  const view = mount(); await fill();
  await waitFor(() => expect(screen.getByRole('button', { name: '关闭' })).toBeVisible());
  fireEvent.click(screen.getByRole('button', { name: '创建模板草稿' }));
  if (stage === 'post') await waitFor(() => expect(writes()).toHaveLength(1));
  expect(screen.queryByRole('button', { name: '关闭' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: '取消' })).toBeDisabled();
  const dialog = screen.getByRole('dialog');
  const wrap = dialog.closest('.ant-modal-wrap')!;
  fireEvent.mouseDown(wrap); fireEvent.mouseUp(wrap); fireEvent.click(wrap);
  fireEvent.keyDown(dialog, { key: 'Escape', keyCode: 27 });
  expect(view.closed).not.toHaveBeenCalled();
  expect(dialog).toBeVisible();
  expect(screen.queryByText('当前草稿尚未保存，继续将放弃修改。')).not.toBeInTheDocument();
  if (stage === 'csrf') await act(async () => csrf.reject(failure(409)));
  else await act(async () => write.reject(failure(409)));
  await screen.findByText('trace-409');
  expect(screen.getByRole('button', { name: '关闭' })).toBeVisible();
  expect(screen.getByRole('button', { name: '取消' })).toBeEnabled();
  expect(screen.getByLabelText('模板流程代码')).toBeEnabled();
  expect(view.closed).not.toHaveBeenCalled();
});

it.each(['unmount', 'session'] as const)('does not dispatch an old write after %s during CSRF', async change => {
  const csrf = deferred<string>(); vi.mocked(csrfToken).mockReturnValue(csrf.promise);
  const view = mount(); await fill(); fireEvent.click(screen.getByRole('button', { name: '创建模板草稿' }));
  if (change === 'unmount') view.unmount();
  else act(() => useWorkTabsStore.getState().bindSession('INTERNAL:organization:two'));
  await act(async () => csrf.resolve('csrf-token'));
  expect(writes()).toHaveLength(0);
  expect(view.created).not.toHaveBeenCalled();
});

it('ignores a late 401 from an old session instead of logging the new session out', async () => {
  const write = deferred<WorkflowDefinition>();
  vi.mocked(apiRequest).mockImplementation((_path, init) => init?.method === 'POST' ? write.promise : Promise.resolve(candidates));
  const view = mount(); await fill(); fireEvent.click(screen.getByRole('button', { name: '创建模板草稿' }));
  await waitFor(() => expect(writes()).toHaveLength(1));
  act(() => useWorkTabsStore.getState().bindSession('INTERNAL:organization:two'));
  await act(async () => write.reject(failure(401)));
  expect(useWorkTabsStore.getState().sessionScope).toBe('INTERNAL:organization:two');
  expect(view.router.state.location.pathname).toBe('/console/workflows');
  expect(view.created).not.toHaveBeenCalled();
});

it('ignores a late candidate GET 401 after the session is replaced', async () => {
  const read = deferred<typeof candidates>();
  vi.mocked(apiRequest).mockReturnValueOnce(read.promise);
  const view = mount(true);
  act(() => useWorkTabsStore.getState().bindSession('INTERNAL:organization:two'));
  await screen.findByRole('option', { name: '供应商关闭审核' });
  await act(async () => read.reject(failure(401)));
  expect(useWorkTabsStore.getState().sessionScope).toBe('INTERNAL:organization:two');
  expect(view.router.state.location.pathname).toBe('/console/workflows');
  expect(screen.queryByText('Login destination')).not.toBeInTheDocument();
  expect(writes()).toHaveLength(0);
});

it.each(['read', 'write'] as const)('clears current session and reaches login on a current %s 401', async stage => {
  vi.mocked(apiRequest).mockImplementation(async (_path, init) => { if (stage === 'read' || init?.method === 'POST') throw failure(401); return candidates; });
  mount(); if (stage === 'write') { await fill(); fireEvent.click(screen.getByRole('button', { name: '创建模板草稿' })); }
  expect(await screen.findByText('Login destination')).toBeVisible();
  expect(useWorkTabsStore.getState().sessionScope).toBeUndefined();
});

it('releases POST busy before completing 401 navigation past a parent dirty draft', async () => {
  const write = deferred<WorkflowDefinition>();
  vi.mocked(apiRequest).mockImplementation((_path, init) => init?.method === 'POST' ? write.promise : Promise.resolve(candidates));
  const view = mount(true); await fill();
  fireEvent.click(screen.getByRole('button', { name: '创建模板草稿' }));
  await waitFor(() => expect(writes()).toHaveLength(1));
  expect(screen.getByRole('button', { name: '取消' })).toBeDisabled();
  await act(async () => write.reject(failure(401)));
  expect(await screen.findByText('Login destination')).toBeVisible();
  expect(view.router.state.location.pathname).toBe('/login');
  expect(useWorkTabsStore.getState().sessionScope).toBeUndefined();
  expect(screen.queryByText('当前草稿尚未保存，继续将放弃修改。')).not.toBeInTheDocument();
  expect(view.created).not.toHaveBeenCalled();
  expect(view.closed).not.toHaveBeenCalled();
});

it('disables further writes after 403 but retains the form and trace', async () => {
  vi.mocked(apiRequest).mockImplementation(async (_path, init) => { if (init?.method === 'POST') throw failure(403); return candidates; });
  mount(); await fill(); fireEvent.click(screen.getByRole('button', { name: '创建模板草稿' }));
  await screen.findByText('trace-403');
  expect(screen.getByLabelText('模板流程代码')).toHaveValue(' SUPPLIER-CLOSE ');
  expect(screen.getByRole('button', { name: '创建模板草稿' })).toBeDisabled();
  expect(screen.getByText('无权执行此操作')).toBeVisible();
  expect(writes()).toHaveLength(1);
});

it('retries candidate read failures without showing a false empty success', async () => {
  vi.mocked(apiRequest).mockRejectedValueOnce(failure(502)).mockResolvedValue(candidates);
  mount(); await screen.findByText('trace-502');
  expect(screen.getByRole('button', { name: '创建模板草稿' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: '重试加载模板' }));
  expect(await screen.findByRole('option', { name: '供应商关闭审核' })).toBeInTheDocument();
});

it.each(['cancel', 'icon', 'mask', 'escape'] as const)('confirms dirty %s through UnsavedChanges and keeps inputs when cancelled', async via => {
  function close() {
    const dialog = screen.getByLabelText('模板策略').closest('[role="dialog"]')!;
    if (via === 'cancel') fireEvent.click(screen.getByRole('button', { name: '取消' }));
    else if (via === 'icon') fireEvent.click(screen.getByRole('button', { name: '关闭' }));
    else if (via === 'mask') {
      const wrap = dialog.closest('.ant-modal-wrap')!;
      fireEvent.mouseDown(wrap); fireEvent.mouseUp(wrap); fireEvent.click(wrap);
    }
    else fireEvent.keyDown(dialog, { key: 'Escape', keyCode: 27 });
  }
  const view = mount(); await fill(); close();
  fireEvent.click(await screen.findByRole('button', { name: '继续编辑' }));
  expect(screen.getByLabelText('模板流程代码')).toHaveValue(' SUPPLIER-CLOSE ');
  expect(view.closed).not.toHaveBeenCalled();
  await waitFor(() => expect(screen.getByText('当前草稿尚未保存，继续将放弃修改。')).not.toBeVisible());
  fireEvent.click(screen.getByRole('button', { name: '取消' }));
  fireEvent.click(await screen.findByRole('button', { name: '放弃修改并关闭' }));
  await waitFor(() => expect(view.closed).toHaveBeenCalledOnce());
});

it('localizes the candidate dialog without changing shared translations', async () => {
  vi.mocked(apiRequest).mockResolvedValue({ items: [{ policy: 'INTERNAL', name: '内部问题关闭审核' }, { policy: 'SUPPLIER', name: '供应商问题关闭审核' }] });
  localStorage.setItem('qms:locale:v1', 'en-US'); mount();
  await waitFor(() => expect(screen.getByLabelText('Template domain code')).toBeVisible());
  expect(await screen.findByRole('option', { name: 'Supplier problem closure review' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Create template draft' })).toBeDisabled();
  expect(screen.getByText('Publishing checks whether the domain is integrated. Creating a candidate draft does not publish, bind or enable it.')).toBeVisible();
});
