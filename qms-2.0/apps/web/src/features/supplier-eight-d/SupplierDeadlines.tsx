import { useEffect, useState } from 'react';
import { Alert, Button, Space, Spin, Tag } from 'antd';
import type { components } from '@qms/contracts';
import { EightDField } from '../process-eight-d/EightDDocumentEditor';
import { aborted, useEightDText, type EightDRead } from '../process-eight-d/eight-d';
import type { SupplierCommand, SupplierReport } from './supplier-eight-d';

type Extension = components['schemas']['SupplierEightDDeadlineResultDto'];
type Request = components['schemas']['SupplierEightDDeadlineRequestDto'];
export function SupplierDeadlines({ report, base, portal, read, command, blocked, onDirty }: { report: SupplierReport; base: string; portal: boolean; read: EightDRead; command: SupplierCommand; blocked: boolean; onDirty: (dirty: boolean) => void }) {
  const text = useEightDText();
  const [items, setItems] = useState<Extension[]>();
  const [error, setError] = useState(false);
  const [revision, setRevision] = useState(0);
  const [stage, setStage] = useState<Request['stage']>('ANALYSIS');
  const [date, setDate] = useState('');
  const [reason, setReason] = useState('');
  const [comment, setComment] = useState('');
  useEffect(() => {
    const controller = new AbortController(); setError(false); setItems(undefined);
    read<Extension[]>(`${base}/deadline-extensions`, { signal: controller.signal }).then(value => { if (!controller.signal.aborted) setItems(value); }).catch(cause => { if (!controller.signal.aborted && !aborted(cause)) setError(true); });
    return () => controller.abort();
  }, [base, read, revision, report.rowVersion]);
  return <>
    <h3>{text('供应商专用延期', 'Supplier deadline extensions')}</h3>
    {portal && <p>{text('低 / 中风险由SQE审核；高 / 重大风险先SQE、后经理。同人也须分两阶段确认；申请不暂停原期限，最终批准后才生效。', 'Low / medium: SQE review. High / critical: SQE then manager, including separate confirmation when the same person holds both duties. Requests do not pause deadlines; only final approval applies the new date.')}</p>}
    <Button disabled={blocked} onClick={() => setRevision(value => value + 1)}>{text('刷新延期历史', 'Refresh extension history')}</Button>
    {report.allowedActions.includes('request-extension') && <fieldset disabled={blocked}>
      <EightDField label={text('延期阶段', 'Extension stage')}><select value={stage} onChange={event => { setStage(event.target.value as Request['stage']); onDirty(true); }}><option value="ANALYSIS">{text('分析', 'Analysis')}</option><option value="SUBMISSION">{text('完整提交', 'Submission')}</option><option value="CLOSURE">{text('关闭', 'Closure')}</option></select></EightDField>
      <EightDField label={text('申请到期时间', 'Requested due time')}><input type="datetime-local" value={date} onChange={event => { setDate(event.target.value); onDirty(true); }} /></EightDField>
      <EightDField label={text('延期理由', 'Extension reason')}><textarea maxLength={2000} value={reason} onChange={event => { setReason(event.target.value); onDirty(true); }} /></EightDField>
      {!portal && <p>{text('批准前原期限继续有效。', 'The original deadline remains active until approval.')}</p>}
      <Button disabled={blocked || !date || !reason.trim()} onClick={() => void command(`${base}/deadline-extensions`, 'POST', { expectedRowVersion: report.rowVersion, expectedContentVersion: report.contentVersion, expectedInstanceVersion: report.instanceVersion, stage, requestedDueAt: new Date(date).toISOString(), reason })}>{text('提交延期申请', 'Request extension')}</Button>
    </fieldset>}
    {error ? <Alert type="error" title={text('延期历史加载失败，请重试。', 'Extension history failed. Retry.')} /> : !items ? <Spin /> : !items.length ? <p>{text('暂无延期申请', 'No extension requests')}</p> : <>
      <EightDField label={text('延期处理意见', 'Extension decision comment')}><textarea disabled={blocked} maxLength={2000} value={comment} onChange={event => { setComment(event.target.value); onDirty(true); }} /></EightDField>
      {items.map(item => {
        const actions = item.allowedActions ?? [];
        return <article key={item.id}><h4>{item.stage} · <Tag>{item.status}</Tag></h4><p>{item.originalDueAt} → {item.requestedDueAt}</p><p>{item.reason}</p>{item.originallyOverdue && <Tag>{text('原期限已超期', 'Originally overdue')}</Tag>}
          {!portal && actions.some(action => ['approve-sqe', 'return-sqe', 'approve-manager', 'return-manager'].includes(action)) && <p>{text('批准前原期限继续有效。', 'The original deadline remains active until approval.')}</p>}
          <Space wrap>{!portal && (['SQE', 'MANAGER'] as const).flatMap(duty => (['APPROVE', 'RETURN'] as const).map(decision => {
            const action = `${decision.toLowerCase()}-${duty.toLowerCase()}`;
            return actions.some(allowed => allowed === action) && <Button key={action} disabled={blocked || !comment.trim()} onClick={() => void command(`${base}/deadline-extensions/${encodeURIComponent(item.id)}/decide`, 'POST', { expectedVersion: item.version, duty, decision, comment })}>{duty === 'SQE' ? 'SQE' : text('经理', 'Manager')} · {decision === 'APPROVE' ? text('同意延期', 'Approve extension') : text('退回延期', 'Return extension')}</Button>;
          }))}{actions.includes('cancel') && <Button disabled={blocked || !comment.trim()} onClick={() => void command(`${base}/deadline-extensions/${encodeURIComponent(item.id)}/cancel`, 'POST', { expectedVersion: item.version, comment })}>{text('取消延期申请', 'Cancel extension request')}</Button>}</Space>
        </article>;
      })}
    </>}
  </>;
}
