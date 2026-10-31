import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Button, Modal, Space, Spin } from 'antd';
import type { components } from '@qms/contracts';
import { ApiError } from '../../api/client';
import { AttachmentPanel } from '../attachments/AttachmentPanel';
import { fileUrl, type Attachment, type FileResource } from '../attachments/attachments';
import { aborted, useEightDText, type EightDRead } from './eight-d';
import { useEightDEvidenceScope } from './EightDEvidenceScope';
import styles from './eight-d.module.css';

const previewTypes = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'application/pdf'];
const clean = (file: Attachment) => file.status === 'AVAILABLE' && file.scanStatus === 'CLEAN';
function previewMagic(bytes: Uint8Array, contentType: string) {
  const head = String.fromCharCode(...bytes.subarray(0, 12));
  if (contentType === 'application/pdf') return head.startsWith('%PDF-');
  if (contentType === 'image/gif') return head.startsWith('GIF87a') || head.startsWith('GIF89a');
  if (contentType === 'image/webp') return head.startsWith('RIFF') && head.slice(8, 12) === 'WEBP';
  const signature = contentType === 'image/png' ? [137, 80, 78, 71, 13, 10, 26, 10] : contentType === 'image/jpeg' ? [255, 216, 255] : undefined;
  return signature?.every((value, index) => bytes[index] === value) ?? false;
}
async function fetchPreviewBlob(url: string, file: Attachment, signal: AbortSignal) {
  const limit = 25 * 1024 * 1024;
  if (!clean(file) || !previewTypes.includes(file.contentType) || !Number.isSafeInteger(file.sizeBytes) || file.sizeBytes < 1 || file.sizeBytes > limit || !/^[a-f0-9]{64}$/.test(file.sha256)) throw new Error('PREVIEW_METADATA_INVALID');
  const response = await fetch(url, { signal, credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer' });
  const mime = response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase();
  if (!response.ok || (mime !== file.contentType && mime !== 'application/octet-stream') || Number(response.headers.get('content-length')) > limit) {
    await response.body?.cancel().catch(() => {});
    throw new Error('PREVIEW_CONTENT_INVALID');
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error('PREVIEW_BODY_UNAVAILABLE');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      signal.throwIfAborted();
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit || size > file.sizeBytes) throw new Error('PREVIEW_SIZE_EXCEEDED');
      chunks.push(new Uint8Array(value));
    }
    signal.throwIfAborted();
    if (size !== file.sizeBytes) throw new Error('PREVIEW_SIZE_MISMATCH');
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    if (!previewMagic(bytes, file.contentType)) throw new Error('PREVIEW_MAGIC_INVALID');
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    signal.throwIfAborted();
    const sha256 = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
    if (sha256 !== file.sha256) throw new Error('PREVIEW_HASH_MISMATCH');
    // Storage signs attachment/octet-stream; only verified bytes receive the preview MIME.
    return new Blob([bytes], { type: file.contentType });
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

export function EightDEvidenceSection({ label, ...props }: Parameters<typeof EightDEvidence>[0] & { label: string }) {
  const [opened, setOpened] = useState(false);
  return <details className={styles.evidence} onToggle={event => { if (event.currentTarget.open) setOpened(true); }}>
    <summary>{label} ({props.fileIds.length})</summary>
    {/* Keep an opened panel mounted so collapsing it cannot interrupt an upload. */}
    {opened && <EightDEvidence {...props} />}
  </details>;
}

export function EightDEvidence({ problemId, resource, fileIds, readOnly, read, onChange, onLocalPendingChange, onFileReady }: {
  problemId: string; fileIds: string[]; readOnly: boolean; read: EightDRead; onChange: (ids: string[]) => void;
  resource?: FileResource; onLocalPendingChange?: (pending: boolean) => void;
  onFileReady?: (file: Attachment) => boolean | void;
}) {
  const text = useEightDText();
  const scope = useEightDEvidenceScope();
  const targetResource = resource ?? { resourceType: 'process-eight-d', resourceId: problemId };
  const [files, setFiles] = useState<Attachment[]>([]);
  const [preview, setPreview] = useState<{ file: Attachment; url?: string }>();
  const [zoom, setZoom] = useState(100);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const generation = useRef(0);
  const previewRequest = useRef<AbortController | undefined>(undefined);
  const objectUrl = useRef<string | undefined>(undefined);
  const previewFile = useRef<Attachment | undefined>(undefined);
  const revoked = useRef(false);
  const idsKey = [...fileIds].sort().join(',');
  const release = useCallback(() => {
    generation.current++; previewRequest.current?.abort(); previewRequest.current = undefined;
    if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    objectUrl.current = undefined; previewFile.current = undefined;
  }, []);
  const close = useCallback(() => { release(); setPreview(undefined); setBusy(false); setError(false); }, [release]);
  useEffect(() => { close(); return release; }, [problemId, targetResource.resourceType, targetResource.resourceId, idsKey, read, close, release]);
  const denied = useCallback((cause: ApiError) => {
    revoked.current = true; close(); setFiles([]); scope.onAccessDenied?.(cause);
  }, [close, scope.onAccessDenied]);
  const changed = useCallback((values: Attachment[]) => {
    if (revoked.current) return;
    const selected = previewFile.current;
    if (selected && !values.some(file => file.id === selected.id && file.version === selected.version && clean(file))) close();
    setFiles(values);
  }, [close]);
  async function grant(file: Attachment, signal: AbortSignal) {
    const value = await read<components['schemas']['FileDownloadDto']>(`/api/v1/files/${encodeURIComponent(file.id)}/download`, { method: 'POST', body: '{}', signal });
    signal.throwIfAborted();
    return fileUrl(value.url);
  }
  async function open(file: Attachment) {
    if (busy || revoked.current || !fileIds.includes(file.id) || !clean(file)) return;
    release();
    const controller = new AbortController(); previewRequest.current = controller; previewFile.current = file;
    const version = generation.current; setBusy(true); setError(false); setZoom(100); setPreview({ file });
    try {
      const url = await grant(file, controller.signal);
      const blob = await fetchPreviewBlob(url, file, controller.signal);
      if (version !== generation.current || revoked.current) return;
      objectUrl.current = URL.createObjectURL(blob);
      setPreview({ file, url: objectUrl.current });
    } catch (cause) {
      if (version === generation.current && !aborted(cause)) {
        if (cause instanceof ApiError && (cause.status === 401 || cause.status === 403)) denied(cause);
        else setError(true);
      }
    }
    finally { if (version === generation.current) setBusy(false); }
  }
  async function download(file: Attachment) {
    if (busy || revoked.current || !clean(file)) return;
    const controller = new AbortController(); previewRequest.current = controller;
    const version = generation.current; setBusy(true); setError(false);
    try {
      const url = await grant(file, controller.signal);
      if (version !== generation.current || revoked.current) return;
      const link = document.createElement('a'); link.href = url; link.download = file.originalName; link.rel = 'noreferrer';
      document.body.append(link); link.click(); link.remove();
    } catch (cause) {
      if (version === generation.current && !aborted(cause)) {
        if (cause instanceof ApiError && (cause.status === 401 || cause.status === 403)) denied(cause);
        else setError(true);
      }
    } finally { if (version === generation.current) setBusy(false); }
  }
  return <>
    <AttachmentPanel resource={targetResource} fileIds={fileIds} readOnly={readOnly || revoked.current} onFilesChanged={changed}
      onAccessDenied={denied} onPendingChange={onLocalPendingChange ? undefined : scope.onPendingChange} onLocalPendingChange={onLocalPendingChange}
      onReady={file => { if (revoked.current) return false; if (onFileReady) return onFileReady(file); if (readOnly) return false; if (!fileIds.includes(file.id)) onChange([...fileIds, file.id]); return true; }} onRemoved={id => { if (!readOnly && !revoked.current) onChange(fileIds.filter(file => file !== id)); }} />
    <Space wrap>{files.filter(file => fileIds.includes(file.id) && clean(file) && previewTypes.includes(file.contentType)).map(file => <Button key={file.id} disabled={busy} aria-label={`${text('预览附件', 'Preview attachment')} ${file.originalName}`} onClick={() => void open(file)}>{text('预览附件', 'Preview attachment')} · {file.originalName}</Button>)}</Space>
    <Modal open={!!preview} title={preview?.file.originalName} onCancel={close} destroyOnHidden width="min(1000px, 95vw)" footer={<Space wrap>
      {preview && <Button disabled={busy} onClick={() => void download(preview.file)}>{text('授权下载附件', 'Download authorized attachment')}</Button>}
      <Button onClick={close}>{text('关闭预览', 'Close preview')}</Button>
    </Space>}>
      {busy && <Spin aria-label={text('正在加载预览', 'Loading preview')} />}
      {error && <Alert type="error" title={text('附件预览或下载失败，请重新授权下载。', 'Preview or download failed. Request a new download authorization.')} />}
      {preview?.url && <>

        {preview.file.contentType === 'application/pdf'
          ? <iframe title={preview.file.originalName} src={preview.url} sandbox="" referrerPolicy="no-referrer" style={{ width: '100%', height: '65vh', border: 0 }} />
          : <><Space><Button aria-label={text('缩小图片', 'Zoom out')} disabled={zoom <= 100} onClick={() => setZoom(value => value - 25)}>-</Button><span>{zoom}%</span><Button aria-label={text('放大图片', 'Zoom in')} disabled={zoom >= 400} onClick={() => setZoom(value => value + 25)}>+</Button></Space><div style={{ maxHeight: '65vh', overflow: 'auto' }}><img src={preview.url} alt={preview.file.originalName} referrerPolicy="no-referrer" style={{ width: `${zoom}%`, maxWidth: 'none' }} /></div></>}
      </>}
    </Modal>
  </>;
}
