import { Fragment, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Alert, Button, Spin, Tag } from 'antd';
import type { components } from '@qms/contracts';
import { ApiError } from '../../api/client';
import { AttachmentPanel } from '../attachments/AttachmentPanel';
import { readAttachmentPreview } from '../attachments/attachment-preview';
import { attachmentDownload, readAttachment } from '../attachments/attachments';
import { EightDField } from './EightDDocumentEditor';
import { EightDProblemInput } from './EightDProblemInput';
import { useEightDEvidenceScope } from './EightDEvidenceScope';
import { aborted, eightDPath, useEightDText, type EightDRead, type EightDReport } from './eight-d';
import styles from './eight-d.module.css';
import previewStyles from './controlled-report.module.css';
import { eightDDomain, type InternalEightDDomain } from '../internal-eight-d/domain';
import { InternalEightDSourceFacts } from '../internal-eight-d/InternalEightDSourceFacts';

type Controlled = components['schemas']['ProcessEightDControlledReportDto'];
type ReportAttachment = Controlled['attachments'][number];
export function matchesReportSelection(report: Pick<Controlled, 'view' | 'revisionId'>, selection: string, allowApprovedCurrent = false) {
  if (selection === 'CURRENT') return report.view === 'CURRENT' && report.revisionId === null
    || allowApprovedCurrent && report.view === 'APPROVED' && !!report.revisionId;
  if (selection === 'APPROVED') return report.view === 'APPROVED' && !!report.revisionId;
  return report.view === 'HISTORICAL' && report.revisionId === selection;
}

function ReportImage({ file }: { file: ReportAttachment }) {
  const text = useEightDText();
  const { onAccessDenied } = useEightDEvidenceScope();
  const figure = useRef<HTMLElement>(null);
  const [preview, setPreview] = useState<{ url: string } | 'loading' | 'unavailable'>();
  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    let objectUrl: string | undefined;
    async function load() {
      setPreview('loading');
      try {
        const metadata = await readAttachment(file.id, signal);
        if (metadata.id !== file.id || metadata.version !== file.version || metadata.sha256 !== file.sha256
          || metadata.sizeBytes !== file.sizeBytes || metadata.contentType !== file.contentType) throw new Error('REPORT_ATTACHMENT_CHANGED');
        const result = await readAttachmentPreview(metadata, signal, attachmentDownload);
        signal.throwIfAborted();
        if (result.kind !== 'image') throw new Error('REPORT_IMAGE_INVALID');
        objectUrl = URL.createObjectURL(result.blob);
        setPreview({ url: objectUrl });
      } catch (cause) {
        if (signal.aborted) return;
        if (cause instanceof ApiError && (cause.status === 401 || cause.status === 403)) onAccessDenied?.(cause);
        setPreview('unavailable');
      }
    }
    const observer = typeof IntersectionObserver === 'function' ? new IntersectionObserver(entries => {
      if (signal.aborted || !entries.some(entry => entry.isIntersecting)) return;
      observer?.disconnect();
      void load();
    }) : undefined;
    if (observer && figure.current) observer.observe(figure.current);
    else void load();
    return () => {
      observer?.disconnect(); controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [file, onAccessDenied]);
  return <figure ref={figure} className={previewStyles.figure}>
    {typeof preview === 'object' && <img src={preview.url} alt={file.originalName} />}
    <figcaption>{file.originalName}{preview === 'loading' && ` · ${text('正在加载图片', 'Loading image')}`}
      {preview === 'unavailable' && ` · ${text('图片预览不可用', 'Image preview unavailable')}`}</figcaption>
  </figure>;
}

export function EightDReportDocument({ document, attachments, overview }: { document: Controlled['snapshot']['document']; attachments: Controlled['attachments']; overview?: ReactNode }) {
  const text = useEightDText();
  const id = useId();
  const labels = [text('团队建立', 'Team establishment'), text('问题描述', 'Problem description'), text('临时措施与围堵', 'Temporary measures and containment'),
    text('根因分析', 'Root cause analysis'), text('制定永久纠正措施', 'Permanent corrective actions'), text('实施与验证', 'Implementation and verification'),
    text('横向展开与标准化', 'Horizontal deployment and standardization'), text('结案总结', 'Closure summary')];
  const missing = text('未记录', 'Not recorded');
  const display = (value: string | number | null | undefined) => value === '' || value == null ? missing : value;
  const yesNo = (value?: boolean | null) => value == null ? undefined : value ? text('是', 'Yes') : text('否', 'No');
  const facts = (entries: [string, string | number | null | undefined][]) => <dl className={previewStyles.facts}>
    {entries.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{display(value)}</dd></div>)}
  </dl>;
  const shownImages = new Set<string>();
  const files = (label: string, ids: string[], embed = true) => {
    const selected = attachments.filter(file => ids.includes(file.id));
    const images = embed ? selected.filter(file => file.rendering === 'EMBEDDED' && ['image/png', 'image/jpeg'].includes(file.contentType) && !shownImages.has(file.id)) : [];
    images.forEach(file => shownImages.add(file.id));
    return selected.length > 0 ? <>
      <p>{label} · {selected.map(file => file.originalName).join('、')}</p>
      {images.map(file => <ReportImage key={`${file.id}:${file.version}:${file.sha256}`} file={file} />)}
    </> : null;
  };
  const chapter = (number: number, body: ReactNode) => <section id={`${id}-D${number}`} className={styles.section}>
    <h3>D{number} · {labels[number - 1]}</h3>{body}
  </section>;
  const attachmentLabel = text('附件', 'Attachments');
  const containment = (heading: string, rows: typeof document.containment, scope?: string) => <>
    <h4>{heading}</h4>{scope && facts([[text('潜在影响范围', 'Potential impact scope'), scope]])}
    {rows.map(row => <Fragment key={row.id}>{facts([
      [text('分组', 'Group'), row.group], [text('位置', 'Location'), row.location], [text('数量', 'Quantity'), row.quantity],
      [text('不良数量', 'Defect quantity'), row.ngQuantity], [text('措施', 'Measure'), row.measure], [text('负责人', 'Owner'), row.owner],
      [text('计划日期', 'Planned date'), row.plannedAt], [text('进展', 'Progress'), row.completion],
    ])}</Fragment>)}
  </>;
  const causes = { OCCURRENCE: text('发生原因', 'Occurrence cause'), ESCAPE: text('流出原因', 'Escape cause'), SYSTEM: text('系统原因', 'System cause') };
  const tracking = document.effectTracking;
  const teamColumns = [text('姓名', 'Name'), text('部门', 'Department'), text('职务', 'Job title'), text('职责分工', 'Responsibility'), text('协作范围', 'Collaboration scope'), text('组长', 'Team leader')];
  return <>
    <nav className={styles.anchors} aria-label={text('8D 内容分区', '8D content sections')}>
      {labels.map((label, index) => <a key={label} href={`#${id}-D${index + 1}`}>D{index + 1}</a>)}
    </nav>
    {overview}
    {document.riskAssessment && facts([[text('风险判定说明', 'Risk assessment'), document.riskAssessment]])}
    {chapter(1, document.team?.length ? <div className={styles.scroll} role="region" aria-label={labels[0]} tabIndex={0}>
      <table className={styles.table}><thead><tr>{teamColumns.map(label => <th key={label} scope="col">{label}</th>)}</tr></thead>
        <tbody>{document.team.map(member => <tr key={member.id}>
          {[member.name, member.department, member.jobTitle, member.responsibility, member.collaborationScope, yesNo(member.isLeader)].map((value, index) => <td key={teamColumns[index]}>{display(value)}</td>)}
        </tr>)}</tbody>
      </table>
    </div> : <p>{missing}</p>)}
    {chapter(2, <>
      {facts([[text('问题描述', 'Problem description'), document.description]])}
      {document.okDescription && facts([[text('OK 图片说明', 'OK image description'), document.okDescription]])}
      {files(text('OK 图片', 'OK images'), document.okFileIds)}
      {document.ngDescription && facts([[text('NG 图片说明', 'NG image description'), document.ngDescription]])}
      {files(text('NG 图片', 'NG images'), document.ngFileIds)}
    </>)}
    {chapter(3, <>
      {document.temporaryMeasures.map((row, index) => <section key={row.id}>
        <h4>{text('临时措施', 'Temporary measure')} {index + 1}</h4>
        {facts([[text('措施', 'Measure'), row.description], [text('责任部门 / 人', 'Department / owner'), row.departmentOwner], [text('导入日期', 'Introduction date'), row.introducedAt]])}
        {files(attachmentLabel, row.fileIds)}
      </section>)}
      {containment(text('围堵', 'Containment'), document.containment)}
      {containment(text('可选扩展围堵', 'Additional containment'), document.optionalAffectedContainment, document.optionalAffectedScope)}
    </>)}
    {chapter(4, <>
      {facts([[text('分析过程', 'Analysis process'), document.analysisProcess], [causes.OCCURRENCE, document.occurrenceCause], [causes.ESCAPE, document.escapeCause], [causes.SYSTEM, document.systemCause]])}
      {files(attachmentLabel, document.analysisFileIds)}
    </>)}
    {chapter(5, document.correctiveActions.map((row, index) => <section key={row.id}>
      <h4>{text('措施', 'Action')} {index + 1} · {causes[row.causeKind]}</h4>
      {facts([[text('对策', 'Action'), row.action], [text('负责人', 'Owner'), row.owner], [text('计划日期', 'Planned date'), row.plannedAt],
        [text('验证方法', 'Verification method'), row.verificationMethod], [text('选用原因', 'Selection reason'), row.selectionReason]])}
      {files(attachmentLabel, row.fileIds)}
    </section>))}
    {chapter(6, <>
      {document.correctiveActions.map((row, index) => <section key={row.id}>
        <h4>{text('措施', 'Action')} {index + 1} · {causes[row.causeKind]}</h4>
        {facts([[text('实施人', 'Implementer'), row.implementer], [text('验证人', 'Verifier'), row.verifier], [text('实施时间', 'Implementation time'), row.implementationAt],
          [text('实施结果', 'Implementation result'), row.result], [text('改善前', 'Before'), row.beforeState], [text('改善后', 'After'), row.afterState],
          [text('真实首批断点', 'First batch'), row.firstBatch], [text('后续批数', 'Follow-up batches'), row.followUpBatchCount], [text('跟踪时长', 'Follow-up duration'), row.followUpDuration],
          [text('验证记录', 'Verification record'), row.verificationRecord], [text('确认有效', 'Confirmed effective'), yesNo(row.effective)]])}
        {files(text('验证附件', 'Verification attachments'), row.verificationFileIds)}
      </section>)}
      {tracking && <><h4>{text('效果跟踪', 'Effect tracking')}</h4>{facts([
        [text('开始日期', 'Start date'), tracking.startDate], [text('开始订单号', 'Starting order'), tracking.startOrderNumber],
        [text('生产数量', 'Production quantity'), tracking.productionQuantity], [text('不良数量', 'Defect quantity'), tracking.defectQuantity],
        [text('确认结果', 'Confirmed result'), tracking.result], [text('判断', 'Judgment'), tracking.judgement],
      ])}</>}
    </>)}
    {chapter(7, <>
      {document.horizontalDeployment.map((row, index) => <section key={row.id}>
        <h4>{text('横向展开', 'Horizontal deployment')} {index + 1}</h4>
        {facts([[text('范围', 'Scope'), row.scope], [text('排查结果', 'Inspection result'), row.inspectionResult], [text('措施', 'Action'), row.action],
          [text('负责人', 'Owner'), row.owner], [text('完成情况', 'Completion'), row.completion], [text('已完成', 'Completed'), yesNo(row.completed)]])}
        {files(attachmentLabel, row.fileIds)}
      </section>)}
      {document.standardization.map((row, index) => <section key={row.id}>
        <h4>{text('标准化', 'Standardization')} {index + 1}</h4>
        {facts([[text('相关文件', 'Document'), row.documentName], [text('需要更新', 'Needs update'), yesNo(row.needsUpdate)],
          [text('部门 / 主导者', 'Department / lead'), row.departmentOwner], [text('计划完成日期', 'Planned completion'), row.plannedAt],
          [text('实际完成日期', 'Actual completion'), row.completedAt], [text('状态', 'Status'), row.status === 'COMPLETED' ? text('已完成', 'Completed')
            : row.status === 'NOT_APPLICABLE' ? text('不适用', 'Not applicable') : row.status], [text('补充说明', 'Notes'), row.reason]])}
        {files(attachmentLabel, row.fileIds ?? [], false)}
      </section>)}
    </>)}
    {chapter(8, facts([[text('关闭总结', 'Closure summary'), document.closureSummary], [text('经验总结', 'Lessons learned'), document.lessonsLearned]]))}
  </>;
}

export function EightDControlledReport({ report, read, download, domain = 'process' }: { report: EightDReport; domain?: InternalEightDDomain; read: EightDRead; download: (path: string) => Promise<void> }) {
  const text = useEightDText();
  const evidenceScope = useEightDEvidenceScope();
  const [selection, setSelection] = useState('CURRENT');
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState<{ key: string; report?: Controlled }>();
  const [downloadFailure, setDownloadFailure] = useState<{ key: string; conflict: boolean }>();
  const [downloading, setDownloading] = useState(false);
  const query = new URLSearchParams({ organizationId: report.organizationId });
  if (selection === 'CURRENT' || selection === 'APPROVED') query.set('view', selection); else query.set('revisionId', selection);
  const path = `${eightDPath(report.problemId, domain)}/report?${query}`;
  const requestKey = JSON.stringify([path, report.version, revision]);
  const loaded = state?.key === requestKey ? state : undefined;
  const controlled = loaded?.report;
  const failure = downloadFailure?.key === requestKey ? downloadFailure : undefined;
  const fingerprint = controlled?.previewFingerprint;
  useEffect(() => {
    const controller = new AbortController();
    setState(undefined);
    setDownloadFailure(undefined);
    read<Controlled>(path, { signal: controller.signal }).then(value => {
      if (controller.signal.aborted) return;
      setState({ key: requestKey, report: value.problemId === report.problemId && matchesReportSelection(value, selection) ? value : undefined });
    }).catch(cause => {
      if (!controller.signal.aborted && !aborted(cause)) setState({ key: requestKey });
    });
    return () => controller.abort();
  }, [path, read, report.problemId, requestKey, selection]);

  const title = controlled && (controlled.snapshot.document.title || (typeof controlled.snapshot.problem.title === 'string' && controlled.snapshot.problem.title) || controlled.reportNumber);
  const show = (value: unknown) => typeof value === 'string' && value ? value : text('未记录', 'Not recorded');
  return <div className={previewStyles.preview}>
    <div className={previewStyles.toolbar}><EightDField label={text('报告版本', 'Report version')}><select value={selection} disabled={downloading} onChange={event => setSelection(event.target.value)}><option value="CURRENT">{text('当前保存版 CURRENT', 'Current saved version CURRENT')}</option><option value="APPROVED">{text('批准版 APPROVED', 'Approved version APPROVED')}</option>{report.revisions.map(item => <option key={item.id} value={item.id}>{text('历史版', 'Historical')} · v{item.contentVersion} · {item.recordedAt}</option>)}</select></EightDField>
      <Button onClick={() => setRevision(value => value + 1)} disabled={downloading}>{text('刷新报告', 'Refresh report')}</Button>
      <Button disabled={!fingerprint || downloading || failure?.conflict} loading={downloading} onClick={() => {
        if (!fingerprint || downloading || failure?.conflict) return;
        setDownloading(true); setDownloadFailure(undefined);
        const pdfQuery = new URLSearchParams(query);
        pdfQuery.set('previewFingerprint', fingerprint);
        void download(`${eightDPath(report.problemId, domain)}/report/pdf?${pdfQuery}`).catch(cause => {
          if (!aborted(cause)) setDownloadFailure({ key: requestKey, conflict: cause instanceof ApiError && cause.status === 409 });
        }).finally(() => setDownloading(false));
      }}>{text('授权下载 PDF', 'Download authorized PDF')}</Button>
    </div>

    {failure && <Alert type="error" title={failure.conflict ? text('报告版本已变化，请刷新预览后下载。', 'The report changed. Refresh the preview before downloading.') : text('报告读取或下载失败，请检查权限与版本后刷新。', 'Report reading or download failed. Check access and version, then refresh.')} />}
    {!loaded ? <Spin aria-label={text('正在加载报告预览', 'Loading report preview')} /> : !controlled ? <Alert type="error" title={text('报告读取或下载失败，请检查权限与版本后刷新。', 'Report reading or download failed. Check access and version, then refresh.')} /> : <article className={previewStyles.article} aria-label={controlled.reportNumber}>
      <header className={previewStyles.cover}><h2>{title}</h2>{title !== controlled.reportNumber && <p>{controlled.reportNumber}</p>}<Tag>{controlled.label}</Tag><p>{controlled.view} · {text('内容版本', 'Content version')} {controlled.contentVersion} · {text('记录版本', 'Row version')} {controlled.rowVersion} · {controlled.generatedAt}</p></header>
      <EightDReportDocument document={controlled.snapshot.document} attachments={controlled.attachments}
        overview={<>
          <dl className={previewStyles.facts}>{[
            [text('负责人', 'Owner'), controlled.snapshot.ownerName],
            [text('责任科室', 'Responsible section'), controlled.snapshot.responsibleSectionName],
            [text('分析计划', 'Analysis due'), controlled.snapshot.deadlines.analysisDueAt],
            [text('分析完成', 'Analysis completed'), controlled.snapshot.analysisCompletedAt],
            [text('完整提交计划', 'Submission due'), controlled.snapshot.deadlines.submissionDueAt],
            [text('完整提交时间', 'Submitted at'), controlled.snapshot.submittedAt],
            [text('关闭计划', 'Closure due'), controlled.snapshot.deadlines.closureDueAt],
            [text('实际关闭时间', 'Closed at'), controlled.snapshot.problem.closedAt],
          ].map(([label, value]) => <div key={String(label)}><dt>{String(label)}</dt><dd>{show(value)}</dd></div>)}</dl>
          {domain === 'process' ? <EightDProblemInput sources={controlled.snapshot.sources} organizationId={report.organizationId} severity={controlled.snapshot.severity} /> : <InternalEightDSourceFacts domain={domain} sources={controlled.snapshot.sources} />}
        </>} />
      <details className={styles.section}><summary>{text('报告来源快照备查', 'Raw report source snapshots')}</summary>{controlled.snapshot.sources.map(source => <div key={source.sourceId}><strong>{source.sourceId}</strong> · v{source.sourceVersion}<pre className={styles.pre}>{JSON.stringify(source.sourceSnapshot, null, 2)}</pre></div>)}</details>
      <section className={styles.section}><h3>{text('版本附件', 'Version attachments')}</h3>{controlled.attachments.map(file => <p key={file.id}>{file.originalName} · {file.rendering} · {file.note} · {file.uses.join(', ')}</p>)}<AttachmentPanel variant="standard" resource={{ resourceType: eightDDomain(domain).resourceType, resourceId: report.problemId }} fileIds={controlled.attachments.map(file => file.id)} readOnly onAccessDenied={evidenceScope.onAccessDenied} onPendingChange={evidenceScope.onPendingChange} /></section>
      <details><summary>{text('报告绑定的批准与轮次快照', 'Approval and round snapshot bound to this report')}</summary><pre className={styles.pre}>{JSON.stringify({ approval: controlled.snapshot.approval, approvalRounds: controlled.snapshot.approvalRounds }, null, 2)}</pre></details>
    </article>}
  </div>;
}
