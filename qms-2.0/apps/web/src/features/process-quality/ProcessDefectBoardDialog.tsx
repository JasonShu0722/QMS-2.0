import type { components } from '@qms/contracts';
import { Alert, Button, Form, Input, Modal, Radio, Space, Typography } from 'antd';
import { useId, useRef, useState } from 'react';
import { apiRequest, ApiError } from '../../api/client';
import { useNavigationBusy, useNavigationGuard, useUnsavedChanges } from '../../layouts/UnsavedChanges';
import { planSharedMaterials, ProcessDefectBoardMaterials, type MaterialConflict, type MaterialDrafts, type SharedMaterialDraft, type Supplier } from './ProcessDefectBoardMaterials';
import { categoryOptions, denied, ProcessError, useProcessWrite, type Defect } from './process-ledger';

type Request = components['schemas']['BulkMaintainProcessDefectsDto'];
type Result = components['schemas']['BulkMaintainProcessDefectsResultDto'];
type Fields = Request['sources'][number]['fields'];
export type MaintenanceBoard = Request['board'];
export type MaintenanceTarget = { board: MaintenanceBoard; records: Defect[]; materialId?: string };
export const maintenanceLimit = 100;
export const boardLabels = {
  ANALYSIS: '分析进度维护', RESPONSIBILITY: '责任判定', DISPOSITION: '处置维护', CLOSURE: '关闭判定', MATERIAL_REVIEW: '物料复核',
} satisfies Record<MaintenanceBoard, string>;
export const dispositionLabels = { REWORK: '返修', SCRAP: '报废', CONCESSION: '让步放行' } satisfies Record<NonNullable<Fields['dispositionPlan']>, string>;

function localTime(timestamp: string | Date) {
  const date = new Date(timestamp);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

type ConflictChoices = Record<string, string>;
type MaterialPreflight = { records: Defect[]; drafts: MaterialDrafts; conflicts: MaterialConflict[]; choices: ConflictChoices };

async function readBatchDetails(records: Defect[], organizationId: string, signal: AbortSignal) {
  const results: Defect[] = [];
  const query = new URLSearchParams({ organizationId });
  for (let offset = 0; offset < records.length; offset += 8) {
    signal.throwIfAborted();
    const chunk = await Promise.all(records.slice(offset, offset + 8).map(async record => {
      const latest = await apiRequest<Defect>(`/api/v1/process-quality/defects/${encodeURIComponent(record.id)}?${query}`, { signal });
      if (latest.id !== record.id || latest.organizationId !== organizationId || latest.archivedAt || !Number.isInteger(latest.version) || latest.version < record.version) {
        throw new Error('台账已变更，无法检查批量物料冲突。');
      }
      return latest;
    }));
    results.push(...chunk);
  }
  return results;
}

export function ProcessDefectBoardDialog({ board: targetBoard, records, materialId, organizationId, userId, suppliers, canReadSuppliers, canReviewSelectedMaterial, onClose, onSaved, onDenied }: MaintenanceTarget & {
  organizationId: string; userId?: string; suppliers: Supplier[]; canReadSuppliers: boolean; canReviewSelectedMaterial?: boolean;
  onClose: () => void; onSaved: (result: Result) => void; onDenied: (cause?: unknown) => void;
}) {
  const formId = useId();
  const single = records.length === 1 ? records[0] : undefined;
  const [board, setBoard] = useState(targetBoard);
  const initialStatus = single ? single.ledgerStatus === 'CLOSED' ? 'FOLLOWING' : 'CLOSED' : undefined;
  const [draft, setDraft] = useState<Fields>({});
  const [completion, setCompletion] = useState<string>();
  const [status, setStatus] = useState<Fields['status']>(initialStatus);
  const [materials, setMaterials] = useState<MaterialDrafts>({});
  const [lookupPending, setLookupPending] = useState(false);
  const [incompleteMaterials, setIncompleteMaterials] = useState(false);
  const [sharedDraft, setSharedDraft] = useState<SharedMaterialDraft>();
  const [preflight, setPreflight] = useState<MaterialPreflight>();
  const [checking, setChecking] = useState(false);
  const [notice, setNotice] = useState<string>();
  const [error, setError] = useState<unknown>();
  const submitting = useRef(false);
  const writer = useProcessWrite(onDenied);
  const requestLeave = useNavigationGuard();
  const busy = writer.busy || checking;
  const disabled = busy || writer.uncertain;
  const completionIso = completion ? new Date(completion) : undefined;
  const invalidCompletion = !!completionIso && !Number.isFinite(completionIso.getTime());
  const category = draft.responsibilityCategory === undefined ? single?.responsibilityCategory : draft.responsibilityCategory;
  const showMaterials = board === 'MATERIAL_REVIEW' || board === 'RESPONSIBILITY' && (!!materialId || category === 'MATERIAL' || !!single?.materials?.length);
  const sharedMaterials = !single && board === 'RESPONSIBILITY' && category === 'MATERIAL';
  const resolving = !!preflight;
  const currentConflicts = preflight?.conflicts ?? [];
  const canSwitchBoard = targetBoard === 'RESPONSIBILITY' && !!materialId && canReviewSelectedMaterial && !!userId && single?.materials?.some(item => item.id === materialId && item.sqeUserId === userId);

  function buildSources(targets: Defect[], changes: MaterialDrafts, conflicts: MaterialConflict[] = [], choices: ConflictChoices = {}, compareUnchanged = false): Request['sources'] {
    return targets.flatMap(record => {
      if (choices[record.id] === 'skip') return [];
      const fields: Fields = {};
      if (draft.analysisProgress !== undefined && (draft.analysisProgress?.trim() || null) !== (record.analysisProgress ?? null)) fields.analysisProgress = draft.analysisProgress?.trim() || null;
      if (draft.responsibilityCategory !== undefined && draft.responsibilityCategory !== (record.responsibilityCategory ?? null)) fields.responsibilityCategory = draft.responsibilityCategory;
      if (draft.dispositionPlan !== undefined && draft.dispositionPlan !== (record.dispositionPlan ?? null)) fields.dispositionPlan = draft.dispositionPlan;
      if (draft.dispositionProgress !== undefined && (draft.dispositionProgress?.trim() || null) !== (record.dispositionProgress ?? null)) fields.dispositionProgress = draft.dispositionProgress?.trim() || null;
      if (completion !== undefined && !invalidCompletion && completion !== (record.dispositionCompletedAt ? localTime(record.dispositionCompletedAt) : '')) fields.dispositionCompletedAt = completionIso?.toISOString() ?? null;
      if (board === 'CLOSURE' && status && status !== record.ledgerStatus) {
        fields.status = status;
        if (draft.reason?.trim()) fields.reason = draft.reason.trim();
      }
      const materialChanges = showMaterials ? changes[record.id] : undefined;
      if (materialChanges?.materials?.length) fields.materials = materialChanges.materials;
      if (materialChanges?.reviews?.length) fields.reviews = materialChanges.reviews;
      if (materialChanges?.removedMaterialIds?.length) fields.removedMaterialIds = materialChanges.removedMaterialIds;
      const overwrite = choices[record.id];
      if (overwrite) {
        const candidate = conflicts.find(conflict => conflict.defectId === record.id)?.candidates.find(item => item.id === overwrite);
        if (candidate) fields.materials = [candidate.patch];
      }
      const source = { defectId: record.id, expectedVersion: record.version, fields };
      if (Object.keys(fields).length) return [source];
      return compareUnchanged ? [{ ...source, compareOnly: true }] : [];
    });
  }
  const sources = preflight ? buildSources(preflight.records, preflight.drafts, preflight.conflicts, preflight.choices, true) : buildSources(records, materials);
  const versionChanged = error instanceof ApiError && error.code === 'CONCURRENCY_CONFLICT';
  const invalidTargets = preflight ? versionChanged || !sources.length || currentConflicts.some(conflict => !preflight.choices[conflict.defectId]) : sharedMaterials ? !sharedDraft : !sources.length;
  const invalid = invalidTargets || (board === 'CLOSURE' && status === 'FOLLOWING' && !draft.reason?.trim()) || invalidCompletion || showMaterials && (incompleteMaterials || lookupPending);
  useUnsavedChanges(Object.keys(draft).length > 0 || completion !== undefined || status !== initialStatus || Object.keys(materials).length > 0 || incompleteMaterials || writer.uncertain);
  useNavigationBusy(busy);

  async function submit() {
    if (submitting.current || (invalid && !writer.uncertain)) return;
    submitting.current = true;
    setError(undefined);
    setNotice(undefined);
    const signal = writer.signal();
    try {
      let changes = sources;
      if (sharedMaterials && sharedDraft && !resolving && !writer.uncertain) {
        setChecking(true);
        let latest: Defect[];
        try {
          latest = await readBatchDetails(records, organizationId, signal);
          signal.throwIfAborted();
        } catch (cause) {
          if (!signal.aborted) {
            if (denied(cause)) onDenied(cause);
            else setNotice('无法读取最新台账，请重试。当前录入已保留。');
          }
          return;
        } finally {
          if (!signal.aborted) setChecking(false);
        }
        const { drafts, conflicts } = planSharedMaterials(latest, sharedDraft, suppliers);
        if (conflicts.length) {
          setPreflight({ records: latest, drafts, conflicts, choices: {} });
          return;
        }
        changes = buildSources(latest, drafts, [], {}, true);
      }
      const body: Request = { organizationId, board, sources: changes };
      const result = await writer.write<Result>('/api/v1/process-quality/defects/bulk-maintenance', body, 'PATCH');
      if (!signal.aborted) onSaved(result);
    } catch (cause) {
      if (!signal.aborted) setError(cause);
    } finally { submitting.current = false; }
  }

  const returnToEdit = () => { setPreflight(undefined); setError(undefined); setNotice(undefined); };
  const close = () => {
    if (busy) return;
    if (resolving && !writer.uncertain) returnToEdit();
    else requestLeave(onClose, true);
  };
  const saveLabel = writer.uncertain ? '同请求重试' : resolving ? '确认保存' : '保存维护';
  function textField(key: 'analysisProgress' | 'dispositionProgress' | 'reason', label: string, initial?: string | null, required = false) {
    return <Form.Item label={label} htmlFor={`${formId}-${key}`} required={required}>
      <Input.TextArea id={`${formId}-${key}`} value={draft[key] ?? initial ?? ''} maxLength={key === 'reason' ? 2000 : 10000} rows={3}
        placeholder={!single && key !== 'reason' ? '填写后更新所选台账' : undefined}
        onChange={event => setDraft(current => ({ ...current, [key]: event.target.value }))} />
      {!single && key !== 'reason' ? <Button size="small" onClick={() => setDraft(current => ({ ...current, [key]: '' }))}>清空{label}</Button> : null}
    </Form.Item>;
  }

  return <Modal open title={targetBoard === 'RESPONSIBILITY' && materialId ? '编辑异常物料' : boardLabels[board]} onCancel={close} closable={!busy} keyboard={!busy} mask={{ closable: false }} width={680}
    styles={{ body: { maxHeight: '60vh', overflowY: 'auto' } }} footer={<Space wrap>
      <Button onClick={close} disabled={busy}>{resolving && !writer.uncertain ? '返回修改' : '取消'}</Button>
      <Button type="primary" onClick={() => void submit()} loading={busy} disabled={busy || invalid && !writer.uncertain}>{saveLabel}</Button>
    </Space>}>
    <Typography.Paragraph>{single ? single.description || single.traceCode || '待完善记录' : `已选择 ${records.length} 条台账`}</Typography.Paragraph>
    <ProcessError cause={error} fallback="维护失败，草稿已保留，请重试。" />
    {notice ? <Alert type="info" title={notice} /> : null}
    {versionChanged ? <Alert type="warning" title={resolving ? '台账版本已更新。请返回修改，再次保存以检查最新信息。' : sharedMaterials ? '台账版本已更新。请再次保存以检查最新信息。' : '台账版本已更新。请保留所需输入，关闭后刷新并重新选择台账。'} /> : null}
    {writer.uncertain ? <Alert type="warning" title="维护结果未知，可使用原请求重试。" /> : null}
    {preflight ? <section className="process-material-conflicts" aria-label="物料冲突确认">
      <Alert type="warning" showIcon title="所选台账有不同的物料信息，请逐条处理。" />
      {currentConflicts.map(conflict => <fieldset key={conflict.defectId} disabled={disabled}>
        <legend>{conflict.label}</legend>
        <Radio.Group aria-label={`${conflict.label}冲突处理`} value={preflight.choices[conflict.defectId]}
          onChange={event => setPreflight(current => current && ({ ...current, choices: { ...current.choices, [conflict.defectId]: event.target.value } }))}>
          {conflict.candidates.map(candidate => <div key={candidate.id}>
            <Radio value={candidate.id}>{conflict.candidates.length === 1 ? '覆盖' : `覆盖 ${candidate.label}`}</Radio>
            <table>
              <thead><tr><th scope="col">冲突字段</th><th scope="col">现值</th><th scope="col">录入值</th></tr></thead>
              <tbody>{candidate.differences.map(item => <tr key={item.field}><td>{item.label}</td><td>{item.before}</td><td>{item.after}</td></tr>)}</tbody>
            </table>
          </div>)}
          <Radio value="skip">跳过本条</Radio>
        </Radio.Group>
      </fieldset>)}
    </section> : null}
    <div hidden={resolving}><Form layout="vertical" disabled={disabled || resolving}>
      {canSwitchBoard ? <Form.Item>
        <Radio.Group aria-label="物料维护板块" value={board} disabled={disabled} onChange={event => {
          const next = event.target.value;
          requestLeave(() => {
            setMaterials({}); setIncompleteMaterials(false); setLookupPending(false); setError(undefined); setBoard(next);
          }, true);
        }} optionType="button" options={[{ label: '物料信息', value: 'RESPONSIBILITY' }, { label: '物料复核', value: 'MATERIAL_REVIEW' }]} />
      </Form.Item> : null}
      {board === 'ANALYSIS' ? textField('analysisProgress', '分析进度', single?.analysisProgress) : null}
      {board === 'RESPONSIBILITY' && !materialId ? <Form.Item label="责任类别">
        <Radio.Group aria-label="责任类别" value={category ?? (single || draft.responsibilityCategory === null ? '' : undefined)}
          onChange={event => setDraft(current => ({ ...current, responsibilityCategory: event.target.value || null }))}>
          <Space wrap>{categoryOptions.map(({ value, label }) => <Radio key={value} value={value}>{label}</Radio>)}<Radio value="">待分析</Radio></Space>
        </Radio.Group>
      </Form.Item> : null}
      {board === 'DISPOSITION' ? <>
        <Form.Item label="处置方案">
          <Radio.Group aria-label="处置方案" defaultValue={single ? single.dispositionPlan ?? '' : undefined}
            onChange={event => setDraft(current => ({ ...current, dispositionPlan: event.target.value || null }))}>
            <Space wrap>{Object.entries(dispositionLabels).map(([value, label]) => <Radio key={value} value={value}>{label}</Radio>)}<Radio value="">清空方案</Radio></Space>
          </Radio.Group>
        </Form.Item>
        {textField('dispositionProgress', '处置进度', single?.dispositionProgress)}
        <Form.Item label="完成时间" htmlFor={`${formId}-completion`} validateStatus={invalidCompletion ? 'error' : undefined} help={invalidCompletion ? '请选择有效日期和时间。' : undefined}>
          <Space wrap>
            <Input id={`${formId}-completion`} type="datetime-local" value={completion ?? (single?.dispositionCompletedAt ? localTime(single.dispositionCompletedAt) : '')}
              onChange={event => setCompletion(event.target.value)} onClick={() => { if (completion === undefined && !single?.dispositionCompletedAt) setCompletion(localTime(new Date())); }} />
            {!completion && !single?.dispositionCompletedAt ? <Button onClick={() => setCompletion(localTime(new Date()))}>填写完成时间</Button> : null}
            <Button onClick={() => setCompletion('')}>清空完成时间</Button>
          </Space>
        </Form.Item>
      </> : null}
      {board === 'CLOSURE' ? <>
        <Form.Item label="台账状态"><Radio.Group aria-label="台账状态" value={status} onChange={event => setStatus(event.target.value)}>
          <Space wrap><Radio value="CLOSED">关闭台账</Radio><Radio value="FOLLOWING">恢复跟进</Radio></Space>
        </Radio.Group></Form.Item>
        {status ? textField('reason', status === 'FOLLOWING' ? '恢复原因' : '关闭说明', undefined, status === 'FOLLOWING') : null}
      </> : null}
      {board === 'RESPONSIBILITY' || board === 'MATERIAL_REVIEW' ? <ProcessDefectBoardMaterials key={board} board={board} records={records} materialId={materialId} organizationId={organizationId} userId={userId}
        suppliers={suppliers} canReadSuppliers={canReadSuppliers} disabled={disabled || resolving} showMaterials={showMaterials} onChange={setMaterials} onPendingChange={setLookupPending}
        onIncompleteChange={setIncompleteMaterials} onSharedChange={setSharedDraft} /> : null}
    </Form></div>
  </Modal>;
}
