import { expect, it, afterEach, vi } from 'vitest';
import { apiRequest, registerReauthentication } from '../../api/client';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
let unregister: (() => void) | undefined;
afterEach(() => { unregister?.(); unregister = undefined; vi.unstubAllGlobals(); });

it('does not replay a consumed factor for callers that opt out of automatic replay', async () => {
  let recent = false;
  const fetcher = vi.fn(async () => recent ? json({ saved: true }) : json({ code: 'AUTH_REAUTHENTICATION_REQUIRED' }, 403));
  vi.stubGlobal('fetch', fetcher);
  unregister = registerReauthentication(async () => { recent = true; });
  await expect(apiRequest('/api/v1/test/guarded', { method: 'POST', body: JSON.stringify({ code: 'used-factor' }) }, { replayAfterReauthentication: false })).rejects.toMatchObject({ code: 'CLIENT_REAUTHENTICATION_COMPLETED' });
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it('retains automatic replay and refreshed CSRF for callers without the opt-out', async () => {
  let recent = false;
  const fetcher = vi.fn(async (path: string) => path.endsWith('/csrf') ? json({ csrfToken: 'new-csrf' }) : recent ? json({ saved: true }) : json({ code: 'AUTH_REAUTHENTICATION_REQUIRED' }, 403));
  vi.stubGlobal('fetch', fetcher);
  unregister = registerReauthentication(async () => { recent = true; });
  await expect(apiRequest('/api/v1/test/guarded', { method: 'POST', headers: { 'x-csrf-token': 'old-csrf', 'Idempotency-Key': 'stable-key' }, body: JSON.stringify({ name: 'test' }) })).resolves.toEqual({ saved: true });
  expect(fetcher).toHaveBeenCalledTimes(3);
  expect(fetcher).toHaveBeenLastCalledWith('/api/v1/test/guarded', expect.objectContaining({ headers: expect.objectContaining({ 'x-csrf-token': 'new-csrf', 'Idempotency-Key': 'stable-key' }), body: JSON.stringify({ name: 'test' }) }));
});
