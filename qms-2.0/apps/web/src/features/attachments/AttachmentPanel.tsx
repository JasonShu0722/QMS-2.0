import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Card, Empty, Popconfirm, Space, Spin, Tag, Typography } from 'antd';
import { ApiError, safeAccountError } from '../../api/client';
import { useLanguage } from '../../i18n/Language';
import { attachmentDownload, createUploadAttempt, deleteAttachment, readAttachment, retryScanAttachment, type Attachment, type FileResource } from './attachments';

import './attachments.css';

interface Props {
  resource: FileResource;
  fileIds: string[];
  readOnly?: boolean;
  onReady?: (file: Attachment) => void | boolean;
  onAccessDenied?: (cause: ApiError) => void;
  onPendingChange?: (pending: boolean) => void;
  onLocalPendingChange?: (pending: boolean) => void;
  onFilesChanged?: (files: Attachment[]) => void;
  onRemoved?: (id: string) => void;
}

export function AttachmentPanel(props: Props) {
  return <AttachmentContent key={`${props.resource.resourceType}:${props.resource.resourceId}`} {...props} />;
}

function AttachmentContent({ resource, fileIds, readOnly = false, onReady, onFilesChanged, onRemoved, onAccessDenied, onPendingChange, onLocalPendingChange }: Props) {
  const { t, locale } = useLanguage();
  const [localIds, setLocalIds] = useState<string[]>([]);
  const [files, setFiles] = useState<Record<string, Attachment>>({});
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(false);
  const [queryError, setQueryError] = useState<unknown>();
  const [actionError, setActionError] = useState<unknown>();
  const [busy, setBusy] = useState(false);
  const [retryAvailable, setRetryAvailable] = useState(false);
  const attempt = useRef<ReturnType<typeof createUploadAttempt> | undefined>(undefined);
  const actionLock = useRef(false);
  const lifetime = useRef(new AbortController());
  const [announced, setAnnounced] = useState(new Set<string>());
  const readyCallback = useRef(onReady);
  readyCallback.current = onReady;
  const filesChangedCallback = useRef(onFilesChanged);
  filesChangedCallback.current = onFilesChanged;
  const deniedCallback = useRef(onAccessDenied);
  deniedCallback.current = onAccessDenied;
  function reportError(cause: unknown) {
    if (cause instanceof ApiError && (cause.status === 401 || cause.status === 403)) deniedCallback.current?.(cause);
  }
  const idsKey = [...new Set([...fileIds, ...localIds])].sort().join(',');
  const ids = idsKey ? idsKey.split(',') : [];
  const visible = ids.flatMap((id) => files[id] ? [files[id]!] : []);
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
    if (actionLock.current || readOnly) return;
    actionLock.current = true; setBusy(true); setActionError(undefined); setRetryAvailable(false);
    try {
      if (selected) attempt.current = createUploadAttempt(resource, selected);
      if (!attempt.current) return;
      await attempt.current.run(observe, lifetime.current.signal);
      attempt.current = undefined;
    } catch (cause) {
      if (!lifetime.current.signal.aborted) { reportError(cause); setActionError(cause); setRetryAvailable(true); }
    } finally {
      actionLock.current = false;
      if (!lifetime.current.signal.aborted) { setBusy(false); refresh(); }
    }
  }
  async function operate(file: Attachment, action: 'download' | 'delete' | 'retry-scan') {
    if (actionLock.current) return;
    actionLock.current = true; setBusy(true); setActionError(undefined);
    try {
      if (action === 'delete') {
        await deleteAttachment(file);
        if (!lifetime.current.signal.aborted) onRemoved?.(file.id);
      } else if (action === 'retry-scan') {
        observe(await retryScanAttachment(file));
      } else {
        const url = await attachmentDownload(file.id);
        if (!lifetime.current.signal.aborted) {
          const link = document.createElement('a');
          link.href = url; link.download = file.originalName; link.rel = 'noreferrer';
          document.body.append(link); link.click(); link.remove();
        }
      }
    } catch (cause) { if (!lifetime.current.signal.aborted) { reportError(cause); setActionError(cause); } }
    finally { actionLock.current = false; if (!lifetime.current.signal.aborted) { setBusy(false); refresh(); } }
  }
  const error = actionError ?? queryError;
  const errorText = error instanceof ApiError && error.code.startsWith('FILE_') ? '附件操作被拒绝，请检查权限、状态和文件内容'
    : error instanceof Error && error.message === 'FILE_SIZE_INVALID' ? '附件大小须为 1 字节至 25 MiB' : safeAccountError(error);
  const status = (file: Attachment) => file.status === 'DELETED' ? '已删除，保留历史记录'
    : file.status === 'AVAILABLE' && file.scanStatus === 'CLEAN' ? '扫描通过，可作为证据'
      : file.scanStatus === 'PENDING' ? '等待安全扫描'
        : file.scanStatus === 'WAITING_UPLOAD' ? '等待上传完成'
          : file.scanStatus === 'EXPIRED' ? '上传已过期'
            : file.scanStatus === 'ERROR' ? '扫描暂不可用，附件仍隔离' : '扫描未通过，附件已隔离';
  return <Card className="attachment-panel" title={t('附件证据')}>
    <Space orientation="vertical" size={6} style={{ width: '100%' }}>
      <Typography.Paragraph>{t('附件上传后先隔离，通过安全扫描后才可下载和提交为证据。')}</Typography.Paragraph>
      {error ? <Alert type="error" title={t(errorText)} description={error instanceof ApiError && error.traceId ? <code>{error.traceId}</code> : undefined} showIcon /> : null}
      <Space wrap>
        {!readOnly && <label className="attachment-panel__picker">{t('选择附件')} <input aria-label={t('选择附件')} type="file" disabled={busy || retryAvailable} accept=".pdf,.png,.jpg,.jpeg,.txt,.docx,.xlsx" onChange={(event) => { const selected = event.target.files?.[0]; event.target.value = ''; if (selected) void upload(selected); }} /></label>}
        <Button aria-label={t('刷新附件')} onClick={refresh} disabled={loading}>{t('刷新附件')}</Button>
        {retryAvailable && !readOnly && <><Button onClick={() => void upload()} disabled={busy}>{t('重试上传')}</Button><Button onClick={() => { attempt.current = undefined; setRetryAvailable(false); }} disabled={busy}>{t('放弃重试')}</Button></>}
        {busy && <Spin aria-label={t('正在处理附件')} />}
      </Space>
      {loading && !visible.length ? <Spin aria-label={t('正在加载附件')} /> : !error && !visible.length ? <Empty description={t('暂无附件')} /> : null}
      {visible.map((file) => <Card className="attachment-panel__file" key={file.id} size="small" title={file.originalName}>
        <Space wrap>
          <Tag color={file.status === 'AVAILABLE' && file.scanStatus === 'CLEAN' ? 'green' : 'orange'}>{t(status(file))}</Tag>
          <span>{new Intl.NumberFormat(locale).format(file.sizeBytes)} {t('字节')}</span>
          {file.status === 'AVAILABLE' && file.scanStatus === 'CLEAN' && <Button aria-label={t('下载附件')} disabled={busy} onClick={() => void operate(file, 'download')}>{t('下载附件')}</Button>}
          {!readOnly && file.status === 'QUARANTINED' && file.scanStatus === 'ERROR' && <Button aria-label={t('重试安全扫描')} disabled={busy} onClick={() => void operate(file, 'retry-scan')}>{t('重试安全扫描')}</Button>}
          {!readOnly && file.status !== 'DELETED' && <Popconfirm title={t('确认删除此附件？')} description={t('删除后无法继续下载，历史记录和保留对象不受影响。')} okText={t('确认删除附件')} cancelText={t('取消')} onConfirm={() => operate(file, 'delete')}>
            <Button aria-label={t('删除附件')} disabled={busy} danger>{t('删除附件')}</Button>
          </Popconfirm>}
        </Space>
      </Card>)}
    </Space>
  </Card>;
}
