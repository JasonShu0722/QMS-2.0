import { StrictMode } from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { components } from '@qms/contracts';
import { ApiError, apiRequest } from '../api/client';
import { LanguageProvider } from '../i18n/Language';
import { publishSessionSignal } from '../features/auth/session-invalidation';
import { useWorkTabsStore } from '../work-tabs/workTabsStore';
import { ConsoleTheme } from './ConsoleTheme';
import type { ConsoleContext } from './console-navigation';
import { ApiMonitoringPage } from './ApiMonitoringPage';

type Page = components['schemas']['ApiObservationPageDto'];
const mocks = vi.hoisted(() => ({ context: {} as ConsoleContext, refresh: vi.fn(), invalidate: vi.fn() }));
vi.mock('./ConsoleLayout', () => ({ useConsoleContext: () => mocks }));
vi.mock('../api/client', async original => ({ ...await original<typeof import('../api/client')>(), apiRequest: vi.fn() }));
const read = vi.mocked(apiRequest);
const realClient = await vi.importActual<typeof import('../api/client')>('../api/client');
const homeId = '11111111-1111-4111-8111-111111111111';
const targetId = '22222222-2222-4222-8222-222222222222';
const actorId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const home = { id: homeId, code: 'HOME', name: '会话组织', type: 'INTERNAL', status: 'ACTIVE', configurationRequired: false } as const;
const target = { ...home, id: targetId, code: 'TARGET', name: '目标组织' };
const time = '2026-10-30T04:00:00.000Z';
function context(platform = true): ConsoleContext {
  return { actor: { id: actorId, accountType: 'INTERNAL', homeOrganization: home }, targetOrganization: target, organizations: [home, target], hasPlatformAdministrator: platform,
    modules: [{ key: 'api-monitoring', scope: 'TARGET', coverage: 'ORGANIZATION', organizationId: targetId, permissions: ['console:api:read'] }] };
}
function result(scope: Page['scope'] = 'ORGANIZATION', overrides: Partial<Page> = {}): Page {
  return { scope, organizationId: mocks.context.targetOrganization.id, from: '2026-10-29T04:00:00.000Z', to: time, asOf: time, page: 1, limit: 50, total: 1,
    items: [{ minute: '2026-10-30T03:59:00.000Z', scopeKey: mocks.context.targetOrganization.id, method: 'GET', route: '/api/v1/tasks/:id', statusClass: 2, count: 12, durationTotal: 240, durationMax: 80, le50: 10, le200: 2, le1000: 0, le5000: 0, gt5000: 0 }],
    summary: { requests: 12, errors: 2, durationTotal: 240, durationMax: 80, le50: 10, le200: 2, le1000: 0, le5000: 0, gt5000: 0 }, collector: { status: 'UNKNOWN' }, ...overrides };
}
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (error: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function view(strict = false) {
  const tree = () => { const page = <LanguageProvider><ConsoleTheme><MemoryRouter><ApiMonitoringPage /></MemoryRouter></ConsoleTheme></LanguageProvider>; return strict ? <StrictMode>{page}</StrictMode> : page; };
  const rendered = render(tree()); return { ...rendered, update: () => rendered.rerender(tree()) };
}
async function choose(label: string, option: string) {
  fireEvent.mouseDown(screen.getByRole('combobox', { name: label }));
  fireEvent.click(await screen.findByText(option, { selector: '.ant-select-item-option-content' }));
}
beforeEach(() => {
  vi.clearAllMocks(); read.mockReset(); localStorage.clear(); mocks.context = context();
  useWorkTabsStore.getState().bindSession(`INTERNAL:${homeId}:${actorId}`);
  read.mockResolvedValue(result());
});
afterEach(() => { vi.unstubAllGlobals(); localStorage.clear(); });

it('reads the verified target and renders actual request totals, latency buckets and server range', async () => {
  view();
  const metrics = await screen.findByRole('region', { name: '请求摘要' });
  expect(within(metrics).getByText('12')).toBeVisible();
  expect(within(metrics).getByText('20 ms')).toBeVisible();
  expect(within(metrics).getByText('80 ms')).toBeVisible();
  expect(screen.getByRole('region', { name: '耗时分布' })).toHaveTextContent('10');
  expect(screen.getByText('/api/v1/tasks/:id')).toBeVisible();
  const query = new URL(read.mock.calls[0]![0], 'http://localhost').searchParams;
  expect(query.get('organizationId')).toBe(targetId); expect(query.get('scope')).toBe('ORGANIZATION');
  expect(document.querySelector(`time[datetime="${time}"]`)).toBeInTheDocument();
  expect(screen.getByText('目标组织 (TARGET)')).toBeVisible();
  expect(screen.getByText(/采集完整性未知/)).toBeVisible();
  expect(useWorkTabsStore.getState().tabs).toEqual([]);
  expect(screen.queryByRole('heading', { name: 'API 技术观测' })).not.toBeInTheDocument();
  const notes = document.querySelector('.qms-api-heading details');
  expect(notes).not.toBeNull();
  expect(notes).not.toHaveAttribute('open');
  expect(notes!.querySelector('summary')).toHaveTextContent('技术成功不等于业务落地');
  const scopeNote = within(notes as HTMLElement).getByText(/未归属请求仅平台范围可见/);
  expect(scopeNote).not.toBeVisible();
  fireEvent.click(notes!.querySelector('summary')!);
  expect(scopeNote).toBeVisible();
});
it('shows an accessible loading state and never fills unknown metrics with fake zeros', () => {
  read.mockReturnValue(deferred<Page>().promise); view();
  expect(screen.getByRole('status', { name: '读取 API 观测中' })).toBeInTheDocument();
  expect(screen.queryByRole('region', { name: '请求摘要' })).not.toBeInTheDocument();
});
it('denies missing capability without issuing a request even for a platform marker', () => {
  mocks.context = { ...context(), modules: [] }; view();
  expect(screen.getByRole('alert')).toHaveTextContent('API 观测访问已失效或无权限'); expect(read).not.toHaveBeenCalled();
});
it('never offers platform scope to an organization-only reader', async () => {
  mocks.context = context(false); view(); await screen.findByText('/api/v1/tasks/:id');
  expect(screen.queryByRole('combobox', { name: '观测范围' })).not.toBeInTheDocument();
});
it('applies bounded static-route filters and paginates using bucket totals rather than request count', async () => {
  read.mockImplementation(async path => { const page = Number(new URL(path, 'http://localhost').searchParams.get('page') ?? 1); return result('ORGANIZATION', { page, total: 101 }); });
  view(); await screen.findByText('/api/v1/tasks/:id');
  fireEvent.change(screen.getByRole('textbox', { name: '路由模板' }), { target: { value: '/api/v1/tasks/:id' } });
  await choose('请求方法', 'POST'); await choose('状态类别', '5xx');
  fireEvent.click(screen.getByRole('button', { name: '应用筛选' }));
  await waitFor(() => expect(read).toHaveBeenLastCalledWith(expect.stringContaining('method=POST'), { signal: expect.any(AbortSignal) }));
  const firstPage = new URL(read.mock.calls.at(-1)![0], 'http://localhost').searchParams;
  fireEvent.click(await screen.findByRole('button', { name: '下一页' }));
  await waitFor(() => expect(read.mock.calls.at(-1)![0]).toContain('page=2'));
  const query = new URL(read.mock.calls.at(-1)![0], 'http://localhost').searchParams;
  expect(query.get('statusClass')).toBe('5'); expect(query.get('route')).toBe('/api/v1/tasks/:id');
  expect(query.get('from')).toBe(firstPage.get('from')); expect(query.get('to')).toBe(firstPage.get('to'));
  expect(query.get('limit')).toBe('50'); expect(screen.getByText(/共 101 个聚合桶/)).toBeVisible();
});
it('rejects raw URL queries instead of sending them as route filters', async () => {
  view(); await screen.findByText('/api/v1/tasks/:id'); const count = read.mock.calls.length;
  fireEvent.change(screen.getByRole('textbox', { name: '路由模板' }), { target: { value: '/api/v1/tasks/secret?token=PRIVATE' } });
  fireEvent.click(screen.getByRole('button', { name: '应用筛选' }));
  expect(screen.getByText('请输入静态路由模板或 UNKNOWN，不可包含查询参数或原请求 URL。')).toBeVisible(); expect(read).toHaveBeenCalledTimes(count);
});
it('keeps the seven-day request strictly inside the retained window with minute headroom', async () => {
  view(); await screen.findByText('/api/v1/tasks/:id'); const before = Date.now();
  await choose('查询时段', '近 7 天'); fireEvent.click(screen.getByRole('button', { name: '应用筛选' }));
  await waitFor(() => expect(read.mock.calls.length).toBe(2));
  const query = new URL(read.mock.calls.at(-1)![0], 'http://localhost').searchParams;
  expect(Date.parse(query.get('from')!)).toBeGreaterThan(before - 7 * 86400000);
  expect(Date.parse(query.get('to')!) - Date.parse(query.get('from')!)).toBeLessThan(7 * 86400000);
});
it('clears organization rows during explicit platform switch and shows partial receipt gaps without claiming health', async () => {
  const pending = deferred<Page>(); read.mockResolvedValueOnce(result()).mockReturnValueOnce(pending.promise);
  view(); await screen.findByText('/api/v1/tasks/:id'); await choose('观测范围', '平台观测（含未归属请求）');
  expect(screen.queryByText('/api/v1/tasks/:id')).not.toBeInTheDocument();
  await act(async () => pending.resolve(result('PLATFORM', { collector: { status: 'PARTIAL', liveDropped: 3, liveFailures: 1, producers: [] } })));
  expect(await screen.findByText(/采集存在缺口/)).toBeVisible(); expect(screen.getByText(/当前进程丢弃：3/)).toBeVisible();
  expect(screen.queryByText('系统健康')).not.toBeInTheDocument();
});
it('distinguishes an empty successful query from unavailable data and supports a safe retry', async () => {
  read.mockRejectedValueOnce(new Error('PRIVATE_DATABASE_STACK')).mockResolvedValueOnce(result('ORGANIZATION', { items: [], total: 0, summary: { requests: 0, errors: 0, durationTotal: 0, durationMax: 0, le50: 0, le200: 0, le1000: 0, le5000: 0, gt5000: 0 } }));
  view(); expect(await screen.findByRole('alert')).toHaveTextContent('API 观测读取失败');
  expect(screen.queryByText('PRIVATE_DATABASE_STACK')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '重试读取' }));
  expect(await screen.findByText('当前查询范围没有观测记录')).toBeVisible();
  expect(screen.getByText('没有记录不代表没有请求或系统正常。')).toBeVisible();
});
it.each([401, 403])('clears sensitive results and invalidates on a current %s without retry loops', async status => {
  read.mockResolvedValueOnce(result()).mockRejectedValueOnce(new ApiError({ code: 'FEATURE_PERMISSION_DENIED', message: 'PRIVATE' }, status));
  view(); await screen.findByText('/api/v1/tasks/:id'); fireEvent.click(screen.getByRole('button', { name: '刷新 API 观测' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('API 观测访问已失效或无权限');
  expect(screen.queryByText('/api/v1/tasks/:id')).not.toBeInTheDocument(); expect(mocks.invalidate).toHaveBeenCalledTimes(1); expect(read).toHaveBeenCalledTimes(2);
});
it('handles the actual client 403 revalidate broadcast before its rejection without accepting another response', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ code: 'FEATURE_PERMISSION_DENIED', message: 'PRIVATE' }), { status: 403, headers: { 'content-type': 'application/json' } })));
  read.mockImplementation(realClient.apiRequest); view();
  expect(await screen.findByRole('alert')).toHaveTextContent('API 观测访问已失效或无权限');
  expect(mocks.invalidate).toHaveBeenCalledTimes(1); expect(read).toHaveBeenCalledTimes(1);
});
it('retires late scope responses and clears platform data when capability changes', async () => {
  const old = deferred<Page>(); read.mockReturnValueOnce(old.promise).mockImplementation(async () => result()); const page = view();
  mocks.context = { ...context(false), targetOrganization: home, modules: [{ ...context().modules[0]!, organizationId: homeId }] }; page.update();
  expect(await screen.findByText('会话组织 (HOME)')).toBeVisible(); await screen.findByText('/api/v1/tasks/:id');
  await act(async () => old.resolve(result('PLATFORM', { items: [{ ...result().items[0]!, route: '/api/v1/OLD_PRIVATE' }] })));
  expect(screen.queryByText('/api/v1/OLD_PRIVATE')).not.toBeInTheDocument();
  mocks.context = { ...mocks.context, modules: [] }; page.update();
  expect(screen.queryByText('/api/v1/tasks/:id')).not.toBeInTheDocument();
});
it('removes platform-only rows immediately when the platform marker is revoked', async () => {
  read.mockImplementation(async path => new URL(path, 'http://localhost').searchParams.get('scope') === 'PLATFORM'
    ? result('PLATFORM', { items: [{ ...result().items[0]!, scopeKey: 'UNSCOPED', route: '/api/v1/PLATFORM_PRIVATE' }], collector: { status: 'STALE', producers: [] } }) : result());
  const page = view(); await screen.findByText('/api/v1/tasks/:id'); await choose('观测范围', '平台观测（含未归属请求）');
  await screen.findByText('/api/v1/PLATFORM_PRIVATE'); expect(screen.getByText(/采集回执已过期/)).toBeVisible();
  mocks.context = context(false); page.update();
  expect(screen.queryByText('/api/v1/PLATFORM_PRIVATE')).not.toBeInTheDocument();
  await screen.findByText('/api/v1/tasks/:id');
  expect(new URL(read.mock.calls.at(-1)![0], 'http://localhost').searchParams.get('scope')).toBe('ORGANIZATION');
});
it('ignores an old scope denial and rechecks a pending success after a revalidate signal', async () => {
  const old = deferred<Page>(); const second = deferred<Page>(); read.mockReturnValueOnce(old.promise).mockReturnValueOnce(second.promise).mockResolvedValue(result());
  const page = view(); mocks.context = { ...context(), targetOrganization: home, modules: [{ ...context().modules[0]!, organizationId: homeId }] }; page.update();
  await waitFor(() => expect(read.mock.calls.length).toBe(2));
  await act(async () => old.reject(new ApiError({ code: 'FEATURE_PERMISSION_DENIED', message: 'OLD' }, 403)));
  expect(mocks.invalidate).not.toHaveBeenCalled();
  act(() => publishSessionSignal('revalidate'));
  await act(async () => second.resolve(result('ORGANIZATION', { items: [{ ...result().items[0]!, route: '/api/v1/RECHECK_PRIVATE' }] })));
  await waitFor(() => expect(read.mock.calls.length).toBe(3));
  expect(screen.queryByText('/api/v1/RECHECK_PRIVATE')).not.toBeInTheDocument();
});
it('retires requests synchronously across a batched session A-B-A transition', async () => {
  const old = deferred<Page>(); read.mockReturnValueOnce(old.promise).mockResolvedValue(result()); view();
  act(() => { useWorkTabsStore.getState().bindSession('INTERNAL:other:user'); useWorkTabsStore.getState().bindSession(`INTERNAL:${homeId}:${actorId}`); });
  await waitFor(() => expect(read.mock.calls.length).toBeGreaterThan(1));
  await act(async () => old.resolve(result('ORGANIZATION', { items: [{ ...result().items[0]!, route: '/api/v1/OLD_PRIVATE' }] })));
  expect(screen.queryByText('/api/v1/OLD_PRIVATE')).not.toBeInTheDocument();
});
it('clears data on invalidate signals and rejects forged response scope', async () => {
  view(); await screen.findByText('/api/v1/tasks/:id'); act(() => publishSessionSignal('invalidate'));
  expect(screen.queryByText('/api/v1/tasks/:id')).not.toBeInTheDocument(); expect(mocks.invalidate).toHaveBeenCalledTimes(1);
});
it('rejects a foreign organization result rather than displaying its rows', async () => {
  read.mockResolvedValue(result('ORGANIZATION', { organizationId: homeId })); view();
  expect(await screen.findByRole('alert')).toHaveTextContent('API 观测访问已失效或无权限');
  expect(screen.queryByText('/api/v1/tasks/:id')).not.toBeInTheDocument();
});
it('ignores discarded StrictMode reads and uses English labels without changing data', async () => {
  localStorage.setItem('qms:locale:v1', 'en-US'); const old = deferred<Page>(); read.mockReturnValueOnce(old.promise).mockResolvedValue(result()); view(true);
  await screen.findByText('/api/v1/tasks/:id'); await act(async () => old.resolve(result('ORGANIZATION', { items: [{ ...result().items[0]!, route: '/api/v1/OLD_PRIVATE' }] })));
  expect(screen.queryByText('/api/v1/OLD_PRIVATE')).not.toBeInTheDocument(); expect(screen.getByRole('button', { name: 'Refresh API observations' })).toBeVisible();
});
