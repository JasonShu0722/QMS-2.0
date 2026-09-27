import { webcrypto } from 'node:crypto';
import { afterEach, expect, it, vi } from 'vitest';
import { createUploadAttempt, retryScanAttachment } from './attachments';

const resource = { resourceType: 'test-evidence', resourceId: 'resource-id' };
const fileRecord = { id: 'file-id', version: 1, status: 'QUARANTINED', scanStatus: 'WAITING_UPLOAD', ...resource };
const reservation = { file: fileRecord, uploadUrl: 'https://objects.example.test/object?signed=secret', headers: { 'content-type': 'text/plain', 'if-none-match': '*' }, urlExpiresAt: '2026-09-20T12:00:00Z' };
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
function sample() {
  const file = new File(['clean sample'], 'sample.txt', { type: 'text/plain' });
  Object.defineProperty(file, 'arrayBuffer', { value: async () => new TextEncoder().encode('clean sample').buffer });
  return file;
}
afterEach(() => vi.unstubAllGlobals());

it('hashes the actual selected bytes, uploads without cookies, and completes while still quarantined', async () => {
  vi.stubGlobal('crypto', webcrypto);
  const fetchMock = vi.fn(async (path: string, init?: RequestInit) => {
    if (path.endsWith('/csrf')) return json({ csrfToken: 'csrf' });
    if (path.endsWith('/uploads')) return json(reservation, 201);
    if (path.startsWith('https:')) return new Response(null, { status: 200 });
    return json({ ...fileRecord, version: 2, scanStatus: 'PENDING' }, 202);
  });
  vi.stubGlobal('fetch', fetchMock);
  const selected = sample(); const observe = vi.fn();
  const result = await createUploadAttempt(resource, selected).run(observe);
  expect(result.status).toBe('QUARANTINED');
  expect(result.scanStatus).toBe('PENDING');
  const initialized = fetchMock.mock.calls.find(([path]) => path.endsWith('/uploads'));
  expect(JSON.parse(initialized![1]!.body as string)).toMatchObject({ ...resource, originalName: 'sample.txt', sizeBytes: selected.size, sha256: expect.stringMatching(/^[a-f0-9]{64}$/) });
  expect(fetchMock.mock.calls.find(([path]) => path.startsWith('https:'))?.[1]).toMatchObject({ method: 'PUT', credentials: 'omit', referrerPolicy: 'no-referrer', body: selected, headers: reservation.headers });
  expect(observe).toHaveBeenCalledTimes(2);
});

it('retries an ambiguous completion using the same version and key without uploading again', async () => {
  vi.stubGlobal('crypto', webcrypto);
  let completions = 0;
  const fetchMock = vi.fn(async (path: string, init?: RequestInit) => {
    if (path.endsWith('/csrf')) return json({ csrfToken: 'csrf' });
    if (path.endsWith('/uploads')) return json(reservation, 201);
    if (path.startsWith('https:')) return new Response(null, { status: 200 });
    if (++completions === 1) throw new Error('Response lost');
    return json({ ...fileRecord, version: 2, scanStatus: 'PENDING' }, 202);
  });
  vi.stubGlobal('fetch', fetchMock);
  const attempt = createUploadAttempt(resource, sample());
  await expect(attempt.run()).rejects.toThrow('Response lost');
  await attempt.run();
  expect(fetchMock.mock.calls.filter(([path]) => path.endsWith('/uploads'))).toHaveLength(1);
  expect(fetchMock.mock.calls.filter(([path]) => path.startsWith('https:'))).toHaveLength(1);
  const writes = fetchMock.mock.calls.filter(([path]) => path.endsWith('/complete'));
  expect(writes[0]![1]).toEqual(writes[1]![1]);
  expect(JSON.parse(writes[0]![1]!.body as string)).toEqual({ expectedVersion: 1 });
});

it('refreshes an expired upload signature with the same reservation and lets completion verify a prior PUT', async () => {
  vi.stubGlobal('crypto', webcrypto);
  let uploads = 0;
  const fetchMock = vi.fn(async (path: string, init?: RequestInit) => {
    if (path.endsWith('/csrf')) return json({ csrfToken: 'csrf' });
    if (path.endsWith('/uploads')) return json(reservation, 201);
    if (path.startsWith('https:')) return new Response(null, { status: ++uploads === 1 ? 403 : 412 });
    return json({ ...fileRecord, version: 2, scanStatus: 'PENDING' }, 202);
  });
  vi.stubGlobal('fetch', fetchMock);
  const attempt = createUploadAttempt(resource, sample());
  await expect(attempt.run()).rejects.toThrow('FILE_UPLOAD_FAILED');
  await attempt.run();
  const reservations = fetchMock.mock.calls.filter(([path]) => path.endsWith('/uploads'));
  expect(reservations[0]![1]).toEqual(reservations[1]![1]);
  expect(fetchMock.mock.calls.filter(([path]) => path.endsWith('/complete'))).toHaveLength(1);
});

it('rejects non-HTTP upload URLs before sending file bytes', async () => {
  vi.stubGlobal('crypto', webcrypto);
  const fetchMock = vi.fn(async (path: string) => path.endsWith('/csrf') ? json({ csrfToken: 'csrf' }) : json({ ...reservation, uploadUrl: 'javascript:alert(1)' }, 201));
  vi.stubGlobal('fetch', fetchMock);
  await expect(createUploadAttempt(resource, sample()).run()).rejects.toThrow('FILE_URL_INVALID');
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

it('retries a terminal scan failure with the current version and idempotency key', async () => {
  vi.stubGlobal('crypto', { ...webcrypto, randomUUID: () => 'retry-key' });
  const fetchMock = vi.fn(async (path: string, init?: RequestInit) => {
    if (path.endsWith('/csrf')) return json({ csrfToken: 'csrf' });
    return json({ ...fileRecord, version: 1, scanStatus: 'PENDING' }, 202);
  });
  vi.stubGlobal('fetch', fetchMock);
  await expect(retryScanAttachment({ ...fileRecord, scanStatus: 'ERROR' } as never)).resolves.toMatchObject({ scanStatus: 'PENDING' });
  const retry = fetchMock.mock.calls.find(([path]) => path.endsWith('/retry-scan'))!;
  expect(retry[1]).toMatchObject({ method: 'POST', headers: { 'x-csrf-token': 'csrf', 'Idempotency-Key': 'retry-key' } });
  expect(JSON.parse(retry[1]!.body as string)).toEqual({ expectedVersion: 1 });
});
