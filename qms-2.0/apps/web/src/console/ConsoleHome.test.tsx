import { StrictMode } from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConfigProvider } from 'antd';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { components } from '@qms/contracts';
import { ApiError, apiRequest } from '../api/client';
import { publishSessionSignal } from '../features/auth/session-invalidation';
import { useWorkTabsStore } from '../work-tabs/workTabsStore';
import type { ConsoleContext } from './console-navigation';
import { ConsoleHome } from './ConsoleHome';

type Home = components['schemas']['ConsoleHomeDto'];
type Source = components['schemas']['ConsoleHomeSourceDto'];
const mocks = vi.hoisted(() => ({ context: {} as ConsoleContext, refresh: vi.fn(), invalidate: vi.fn() }));
vi.mock('./ConsoleLayout', () => ({ useConsoleContext: () => mocks }));
vi.mock('./ConsoleObservationSummary', () => ({ ConsoleObservationSummary: () => <output aria-label="observation summary mount" /> }));
vi.mock('../api/client', async original => ({ ...await original<typeof import('../api/client')>(), apiRequest: vi.fn() }));
const read = vi.mocked(apiRequest);
const realClient = await vi.importActual<typeof import('../api/client')>('../api/client');
const homeId = '11111111-1111-4111-8111-111111111111';
const targetId = '22222222-2222-4222-8222-222222222222';
const actorId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const home = { id: homeId, code: 'HOME', name: '会话组织', type: 'INTERNAL', status: 'ACTIVE', configurationRequired: false } as const;
const target = { ...home, id: targetId, code: 'TARGET', name: '目标组织' };
const time = '2026-10-30T02:03:04.000Z';
const sourceTime = '2026-10-30T02:03:03.000Z';
function context(): ConsoleContext {
  return { actor: { id: actorId, accountType: 'INTERNAL', homeOrganization: home }, targetOrganization: target, organizations: [home, target], hasPlatformAdministrator: true, modules: [
    { key: 'outbox', scope: 'TARGET', coverage: 'ORGANIZATION', organizationId: targetId, permissions: ['outbox:read'] },
    { key: 'audit', scope: 'TARGET', coverage: 'ORGANIZATION', organizationId: targetId, permissions: ['audit:read'] },
    { key: 'reconfiguration', scope: 'SESSION_HOME', coverage: 'PLATFORM', organizationId: homeId, permissions: ['organization:reconfigure'] },
    { key: 'problem-reconfiguration', scope: 'SESSION_HOME', coverage: 'PLATFORM', organizationId: homeId, permissions: ['organization:reconfigure'] },
    { key: 'workflows', scope: 'SESSION_HOME', coverage: 'ORGANIZATION', organizationId: homeId, permissions: ['workflow:manage'] },
  ] };
}
function item(key: Source['key'] = 'outbox', total = 17): Source {
  return { key, total, status: 'AVAILABLE', scope: key.startsWith('reconfiguration-') ? 'SESSION_HOME' : 'TARGET', coverage: key.startsWith('reconfiguration-') ? 'PLATFORM' : 'ORGANIZATION', organizationId: key.startsWith('reconfiguration-') ? homeId : targetId, completedAt: sourceTime };
}
function result(sources: Source[] = [item()]): Home { return { context: mocks.context, asOf: time, sources }; }
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (error: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function view(strict = false) {
  const tree = () => {
    const page = <ConfigProvider theme={{ token: { motion: false } }}><MemoryRouter><ConsoleHome /></MemoryRouter></ConfigProvider>;
    return strict ? <StrictMode>{page}</StrictMode> : page;
  };
  const rendered = render(tree());
  return { ...rendered, revalidate: () => rendered.rerender(tree()) };
}
beforeEach(() => {
  vi.clearAllMocks(); read.mockReset(); mocks.context = context();
  useWorkTabsStore.getState().bindSession(`INTERNAL:${homeId}:${actorId}`);
  read.mockResolvedValue(result());
});
afterEach(() => vi.unstubAllGlobals());

it('mounts the independently permission-filtered observation summary on the formal home', async () => {
  view();
  expect(await screen.findByLabelText('observation summary mount')).toBeInTheDocument();
});

it('keeps the data scope and source link visible beside the server count', async () => {
  view();
  const card = await screen.findByRole('region', { name: '失败队列' });
  expect(within(card).getByText('17')).toBeVisible();
  expect(within(card).getByText('组织范围')).toBeVisible();
  expect(within(card).getByText('目标组织 (TARGET)')).toBeVisible();
  expect(within(card).getByRole('link', { name: '查看失败队列' })).toBeVisible();
});

it('reads the verified target and shows only server totals with a real source link and server query times', async () => {
  view();
  const card = await screen.findByRole('region', { name: '失败队列' });
  expect(within(card).getByText('17')).toBeInTheDocument();
  expect(within(card).getByRole('link', { name: '查看失败队列' })).toHaveAttribute('href', `/console/outbox?organizationId=${targetId}`);
  expect(read).toHaveBeenCalledWith(`/api/v1/admin/console/home?organizationId=${targetId}`, { signal: expect.any(AbortSignal) });
  expect(document.querySelector(`time[datetime="${time}"]`)).toBeInTheDocument();
  expect(within(card).getByText('组织范围')).toBeVisible();
  expect(within(card).getByText('目标组织 (TARGET)')).toBeInTheDocument();
  expect(within(card).getByText((_, node) => node?.tagName === 'TIME' && node.getAttribute('datetime') === sourceTime)).toBeInTheDocument();
  expect(useWorkTabsStore.getState().tabs).toEqual([]);
});

it('provides an accessible loading state without fake zero totals', async () => {
  read.mockReturnValue(deferred<Home>().promise);
  view();
  expect(screen.getByRole('status', { name: '读取管理事项中' })).toBeInTheDocument();
  expect(screen.queryByText('0')).not.toBeInTheDocument();
  expect(screen.queryByText('17')).not.toBeInTheDocument();
});

it('shows workflow-only empty scope and only actual permitted common entries', async () => {
  mocks.context = { ...context(), hasPlatformAdministrator: false, modules: [context().modules[4]!] };
  read.mockResolvedValue(result([]));
  view();
  expect(await screen.findByText('当前无可汇总事项')).toBeInTheDocument();
  const links = within(screen.getByRole('navigation', { name: '常用入口' })).getAllByRole('link');
  expect(links).toHaveLength(1);
  expect(links[0]).toHaveAttribute('href', `/console/workflows?organizationId=${targetId}`);
  expect(screen.queryByRole('region', { name: '失败队列' })).not.toBeInTheDocument();
  expect(screen.queryByText(/在线服务|成功率|系统健康/)).not.toBeInTheDocument();
});

it('distinguishes platform pending authorization home from organization resource ownership without unsupported kind query', async () => {
  read.mockResolvedValue(result([item('reconfiguration-organizations', 6), item('reconfiguration-departments', 3), item('reconfiguration-positions', 2), item('reconfiguration-users', 9)]));
  view();
  const card = await screen.findByRole('region', { name: '待配置组织' });
  expect(within(card).getByText('平台级目录')).toBeVisible();
  expect(within(card).getByText('授权组织：会话组织 (HOME)')).toBeVisible();
  const links = screen.getAllByRole('link', { name: /查看待配置/ });
  expect(links).toHaveLength(4);
  for (const link of links) expect(link).toHaveAttribute('href', `/console/reconfiguration?organizationId=${targetId}`);
});

it('shows each source failure separately, never its supplied stale total or a fake zero', async () => {
  read.mockResolvedValue(result([item(), { ...item('reconfiguration-users', 9831), status: 'UNAVAILABLE', reasonCode: 'SOURCE_UNAVAILABLE' }]));
  view();
  const failed = await screen.findByRole('region', { name: '待配置用户' });
  expect(within(failed).getByText('来源暂不可用')).toBeInTheDocument();
  expect(within(failed).queryByText('9831')).not.toBeInTheDocument();
  expect(within(failed).queryByText('0')).not.toBeInTheDocument();
  expect(within(screen.getByRole('region', { name: '失败队列' })).getByText('17')).toBeInTheDocument();
});

it('offers explicit parent authorization revalidation for a source authorization change', async () => {
  read.mockResolvedValue(result([{ ...item('audit'), status: 'UNAVAILABLE', reasonCode: 'AUTHORIZATION_CHANGED' }]));
  view();
  const card = await screen.findByRole('region', { name: '最近管理审计' });
  expect(within(card).getByText('来源权限已变化，请重新核验。')).toBeInTheDocument();
  fireEvent.click(within(card).getByRole('button', { name: '重新核验权限' }));
  expect(mocks.refresh).toHaveBeenCalledTimes(1);
  expect(mocks.invalidate).not.toHaveBeenCalled();
});

it('renders recent authorized audit details and bounds precise resource links to internal routes', async () => {
  const audit: Source = { ...item('audit'), total: undefined, items: [
    { id: 'event-a', organizationId: targetId, actorUserId: actorId, actorSummary: { username: '真实审核人', accountType: 'INTERNAL', organizationName: '目标组织' }, action: 'USER_UPDATED', actionLabel: '更新用户', resourceType: 'User', resourceId: actorId, outcome: 'SUCCESS', traceId: 'trace-a', createdAt: sourceTime, metadata: {} },
    { id: 'event-b', organizationId: targetId, actorUserId: null, actorSummary: null, action: 'UNKNOWN_ACTION', actionLabel: 'UNKNOWN_ACTION', resourceType: 'Resource', resourceId: null, outcome: 'DENIED', traceId: 'trace-b', createdAt: sourceTime, metadata: {} },
  ] };
  read.mockResolvedValue(result([audit]));
  view();
  const card = await screen.findByRole('region', { name: '最近管理审计' });
  expect(within(card).getByText('真实审核人')).toBeInTheDocument();
  expect(within(card).getByText('更新用户')).toBeInTheDocument();
  expect(within(card).getByText('系统或历史账号')).toBeInTheDocument();
  expect(within(card).getByRole('link', { name: '查看审计记录 更新用户' })).toHaveAttribute('href', `/console/audit-log?organizationId=${targetId}&resourceType=User&resourceId=${actorId}`);
  expect(within(card).getByRole('link', { name: '查看审计记录 UNKNOWN_ACTION' })).toHaveAttribute('href', `/console/audit-log?organizationId=${targetId}`);
  expect(within(card).queryByText('0')).not.toBeInTheDocument();
});

it('renders audit empty state and does not render ungranted source data even if it is returned', async () => {
  mocks.context = { ...context(), modules: [context().modules[1]!] };
  read.mockResolvedValue(result([{ ...item('audit'), total: undefined, items: [] }, item('outbox', 9382)]));
  view();
  expect(await screen.findByText('当前范围暂无审计记录')).toBeInTheDocument();
  expect(screen.queryByText('9382')).not.toBeInTheDocument();
  expect(screen.queryByRole('region', { name: '失败队列' })).not.toBeInTheDocument();
});

it('retries an overall network error locally without invalidating parent authorization', async () => {
  read.mockRejectedValueOnce(new Error('private-network-debug')).mockResolvedValue(result());
  view();
  expect(await screen.findByText('管理事项读取失败，请重试。')).toBeInTheDocument();
  expect(screen.queryByText('private-network-debug')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '重试读取' }));
  expect(await screen.findByText('17')).toBeInTheDocument();
  expect(mocks.refresh).not.toHaveBeenCalled();
  expect(mocks.invalidate).not.toHaveBeenCalled();
});

it.each([401, 403])('clears prior sensitive data and invalidates the parent after current HTTP %s', async status => {
  view(); await screen.findByText('17');
  read.mockRejectedValueOnce(new ApiError({ code: 'FEATURE_PERMISSION_DENIED', message: 'private denial' }, status));
  fireEvent.click(screen.getByRole('button', { name: '刷新管理事项' }));
  expect(await screen.findByText('管理访问已失效或无权限，请重新核验。')).toBeInTheDocument();
  expect(screen.queryByText('17')).not.toBeInTheDocument();
  expect(screen.queryByRole('navigation', { name: '常用入口' })).not.toBeInTheDocument();
  expect(mocks.invalidate).toHaveBeenCalledTimes(1);
});

it.each([401, 403])('handles current %s from the actual shared API client including its preceding session broadcast', async status => {
  view(); await screen.findByText('17');
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ code: status === 401 ? 'AUTH_SESSION_REQUIRED' : 'FEATURE_PERMISSION_DENIED', message: 'shared-client-denial' }), { status, headers: { 'content-type': 'application/json' } })));
  read.mockImplementationOnce((path, init) => realClient.apiRequest(path, init));
  fireEvent.click(screen.getByRole('button', { name: '刷新管理事项' }));
  expect(await screen.findByText('管理访问已失效或无权限，请重新核验。')).toBeInTheDocument();
  expect(screen.queryByText('17')).not.toBeInTheDocument();
  expect(mocks.invalidate).toHaveBeenCalledTimes(1);
});

it('can retry denied access after explicit parent verification returns the same capabilities in a fresh context', async () => {
  read.mockRejectedValueOnce(new ApiError({ code: 'FEATURE_PERMISSION_DENIED', message: 'denied' }, 403)).mockResolvedValue(result());
  const rendered = view();
  await screen.findByText('管理访问已失效或无权限，请重新核验。');
  fireEvent.click(screen.getByRole('button', { name: '重新核验权限' }));
  expect(mocks.refresh).toHaveBeenCalledTimes(1);
  mocks.context = context(); rendered.revalidate();
  expect(await screen.findByText('17')).toBeInTheDocument();
});

it.each(['actor', 'home', 'target', 'capability'])('refuses a response with mismatched %s projection before showing its data', async mismatch => {
  const payload = structuredClone(result());
  if (mismatch === 'actor') payload.context.actor.id = 'wrong-actor';
  if (mismatch === 'home') payload.context.actor.homeOrganization.id = 'wrong-home';
  if (mismatch === 'target') payload.context.targetOrganization.id = 'wrong-target';
  if (mismatch === 'capability') payload.context.modules = [];
  read.mockResolvedValue(payload);
  view();
  expect(await screen.findByText('管理访问已失效或无权限，请重新核验。')).toBeInTheDocument();
  expect(screen.queryByText('17')).not.toBeInTheDocument();
  expect(mocks.invalidate).toHaveBeenCalledTimes(1);
});

it('aborts StrictMode retired reads and ignores their late denial without invalidating the active page', async () => {
  const old = deferred<Home>(); read.mockReturnValueOnce(old.promise).mockResolvedValue(result());
  view(true);
  await screen.findByText('17');
  expect(read.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
  await act(async () => old.reject(new ApiError({ code: 'AUTH_SESSION_REQUIRED', message: 'old' }, 401)));
  expect(screen.getByText('17')).toBeInTheDocument();
  expect(mocks.invalidate).not.toHaveBeenCalled();
});

it('retires the read synchronously for a batched A to B to A identity transition', async () => {
  const old = deferred<Home>(); read.mockReturnValueOnce(old.promise).mockResolvedValue(result([item('outbox', 23)]));
  view();
  act(() => { useWorkTabsStore.getState().bindSession(`INTERNAL:${homeId}:other`); useWorkTabsStore.getState().bindSession(`INTERNAL:${homeId}:${actorId}`); });
  await screen.findByText('23');
  await act(async () => old.resolve(result([item('outbox', 7319)])));
  expect(screen.queryByText('7319')).not.toBeInTheDocument();
  expect(read.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
});

it('rejects an old target response across target A to B to A without reusing its authorization token', async () => {
  const old = deferred<Home>(); const payload = result([item('outbox', 7319)]);
  read.mockReturnValueOnce(old.promise).mockResolvedValue(result([item('outbox', 23)]));
  const rendered = view();
  mocks.context = { ...context(), targetOrganization: home, modules: [] }; rendered.revalidate();
  mocks.context = context(); rendered.revalidate();
  await screen.findByText('23');
  await act(async () => old.resolve(payload));
  expect(screen.queryByText('7319')).not.toBeInTheDocument();
  expect(mocks.invalidate).not.toHaveBeenCalled();
});

it('preserves the existing content subtree and keyboard focus on same-identity same-capability soft revalidation', async () => {
  const next = deferred<Home>();
  view(); await screen.findByText('17');
  const button = screen.getByRole('button', { name: '刷新管理事项' });
  button.focus();
  const card = screen.getByRole('region', { name: '失败队列' });
  read.mockReturnValueOnce(next.promise);
  act(() => publishSessionSignal('revalidate'));
  await waitFor(() => expect(read).toHaveBeenCalledTimes(2));
  expect(screen.getByRole('region', { name: '失败队列' })).toBe(card);
  expect(document.activeElement).toBe(button);
  await act(async () => next.resolve(result([item('outbox', 24)])));
  expect(screen.getByRole('region', { name: '失败队列' })).toBe(card);
  expect(screen.getByText('24')).toBeInTheDocument();
  expect(document.activeElement).toBe(button);
});

it('keeps keyboard-usable refresh and source links without autofocus or a business tab side effect', async () => {
  const user = userEvent.setup();
  view(); await screen.findByText('17');
  expect(document.activeElement).toBe(document.body);
  await user.tab();
  expect(screen.getByRole('button', { name: '刷新管理事项' })).toHaveFocus();
  await user.tab();
  expect(screen.getByRole('link', { name: '查看失败队列' })).toHaveFocus();
  expect(useWorkTabsStore.getState().tabs).toEqual([]);
});
