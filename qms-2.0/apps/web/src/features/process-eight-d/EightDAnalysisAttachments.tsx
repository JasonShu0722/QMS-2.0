import { useCallback, useRef } from 'react';
import type { components } from '@qms/contracts';
import { AttachmentPanel } from '../attachments/AttachmentPanel';
import { fileUrl, type FileResource } from '../attachments/attachments';
import { useEightDEvidenceScope } from './EightDEvidenceScope';
import type { EightDRead } from './eight-d';

interface Props {
  resource: FileResource;
  fileIds: string[];
  readOnly: boolean;
  read: EightDRead;
  onChange: (apply: (current: string[]) => string[]) => void;
}

export function EightDAnalysisAttachments(props: Props) {
  return <AnalysisAttachments key={`${props.resource.resourceType}:${props.resource.resourceId}`} {...props} />;
}

function AnalysisAttachments({ resource, fileIds, readOnly, read, onChange }: Props) {
  const scope = useEightDEvidenceScope();
  const revoked = useRef(false);
  const downloadUrl = useCallback(async (id: string, signal: AbortSignal) => {
    const result = await read<components['schemas']['FileDownloadDto']>(`/api/v1/files/${encodeURIComponent(id)}/download`, { method: 'POST', body: '{}', signal });
    signal.throwIfAborted();
    return fileUrl(result.url);
  }, [read]);

  return <AttachmentPanel variant="standard" resource={resource} fileIds={fileIds} readOnly={readOnly || revoked.current}
    downloadUrl={downloadUrl} onPendingChange={scope.onPendingChange} onAccessDenied={cause => {
      revoked.current = true;
      scope.onAccessDenied?.(cause);
    }} onReady={file => {
      if (readOnly || revoked.current) return false;
      if (!fileIds.includes(file.id)) onChange(current => current.includes(file.id) ? current : [...current, file.id]);
      return true;
    }} onRemoved={id => {
      if (!readOnly && !revoked.current) onChange(current => current.filter(fileId => fileId !== id));
    }} />;
}
