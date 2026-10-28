import { useEffect, useState } from 'react';
import { Alert, Button, Spin } from 'antd';
import type { components } from '@qms/contracts';
import { AttachmentPanel } from '../attachments/AttachmentPanel';
import { useEightDEvidenceScope } from '../process-eight-d/EightDEvidenceScope';
import { aborted, useEightDText, type EightDRead } from '../process-eight-d/eight-d';
import type { SupplierReport } from './supplier-eight-d';
import styles from './supplier-eight-d.module.css';

type FileDto = components['schemas']['FileDto'];
export function SupplierDisclosedAttachments({ report, base, read }: { report: SupplierReport; base: string; read: EightDRead }) {
  const text = useEightDText();
  const scope = useEightDEvidenceScope();
  const [retry, setRetry] = useState(0);
  const [result, setResult] = useState<{ key: string; files?: FileDto[]; error?: boolean }>();
  const key = JSON.stringify([base, report.rowVersion, report.releasedToSupplierAt, retry]);
  const value = result?.key === key ? result : undefined;
  useEffect(() => {
    const controller = new AbortController();
    read<FileDto[]>(`${base}/disclosure-attachments`, { signal: controller.signal }).then(files => {
      if (controller.signal.aborted) return;
      if (!Array.isArray(files)) throw new Error('INVALID_DISCLOSURE_ATTACHMENTS');
      setResult({ key, files });
    }).catch(cause => {
      if (!controller.signal.aborted && !aborted(cause)) setResult({ key, error: true });
    });
    return () => controller.abort();
  }, [base, key, read]);
  return <section className={styles.section} aria-label={text('已披露附件', 'Disclosed attachments')}>
    <h3>{text('已披露附件', 'Disclosed attachments')}</h3>
    {value?.error ? <Alert type="error" title={text('已披露附件读取失败，请重试。', 'Disclosed attachments could not be loaded. Retry.')} action={<Button onClick={() => setRetry(n => n + 1)}>{text('重试已披露附件', 'Retry disclosed attachments')}</Button>} />
      : value?.files ? <AttachmentPanel key={key} resource={{ resourceType: 'supplier-eight-d-disclosure', resourceId: report.supplierProblemId }} fileIds={value.files.map(file => file.id)} readOnly onAccessDenied={scope.onAccessDenied} onPendingChange={scope.onPendingChange} />
        : <Spin aria-label={text('正在加载已披露附件', 'Loading disclosed attachments')} />}
  </section>;
}
