import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import { RequiredPasswordChangePage } from './RequiredPasswordChangePage';

const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
afterEach(() => { vi.unstubAllGlobals(); sessionStorage.clear(); localStorage.clear(); });

async function pendingChange() {
  let finish!: (response: Response) => void;
  const response = new Promise<Response>(resolve => { finish = resolve; });
  const fetcher = vi.fn(async (path: string) => path.endsWith('/csrf') ? json({ csrfToken: 'csrf' })
    : path.endsWith('/complete') ? (await response).clone() : json({ securityState: 'PASSWORD_CHANGE_REQUIRED' }));
  vi.stubGlobal('fetch', fetcher);
  render(<MemoryRouter><RequiredPasswordChangePage /></MemoryRouter>);
  const password = await screen.findByLabelText('新密码');
  fireEvent.change(password, { target: { value: 'NewPermanentPassword123!' } });
  fireEvent.change(screen.getByLabelText('确认新密码'), { target: { value: 'NewPermanentPassword123!' } });
  return { form: password.closest('form')!, finish, fetcher, writes: () => fetcher.mock.calls.filter(([path]) => path.endsWith('/complete')) };
}

it('freezes both password fields and blocks exit while the password change is pending', async () => {
  const { form, finish, fetcher, writes } = await pendingChange();
  fireEvent.submit(form);
  await waitFor(() => expect(writes()).toHaveLength(1));
  try {
    expect(screen.getByRole('button', { name: '退出并返回登录' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: '退出并返回登录' }));
    expect(fetcher.mock.calls.some(([path]) => path.endsWith('/logout'))).toBe(false);
    for (const label of ['新密码', '确认新密码']) {
      expect(screen.getByLabelText(label)).toBeDisabled();
      await userEvent.type(screen.getByLabelText(label), 'changed');
      expect(screen.getByLabelText(label)).toHaveValue('NewPermanentPassword123!');
    }
  } finally {
    await act(async () => finish(json({ code: 'AUTH_PASSWORD_POLICY_INVALID' }, 400)));
  }
  await screen.findByText('密码不符合安全要求，请使用至少 12 位的强密码');
  expect(screen.getByLabelText('新密码')).toBeEnabled();
});

it('keeps the existing single-request guard for repeated password-change submissions', async () => {
  const { form, finish, writes } = await pendingChange();
  await act(async () => { fireEvent.submit(form); fireEvent.submit(form); });
  await waitFor(() => expect(writes()).toHaveLength(1));
  await act(async () => { fireEvent.submit(form); });
  await act(async () => finish(json({ code: 'AUTH_PASSWORD_POLICY_INVALID' }, 400)));
  await screen.findByText('密码不符合安全要求，请使用至少 12 位的强密码');
  expect(writes()).toHaveLength(1);
});

it('restores the challenge, keeps failed input and follows the server MFA landing path after change', async () => {
  let fail = true;
  const fetcher = vi.fn(async (path: string) => path.endsWith('/csrf') ? json({ csrfToken: 'csrf' })
    : path.endsWith('/complete') ? fail ? json({ code: 'AUTH_PASSWORD_POLICY_INVALID', message: 'private' }, 400) : json({ landingPath: '/mfa', securityState: 'MFA_REQUIRED', accountType: 'INTERNAL' })
      : json({ securityState: 'PASSWORD_CHANGE_REQUIRED', landingPath: '/change-password', accountType: 'INTERNAL' }));
  vi.stubGlobal('fetch', fetcher);
  render(<MemoryRouter initialEntries={['/change-password']}><Routes><Route path="/change-password" element={<RequiredPasswordChangePage />} /><Route path="/mfa" element={<p>MFA landing</p>} /></Routes></MemoryRouter>);
  const password = await screen.findByLabelText('新密码');
  await userEvent.type(password, 'NewPermanentPassword123!');
  await userEvent.type(screen.getByLabelText('确认新密码'), 'NewPermanentPassword123!');
  await userEvent.click(screen.getByRole('button', { name: '保存新密码' }));
  expect(await screen.findByText('密码不符合安全要求，请使用至少 12 位的强密码')).toBeInTheDocument();
  expect(password).toHaveValue('NewPermanentPassword123!');
  fail = false;
  await userEvent.click(screen.getByRole('button', { name: '保存新密码' }));
  expect(await screen.findByText('MFA landing')).toBeInTheDocument();
  expect(fetcher.mock.calls.some(([path]) => path === '/api/v1/auth/password-change')).toBe(true);
  expect(localStorage.length + sessionStorage.length).toBe(0);
});

it('cancels the challenge when exiting without sending password contents', async () => {
  const fetcher = vi.fn(async (path: string) => path.endsWith('/csrf') ? json({ csrfToken: 'csrf' }) : path.endsWith('/logout') ? new Response(null, { status: 204 }) : json({ securityState: 'PASSWORD_CHANGE_REQUIRED' }));
  vi.stubGlobal('fetch', fetcher);
  render(<MemoryRouter><Routes><Route path="/" element={<RequiredPasswordChangePage />} /><Route path="/login" element={<p>Login landing</p>} /></Routes></MemoryRouter>);
  await screen.findByLabelText('新密码');
  await userEvent.click(screen.getByRole('button', { name: '退出并返回登录' }));
  expect(await screen.findByText('Login landing')).toBeInTheDocument();
  expect(fetcher.mock.calls.some(([path]) => path === '/api/v1/auth/logout')).toBe(true);
});
