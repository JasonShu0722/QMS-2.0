import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { components } from '@qms/contracts';
import { LanguageProvider } from '../../i18n/Language';
import { useWorkTabsStore } from '../../work-tabs/workTabsStore';
import { SupplierEightDTaskInbox } from './SupplierEightDTaskInbox';

type Task = components['schemas']['SupplierEightDTaskDto'];
const task: Task = {
  id: 'duty-1', supplierProblemId: 'source-case', problemId: 'index-not-source', reportNumber: 'SQ-34',
  workflowVersionId: 'version', userId: 'user', kind: 'CLOSURE', stage: 'CLOSURE', status: 'PENDING', duty: 'SECTION_MANAGER',
  rowVersion: 1, contentVersion: 2, instanceVersion: 3, dueAt: null, overdue: false,
  roundId: 'round', roundVersion: 1, requestId: null, requestVersion: null, requestedDueAt: null,
  actions: ['OPEN_REPORT', 'DECIDE_CLOSURE'],
};
const notice: components['schemas']['SupplierEightDNotificationDto'] = {
  id: 'notice', supplierProblemId: 'source-case', problemId: 'index-not-source', kind: 'CLOSURE_REMINDER',
  subject: '真实关闭提醒', body: '供应商正文', channel: 'IN_APP', status: 'DELIVERED', deliveredAt: '2026-10-28T08:00:00Z',
};
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
const page = (items: unknown[] = [], examined = 1, nextCursor: string | null = null) => ({ items, examined, nextCursor });
type Request = { path: string; init?: RequestInit };
function api(intercept?: (request: Request) => Response | Promise<Response> | undefined) {
  const requests: Request[] = [];
  vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const request = { path: String(input), init }; requests.push(request);
    if (request.path.includes('/source-collaboration/')) return Promise.resolve(json({ items: [], scannedCount: 0, nextCursor: null }));
    return Promise.resolve(intercept?.(request) ?? json(page(request.path.includes('/notifications') ? [notice] : [task])));
  }));
  return requests;
}
function mount(portal = false, search = '') {
  return render(<MemoryRouter initialEntries={[`/inbox${search}`]}><LanguageProvider><SupplierEightDTaskInbox portal={portal} /></LanguageProvider></MemoryRouter>);
}
beforeEach(() => { useWorkTabsStore.getState().reset(); useWorkTabsStore.getState().bindSession('INTERNAL:org:user'); });
afterEach(() => { vi.unstubAllGlobals(); useWorkTabsStore.getState().reset(); sessionStorage.clear(); });

it('uses generated duties and source-case links, preserves two duties on one problem and never writes', async () => {
  const requests = api(({ path }) => path.includes('/eight-d/tasks') ? json(page([task, { ...task, id: 'duty-2', duty: 'MINISTER' }])) : undefined);
  mount(false, '?organizationId=selected');
  const manager = await screen.findByText('科室经理');
  const tasks = within(manager.closest('section')!);
  expect(manager).toBeVisible();
  expect(tasks.getByText('部长')).toBeVisible();
  expect(tasks.queryByText(/同一问题的多份职责/)).not.toBeInTheDocument();
  expect(tasks.getAllByRole('link', { name: '审核关闭' })).toHaveLength(2);
  for (const link of screen.getAllByRole('link')) expect(link.getAttribute('href')).toBe('/app/supplier-quality/eight-d/source-case');
  expect(screen.getByText('当前已加载任务：2')).toBeVisible();
  expect(screen.queryByText(/总数/)).not.toBeInTheDocument();
  expect(requests.every(({ path, init }) => path.includes('organizationId=selected') && (!init?.method || init.method === 'GET'))).toBe(true);
});

it('portal uses only portal endpoints and omits an internal organization query', async () => {
  useWorkTabsStore.getState().bindSession('SUPPLIER:vendor:user');
  const requests = api(); mount(true, '?organizationId=internal-owner');
  expect(await screen.findByRole('link', { name: '审核关闭' })).toHaveAttribute('href', '/supplier/corrections/problems/source-case');
  expect(await screen.findByRole('link', { name: '查看关联8D' })).toHaveAttribute('href', '/supplier/corrections/problems/source-case');
  expect(requests).toHaveLength(2);
  expect(requests.every(({ path }) => path.startsWith('/api/v1/supplier-portal/eight-d/') && !path.includes('organizationId'))).toBe(true);
  expect(screen.getByText(/同一问题的多份职责/)).toBeVisible();
});

it.each([undefined, 'SUPPLIER:vendor:user'])('does not request internal data without a matching real principal (%s)', async scope => {
  useWorkTabsStore.getState().reset(); if (scope) useWorkTabsStore.getState().bindSession(scope);
  const requests = api(); mount();
  expect(await screen.findByRole('alert')).toBeVisible(); expect(requests).toHaveLength(0);
});

it('renders all actual actions as workspace links and keeps extension decisions out of this inbox', async () => {
  api(({ path }) => path.includes('/eight-d/tasks') ? json(page([
    { ...task, kind: 'HANDLING', duty: null, stage: 'ANALYSIS', dueAt: '2026-10-27T08:00:00Z', overdue: true, actions: ['ANALYSIS_COMPLETE', 'SUBMIT'] },
    { ...task, id: 'extension', kind: 'EXTENSION', duty: 'SQE', status: 'QUALITY_PENDING', requestId: 'extension', requestedDueAt: '2026-10-30T08:00:00Z', actions: ['DECIDE_EXTENSION'] },
  ])) : undefined);
  mount();
  for (const label of ['确认分析完成', '完整提交8D', '审核延期']) expect(await screen.findByRole('link', { name: label })).toHaveAttribute('href', '/app/supplier-quality/eight-d/source-case');
  expect(screen.getByText('已逾期')).toBeVisible();
  expect(screen.getByText('SQE')).toBeVisible(); expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

it('loads more by opaque cursor even after an empty scan, appends duties and resets on refresh', async () => {
  const requests = api(({ path }) => {
    if (!path.includes('/eight-d/tasks')) return json(page());
    return json(path.includes('cursor=') ? page([task], 2) : page([], 25, 'opaque/+?'));
  });
  mount(); expect(await screen.findByText('暂无供应商8D待办')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: '加载更多8D待办' }));
  expect(await screen.findByText('SQ-34')).toBeVisible();
  expect(requests.some(({ path }) => new URL(path, 'https://qms.test').searchParams.get('cursor') === 'opaque/+?')).toBe(true);
  expect(screen.getByText('已扫描问题：27')).toBeVisible();
  expect(screen.queryByRole('button', { name: '加载更多8D待办' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '刷新8D待办' }));
  expect(await screen.findByText('暂无供应商8D待办')).toBeVisible();
  expect(screen.getByText('已扫描问题：25')).toBeVisible();
});

it('paginates notifications independently and labels only delivered IN_APP notifications as delivered', async () => {
  const requests = api(({ path }) => path.includes('/notifications') ? json(page(path.includes('cursor=') ? [{ ...notice, id: 'second', subject: '第二条提醒' }] : [notice, { ...notice, id: 'pending', subject: '不可假送达', status: 'PENDING' }, { ...notice, id: 'email', channel: 'EMAIL' }], 3, path.includes('cursor=') ? null : 'notice-cursor')) : undefined);
  mount(); expect(await screen.findByText('真实关闭提醒')).toBeVisible();
  expect(screen.getAllByText('已送达')).toHaveLength(1);
  expect(screen.queryByText('不可假送达')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '加载更多8D通知' }));
  expect(await screen.findByText('第二条提醒')).toBeVisible();
  expect(screen.getByText('真实关闭提醒')).toBeVisible();
  expect(requests.filter(({ path }) => path.includes('/eight-d/tasks'))).toHaveLength(1);
});

it('shows loading, safe error and retry without inventing empty results', async () => {
  let resolve!: (response: Response) => void;
  let first = true;
  api(({ path }) => path.includes('/eight-d/tasks') && first ? (first = false, new Promise<Response>(done => { resolve = done; })) : undefined);
  mount(); expect(screen.getByLabelText('正在加载8D待办')).toBeVisible();
  await act(async () => resolve(json({ message: 'private SQL failure' }, 500)));
  expect(await screen.findByText('8D待办加载失败，请重试')).toBeVisible();
  expect(screen.queryByText(/private SQL/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '重试8D待办' }));
  expect(await screen.findByText('SQ-34')).toBeVisible();
});

it.each([401, 403])('clears both projections on %s, aborts siblings and ignores late success', async status => {
  let resolve!: (response: Response) => void;
  let mode = 'initial';
  const requests = api(({ path }) => {
    if (mode === 'late' && path.includes('/notifications')) return new Promise<Response>(done => { resolve = done; });
    if (mode === 'denied' && path.includes('/eight-d/tasks')) return json({ code: 'FEATURE_PERMISSION_DENIED', message: 'private' }, status);
    return undefined;
  });
  mount(); await screen.findByText('SQ-34'); await screen.findByText('真实关闭提醒');
  mode = 'late'; fireEvent.click(screen.getByRole('button', { name: '刷新8D通知' }));
  mode = 'denied'; fireEvent.click(screen.getByRole('button', { name: '刷新8D待办' }));
  expect(await screen.findByText('当前会话失效或无权访问，敏感内容已清除。')).toBeVisible();
  expect(requests.at(-2)?.init?.signal?.aborted).toBe(true);
  await act(async () => resolve(json(page([notice]))));
  expect(screen.queryByText('真实关闭提醒')).not.toBeInTheDocument(); expect(screen.queryByText('SQ-34')).not.toBeInTheDocument();
});

it('aborts on session replacement and never fills a new principal with late rows', async () => {
  let resolve!: (response: Response) => void;
  const requests = api(({ path }) => path.includes('/eight-d/tasks') ? new Promise<Response>(done => { resolve = done; }) : undefined);
  mount(); const oldResolve = resolve;
  act(() => useWorkTabsStore.getState().bindSession('INTERNAL:org:other'));
  expect(requests[0].init?.signal?.aborted).toBe(true);
  await act(async () => oldResolve(json(page([task]))));
  expect(screen.queryByText('SQ-34')).not.toBeInTheDocument();
});

it('aborts on unmount, keeps horizontal scrolling keyboard reachable and local', async () => {
  const requests = api(); const view = mount();
  await screen.findByText('SQ-34');
  const section = screen.getByRole('region', { name: '供应商8D正式待办' });
  expect(within(section).getByRole('group', { name: '供应商8D待办表格' })).toHaveAttribute('tabindex', '0');
  expect(within(section).getByRole('group', { name: '供应商8D待办表格' })).toHaveStyle({ overflowX: 'auto' });
  expect(within(section).getByRole('link', { name: '审核关闭' })).not.toHaveAttribute('tabindex', '-1');
  view.unmount(); await waitFor(() => expect(requests.every(({ init }) => init?.signal?.aborted)).toBe(true));
});

it('aborts old query scope and ignores a late notification result', async () => {
  let resolve!: (response: Response) => void;
  const requests = api(({ path }) => path.includes('organizationId=old') && path.includes('/notifications') ? new Promise<Response>(done => { resolve = done; }) : undefined);
  function Host() { const navigate = useNavigate(); return <><button onClick={() => navigate('/inbox?organizationId=new')}>换组织</button><SupplierEightDTaskInbox /></>; }
  render(<MemoryRouter initialEntries={['/inbox?organizationId=old']}><LanguageProvider><Host /></LanguageProvider></MemoryRouter>);
  await screen.findByText('SQ-34');
  fireEvent.click(screen.getByRole('button', { name: '换组织' }));
  expect(requests.filter(({ path }) => path.includes('organizationId=old')).every(({ init }) => init?.signal?.aborted)).toBe(true);
  await act(async () => resolve(json(page([{ ...notice, subject: '旧组织秘密' }]))));
  expect(screen.queryByText('旧组织秘密')).not.toBeInTheDocument();
  expect(requests.filter(({ path }) => path.includes('organizationId=new'))).toHaveLength(3);
});

it('notification denial also clears already loaded tasks and permission retry starts both reads fresh', async () => {
  let denied = false;
  const requests = api(({ path }) => denied && path.includes('/notifications') ? json({ code: 'FEATURE_PERMISSION_DENIED', message: 'private' }, 403) : undefined);
  mount(); await screen.findByText('SQ-34'); await screen.findByText('真实关闭提醒');
  denied = true; fireEvent.click(screen.getByRole('button', { name: '刷新8D通知' }));
  await screen.findByText('当前会话失效或无权访问，敏感内容已清除。');
  expect(screen.queryByText('SQ-34')).not.toBeInTheDocument();
  denied = false; fireEvent.click(screen.getByRole('button', { name: '重新核对访问权限' }));
  expect(await screen.findByText('SQ-34')).toBeVisible();
  expect(await screen.findByText('真实关闭提醒')).toBeVisible();
  expect(requests.filter(({ path }) => path.includes('/eight-d/tasks'))).toHaveLength(2);
});

it('appends distinct task duties, deduplicates only task identity and retries the original failed cursor', async () => {
  let fail = true;
  const requests = api(({ path }) => {
    if (!path.includes('/eight-d/tasks')) return undefined;
    if (!path.includes('cursor=')) return json(page([task], 25, 'next'));
    if (fail) return json({ message: 'unavailable' }, 500);
    return json(page([task, { ...task, id: 'second-duty', duty: 'MINISTER' }], 4));
  });
  mount(); await screen.findByText('SQ-34');
  fireEvent.click(screen.getByRole('button', { name: '加载更多8D待办' }));
  await screen.findByText('8D待办加载失败，请重试');
  expect(screen.getByText('科室经理')).toBeVisible();
  fail = false; fireEvent.click(screen.getByRole('button', { name: '重试8D待办' }));
  expect(await screen.findByText('部长')).toBeVisible();
  expect(screen.getByText('当前已加载任务：2')).toBeVisible();
  expect(screen.getByText('已扫描问题：29')).toBeVisible();
  expect(requests.filter(({ path }) => path.includes('cursor=next'))).toHaveLength(2);
});
