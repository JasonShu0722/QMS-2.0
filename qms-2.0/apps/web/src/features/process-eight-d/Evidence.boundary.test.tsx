import { createHash, webcrypto } from 'node:crypto';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { LanguageProvider } from '../../i18n/Language';
import { EightDEvidence } from './EightDEvidence';
import { EightDControlledReport } from './EightDControlledReport';
import { EightDEvidenceScopeContext, type EightDEvidenceScopeValue } from './EightDEvidenceScope';
import type { EightDDocument, EightDRead, EightDReport } from './eight-d';

const png = new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'));
function pdfSample() {
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << >> /Contents 4 0 R >>', '<< /Length 0 >>\nstream\n\nendstream'];
  let value = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((body, index) => { offsets.push(value.length); value += `${index + 1} 0 obj\n${body}\nendobj\n`; });
  const xref = value.length;
  value += `xref\n0 5\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(value);
}
const pdf = pdfSample();
const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const file = { id: 'evidence-1', resourceType: 'process-eight-d', resourceId: 'problem-1', originalName: 'evidence.png', contentType: 'image/png', sizeBytes: png.length, sha256: sha256(png), version: 3, status: 'AVAILABLE', scanStatus: 'CLEAN' };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const document: EightDDocument = { description: '', okFileIds: [], ngFileIds: [], temporaryMeasures: [], containment: [], optionalAffectedContainment: [], analysisProcess: '', analysisFileIds: [], occurrenceCause: '', escapeCause: '', systemCause: '', correctiveActions: [], horizontalDeployment: [], standardization: [], closureSummary: '' };
beforeEach(() => vi.stubGlobal('crypto', webcrypto));
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it('uses an explicit customer source resource for uploads while retaining verified preview metadata', async () => {
  const current = { ...file, resourceType: 'CustomerComplaint', resourceId: 'complaint-1' };
  let uploaded: { resourceType: string; resourceId: string } | undefined;
  vi.stubGlobal('fetch', vi.fn(async (path: string, init?: RequestInit) => {
    if (path.endsWith('/csrf')) return json({ csrfToken: 'csrf-test' });
    if (path.endsWith('/uploads')) { uploaded = JSON.parse(String(init?.body)); return json({ code: 'FILE_UPLOAD_INVALID', message: 'test boundary' }, 422); }
    return json(current);
  }));
  const scope = { onAccessDenied: vi.fn(), onPendingChange: vi.fn() };
  const props = { problemId: current.resourceId, resource: { resourceType: current.resourceType, resourceId: current.resourceId },
    fileIds: [current.id], readOnly: false, read: vi.fn(async () => undefined as never), onChange: vi.fn() };
  render(<LanguageProvider><EightDEvidenceScopeContext.Provider value={scope}><EightDEvidence {...props} /></EightDEvidenceScopeContext.Provider></LanguageProvider>);
  expect(await screen.findByRole('button', { name: `预览附件 ${current.originalName}` })).toBeEnabled();
  expect(scope.onAccessDenied).not.toHaveBeenCalled();
  const selected = new File([png], 'source-proof.png', { type: 'image/png' });
  Object.defineProperty(selected, 'arrayBuffer', { value: async () => png.slice().buffer });
  fireEvent.change(screen.getByLabelText('选择附件'), { target: { files: [selected] } });
  await waitFor(() => expect(uploaded).toMatchObject({ resourceType: 'CustomerComplaint', resourceId: current.resourceId }));
});

it('lets a persisted source resource acknowledge its own CLEAN receipt after a read-only handoff', async () => {
  let complete!: (response: Response) => void;
  const current = { ...file, resourceType: 'CustomerComplaint', resourceId: 'complaint-1' };
  vi.stubGlobal('fetch', vi.fn(async (path: string) => {
    if (path.endsWith('/csrf')) return json({ csrfToken: 'csrf-test' });
    if (path.endsWith('/uploads')) return json({ file: { ...current, status: 'QUARANTINED', scanStatus: 'WAITING_UPLOAD', version: 1 }, uploadUrl: 'https://objects.example.test/source', headers: {} });
    if (path.startsWith('https:')) return new Response(null);
    if (path.endsWith('/complete')) return new Promise<Response>(resolve => { complete = resolve; });
    return json(current);
  }));
  const ready = vi.fn(() => true), pending = vi.fn(), change = vi.fn();
  const props = { problemId: current.resourceId, resource: { resourceType: current.resourceType, resourceId: current.resourceId },
    fileIds: [], read: vi.fn(async () => undefined as never), onChange: change, onFileReady: ready, onLocalPendingChange: pending };
  const content = (readOnly: boolean) => <LanguageProvider><EightDEvidence {...props} readOnly={readOnly} /></LanguageProvider>;
  const view = render(content(false));
  const selected = new File([png], 'source.png', { type: 'image/png' });
  Object.defineProperty(selected, 'arrayBuffer', { value: async () => png.slice().buffer });
  fireEvent.change(screen.getByLabelText('选择附件'), { target: { files: [selected] } });
  await waitFor(() => expect(complete).toBeTypeOf('function'));
  view.rerender(content(true));
  await act(async () => complete(json(current)));
  await waitFor(() => expect(pending).toHaveBeenLastCalledWith(false));
  expect(ready).toHaveBeenCalledWith(expect.objectContaining({ id: current.id, status: 'AVAILABLE', scanStatus: 'CLEAN' }));
  expect(change).not.toHaveBeenCalled();
});

function mount({ readOnly = false, read = vi.fn(async () => undefined as never), scope = { onAccessDenied: vi.fn(), onPendingChange: vi.fn() }, onChange = vi.fn() }: {
  readOnly?: boolean; read?: EightDRead; scope?: EightDEvidenceScopeValue; onChange?: (ids: string[]) => void;
} = {}) {
  return render(<LanguageProvider><EightDEvidenceScopeContext.Provider value={scope}>
    <EightDEvidence problemId="problem-1" fileIds={[file.id]} readOnly={readOnly} read={read} onChange={onChange} />
  </EightDEvidenceScopeContext.Provider></LanguageProvider>);
}

it('routes the real evidence panel denial to the scope without missing-id fallback reads', async () => {
  const scope = { onAccessDenied: vi.fn(), onPendingChange: vi.fn() };
  const read = vi.fn(async () => undefined as never);
  const fetchMock = vi.fn(async () => json({ code: 'FILE_RESOURCE_DENIED', traceId: 'boundary-denied' }, 403));
  vi.stubGlobal('fetch', fetchMock);
  mount({ scope, read });
  await screen.findByText('boundary-denied');
  expect(scope.onAccessDenied).toHaveBeenCalledWith(expect.objectContaining({ status: 403 }));
  expect(read).not.toHaveBeenCalled();
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it.each(['application/pdf', 'image/png'])('previews verified %s from the actual octet-stream attachment storage contract without changing the signed URL', async contentType => {
  vi.stubGlobal('crypto', webcrypto);
  const bytes = contentType === 'application/pdf' ? pdf : png;
  const current = { ...file, contentType, originalName: contentType === 'application/pdf' ? 'evidence.pdf' : 'evidence.png', sizeBytes: bytes.length, sha256: sha256(bytes) };
  const signed = 'https://objects.example.test/download?response-content-type=application%2Foctet-stream&response-content-disposition=attachment&X-Amz-Signature=original';
  const create = vi.fn(() => 'blob:verified-storage');
  const revoke = vi.fn();
  vi.stubGlobal('URL', class extends URL { static createObjectURL = create; static revokeObjectURL = revoke; });
  const fetchMock = vi.fn(async (path: string, _init?: RequestInit) => path.startsWith('https:')
    ? new Response(bytes, { headers: { 'content-type': 'application/octet-stream', 'content-disposition': 'attachment' } }) : json(current));
  vi.stubGlobal('fetch', fetchMock);
  const view = mount({ read: vi.fn(async () => ({ url: signed }) as never) });
  fireEvent.click(await screen.findByRole('button', { name: `预览附件 ${current.originalName}` }));
  await waitFor(() => expect(create).toHaveBeenCalledWith(expect.objectContaining({ type: contentType, size: bytes.length })));
  const dialog = screen.getByRole('dialog');
  const media = contentType === 'application/pdf' ? within(dialog).getByTitle(current.originalName) : within(dialog).getByRole('img', { name: current.originalName });
  expect(media).toHaveAttribute('src', 'blob:verified-storage');
  expect(fetchMock.mock.calls.find(([path]) => path.startsWith('https:'))?.[0]).toBe(signed);
  view.unmount();
  expect(revoke).toHaveBeenCalledWith('blob:verified-storage');
});

it.each(['image/png', 'application/pdf'])('opens authorized %s bytes in a modal and revokes the object URL on close', async contentType => {
  const bytes = contentType === 'application/pdf' ? pdf : png;
  const current = { ...file, contentType, originalName: contentType === 'application/pdf' ? 'proof.pdf' : 'proof.png', sizeBytes: bytes.length, sha256: sha256(bytes) };
  const create = vi.fn(() => 'blob:authorized-preview');
  const revoke = vi.fn();
  vi.stubGlobal('URL', class extends URL { static createObjectURL = create; static revokeObjectURL = revoke; });
  const fetchMock = vi.fn(async (path: string, _init?: RequestInit) => path.startsWith('https:')
    ? new Response(bytes, { headers: { 'content-type': `${contentType}; charset=binary`, 'content-disposition': 'attachment' } })
    : json(current));
  vi.stubGlobal('fetch', fetchMock);
  const read = vi.fn(async () => ({ url: 'https://objects.example.test/download?signed=temporary' }) as never);
  const view = mount({ read });
  fireEvent.click(await screen.findByRole('button', { name: `预览附件 ${current.originalName}` }));
  const dialog = await screen.findByRole('dialog');
  if (contentType === 'application/pdf') {
    await waitFor(() => expect(within(dialog).getByTitle('proof.pdf')).toHaveAttribute('src', 'blob:authorized-preview'));
    expect(within(dialog).getByTitle('proof.pdf')).toHaveAttribute('sandbox', '');
  } else {
    await waitFor(() => expect(within(dialog).getByRole('img', { name: 'proof.png' })).toHaveAttribute('src', 'blob:authorized-preview'));
    fireEvent.click(within(dialog).getByRole('button', { name: '放大图片' }));
    expect(within(dialog).getByRole('img', { name: 'proof.png' })).toHaveStyle({ width: '125%' });
  }
  expect(create).toHaveBeenCalledWith(expect.objectContaining({ type: contentType, size: bytes.length }));
  expect(fetchMock.mock.calls.find(([path]) => path.startsWith('https:'))?.[1]).toMatchObject({ credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer' });
  fireEvent.click(within(dialog).getByRole('button', { name: '关闭预览' }));
  await waitFor(() => expect(revoke).toHaveBeenCalledWith('blob:authorized-preview'));
  expect(read).toHaveBeenCalledTimes(1);
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  fireEvent.click(screen.getByRole('button', { name: `预览附件 ${current.originalName}` }));
  await waitFor(() => expect(create).toHaveBeenCalledTimes(2));
  expect(read).toHaveBeenCalledTimes(2);
  view.unmount();
  expect(revoke).toHaveBeenCalledTimes(2);
});

it('routes a real controlled-report raw attachment denial through the same scope', async () => {
  const scope = { onAccessDenied: vi.fn(), onPendingChange: vi.fn() };
  vi.stubGlobal('fetch', vi.fn(async () => json({ code: 'FILE_RESOURCE_DENIED', traceId: 'raw-denied' }, 401)));
  const read: EightDRead = async <T,>() => ({ reportNumber: '8D-1', attachments: [{ ...file, uses: [] }], snapshot: { document, sources: [] } }) as T;
  const report = { organizationId: 'org-1', problemId: 'problem-1', version: 1, revisions: [] } as unknown as EightDReport;
  render(<LanguageProvider><EightDEvidenceScopeContext.Provider value={scope}><EightDControlledReport report={report} read={read} download={vi.fn()} /></EightDEvidenceScopeContext.Provider></LanguageProvider>);
  await screen.findByText('raw-denied');
  expect(scope.onAccessDenied).toHaveBeenCalledWith(expect.objectContaining({ status: 401 }));
});

it('registers separate stable pending ids and unregisters every panel on unmount', async () => {
  const scope = { onAccessDenied: vi.fn(), onPendingChange: vi.fn() };
  vi.stubGlobal('fetch', vi.fn(async () => json({ ...file, status: 'QUARANTINED', scanStatus: 'PENDING' })));
  const read = vi.fn(async () => undefined as never);
  const view = render(<LanguageProvider><EightDEvidenceScopeContext.Provider value={scope}>
    {[1, 2].map(key => <EightDEvidence key={key} problemId="problem-1" fileIds={[file.id]} readOnly read={read} onChange={vi.fn()} />)}
  </EightDEvidenceScopeContext.Provider></LanguageProvider>);
  await waitFor(() => expect(scope.onPendingChange.mock.calls.filter(([, pending]) => pending)).toHaveLength(2));
  const ids = scope.onPendingChange.mock.calls.filter(([, pending]) => pending).map(([id]) => id);
  expect(new Set(ids).size).toBe(2);
  view.unmount();
  for (const id of ids) expect(scope.onPendingChange.mock.calls.filter(([value]) => value === id).at(-1)).toEqual([id, false]);
});

it('cancels closed preview authorization and ignores its late result', async () => {
  let resolve!: (value: never) => void;
  const read = vi.fn((_path: string, _init?: RequestInit) => new Promise<never>(done => { resolve = done; }));
  const fetchMock = vi.fn(async () => json(file));
  vi.stubGlobal('fetch', fetchMock);
  mount({ read });
  fireEvent.click(await screen.findByRole('button', { name: '预览附件 evidence.png' }));
  const dialog = await screen.findByRole('dialog');
  fireEvent.click(within(dialog).getByRole('button', { name: '关闭预览' }));
  expect(read.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
  await act(async () => resolve({ url: 'https://objects.example.test/late' } as never));
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it('bounds PDF streaming without trusting Content-Length and offers a freshly authorized fallback', async () => {
  const create = vi.fn();
  const cancel = vi.fn();
  vi.stubGlobal('URL', class extends URL { static createObjectURL = create; static revokeObjectURL = vi.fn(); });
  const fetchMock = vi.fn(async (path: string) => path.startsWith('https:')
    ? new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(25 * 1024 * 1024)); controller.enqueue(new Uint8Array(1)); }, cancel }), { headers: { 'content-type': 'application/octet-stream' } })
    : json({ ...file, originalName: 'proof.pdf', contentType: 'application/pdf', sizeBytes: 25 * 1024 * 1024 }));
  vi.stubGlobal('fetch', fetchMock);
  const read = vi.fn(async () => ({ url: 'https://objects.example.test/bounded' }) as never);
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  mount({ read });
  fireEvent.click(await screen.findByRole('button', { name: '预览附件 proof.pdf' }));
  const dialog = await screen.findByRole('dialog');
  await within(dialog).findByText('附件预览或下载失败，请重新授权下载。');
  expect(create).not.toHaveBeenCalled();
  expect(cancel).toHaveBeenCalled();
  fireEvent.click(within(dialog).getByRole('button', { name: '授权下载附件' }));
  await waitFor(() => expect(click).toHaveBeenCalledTimes(1));
  expect(read).toHaveBeenCalledTimes(2);
  click.mockRestore();
});

it('revokes an open preview object URL immediately when metadata access is withdrawn', async () => {
  let forbidden = false;
  const revoke = vi.fn();
  vi.stubGlobal('URL', class extends URL { static createObjectURL = () => 'blob:revoke-me'; static revokeObjectURL = revoke; });
  vi.stubGlobal('fetch', vi.fn(async (path: string) => path.startsWith('https:')
    ? new Response(png, { headers: { 'content-type': 'application/octet-stream' } })
    : forbidden ? json({ code: 'FILE_RESOURCE_DENIED', traceId: 'revoked' }, 403) : json(file)));
  const scope = { onAccessDenied: vi.fn(), onPendingChange: vi.fn() };
  mount({ scope, read: vi.fn(async () => ({ url: 'https://objects.example.test/current' }) as never) });
  fireEvent.click(await screen.findByRole('button', { name: '预览附件 evidence.png' }));
  const dialog = await screen.findByRole('dialog');
  await waitFor(() => expect(within(dialog).getByRole('img', { name: file.originalName })).toHaveAttribute('src', 'blob:revoke-me'));
  forbidden = true;
  fireEvent.click(screen.getByRole('button', { name: '刷新附件' }));
  await waitFor(() => expect(scope.onAccessDenied).toHaveBeenCalledWith(expect.objectContaining({ status: 403 })));
  expect(revoke).toHaveBeenCalledWith('blob:revoke-me');
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
});

it('cancels a MIME-mismatched response instead of leaving a rejected download streaming', async () => {
  const cancel = vi.fn();
  vi.stubGlobal('fetch', vi.fn(async (path: string) => path.startsWith('https:')
    ? new Response(new ReadableStream({ cancel }), { headers: { 'content-type': 'text/html' } })
    : json(file)));
  mount({ read: vi.fn(async () => ({ url: 'https://objects.example.test/wrong-mime' }) as never) });
  fireEvent.click(await screen.findByRole('button', { name: '预览附件 evidence.png' }));
  const dialog = await screen.findByRole('dialog');
  await within(dialog).findByText('附件预览或下载失败，请重新授权下载。');
  expect(cancel).toHaveBeenCalledTimes(1);
  expect(within(dialog).queryByRole('img', { name: file.originalName })).not.toBeInTheDocument();
});

it.each(['magic', 'size', 'truncated', 'hash', 'html-header', 'other-image-header'])('rejects storage preview %s mismatches before creating an object URL', async mismatch => {
  const bytes = mismatch === 'magic' ? new TextEncoder().encode('<html><script>alert(1)</script></html>') : mismatch === 'truncated' ? pdf.slice(0, -1) : pdf;
  const current = { ...file, contentType: 'application/pdf', sizeBytes: bytes.length, sha256: sha256(bytes) };
  if (mismatch === 'size') current.sizeBytes--;
  if (mismatch === 'truncated') current.sizeBytes++;
  if (mismatch === 'hash') current.sha256 = '0'.repeat(64);
  const wrongHeader = mismatch === 'html-header' || mismatch === 'other-image-header';
  const mime = mismatch === 'html-header' ? 'text/html' : mismatch === 'other-image-header' ? 'image/png' : 'application/octet-stream';
  const cancel = vi.fn();
  const create = vi.fn();
  const digest = vi.spyOn(webcrypto.subtle, 'digest');
  vi.stubGlobal('URL', class extends URL { static createObjectURL = create; static revokeObjectURL = vi.fn(); });
  vi.stubGlobal('fetch', vi.fn(async (path: string) => path.startsWith('https:')
    ? new Response(new ReadableStream({ start(controller) { controller.enqueue(bytes); if (!wrongHeader) controller.close(); }, cancel }), { headers: { 'content-type': mime } }) : json(current)));
  mount({ read: vi.fn(async () => ({ url: 'https://objects.example.test/invalid-bytes?signature=unchanged' }) as never) });
  fireEvent.click(await screen.findByRole('button', { name: `预览附件 ${current.originalName}` }));
  const dialog = await screen.findByRole('dialog');
  await within(dialog).findByText('附件预览或下载失败，请重新授权下载。');
  expect(create).not.toHaveBeenCalled();
  expect(within(dialog).queryByTitle(current.originalName)).not.toBeInTheDocument();
  if (wrongHeader) expect(cancel).toHaveBeenCalledTimes(1);
  if (mismatch === 'hash') expect(digest).toHaveBeenCalledTimes(1);
});

it('does not offer HTML as a preview type even for CLEAN attachment metadata', async () => {
  const fetchMock = vi.fn(async () => json({ ...file, contentType: 'text/html' }));
  vi.stubGlobal('fetch', fetchMock);
  mount();
  await screen.findByRole('button', { name: '下载附件' });
  expect(screen.queryByRole('button', { name: `预览附件 ${file.originalName}` })).not.toBeInTheDocument();
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it.each(['close', 'unmount'])('does not publish a late preview after %s during SHA verification', async action => {
  const digest = await webcrypto.subtle.digest('SHA-256', png);
  let release!: (value: ArrayBuffer) => void;
  vi.spyOn(webcrypto.subtle, 'digest').mockImplementationOnce(() => new Promise<ArrayBuffer>(resolve => { release = resolve; }));
  const create = vi.fn();
  vi.stubGlobal('URL', class extends URL { static createObjectURL = create; static revokeObjectURL = vi.fn(); });
  const fetchMock = vi.fn(async (path: string, _init?: RequestInit) => path.startsWith('https:')
    ? new Response(png, { headers: { 'content-type': 'application/octet-stream' } }) : json(file));
  vi.stubGlobal('fetch', fetchMock);
  const view = mount({ read: vi.fn(async () => ({ url: 'https://objects.example.test/hash-pending' }) as never) });
  fireEvent.click(await screen.findByRole('button', { name: `预览附件 ${file.originalName}` }));
  await waitFor(() => expect(release).toBeTypeOf('function'));
  if (action === 'unmount') view.unmount();
  else fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '关闭预览' }));
  expect(fetchMock.mock.calls.find(([path]) => path.startsWith('https:'))?.[1]?.signal?.aborted).toBe(true);
  await act(async () => release(digest));
  expect(create).not.toHaveBeenCalled();
});

it('defers real F2 upload evidence until editable while retaining the scope pending id', async () => {
  vi.stubGlobal('crypto', webcrypto);
  const uploaded = { ...file, id: 'uploaded-2' };
  let uploadCompleted = false;
  let complete!: (response: Response) => void;
  vi.stubGlobal('fetch', vi.fn(async (path: string) => {
    if (path.endsWith('/csrf')) return json({ csrfToken: 'csrf' });
    if (path.endsWith('/uploads')) return json({ file: { ...uploaded, status: 'QUARANTINED', scanStatus: 'WAITING_UPLOAD' }, uploadUrl: 'https://objects.example.test/upload', headers: {} });
    if (path.startsWith('https:')) return new Response(null);
    if (path.endsWith('/complete')) return new Promise<Response>(resolve => { complete = response => { uploadCompleted = true; resolve(response); }; });
    if (path.endsWith('/uploaded-2')) return json(uploadCompleted ? uploaded : { ...uploaded, status: 'QUARANTINED', scanStatus: 'WAITING_UPLOAD' });
    return json(file);
  }));
  const selected = new File(['sample'], 'sample.txt', { type: 'text/plain' });
  Object.defineProperty(selected, 'arrayBuffer', { value: async () => new TextEncoder().encode('sample').buffer });
  const scope = { onAccessDenied: vi.fn(), onPendingChange: vi.fn() };
  const read = vi.fn(async () => undefined as never);
  const change = vi.fn();
  const panel = (readOnly: boolean) => <LanguageProvider><EightDEvidenceScopeContext.Provider value={scope}>
    <EightDEvidence problemId="problem-1" fileIds={[file.id]} readOnly={readOnly} read={read} onChange={change} />
  </EightDEvidenceScopeContext.Provider></LanguageProvider>;
  const view = render(panel(false));
  fireEvent.change(screen.getByLabelText('选择附件'), { target: { files: [selected] } });
  await waitFor(() => expect(complete).toBeTypeOf('function'));
  view.rerender(panel(true));
  await act(async () => complete(json(uploaded)));
  await waitFor(() => expect(screen.getAllByText('扫描通过，可作为证据')).toHaveLength(2));
  expect(change).not.toHaveBeenCalled();
  const id = scope.onPendingChange.mock.calls.find(([, pending]) => pending)?.[0];
  expect(scope.onPendingChange).toHaveBeenLastCalledWith(id, true);
  view.rerender(panel(false));
  await waitFor(() => expect(change).toHaveBeenCalledWith([file.id, uploaded.id]));
  expect(change).toHaveBeenCalledTimes(1);
  await waitFor(() => expect(scope.onPendingChange).toHaveBeenLastCalledWith(id, false));
});
