import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { LanguageProvider } from '../../i18n/Language';
import { useWorkTabsStore } from '../../work-tabs/workTabsStore';
import { SecurityPage } from './SecurityPage';

const status = { isAdministrator: true, mfaPreference: 'DEFAULT', mfaEnabled: true, mfaRequired: true, securityState: 'AUTHENTICATED', recoveryCodesRemaining: 5, emailVerifiedAt: '2026-10-17T00:00:00Z', reauthenticationExpiresAt: null };
const json = (body: unknown, code = 200) => new Response(JSON.stringify(body), { status: code, headers: { 'content-type': 'application/json' } });
function mount() {
  return render(<LanguageProvider><MemoryRouter initialEntries={['/mfa']}><Routes><Route path="/mfa" element={<SecurityPage />} /><Route path="/login" element={<h1>Login</h1>} /></Routes></MemoryRouter></LanguageProvider>);
}
function setup(next = {}, post: () => Promise<Response> = async () => new Response(null, { status: 204 })) {
  const fetcher = vi.fn(async (path: string) => path.endsWith('/csrf') ? json({ csrfToken: 'csrf-test' }) : path.endsWith('/preference') ? post() : json({ ...status, ...next }));
  vi.stubGlobal('fetch', fetcher);
  return fetcher;
}
async function openDisable() {
  await userEvent.click(await screen.findByRole('switch', { name: '登录 MFA' }));
  return within(await screen.findByRole('dialog', { name: '关闭登录 MFA？' }));
}
beforeEach(() => { localStorage.clear(); useWorkTabsStore.getState().reset(); });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it('shows bound and effective states separately and cancellation does not change the policy', async () => {
  const fetcher = setup(); mount();
  expect(await screen.findByText('验证器已绑定')).toBeVisible();
  expect(screen.getByText('登录时要求 MFA')).toBeVisible();
  const dialog = await openDisable();
  await waitFor(() => expect(dialog.getByText('关闭后保留验证器和恢复码，撤销现有会话并重新登录。')).toBeVisible());
  await userEvent.click(dialog.getByRole('button', { name: /取.?消/ }));
  expect(screen.getByRole('switch', { name: '登录 MFA' })).toBeChecked();
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it('requires explicit factor, sends one protected mutation, and clears work tabs only after success', async () => {
  let complete!: (response: Response) => void;
  const fetcher = setup({}, () => new Promise(resolve => { complete = resolve; }));
  const store = useWorkTabsStore.getState(); store.bindSession('INTERNAL:org:alice'); store.openTab({ id: 'a', title: 'Account', path: '/app/account' });
  mount(); const dialog = await openDisable();
  const confirm = dialog.getByRole('button', { name: '关闭并重新登录' });
  await userEvent.click(confirm);
  expect(fetcher).toHaveBeenCalledTimes(1);
  await userEvent.type(dialog.getByLabelText('验证码或恢复码'), '123456');
  await userEvent.dblClick(confirm);
  await waitFor(() => expect(fetcher.mock.calls.filter(([path]) => path.endsWith('/preference'))).toHaveLength(1));
  expect(fetcher).toHaveBeenCalledWith('/api/v1/me/mfa/preference', expect.objectContaining({ method: 'POST', credentials: 'include', body: JSON.stringify({ preference: 'DISABLED', code: '123456' }), headers: expect.objectContaining({ 'x-csrf-token': 'csrf-test', 'Idempotency-Key': expect.any(String) }) }));
  expect(dialog.getByRole('button', { name: /取.?消/ })).toBeDisabled();
  expect(useWorkTabsStore.getState().sessionScope).toBe('INTERNAL:org:alice');
  await act(async () => complete(new Response(null, { status: 204 })));
  expect(await screen.findByRole('heading', { name: 'Login' })).toBeVisible();
  expect(useWorkTabsStore.getState().sessionScope).toBeUndefined();
  expect(sessionStorage.getItem('qms:work-pages:v1')).toBeNull();
  expect(fetcher.mock.calls.some(([path]) => path.endsWith('/disable'))).toBe(false);
});

it('keeps the original state and input on failure and reuses the key on retry', async () => {
  let attempts = 0;
  const fetcher = setup({}, async () => ++attempts === 1 ? json({ code: 'PRIVATE_ERROR', message: 'private internals' }, 503) : new Response(null, { status: 204 }));
  mount(); const dialog = await openDisable();
  await userEvent.type(dialog.getByLabelText('验证码或恢复码'), '123456');
  await userEvent.click(dialog.getByRole('button', { name: '关闭并重新登录' }));
  expect(await dialog.findByText('请求被拒绝，请检查权限和填写内容后重试')).toBeVisible();
  expect(screen.queryByText('private internals')).not.toBeInTheDocument();
  expect(dialog.getByLabelText('验证码或恢复码')).toHaveValue('123456');
  expect(screen.getByRole('switch', { name: '登录 MFA' })).toBeChecked();
  await userEvent.click(dialog.getByRole('button', { name: '关闭并重新登录' }));
  await screen.findByRole('heading', { name: 'Login' });
  const calls = fetcher.mock.calls.filter(([path]) => path.endsWith('/preference'));
  expect(calls).toHaveLength(2);
  expect((calls[0] as unknown as [string, RequestInit])[1].headers).toEqual((calls[1] as unknown as [string, RequestInit])[1].headers);
});

it('verifies an existing bound factor before enabling login MFA', async () => {
  const fetcher = setup({ mfaPreference: 'DISABLED', mfaRequired: false }); mount();
  expect(await screen.findByText('验证器已绑定')).toBeVisible();
  expect(screen.getByText('登录时不要求 MFA')).toBeVisible();
  expect(screen.queryByRole('button', { name: '停用 MFA 并退出' })).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('switch', { name: '登录 MFA' }));
  const dialog = within(await screen.findByRole('dialog', { name: '开启登录 MFA' }));
  await userEvent.click(dialog.getByRole('button', { name: '开启并重新登录' }));
  expect(fetcher).toHaveBeenCalledTimes(1);
  await userEvent.type(dialog.getByLabelText('验证码或恢复码'), 'recovery-code');
  await userEvent.click(dialog.getByRole('button', { name: '开启并重新登录' }));
  expect(await screen.findByRole('heading', { name: 'Login' })).toBeVisible();
  expect(fetcher).toHaveBeenCalledWith('/api/v1/me/mfa/preference', expect.objectContaining({ body: JSON.stringify({ preference: 'ENABLED', code: 'recovery-code' }) }));
});

it('enrolls an unbound administrator before offering the enable mutation', async () => {
  let bound = false;
  const fetcher = vi.fn(async (path: string) => {
    if (path.endsWith('/csrf')) return json({ csrfToken: 'csrf-test' });
    if (path.endsWith('/enrollment')) return json({ secret: 'TEST-ONLY', otpauthUri: 'otpauth://totp/TEST', expiresAt: '2026-10-18T00:00:00Z' });
    if (path.endsWith('/confirm')) { bound = true; return json({ recoveryCodes: ['test-recovery'], landingPath: '/app/workbench' }); }
    return json({ ...status, mfaPreference: 'DISABLED', mfaEnabled: bound, mfaRequired: false });
  });
  vi.stubGlobal('fetch', fetcher); mount();
  await userEvent.click(await screen.findByRole('switch', { name: '登录 MFA' }));
  await userEvent.type(await screen.findByLabelText('验证码或恢复码'), '123456');
  await userEvent.click(screen.getByRole('button', { name: /验.?证/ }));
  await userEvent.click(await screen.findByRole('button', { name: '已保存，继续' }));
  const dialog = within(await screen.findByRole('dialog', { name: '开启登录 MFA' }));
  expect(dialog.getByLabelText('验证码或恢复码')).toHaveValue('');
  expect(fetcher.mock.calls.some(([path]) => path.endsWith('/preference'))).toBe(false);
});

it.each(['AUTHENTICATED', 'MFA_REQUIRED'])('does not offer the administrator switch to ordinary accounts in %s', async securityState => {
  setup({ isAdministrator: false, securityState }); mount();
  await screen.findByText('验证器已绑定');
  expect(screen.queryByRole('switch')).not.toBeInTheDocument();
});

it('does not offer the switch in administrator MFA challenge state', async () => {
  setup({ securityState: 'MFA_REQUIRED' }); mount();
  await screen.findByText('验证器已绑定');
  expect(screen.queryByRole('switch')).not.toBeInTheDocument();
});

it.each([true, false])('preserves ordinary optional unbinding only when the server permits it: %s', async canUnbindMfa => {
  const fetcher = setup({ isAdministrator: false, canUnbindMfa }); mount();
  await screen.findByText('验证器已绑定');
  const button = screen.queryByRole('button', { name: '停用 MFA 并退出' });
  if (canUnbindMfa) {
    expect(button).toBeInTheDocument();
    await userEvent.click(button!);
    expect(fetcher).toHaveBeenCalledWith('/api/v1/me/mfa/disable', expect.objectContaining({ method: 'POST' }));
  } else {
    expect(button).not.toBeInTheDocument();
  }
});

it('localizes the switch, confirmation and controlled factor errors', async () => {
  localStorage.setItem('qms:locale:v1', 'en-US');
  setup({}, async () => json({ code: 'AUTH_MFA_CODE_INVALID', message: 'private' }, 401)); mount();
  await userEvent.click(await screen.findByRole('switch', { name: 'Sign-in MFA' }));
  const dialog = within(await screen.findByRole('dialog', { name: 'Disable sign-in MFA?' }));
  await waitFor(() => expect(dialog.getByText('Your authenticator and recovery codes are retained. Existing sessions will be revoked and you must sign in again.')).toBeVisible());
  fireEvent.change(dialog.getByLabelText('Authenticator or recovery code'), { target: { value: '123456' } });
  await userEvent.click(dialog.getByRole('button', { name: 'Disable and sign in again' }));
  expect(await dialog.findByText('Invalid or used code. Enter a new code.')).toBeVisible();
});
