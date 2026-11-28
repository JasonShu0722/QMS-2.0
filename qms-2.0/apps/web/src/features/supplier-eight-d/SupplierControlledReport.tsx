import { useEffect, useState } from 'react';
import { Alert, Button, Spin } from 'antd';
import type { components } from '@qms/contracts';
import { ApiError } from '../../api/client';
import { EightDField } from '../process-eight-d/EightDDocumentEditor';
import { EightDReportDocument, ReportApproval, ReportCover, ReportFacts, ReportSources, matchesReportSelection } from '../process-eight-d/EightDControlledReport';
import { useEightDEvidenceScope } from '../process-eight-d/EightDEvidenceScope';
import { aborted, useEightDText, type EightDRead } from '../process-eight-d/eight-d';
import styles from '../process-eight-d/controlled-report.module.css';
import type { SupplierReport } from './supplier-eight-d';

type Controlled = components['schemas']['SupplierEightDControlledReportDto'];
type RevisionPage = components['schemas']['SupplierEightDRevisionPageDto'];
export function SupplierControlledReport({ report, base, portal, read }: { report: SupplierReport; base: string; portal: boolean; read: EightDRead }) {
  const text = useEightDText();
  const scope = useEightDEvidenceScope();
  const pdfScope = useEightDEvidenceScope();
  const [selection, setSelection] = useState('CURRENT');
  const [value, setValue] = useState<{ key: string; report?: Controlled }>();
  const [downloadFailure, setDownloadFailure] = useState<{ key: string; conflict: boolean }>();
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const [history, setHistory] = useState<{ scope: string; items: RevisionPage['items']; nextBefore: number | null }>();
  const [cursor, setCursor] = useState<{ scope: string; before: number }>();
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState(false);
  const [historyRetry, setHistoryRetry] = useState(0);
  const query = new URLSearchParams();
  if (selection === 'CURRENT' || selection === 'APPROVED') query.set('view', selection); else query.set('revisionId', selection);
  const path = `${base}/report?${query}`;
  const requestKey = JSON.stringify([path, report.rowVersion, report.problemId, report.supplierProblemId, portal, revision]);
  const loaded = value?.key === requestKey ? value : undefined;
  const controlled = loaded?.report;
  const failure = downloadFailure?.key === requestKey ? downloadFailure : undefined;
  const fingerprint = controlled?.previewFingerprint;
  const snapshot = controlled?.snapshot;
  const problem = snapshot?.problem ?? {};
  const historyScope = JSON.stringify([base, report.rowVersion]);
  useEffect(() => { setSelection('CURRENT'); }, [historyScope]);
  const before = cursor?.scope === historyScope ? cursor.before : undefined;
  const revisions = history?.scope === historyScope ? history.items : [];
  const nextBefore = history?.scope === historyScope ? history.nextBefore : null;
  useEffect(() => {
    const controller = new AbortController(); setHistoryLoading(true); setHistoryError(false);
    const query = new URLSearchParams({ pageSize: '20' });
    if (before !== undefined) query.set('before', String(before));
    read<RevisionPage>(`${base}/revisions?${query}`, { signal: controller.signal }).then(page => {
      if (controller.signal.aborted) return;
      if (!Array.isArray(page.items) || page.nextBefore !== null && (!Number.isSafeInteger(page.nextBefore) || page.nextBefore < 1 || before !== undefined && page.nextBefore >= before)) throw new Error('INVALID_REVISION_PAGE');
      setHistory(previous => ({ scope: historyScope, items: before !== undefined && previous?.scope === historyScope
        ? [...previous.items, ...page.items.filter(item => !previous.items.some(old => old.id === item.id))] : page.items, nextBefore: page.nextBefore }));
    }).catch(cause => { if (!controller.signal.aborted && !aborted(cause)) setHistoryError(true); })
      .finally(() => { if (!controller.signal.aborted) setHistoryLoading(false); });
    return () => controller.abort();
  }, [base, read, historyScope, before, historyRetry]);
  useEffect(() => {
    const controller = new AbortController(); setDownloadFailure(undefined); setValue(undefined);
    read<Controlled>(path, { signal: controller.signal }).then(result => {
      if (controller.signal.aborted) return;
      if (result.supplierProblemId !== report.supplierProblemId || result.problemId !== report.problemId || portal && result.status === 'CLOSED_SUPPLEMENT') {
        scope.onAccessDenied?.(new ApiError({ code: 'REPORT_SCOPE_DENIED', message: 'Report scope mismatch' }, 403));
        setValue({ key: requestKey });
        return;
      }
      setValue({ key: requestKey, report: matchesReportSelection(result, selection, portal) ? result : undefined });
    }).catch(cause => { if (!controller.signal.aborted && !aborted(cause)) setValue({ key: requestKey }); });
    return () => controller.abort();
  }, [path, read, report.supplierProblemId, report.problemId, portal, requestKey, scope.onAccessDenied, selection]);
  useEffect(() => { pdfScope.onPendingChange(busy); }, [busy, pdfScope.onPendingChange]);
  async function download() {
    if (busy || !controlled || !fingerprint || failure?.conflict) return;
    setBusy(true); setDownloadFailure(undefined);
    try {
      const pdfQuery = new URLSearchParams(query);
      pdfQuery.set('previewFingerprint', fingerprint);
      const bytes = await read<ArrayBuffer>(`${base}/report/pdf?${pdfQuery}`, { headers: { Accept: 'application/pdf' } });
      const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
      try { const link = document.createElement('a'); link.href = url; link.download = `${controlled.reportNumber}.pdf`; document.body.append(link); link.click(); link.remove(); }
      finally { URL.revokeObjectURL(url); }
    } catch (cause) {
      if (!aborted(cause)) setDownloadFailure({ key: requestKey, conflict: cause instanceof ApiError && cause.status === 409 });
    }
    finally { setBusy(false); }
  }
  return <div className={styles.preview}>
    <div className={styles.toolbar}>
    <EightDField label={text('报告版本', 'Report version')}><select disabled={busy} value={selection} onChange={event => setSelection(event.target.value)}><option value="CURRENT">{text('当前保存版 CURRENT', 'Current saved version CURRENT')}</option><option value="APPROVED">{text('批准版 APPROVED', 'Approved version APPROVED')}</option>{revisions.map(item => <option key={item.id} value={item.id}>{text('历史修订', 'Historical revision')} · {item.revision} · {item.createdAt}{item.approved ? ` · ${text('批准依据', 'Approved basis')}` : ''}</option>)}</select></EightDField>
    {historyLoading && <Spin aria-label={text('正在加载历史版本', 'Loading historical revisions')} />}
    {historyError && <Alert type="error" title={text('历史版本加载失败，已加载记录保留。', 'History loading failed. Previously loaded revisions are retained.')} action={<Button disabled={busy || historyLoading} onClick={() => setHistoryRetry(value => value + 1)}>{text('重试历史版本', 'Retry historical revisions')}</Button>} />}
    {!historyError && nextBefore !== null && <Button disabled={busy || historyLoading} onClick={() => setCursor({ scope: historyScope, before: nextBefore })}>{text('加载更多历史版本', 'Load more historical revisions')}</Button>}
    <Button disabled={busy} onClick={() => setRevision(n => n + 1)}>{text('刷新报告', 'Refresh report')}</Button><Button disabled={!fingerprint || busy || failure?.conflict} loading={busy} onClick={() => void download()}>{text('授权下载 PDF', 'Download authorized PDF')}</Button>
    </div>
    {failure && <Alert type="error" title={failure.conflict ? text('报告版本已变化，请刷新预览后下载。', 'The report changed. Refresh the preview before downloading.') : text('报告读取或下载失败，请检查版本与权限后刷新。', 'Report read or download failed. Check the version and permissions.')} />}
    {!loaded ? <Spin aria-label={text('正在加载报告预览', 'Loading report preview')} /> : !controlled ? <Alert type="error" title={text('报告读取或下载失败，请检查版本与权限后刷新。', 'Report read or download failed. Check the version and permissions.')} /> : <article className={styles.article} aria-label={controlled.reportNumber}>
      <ReportCover report={controlled} title={controlled.snapshot.document.title || (typeof problem.title === 'string' && problem.title) || controlled.reportNumber} severity={problem.severity ?? snapshot?.severity} />
      <section aria-label={text('所选版本基础事实', 'Selected version facts')}>
        <h3>{text('基础事实', 'Basic facts')}</h3>
        <ReportFacts entries={[
          [text('物料编码', 'Material code'), problem.materialCode], [text('物料类别', 'Material category'), problem.materialCategory],
          [text('不良描述', 'Defect description'), problem.defectDescription], [text('不良数量', 'Defect quantity'), problem.defectQuantity],
          [text('发起时间', 'Created at'), problem.createdAt],
        ]} />
      </section>
      {[controlled.snapshot.deadlines.analysisDueAt, controlled.snapshot.analysisCompletedAt, controlled.snapshot.deadlines.submissionDueAt,
        controlled.snapshot.submittedAt, controlled.snapshot.deadlines.closureDueAt, problem.closedAt].some(Boolean) && <section aria-label={text('所选版本阶段时间', 'Selected version stage dates')}>
        <h3>{text('阶段计划与实际时间', 'Planned and actual stage dates')}</h3>
        <ReportFacts entries={[
          [text('分析计划', 'Analysis due'), controlled.snapshot.deadlines.analysisDueAt], [text('分析完成', 'Analysis completed'), controlled.snapshot.analysisCompletedAt],
          [text('完整提交计划', 'Submission due'), controlled.snapshot.deadlines.submissionDueAt], [text('完整提交时间', 'Submitted at'), controlled.snapshot.submittedAt],
          [text('关闭计划', 'Closure due'), controlled.snapshot.deadlines.closureDueAt], [text('实际关闭时间', 'Closed at'), problem.closedAt],
        ]} />
      </section>}
      {!portal && <ReportSources sources={controlled.snapshot.sources} />}
      <EightDReportDocument document={controlled.snapshot.document} attachments={controlled.attachments} />
      <ReportApproval report={controlled} portal={portal} />
      {!portal && controlled.status === 'CLOSED_SUPPLEMENT' && <section aria-label={text('内部补充版本说明', 'Internal supplement version notice')}>
        <p>{text('关闭后内部补充，非原批准版，不对供应商公开。', 'Post-closure internal supplement, not the original approved version and not public to suppliers.')}</p>
        <ReportFacts entries={[[text('补充更新时间', 'Supplement updated at'), problem.supplementUpdatedAt]]} />
      </section>}
    </article>}
  </div>;
}
