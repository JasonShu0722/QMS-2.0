import { beforeEach, expect, it, vi } from 'vitest';
import { ApiError, apiRequest, csrfToken, getSession } from '../../api/client';
import { createCustomerAnalysisWrite } from './customer-analysis';

vi.mock('../../api/client', async () => ({ ...(await vi.importActual<typeof import('../../api/client')>('../../api/client')), apiRequest: vi.fn(), csrfToken: vi.fn(), getSession: vi.fn() }));
const session = { userId: 'actor', organizationId: 'home', accountType: 'INTERNAL' as const, landingPath: '/app/workbench' as const };
const body = { expectedVersion: 1, text: '原稿', organizationId: 'selected' };
beforeEach(() => { vi.mocked(apiRequest).mockReset().mockResolvedValue({}); vi.mocked(csrfToken).mockReset().mockResolvedValue('csrf'); vi.mocked(getSession).mockReset().mockResolvedValue(session); });

it('freezes private path, body and key on unknown results and explicitly replays only that request', async () => {
  const write = createCustomerAnalysisWrite(session, () => true);
  const signal = new AbortController().signal;
  vi.mocked(apiRequest).mockRejectedValueOnce(new TypeError('network'));
  await expect(write.run('/analysis/a/fae', 'PUT', body, signal)).rejects.toThrow();
  expect(write.uncertain).toBe(true);
  await write.run('/analysis/b/supplier', 'POST', { expectedVersion: 99 }, signal);
  const calls = vi.mocked(apiRequest).mock.calls;
  expect(calls[1]).toEqual(calls[0]);
  expect(calls[0][2]).toEqual({ replayAfterReauthentication: false });
  expect(write.uncertain).toBe(false);
});

it.each([400, 422, 429])('retains an already unknown request after CSRF retry %s', async status => {
  const write = createCustomerAnalysisWrite(session, () => true); const signal = new AbortController().signal;
  vi.mocked(apiRequest).mockRejectedValueOnce(new TypeError('network'));
  await expect(write.run('/a', 'PUT', body, signal)).rejects.toThrow();
  vi.mocked(csrfToken).mockRejectedValueOnce(new ApiError({ code: 'HTTP_ERROR', message: '' }, status));
  await expect(write.run('/b', 'POST', { expectedVersion: 2 }, signal)).rejects.toThrow();
  expect(write.uncertain).toBe(true);
  await write.run('/b', 'POST', { expectedVersion: 2 }, signal);
  expect(vi.mocked(apiRequest).mock.calls[1]).toEqual(vi.mocked(apiRequest).mock.calls[0]);
});

it('preserves an identical key after 409 but changes it for a changed body', async () => {
  const write = createCustomerAnalysisWrite(session, () => true); const signal = new AbortController().signal;
  const conflict = () => new ApiError({ code: 'CONCURRENCY_CONFLICT', message: '' }, 409);
  vi.mocked(apiRequest).mockRejectedValueOnce(conflict()).mockRejectedValueOnce(conflict());
  await expect(write.run('/a', 'PUT', body, signal)).rejects.toThrow();
  expect(write.uncertain).toBe(false);
  await expect(write.run('/a', 'PUT', body, signal)).rejects.toThrow();
  expect(vi.mocked(apiRequest).mock.calls[1]).toEqual(vi.mocked(apiRequest).mock.calls[0]);
  await write.run('/a', 'PUT', { ...body, expectedVersion: 2 }, signal);
  expect(new Headers(vi.mocked(apiRequest).mock.calls[2][1]?.headers).get('Idempotency-Key')).not.toBe(new Headers(vi.mocked(apiRequest).mock.calls[0][1]?.headers).get('Idempotency-Key'));
});

it.each(['abort', 'scope'])('checks current lifetime after CSRF (%s)', async reason => {
  let release!: (value: string) => void; let current = true; const controller = new AbortController();
  vi.mocked(csrfToken).mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  const write = createCustomerAnalysisWrite(session, () => current);
  const result = write.run('/a', 'PUT', body, controller.signal).catch(cause => cause);
  await vi.waitFor(() => expect(csrfToken).toHaveBeenCalled());
  if (reason === 'abort') controller.abort(); else current = false;
  release('late'); await result;
  expect(apiRequest).not.toHaveBeenCalled();
});

it('never substitutes the selected organization for the actual actor home organization', async () => {
  vi.mocked(getSession).mockResolvedValueOnce({ ...session, userId: 'another-actor' });
  const write = createCustomerAnalysisWrite(session, () => true);
  await expect(write.run('/a', 'PUT', body, new AbortController().signal)).rejects.toMatchObject({ status: 401 });
  expect(apiRequest).not.toHaveBeenCalled();
});

it('serializes duplicate clicks before the first session check finishes', async () => {
  let release!: (value: typeof session) => void;
  vi.mocked(getSession).mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  const write = createCustomerAnalysisWrite(session, () => true); const signal = new AbortController().signal;
  const first = write.run('/a', 'PUT', body, signal);
  await expect(write.run('/a', 'PUT', body, signal)).rejects.toThrow();
  release(session); await first;
  expect(apiRequest).toHaveBeenCalledTimes(1);
});
