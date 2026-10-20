import { afterEach, expect, it, vi } from 'vitest';
import { getAccountOverview, getMySignatureSummary, registerMySignature, revokeMySignature, updateAccountProfile } from './client';
const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
afterEach(() => vi.unstubAllGlobals());
it('uses the session-scoped summary endpoints and sends the callers stable profile CAS key with CSRF', async () => {
  const fetcher = vi.fn(async (path: string) => json(path.endsWith('/csrf') ? { csrfToken: 'csrf' } : {}));
  vi.stubGlobal('fetch', fetcher);
  await getAccountOverview(); await getMySignatureSummary();
  const body = { fullName: null, phone: '+1 123', email: null, expectedProfileVersion: 3 };
  await updateAccountProfile(body, 'stable-key'); await updateAccountProfile(body, 'stable-key');
  expect(fetcher.mock.calls[0][0]).toBe('/api/v1/me/overview');
  expect(fetcher.mock.calls[1][0]).toBe('/api/v1/e-signatures/mine/summary');
  const writes = vi.mocked(fetch).mock.calls.filter(([, init]) => init?.method === 'PATCH');
  expect(writes).toHaveLength(2);
  for (const [path, init] of writes) {
    expect(path).toBe('/api/v1/me');
    expect(init?.headers).toMatchObject({ 'x-csrf-token': 'csrf', 'Idempotency-Key': 'stable-key' });
    expect(JSON.parse(String(init?.body))).toEqual(body);
  }
});
it('uses the original signature mutation endpoints with CSRF, caller keys and revoke version', async () => {
  vi.stubGlobal('fetch', vi.fn(async (path: string) => json(path.endsWith('/csrf') ? { csrfToken: 'csrf' } : {})));
  await registerMySignature({ label: 'Approval', signatureData: 'private signature material' }, 'registration-key');
  await revokeMySignature('s1', { expectedVersion: 7 }, 'revocation-key');
  const writes = vi.mocked(fetch).mock.calls.filter(([, init]) => init?.method === 'POST');
  expect(writes.map(([path]) => path)).toEqual(['/api/v1/e-signatures', '/api/v1/e-signatures/s1/revoke']);
  expect(writes.map(([, init]) => JSON.parse(String(init?.body)))).toEqual([{ label: 'Approval', signatureData: 'private signature material' }, { expectedVersion: 7 }]);
  expect(writes[0][1]?.headers).toMatchObject({ 'x-csrf-token': 'csrf', 'Idempotency-Key': 'registration-key' });
  expect(writes[1][1]?.headers).toMatchObject({ 'x-csrf-token': 'csrf', 'Idempotency-Key': 'revocation-key' });
});
