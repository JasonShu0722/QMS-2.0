import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { StrictMode } from 'react';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { AuthenticatedRoute } from './AuthenticatedRoute';
import { LoginPage } from './LoginPage';
import { RequiredPasswordChangePage } from './RequiredPasswordChangePage';
import { SecurityPage } from './SecurityPage';

const id = '2c7b3607-1d6d-4304-9a72-f595c8467d88';
const target = `/console/users?organizationId=${id}&section=users&userId=${id}`;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const authenticated = { accountType: 'INTERNAL', landingPath: '/app/workbench', securityState: 'AUTHENTICATED' };
const security = { securityState: 'MFA_REQUIRED', mfaEnabled: true, mfaRequired: true, recoveryCodesRemaining: 1 };

function Probe() {
  const location = useLocation();
  return <output aria-label="location">{JSON.stringify({ path: location.pathname + location.search, state: location.state })}</output>;
}
function NavigationControls() {
  const navigate = useNavigate();
  const location = useLocation();
  return <><button onClick={() => navigate('/away')}>Leave authentication</button><button onClick={() => navigate(location.pathname, { state: { returnTo: '/console/audit-log' } })}>Replace authentication target</button></>;
}
function mount(path: string, state?: unknown, controls = false) {
  const content = <MemoryRouter initialEntries={[{ pathname: path.split('?')[0], search: path.includes('?') ? `?${path.split('?')[1]}` : '', state }]}><Probe />{controls && <NavigationControls />}<Routes>
    <Route path="/login" element={<LoginPage />} />
    <Route path="/change-password" element={<RequiredPasswordChangePage />} />
    <Route path="/mfa" element={<SecurityPage />} />
    <Route path="/app/workbench" element={<div>Default landing</div>} />
    <Route path="/supplier/inbox" element={<div>Supplier landing</div>} />
    <Route path="/password-recovery" element={<div>Recovery destination</div>} />
    <Route path="/away" element={<div>Away destination</div>} />
    <Route path="/console/*" element={<AuthenticatedRoute accountType="INTERNAL"><div>Authorized console</div></AuthenticatedRoute>} />
    <Route path="/app/workflow-designer/*" element={<AuthenticatedRoute accountType="INTERNAL"><div>Authorized console</div></AuthenticatedRoute>} />
    <Route path="/app/supplier-quality/eight-d/:problemId" element={<AuthenticatedRoute accountType="INTERNAL"><div>Authorized console</div></AuthenticatedRoute>} />
  </Routes></MemoryRouter>;
  render(controls ? <StrictMode>{content}</StrictMode> : content);
}
async function signIn() {
  await waitFor(() => expect(screen.getByRole('button', { name: '登录' })).toBeEnabled());
  fireEvent.change(screen.getByLabelText('账号'), { target: { value: 'test-account' } });
  fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'Test-password-123!' } });
  fireEvent.submit(screen.getByLabelText('账号').closest('form')!);
}
async function changePassword() {
  const password = await screen.findByLabelText('新密码');
  fireEvent.change(password, { target: { value: 'Permanent-password-123!' } });
  fireEvent.change(screen.getByLabelText('确认新密码'), { target: { value: 'Permanent-password-123!' } });
  fireEvent.submit(password.closest('form')!);
}
async function verifyMfa() {
  const code = await screen.findByLabelText('验证码或恢复码');
  fireEvent.change(code, { target: { value: '123456' } });
  fireEvent.submit(code.closest('form')!);
}
afterEach(async () => {
  cleanup();
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 25)); });
  vi.unstubAllGlobals(); vi.restoreAllMocks();
  localStorage.clear(); sessionStorage.clear();
});

it.each([
  `/console/audit-log?organizationId=${id}&section=audit-log&resourceType=USER&resourceId=${id}`,
  `/console/workflows/${id}/${id}?organizationId=${id}`,
  `/app/workflow-designer/${id}/${id}?organizationId=${id}`,
  `/app/supplier-quality/eight-d/${id}?organizationId=${id}`,
])('preserves %s through anonymous login, password change and MFA, then rechecks the formal route', async deepLink => {
  let signedIn = false;
  let passwordChanged = false;
  let verified = false;
  const fetcher = vi.fn(async (path: string) => {
    if (path.endsWith('/csrf')) return json({ csrfToken: 'test-csrf' });
    if (path.endsWith('/session')) return verified ? json({ ...authenticated, user: { accountType: 'INTERNAL', id: 'user-1', organizationId: 'org-1' } }) : json({ code: 'AUTH_SESSION_REQUIRED' }, 401);
    if (path.endsWith('/login')) { signedIn = true; return json({ ...authenticated, landingPath: '/change-password', securityState: 'PASSWORD_CHANGE_REQUIRED' }); }
    if (path.endsWith('/password-change/complete')) { passwordChanged = true; return json({ ...authenticated, landingPath: '/mfa', securityState: 'MFA_REQUIRED' }); }
    if (path.endsWith('/password-change')) return signedIn ? json({ ...authenticated, landingPath: '/change-password', securityState: 'PASSWORD_CHANGE_REQUIRED' }) : json({ code: 'AUTH_PASSWORD_CHANGE_INVALID' }, 401);
    if (path.endsWith('/mfa/verify')) { verified = true; return json(authenticated); }
    if (path.endsWith('/me/security')) return json(security);
    throw new Error(`Unexpected request: ${path}`);
  });
  vi.stubGlobal('fetch', fetcher);
  const localWrites = vi.spyOn(Storage.prototype, 'setItem');
  // Legacy management links reject the whole invalid target; other business paths still strip sensitive fields.
  mount(deepLink.startsWith('/app/workflow-designer/') ? deepLink : `${deepLink}&token=do-not-retain&password=private`);
  await signIn();
  await screen.findByLabelText('新密码');
  expect(screen.getByLabelText('location')).toHaveTextContent('returnTo');
  expect(screen.getByLabelText('location')).not.toHaveTextContent('do-not-retain');
  expect(screen.queryByText('Authorized console')).not.toBeInTheDocument();
  await changePassword();
  await screen.findByLabelText('验证码或恢复码');
  expect(passwordChanged).toBe(true);
  expect(screen.queryByText('Authorized console')).not.toBeInTheDocument();
  await verifyMfa();
  expect(await screen.findByText('Authorized console')).toBeInTheDocument();
  expect(screen.getByLabelText('location')).toHaveTextContent(deepLink);
  expect(screen.getByLabelText('location')).not.toHaveTextContent('returnTo');
  expect(fetcher.mock.calls.filter(([path]) => path.endsWith('/session')).length).toBeGreaterThanOrEqual(3);
  expect(localWrites.mock.calls.every(([key, value]) => key === 'qms:work-pages:v1' && !/returnTo|do-not-retain|private|Permanent-password|test-csrf|123456/.test(value))).toBe(true);
});

it('consumes legacy state.from when a session already exists', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => json({ ...authenticated, user: { accountType: 'INTERNAL', id: 'user-1', organizationId: 'org-1' } })));
  mount('/login', { from: target });
  expect(await screen.findByText('Authorized console')).toBeInTheDocument();
  expect(screen.getByLabelText('location')).toHaveTextContent(target);
});

it.each([
  `/app/admin?organizationId=${id}&section=users&userId=${id}&unknown=value`,
  `/app/workflow-designer/${id}/${id}?organizationId=${id}&unknown=value`,
])('drops an invalid legacy login target and uses only the server landing: %s', async returnTo => {
  vi.stubGlobal('fetch', vi.fn(async (path: string) => path.endsWith('/session') ? json({ code: 'AUTH_SESSION_REQUIRED' }, 401)
    : path.endsWith('/csrf') ? json({ csrfToken: 'test-csrf' }) : json(authenticated)));
  mount('/login', { returnTo });
  await signIn();
  expect(await screen.findByText('Default landing')).toBeVisible();
  expect(screen.getByLabelText('location')).toHaveTextContent('"path":"/app/workbench","state":null');
  expect(screen.queryByText('Authorized console')).not.toBeInTheDocument();
});

it('returns an existing forced-password challenge to its original protected location', async () => {
  let changed = false;
  vi.stubGlobal('fetch', vi.fn(async (path: string) => {
    if (path.endsWith('/csrf')) return json({ csrfToken: 'test-csrf' });
    if (path.endsWith('/session')) return changed ? json({ ...authenticated, user: { accountType: 'INTERNAL', id: 'user-1', organizationId: 'org-1' } }) : json({ code: 'AUTH_SESSION_REQUIRED' }, 401);
    if (path.endsWith('/complete')) { changed = true; return json(authenticated); }
    return json({ ...authenticated, landingPath: '/change-password', securityState: 'PASSWORD_CHANGE_REQUIRED' });
  }));
  mount(target);
  await changePassword();
  expect(await screen.findByText('Authorized console')).toBeInTheDocument();
  expect(screen.getByLabelText('location')).toHaveTextContent(target);
});

it('drops the previous identity target on forced-password exit', async () => {
  vi.stubGlobal('fetch', vi.fn(async (path: string) => path.endsWith('/csrf') ? json({ csrfToken: 'test-csrf' }) : path.endsWith('/logout') ? new Response(null, { status: 204 }) : path.endsWith('/session') ? json({ code: 'AUTH_SESSION_REQUIRED' }, 401) : json({ securityState: 'PASSWORD_CHANGE_REQUIRED' })));
  mount('/change-password', { returnTo: target });
  const password = await screen.findByLabelText('新密码');
  expect(password).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '退出并返回登录' }));
  await waitFor(() => expect(screen.getByLabelText('location')).toHaveTextContent('"path":"/login","state":null'));
});

it('waits for enrollment recovery-code acknowledgement before returning through the formal route', async () => {
  let enrolled = false;
  vi.stubGlobal('fetch', vi.fn(async (path: string) => {
    if (path.endsWith('/csrf')) return json({ csrfToken: 'test-csrf' });
    if (path.endsWith('/enrollment')) return json({ secret: 'TEST-ONLY', otpauthUri: 'otpauth://totp/TEST', expiresAt: '2026-10-30T00:00:00Z' });
    if (path.endsWith('/confirm')) { enrolled = true; return json({ ...authenticated, recoveryCodes: ['test-recovery-code'] }); }
    if (path.endsWith('/session')) return json({ ...authenticated, user: { accountType: 'INTERNAL', id: 'user-1', organizationId: 'org-1' } });
    return json({ ...security, securityState: enrolled ? 'AUTHENTICATED' : 'MFA_ENROLLMENT_REQUIRED', mfaEnabled: enrolled });
  }));
  mount('/mfa', { returnTo: target });
  fireEvent.click(await screen.findByRole('button', { name: '启用 MFA' }));
  await verifyMfa();
  expect(await screen.findByText('test-recovery-code')).toBeInTheDocument();
  expect(screen.queryByText('Authorized console')).not.toBeInTheDocument();
  expect(screen.getByLabelText('location')).toHaveTextContent('"path":"/mfa"');
  fireEvent.click(screen.getByRole('button', { name: '已保存，继续' }));
  expect(await screen.findByText('Authorized console')).toBeInTheDocument();
  expect(screen.getByLabelText('location')).toHaveTextContent(target);
  expect(screen.getByLabelText('location')).not.toHaveTextContent('test-recovery-code');
});

it.each(['//evil.test/console/users', target])('falls back to the supplier landing after login for rejected internal or external target %s', async returnTo => {
  vi.stubGlobal('fetch', vi.fn(async (path: string) => path.endsWith('/session') ? json({ code: 'AUTH_SESSION_REQUIRED' }, 401) : path.endsWith('/csrf') ? json({ csrfToken: 'test-csrf' }) : json({ accountType: 'SUPPLIER', landingPath: '/supplier/inbox', securityState: 'AUTHENTICATED' })));
  mount('/login', { returnTo });
  await signIn();
  expect(await screen.findByText('Supplier landing')).toBeInTheDocument();
  expect(screen.getByLabelText('location')).toHaveTextContent('"state":null');
  expect(screen.queryByText('Authorized console')).not.toBeInTheDocument();
});

it('does not carry an abandoned MFA target into another login', async () => {
  vi.stubGlobal('fetch', vi.fn(async (path: string) => path.endsWith('/session') ? json({ code: 'AUTH_SESSION_REQUIRED' }, 401) : json(security)));
  mount('/mfa', { returnTo: target });
  await screen.findByLabelText('验证码或恢复码');
  fireEvent.click(screen.getByRole('link', { name: '返回登录' }));
  await waitFor(() => expect(screen.getByLabelText('location')).toHaveTextContent('"path":"/login","state":null'));
});

function deferredResponse() {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>(done => { resolve = done; });
  return { promise, resolve };
}

it.each((['login', 'mfa', 'change-password'] as const).flatMap(page => [true, false].map(success => ({ page, success }))))('ignores an old $page response after leaving the page (success=$success)', async ({ page, success }) => {
  const old = deferredResponse();
  const mutation = page === 'login' ? '/login' : page === 'mfa' ? '/mfa/verify' : '/password-change/complete';
  const fetcher = vi.fn(async (path: string) => path.endsWith('/csrf') ? json({ csrfToken: 'test-csrf' })
    : path.endsWith('/session') ? json({ code: 'AUTH_SESSION_REQUIRED' }, 401)
      : path.endsWith(mutation) ? old.promise : page === 'mfa' ? json(security) : json({ securityState: 'PASSWORD_CHANGE_REQUIRED' }));
  vi.stubGlobal('fetch', fetcher);
  mount(`/${page}`, { returnTo: target }, true);
  if (page === 'login') await signIn(); else if (page === 'mfa') await verifyMfa(); else await changePassword();
  await waitFor(() => expect(fetcher.mock.calls.some(([path]) => path.endsWith(mutation))).toBe(true));
  if (page === 'login') fireEvent.click(screen.getByRole('link', { name: '找回密码' }));
  else if (page === 'mfa') fireEvent.click(screen.getByRole('link', { name: '返回登录' }));
  else fireEvent.click(screen.getByRole('button', { name: 'Leave authentication' }));
  const destination = page === 'login' ? '/password-recovery' : page === 'mfa' ? '/login' : '/away';
  await waitFor(() => expect(screen.getByLabelText('location')).toHaveTextContent(`"path":"${destination}"`));
  if (page === 'mfa') await waitFor(() => expect(screen.getByRole('button', { name: '登录' })).toBeEnabled());
  const sessionReads = fetcher.mock.calls.filter(([path]) => path.endsWith('/session')).length;
  await act(async () => { old.resolve(success ? json(authenticated) : json({ code: 'AUTH_INVALID_CREDENTIALS', traceId: 'stale-auth-error' }, 401)); });
  expect(screen.getByLabelText('location')).toHaveTextContent(`"path":"${destination}"`);
  expect(screen.getByLabelText('location')).toHaveTextContent('"state":null');
  expect(fetcher.mock.calls.filter(([path]) => path.endsWith('/session'))).toHaveLength(sessionReads);
  expect(screen.queryByText('stale-auth-error')).not.toBeInTheDocument();
  expect(screen.queryByText('Authorized console')).not.toBeInTheDocument();
  cleanup();
});

it.each((['login', 'mfa', 'change-password'] as const).flatMap(page => [true, false].map(success => ({ page, success }))))('keeps a new same-path $page navigation independent of the old response (success=$success)', async ({ page, success }) => {
  const old = deferredResponse();
  const current = deferredResponse();
  let writes = 0;
  const mutation = page === 'login' ? '/login' : page === 'mfa' ? '/mfa/verify' : '/password-change/complete';
  vi.stubGlobal('fetch', vi.fn(async (path: string) => path.endsWith('/csrf') ? json({ csrfToken: 'test-csrf' })
    : path.endsWith('/session') ? json({ code: 'AUTH_SESSION_REQUIRED' }, 401)
      : path.endsWith(mutation) ? ++writes === 1 ? old.promise : current.promise : page === 'mfa' ? json(security) : json({ securityState: 'PASSWORD_CHANGE_REQUIRED' })));
  mount(`/${page}`, { returnTo: target }, true);
  const submit = page === 'login' ? signIn : page === 'mfa' ? verifyMfa : changePassword;
  await submit();
  await waitFor(() => expect(writes).toBe(1));
  fireEvent.click(screen.getByRole('button', { name: 'Replace authentication target' }));
  const label = page === 'login' ? '账号' : page === 'mfa' ? '验证码或恢复码' : '新密码';
  await waitFor(() => expect(screen.getByLabelText(label)).toBeEnabled());
  expect(screen.getByLabelText(page === 'login' ? '密码' : label)).toHaveValue('');
  await submit();
  await waitFor(() => expect(writes).toBe(2));
  await act(async () => { old.resolve(success ? json(authenticated) : json({ code: 'AUTH_INVALID_CREDENTIALS', traceId: 'stale-auth-error' }, 401)); });
  expect(screen.getByLabelText('location')).toHaveTextContent(`"path":"/${page}"`);
  expect(screen.getByLabelText('location')).toHaveTextContent('/console/audit-log');
  expect(screen.getByLabelText(label)).toBeDisabled();
  expect(screen.queryByText('stale-auth-error')).not.toBeInTheDocument();
  await act(async () => { current.resolve(json({ code: 'AUTH_INVALID_CREDENTIALS', traceId: 'current-auth-error' }, 401)); });
  await waitFor(() => expect(screen.getByLabelText(label)).toBeEnabled());
  cleanup();
});

it.each((['enroll', 'confirm', 'recovery', 'email-request', 'email-complete'] as const).flatMap(operation => [true, false].map(success => ({ operation, success }))))('does not refill old $operation secrets or feedback after same-path navigation (success=$success)', async ({ operation, success }) => {
  const old = deferredResponse();
  const endpoint = { enroll: '/enrollment', confirm: '/enrollment/confirm', recovery: '/recovery-codes', 'email-request': '/me/email-verification', 'email-complete': '/email-verification/complete' }[operation];
  let writes = 0;
  vi.stubGlobal('fetch', vi.fn(async (path: string) => {
    if (path.endsWith('/csrf')) return json({ csrfToken: 'test-csrf' });
    if (path.endsWith(endpoint)) { writes++; return old.promise; }
    if (path.endsWith('/enrollment')) return json({ secret: 'CURRENT-ENROLLMENT', otpauthUri: 'otpauth://totp/TEST', expiresAt: '2026-10-30T00:00:00Z' });
    return json({ ...security, securityState: 'AUTHENTICATED', mfaEnabled: operation !== 'enroll' && operation !== 'confirm', emailVerifiedAt: null });
  }));
  mount('/mfa', { returnTo: target }, true);
  if (operation === 'enroll' || operation === 'confirm') {
    fireEvent.click(await screen.findByRole('button', { name: '绑定验证器' }));
    if (operation === 'confirm') await verifyMfa();
  } else if (operation === 'recovery') fireEvent.click(await screen.findByRole('button', { name: '重新生成恢复码' }));
  else if (operation === 'email-request') fireEvent.click(await screen.findByRole('button', { name: '发送确认邮件' }));
  else {
    const token = await screen.findByLabelText('邮件凭证');
    fireEvent.change(token, { target: { value: 's'.repeat(43) } });
    fireEvent.submit(token.closest('form')!);
  }
  await waitFor(() => expect(writes).toBe(1));
  fireEvent.click(screen.getByRole('button', { name: 'Replace authentication target' }));
  await act(async () => { old.resolve(success ? json({ ...authenticated, secret: 'STALE-SECRET', recoveryCodes: ['STALE-RECOVERY'], otpauthUri: 'otpauth://totp/OLD', expiresAt: '2026-10-30T00:00:00Z' }) : json({ code: 'AUTH_MFA_CODE_INVALID', traceId: 'stale-auth-error' }, 401)); });
  expect(screen.getByLabelText('location')).toHaveTextContent('"path":"/mfa"');
  expect(screen.queryByText(/STALE-SECRET|STALE-RECOVERY|CURRENT-ENROLLMENT|stale-auth-error/)).not.toBeInTheDocument();
  expect(screen.queryByText('确认邮件已申请，请查看邮箱。')).not.toBeInTheDocument();
  expect(screen.queryByText('邮箱已确认')).not.toBeInTheDocument();
  cleanup();
});

it.each([true, false])('ignores an old password-challenge logout result and finally callback in a new navigation generation (success=%s)', async success => {
  const old = deferredResponse();
  const current = deferredResponse();
  let writes = 0;
  vi.stubGlobal('fetch', vi.fn(async (path: string) => path.endsWith('/csrf') ? json({ csrfToken: 'test-csrf' })
    : path.endsWith('/logout') ? ++writes === 1 ? old.promise : current.promise : json({ securityState: 'PASSWORD_CHANGE_REQUIRED' })));
  mount('/change-password', { returnTo: target }, true);
  await screen.findByLabelText('新密码');
  fireEvent.click(screen.getByRole('button', { name: '退出并返回登录' }));
  await waitFor(() => expect(writes).toBe(1));
  fireEvent.click(screen.getByRole('button', { name: 'Replace authentication target' }));
  await waitFor(() => expect(screen.getByRole('button', { name: '退出并返回登录' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: '退出并返回登录' }));
  await waitFor(() => expect(writes).toBe(2));
  await act(async () => { old.resolve(success ? new Response(null, { status: 204 }) : json({ code: 'AUTH_INVALID_CREDENTIALS' }, 401)); });
  expect(screen.getByLabelText('location')).toHaveTextContent('"path":"/change-password"');
  expect(screen.getByLabelText('location')).toHaveTextContent('/console/audit-log');
  expect(screen.getByRole('button', { name: '退出并返回登录' })).toBeDisabled();
  expect(screen.queryByText('用户名或密码错误')).not.toBeInTheDocument();
  await act(async () => { current.resolve(json({ code: 'AUTH_INVALID_CREDENTIALS' }, 401)); });
  await waitFor(() => expect(screen.getByRole('button', { name: '退出并返回登录' })).toBeEnabled());
  cleanup();
});

it('clears the login password store on a new navigation generation while the previous login is pending', async () => {
  const old = deferredResponse();
  let writes = 0;
  vi.stubGlobal('fetch', vi.fn(async (path: string) => path.endsWith('/session') ? json({ code: 'AUTH_SESSION_REQUIRED' }, 401)
    : path.endsWith('/csrf') ? json({ csrfToken: 'test-csrf' }) : (writes++, old.promise)));
  mount('/login', { returnTo: target }, true);
  await signIn();
  await waitFor(() => expect(writes).toBe(1));
  fireEvent.click(screen.getByRole('button', { name: 'Replace authentication target' }));
  await waitFor(() => expect(screen.getByRole('button', { name: '登录' })).toBeEnabled());
  expect(screen.getByLabelText('密码')).toHaveValue('');
  fireEvent.change(screen.getByLabelText('账号'), { target: { value: 'new-account' } });
  fireEvent.submit(screen.getByLabelText('账号').closest('form')!);
  expect(await screen.findByText('请输入密码')).toBeInTheDocument();
  expect(writes).toBe(1);
  await act(async () => { old.resolve(json({ code: 'AUTH_INVALID_CREDENTIALS', traceId: 'stale-auth-error' }, 401)); });
  expect(screen.getByLabelText('密码')).toHaveValue('');
  expect(screen.queryByText('stale-auth-error')).not.toBeInTheDocument();
});

it('retains login inputs for a network failure retry within the same navigation generation', async () => {
  const bodies: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (path: string, init?: RequestInit) => {
    if (path.endsWith('/session')) return json({ code: 'AUTH_SESSION_REQUIRED' }, 401);
    if (path.endsWith('/csrf')) return json({ csrfToken: 'test-csrf' });
    bodies.push(String(init?.body));
    if (bodies.length === 1) throw new TypeError('test network failure');
    return json({ code: 'AUTH_INVALID_CREDENTIALS' }, 401);
  }));
  mount('/login', { returnTo: target }, true);
  await signIn();
  await waitFor(() => expect(bodies).toHaveLength(1));
  await waitFor(() => expect(screen.getByLabelText('密码')).toBeEnabled());
  expect(screen.getByLabelText('账号')).toHaveValue('test-account');
  expect(screen.getByLabelText('密码')).toHaveValue('Test-password-123!');
  fireEvent.submit(screen.getByLabelText('账号').closest('form')!);
  await waitFor(() => expect(bodies).toHaveLength(2));
  expect(JSON.parse(bodies[1]!)).toEqual({ identifier: 'test-account', password: 'Test-password-123!', rememberMe: false });
});

it('clears a preserved email credential store hidden behind recovery codes before a new navigation generation', async () => {
  const fetcher = vi.fn(async (path: string) => path.endsWith('/csrf') ? json({ csrfToken: 'test-csrf' })
    : path.endsWith('/recovery-codes') ? json({ recoveryCodes: ['test-recovery-code'] })
      : json({ ...security, securityState: 'AUTHENTICATED', emailVerifiedAt: null }));
  vi.stubGlobal('fetch', fetcher);
  mount('/mfa', { returnTo: target }, true);
  fireEvent.change(await screen.findByLabelText('邮件凭证'), { target: { value: 's'.repeat(43) } });
  fireEvent.click(screen.getByRole('button', { name: '重新生成恢复码' }));
  expect(await screen.findByText('test-recovery-code')).toBeInTheDocument();
  expect(screen.queryByLabelText('邮件凭证')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Replace authentication target' }));
  const credential = await screen.findByLabelText('邮件凭证');
  expect(credential).toHaveValue('');
  fireEvent.submit(credential.closest('form')!);
  await waitFor(() => expect(credential).toHaveAttribute('aria-invalid', 'true'));
  expect(fetcher.mock.calls.some(([path]) => path.endsWith('/email-verification/complete'))).toBe(false);
});
