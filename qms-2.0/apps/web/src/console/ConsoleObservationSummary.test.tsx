import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { components } from '@qms/contracts';
import { ApiError, apiRequest } from '../api/client';
import { publishSessionSignal } from '../features/auth/session-invalidation';
import { LanguageProvider } from '../i18n/Language';
import { useWorkTabsStore } from '../work-tabs/workTabsStore';
import { ConsoleTheme } from './ConsoleTheme';
import type { ConsoleContext } from './console-navigation';
import { ConsoleObservationSummary } from './ConsoleObservationSummary';

const mocks = vi.hoisted(() => ({ context: {} as ConsoleContext, refresh: vi.fn(), invalidate: vi.fn() }));
vi.mock('./ConsoleLayout', () => ({ useConsoleContext: () => mocks }));
vi.mock('../api/client', async original => ({ ...await original<typeof import('../api/client')>(), apiRequest: vi.fn() }));
const read = vi.mocked(apiRequest);
const realClient = await vi.importActual<typeof import('../api/client')>('../api/client');
const org = '11111111-1111-4111-8111-111111111111';
const actor = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const time = '2026-10-30T04:00:00.000Z';
const organization = { id: org, code: 'A', name: '组织A', type: 'INTERNAL', status: 'ACTIVE', configurationRequired: false } as const;
const capabilities = [
  { key: 'api-monitoring', permission: 'console:api:read' }, { key: 'data-exchanges', permission: 'console:exchanges:read' }, { key: 'services', permission: 'console:services:read' },
] as const;
function context(): ConsoleContext { return { actor: { id: actor, accountType: 'INTERNAL', homeOrganization: organization }, targetOrganization: organization, organizations: [organization], hasPlatformAdministrator: false,
  modules: capabilities.map(item => ({ key: item.key, scope: 'TARGET', coverage: 'ORGANIZATION', organizationId: org, permissions: [item.permission] })) }; }
function api(requests = 12): components['schemas']['ApiObservationPageDto'] { return { scope: 'ORGANIZATION', organizationId: org, from: '2026-10-29T04:00:00.000Z', to: time, asOf: time, page: 1, limit: 50, total: 0, items: [],
  summary: { requests, errors: 2, durationTotal: 240, durationMax: 80, le50: 10, le200: 2, le1000: 0, le5000: 0, gt5000: 0 }, collector: { status: 'UNKNOWN' } }; }
function exchange(): components['schemas']['DataExchangePageDto'] { return { scope: 'ORGANIZATION', organizationId: org, from: time, to: time, asOf: time, page: 1, limit: 50, total: 0, sources: [], items: [], connectionStatus: 'NOT_CONNECTED', collection: { status: 'UNKNOWN' },
  summary: { batchAttempts: 0, recordAttempts: 0, transferSucceededBatches: 0, processingFailedBatches: 0, reconciliationSucceededBatches: 0 } }; }
function services(): components['schemas']['ServiceOperationsPageDto'] { return { scope: 'ORGANIZATION', organizationId: org, asOf: time, sources: [{ key: 'files', coverage: 'ORGANIZATION', organizationId: org, asOf: time, status: 'RECENT_RESULT', configured: true, results: [{ status: 'FAILED', observedAt: time }] }] }; }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; }
function view() { const tree = () => <LanguageProvider><ConsoleTheme><MemoryRouter><ConsoleObservationSummary /></MemoryRouter></ConsoleTheme></LanguageProvider>; const rendered = render(tree()); return { ...rendered, update: () => rendered.rerender(tree()) }; }
beforeEach(() => { vi.clearAllMocks(); read.mockReset(); localStorage.clear(); mocks.context = context(); useWorkTabsStore.getState().bindSession(`INTERNAL:${org}:${actor}`);
  read.mockImplementation(async path => path.includes('/api-observations?') ? api() : path.includes('/data-exchanges?') ? exchange() : services()); });
afterEach(() => { vi.unstubAllGlobals(); localStorage.clear(); });

it('does not render or query without a matching observation capability', () => {
  mocks.context = { ...context(), modules: [] }; const page = view(); expect(page.container.querySelector('.qms-observation-summary')).toBeNull(); expect(screen.queryByRole('heading', { name: '观测与运行事实' })).not.toBeInTheDocument(); expect(read).not.toHaveBeenCalled();
});
it('reads only authorized organization summaries and separates requests, unconnected exchange and actual service facts', async () => {
  view(); const card = await screen.findByRole('region', { name: 'API 观测摘要' });
  await waitFor(() => expect(within(card).getByText('12')).toBeVisible());
  expect(within(card).getByText('2')).toBeVisible(); expect(within(card).getByText(/采集完整性未知/)).toBeVisible();
  expect(await screen.findByText('尚未接入外部数据来源')).toBeVisible();
  expect(within(screen.getByRole('region', { name: '数据交换摘要' })).queryByText('0')).not.toBeInTheDocument();
  const facts = screen.getByRole('region', { name: '运行服务摘要' }); expect(within(facts).getByText('近期执行事实')).toBeVisible(); expect(within(facts).getByText('执行失败')).toBeVisible();
  expect(read).toHaveBeenCalledTimes(3); for (const [path] of read.mock.calls) { const query = new URL(path, 'http://localhost').searchParams; expect(query.get('organizationId')).toBe(org); expect(query.get('scope')).toBe('ORGANIZATION'); }
  expect(screen.getByRole('link', { name: '查看 API 观测' })).toHaveAttribute('href', `/console/api-monitoring?organizationId=${org}`);
  expect(document.querySelector(`time[datetime="${time}"]`)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '刷新观测摘要' })).toBeEnabled();
  expect(within(card).getByRole('link', { name: '查看 API 观测' })).toBeVisible();
});
it('does not request or link modules outside the caller capability', async () => {
  mocks.context = { ...context(), modules: context().modules.slice(0, 1) }; view(); await screen.findByText('12');
  expect(read).toHaveBeenCalledTimes(1); expect(screen.queryByRole('region', { name: '数据交换摘要' })).not.toBeInTheDocument(); expect(screen.queryByRole('link', { name: '查看运行服务' })).not.toBeInTheDocument();
});
it('keeps a failed source unavailable without replacing it with zero or hiding successful sources', async () => {
  read.mockImplementation(async path => { if (path.includes('/api-observations?')) throw new Error('PRIVATE_DATABASE'); return path.includes('/data-exchanges?') ? exchange() : services(); });
  view(); const apiCard = await screen.findByRole('region', { name: 'API 观测摘要' }); await waitFor(() => expect(within(apiCard).getByText('此来源暂不可读取')).toBeVisible());
  expect(within(apiCard).queryByText('0')).not.toBeInTheDocument(); expect(screen.queryByText('PRIVATE_DATABASE')).not.toBeInTheDocument(); expect(await screen.findByText('尚未接入外部数据来源')).toBeVisible();
});
it('clears all observation summaries on a current forbidden read', async () => {
  read.mockImplementation(async path => { if (path.includes('/api-observations?')) throw new ApiError({ code: 'FEATURE_PERMISSION_DENIED', message: 'PRIVATE' }, 403); return services(); });
  view(); expect(await screen.findByRole('alert')).toHaveTextContent('观测摘要访问已失效'); expect(mocks.invalidate).toHaveBeenCalledTimes(1); expect(screen.queryByRole('region', { name: '运行服务摘要' })).not.toBeInTheDocument();
});
it('handles the real client revalidate-before-reject ordering without retrying a forbidden summary', async () => {
  mocks.context = { ...context(), modules: context().modules.slice(0, 1) };
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ code: 'FEATURE_PERMISSION_DENIED', message: 'PRIVATE' }), { status: 403, headers: { 'content-type': 'application/json' } })));
  read.mockImplementation(realClient.apiRequest); view(); expect(await screen.findByRole('alert')).toHaveTextContent('观测摘要访问已失效'); expect(read).toHaveBeenCalledTimes(1); expect(mocks.invalidate).toHaveBeenCalledTimes(1);
});
it('rejects foreign summary scope and never displays its counts', async () => {
  mocks.context = { ...context(), modules: context().modules.slice(0, 1) }; read.mockResolvedValue({ ...api(98765), organizationId: actor }); view();
  expect(await screen.findByRole('alert')).toHaveTextContent('观测摘要访问已失效'); expect(screen.queryByText('98765')).not.toBeInTheDocument();
});
it('retires pending results across session ABA and revalidates before accepting a signaled read', async () => {
  mocks.context = { ...context(), modules: context().modules.slice(0, 1) }; const old = deferred<ReturnType<typeof api>>(), pending = deferred<ReturnType<typeof api>>();
  read.mockReturnValueOnce(old.promise).mockReturnValueOnce(pending.promise).mockResolvedValue(api()); view();
  act(() => { useWorkTabsStore.getState().bindSession('INTERNAL:foreign:person'); useWorkTabsStore.getState().bindSession(`INTERNAL:${org}:${actor}`); }); await waitFor(() => expect(read.mock.calls.length).toBe(2));
  await act(async () => old.resolve(api(54321))); expect(screen.queryByText('54321')).not.toBeInTheDocument(); act(() => publishSessionSignal('revalidate'));
  await act(async () => pending.resolve(api(45678))); await waitFor(() => expect(read.mock.calls.length).toBe(3)); expect(screen.queryByText('45678')).not.toBeInTheDocument();
});
