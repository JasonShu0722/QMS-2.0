import { act, renderHook } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { ApiError, apiRequest, csrfToken, getSession } from '../../api/client';
import { useWorkTabsStore } from '../../work-tabs/workTabsStore';
import { useCustomerLedgerWrite } from './customer-ledger-write';

vi.mock('../../api/client', async () => ({ ...(await vi.importActual<typeof import('../../api/client')>('../../api/client')), apiRequest: vi.fn(), csrfToken: vi.fn(), getSession: vi.fn() }));
const session = { accountType: 'INTERNAL' as const, organizationId: 'org', userId: 'user', landingPath: '/app/workbench' as const };
beforeEach(() => {
  useWorkTabsStore.getState().bindSession('INTERNAL:org:user');
  vi.mocked(getSession).mockReset().mockResolvedValue(session);
  vi.mocked(csrfToken).mockReset().mockResolvedValue('csrf');
  vi.mocked(apiRequest).mockReset().mockResolvedValue({ id: 'saved' });
});

it('freezes private unknown attempts and replays the exact key/body/path after later explicit nonterminal failures', async () => {
  const { result } = renderHook(() => useCustomerLedgerWrite(vi.fn()));
  vi.mocked(apiRequest).mockRejectedValueOnce(new TypeError('lost'));
  await act(async () => { await expect(result.current.write('/ledger', { fields: { customerName: '原文' } }, 'POST')).rejects.toThrow(); });
  expect(result.current.uncertain).toBe(true);
  vi.mocked(csrfToken).mockRejectedValueOnce(new ApiError({ code: 'RATE_LIMITED', message: '' }, 429));
  await act(async () => { await expect(result.current.write('/other', { fields: {} }, 'PUT')).rejects.toThrow(); });
  expect(result.current.uncertain).toBe(true);
  await act(async () => { await result.current.write('/other', { fields: {} }, 'PUT'); });
  expect(vi.mocked(apiRequest).mock.calls[1]).toEqual(vi.mocked(apiRequest).mock.calls[0]);
  expect(result.current.uncertain).toBe(false);
  expect(vi.mocked(apiRequest).mock.calls[0]?.[2]).toEqual({ replayAfterReauthentication: false });
});
it.each([401, 403, 409])('handles terminal %s without leaking a frozen attempt', async status => {
  const denied = vi.fn();
  const { result } = renderHook(() => useCustomerLedgerWrite(denied));
  vi.mocked(apiRequest).mockRejectedValueOnce(new ApiError({ code: 'CONCURRENCY_CONFLICT', message: '' }, status));
  await act(async () => { await expect(result.current.write('/ledger', { fields: {} }, 'POST')).rejects.toThrow(); });
  expect(denied).toHaveBeenCalledTimes(status === 409 ? 0 : 1);
  expect(result.current.uncertain).toBe(false);
});
it('checks identity and live scope after delayed CSRF before dispatching', async () => {
  let resolve!: (token: string) => void;
  vi.mocked(csrfToken).mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  const denied = vi.fn();
  const { result } = renderHook(() => useCustomerLedgerWrite(denied));
  let attempt!: Promise<unknown>;
  await act(async () => { attempt = result.current.write('/ledger', { fields: {} }, 'POST').catch(error => error); });
  useWorkTabsStore.getState().bindSession('INTERNAL:org:other');
  await act(async () => { resolve('late'); await attempt; });
  expect(apiRequest).not.toHaveBeenCalled();
  expect(denied).toHaveBeenCalledTimes(1);
});
it('aborts a late CSRF on unmount and rejects synchronous double submission', async () => {
  let resolve!: (token: string) => void;
  vi.mocked(csrfToken).mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  const { result, unmount } = renderHook(() => useCustomerLedgerWrite(vi.fn()));
  let attempt!: Promise<unknown>;
  await act(async () => {
    attempt = result.current.write('/ledger', { fields: {} }, 'POST').catch(error => error);
    await expect(result.current.write('/ledger', { fields: {} }, 'POST')).rejects.toThrow();
  });
  unmount();
  await act(async () => { resolve('late'); await attempt; });
  expect(apiRequest).not.toHaveBeenCalled();
});

it('checks a live attachment predicate after delayed CSRF without dispatch or an uncertain write', async () => {
  let resolve!: (token: string) => void;
  let pending = false;
  vi.mocked(csrfToken).mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  const { result } = renderHook(() => useCustomerLedgerWrite(vi.fn()));
  let attempt!: Promise<unknown>;
  await act(async () => { attempt = result.current.write('/ledger/close', { expectedVersion: 1, note: '实际结论' }, 'POST', () => !pending).catch(error => error); });
  pending = true;
  await act(async () => { resolve('late'); await attempt; });
  expect(apiRequest).not.toHaveBeenCalled();
  expect(result.current.busy).toBe(false);
  expect(result.current.uncertain).toBe(false);
  pending = false;
  await act(async () => { await result.current.write('/ledger/close', { expectedVersion: 1, note: '实际结论' }, 'POST', () => !pending); });
  expect(apiRequest).toHaveBeenCalledTimes(1);
});

it('does not even prepare CSRF while source uploads are already pending', async () => {
  const { result } = renderHook(() => useCustomerLedgerWrite(vi.fn()));
  await act(async () => { await expect(result.current.write('/ledger', { fields: {} }, 'PUT', () => false)).rejects.toThrow(/附件/); });
  expect(csrfToken).not.toHaveBeenCalled();
  expect(apiRequest).not.toHaveBeenCalled();
});
