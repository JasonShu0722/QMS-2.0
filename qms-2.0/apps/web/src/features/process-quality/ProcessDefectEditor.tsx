import type { components } from '@qms/contracts';
import { Alert, Button, Collapse, Drawer, Form, Input, InputNumber, Pagination, Select, Space, Typography } from 'antd';
import { useEffect, useRef, useState } from 'react';
import { apiRequest } from '../../api/client';
import { useLanguage } from '../../i18n/Language';
import { useNavigationBusy, useNavigationGuard, useUnsavedChanges } from '../../layouts/UnsavedChanges';
import { AttachmentPanel } from '../attachments/AttachmentPanel';
import { categoryOptions, denied, MappingHint, ProcessError, useProcessWrite, type Defect } from './process-ledger';

type Update = components['schemas']['UpdateProcessDefectDto'];
type Material = components['schemas']['ProcessDefectMaterialInputDto'];
type SqePage = components['schemas']['ProcessMaterialSqePageDto'];
type Supplier = components['schemas']['SupplierProfileDto'];
const clueFields = [
  ['traceCode', '条码'], ['batchCode', '批次'], ['workOrderCode', '工单'], ['operationCode', '工序'], ['lineCode', '产线'],
  ['projectCode', '人工项目'], ['productCode', '零部件/产品编码'], ['analysisProgress', '分析进展'],
] as const;
export function materialInputs(record?: Defect): Material[] {
  return (record?.materials ?? []).map(item => ({ id: item.id, materialCode: item.materialCode, materialName: item.materialName, supplierOrganizationId: item.supplierOrganizationId, supplierProfileId: item.supplierProfileId, materialBatch: item.materialBatch, sqeUserId: item.sqeUserId, notes: item.notes }));
}
export function ProcessDefectEditor({ record, suppliers, canReadSuppliers, onSaved, onClose, onDenied }: { record?: Defect; suppliers: Supplier[]; canReadSuppliers: boolean; onSaved: (record: Defect) => void; onClose: () => void; onDenied: (cause?: unknown) => void }) {
  const { t } = useLanguage();
  const [form] = Form.useForm<Update>();
  const [saved, setSaved] = useState(record);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<unknown>();
  const [sqes, setSqes] = useState<SqePage>();
  const [sqeSearch, setSqeSearch] = useState('');
  const [sqePage, setSqePage] = useState(1);
  const [sqeError, setSqeError] = useState<unknown>();
  const [sqeLoading, setSqeLoading] = useState(true);
  const [optionRevision, setOptionRevision] = useState(0);
  const [types, setTypes] = useState<components['schemas']['ProcessDefectTypeDto'][]>([]);
  const [typesError, setTypesError] = useState<unknown>();
  const writer = useProcessWrite(onDenied);
  const requestLeave = useNavigationGuard();
  const submitting = useRef(false);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useUnsavedChanges(dirty || writer.uncertain);
  useNavigationBusy(writer.busy);
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    setSqeLoading(true); setSqeError(undefined);
    const query = new URLSearchParams({ page: String(sqePage), pageSize: '100', search: sqeSearch });
    void apiRequest<SqePage>(`/api/v1/process-quality/defects/material-sqes?${query}`, { signal: controller.signal }).then(value => { if (active) setSqes(value); }).catch(cause => { if (active) { setSqes(undefined); setSqeError(cause); if (denied(cause)) onDenied(cause); } }).finally(() => { if (active) setSqeLoading(false); });
    return () => { active = false; controller.abort(); };
  }, [sqeSearch, sqePage, optionRevision]);
  useEffect(() => {
    let active = true;
    setTypesError(undefined);
    void apiRequest<components['schemas']['ProcessDefectTypeDto'][]>('/api/v1/process-quality/defect-types').then(value => { if (active && Array.isArray(value)) setTypes(value); }).catch(cause => { if (active) { setTypesError(cause); if (denied(cause)) onDenied(cause); } });
    return () => { active = false; };
  }, [optionRevision]);

  async function save(values: Update) {
    if (submitting.current) return;
    submitting.current = true; setError(undefined);
    try {
      const body: Omit<Update, 'expectedVersion'> = {
        description: values.description?.trim() ?? '', defectTypeCode: values.defectTypeCode || null,
        defectQuantity: values.defectQuantity ?? null,
        // Minute-only display must not truncate an untouched source timestamp.
        occurredAt: saved && !form.isFieldTouched('occurredAt') ? saved.occurredAt : values.occurredAt ? new Date(values.occurredAt).toISOString() : null,
        responsibilityCategory: values.responsibilityCategory ?? null,
        ...Object.fromEntries(clueFields.map(([field]) => [field, values[field]?.trim() || null])),
        materials: (values.materials ?? []).map(item => ({ ...item, materialCode: item.materialCode?.trim() || null, materialName: item.materialName?.trim() || null, materialBatch: item.materialBatch?.trim() || null, notes: item.notes?.trim() || null, sqeUserId: item.sqeUserId || null, supplierProfileId: item.supplierProfileId || null, supplierOrganizationId: item.supplierOrganizationId || null })).filter(item => Object.values(item).some(Boolean)),
      };
      // The frozen create schema mis-types description as an object; use the generated update fact fields, never fabricate a DTO or object description.
      const result = await writer.write<Defect>(saved ? `/api/v1/process-quality/defects/${saved.id}` : '/api/v1/process-quality/defects', saved ? { ...body, expectedVersion: saved.version } satisfies Update : body, saved ? 'PUT' : 'POST');
      if (alive.current) { setSaved(result); setDirty(false); onSaved(result); form.setFieldsValue({ materials: materialInputs(result) }); }
    } catch (cause) { if (alive.current) setError(cause); }
    finally { submitting.current = false; }
  }
  const initialValues: Partial<Update> = record ? { ...record, materials: materialInputs(record), occurredAt: record.occurredAt ? new Date(new Date(record.occurredAt).getTime() - new Date(record.occurredAt).getTimezoneOffset() * 60000).toISOString().slice(0, 16) : null } : { materials: [{}] };
  return <Drawer open title={record ? '维护人工台账' : '登记不良'} size="min(920px, 100vw)" onClose={() => { if (!writer.busy) requestLeave(onClose, true); }} closable={!writer.busy} keyboard={!writer.busy} mask={{ closable: !writer.busy }}>
    <Typography.Paragraph type="secondary">班长/PQC可维护事实；未知资料可空。台账保存不创建SQE待办，关闭/恢复需要独立权限。</Typography.Paragraph>
    <ProcessError cause={error} fallback="保存失败，请重试。" />
    {writer.uncertain ? <Alert type="warning" title="保存结果未知；已锁定原请求，请使用同请求重试，避免重复登记。" /> : null}
    {saved ? <Alert type="success" title={<>已保存 · 版本 {saved.version} <MappingHint record={saved} /></>} /> : null}
    <Form form={form} layout="vertical" initialValues={initialValues} disabled={writer.busy || writer.uncertain} onValuesChange={() => setDirty(true)} onFinish={() => void save(form.getFieldsValue(true))}>
      <Form.Item name="description" label="失效现象" rules={[{ max: 10000, message: '最多10000个字符' }]}><Input.TextArea rows={3} maxLength={10000} /></Form.Item>
      <div className="process-quality-form-grid"><Form.Item name="defectQuantity" label="不良数量"><InputNumber min={1} max={2147483647} precision={0} placeholder="未知可空" /></Form.Item><Form.Item name="occurredAt" label="发生时间"><Input type="datetime-local" /></Form.Item></div>
      <Collapse items={[{ key: 'clues', label: '人工表线索与分类（可空）', children: <>
        <div className="process-quality-form-grid">{clueFields.map(([name, label]) => <Form.Item key={name} name={name} label={label}><Input maxLength={name === 'analysisProgress' ? 10000 : name === 'traceCode' ? 200 : 100} /></Form.Item>)}
          <Form.Item name="responsibilityCategory" label="责任分类"><Select allowClear placeholder="待分析" options={categoryOptions} /></Form.Item>
          <Form.Item name="defectTypeCode" label="失效类型"><Select allowClear options={types.filter(type => type.active || type.code === record?.defectTypeCode).map(type => ({ value: type.code, label: `${type.name} (${type.code})` }))} /></Form.Item>
        </div><ProcessError cause={typesError} fallback="失效类型加载失败，未知可空，原值保留。" />{typesError ? <Button onClick={() => setOptionRevision(value => value + 1)}>重试失效类型</Button> : null}
      </> }, { key: 'materials', label: '多物料、供应商与SQE', children: <>
        {!canReadSuppliers ? <Alert type="info" title="当前无供应商资料读取权限：保留已有供应商，不要求手填UUID或管理权限。" /> : null}
        <Typography.Paragraph type="secondary">SQE需人工从有效候选中选择；供应商变化不会自动映射SQE。</Typography.Paragraph>
        <ProcessError cause={sqeError} fallback="有效SQE候选加载失败，请重试。" />
        {sqeError ? <Button onClick={() => setOptionRevision(value => value + 1)}>重试SQE候选</Button> : null}
        <Form.List name="materials">{(fields, { add, remove }) => <>{fields.map(field => <section className="process-quality-card" key={field.key} aria-label={`物料明细 ${field.name + 1}`}>
          <Form.Item name={[field.name, 'id']} hidden><Input /></Form.Item><Form.Item name={[field.name, 'supplierOrganizationId']} hidden><Input /></Form.Item>
          <div className="process-quality-form-grid"><Form.Item name={[field.name, 'materialCode']} label={`物料编码 ${field.name + 1}`}><Input maxLength={100} /></Form.Item><Form.Item name={[field.name, 'materialName']} label={`物料名称 ${field.name + 1}`}><Input maxLength={200} /></Form.Item>
            <Form.Item name={[field.name, 'supplierProfileId']} label={`供应商 ${field.name + 1}`}><Select allowClear disabled={!canReadSuppliers || writer.busy || writer.uncertain} showSearch optionFilterProp="label" options={suppliers.map(supplier => ({ value: supplier.id, label: supplier.displayName }))} onChange={value => form.setFieldValue(['materials', field.name, 'supplierOrganizationId'], suppliers.find(supplier => supplier.id === value)?.supplierOrganizationId ?? null)} /></Form.Item>
            <Form.Item name={[field.name, 'materialBatch']} label={`物料批次 ${field.name + 1}`}><Input maxLength={100} /></Form.Item>
            <Form.Item name={[field.name, 'sqeUserId']} label={`SQE ${field.name + 1}`}><Select allowClear loading={sqeLoading} showSearch filterOption={false} onSearch={value => { setSqeSearch(value); setSqePage(1); }} options={(sqes?.items ?? []).map(user => ({ value: user.id, label: user.fullName ?? user.username }))} /></Form.Item>
            <Form.Item name={[field.name, 'notes']} label={`物料说明 ${field.name + 1}`}><Input maxLength={2000} /></Form.Item>
          </div><Button danger onClick={() => { remove(field.name); setDirty(true); }}>移除此物料</Button>
        </section>)}<Button disabled={fields.length >= 100 || writer.busy || writer.uncertain} onClick={() => { add({}); setDirty(true); }}>添加物料</Button></>}</Form.List>
        {(sqes?.total ?? 0) > 100 ? <Pagination aria-label="SQE候选分页" current={sqePage} pageSize={100} total={sqes?.total} showSizeChanger={false} onChange={setSqePage} /> : null}
      </> }]} />
      <div className="qms-dialog-actions"><Button type="primary" htmlType="submit" loading={writer.busy} disabled={writer.busy}>{writer.uncertain ? '同请求重试保存' : '保存登记'}</Button></div>
    </Form>
    {saved ? <><Typography.Title level={4}>附件与扫描</Typography.Title><AttachmentPanel resource={{ resourceType: 'process-defect', resourceId: saved.id }} fileIds={(saved.evidence ?? []).map(file => file.id)} /></> : <Typography.Paragraph type="secondary">{t('请先保存台账，再上传附件。')}</Typography.Paragraph>}
  </Drawer>;
}
