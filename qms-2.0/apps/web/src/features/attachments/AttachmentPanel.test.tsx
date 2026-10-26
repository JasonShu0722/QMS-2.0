import { webcrypto } from 'node:crypto';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { LanguageProvider } from '../../i18n/Language';
import { AttachmentPanel } from './AttachmentPanel';
import { CustomerComplaintEightDPanel } from '../customer-quality/CustomerComplaintEightDPanel';

const resource = { resourceType: 'test-evidence', resourceId: 'resource-id' };
const file = { ...resource, id: 'file-id', originalName: 'evidence.txt', contentType: 'text/plain', sizeBytes: 12, sha256: 'a'.repeat(64), version: 2, status: 'QUARANTINED', scanStatus: 'PENDING', scanReason: null, uploadExpiresAt: '2026-09-20T12:00:00Z', scannedAt: null, deletedAt: null, retainUntil: '2026-09-27T12:00:00Z' };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

function sample() {
  const selected = new File(['sample'], 'sample.txt', { type: 'text/plain' });
  Object.defineProperty(selected, 'arrayBuffer', { value: async () => new TextEncoder().encode('sample').buffer });
  return selected;
}

it('distinguishes historical quarantine from pending work started in the current panel', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => json(file)));
  const allPending = vi.fn(), localPending = vi.fn();
  const props = { resource, fileIds: [file.id], onPendingChange: allPending, onLocalPendingChange: localPending };
  render(<LanguageProvider><AttachmentPanel {...props} /></LanguageProvider>);
  await screen.findByText(file.originalName);
  await waitFor(() => expect(allPending).toHaveBeenLastCalledWith(true));
  expect(localPending).toHaveBeenLastCalledWith(false);
});

it('keeps an unknown local upload pending until its private retry is explicitly abandoned', async () => {
  vi.stubGlobal('crypto', webcrypto);
  vi.stubGlobal('fetch', vi.fn(async (path: string) => {
    if (path.endsWith('/csrf')) return json({ csrfToken: 'csrf' });
    if (path.endsWith('/uploads')) throw new TypeError('lost upload initialization response');
    return json(file);
  }));
  const localPending = vi.fn();
  const props = { resource, fileIds: [], onLocalPendingChange: localPending };
  render(<LanguageProvider><AttachmentPanel {...props} /></LanguageProvider>);
  fireEvent.change(screen.getByLabelText('选择附件'), { target: { files: [sample()] } });
  await screen.findByRole('button', { name: '重试上传' });
  expect(localPending).toHaveBeenLastCalledWith(true);
  fireEvent.click(screen.getByRole('button', { name: '放弃重试' }));
  await waitFor(() => expect(localPending).toHaveBeenLastCalledWith(false));
});

it('keeps a rejected CLEAN receipt pending and retries it after a temporary read-only render', async () => {
  vi.stubGlobal('crypto', webcrypto);
  let complete!: (response: Response) => void;
  const clean = { ...file, version: 3, status: 'AVAILABLE', scanStatus: 'CLEAN' };
  vi.stubGlobal('fetch', vi.fn(async (path: string) => {
    if (path.endsWith('/csrf')) return json({ csrfToken: 'csrf' });
    if (path.endsWith('/uploads')) return json({ file, uploadUrl: 'https://objects.example.test/upload', headers: {} });
    if (path.startsWith('https:')) return new Response(null);
    if (path.endsWith('/complete')) return new Promise<Response>(resolve => { complete = resolve; });
    return json(clean);
  }));
  const pending = vi.fn();
  const ready = vi.fn((): boolean => false);
  const panel = (readOnly: boolean) => <LanguageProvider><AttachmentPanel resource={resource} fileIds={[]} readOnly={readOnly} onReady={ready} onPendingChange={pending} /></LanguageProvider>;
  const view = render(panel(false));
  fireEvent.change(screen.getByLabelText('选择附件'), { target: { files: [sample()] } });
  await waitFor(() => expect(complete).toBeTypeOf('function'));
  expect(pending).toHaveBeenLastCalledWith(true);
  view.rerender(panel(true));
  await act(async () => complete(json(clean)));
  await waitFor(() => expect(ready).toHaveBeenCalled());
  expect(pending).toHaveBeenLastCalledWith(true);
  ready.mockReturnValue(true);
  view.rerender(panel(false));
  await waitFor(() => expect(pending).toHaveBeenLastCalledWith(false));
  expect(ready.mock.calls.length).toBeGreaterThan(1);
});

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

it('forwards a real metadata denial to the owning scope without a compensating read', async () => {
  const denied = vi.fn();
  const fetchMock = vi.fn(async () => json({ code: 'FILE_RESOURCE_DENIED', traceId: 'scope-trace' }, 403));
  vi.stubGlobal('fetch', fetchMock);
  render(<LanguageProvider><AttachmentPanel resource={resource} fileIds={[file.id]} onAccessDenied={denied} /></LanguageProvider>);
  await screen.findByText('scope-trace');
  expect(denied).toHaveBeenCalledWith(expect.objectContaining({ status: 403, code: 'FILE_RESOURCE_DENIED' }));
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it('notifies the parent when a restored pending file finishes scanning', async () => {
  let reads = 0;
  vi.stubGlobal('fetch', vi.fn(async () => json(++reads === 1 ? file : { ...file, version: 3, status: 'AVAILABLE', scanStatus: 'CLEAN' })));
  const changed = vi.fn();
  const ready = vi.fn();
  render(<LanguageProvider><AttachmentPanel resource={resource} fileIds={[file.id]} onFilesChanged={changed} onReady={ready} /></LanguageProvider>);
  expect(await screen.findByText('等待安全扫描')).toBeInTheDocument();
  await waitFor(() => expect(changed).toHaveBeenCalledWith([expect.objectContaining({ id: file.id, status: 'AVAILABLE', scanStatus: 'CLEAN' })]), { timeout: 4000 });
  expect(ready).not.toHaveBeenCalled();
});

it('offers scan recovery for an unavailable scanner while keeping the file quarantined', async () => {
  let retried = false;
  const fetchMock = vi.fn(async (path: string, init?: RequestInit) => {
    if (path.endsWith('/csrf')) return json({ csrfToken: 'csrf' });
    if (path.endsWith('/retry-scan')) { retried = true; return json({ ...file, version: 2, scanStatus: 'PENDING' }, 202); }
    return json({ ...file, scanStatus: retried ? 'PENDING' : 'ERROR' });
  });
  vi.stubGlobal('fetch', fetchMock);
  render(<LanguageProvider><AttachmentPanel resource={resource} fileIds={[file.id]} /></LanguageProvider>);
  expect(await screen.findByText('扫描暂不可用，附件仍隔离')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: '重试安全扫描' }));
  expect(await screen.findByText('等待安全扫描')).toBeInTheDocument();
  expect(fetchMock.mock.calls.some(([path]) => path.endsWith('/retry-scan'))).toBe(true);
});

it.each(['uploads', 'complete', 'download', 'delete', 'retry-scan'].flatMap(stage => [401, 403].map(status => ({ stage, status }))))('forwards $stage $status from the real API call', async ({ stage, status }) => {
  vi.stubGlobal('crypto', webcrypto);
  const denied = vi.fn();
  const current = { ...file, status: stage === 'retry-scan' ? 'QUARANTINED' : 'AVAILABLE', scanStatus: stage === 'retry-scan' ? 'ERROR' : 'CLEAN' };
  vi.stubGlobal('fetch', vi.fn(async (path: string) => {
    if (path.endsWith('/csrf')) return json({ csrfToken: 'csrf' });
    if (path.endsWith(`/${stage}`)) return json({ code: 'FILE_RESOURCE_DENIED', traceId: `${stage}-${status}` }, status);
    if (path.endsWith('/uploads')) return json({ file, uploadUrl: 'https://objects.example.test/upload', headers: {} });
    if (path.startsWith('https:')) return new Response(null);
    return json(current);
  }));
  render(<LanguageProvider><AttachmentPanel resource={resource} fileIds={['uploads', 'complete'].includes(stage) ? [] : [file.id]} onAccessDenied={denied} /></LanguageProvider>);
  if (stage === 'uploads' || stage === 'complete') fireEvent.change(screen.getByLabelText('选择附件'), { target: { files: [sample()] } });
  else {
    await userEvent.click(await screen.findByRole('button', { name: { download: '下载附件', delete: '删除附件', 'retry-scan': '重试安全扫描' }[stage] }));
    if (stage === 'delete') await userEvent.click(await screen.findByRole('button', { name: '确认删除附件' }));
  }
  await screen.findByText(`${stage}-${status}`);
  expect(denied).toHaveBeenCalledWith(expect.objectContaining({ status }));
});

it('preserves the real legacy customer consumer void onReady callback and saved evidence', async () => {
  vi.stubGlobal('crypto', webcrypto);
  const draft = { complaintId: 'complaint-1', version: 1, status: 'DRAFT', archiveChecklist: [], verificationEvidenceFileIds: [] };
  const clean = { ...file, status: 'AVAILABLE', scanStatus: 'CLEAN', version: 3 };
  const fetchMock = vi.fn(async (path: string, init?: RequestInit) => {
    if (path.endsWith('/csrf')) return json({ csrfToken: 'csrf' });
    if (path.endsWith('/8d/draft')) return json({ ...draft, ...JSON.parse(init!.body as string).content, version: 2 });
    if (path.endsWith('/8d')) return json(draft);
    if (path.endsWith('/uploads')) return json({ file, uploadUrl: 'https://objects.example.test/upload', headers: {} });
    if (path.startsWith('https:')) return new Response(null);
    return json(clean);
  });
  vi.stubGlobal('fetch', fetchMock);
  render(<LanguageProvider><CustomerComplaintEightDPanel complaintId="complaint-1" canWrite /></LanguageProvider>);
  fireEvent.change(await screen.findByLabelText('选择附件'), { target: { files: [sample()] } });
  await screen.findByText('扫描通过，可作为证据');
  await waitFor(() => expect(screen.getByRole('button', { name: '保存 8D 草稿' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: '保存 8D 草稿' }));
  await waitFor(() => expect(fetchMock.mock.calls.find(([path]) => path.endsWith('/8d/draft'))?.[1]?.body).toContain(`"verificationEvidenceFileIds":["${file.id}"]`));
  expect(fetchMock.mock.calls.filter(([path]) => path.endsWith('/complete'))).toHaveLength(1);
});
