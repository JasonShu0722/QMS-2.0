import type { components } from '@qms/contracts';
import { Alert, Button, Form, Input, Modal, Radio, Space, Typography } from 'antd';
import { useId, useRef, useState } from 'react';
import { ApiError } from '../../api/client';
import { useNavigationBusy, useNavigationGuard, useUnsavedChanges } from '../../layouts/UnsavedChanges';
import { ProcessDefectBoardMaterials, type MaterialDrafts, type Supplier } from './ProcessDefectBoardMaterials';
import { categoryOptions, ProcessError, useProcessWrite, type Defect } from './process-ledger';

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

export function ProcessDefectBoardDialog({ board, records, materialId, organizationId, userId, suppliers, canReadSuppliers, onClose, onSaved, onDenied }: MaintenanceTarget & {
  organizationId: string; userId?: string; suppliers: Supplier[]; canReadSuppliers: boolean;
  onClose: () => void; onSaved: (result: Result) => void; onDenied: (cause?: unknown) => void;
}) {
  const formId = useId();
  const single = records.length === 1 ? records[0] : undefined;
  const initialStatus = single ? single.ledgerStatus === 'CLOSED' ? 'FOLLOWING' : 'CLOSED' : undefined;
  const [draft, setDraft] = useState<Fields>({});
  const [completion, setCompletion] = useState<string>();
  const [status, setStatus] = useState<Fields['status']>(initialStatus);
  const [materials, setMaterials] = useState<MaterialDrafts>({});
  const [lookupPending, setLookupPending] = useState(false);
  const [incompleteReview, setIncompleteReview] = useState(false);
  const [error, setError] = useState<unknown>();
  const submitting = useRef(false);
  const writer = useProcessWrite(onDenied);
  const requestLeave = useNavigationGuard();
  const disabled = writer.busy || writer.uncertain;
  const completionIso = completion ? new Date(completion) : undefined;
  const invalidCompletion = !!completionIso && !Number.isFinite(completionIso.getTime());

  const sources = records.flatMap(record => {
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
    const materialChanges = materials[record.id];
    if (materialChanges?.materials?.length) fields.materials = materialChanges.materials;
    if (materialChanges?.reviews?.length) fields.reviews = materialChanges.reviews;
    if (materialChanges?.removedMaterialIds?.length) fields.removedMaterialIds = materialChanges.removedMaterialIds;
    return Object.keys(fields).length ? [{ defectId: record.id, expectedVersion: record.version, fields }] : [];
  });
  const invalid = !sources.length || (board === 'CLOSURE' && status === 'FOLLOWING' && !draft.reason?.trim()) || invalidCompletion || incompleteReview || lookupPending;
  useUnsavedChanges(Object.keys(draft).length > 0 || completion !== undefined || status !== initialStatus || Object.keys(materials).length > 0 || incompleteReview || writer.uncertain);
  useNavigationBusy(writer.busy);

  async function submit() {
    if (submitting.current || (invalid && !writer.uncertain)) return;
    submitting.current = true;
    setError(undefined);
    try {
      const body: Request = { organizationId, board, sources };
      const result = await writer.write<Result>('/api/v1/process-quality/defects/bulk-maintenance', body, 'PATCH');
      if (!writer.signal().aborted) onSaved(result);
    } catch (cause) {
      if (!writer.signal().aborted) setError(cause);
    } finally { submitting.current = false; }
  }

  const close = () => { if (!writer.busy) requestLeave(onClose, true); };
  const saveLabel = writer.uncertain ? '同请求重试' : '保存维护';
  function textField(key: 'analysisProgress' | 'dispositionProgress' | 'reason', label: string, initial?: string | null, required = false) {
    return <Form.Item label={label} htmlFor={`${formId}-${key}`} required={required}>
      <Input.TextArea id={`${formId}-${key}`} value={draft[key] ?? initial ?? ''} maxLength={key === 'reason' ? 2000 : 10000} rows={3}
        placeholder={!single && key !== 'reason' ? '填写后更新所选台账' : undefined}
        onChange={event => setDraft(current => ({ ...current, [key]: event.target.value }))} />
      {!single && key !== 'reason' ? <Button size="small" onClick={() => setDraft(current => ({ ...current, [key]: '' }))}>清空{label}</Button> : null}
    </Form.Item>;
  }

  return <Modal open title={boardLabels[board]} onCancel={close} closable={!writer.busy} keyboard={!writer.busy} mask={{ closable: false }} width={680}
    styles={{ body: { maxHeight: '60vh', overflowY: 'auto' } }} footer={<Space wrap>
      <Button onClick={close} disabled={writer.busy}>取消</Button>
      <Button type="primary" onClick={() => void submit()} loading={writer.busy} disabled={writer.busy || invalid && !writer.uncertain}>{saveLabel}</Button>
    </Space>}>
    <Typography.Paragraph>{single ? single.description || single.traceCode || '待完善记录' : `已选择 ${records.length} 条台账`}</Typography.Paragraph>
    <ProcessError cause={error} fallback="维护失败，草稿已保留，请重试。" />
    {error instanceof ApiError && error.code === 'CONCURRENCY_CONFLICT' ? <Alert type="warning" title="台账版本已更新。请保留所需输入，关闭后刷新并重新选择台账。" /> : null}
    {writer.uncertain ? <Alert type="warning" title="维护结果未知，可使用原请求重试。" /> : null}
    <Form layout="vertical" disabled={disabled}>
      {board === 'ANALYSIS' ? textField('analysisProgress', '分析进度', single?.analysisProgress) : null}
      {board === 'RESPONSIBILITY' ? <Form.Item label="责任类别">
        <Radio.Group aria-label="责任类别" defaultValue={single ? single.responsibilityCategory ?? '' : undefined}
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
      {board === 'RESPONSIBILITY' || board === 'MATERIAL_REVIEW' ? <ProcessDefectBoardMaterials board={board} records={records} materialId={materialId} organizationId={organizationId} userId={userId}
        suppliers={suppliers} canReadSuppliers={canReadSuppliers} disabled={disabled} onChange={setMaterials} onPendingChange={setLookupPending} onIncompleteReview={setIncompleteReview} /> : null}
    </Form>
  </Modal>;
}
