import type { components } from '@qms/contracts';
import { Alert, Button, Input, Modal } from 'antd';
import { useState } from 'react';
import { ApiError } from '../../api/client';
import { useNavigationBusy, useNavigationGuard, useUnsavedChanges } from '../../layouts/UnsavedChanges';
import { ledgerFields, rawText, type LedgerFields } from './customer-ledger-import';
import { candidateLabel, LedgerConflicts, LedgerError, ledgerBase, ledgerChanges, ledgerConflicts, type LedgerConflict, type LedgerCandidate, type LedgerDetail, type LedgerItem } from './customer-ledger-ui';
import { useCustomerLedgerWrite } from './customer-ledger-write';

const choices: Partial<Record<keyof LedgerFields, readonly (readonly [string, string])[]>> = {
  complaintType: [['ZERO_KM', '零公里'], ['AFTER_SALES', '售后']],
  serviceMode: [['远程指导', '远程指导'], ['现场现调', '现场现调'], ['未接到通知', '未接到通知']],
  interceptionStatus: [['是，已发备件', '是，已发备件'], ['否，索赔件', '否，索赔件'], ['否，不索赔', '否，不索赔']],
};

export function CustomerLedgerEditor({ record, organizationId, candidates, customers = [], canInvestigate = false, sourcePending = false, canDispatch, onDenied, onSaved, onClose, refreshDetail }: {
  record?: LedgerDetail; organizationId?: string; candidates: LedgerCandidate[]; canInvestigate?: boolean;
  sourcePending?: boolean; canDispatch?: () => boolean;
  customers?: components['schemas']['CustomerMasterDto'][];
  onDenied: (cause: unknown) => void; onSaved: (record: LedgerItem) => void; onClose: () => void;
  refreshDetail: () => Promise<LedgerDetail | undefined>;
}) {
  const [fields, setFields] = useState<LedgerFields>({ ...record?.raw });
  const [baseline, setBaseline] = useState(record);
  const [assignment, setAssignment] = useState<string | undefined>();
  const [customerId, setCustomerId] = useState<string | null | undefined>();
  const [version, setVersion] = useState(record?.version);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<unknown>();
  const [conflict, setConflict] = useState(false);
  const [conflicts, setConflicts] = useState<LedgerConflict[]>([]);
  const [confirmed, setConfirmed] = useState(false);
  const writer = useCustomerLedgerWrite(onDenied);
  const [refreshing, setRefreshing] = useState(false);
  const requestLeave = useNavigationGuard();
  useNavigationBusy(writer.busy || refreshing);
  useUnsavedChanges(dirty || writer.uncertain);
  const title = record ? '编辑台账' : '人工登记客诉';
  const conflictPending = !!conflicts.length && !confirmed;
  function values(detail?: LedgerDetail) { return { ...detail?.raw, customerId: detail?.customerId ?? null, qualityEngineerAssignmentId: detail?.qualityEngineerAssignmentId ?? null }; }
  function draftValues() { return { ...fields, customerId: customerId === undefined ? baseline?.customerId ?? null : customerId, qualityEngineerAssignmentId: assignment === undefined ? baseline?.qualityEngineerAssignmentId ?? null : assignment || null }; }
  function close() { if (!writer.busy && !refreshing) requestLeave(onClose, true); }
  async function refreshVersion() {
    setRefreshing(true);
    try {
      const latest = await refreshDetail();
      if (latest && !writer.signal().aborted) {
        const before = values(baseline); const local = draftValues(); const fresh = values(latest);
        const changes = ledgerChanges(before, local);
        const { customerId: nextCustomer, qualityEngineerAssignmentId: nextAssignment, ...nextFields } = { ...fresh, ...changes };
        setConflicts(ledgerConflicts(before, local, fresh)); setConfirmed(false);
        setFields(nextFields); setCustomerId('customerId' in changes ? nextCustomer : undefined); setAssignment('qualityEngineerAssignmentId' in changes ? nextAssignment ?? '' : undefined);
        setBaseline(latest); setVersion(latest.version); setConflict(true);
      }
    }
    catch (cause) { if (!writer.signal().aborted) setError(cause); }
    finally { if (!writer.signal().aborted) setRefreshing(false); }
  }
  async function save() {
    if (writer.busy || refreshing || conflictPending || sourcePending || (record && version === undefined)) return;
    setError(undefined);
    const changed = record ? ledgerChanges(values(baseline), draftValues()) : draftValues();
    const editable: LedgerFields = Object.fromEntries(Object.entries(changed).filter(([key]) => ledgerFields.some(([field]) => field === key)));
    if (record && canInvestigate && 'investigation' in changed) editable.investigation = changed.investigation;
    const body: components['schemas']['CustomerLedgerCreateDto'] = { organizationId, fields: editable,
      ...((record ? 'qualityEngineerAssignmentId' in changed : assignment !== undefined) ? { qualityEngineerAssignmentId: changed.qualityEngineerAssignmentId } : {}),
      ...((record ? 'customerId' in changed : customerId !== undefined) ? { customerId: changed.customerId } : {}) };
    try {
      const value = record
        ? await writer.write<LedgerItem>(`${ledgerBase}/${record.id}`, { ...body, expectedVersion: version! }, 'PUT', canDispatch)
        : await writer.write<LedgerItem>(ledgerBase, body, 'POST', canDispatch);
      setDirty(false); onSaved(value);
    } catch (cause) {
      if (!writer.signal().aborted) {
        setError(cause);
        if (cause instanceof ApiError && cause.status === 409 && record) { setVersion(undefined); await refreshVersion(); }
      }
    }
  }
  return <Modal open title={title} width={820} onCancel={close} keyboard={!writer.busy} mask={{ closable: !writer.busy }} closable={!writer.busy} footer={<div className="qms-dialog-actions"><Button onClick={close} disabled={writer.busy || refreshing}>取消</Button><Button aria-label={record ? '保存台账' : '登记'} type="primary" loading={writer.busy} disabled={refreshing || conflictPending || sourcePending || !!record && version === undefined} onClick={() => void save()}>{writer.uncertain ? '核对并重试原请求' : record ? '保存台账' : '登记'}</Button></div>}>
    <LedgerError cause={error} />
    {conflict ? <Alert type="warning" showIcon title="已刷新服务器版本，草稿保留；请核对变更后再次保存。" /> : null}
    <LedgerConflicts conflicts={conflicts} confirmed={confirmed} onConfirm={setConfirmed} disabled={writer.busy || writer.uncertain || refreshing} />
    {record && version === undefined ? <Button onClick={() => void refreshVersion()} loading={refreshing}>重试读取最新版本</Button> : null}
    {writer.uncertain ? <Alert type="warning" showIcon title="上次保存结果未知，原请求已锁定；重试会使用同一幂等键及原文，不会另建一条。" /> : null}
    <p>客户、件数和日期可待补。不自动填客户、数量、服务方式、风险或日期；一行多件不以单车派生值代表整批。</p>
    <fieldset disabled={writer.busy || writer.uncertain || refreshing} className="customer-ledger-form">
      <label><span>关联客户主数据（可选，不改来源原文）</span><select aria-label="关联客户主数据" value={customerId === undefined ? baseline?.customerId ?? '' : customerId ?? ''} onChange={event => { setCustomerId(event.target.value || null); setConfirmed(false); setDirty(true); }}>
        <option value="">不关联 / 待匹配，可直接登记</option>{baseline?.customerId && !customers.some(customer => customer.id === baseline.customerId && customer.active) ? <option value={baseline.customerId}>保留原关联（当前主数据不可用）</option> : null}{customers.filter(customer => customer.active).map(customer => <option key={customer.id} value={customer.id}>{customer.code} · {customer.name}</option>)}
      </select></label>
      {ledgerFields.map(([key, label]) => {
        const options = choices[key]; const value = rawText(fields[key]);
        return <label key={key} className={key === 'defectDescription' ? 'customer-ledger-form-wide' : undefined}><span>{label}</span>
          {options ? <select aria-label={label} value={value} onChange={event => { setFields(current => ({ ...current, [key]: event.target.value })); setConfirmed(false); setDirty(true); }}>
            <option value="">请选择 / 留空</option>{value && !options.some(([option]) => option === value) ? <option value={value}>原填写：{value}（待补正）</option> : null}{options.map(([option, text]) => <option key={option} value={option}>{text}</option>)}
          </select> : key === 'defectDescription' ? <Input.TextArea aria-label={label} rows={4} value={value} onChange={event => { setFields(current => ({ ...current, [key]: event.target.value })); setConfirmed(false); setDirty(true); }} /> : <Input aria-label={label} value={value} placeholder={key.endsWith('On') ? 'YYYY-MM-DD；异常原文可保留待补正' : undefined} onChange={event => { setFields(current => ({ ...current, [key]: event.target.value })); setConfirmed(false); setDirty(true); }} />}
        </label>;
      })}
      {record && canInvestigate ? <label className="customer-ledger-form-wide"><span>调查情况</span><Input.TextArea aria-label="调查情况" rows={4} value={rawText(fields.investigation)} onChange={event => { setFields(current => ({ ...current, investigation: event.target.value })); setConfirmed(false); setDirty(true); }} /></label> : null}
      <label><span>实际跟进质量工程师</span><select aria-label="实际跟进质量工程师" value={assignment ?? '__KEEP__'} onChange={event => { setAssignment(event.target.value === '__KEEP__' ? undefined : event.target.value); setConfirmed(false); setDirty(true); }}>
        <option value="__KEEP__">{record ? '保留当前实际跟进人' : '由映射带出；无可用映射可待分配'}</option><option value="">{record ? '清除指定；跟进中仍按映射带出，无可用人选则待分配' : '未指定，仍按映射带出；无可用人选则待分配'}</option>{candidates.map(candidate => <option key={candidate.assignmentId} value={candidate.assignmentId}>{candidateLabel(candidate)}</option>)}
      </select></label>
    </fieldset>
  </Modal>;
}
