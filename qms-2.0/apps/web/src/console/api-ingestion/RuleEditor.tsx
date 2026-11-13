import { useState } from 'react';
import { Button, Checkbox, Form, Input, InputNumber, Modal, Select, Space, Switch } from 'antd';
import { Minus, Plus } from 'lucide-react';
import type { components } from '@qms/contracts';
import { useNavigationGuard, useUnsavedChanges } from '../../layouts/UnsavedChanges';
import type { IntegrationScope } from '../api-integrations/integration-ui';
import { IngestionError, ingestionPath, label, useIngestionMutation, useIngestionText, type Endpoint, type Rule } from './ingestion-ui';

type Save = components['schemas']['SaveIngestionRuleDto'];
type Condition = components['schemas']['IngestionConditionDto'];
type ConditionValues = Omit<Condition, 'value'> & { valueType: 'string' | 'number' | 'boolean'; valueText?: string; scalar?: string | number | boolean };
type Values = Omit<Save, 'conditions'> & { conditions: ConditionValues[] };
const operators: Condition['operator'][] = ['EQ', 'NE', 'IN', 'NOT_IN', 'EMPTY', 'NOT_EMPTY'];

export function RuleEditor({ scope, rule, endpoints, endpointsLoading, close, saved }: { scope: IntegrationScope; rule?: Rule; endpoints: Endpoint[]; endpointsLoading: boolean; close: () => void; saved: () => void }) {
  const text = useIngestionText(); const english = text('zh', 'en') === 'en';
  const [form] = Form.useForm<Values>(); const [dirty, setDirty] = useState(false);
  const mutation = useIngestionMutation(scope); const requestLeave = useNavigationGuard();
  useUnsavedChanges(dirty);
  const target = Form.useWatch('target', form) ?? rule?.target ?? 'SUPPLIER';
  const initial: Values = { organizationId: scope.organizationId, name: rule?.name ?? '', endpointId: rule?.endpointId ?? '', target: rule?.target ?? 'SUPPLIER', enabled: rule?.enabled ?? false,
    match: rule?.match ?? 'ALL', mapping: rule?.mapping ?? { code: '', name: '' }, mode: rule?.mode ?? 'INSERT_ONLY', updateFields: rule?.updateFields ?? [], sourceUpdatedAtField: rule?.sourceUpdatedAtField,
    conditions: (rule?.conditions ?? []).map(condition => { const sample = Array.isArray(condition.value) ? condition.value[0] : condition.value; return { path: condition.path, operator: condition.operator, valueType: typeof sample === 'number' ? 'number' : typeof sample === 'boolean' ? 'boolean' : 'string', valueText: Array.isArray(condition.value) ? condition.value.join('\n') : undefined, scalar: !Array.isArray(condition.value) && condition.value !== null ? typeof condition.value === 'boolean' ? String(condition.value) : condition.value : undefined }; }) };
  function save(values: Values) {
    if (mutation.locked) return;
    const parse = (value: string, type: ConditionValues['valueType']) => type === 'number' ? Number(value.trim()) : type === 'boolean' ? value.trim() === 'true' : value;
    const conditions: Condition[] = values.conditions.map(condition => ({ path: condition.path.trim(), operator: condition.operator,
      ...(['EMPTY', 'NOT_EMPTY'].includes(condition.operator) ? {} : { value: ['IN', 'NOT_IN'].includes(condition.operator)
        ? (condition.valueText ?? '').split(/\r?\n/).map(value => parse(value, condition.valueType)) : condition.valueType === 'boolean' ? condition.scalar === 'true' : condition.scalar }) }));
    const mapping: Save['mapping'] = { code: values.mapping.code.trim(), name: values.mapping.name.trim() };
    if (values.target === 'SUPPLIER') for (const field of ['contactName', 'contactEmail']) if (values.mapping[field]?.trim()) mapping[field] = values.mapping[field].trim();
    const body: Save = { organizationId: scope.organizationId, name: values.name.trim(), endpointId: values.endpointId, target: values.target, enabled: values.enabled, match: values.match, conditions, mapping,
      mode: values.mode, updateFields: values.mode === 'INSERT_ONLY' ? [] : values.updateFields.filter(field => field === 'name' || values.target === 'SUPPLIER' && ['contactName', 'contactEmail'].includes(field)),
      ...(values.sourceUpdatedAtField?.trim() ? { sourceUpdatedAtField: values.sourceUpdatedAtField.trim() } : {}) };
    const command = rule ? { path: `${ingestionPath}/rules/${rule.id}`, method: 'PATCH' as const, body: { ...body, expectedVersion: rule.version } satisfies components['schemas']['UpdateIngestionRuleDto'] }
      : { path: `${ingestionPath}/rules`, method: 'POST' as const, body };
    void mutation.execute<Rule>(command, () => { setDirty(false); saved(); });
  }
  const fieldOptions = ['name', ...(target === 'SUPPLIER' ? ['contactName', 'contactEmail'] : [])].map(value => ({ value, label: label(value, english) }));
  const operatorLabel = (value: string) => ({ EQ: text('等于', 'Equals'), NE: text('不等于', 'Not equal'), IN: text('属于', 'In'), NOT_IN: text('不属于', 'Not in'), EMPTY: text('为空', 'Empty'), NOT_EMPTY: text('不为空', 'Not empty') })[value];
  return <Modal open title={text(rule ? '编辑入库规则' : '新增入库规则', rule ? 'Edit ingestion rule' : 'New ingestion rule')} width={850} footer={null} destroyOnHidden mask={{ closable: false }} closable={!mutation.locked} keyboard={!mutation.locked} onCancel={() => { if (!mutation.locked) requestLeave(close, true); }}>
    <Form className="qms-ingestion-form" form={form} layout="vertical" initialValues={initial} disabled={mutation.locked} onValuesChange={() => setDirty(true)} onFinish={save}>
      <div className="qms-ingestion-grid">
        <Form.Item name="name" label={text('规则名称', 'Rule name')} rules={[{ required: true, whitespace: true }]}><Input maxLength={120} /></Form.Item>
        <Form.Item name="endpointId" label={text('接收接口', 'Receiving interface')} rules={[{ required: true }]}><Select disabled={!!rule || mutation.locked} showSearch optionFilterProp="label" loading={endpointsLoading} options={endpoints.map(endpoint => ({ value: endpoint.id, label: endpoint.name }))} /></Form.Item>
        <Form.Item name="target" label={text('目标档案', 'Target record')} rules={[{ required: true }]}><Select disabled={!!rule || mutation.locked} onChange={() => form.setFieldValue('updateFields', [])} options={['SUPPLIER', 'CUSTOMER', 'MATERIAL', 'COMPONENT'].map(value => ({ value, label: label(value, english) }))} /></Form.Item>
        <Form.Item name="enabled" label={text('启用自动入库', 'Enable automatic ingestion')} valuePropName="checked"><Switch /></Form.Item>
      </div>
      <Form.Item name="match" label={text('条件关系', 'Condition matching')}><Select options={[{ value: 'ALL', label: text('全部满足', 'All conditions') }, { value: 'ANY', label: text('任一满足', 'Any condition') }]} /></Form.Item>
      <Form.List name="conditions">{(fields, { add, remove }) => <>
        {fields.map(field => <div className="qms-ingestion-condition" key={field.key}>
          <Form.Item name={[field.name, 'path']} label={text(`判断字段${field.name + 1}`, `Condition field ${field.name + 1}`)} rules={[{ required: true, whitespace: true }]}><Input maxLength={200} /></Form.Item>
          <Form.Item name={[field.name, 'operator']} label={text('比较方式', 'Comparison')}><Select options={operators.map(value => ({ value, label: operatorLabel(value) }))} /></Form.Item>
          <Form.Item noStyle shouldUpdate={(before, after) => before.conditions?.[field.name] !== after.conditions?.[field.name]}>{({ getFieldValue }) => {
            const condition: ConditionValues = getFieldValue(['conditions', field.name]) ?? {};
            if (['EMPTY', 'NOT_EMPTY'].includes(condition.operator)) return <div />;
            return <>
              <Form.Item name={[field.name, 'valueType']} label={text('值类型', 'Value type')}><Select onChange={() => { form.setFieldValue(['conditions', field.name, 'scalar'], undefined); form.setFieldValue(['conditions', field.name, 'valueText'], undefined); }} options={[{ value: 'string', label: text('文字', 'Text') }, { value: 'number', label: text('数字', 'Number') }, { value: 'boolean', label: text('是/否', 'Boolean') }]} /></Form.Item>
              {['IN', 'NOT_IN'].includes(condition.operator)
                ? <Form.Item name={[field.name, 'valueText']} label={text('比较值（每行一个）', 'Values (one per line)')} rules={[{ required: true }, { validator: async (_, value: string) => { const entries = (value ?? '').split(/\r?\n/); if (entries.length > 50) throw new Error(text('最多填写50个比较值', 'Enter at most 50 values')); if (entries.some(entry => !entry.trim() || condition.valueType === 'number' && !Number.isFinite(Number(entry)) || condition.valueType === 'boolean' && !['true', 'false'].includes(entry.trim()))) throw new Error(text('请按所选类型填写每行值；是/否填true或false', 'Enter typed values on each line; use true or false for booleans')); } }]}><Input.TextArea autoSize={{ minRows: 1, maxRows: 5 }} maxLength={4000} /></Form.Item>
                : <Form.Item name={[field.name, 'scalar']} label={text('比较值', 'Value')} rules={[{ required: true, validator: async (_, value) => { if (value === undefined || value === null || condition.valueType === 'string' && value === '') throw new Error(text('请填写比较值', 'Enter a value')); } }]}>{condition.valueType === 'number' ? <InputNumber /> : condition.valueType === 'boolean' ? <Select options={[{ value: 'true', label: text('是', 'True') }, { value: 'false', label: text('否', 'False') }]} /> : <Input maxLength={500} />}</Form.Item>}
            </>;
          }}</Form.Item>
          <Button style={{ marginTop: 30 }} icon={<Minus size={14} />} aria-label={text(`移除条件${field.name + 1}`, `Remove condition ${field.name + 1}`)} onClick={() => remove(field.name)} />
        </div>)}
        <Button icon={<Plus size={14} />} disabled={mutation.locked || fields.length >= 20} onClick={() => add({ path: '', operator: 'EQ', valueType: 'string' })}>{text('添加条件', 'Add condition')}</Button>
      </>}</Form.List>
      <div className="qms-ingestion-grid qms-ingestion-actions">
        <Form.Item name={['mapping', 'code']} label={text('编码来源字段', 'Code source field')} rules={[{ required: true, whitespace: true }]}><Input maxLength={200} /></Form.Item>
        <Form.Item name={['mapping', 'name']} label={text('名称来源字段', 'Name source field')} rules={[{ required: true, whitespace: true }]}><Input maxLength={200} /></Form.Item>
        {target === 'SUPPLIER' && <><Form.Item name={['mapping', 'contactName']} label={text('联系人来源字段', 'Contact source field')}><Input maxLength={200} /></Form.Item><Form.Item name={['mapping', 'contactEmail']} label={text('联系邮箱来源字段', 'Email source field')}><Input maxLength={200} /></Form.Item></>}
        <Form.Item name="sourceUpdatedAtField" label={text('来源更新时间字段', 'Source update time field')}><Input maxLength={200} /></Form.Item>
        <Form.Item name="mode" label={text('已有记录处理', 'Existing records')}><Select options={['INSERT_ONLY', 'UPDATE', 'CONFIRM'].map(value => ({ value, label: label(value, english) }))} /></Form.Item>
      </div>
      <Form.Item noStyle shouldUpdate={(before, after) => before.mode !== after.mode}>{({ getFieldValue }) => getFieldValue('mode') !== 'INSERT_ONLY' && <Form.Item name="updateFields" label={text('允许更新字段', 'Allowed update fields')} rules={[{ type: 'array', min: 1, message: text('请选择至少一个允许更新字段', 'Select at least one update field') }]}><Checkbox.Group options={fieldOptions} /></Form.Item>}</Form.Item>
      <IngestionError error={mutation.error} unknown={mutation.unknown} />
      <Space wrap className="qms-ingestion-actions"><Button disabled={mutation.locked} onClick={() => requestLeave(close, true)}>{text('取消', 'Cancel')}</Button>{mutation.unknown ? <Button type="primary" disabled={mutation.busy} loading={mutation.busy} onClick={mutation.retry}>{text('重试原请求', 'Retry original request')}</Button> : <Button type="primary" htmlType="submit" loading={mutation.busy}>{text('保存', 'Save')}</Button>}</Space>
    </Form>
  </Modal>;
}
