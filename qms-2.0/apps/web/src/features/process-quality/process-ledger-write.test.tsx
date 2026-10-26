import { act, renderHook } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { ApiError, apiRequest, csrfToken, getSession } from '../../api/client';
import { useWorkTabsStore } from '../../work-tabs/workTabsStore';
import { useProcessWrite } from './process-ledger';

vi.mock('../../api/client', async () => ({ ...(await vi.importActual<typeof import('../../api/client')>('../../api/client')), apiRequest: vi.fn(), csrfToken: vi.fn(), getSession: vi.fn() }));
const session = { userId: 'user', organizationId: 'org', accountType: 'INTERNAL' as const, landingPath: '/app/workbench' as const };
beforeEach(() => {
  useWorkTabsStore.getState().reset();
  useWorkTabsStore.getState().bindSession('INTERNAL:org:user');
  vi.mocked(getSession).mockReset().mockResolvedValue(session);
  vi.mocked(csrfToken).mockReset().mockResolvedValue('csrf');
  vi.mocked(apiRequest).mockReset().mockResolvedValue({ version: 2 });
});
it('retries unknown outcomes with exactly the same key, payload, method and endpoint', async () => {
  vi.mocked(apiRequest).mockRejectedValueOnce(new TypeError('network'));
  const { result } = renderHook(() => useProcessWrite(vi.fn()));
  await act(async () => { await expect(result.current.write('/save', { expectedVersion: 1, description: '原稿' }, 'POST')).rejects.toThrow(); });
  expect(result.current.uncertain).toBe(true);
  await act(async () => { await result.current.write('/different', { description: '不能误改原稿' }); });
  const calls = vi.mocked(apiRequest).mock.calls;
  expect(calls[0][0]).toBe(calls[1][0]);
  expect(calls[0][1]).toEqual(calls[1][1]);
});
it('keeps a known conflict recoverable and does not mark it as an unknown write', async () => {
  vi.mocked(apiRequest).mockRejectedValueOnce(new ApiError({ code: 'CONCURRENCY_CONFLICT', message: '' }, 409));
  const { result } = renderHook(() => useProcessWrite(vi.fn()));
  await act(async () => { await expect(result.current.write('/save', { expectedVersion: 1 })).rejects.toThrow(); });
  expect(result.current.uncertain).toBe(false);
  await act(async () => { await result.current.write('/save', { expectedVersion: 2 }); });
  expect(JSON.parse(String(vi.mocked(apiRequest).mock.calls[1][1]?.body))).toEqual({ expectedVersion: 2 });
});
it.each([false, true])('reuses the same request key after 409 (previous unknown: %s)', async previousUnknown => {
  const onDenied = vi.fn();
  const { result } = renderHook(() => useProcessWrite(onDenied));
  if (previousUnknown) {
    vi.mocked(apiRequest).mockRejectedValueOnce(new TypeError('network'));
    await act(async () => { await expect(result.current.write('/save', { expectedVersion: 1 }, 'POST')).rejects.toThrow(); });
    expect(result.current.uncertain).toBe(true);
  }
  vi.mocked(apiRequest).mockRejectedValueOnce(new ApiError({ code: 'CONCURRENCY_CONFLICT', message: '' }, 409));
  await act(async () => { await expect(result.current.write('/save', { expectedVersion: 1 }, 'POST')).rejects.toThrow(); });
  expect(result.current.uncertain).toBe(false);
  expect(onDenied).not.toHaveBeenCalled();
  await act(async () => { await result.current.write('/save', { expectedVersion: 1 }, 'POST'); });
  const calls = vi.mocked(apiRequest).mock.calls;
  for (const call of calls.slice(1)) expect(call).toEqual(calls[0]);
  await act(async () => { await result.current.write('/save', { expectedVersion: 1 }, 'POST'); });
  expect(new Headers(calls.at(-1)?.[1]?.headers).get('Idempotency-Key')).not.toBe(new Headers(calls[0][1]?.headers).get('Idempotency-Key'));
});
it.each([false, true])('creates a new request key for a changed body after 409 (previous unknown: %s)', async previousUnknown => {
  const { result } = renderHook(() => useProcessWrite(vi.fn()));
  if (previousUnknown) {
    vi.mocked(apiRequest).mockRejectedValueOnce(new TypeError('network'));
    await act(async () => { await expect(result.current.write('/save', { expectedVersion: 1 }, 'POST')).rejects.toThrow(); });
    expect(result.current.uncertain).toBe(true);
  }
  vi.mocked(apiRequest).mockRejectedValueOnce(new ApiError({ code: 'CONCURRENCY_CONFLICT', message: '' }, 409));
  await act(async () => { await expect(result.current.write('/save', { expectedVersion: 1 }, 'POST')).rejects.toThrow(); });
  expect(result.current.uncertain).toBe(false);
  await act(async () => { await result.current.write('/save', { expectedVersion: 2 }, 'POST'); });
  const calls = vi.mocked(apiRequest).mock.calls;
  expect(JSON.parse(String(calls.at(-1)?.[1]?.body))).toEqual({ expectedVersion: 2 });
  expect(new Headers(calls.at(-1)?.[1]?.headers).get('Idempotency-Key')).not.toBe(new Headers(calls[0][1]?.headers).get('Idempotency-Key'));
});
it('fails closed before writing when the current auth account no longer matches the scope', async () => {
  vi.mocked(getSession).mockResolvedValue({ ...session, userId: 'another-user' });
  const onDenied = vi.fn();
  const { result } = renderHook(() => useProcessWrite(onDenied));
  await act(async () => { await expect(result.current.write('/save', {})).rejects.toThrow(); });
  expect(onDenied).toHaveBeenCalled();
  expect(apiRequest).not.toHaveBeenCalled();
});
it('does not send a late write when CSRF resolves after the editor unmounts', async () => {
  let resolve!: (value: string) => void;
  vi.mocked(csrfToken).mockImplementation(() => new Promise<string>(done => { resolve = done; }));
  const { result, unmount } = renderHook(() => useProcessWrite(vi.fn()));
  let attempt!: Promise<unknown>;
  await act(async () => { attempt = result.current.write('/save', {}).catch(error => error); });
  unmount();
  await act(async () => { resolve('late-csrf'); await attempt; });
  expect(apiRequest).not.toHaveBeenCalled();
});
it('prevents two synchronous writes while the first session check is pending', async () => {
  let resolve!: (value: typeof session) => void;
  vi.mocked(getSession).mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  const { result } = renderHook(() => useProcessWrite(vi.fn()));
  let attempt!: Promise<unknown>;
  await act(async () => {
    attempt = result.current.write('/save', { version: 1 });
    await expect(result.current.write('/save', { version: 2 })).rejects.toThrow();
  });
  await act(async () => { resolve(session); await attempt; });
  expect(apiRequest).toHaveBeenCalledTimes(1);
});
it('requires explicit replay after reauthentication for every ledger mutation', async () => {
  const { result } = renderHook(() => useProcessWrite(vi.fn()));
  await act(async () => { await result.current.write('/save', { expectedVersion: 1 }); });
  expect(vi.mocked(apiRequest).mock.calls[0][2]).toEqual({ replayAfterReauthentication: false });
});

it.each([{ stage: 'CSRF', status: 429 }, { stage: 'POST', status: 400 }, { stage: 'POST', status: 422 }, { stage: 'POST', status: 429 }])('retains an unknown ledger attempt after retry $stage $status until the original request succeeds', async ({ stage, status }) => {
  vi.mocked(apiRequest).mockRejectedValueOnce(new TypeError('network'));
  const { result } = renderHook(() => useProcessWrite(vi.fn()));
  await act(async () => { await expect(result.current.write('/save', { expectedVersion: 1, description: '原稿' }, 'POST')).rejects.toThrow(); });
  expect(result.current.uncertain).toBe(true);
  const failure = new ApiError({ code: `HTTP_${status}`, message: 'refused' }, status);
  if (stage === 'CSRF') vi.mocked(csrfToken).mockRejectedValueOnce(failure);
  else vi.mocked(apiRequest).mockRejectedValueOnce(failure);
  await act(async () => { await expect(result.current.write('/different', { description: '不得替换' })).rejects.toThrow(); });
  expect(result.current.busy).toBe(false);
  expect(result.current.uncertain).toBe(true);
  expect(apiRequest).toHaveBeenCalledTimes(stage === 'CSRF' ? 1 : 2);
  await act(async () => { await result.current.write('/different-again', { description: '仍不得替换' }); });
  const calls = vi.mocked(apiRequest).mock.calls;
  expect(calls).toHaveLength(stage === 'CSRF' ? 2 : 3);
  for (const call of calls.slice(1)) expect(call).toEqual(calls[0]);
  expect(result.current.uncertain).toBe(false);
});

it.each([
  [408, 'HTTP_408'], [425, 'HTTP_425'],
  [400, 'CLIENT_REAUTHENTICATION_COMPLETED'], [422, 'CLIENT_REAUTHENTICATION_COMPLETED'], [429, 'CLIENT_REAUTHENTICATION_COMPLETED'],
] as const)('freezes the original ledger request after initial %s %s', async (status, code) => {
  vi.mocked(apiRequest).mockRejectedValueOnce(new ApiError({ code, message: 'unconfirmed' }, status));
  const { result } = renderHook(() => useProcessWrite(vi.fn()));
  await act(async () => { await expect(result.current.write('/save', { expectedVersion: 1 }, 'POST')).rejects.toThrow(); });
  expect(result.current.uncertain).toBe(true);
  await act(async () => { await result.current.write('/different', { expectedVersion: 2 }); });
  const calls = vi.mocked(apiRequest).mock.calls;
  expect(calls).toHaveLength(2);
  expect(calls[1]).toEqual(calls[0]);
  expect(result.current.uncertain).toBe(false);
});

it.each([400, 422, 429])('allows ledger edits after an initial explicit %s rejection', async status => {
  vi.mocked(apiRequest).mockRejectedValueOnce(new ApiError({ code: `HTTP_${status}`, message: 'refused' }, status));
  const { result } = renderHook(() => useProcessWrite(vi.fn()));
  await act(async () => { await expect(result.current.write('/save', { description: '原稿' }, 'POST')).rejects.toThrow(); });
  expect(result.current.uncertain).toBe(false);
  await act(async () => { await result.current.write('/save', { description: '修改后' }, 'POST'); });
  const calls = vi.mocked(apiRequest).mock.calls;
  expect(JSON.parse(String(calls[1][1]?.body))).toEqual({ description: '修改后' });
  expect(calls[1][1]?.headers).not.toEqual(calls[0][1]?.headers);
});

it.each([401, 403, 409])('releases an unknown ledger attempt on terminal retry %s', async status => {
  vi.mocked(apiRequest).mockRejectedValueOnce(new TypeError('network'));
  const onDenied = vi.fn();
  const { result } = renderHook(() => useProcessWrite(onDenied));
  await act(async () => { await expect(result.current.write('/save', { expectedVersion: 1 })).rejects.toThrow(); });
  expect(result.current.uncertain).toBe(true);
  vi.mocked(apiRequest).mockRejectedValueOnce(new ApiError({ code: `HTTP_${status}`, message: 'refused' }, status));
  await act(async () => { await expect(result.current.write('/save', { expectedVersion: 1 })).rejects.toThrow(); });
  expect(result.current.uncertain).toBe(false);
  expect(onDenied).toHaveBeenCalledTimes(status === 409 ? 0 : 1);
});
