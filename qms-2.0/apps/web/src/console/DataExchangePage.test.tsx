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
import { DataExchangePage } from './DataExchangePage';

type Page = components['schemas']['DataExchangePageDto'];
type Attempt = components['schemas']['DataExchangeAttemptDto'];
const mocks = vi.hoisted(() => ({ context: {} as ConsoleContext, refresh: vi.fn(), invalidate: vi.fn() }));
vi.mock('./ConsoleLayout', () => ({ useConsoleContext: () => mocks }));
vi.mock('../api/client', async original => ({ ...await original<typeof import('../api/client')>(), apiRequest: vi.fn() }));
const read = vi.mocked(apiRequest);
const realClient = await vi.importActual<typeof import('../api/client')>('../api/client');
const homeId = '11111111-1111-4111-8111-111111111111';
const targetId = '22222222-2222-4222-8222-222222222222';
const actorId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const attemptId = '33333333-3333-4333-8333-333333333333';
const otherAttempt = '44444444-4444-4444-8444-444444444444';
const home = { id: homeId, code: 'HOME', name: '会话组织', type: 'INTERNAL', status: 'ACTIVE', configurationRequired: false } as const;
const target = { ...home, id: targetId, code: 'TARGET', name: '目标组织' };
const time = '2026-10-30T04:00:00.000Z';
function context(platform = true): ConsoleContext {
  return { actor: { id: actorId, accountType: 'INTERNAL', homeOrganization: home }, targetOrganization: target, organizations: [home, target], hasPlatformAdministrator: platform,
    modules: [{ key: 'data-exchanges', scope: 'TARGET', coverage: 'ORGANIZATION', organizationId: targetId, permissions: ['console:exchanges:read'] }] };
}
function attempt(overrides: Partial<Attempt> = {}): Attempt {
  return { id: attemptId, organizationId: mocks.context.targetOrganization.id, sourceKey: 'TECHNICAL_TEST', direction: 'INBOUND', objectType: 'FIXTURE', level: 'BATCH', correlationId: 'correlation-001', batchId: 'batch-001', attemptNumber: 1,
    stages: { transfer: { outcome: 'SUCCEEDED', observedCount: 12, observedAt: time }, validation: { outcome: 'NOT_REPORTED' }, processing: { outcome: 'FAILED', observedCount: 2, errorCode: 'PROCESSING_FAILED', observedAt: time }, reconciliation: { outcome: 'NOT_REPORTED' } },
    startedAt: time, observedAt: time, finishedAt: null, ...overrides };
}
function result(scope: Page['scope'] = 'ORGANIZATION', overrides: Partial<Page> = {}): Page {
  return { scope, organizationId: mocks.context.targetOrganization.id, connectionStatus: 'REGISTERED', sources: [{ key: 'TECHNICAL_TEST', label: '技术验证来源', directions: ['INBOUND', 'OUTBOUND'], objectTypes: ['FIXTURE'] }], items: [attempt()], total: 1, page: 1, limit: 50,
    from: '2026-10-29T04:00:00.000Z', to: time, asOf: time, summary: { batchAttempts: 7, recordAttempts: 12, transferSucceededBatches: 5, processingFailedBatches: 2, reconciliationSucceededBatches: 0 }, collection: { status: 'UNKNOWN' }, ...overrides };
}
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (error: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function view(strict = false) {
  const tree = () => { const page = <LanguageProvider><ConsoleTheme><MemoryRouter><DataExchangePage /></MemoryRouter></ConsoleTheme></LanguageProvider>; return strict ? <StrictMode>{page}</StrictMode> : page; };
  const rendered = render(tree()); return { ...rendered, update: () => rendered.rerender(tree()) };
}
async function choose(label: string, option: string) {
  fireEvent.mouseDown(screen.getByLabelText(label, { selector: 'input' }));
  fireEvent.click(await screen.findByText(option, { selector: '.ant-select-item-option-content' }));
}
async function openDetails() {
  fireEvent.click(await screen.findByRole('button', { name: '查看批次 batch-001 第 1 次尝试' }));
  const dialog = await screen.findByRole('dialog', { name: '交换尝试详情' });
  await waitFor(() => expect(dialog).toBeVisible());
  return dialog;
}
beforeEach(() => {
  // Ant Design's shared test ID otherwise aliases Select and Modal accessibility labels.
  vi.stubEnv('NODE_ENV', 'development');
  vi.clearAllMocks(); read.mockReset(); localStorage.clear(); mocks.context = context();
  useWorkTabsStore.getState().bindSession(`INTERNAL:${homeId}:${actorId}`);
  read.mockImplementation(async path => path.includes('/attempts/') ? attempt() : result());
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); localStorage.clear(); });

it('reads the verified scope and keeps transfer, business processing and reconciliation facts distinct', async () => {
  view(); const metrics = await screen.findByRole('region', { name: '交换摘要' });
  expect(within(metrics).getByText('批次尝试')).toBeVisible(); expect(within(metrics).getByText('7')).toBeVisible();
  expect(within(metrics).getByText('记录尝试')).toBeVisible(); expect(within(metrics).getByText('12')).toBeVisible();
  expect(within(metrics).getByText('传输成功批次')).toBeVisible();
  expect(within(metrics).getByText('5')).toBeVisible();
  expect(within(metrics).getByText('处理失败批次')).toBeVisible();
  expect(within(metrics).getByText('2')).toBeVisible();
  const table = screen.getByRole('region', { name: '交换尝试记录' });
  expect(table).toHaveTextContent('传输'); expect(table).toHaveTextContent('处理'); expect(table).toHaveTextContent('失败'); expect(table).toHaveTextContent('未报告');
  expect(document.querySelector(`time[datetime="${time}"]`)).toBeInTheDocument();
  const query = new URL(read.mock.calls[0]![0], 'http://localhost').searchParams;
  expect(query.get('scope')).toBe('ORGANIZATION'); expect(query.get('organizationId')).toBe(targetId);
  expect(screen.queryByRole('button', { name: /重放|补传|导出原文/ })).not.toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: '数据交换观测' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: '刷新交换观测' })).toBeEnabled();
});
it('shows a genuine unconnected empty catalogue without claiming zero failures or healthy integration', async () => {
  read.mockResolvedValue(result('ORGANIZATION', { connectionStatus: 'NOT_CONNECTED', sources: [], items: [], total: 0, summary: { batchAttempts: 0, recordAttempts: 0, transferSucceededBatches: 0, processingFailedBatches: 0, reconciliationSucceededBatches: 0 } }));
  view(); expect(await screen.findByText('尚未接入数据交换来源')).toBeVisible();
  expect(screen.getByText('当前范围没有交换观测记录')).toBeVisible();
  expect(screen.getByText(/采集完整性未知/)).toBeVisible();
  expect(screen.queryByRole('table')).not.toBeInTheDocument();
  expect(screen.queryByText('系统健康')).not.toBeInTheDocument(); expect(screen.queryByText('技术验证来源')).not.toBeInTheDocument();
});
it('keeps loading distinct from unknown or empty metadata', () => {
  read.mockReturnValue(deferred<Page>().promise); view();
  expect(screen.getByRole('status', { name: '读取交换观测中' })).toBeVisible(); expect(screen.queryByRole('region', { name: '交换摘要' })).not.toBeInTheDocument();
});
it('does not issue a request without the explicit capability even for a platform marker', () => {
  mocks.context = { ...context(), modules: [] }; view(); expect(screen.getByRole('alert')).toHaveTextContent('交换观测访问已失效或无权限'); expect(read).not.toHaveBeenCalled();
});
it('hides the platform selector for an organization-only reader', async () => {
  mocks.context = context(false); view(); await screen.findByText('batch-001'); expect(screen.queryByRole('combobox', { name: '交换范围' })).not.toBeInTheDocument();
});
it('applies source and paired stage filters, and keeps the same window when paginating attempt totals', async () => {
  read.mockImplementation(async path => result('ORGANIZATION', { page: Number(new URL(path, 'http://localhost').searchParams.get('page') ?? 1), total: 101 }));
  view(); await screen.findByText('batch-001');
  const form = within(screen.getByRole('form', { name: '交换观测筛选' }));
  const selects = Object.fromEntries(['交换来源', '交换方向', '对象类型', '记录层级', '观测阶段', '阶段结果'].map(label => [label, form.getByLabelText(label, { selector: 'input' })]));
  const batch = form.getByLabelText('批次标识', { selector: 'input' });
  const apply = form.getByRole('button', { name: '应用筛选' });
  for (const [label, option] of [['交换来源', '技术验证来源'], ['交换方向', '发出'], ['对象类型', 'FIXTURE'], ['记录层级', '记录'], ['观测阶段', '业务处理'], ['阶段结果', '失败']]) {
    fireEvent.mouseDown(selects[label]!);
    fireEvent.click(await screen.findByText(option!, { selector: '.ant-select-item-option-content' }));
  }
  fireEvent.change(batch, { target: { value: 'batch-001' } });
  fireEvent.click(apply);
  await waitFor(() => expect(read.mock.calls.at(-1)![0]).toContain('outcome=FAILED'));
  const first = new URL(read.mock.calls.at(-1)![0], 'http://localhost').searchParams;
  expect(Object.fromEntries(first)).toMatchObject({ sourceKey: 'TECHNICAL_TEST', direction: 'OUTBOUND', objectType: 'FIXTURE', level: 'RECORD', stage: 'processing', outcome: 'FAILED', batchId: 'batch-001', limit: '50' });
  const next = await screen.findByRole('button', { name: '下一页' });
  await waitFor(() => expect(next).toBeEnabled()); fireEvent.click(next);
  await waitFor(() => expect(read.mock.calls.at(-1)![0]).toContain('page=2'));
  const second = new URL(read.mock.calls.at(-1)![0], 'http://localhost').searchParams;
  expect(second.get('from')).toBe(first.get('from')); expect(second.get('to')).toBe(first.get('to')); expect(screen.getByText(/共 101 个尝试/)).toBeVisible();
});
it('rejects unpaired stage filters and raw URL-like batch input before requesting', async () => {
  view(); await screen.findByText('batch-001'); const calls = read.mock.calls.length;
  await choose('观测阶段', '业务处理'); fireEvent.click(screen.getByRole('button', { name: '应用筛选' }));
  expect(screen.getByText('请选择成对的阶段与结果，并使用不含 URL 或查询参数的批次标识。')).toBeVisible(); expect(read).toHaveBeenCalledTimes(calls);
  await choose('阶段结果', '失败'); fireEvent.change(screen.getByRole('textbox', { name: '批次标识' }), { target: { value: 'batch?token=SECRET' } });
  fireEvent.click(screen.getByRole('button', { name: '应用筛选' })); expect(read).toHaveBeenCalledTimes(calls);
});
it('keeps thirty-day queries inside retention with headroom instead of silently widening server limits', async () => {
  view(); await screen.findByText('batch-001'); const before = Date.now();
  await choose('查询时段', '近 30 天'); fireEvent.click(screen.getByRole('button', { name: '应用筛选' })); await waitFor(() => expect(read.mock.calls.length).toBe(2));
  const query = new URL(read.mock.calls.at(-1)![0], 'http://localhost').searchParams;
  expect(Date.parse(query.get('from')!)).toBeGreaterThan(before - 30 * 86400000); expect(Date.parse(query.get('to')!) - Date.parse(query.get('from')!)).toBeLessThan(30 * 86400000);
});
it('opens read-only attempt detail with its exact scope and no replay or mutation request', async () => {
  view(); const dialog = await openDetails(); expect(await within(dialog).findByText('correlation-001')).toBeVisible();
  expect(within(dialog).getByText('未全部报告终态')).toBeVisible(); expect(within(dialog).getByText('PROCESSING_FAILED')).toBeVisible();
  const path = read.mock.calls.find(([path]) => path.includes('/attempts/'))![0]; const url = new URL(path, 'http://localhost');
  expect(url.pathname).toBe(`/api/v1/admin/console/data-exchanges/attempts/${attemptId}`); expect(url.searchParams.get('organizationId')).toBe(targetId); expect(url.searchParams.get('scope')).toBe('ORGANIZATION');
  expect(read.mock.calls.every(([, init]) => !init?.method || init.method === 'GET')).toBe(true);
});
it('never reopens a closed detail on a late result and lets a new attempt own the modal', async () => {
  const old = deferred<Attempt>(); const current = attempt({ id: otherAttempt, batchId: 'batch-002', correlationId: 'correlation-002' });
  read.mockImplementation(async path => path.includes(`/attempts/${attemptId}`) ? old.promise : path.includes('/attempts/') ? current : result('ORGANIZATION', { items: [attempt(), current], total: 2 }));
  view(); const first = await openDetails(); fireEvent.click(within(first).getByRole('button', { name: '关闭' }));
  fireEvent.click(screen.getByRole('button', { name: '查看批次 batch-002 第 1 次尝试' }));
  const dialog = await screen.findByRole('dialog', { name: '交换尝试详情' });
  await waitFor(() => expect(dialog).toBeVisible()); await within(dialog).findByText('correlation-002');
  await act(async () => old.resolve(attempt({ correlationId: 'OLD_PRIVATE' })));
  expect(within(dialog).queryByText('OLD_PRIVATE')).not.toBeInTheDocument(); expect(within(dialog).getByText('correlation-002')).toBeVisible();
});
it.each([401, 403])('clears both list and detail and invalidates on a current detail %s', async status => {
  read.mockImplementation(async path => { if (path.includes('/attempts/')) throw new ApiError({ code: 'FEATURE_PERMISSION_DENIED', message: 'PRIVATE' }, status); return result(); });
  view(); fireEvent.click(await screen.findByRole('button', { name: '查看批次 batch-001 第 1 次尝试' })); await waitFor(() => expect(mocks.invalidate).toHaveBeenCalledTimes(1));
  expect(screen.queryByText('batch-001')).not.toBeInTheDocument(); expect(screen.queryByRole('dialog')).not.toBeInTheDocument(); expect(screen.getByRole('alert')).toHaveTextContent('交换观测访问已失效或无权限');
});
it('handles actual client 403 broadcast before rejection without accepting another list response', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ code: 'FEATURE_PERMISSION_DENIED', message: 'PRIVATE' }), { status: 403, headers: { 'content-type': 'application/json' } })));
  read.mockImplementation(realClient.apiRequest); view(); expect(await screen.findByRole('alert')).toHaveTextContent('交换观测访问已失效或无权限'); expect(mocks.invalidate).toHaveBeenCalledTimes(1); expect(read).toHaveBeenCalledTimes(1);
});
it('handles an actual detail 403 broadcast before rejection without retaining list or dialog metadata', async () => {
  vi.stubGlobal('fetch', vi.fn(async input => String(input).includes('/attempts/')
    ? new Response(JSON.stringify({ code: 'FEATURE_PERMISSION_DENIED', message: 'PRIVATE' }), { status: 403, headers: { 'content-type': 'application/json' } })
    : new Response(JSON.stringify(result()), { headers: { 'content-type': 'application/json' } })));
  read.mockImplementation(realClient.apiRequest); view(); fireEvent.click(await screen.findByRole('button', { name: '查看批次 batch-001 第 1 次尝试' }));
  await waitFor(() => expect(mocks.invalidate).toHaveBeenCalledTimes(1));
  expect(screen.queryByText('batch-001')).not.toBeInTheDocument(); expect(screen.queryByRole('dialog')).not.toBeInTheDocument(); expect(read).toHaveBeenCalledTimes(2);
});
it('retires a pending detail on a revalidate signal and confirms scope before showing new data', async () => {
  const pending = deferred<Attempt>(); read.mockImplementation(async path => path.includes('/attempts/') ? pending.promise : result()); view(); await openDetails();
  act(() => publishSessionSignal('revalidate')); expect(screen.queryByText('batch-001')).not.toBeInTheDocument();
  await act(async () => pending.resolve(attempt({ correlationId: 'RECHECK_DETAIL_PRIVATE' })));
  await waitFor(() => expect(read.mock.calls.length).toBe(3)); expect(screen.queryByRole('dialog')).not.toBeInTheDocument(); expect(screen.queryByText('RECHECK_DETAIL_PRIVATE')).not.toBeInTheDocument();
});
it('does not let an old organization detail denial invalidate the new scope', async () => {
  const old = deferred<Attempt>(); read.mockImplementation(async path => path.includes('/attempts/') ? old.promise : result()); const page = view(); await openDetails();
  mocks.context = { ...context(), targetOrganization: home, modules: [{ ...context().modules[0]!, organizationId: homeId }] }; page.update();
  await screen.findByText('会话组织 (HOME)'); await screen.findByText('batch-001'); await act(async () => old.reject(new ApiError({ code: 'FEATURE_PERMISSION_DENIED', message: 'OLD' }, 403)));
  expect(mocks.invalidate).not.toHaveBeenCalled(); expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});
it('clears platform-only list and detail as soon as the marker is revoked', async () => {
  read.mockImplementation(async path => path.includes('/attempts/') ? attempt({ organizationId: homeId, correlationId: 'PLATFORM_PRIVATE' }) : new URL(path, 'http://localhost').searchParams.get('scope') === 'PLATFORM' ? result('PLATFORM', { items: [attempt({ organizationId: homeId, correlationId: 'PLATFORM_PRIVATE' })] }) : result());
  const page = view(); await screen.findByText('batch-001'); await choose('交换范围', '平台交换观测'); await screen.findByText('PLATFORM_PRIVATE'); await openDetails();
  mocks.context = context(false); page.update(); expect(screen.queryByText('PLATFORM_PRIVATE')).not.toBeInTheDocument(); expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  await waitFor(() => expect(new URL(read.mock.calls.at(-1)![0], 'http://localhost').searchParams.get('scope')).toBe('ORGANIZATION'));
});
it('rejects late session ABA results and rereads pending successes after revalidation', async () => {
  const old = deferred<Page>(); const second = deferred<Page>(); read.mockReturnValueOnce(old.promise).mockReturnValueOnce(second.promise).mockImplementation(async () => result()); view();
  act(() => { useWorkTabsStore.getState().bindSession('INTERNAL:other:user'); useWorkTabsStore.getState().bindSession(`INTERNAL:${homeId}:${actorId}`); }); await waitFor(() => expect(read.mock.calls.length).toBe(2));
  await act(async () => old.resolve(result('ORGANIZATION', { items: [attempt({ correlationId: 'OLD_PRIVATE' })] })));
  act(() => publishSessionSignal('revalidate')); await act(async () => second.resolve(result('ORGANIZATION', { items: [attempt({ correlationId: 'RECHECK_PRIVATE' })] })));
  await waitFor(() => expect(read.mock.calls.length).toBe(3)); expect(screen.queryByText('OLD_PRIVATE')).not.toBeInTheDocument(); expect(screen.queryByText('RECHECK_PRIVATE')).not.toBeInTheDocument();
});
it('separates network failure, retry and collection unavailability without leaking error details', async () => {
  read.mockRejectedValueOnce(new Error('PRIVATE_STACK')).mockResolvedValueOnce(result('ORGANIZATION', { collection: { status: 'UNAVAILABLE' } })); view();
  expect(await screen.findByRole('alert')).toHaveTextContent('交换观测读取失败'); expect(screen.queryByText('PRIVATE_STACK')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '重试读取' })); expect(await screen.findByText('观测采集不可用')).toBeVisible();
});
it('rejects foreign or forged list and detail scope instead of displaying the metadata', async () => {
  read.mockImplementation(async path => path.includes('/attempts/') ? attempt({ organizationId: homeId, correlationId: 'FOREIGN_PRIVATE' }) : result()); view(); fireEvent.click(await screen.findByRole('button', { name: '查看批次 batch-001 第 1 次尝试' }));
  await waitFor(() => expect(mocks.invalidate).toHaveBeenCalledTimes(1)); expect(screen.queryByText('FOREIGN_PRIVATE')).not.toBeInTheDocument(); expect(screen.queryByText('batch-001')).not.toBeInTheDocument();
});
it('does not expose rows or totals from a foreign list response', async () => {
  read.mockResolvedValue(result('ORGANIZATION', { organizationId: homeId, items: [attempt({ organizationId: homeId, correlationId: 'FOREIGN_LIST_PRIVATE' })] })); view();
  expect(await screen.findByRole('alert')).toHaveTextContent('交换观测访问已失效或无权限'); expect(screen.queryByText('FOREIGN_LIST_PRIVATE')).not.toBeInTheDocument(); expect(screen.queryByRole('region', { name: '交换摘要' })).not.toBeInTheDocument();
});
it('keeps StrictMode and English labels while retiring the discarded first read', async () => {
  localStorage.setItem('qms:locale:v1', 'en-US'); const old = deferred<Page>(); read.mockReturnValueOnce(old.promise).mockImplementation(async () => result()); view(true);
  await screen.findByText('batch-001'); await act(async () => old.resolve(result('ORGANIZATION', { items: [attempt({ correlationId: 'OLD_PRIVATE' })] })));
  expect(screen.queryByText('OLD_PRIVATE')).not.toBeInTheDocument(); expect(screen.getByRole('button', { name: 'Refresh exchange observations' })).toBeVisible();
});
