import { StrictMode, useEffect, useState } from 'react';
import { Modal } from 'antd';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, MemoryRouter, Route, RouterProvider, Routes, useNavigate } from 'react-router-dom';
import { transferableAbortController } from 'node:util';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AuthenticatedRoute } from './AuthenticatedRoute';
import { publishSessionSignal, sessionSignalVersion } from './session-invalidation';
import { useWorkTabsStore } from '../../work-tabs/workTabsStore';
import { UnsavedChangesProvider, useUnsavedChanges } from '../../layouts/UnsavedChanges';
import { SecurityDialog } from './SecurityDialog';
import { apiRequest, completePasswordReset } from '../../api/client';
import { PasswordChangeDialog } from '../account/PasswordChangeDialog';
import { ReauthenticationProvider } from './ReauthenticationProvider';

const session = (id = 'actor') => ({ user: { id, organizationId: 'a', accountType: 'INTERNAL' }, landingPath: '/app/workbench', securityState: 'AUTHENTICATED' });
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
let mounts = 0;
// jsdom has no native top layer; these spies verify calls, not browser modal isolation.
Object.defineProperties(HTMLDialogElement.prototype, { showModal: { configurable: true, writable: true, value() {} }, close: { configurable: true, writable: true, value() {} } });
function Draft() { const [value, setValue] = useState(''); useEffect(() => { mounts++; }, []); return <input aria-label="draft" value={value} onChange={event => setValue(event.target.value)} />; }
function application(strict = false, modal = false) {
  const view = <MemoryRouter initialEntries={['/app/workbench']}><Routes><Route path="/app/*" element={<AuthenticatedRoute accountType="INTERNAL">{modal ? <Modal open title="private editor"><Draft /></Modal> : <Draft />}</AuthenticatedRoute>} /><Route path="/login" element={<p>login destination</p>} /></Routes></MemoryRouter>;
  return render(strict ? <StrictMode>{view}</StrictMode> : view);
}
beforeEach(() => { mounts = 0; useWorkTabsStore.getState().reset(); vi.spyOn(HTMLDialogElement.prototype, 'showModal').mockImplementation(function (this: HTMLDialogElement) { this.setAttribute('open', ''); }); vi.spyOn(HTMLDialogElement.prototype, 'close').mockImplementation(function (this: HTMLDialogElement) { this.removeAttribute('open'); }); });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it('revalidates on focus, blocks while pending, and preserves an unchanged business draft', async () => {
  let finish!: (value: Response) => void;
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(response(session())).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })));
  application(); fireEvent.change(await screen.findByRole('textbox', { name: 'draft' }), { target: { value: 'unsaved' } });
  fireEvent.focus(window);
  await waitFor(() => expect(finish).toBeDefined());
  expect(screen.getByRole('dialog', { name: '会话安全验证' })).toHaveAttribute('open');
  expect(HTMLDialogElement.prototype.showModal).toHaveBeenCalled();
  await act(async () => finish(response(session())));
  expect(await screen.findByRole('textbox', { name: 'draft' })).toHaveValue('unsaved'); expect(mounts).toBe(1);
});

it('keeps a network-failed revalidation blocked and retries without losing its draft', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(response(session())).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(response(session())));
  application(); fireEvent.change(await screen.findByRole('textbox'), { target: { value: 'unsaved' } });
  fireEvent.focus(window);
  expect(await screen.findByText('暂时无法验证登录状态')).toBeInTheDocument();
  expect(screen.getByRole('dialog', { name: '会话安全验证' })).toHaveAttribute('open');
  fireEvent.click(screen.getByRole('button', { name: /重\s*试/ }));
  expect(await screen.findByRole('textbox')).toHaveValue('unsaved'); expect(mounts).toBe(1);
});

it('clears drafts on an invalidation signal and never treats the signal as proof of a session', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(response(session())).mockResolvedValue(response({ code: 'AUTH_SESSION_REQUIRED' }, 401)));
  application(); await screen.findByRole('textbox');
  act(() => publishSessionSignal('invalidate'));
  expect(screen.queryByLabelText('draft')).not.toBeInTheDocument();
  expect(await screen.findByText('login destination')).toBeInTheDocument();
  expect(useWorkTabsStore.getState().sessionScope).toBeUndefined();
});

it('does not restore a late session check over a newer invalidation in StrictMode', async () => {
  let finish!: (value: Response) => void; let delayed = false;
  vi.stubGlobal('fetch', vi.fn(async () => delayed ? new Promise<Response>(resolve => { finish = resolve; }) : response(session())));
  application(true); await screen.findByRole('textbox'); delayed = true;
  fireEvent.focus(window); await waitFor(() => expect(finish).toBeDefined());
  const old = finish;
  act(() => publishSessionSignal('invalidate'));
  vi.stubGlobal('fetch', vi.fn(async () => response({ code: 'AUTH_SESSION_REQUIRED' }, 401)));
  fireEvent.focus(window);
  expect(await screen.findByText('login destination')).toBeInTheDocument();
  await act(async () => old(response(session())));
  expect(screen.queryByLabelText('draft')).not.toBeInTheDocument();
});

it('rechecks when the document becomes visible and clears an old account draft', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(response(session())).mockImplementation(async () => response(session('other'))));
  application(); fireEvent.change(await screen.findByRole('textbox'), { target: { value: 'old account secret' } });
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  fireEvent(document, new Event('visibilitychange'));
  await waitFor(() => expect(useWorkTabsStore.getState().sessionScope).toBe('INTERNAL:a:other'));
  expect(await screen.findByRole('textbox')).toHaveValue('');
});

it('quarantines a real body Modal portal through pending and failed checks, preserves on success, and clears on logout', async () => {
  let finish!: (value: Response) => void;
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(response(session())).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(response(session())).mockResolvedValue(response({ code: 'AUTH_SESSION_REQUIRED' }, 401)));
  application(false, true);
  fireEvent.change(await screen.findByRole('textbox'), { target: { value: 'private modal draft' } });
  fireEvent.focus(window); await waitFor(() => expect(finish).toBeDefined());
  expect(screen.getByRole('dialog', { name: '会话安全验证' })).toHaveAttribute('open');
  expect(screen.getByLabelText('draft')).toHaveValue('private modal draft');
  await act(async () => finish(response(session())));
  expect(await screen.findByRole('textbox')).toHaveValue('private modal draft');
  fireEvent.focus(window);
  expect(await screen.findByText('暂时无法验证登录状态')).toBeVisible();
  expect(screen.getByRole('dialog', { name: '会话安全验证' })).toHaveAttribute('open');
  fireEvent.click(screen.getByRole('button', { name: /重\s*试/ }));
  expect(await screen.findByRole('textbox')).toHaveValue('private modal draft');
  act(() => publishSessionSignal('invalidate'));
  expect(await screen.findByText('login destination')).toBeInTheDocument();
  expect(screen.queryByLabelText('draft')).not.toBeInTheDocument();
});

it('bypasses ordinary dirty navigation confirmation after server session refusal', async () => {
  const original = globalThis.AbortController;
  globalThis.AbortController = function () { return transferableAbortController(); } as unknown as typeof AbortController;
  function Dirty() { useUnsavedChanges(true); return <Draft />; }
  let sessionReads = 0;
  const version = sessionSignalVersion();
  vi.stubGlobal('fetch', vi.fn(async (path: string) => path.endsWith('/auth/session') && ++sessionReads === 1 ? response(session()) : response({ code: 'AUTH_SESSION_REQUIRED' }, 401)));
  const router = createMemoryRouter([{ path: '/app/*', element: <AuthenticatedRoute accountType="INTERNAL"><UnsavedChangesProvider><Dirty /></UnsavedChangesProvider></AuthenticatedRoute> }, { path: '/login', element: <p>login destination</p> }], { initialEntries: ['/app/workbench'] });
  try {
    render(<RouterProvider router={router} />); await screen.findByRole('textbox');
    fireEvent.focus(window);
    expect(await screen.findByText('login destination')).toBeInTheDocument();
    expect(screen.queryByText('当前草稿尚未保存，继续将放弃修改。')).not.toBeInTheDocument();
    expect(sessionSignalVersion()).toBe(version + 1);
    expect(sessionReads).toBe(3);
  } finally { router.dispose(); globalThis.AbortController = original; }
});

it('never revives a stale A session over a batched A to B to A store transition', async () => {
  let finish!: (value: Response) => void;
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(response(session())).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })).mockResolvedValue(response(session())));
  application(); fireEvent.change(await screen.findByRole('textbox'), { target: { value: 'obsolete draft' } });
  fireEvent.focus(window); await waitFor(() => expect(finish).toBeDefined());
  act(() => { useWorkTabsStore.getState().bindSession('INTERNAL:a:b'); useWorkTabsStore.getState().bindSession('INTERNAL:a:actor'); });
  await waitFor(() => expect(useWorkTabsStore.getState().sessionScope).toBe('INTERNAL:a:actor'));
  await act(async () => finish(response(session('old-sensitive-identity'))));
  expect(useWorkTabsStore.getState().sessionScope).toBe('INTERNAL:a:actor');
  expect(await screen.findByRole('textbox')).toHaveValue('');
});

it('does not remount an old authorization projection across a path A to B to A round trip', async () => {
  const pending: ((value: Response) => void)[] = [];
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(response(session())).mockImplementation(() => new Promise(resolve => pending.push(resolve))));
  function Navigation() { const navigate = useNavigate(); return <><button onClick={() => navigate('/app/b')}>go B</button><button onClick={() => navigate('/app/a')}>go A</button></>; }
  render(<MemoryRouter initialEntries={['/app/a']}><Navigation /><AuthenticatedRoute accountType="INTERNAL"><Draft /></AuthenticatedRoute></MemoryRouter>);
  await screen.findByRole('textbox');
  fireEvent.click(screen.getByRole('button', { name: 'go B' }));
  expect(screen.queryByLabelText('draft')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'go A' }));
  expect(screen.queryByLabelText('draft')).not.toBeInTheDocument();
  await act(async () => pending[0]!(response(session('obsolete'))));
  expect(screen.queryByLabelText('draft')).not.toBeInTheDocument();
  await act(async () => pending[1]!(response(session())));
  expect(await screen.findByRole('textbox')).toHaveValue('');
});

it.each(['regenerate', 'enroll'] as const)('retains actual one-time codes after the embedded security %s POST triggers session revalidation', async kind => {
  let sessionReads = 0; let bound = kind === 'regenerate';
  vi.stubGlobal('fetch', vi.fn(async (path: string) => {
    if (path.endsWith('/auth/session')) { sessionReads++; return response(session()); }
    if (path.endsWith('/csrf')) return response({ csrfToken: 'csrf' });
    if (path.endsWith('/enrollment')) return response({ secret: 'TEST-ONLY', otpauthUri: 'otpauth://totp/TEST', expiresAt: '2026-10-30T12:00:00Z' });
    if (path.endsWith('/confirm') || path.endsWith('/recovery-codes')) { bound = true; return response({ recoveryCodes: ['one-time-private-code'], landingPath: '/app/workbench' }); }
    return response({ isAdministrator: false, mfaEnabled: bound, mfaRequired: false, securityState: 'AUTHENTICATED', recoveryCodesRemaining: 5, emailVerifiedAt: '2026-10-17' });
  }));
  render(<MemoryRouter initialEntries={['/app/account']}><AuthenticatedRoute accountType="INTERNAL"><SecurityDialog open onClose={() => {}} /></AuthenticatedRoute></MemoryRouter>);
  if (kind === 'regenerate') fireEvent.click(await screen.findByRole('button', { name: '重新生成恢复码' }));
  else {
    fireEvent.click(await screen.findByRole('button', { name: '绑定验证器' }));
    fireEvent.change(await screen.findByLabelText('验证码或恢复码'), { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: /验.?证/ }));
  }
  await waitFor(() => expect(fetch).toHaveBeenCalledWith(kind === 'regenerate' ? '/api/v1/me/mfa/recovery-codes' : '/api/v1/me/mfa/enrollment/confirm', expect.objectContaining({ method: 'POST' })));
  await waitFor(() => expect(sessionReads).toBe(2));
  expect(await screen.findByText('one-time-private-code')).toBeInTheDocument();
  await waitFor(() => expect(screen.queryByRole('dialog', { name: '会话安全验证' })).not.toBeInTheDocument());
  expect(screen.getByRole('dialog', { name: '账号安全' })).toBeInTheDocument();
});

it.each(['reset', 'recovery'] as const)('keeps an unrelated B session draft after a real anonymous %s exchange', async kind => {
  let sessionReads = 0;
  vi.stubGlobal('fetch', vi.fn(async (path: string) => {
    if (path.endsWith('/auth/session')) { sessionReads++; return response(session('account-b')); }
    if (path.endsWith('/csrf')) return response({ csrfToken: 'csrf' });
    return new Response(null, { status: 204 });
  }));
  application(); fireEvent.change(await screen.findByRole('textbox'), { target: { value: 'B draft must survive A reset' } });
  await act(async () => {
    if (kind === 'reset') await completePasswordReset({ resetId: 'reset-a', temporaryCode: 'credential-a', newPassword: 'ReplacementPassword123!' });
    else await apiRequest('/api/v1/auth/password-recovery/complete', { method: 'POST', body: JSON.stringify({ token: 't'.repeat(43), newPassword: 'ReplacementPassword123!' }) });
  });
  await waitFor(() => expect(sessionReads).toBe(2));
  expect(await screen.findByRole('textbox')).toHaveValue('B draft must survive A reset');
  expect(useWorkTabsStore.getState().sessionScope).toBe('INTERNAL:a:account-b'); expect(mounts).toBe(1);
});

it('retains the password dialog input and business draft when the current password is rejected with a real 401', async () => {
  let sessionReads = 0;
  vi.stubGlobal('fetch', vi.fn(async (path: string) => {
    if (path.endsWith('/auth/session')) { sessionReads++; return response(session()); }
    if (path.endsWith('/csrf')) return response({ csrfToken: 'csrf' });
    return response({ code: 'AUTH_CURRENT_PASSWORD_INVALID' }, 401);
  }));
  render(<MemoryRouter><AuthenticatedRoute accountType="INTERNAL"><Draft /><PasswordChangeDialog onClose={() => {}} onSuccess={() => {}} afterClose={() => {}} /></AuthenticatedRoute></MemoryRouter>);
  fireEvent.change(await screen.findByLabelText('当前密码'), { target: { value: 'wrong current password' } });
  fireEvent.change(screen.getByLabelText('新密码'), { target: { value: 'ReplacementPassword123!' } });
  fireEvent.change(screen.getByLabelText('draft'), { target: { value: 'unsaved business draft' } });
  fireEvent.click(screen.getByRole('button', { name: '修改密码' }));
  expect(await screen.findByText('当前密码错误')).toBeInTheDocument();
  await waitFor(() => expect(sessionReads).toBe(2));
  expect(screen.getByLabelText('当前密码')).toHaveValue('wrong current password');
  expect(screen.getByLabelText('新密码')).toHaveValue('ReplacementPassword123!');
  expect(screen.getByLabelText('draft')).toHaveValue('unsaved business draft'); expect(mounts).toBe(1);
});

it('keeps enrollment secrets and the wrong factor visible to their owner after a real input 401', async () => {
  let sessionReads = 0;
  vi.stubGlobal('fetch', vi.fn(async (path: string) => {
    if (path.endsWith('/auth/session')) { sessionReads++; return response(session()); }
    if (path.endsWith('/csrf')) return response({ csrfToken: 'csrf' });
    if (path.endsWith('/enrollment')) return response({ secret: 'KEEP-ENROLLMENT', otpauthUri: 'otpauth://totp/TEST', expiresAt: '2026-10-30T12:00:00Z' });
    if (path.endsWith('/confirm')) return response({ code: 'AUTH_MFA_CODE_INVALID' }, 401);
    return response({ isAdministrator: false, mfaEnabled: false, mfaRequired: false, securityState: 'AUTHENTICATED', recoveryCodesRemaining: 0, emailVerifiedAt: '2026-10-17' });
  }));
  render(<MemoryRouter><AuthenticatedRoute accountType="INTERNAL"><SecurityDialog open onClose={() => {}} /></AuthenticatedRoute></MemoryRouter>);
  fireEvent.click(await screen.findByRole('button', { name: '绑定验证器' }));
  fireEvent.change(await screen.findByLabelText('验证码或恢复码'), { target: { value: '123456' } });
  fireEvent.click(screen.getByRole('button', { name: /验.?证/ }));
  expect(await screen.findByText('验证码无效或已使用，请使用新的验证码')).toBeInTheDocument();
  await waitFor(() => expect(sessionReads).toBe(2));
  expect(screen.getByLabelText('验证码或恢复码')).toHaveValue('123456');
  expect(screen.getByText('KEEP-ENROLLMENT')).toBeInTheDocument();
});

it('keeps the pending reauthentication flow and caller draft after a real wrong-password-or-factor 401', async () => {
  let sessionReads = 0;
  vi.stubGlobal('fetch', vi.fn(async (path: string) => {
    if (path.endsWith('/auth/session')) { sessionReads++; return response(session()); }
    if (path.endsWith('/csrf')) return response({ csrfToken: 'csrf' });
    return response({ code: path.endsWith('/reauthenticate') ? 'AUTH_MFA_CODE_INVALID' : 'AUTH_REAUTHENTICATION_REQUIRED' }, path.endsWith('/reauthenticate') ? 401 : 403);
  }));
  function Action() { return <button onClick={() => void apiRequest('/api/v1/admin/users').catch(() => {})}>Protected action</button>; }
  render(<MemoryRouter><AuthenticatedRoute accountType="INTERNAL"><ReauthenticationProvider><Draft /><Action /></ReauthenticationProvider></AuthenticatedRoute></MemoryRouter>);
  fireEvent.change(await screen.findByLabelText('draft'), { target: { value: 'caller draft' } });
  fireEvent.click(screen.getByRole('button', { name: 'Protected action' }));
  fireEvent.change(await screen.findByLabelText('当前密码'), { target: { value: 'wrong password' } });
  fireEvent.change(screen.getByLabelText('验证码或恢复码'), { target: { value: '123456' } });
  fireEvent.click(screen.getByRole('button', { name: /验.?证/ }));
  expect(await screen.findByText('验证码无效或已使用，请使用新的验证码')).toBeInTheDocument();
  await waitFor(() => expect(sessionReads).toBe(2));
  expect(screen.getByLabelText('当前密码')).toHaveValue('wrong password');
  expect(screen.getByLabelText('验证码或恢复码')).toHaveValue('123456');
  expect(screen.getByLabelText('draft')).toHaveValue('caller draft'); expect(mounts).toBe(1);
});
