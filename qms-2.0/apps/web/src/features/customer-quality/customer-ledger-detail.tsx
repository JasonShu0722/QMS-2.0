import type { components } from '@qms/contracts';
import { Alert, Button, Descriptions, Input, Modal, Space, Table, Tag, Typography } from 'antd';
import { useCallback, useRef, useState, type ReactNode } from 'react';
import { ApiError } from '../../api/client';
import { useNavigationBusy, useNavigationGuard, useUnsavedChanges } from '../../layouts/UnsavedChanges';
import { ledgerFields, rawText } from './customer-ledger-import';
import { CustomerLedgerEditor } from './customer-ledger-editor';
import { CustomerLedgerSourceAttachments } from './customer-ledger-source-attachments';
import { CustomerLedgerHandoff } from './customer-ledger-handoff';
import { LedgerConflicts, LedgerError, LedgerWarnings, ledgerBase, ledgerChanges, ledgerConflicts, stageLabel, typeLabel, type LedgerConflict, type LedgerCandidate, type LedgerDetail, type LedgerItem } from './customer-ledger-ui';
import { useCustomerLedgerWrite } from './customer-ledger-write';

export function CustomerLedgerDetail({ record, candidates, customers = [], userId, permissions, organizationId, onDenied, onSaved, refreshDetail, renderAnalysis }: {
  record: LedgerDetail; candidates: LedgerCandidate[]; userId?: string; permissions: string[]; organizationId?: string;
  customers?: components['schemas']['CustomerMasterDto'][];
  onDenied: (cause: unknown) => void; onSaved: (record: LedgerItem) => void; refreshDetail: () => Promise<LedgerDetail | undefined>;
  renderAnalysis?: (complaintId: string, onDenied: (cause: unknown) => void, sourceRecord: LedgerDetail) => ReactNode;
}) {
  const [editing, setEditing] = useState(false);
  const [action, setAction] = useState<'receiving' | 'close' | 'reopen'>();
  const [courier, setCourier] = useState(''); const [received, setReceived] = useState(''); const [note, setNote] = useState('');
  const [version, setVersion] = useState<number | undefined>(record.version);
  const [receivingBaseline, setReceivingBaseline] = useState({ courierNumber: record.courierNumber ?? '', receivedOn: record.receivedOn ?? '' });
  const [conflicts, setConflicts] = useState<LedgerConflict[]>([]); const [confirmed, setConfirmed] = useState(false);
  const [dirty, setDirty] = useState(false); const [error, setError] = useState<unknown>(); const [conflict, setConflict] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [sourcePending, setSourcePending] = useState(false);
  const sourcePendingRef = useRef(false);
  const sourceChanged = useCallback((pending: boolean) => { sourcePendingRef.current = pending; setSourcePending(pending); }, []);
  const writer = useCustomerLedgerWrite(onDenied);
  const requestLeave = useNavigationGuard();
  useUnsavedChanges(dirty || writer.uncertain); useNavigationBusy(writer.busy || refreshing);
  const archived = record.archived === true || record.legacyStatus === 'ARCHIVED';
  const featureWrite = permissions.includes('customer-quality:complaints:write');
  const assigned = candidates.find(candidate => candidate.assignmentId === record.qualityEngineerAssignmentId && candidate.userId === record.qualityEngineerId);
  const corresponding = !!userId && record.qualityEngineerId === userId && !!assigned && !record.warnings.some(warning => warning.code === 'ENGINEER_NO_LONGER_ELIGIBLE');
  const candidateOptions = record.stage === 'NEW_PRODUCT' ? candidates.filter(candidate => candidate.projectQualified !== false) : candidates;
  const canEdit = !archived && featureWrite && (corresponding || (!record.qualityEngineerId && record.registeredByUserId === userId && record.status !== 'CLOSED')) && (record.status !== 'CLOSED' || permissions.includes('customer-quality:complaints:closed-edit'));
  const canReceive = !archived && featureWrite && !!userId && (corresponding || record.registeredByUserId === userId);
  const canClose = !archived && featureWrite && corresponding && permissions.includes('customer-quality:complaints:close');
  const actionAllowed = action === 'receiving' ? canReceive : canClose;
  const live = useRef({ canEdit, actionAllowed });
  live.current = { canEdit, actionAllowed };
  const conflictPending = !!conflicts.length && !confirmed;
  function start(next: NonNullable<typeof action>) {
    requestLeave(() => { writer.discard(); setAction(next); setVersion(record.version); setCourier(record.courierNumber ?? ''); setReceived(record.receivedOn ?? ''); setReceivingBaseline({ courierNumber: record.courierNumber ?? '', receivedOn: record.receivedOn ?? '' }); setConflicts([]); setConfirmed(false); setNote(''); setError(undefined); setConflict(false); setDirty(false); });
  }
  function closeAction() { if (!writer.busy && !refreshing) requestLeave(() => { writer.discard(); setAction(undefined); setDirty(false); }, true); }
  async function refreshVersion() {
    setRefreshing(true);
    try {
      const latest = await refreshDetail();
      if (latest && !writer.signal().aborted) {
        if (action === 'receiving') {
          const local = { courierNumber: courier, receivedOn: received };
          const fresh = { courierNumber: latest.courierNumber ?? '', receivedOn: latest.receivedOn ?? '' };
          const rebased = { ...fresh, ...ledgerChanges(receivingBaseline, local) };
          setConflicts(ledgerConflicts(receivingBaseline, local, fresh)); setConfirmed(false);
          setCourier(rebased.courierNumber); setReceived(rebased.receivedOn); setReceivingBaseline(fresh);
        }
        setVersion(latest.version); setConflict(true);
      }
    }
    catch (refreshError) { if (!writer.signal().aborted) setError(refreshError); }
    finally { if (!writer.signal().aborted) setRefreshing(false); }
  }
  async function saveAction() {
    if (!action || !live.current.actionAllowed || writer.busy || refreshing || conflictPending || version === undefined || (action !== 'receiving' && (!note.trim() || sourcePendingRef.current))) return;
    setError(undefined);
    try {
      const changes = ledgerChanges(receivingBaseline, { courierNumber: courier, receivedOn: received });
      const value = action === 'receiving'
        ? await writer.write<LedgerItem>(`${ledgerBase}/${record.id}/receiving`, { organizationId, expectedVersion: version, ...('courierNumber' in changes ? { courierNumber: courier || null } : {}), ...('receivedOn' in changes ? { receivedOn: received || null } : {}) }, 'PUT', () => live.current.actionAllowed)
        : await writer.write<LedgerItem>(`${ledgerBase}/${record.id}/${action}`, { organizationId, expectedVersion: version, note }, 'POST', () => live.current.actionAllowed && !sourcePendingRef.current);
      setDirty(false); setAction(undefined); onSaved(value);
    } catch (cause) {
      if (writer.signal().aborted) return;
      setError(cause);
      if (cause instanceof ApiError && cause.status === 409) {
        setVersion(undefined); await refreshVersion();
      }
    }
  }
  return <section className="customer-quality-card customer-ledger-detail" aria-label="客诉详情">
    <header className="customer-quality-heading"><div><Typography.Title level={2}>{record.complaintNumber}</Typography.Title><Space><Tag>{typeLabel(record.normalized.complaintType)}</Tag><Tag>{stageLabel(record.stage)}</Tag><Tag>{record.status === 'CLOSED' ? '已关闭' : '跟进中'}</Tag><LedgerWarnings warnings={record.warnings} raw={record.raw} label={record.complaintNumber} /></Space></div><Space wrap>
      {canEdit ? <Button aria-label="编辑台账" onClick={() => requestLeave(() => { writer.discard(); setAction(undefined); setDirty(false); setEditing(true); })}>编辑台账</Button> : null}
      {canReceive ? <Button aria-label="维护收件" onClick={() => start('receiving')}>维护收件</Button> : null}
      {canClose ? <Button aria-label={record.status === 'CLOSED' ? '恢复跟进' : '关闭台账'} onClick={() => start(record.status === 'CLOSED' ? 'reopen' : 'close')}>{record.status === 'CLOSED' ? '恢复跟进' : '关闭台账'}</Button> : null}
    </Space></header>
    <CustomerLedgerHandoff record={record} candidates={candidateOptions} permissions={permissions} organizationId={organizationId}
      sourcePending={sourcePending} canDispatch={() => !sourcePendingRef.current} onDenied={onDenied} onSaved={onSaved} refreshDetail={refreshDetail} />
    <Descriptions column={{ xs: 1, sm: 2, lg: 3 }} items={[
      { key: 'engineer', label: '实际跟进质量工程师', children: assigned?.fullName || assigned?.username || (record.qualityEngineerId ? `原跟进人 ${record.qualityEngineerId}（当前任职不可用）` : '待分配') },
      { key: 'source', label: '人员来源', children: record.qualityEngineerSource === 'MANUAL' ? '人工指定' : record.qualityEngineerSource === 'MAPPING' ? '映射带出' : '未分配' },
      { key: 'project', label: '映射项目', children: record.mapping?.project ? `${record.mapping.project.code} · ${record.mapping.project.name}` : '未检索到映射关系' },
      { key: 'category', label: '产品大类 / 细分', children: `${record.mapping?.mapping?.productCategory ?? '待匹配'} / ${record.mapping?.mapping?.productSubcategory ?? '待匹配'}` },
      { key: 'quantity', label: '登记件数', children: record.normalized.quantity ?? '待补正' },
      { key: 'mileage', label: '故障里程分档', children: record.mileageBand ?? '未计算' },
      { key: 'months', label: '服务月数', children: record.serviceMonths ?? '未计算' }, { key: 'mis', label: 'MIS', children: record.misTag ?? '未计算' },
      { key: 'courier', label: '快递单号', children: record.courierNumber ?? '未填写' }, { key: 'received', label: '收件日期', children: record.receivedOn ?? '未填写' },
      { key: 'closed', label: '关闭时间', children: record.closedAt ?? '未关闭' }, { key: 'closer', label: '关闭人', children: record.closedByUserId ?? '—' },
      { key: 'investigation', label: '调查情况', children: record.normalized.investigation ?? '未填写' },
      { key: 'conclusion', label: '调查结论 / 关闭结果', children: record.closureNote ?? '未填写' },
    ]} />
    <details><summary>登记事实与原填写（含待补正值）</summary><dl className="customer-ledger-facts">{ledgerFields.map(([key, label]) => <div key={key}><dt>{label}</dt><dd><span>规范值：{rawText(record.normalized[key]) || '未填写 / 待补正'}</span><span className="customer-ledger-raw">原填写：{rawText(record.raw[key]) || '（空）'}</span></dd></div>)}</dl></details>
    <Alert type="info" title="台账两态与 8D 独立；收件、解析和台账关闭均不自动发单或变更 8D。完整多来源 8D 在后续交付单元接入。" />
    <CustomerLedgerSourceAttachments recordId={record.id} organizationId={organizationId} readOnly={!canEdit} onDenied={onDenied} onPendingChange={sourceChanged} />
    {renderAnalysis?.(record.id, onDenied, record)}
    <details><summary>台账历史（{record.history.length}）</summary><Table<components['schemas']['CustomerLedgerEventDto']> rowKey="id" dataSource={record.history} size="small" pagination={{ pageSize: 10 }} scroll={{ x: 650 }} columns={[
      { title: '时间', dataIndex: 'createdAt' }, { title: '事件', dataIndex: 'eventType' }, { title: '原状态', dataIndex: 'fromStatus' }, { title: '后状态', dataIndex: 'toStatus' }, { title: '操作人', dataIndex: 'actorUserId' }, { title: '说明', dataIndex: 'note' },
    ]} /></details>
    {editing && !archived ? <CustomerLedgerEditor record={record} organizationId={organizationId} candidates={candidateOptions} customers={customers} canInvestigate={corresponding} sourcePending={sourcePending} canDispatch={() => live.current.canEdit && !sourcePendingRef.current} onDenied={onDenied} onSaved={value => { setEditing(false); onSaved(value); }} onClose={() => setEditing(false)} refreshDetail={refreshDetail} /> : null}
    <Modal open={!!action} title={action === 'receiving' ? '维护收件' : action === 'close' ? '关闭台账' : '恢复跟进'} onCancel={closeAction} closable={!writer.busy} keyboard={!writer.busy} mask={{ closable: !writer.busy }} footer={<div className="qms-dialog-actions"><Button disabled={writer.busy || refreshing} onClick={closeAction}>取消</Button><Button aria-label="保存台账动作" type="primary" loading={writer.busy} disabled={!actionAllowed || refreshing || conflictPending || version === undefined || action !== 'receiving' && (!note.trim() || sourcePending)} onClick={() => void saveAction()}>{writer.uncertain ? '核对并重试原请求' : '保存'}</Button></div>}>
      <LedgerError cause={error} />{conflict ? <Alert type="warning" title="已刷新服务器版本，草稿保留；请核对后重新保存。" /> : null}
      <LedgerConflicts conflicts={conflicts} confirmed={confirmed} onConfirm={setConfirmed} disabled={writer.busy || writer.uncertain || refreshing} />
      {version === undefined ? <Button onClick={() => void refreshVersion()} loading={refreshing}>重试读取最新版本</Button> : null}
      {writer.uncertain ? <Alert type="warning" title="保存结果未知，输入已锁定，重试原请求以核对结果。取消并确认放弃仅清除本地请求，不会撤销服务端已执行的操作；请刷新核对最新记录，后续保存仍受版本校验保护。" /> : null}
      <fieldset className="customer-ledger-form" disabled={!actionAllowed || writer.busy || writer.uncertain || refreshing}>
        {action === 'receiving' ? <><label><span>快递单号</span><Input aria-label="快递单号" value={courier} onChange={event => { setCourier(event.target.value); setConfirmed(false); setDirty(true); }} /></label><label><span>收件日期</span><Input aria-label="收件日期" type="date" value={received} onChange={event => { setReceived(event.target.value); setConfirmed(false); setDirty(true); }} /></label></> : <label className="customer-ledger-form-wide"><span>{action === 'close' ? '调查结论 / 关闭结果' : '恢复原因'}</span><Input.TextArea aria-label={action === 'close' ? '调查结论 / 关闭结果' : '恢复原因'} rows={4} value={note} onChange={event => { setNote(event.target.value); setDirty(true); }} /></label>}
      </fieldset>
    </Modal>
  </section>;
}
