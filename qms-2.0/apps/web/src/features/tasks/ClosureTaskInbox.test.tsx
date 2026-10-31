import { transferableAbortController } from 'node:util';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ConfigProvider } from 'antd';
import { MemoryRouter, Route, Routes, createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { components } from '@qms/contracts';
import { registerReauthentication } from '../../api/client';
import { LanguageProvider } from '../../i18n/Language';
import { UnsavedChangesProvider, useUnsavedChanges } from '../../layouts/UnsavedChanges';
import { useWorkTabsStore } from '../../work-tabs/workTabsStore';
import { ClosureTaskInbox } from './ClosureTaskInbox';

type Task = components['schemas']['ClosureTaskDto'];
type Round = components['schemas']['WorkflowClosureRoundDto'];
type Notice = components['schemas']['ClosureNotificationDto'];
const task: Task = { id: 'manager-duty', roundId: 'round-1', roundVersion: 7, problemId: 'problem-1', reportNumber: 'Q-001', workflowVersionId: 'wf-1', duty: 'SECTION_MANAGER', status: 'PENDING', contentVersion: 3, createdAt: '2026-10-25T00:00:00Z', userId: 'actor', canAct: true, requiresJointConfirmation: false, jointDuties: [] };
const duty = (name: Task['duty'], userId = task.userId): Round['duties'][number] => ({ id: name, duty: name, status: 'PENDING', userId, decidedBy: null, comment: null, decidedAt: null, version: 1 });
const round: Round = { id: task.roundId, problemId: task.problemId, instanceId: 'instance-1', workflowVersionId: task.workflowVersionId, contentVersion: 3, roundNumber: 2, status: 'PENDING', version: 7, createdAt: task.createdAt, updatedAt: task.createdAt, duties: [duty('SECTION_MANAGER'), duty('PROFESSIONAL', 'professional')] };
const joint: Task = { ...task, requiresJointConfirmation: true, jointDuties: ['SECTION_MANAGER', 'MINISTER'] };
const notice: Notice = { id: 'notice-1', roundId: task.roundId, roundVersion: 7, problemId: task.problemId, reportNumber: task.reportNumber, kind: 'CLOSURE_PENDING', subject: '关闭职责待审核', body: '请核对固定内容版本', deliveredAt: task.createdAt, duties: ['SECTION_MANAGER'], requiresJointConfirmation: false, jointDuties: [] };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
type Request = { path: string; init?: RequestInit };
function stub(options: { tasks?: Task[]; total?: number; rounds?: Round[]; notices?: Notice[]; noticeTotal?: number; intercept?: (request: Request) => Response | Promise<Response> | undefined } = {}) {
  const requests: Request[] = [];
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = { path: String(input), init }; requests.push(request);
    const intercepted = options.intercept?.(request);
    if (intercepted !== undefined) return intercepted;
    if (request.path === '/api/v1/auth/csrf') return json({ csrfToken: 'csrf-test' });
    if (request.path.startsWith('/api/v1/tasks/closure?')) return json({ items: options.tasks ?? [task], total: options.total ?? (options.tasks ?? [task]).length });
    if (request.path.startsWith('/api/v1/notifications/closure?')) return json({ items: options.notices ?? [notice], total: options.noticeTotal ?? (options.notices ?? [notice]).length });
    if (request.path.endsWith('/rounds')) return json(options.rounds ?? [round]);
    if (request.path.endsWith('/decide')) return json({ ...round, version: 8, status: 'APPROVED' });
    throw new Error(`Unexpected request: ${request.path}`);
  }));
  return requests;
}
function scene() {
  return <ConfigProvider theme={{ token: { motion: false } }}><LanguageProvider><MemoryRouter initialEntries={['/app/my-tasks']}><UnsavedChangesProvider><Routes>
    <Route path="/app/my-tasks" element={<ClosureTaskInbox />} /><Route path="/login" element={<p>LOGIN</p>} />
  </Routes></UnsavedChangesProvider></MemoryRouter></LanguageProvider></ConfigProvider>;
}
const writes = (requests: Request[]) => requests.filter(item => item.path.endsWith('/decide'));
// State checks use the known native button; representative role assertions remain below.
function visibleButton(scope: HTMLElement, label: string) {
  const button = within(scope).getByText(label, { selector: 'button span' }).closest('button')!;
  expect(button).toBeVisible();
  return button;
}
async function openReview() {
  const label = await screen.findByText('审核关闭职责', { selector: 'button span' });
  const button = label.closest('button')!;
  await waitFor(() => { expect(button).toBeVisible(); expect(button).toBeEnabled(); });
  fireEvent.click(button);
  const dialog = await screen.findByRole('dialog', { name: '关闭职责审核' });
  await waitFor(() => expect(dialog).toBeVisible());
  return dialog;
}
async function fillReview() { const dialog = await openReview(); await within(dialog).findByText('第 2 轮'); fireEvent.change(within(dialog).getByLabelText('审核意见'), { target: { value: '核对完成' } }); return dialog; }
const submit = (dialog: HTMLElement) => fireEvent.click(visibleButton(dialog, '提交审核'));
beforeEach(() => {
  localStorage.clear(); sessionStorage.clear(); useWorkTabsStore.getState().bindSession('INTERNAL:org:actor');
  // Match the existing navigation tests: data routers use Node's native Request.
  vi.stubGlobal('AbortController', function () { return transferableAbortController(); });
});
afterEach(() => { vi.unstubAllGlobals(); useWorkTabsStore.getState().reset(); });

it('reads real paginated duty tasks and notifications without counting problems or exposing claim/transfer', async () => {
  const requests = stub({ tasks: [task, { ...task, id: 'second', duty: 'MINISTER' }], total: 27 }); render(scene());
  expect(await screen.findByText('职责待办总数：27（非问题数）')).toBeInTheDocument();
  expect(requests.some(item => item.path === '/api/v1/tasks/closure?pageSize=25&offset=0')).toBe(true);
  expect(await screen.findByText(notice.subject)).toBeInTheDocument();
  expect(requests.some(item => item.path === '/api/v1/notifications/closure?pageSize=25&offset=0')).toBe(true);
  expect(screen.queryByRole('button', { name: /领取|转派|指派/ })).not.toBeInTheDocument();
  fireEvent.click(within(screen.getByRole('region', { name: '关闭职责待办' })).getByTitle('2'));
  await waitFor(() => expect(requests.some(item => item.path.endsWith('pageSize=25&offset=25'))).toBe(true));
});

it('rechecks round history, shows fixed version and a real workspace link without claiming a full snapshot', async () => {
  const requests = stub(); render(scene()); const dialog = await fillReview();
  expect(requests.filter(item => item.path.endsWith('/rounds'))).toHaveLength(1);
  expect(within(dialog).getByText('固定内容版本：3')).toBeInTheDocument();
  expect(within(dialog).getByText(/提交审核前.*核对完整内容/)).toBeInTheDocument();
  expect(within(dialog).getByRole('link', { name: '核对问题工作空间' })).toHaveAttribute('href', '/app/problem-workspace/problem-1?instanceId=instance-1');
  for (const label of ['提交审核', '关闭审核', '刷新审核基线']) {
    expect(within(dialog).getByRole('button', { name: label })).toBe(visibleButton(dialog, label));
  }
  submit(dialog); await waitFor(() => expect(writes(requests)).toHaveLength(1));
  expect(JSON.parse(writes(requests)[0].init!.body as string)).toEqual({ expectedRoundVersion: 7, duties: ['SECTION_MANAGER'], decision: 'APPROVE', comment: '核对完成' });
  expect(writes(requests)[0].init!.headers).toMatchObject({ 'x-csrf-token': 'csrf-test', 'Idempotency-Key': expect.any(String) });
});

it('requires an explicit joint acknowledgement and submits both management duties, never the professional duty', async () => {
  const requests = stub({ tasks: [joint], rounds: [{ ...round, duties: [...round.duties, duty('MINISTER'), duty('PROFESSIONAL')] }] }); render(scene());
  const dialog = await fillReview(); expect(within(dialog).getByText(/本次一次确认科室经理与部长两份职责/)).toBeInTheDocument();
  expect(visibleButton(dialog, '提交审核')).toBeDisabled();
  fireEvent.click(within(dialog).getByRole('checkbox', { name: '我确认同时审核科室经理与部长两份职责' })); submit(dialog);
  await waitFor(() => expect(writes(requests)).toHaveLength(1));
  expect(JSON.parse(writes(requests)[0].init!.body as string).duties).toEqual(['SECTION_MANAGER', 'MINISTER']);
});

it.each(['PROFESSIONAL', 'MINISTER'] as const)('keeps a single %s duty independent and sends RETURN explicitly', async name => {
  const requests = stub({ tasks: [{ ...task, duty: name }], rounds: [{ ...round, duties: [duty(name)] }] }); render(scene());
  const dialog = await fillReview(); fireEvent.click(within(dialog).getByRole('radio', { name: '退回修改' })); submit(dialog);
  await waitFor(() => expect(writes(requests)).toHaveLength(1));
  expect(JSON.parse(writes(requests)[0].init!.body as string)).toMatchObject({ duties: [name], decision: 'RETURN' });
});

it.each([
  { ...round, version: 8 }, { ...round, status: 'CANCELLED' as const }, { ...round, id: 'replacement-round' },
  { ...round, duties: [duty('SECTION_MANAGER', 'another-user')] },
  { ...round, duties: [{ ...duty('SECTION_MANAGER'), status: 'WAITING' as const }] },
  { ...round, contentVersion: 4 }, { ...round, workflowVersionId: 'replacement-workflow' },
])('refuses an obsolete or mismatched history baseline %#', async changed => {
  const requests = stub({ rounds: [changed] }); render(scene()); const dialog = await openReview();
  await within(dialog).findByText(/审核基线已失效/); expect(visibleButton(dialog, '提交审核')).toBeDisabled(); expect(writes(requests)).toHaveLength(0);
});

it('rejects malformed joint duties instead of mixing professional and management', async () => {
  const requests = stub({ tasks: [{ ...joint, jointDuties: ['SECTION_MANAGER', 'PROFESSIONAL'] }] }); render(scene()); const dialog = await openReview();
  await within(dialog).findByText(/审核基线已失效/); expect(visibleButton(dialog, '提交审核')).toBeDisabled(); expect(writes(requests)).toHaveLength(0);
});

it.each([503, 'network'] as const)('freezes an unknown %s write and retries exactly the original body and key', async failure => {
  let attempt = 0;
  const requests = stub({ intercept: ({ path }) => { if (!path.endsWith('/decide') || ++attempt > 1) return; if (failure === 'network') return Promise.reject(new TypeError('offline')); return json({}, failure); } }); render(scene());
  const dialog = await fillReview(); submit(dialog); await within(dialog).findByText(/审核结果尚未确认/);
  expect(within(dialog).getByLabelText('审核意见')).toBeDisabled();
  expect(within(dialog).getByRole('radio', { name: '退回修改' })).toBeDisabled();
  fireEvent.click(visibleButton(dialog, '重试原请求'));
  await waitFor(() => expect(writes(requests)).toHaveLength(2));
  expect(writes(requests)[1].init!.body).toBe(writes(requests)[0].init!.body);
  expect(writes(requests)[1].init!.headers).toEqual(writes(requests)[0].init!.headers);
  await screen.findByText(/审核回执：/);
});

it.each(['initial', 'after-conflict'] as const)('requires explicit retry after real reauthentication on %s mutation with the same body and key', async stage => {
  let count = 0;
  const requests = stub({ intercept: ({ path }) => {
    if (!path.endsWith('/decide')) return;
    count++;
    if (stage === 'after-conflict' && count === 1) return json({ code: 'WORKFLOW_CLOSURE_CONFLICT' }, 409);
    if (count === (stage === 'initial' ? 1 : 2)) return json({ code: 'AUTH_REAUTHENTICATION_REQUIRED' }, 401);
  } });
  const reauthenticate = vi.fn(async () => {});
  const unregister = registerReauthentication(reauthenticate);
  try {
    render(scene()); const dialog = await fillReview(); submit(dialog);
    if (stage === 'after-conflict') {
      await within(dialog).findByText(/审核基线已失效/);
      fireEvent.click(visibleButton(dialog, '刷新审核基线'));
      await waitFor(() => expect(visibleButton(dialog, '提交审核')).toBeEnabled());
      submit(dialog);
    }
    await waitFor(() => expect(reauthenticate).toHaveBeenCalledTimes(1));
    await act(async () => {});
    const expected = stage === 'initial' ? 1 : 2;
    expect(writes(requests)).toHaveLength(expected);
    expect(within(dialog).getByText(/身份验证已完成/)).toBeInTheDocument();
    expect(within(dialog).getByLabelText('审核意见')).toHaveValue('核对完成');
    expect(within(dialog).getByLabelText('审核意见')).toBeDisabled();
    expect(within(dialog).getByRole('radio', { name: '退回修改' })).toBeDisabled();
    expect(visibleButton(dialog, '关闭审核')).toBeDisabled();
    const retry = visibleButton(dialog, '重试原请求');
    expect(retry).toBeEnabled();
    expect(screen.queryByText('无权审核关闭职责')).not.toBeInTheDocument();
    expect(screen.queryByText(/审核回执：/)).not.toBeInTheDocument();
    fireEvent.click(retry);
    await screen.findByText(/审核回执：/);
    expect(writes(requests)).toHaveLength(expected + 1);
    expect(writes(requests)[expected].init!.body).toBe(writes(requests)[expected - 1].init!.body);
    expect(writes(requests)[expected].init!.headers).toEqual(writes(requests)[expected - 1].init!.headers);
  } finally { unregister(); }
});

it.each([[503, 'close'], [503, 'route'], ['network', 'close'], ['network', 'route']] as const)('releases an unknown %s attempt after notifications 403 for guarded %s', async (failure, exit) => {
  // Wait for portal visibility instead of relying on slow role queries as a delay.
  const control = (scope: HTMLElement, label: string) => waitFor(() => visibleButton(scope, label));
  let denied = false;
  const requests = stub({ intercept: ({ path }) => {
    if (path.endsWith('/decide')) return failure === 'network' ? Promise.reject(new TypeError('offline')) : json({}, failure);
    if (denied && path.startsWith('/api/v1/notifications/closure?')) return json({ code: 'FEATURE_PERMISSION_DENIED', traceId: 'trace-notices-denied' }, 403);
  } });
  const router = createMemoryRouter([{ path: '*', element: <UnsavedChangesProvider><Routes>
    <Route path="/app/my-tasks" element={<ClosureTaskInbox />} /><Route path="/other" element={<p>OTHER</p>} />
  </Routes></UnsavedChangesProvider> }], { initialEntries: ['/app/my-tasks'] });
  render(<ConfigProvider theme={{ token: { motion: false } }}><LanguageProvider><RouterProvider router={router} /></LanguageProvider></ConfigProvider>);
  const dialog = await fillReview(); submit(dialog); await within(dialog).findByText(/审核结果尚未确认/);
  denied = true; fireEvent.click(await control(document.body, '刷新职责通知'));
  await within(dialog).findByText('无权审核关闭职责');
  const close = await control(dialog, '关闭审核');
  expect(close).toBeEnabled();
  expect(screen.getAllByText('trace-notices-denied').every(element => element.tagName === 'CODE')).toBe(true);
  expect(within(dialog).getByText(/先前审核结果仍待核对/)).toBeInTheDocument();
  expect(screen.queryByText('Q-001')).not.toBeInTheDocument();
  expect(screen.queryByText(notice.subject)).not.toBeInTheDocument();
  const retry = await control(dialog, '重试原请求');
  expect(retry).toBeDisabled();
  fireEvent.click(retry);
  fireEvent.click(close);
  let guard = (await screen.findByText('当前草稿尚未保存，继续将放弃修改。')).closest('[role="dialog"]') as HTMLElement;
  fireEvent.click(await control(guard, '继续编辑'));
  expect(within(dialog).getByLabelText('审核意见')).toHaveValue('核对完成');
  await act(async () => { await router.navigate('/other'); });
  guard = (await screen.findByText('当前草稿尚未保存，继续将放弃修改。')).closest('[role="dialog"]') as HTMLElement;
  fireEvent.click(await control(guard, '继续编辑'));
  expect(router.state.location.pathname).toBe('/app/my-tasks');
  if (exit === 'close') {
    fireEvent.click(close);
    guard = (await screen.findByText('当前草稿尚未保存，继续将放弃修改。')).closest('[role="dialog"]') as HTMLElement;
    fireEvent.click(await control(guard, '放弃修改并关闭'));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '关闭职责审核' })).not.toBeInTheDocument());
    expect(screen.getByText(/先前审核结果仍待核对/)).toBeInTheDocument();
    const unload = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(unload); expect(unload.defaultPrevented).toBe(false);
    await act(async () => { await router.navigate('/other'); });
  } else {
    await act(async () => { await router.navigate('/other'); });
    guard = (await screen.findByText('当前草稿尚未保存，继续将放弃修改。')).closest('[role="dialog"]') as HTMLElement;
    fireEvent.click(await control(guard, '放弃修改'));
  }
  await screen.findByText('OTHER'); expect(writes(requests)).toHaveLength(1);
});

it.each(['success', '503', '401'] as const)('isolates a late %s POST after concurrent notifications GET 403 without a receipt or old data', async result => {
  let release!: (value: Response) => void;
  let denied = false;
  const requests = stub({ intercept: ({ path }) => {
    if (path.endsWith('/decide')) return new Promise<Response>(resolve => { release = resolve; });
    if (denied && path.startsWith('/api/v1/notifications/closure?')) return json({ code: 'FEATURE_PERMISSION_DENIED', traceId: 'trace-inflight-denied' }, 403);
  } });
  render(scene()); const dialog = await fillReview(); submit(dialog);
  await waitFor(() => expect(writes(requests)).toHaveLength(1));
  denied = true; fireEvent.click(visibleButton(document.body, '刷新职责通知'));
  await within(dialog).findByText('无权审核关闭职责');
  expect(writes(requests)[0].init!.signal!.aborted).toBe(true);
  expect(visibleButton(dialog, '关闭审核')).toBeEnabled();
  expect(within(dialog).getByText(/先前审核结果仍待核对/)).toBeInTheDocument();
  const count = requests.length;
  await act(async () => { release(result === 'success' ? json({ ...round, version: 8, status: 'APPROVED' }) : json({ code: result === '401' ? 'AUTH_SESSION_REQUIRED' : 'UNAVAILABLE' }, Number(result))); });
  expect(requests).toHaveLength(count);
  expect(screen.queryByText(/审核回执：/)).not.toBeInTheDocument();
  expect(screen.queryByText('Q-001')).not.toBeInTheDocument();
  expect(screen.queryByText(notice.subject)).not.toBeInTheDocument();
  expect(screen.queryByText('第 2 轮')).not.toBeInTheDocument();
  expect(screen.queryByText('LOGIN')).not.toBeInTheDocument();
  expect(within(dialog).getByText('无权审核关闭职责')).toBeInTheDocument();
  expect(visibleButton(dialog, '提交审核')).toBeDisabled();
  expect(useWorkTabsStore.getState().sessionScope).toBe('INTERNAL:org:actor');
});

it('does not dispatch a decision after notifications 403 during CSRF', async () => {
  let release!: (value: Response) => void;
  let denied = false;
  const requests = stub({ intercept: ({ path }) => {
    if (path === '/api/v1/auth/csrf') return new Promise<Response>(resolve => { release = resolve; });
    if (denied && path.startsWith('/api/v1/notifications/closure?')) return json({ code: 'FEATURE_PERMISSION_DENIED' }, 403);
  } });
  render(scene()); const dialog = await fillReview(); submit(dialog);
  await waitFor(() => expect(release).toBeDefined());
  denied = true; fireEvent.click(visibleButton(document.body, '刷新职责通知'));
  await within(dialog).findByText('无权审核关闭职责');
  expect(requests.find(item => item.path === '/api/v1/auth/csrf')!.init!.signal!.aborted).toBe(true);
  await act(async () => { release(json({ csrfToken: 'late-csrf' })); });
  expect(writes(requests)).toHaveLength(0);
  expect(visibleButton(dialog, '关闭审核')).toBeEnabled();
  expect(visibleButton(dialog, '提交审核')).toBeDisabled();
  expect(within(dialog).getByText('无权审核关闭职责')).toBeInTheDocument();
});

it('clears a 409 baseline but retains the comment and requires an explicit refresh', async () => {
  let conflict = false;
  const requests = stub({ intercept: ({ path }) => {
    if (path.endsWith('/decide')) { conflict = true; return json({ code: 'WORKFLOW_CLOSURE_CONFLICT' }, 409); }
    if (conflict && path.startsWith('/api/v1/tasks/closure?')) return json({ items: [{ ...task, roundVersion: 8 }], total: 1 });
    if (conflict && path.endsWith('/rounds')) return json([{ ...round, version: 8 }]);
  } }); render(scene()); const dialog = await fillReview();
  fireEvent.click(within(dialog).getByText('轮次与职责历史'));
  expect(await within(dialog).findByText('第 2 轮 · v7')).toBeInTheDocument();
  submit(dialog);
  await within(dialog).findByText(/审核基线已失效/);
  fireEvent.click(within(dialog).getByText('轮次与职责历史'));
  expect(await within(dialog).findByText('暂无轮次历史')).toBeVisible();
  expect(within(dialog).queryByText('第 2 轮 · v7')).not.toBeInTheDocument();
  expect(within(dialog).getByLabelText('审核意见')).toHaveValue('核对完成');
  expect(visibleButton(dialog, '提交审核')).toBeDisabled();
  fireEvent.click(visibleButton(dialog, '刷新审核基线'));
  await waitFor(() => expect(visibleButton(dialog, '提交审核')).toBeEnabled());
  expect(within(dialog).getByLabelText('审核意见')).toHaveValue('核对完成'); expect(writes(requests)).toHaveLength(1);
});

it('reports source-change CANCELLED as cancellation and instructs restore/resubmit, not approval', async () => {
  stub({ intercept: ({ path }) => path.endsWith('/decide') ? json({ ...round, status: 'CANCELLED', version: 8 }) : undefined }); render(scene());
  submit(await fillReview()); await screen.findByText(/本轮已取消，请恢复修改后重新提交/);
  expect(screen.queryByText('审核通过')).not.toBeInTheDocument();
});

it('retains the confirmed receipt when inbox refresh fails and never replays the decision', async () => {
  let decided = false;
  const requests = stub({ intercept: ({ path }) => {
    if (path.endsWith('/decide')) { decided = true; return json({ ...round, status: 'APPROVED', version: 8 }); }
    if (decided && path.includes('/closure?')) return json({}, 503);
  } }); render(scene()); submit(await fillReview());
  await screen.findByText(/审核回执：/); await screen.findAllByText(/加载失败/);
  fireEvent.click(visibleButton(document.body, '刷新职责待办'));
  await waitFor(() => expect(requests.filter(item => item.path.startsWith('/api/v1/tasks/closure?')).length).toBeGreaterThan(2));
  expect(writes(requests)).toHaveLength(1); expect(screen.getByText(/审核回执：/)).toBeInTheDocument();
});

it('terminates current 401 through session navigation even with a dirty comment', async () => {
  stub({ intercept: ({ path }) => path.endsWith('/decide') ? json({ code: 'AUTH_SESSION_REQUIRED' }, 401) : undefined }); render(scene());
  submit(await fillReview()); await screen.findByText('LOGIN', {}, { timeout: 5000 }); expect(useWorkTabsStore.getState().sessionScope).toBeUndefined();
  expect(screen.queryByText('当前草稿尚未保存，继续将放弃修改。')).not.toBeInTheDocument();
});

it('disables review after 403 without keeping sensitive task details', async () => {
  stub({ intercept: ({ path }) => path.endsWith('/decide') ? json({ code: 'FEATURE_PERMISSION_DENIED' }, 403) : undefined }); render(scene());
  const dialog = await fillReview(); submit(dialog); await within(dialog).findByText('无权审核关闭职责');
  expect(visibleButton(dialog, '提交审核')).toBeDisabled();
  expect(screen.queryByText('Q-001')).not.toBeInTheDocument();
});

it('does not dispatch after scope change during CSRF and aborts the old scope', async () => {
  let release!: (value: Response) => void;
  const requests = stub({ intercept: ({ path }) => path === '/api/v1/auth/csrf' ? new Promise<Response>(resolve => { release = resolve; }) : undefined }); render(scene());
  submit(await fillReview()); await waitFor(() => expect(release).toBeDefined());
  const csrf = requests.find(item => item.path === '/api/v1/auth/csrf')!;
  act(() => useWorkTabsStore.getState().bindSession('INTERNAL:other:someone'));
  await act(async () => { release(json({ csrfToken: 'late' })); });
  expect(csrf.init!.signal!.aborted).toBe(true); expect(writes(requests)).toHaveLength(0);
  expect(screen.queryByDisplayValue('核对完成')).not.toBeInTheDocument();
});

it('aborts on unmount and ignores late read results', async () => {
  let release!: (value: Response) => void;
  const requests = stub({ intercept: ({ path }) => path.endsWith('/rounds') ? new Promise<Response>(resolve => { release = resolve; }) : undefined }); const view = render(scene());
  await openReview(); await waitFor(() => expect(release).toBeDefined()); view.unmount();
  expect(requests.find(item => item.path.endsWith('/rounds'))!.init!.signal!.aborted).toBe(true);
  await act(async () => { release(json([round])); }); expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

it('can close an untouched review while its readonly history request is still pending', async () => {
  const requests = stub({ intercept: ({ path }) => path.endsWith('/rounds') ? new Promise<Response>(() => {}) : undefined }); render(scene());
  const dialog = await openReview(); fireEvent.click(visibleButton(dialog, '关闭审核'));
  await waitFor(() => expect(screen.queryByRole('dialog', { name: '关闭职责审核' })).not.toBeInTheDocument());
  expect(requests.find(item => item.path.endsWith('/rounds'))!.init!.signal!.aborted).toBe(true);
});

it('synchronously locks double submit while CSRF is pending', async () => {
  let release!: (value: Response) => void;
  const requests = stub({ intercept: ({ path }) => path === '/api/v1/auth/csrf' ? new Promise<Response>(resolve => { release = resolve; }) : undefined }); render(scene());
  const dialog = await fillReview(); act(() => { submit(dialog); submit(dialog); });
  expect(requests.filter(item => item.path === '/api/v1/auth/csrf')).toHaveLength(1);
  await act(async () => { release(json({ csrfToken: 'token' })); }); await waitFor(() => expect(writes(requests)).toHaveLength(1));
});

it('guards dirty close, preserves on continue, and restores focus after confirmed discard', async () => {
  stub(); render(scene()); const trigger = await screen.findByRole('button', { name: '审核关闭职责' });
  const dialog = await fillReview(); fireEvent.click(visibleButton(dialog, '关闭审核'));
  // rc-dialog uses the same test-id for both modal headings in test mode.
  const guard = (await screen.findByText('当前草稿尚未保存，继续将放弃修改。')).closest('[role="dialog"]') as HTMLElement;
  fireEvent.click(within(guard).getByRole('button', { name: '继续编辑' })); expect(within(dialog).getByLabelText('审核意见')).toHaveValue('核对完成');
  fireEvent.click(visibleButton(dialog, '关闭审核'));
  fireEvent.click(within((await screen.findByText('当前草稿尚未保存，继续将放弃修改。')).closest('[role="dialog"]') as HTMLElement).getByRole('button', { name: '放弃修改并关闭' }));
  await waitFor(() => expect(screen.queryByRole('dialog', { name: '关闭职责审核' })).not.toBeInTheDocument());
  await waitFor(() => expect(trigger).toHaveFocus());
});

it('shows truthful empty states', async () => {
  stub({ tasks: [], notices: [] }); render(scene()); expect(await screen.findByText('暂无关闭职责待办')).toBeInTheDocument(); expect(await screen.findByText('暂无关闭职责通知')).toBeInTheDocument();
});

it('keeps professional independent when the same user also has joint management metadata', async () => {
  const requests = stub({ tasks: [{ ...joint, duty: 'PROFESSIONAL' }], rounds: [{ ...round, duties: [duty('PROFESSIONAL'), { ...duty('SECTION_MANAGER'), status: 'WAITING' }, { ...duty('MINISTER'), status: 'WAITING' }] }] }); render(scene());
  const dialog = await fillReview(); expect(within(dialog).queryByRole('checkbox')).not.toBeInTheDocument(); submit(dialog);
  await waitFor(() => expect(writes(requests)).toHaveLength(1)); expect(JSON.parse(writes(requests)[0].init!.body as string).duties).toEqual(['PROFESSIONAL']);
});

it('shows a failed task read as failure, not an empty inbox, without hiding notifications', async () => {
  let failed = true;
  const requests = stub({ intercept: ({ path }) => failed && path.startsWith('/api/v1/tasks/closure?') ? json({}, 503) : undefined }); render(scene());
  const region = screen.getByRole('region', { name: '关闭职责待办' }); await within(region).findByText('加载失败，请重试');
  expect(within(region).queryByText('暂无关闭职责待办')).not.toBeInTheDocument(); expect(await screen.findByText(notice.subject)).toBeInTheDocument();
  failed = false; fireEvent.click(visibleButton(region, '刷新职责待办'));
  await within(region).findByRole('button', { name: '审核关闭职责' }); expect(requests.filter(item => item.path.startsWith('/api/v1/notifications/closure?'))).toHaveLength(1);
});

it('does not interpret one recorded duty as approval of the entire pending round', async () => {
  stub({ intercept: ({ path }) => path.endsWith('/decide') ? json({ ...round, version: 8, status: 'PENDING' }) : undefined }); render(scene());
  submit(await fillReview()); await screen.findByText('本次职责已记录；本轮待处理。'); expect(screen.queryByText('本轮已通过。')).not.toBeInTheDocument();
  expect(screen.getByText(/审核回执：/)).toHaveTextContent(round.id);
});

it('isolates a late old-session 401 and never logs out the newly bound session', async () => {
  let release!: (value: Response) => void;
  stub({ intercept: ({ path }) => path.endsWith('/rounds') ? new Promise<Response>(resolve => { release = resolve; }) : undefined }); render(scene());
  await openReview(); await waitFor(() => expect(release).toBeDefined());
  act(() => useWorkTabsStore.getState().bindSession('INTERNAL:org:new-actor'));
  await act(async () => { release(json({ code: 'AUTH_SESSION_REQUIRED' }, 401)); });
  expect(useWorkTabsStore.getState().sessionScope).toBe('INTERNAL:org:new-actor'); expect(screen.queryByText('LOGIN')).not.toBeInTheDocument();
});

it('aborts an in-flight write and does not show its late receipt in a new session', async () => {
  let release!: (value: Response) => void;
  const requests = stub({ intercept: ({ path }) => path.endsWith('/decide') ? new Promise<Response>(resolve => { release = resolve; }) : undefined }); render(scene());
  submit(await fillReview()); await waitFor(() => expect(writes(requests)).toHaveLength(1));
  act(() => useWorkTabsStore.getState().bindSession('INTERNAL:org:new-actor'));
  expect(writes(requests)[0].init!.signal!.aborted).toBe(true);
  await act(async () => { release(json({ ...round, version: 8, status: 'APPROVED' })); });
  expect(screen.queryByText(/审核回执：/)).not.toBeInTheDocument();
});

it('does not submit blank comments and focuses the editable comment field', async () => {
  const requests = stub(); render(scene()); const dialog = await openReview(); await within(dialog).findByText('第 2 轮');
  expect(visibleButton(dialog, '提交审核')).toBeDisabled();
  fireEvent.change(within(dialog).getByLabelText('审核意见'), { target: { value: '   ' } }); submit(dialog); expect(writes(requests)).toHaveLength(0);
  await waitFor(() => expect(within(dialog).getByLabelText('审核意见')).toHaveFocus());
});

it('paginates notifications independently and confines wide tables to their own scroll containers', async () => {
  const requests = stub({ noticeTotal: 26 }); render(scene()); await screen.findByText(notice.subject);
  const region = screen.getByRole('region', { name: '关闭职责通知' }); fireEvent.click(within(region).getByTitle('2'));
  await waitFor(() => expect(requests.some(item => item.path === '/api/v1/notifications/closure?pageSize=25&offset=25')).toBe(true));
  expect(requests.filter(item => item.path.startsWith('/api/v1/tasks/closure?'))).toHaveLength(1);
  expect(region.querySelector('.ant-table-content')).toHaveStyle({ overflowX: 'auto' });
});

it('aborts old route reads and ignores late errors after a query-scope transition', async () => {
  let release!: (value: Response) => void;
  let pending = true;
  const requests = stub({ intercept: ({ path }) => path.startsWith('/api/v1/tasks/closure?') && pending ? new Promise<Response>(resolve => { release = resolve; }) : undefined });
  const router = createMemoryRouter([{ path: '/app/my-tasks', element: <UnsavedChangesProvider><ClosureTaskInbox /></UnsavedChangesProvider> }], { initialEntries: ['/app/my-tasks'] });
  render(<ConfigProvider theme={{ token: { motion: false } }}><LanguageProvider><RouterProvider router={router} /></LanguageProvider></ConfigProvider>);
  await waitFor(() => expect(release).toBeDefined()); const original = requests.find(item => item.path.startsWith('/api/v1/tasks/closure?'))!;
  pending = false; await act(async () => { await router.navigate('/app/my-tasks?context=other'); });
  expect(original.init!.signal!.aborted).toBe(true); await screen.findByRole('button', { name: '审核关闭职责' });
  await act(async () => { release(json({ code: 'AUTH_SESSION_REQUIRED' }, 401)); });
  expect(router.state.location.search).toBe('?context=other'); expect(useWorkTabsStore.getState().sessionScope).toBe('INTERNAL:org:actor');
});

it('protects refresh and route navigation while a write is pending, then completes session-ending 401', async () => {
  let release!: (value: Response) => void;
  stub({ intercept: ({ path }) => path.endsWith('/decide') ? new Promise<Response>(resolve => { release = resolve; }) : undefined });
  const router = createMemoryRouter([{ path: '*', element: <UnsavedChangesProvider><Routes><Route path="/app/my-tasks" element={<ClosureTaskInbox />} /><Route path="/login" element={<p>LOGIN</p>} /><Route path="/other" element={<p>OTHER</p>} /></Routes></UnsavedChangesProvider> }], { initialEntries: ['/app/my-tasks'] });
  render(<ConfigProvider theme={{ token: { motion: false } }}><LanguageProvider><RouterProvider router={router} /></LanguageProvider></ConfigProvider>);
  const dialog = await fillReview(); submit(dialog); await waitFor(() => expect(release).toBeDefined());
  const unload = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(unload); expect(unload.defaultPrevented).toBe(true);
  await act(async () => { await router.navigate('/other'); }); expect(router.state.location.pathname).toBe('/app/my-tasks');
  expect(visibleButton(dialog, '关闭审核')).toBeDisabled();
  await act(async () => { release(json({ code: 'AUTH_SESSION_REQUIRED' }, 401)); });
  await screen.findByText('LOGIN'); expect(router.state.location.pathname).toBe('/login'); expect(useWorkTabsStore.getState().sessionScope).toBeUndefined();
});

it('uses local English copy for duty and status enums without changing shared translations', async () => {
  localStorage.setItem('qms:locale:v1', 'en-US'); stub(); render(scene());
  const dialog = await (async () => { fireEvent.click(await screen.findByRole('button', { name: 'Review closure duty' })); return screen.findByRole('dialog', { name: 'Closure duty review' }); })();
  await within(dialog).findByText('Round 2'); fireEvent.click(within(dialog).getByText('Round and duty history'));
  expect(within(dialog).getAllByText(/Section manager/).length).toBeGreaterThan(0); expect(within(dialog).getAllByText(/Pending/).length).toBeGreaterThan(0);
  expect(within(dialog).queryByText('SECTION_MANAGER')).not.toBeInTheDocument(); expect(within(dialog).queryByText('PENDING')).not.toBeInTheDocument();
});

it('releases POST busy before completing 401 navigation past a parent dirty draft', async () => {
  let release!: (value: Response) => void;
  const requests = stub({ intercept: ({ path }) => path.endsWith('/decide') ? new Promise<Response>(resolve => { release = resolve; }) : undefined });
  function ParentDraft() { useUnsavedChanges(true); return <ClosureTaskInbox />; }
  const router = createMemoryRouter([{ path: '*', element: <UnsavedChangesProvider><Routes>
    <Route path="/app/my-tasks" element={<ParentDraft />} /><Route path="/login" element={<p>LOGIN</p>} /><Route path="/other" element={<p>OTHER</p>} />
  </Routes></UnsavedChangesProvider> }], { initialEntries: ['/app/my-tasks'] });
  render(<ConfigProvider theme={{ token: { motion: false } }}><LanguageProvider><RouterProvider router={router} /></LanguageProvider></ConfigProvider>);
  const dialog = await fillReview(); submit(dialog);
  await waitFor(() => expect(writes(requests)).toHaveLength(1));
  expect(visibleButton(dialog, '关闭审核')).toBeDisabled();
  await act(async () => { await router.navigate('/other'); });
  expect(router.state.location.pathname).toBe('/app/my-tasks');
  await act(async () => { release(json({ code: 'AUTH_SESSION_REQUIRED' }, 401)); });
  await screen.findByText('LOGIN');
  expect(router.state.location.pathname).toBe('/login');
  expect(useWorkTabsStore.getState().sessionScope).toBeUndefined();
  expect(screen.queryByText('当前草稿尚未保存，继续将放弃修改。')).not.toBeInTheDocument();
  expect(writes(requests)).toHaveLength(1);
});

it.each(['GET', 'history', 'decide'] as const)('preserves safe 403 trace from %s while hiding old details and preventing further writes', async scope => {
  let denied = false;
  const traceId = `trace-closure-${scope}-403`;
  const requests = stub({ intercept: ({ path }) => {
    const matches = scope === 'GET' ? path.startsWith('/api/v1/tasks/closure?') : path.endsWith(scope === 'history' ? '/rounds' : '/decide');
    if (denied && matches) return json({ code: 'FEATURE_PERMISSION_DENIED', message: 'PRIVATE_MESSAGE_FROM_SERVER', stack: 'RAW_STACK_FROM_SERVER', traceId }, 403);
  } });
  render(scene());
  await screen.findByText(notice.subject);
  if (scope === 'GET') {
    // First retain a successful receipt, then lose read permission on refresh.
    submit(await fillReview()); await screen.findByText(/审核回执：/);
    await waitFor(() => expect(visibleButton(document.body, '刷新职责待办')).toBeEnabled());
    denied = true; fireEvent.click(visibleButton(document.body, '刷新职责待办'));
  } else {
    const dialog = await fillReview();
    denied = true;
    if (scope === 'history') fireEvent.click(visibleButton(dialog, '刷新审核基线'));
    else submit(dialog);
  }
  expect((await screen.findAllByText(traceId)).some(element => element.tagName === 'CODE')).toBe(true);
  expect(screen.getAllByText('无权审核关闭职责').length).toBeGreaterThan(0);
  expect(screen.queryByText(/PRIVATE_MESSAGE_FROM_SERVER|RAW_STACK_FROM_SERVER/)).not.toBeInTheDocument();
  expect(screen.queryByText('Q-001')).not.toBeInTheDocument();
  expect(screen.queryByText(notice.subject)).not.toBeInTheDocument();
  expect(screen.queryByText(/审核回执：/)).not.toBeInTheDocument();
  expect(screen.queryByText('第 2 轮')).not.toBeInTheDocument();
  expect(screen.queryByRole('link', { name: '核对问题工作空间' })).not.toBeInTheDocument();
  const count = writes(requests).length;
  if (scope !== 'GET') {
    const dialog = screen.getByRole('dialog', { name: '关闭职责审核' });
    expect(within(dialog).getByLabelText('审核意见')).toBeDisabled();
    expect(visibleButton(dialog, '刷新审核基线')).toBeDisabled();
    expect(visibleButton(dialog, '提交审核')).toBeDisabled();
    submit(dialog);
  }
  expect(writes(requests)).toHaveLength(count);
});

it.each(['clean', 'keep', 'discard'] as const)('handles real Escape with %s through the existing draft guard', async action => {
  const requests = stub(); render(scene());
  const trigger = await screen.findByRole('button', { name: '审核关闭职责' });
  const dialog = action === 'clean' ? await openReview() : await fillReview();
  await within(dialog).findByText('第 2 轮');
  fireEvent.keyDown(dialog, { key: 'Escape', keyCode: 27 });
  if (action !== 'clean') {
    const guard = (await screen.findByText('当前草稿尚未保存，继续将放弃修改。')).closest('[role="dialog"]') as HTMLElement;
    if (action === 'keep') {
      fireEvent.click(within(guard).getByRole('button', { name: '继续编辑' }));
      await waitFor(() => expect(guard).not.toBeVisible());
      expect(dialog).toBeVisible();
      expect(within(dialog).getByLabelText('审核意见')).toHaveValue('核对完成');
      expect(writes(requests)).toHaveLength(0);
      return;
    }
    fireEvent.click(within(guard).getByRole('button', { name: '放弃修改并关闭' }));
  }
  await waitFor(() => expect(screen.queryByRole('dialog', { name: '关闭职责审核' })).not.toBeInTheDocument());
  await waitFor(() => expect(trigger).toHaveFocus());
  expect(requests.find(item => item.path.endsWith('/rounds'))!.init!.signal!.aborted).toBe(true);
  expect(writes(requests)).toHaveLength(0);
});

it.each(['csrf', 'post', 'unknown'] as const)('ignores real Escape while %s keeps the review locked', async stage => {
  let release!: (value: Response) => void;
  const requests = stub({ intercept: ({ path }) => {
    if (stage === 'unknown' && path.endsWith('/decide')) return json({}, 503);
    if (path === (stage === 'csrf' ? '/api/v1/auth/csrf' : '/api/v1/workflow-closure/rounds/round-1/decide')) return new Promise<Response>(resolve => { release = resolve; });
  } });
  render(scene()); const dialog = await fillReview(); submit(dialog);
  if (stage === 'unknown') await within(dialog).findByText(/审核结果尚未确认/);
  else await waitFor(() => expect(release).toBeDefined());
  fireEvent.keyDown(dialog, { key: 'Escape', keyCode: 27 });
  expect(screen.getByRole('dialog', { name: '关闭职责审核' })).toBe(dialog);
  expect(within(dialog).getByLabelText('审核意见')).toHaveValue('核对完成');
  expect(visibleButton(dialog, '关闭审核')).toBeDisabled();
  expect(screen.queryByText('当前草稿尚未保存，继续将放弃修改。')).not.toBeInTheDocument();
  expect(writes(requests)).toHaveLength(stage === 'csrf' ? 0 : 1);
  if (stage !== 'unknown') {
    await act(async () => { release(json({ code: 'WORKFLOW_CLOSURE_CONFLICT' }, 409)); });
    await waitFor(() => expect(visibleButton(dialog, '关闭审核')).toBeEnabled());
    expect(writes(requests)).toHaveLength(stage === 'csrf' ? 0 : 1);
  }
});

it.each(['route', 'unmount'] as const)('does not dispatch an old write when %s invalidates the inbox while CSRF is pending', async via => {
  let release!: (value: Response) => void;
  const requests = stub({ intercept: ({ path }) => path === '/api/v1/auth/csrf' ? new Promise<Response>(resolve => { release = resolve; }) : undefined });
  // Deliberately omit the leave guard here: exercise actual route-scope disposal, not a blocked navigation.
  const router = createMemoryRouter([{ path: '/app/my-tasks', element: <ClosureTaskInbox /> }], { initialEntries: ['/app/my-tasks'] });
  const view = render(<ConfigProvider theme={{ token: { motion: false } }}><LanguageProvider><RouterProvider router={router} /></LanguageProvider></ConfigProvider>);
  submit(await fillReview()); await waitFor(() => expect(release).toBeDefined());
  const csrf = requests.find(item => item.path === '/api/v1/auth/csrf')!;
  expect(csrf.init!.signal!.aborted).toBe(false); expect(writes(requests)).toHaveLength(0);
  if (via === 'route') await act(async () => { await router.navigate('/app/my-tasks?context=other'); });
  else view.unmount();
  expect(csrf.init!.signal!.aborted).toBe(true);
  await act(async () => { release(json({ csrfToken: 'late-old-scope-token' })); });
  expect(writes(requests)).toHaveLength(0);
  expect(screen.queryByDisplayValue('核对完成')).not.toBeInTheDocument();
  expect(screen.queryByText(/审核回执：|审核结果尚未确认/)).not.toBeInTheDocument();
  expect(useWorkTabsStore.getState().sessionScope).toBe('INTERNAL:org:actor');
  if (via === 'route') {
    expect(router.state.location.search).toBe('?context=other');
    expect(await screen.findByRole('button', { name: '审核关闭职责' })).toBeEnabled();
  }
});
