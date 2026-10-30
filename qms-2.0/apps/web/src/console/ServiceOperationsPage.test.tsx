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
import { ServiceOperationsPage } from './ServiceOperationsPage';

type Page = components['schemas']['ServiceOperationsPageDto'];
const mocks = vi.hoisted(() => ({ context: {} as ConsoleContext, refresh: vi.fn(), invalidate: vi.fn() }));
vi.mock('./ConsoleLayout', () => ({ useConsoleContext: () => mocks }));
vi.mock('../api/client', async original => ({ ...await original<typeof import('../api/client')>(), apiRequest: vi.fn() }));
const read = vi.mocked(apiRequest);
const realClient = await vi.importActual<typeof import('../api/client')>('../api/client');
const homeId = '11111111-1111-4111-8111-111111111111';
const targetId = '22222222-2222-4222-8222-222222222222';
const actorId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const time = '2026-10-30T04:00:00.000Z';
const home = { id: homeId, code: 'HOME', name: '会话组织', type: 'INTERNAL', status: 'ACTIVE', configurationRequired: false } as const;
const target = { ...home, id: targetId, code: 'TARGET', name: '目标组织' };
function context(platform = true): ConsoleContext {
  return { actor: { id: actorId, accountType: 'INTERNAL', homeOrganization: home }, targetOrganization: target, organizations: [home, target], hasPlatformAdministrator: platform,
    modules: [{ key: 'services', scope: 'TARGET', coverage: 'ORGANIZATION', organizationId: targetId, permissions: ['console:services:read'] }] };
}
function result(scope: Page['scope'] = 'ORGANIZATION', overrides: Partial<Page> = {}): Page {
  const organizationId = mocks.context.targetOrganization.id;
  return { scope, organizationId, asOf: time, sources: [
    { key: 'worker', coverage: 'PLATFORM', organizationId, status: 'UNKNOWN', asOf: time, reasonCode: 'GLOBAL_SCOPE_REQUIRED' },
    { key: 'outbox', coverage: 'ORGANIZATION', organizationId, status: 'UNKNOWN', asOf: time, counts: { pending: 7, failed: 2 } },
    { key: 'files', coverage: 'ORGANIZATION', organizationId, status: 'RECENT_RESULT', asOf: time, configured: true, scannerConfigured: true, storageConfigured: true, counts: { waiting: 3, succeeded: 9 }, results: [{ status: 'SUCCEEDED', observedAt: time }] },
    { key: 'mail', coverage: 'ORGANIZATION', organizationId, status: 'UNAVAILABLE', asOf: time, reasonCode: 'SOURCE_UNAVAILABLE' },
    { key: 'pdf', coverage: 'ORGANIZATION', organizationId, status: 'STALE', asOf: time, results: [{ status: 'FAILED', observedAt: time, domainCode: 'customer-quality', reasonCode: 'PDF_RENDER_FAILED', durationMs: 120 }] },
  ], ...overrides };
}
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (error: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function view(strict = false) {
  const tree = () => { const page = <LanguageProvider><ConsoleTheme><MemoryRouter><ServiceOperationsPage /></MemoryRouter></ConsoleTheme></LanguageProvider>; return strict ? <StrictMode>{page}</StrictMode> : page; };
  const rendered = render(tree()); return { ...rendered, update: () => rendered.rerender(tree()) };
}
async function platform() {
  fireEvent.mouseDown(screen.getByRole('combobox', { name: '观测范围' }));
  fireEvent.click(await screen.findByText('平台执行回执', { selector: '.ant-select-item-option-content' }));
}
beforeEach(() => {
  vi.clearAllMocks(); read.mockReset(); localStorage.clear(); mocks.context = context();
  useWorkTabsStore.getState().bindSession(`INTERNAL:${homeId}:${actorId}`); read.mockResolvedValue(result());
});
afterEach(() => { vi.unstubAllGlobals(); localStorage.clear(); });

it('renders owner facts and server timestamps without turning configuration or recent results into health', async () => {
  view(); const files = await screen.findByRole('region', { name: '文件与扫描' });
  expect(within(files).getByText('9')).toBeVisible(); expect(within(files).getByText('配置满足')).toBeVisible();
  expect(within(files).getByText('近期执行事实')).toBeVisible();
  const pdf = screen.getByRole('region', { name: 'PDF 按请求渲染' });
  expect(within(pdf).getByText('执行失败')).toBeVisible(); expect(within(pdf).getByText('回执已过期')).toBeVisible();
  expect(within(pdf).getByText('120 ms')).toBeVisible(); expect(screen.getByText(/不是常驻队列/)).toBeVisible();
  expect(within(pdf).getByText(/不代表最终业务请求成功/)).toBeVisible();
  expect(screen.getByText('目标组织 (TARGET)')).toBeVisible(); expect(document.querySelector(`time[datetime="${time}"]`)).toBeInTheDocument();
  const query = new URL(read.mock.calls[0]![0], 'http://localhost').searchParams;
  expect(query.get('organizationId')).toBe(targetId); expect(query.get('scope')).toBe('ORGANIZATION');
  expect(screen.queryByText('系统健康')).not.toBeInTheDocument(); expect(useWorkTabsStore.getState().tabs).toEqual([]);
});
it('keeps unavailable source counts absent while retaining safe facts from the other owners', async () => {
  view(); const mail = await screen.findByRole('region', { name: '邮件投递' });
  expect(within(mail).getByText('来源不可用')).toBeVisible(); expect(within(mail).queryByRole('definition')).not.toBeInTheDocument();
  expect(within(mail).queryByText('0')).not.toBeInTheDocument(); expect(within(screen.getByRole('region', { name: '失败队列元数据' })).getByText('7')).toBeVisible();
});
it('shows loading without fabricated source cards or zero facts', () => {
  read.mockReturnValue(deferred<Page>().promise); view();
  expect(screen.getByRole('status', { name: '读取运行服务事实中' })).toBeVisible(); expect(screen.queryByRole('region', { name: '邮件投递' })).not.toBeInTheDocument();
});
it('does not query for missing capabilities or a mismatched session', () => {
  mocks.context = { ...context(), modules: [] }; const page = view();
  expect(screen.getByRole('alert')).toHaveTextContent('运行服务访问已失效或无权限'); expect(read).not.toHaveBeenCalled();
  mocks.context = context(); act(() => useWorkTabsStore.getState().bindSession('INTERNAL:foreign:person')); page.update(); expect(read).not.toHaveBeenCalled();
});
it('does not expose global Worker facts or platform controls to an organization-only reader', async () => {
  mocks.context = context(false); read.mockResolvedValue(result()); view();
  const worker = await screen.findByRole('region', { name: 'Worker 执行回执' });
  expect(within(worker).getByText('需显式平台范围才能读取全局回执')).toBeVisible();
  expect(within(worker).queryByText('执行成功')).not.toBeInTheDocument(); expect(screen.queryByRole('combobox', { name: '观测范围' })).not.toBeInTheDocument();
});
it('offers a failure queue link only with the separate existing outbox read capability', async () => {
  const page = view(); await screen.findByRole('region', { name: '失败队列元数据' });
  expect(screen.queryByRole('link', { name: '查看失败队列' })).not.toBeInTheDocument();
  mocks.context = { ...context(), modules: [...context().modules, { key: 'outbox', scope: 'TARGET', coverage: 'ORGANIZATION', organizationId: targetId, permissions: ['outbox:read'] }] }; page.update();
  const link = await screen.findByRole('link', { name: '查看失败队列' }); expect(link).toHaveAttribute('href', `/console/outbox?organizationId=${targetId}`);
  expect(screen.queryByRole('button', { name: /重启|补传|重试事件|导出报文/ })).not.toBeInTheDocument();
});
it('clears old source facts during an explicit platform switch and shows actual failed Worker results neutrally', async () => {
  const pending = deferred<Page>(); read.mockResolvedValueOnce(result()).mockReturnValueOnce(pending.promise); view();
  await screen.findByRole('region', { name: '文件与扫描' }); await platform();
  expect(screen.queryByRole('region', { name: '文件与扫描' })).not.toBeInTheDocument();
  const data = result('PLATFORM'); data.sources[0] = { ...data.sources[0]!, reasonCode: undefined, status: 'RECENT_RESULT', results: [{ status: 'FAILED', observedAt: time, counts: { failed: 4 }, reasonCode: 'WORKER_EXECUTION_FAILED' }] };
  await act(async () => pending.resolve(data)); const worker = await screen.findByRole('region', { name: 'Worker 执行回执' });
  expect(within(worker).getByText('执行失败')).toBeVisible(); expect(within(worker).getByText('4')).toBeVisible(); expect(within(worker).getByText('近期执行事实')).toBeVisible();
  expect(within(worker).getByText(/最近周期快照/)).toBeVisible(); expect(within(worker).getByText(/自本进程启动/)).toBeVisible();
});
it('removes global facts immediately when the platform marker or read capability changes', async () => {
  read.mockImplementation(async path => {
    const scope = new URL(path, 'http://localhost').searchParams.get('scope') === 'PLATFORM' ? 'PLATFORM' : 'ORGANIZATION';
    const data = result(scope); if (scope === 'PLATFORM') data.sources[0] = { ...data.sources[0]!, reasonCode: undefined, results: [{ status: 'FAILED', observedAt: time, counts: { failed: 987 } }] }; return data;
  });
  const page = view(); await screen.findByRole('region', { name: '文件与扫描' }); await platform(); await screen.findByText('987');
  mocks.context = context(false); page.update(); expect(screen.queryByText('987')).not.toBeInTheDocument();
  await waitFor(() => expect(new URL(read.mock.calls.at(-1)![0], 'http://localhost').searchParams.get('scope')).toBe('ORGANIZATION'));
  mocks.context = { ...context(), modules: [] }; page.update(); expect(screen.queryByRole('region', { name: '文件与扫描' })).not.toBeInTheDocument();
});
it('distinguishes successful empty results from a failed read and supports a safe retry', async () => {
  read.mockRejectedValueOnce(new Error('PRIVATE_BACKEND_HOST')).mockResolvedValueOnce(result('ORGANIZATION', { sources: [] })); view();
  expect(await screen.findByRole('alert')).toHaveTextContent('运行服务事实读取失败'); expect(screen.queryByText('PRIVATE_BACKEND_HOST')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '重试读取' })); expect(await screen.findByText('当前没有可展示的服务事实')).toBeVisible();
  expect(screen.getByText('没有事实不代表没有任务或服务正常。')).toBeVisible();
});
it.each([401, 403])('clears source facts and invalidates once after the current read returns %s', async status => {
  read.mockResolvedValueOnce(result()).mockRejectedValueOnce(new ApiError({ code: 'FEATURE_PERMISSION_DENIED', message: 'PRIVATE' }, status)); view();
  await screen.findByRole('region', { name: '文件与扫描' }); fireEvent.click(screen.getByRole('button', { name: '刷新运行服务事实' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('运行服务访问已失效或无权限'); expect(mocks.invalidate).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole('region', { name: '文件与扫描' })).not.toBeInTheDocument(); expect(read).toHaveBeenCalledTimes(2);
});
it('handles the actual client forbidden broadcast before rejection without retrying a denied read', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ code: 'FEATURE_PERMISSION_DENIED', message: 'PRIVATE' }), { status: 403, headers: { 'content-type': 'application/json' } })));
  read.mockImplementation(realClient.apiRequest); view(); expect(await screen.findByRole('alert')).toHaveTextContent('运行服务访问已失效或无权限');
  expect(mocks.invalidate).toHaveBeenCalledTimes(1); expect(read).toHaveBeenCalledTimes(1);
});
it('rejects a foreign target or global Worker data in an organization response', async () => {
  const data = result(); data.sources[0] = { ...data.sources[0]!, counts: { processed: 54321 } }; read.mockResolvedValue(data); view();
  expect(await screen.findByRole('alert')).toHaveTextContent('运行服务访问已失效或无权限'); expect(screen.queryByText('54321')).not.toBeInTheDocument();
});
it('rejects a forged source coverage before rendering its results', async () => {
  const data = result(); data.sources[2] = { ...data.sources[2]!, coverage: 'PLATFORM' }; read.mockResolvedValue(data); view();
  expect(await screen.findByRole('alert')).toHaveTextContent('运行服务访问已失效或无权限'); expect(screen.queryByRole('region', { name: '文件与扫描' })).not.toBeInTheDocument();
});
it('retires old scope denial and rechecks a pending success after a revalidate signal', async () => {
  const old = deferred<Page>(); const pending = deferred<Page>(); read.mockReturnValueOnce(old.promise).mockReturnValueOnce(pending.promise).mockImplementation(async () => result());
  const page = view(); mocks.context = { ...context(), targetOrganization: home, modules: [{ ...context().modules[0]!, organizationId: homeId }] }; page.update();
  await waitFor(() => expect(read.mock.calls.length).toBe(2)); await act(async () => old.reject(new ApiError({ code: 'FEATURE_PERMISSION_DENIED', message: 'OLD' }, 403)));
  expect(mocks.invalidate).not.toHaveBeenCalled(); act(() => publishSessionSignal('revalidate'));
  const rejected = result(); rejected.sources[1] = { ...rejected.sources[1]!, counts: { failed: 45678 } };
  await act(async () => pending.resolve(rejected)); await waitFor(() => expect(read.mock.calls.length).toBe(3)); expect(screen.queryByText('45678')).not.toBeInTheDocument();
});
it('retires a pending read synchronously across a batched session A-B-A transition', async () => {
  const old = deferred<Page>(); read.mockReturnValueOnce(old.promise).mockImplementation(async () => result()); view();
  act(() => { useWorkTabsStore.getState().bindSession('INTERNAL:other:person'); useWorkTabsStore.getState().bindSession(`INTERNAL:${homeId}:${actorId}`); });
  await waitFor(() => expect(read.mock.calls.length).toBeGreaterThan(1)); const data = result(); data.sources[1] = { ...data.sources[1]!, counts: { failed: 34567 } };
  await act(async () => old.resolve(data)); expect(screen.queryByText('34567')).not.toBeInTheDocument();
});
it('clears source facts on invalidation and preserves explicit verification action', async () => {
  view(); await screen.findByRole('region', { name: '文件与扫描' }); act(() => publishSessionSignal('invalidate'));
  expect(screen.queryByRole('region', { name: '文件与扫描' })).not.toBeInTheDocument(); fireEvent.click(screen.getByRole('button', { name: '重新核验权限' })); expect(mocks.refresh).toHaveBeenCalledTimes(1);
});
it('ignores discarded StrictMode reads and renders English labels without changing supplied facts', async () => {
  localStorage.setItem('qms:locale:v1', 'en-US'); const old = deferred<Page>(); read.mockReturnValueOnce(old.promise).mockImplementation(async () => result()); view(true);
  await screen.findByRole('region', { name: 'Files & scanning' }); const data = result(); data.sources[1] = { ...data.sources[1]!, counts: { failed: 23456 } };
  await act(async () => old.resolve(data)); expect(screen.queryByText('23456')).not.toBeInTheDocument(); expect(screen.getByRole('heading', { name: 'Service operation facts' })).toBeVisible();
});
