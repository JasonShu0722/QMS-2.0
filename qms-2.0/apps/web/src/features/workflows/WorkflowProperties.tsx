import { Button, Card, Space } from 'antd';
import { useLanguage } from '../../i18n/Language';
import type { WorkflowEdge, WorkflowGraph, WorkflowNode, WorkflowOptions } from './workflow-api';
import { workflowLabel } from './workflow-labels';

type Config = NonNullable<WorkflowNode['config']>;
type Assignment = NonNullable<Config['assignment']>;
interface Props { graph: WorkflowGraph; selected: string; readOnly: boolean; options: WorkflowOptions; onChange: (graph: WorkflowGraph) => void; onSelect: (id: string) => void }
const nodeTypes = ['ACTION', 'APPROVAL', 'VERIFICATION', 'CC', 'CLOSE'] as const;
const fields = ['status', 'severity', 'problemType', 'domainCode', 'sourceType', 'responsibleParty'] as const;
const closureCopy: Record<string, string> = {
  '受控关闭审核': 'Controlled closure review', '关闭审核策略': 'Closure review policy', '关闭审核领域代码': 'Closure review domain code',
  '内部问题': 'Internal problems', '供应商问题': 'Supplier problems',
  '专业审核与管理审核按受控规则解析；此处配置规则，不指定具体人员 UUID。关闭后须手动配置普通处理范围，不会恢复或编造人员。': 'Professional and management reviews resolve through controlled rules, not specific user UUIDs. After disabling, configure ordinary assignments manually; no people are restored or invented.',
  '发布时校验对应领域接入与配置；保存草稿不代表已发布、绑定或启用。': 'Publishing validates the domain integration and configuration. Saving a draft does not publish, bind or enable it.',
};

function AssignmentFields({ label, value, options, onChange }: { label: string; value?: Assignment; options: WorkflowOptions; onChange: (value: Assignment | undefined) => void }) {
  const { t } = useLanguage();
  const change = (key: keyof Assignment, next: string) => {
    const updated = { ...value, [key]: next || undefined };
    onChange(Object.values(updated).some(Boolean) ? updated : undefined);
  };
  const entries = [
    { key: 'roleCode' as const, label: '角色', choices: options.roles.map((entry) => ({ value: entry.code, name: entry.name })) },
    { key: 'assigneeUserId' as const, label: '处理人', choices: options.users.map((entry) => ({ value: entry.id, name: entry.name })) },
    { key: 'permission' as const, label: '额外权限', choices: options.permissions.map((entry) => ({ value: entry.code, name: entry.name })) },
  ];
  return <fieldset><legend>{t(label)}</legend><p>{t('已配置的处理条件须同时满足。')}</p>{entries.map((entry) => <label key={entry.key}>{t(entry.label)}<select aria-label={`${t(label)} ${t(entry.label)}`} value={value?.[entry.key] ?? ''} onChange={(event) => change(entry.key, event.target.value)}>
    <option value="">{t('不限')}</option>
    {value?.[entry.key] && !entry.choices.some((choice) => choice.value === value[entry.key]) && <option value={value[entry.key]}>{value[entry.key]}</option>}
    {entry.choices.map((choice) => <option key={choice.value} value={choice.value}>{choice.name} ({choice.value})</option>)}
  </select></label>)}</fieldset>;
}

function ConditionFields({ edge, onChange }: { edge: WorkflowEdge; onChange: (edge: WorkflowEdge) => void }) {
  const { t } = useLanguage();
  const condition = edge.condition;
  const multiple = condition && ['in', 'notIn'].includes(condition.operator);
  const values = condition ? (Array.isArray(condition.value) ? condition.value : [condition.value]) : [];
  function setValues(next: (string | null)[]) {
    if (condition) onChange({ ...edge, condition: { ...condition, value: multiple ? next : next[0] ?? null } });
  }
  return <fieldset><legend>{t('分支条件')}</legend><label>{t('条件字段')}<select aria-label={t('条件字段')} value={condition?.field ?? ''} onChange={(event) => onChange({ ...edge, condition: event.target.value ? { field: event.target.value as NonNullable<WorkflowEdge['condition']>['field'], operator: 'eq', value: '' } : undefined })}>
    <option value="">{t('无条件')}</option>{fields.map((field) => <option key={field} value={field}>{t(workflowLabel(field))}</option>)}
  </select></label>{condition && <>
    <label>{t('比较方式')}<select aria-label={t('比较方式')} value={condition.operator} onChange={(event) => {
      const operator = event.target.value as typeof condition.operator;
      onChange({ ...edge, condition: { ...condition, operator, value: ['in', 'notIn'].includes(operator) ? values : values[0] ?? null } });
    }}>{['eq', 'ne', 'in', 'notIn'].map((operator) => <option key={operator} value={operator}>{t(workflowLabel(operator))}</option>)}</select></label>
    {values.map((value, index) => <div key={index}><label>{t('条件值')} {index + 1}<input aria-label={`${t('条件值')} ${index + 1}`} value={value ?? ''} disabled={value === null} maxLength={200} onChange={(event) => setValues(values.map((item, position) => position === index ? event.target.value : item))} /></label>
      <label className="workflow-check"><input type="checkbox" checked={value === null} onChange={(event) => setValues(values.map((item, position) => position === index ? (event.target.checked ? null : '') : item))} />{t('未设置值')}</label>
      {multiple && <Button disabled={values.length < 2} onClick={() => setValues(values.filter((_item, position) => position !== index))}>{t('移除条件值')}</Button>}
    </div>)}
    {multiple && <Button disabled={values.length >= 20} onClick={() => setValues([...values, ''])}>{t('添加条件值')}</Button>}
  </>}</fieldset>;
}

export function WorkflowProperties({ graph, selected, readOnly, options, onChange, onSelect }: Props) {
  const { t: translate, locale } = useLanguage();
  const t = (text: string) => locale === 'en-US' ? closureCopy[text] ?? translate(text) : translate(text);
  const node = graph.nodes.find((entry) => entry.id === selected);
  if (!node) return <Card>{t('选择节点以编辑处理规则和动作连线。')}</Card>;
  const config = node.config ?? {};
  const closure = config.closureReview;
  const eightD = config.processEightD;
  function update(patch: Partial<WorkflowNode>) { if (!readOnly) onChange({ ...graph, nodes: graph.nodes.map((entry) => entry.id === selected ? { ...entry, ...patch } : entry) }); }
  function configure(patch: Partial<Config>) { update({ config: { ...config, ...patch } }); }
  function mark(key: 'isStart' | 'isEnd', checked: boolean) {
    if (!readOnly) onChange({ ...graph, nodes: graph.nodes.map((entry) => entry.id === selected ? { ...entry, config: { ...entry.config, [key]: checked, ...(checked ? { closureReview: undefined } : {}) } } : checked ? { ...entry, config: { ...entry.config, [key]: false } } : entry) });
  }
  function changeEdge(edge: WorkflowEdge) { if (!readOnly) onChange({ ...graph, transitions: graph.transitions.map((entry) => entry.id === edge.id ? edge : entry) }); }
  const actions = node.type === 'CLOSE' ? ['REOPEN', 'RETURN'] : node.type === 'CC' ? ['SUBMIT'] : [node.type === 'APPROVAL' ? 'APPROVE' : node.type === 'VERIFICATION' ? 'VERIFY' : 'SUBMIT', 'RETURN', 'REJECT'];
  return <Card title={t('节点属性')}><fieldset disabled={readOnly} className="workflow-properties-fields">
    <label>{t('节点名称')}<input aria-label={t('节点名称')} maxLength={200} value={node.name} onChange={(event) => update({ name: event.target.value })} /></label>
    <label>{t('节点类型')}<select aria-label={t('节点类型')} value={node.type} onChange={(event) => {
      const type = event.target.value as WorkflowNode['type'];
      update({ type, config: { ...config, processEightD: type === 'ACTION' ? eightD : undefined, closureReview: type === 'APPROVAL' ? closure : undefined, isEnd: type === 'CLOSE' ? config.isEnd : undefined, requireIndependentVerification: type === 'CLOSE' ? config.requireIndependentVerification : undefined, isStart: type === 'CLOSE' ? undefined : config.isStart } });
    }}>{!nodeTypes.some((type) => type === node.type) && <option value={node.type}>{t(workflowLabel(node.type))}</option>}{nodeTypes.map((type) => <option key={type} value={type}>{t(workflowLabel(type))}</option>)}</select></label>
    {node.type !== 'CLOSE' && <label className="workflow-check"><input type="checkbox" disabled={!!eightD} checked={config.isStart === true} onChange={(event) => mark('isStart', event.target.checked)} />{t('起始节点')}</label>}
    {node.type === 'CLOSE' && <><label className="workflow-check"><input type="checkbox" checked={config.isEnd === true} onChange={(event) => mark('isEnd', event.target.checked)} />{t('结束节点')}</label>
      <label className="workflow-check"><input type="checkbox" checked={config.requireIndependentVerification === true} onChange={(event) => configure({ requireIndependentVerification: event.target.checked })} />{t('验证人与关闭人须不同')}</label></>}
    {node.type === 'APPROVAL' && !config.isStart && !config.isEnd && <fieldset><legend>{t('受控关闭审核')}</legend>
      <label className="workflow-check"><input aria-label={t('受控关闭审核')} type="checkbox" checked={!!closure} onChange={(event) => configure(event.target.checked ? { closureReview: { schemaVersion: 1, policy: 'INTERNAL', domainCode: '' }, assignment: undefined, escalation: undefined } : { closureReview: undefined })} />{t('受控关闭审核')}</label>
      <p>{t('专业审核与管理审核按受控规则解析；此处配置规则，不指定具体人员 UUID。关闭后须手动配置普通处理范围，不会恢复或编造人员。')}</p>
      {closure && <>
        <label>{t('关闭审核策略')}<select aria-label={t('关闭审核策略')} value={closure.policy} onChange={(event) => configure({ closureReview: { ...closure, policy: event.target.value as typeof closure.policy }, assignment: undefined, escalation: undefined })}>
          <option value="INTERNAL">{t('内部问题')}</option><option value="SUPPLIER">{t('供应商问题')}</option>
        </select></label>
        <label>{t('关闭审核领域代码')}<input aria-label={t('关闭审核领域代码')} required maxLength={100} value={closure.domainCode} onChange={(event) => configure({ closureReview: { ...closure, domainCode: event.target.value }, assignment: undefined, escalation: undefined })} /></label>
        <p role="note">{t('发布时校验对应领域接入与配置；保存草稿不代表已发布、绑定或启用。')}</p>
      </>}
    </fieldset>}
    {node.type === 'ACTION' && <fieldset><legend>{t('过程8D负责人策略')}</legend>
      <label className="workflow-check"><input aria-label={t('过程8D负责人处理')} type="checkbox" checked={!!eightD} onChange={event => {
        if (readOnly) return;
        if (!event.target.checked) { configure({ processEightD: undefined, assignment: undefined }); return; }
        onChange({ ...graph, nodes: graph.nodes.map(entry => entry.id === selected ? { ...entry, config: { ...config, isStart: true, assignment: { permission: 'workflow:act' }, processEightD: { schemaVersion: 1, extensionPolicy: 'LEADER_THEN_PROFESSIONAL', reminderEveryHours: null }, slaMinutes: undefined, reminders: undefined, escalation: undefined } } : entry.config?.isStart ? { ...entry, config: { ...entry.config, isStart: false } } : entry) });
      }} />{t('过程8D负责人处理')}</label>
      {eightD && <>
        <p>{t('延期按上级→专业审核；负责人从正式8D解析，不指定人员或岗位。')}</p>
        <label>{t('8D提醒间隔（小时）')}<input aria-label={t('8D提醒间隔（小时）')} type="number" min={1} max={8760} step={1} value={eightD.reminderEveryHours ?? ''} onChange={event => {
          const value = event.target.value === '' ? null : Number(event.target.value);
          if (value === null || (Number.isInteger(value) && value >= 1 && value <= 8760)) configure({ processEightD: { schemaVersion: 1, extensionPolicy: 'LEADER_THEN_PROFESSIONAL', reminderEveryHours: value } });
        }} /></label><p>{t('留空关闭提醒；填写1～8760整数小时。不使用通用SLA提醒。')}</p>
      </>}
    </fieldset>}
    {!closure && !eightD && <AssignmentFields label="处理范围" value={config.assignment} options={options} onChange={(assignment) => configure({ assignment })} />}
    {!eightD && <label>{t('处理时限（分钟）')}<input aria-label={t('处理时限（分钟）')} type="number" min={1} max={2147483647} value={config.slaMinutes ?? ''} onChange={(event) => configure(event.target.value ? { slaMinutes: Number(event.target.value) } : { slaMinutes: undefined, reminders: undefined, escalation: undefined })} /></label>}
    {!eightD && config.slaMinutes !== undefined && <>
      <fieldset><legend>{t('截止前提醒')}</legend>{config.reminders?.map((reminder, index) => <Space key={index}>
        <label>{t('提前分钟')} {index + 1}<input aria-label={`${t('提前分钟')} ${index + 1}`} type="number" min={0} max={config.slaMinutes} value={reminder.offsetMinutes} onChange={(event) => configure({ reminders: config.reminders!.map((entry, position) => position === index ? { offsetMinutes: Number(event.target.value) } : entry) })} /></label>
        <Button onClick={() => configure({ reminders: config.reminders!.filter((_entry, position) => position !== index) })}>{t('移除提醒')}</Button>
      </Space>)}<Button disabled={(config.reminders?.length ?? 0) >= 10} onClick={() => configure({ reminders: [...config.reminders ?? [], { offsetMinutes: 0 }] })}>{t('添加提醒')}</Button></fieldset>
      {!closure && <><AssignmentFields label="超时通知负责人" value={config.escalation} options={options} onChange={(escalation) => configure({ escalation })} />
      <p>{t('超时只通知负责人，保留当前处理人和流程节点。')}</p></>}
    </>}
    <fieldset><legend>{t('动作连线')}</legend>{graph.transitions.filter((edge) => edge.from === node.id).map((edge) => <div className="workflow-edge" id={`workflow-edge-${edge.id}`} key={edge.id}>
      <label>{t('动作')}<select aria-label={`${t('动作')} ${edge.id}`} value={edge.action ?? actions[0]} onChange={(event) => changeEdge({ ...edge, action: event.target.value as WorkflowEdge['action'] })}>
        {actions.map((action) => <option key={action} value={action}>{t(workflowLabel(action))}</option>)}
      </select></label><label>{t('目标节点')}<select aria-label={`${t('目标节点')} ${edge.id}`} value={edge.to} onChange={(event) => changeEdge({ ...edge, to: event.target.value })}>
        {graph.nodes.filter((entry) => entry.id !== node.id).map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
      </select></label><ConditionFields edge={edge} onChange={changeEdge} />
      <Button danger onClick={() => onChange({ ...graph, transitions: graph.transitions.filter((entry) => entry.id !== edge.id) })}>{t('删除连线')}</Button>
    </div>)}<Button disabled={graph.nodes.length < 2} onClick={() => onChange({ ...graph, transitions: [...graph.transitions, { id: crypto.randomUUID(), from: node.id, to: graph.nodes.find((entry) => entry.id !== node.id)!.id, action: actions[0] as WorkflowEdge['action'] }] })}>{t('添加连线')}</Button></fieldset>
    <Button danger onClick={() => { onChange({ nodes: graph.nodes.filter((entry) => entry.id !== node.id), transitions: graph.transitions.filter((edge) => edge.from !== node.id && edge.to !== node.id) }); onSelect(''); }}>{t('删除节点及连线')}</Button>
  </fieldset></Card>;
}
