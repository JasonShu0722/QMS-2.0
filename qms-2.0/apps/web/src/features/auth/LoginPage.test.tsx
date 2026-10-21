import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom';
import { LoginPage } from './LoginPage';
import { LanguageProvider } from '../../i18n/Language';
import { getSession } from '../../api/client';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
function mount() {
  return render(<LanguageProvider><MemoryRouter initialEntries={['/login']}><Routes>
    <Route path="/login" element={<><LoginPage /><Link to="/elsewhere">Leave login</Link></>} />
    {['/app/workbench', '/supplier/inbox', '/mfa', '/elsewhere'].map(path => <Route key={path} path={path} element={<div>{path}</div>} />)}
  </Routes></MemoryRouter></LanguageProvider>);
}
beforeEach(() => { localStorage.clear(); });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); localStorage.clear(); });

async function pendingLogin() {
  let finish!: (response: Response) => void;
  const response = new Promise<Response>(resolve => { finish = resolve; });
  const fetcher = vi.fn(async (path: string) => path.endsWith('/session') ? json({ code: 'AUTH_SESSION_REQUIRED' }, 401)
    : path.endsWith('/csrf') ? json({ csrfToken: 'csrf' }) : (await response).clone());
  vi.stubGlobal('fetch', fetcher);
  mount();
  await waitFor(() => expect(screen.getByRole('button', { name: '登录' })).toBeEnabled());
  fireEvent.change(screen.getByLabelText('账号'), { target: { value: 'alice' } });
  fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'correct-password' } });
  const form = screen.getByLabelText('账号').closest('form')!;
  return { form, finish, writes: () => fetcher.mock.calls.filter(([path]) => path === '/api/v1/auth/login') };
}

it('freezes login inputs and the remember option while authentication is pending', async () => {
  const { form, finish, writes } = await pendingLogin();
  fireEvent.submit(form);
  await waitFor(() => expect(writes()).toHaveLength(1));
  try {
    for (const label of ['账号', '密码']) expect(screen.getByLabelText(label)).toBeDisabled();
    expect(screen.getByRole('checkbox', { name: '记住登录' })).toBeDisabled();
    await userEvent.type(screen.getByLabelText('密码'), 'changed');
    expect(screen.getByLabelText('密码')).toHaveValue('correct-password');
  } finally {
    await act(async () => finish(json({ code: 'AUTH_INVALID_CREDENTIALS' }, 401)));
  }
  expect(await screen.findByText('用户名或密码错误')).toBeInTheDocument();
  expect(screen.getByLabelText('密码')).toHaveValue('correct-password');
  expect(screen.getByLabelText('密码')).toBeEnabled();
});

it('sends one login request for repeated form submissions until authentication settles', async () => {
  const { form, finish, writes } = await pendingLogin();
  await act(async () => { fireEvent.submit(form); fireEvent.submit(form); });
  await waitFor(() => expect(writes().length).toBeGreaterThan(0));
  await act(async () => { fireEvent.submit(form); });
  await act(async () => finish(json({ code: 'AUTH_INVALID_CREDENTIALS' }, 401)));
  await screen.findByText('用户名或密码错误');
  expect(writes()).toHaveLength(1);
});

describe('remember login', () => {
  it.each([false, true])('submits explicit rememberMe=%s without storing credentials', async rememberMe => {
    const fetch = vi.fn<typeof globalThis.fetch>(async path => {
      if (path === '/api/v1/auth/session') return json({ code: 'AUTH_SESSION_REQUIRED' }, 401);
      if (path === '/api/v1/auth/csrf') return json({ csrfToken: 'csrf' });
      return json({ landingPath: '/app/workbench', securityState: 'AUTHENTICATED' });
    });
    vi.stubGlobal('fetch', fetch);
    const storage = vi.spyOn(Storage.prototype, 'setItem');
    mount();
    const checkbox = screen.getByRole('checkbox', { name: '记住登录' });
    expect(checkbox).not.toBeChecked();
    expect(screen.getByText('管理员保持登录 7 天，普通账号 30 天。请勿在公共设备上勾选。')).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('账号'), 'alice');
    await userEvent.type(screen.getByLabelText('密码'), 'correct-password');
    if (rememberMe) await userEvent.click(checkbox);
    await userEvent.click(screen.getByRole('button', { name: '登录' }));
    expect(await screen.findByText('/app/workbench')).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledWith('/api/v1/auth/login', expect.objectContaining({ body: JSON.stringify({ identifier: 'alice', password: 'correct-password', rememberMe }) }));
    expect(storage.mock.calls).toEqual([['qms:locale:v1', 'zh-CN']]);
  });
  it.each(['/app/workbench', '/supplier/inbox'])('uses the existing session server landingPath %s, not account type', async landingPath => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ user: { id: 'alice', organizationId: 'org', accountType: 'INTERNAL' }, landingPath, securityState: 'AUTHENTICATED' })));
    mount();
    expect(await screen.findByText(landingPath)).toBeInTheDocument();
  });
  it('keeps network verification failures retryable and preserves form input', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockRejectedValueOnce(new TypeError('network failure')).mockResolvedValueOnce(json({ code: 'AUTH_SESSION_REQUIRED' }, 401));
    vi.stubGlobal('fetch', fetch);
    mount();
    expect(await screen.findByText('暂时无法验证登录状态')).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('账号'), 'alice');
    expect(screen.getByRole('button', { name: '登录' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: /重\s*试/ }));
    await waitFor(() => expect(screen.getByRole('button', { name: '登录' })).toBeEnabled());
    expect(screen.getByLabelText('账号')).toHaveValue('alice');
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it('ignores an existing session response after leaving login', async () => {
    let resolve!: (response: Response) => void;
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(done => { resolve = done; })));
    mount();
    fireEvent.click(screen.getByRole('link', { name: 'Leave login' }));
    await act(async () => resolve(json({ user: { id: 'alice', organizationId: 'org', accountType: 'INTERNAL' }, landingPath: '/app/workbench', securityState: 'AUTHENTICATED' })));
    expect(screen.getByText('/elsewhere')).toBeInTheDocument();
    expect(screen.queryByText('/app/workbench')).not.toBeInTheDocument();
  });
  it('localizes the remember option and lifetime explanation', async () => {
    localStorage.setItem('qms:locale:v1', 'en-US');
    vi.stubGlobal('fetch', vi.fn(async () => json({ code: 'AUTH_SESSION_REQUIRED' }, 401)));
    mount();
    expect(screen.getByRole('checkbox', { name: 'Remember sign-in' })).toBeInTheDocument();
    expect(screen.getByText('Stay signed in for 7 days as an administrator or 30 days as a regular account. Do not select on shared devices.')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Sign in' })).toBeEnabled());
  });
  it('rejects a malformed successful session rather than inferring its portal', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ user: { id: 'alice', organizationId: 'org', accountType: 'INTERNAL' } })));
    await expect(getSession()).rejects.toThrow();
  });
});
