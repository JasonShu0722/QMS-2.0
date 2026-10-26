import { useEffect, useState, type ReactNode } from 'react';
import { Alert, Button, Checkbox, Modal, Spin } from 'antd';
import type { components } from '@qms/contracts';
import { EightDField } from './EightDDocumentEditor';
import { EightDAssignmentPicker } from './EightDAssignmentPicker';
import { EightDSourcePicker } from './EightDSourcePicker';
import { aborted, eightDPath, extensionPath, useEightDSeverityText, useEightDStyle, useEightDText, type EightDRead, type EightDReport, type EightDWrite, type EightDWriteBody } from './eight-d';
import styles from './eight-d.module.css';

export type EightDAction = 'submit' | 'analysis-complete' | 'collaborators' | 'reassign' | 'risk' | 'sources' | 'deadlines' | 'extension';
type Sources = Pick<components['schemas']['ProcessEightDSourcesDto'], 'add' | 'removeDefectIds' | 'primaryDefectId' | 'sourceConfirmations'>;
type Stage = components['schemas']['RequestWorkflowDeadlineExtensionDto']['stage'];
type Tasks = components['schemas']['ProcessEightDTaskPageDto'];
export function EightDActionDialog({ action, report, read, write, frozen, busy, recovery, onClose, onDirty, open = true, afterClose }: {
  action: EightDAction; report: EightDReport; read: EightDRead; write: EightDWrite; frozen: boolean; busy: boolean; recovery?: ReactNode; onClose: () => void; onDirty: () => void; open?: boolean; afterClose?: () => void;
}) {
  const text = useEightDText();
  const severityText = useEightDSeverityText();
  const css = useEightDStyle();
  const [reason, setReason] = useState('');
  const [severity, setSeverity] = useState(report.severity);
  const [cancelApproval, setCancelApproval] = useState(false);
  const [selected, setSelected] = useState<string[]>(action === 'collaborators' ? report.collaboratorUserIds : []);
  const [section, setSection] = useState('');
  const [submissionDueAt, setSubmissionDueAt] = useState('');
  const [analysisDueAt, setAnalysisDueAt] = useState('');
  const [closureDueAt, setClosureDueAt] = useState('');
  const [stage, setStage] = useState<Stage>('ANALYSIS');
  const [requestedDueAt, setRequestedDueAt] = useState('');
  const [sourceChange, setSourceChange] = useState<Sources>();
  const [tasks, setTasks] = useState<Tasks>();
  const [taskError, setTaskError] = useState(false);
  const [retry, setRetry] = useState(0);
  const disabled = frozen || busy;
  const titles: Record<EightDAction, string> = {
    submit: text('完整提交', 'Submit complete report'), 'analysis-complete': text('分析完成并设提交计划', 'Complete analysis and plan submission'),
    collaborators: text('维护协作者', 'Manage collaborators'), reassign: text('专业重派 / 科室内转派', 'Professional / within-section reassignment'),
    risk: text('调整风险', 'Change risk'), sources: text('调整来源', 'Change sources'), deadlines: text('设置期限', 'Set deadlines'), extension: text('申请延期', 'Request extension'),
  };
  const reviewChange = (action === 'risk' || action === 'sources') && report.status === 'IN_REVIEW';
  const requestTask = tasks?.items.find(task => task.problemId === report.problemId && task.actions.includes('REQUEST_EXTENSION'));
  useEffect(() => {
    if (action !== 'extension') return;
    let active = true; setTasks(undefined); setTaskError(false);
    read<Tasks>(`/api/v1/process-quality/eight-d/tasks?problemId=${encodeURIComponent(report.problemId)}&pageSize=100&offset=0`).then(result => {
      if (!active) return;
      setTasks(result);
      const task = result.items.find(item => item.problemId === report.problemId && item.actions.includes('REQUEST_EXTENSION'));
      if (task?.extensionStages[0]) setStage(task.extensionStages[0]);
    }).catch(cause => { if (active && !aborted(cause)) setTaskError(true); });
    return () => { active = false; };
  }, [action, report.problemId, read, retry]);
  const datetime = (label: string, value: string, change: (value: string) => void, required = false) => <EightDField label={label}><input type="datetime-local" required={required} disabled={disabled} value={value} onChange={event => { onDirty(); change(event.target.value); }} /></EightDField>;
  async function submit() {
    if (disabled) return;
    const base = { organizationId: report.organizationId, expectedVersion: report.version };
    let body: EightDWriteBody;
    const date = (value: string) => new Date(value).toISOString();
    switch (action) {
      case 'submit': body = base; break;
      case 'analysis-complete': body = { ...base, submissionDueAt: date(submissionDueAt) }; break;
      case 'collaborators': body = { ...base, userIds: selected }; break;
      case 'reassign': body = { ...base, ownerUserId: selected[0], responsibleSectionDepartmentId: section, reason }; break;
      case 'risk': body = { ...base, severity, reason, confirmCancelApproval: cancelApproval }; break;
      case 'sources': if (!sourceChange) return; body = { ...base, ...sourceChange, reason, confirmCancelApproval: cancelApproval }; break;
      case 'deadlines': body = { ...base, ...(analysisDueAt ? { analysisDueAt: date(analysisDueAt) } : {}), ...(closureDueAt ? { closureDueAt: date(closureDueAt) } : {}) }; break;
      case 'extension':
        if (!requestTask?.extensionStages.includes(stage) || requestTask.rowVersion !== report.version || requestTask.instanceVersion !== report.instanceVersion) return;
        body = { expectedRowVersion: report.version, expectedInstanceVersion: report.instanceVersion, stage, requestedDueAt: date(requestedDueAt), reason };
        break;
    }
    await write(action === 'extension' ? extensionPath(report.problemId) : `${eightDPath(report.problemId)}/${action}`, ['submit', 'analysis-complete', 'extension'].includes(action) ? 'POST' : 'PUT', body);
  }
  const valid = !reviewChange || cancelApproval;
  const validAction = action === 'reassign' ? !!selected[0] && !!section
    : action === 'sources' ? !!sourceChange
      : action === 'deadlines' ? !!analysisDueAt || !!closureDueAt
        : action === 'extension' ? !!requestTask?.extensionStages.includes(stage) && requestTask.rowVersion === report.version && requestTask.instanceVersion === report.instanceVersion : true;
  return <Modal open={open} afterClose={afterClose} focusable={{ focusTriggerAfterClose: open }} title={`${report.reportNumber} · ${titles[action]}`} onCancel={() => { if (!disabled) onClose(); }} footer={null} closable={!disabled} mask={{ closable: false }} keyboard={!disabled} width={720}>
    <form style={css} className={styles.modal} onChange={onDirty} onSubmit={event => { event.preventDefault(); if (valid && validAction) void submit(); }}>
      {recovery}
      <p>{text('固定内容版本', 'Fixed content version')} {report.contentVersion} · {text('记录版本', 'Row version')} {report.version}</p>
      {action === 'submit' && <Alert type="info" title={text('只有负责人可提交。提交前由服务端检查发生 / 流出措施实施及人工有效结论；D2–D8不是八道审批。', 'Only the owner may submit. The server verifies occurrence / escape actions and human effectiveness decisions. D2–D8 are not eight approval stages.')} />}
      {action === 'analysis-complete' && <>{datetime(text('完整提交计划', 'Planned complete submission'), submissionDueAt, setSubmissionDueAt, true)}<p>{text('确认分析与对策计划已完成；完整实施及验证仍须在正式提交前完成。', 'Confirm analysis and corrective plans are complete. Implementation and verification are still required before final submission.')}</p></>}
      {(action === 'collaborators' || action === 'reassign') && <EightDAssignmentPicker report={report} read={read} collaborators={action === 'collaborators'} disabled={disabled} section={section} onSection={value => { onDirty(); setSection(value); }} selected={selected} onSelect={value => { onDirty(); setSelected(value); }} />}
      {action === 'risk' && <EightDField label={text('风险等级', 'Risk level')}><select disabled={disabled} value={severity} onChange={event => setSeverity(event.target.value as typeof severity)}><option value="LOW">{severityText('LOW')}</option><option value="MEDIUM">{severityText('MEDIUM')}</option><option value="HIGH">{severityText('HIGH')}</option><option value="CRITICAL">{severityText('CRITICAL')}</option></select></EightDField>}
      {action === 'sources' && <EightDSourcePicker report={report} read={read} disabled={disabled} onChange={setSourceChange} />}
      {action === 'deadlines' && <><p>{text('不猜默认天数，显式选择日期。原期限在延期全部通过前不改变。', 'Choose explicit dates; no default days are inferred. Existing deadlines stay in force until an extension is fully approved.')}</p>{datetime(text('分析 / 对策期限', 'Analysis / countermeasure deadline'), analysisDueAt, setAnalysisDueAt)}{datetime(text('关闭计划', 'Planned closure'), closureDueAt, setClosureDueAt)}</>}
      {action === 'extension' && <>{!tasks && !taskError ? <Spin /> : null}{taskError ? <Alert type="error" title={text('延期资格加载失败', 'Extension eligibility could not be loaded')} action={<Button onClick={() => setRetry(value => value + 1)}>{text('重试', 'Retry')}</Button>} /> : null}
        {tasks && !requestTask ? <Alert type="info" title={text('当前无可申请延期阶段', 'No eligible extension stages')} /> : null}
        <EightDField label={text('延期阶段', 'Extension stage')}><select disabled={disabled || !requestTask} value={stage} onChange={event => setStage(event.target.value as Stage)}>{requestTask?.extensionStages.map(item => <option key={item} value={item}>{item === 'ANALYSIS' ? text('分析', 'Analysis') : item === 'SUBMISSION' ? text('完整提交', 'Submission') : text('关闭', 'Closure')}</option>)}</select></EightDField>
        {datetime(text('申请新期限', 'Requested deadline'), requestedDueAt, setRequestedDueAt, true)}
        <Alert type="info" title={text('上级 → 质量侧依次审批。同人仅跳上级并留痕，不跳质量侧；原期限不暂停。', 'Leader → quality review in sequence. Same-person leader review is skipped with an audit record, never quality review. The original deadline remains active.')} />
      </>}
      {['reassign', 'risk', 'sources', 'extension'].includes(action) && <EightDField label={text('变更 / 申请理由', 'Change / request reason')}><textarea required disabled={disabled} maxLength={2000} value={reason} onChange={event => setReason(event.target.value)} /></EightDField>}
      {reviewChange && <><Alert type="warning" title={text('本次变更须取消整轮审批，两侧既有意见保留为历史；取消此对话框不写入。', 'This change must cancel the entire approval round. Both sides remain in history. Cancelling this dialog makes no change.')} /><Checkbox checked={cancelApproval} disabled={disabled} onChange={event => { onDirty(); setCancelApproval(event.target.checked); }}>{text('我确认取消当前整轮审批后变更', 'I confirm cancellation of the current approval round before changing')}</Checkbox></>}
      <div><Button aria-label={text('取消', 'Cancel')} disabled={disabled} onClick={onClose}>{text('取消', 'Cancel')}</Button> <Button htmlType="submit" type="primary" loading={busy} disabled={disabled || !valid || !validAction}>{text('确认提交', 'Confirm')}</Button></div>
    </form>
  </Modal>;
}
