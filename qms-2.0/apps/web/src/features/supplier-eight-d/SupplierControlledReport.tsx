import { useEffect, useState } from 'react';
import { Alert, Button, Spin, Tag } from 'antd';
import type { components } from '@qms/contracts';
import { ApiError } from '../../api/client';
import { AttachmentPanel } from '../attachments/AttachmentPanel';
import { EightDDocumentEditor, EightDField } from '../process-eight-d/EightDDocumentEditor';
import { useEightDEvidenceScope } from '../process-eight-d/EightDEvidenceScope';
import { aborted, useEightDText, type EightDRead } from '../process-eight-d/eight-d';
import type { SupplierReport } from './supplier-eight-d';

type Controlled = components['schemas']['SupplierEightDControlledReportDto'];
type RevisionPage = components['schemas']['SupplierEightDRevisionPageDto'];
function metadata(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
export function SupplierControlledReport({ report, base, portal, read }: { report: SupplierReport; base: string; portal: boolean; read: EightDRead }) {
  const text = useEightDText();
  const scope = useEightDEvidenceScope();
  const pdfScope = useEightDEvidenceScope();
  const [selection, setSelection] = useState('CURRENT');
  const [value, setValue] = useState<{ path: string; rowVersion: number; report: Controlled }>();
  const [error, setError] = useState(false);
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
  const controlled = value?.path === path && value.rowVersion === report.rowVersion ? value.report : undefined;
  const snapshot = controlled?.snapshot;
  const problem = snapshot?.problem ?? {};
  const rounds = snapshot?.approvalRounds ?? (snapshot?.approval ? [snapshot.approval] : []);
  const show = (value: unknown) => typeof value === 'string' && value !== '' || typeof value === 'number' && Number.isFinite(value) ? String(value) : text('未记录', 'Not recorded');
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
    const controller = new AbortController(); setError(false); setValue(undefined);
    read<Controlled>(path, { signal: controller.signal }).then(result => {
      if (controller.signal.aborted) return;
      if (result.supplierProblemId !== report.supplierProblemId || result.problemId !== report.problemId || portal && result.status === 'CLOSED_SUPPLEMENT') { scope.onAccessDenied?.(new ApiError({ code: 'REPORT_SCOPE_DENIED', message: 'Report scope mismatch' }, 403)); return; }
      setValue({ path, rowVersion: report.rowVersion, report: result });
    }).catch(cause => { if (!controller.signal.aborted && !aborted(cause)) setError(true); });
    return () => controller.abort();
  }, [path, read, report.rowVersion, report.supplierProblemId, report.problemId, portal, revision, scope.onAccessDenied]);
  useEffect(() => { pdfScope.onPendingChange(busy); }, [busy, pdfScope.onPendingChange]);
  async function download() {
    if (busy || !controlled) return;
    setBusy(true); setError(false);
    try {
      const bytes = await read<ArrayBuffer>(`${base}/report/pdf?${query}`, { headers: { Accept: 'application/pdf' } });
      const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
      try { const link = document.createElement('a'); link.href = url; link.download = `${report.reportNumber}.pdf`; document.body.append(link); link.click(); link.remove(); }
      finally { URL.revokeObjectURL(url); }
    } catch (cause) { if (!aborted(cause)) setError(true); }
    finally { setBusy(false); }
  }
  return <>
    <h3>{text('受控报告与历史', 'Controlled reports and history')}</h3>
    <EightDField label={text('报告版本', 'Report version')}><select disabled={busy} value={selection} onChange={event => setSelection(event.target.value)}><option value="CURRENT">{text('当前保存版 CURRENT', 'Current saved version CURRENT')}</option><option value="APPROVED">{text('批准版 APPROVED', 'Approved version APPROVED')}</option>{revisions.map(item => <option key={item.id} value={item.id}>{text('历史修订', 'Historical revision')} · {item.revision} · {item.createdAt}{item.approved ? ` · ${text('批准依据', 'Approved basis')}` : ''}</option>)}</select></EightDField>
    {historyLoading && <Spin aria-label={text('正在加载历史版本', 'Loading historical revisions')} />}
    {historyError && <Alert type="error" title={text('历史版本加载失败，已加载记录保留。', 'History loading failed. Previously loaded revisions are retained.')} action={<Button disabled={busy || historyLoading} onClick={() => setHistoryRetry(value => value + 1)}>{text('重试历史版本', 'Retry historical revisions')}</Button>} />}
    {!historyError && nextBefore !== null && <Button disabled={busy || historyLoading} onClick={() => setCursor({ scope: historyScope, before: nextBefore })}>{text('加载更多历史版本', 'Load more historical revisions')}</Button>}
    <Button disabled={busy} onClick={() => setRevision(n => n + 1)}>{text('刷新报告', 'Refresh report')}</Button><Button disabled={!controlled || busy} loading={busy} onClick={() => void download()}>{text('授权下载 PDF', 'Download authorized PDF')}</Button>
    <p>{text('报告只含服务端已保存内容。原批准依据保持固定，当前内部补充不向供应商公开。', 'Reports contain server-saved content only. The approved basis is immutable; current internal supplements are not public to suppliers.')}</p>
    {error ? <Alert type="error" title={text('报告读取或下载失败，请检查版本与权限后刷新。', 'Report read or download failed. Check the version and permissions.')} /> : !controlled ? <Spin /> : <>
      <h4>{controlled.reportNumber} · <Tag>{controlled.label}</Tag></h4><p>{controlled.generatedAt} · v{controlled.contentVersion}</p>
      <section aria-label={text('所选版本基础事实', 'Selected version facts')}>
        <h4>{text('基础事实', 'Basic facts')}</h4>
        <dl style={{ overflowWrap: 'anywhere' }}>{[
          [text('报告单号', 'Report number'), problem.reportNumber], [text('标题', 'Title'), problem.title],
          [text('物料编码', 'Material code'), problem.materialCode], [text('物料类别', 'Material category'), problem.materialCategory],
          [text('不良描述', 'Defect description'), problem.defectDescription], [text('不良数量', 'Defect quantity'), problem.defectQuantity],
          [text('风险等级', 'Severity'), problem.severity], [text('创建时间', 'Created at'), problem.createdAt],
        ].map(([label, value]) => <div key={String(label)}><dt>{String(label)}</dt><dd>{show(value)}</dd></div>)}</dl>
      </section>
      <section aria-label={text('所选版本阶段时间', 'Selected version stage dates')}>
        <h4>{text('阶段计划与实际时间', 'Planned and actual stage dates')}</h4>
        <dl style={{ overflowWrap: 'anywhere' }}>{[
          [text('分析计划', 'Analysis due'), controlled.snapshot.deadlines.analysisDueAt], [text('分析完成', 'Analysis completed'), controlled.snapshot.analysisCompletedAt],
          [text('完整提交计划', 'Submission due'), controlled.snapshot.deadlines.submissionDueAt], [text('完整提交时间', 'Submitted at'), controlled.snapshot.submittedAt],
          [text('关闭计划', 'Closure due'), controlled.snapshot.deadlines.closureDueAt], [text('实际关闭时间', 'Closed at'), problem.closedAt],
        ].map(([label, value]) => <div key={String(label)}><dt>{String(label)}</dt><dd>{show(value)}</dd></div>)}</dl>
      </section>
      <section aria-label={text('所选版本审批与关闭依据', 'Selected version approval and closure basis')}>
        <h4>{text('审批与关闭依据', 'Approval and closure basis')}</h4>
        <dl style={{ overflowWrap: 'anywhere' }}>{[
          [text('修订标识', 'Revision ID'), controlled.revisionId], [text('正文版本', 'Content version'), controlled.snapshot.contentVersion],
          [text('数据版本', 'Row version'), controlled.snapshot.rowVersion], [text('流程版本', 'Instance version'), controlled.snapshot.instance.version],
          [text('流程状态', 'Instance status'), controlled.snapshot.instance.status],
        ].map(([label, value]) => <div key={String(label)}><dt>{String(label)}</dt><dd>{show(value)}</dd></div>)}</dl>
        {!rounds.length && <p>{text('本版无批准记录（未批准）', 'No approval record in this version (unapproved)')}</p>}
        {rounds.map((value, index) => {
          const round = metadata(value);
          return <section key={index} aria-label={`${text('审批轮次', 'Approval round')} ${show(round.roundNumber)}`}>
            <h5>{text('审批轮次', 'Approval round')} {show(round.roundNumber)}</h5>
            <dl style={{ overflowWrap: 'anywhere' }}>{[
              [text('轮次结果', 'Round result'), round.status], [text('固定正文版本', 'Pinned content version'), round.contentVersion],
              [text('轮次版本', 'Round version'), round.version], [text('发起时间', 'Started at'), round.createdAt],
              [text('轮次更新时间', 'Round updated at'), round.updatedAt],
            ].map(([label, value]) => <div key={String(label)}><dt>{String(label)}</dt><dd>{show(value)}</dd></div>)}</dl>
            {(Array.isArray(round.duties) ? round.duties : []).map((value, index) => {
              const duty = metadata(value);
              return <section key={index} aria-label={`${text('审批职责', 'Approval duty')} ${index + 1}`}>
                <dl style={{ overflowWrap: 'anywhere' }}>{[
                  [text('职责', 'Duty'), duty.duty], [text('职责结果', 'Duty result'), duty.status], [text('确认时间', 'Decided at'), duty.decidedAt],
                  ...portal ? [] : [[text('职责用户标识', 'Assigned user ID'), duty.userId], [text('确认用户标识', 'Deciding user ID'), duty.decidedBy], [text('意见', 'Comment'), duty.comment]],
                ].map(([label, value]) => <div key={String(label)}><dt>{String(label)}</dt><dd>{show(value)}</dd></div>)}</dl>
              </section>;
            })}
          </section>;
        })}
      </section>
      {!portal && controlled.status === 'CLOSED_SUPPLEMENT' && <section aria-label={text('内部补充版本说明', 'Internal supplement version notice')}>
        <p>{text('关闭后内部补充，非原批准版，不对供应商公开。', 'Post-closure internal supplement, not the original approved version and not public to suppliers.')}</p>
        <dl style={{ overflowWrap: 'anywhere' }}><dt>{text('补充更新时间', 'Supplement updated at')}</dt><dd>{show(problem.supplementUpdatedAt)}</dd></dl>
      </section>}
      <EightDDocumentEditor problemId={report.supplierProblemId} anchorId={`${report.supplierProblemId}-report`} resource={{ resourceType: !portal && controlled.status === 'CLOSED_SUPPLEMENT' ? 'supplier-eight-d-supplement' : 'supplier-quality', resourceId: report.supplierProblemId }} document={controlled.snapshot.document} disabled read={read} onChange={() => {}} />
      <ul>{controlled.attachments.map(file => <li key={file.id}>{file.originalName} · {file.rendering} · {file.note} · {file.uses.join(', ')}</li>)}</ul>
      <AttachmentPanel resource={{ resourceType: !portal && controlled.status === 'CLOSED_SUPPLEMENT' ? 'supplier-eight-d-supplement' : 'supplier-quality', resourceId: report.supplierProblemId }} fileIds={controlled.attachments.map(file => file.id)} readOnly onAccessDenied={scope.onAccessDenied} onPendingChange={scope.onPendingChange} />
    </>}
  </>;
}
