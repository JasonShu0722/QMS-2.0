import type { components } from '@qms/contracts';
import { Alert, Button, Collapse, Descriptions, Drawer, Form, Input, InputNumber, Select, Typography } from 'antd';
import { useEffect, useId, useRef, useState } from 'react';
import { apiRequest } from '../../api/client';
import { useNavigationBusy, useNavigationGuard, useUnsavedChanges } from '../../layouts/UnsavedChanges';
import { AttachmentPanel } from '../attachments/AttachmentPanel';
import { denied, ProcessError, useProcessWrite, type Defect } from './process-ledger';
import { useWorkTabsStore } from '../../work-tabs/workTabsStore';
import { ProcessTraceScanner } from './ProcessTraceScanner';
import { useLanguage } from '../../i18n/Language';
import { factoryChoices, factoryFieldLabel, factoryLabel } from './process-factory';

type Update = components['schemas']['UpdateProcessDefectDto'];
type Create = components['schemas']['CreateProcessDefectDto'];
const clueFields = [
  ['batchCode', '批次'], ['operationCode', '工序编码'], ['lineCode', '生产线编码'],
] as const;
const factFields = [...clueFields, ['productCode', '成品编码'], ['traceCode', '追溯码'], ['workOrderCode', '工单号'], ['lineName', '生产线名称'], ['operationName', '工序名称']] as const;
export function ProcessDefectEditor({ record, organizationId, onSaved, onClose, onDenied, onWriteDenied = onDenied }: { record?: Defect; organizationId?: string; onSaved: (record: Defect) => void; onClose: () => void; onDenied: (cause?: unknown) => void; onWriteDenied?: (cause?: unknown) => void }) {
  const [form] = Form.useForm<Update>();
  const english = useLanguage().locale === 'en-US';
  const factoryTitle = factoryFieldLabel[english ? 1 : 0];
  const formId = useId();
  const [saved, setSaved] = useState(record);
  const [dirty, setDirty] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<unknown>();
  const [invalidated, setInvalidated] = useState(false);
  const retired = useRef(false);
  const scope = useWorkTabsStore(state => state.sessionScope);
  const initialScope = useRef(scope);
  const [optionRevision, setOptionRevision] = useState(0);
  const [types, setTypes] = useState<components['schemas']['ProcessDefectTypeDto'][]>([]);
  const [typesError, setTypesError] = useState<unknown>();
  const writer = useProcessWrite(onWriteDenied);
  const requestLeave = useNavigationGuard();
  const submitting = useRef(false);
  const alive = useRef(true);
  const editorDisabled = invalidated || writer.busy || writer.uncertain;
  const current = () => alive.current && !retired.current && initialScope.current === useWorkTabsStore.getState().sessionScope;
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => useWorkTabsStore.subscribe(state => {
    if (state.sessionScope === initialScope.current) return;
    retired.current = true; setInvalidated(true);
  }), []);
  useUnsavedChanges(dirty || writer.uncertain);
  useNavigationBusy(writer.busy);
  useEffect(() => {
    let active = true;
    setTypesError(undefined);
    const query = organizationId ? `?organizationId=${encodeURIComponent(organizationId)}` : '';
    void apiRequest<components['schemas']['ProcessDefectTypeDto'][] >(`/api/v1/process-quality/defect-types${query}`).then(value => { if (active && Array.isArray(value)) setTypes(value); }).catch(cause => { if (active) { setTypesError(cause); if (denied(cause)) onDenied(cause); } });
    return () => { active = false; };
  }, [optionRevision, organizationId]);

  async function save(values: Update) {
    if (submitting.current || !current()) return;
    submitting.current = true; setError(undefined);
    try {
      let body: Omit<Update, 'expectedVersion'> = {
        description: values.description?.trim() ?? '', defectTypeCode: values.defectTypeCode || null,
        defectQuantity: values.defectQuantity ?? null,
        // Minute-only display must not truncate an untouched source timestamp.
        occurredAt: saved && !form.isFieldTouched('occurredAt') ? saved.occurredAt : values.occurredAt ? new Date(values.occurredAt).toISOString() : null,
        ...Object.fromEntries(factFields.map(([field]) => [field, values[field]?.trim() || null])),
      };
      if (saved?.sourceKind === 'IMS') {
        body = Object.fromEntries(Object.entries(body).filter(([field, value]) => (value ?? null) !== (saved[field as keyof Defect] ?? null)));
        if (!saved.externalRecordKey && values.externalRecordKey?.trim()) body.externalRecordKey = values.externalRecordKey.trim();
      } else if (values.factoryCode && values.factoryCode !== saved?.factoryCode) {
        body.factoryCode = values.factoryCode;
      }
      if (organizationId) body.organizationId = organizationId;
      let result: Defect;
      if (saved) {
        const update: Update = { ...body, expectedVersion: saved.version };
        result = await writer.write<Defect>(`/api/v1/process-quality/defects/${saved.id}`, update, 'PUT');
      } else {
        if (!values.factoryCode || !body.description || !body.occurredAt || !body.productCode || !body.traceCode || body.defectQuantity == null) return;
        const create: Create = { ...body, factoryCode: values.factoryCode, description: body.description, occurredAt: body.occurredAt, productCode: body.productCode, traceCode: body.traceCode, defectQuantity: body.defectQuantity };
        result = await writer.write<Defect>('/api/v1/process-quality/defects', create, 'POST');
      }
      if (current()) {
        const updated = { ...result, evidence: result.evidence ?? saved?.evidence };
        setSaved(updated);
        setDirty(false);
        onSaved(updated);
        form.setFieldValue('factoryCode', updated.factoryCode ?? undefined);
      }
    } catch (cause) { if (current()) setError(cause); }
    finally { submitting.current = false; }
  }
  const initialValues: Partial<Update> = record ? { ...record, factoryCode: record.sourceKind === 'IMS' ? undefined : record.factoryCode ?? undefined, externalRecordKey: record.externalRecordKey ?? undefined, occurredAt: record.occurredAt ? new Date(new Date(record.occurredAt).getTime() - new Date(record.occurredAt).getTimezoneOffset() * 60000).toISOString().slice(0, 16) : null } : { defectQuantity: 1 };
  return <Drawer open title={record ? '维护不良台账' : '登记不良'} size="min(920px, 100vw)"
    extra={<Button type="primary" htmlType="submit" form={formId} loading={writer.busy} disabled={invalidated || writer.busy}>{writer.uncertain ? '同请求重试保存' : '保存登记'}</Button>}
    onClose={() => { if (!writer.busy) requestLeave(onClose, true); }} closable={!writer.busy} keyboard={!writer.busy} mask={{ closable: !writer.busy }}>
    <ProcessError cause={error} fallback="保存失败，请重试。" />
    {invalidated ? <Alert type="warning" title="会话已变化，请重新打开编辑器。" /> : null}
    {writer.uncertain ? <Alert type="warning" title="保存结果未知；已锁定原请求，请使用同请求重试，避免重复登记。" /> : null}
    <Form id={formId} form={form} layout="vertical" initialValues={initialValues} disabled={editorDisabled} onValuesChange={() => setDirty(true)} onFinish={() => void save(form.getFieldsValue(true))}>
      <div className="process-quality-form-grid">
        <Form.Item name="occurredAt" label="发生时间" rules={[{ required: !saved, message: '请填写发生时间' }]}><Input type="datetime-local" /></Form.Item>
        {saved?.sourceKind !== 'IMS' && <Form.Item name="factoryCode" label={factoryTitle} rules={[{ required: true, message: english ? 'Select a factory' : '请选择工厂' }]}><Select options={factoryChoices.map(([value, zh, en]) => ({ value, label: english ? en : zh }))} /></Form.Item>}
        <Form.Item name="productCode" label="成品编码" rules={[{ required: !saved, whitespace: true, message: '请填写成品编码' }]}><Input maxLength={100} /></Form.Item>
        <Form.Item label="追溯码" required={!saved}><div className="process-trace-input"><Form.Item name="traceCode" noStyle rules={[{ required: !saved, whitespace: true, message: '请填写追溯码' }, { max: 200, message: '追溯码最多200个字符' }]}><Input aria-label="追溯码" maxLength={200} onKeyDown={event => { if (event.key === 'Enter') event.preventDefault(); }} /></Form.Item><Button disabled={invalidated || writer.busy || writer.uncertain} onClick={() => setScanning(true)}>手机扫码</Button></div></Form.Item>
        <Form.Item name="defectQuantity" label="不良数量" rules={[{ required: !saved, message: '请填写不良数量' }, { type: 'integer', min: 1, max: 2147483647, message: '请输入正整数' }]}><InputNumber min={1} max={2147483647} /></Form.Item>
      </div>
      <Form.Item name="description" label="不良描述" rules={[{ required: !saved, whitespace: true, message: '请填写不良描述' }, { max: 10000, message: '最多10000个字符' }]}><Input.TextArea rows={3} maxLength={10000} /></Form.Item>
      <div className="process-quality-form-grid"><Form.Item name="workOrderCode" label="工单号"><Input maxLength={100} /></Form.Item><Form.Item name="lineName" label="生产线名称"><Input maxLength={200} /></Form.Item><Form.Item name="operationName" label="工序名称"><Input maxLength={200} /></Form.Item></div>
      {saved?.sourceKind === 'IMS' ? <Form.Item name="externalRecordKey" label="来源明细编号"><Input maxLength={200} readOnly={!!saved.externalRecordKey} /></Form.Item> : null}
      {saved ? <Descriptions size="small" column={2} items={[
        ...(saved.sourceKind === 'IMS' ? [{ key: 'factoryCode', label: factoryTitle, children: factoryLabel(saved.factoryCode, english) }] : []),
        { key: 'project', label: '项目号', children: saved.componentProject?.project?.code ?? '未确认' },
        { key: 'stage', label: '项目状态', children: saved.projectStage === 'NEW_PRODUCT' ? '新品' : saved.projectStage === 'MASS_PRODUCTION' ? '量产' : '未确认' },
        { key: 'subcategory', label: '细分类型', children: saved.productSubcategory ?? '—' },
        { key: 'sector', label: '板块', children: saved.operationSector ?? '未确认' },
        { key: 'shift', label: '班次', children: saved.shift === 'DAY' ? '白班' : saved.shift === 'NIGHT' ? '夜班' : '未知' },
        { key: 'registrant', label: '登记人', children: saved.sourceKind === 'IMS' ? '自动' : saved.registeredByName ?? '—' },
        ...(saved.projectCode ? [{ key: 'legacyProject', label: '原人工项目', children: saved.projectCode }] : []),
      ]} /> : null}
      <Collapse items={[{ key: 'clues', label: '人工表线索与分类（可空）', children: <>
        <div className="process-quality-form-grid">{clueFields.map(([name, label]) => <Form.Item key={name} name={name} label={label}><Input maxLength={100} /></Form.Item>)}
          <Form.Item name="defectTypeCode" label="失效类型"><Select allowClear options={types.filter(type => type.active || type.code === record?.defectTypeCode).map(type => ({ value: type.code, label: `${type.name} (${type.code})` }))} /></Form.Item>
        </div><ProcessError cause={typesError} fallback="失效类型加载失败，未知可空，原值保留。" />{typesError ? <Button onClick={() => setOptionRevision(value => value + 1)}>重试失效类型</Button> : null}
      </> }]} />
    </Form>
    {scanning && !invalidated ? <ProcessTraceScanner onScan={value => { form.setFieldValue('traceCode', value); setDirty(true); }} onClose={() => setScanning(false)} /> : null}
    {saved ? <><Typography.Title level={4}>附件与扫描</Typography.Title><AttachmentPanel resource={{ resourceType: 'process-defect', resourceId: saved.id }} fileIds={(saved.evidence ?? []).map(file => file.id)} /></> : null}
  </Drawer>;
}
