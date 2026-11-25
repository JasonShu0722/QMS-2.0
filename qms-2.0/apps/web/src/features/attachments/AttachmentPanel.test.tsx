import { webcrypto } from 'node:crypto';
import { deflateRawSync } from 'node:zlib';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { LanguageProvider } from '../../i18n/Language';
import { AttachmentPanel } from './AttachmentPanel';
import { CustomerComplaintEightDPanel } from '../customer-quality/CustomerComplaintEightDPanel';

const resource = { resourceType: 'test-evidence', resourceId: 'resource-id' };
const file = { ...resource, id: 'file-id', originalName: 'evidence.txt', contentType: 'text/plain', sizeBytes: 12, sha256: 'a'.repeat(64), version: 2, status: 'QUARANTINED', scanStatus: 'PENDING', scanReason: null, uploadExpiresAt: '2026-09-20T12:00:00Z', scannedAt: null, deletedAt: null, retainUntil: '2026-09-27T12:00:00Z' };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const BrowserFile = File;
function installReadableFile() {
  vi.stubGlobal('File', class extends BrowserFile {
    arrayBuffer() {
      return new Promise<ArrayBuffer>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as ArrayBuffer);
        reader.onerror = () => reject(reader.error);
        reader.readAsArrayBuffer(this);
      });
    }
  });
}

function sample() {
  const selected = new File(['sample'], 'sample.txt', { type: 'text/plain' });
  Object.defineProperty(selected, 'arrayBuffer', { value: async () => new TextEncoder().encode('sample').buffer });
  return selected;
}

function wordDocument(text: string) {
  const name = Buffer.from('word/document.xml');
  const xml = Buffer.from(`<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`);
  const compressed = deflateRawSync(xml);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50);
  local.writeUInt16LE(8, 8);
  local.writeUInt32LE(compressed.length, 18);
  local.writeUInt32LE(xml.length, 22);
  local.writeUInt16LE(name.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50);
  central.writeUInt16LE(8, 10);
  central.writeUInt32LE(compressed.length, 20);
  central.writeUInt32LE(xml.length, 24);
  central.writeUInt16LE(name.length, 28);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length + name.length, 12);
  end.writeUInt32LE(local.length + name.length + compressed.length, 16);
  return new Uint8Array(Buffer.concat([local, name, compressed, central, name, end]));
}

it.each([
  { variant: 'standard', placement: '.ant-card-extra' },
  { variant: undefined, placement: '.ant-card-body' },
] as const)('refreshes read-only attachments from $placement', async ({ variant, placement }) => {
  const available = { ...file, status: 'AVAILABLE', scanStatus: 'CLEAN' };
  let completeRefresh!: (response: Response) => void;
  const refreshResponse = new Promise<Response>(resolve => { completeRefresh = resolve; });
  const fetchMock = vi.fn<(path: string) => Promise<Response>>()
    .mockResolvedValueOnce(json(available))
    .mockReturnValueOnce(refreshResponse);
  vi.stubGlobal('fetch', fetchMock);

  render(<LanguageProvider><AttachmentPanel resource={resource} fileIds={[file.id]} variant={variant} readOnly /></LanguageProvider>);
  const refresh = screen.getByRole('button', { name: '刷新附件' });
  await screen.findByText(file.originalName);
  expect(refresh.closest(placement)).toBeInTheDocument();
  expect(refresh).toBeEnabled();

  await userEvent.click(refresh);
  expect(refresh).toBeDisabled();
  expect(fetchMock.mock.calls).toEqual([[`/api/v1/files/${file.id}`, expect.any(Object)], [`/api/v1/files/${file.id}`, expect.any(Object)]]);
  completeRefresh(json({ ...available, version: file.version + 1, originalName: 'updated-evidence.txt' }));
  expect(await screen.findByText('updated-evidence.txt')).toBeInTheDocument();
  expect(refresh).toBeEnabled();
});

it('drops attachments into the existing upload lifecycle and reports completion', async () => {
  vi.stubGlobal('crypto', webcrypto);
  const completed = vi.fn();
  const fetchMock = vi.fn(async (path: string) => {
    if (path.endsWith('/csrf')) return json({ csrfToken: 'csrf' });
    if (path.endsWith('/uploads')) return json({ file, uploadUrl: 'https://objects.example.test/upload', headers: {} });
    if (path.startsWith('https:')) return new Response(null);
    return json(file);
  });
  vi.stubGlobal('fetch', fetchMock);
  render(<LanguageProvider><AttachmentPanel resource={resource} fileIds={[]} variant="standard" onUploadCompleted={completed} /></LanguageProvider>);
  fireEvent.drop(screen.getByRole('group', { name: '上传附件' }), { dataTransfer: { files: [sample()] } });
  await waitFor(() => expect(completed).toHaveBeenCalledWith(expect.objectContaining({ id: file.id, scanStatus: 'PENDING' })));
  expect(fetchMock.mock.calls.filter(([path]) => path.endsWith('/complete'))).toHaveLength(1);
});

it('keeps camera capture local until confirmed and releases the stream', async () => {
  vi.stubGlobal('crypto', webcrypto);
  installReadableFile();
  const stop = vi.fn();
  const getUserMedia = vi.fn(async () => ({ getTracks: () => [{ stop }] }));
  vi.stubGlobal('navigator', Object.create(navigator, { mediaDevices: { value: { getUserMedia } } }));
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
  vi.spyOn(HTMLVideoElement.prototype, 'videoWidth', 'get').mockReturnValue(640);
  vi.spyOn(HTMLVideoElement.prototype, 'videoHeight', 'get').mockReturnValue(480);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: vi.fn() } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(callback => callback(new globalThis.Blob(['photo'], { type: 'image/jpeg' })));
  vi.stubGlobal('URL', Object.assign(class extends URL {}, { createObjectURL: vi.fn(() => 'blob:photo'), revokeObjectURL: vi.fn() }));
  const fetchMock = vi.fn(async (path: string) => {
    if (path.endsWith('/csrf')) return json({ csrfToken: 'csrf' });
    if (path.endsWith('/uploads')) return json({ file, uploadUrl: 'https://objects.example.test/upload', headers: {} });
    return path.startsWith('https:') ? new Response(null) : json(file);
  });
  vi.stubGlobal('fetch', fetchMock);
  render(<LanguageProvider><AttachmentPanel resource={resource} fileIds={[]} variant="standard" /></LanguageProvider>);
  fireEvent.click(screen.getByRole('button', { name: '拍照上传' }));
  const camera = within(await screen.findByRole('dialog'));
  const capture = camera.getByRole('button', { name: /^拍\s*照$/ });
  await waitFor(() => expect(capture).toBeEnabled());
  fireEvent.click(capture);
  expect(await camera.findByRole('img', { name: '待上传照片' })).toBeVisible();
  expect(stop).toHaveBeenCalledTimes(1);
  expect(fetchMock.mock.calls.some(([path]) => path.endsWith('/uploads'))).toBe(false);
  fireEvent.click(camera.getByRole('button', { name: '确认上传' }));
  await waitFor(() => expect(fetchMock.mock.calls.some(([path]) => path.endsWith('/complete'))).toBe(true));
});

it.each([
  { name: 'evidence.txt', mime: 'text/plain', bytes: async () => new TextEncoder().encode('<b>现场记录</b>'), visible: '<b>现场记录</b>' },
  { name: 'evidence.docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', bytes: async () => wordDocument('现场记录'), visible: '现场记录' },
  { name: 'evidence.xlsx', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', bytes: async () => {
    const ExcelJS = (await import('exceljs')).default;
    const workbook = new ExcelJS.Workbook();
    workbook.addWorksheet('现场').addRow(['现场记录']);
    return new Uint8Array(await workbook.xlsx.writeBuffer() as ArrayBuffer);
  }, visible: '现场记录' },
])('previews verified $name as plain content in a read-only panel', async ({ name, mime, bytes, visible }) => {
  vi.stubGlobal('crypto', webcrypto);
  installReadableFile();
  const content = await bytes();
  const sha256 = Buffer.from(await webcrypto.subtle.digest('SHA-256', content)).toString('hex');
  const available = { ...file, originalName: name, contentType: mime, sha256, sizeBytes: content.byteLength, status: 'AVAILABLE', scanStatus: 'CLEAN' };
  const url = 'https://objects.example.test/download?token=sample';
  const fetchMock = vi.fn(async (path: string, _init?: RequestInit) => {
    if (path.endsWith('/csrf')) return json({ csrfToken: 'csrf' });
    if (path.endsWith('/download')) return json({ url });
    if (path === url) return new Response(content, { headers: { 'content-type': 'application/octet-stream' } });
    return json(available);
  });
  vi.stubGlobal('fetch', fetchMock);
  render(<LanguageProvider><AttachmentPanel resource={resource} fileIds={[file.id]} variant="standard" readOnly /></LanguageProvider>);
  fireEvent.click(await screen.findByRole('button', { name }));
  const modal = within(await screen.findByRole('dialog'));
  const contentPreview = await modal.findByText(visible);
  await waitFor(() => expect(contentPreview).toBeVisible());
  expect(fetchMock).toHaveBeenCalledWith(url, expect.objectContaining({ credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer' }));
  expect(modal.getByRole('button', { name: '下载附件' })).toBeEnabled();
});

it.each([
  { name: 'evidence.png', mime: 'image/png', content: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), viewer: true },
  { name: 'evidence.pdf', mime: 'application/pdf', content: new TextEncoder().encode('%PDF-1.7'), viewer: true },
  { name: 'external.pdf', mime: 'application/pdf', content: new TextEncoder().encode('%PDF-1.7'), viewer: false },
])('opens $name from verified bytes and releases its object URL on close', async ({ name, mime, content, viewer }) => {
  vi.stubGlobal('crypto', webcrypto);
  vi.stubGlobal('navigator', Object.create(navigator, { pdfViewerEnabled: { value: viewer } }));
  const create = vi.fn(() => 'blob:preview');
  const revoke = vi.fn();
  vi.stubGlobal('URL', Object.assign(class extends URL {}, { createObjectURL: create, revokeObjectURL: revoke }));
  const sha256 = Buffer.from(await webcrypto.subtle.digest('SHA-256', content)).toString('hex');
  const available = { ...file, originalName: name, contentType: mime, sha256, sizeBytes: content.byteLength, status: 'AVAILABLE', scanStatus: 'CLEAN' };
  vi.stubGlobal('fetch', vi.fn(async (path: string) => {
    if (path.endsWith('/csrf')) return json({ csrfToken: 'csrf' });
    if (path.endsWith('/download')) return json({ url: 'https://objects.example.test/content' });
    if (path.startsWith('https:')) return new Response(content, { headers: { 'content-type': 'application/octet-stream' } });
    return json(available);
  }));
  render(<LanguageProvider><AttachmentPanel resource={resource} fileIds={[file.id]} variant="standard" readOnly /></LanguageProvider>);
  fireEvent.click(await screen.findByRole('button', { name }));
  const modal = within(await screen.findByRole('dialog'));
  if (viewer) {
    const media = mime === 'application/pdf' ? await modal.findByTitle(name) : await modal.findByRole('img', { name });
    expect(media).toHaveAttribute('src', 'blob:preview');
  } else {
    expect(await modal.findByText('浏览器无法显示此附件。')).toBeInTheDocument();
    expect(modal.queryByTitle(name)).not.toBeInTheDocument();
  }
  expect(create).toHaveBeenCalledWith(expect.objectContaining({ type: mime }));
  if (mime === 'application/pdf') {
    expect(modal.getByRole('link', { name: '在新窗口预览 PDF' })).toBeInTheDocument();
  }
  fireEvent.click(modal.getByRole('button', { name: '关闭' }));
  expect(revoke).toHaveBeenCalledWith('blob:preview');
});

it('shows a download fallback and obtains a new grant when preview verification fails', async () => {
  vi.stubGlobal('crypto', webcrypto);
  const clicked = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
  const fetchMock = vi.fn(async (path: string) => {
    if (path.endsWith('/csrf')) return json({ csrfToken: 'csrf' });
    if (path.endsWith('/download')) return json({ url: 'https://objects.example.test/content' });
    if (path.startsWith('https:')) return new Response(new Uint8Array([98, 97, 100]), { headers: { 'content-type': 'application/octet-stream' } });
    return json({ ...file, sizeBytes: 3, status: 'AVAILABLE', scanStatus: 'CLEAN' });
  });
  vi.stubGlobal('fetch', fetchMock);
  render(<LanguageProvider><AttachmentPanel resource={resource} fileIds={[file.id]} variant="standard" readOnly /></LanguageProvider>);
  fireEvent.click(await screen.findByRole('button', { name: file.originalName }));
  const modal = within(await screen.findByRole('dialog'));
  await modal.findByText('此附件无法预览，可下载原文件查看。');
  expect(modal.getByText('文件校验未通过。')).toBeInTheDocument();
  fireEvent.click(modal.getByRole('button', { name: '下载附件' }));
  await waitFor(() => expect(clicked).toHaveBeenCalledTimes(1));
  expect(fetchMock.mock.calls.filter(([path]) => path.startsWith('/api/v1/files/') && path.endsWith('/download'))).toHaveLength(2);
});

it('never reads object bytes after the live preview authorization is denied', async () => {
  const denied = vi.fn();
  const fetchMock = vi.fn(async (path: string) => {
    if (path.endsWith('/csrf')) return json({ csrfToken: 'csrf' });
    if (path.endsWith('/download')) return json({ code: 'FILE_RESOURCE_DENIED', traceId: 'preview-denied' }, 403);
    return json({ ...file, status: 'AVAILABLE', scanStatus: 'CLEAN' });
  });
  vi.stubGlobal('fetch', fetchMock);
  render(<LanguageProvider><AttachmentPanel resource={resource} fileIds={[file.id]} variant="standard" onAccessDenied={denied} readOnly /></LanguageProvider>);
  fireEvent.click(await screen.findByRole('button', { name: file.originalName }));
  await waitFor(() => expect(denied).toHaveBeenCalledWith(expect.objectContaining({ status: 403 })));
  expect(fetchMock.mock.calls.some(([path]) => path.startsWith('https:'))).toBe(false);
});

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
  const confirmation = within(await screen.findByRole('tooltip'));
  await waitFor(() => expect(confirmation.getByText(`删除附件 · ${file.originalName}`)).toBeVisible());
  expect(confirmation.getByText(/无法继续下载/)).toBeVisible();
  expect(confirmation.queryByRole('textbox')).not.toBeInTheDocument();
  await userEvent.click(confirmation.getByRole('button', { name: /^取\s*消$/ }));
  expect(deleted).toBe(false);
  await waitFor(() => expect(confirmation.getByText(`删除附件 · ${file.originalName}`)).not.toBeVisible());
  await userEvent.click(screen.getByRole('button', { name: '删除附件' }));
  await waitFor(() => expect(confirmation.getByText(`删除附件 · ${file.originalName}`)).toBeVisible());
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

it.each([true, false])('offers standard scan retry only to the uploader (%s)', async isCurrentUserUploader => {
  vi.stubGlobal('fetch', vi.fn(async () => json({ ...file, scanStatus: 'ERROR', isCurrentUserUploader })));
  render(<LanguageProvider><AttachmentPanel resource={resource} fileIds={[file.id]} variant="standard" /></LanguageProvider>);
  await screen.findByText('扫描暂不可用，附件仍隔离');
  expect(!!screen.queryByRole('button', { name: '重试安全扫描' })).toBe(isCurrentUserUploader);
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

it('keeps a readable attachment accessible after a write-only denial', async () => {
  vi.stubGlobal('crypto', webcrypto);
  const denied = vi.fn();
  const writeDenied = vi.fn();
  vi.stubGlobal('fetch', vi.fn(async (path: string) => {
    if (path.endsWith('/csrf')) return json({ csrfToken: 'csrf' });
    if (path.endsWith('/uploads')) return json({ code: 'FILE_RESOURCE_DENIED', traceId: 'write-only-denied' }, 403);
    return json({ ...file, status: 'AVAILABLE', scanStatus: 'CLEAN' });
  }));
  render(<LanguageProvider><AttachmentPanel resource={resource} fileIds={[file.id]} variant="standard" onAccessDenied={denied} onWriteAccessDenied={writeDenied} /></LanguageProvider>);
  fireEvent.change(screen.getByLabelText('选择附件'), { target: { files: [sample()] } });
  await screen.findByText('write-only-denied');
  expect(writeDenied).toHaveBeenCalledWith(expect.objectContaining({ status: 403 }));
  expect(denied).not.toHaveBeenCalled();
  expect(await screen.findByRole('button', { name: '下载附件' })).toBeEnabled();
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
