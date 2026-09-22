import { afterEach, expect, it, vi } from 'vitest';
import { createSupplierMutation } from './supplierQuality';

afterEach(() => vi.unstubAllGlobals());

it('reuses an idempotency key after a lost response and rotates it after success', async () => {
  const keys: string[] = [];
  let attempts = 0;
  vi.stubGlobal('fetch', vi.fn(async (path: string, init: RequestInit) => {
    if (path.endsWith('/csrf')) return new Response(JSON.stringify({ csrfToken: 'test-csrf' }), { headers: { 'content-type': 'application/json' } });
    expect(new Headers(init.headers).get('x-csrf-token')).toBe('test-csrf');
    keys.push(new Headers(init.headers).get('Idempotency-Key')!);
    if (++attempts === 1) throw new TypeError('lost response');
    return new Response('{}', { headers: { 'content-type': 'application/json' } });
  }));
  const mutate = createSupplierMutation();
  const body = { expectedVersion: 1, content: { rootCause: '包装破损' } };
  await expect(mutate('/api/v1/supplier-portal/problems/test/response-draft', 'PUT', body)).rejects.toThrow('lost response');
  await mutate('/api/v1/supplier-portal/problems/test/response-draft', 'PUT', body);
  await mutate('/api/v1/supplier-portal/problems/test/response-draft', 'PUT', { ...body, expectedVersion: 2 });
  expect(keys[0]).toBe(keys[1]);
  expect(keys[2]).not.toBe(keys[1]);
});

it('starts a different request key when a failed draft is edited', async () => {
  const keys: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (path: string, init: RequestInit) => {
    if (path.endsWith('/csrf')) return new Response(JSON.stringify({ csrfToken: 'test-csrf' }), { headers: { 'content-type': 'application/json' } });
    keys.push(new Headers(init.headers).get('Idempotency-Key')!);
    throw new TypeError('lost response');
  }));
  const mutate = createSupplierMutation();
  for (const rootCause of ['初步原因', '更正原因']) {
    await expect(mutate('/api/v1/supplier-portal/problems/test/response-draft', 'PUT', { expectedVersion: 1, content: { rootCause } })).rejects.toThrow();
  }
  expect(keys[0]).not.toBe(keys[1]);
});
