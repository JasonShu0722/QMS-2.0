import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { LanguageProvider } from '../../i18n/Language';
import { SecurityPage } from './SecurityPage';

const status = { isAdministrator: true, mfaPreference: 'DEFAULT', mfaEnabled: true, mfaRequired: true, securityState: 'AUTHENTICATED', recoveryCodesRemaining: 5, emailVerifiedAt: '2026-10-17T00:00:00Z', reauthenticationExpiresAt: null };
const json = (body: unknown, code = 200) => new Response(JSON.stringify(body), { status: code, headers: { 'content-type': 'application/json' } });
function mount() {
  return render(<LanguageProvider><MemoryRouter initialEntries={['/mfa']}><Routes><Route path="/mfa" element={<SecurityPage />} /><Route path="/login" element={<h1>Login</h1>} /><Route path="/app/workbench" element={<h1>Workbench</h1>} /></Routes></MemoryRouter></LanguageProvider>);
}
beforeEach(() => localStorage.clear());
afterEach(() => vi.unstubAllGlobals());

it.each([true, false])('shows effective policy without self-service policy or unbinding controls, administrator=%s', async isAdministrator => {
  const fetcher = vi.fn(async () => json({ ...status, isAdministrator, canUnbindMfa: true })); vi.stubGlobal('fetch', fetcher); mount();
  expect(await screen.findByText('验证器已绑定')).toBeVisible();
  expect(screen.getByText('登录时要求 MFA')).toBeVisible();
  expect(screen.getByText('MFA 策略由管理员在用户管理中统一设置。')).toBeVisible();
  expect(screen.queryByRole('switch')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '停用 MFA 并退出' })).not.toBeInTheDocument();
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it('distinguishes an existing authenticator from an optional sign-in policy', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => json({ ...status, mfaRequired: false, mfaPreference: 'DISABLED' }))); mount();
  expect(await screen.findByText('验证器已绑定')).toBeVisible();
  expect(screen.getByText('登录时不要求 MFA')).toBeVisible();
  expect(screen.getByText('剩余恢复码: 5')).toBeVisible();
});

it.each([true, false])('lets an unbound authenticated account enroll without changing policy, administrator=%s', async isAdministrator => {
  let bound = false;
  const fetcher = vi.fn(async (path: string) => {
    if (path.endsWith('/csrf')) return json({ csrfToken: 'test-csrf' });
    if (path.endsWith('/enrollment')) return json({ secret: 'TEST-ONLY', otpauthUri: 'otpauth://totp/TEST', expiresAt: '2026-10-18T00:00:00Z' });
    if (path.endsWith('/confirm')) { bound = true; return json({ recoveryCodes: ['test-recovery'], landingPath: '/app/workbench' }); }
    return json({ ...status, isAdministrator, mfaEnabled: bound, mfaRequired: false });
  });
  vi.stubGlobal('fetch', fetcher); mount();
  await userEvent.click(await screen.findByRole('button', { name: '绑定验证器' }));
  fireEvent.change(await screen.findByLabelText('验证码或恢复码'), { target: { value: '123456' } });
  await userEvent.click(screen.getByRole('button', { name: /验.?证/ }));
  expect(await screen.findByText('test-recovery')).toBeVisible();
  await userEvent.click(screen.getByRole('button', { name: '已保存，继续' }));
  expect(await screen.findByRole('heading', { name: 'Workbench' })).toBeVisible();
  expect(fetcher.mock.calls.some(([path]) => /preference|disable/.test(path))).toBe(false);
});

it('retains the independent MFA challenge and navigates only after successful verification', async () => {
  let attempts = 0;
  const fetcher = vi.fn(async (path: string) => path.endsWith('/csrf') ? json({ csrfToken: 'test' }) : path.endsWith('/verify') ? ++attempts === 1 ? json({ code: 'AUTH_MFA_CODE_INVALID', message: 'private' }, 401) : json({ landingPath: '/app/workbench' }) : json({ ...status, securityState: 'MFA_REQUIRED' }));
  vi.stubGlobal('fetch', fetcher); mount();
  const input = await screen.findByLabelText('验证码或恢复码');
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '重新生成恢复码' })).not.toBeInTheDocument();
  expect(screen.queryByRole('region', { name: '邮箱确认' })).not.toBeInTheDocument();
  fireEvent.change(input, { target: { value: '123456' } });
  await userEvent.click(screen.getByRole('button', { name: /验.?证/ }));
  expect(await screen.findByText('验证码无效或已使用，请使用新的验证码')).toBeVisible();
  expect(input).toHaveValue('123456');
  fireEvent.change(input, { target: { value: '654321' } });
  await userEvent.click(screen.getByRole('button', { name: /验.?证/ }));
  expect(await screen.findByRole('heading', { name: 'Workbench' })).toBeVisible();
  expect(fetcher).toHaveBeenCalledWith('/api/v1/auth/mfa/verify', expect.objectContaining({ body: JSON.stringify({ code: '654321' }), headers: expect.objectContaining({ 'x-csrf-token': 'test' }) }));
});

it('localizes policy, binding and recovery sections', async () => {
  localStorage.setItem('qms:locale:v1', 'en-US');
  vi.stubGlobal('fetch', vi.fn(async () => json(status))); mount();
  expect(await screen.findByText('Authenticator bound')).toBeVisible();
  expect(screen.getByText('Administrators manage MFA policy in user management.')).toBeVisible();
  expect(screen.getByRole('button', { name: 'Regenerate recovery codes' })).toBeVisible();
});

it('confirms email with CSRF and clears the submitted credential', async () => {
  let verified = false;
  const fetcher = vi.fn(async (path: string) => {
    if (path.endsWith('/csrf')) return json({ csrfToken: 'test' });
    if (path.endsWith('/complete')) { verified = true; return new Response(null, { status: 204 }); }
    return json({ ...status, emailVerifiedAt: verified ? status.emailVerifiedAt : null });
  });
  vi.stubGlobal('fetch', fetcher); mount();
  fireEvent.change(await screen.findByLabelText('邮件凭证'), { target: { value: 's'.repeat(43) } });
  await userEvent.click(screen.getByRole('button', { name: '确认邮箱' }));
  await waitFor(() => expect(screen.queryByLabelText('邮件凭证')).not.toBeInTheDocument());
  expect(fetcher).toHaveBeenCalledWith('/api/v1/auth/email-verification/complete', expect.objectContaining({ body: JSON.stringify({ token: 's'.repeat(43) }), headers: expect.objectContaining({ 'x-csrf-token': 'test' }) }));
});
