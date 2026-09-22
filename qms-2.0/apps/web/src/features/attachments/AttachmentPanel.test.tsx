import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { LanguageProvider } from '../../i18n/Language';
import { AttachmentPanel } from './AttachmentPanel';

const resource = { resourceType: 'test-evidence', resourceId: 'resource-id' };
const file = { ...resource, id: 'file-id', originalName: 'evidence.txt', contentType: 'text/plain', sizeBytes: 12, sha256: 'a'.repeat(64), version: 2, status: 'QUARANTINED', scanStatus: 'PENDING', scanReason: null, uploadExpiresAt: '2026-09-20T12:00:00Z', scannedAt: null, deletedAt: null, retainUntil: '2026-09-27T12:00:00Z' };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
afterEach(() => vi.unstubAllGlobals());

it('shows quarantine status and never offers download before the scan succeeds', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => json(file)));
  render(<LanguageProvider><AttachmentPanel resource={resource} fileIds={[file.id]} /></LanguageProvider>);
  expect(await screen.findByText('evidence.txt')).toBeInTheDocument();
  expect(screen.getByText('等待安全扫描')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '下载附件' })).not.toBeInTheDocument();
});

it('requires both availability and a clean scan for download, and respects read-only mode', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => json({ ...file, status: 'AVAILABLE', scanStatus: 'CLEAN', scannedAt: '2026-09-20T12:00:00Z' })));
  render(<LanguageProvider><AttachmentPanel resource={resource} fileIds={[file.id]} readOnly /></LanguageProvider>);
  expect(await screen.findByRole('button', { name: '下载附件' })).toBeInTheDocument();
  expect(screen.queryByLabelText('选择附件')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '删除附件' })).not.toBeInTheDocument();
});

it('refreshes after a delete version conflict and displays only a controlled error and trace', async () => {
  let deleted = false;
  const fetchMock = vi.fn(async (path: string, init?: RequestInit) => {
    if (path.endsWith('/csrf')) return json({ csrfToken: 'csrf' });
    if (path.endsWith('/delete')) { deleted = true; return json({ code: 'CONCURRENCY_CONFLICT', message: 'private object credentials', traceId: 'file-trace' }, 409); }
    return json({ ...file, status: deleted ? 'DELETED' : 'AVAILABLE', scanStatus: 'CLEAN', version: deleted ? 4 : 3 });
  });
  vi.stubGlobal('fetch', fetchMock);
  render(<LanguageProvider><AttachmentPanel resource={resource} fileIds={[file.id]} /></LanguageProvider>);
  await userEvent.click(await screen.findByRole('button', { name: '删除附件' }));
  await userEvent.click(screen.getByRole('button', { name: '确认删除附件' }));
  expect(await screen.findByText('file-trace')).toBeInTheDocument();
  expect(await screen.findByText('已删除，保留历史记录')).toBeInTheDocument();
  expect(screen.queryByText(/private object/)).not.toBeInTheDocument();
  expect(fetchMock.mock.calls.filter(([path]) => path.endsWith('/delete'))).toHaveLength(1);
  expect(JSON.parse(fetchMock.mock.calls.find(([path]) => path.endsWith('/delete'))![1]!.body as string)).toEqual({ expectedVersion: 3 });
});

it('does not show a permission error as an empty attachment list', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => json({ code: 'FILE_RESOURCE_DENIED', traceId: 'resource-trace' }, 403)));
  render(<LanguageProvider><AttachmentPanel resource={resource} fileIds={[file.id]} /></LanguageProvider>);
  expect(await screen.findByText('resource-trace')).toBeInTheDocument();
  await waitFor(() => expect(screen.queryByText('暂无附件')).not.toBeInTheDocument());
});
