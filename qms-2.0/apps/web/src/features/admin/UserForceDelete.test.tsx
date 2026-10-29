import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { registerReauthentication } from '../../api/client';
import { UnsavedChangesProvider, useNavigationGuard } from '../../layouts/UnsavedChanges';
import { useWorkTabsStore } from '../../work-tabs/workTabsStore';
import { UserForceDelete, type UserForceDeleteProps } from './UserForceDelete';
import { UserAdministration } from './UserAdministration';
import type { AdminOrganization } from './admin';

const target = { id: '20000000-0000-4000-8000-000000000001', organizationId: '10000000-0000-4000-8000-000000000001', username: 'alice-private', securityVersion: 7 };
const path = `/api/v1/admin/users/${target.id}?organizationId=${target.organizationId}`;
const result = { userId: target.id, deleted: true, effects: [] };
const session = 'INTERNAL:actor:organization';
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
function setup(overrides: Partial<UserForceDeleteProps> = {}) {
  const props: UserForceDeleteProps = { target, canDelete: true, onDeleted: vi.fn(), onRefresh: vi.fn(), onDenied: vi.fn(), ...overrides };
  const view = render(<UserForceDelete {...props} />);
  return { ...view, props, update: (next: Partial<UserForceDeleteProps>) => view.rerender(<UserForceDelete {...props} {...next} />) };
}
function network(write: (init: RequestInit) => Promise<Response> = async () => json(result)) {
  const fetch = vi.fn(async (_url: string, init: RequestInit = {}) => _url === '/api/v1/auth/csrf' ? json({ csrfToken: 'csrf-private' }) : write(init));
  vi.stubGlobal('fetch', fetch);
  return fetch;
}
async function open() {
  await userEvent.click(screen.getByRole('button', { name: '永久删除用户' }));
  const dialog = await screen.findByRole('dialog');
  await waitFor(() => expect(dialog).toBeVisible());
  return dialog;
}
async function confirm() { await userEvent.click(screen.getByRole('button', { name: /确认永久删除/ })); }
const writes = (fetch: ReturnType<typeof network>) => fetch.mock.calls.filter(([, init]) => init?.method === 'DELETE');
beforeEach(() => { useWorkTabsStore.getState().bindSession(session); });
afterEach(() => { vi.unstubAllGlobals(); useWorkTabsStore.getState().reset(); });

it('uses the profile-owned supplier deletion endpoint with the same real security baseline', async () => {
  const fetch = network();
  const deletePath = '/api/v1/supplier-quality/profiles/profile-a/accounts/portal-user?organizationId=owner';
  const view = setup({ deletePath });
  await open(); await confirm();
  await waitFor(() => expect(view.props.onDeleted).toHaveBeenCalledOnce());
  expect(writes(fetch)).toHaveLength(1);
  expect(writes(fetch)[0][0]).toBe(deletePath);
  expect(JSON.parse(String(writes(fetch)[0][1]?.body))).toEqual({ expectedSecurityVersion: target.securityVersion });
});

it('retires the old unknown command when the profile-owned deletion path changes', async () => {
  const fetch = network(async () => { throw new TypeError('unknown old result'); });
  const view = setup({ deletePath: '/api/v1/supplier-quality/profiles/profile-a/accounts/portal-user?organizationId=owner-a' });
  await open(); await confirm();
  await screen.findByRole('button', { name: '重试确认结果' });
  view.update({ deletePath: '/api/v1/supplier-quality/profiles/profile-b/accounts/portal-user?organizationId=owner-b' });
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '重试确认结果' })).not.toBeInTheDocument();
  expect(writes(fetch)).toHaveLength(1);
});

it.each([400, 422, 429])('retains the original unknown delete across a retry CSRF %s rejection', async status => {
  let csrfCalls = 0, deleteCalls = 0;
  const fetch = vi.fn(async (path: string, init: RequestInit = {}) => {
    if (path.endsWith('/csrf')) return ++csrfCalls === 2 ? json({ code: 'RETRY_CSRF_REJECTED' }, status) : json({ csrfToken: 'csrf-private' });
    if (init.method === 'DELETE' && ++deleteCalls === 1) throw new TypeError('response lost');
    return json(result);
  });
  vi.stubGlobal('fetch', fetch);
  const view = setup();
  await open(); await confirm();
  await userEvent.click(await screen.findByRole('button', { name: '重试确认结果' }));
  await waitFor(() => expect(csrfCalls).toBe(2));
  const retry = screen.getByRole('button', { name: '重试确认结果' });
  await waitFor(() => expect(retry).toBeEnabled());
  await userEvent.click(retry);
  await waitFor(() => expect(view.props.onDeleted).toHaveBeenCalledOnce());
  const commands = fetch.mock.calls.filter(([, init]) => init?.method === 'DELETE');
  expect(commands).toHaveLength(2);
  expect(commands[1][0]).toBe(commands[0][0]);
  expect(commands[1][1]?.body).toBe(commands[0][1]?.body);
  expect(commands[1][1]?.headers).toEqual(commands[0][1]?.headers);
});

it('retains an unknown command across reauthentication without replaying it automatically', async () => {
  let count = 0;
  const fetch = network(async () => {
    count++;
    if (count === 1) throw new TypeError('response lost');
    return count === 2 ? json({ code: 'AUTH_REAUTHENTICATION_REQUIRED' }, 401) : json(result);
  });
  const reauthenticate = vi.fn(async () => {});
  const unregister = registerReauthentication(reauthenticate);
  try {
    const view = setup(); await open(); await confirm();
    await userEvent.click(await screen.findByRole('button', { name: '重试确认结果' }));
    await waitFor(() => expect(reauthenticate).toHaveBeenCalledOnce());
    expect(writes(fetch)).toHaveLength(2);
    expect(await screen.findByText('身份验证已完成，原删除结果仍待核对，请重试原请求。')).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: '重试确认结果' }));
    await waitFor(() => expect(view.props.onDeleted).toHaveBeenCalledOnce());
    const commands = writes(fetch);
    expect(commands).toHaveLength(3);
    for (const command of commands.slice(1)) {
      expect(command[1]?.body).toBe(commands[0][1]?.body);
      expect(command[1]?.headers).toEqual(commands[0][1]?.headers);
    }
  } finally { unregister(); }
});

it('does not expose an action without the explicit capability', () => {
  setup({ canDelete: false });
  expect(screen.queryByRole('button', { name: '永久删除用户' })).not.toBeInTheDocument();
});

it.each([undefined, 0, -1, 1.5, NaN, 2147483648])('never fabricates a missing or invalid security baseline %s', async version => {
  const fetch = network();
  setup({ target: { ...target, securityVersion: version as number } });
  expect(screen.getByRole('button', { name: '永久删除用户' })).toBeDisabled();
  expect(fetch).not.toHaveBeenCalled();
});

it('confirms once, explains credential/appointment revocation and retained history, and cancels without requests', async () => {
  const fetch = network(); setup();
  const dialog = await open();
  expect(within(dialog).getByText(target.username)).toBeVisible();
  expect(within(dialog).getByText(/凭证.*任职/)).toBeVisible();
  expect(within(dialog).getByText(/历史.*签章.*审批/)).toBeVisible();
  expect(within(dialog).queryByRole('textbox')).not.toBeInTheDocument();
  await userEvent.click(within(dialog).getByRole('button', { name: /取\s*消/ }));
  expect(fetch).not.toHaveBeenCalled();
});

it('dispatches DELETE with the real version, target original organization, CSRF and private idempotency key', async () => {
  const fetch = network(); const { props } = setup();
  await open(); await confirm();
  await waitFor(() => expect(props.onDeleted).toHaveBeenCalledOnce());
  expect(writes(fetch)).toHaveLength(1);
  const [url, init] = writes(fetch)[0];
  expect(url).toBe(path);
  expect(JSON.parse(init!.body as string)).toEqual({ expectedSecurityVersion: 7 });
  expect(init).toMatchObject({ credentials: 'include', headers: { 'x-csrf-token': 'csrf-private', 'Idempotency-Key': expect.any(String) } });
  expect(init!.signal).toBeInstanceOf(AbortSignal);
  expect(screen.queryByText('csrf-private')).not.toBeInTheDocument();
});

it('freezes the open baseline despite same-account server updates until explicit refresh', async () => {
  const fetch = network(); const view = setup();
  await open(); view.update({ target: { ...target, securityVersion: 9 } });
  await confirm();
  await waitFor(() => expect(view.props.onDeleted).toHaveBeenCalledOnce());
  expect(JSON.parse(writes(fetch)[0][1]!.body as string)).toEqual({ expectedSecurityVersion: 7 });
});

it('uses the updated server version on a newly opened confirmation after cancellation', async () => {
  const fetch = network(); const view = setup();
  await open(); await userEvent.click(screen.getByRole('button', { name: /取\s*消/ }));
  view.update({ target: { ...target, securityVersion: 9 } });
  await open(); await confirm();
  await waitFor(() => expect(writes(fetch)).toHaveLength(1));
  expect(JSON.parse(writes(fetch)[0][1]!.body as string).expectedSecurityVersion).toBe(9);
});

it.each(['network', 'server'])('requires explicit retry with unchanged body/path/key for unknown %s outcome', async failure => {
  let count = 0;
  const fetch = network(async () => {
    if (++count > 1) return json(result);
    if (failure === 'network') throw new TypeError('private network error');
    return json({ code: 'HTTP_503', message: 'private server error' }, 503);
  });
  const view = setup(); await open(); await confirm();
  expect(await screen.findByText(/删除结果尚未确认/)).toBeVisible();
  view.update({ target: { ...target, securityVersion: 12 } });
  expect(writes(fetch)).toHaveLength(1);
  expect(screen.getByRole('button', { name: '确认永久删除' })).toBeDisabled();
  expect(screen.queryByText(/private .* error/)).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: '重试确认结果' }));
  await waitFor(() => expect(view.props.onDeleted).toHaveBeenCalledOnce());
  const [first, retry] = writes(fetch);
  expect(retry[0]).toBe(first[0]); expect(retry[1]!.body).toBe(first[1]!.body);
  expect(retry[1]!.headers).toEqual(first[1]!.headers);
});

it('never reports a malformed 2xx as success or blindly replays a consumed helper key', async () => {
  const fetch = network(async () => json({ ...result, userId: 'wrong-user' }));
  const { props } = setup(); await open(); await confirm();
  expect(await screen.findByText(/账号版本已变化或删除结果无法核验/)).toBeVisible();
  expect(props.onDeleted).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: '确认永久删除' })).toBeDisabled();
  expect(screen.queryByRole('button', { name: '重试确认结果' })).not.toBeInTheDocument();
  expect(writes(fetch)).toHaveLength(1);
});

it('409 preserves baseline and forbids blind replay until explicit refresh and a new confirmation', async () => {
  let count = 0;
  const fetch = network(async () => ++count === 1 ? json({ code: 'CONCURRENCY_CONFLICT', message: 'private' }, 409) : json(result));
  const view = setup(); await open(); await confirm();
  expect(await screen.findByText(/账号版本已变化/)).toBeVisible();
  expect(view.props.onRefresh).not.toHaveBeenCalled();
  view.update({ target: { ...target, securityVersion: 10 } });
  expect(screen.getByRole('button', { name: '确认永久删除' })).toBeDisabled();
  expect(writes(fetch)).toHaveLength(1);
  await userEvent.click(screen.getByRole('button', { name: '刷新账号后重新确认' }));
  expect(view.props.onRefresh).toHaveBeenCalledOnce();
  await open(); await confirm();
  await waitFor(() => expect(view.props.onDeleted).toHaveBeenCalledOnce());
  expect(JSON.parse(writes(fetch)[1][1]!.body as string)).toEqual({ expectedSecurityVersion: 10 });
  expect((writes(fetch)[1][1]!.headers as Record<string, string>)['Idempotency-Key']).not.toBe((writes(fetch)[0][1]!.headers as Record<string, string>)['Idempotency-Key']);
});

it.each([401, 403])('clears the sensitive modal and delegates %s to the parent', async status => {
  const fetch = network(async () => json({ code: 'FEATURE_PERMISSION_DENIED', message: 'private raw message' }, status));
  const { props } = setup(); await open(); await confirm();
  await waitFor(() => expect(props.onDenied).toHaveBeenCalledWith(expect.objectContaining({ status })));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(screen.queryByText(target.username)).not.toBeInTheDocument();
  expect(props.onDeleted).not.toHaveBeenCalled(); expect(writes(fetch)).toHaveLength(1);
});

it('reauthenticates without automatic replay and requires a fresh user confirmation', async () => {
  let count = 0;
  const fetch = network(async () => ++count === 1 ? json({ code: 'AUTH_REAUTHENTICATION_REQUIRED' }, 401) : json(result));
  const reauth = vi.fn(async () => {}); const unregister = registerReauthentication(reauth);
  try {
    const { props } = setup(); await open(); await confirm();
    await waitFor(() => expect(reauth).toHaveBeenCalledOnce());
    expect(await screen.findByText(/身份验证已完成.*重新确认/)).toBeVisible();
    expect(writes(fetch)).toHaveLength(1); expect(props.onDeleted).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: /取\s*消/ }));
    await open(); await confirm(); await waitFor(() => expect(props.onDeleted).toHaveBeenCalledOnce());
    expect(writes(fetch)).toHaveLength(2);
  } finally { unregister(); }
});

it.each(['session', 'revoke', 'target', 'organization', 'unmount', 'disabled'])('aborts %s during CSRF wait before actual DELETE dispatch', async change => {
  const csrf = deferred<Response>();
  const fetch = vi.fn(async () => csrf.promise); vi.stubGlobal('fetch', fetch);
  const view = setup(); await open(); await confirm();
  await waitFor(() => expect(fetch).toHaveBeenCalledOnce());
  const signal = (fetch.mock.calls as unknown as [string, RequestInit][])[0][1].signal;
  act(() => {
    if (change === 'session') useWorkTabsStore.getState().bindSession('INTERNAL:another:organization');
    if (change === 'revoke') view.update({ canDelete: false });
    if (change === 'target') view.update({ target: { ...target, id: 'another-user' } });
    if (change === 'organization') view.update({ target: { ...target, organizationId: 'deleted-original-org' } });
    if (change === 'unmount') view.unmount();
    if (change === 'disabled') view.update({ disabled: true });
  });
  expect(signal?.aborted).toBe(true);
  await act(async () => csrf.resolve(json({ csrfToken: 'late-token' })));
  expect(fetch).toHaveBeenCalledOnce(); expect(view.props.onDeleted).not.toHaveBeenCalled();
});

it.each([200, 403])('ignores a late old-session %s response even if the principal switches back', async status => {
  const response = deferred<Response>(); const fetch = network(async () => response.promise);
  const view = setup(); await open(); await confirm();
  await waitFor(() => expect(writes(fetch)).toHaveLength(1));
  act(() => { useWorkTabsStore.getState().bindSession('another-actor'); useWorkTabsStore.getState().bindSession(session); });
  await act(async () => response.resolve(status === 200 ? json(result) : json({ code: 'FEATURE_PERMISSION_DENIED' }, status)));
  expect(view.props.onDeleted).not.toHaveBeenCalled(); expect(view.props.onDenied).not.toHaveBeenCalled();
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

it('prevents duplicate confirmation, modal closure and navigation while in flight; protects unknown results', async () => {
  const response = deferred<Response>(); const fetch = network(async () => response.promise); const leave = vi.fn();
  function Leave() { const guard = useNavigationGuard(); return <button onClick={() => guard(leave)}>离开测试</button>; }
  render(<MemoryRouter><UnsavedChangesProvider><Leave /><UserForceDelete target={target} canDelete onDeleted={vi.fn()} /></UnsavedChangesProvider></MemoryRouter>);
  await open(); await confirm(); await confirm();
  expect(writes(fetch)).toHaveLength(1);
  expect(screen.getByRole('button', { name: /取\s*消/ })).toBeDisabled();
  await userEvent.keyboard('{Escape}'); expect(screen.getByRole('dialog')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: '离开测试' })); expect(leave).not.toHaveBeenCalled();
  const unload = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(unload); expect(unload.defaultPrevented).toBe(true);
  await act(async () => response.resolve(json({ code: 'HTTP_503' }, 503)));
  expect(await screen.findByText(/删除结果尚未确认/)).toBeVisible();
  expect(leave).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole('button', { name: '放弃修改' })); expect(leave).toHaveBeenCalledOnce();
});

it('does not reuse an unknown command for a different target', async () => {
  const fetch = network(async () => { throw new TypeError('offline'); });
  const view = setup(); await open(); await confirm(); await screen.findByText(/删除结果尚未确认/);
  view.update({ target: { ...target, id: 'new-target', organizationId: 'original-deleted-org' } });
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  await open(); await confirm(); await screen.findByText(/删除结果尚未确认/);
  expect(writes(fetch)[1][0]).toBe('/api/v1/admin/users/new-target?organizationId=original-deleted-org');
  expect((writes(fetch)[1][1]!.headers as Record<string, string>)['Idempotency-Key']).not.toBe((writes(fetch)[0][1]!.headers as Record<string, string>)['Idempotency-Key']);
});

it('shows safe validation rejection without reporting success or entering unknown retry', async () => {
  network(async () => json({ code: 'VALIDATION_FAILED', message: 'private raw', traceId: 'trace-safe' }, 400));
  const { props } = setup(); await open(); await confirm();
  expect(await screen.findByText('请检查填写内容')).toBeVisible();
  expect(screen.getByText('trace-safe')).toBeVisible();
  expect(screen.queryByText('private raw')).not.toBeInTheDocument(); expect(props.onDeleted).not.toHaveBeenCalled();
  expect(screen.queryByRole('button', { name: '重试确认结果' })).not.toBeInTheDocument();
});

const organization: AdminOrganization = { id: target.organizationId, code: 'A', name: '组织 A', type: 'INTERNAL', permissions: ['account:users:read', 'account:users:status', 'account:users:delete'] };
const directoryUser = { ...target, fullName: null, phone: null, profileVersion: 1, email: null, emailVerifiedAt: null, accountType: 'INTERNAL', status: 'ACTIVE', organization: { id: organization.id, code: 'A', name: organization.name }, mfaEnabled: false, createdAt: '2026-10-29', updatedAt: '2026-10-29' };

it.each([false, true])('mounts the row action only with parent-sanitized lifecycle capability (%s)', async ready => {
  vi.stubGlobal('fetch', vi.fn(async () => json([directoryUser])));
  const sanitized = { ...organization, permissions: organization.permissions.filter(code => ready || code !== 'account:users:delete') };
  const view = render(<UserAdministration organization={sanitized} organizations={[sanitized]} />);
  await screen.findByText(target.username);
  expect(screen.getByRole('button', { name: /^停\s*用$/ })).toBeEnabled();
  expect(!!screen.queryByRole('button', { name: '永久删除用户' })).toBe(ready);
  view.rerender(<UserAdministration organization={{ ...organization, permissions: ['account:users:read', 'account:users:status'] }} organizations={[organization]} />);
  expect(screen.queryByRole('button', { name: '永久删除用户' })).not.toBeInTheDocument();
});

it('mount success refreshes the directory through the existing parent callback', async () => {
  const fetch = vi.fn(async (url: string, init: RequestInit = {}) => {
    if (url === '/api/v1/auth/csrf') return json({ csrfToken: 'token' });
    if (init.method === 'DELETE') return json(result);
    return json([directoryUser]);
  }); vi.stubGlobal('fetch', fetch);
  render(<UserAdministration organization={organization} organizations={[organization]} />);
  await screen.findByText(target.username); await open(); await confirm();
  expect(await screen.findByText('用户已永久删除')).toBeVisible();
  await waitFor(() => expect(fetch.mock.calls.filter(([url]) => url.startsWith('/api/v1/admin/users?'))).toHaveLength(2));
});

it('mount denial reaches the existing parent feedback', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
    if (url === '/api/v1/auth/csrf') return json({ csrfToken: 'token' });
    return init.method === 'DELETE' ? json({ code: 'FEATURE_PERMISSION_DENIED' }, 403) : json([directoryUser]);
  }));
  render(<UserAdministration organization={organization} organizations={[organization]} />);
  await screen.findByText(target.username); await open(); await confirm();
  expect(await screen.findByText('无权执行此操作')).toBeVisible();
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});
