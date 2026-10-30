import { afterEach, expect, it, vi } from 'vitest';
import { publishSessionSignal, subscribeSessionSignals } from './session-invalidation';

afterEach(() => { vi.unstubAllGlobals(); localStorage.clear(); });

it('sends only a bounded signal, receives remote signals without echo, and closes its channel', () => {
  const postMessage = vi.fn(); const close = vi.fn();
  let channel!: { onmessage: ((event: MessageEvent) => void) | null };
  vi.stubGlobal('BroadcastChannel', class { onmessage = null; postMessage = postMessage; close = close; constructor() { channel = this; } });
  const listener = vi.fn(); const stop = subscribeSessionSignals(listener);
  publishSessionSignal('invalidate');
  expect(listener).toHaveBeenLastCalledWith('invalidate');
  expect(postMessage).toHaveBeenCalledWith('invalidate');
  channel.onmessage!(new MessageEvent('message', { data: 'revalidate' }));
  expect(listener).toHaveBeenLastCalledWith('revalidate');
  channel.onmessage!(new MessageEvent('message', { data: { token: 'secret', signal: 'invalidate' } }));
  expect(listener).toHaveBeenCalledTimes(2);
  expect(postMessage).toHaveBeenCalledTimes(1);
  stop(); expect(close).toHaveBeenCalledOnce();
});

it('falls back to storage signals without storing identity or drafts and removes listeners', () => {
  vi.stubGlobal('BroadcastChannel', undefined);
  const listener = vi.fn(); const stop = subscribeSessionSignals(listener);
  publishSessionSignal('revalidate');
  const stored = localStorage.getItem('qms:session-signal:v1')!;
  expect(JSON.parse(stored)).toEqual({ signal: 'revalidate', nonce: expect.any(String) });
  window.dispatchEvent(new StorageEvent('storage', { key: 'qms:session-signal:v1', newValue: JSON.stringify({ signal: 'invalidate', nonce: 'remote' }) }));
  expect(listener).toHaveBeenLastCalledWith('invalidate');
  stop();
  window.dispatchEvent(new StorageEvent('storage', { key: 'qms:session-signal:v1', newValue: stored }));
  expect(listener).toHaveBeenCalledTimes(2);
});

it('still delivers locally when browser communication and storage are unavailable', () => {
  vi.stubGlobal('BroadcastChannel', class { constructor() { throw new Error('privacy'); } });
  const write = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('privacy'); });
  const listener = vi.fn(); const stop = subscribeSessionSignals(listener);
  expect(() => publishSessionSignal('invalidate')).not.toThrow();
  expect(listener).toHaveBeenCalledWith('invalidate');
  stop(); write.mockRestore();
});

it('uses actual client authentication calls and keeps session probes from broadcasting recursively', async () => {
  const { apiRequest, login, logout, getSession } = await import('../../api/client');
  const listener = vi.fn(); const stop = subscribeSessionSignals(listener);
  vi.stubGlobal('fetch', vi.fn(async (path: string) => new Response(JSON.stringify(path.endsWith('/csrf') ? { csrfToken: 'not-broadcast' } : { securityState: 'AUTHENTICATED' }), { headers: { 'content-type': 'application/json' } })));
  try {
    await login({ identifier: 'user', password: 'secret', rememberMe: false });
    expect(listener).toHaveBeenLastCalledWith('invalidate');
    await logout(); expect(listener).toHaveBeenCalledTimes(2);
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ code: 'AUTH_SESSION_REQUIRED' }), { status: 401, headers: { 'content-type': 'application/json' } })));
    await expect(getSession()).rejects.toThrow(); expect(listener).toHaveBeenCalledTimes(2);
    await expect(apiRequest('/api/v1/me')).rejects.toThrow(); expect(listener).toHaveBeenCalledTimes(3);
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ code: 'FEATURE_PERMISSION_DENIED' }), { status: 403, headers: { 'content-type': 'application/json' } })));
    await expect(apiRequest('/api/v1/admin/users')).rejects.toThrow(); expect(listener).toHaveBeenCalledTimes(4);
    expect(listener).toHaveBeenLastCalledWith('revalidate');
  } finally { stop(); }
});

it.each([
  ['/api/v1/organizations/a/positions/p/permissions', 'PUT'],
  ['/api/v1/organizations/a/users/user/positions', 'PUT'],
  ['/api/v1/me/mfa/enrollment/confirm', 'POST'],
  ['/api/v1/me/mfa/recovery-codes', 'POST'],
] as const)('requests soft revalidation after a real successful %s mutation, never after reads', async (path, method) => {
  const { apiRequest } = await import('../../api/client');
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { headers: { 'content-type': 'application/json' } })));
  const listener = vi.fn(); const stop = subscribeSessionSignals(listener);
  try {
    await apiRequest(path); expect(listener).not.toHaveBeenCalled();
    await apiRequest(path, { method }); expect(listener).toHaveBeenCalledExactlyOnceWith('revalidate');
  } finally { stop(); }
});

it.each([
  ['/api/v1/auth/password-reset/complete', 'normal'], ['/api/v1/auth/password-reset/complete', 'late'],
  ['/api/v1/auth/password-reset/complete', 'abort'], ['/api/v1/auth/password-reset/complete', 'parse'],
  ['/api/v1/auth/password-recovery/complete', 'normal'], ['/api/v1/auth/password-recovery/complete', 'late'],
  ['/api/v1/auth/password-recovery/complete', 'abort'], ['/api/v1/auth/password-recovery/complete', 'parse'],
] as const)('softly notifies a successful public %s exchange before %s response handling', async (path, mode) => {
  const { apiRequest, completePasswordReset } = await import('../../api/client');
  let finish!: (value: Response) => void; let sent!: () => void;
  const dispatched = new Promise<void>(resolve => { sent = resolve; });
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url.endsWith('/csrf')) return new Response(JSON.stringify({ csrfToken: 'csrf' }), { headers: { 'content-type': 'application/json' } });
    return new Promise<Response>(resolve => { finish = resolve; sent(); });
  }));
  const listener = vi.fn(); const stop = subscribeSessionSignals(listener);
  const controller = new AbortController();
  try {
    const pending = path.includes('password-reset') && mode !== 'abort'
      ? completePasswordReset({ resetId: 'reset-id', temporaryCode: 'code', newPassword: 'ReplacementPassword123!' })
      : apiRequest(path, { method: 'POST', signal: mode === 'abort' ? controller.signal : undefined, body: JSON.stringify(path.includes('password-reset') ? { resetId: 'reset-id', temporaryCode: 'code', newPassword: 'ReplacementPassword123!' } : { token: 't'.repeat(43), newPassword: 'ReplacementPassword123!' }) });
    await dispatched;
    if (mode === 'late') publishSessionSignal('invalidate');
    if (mode === 'abort') controller.abort();
    const result = mode === 'late' || mode === 'abort' ? expect(pending).rejects.toMatchObject({ name: 'AbortError' })
      : mode === 'parse' ? expect(pending).rejects.toBeInstanceOf(SyntaxError) : pending;
    finish(new Response(mode === 'parse' ? 'not json' : '{}', { headers: { 'content-type': 'application/json' } }));
    await result;
    expect(listener).toHaveBeenCalledTimes(mode === 'late' ? 2 : 1);
    expect(listener).toHaveBeenLastCalledWith('revalidate');
  } finally { stop(); }
});

it.each([
  ['/api/v1/me/password', 'AUTH_CURRENT_PASSWORD_INVALID'],
  ['/api/v1/me/reauthenticate', 'AUTH_MFA_CODE_INVALID'],
  ['/api/v1/me/mfa/enrollment/confirm', 'AUTH_MFA_CODE_INVALID'],
] as const)('preserves an existing session on the real input rejection %s / %s', async (path, code) => {
  const { apiRequest, changeAccountPassword } = await import('../../api/client');
  vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(JSON.stringify(url.endsWith('/csrf') ? { csrfToken: 'csrf' } : { code }), { status: url.endsWith('/csrf') ? 200 : 401, headers: { 'content-type': 'application/json' } })));
  const listener = vi.fn(); const stop = subscribeSessionSignals(listener);
  try {
    const pending = path.endsWith('/password') ? changeAccountPassword({ currentPassword: 'wrong', newPassword: 'ReplacementPassword123!' }) : apiRequest(path, { method: 'POST', body: '{}' });
    await expect(pending).rejects.toMatchObject({ code, status: 401 });
    expect(listener).toHaveBeenCalledExactlyOnceWith('revalidate');
  } finally { stop(); }
});

it.each(['/api/v1/me/password', '/api/v1/me/reauthenticate', '/api/v1/me/mfa/enrollment/confirm'])('still hard-invalidates a real session rejection at %s', async path => {
  const { apiRequest } = await import('../../api/client');
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ code: 'AUTH_SESSION_REQUIRED' }), { status: 401, headers: { 'content-type': 'application/json' } })));
  const listener = vi.fn(); const stop = subscribeSessionSignals(listener);
  try {
    await expect(apiRequest(path, { method: 'POST' })).rejects.toMatchObject({ code: 'AUTH_SESSION_REQUIRED', status: 401 });
    expect(listener).toHaveBeenCalledExactlyOnceWith('invalidate');
  } finally { stop(); }
});

it.each([
  ['/api/v1/auth/login', 'invalidate'],
  ['/api/v1/organizations/a/users/user/positions', 'revalidate'],
] as const)('notifies known successful %s changes even if parsing the response fails', async (path, signal) => {
  const { apiRequest } = await import('../../api/client');
  vi.stubGlobal('fetch', vi.fn(async () => new Response('not json', { headers: { 'content-type': 'application/json' } })));
  const listener = vi.fn(); const stop = subscribeSessionSignals(listener);
  try {
    await expect(apiRequest(path, { method: 'POST' })).rejects.toBeInstanceOf(SyntaxError);
    expect(listener).toHaveBeenCalledExactlyOnceWith(signal);
  } finally { stop(); }
});

it('notifies a known successful cookie change before discarding an aborted caller', async () => {
  const { apiRequest } = await import('../../api/client');
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { headers: { 'content-type': 'application/json' } })));
  const listener = vi.fn(); const stop = subscribeSessionSignals(listener);
  try {
    const controller = new AbortController();
    const pending = apiRequest('/api/v1/auth/login', { method: 'POST', signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(listener).toHaveBeenCalledExactlyOnceWith('invalidate');
  } finally { stop(); }
});

it('allows its own auth signal but rejects another invalidation received while parsing that response', async () => {
  const { apiRequest } = await import('../../api/client');
  let finish!: (value: unknown) => void; let parsing!: () => void;
  const started = new Promise<void>(resolve => { parsing = resolve; });
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, headers: new Headers({ 'content-type': 'application/json' }), json: () => { parsing(); return new Promise(resolve => { finish = resolve; }); } } as Response)));
  const listener = vi.fn(); const stop = subscribeSessionSignals(listener);
  try {
    const pending = apiRequest('/api/v1/auth/login', { method: 'POST' });
    await started;
    expect(listener).toHaveBeenCalledExactlyOnceWith('invalidate');
    const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    publishSessionSignal('invalidate'); finish({ obsolete: 'do not apply' });
    await rejected;
  } finally { stop(); }
});

it('does not turn a successful or refused server request into a notification cleanup failure', async () => {
  const { apiRequest } = await import('../../api/client');
  vi.stubGlobal('BroadcastChannel', class { postMessage() { throw new Error('platform send unavailable'); } close() { throw new Error('platform close unavailable'); } });
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { headers: { 'content-type': 'application/json' } })));
  await expect(apiRequest('/api/v1/admin/users', { method: 'POST' })).resolves.toEqual({});
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 401, headers: { 'content-type': 'application/json' } })));
  await expect(apiRequest('/api/v1/me')).rejects.toMatchObject({ code: 'HTTP_401', status: 401 });
});

it('removes subscriptions even if the platform channel close throws', () => {
  vi.stubGlobal('BroadcastChannel', class { onmessage = null; close() { throw new Error('platform close unavailable'); } });
  const listener = vi.fn(); const stop = subscribeSessionSignals(listener);
  expect(stop).not.toThrow();
  window.dispatchEvent(new Event('focus'));
  expect(listener).not.toHaveBeenCalled();
});

it.each([
  ['/api/v1/auth/login', 'POST', 'invalidate'],
  ['/api/v1/organizations/a/users/user/positions', 'PUT', 'revalidate'],
] as const)('notifies a late successful %s server change while refusing its obsolete response body', async (path, method, signal) => {
  const { apiRequest } = await import('../../api/client');
  let finish!: (value: Response) => void;
  vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(resolve => { finish = resolve; })));
  const listener = vi.fn(); const stop = subscribeSessionSignals(listener);
  try {
    const pending = apiRequest(path, { method });
    publishSessionSignal('invalidate');
    const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    finish(new Response(JSON.stringify({ obsolete: 'must not apply' }), { headers: { 'content-type': 'application/json' } }));
    await rejected;
    expect(listener).toHaveBeenCalledTimes(2);
    expect(listener).toHaveBeenLastCalledWith(signal);
  } finally { stop(); }
});
