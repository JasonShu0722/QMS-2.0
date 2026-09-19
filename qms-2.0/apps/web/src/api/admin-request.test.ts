import { afterEach, expect, it, vi } from 'vitest';
import * as client from './client';

afterEach(() => vi.unstubAllGlobals());
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
