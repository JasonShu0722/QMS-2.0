import { Fragment, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Alert, Button, Spin, Tag } from 'antd';
import type { components } from '@qms/contracts';
import { Link } from 'react-router-dom';
import { ApiError } from '../../api/client';
import { QmsLoading } from '../../components/QmsLoading';
import { canDownloadAttachment, readAttachmentPreview } from '../attachments/attachment-preview';
import { attachmentDownload, readAttachment } from '../attachments/attachments';
import { EightDField } from './EightDDocumentEditor';
import { useEightDEvidenceScope } from './EightDEvidenceScope';
import { aborted, eightDPath, useEightDSeverityText, useEightDText, type EightDRead, type EightDReport } from './eight-d';
import styles from './eight-d.module.css';
import previewStyles from './controlled-report.module.css';
import type { InternalEightDDomain } from '../internal-eight-d/domain';

type Controlled = components['schemas']['ProcessEightDControlledReportDto'];
type ReportAttachment = Controlled['attachments'][number];
type Fact = [label: string, value: unknown];
const hasValue = (value: unknown) => typeof value === 'string' && !!value.trim() || typeof value === 'number' && Number.isFinite(value);
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
export function ReportFacts({ entries }: { entries: Fact[] }) {
  const visible = entries.filter(([, value]) => hasValue(value));
  return visible.length ? <dl className={previewStyles.facts}>{visible.map(([label, value]) =>
    <div key={label}><dt>{label}</dt><dd>{String(value)}</dd></div>)}</dl> : null;
}

export function ReportCover({ report, title, severity }: { report: Pick<Controlled, 'reportNumber' | 'label' | 'contentVersion' | 'status' | 'snapshot'>; title: string; severity: unknown }) {
  const text = useEightDText();
  const severityText = useEightDSeverityText();
  const { document, problem } = report.snapshot;
  const businessStatus = report.status === 'APPROVED' || report.status === 'CLOSED_SUPPLEMENT' || hasValue(problem.closedAt)
    ? text('已关闭', 'Closed') : report.status === 'IN_REVIEW' || report.status === 'HISTORICAL' && hasValue(report.snapshot.submittedAt)
      ? text('审批中', 'In review') : text('办理中', 'Processing');
  const summary = text('执行摘要', 'Executive summary');
  const summaryEntries: Fact[] = [
    [text('问题', 'Problem'), document.description || problem.defectDescription],
    [text('发生原因', 'Occurrence cause'), document.occurrenceCause],
    [text('流出原因', 'Escape cause'), document.escapeCause],
    [text('系统原因', 'System cause'), document.systemCause],
    [text('已记录对策（摘录）', 'Recorded action (excerpt)'), document.correctiveActions.find(row => hasValue(row.action))?.action],
    [text('已记录结果（摘录）', 'Recorded result (excerpt)'), document.effectTracking?.result || document.correctiveActions.find(row => hasValue(row.result))?.result],
  ];
  const findings = summaryEntries.flatMap(([label, value]) => {
    if (typeof value !== 'string' || !hasValue(value)) return [];
    const excerpt = [...value.trim()];
    return [{ label, value: excerpt.length > 100 ? `${excerpt.slice(0, 100).join('')}…` : excerpt.join('') }];
  });
  return <header className={previewStyles.cover}>
    <p>{report.reportNumber} · {text('版本', 'Version')} V{report.contentVersion}</p>
    <h2>{title}</h2>
    <div className={previewStyles.badges}><Tag>{businessStatus}</Tag><Tag>{report.label}</Tag>
      {typeof severity === 'string' && <Tag>{severityText(severity as EightDReport['severity'])}</Tag>}
    </div>
    {!!findings.length && <section aria-label={summary}><h3>{summary}</h3>{findings.map(({ label, value }) =>
      <p key={label} className={previewStyles.narrative}>{`${label} · ${value}`}</p>)}</section>}
  </header>;
}

export function ReportSources({ sources, organizationId, confirmations }: { sources: Controlled['snapshot']['sources']; organizationId?: string; confirmations?: unknown }) {
  const text = useEightDText();
  const related = Array.isArray(confirmations) ? confirmations : [];
  if (!sources.length && !related.length) return null;
  return <section aria-label={text('来源基础信息', 'Source facts')}>
    <h3>{text('来源基础信息', 'Source facts')}</h3>
    {sources.map(({ sourceId, sourceDomain, sourceSnapshot: source }, index) => {
      const normalized = record(source.normalized);
      const inclusion = record(source.inclusion);
      const project = record(record(source.mappingSnapshot).project);
      const customer = sourceDomain === 'customer-quality';
      const reference = String([source.complaintNumber, source.traceCode, source.workOrderCode].find(hasValue) ?? sourceId);
      const recordId = sourceDomain === 'new-product-quality' ? source.id : sourceId;
      const route = customer ? 'customer-quality' : 'process-quality';
      const path = organizationId && typeof recordId === 'string' && /^[0-9a-f-]{36}$/i.test(recordId)
        ? `/app/${route}?${new URLSearchParams({ organizationId, [customer ? 'complaintId' : 'defectId']: recordId })}` : undefined;
      const description = normalized.defectDescription ?? source.description;
      return <section key={sourceId} className={previewStyles.source}>
        <h4>{text('来源', 'Source')} {index + 1} · {path ? <Link to={path}>{reference}</Link> : reference}</h4>
        {hasValue(description) && <p className={previewStyles.narrative}>{String(description)}</p>}
        <ReportFacts entries={[
          [text('客户名称', 'Customer'), source.customerName],
          [text('客诉类型', 'Complaint type'), source.complaintType], [text('登记阶段', 'Registered stage'), source.stage],
          [text('发生时间', 'Occurrence time'), normalized.occurredOn ?? source.occurredAt], [text('不良数量', 'Defect quantity'), normalized.quantity ?? source.defectQuantity],
          [text('工序', 'Operation'), source.operationName ?? source.operationCode], [text('产线', 'Line'), source.lineName ?? source.lineCode],
          [text('追溯码', 'Trace code'), normalized.barcode ?? (reference === source.traceCode ? undefined : source.traceCode)],
          [text('工单', 'Work order'), reference === source.workOrderCode ? undefined : source.workOrderCode],
          [text('批次', 'Batch'), normalized.batch ?? source.batchCode], [text('项目代码', 'Project code'), inclusion.projectCode ?? project.code ?? source.projectCode],
          [text('零部件代码', 'Component code'), inclusion.componentCode ?? normalized.componentCode],
          [text('产品型号', 'Product model'), normalized.productModel ?? source.productCode], [text('VIN', 'VIN'), normalized.vin],
          [text('行驶里程', 'Mileage'), normalized.mileage], [text('生产日期', 'Production date'), normalized.productionOn],
          [text('购买日期', 'Purchase date'), normalized.purchaseOn], [text('车辆交付日期', 'Vehicle delivery date'), normalized.vehicleDeliveryOn],
          [text('车辆下线日期', 'Vehicle offline date'), normalized.vehicleOfflineOn], [text('上线日期', 'Online date'), normalized.onlineOn],
          [text('发生地点', 'Occurrence location'), normalized.occurredAtLocation], [text('发生区域', 'Occurrence region'), normalized.occurredAtRegion],
          [text('终端客户名称', 'End customer'), normalized.terminalCustomerName], [text('纳入时观察阶段', 'Observed stage'), inclusion.observedProjectStage],
          [text('纳入观察时间', 'Inclusion time'), inclusion.observedAt], [text('历史阶段依据', 'Historical stage evidence'), inclusion.temporalEvidence],
          [text('确认理由', 'Confirmation reason'), inclusion.confirmationReason],
        ]} />
        {(Array.isArray(source.materials) ? source.materials : []).map((value, materialIndex) => {
          const material = record(value);
          return <ReportFacts key={materialIndex} entries={[[text('物料编码', 'Material code'), material.materialCode],
            [text('物料名称', 'Material name'), material.materialName], [text('物料批次', 'Material batch'), material.materialBatch], [text('备注', 'Notes'), material.notes]]} />;
        })}
      </section>;
    })}
    {related.map((value, index) => {
      const confirmation = record(value);
      return <ReportFacts key={index} entries={[
        [text('复发确认', 'Recurrence'), confirmation.recurrence === 'RECURRENCE' || confirmation.recurrence === true
          ? text('复发', 'Recurrence') : confirmation.recurrence === 'NOT_RECURRENCE' || confirmation.recurrence === false ? text('非复发', 'No recurrence') : undefined],
        [text('确认理由', 'Confirmation reason'), confirmation.reason], [text('确认时间', 'Confirmed at'), confirmation.recordedAt],
        [text('相关问题', 'Related problems'), Array.isArray(confirmation.relatedProblemIds) ? confirmation.relatedProblemIds.filter(hasValue).join('、') : undefined],
      ]} />;
    })}
  </section>;
}
export function matchesReportSelection(report: Pick<Controlled, 'view' | 'revisionId'>, selection: string, allowApprovedCurrent = false) {
  if (selection === 'CURRENT') return report.view === 'CURRENT' && report.revisionId === null
    || allowApprovedCurrent && report.view === 'APPROVED' && !!report.revisionId;
  if (selection === 'APPROVED') return report.view === 'APPROVED' && !!report.revisionId;
  return report.view === 'HISTORICAL' && report.revisionId === selection;
}

async function readReportAttachment(file: ReportAttachment, signal: AbortSignal) {
  const metadata = await readAttachment(file.id, signal);
  if (metadata.id !== file.id || metadata.version !== file.version || metadata.sha256 !== file.sha256
    || metadata.sizeBytes !== file.sizeBytes || metadata.contentType !== file.contentType) throw new Error('REPORT_ATTACHMENT_CHANGED');
  return metadata;
}

function ReportFile({ file, purpose }: { file: ReportAttachment; purpose: string }) {
  const text = useEightDText();
  const { onAccessDenied, onPendingChange } = useEightDEvidenceScope();
  const active = useRef<AbortController>(null);
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => () => { if (active.current) { active.current.abort(); onPendingChange(false); } }, [onPendingChange]);
  async function download() {
    if (active.current) return;
    const controller = new AbortController();
    active.current = controller;
    const { signal } = controller;
    setPending(true); setFailed(false); onPendingChange(true);
    try {
      const metadata = await readReportAttachment(file, signal);
      if (!canDownloadAttachment(metadata)) throw new Error('REPORT_ATTACHMENT_UNAVAILABLE');
      const url = await attachmentDownload(file.id, signal);
      signal.throwIfAborted();
      const link = window.document.createElement('a');
      link.href = url; link.download = file.originalName; link.rel = 'noreferrer'; link.click();
    } catch (cause) {
      if (signal.aborted) return;
      if (cause instanceof ApiError && (cause.status === 401 || cause.status === 403)) onAccessDenied?.(cause);
      setFailed(true);
    } finally {
      active.current = null;
      if (!signal.aborted) { setPending(false); onPendingChange(false); }
    }
  }
  return <li className={previewStyles.file}><Button type="link" loading={pending} onClick={() => void download()}>{file.originalName}</Button>
    {purpose && <span>{purpose}</span>}{failed && <span role="alert">{text('附件下载失败', 'Attachment download failed')}</span>}</li>;
}

export function ReportApproval({ report, portal = false }: { report: Pick<Controlled, 'snapshot' | 'status' | 'contentVersion'>; portal?: boolean }) {
  const text = useEightDText();
  const rounds = report.snapshot.approvalRounds ?? (report.snapshot.approval ? [report.snapshot.approval] : []);
  return <section aria-label={text('所选版本审批与关闭依据', 'Selected version approval and closure basis')}>
    <h3>{text('审批与关闭依据', 'Approval and closure basis')}</h3>
    {!rounds.length && <p>{text('本版无批准记录', 'No approval record in this version')}</p>}
    {rounds.map((round, index) => {
      const invalid = round.status === 'RETURNED' || round.status === 'CANCELLED';
      const old = round.contentVersion !== report.contentVersion;
      const qualification = invalid ? text('旧轮已失效', 'Superseded round') : old
        ? round.status === 'APPROVED' && report.status === 'CLOSED_SUPPLEMENT'
          ? text('原版本实际批准，未覆盖本次补充', 'Original approval excludes this supplement')
          : text('非本版审批，不作为本版批准', 'Approval does not apply to this version') : undefined;
      const label = `${text('审批轮次', 'Approval round')} ${round.roundNumber ?? index + 1}`;
      return <section key={index} aria-label={label}>
        <h4>{label}</h4>
        <ReportFacts entries={[[text('轮次结果', 'Round result'), round.status], [text('适用范围', 'Applicability'), qualification],
          [text('发起时间', 'Started at'), round.createdAt], [text('轮次更新时间', 'Round updated at'), round.updatedAt]]} />
        <ReportFacts entries={[[text('轮次结束原因', 'Round end reason'), portal ? undefined : record(round.context).endReason]]} />
        {(Array.isArray(round.duties) ? round.duties : []).map((value, dutyIndex) => {
          const duty = record(value);
          return <section key={dutyIndex} aria-label={`${text('审批职责', 'Approval duty')} ${dutyIndex + 1}`}>
          <ReportFacts entries={[[text('职责', 'Duty'), duty.duty], [text('职责结果', 'Duty result'), duty.status === 'SKIPPED_SAME_PERSON'
            ? text('同人跳过（非签批）', 'Skipped for same person (no sign-off)') : duty.status], [text('确认时间', 'Decided at'), duty.decidedAt],
            ...portal ? [] : [[text('确认用户标识', 'Deciding user ID'), duty.decidedBy], [text('意见', 'Comment'), duty.comment]] as Fact[]]} />
          </section>;
        })}
      </section>;
    })}
  </section>;
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
        const metadata = await readReportAttachment(file, signal);
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
    {typeof preview === 'object' && <a href={preview.url} target="_blank" rel="noopener noreferrer"
      aria-label={`${text('查看原图', 'Open original image')} ${file.originalName}`}><img src={preview.url} alt={file.originalName} /></a>}
    {preview === 'loading' && <QmsLoading label={text('正在加载图片', 'Loading image')} />}
    <figcaption>{file.originalName}
      {preview === 'unavailable' && ` · ${text('图片预览不可用', 'Image preview unavailable')}`}</figcaption>
  </figure>;
}

export function EightDReportDocument({ document, attachments, overview }: { document: Controlled['snapshot']['document']; attachments: Controlled['attachments']; overview?: ReactNode }) {
  const text = useEightDText();
  const id = useId();
  const labels = [text('团队建立', 'Team establishment'), text('问题描述', 'Problem description'), text('临时措施与围堵', 'Temporary measures and containment'),
    text('根因分析', 'Root cause analysis'), text('制定永久纠正措施', 'Permanent corrective actions'), text('实施与验证', 'Implementation and verification'),
    text('横向展开与标准化', 'Horizontal deployment and standardization'), text('结案总结', 'Closure summary')];
  const yesNo = (value?: boolean | null) => value == null ? undefined : value ? text('是', 'Yes') : text('否', 'No');
  const facts = (entries: Fact[]) => <ReportFacts entries={entries} />;
  const paragraph = (value?: string) => hasValue(value) && <p className={previewStyles.narrative}>{value}</p>;
  const shownImages = new Set<string>();
  const files = (ids: string[]) => {
    const images = attachments.filter(file => ids.includes(file.id) && file.rendering === 'EMBEDDED' && !shownImages.has(file.id));
    images.forEach(file => shownImages.add(file.id));
    return images.map(file => <ReportImage key={`${file.id}:${file.version}:${file.sha256}`} file={file} />);
  };
  const hasFiles = (ids: string[]) => attachments.some(file => ids.includes(file.id));
  const table = (label: string, headers: string[], rows: { id: string; cells: unknown[]; evidence?: ReactNode[] }[]) => {
    const columns = headers.flatMap((header, index) => rows.some(row => hasValue(row.cells[index])) ? [{ header, index }] : []);
    if (!columns.length) return rows.flatMap(row => row.evidence ?? []);
    return <div className={styles.scroll} role="region" aria-label={label} tabIndex={0}>
      <table className={styles.table}><thead><tr>{columns.map(({ header }) => <th key={header} scope="col">{header}</th>)}</tr></thead>
        <tbody>{rows.map(row => <Fragment key={row.id}>
          {row.cells.some(hasValue) && <tr>{columns.map(({ header, index }) => <td key={header}>{hasValue(row.cells[index]) ? String(row.cells[index]) : ''}</td>)}</tr>}
          {!!row.evidence?.length && <tr><td colSpan={columns.length}>{row.evidence}</td></tr>}
        </Fragment>)}</tbody></table>
    </div>;
  };
  const chapter = (number: number, body: ReactNode) => <section id={`${id}-D${number}`} className={styles.section}>
    <h3>D{number} · {labels[number - 1]}</h3>{body}
  </section>;
  const containment = (heading: string, rows: typeof document.containment, scope?: string) => {
    const entries = rows.map(row => ({ id: row.id, cells: [row.group, row.location, row.quantity, row.ngQuantity, row.measure, row.owner, row.plannedAt, row.completion] }));
    return (entries.some(row => row.cells.some(hasValue)) || hasValue(scope)) && <><h4>{heading}</h4>{paragraph(scope)}
      {table(heading, [text('分组', 'Group'), text('位置', 'Location'), text('数量', 'Quantity'), text('不良数量', 'Defect quantity'),
        text('措施', 'Measure'), text('负责人', 'Owner'), text('计划日期', 'Planned date'), text('进展', 'Progress')], entries)}</>;
  };
  const causes = { OCCURRENCE: text('发生原因', 'Occurrence cause'), ESCAPE: text('流出原因', 'Escape cause'), SYSTEM: text('系统原因', 'System cause') };
  const tracking = document.effectTracking;
  const lessonFiles = document.lessonsLearnedFileIds ?? [];
  const teamColumns = [text('姓名', 'Name'), text('部门', 'Department'), text('职务', 'Job title'), text('职责分工', 'Responsibility'), text('协作范围', 'Collaboration scope'), text('组长', 'Team leader')];
  const listed = attachments.filter(file => file.rendering === 'LISTED');
  const purpose = (use: string) => use.replace(/^(D3 临时措施|D5 \/ D6 措施|D5 措施|D6 验证|D7 横展|D7 标准化) .+$/, '$1');
  return <>
    <nav className={styles.anchors} aria-label={text('8D 内容分区', '8D content sections')}>
      {labels.map((label, index) => <a key={label} href={`#${id}-D${index + 1}`}>D{index + 1}</a>)}
    </nav>
    {overview}
    {document.riskAssessment && facts([[text('风险判定说明', 'Risk assessment'), document.riskAssessment]])}
    {chapter(1, table(labels[0]!, teamColumns, (document.team ?? []).map(member => ({ id: member.id,
      cells: [member.name, member.department, member.jobTitle, member.responsibility, member.collaborationScope, member.isLeader ? text('组长', 'Team leader') : undefined],
    }))))}
    {chapter(2, <>
      {paragraph(document.description)}
      <div className={previewStyles.comparison}>{([[text('OK 图片', 'OK images'), document.okDescription, document.okFileIds],
        [text('NG 图片', 'NG images'), document.ngDescription, document.ngFileIds]] as const).map(([label, description, ids]) => {
        const evidence = files(ids);
        return (hasValue(description) || evidence.length > 0) && <div key={label}><h4>{label}</h4>{paragraph(description)}{evidence}</div>;
      })}</div>
    </>)}
    {chapter(3, <>
      {table(text('临时措施', 'Temporary measures'), [text('措施', 'Measure'), text('责任部门 / 人', 'Department / owner'), text('导入日期', 'Introduction date')],
        document.temporaryMeasures.map(row => ({ id: row.id, cells: [row.description, row.departmentOwner, row.introducedAt], evidence: files(row.fileIds) })))}
      {containment(text('围堵', 'Containment'), document.containment)}
      {containment(text('可选扩展围堵', 'Additional containment'), document.optionalAffectedContainment, document.optionalAffectedScope)}
    </>)}
    {chapter(4, <>
      {paragraph(document.analysisProcess)}
      {facts([[causes.OCCURRENCE, document.occurrenceCause], [causes.ESCAPE, document.escapeCause], [causes.SYSTEM, document.systemCause]])}
      {files(document.analysisFileIds)}
    </>)}
    {chapter(5, table(labels[4]!, [text('序号', 'No.'), text('原因类别', 'Cause category'), text('对策', 'Action'), text('负责人', 'Owner'), text('计划日期', 'Planned date')],
      document.correctiveActions.flatMap((row, index) => [row.action, row.owner, row.plannedAt].some(hasValue) || hasFiles(row.fileIds)
        ? [{ id: row.id, cells: [index + 1, causes[row.causeKind], row.action, row.owner, row.plannedAt], evidence: files(row.fileIds) }] : [])))}
    {chapter(6, <>
      {document.correctiveActions.map((row, index) => ([row.implementer, row.verifier, row.implementationAt, row.result, row.beforeState, row.afterState,
        row.firstBatch, row.followUpBatchCount, row.followUpDuration, row.verificationRecord, yesNo(row.effective)].some(hasValue) || hasFiles(row.verificationFileIds)) && <section key={row.id}>
        <h4>{text('措施', 'Action')} {index + 1} · {causes[row.causeKind]}</h4>
        {facts([[text('实施人', 'Implementer'), row.implementer], [text('验证人', 'Verifier'), row.verifier], [text('实施时间', 'Implementation time'), row.implementationAt],
          [text('实施结果', 'Implementation result'), row.result], [text('改善前', 'Before'), row.beforeState], [text('改善后', 'After'), row.afterState],
          [text('真实首批断点', 'First batch'), row.firstBatch], [text('后续批数', 'Follow-up batches'), row.followUpBatchCount], [text('跟踪时长', 'Follow-up duration'), row.followUpDuration],
          [text('验证记录', 'Verification record'), row.verificationRecord], [text('确认有效', 'Confirmed effective'), yesNo(row.effective)]])}
        {files(row.verificationFileIds)}
      </section>)}
      {tracking && Object.values(tracking).some(hasValue) && <><h4>{text('效果跟踪', 'Effect tracking')}</h4>{facts([
        [text('开始日期', 'Start date'), tracking.startDate], [text('开始订单号', 'Starting order'), tracking.startOrderNumber],
        [text('生产数量', 'Production quantity'), tracking.productionQuantity], [text('不良数量', 'Defect quantity'), tracking.defectQuantity],
        [text('确认结果', 'Confirmed result'), tracking.result], [text('判断', 'Judgment'), tracking.judgement],
      ])}</>}
    </>)}
    {chapter(7, <>
      {table(text('横向展开', 'Horizontal deployment'), [text('范围', 'Scope'), text('排查结果', 'Inspection result'), text('措施', 'Action'),
        text('负责人', 'Owner'), text('完成情况', 'Completion'), text('状态', 'Status')], document.horizontalDeployment.map(row => ({
        id: row.id, cells: [row.scope, row.inspectionResult, row.action, row.owner, row.completion, row.completed == null ? undefined
          : row.completed ? text('已完成', 'Completed') : text('未完成', 'Incomplete')], evidence: files(row.fileIds),
      })))}
      {table(text('标准化', 'Standardization'), [text('相关文件', 'Document'), text('需要更新', 'Needs update'), text('部门 / 主导者', 'Department / lead'),
        text('计划完成日期', 'Planned completion'), text('实际完成日期', 'Actual completion'), text('状态', 'Status'), text('补充说明', 'Notes')],
      document.standardization.flatMap(row => {
        const status = row.status === 'COMPLETED' ? text('已完成', 'Completed') : row.status === 'NOT_APPLICABLE' ? text('不适用', 'Not applicable') : undefined;
        const details = [yesNo(row.needsUpdate), row.departmentOwner, row.plannedAt, row.completedAt, status, row.reason];
        return details.some(hasValue) || hasFiles(row.fileIds ?? []) || row.key.startsWith('custom-') && hasValue(row.documentName)
          ? [{ id: row.id, cells: [row.documentName, ...details], evidence: files(row.fileIds ?? []) }] : [];
      }))}
    </>)}
    {chapter(8, <>{paragraph(document.closureSummary)}
      {([document.lessonsLearnedTitle, document.lessonsLearned, document.lessonsLearnedApplicability].some(hasValue) || hasFiles(lessonFiles)) && <>
        <h4>{text('经验教训', 'Lessons learned')}</h4>{hasValue(document.lessonsLearnedTitle) && <h5>{document.lessonsLearnedTitle}</h5>}
        {paragraph(document.lessonsLearned)}{facts([[text('经验适用简要说明', 'Applicability'), document.lessonsLearnedApplicability]])}{files(lessonFiles)}
      </>}
    </>)}
    {files(attachments.map(file => file.id))}
    {!!listed.length && <section className={styles.section}><h3>{text('版本附件', 'Version attachments')}</h3><ul className={previewStyles.fileList}>
      {listed.map(file => <ReportFile key={`${file.id}:${file.version}:${file.sha256}`} file={file} purpose={[...new Set(file.uses.map(purpose))].join(' · ')} />)}
    </ul></section>}
  </>;
}

export function EightDControlledReport({ report, read, download, domain = 'process' }: { report: EightDReport; domain?: InternalEightDDomain; read: EightDRead; download: (path: string) => Promise<void> }) {
  const text = useEightDText();
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
      <ReportCover report={controlled} title={title || controlled.reportNumber} severity={controlled.snapshot.problem.severity ?? controlled.snapshot.severity} />
      <EightDReportDocument document={controlled.snapshot.document} attachments={controlled.attachments}
        overview={<>
          <section><h3>{text('基本信息', 'Basic information')}</h3><ReportFacts entries={[
            [text('发起时间', 'Created at'), controlled.snapshot.problem.createdAt],
            [text('负责人', 'Owner'), controlled.snapshot.ownerName],
            [text('责任科室', 'Responsible section'), controlled.snapshot.responsibleSectionName],
            [text('分析计划', 'Analysis due'), controlled.snapshot.deadlines.analysisDueAt],
            [text('分析完成', 'Analysis completed'), controlled.snapshot.analysisCompletedAt],
            [text('完整提交计划', 'Submission due'), controlled.snapshot.deadlines.submissionDueAt],
            [text('完整提交时间', 'Submitted at'), controlled.snapshot.submittedAt],
            [text('关闭计划', 'Closure due'), controlled.snapshot.deadlines.closureDueAt],
            [text('实际关闭时间', 'Closed at'), controlled.snapshot.problem.closedAt],
          ]} /></section>
          <ReportSources sources={controlled.snapshot.sources} organizationId={report.organizationId} confirmations={record(controlled.snapshot).sourceConfirmations} />
        </>} />
      <ReportApproval report={controlled} />
    </article>}
  </div>;
}
