import type { components } from '@qms/contracts';
import { personLabel } from '../../ui/personLabel';
import { Alert, Button, Collapse, Descriptions, Drawer, Form, Input, InputNumber, Pagination, Select, Typography } from 'antd';
import { useEffect, useRef, useState } from 'react';
import { apiRequest } from '../../api/client';
import { useNavigationBusy, useNavigationGuard, useUnsavedChanges } from '../../layouts/UnsavedChanges';
import { AttachmentPanel } from '../attachments/AttachmentPanel';
import { categoryOptions, denied, MappingHint, ProcessError, useProcessWrite, type Defect } from './process-ledger';
import { useWorkTabsStore } from '../../work-tabs/workTabsStore';
import { ProcessTraceScanner } from './ProcessTraceScanner';

type Update = components['schemas']['UpdateProcessDefectDto'];
type Material = components['schemas']['ProcessDefectMaterialInputDto'];
type SqePage = components['schemas']['ProcessMaterialSqePageDto'];
type Supplier = components['schemas']['SupplierProfileDto'];
const clueFields = [
  ['batchCode', '批次'], ['operationCode', '工序编码'], ['lineCode', '生产线编码'],
  ['analysisProgress', '分析进展'],
] as const;
const factFields = [...clueFields, ['productCode', '成品编码'], ['traceCode', '追溯码'], ['workOrderCode', '工单号'], ['lineName', '生产线名称'], ['operationName', '工序名称']] as const;
export function materialInputs(record?: Defect): Material[] {
  return (record?.materials ?? []).map(item => ({ id: item.id, materialCode: item.materialCode, materialName: item.materialName, supplierOrganizationId: item.supplierOrganizationId, supplierProfileId: item.supplierProfileId, materialBatch: item.materialBatch, sqeUserId: item.sqeUserId, notes: item.notes }));
}
export function ProcessDefectEditor({ record, suppliers, canReadSuppliers, onSaved, onClose, onDenied }: { record?: Defect; suppliers: Supplier[]; canReadSuppliers: boolean; onSaved: (record: Defect) => void; onClose: () => void; onDenied: (cause?: unknown) => void }) {
  const [form] = Form.useForm<Update>();
  const [saved, setSaved] = useState(record);
  const [dirty, setDirty] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<unknown>();
  const [sqes, setSqes] = useState<SqePage>();
  const [selectedSqes, setSelectedSqes] = useState<Record<string, SqePage['items'][number]>>({});
  const [invalidated, setInvalidated] = useState(false);
  const retired = useRef(false);
  const scope = useWorkTabsStore(state => state.sessionScope);
  const initialScope = useRef(scope);
  const materials: Material[] | undefined = Form.useWatch('materials', { form, preserve: true });
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
  const current = () => alive.current && !retired.current && initialScope.current === useWorkTabsStore.getState().sessionScope;
  const selectedIds = new Set((materials ?? materialInputs(record)).map(material => material.sqeUserId).filter((id): id is string => !!id));
  const sqeChoices = [...new Map([...(sqes?.items ?? []), ...Object.values(selectedSqes).filter(user => selectedIds.has(user.id))].map(user => [user.id, user])).values()];
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => useWorkTabsStore.subscribe(state => {
    if (state.sessionScope === initialScope.current) return;
    retired.current = true; setInvalidated(true); setSqes(undefined); setSelectedSqes({});
    form.setFieldValue('materials', (form.getFieldValue('materials') ?? []).map((material: Material) => ({ ...material, sqeUserId: null })));
  }), [form]);
  useUnsavedChanges(dirty || writer.uncertain);
  useNavigationBusy(writer.busy);
  useEffect(() => {
    if (invalidated) return;
    let active = true;
    const controller = new AbortController();
    setSqeLoading(true); setSqeError(undefined);
    const query = new URLSearchParams({ page: String(sqePage), pageSize: '100', search: sqeSearch });
    void apiRequest<SqePage>(`/api/v1/process-quality/defects/material-sqes?${query}`, { signal: controller.signal }).then(value => {
      if (!active || !current()) return;
      setSqes(value);
      const retained = new Set((form.getFieldValue('materials') as Material[] ?? materialInputs(record)).map(material => material.sqeUserId));
      setSelectedSqes(previous => Object.fromEntries([...Object.values(previous), ...value.items].filter(user => retained.has(user.id)).map(user => [user.id, user])));
    }).catch(cause => { if (active && current()) { setSqes(undefined); setSqeError(cause); if (denied(cause)) onDenied(cause); } }).finally(() => { if (active && current()) setSqeLoading(false); });
    return () => { active = false; controller.abort(); };
  }, [sqeSearch, sqePage, optionRevision, invalidated]);
  useEffect(() => {
    let active = true;
    setTypesError(undefined);
    void apiRequest<components['schemas']['ProcessDefectTypeDto'][]>('/api/v1/process-quality/defect-types').then(value => { if (active && Array.isArray(value)) setTypes(value); }).catch(cause => { if (active) { setTypesError(cause); if (denied(cause)) onDenied(cause); } });
    return () => { active = false; };
  }, [optionRevision]);

  async function save(values: Update) {
    if (submitting.current || !current()) return;
    submitting.current = true; setError(undefined);
    try {
      let body: Omit<Update, 'expectedVersion'> = {
        description: values.description?.trim() ?? '', defectTypeCode: values.defectTypeCode || null,
        defectQuantity: values.defectQuantity ?? null,
        // Minute-only display must not truncate an untouched source timestamp.
        occurredAt: saved && !form.isFieldTouched('occurredAt') ? saved.occurredAt : values.occurredAt ? new Date(values.occurredAt).toISOString() : null,
        responsibilityCategory: values.responsibilityCategory ?? null,
        ...Object.fromEntries(factFields.map(([field]) => [field, values[field]?.trim() || null])),
        materials: (values.materials ?? []).map(item => ({ ...item, materialCode: item.materialCode?.trim() || null, materialName: item.materialName?.trim() || null, materialBatch: item.materialBatch?.trim() || null, notes: item.notes?.trim() || null, sqeUserId: item.sqeUserId || null, supplierProfileId: item.supplierProfileId || null, supplierOrganizationId: item.supplierOrganizationId || null })).filter(item => Object.values(item).some(Boolean)),
      };
      if (saved?.sourceKind === 'IMS') {
        body = Object.fromEntries(Object.entries(body).filter(([field, value]) => field === 'materials' ? form.isFieldTouched('materials') : JSON.stringify(value ?? null) !== JSON.stringify(saved[field as keyof Defect] ?? null)));
        if (!saved.externalRecordKey && values.externalRecordKey?.trim()) body.externalRecordKey = values.externalRecordKey.trim();
      }
      const result = await writer.write<Defect>(saved ? `/api/v1/process-quality/defects/${saved.id}` : '/api/v1/process-quality/defects', saved ? { ...body, expectedVersion: saved.version } satisfies Update : body, saved ? 'PUT' : 'POST');
      if (current()) { setSaved(result); setDirty(false); onSaved(result); form.setFieldsValue({ materials: materialInputs(result) }); }
    } catch (cause) { if (current()) setError(cause); }
    finally { submitting.current = false; }
  }
  const initialValues: Partial<Update> = record ? { ...record, externalRecordKey: record.externalRecordKey ?? undefined, materials: materialInputs(record), occurredAt: record.occurredAt ? new Date(new Date(record.occurredAt).getTime() - new Date(record.occurredAt).getTimezoneOffset() * 60000).toISOString().slice(0, 16) : null } : { materials: [{}], defectQuantity: 1 };
  return <Drawer open title={record ? '维护不良台账' : '登记不良'} size="min(920px, 100vw)" onClose={() => { if (!writer.busy) requestLeave(onClose, true); }} closable={!writer.busy} keyboard={!writer.busy} mask={{ closable: !writer.busy }}>
    <ProcessError cause={error} fallback="保存失败，请重试。" />
    {invalidated ? <Alert type="warning" title="会话已变化，请重新打开编辑器。" /> : null}
    {writer.uncertain ? <Alert type="warning" title="保存结果未知；已锁定原请求，请使用同请求重试，避免重复登记。" /> : null}
    {saved ? <Alert type="success" title={<>已保存 · 版本 {saved.version} <MappingHint record={saved} /></>} /> : null}
    <Form form={form} layout="vertical" initialValues={initialValues} disabled={invalidated || writer.busy || writer.uncertain} onValuesChange={() => setDirty(true)} onFinish={() => void save(form.getFieldsValue(true))}>
      <div className="process-quality-form-grid">
        <Form.Item name="occurredAt" label="发生时间" rules={[{ required: !saved, message: '请填写发生时间' }]}><Input type="datetime-local" /></Form.Item>
        <Form.Item name="productCode" label="成品编码" rules={[{ required: !saved, whitespace: true, message: '请填写成品编码' }]}><Input maxLength={100} /></Form.Item>
        <Form.Item label="追溯码" required={!saved}><div className="process-trace-input"><Form.Item name="traceCode" noStyle rules={[{ required: !saved, whitespace: true, message: '请填写追溯码' }, { max: 200, message: '追溯码最多200个字符' }]}><Input aria-label="追溯码" maxLength={200} onKeyDown={event => { if (event.key === 'Enter') event.preventDefault(); }} /></Form.Item><Button disabled={invalidated || writer.busy || writer.uncertain} onClick={() => setScanning(true)}>手机扫码</Button></div></Form.Item>
        <Form.Item name="defectQuantity" label="不良数量" rules={[{ required: !saved, message: '请填写不良数量' }, { type: 'integer', min: 1, max: 2147483647, message: '请输入正整数' }]}><InputNumber min={1} max={2147483647} /></Form.Item>
      </div>
      <Form.Item name="description" label="不良描述" rules={[{ required: !saved, whitespace: true, message: '请填写不良描述' }, { max: 10000, message: '最多10000个字符' }]}><Input.TextArea rows={3} maxLength={10000} /></Form.Item>
      <div className="process-quality-form-grid"><Form.Item name="workOrderCode" label="工单号"><Input maxLength={100} /></Form.Item><Form.Item name="lineName" label="生产线名称"><Input maxLength={200} /></Form.Item><Form.Item name="operationName" label="工序名称"><Input maxLength={200} /></Form.Item></div>
      {saved?.sourceKind === 'IMS' ? <Form.Item name="externalRecordKey" label="来源明细编号"><Input maxLength={200} readOnly={!!saved.externalRecordKey} placeholder="待补充" /></Form.Item> : null}
      {saved ? <Descriptions size="small" column={2} items={[
        { key: 'project', label: '项目号', children: saved.componentProject?.project?.code ?? '待补配' },
        { key: 'stage', label: '新品/量产', children: saved.projectStage === 'NEW_PRODUCT' ? '新品' : saved.projectStage === 'MASS_PRODUCTION' ? '量产' : '未确认' },
        { key: 'subcategory', label: '细分类型', children: saved.productSubcategory ?? '待补配' },
        { key: 'sector', label: '板块', children: saved.operationSector ?? '待补配' },
        { key: 'shift', label: '班次', children: saved.shift === 'DAY' ? '白班' : saved.shift === 'NIGHT' ? '夜班' : '未知' },
        { key: 'registrant', label: '登记人', children: saved.sourceKind === 'IMS' ? '自动' : saved.registeredByName ?? '—' },
        ...(saved.projectCode ? [{ key: 'legacyProject', label: '原人工项目', children: saved.projectCode }] : []),
      ]} /> : null}
      <Collapse items={[{ key: 'clues', label: '人工表线索与分类（可空）', children: <>
        <div className="process-quality-form-grid">{clueFields.map(([name, label]) => <Form.Item key={name} name={name} label={label}><Input maxLength={name === 'analysisProgress' ? 10000 : 100} /></Form.Item>)}
          <Form.Item name="responsibilityCategory" label="责任分类"><Select allowClear placeholder="待分析" options={categoryOptions} /></Form.Item>
          <Form.Item name="defectTypeCode" label="失效类型"><Select allowClear options={types.filter(type => type.active || type.code === record?.defectTypeCode).map(type => ({ value: type.code, label: `${type.name} (${type.code})` }))} /></Form.Item>
        </div><ProcessError cause={typesError} fallback="失效类型加载失败，未知可空，原值保留。" />{typesError ? <Button onClick={() => setOptionRevision(value => value + 1)}>重试失效类型</Button> : null}
      </> }, { key: 'materials', label: '多物料、供应商与SQE', children: <>
        {!canReadSuppliers ? <Alert type="info" title="无供应商资料读取权限，已有供应商保留。" /> : null}
        <ProcessError cause={sqeError} fallback="有效SQE候选加载失败，请重试。" />
        {sqeError ? <Button onClick={() => setOptionRevision(value => value + 1)}>重试SQE候选</Button> : null}
        <Form.List name="materials">{(fields, { add, remove }) => <>{fields.map(field => <section className="process-quality-card" key={field.key} aria-label={`物料明细 ${field.name + 1}`}>
          <Form.Item name={[field.name, 'id']} hidden><Input /></Form.Item><Form.Item name={[field.name, 'supplierOrganizationId']} hidden><Input /></Form.Item>
          <div className="process-quality-form-grid"><Form.Item name={[field.name, 'materialCode']} label={`物料编码 ${field.name + 1}`}><Input maxLength={100} /></Form.Item><Form.Item name={[field.name, 'materialName']} label={`物料名称 ${field.name + 1}`}><Input maxLength={200} /></Form.Item>
            <Form.Item name={[field.name, 'supplierProfileId']} label={`供应商 ${field.name + 1}`}><Select allowClear disabled={!canReadSuppliers || writer.busy || writer.uncertain} showSearch optionFilterProp="label" options={suppliers.map(supplier => ({ value: supplier.id, label: supplier.displayName }))} onChange={value => form.setFieldValue(['materials', field.name, 'supplierOrganizationId'], suppliers.find(supplier => supplier.id === value)?.supplierOrganizationId ?? null)} /></Form.Item>
            <Form.Item name={[field.name, 'materialBatch']} label={`物料批次 ${field.name + 1}`}><Input maxLength={100} /></Form.Item>
            <Form.Item name={[field.name, 'sqeUserId']} label={`SQE ${field.name + 1}`}><Select allowClear loading={sqeLoading} showSearch filterOption={false} onSearch={value => { setSqeSearch(value); setSqePage(1); }} onChange={id => { const user = sqeChoices.find(user => user.id === id); if (user) setSelectedSqes(previous => ({ ...previous, [user.id]: user })); }} options={[...sqeChoices.map(user => ({ value: user.id, label: personLabel(user) })), ...[...selectedIds].filter(id => !sqeChoices.some(user => user.id === id)).map(id => ({ value: id, label: '原SQE（资料不可用）', disabled: true }))]} /></Form.Item>
            <Form.Item name={[field.name, 'notes']} label={`物料说明 ${field.name + 1}`}><Input maxLength={2000} /></Form.Item>
          </div><Button danger onClick={() => { remove(field.name); setDirty(true); }}>移除此物料</Button>
        </section>)}<Button disabled={fields.length >= 100 || writer.busy || writer.uncertain} onClick={() => { add({}); setDirty(true); }}>添加物料</Button></>}</Form.List>
        {(sqes?.total ?? 0) > 100 ? <Pagination aria-label="SQE候选分页" current={sqePage} pageSize={100} total={sqes?.total} showSizeChanger={false} onChange={setSqePage} /> : null}
      </> }]} />
      <div className="qms-dialog-actions"><Button type="primary" htmlType="submit" loading={writer.busy} disabled={invalidated || writer.busy}>{writer.uncertain ? '同请求重试保存' : '保存登记'}</Button></div>
    </Form>
    {scanning && !invalidated ? <ProcessTraceScanner onScan={value => { form.setFieldValue('traceCode', value); setDirty(true); }} onClose={() => setScanning(false)} /> : null}
    {saved ? <><Typography.Title level={4}>附件与扫描</Typography.Title><AttachmentPanel resource={{ resourceType: 'process-defect', resourceId: saved.id }} fileIds={(saved.evidence ?? []).map(file => file.id)} /></> : null}
  </Drawer>;
}
