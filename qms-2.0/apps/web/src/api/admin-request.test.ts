import { afterEach, expect, it, vi } from 'vitest';
import * as client from './client';

afterEach(() => vi.unstubAllGlobals());
it.each([false, true])('preserves default replay and supports an explicit opt-out: replay=%s', async replay => {
  let recent = false;
  const writes: RequestInit[] = [];
  const unregister = client.registerReauthentication(async () => { recent = true; });
  vi.stubGlobal('fetch', vi.fn(async (path: string, init: RequestInit) => {
    if (path.endsWith('/csrf')) return new Response(JSON.stringify({ csrfToken: 'csrf' }), { headers: { 'content-type': 'application/json' } });
    writes.push(init);
    return new Response(JSON.stringify(recent ? { saved: true } : { code: 'AUTH_REAUTHENTICATION_REQUIRED' }),
      { status: recent ? 200 : 403, headers: { 'content-type': 'application/json' } });
  }));
  try {
    const mutation = replay ? client.createAdminMutation() : client.createAdminMutation({ replayAfterReauthentication: false });
    const save = () => mutation('/api/v1/admin/users/user', 'PATCH', { email: 'one@example.test' });
    if (replay) await expect(save()).resolves.toEqual({ saved: true });
    else {
      await expect(save()).rejects.toMatchObject({ code: 'CLIENT_REAUTHENTICATION_COMPLETED' });
      expect(writes).toHaveLength(1);
      await expect(save()).resolves.toEqual({ saved: true });
    }
    expect(writes).toHaveLength(2);
    expect(writes[1].body).toBe(writes[0].body);
    expect((writes[1].headers as Record<string, string>)['Idempotency-Key']).toBe((writes[0].headers as Record<string, string>)['Idempotency-Key']);
  } finally { unregister(); }
});

it('does not dispatch a scope-bound mutation after its pending CSRF read is aborted', async () => {
  let finish!: (response: Response) => void;
  const fetch = vi.fn((path: string, _init?: RequestInit) => path.endsWith('/csrf')
    ? new Promise<Response>(resolve => { finish = resolve; })
    : Promise.resolve(new Response('{}', { headers: { 'content-type': 'application/json' } })));
  vi.stubGlobal('fetch', fetch);
  const controller = new AbortController();
  const pending = client.createAdminMutation()('/api/v1/admin/users/user', 'PATCH', { email: 'one@example.test' }, controller.signal);
  const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  controller.abort();
  finish(new Response(JSON.stringify({ csrfToken: 'csrf' }), { headers: { 'content-type': 'application/json' } }));
  await rejected;
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(fetch.mock.calls[0]?.[1]?.signal).toBe(controller.signal);
});
it('keeps an aborted dispatched write key for an explicit retry with a new signal', async () => {
  const writes: RequestInit[] = [];
  let started!: () => void;
  const dispatched = new Promise<void>(resolve => { started = resolve; });
  vi.stubGlobal('fetch', vi.fn((path: string, init: RequestInit) => {
    if (path.endsWith('/csrf')) return Promise.resolve(new Response(JSON.stringify({ csrfToken: 'csrf' }), { headers: { 'content-type': 'application/json' } }));
    writes.push(init);
    if (writes.length > 1) return Promise.resolve(new Response('{}', { headers: { 'content-type': 'application/json' } }));
    return new Promise<Response>((_resolve, reject) => {
      init.signal!.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
      started();
    });
  }));
  const mutation = client.createAdminMutation();
  const controller = new AbortController();
  const pending = mutation('/api/v1/admin/users/user', 'PATCH', { email: 'one@example.test' }, controller.signal);
  const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  await dispatched; controller.abort(); await rejected;
  const retry = new AbortController();
  await mutation('/api/v1/admin/users/user', 'PATCH', { email: 'one@example.test' }, retry.signal);
  expect(writes[1]?.signal).toBe(retry.signal);
  expect((writes[1]?.headers as Record<string, string>)['Idempotency-Key']).toBe((writes[0]?.headers as Record<string, string>)['Idempotency-Key']);
});
it('does not replay a scope-bound mutation cancelled during recent authentication', async () => {
  let finish!: () => void;
  let started!: () => void;
  const waiting = new Promise<void>(resolve => { started = resolve; });
  const unregister = client.registerReauthentication(() => { started(); return new Promise<void>(resolve => { finish = resolve; }); });
  const fetch = vi.fn((path: string) => Promise.resolve(new Response(JSON.stringify(path.endsWith('/csrf')
    ? { csrfToken: 'csrf' } : { code: 'AUTH_REAUTHENTICATION_REQUIRED', message: 'Authenticate again' }),
  { status: path.endsWith('/csrf') ? 200 : 401, headers: { 'content-type': 'application/json' } })));
  vi.stubGlobal('fetch', fetch);
  try {
    const controller = new AbortController();
    const pending = client.createAdminMutation()('/api/v1/admin/users/user', 'PATCH', { email: 'one@example.test' }, controller.signal);
    const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    await waiting; controller.abort(); finish(); await rejected;
    expect(fetch).toHaveBeenCalledTimes(2);
  } finally { unregister(); }
});
it('protects management writes and reuses only the same failed payload key', async () => {
  expect(client).toHaveProperty('createAdminMutation');
  const requests: RequestInit[] = [];
  let fail = true;
  vi.stubGlobal('fetch', vi.fn().mockImplementation((path: string, init: RequestInit) => {
    if (path.endsWith('/csrf')) return Promise.resolve(new Response(JSON.stringify({ csrfToken: 'csrf' }), { headers: { 'content-type': 'application/json' } }));
    requests.push(init);
    return Promise.resolve(new Response(JSON.stringify(fail ? { code: 'FORBIDDEN', message: 'raw secret' } : {}), { status: fail ? 403 : 200, headers: { 'content-type': 'application/json' } }));
  }));
  const mutation = client.createAdminMutation();
  await expect(mutation('/api/v1/admin/users/user', 'PATCH', { email: 'one@example.test' })).rejects.toThrow();
  await expect(mutation('/api/v1/admin/users/user', 'PATCH', { email: 'one@example.test' })).rejects.toThrow();
  await expect(mutation('/api/v1/admin/users/user', 'PATCH', { email: 'two@example.test' })).rejects.toThrow();
  fail = false;
  await mutation('/api/v1/admin/users/user', 'PATCH', { email: 'two@example.test' });
  await mutation('/api/v1/admin/users/user', 'PATCH', { email: 'two@example.test' });
  const headers = requests.map((entry) => entry.headers as Record<string, string>);
  expect(headers.every((entry) => entry['x-csrf-token'] === 'csrf')).toBe(true);
  expect(headers[0]['Idempotency-Key']).toBe(headers[1]['Idempotency-Key']);
  expect(headers[1]['Idempotency-Key']).not.toBe(headers[2]['Idempotency-Key']);
  expect(headers[2]['Idempotency-Key']).toBe(headers[3]['Idempotency-Key']);
  expect(headers[3]['Idempotency-Key']).not.toBe(headers[4]['Idempotency-Key']);
});
