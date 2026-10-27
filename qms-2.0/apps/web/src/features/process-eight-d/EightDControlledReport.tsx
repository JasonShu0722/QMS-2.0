import { useEffect, useState } from 'react';
import { Alert, Button, Space, Spin, Tag } from 'antd';
import type { components } from '@qms/contracts';
import { AttachmentPanel } from '../attachments/AttachmentPanel';
import { EightDDocumentEditor, EightDField } from './EightDDocumentEditor';
import { useEightDEvidenceScope } from './EightDEvidenceScope';
import { aborted, eightDPath, useEightDText, type EightDRead, type EightDReport } from './eight-d';
import styles from './eight-d.module.css';
import { eightDDomain, type InternalEightDDomain } from '../internal-eight-d/domain';
import { InternalEightDSourceFacts } from '../internal-eight-d/InternalEightDSourceFacts';

type Controlled = components['schemas']['ProcessEightDControlledReportDto'];
export function EightDControlledReport({ report, read, download, domain = 'process' }: { report: EightDReport; domain?: InternalEightDDomain; read: EightDRead; download: (path: string) => Promise<void> }) {
  const text = useEightDText();
  const evidenceScope = useEightDEvidenceScope();
  const [selection, setSelection] = useState('CURRENT');
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState<{ path: string; version: number; report: Controlled }>();
  const [error, setError] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const query = new URLSearchParams({ organizationId: report.organizationId });
  if (selection === 'CURRENT' || selection === 'APPROVED') query.set('view', selection); else query.set('revisionId', selection);
  const path = `${eightDPath(report.problemId, domain)}/report?${query}`;
  const controlled = state?.path === path && state.version === report.version ? state.report : undefined;
  useEffect(() => {
    let active = true; setError(false); setState(undefined);
    read<Controlled>(path).then(value => { if (active) setState({ path, version: report.version, report: value }); }).catch(cause => { if (active && !aborted(cause)) setError(true); });
    return () => { active = false; };
  }, [path, read, revision, report.version]);
  return <div className={styles.modal}>
    <Space wrap><EightDField label={text('报告版本', 'Report version')}><select value={selection} disabled={downloading} onChange={event => setSelection(event.target.value)}><option value="CURRENT">{text('当前保存版 CURRENT', 'Current saved version CURRENT')}</option><option value="APPROVED">{text('批准版 APPROVED', 'Approved version APPROVED')}</option>{report.revisions.map(item => <option key={item.id} value={item.id}>{text('历史版', 'Historical')} · v{item.contentVersion} · {item.recordedAt}</option>)}</select></EightDField>
      <Button onClick={() => setRevision(value => value + 1)} disabled={downloading}>{text('刷新报告', 'Refresh report')}</Button>
      <Button disabled={!controlled || downloading} loading={downloading} onClick={() => {
        setDownloading(true); setError(false);
        void download(`${eightDPath(report.problemId, domain)}/report/pdf?${query}`).catch(cause => { if (!aborted(cause)) setError(true); }).finally(() => setDownloading(false));
      }}>{text('授权下载 PDF', 'Download authorized PDF')}</Button>
    </Space>
    <Alert type="info" title={text('报告来自服务端保存版本，不包含未保存草稿；批准版不随关闭后来源补充改变。', 'Reports use server-saved versions, not unsaved drafts. Source supplements after closure do not change the approved version.')} />
    {error ? <Alert type="error" title={text('报告读取或下载失败，请检查权限与版本后刷新。', 'Report reading or download failed. Check access and version, then refresh.')} /> : !controlled ? <Spin /> : <>
      <header><h2>{controlled.reportNumber}</h2><Tag>{controlled.label}</Tag><p>{controlled.view} · {text('内容版本', 'Content version')} {controlled.contentVersion} · {text('记录版本', 'Row version')} {controlled.rowVersion} · {controlled.generatedAt}</p></header>
      <EightDDocumentEditor problemId={report.problemId} domain={domain} anchorId={`${report.problemId}-report`} document={controlled.snapshot.document} disabled read={read} onChange={() => {}} />
      <InternalEightDSourceFacts domain={domain} sources={controlled.snapshot.sources} />
      <details className={styles.section}><summary>{text('报告来源快照备查', 'Raw report source snapshots')}</summary>{controlled.snapshot.sources.map(source => <div key={source.sourceId}><strong>{source.sourceId}</strong> · v{source.sourceVersion}<pre className={styles.pre}>{JSON.stringify(source.sourceSnapshot, null, 2)}</pre></div>)}</details>
      <section className={styles.section}><h3>{text('版本附件', 'Version attachments')}</h3>{controlled.attachments.map(file => <p key={file.id}>{file.originalName} · {file.rendering} · {file.note} · {file.uses.join(', ')}</p>)}<AttachmentPanel resource={{ resourceType: eightDDomain(domain).resourceType, resourceId: report.problemId }} fileIds={controlled.attachments.map(file => file.id)} readOnly onAccessDenied={evidenceScope.onAccessDenied} onPendingChange={evidenceScope.onPendingChange} /></section>
      <details><summary>{text('报告绑定的批准与轮次快照', 'Approval and round snapshot bound to this report')}</summary><pre className={styles.pre}>{JSON.stringify({ approval: controlled.snapshot.approval, approvalRounds: controlled.snapshot.approvalRounds }, null, 2)}</pre></details>
    </>}
  </div>;
}
