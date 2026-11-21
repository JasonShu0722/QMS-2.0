import type { components } from '@qms/contracts';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import { LanguageProvider } from '../i18n/Language';
import { useWorkTabsStore } from '../work-tabs/workTabsStore';
import { Workbench } from './Workbench';
import { WorkbenchGraphDetail } from './WorkbenchGraphDetail';

const sceneRender = vi.hoisted(() => vi.fn());
vi.mock('./WorkbenchGraphScene', () => ({ WorkbenchGraphScene: (props: { fallback?: ReactNode }) => {
  sceneRender(props);
  return props.fallback ?? null;
} }));

const guide = { title: '操作手册', version: 'V1', role: '质量工程师', prerequisites: '启用规则', steps: ['确认映射'], result: '写入台账', exceptions: '检查规则' };
const statusDate = { statusUpdatedOn: '2026-11-21', statusVersion: 0 };
const graph: components['schemas']['WorkbenchGraphDto'] = {
  version: 'catalog-fixture',
  canEditStatus: false,
  nodes: [
    { id: 'ledger', name: '不良品台账', domain: '制程质量', entry: '/app/process-quality', aliases: ['台账'], status: 'live', ...statusDate, summary: '记录制程不良', plan: '完善汇总', guide },
    { id: 'ingestion', name: 'API入库衔接', domain: 'API 接入', entry: '/console/api-ingestion', aliases: ['接入', '台账查询'], status: 'development', ...statusDate, summary: '映射接收报文', plan: '配置直接入库', guide: { ...guide, role: '接入管理员', title: '规则操作手册' } },
    { id: 'operations', name: '工序主数据', domain: '主数据', entry: '/console/master-data/operations', aliases: [], status: 'development', ...statusDate, summary: '维护工序', plan: '补齐板块', guide },
    { id: 'scanning', name: '关键件条码校验', domain: '供应商质量', entry: '/app/site-scanning', aliases: [], status: 'development', ...statusDate, summary: '维护校验规则', plan: '完善校验', guide },
    { id: 'supplier-draft', name: '创建问题草稿', domain: '供应商质量', entry: '/app/supplier-quality/new', aliases: [], status: 'development', ...statusDate, summary: '创建内部草稿', plan: '维护供应商问题', guide },
    { id: 'supplier', name: '供应商资料', domain: '供应商门户', entry: '/supplier/documents', aliases: [], status: 'idea', ...statusDate, summary: '提交质量资料', plan: '待接入', guide },
    { id: 'record', name: '问题对象', domain: '问题中心', entry: '/app/problem-workspace/09c22e13-6d58-494a-8b44-672ed155c2f7', aliases: [], status: 'development', ...statusDate, summary: '问题详情', plan: '规划', guide },
  ],
  relations: [
    { id: 'ingestion-ledger', from: 'ingestion', to: 'ledger', name: '不良事实直接入库', kind: 'data', status: 'configuration', trigger: '已启用制程入库规则', content: '传递不良事实', result: '直接写入不良品台账', exceptions: '失败时检查入库回执' },
    { id: 'ingestion-operations', from: 'ingestion', to: 'operations', name: '工序自动入库', kind: 'data', status: 'unverified', trigger: '匹配工序规则', content: '工序编码', result: '新增工序', exceptions: '' },
    { id: 'operations-ledger', from: 'operations', to: 'ledger', name: '工序板块匹配', kind: 'configuration', status: 'effective', trigger: '保存台账', content: '工序板块', result: '记录板块', exceptions: '' },
  ],
};

function CurrentURL() {
  const { pathname, search } = useLocation();
  return <div data-testid="graph-url">{pathname}{search}</div>;
}

function mount(path = '/app/workbench', scope = 'INTERNAL:home:staff', permissions: string[] = [],
  respond?: (url: string, init?: RequestInit) => Response | Promise<Response> | undefined) {
  if (scope) useWorkTabsStore.getState().bindSession(scope);
  const fetchMock = vi.fn(async (request: RequestInfo | URL, init?: RequestInit) => {
    const url = String(request);
    const response = respond?.(url, init);
    if (response) return response;
    if (url === '/api/v1/workbench/graph') return Response.json(graph);
    if (url === '/api/v1/system/my-permissions') return Response.json({ organizationId: 'home', permissions });
    if (url === '/api/v1/admin/console/context' && scope.endsWith(':staff')) return Response.json({ code: 'FEATURE_PERMISSION_DENIED' }, { status: 403 });
    if (url === '/api/v1/admin/console/context') return Response.json({
      actor: { id: scope.split(':')[2], homeOrganization: { id: 'home' } },
      targetOrganization: { id: 'delegated' },
      modules: scope.endsWith(':admin') ? [{ key: 'api-ingestion', permissions: ['ingestion:read'] }] : [],
    });
    throw new Error(`Unexpected request: ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  const user = userEvent.setup();
  const view = render(<MemoryRouter initialEntries={[path]}><LanguageProvider><Workbench /><CurrentURL /></LanguageProvider></MemoryRouter>);
  return { user, fetchMock, ...view };
}

afterEach(() => {
  cleanup();
  useWorkTabsStore.getState().reset();
  localStorage.clear();
  sceneRender.mockClear();
  vi.unstubAllGlobals();
});

it('opens and requests the graph only when the signed-in internal user expands it', async () => {
  const { user, fetchMock } = mount();
  expect(fetchMock).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: '功能图谱' }));
  const browse = await screen.findByRole('button', { name: '浏览功能与联动' });
  expect(screen.queryByRole('region', { name: '图谱目录' })).not.toBeInTheDocument();
  expect(screen.queryByRole('list', { name: '搜索结果' })).not.toBeInTheDocument();
  await user.click(browse);
  expect(within(screen.getByRole('list', { name: '搜索结果' })).getByRole('button', { name: '不良品台账' })).toBeVisible();
  const legend = within(screen.getByRole('list', { name: '功能状态图例' }));
  expect(legend.getAllByRole('listitem').map(item => item.textContent)).toEqual(['构想中', '开发中', '已上线']);
  expect(fetchMock).toHaveBeenCalledExactlyOnceWith('/api/v1/workbench/graph', expect.objectContaining({ credentials: 'include', signal: expect.any(AbortSignal) }));
});

it.each(['', 'SUPPLIER:home:staff'])('does not mount or request the graph for scope %s', (scope) => {
  const { fetchMock } = mount('/app/workbench?graphNode=ledger', scope);
  expect(screen.queryByRole('button', { name: '功能图谱' })).not.toBeInTheDocument();
  expect(fetchMock).not.toHaveBeenCalled();
});

it('ranks exact aliases first and lets the keyboard navigate details and restore focus on reset without a renderer', async () => {
  const { user } = mount('/app/workbench', 'INTERNAL:home:staff', ['process-quality:defects:read']);
  await user.click(screen.getByRole('button', { name: '功能图谱' }));
  const search = await screen.findByRole('searchbox', { name: '搜索功能与联动' });
  expect(search).toHaveAttribute('placeholder', '搜索功能与联动');
  expect(screen.queryByText('搜索功能与联动')).not.toBeInTheDocument();
  expect(screen.getByRole('combobox', { name: '领域' })).toBeVisible();
  expect(screen.getByRole('combobox', { name: '功能状态' })).toBeVisible();
  expect(screen.getByRole('combobox', { name: '联动类型' })).toBeVisible();
  await user.type(search, '台账');
  const results = within(screen.getByRole('list', { name: '搜索结果' }));
  expect(results.getAllByRole('button')[0]).toHaveAccessibleName('不良品台账');
  await user.keyboard('{ArrowDown}{Enter}');
  const detail = within(screen.getByRole('complementary', { name: '不良品台账' }));
  expect(detail.getByRole('heading', { name: '不良品台账' })).toHaveFocus();
  expect(screen.queryByRole('list', { name: '搜索结果' })).not.toBeInTheDocument();
  expect(detail.getByText('记录制程不良')).toBeVisible();
  for (const redundant of [statusDate.statusUpdatedOn, '/app/process-quality', '功能策划', '操作手册', '适用版本']) {
    expect(detail.queryByText(redundant)).not.toBeInTheDocument();
  }
  const disclosure = detail.getByText('使用指南').closest('details')!;
  expect(disclosure).not.toHaveAttribute('open');
  const guideContent = within(disclosure);
  expect(guideContent.getByText(guide.role)).not.toBeVisible();
  expect(detail.getByText('确认映射')).not.toBeVisible();
  await user.click(detail.getByText('使用指南'));
  expect(guideContent.getByText('适用岗位')).toBeVisible();
  expect(guideContent.getByText(guide.role)).toBeVisible();
  expect(detail.getByText('确认映射')).toBeVisible();
  expect(detail.getByText('检查规则')).toBeVisible();
  expect(await detail.findByRole('link', { name: '打开入口' })).toHaveAttribute('href', '/app/process-quality');
  expect(screen.getByTestId('graph-url')).toHaveTextContent('/app/workbench?graphNode=ledger');
  await user.click(screen.getByRole('button', { name: '复位' }));
  expect(search).toHaveValue('');
  expect(search).toHaveFocus();
  expect(screen.queryByRole('list', { name: '搜索结果' })).not.toBeInTheDocument();
  expect(screen.getByTestId('graph-url')).toHaveTextContent(/^\/app\/workbench$/);
});

it('opens search results for filters alone and dismisses the popup without losing the filters', async () => {
  const { user } = mount('/app/workbench?graphNode=ledger');
  const search = await screen.findByRole('searchbox', { name: '搜索功能与联动' });
  const filter = screen.getByRole('combobox', { name: '领域' });
  await user.selectOptions(filter, 'API 接入');
  expect(within(screen.getByRole('list', { name: '搜索结果' })).getByRole('button', { name: 'API入库衔接' })).toBeVisible();
  await user.click(search);
  await user.keyboard('{ArrowDown}{Escape}');
  expect(search).toHaveFocus();
  expect(filter).toHaveValue('API 接入');
  expect(screen.queryByRole('list', { name: '搜索结果' })).not.toBeInTheDocument();
  await user.type(search, '不存在的功能');
  expect(screen.getByText('没有匹配项')).toBeVisible();
  await user.clear(search);
  expect(screen.queryByText('没有匹配项')).not.toBeInTheDocument();
  expect(screen.queryByRole('list', { name: '搜索结果' })).not.toBeInTheDocument();
  await user.click(search);
  await user.click(screen.getByRole('heading', { name: '不良品台账' }));
  expect(screen.queryByRole('list', { name: '搜索结果' })).not.toBeInTheDocument();
});

it('renders the supplied status control in the selected node header without owning its behavior', async () => {
  const user = userEvent.setup();
  const configure = vi.fn();
  render(<MemoryRouter><WorkbenchGraphDetail node={graph.nodes[5]} nodes={new Map()} relations={[]} sessionScope="INTERNAL:home:admin"
    depth={1} headingRef={null} select={vi.fn()} setDepth={vi.fn()} close={vi.fn()} text={zh => zh}
    statusControl={<button type="button" onClick={configure}>配置功能状态</button>} /></MemoryRouter>);
  const heading = screen.getByRole('heading', { name: '供应商资料' });
  expect(heading.closest('header')).toContainElement(screen.getByRole('button', { name: '配置功能状态' }));
  expect(heading.closest('header')).toContainElement(screen.getByRole('button', { name: '关闭详情' }));
  await user.click(screen.getByRole('button', { name: '配置功能状态' }));
  expect(configure).toHaveBeenCalledOnce();
});

function deferredResponse() {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>(complete => { resolve = complete; });
  return { promise, resolve };
}

function mountPendingStatusSave() {
  const patch = deferredResponse();
  const path = '/api/v1/workbench/graph/nodes/ingestion/status';
  const respond = vi.fn((url: string, _init?: RequestInit) => {
    if (url === '/api/v1/workbench/graph') return Response.json({ ...graph, canEditStatus: true });
    if (url === '/api/v1/auth/csrf') return Response.json({ csrfToken: 'test-token' });
    if (url === path) return patch.promise;
  });
  const { user } = mount('/app/workbench?graphNode=ingestion', 'INTERNAL:home:admin', [], respond);
  return { user, patch, path, respond };
}

async function submitIdeaStatus(user: ReturnType<typeof userEvent.setup>) {
  const detail = within(await screen.findByRole('complementary', { name: 'API入库衔接' }));
  await user.click(detail.getByRole('button', { name: '调整状态' }));
  await user.selectOptions(detail.getByRole('combobox', { name: '调整为' }), 'idea');
  await user.click(detail.getByRole('button', { name: '保存状态' }));
  return detail;
}

it.each(['switch', 'close'])('updates search and status after a late save when users %s details', async action => {
  const { user, patch, path, respond } = mountPendingStatusSave();
  const detail = await submitIdeaStatus(user);
  await waitFor(() => expect(respond).toHaveBeenCalledWith(path, expect.objectContaining({
    method: 'PATCH', body: JSON.stringify({ status: 'idea', expectedVersion: 0 }), headers: expect.objectContaining({ 'x-csrf-token': 'test-token' }),
  })));
  await user.click(detail.getByRole('button', { name: action === 'switch' ? '不良事实直接入库' : '关闭详情' }));
  expect(screen.queryByRole('complementary', { name: 'API入库衔接' })).not.toBeInTheDocument();

  const search = screen.getByRole('searchbox', { name: '搜索功能与联动' });
  await user.type(search, 'API入库衔接');
  await user.selectOptions(screen.getByRole('combobox', { name: '功能状态' }), 'idea');
  expect(screen.getByText('没有匹配项')).toBeVisible();
  await act(async () => patch.resolve(Response.json({ ...graph.nodes[1], status: 'idea', statusVersion: 1 })));

  const results = within(await screen.findByRole('list', { name: '搜索结果' }));
  expect(sceneRender.mock.lastCall?.[0].graph.nodes).toContainEqual(expect.objectContaining({ id: 'ingestion', status: 'idea' }));
  await user.click(results.getByRole('button', { name: 'API入库衔接' }));
  expect(within(screen.getByRole('complementary', { name: 'API入库衔接' })).getByText('构想中')).toBeVisible();
});

it('blocks collapse until a late save succeeds, then reads persisted state on reopen', async () => {
  const { user, patch, path, respond } = mountPendingStatusSave();
  const detail = await submitIdeaStatus(user);
  await waitFor(() => expect(respond).toHaveBeenCalledWith(path, expect.objectContaining({ method: 'PATCH' })));
  const signal = respond.mock.calls.find(([url]) => url === path)?.[1]?.signal;
  const disclosure = screen.getByRole('button', { name: '功能图谱' });

  await user.click(disclosure);
  expect(disclosure).toHaveAttribute('aria-expanded', 'true');
  expect(disclosure).toBeDisabled();
  expect(signal?.aborted).toBe(false);
  expect(screen.getByTestId('graph-url')).toHaveTextContent('/app/workbench?graphNode=ingestion');

  const updated = { ...graph.nodes[1], status: 'idea', statusVersion: 1 } as const;
  const request = respond.getMockImplementation()!;
  respond.mockImplementation((url, init) => url === '/api/v1/workbench/graph'
    ? Response.json({ ...graph, canEditStatus: true, nodes: graph.nodes.map(node => node.id === updated.id ? updated : node) })
    : request(url, init));
  await act(async () => patch.resolve(Response.json(updated)));
  expect(detail.getByText('构想中')).toBeVisible();
  expect(disclosure).toBeEnabled();

  const search = screen.getByRole('searchbox', { name: '搜索功能与联动' });
  await user.click(disclosure);
  expect(disclosure).toHaveAttribute('aria-expanded', 'false');
  expect(search).not.toBeInTheDocument();
  expect(screen.getByTestId('graph-url')).toHaveTextContent(/^\/app\/workbench$/);
  expect(respond.mock.calls.filter(([url]) => url === '/api/v1/workbench/graph')).toHaveLength(1);
  await user.click(disclosure);
  await user.type(await screen.findByRole('searchbox', { name: '搜索功能与联动' }), 'API入库衔接');
  await user.click(within(screen.getByRole('list', { name: '搜索结果' })).getByRole('button', { name: 'API入库衔接' }));
  expect(within(screen.getByRole('complementary', { name: 'API入库衔接' })).getByText('构想中')).toBeVisible();
  expect(respond.mock.calls.filter(([url]) => url === '/api/v1/workbench/graph')).toHaveLength(2);
});

it('discards a pending graph save on identity change', async () => {
  const { user, patch, path, respond } = mountPendingStatusSave();
  await submitIdeaStatus(user);
  await waitFor(() => expect(respond).toHaveBeenCalledWith(path, expect.objectContaining({ method: 'PATCH' })));
  const signal = respond.mock.calls.find(([url]) => url === path)?.[1]?.signal;
  act(() => useWorkTabsStore.getState().bindSession('INTERNAL:home:other-admin'));
  expect(signal?.aborted).toBe(true);
  expect(screen.getByRole('button', { name: '功能图谱' })).toBeEnabled();
  await act(async () => patch.resolve(Response.json({ ...graph.nodes[1], status: 'idea', statusVersion: 1 })));
  expect(within(await screen.findByRole('complementary', { name: 'API入库衔接' })).getByText('开发中')).toBeVisible();
});

it('merges a late conflict reload without reverting a newer save', async () => {
  const { user, patch, path, respond } = mountPendingStatusSave();
  const detail = await submitIdeaStatus(user);
  await waitFor(() => expect(respond).toHaveBeenCalledWith(path, expect.objectContaining({ method: 'PATCH' })));
  const reload = deferredResponse();
  const request = respond.getMockImplementation()!;
  respond.mockImplementation(url => {
    if (url === '/api/v1/workbench/graph') return reload.promise;
    if (url === '/api/v1/workbench/graph/nodes/ledger/status') {
      return Response.json({ ...graph.nodes[0], status: 'development', statusVersion: 1 });
    }
    return request(url);
  });
  await act(async () => patch.resolve(Response.json({}, { status: 409 })));
  await waitFor(() => expect(respond.mock.calls.filter(([url]) => url === '/api/v1/workbench/graph')).toHaveLength(2));
  await user.click(detail.getByRole('button', { name: '关闭详情' }));

  const search = screen.getByRole('searchbox', { name: '搜索功能与联动' });
  await user.type(search, '不良品台账');
  await user.click(within(screen.getByRole('list', { name: '搜索结果' })).getByRole('button', { name: '不良品台账' }));
  const ledger = within(screen.getByRole('complementary', { name: '不良品台账' }));
  await user.click(ledger.getByRole('button', { name: '调整状态' }));
  await user.selectOptions(ledger.getByRole('combobox', { name: '调整为' }), 'development');
  await user.click(ledger.getByRole('button', { name: '保存状态' }));
  expect(await ledger.findByText('开发中')).toBeVisible();
  const disclosure = screen.getByRole('button', { name: '功能图谱' });
  expect(disclosure).toBeDisabled();

  await act(async () => reload.resolve(Response.json({ ...graph, canEditStatus: true,
    nodes: graph.nodes.map(node => node.id === 'ingestion' ? { ...node, status: 'idea', statusVersion: 2 } : node),
  })));
  expect(disclosure).toBeEnabled();
  expect(ledger.getByText('开发中')).toBeVisible();
  await user.clear(search);
  await user.type(search, 'API入库衔接');
  await user.selectOptions(screen.getByRole('combobox', { name: '功能状态' }), 'idea');
  await user.click(within(screen.getByRole('list', { name: '搜索结果' })).getByRole('button', { name: 'API入库衔接' }));
  expect(within(screen.getByRole('complementary', { name: 'API入库衔接' })).getByText('构想中')).toBeVisible();
});

it('opens a stable relation link and shows the same direct relation from either endpoint', async () => {
  const { user } = mount('/app/workbench?graphRelation=ingestion-ledger');
  const edge = within(await screen.findByRole('complementary', { name: '不良事实直接入库' }));
  expect(edge.getByText('直接写入不良品台账')).toBeVisible();
  expect(edge.getByText('已启用制程入库规则')).toBeVisible();
  expect(edge.getByText('传递不良事实')).toBeVisible();
  await user.click(edge.getByRole('button', { name: '不良品台账' }));
  const ledger = within(screen.getByRole('complementary', { name: '不良品台账' }));
  expect(within(ledger.getByRole('list', { name: '直接上游' })).getByRole('button', { name: '不良事实直接入库' })).toBeVisible();
  await user.click(ledger.getByRole('button', { name: '不良事实直接入库' }));
  await user.click(within(screen.getByRole('complementary', { name: '不良事实直接入库' })).getByRole('button', { name: 'API入库衔接' }));
  const ingestion = within(screen.getByRole('complementary', { name: 'API入库衔接' }));
  expect(within(ingestion.getByRole('list', { name: '直接下游' })).getByRole('button', { name: '不良事实直接入库' })).toBeVisible();
  expect(ingestion.getByRole('button', { name: '展开第二跳' })).toBeVisible();
  await user.click(ingestion.getByRole('button', { name: '展开第二跳' }));
  expect(within(ingestion.getByRole('list', { name: '第二跳联动' })).getByRole('button', { name: '工序板块匹配' })).toBeVisible();
});

it('sends search visibility to the scene and retains selected nodes and both hops as a user narrows the results', async () => {
  const { user } = mount();
  await user.click(screen.getByRole('button', { name: '功能图谱' }));
  const search = await screen.findByRole('searchbox', { name: '搜索功能与联动' });
  await screen.findByRole('button', { name: '浏览功能与联动' });
  expect(sceneRender.mock.lastCall?.[0].visibleNodeIds).toBeUndefined();
  await user.type(search, '工序自动入库');
  expect(sceneRender).toHaveBeenLastCalledWith(expect.objectContaining({
    visibleNodeIds: new Set(['ingestion', 'operations']), visibleRelationIds: new Set(['ingestion-operations']),
  }));
  await user.clear(search);
  await user.type(search, 'API入库衔接');
  await user.click(within(screen.getByRole('list', { name: '搜索结果' })).getByRole('button', { name: 'API入库衔接' }));
  await user.clear(search);
  const filters = within(screen.getByRole('group', { name: '图谱筛选' }));
  await user.selectOptions(filters.getByRole('combobox', { name: '领域' }), '供应商门户');
  await user.selectOptions(filters.getByRole('combobox', { name: '联动类型' }), 'data');
  expect(sceneRender).toHaveBeenLastCalledWith(expect.objectContaining({
    relationKind: 'data', depth: 1, visibleNodeIds: new Set(['ingestion', 'operations', 'ledger']), visibleRelationIds: new Set(['ingestion-ledger', 'ingestion-operations']),
  }));
  await user.click(screen.getByRole('button', { name: '展开第二跳' }));
  expect(sceneRender).toHaveBeenLastCalledWith(expect.objectContaining({
    relationKind: 'data', depth: 2, visibleNodeIds: new Set(['ingestion', 'operations', 'ledger']), visibleRelationIds: new Set(['ingestion-ledger', 'ingestion-operations']),
  }));
  await user.click(within(screen.getByRole('list', { name: '第二跳联动' })).getByRole('button', { name: '工序板块匹配' }));
  expect(sceneRender).toHaveBeenLastCalledWith(expect.objectContaining({
    relationKind: 'data', selection: { type: 'relation', id: 'operations-ledger' }, visibleRelationIds: new Set(['ingestion-ledger', 'ingestion-operations', 'operations-ledger']),
  }));
  await user.click(screen.getByRole('button', { name: '复位' }));
  expect(sceneRender).toHaveBeenLastCalledWith(expect.objectContaining({
    selection: null, depth: 0, resetKey: 1, relationKind: undefined, visibleNodeIds: undefined, visibleRelationIds: undefined,
  }));
});

it('keeps the workbench available and retries a malformed graph response', async () => {
  const { fetchMock } = mount();
  fetchMock.mockResolvedValueOnce(Response.json({ nodes: null }));
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: '功能图谱' }));
  expect(await screen.findByText('功能图谱加载失败')).toBeVisible();
  expect(screen.getByRole('heading', { name: '综合工作台' })).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: /^重\s*试$/ }));
  expect(await screen.findByRole('searchbox', { name: '搜索功能与联动' })).toBeVisible();
});

it('keeps ledger guidance available but hides the entry when the session lacks the page read permission', async () => {
  const { fetchMock, user } = mount('/app/workbench?graphNode=ledger', 'INTERNAL:home:staff', ['process-quality:defects:write']);
  const detail = within(await screen.findByRole('complementary', { name: '不良品台账' }));
  expect(await detail.findByText('当前账号无此入口权限')).toBeVisible();
  expect(detail.queryByRole('button', { name: '配置功能状态' })).not.toBeInTheDocument();
  await user.click(detail.getByText('使用指南'));
  expect(detail.getByText('确认映射')).toBeVisible();
  expect(detail.queryByRole('link')).not.toBeInTheDocument();
  expect(fetchMock).toHaveBeenCalledWith('/api/v1/system/my-permissions', expect.objectContaining({ signal: expect.any(AbortSignal) }));
});

it.each([[], ['supplier-barcode:scan'], ['supplier-barcode:read'], ['supplier-barcode:scan', 'supplier-barcode:read']].map(permissions => ({ permissions })))('checks barcode page permissions ($permissions)', async ({ permissions }) => {
  mount('/app/workbench?graphNode=scanning', 'INTERNAL:home:staff', permissions);
  const detail = within(await screen.findByRole('complementary', { name: '关键件条码校验' }));
  if (permissions.length === 2) expect(await detail.findByRole('link', { name: '打开入口' })).toHaveAttribute('href', '/app/site-scanning');
  else {
    expect(await detail.findByText('当前账号无此入口权限')).toBeVisible();
    expect(detail.getByText(guide.role)).not.toBeVisible();
    expect(detail.queryByRole('link')).not.toBeInTheDocument();
  }
});

it.each([false, true])('honors the write permission for the non-menu supplier draft entry (%s)', async allowed => {
  mount('/app/workbench?graphNode=supplier-draft', 'INTERNAL:home:staff', allowed ? ['supplier-quality:problems:write'] : []);
  const detail = within(await screen.findByRole('complementary', { name: '创建问题草稿' }));
  if (allowed) expect(await detail.findByRole('link', { name: '打开入口' })).toHaveAttribute('href', '/app/supplier-quality/new');
  else expect(await detail.findByText('当前账号无此入口权限')).toBeVisible();
});

it.each(['staff', 'admin'])('uses the existing console context gate for %s without trimming the graph', async (role) => {
  const { user } = mount('/app/workbench?graphNode=ingestion', `INTERNAL:home:${role}`);
  const detail = within(await screen.findByRole('complementary', { name: 'API入库衔接' }));
  expect(detail.getByText('使用指南')).toBeVisible();
  if (role === 'admin') expect(await detail.findByRole('link', { name: '打开入口' })).toHaveAttribute('href', '/console/api-ingestion');
  else {
    expect(await detail.findByText('当前账号无此入口权限')).toBeVisible();
    expect(detail.queryByRole('link', { name: '打开入口' })).not.toBeInTheDocument();
  }
  await user.click(await screen.findByRole('button', { name: '浏览功能与联动' }));
  expect(within(screen.getByRole('list', { name: '搜索结果' })).getByRole('button', { name: '供应商资料' })).toBeVisible();
});

it.each(['supplier', 'record'])('never links from the internal graph to %s', async (id) => {
  mount(`/app/workbench?graphNode=${id}`);
  const detail = within(await screen.findByRole('complementary'));
  expect(detail.queryByRole('link', { name: '打开入口' })).not.toBeInTheDocument();
});
