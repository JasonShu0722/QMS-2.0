import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { LanguageProvider } from '../../i18n/Language';
import { UnsavedChangesProvider } from '../../layouts/UnsavedChanges';
import { useWorkTabsStore } from '../../work-tabs/workTabsStore';
import { ConsoleTheme } from '../ConsoleTheme';
import type { ConsoleContext } from '../console-navigation';
import { ApiIntegrationsPage } from './ApiIntegrationsPage';
import type { Endpoint } from './integration-ui';

const mocks = vi.hoisted(() => ({ context: {} as ConsoleContext, invalidate: vi.fn() }));
vi.mock('../ConsoleLayout', () => ({ useConsoleContext: () => mocks }));
const fetcher = vi.fn<typeof fetch>();
const homeId = '11111111-1111-4111-8111-111111111111';
const targetId = '22222222-2222-4222-8222-222222222222';
const actorId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const endpointId = '33333333-3333-4333-8333-333333333333';
const integrationPath = '/api/v1/admin/integrations/endpoints';
const home = { id: homeId, code: 'HOME', name: '会话组织', type: 'INTERNAL', status: 'ACTIVE', configurationRequired: false } as const;
const target = { ...home, id: targetId, code: 'TARGET', name: '目标组织' };
const endpoint: Endpoint = { id: endpointId, organizationId: targetId, code: 'MES_QUALITY', name: 'MES质量推送', description: '', sourceCode: 'MES', sourceName: '制造系统', status: 'ENABLED', version: 7,
  returnReceipt: true, maxBodyBytes: 1048576, ratePerMinute: 60, bodyRetentionDays: 7, capacityBytes: 268435456, usedBodyBytes: 0, allowedIps: [],
  createdAt: '2026-11-09T03:00:00.000Z', updatedAt: '2026-11-09T03:00:00.000Z', publicUrl: 'https://qms.example.test/receive' };
const otherEndpoint: Endpoint = { ...endpoint, id: '44444444-4444-4444-8444-444444444444', code: 'IMS', name: 'IMS推送' };
let items: Endpoint[];
let remove: () => Promise<Response>;
let releasePending: (() => void) | undefined;
function context(permissions = ['integration:read', 'integration:manage', 'integration:credentials:manage']): ConsoleContext {
  return { actor: { id: actorId, accountType: 'INTERNAL', homeOrganization: home }, targetOrganization: target, organizations: [home, target], hasPlatformAdministrator: true,
    modules: [{ key: 'api-integrations', scope: 'TARGET', coverage: 'ORGANIZATION', organizationId: targetId, permissions }] };
}
function json(value: unknown, status = 200) { return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } }); }
function view() {
  const tree = () => <LanguageProvider><ConsoleTheme><MemoryRouter><UnsavedChangesProvider><ApiIntegrationsPage /></UnsavedChangesProvider></MemoryRouter></ConsoleTheme></LanguageProvider>;
  const result = render(tree()); return { ...result, update: () => result.rerender(tree()) };
}
const deletes = () => fetcher.mock.calls.filter(([, init]) => init?.method === 'DELETE');
async function confirmDelete() {
  fireEvent.click(await screen.findByLabelText('删除MES质量推送'));
  const popup = await screen.findByRole('tooltip');
  await waitFor(() => expect(popup).toBeVisible());
  expect(popup).toHaveTextContent('停止接收'); expect(popup).toHaveTextContent('撤销'); expect(popup).toHaveTextContent('保留历史');
  const confirm = within(popup).getByRole('button', { name: '确认删除' });
  fireEvent.click(confirm); return confirm;
}
beforeEach(() => {
  vi.stubEnv('NODE_ENV', 'development'); vi.clearAllMocks(); fetcher.mockReset(); vi.stubGlobal('fetch', fetcher);
  mocks.context = context(); items = [endpoint, otherEndpoint]; releasePending = undefined;
  useWorkTabsStore.getState().bindSession(`INTERNAL:${homeId}:${actorId}`);
  remove = async () => { items = [otherEndpoint]; return new Response(null, { status: 204 }); };
  fetcher.mockImplementation(async (input, init) => {
    const url = String(input);
    if (url === '/api/v1/auth/csrf') return json({ csrfToken: 'fixture-csrf' });
    if (init?.method === 'DELETE') return remove();
    if (url.startsWith(`${integrationPath}?`)) return json({ items, total: 21, page: 1, limit: 20 });
    throw new Error(`Unexpected request: ${url}`);
  });
});
afterEach(async () => { await act(async () => releasePending?.()); vi.unstubAllEnvs(); vi.unstubAllGlobals(); localStorage.clear(); });

it('offers one dangerous deletion confirmation only to integration managers and cancel sends nothing', async () => {
  view(); const button = await screen.findByLabelText('删除MES质量推送');
  expect(button).toHaveClass('ant-btn-dangerous'); fireEvent.click(button);
  const popup = await screen.findByRole('tooltip'); await waitFor(() => expect(popup).toBeVisible());
  expect(popup).toHaveTextContent('停止接收'); expect(popup).toHaveTextContent('撤销'); expect(popup).toHaveTextContent('保留历史');
  fireEvent.click(within(popup).getByRole('button', { name: '取消' })); expect(deletes()).toHaveLength(0);
  expect(screen.getByText('MES质量推送')).toBeVisible();
});

it('hides deletion from read-only users', async () => {
  mocks.context = context(['integration:read']); view(); await screen.findByText('MES质量推送');
  expect(screen.queryByRole('button', { name: /删除/ })).not.toBeInTheDocument();
});

it('deletes with the target organization and original version then refreshes and closes its instructions', async () => {
  view(); fireEvent.click(await screen.findByLabelText('查看MES质量推送调用说明'));
  expect(screen.getByRole('region', { name: '调用说明' })).toBeVisible();
  await confirmDelete();
  await waitFor(() => expect(screen.queryByText('MES质量推送')).not.toBeInTheDocument());
  expect(deletes()).toHaveLength(1);
  const [path, init] = deletes()[0]!;
  expect(path).toBe(`${integrationPath}/${endpointId}`);
  expect(JSON.parse(String(init?.body))).toEqual({ organizationId: targetId, expectedVersion: 7 });
  expect(init?.headers).toMatchObject({ 'x-csrf-token': 'fixture-csrf', 'Idempotency-Key': expect.any(String) });
  expect(screen.queryByRole('region', { name: '调用说明' })).not.toBeInTheDocument();
});

it('retains an unknown result and retries the exact request and idempotency key while freezing other operations', async () => {
  remove = async () => { throw new TypeError('network lost'); }; view(); await confirmDelete();
  const retry = await screen.findByLabelText('重试删除MES质量推送');
  expect(screen.getByText('MES质量推送')).toBeVisible();
  expect(screen.getByRole('alert')).toHaveTextContent('删除结果未确认');
  for (const name of ['新增接收接口', '刷新接口']) expect(screen.getByText(name).closest('button')).toBeDisabled();
  for (const name of ['删除IMS推送', '编辑IMS推送', '管理IMS推送凭据']) expect(screen.getByLabelText(name)).toBeDisabled();
  fireEvent.click(screen.getByText('发出接口'));
  expect(screen.queryByText('后续开放')).not.toBeInTheDocument();
  const unload = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(unload); expect(unload.defaultPrevented).toBe(true);
  remove = async () => { items = [otherEndpoint]; return new Response(null, { status: 204 }); };
  fireEvent.click(retry);
  await waitFor(() => expect(deletes()).toHaveLength(2));
  expect(deletes()[1]![0]).toBe(deletes()[0]![0]);
  expect(deletes()[1]![1]?.body).toBe(deletes()[0]![1]?.body);
  expect(deletes()[1]![1]?.headers).toEqual(deletes()[0]![1]?.headers);
  await waitFor(() => expect(screen.queryByText('MES质量推送')).not.toBeInTheDocument());
});

it('keeps pending deletion busy and rejects duplicate confirmation and page changes', async () => {
  let resolve!: (response: Response) => void;
  remove = () => new Promise(done => { resolve = done; releasePending = () => done(new Response(null, { status: 204 })); });
  try {
    view(); const confirm = await confirmDelete(); await waitFor(() => expect(deletes()).toHaveLength(1));
    fireEvent.click(confirm); fireEvent.click(confirm);
    expect(deletes()).toHaveLength(1); expect(screen.getByText('刷新接口').closest('button')).toBeDisabled();
    const reads = fetcher.mock.calls.filter(([input]) => String(input).startsWith(`${integrationPath}?`)).length;
    const nextPage = document.querySelector<HTMLButtonElement>('.qms-integration-section .ant-pagination-next button');
    expect(nextPage).toBeInTheDocument(); expect(nextPage!.closest('.ant-pagination')).toHaveClass('ant-pagination-disabled'); fireEvent.click(nextPage!);
    expect(fetcher.mock.calls.filter(([input]) => String(input).startsWith(`${integrationPath}?`))).toHaveLength(reads);
    fireEvent.click(screen.getByText('发出接口')); expect(screen.queryByText('后续开放')).not.toBeInTheDocument();
    items = [otherEndpoint]; await act(async () => resolve(new Response(null, { status: 204 })));
  } finally { await act(async () => releasePending?.()); }
});

it('keeps the row after a confirmed conflict and permits refresh without treating it as an unknown outcome', async () => {
  remove = async () => json({ code: 'CONCURRENCY_CONFLICT', message: 'conflict', traceId: 'fixture-trace' }, 409);
  view(); await confirmDelete();
  expect(await screen.findByRole('alert')).toHaveTextContent('配置已变化');
  expect(screen.getByText('MES质量推送')).toBeVisible(); expect(screen.getByText('刷新接口').closest('button')).toBeEnabled();
  expect(screen.queryByLabelText('重试删除MES质量推送')).not.toBeInTheDocument();
});

it.each(['session ABA', 'lost permission'])('rejects a late deletion response after %s', async reason => {
  let resolve!: (response: Response) => void;
  remove = () => new Promise(done => { resolve = done; releasePending = () => done(new Response(null, { status: 204 })); });
  try {
    const rendered = view(); await confirmDelete(); await waitFor(() => expect(deletes()).toHaveLength(1));
    const signal = deletes()[0]![1]?.signal;
    if (reason === 'session ABA') act(() => { useWorkTabsStore.getState().bindSession(`INTERNAL:${homeId}:other`); useWorkTabsStore.getState().bindSession(`INTERNAL:${homeId}:${actorId}`); });
    else { mocks.context = context(['integration:read']); rendered.update(); }
    expect(signal?.aborted).toBe(true);
    const requestsBeforeLateResult = fetcher.mock.calls.length;
    await act(async () => resolve(new Response(null, { status: 204 })));
    expect(fetcher.mock.calls).toHaveLength(requestsBeforeLateResult);
    expect(screen.queryByLabelText('重试删除MES质量推送')).not.toBeInTheDocument();
  } finally { await act(async () => releasePending?.()); }
});
