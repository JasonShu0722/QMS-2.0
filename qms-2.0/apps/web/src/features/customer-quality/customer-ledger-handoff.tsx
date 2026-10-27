import { Alert, Button, Input, Modal } from 'antd';
import { useRef, useState } from 'react';
import { ApiError } from '../../api/client';
import { useNavigationBusy, useNavigationGuard, useUnsavedChanges } from '../../layouts/UnsavedChanges';
import { candidateLabel, LedgerError, ledgerBase, type LedgerCandidate, type LedgerDetail, type LedgerItem } from './customer-ledger-ui';
import { ledgerDenied, useCustomerLedgerWrite } from './customer-ledger-write';

type Props = {
  record: LedgerDetail; candidates: LedgerCandidate[]; permissions: string[]; organizationId?: string;
  readOnly?: boolean; sourcePending?: boolean; canDispatch?: () => boolean;
  onDenied: (cause: unknown) => void; onSaved: (record: LedgerItem) => void;
  refreshDetail: () => Promise<LedgerDetail | undefined>;
};

function eligible(record: LedgerDetail, permissions: string[], readOnly?: boolean) {
  return !readOnly && !!record.qualityEngineerId?.trim()
    && record.warnings.some(warning => warning.code === 'ENGINEER_NO_LONGER_ELIGIBLE')
    && ['read', 'write', 'reassign'].every(action => permissions.includes(`customer-quality:complaints:${action}`))
    && (record.status !== 'CLOSED' || permissions.includes('customer-quality:complaints:closed-edit'));
}

export function CustomerLedgerHandoff(props: Props) {
  const [open, setOpen] = useState(false);
  const guard = useNavigationGuard();
  if (!eligible(props.record, props.permissions, props.readOnly)) return null;
  return <>
    <Button onClick={() => guard(() => setOpen(true))}>交接失效跟进人</Button>
    {open ? <HandoffDialog key={`${props.record.organizationId}:${props.record.id}`} {...props} onClose={() => setOpen(false)} /> : null}
  </>;
}

function HandoffDialog({ record, candidates, permissions, organizationId, readOnly, sourcePending = false, canDispatch, onDenied, onSaved, refreshDetail, onClose }: Props & { onClose: () => void }) {
  const [assignment, setAssignment] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<unknown>();
  const [conflict, setConflict] = useState(false);
  const [latest, setLatest] = useState<LedgerDetail>();
  const [confirmed, setConfirmed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [discard, setDiscard] = useState(false);
  const [version] = useState(record.version);
  const writer = useCustomerLedgerWrite(cause => { onClose(); onDenied(cause); });
  const live = useRef<() => boolean>(() => true);
  live.current = () => !sourcePending && canDispatch?.() !== false && eligible(latest ?? record, permissions, readOnly);
  const valid = candidates.some(candidate => !!candidate.assignmentId && candidate.assignmentId === assignment)
    && !!reason.trim() && reason.length <= 10000 && !reason.includes('\0');
  const blocked = writer.busy || refreshing;
  useUnsavedChanges(!!assignment || !!reason || writer.uncertain);
  useNavigationBusy(blocked);

  function close() {
    if (blocked) return;
    // Local dismissal must not wait for, or discard, a sibling attachment upload.
    if (assignment || reason || writer.uncertain) setDiscard(true); else onClose();
  }
  async function reload() {
    if (blocked || writer.uncertain) return;
    setRefreshing(true); setError(undefined); setConfirmed(false); setLatest(undefined);
    try {
      const value = await refreshDetail();
      if (writer.signal().aborted) return;
      if (!value || value.id !== record.id || value.organizationId !== record.organizationId || value.version < version) throw new Error('未能读取同一记录的最新版本，请重试。');
      setLatest(value);
    } catch (cause) {
      if (!writer.signal().aborted) {
        if (ledgerDenied(cause)) { onClose(); onDenied(cause); }
        else setError(cause);
      }
    } finally { if (!writer.signal().aborted) setRefreshing(false); }
  }
  async function save() {
    if (blocked || !valid || !live.current() || (conflict && (!latest || !confirmed))) return;
    setError(undefined);
    try {
      const value = await writer.write<LedgerItem>(`${ledgerBase}/${record.id}/reassign`, {
        organizationId, expectedVersion: latest?.version ?? version, qualityEngineerAssignmentId: assignment, reason,
      }, 'POST', () => live.current());
      onClose(); onSaved(value);
    } catch (cause) {
      if (writer.signal().aborted || ledgerDenied(cause)) return;
      setError(cause);
      if (cause instanceof ApiError && cause.status === 409) { setConflict(true); setLatest(undefined); setConfirmed(false); }
    }
  }
  return <>
    <Modal open title="交接失效跟进人" onCancel={close} closable={!blocked} keyboard={!blocked} mask={{ closable: !blocked }} footer={<div className="qms-dialog-actions">
      <Button aria-label="取消" onClick={close} disabled={blocked}>取消</Button>
      <Button aria-label={writer.uncertain ? '核对并重试原请求' : '确认交接'} type="primary" loading={writer.busy} disabled={refreshing || !valid || sourcePending || (conflict && (!latest || !confirmed)) || !eligible(latest ?? record, permissions, readOnly)} onClick={() => void save()}>{writer.uncertain ? '核对并重试原请求' : '确认交接'}</Button>
    </div>}>
      <LedgerError cause={error} />
      {writer.uncertain ? <Alert type="warning" showIcon title="上次交接结果未知，草稿已锁定；核对并重试原请求将使用原文和同一幂等键。" /> : null}
      {conflict ? <section aria-label="交接冲突核对">
        <Alert type="warning" showIcon title="记录已变化，草稿保留。请读取最新记录并核对后继续交接。" />
        <Button loading={refreshing} disabled={writer.busy} onClick={() => void reload()}>读取最新记录</Button>
        {latest ? <>
          <p>服务器版本：{latest.version}；当前跟进人：{latest.qualityEngineerId ?? '待分配'}；当前任职：{latest.qualityEngineerAssignmentId ?? '未分配'}</p>
          <label><input type="checkbox" aria-label="确认基于最新记录继续交接" checked={confirmed} disabled={blocked} onChange={event => setConfirmed(event.target.checked)} />确认基于最新记录继续交接</label>
        </> : null}
      </section> : null}
      <fieldset className="customer-ledger-form" disabled={blocked || writer.uncertain}>
        <label><span>接任质量工程师</span><select aria-label="接任质量工程师" value={assignment} onChange={event => { setAssignment(event.target.value); setConfirmed(false); }}>
          <option value="">请选择实际任职</option>{candidates.filter(candidate => !!candidate.assignmentId).map(candidate => <option key={candidate.assignmentId} value={candidate.assignmentId}>{candidateLabel(candidate)}</option>)}
        </select></label>
        <label className="customer-ledger-form-wide"><span>交接原因</span><Input.TextArea aria-label="交接原因" rows={4} value={reason} onChange={event => { setReason(event.target.value); setConfirmed(false); }} /></label>
      </fieldset>
    </Modal>
    <Modal open={discard} title="放弃交接修改？" okText="放弃修改并关闭" cancelText="继续编辑" okButtonProps={{ danger: true }} onCancel={() => setDiscard(false)} onOk={onClose} />
  </>;
}
