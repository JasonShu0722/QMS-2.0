import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { apiRequest, registerReauthentication } from '../../api/client';
import { LanguageProvider } from '../../i18n/Language';
import { useWorkTabsStore } from '../../work-tabs/workTabsStore';
import { SecurityPage } from './SecurityPage';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
let unregister: (() => void) | undefined;
beforeEach(() => { localStorage.clear(); useWorkTabsStore.getState().reset(); });
afterEach(() => { unregister?.(); unregister = undefined; vi.unstubAllGlobals(); });

it.each([false, true])('does not replay a factor consumed by recent reauthentication, English=%s', async english => {
  if (english) localStorage.setItem('qms:locale:v1', 'en-US');
  const usedFactor = 'a'.repeat(43);
  const freshFactor = 'b'.repeat(43);
  let recent = false;
  let consumed = false;
  const preferenceRequests: RequestInit[] = [];
  const fetcher = vi.fn(async (path: string, init?: RequestInit) => {
    if (path.endsWith('/csrf')) return json({ csrfToken: recent ? 'new-csrf' : 'old-csrf' });
    if (path.endsWith('/reauthenticate')) {
      expect(JSON.parse(String(init?.body)).code).toBe(usedFactor);
      consumed = true; recent = true;
      return json({ reauthenticationExpiresAt: '2026-10-17T00:05:00Z' });
    }
    if (path.endsWith('/preference')) {
      preferenceRequests.push(init!);
      if (!recent) return json({ code: 'AUTH_REAUTHENTICATION_REQUIRED' }, 403);
      if (JSON.parse(String(init?.body)).code === usedFactor && consumed) return json({ code: 'AUTH_MFA_CODE_INVALID' }, 401);
      expect(JSON.parse(String(init?.body))).toEqual({ preference: 'DISABLED', code: freshFactor });
      return new Response(null, { status: 204 });
    }
    return json({ isAdministrator: true, mfaPreference: 'DEFAULT', mfaEnabled: true, mfaRequired: true, securityState: 'AUTHENTICATED', recoveryCodesRemaining: 5, emailVerifiedAt: '2026-10-17T00:00:00Z' });
  });
  vi.stubGlobal('fetch', fetcher);
  unregister = registerReauthentication(async () => {
    await apiRequest('/api/v1/me/reauthenticate', { method: 'POST', body: JSON.stringify({ password: 'test-password', code: usedFactor }) });
  });
  useWorkTabsStore.getState().bindSession('INTERNAL:org:alice');
  render(<LanguageProvider><MemoryRouter initialEntries={['/mfa']}><Routes><Route path="/mfa" element={<SecurityPage />} /><Route path="/login" element={<h1>Login</h1>} /></Routes></MemoryRouter></LanguageProvider>);
  await userEvent.click(await screen.findByRole('switch', { name: english ? 'Sign-in MFA' : '登录 MFA' }));
  const dialog = within(await screen.findByRole('dialog', { name: english ? 'Disable sign-in MFA?' : '关闭登录 MFA？' }));
  const input = dialog.getByLabelText(english ? 'Authenticator or recovery code' : '验证码或恢复码');
  const submit = dialog.getByRole('button', { name: english ? 'Disable and sign in again' : '关闭并重新登录' });
  fireEvent.change(input, { target: { value: usedFactor } });
  await userEvent.click(submit);
  expect(await dialog.findByText(english ? 'Identity verified. Enter a new authenticator code or an unused recovery code, then try again.' : '身份验证已完成，请输入新的验证码或未使用的恢复码后重试')).toBeInTheDocument();
  expect(consumed).toBe(true);
  expect(preferenceRequests).toHaveLength(1);
  expect(input).toHaveValue('');
  expect(screen.getByRole('switch', { name: english ? 'Sign-in MFA' : '登录 MFA' })).toBeChecked();
  expect(useWorkTabsStore.getState().sessionScope).toBe('INTERNAL:org:alice');
  await userEvent.click(submit);
  expect(preferenceRequests).toHaveLength(1);
  fireEvent.change(input, { target: { value: freshFactor } });
  await userEvent.click(submit);
  expect(await screen.findByRole('heading', { name: 'Login' })).toBeInTheDocument();
  expect(preferenceRequests).toHaveLength(2);
  const firstHeaders = preferenceRequests[0].headers as Record<string, string>;
  const secondHeaders = preferenceRequests[1].headers as Record<string, string>;
  expect(secondHeaders['Idempotency-Key']).not.toBe(firstHeaders['Idempotency-Key']);
  expect(secondHeaders['x-csrf-token']).toBe('new-csrf');
  expect(useWorkTabsStore.getState().sessionScope).toBeUndefined();
});

it('retains automatic replay and refreshed CSRF for callers without the opt-out', async () => {
  let recent = false;
  const fetcher = vi.fn(async (path: string) => path.endsWith('/csrf') ? json({ csrfToken: 'new-csrf' }) : recent ? json({ saved: true }) : json({ code: 'AUTH_REAUTHENTICATION_REQUIRED' }, 403));
  vi.stubGlobal('fetch', fetcher);
  unregister = registerReauthentication(async () => { recent = true; });
  await expect(apiRequest('/api/v1/test/guarded', { method: 'POST', headers: { 'x-csrf-token': 'old-csrf', 'Idempotency-Key': 'stable-key' }, body: JSON.stringify({ name: 'test' }) })).resolves.toEqual({ saved: true });
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(3));
  expect(fetcher).toHaveBeenLastCalledWith('/api/v1/test/guarded', expect.objectContaining({ headers: expect.objectContaining({ 'x-csrf-token': 'new-csrf', 'Idempotency-Key': 'stable-key' }), body: JSON.stringify({ name: 'test' }) }));
});
