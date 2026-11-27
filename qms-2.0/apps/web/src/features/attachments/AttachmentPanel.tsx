import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Button, Card, Empty, Popconfirm, Space, Spin, Tag, Typography } from 'antd';
import { Camera, Paperclip, RefreshCw } from 'lucide-react';
import { ApiError, safeAccountError } from '../../api/client';
import { useLanguage } from '../../i18n/Language';
import { AttachmentCameraDialog } from './AttachmentCameraDialog';
import { AttachmentPreviewDialog } from './AttachmentPreviewDialog';
import { canDownloadAttachment, canPreviewAttachment } from './attachment-preview';
import { attachmentDownload, createUploadAttempt, deleteAttachment, readAttachment, retryScanAttachment, type Attachment, type FileResource } from './attachments';

import './attachments.css';

interface Props {
  resource: FileResource;
  fileIds: string[];
  variant?: 'standard';
  imagesOnly?: boolean;
  preserveAvailableFile?: boolean;
  readOnly?: boolean;
  downloadUrl?: (id: string, signal: AbortSignal) => Promise<string>;
  onReady?: (file: Attachment) => void | boolean;
  onUploadCompleted?: (file: Attachment) => void;
  onAccessDenied?: (cause: ApiError) => void;
  onWriteAccessDenied?: (cause: ApiError) => void;
  onPendingChange?: (pending: boolean) => void;
  onLocalPendingChange?: (pending: boolean) => void;
  onFilesChanged?: (files: Attachment[]) => void;
  onRemoved?: (id: string) => void;
  onDetach?: (id: string) => void;
}

export function AttachmentPanel(props: Props) {
  return <AttachmentContent key={`${props.resource.resourceType}:${props.resource.resourceId}`} {...props} />;
}

function AttachmentContent({ resource, fileIds, variant, imagesOnly = false, preserveAvailableFile = false, readOnly = false, downloadUrl = attachmentDownload, onReady, onUploadCompleted, onFilesChanged, onRemoved, onDetach, onAccessDenied, onWriteAccessDenied, onPendingChange, onLocalPendingChange }: Props) {
  const { t, locale } = useLanguage();
  const standard = variant === 'standard';
  const english = locale === 'en-US';
  const [localIds, setLocalIds] = useState<string[]>([]);
  const [files, setFiles] = useState<Record<string, Attachment>>({});
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(false);
  const [queryError, setQueryError] = useState<unknown>();
  const [actionError, setActionError] = useState<unknown>();
  const [busy, setBusy] = useState(false);
  const [retryAvailable, setRetryAvailable] = useState(false);
  const [preview, setPreview] = useState<{ file: Attachment; downloadUrl: typeof downloadUrl }>();
  const [cameraOpen, setCameraOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const picker = useRef<HTMLInputElement>(null);
  const attempt = useRef<ReturnType<typeof createUploadAttempt> | undefined>(undefined);
  const actionLock = useRef(false);
  const lifetime = useRef(new AbortController());
  const [announced, setAnnounced] = useState(new Set<string>());
  const readyCallback = useRef(onReady);
  readyCallback.current = onReady;
  const completedCallback = useRef(onUploadCompleted);
  completedCallback.current = onUploadCompleted;
  const filesChangedCallback = useRef(onFilesChanged);
  filesChangedCallback.current = onFilesChanged;
  const deniedCallback = useRef(onAccessDenied);
  deniedCallback.current = onAccessDenied;
  const writeDeniedCallback = useRef(onWriteAccessDenied);
  writeDeniedCallback.current = onWriteAccessDenied;
  const reportError = useCallback((cause: unknown, access: 'read' | 'write' = 'read') => {
    if (cause instanceof ApiError && (cause.status === 401 || cause.status === 403)) {
      if (cause.status === 403 && access === 'write' && writeDeniedCallback.current) {
        writeDeniedCallback.current(cause);
        return;
      }
      setPreview(undefined);
      deniedCallback.current?.(cause);
    }
  }, []);
  const idsKey = [...new Set([...fileIds, ...localIds])].sort().join(',');
  const ids = idsKey ? idsKey.split(',') : [];
  const visible = ids.flatMap((id) => files[id] ? [files[id]!] : []);
  const requiredFile = (file: Attachment) => preserveAvailableFile && fileIds.includes(file.id) && canDownloadAttachment(file)
    && !visible.some(other => other.id !== file.id && fileIds.includes(other.id) && canDownloadAttachment(other));
  const selected = preview?.file;
  const previewFile = selected && preview?.downloadUrl === downloadUrl && ids.includes(selected.id) && files[selected.id]?.version === selected.version && canPreviewAttachment(files[selected.id]!) ? selected : undefined;
  useEffect(() => { if (preview && !previewFile) setPreview(undefined); }, [preview, previewFile]);
  useEffect(() => { if (readOnly) setCameraOpen(false); }, [readOnly]);
  const pending = visible.some((file) => file.status === 'QUARANTINED' && ['WAITING_UPLOAD', 'PENDING'].includes(file.scanStatus));
  const awaitingReceipt = !!onReady && localIds.some(id => files[id]?.status === 'AVAILABLE' && files[id]?.scanStatus === 'CLEAN' && !announced.has(id));
  const unsettled = busy || pending || awaitingReceipt;
  useEffect(() => { onPendingChange?.(unsettled); }, [onPendingChange, unsettled]);
  const localUnsettled = busy || retryAvailable || awaitingReceipt || localIds.some(id => files[id]?.status === 'QUARANTINED' && ['WAITING_UPLOAD', 'PENDING'].includes(files[id].scanStatus));
  useEffect(() => { onLocalPendingChange?.(localUnsettled); }, [onLocalPendingChange, localUnsettled]);
  useEffect(() => () => onPendingChange?.(false), [onPendingChange]);
  const refresh = () => setRevision((value) => value + 1);
  useEffect(() => {
    const controller = new AbortController();
    lifetime.current = controller;
    return () => controller.abort();
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    const requested = idsKey ? idsKey.split(',') : [];
    setLoading(true); setQueryError(undefined);
    Promise.allSettled(requested.map((id) => readAttachment(id, controller.signal).catch(cause => {
      if (!controller.signal.aborted) reportError(cause);
      throw cause;
    }))).then((results) => {
      if (controller.signal.aborted) return;
      const failure = results.find((result) => result.status === 'rejected');
      if (failure?.status === 'rejected') setQueryError(failure.reason);
      setFiles((current) => Object.fromEntries(results.flatMap((result, index) => {
        if (result.status !== 'fulfilled') return [];
        const file = result.value;
        const existing = current[requested[index]!];
        return [[file.id, existing && existing.version > file.version ? existing : file]];
      })));
      filesChangedCallback.current?.(results.flatMap((result) => result.status === 'fulfilled' ? [result.value] : []));
      setLoading(false);
    });
    return () => controller.abort();
  }, [idsKey, revision]);
  useEffect(() => {
    if (!pending) return;
    const timer = setTimeout(refresh, 2000);
    return () => clearTimeout(timer);
  }, [pending, revision]);
  useEffect(() => {
    const accepted: string[] = [];
    for (const id of localIds) {
      const file = files[id];
      if (file?.status !== 'AVAILABLE' || file.scanStatus !== 'CLEAN' || announced.has(id)) continue;
      if (readyCallback.current?.(file) !== false) accepted.push(id);
    }
    if (accepted.length) setAnnounced(current => new Set([...current, ...accepted]));
  }, [files, localIds, announced, onReady, readOnly]);
  const observe = (file: Attachment) => {
    if (lifetime.current.signal.aborted) return;
    setLocalIds((current) => current.includes(file.id) ? current : [...current, file.id]);
    setFiles((current) => ({ ...current, [file.id]: file }));
  };
  async function upload(selected?: File) {
    if (imagesOnly && selected && !['image/png', 'image/jpeg'].includes(selected.type)) {
      setActionError(new Error('FILE_IMAGE_REQUIRED'));
      return;
    }
    if (actionLock.current || readOnly) return;
    actionLock.current = true; setBusy(true); setActionError(undefined); setRetryAvailable(false);
    try {
      if (selected) attempt.current = createUploadAttempt(resource, selected);
      if (!attempt.current) return;
      const completed = await attempt.current.run(observe, lifetime.current.signal);
      attempt.current = undefined;
      if (!lifetime.current.signal.aborted) completedCallback.current?.(completed);
    } catch (cause) {
      if (!lifetime.current.signal.aborted) { reportError(cause, 'write'); setActionError(cause); setRetryAvailable(true); }
    } finally {
      actionLock.current = false;
      if (!lifetime.current.signal.aborted) { setBusy(false); refresh(); }
    }
  }
  async function operate(file: Attachment, action: 'download' | 'delete' | 'retry-scan') {
    if (actionLock.current || action !== 'download' && readOnly) return false;
    actionLock.current = true; setBusy(true); setActionError(undefined);
    try {
      if (action === 'delete') {
        await deleteAttachment(file);
        if (!lifetime.current.signal.aborted) onRemoved?.(file.id);
      } else if (action === 'retry-scan') {
        observe(await retryScanAttachment(file));
      } else {
        const url = await downloadUrl(file.id, lifetime.current.signal);
        if (!lifetime.current.signal.aborted) {
          const link = document.createElement('a');
          link.href = url; link.download = file.originalName; link.rel = 'noreferrer';
          document.body.append(link); link.click(); link.remove();
        }
      }
      return true;
    } catch (cause) { if (!lifetime.current.signal.aborted) { reportError(cause, action === 'download' ? 'read' : 'write'); setActionError(cause); } return false; }
    finally { actionLock.current = false; if (!lifetime.current.signal.aborted) { setBusy(false); refresh(); } }
  }
  const error = actionError ?? queryError;
  const errorText = error instanceof ApiError && error.code.startsWith('FILE_') ? '附件操作被拒绝，请检查权限、状态和文件内容'
    : error instanceof Error && error.message === 'FILE_SIZE_INVALID' ? '附件大小须为 1 字节至 25 MiB'
      : error instanceof Error && error.message === 'FILE_IMAGE_REQUIRED' ? (english ? 'Select a PNG or JPEG image.' : '请选择 PNG 或 JPEG 图片。')
        : error instanceof Error && error.message === 'FILE_SINGLE_REQUIRED' ? (english ? 'Drop one file at a time.' : '请每次拖放一个文件。') : safeAccountError(error);
  const status = (file: Attachment) => file.status === 'DELETED' ? '已删除，保留历史记录'
    : canDownloadAttachment(file) ? !standard ? '扫描通过，可作为证据' : canPreviewAttachment(file) ? (english ? 'Ready to preview' : '可预览') : (english ? 'Ready to download' : '可下载')
      : file.scanStatus === 'PENDING' ? '等待安全扫描'
        : file.scanStatus === 'WAITING_UPLOAD' ? '等待上传完成'
          : file.scanStatus === 'EXPIRED' ? '上传已过期'
            : file.scanStatus === 'ERROR' ? '扫描暂不可用，附件仍隔离' : '扫描未通过，附件已隔离';
  const blockedUpload = busy || retryAvailable || cameraOpen;
  const accept = imagesOnly ? '.png,.jpg,.jpeg' : '.pdf,.png,.jpg,.jpeg,.txt,.docx,.xlsx';
  const fileInput = <input ref={picker} aria-label={t('选择附件')} type="file" hidden={standard} disabled={blockedUpload} accept={accept} onChange={(event) => {
    const selected = event.target.files?.[0];
    event.target.value = '';
    if (selected) void upload(selected);
  }} />;
  const refreshButton = <Button aria-label={t('刷新附件')} onClick={refresh} disabled={loading} size={standard ? 'small' : undefined} icon={standard && <RefreshCw size={14} />}>{t('刷新附件')}</Button>;
  const showRetry = retryAvailable && !readOnly;
  const detachLabel = english ? 'Remove attachment from this item' : '从本项移除附件';
  const requiredTitle = english ? 'Completed items require an attachment' : '已完成事项必须保留附件';
  return <Card className={standard ? 'attachment-panel attachment-panel--standard' : 'attachment-panel'} title={imagesOnly ? (english ? 'Images' : '图片') : t(standard ? '附件' : '附件证据')} extra={standard ? refreshButton : undefined}>
    <Space orientation="vertical" size={6} style={{ width: '100%' }}>

      {error ? <Alert type="error" title={t(errorText)} description={error instanceof ApiError && error.traceId ? <code>{error.traceId}</code> : undefined} showIcon /> : null}
      {standard && !readOnly && <div role="group" aria-label={english ? 'Upload attachments' : '上传附件'} className={`attachment-panel__drop${dragging ? ' attachment-panel__drop--active' : ''}`}
        onDragOver={event => { event.preventDefault(); event.dataTransfer.dropEffect = blockedUpload ? 'none' : 'copy'; setDragging(!blockedUpload); }}
        onDragLeave={event => { if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) setDragging(false); }}
        onDrop={event => {
          event.preventDefault();
          setDragging(false);
          if (blockedUpload) return;
          const selected = event.dataTransfer.files;
          if (selected.length > 1) { setActionError(new Error('FILE_SINGLE_REQUIRED')); return; }
          if (selected[0]) void upload(selected[0]);
        }}>
        <Space wrap>
          {fileInput}
          <Button size="small" icon={<Paperclip size={14} />} disabled={blockedUpload} onClick={() => picker.current?.click()}>{t('选择附件')}</Button>
          <Button size="small" icon={<Camera size={14} />} disabled={blockedUpload} onClick={() => setCameraOpen(true)}>{english ? 'Take a photo' : '拍照上传'}</Button>
          <Typography.Text type="secondary">{english ? 'or drop a file here' : '或将文件拖到此处'}</Typography.Text>
        </Space>
      </div>}
      {(!standard || showRetry || busy) && <Space wrap>
        {!standard && !readOnly && <label className="attachment-panel__picker">{t('选择附件')} {fileInput}</label>}
        {!standard && refreshButton}
        {showRetry && <><Button onClick={() => void upload()} disabled={busy}>{t('重试上传')}</Button><Button onClick={() => { attempt.current = undefined; setRetryAvailable(false); }} disabled={busy}>{t('放弃重试')}</Button></>}
        {busy && <Spin aria-label={t('正在处理附件')} />}
      </Space>}
      {loading && !visible.length ? <Spin aria-label={t('正在加载附件')} /> : !error && !visible.length ? standard ? <Typography.Text type="secondary">{t('暂无附件')}</Typography.Text> : <Empty description={t('暂无附件')} /> : null}
      {visible.map((file) => <Card className="attachment-panel__file" key={file.id} size="small" title={standard && canPreviewAttachment(file) ?
        <Button className="attachment-panel__preview-link" type="link" size="small" disabled={busy} onClick={() => setPreview({ file, downloadUrl })}>{file.originalName}</Button> : file.originalName}>
        <Space wrap>
          <Tag color={file.status === 'AVAILABLE' && file.scanStatus === 'CLEAN' ? 'green' : 'orange'}>{t(status(file))}</Tag>
          <span>{new Intl.NumberFormat(locale).format(file.sizeBytes)} {t('字节')}</span>
          {file.status === 'AVAILABLE' && file.scanStatus === 'CLEAN' && <Button aria-label={t('下载附件')} disabled={busy} onClick={() => void operate(file, 'download')}>{t('下载附件')}</Button>}
          {!readOnly && (!standard || file.isCurrentUserUploader) && file.status === 'QUARANTINED' && file.scanStatus === 'ERROR' && <Button aria-label={t('重试安全扫描')} disabled={busy} onClick={() => void operate(file, 'retry-scan')}>{t('重试安全扫描')}</Button>}
          {!readOnly && onDetach && <Button disabled={busy || requiredFile(file)} title={requiredFile(file) ? requiredTitle : undefined} onClick={() => {
            setLocalIds(current => current.filter(id => id !== file.id));
            onDetach(file.id);
          }}>{detachLabel}</Button>}
          {!readOnly && !onDetach && file.status !== 'DELETED' && <Popconfirm title={`${t('删除附件')} · ${file.originalName}`} description={t('删除后无法继续下载，历史记录和保留对象不受影响。')} okText={t('确认删除附件')} cancelText={t('取消')} okButtonProps={{ danger: true }} disabled={requiredFile(file)} onConfirm={() => { if (!requiredFile(file)) void operate(file, 'delete'); }}>
            <Button aria-label={t('删除附件')} disabled={busy || requiredFile(file)} title={requiredFile(file) ? requiredTitle : undefined} danger>{t('删除附件')}</Button>
          </Popconfirm>}
        </Space>
      </Card>)}
    </Space>
    {standard && previewFile && <AttachmentPreviewDialog file={previewFile} downloadUrl={downloadUrl} downloading={busy} onDownload={() => operate(previewFile, 'download')} onClose={() => setPreview(undefined)} onDenied={reportError} />}
    {standard && !readOnly && cameraOpen && <AttachmentCameraDialog onClose={() => setCameraOpen(false)} onConfirm={photo => { setCameraOpen(false); void upload(photo); }} />}
  </Card>;
}
