import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { ApiError, apiRequest, createAdminMutation, login, logout } from '../../api/client';
import { ReauthenticationProvider } from './ReauthenticationProvider';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { AuthenticatedRoute } from './AuthenticatedRoute';
import { publishSessionSignal, sessionSignalVersion } from './session-invalidation';
import { useWorkTabsStore } from '../../work-tabs/workTabsStore';
import { accountAvatarEpoch } from '../account/account-avatar-state';
import { Drawer, Modal } from 'antd';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
Object.defineProperties(HTMLDialogElement.prototype, { showModal: { configurable: true, writable: true, value(this: HTMLDialogElement) { this.setAttribute('open', ''); } }, close: { configurable: true, writable: true, value(this: HTMLDialogElement) { this.removeAttribute('open'); } } });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

async function pendingReauthentication() {
  let finish!: (response: Response) => void;
  const response = new Promise<Response>(resolve => { finish = resolve; });
  const fetcher = vi.fn(async (path: string) => path.endsWith('/csrf') ? json({ csrfToken: 'csrf' })
    : path.endsWith('/reauthenticate') ? (await response).clone() : json({ code: 'AUTH_REAUTHENTICATION_REQUIRED' }, 403));
  vi.stubGlobal('fetch', fetcher);
  const view = render(<ReauthenticationProvider><span>Application</span></ReauthenticationProvider>);
  const resolved = vi.fn();
  const rejected = vi.fn();
  const operation = apiRequest('/api/v1/test/guarded', { method: 'POST', body: '{}' }).then(resolved, rejected);
  const dialog = await screen.findByRole('dialog', { name: '重新验证身份' });
  const content = within(dialog);
  fireEvent.change(content.getByLabelText('当前密码'), { target: { value: 'only-in-memory-password' } });
  fireEvent.change(content.getByLabelText('验证码或恢复码'), { target: { value: '123456' } });
  const form = content.getByLabelText('当前密码').closest('form')!;
  return { view, dialog, content, form, finish, operation, rejected, resolved, writes: () => fetcher.mock.calls.filter(([path]) => path.endsWith('/reauthenticate')), guardedWrites: () => fetcher.mock.calls.filter(([path]) => path.endsWith('/guarded')) };
}

it('rejects cancelled reauthentication as a known local cancellation without replaying the business write', async () => {
  const { view, content, operation, rejected, resolved, writes, guardedWrites } = await pendingReauthentication();
  try {
    await userEvent.click(content.getByRole('button', { name: /取\s*消/ }));
    await operation;
    expect(rejected).toHaveBeenCalledTimes(1);
    expect(rejected.mock.calls[0]![0]).toBeInstanceOf(ApiError);
    expect(rejected.mock.calls[0]![0]).toMatchObject({ code: 'CLIENT_REAUTHENTICATION_CANCELLED', status: 400 });
    expect(resolved).not.toHaveBeenCalled();
    expect(writes()).toHaveLength(0);
    expect(guardedWrites()).toHaveLength(1);
    expect(screen.queryByLabelText('当前密码')).not.toBeInTheDocument();
  } finally {
    view.unmount();
    await operation;
  }
});

it('keeps reauthentication inputs frozen while pending and retains them after a safe failure', async () => {
  const { view, content, form, finish, operation, writes } = await pendingReauthentication();
  try {
    fireEvent.submit(form);
    await waitFor(() => expect(writes()).toHaveLength(1));
    for (const label of ['当前密码', '验证码或恢复码']) expect(content.getByLabelText(label)).toBeDisabled();
    await userEvent.type(content.getByLabelText('当前密码'), 'changed');
    expect(content.getByLabelText('当前密码')).toHaveValue('only-in-memory-password');
    await act(async () => finish(json({ code: 'AUTH_MFA_CODE_INVALID', message: 'private server details' }, 401)));
    expect(await content.findByText('验证码无效或已使用，请使用新的验证码')).toBeInTheDocument();
    expect(content.queryByText('private server details')).not.toBeInTheDocument();
    expect(content.getByLabelText('当前密码')).toHaveValue('only-in-memory-password');
    expect(content.getByLabelText('验证码或恢复码')).toHaveValue('123456');
    expect(content.getByLabelText('当前密码')).toBeEnabled();
  } finally {
    view.unmount();
    await operation;
  }
});

it.each(['modal', 'drawer', 'unsaved'] as const)('keeps reauthentication above %s overlays and resumes the original mutation after success', async overlay => {
  let recent = false;
  const mutations: RequestInit[] = [];
  vi.stubGlobal('fetch', vi.fn(async (path: string, init?: RequestInit) => {
    if (path.endsWith('/csrf')) return json({ csrfToken: 'csrf' });
    if (path.endsWith('/reauthenticate')) { recent = true; return json({}); }
    mutations.push(init!);
    return recent ? json({ saved: true }) : json({ code: 'AUTH_REAUTHENTICATION_REQUIRED' }, 403);
  }));
  const action = <Modal open title="暂停确认" zIndex={overlay === 'unsaved' ? 2000 : undefined} footer={null}><p>暂停当前任务</p></Modal>;
  const view = render(<ReauthenticationProvider>{overlay === 'drawer' ? <Drawer open title="任务详情">{action}</Drawer> : <Modal open title="任务详情" footer={null}>{action}</Modal>}</ReauthenticationProvider>);
  const operation = createAdminMutation()('/api/v1/admin/users/user', 'PATCH', { email: 'updated@example.test' });
  const settled = operation.then(value => ({ value }), error => ({ error }));
  try {
    const password = await screen.findByLabelText('当前密码');
    const dialog = password.closest<HTMLElement>('[role="dialog"]')!;
    const wrapper = dialog.closest<HTMLElement>('.ant-modal-wrap')!;
    const mask = wrapper.parentElement!.querySelector<HTMLElement>('.ant-modal-mask')!;
    const underlyingLayers = [...document.querySelectorAll<HTMLElement>('.ant-modal-wrap, .ant-drawer')].filter(element => element !== wrapper);
    for (const layer of underlyingLayers) {
      const layerIndex = Number(layer.style.zIndex || 1000);
      expect(Number(wrapper.style.zIndex || 1000)).toBeGreaterThan(layerIndex);
      expect(Number(mask.style.zIndex || 1000)).toBeGreaterThan(layerIndex);
    }
    const content = within(dialog);
    await userEvent.click(content.getByLabelText('当前密码'));
    expect(content.getByLabelText('当前密码')).toHaveFocus();
    await userEvent.type(content.getByLabelText('当前密码'), 'only-in-memory-password');
    fireEvent.submit(content.getByLabelText('当前密码').closest('form')!);
    expect(await settled).toEqual({ value: { saved: true } });
    await waitFor(() => expect(password).not.toBeInTheDocument());
    expect(mutations).toHaveLength(2);
    expect(mutations[1]!.body).toBe(mutations[0]!.body);
    expect((mutations[1]!.headers as Record<string, string>)['Idempotency-Key']).toBe((mutations[0]!.headers as Record<string, string>)['Idempotency-Key']);
    expect(screen.getByText('暂停当前任务')).toBeVisible();
  } finally {
    view.unmount();
    await settled;
  }
});

it('sends one reauthentication request for repeated form submissions while pending', async () => {
  const { view, form, finish, operation, writes } = await pendingReauthentication();
  try {
    await act(async () => { fireEvent.submit(form); fireEvent.submit(form); });
    await waitFor(() => expect(writes().length).toBeGreaterThan(0));
    await act(async () => { fireEvent.submit(form); });
    await act(async () => finish(json({ code: 'AUTH_MFA_CODE_INVALID' }, 401)));
    await screen.findByText('验证码无效或已使用，请使用新的验证码');
    expect(writes()).toHaveLength(1);
  } finally {
    view.unmount();
    await operation;
  }
});

it('blocks cancel and Escape while a reauthentication write is pending', async () => {
  const { view, dialog, content, form, finish, operation, rejected, resolved, writes } = await pendingReauthentication();
  try {
    fireEvent.submit(form);
    await waitFor(() => expect(writes()).toHaveLength(1));
    try {
      expect(content.getByRole('button', { name: /取\s*消/ })).toBeDisabled();
      await userEvent.click(content.getByRole('button', { name: /取\s*消/ }));
      fireEvent.keyDown(content.getByLabelText('当前密码'), { key: 'Escape', code: 'Escape', keyCode: 27 });
      await act(async () => {});
      expect(dialog).toBeVisible();
      expect(content.getByLabelText('当前密码')).toHaveValue('only-in-memory-password');
      expect(rejected).not.toHaveBeenCalled();
      expect(resolved).not.toHaveBeenCalled();
    } finally {
      await act(async () => finish(json({ code: 'AUTH_MFA_CODE_INVALID' }, 401)));
    }
  } finally {
    view.unmount();
    await operation;
  }
});

async function globalPrompt() {
  useWorkTabsStore.getState().reset();
  let actor = 'a';
  const attempts: { finish: (value: Response) => void; signal?: AbortSignal | null }[] = [];
  const mutations: RequestInit[] = [];
  const failures: unknown[] = [];
  vi.stubGlobal('fetch', vi.fn(async (path: string, init?: RequestInit) => {
    if (path.endsWith('/auth/session')) return json({ user: { id: actor, organizationId: 'org', accountType: 'INTERNAL' }, landingPath: '/app/workbench', securityState: 'AUTHENTICATED' });
    if (path.endsWith('/csrf')) return json({ csrfToken: 'csrf' });
    if (path.endsWith('/reauthenticate')) return new Promise<Response>(finish => attempts.push({ finish, signal: init?.signal }));
    mutations.push(init!); return json({ code: 'AUTH_REAUTHENTICATION_REQUIRED' }, 403);
  }));
  function Action() { return <button onClick={() => void createAdminMutation()('/api/v1/admin/users/user', 'PATCH', { email: `${actor}@example.test` }).catch(error => { failures.push(error); })}>Guarded mutation</button>; }
  const view = render(<MemoryRouter><ReauthenticationProvider><AuthenticatedRoute accountType="INTERNAL"><Action /></AuthenticatedRoute></ReauthenticationProvider></MemoryRouter>);
  await screen.findByRole('button', { name: 'Guarded mutation' });
  const open = async (password: string) => {
    fireEvent.click(screen.getByRole('button', { name: 'Guarded mutation' }));
    fireEvent.change(await screen.findByLabelText('当前密码'), { target: { value: password } });
    fireEvent.change(screen.getByLabelText('验证码或恢复码'), { target: { value: '123456' } });
  };
  const submit = () => fireEvent.submit(screen.getByLabelText('当前密码').closest('form')!);
  const switchActor = async (hard = true) => {
    actor = 'b'; act(() => { if (hard) publishSessionSignal('invalidate'); else window.dispatchEvent(new Event('focus')); });
    await waitFor(() => expect(useWorkTabsStore.getState().sessionScope).toBe('INTERNAL:org:b'));
  };
  return { view, open, submit, switchActor, attempts, mutations, failures };
}

it.each(['hard', 'focus'] as const)('clears the global provider password, factor and pending prompt when %s detects a changed protected actor', async kind => {
  const fixture = await globalPrompt();
  try {
    await fixture.open('secret-a'); const version = sessionSignalVersion(); await fixture.switchActor(kind === 'hard');
    expect(sessionSignalVersion()).toBe(version + 1);
    await waitFor(() => expect(screen.queryByLabelText('当前密码')).not.toBeInTheDocument());
    expect(screen.queryByDisplayValue('secret-a')).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue('123456')).not.toBeInTheDocument();
    await waitFor(() => expect(fixture.failures).toHaveLength(1));
    expect(fixture.failures[0]).toMatchObject({ name: 'AbortError' });
    expect(fixture.mutations).toHaveLength(1);
    await fixture.open('secret-b');
    expect(screen.getByLabelText('当前密码')).toHaveValue('secret-b');
  } finally { fixture.view.unmount(); }
});

it.each(['success', 'failure'] as const)('does not let late A %s/finally overwrite the new global B prompt', async outcome => {
  const fixture = await globalPrompt();
  try {
    await fixture.open('secret-a'); fixture.submit(); await waitFor(() => expect(fixture.attempts).toHaveLength(1));
    await fixture.switchActor();
    await fixture.open('secret-b'); fixture.submit(); await waitFor(() => expect(fixture.attempts).toHaveLength(2));
    if (outcome === 'failure') {
      await act(async () => fixture.attempts[1]!.finish(json({ code: 'AUTH_MFA_CODE_INVALID' }, 401)));
      expect(await screen.findByText('验证码无效或已使用，请使用新的验证码')).toBeInTheDocument();
    }
    await act(async () => fixture.attempts[0]!.finish(json(outcome === 'success' ? {} : { code: 'HTTP_500' }, outcome === 'success' ? 200 : 500)));
    expect(screen.getByLabelText('当前密码')).toHaveValue('secret-b');
    expect(screen.getByLabelText('验证码或恢复码')).toHaveValue('123456');
    if (outcome === 'success') expect(screen.getByLabelText('当前密码')).toBeDisabled();
    else expect(screen.getByText('验证码无效或已使用，请使用新的验证码')).toBeInTheDocument();
    expect(fixture.attempts[0]!.signal?.aborted).toBe(true);
    expect(fixture.mutations).toHaveLength(2);
  } finally { fixture.view.unmount(); }
});

it('clears the old session binding and avatar epoch on hard invalidation without an AuthRoute', () => {
  useWorkTabsStore.getState().bindSession('INTERNAL:org:a');
  const avatar = accountAvatarEpoch();
  render(<ReauthenticationProvider><p>Public route</p></ReauthenticationProvider>);
  act(() => publishSessionSignal('invalidate'));
  expect(useWorkTabsStore.getState().sessionScope).toBeUndefined();
  expect(accountAvatarEpoch()).toBe(avatar + 1);
});

it('does not reset a valid binding on soft notification or ordinary reauthentication cancel', async () => {
  useWorkTabsStore.getState().bindSession('INTERNAL:org:a');
  const fixture = await pendingReauthentication();
  try {
    act(() => publishSessionSignal('revalidate'));
    expect(useWorkTabsStore.getState().sessionScope).toBe('INTERNAL:org:a');
    await userEvent.click(fixture.content.getByRole('button', { name: /取\s*消/ }));
    await fixture.operation;
    expect(useWorkTabsStore.getState().sessionScope).toBe('INTERNAL:org:a');
  } finally { fixture.view.unmount(); }
});

it('accepts public login and mounted logout responses without a duplicate hard boundary or repeated initial session read', async () => {
  useWorkTabsStore.getState().bindSession('INTERNAL:org:a');
  let actor: string | undefined; let reads = 0;
  vi.stubGlobal('fetch', vi.fn(async (path: string) => {
    if (path.endsWith('/csrf')) return json({ csrfToken: 'csrf' });
    if (path.endsWith('/auth/login')) { actor = 'b'; return json({ accountType: 'INTERNAL', securityState: 'AUTHENTICATED', landingPath: '/app/workbench' }); }
    if (path.endsWith('/auth/logout')) { actor = undefined; return new Response(null, { status: 204 }); }
    if (path.endsWith('/auth/session')) { reads++; if (actor) return json({ user: { id: actor, organizationId: 'org', accountType: 'INTERNAL' }, securityState: 'AUTHENTICATED', landingPath: '/app/workbench' }); }
    return json({ code: 'AUTH_SESSION_REQUIRED' }, 401);
  }));
  function Navigation() { const navigate = useNavigate(); return <button onClick={() => navigate('/app/workbench')}>Enter app</button>; }
  render(<MemoryRouter initialEntries={['/login']}><ReauthenticationProvider><Navigation /><Routes><Route path="/login" element={<p>Login destination</p>} /><Route path="/app/*" element={<AuthenticatedRoute accountType="INTERNAL"><p>Protected B</p></AuthenticatedRoute>} /></Routes></ReauthenticationProvider></MemoryRouter>);
  const before = sessionSignalVersion();
  await act(async () => { await expect(login({ identifier: 'b', password: 'secret-b', rememberMe: false })).resolves.toMatchObject({ securityState: 'AUTHENTICATED' }); });
  expect(sessionSignalVersion()).toBe(before + 1);
  fireEvent.click(screen.getByRole('button', { name: 'Enter app' }));
  await screen.findByText('Protected B');
  expect(reads).toBe(1); expect(sessionSignalVersion()).toBe(before + 1);
  await act(async () => { await expect(logout()).resolves.toBeUndefined(); });
  await screen.findByText('Login destination');
  expect(reads).toBe(2); expect(sessionSignalVersion()).toBe(before + 2);
  expect(useWorkTabsStore.getState().sessionScope).toBeUndefined();
});
