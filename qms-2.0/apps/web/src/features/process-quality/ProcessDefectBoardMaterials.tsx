import type { components } from '@qms/contracts';
import { Alert, Button, Checkbox, Form, Input, Radio, Select, Space } from 'antd';
import { useEffect, useId, useRef, useState } from 'react';
import { apiRequest } from '../../api/client';
import { personLabel } from '../../ui/personLabel';
import { ProcessMaterialEntry } from './ProcessMaterialEntry';
import { verificationLabels, type Defect } from './process-ledger';

type Fields = components['schemas']['BulkMaintainProcessDefectsDto']['sources'][number]['fields'];
type Material = NonNullable<Fields['materials']>[number];
type Review = NonNullable<Fields['reviews']>[number];
type MaterialView = Defect['materials'][number];
type SqePage = components['schemas']['ProcessMaterialSqePageDto'];
export type Supplier = components['schemas']['SupplierProfileDto'];
export type MaterialDrafts = Record<string, Pick<Fields, 'materials' | 'reviews' | 'removedMaterialIds'>>;
const comparedFields = {
  materialCode: '物料编码', materialName: '物料名称', supplierProfileId: '供应商名称', materialBatch: '物料批次', sqeUserId: '责任 SQE', notes: '物料说明',
} as const satisfies Partial<Record<keyof Material, string>>;
type ComparedField = keyof typeof comparedFields;
type MaterialDifference = { field: ComparedField; label: string; before: string; after: string };
export type MaterialConflict = {
  defectId: string;
  label: string;
  candidates: { id: string; label: string; patch: Material; differences: MaterialDifference[] }[];
};
export type SharedMaterialDraft = { values: Material; sqes: SqePage['items'] };
type Line = { key: string; defectId: string; original?: MaterialView; material?: Material; review?: Partial<Review> };
const sharedKey = 'shared-material';
const requiredMaterialFields = ['materialCode', 'supplierProfileId', 'supplierOrganizationId'] as const;
const reviewOptions = Object.entries(verificationLabels).filter(([value]) => value !== 'UNREVIEWED').map(([value, label]) => ({ value, label }));

function changedMaterial(material?: Material, original?: MaterialView): Material | undefined {
  const patch: Material = Object.fromEntries(Object.entries(material ?? {}).flatMap(([field, raw]) => {
    const value = raw?.trim() || null;
    return value === (original?.[field as keyof Material] ?? null) ? [] : [[field, value]];
  }));
  return Object.keys(patch).length ? { ...patch, id: original?.id } : undefined;
}

function incompleteMaterial(value?: Material) {
  return !value?.materialCode?.trim() || !value?.supplierProfileId;
}

function recordLabel(record: Defect) {
  return record.description || record.traceCode || '待完善记录';
}

function materialLabel(material: MaterialView, index?: number) {
  return [material.materialCode, material.materialName, material.materialBatch].filter(Boolean).join(' / ') || (index === undefined ? '物料明细' : `物料明细 ${index + 1}`);
}

export function planSharedMaterials(records: Defect[], { values: material, sqes }: SharedMaterialDraft, suppliers: Supplier[]) {
  const drafts: MaterialDrafts = {};
  const conflicts: MaterialConflict[] = [];
  const supplierProfileId = (item: Material | MaterialView) => item.supplierProfileId ?? (item.supplierOrganizationId
    ? suppliers.find(supplier => supplier.supplierOrganizationId === item.supplierOrganizationId)?.id
    : undefined);
  const format = (field: ComparedField, item: Material | MaterialView) => {
    if (field === 'supplierProfileId') {
      const id = supplierProfileId(item);
      if (!id) return item.supplierOrganizationId ? '供应商名称不可用' : '—';
      const supplier = suppliers.find(candidate => candidate.id === id);
      return supplier ? `${supplier.displayName}（${supplier.businessCode}）` : `档案 ${id}`;
    }
    const value = item[field];
    if (!value) return '—';
    if (field === 'sqeUserId') {
      const person = sqes.find(item => item.id === value);
      return person ? personLabel(person) : `用户 ${value}`;
    }
    return value;
  };
  const code = material.materialCode?.trim();
  const batch = material.materialBatch?.trim() || null;
  const matchesSupplier = (item: MaterialView) => !!material.supplierProfileId && supplierProfileId(item) === material.supplierProfileId;
  for (const record of records) {
    const items = (record.materials ?? []).filter(item => !!item.id);
    if (!items.length) {
      const patch = changedMaterial(material);
      if (patch) drafts[record.id] = { materials: [patch] };
      continue;
    }

    const sameCode = items.filter(item => item.materialCode === code);
    const sameSupplier = sameCode.filter(matchesSupplier);
    const sameIdentity = sameSupplier.filter(item => (item.materialBatch ?? null) === batch);
    const targets = [sameIdentity, sameSupplier, sameCode, items].find(rows => rows.length)!;
    const candidates: MaterialConflict['candidates'] = [];
    for (const original of targets) {
      const next = { ...material, materialBatch: batch };
      if (matchesSupplier(original)) {
        delete next.supplierProfileId;
        delete next.supplierOrganizationId;
      }
      if (original.materialCode === code && !next.materialName) delete next.materialName;
      const patch = changedMaterial(next, original);
      if (!patch) break;
      const differences = (Object.keys(comparedFields) as ComparedField[]).flatMap(field => patch[field] === undefined ? [] : [{
        field, label: comparedFields[field], before: format(field, original), after: format(field, patch),
      }]);
      candidates.push({ id: original.id!, label: materialLabel(original), patch, differences });
    }
    if (candidates.length === targets.length) conflicts.push({ defectId: record.id, label: recordLabel(record), candidates });
  }
  return { drafts, conflicts };
}

function revision(line: Line) {
  const original = line.original;
  const verification = line.review?.verification ?? (original?.verification === 'UNREVIEWED' ? undefined : original?.verification);
  const notes = line.review?.verificationNotes;
  const notesChanged = notes !== undefined && notes !== (original?.verificationNotes ?? null);
  const changed = notesChanged || (verification !== undefined && verification !== original?.verification);
  const review: Review | undefined = changed && verification && original?.id ? { materialId: original.id, verification, ...(notesChanged ? { verificationNotes: notes } : {}) } : undefined;
  return { review, incomplete: changed && !verification };
}

export function ProcessDefectBoardMaterials({ board, records, materialId, organizationId, userId, suppliers, canReadSuppliers, disabled, showMaterials, onChange, onPendingChange, onIncompleteChange, onSharedChange }: {
  board: 'RESPONSIBILITY' | 'MATERIAL_REVIEW'; records: Defect[]; materialId?: string; organizationId: string; userId?: string;
  suppliers: Supplier[]; canReadSuppliers: boolean; disabled: boolean; showMaterials: boolean; onChange: (drafts: MaterialDrafts) => void;
  onPendingChange: (pending: boolean) => void; onIncompleteChange: (incomplete: boolean) => void; onSharedChange: (draft?: SharedMaterialDraft) => void;
}) {
  const formId = useId();
  const reviewOnly = board === 'MATERIAL_REVIEW';
  const shared = !reviewOnly && records.length > 1;
  const direct = !!materialId;
  const canRemove = !reviewOnly && !shared && !direct;
  const [removedIds, setRemovedIds] = useState<string[]>([]);
  const [lines, setLines] = useState<Line[]>(() => {
    if (shared) return [{ key: sharedKey, defectId: sharedKey }];
    if (!materialId) return [];
    const record = records[0];
    const original = record?.materials?.find(item => item.id === materialId && (!reviewOnly || userId && item.sqeUserId === userId));
    return original ? [{ key: materialId, defectId: record.id, original }] : [];
  });
  const pending = useRef(new Set<string>());
  const [sqes, setSqes] = useState<SqePage['items']>();
  const [sqeFailed, setSqeFailed] = useState(false);
  const [sqeRevision, setSqeRevision] = useState(0);
  const showSqes = showMaterials && !reviewOnly && lines.length > 0;

  useEffect(() => {
    if (!showSqes) return;
    const controller = new AbortController();
    const params = new URLSearchParams({ organizationId, pageSize: '100' });
    async function loadSqes() {
      const items: SqePage['items'] = [];
      for (let page = 1; !controller.signal.aborted; page += 1) {
        params.set('page', String(page));
        const result = await apiRequest<SqePage>(`/api/v1/process-quality/defects/material-sqes?${params}`, { signal: controller.signal });
        items.push(...result.items);
        if (items.length >= result.total) return items;
        if (!result.items.length) throw new Error('SQE 候选分页不完整');
      }
      return items;
    }
    setSqes(undefined);
    setSqeFailed(false);
    void loadSqes().then(items => { if (!controller.signal.aborted) setSqes(items); }).catch(() => { if (!controller.signal.aborted) setSqeFailed(true); });
    return () => controller.abort();
  }, [showSqes, organizationId, sqeRevision]);

  useEffect(() => {
    if (!showMaterials) {
      onChange({});
      onSharedChange(undefined);
      onIncompleteChange(false);
      return;
    }
    if (shared) {
      const material = lines[0]?.material;
      onSharedChange(material && !incompleteMaterial(material) ? { values: material, sqes: sqes ?? [] } : undefined);
      onIncompleteChange(incompleteMaterial(material));
      return;
    }
    const drafts: MaterialDrafts = {};
    let incomplete = false;
    for (const line of lines) {
      if (reviewOnly) {
        const { review, incomplete: missing } = revision(line);
        incomplete ||= missing;
        if (review) (drafts[line.defectId] ??= { reviews: [] }).reviews!.push(review);
      } else {
        if (removedIds.includes(line.key)) continue;
        const patch = changedMaterial(line.material, line.original);
        const requiresCompleteIdentity = !line.original || requiredMaterialFields.some(field => patch?.[field] !== undefined);
        if (requiresCompleteIdentity && incompleteMaterial({ ...line.original, ...line.material })) incomplete = true;
        if (patch) (drafts[line.defectId] ??= { materials: [] }).materials!.push(patch);
      }
    }
    if (canRemove && removedIds.length) (drafts[records[0].id] ??= {}).removedMaterialIds = removedIds;
    onChange(drafts);
    onIncompleteChange(incomplete);
  }, [lines, reviewOnly, shared, showMaterials, canRemove, removedIds, records, sqes, onChange, onIncompleteChange, onSharedChange]);

  function update(key: string, update: (line: Line) => Line) {
    setLines(current => current.map(line => line.key === key ? update(line) : line));
  }
  function remove(key: string) {
    setLines(current => current.filter(line => line.key !== key));
    pending.current.delete(key);
    onPendingChange(pending.current.size > 0);
  }
  function renderReview(line: Line, index: number) {
    const original = line.original!;
    const initial = original.verification === 'UNREVIEWED' ? undefined : original.verification;
    const remaining = revision(line).incomplete;
    const notesId = `${formId}-notes-${index}`;
    return <>
      <Form.Item label="复核结论" required validateStatus={remaining ? 'error' : undefined} help={remaining ? '请选择复核结论。' : undefined}>
        <Radio.Group aria-label="复核结论" value={line.review?.verification ?? initial} onChange={event => update(line.key, current => ({ ...current, review: { ...current.review, verification: event.target.value } }))}>
          <Space wrap>{reviewOptions.map(option => <Radio key={option.value} value={option.value}>{option.label}</Radio>)}</Space>
        </Radio.Group>
      </Form.Item>
      <Form.Item label="复核说明" htmlFor={notesId}>
        <Input.TextArea id={notesId} defaultValue={original.verificationNotes ?? ''} maxLength={2000} rows={2}
          onChange={event => { const verificationNotes = event.target.value.trim() || null; update(line.key, current => ({ ...current, review: { ...current.review, verificationNotes } })); }} />
      </Form.Item>
    </>;
  }

  function renderMaterial(line: Line, number: number) {
    const value = { ...line.original, ...line.material };
    const change = (patch: Material) => update(line.key, current => ({ ...current, material: { ...current.material, ...patch } }));
    const sqeId = `${formId}-sqe-${line.key}`;
    const options = (sqes ?? []).map(person => ({ value: person.id, label: personLabel(person) }));
    if (value.sqeUserId && !options.some(option => option.value === value.sqeUserId)) options.push({ value: value.sqeUserId, label: '原责任 SQE' });
    return <>
      <ProcessMaterialEntry number={number} value={value} suppliers={suppliers} canReadSuppliers={canReadSuppliers} organizationId={organizationId} disabled={disabled} onChange={change}
        onLookupPendingChange={active => { if (active) pending.current.add(line.key); else pending.current.delete(line.key); onPendingChange(pending.current.size > 0); }} />
      <div className="process-material-entry-grid">
      <Form.Item label={`责任 SQE ${number}`} htmlFor={sqeId}>
        <Select id={sqeId} value={value.sqeUserId ?? undefined} options={options} loading={!sqes && !sqeFailed} disabled={disabled || !sqes} allowClear
          showSearch={{ optionFilterProp: 'label' }} onChange={sqeUserId => change({ sqeUserId: sqeUserId ?? null })} />
      </Form.Item>
      <Form.Item label={`物料说明 ${number}`} htmlFor={`${formId}-material-notes-${line.key}`}>
        <Input.TextArea id={`${formId}-material-notes-${line.key}`} value={value.notes ?? ''} rows={2} maxLength={2000} onChange={event => change({ notes: event.target.value })} />
      </Form.Item>
      </div>
    </>;
  }

  if (!showMaterials) return null;
  const warning = sqeFailed && showSqes ? <Alert showIcon type="warning" title="责任 SQE 候选加载失败" action={<Button disabled={disabled} onClick={() => setSqeRevision(current => current + 1)}>重试</Button>} /> : null;
  if (shared) return <>{warning}{renderMaterial(lines[0], 1)}</>;
  if (direct) return <>{warning}{lines[0] ? reviewOnly ? renderReview(lines[0], 0) : renderMaterial(lines[0], 1) : null}</>;
  return <>
    {warning}
    {records.map(record => {
      const items = (record.materials ?? []).filter(item => item.id && (!reviewOnly || !!userId && item.sqeUserId === userId));
      const added = lines.filter(line => line.defectId === record.id && !line.original);
      if (reviewOnly && !items.length) return null;
      return <Form.Item key={record.id}>
        <fieldset>
          <legend>{recordLabel(record)}</legend>
          {items.map((item, index) => {
            const line = lines.find(candidate => candidate.key === item.id);
            const id = item.id!;
            const removed = removedIds.includes(id);
            const label = materialLabel(item, index);
            return <div key={item.id}>
              <Space wrap>
                <Checkbox name="material-edit" checked={!!line} disabled={disabled || removed} onChange={event => {
                  if (event.target.checked) setLines(current => [...current, { key: id, defectId: record.id, original: item }]);
                  else remove(id);
                }}>{label}</Checkbox>
                {canRemove ? <Checkbox checked={removed} disabled={disabled} aria-label={`移除物料 ${label}`} onChange={event => {
                  const checked = event.target.checked;
                  if (checked) remove(id);
                  setRemovedIds(current => checked ? [...current, id] : current.filter(value => value !== id));
                }}>保存时移除</Checkbox> : null}
              </Space>
              {line ? reviewOnly ? renderReview(line, lines.indexOf(line)) : renderMaterial(line, index + 1) : null}
            </div>;
          })}
          {added.map((line, index) => <div key={line.key}>
            {renderMaterial(line, items.length + index + 1)}
            <Button disabled={disabled} onClick={() => remove(line.key)}>移除新增明细</Button>
          </div>)}
          {!reviewOnly ? <Button disabled={disabled || (record.materials?.length ?? 0) + added.length >= 100} onClick={() => setLines(current => [...current, { key: crypto.randomUUID(), defectId: record.id }])}>新增物料明细</Button> : null}
        </fieldset>
      </Form.Item>;
    })}
  </>;
}
