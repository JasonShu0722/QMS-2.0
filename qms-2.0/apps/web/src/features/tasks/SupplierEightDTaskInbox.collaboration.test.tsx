import { StrictMode } from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { components } from '@qms/contracts';
import { LanguageProvider } from '../../i18n/Language';
import { useWorkTabsStore } from '../../work-tabs/workTabsStore';
import { SupplierEightDTaskInbox } from './SupplierEightDTaskInbox';

type Task = components['schemas']['SupplierSourceCollaborationTaskDto'];
type Page = components['schemas']['SupplierSourceCollaborationPageDto'];
const endpoint = '/api/v1/supplier-quality/source-collaboration/tasks';
const task: Task = {
  id: 'collaboration-1', kind: 'SOURCE_SQE_COLLABORATION', title: '真实来源协作', sourceKind: 'PROCESS_LEDGER',
  sourceId: 'source-id', materialItemId: 'material-item', verification: 'CONFIRMED_DEFECT', progress: '实际进展', result: '实际结果',
  link: '/app/process-quality?organizationId=actual-org&defectId=actual-defect',
};
const page = (items: Task[] = [], scannedCount = 0, nextCursor: string | null = null): Page => ({ items, scannedCount, nextCursor });
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
type Request = { path: string; init?: RequestInit };
function api(intercept?: (request: Request) => Response | Promise<Response> | undefined) {
  const requests: Request[] = [];
  vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const request = { path: String(input), init }; requests.push(request);
    return Promise.resolve(intercept?.(request) ?? json(request.path.startsWith(endpoint) ? page([task], 1) : {
      items: request.path.includes('/notifications') ? [{
        id: 'notice', supplierProblemId: 'supplier-case', kind: 'CLOSURE_REMINDER', subject: '正式通知', body: '通知正文',
        channel: 'IN_APP', status: 'DELIVERED', deliveredAt: '2026-10-28T08:00:00Z',
      }] : [], examined: 0, nextCursor: null,
    }));
  }));
  return requests;
}
function Host({ portal = false }: { portal?: boolean }) {
  const navigate = useNavigate();
  return <><button onClick={() => navigate('/inbox?organizationId=new')}>换组织</button><SupplierEightDTaskInbox portal={portal} /></>;
}
function mount(portal = false, strict = false) {
  const content = <MemoryRouter initialEntries={['/inbox?organizationId=old']}><LanguageProvider><Host portal={portal} /></LanguageProvider></MemoryRouter>;
  return render(strict ? <StrictMode>{content}</StrictMode> : content);
}
beforeEach(() => { useWorkTabsStore.getState().reset(); useWorkTabsStore.getState().bindSession('INTERNAL:org:user'); });
afterEach(() => { vi.unstubAllGlobals(); useWorkTabsStore.getState().reset(); sessionStorage.clear(); });

it('renders three real source projections and uses the returned links verbatim, including the selected process defect for new product', async () => {
  const items: Task[] = [task,
    { ...task, id: 'customer', title: '客户来源协作', sourceKind: 'CUSTOMER_LEDGER', sourceId: 'complaint-source', link: '/app/customer-quality?organizationId=actual-org&complaintId=real-complaint' },
    { ...task, id: 'new-product', title: '新品来源协作', sourceKind: 'NEW_PRODUCT_SELECTION', sourceId: 'selection-not-defect', link: '/app/process-quality?organizationId=actual-org&defectId=underlying-defect', verification: null, progress: null, result: null },
  ];
  const requests = api(({ path }) => path.startsWith(endpoint) ? json(page(items, 8)) : undefined);
  mount();
  const section = await screen.findByRole('region', { name: 'SQE来源协作跟进' });
  await within(section).findByText('真实来源协作');
  expect(within(section).getAllByRole('link', { name: '查看来源' }).map(link => link.getAttribute('href'))).toEqual(items.map(item => item.link));
  for (const text of ['过程来源', '客户来源', '新品来源', 'selection-not-defect', 'material-item', '实际进展', '实际结果', '不良属实']) {
    expect(within(section).getAllByText(text).length).toBeGreaterThan(0);
  }
  expect(within(section).getByText('当前已加载协作：3')).toBeVisible();
  expect(within(section).getByText('协作已扫描问题：8')).toBeVisible();
  expect(within(section).queryByText(/总数/)).not.toBeInTheDocument();
  const query = new URL(requests.find(request => request.path.startsWith(endpoint))!.path, 'https://qms.test').searchParams;
  expect(Object.fromEntries(query)).toEqual({ organizationId: 'old', scanLimit: '25' });
  expect(requests.every(({ init }) => !init?.method || init.method === 'GET')).toBe(true);
  expect(within(section).getAllByRole('button').map(button => button.textContent).filter(Boolean)).toEqual(['刷新来源协作', '列设置']);
  expect(within(section).getAllByRole('button', { name: /^移动列 / })).toHaveLength(6);
  expect(within(section).getByRole('group', { name: 'SQE来源协作表格' })).toHaveAttribute('tabindex', '0');
  expect(within(section).getByRole('group', { name: 'SQE来源协作表格' })).toHaveStyle({ overflowX: 'auto', maxWidth: '100%' });
});

it('does not mount or request source collaboration in the supplier portal', async () => {
  useWorkTabsStore.getState().bindSession('SUPPLIER:vendor:user');
  const requests = api(); mount(true);
  await screen.findByText('正式通知');
  expect(screen.queryByRole('region', { name: 'SQE来源协作跟进' })).not.toBeInTheDocument();
  expect(requests).toHaveLength(2);
  expect(requests.every(({ path }) => path.startsWith('/api/v1/supplier-portal/eight-d/') && !path.includes('organizationId'))).toBe(true);
});

it.each([undefined, 'SUPPLIER:vendor:user'])('does not request any internal projection for invalid principal %s', async session => {
  useWorkTabsStore.getState().reset(); if (session) useWorkTabsStore.getState().bindSession(session);
  const requests = api(); mount();
  expect(await screen.findByRole('alert')).toBeVisible(); expect(requests).toHaveLength(0);
});

it('continues scanning empty pages, sums scannedCount, deduplicates task identity and restarts on refresh', async () => {
  const cursor = 'opaque/+?';
  const requests = api(({ path }) => {
    if (!path.startsWith(endpoint)) return undefined;
    const after = new URL(path, 'https://qms.test').searchParams.get('cursor');
    return json(after === cursor ? page([task], 3, 'next') : after === 'next' ? page([task, { ...task, id: 'second-material' }], 2) : page([], 25, cursor));
  });
  mount(); await screen.findByText('暂无SQE来源协作跟进');
  fireEvent.click(screen.getByRole('button', { name: '加载更多来源协作' }));
  await screen.findByText('当前已加载协作：1');
  fireEvent.click(screen.getByRole('button', { name: '加载更多来源协作' }));
  await screen.findByText('当前已加载协作：2');
  expect(screen.getByText('协作已扫描问题：30')).toBeVisible();
  expect(screen.queryByRole('button', { name: '加载更多来源协作' })).not.toBeInTheDocument();
  expect(requests.some(({ path }) => new URL(path, 'https://qms.test').searchParams.get('cursor') === cursor)).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: '刷新来源协作' }));
  await screen.findByText('暂无SQE来源协作跟进');
  expect(screen.getByText('协作已扫描问题：25')).toBeVisible();
});

it('shows loading and safe errors, then retries the same failed cursor without losing existing rows', async () => {
  let complete!: (response: Response) => void;
  let fail = true;
  const requests = api(({ path }) => path.startsWith(endpoint) ? path.includes('cursor=')
    ? fail ? new Promise<Response>(resolve => { complete = resolve; }) : json(page([{ ...task, id: 'second', title: '下一页协作' }], 2))
    : json(page([task], 25, 'next')) : undefined);
  mount(); await screen.findByText('真实来源协作');
  fireEvent.click(screen.getByRole('button', { name: '加载更多来源协作' }));
  expect(screen.getByLabelText('正在加载来源协作')).toBeVisible();
  await act(async () => complete(json({ message: 'private SQL', traceId: 'collaboration-trace' }, 500)));
  await screen.findByText('来源协作加载失败，请重试');
  expect(screen.queryByText('private SQL')).not.toBeInTheDocument();
  expect(screen.getByText('collaboration-trace')).toBeVisible();
  expect(screen.getByText('真实来源协作')).toBeVisible();
  fail = false; fireEvent.click(screen.getByRole('button', { name: '重试来源协作' }));
  await screen.findByText('下一页协作');
  expect(screen.getByText('协作已扫描问题：27')).toBeVisible();
  expect(requests.filter(({ path }) => path.startsWith(endpoint) && path.includes('cursor=next'))).toHaveLength(2);
});

it.each([401, 403])('clears all projections after current collaboration %s and ignores a late sibling success', async status => {
  let late!: (response: Response) => void;
  let mode = 'initial';
  const requests = api(({ path }) => {
    if (mode === 'late' && path.includes('/notifications')) return new Promise<Response>(resolve => { late = resolve; });
    if (mode === 'denied' && path.startsWith(endpoint)) return json({ code: 'FEATURE_PERMISSION_DENIED' }, status);
    return undefined;
  });
  mount(); await screen.findByText('真实来源协作'); await screen.findByText('正式通知');
  mode = 'late'; fireEvent.click(screen.getByRole('button', { name: '刷新8D通知' }));
  mode = 'denied'; fireEvent.click(screen.getByRole('button', { name: '刷新来源协作' }));
  await screen.findByText('当前会话失效或无权访问，敏感内容已清除。');
  expect(requests.every(({ init }) => init?.signal?.aborted)).toBe(true);
  await act(async () => late(json({ items: [], examined: 0, nextCursor: null })));
  expect(screen.queryByText('真实来源协作')).not.toBeInTheDocument();
  expect(screen.queryByText('正式通知')).not.toBeInTheDocument();
  mode = 'initial'; fireEvent.click(screen.getByRole('button', { name: '重新核对访问权限' }));
  await screen.findByText('真实来源协作');
  expect(requests.filter(({ path }) => path.startsWith(endpoint))).toHaveLength(3);
});

it.each([401, 403])('clears loaded collaboration after a sibling notification %s', async status => {
  let denied = false;
  api(({ path }) => denied && path.includes('/notifications') ? json({}, status) : undefined);
  mount(); await screen.findByText('真实来源协作'); await screen.findByText('正式通知');
  denied = true; fireEvent.click(screen.getByRole('button', { name: '刷新8D通知' }));
  await screen.findByText('当前会话失效或无权访问，敏感内容已清除。');
  expect(screen.queryByText('真实来源协作')).not.toBeInTheDocument();
});

it.each(['organization', 'session'])('aborts previous %s and ignores both late success and late denial from that scope', async scope => {
  const old: Array<(response: Response) => void> = [];
  let delayed = false;
  const requests = api(({ path }) => delayed && path.startsWith(endpoint) ? new Promise<Response>(resolve => { old.push(resolve); }) : undefined);
  mount(); await screen.findByText('真实来源协作');
  delayed = true; fireEvent.click(screen.getByRole('button', { name: '刷新来源协作' }));
  await waitFor(() => expect(old).toHaveLength(1));
  const previous = requests.filter(({ path }) => path.startsWith(endpoint));
  delayed = false;
  if (scope === 'session') act(() => useWorkTabsStore.getState().bindSession('INTERNAL:org:new-user'));
  else fireEvent.click(screen.getByRole('button', { name: '换组织' }));
  await screen.findByText('真实来源协作');
  expect(previous.every(({ init }) => init?.signal?.aborted)).toBe(true);
  await act(async () => old[0](json(page([{ ...task, title: '旧范围秘密' }], 99))));
  expect(screen.queryByText('旧范围秘密')).not.toBeInTheDocument();
  delayed = true; fireEvent.click(screen.getByRole('button', { name: '刷新来源协作' }));
  await waitFor(() => expect(old).toHaveLength(2));
  delayed = false;
  act(() => useWorkTabsStore.getState().bindSession('INTERNAL:org:third-user'));
  await screen.findByText('真实来源协作');
  await act(async () => old[1](json({}, 403)));
  expect(screen.getByText('真实来源协作')).toBeVisible();
  expect(screen.queryByText('当前会话失效或无权访问，敏感内容已清除。')).not.toBeInTheDocument();
});

it('survives StrictMode and aborts all collaboration reads on unmount', async () => {
  const requests = api(); const view = mount(false, true);
  await screen.findByText('真实来源协作'); view.unmount();
  expect(requests.some(({ path }) => path.startsWith(endpoint))).toBe(true);
  expect(requests.every(({ init }) => init?.signal?.aborted)).toBe(true);
});
