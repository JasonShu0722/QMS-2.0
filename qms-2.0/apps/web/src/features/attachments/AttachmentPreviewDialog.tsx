import { useEffect, useState } from 'react';
import { Alert, Button, Modal, Spin } from 'antd';
import { ApiError } from '../../api/client';
import { useLanguage } from '../../i18n/Language';
import { readAttachmentPreview, type Preview } from './attachment-preview';
import type { Attachment } from './attachments';

function previewFailureMessage(cause: unknown, english: boolean) {
  if (cause instanceof ApiError && (cause.status === 401 || cause.status === 403)) {
    return english ? 'You no longer have access to this attachment.' : '当前无权访问此附件。';
  }
  if (cause instanceof Error) {
    switch (cause.message) {
      case 'PREVIEW_RESPONSE_INVALID':
        return english ? 'The file could not be read from storage.' : '无法从存储读取文件。';
      case 'PREVIEW_METADATA_INVALID':
      case 'PREVIEW_SIZE_MISMATCH':
      case 'PREVIEW_HASH_MISMATCH':
      case 'PREVIEW_SIGNATURE_INVALID':
        return english ? 'File verification failed.' : '文件校验未通过。';
    }
  }
  return english ? 'The file could not be read or its format could not be parsed.' : '无法读取文件或解析其格式。';
}

export function AttachmentPreviewDialog({ file, downloading, onDownload, onClose, onDenied }: {
  file: Attachment;
  downloading: boolean;
  onDownload: () => Promise<boolean>;
  onClose: () => void;
  onDenied: (cause: ApiError) => void;
}) {
  const { t, locale } = useLanguage();
  const english = locale === 'en-US';
  const [result, setResult] = useState<Preview & { url?: string }>();
  const [failure, setFailure] = useState<{ cause: unknown }>();
  const [downloadFailed, setDownloadFailed] = useState(false);
  const [mediaFailed, setMediaFailed] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    let url: string | undefined;
    void readAttachmentPreview(file, controller.signal).then(preview => {
      if (controller.signal.aborted) return;
      if ('blob' in preview) url = URL.createObjectURL(preview.blob);
      setResult({ ...preview, url });
    }).catch(cause => {
      if (controller.signal.aborted) return;
      setFailure({ cause });
      if (cause instanceof ApiError && (cause.status === 401 || cause.status === 403)) onDenied(cause);
    });
    return () => {
      controller.abort();
      if (url) URL.revokeObjectURL(url);
    };
  }, [file, onDenied]);

  const cannotDisplay = mediaFailed || (result?.kind === 'pdf' && navigator.pdfViewerEnabled === false);
  const failureDetail = failure ? previewFailureMessage(failure.cause, english)
    : cannotDisplay ? (english ? 'The browser could not display this attachment.' : '浏览器无法显示此附件。') : undefined;

  return <Modal open title={file.originalName} onCancel={onClose} width="min(920px, 95vw)" footer={[
    <Button key="download" loading={downloading} onClick={async () => setDownloadFailed(!await onDownload())}>{t('下载附件')}</Button>,
    <Button key="close" onClick={onClose}>{t('关闭')}</Button>,
  ]}>
    {!result && !failure && <Spin aria-label={english ? 'Loading preview' : '正在加载预览'} />}
    {failureDetail && <Alert showIcon type="warning" title={english ? 'This file could not be previewed. Download it to view the original.' : '此附件无法预览，可下载原文件查看。'} description={failureDetail} />}
    {downloadFailed && <Alert showIcon type="error" title={english ? 'Download failed. Check access and try again.' : '下载失败，请检查权限后重试。'} />}
    {result && 'truncated' in result && (result.truncated || result.kind === 'word' || result.kind === 'sheet') && <p className="attachment-preview__note">
      {result.kind === 'word' && (english ? 'Word body text preview.' : 'Word 正文预览。')}
      {result.kind === 'sheet' && (english ? 'First worksheet. Numbers and dates show their raw cell values.' : '首个工作表预览，数字和日期按单元格原始值显示。')}
      {result.truncated && (english ? ' Download the original to view all content.' : ' 内容较长，下载原文件查看完整内容。')}
    </p>}
    {result?.kind === 'image' && !mediaFailed && <img className="attachment-preview__image" src={result.url} alt={file.originalName} onError={() => setMediaFailed(true)} />}
    {result?.kind === 'pdf' && <>
      <p className="attachment-preview__note"><a href={result.url} target="_blank" rel="noopener noreferrer">{english ? 'Open PDF in a new window' : '在新窗口预览 PDF'}</a></p>
      {!cannotDisplay && <iframe className="attachment-preview__pdf" title={file.originalName} src={result.url} referrerPolicy="no-referrer" />}
    </>}
    {(result?.kind === 'text' || result?.kind === 'word') && <pre className="attachment-preview__text">{result.text || (english ? 'No text to preview' : '无可预览正文')}</pre>}
    {result?.kind === 'sheet' && <div className="attachment-preview__sheet">
      {result.rows.length ? <table aria-label={english ? 'Worksheet preview' : '工作表预览'}><tbody>{result.rows.map((row, index) => <tr key={index}>
        <th scope="row">{index + 1}</th>{Array.from(row, (cell, column) => <td key={column}>{cell}</td>)}
      </tr>)}</tbody></table> : <p>{english ? 'No cells to preview' : '无可预览单元格'}</p>}
    </div>}
  </Modal>;
}
