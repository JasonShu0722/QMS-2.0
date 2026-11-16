import { useEffect, useState } from 'react';
import { Button, Card, Checkbox, Form, Input, InputNumber, Modal, Select, Space, Switch } from 'antd';
import { ArrowDown, ArrowUp, Minus, Plus } from 'lucide-react';
import type { components } from '@qms/contracts';
import { useNavigationGuard, useUnsavedChanges } from '../../layouts/UnsavedChanges';
import { useScopedIntegrationRequests, type IntegrationScope } from '../api-integrations/integration-ui';
import { IngestionError, ingestionPath, label, useIngestionMutation, useIngestionText, type Endpoint, type Rule } from './ingestion-ui';

type Save = components['schemas']['SaveIngestionRuleDto'];
type Condition = components['schemas']['IngestionConditionDto'];
type ConditionValues = Omit<Condition, 'value'> & { valueType: 'string' | 'number' | 'boolean'; valueText?: string; scalar?: string | number | boolean };
type Values = Omit<Save, 'conditions'> & { conditions: ConditionValues[]; descriptionMode: 'single' | 'multiple'; aiEnabled: boolean };
const operators: Condition['operator'][] = ['EQ', 'NE', 'IN', 'NOT_IN', 'EMPTY', 'NOT_EMPTY'];
const processFields = ['occurredAt', 'productCode', 'workOrderCode', 'lineCode', 'lineName', 'operationCode', 'operationName', 'traceCode', 'description', 'externalRecordKey'];

export function RuleEditor({ scope, rule, endpoints, endpointsLoading, close, saved }: { scope: IntegrationScope; rule?: Rule; endpoints: Endpoint[]; endpointsLoading: boolean; close: () => void; saved: () => void }) {
  const text = useIngestionText(); const english = text('zh', 'en') === 'en';
  const [form] = Form.useForm<Values>(); const [dirty, setDirty] = useState(false);
  const mutation = useIngestionMutation(scope); const requestLeave = useNavigationGuard();
  const { read, current } = useScopedIntegrationRequests(scope);
  const [connections, setConnections] = useState<components['schemas']['AiConnectionDto'][]>([]);
  const [connectionsLoading, setConnectionsLoading] = useState(false); const [connectionsError, setConnectionsError] = useState<unknown>();
  useUnsavedChanges(dirty);
  const target = Form.useWatch('target', form) ?? rule?.target ?? 'SUPPLIER';
  const descriptionMode = Form.useWatch('descriptionMode', form) ?? (rule?.descriptionComposition ? 'multiple' : 'single');
  const aiEnabled = Form.useWatch('aiEnabled', form) ?? !!rule?.aiDescription;
  const connectionId = Form.useWatch(['aiDescription', 'connectionId'], form);
  const outputMode = Form.useWatch(['aiDescription', 'output', 'mode'], form) ?? rule?.aiDescription?.output.mode ?? 'TEXT';
  const selectedConnection = connections.find(connection => connection.id === connectionId);
  useEffect(() => {
    if (target !== 'PROCESS_DEFECT' || !aiEnabled) return;
    let active = true; setConnectionsLoading(true); setConnectionsError(undefined);
    void read<components['schemas']['AiConnectionDto'][]>('/api/v1/admin/ai-connections').then(result => {
      if (!active || !current()) return;
      if (!Array.isArray(result) || result.some(connection => connection.organizationId !== scope.organizationId)) { scope.deny(); return; }
      setConnections(result);
    }).catch(cause => { if (active && current()) setConnectionsError(cause); }).finally(() => { if (active && current()) setConnectionsLoading(false); });
    return () => { active = false; };
  }, [aiEnabled, target, read, current, scope.organizationId, scope.deny]);
  const initialAiFields: NonNullable<Save['descriptionComposition']>['fields'] = rule?.descriptionComposition?.fields ?? (rule?.mapping.description ? [{ path: rule.mapping.description }] : []);
  const initial: Values = { organizationId: scope.organizationId, name: rule?.name ?? '', endpointId: rule?.endpointId ?? '', target: rule?.target ?? 'SUPPLIER', enabled: rule?.enabled ?? false,
    match: rule?.match ?? 'ALL', mapping: rule?.mapping ?? { code: '', name: '' }, mode: rule?.mode ?? 'INSERT_ONLY', updateFields: rule?.updateFields ?? [], sourceUpdatedAtField: rule?.sourceUpdatedAtField,
    sourceTimezone: rule?.sourceTimezone ?? 'Asia/Shanghai', descriptionMode: rule?.descriptionComposition ? 'multiple' : 'single', descriptionComposition: rule?.descriptionComposition ?? { fields: [{ path: '' }], separator: '\n' },
    aiEnabled: !!rule?.aiDescription, aiDescription: rule?.aiDescription ?? { connectionId: '', model: '', prompt: '', inputFields: initialAiFields.map((field, index) => ({ path: field.path, label: field.label ?? field.path, variable: `field${index + 1}` })), output: { mode: 'TEXT', field: 'description', target: 'description' } },
    conditions: (rule?.conditions ?? []).map(condition => { const sample = Array.isArray(condition.value) ? condition.value[0] : condition.value; return { path: condition.path, operator: condition.operator, valueType: typeof sample === 'number' ? 'number' : typeof sample === 'boolean' ? 'boolean' : 'string', valueText: Array.isArray(condition.value) ? condition.value.join('\n') : undefined, scalar: !Array.isArray(condition.value) && condition.value !== null ? typeof condition.value === 'boolean' ? String(condition.value) : condition.value : undefined }; }) };
  function save(values: Values) {
    if (mutation.locked) return;
    const parse = (value: string, type: ConditionValues['valueType']) => type === 'number' ? Number(value.trim()) : type === 'boolean' ? value.trim() === 'true' : value;
    const conditions: Condition[] = values.conditions.map(condition => ({ path: condition.path.trim(), operator: condition.operator,
      ...(['EMPTY', 'NOT_EMPTY'].includes(condition.operator) ? {} : { value: ['IN', 'NOT_IN'].includes(condition.operator)
        ? (condition.valueText ?? '').split(/\r?\n/).map(value => parse(value, condition.valueType)) : condition.valueType === 'boolean' ? condition.scalar === 'true' : condition.scalar }) }));
    const process = values.target === 'PROCESS_DEFECT';
    const allowedFields = process ? processFields.filter(field => field !== 'externalRecordKey') : ['name', ...(values.target === 'SUPPLIER' ? ['contactName', 'contactEmail'] : [])];
    const mapping: Save['mapping'] = process ? Object.fromEntries(processFields.filter(field => !(field === 'description' && values.descriptionMode === 'multiple') && values.mapping[field]?.trim()).map(field => [field, values.mapping[field].trim()])) : { code: values.mapping.code.trim(), name: values.mapping.name.trim() };
    if (values.target === 'SUPPLIER') for (const field of ['contactName', 'contactEmail']) if (values.mapping[field]?.trim()) mapping[field] = values.mapping[field].trim();
    const body: Save = { organizationId: scope.organizationId, name: values.name.trim(), endpointId: values.endpointId, target: values.target, enabled: values.enabled, match: values.match, conditions, mapping,
      mode: values.mode, updateFields: values.mode === 'INSERT_ONLY' ? [] : values.updateFields.filter(field => allowedFields.includes(field)),
      ...(process ? { sourceTimezone: values.sourceTimezone?.trim() || 'Asia/Shanghai', ...(values.descriptionMode === 'multiple' ? { descriptionComposition: { fields: (values.descriptionComposition?.fields ?? []).map(field => ({ path: field.path.trim(), ...(field.label?.trim() ? { label: field.label.trim() } : {}) })), separator: values.descriptionComposition?.separator ?? '\n' } } : {}) } : {}),
      ...(process && values.aiEnabled && values.aiDescription ? { aiDescription: { connectionId: values.aiDescription.connectionId, model: values.aiDescription.model.trim(), prompt: values.aiDescription.prompt.trim(), inputFields: values.aiDescription.inputFields.map(field => ({ path: field.path.trim(), label: field.label?.trim() || field.path.trim(), variable: field.variable.trim() })), output: { mode: values.aiDescription.output.mode, target: 'description', field: values.aiDescription.output.mode === 'JSON' ? values.aiDescription.output.field.trim() : 'description' } } } : {}),
      ...(values.sourceUpdatedAtField?.trim() ? { sourceUpdatedAtField: values.sourceUpdatedAtField.trim() } : {}) };
    const command = rule ? { path: `${ingestionPath}/rules/${rule.id}`, method: 'PATCH' as const, body: { ...body, expectedVersion: rule.version } satisfies components['schemas']['UpdateIngestionRuleDto'] }
      : { path: `${ingestionPath}/rules`, method: 'POST' as const, body };
    void mutation.execute<Rule>(command, () => { setDirty(false); saved(); });
  }
  const fieldOptions = (target === 'PROCESS_DEFECT' ? processFields.filter(field => field !== 'externalRecordKey') : ['name', ...(target === 'SUPPLIER' ? ['contactName', 'contactEmail'] : [])]).map(value => ({ value, label: label(value, english) }));
  const operatorLabel = (value: string) => ({ EQ: text('等于', 'Equals'), NE: text('不等于', 'Not equal'), IN: text('属于', 'In'), NOT_IN: text('不属于', 'Not in'), EMPTY: text('为空', 'Empty'), NOT_EMPTY: text('不为空', 'Not empty') })[value];
  return <Modal open title={text(rule ? '编辑入库规则' : '新增入库规则', rule ? 'Edit ingestion rule' : 'New ingestion rule')} width={850} footer={null} destroyOnHidden mask={{ closable: false }} closable={!mutation.locked} keyboard={!mutation.locked} onCancel={() => { if (!mutation.locked) requestLeave(close, true); }}>
    <Form className="qms-ingestion-form" form={form} layout="vertical" initialValues={initial} disabled={mutation.locked} onValuesChange={() => setDirty(true)} onFinish={save}>
      <div className="qms-ingestion-grid">
        <Form.Item name="name" label={text('规则名称', 'Rule name')} rules={[{ required: true, whitespace: true }]}><Input maxLength={120} /></Form.Item>
        <Form.Item name="endpointId" label={text('接收接口', 'Receiving interface')} rules={[{ required: true }]}><Select disabled={!!rule || mutation.locked} showSearch optionFilterProp="label" loading={endpointsLoading} options={endpoints.map(endpoint => ({ value: endpoint.id, label: endpoint.name }))} /></Form.Item>
        <Form.Item name="target" label={text('目标档案', 'Target record')} rules={[{ required: true }]}><Select disabled={!!rule || mutation.locked} onChange={() => form.setFieldValue('updateFields', [])} options={['SUPPLIER', 'CUSTOMER', 'MATERIAL', 'COMPONENT', 'PROCESS_DEFECT'].map(value => ({ value, label: label(value, english) }))} /></Form.Item>
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
        {target === 'PROCESS_DEFECT' ? <>
          {processFields.filter(field => field !== 'description').map(field => <Form.Item key={field} name={['mapping', field]} label={text(`${label(field, false)}来源字段`, `${label(field, true)} source field`)}><Input maxLength={200} /></Form.Item>)}
          <Form.Item name="sourceTimezone" label={text('来源时区', 'Source timezone')} rules={[{ validator: async (_, value: string) => { if (!value?.trim()) return; try { new Intl.DateTimeFormat('en', { timeZone: value.trim() }); } catch { throw new Error(text('请填写有效的IANA时区', 'Enter a valid IANA timezone')); } } }]}><Input maxLength={100} placeholder="Asia/Shanghai" /></Form.Item>
          <Form.Item name="descriptionMode" label={text('不良描述来源', 'Description source')}><Select options={[{ value: 'single', label: text('单字段', 'Single field') }, { value: 'multiple', label: text('多字段组合', 'Ordered fields') }]} /></Form.Item>
          {descriptionMode === 'single' && <Form.Item name={['mapping', 'description']} label={text('不良描述来源字段', 'Description source field')}><Input maxLength={200} /></Form.Item>}
        </> : <><Form.Item name={['mapping', 'code']} label={text('编码来源字段', 'Code source field')} rules={[{ required: true, whitespace: true }]}><Input maxLength={200} /></Form.Item>
        <Form.Item name={['mapping', 'name']} label={text('名称来源字段', 'Name source field')} rules={[{ required: true, whitespace: true }]}><Input maxLength={200} /></Form.Item></>}
        {target === 'SUPPLIER' && <><Form.Item name={['mapping', 'contactName']} label={text('联系人来源字段', 'Contact source field')}><Input maxLength={200} /></Form.Item><Form.Item name={['mapping', 'contactEmail']} label={text('联系邮箱来源字段', 'Email source field')}><Input maxLength={200} /></Form.Item></>}
        <Form.Item name="sourceUpdatedAtField" label={text('来源更新时间字段', 'Source update time field')}><Input maxLength={200} /></Form.Item>
        <Form.Item name="mode" label={text('已有记录处理', 'Existing records')}><Select options={['INSERT_ONLY', 'UPDATE', 'CONFIRM'].map(value => ({ value, label: label(value, english) }))} /></Form.Item>
      </div>
      {target === 'PROCESS_DEFECT' && descriptionMode === 'multiple' && <>
        <Form.Item name={['descriptionComposition', 'separator']} label={text('描述分隔符', 'Description separator')}><Select options={[{ value: '\n', label: text('换行', 'Newline') }, { value: ' ', label: text('空格', 'Space') }, ...['；', '，', '; ', ', ', ' / ', ' | '].map(value => ({ value, label: value }))]} /></Form.Item>
        <Form.List name={['descriptionComposition', 'fields']} rules={[{ validator: async (_, fields) => { if (!fields?.length) throw new Error(text('请添加至少一个描述字段', 'Add at least one description field')); } }]}>{(fields, { add, remove, move }, { errors }) => <>
          {fields.map(field => <div className="qms-ingestion-description-row" key={field.key}>
            <Form.Item name={[field.name, 'path']} label={text(`描述来源字段${field.name + 1}`, `Description field ${field.name + 1}`)} rules={[{ required: true, whitespace: true }]}><Input maxLength={200} /></Form.Item>
            <Form.Item name={[field.name, 'label']} label={text(`描述标签${field.name + 1}`, `Description label ${field.name + 1}`)}><Input maxLength={100} /></Form.Item>
            <Space wrap><Button icon={<ArrowUp size={14} />} aria-label={text(`上移描述字段${field.name + 1}`, `Move description field ${field.name + 1} up`)} disabled={field.name === 0} onClick={() => move(field.name, field.name - 1)} /><Button icon={<ArrowDown size={14} />} aria-label={text(`下移描述字段${field.name + 1}`, `Move description field ${field.name + 1} down`)} disabled={field.name === fields.length - 1} onClick={() => move(field.name, field.name + 1)} /><Button icon={<Minus size={14} />} aria-label={text(`移除描述字段${field.name + 1}`, `Remove description field ${field.name + 1}`)} onClick={() => remove(field.name)} /></Space>
          </div>)}
          <Form.ErrorList errors={errors} /><Button icon={<Plus size={14} />} disabled={fields.length >= 20} onClick={() => add({ path: '' })}>{text('添加描述字段', 'Add description field')}</Button>
        </>}</Form.List>
      </>}
      {target === 'PROCESS_DEFECT' && <Card size="small" className="qms-ingestion-actions">
        <Form.Item name="aiEnabled" label={text('AI整理', 'AI description')} valuePropName="checked"><Switch /></Form.Item>
        {aiEnabled && <>
          <IngestionError error={connectionsError} />
          <div className="qms-ingestion-grid">
            <Form.Item name={['aiDescription', 'connectionId']} label={text('AI连接', 'AI connection')} rules={[{ required: true }]}><Select loading={connectionsLoading} options={connections.map(connection => ({ value: connection.id, label: connection.name, disabled: !connection.enabled || !connection.hasKey }))} onChange={value => form.setFieldValue(['aiDescription', 'model'], connections.find(connection => connection.id === value)?.defaultModel)} /></Form.Item>
            <Form.Item name={['aiDescription', 'model']} label={text('AI模型', 'AI model')} dependencies={[[ 'aiDescription', 'connectionId' ]]} rules={[{ required: true }, { validator: async (_, value: string) => { if (value && selectedConnection && !selectedConnection.models.includes(value)) throw new Error(text('请选择该连接的可用模型', 'Select an allowed model for this connection')); } }]}><Select showSearch options={(selectedConnection?.models ?? []).map(value => ({ value, label: value }))} /></Form.Item>
          </div>
          <Button disabled={mutation.locked} onClick={() => { const fields = form.getFieldValue('descriptionMode') === 'single' ? [{ path: form.getFieldValue(['mapping', 'description']) ?? '' }] : form.getFieldValue(['descriptionComposition', 'fields']) ?? []; form.setFieldValue(['aiDescription', 'inputFields'], fields.map((field: NonNullable<Save['descriptionComposition']>['fields'][number], index: number) => ({ path: field.path, label: field.label ?? field.path, variable: `field${index + 1}` }))); setDirty(true); }}>{text('复用描述来源字段', 'Reuse description fields')}</Button>
          <Form.List name={['aiDescription', 'inputFields']} rules={[{ validator: async (_, fields) => { if (!fields?.length) throw new Error(text('请添加至少一个AI输入字段', 'Add at least one AI input field')); if (new Set(fields.map((field: { variable?: string }) => field.variable?.trim())).size !== fields.length) throw new Error(text('变量名不能重复', 'Variable names must be unique')); } }]}>{(fields, { add, remove }, { errors }) => <>
            {fields.map(field => <div className="qms-ingestion-description-row qms-ingestion-ai-row" key={field.key}>
              <Form.Item name={[field.name, 'path']} label={text(`AI输入字段${field.name + 1}`, `AI input field ${field.name + 1}`)} rules={[{ required: true, whitespace: true }]}><Input maxLength={200} /></Form.Item>
              <Form.Item name={[field.name, 'label']} label={text(`AI字段标签${field.name + 1}`, `AI field label ${field.name + 1}`)}><Input maxLength={100} /></Form.Item>
              <Form.Item name={[field.name, 'variable']} label={text(`提示词变量${field.name + 1}`, `Prompt variable ${field.name + 1}`)} rules={[{ required: true }, { pattern: /^[A-Za-z][A-Za-z0-9_]*$/, message: text('使用字母开头的字母、数字或下划线', 'Start with a letter and use letters, digits or underscores') }]}><Input maxLength={64} /></Form.Item>
              <Button icon={<Minus size={14} />} aria-label={text(`移除AI输入字段${field.name + 1}`, `Remove AI input field ${field.name + 1}`)} onClick={() => remove(field.name)} />
            </div>)}
            <Form.ErrorList errors={errors} /><Button icon={<Plus size={14} />} disabled={mutation.locked || fields.length >= 20} onClick={() => add({ path: '', label: '', variable: `field${fields.length + 1}` })}>{text('添加AI输入字段', 'Add AI input field')}</Button>
          </>}</Form.List>
          <Form.Item name={['aiDescription', 'prompt']} label={text('描述提示词', 'Description prompt')} extra={text('使用{{变量名}}引用上方输入字段', 'Use {{variable}} to reference selected input fields')} rules={[{ required: true, whitespace: true }]}><Input.TextArea rows={4} maxLength={4000} /></Form.Item>
          <div className="qms-ingestion-grid">
            <Form.Item name={['aiDescription', 'output', 'mode']} label={text('模型输出格式', 'Model output format')}><Select options={[{ value: 'TEXT', label: text('纯文本', 'Plain text') }, { value: 'JSON', label: text('JSON字段', 'JSON field') }]} /></Form.Item>
            {outputMode === 'JSON' && <Form.Item name={['aiDescription', 'output', 'field']} label={text('提取输出字段', 'Output field')} rules={[{ required: true, whitespace: true }]}><Input maxLength={100} /></Form.Item>}
            <Form.Item label={text('输出目标', 'Output target')}><Input aria-label={text('输出目标', 'Output target')} readOnly value={text('不良描述', 'Defect description')} /></Form.Item>
          </div>
        </>}
      </Card>}
      <Form.Item noStyle shouldUpdate={(before, after) => before.mode !== after.mode}>{({ getFieldValue }) => getFieldValue('mode') !== 'INSERT_ONLY' && <Form.Item name="updateFields" label={text('允许更新字段', 'Allowed update fields')} rules={[{ type: 'array', min: 1, message: text('请选择至少一个允许更新字段', 'Select at least one update field') }]}><Checkbox.Group options={fieldOptions} /></Form.Item>}</Form.Item>
      <IngestionError error={mutation.error} unknown={mutation.unknown} />
      {!mutation.unknown && <Button className="qms-ingestion-actions" type="primary" htmlType="submit" loading={mutation.busy}>{text('保存', 'Save')}</Button>}
    </Form>
    <Space wrap className="qms-ingestion-actions"><Button disabled={mutation.locked} onClick={() => requestLeave(close, true)}>{text('取消', 'Cancel')}</Button>{mutation.unknown ? <Button type="primary" disabled={mutation.busy} loading={mutation.busy} onClick={mutation.retry}>{text('重试原请求', 'Retry original request')}</Button> : null}</Space>
  </Modal>;
}
