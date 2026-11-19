import { useCallback, useEffect, useRef, useState, type ComponentRef } from 'react';
import type { components } from '@qms/contracts';
import { Alert, Button, Card, Form, Input, Modal, Select, Space, Switch, Table, Tag } from 'antd';
import { useLanguage } from '../../i18n/Language';
import { useNavigationGuard, useUnsavedChanges } from '../../layouts/UnsavedChanges';
import { LedgerTable, useLedgerPageSize } from '../../ui/ledger';
import { getLedgerSessionEpoch } from '../../ui/ledger/preferences';
import { useWorkTabsStore } from '../../work-tabs/workTabsStore';
import { useScopedIntegrationRequests, type IntegrationScope } from '../../console/api-integrations/integration-ui';
import { ingestionPath, IngestionError, useIngestionMutation, useIngestionPage, useIngestionText } from '../../console/api-ingestion/ingestion-ui';
import type { AdminOrganization } from '../admin/admin';
import '../../console/api-ingestion/api-ingestion.css';

type Application = components['schemas']['AiApplicationDto'];
type Settings = components['schemas']['AiApplicationSettingsDto'];
type Connection = components['schemas']['AiConnectionDto'];
type Trial = components['schemas']['AiApplicationTestResultDto'];
type InvocationPage = components['schemas']['AiApplicationInvocationPageDto'];
type Invocation = InvocationPage['items'][number];
type Rule = components['schemas']['IngestionRuleDto'];
const applicationsPath = '/api/v1/admin/ai-applications';
const invocationPermissions = ['audit:read', 'ingestion:read', 'process-quality:defects:read'];
const invocationStatus: Record<Invocation['status'], [string, string]> = {
  SUCCESS: ['成功', 'Succeeded'], PENDING: ['待处理', 'Pending'], PROCESSING: ['处理中', 'Processing'], RETRY: ['待重试', 'Awaiting retry'],
  FAILED: ['失败', 'Failed'], APPLIED: ['已采用', 'Applied'], SUGGESTED: ['待采用', 'Suggested'], STALE: ['已失效', 'Stale'],
};
function ruleVariables(rule: Rule): Settings['variables'] {
  const fields: Array<{ label?: string; variable?: string }> = rule.descriptionComposition?.fields ?? [];
  const variables = fields.flatMap(({ variable, label }) => variable ? [{ variable, label: label ?? '' }] : []);
  return variables.length ? variables : (rule.aiApplication?.inputFields ?? rule.aiDescription?.inputFields ?? []).map(({ variable, label }) => ({ variable, label: label ?? '' }));
}

export function AiApplications({ organization }: { organization: AdminOrganization }) {
  return <ApplicationScope key={`${organization.id}:${organization.permissions.join(',')}`} organization={organization} />;
}
function ApplicationScope({ organization }: { organization: AdminOrganization }) {
  const { t } = useLanguage(); const [retired, setRetired] = useState(false);
  const deny = useCallback(() => setRetired(true), []);
  const [scope] = useState<IntegrationScope>(() => ({ organizationId: organization.id, permissions: organization.permissions, session: useWorkTabsStore.getState().sessionScope!, epoch: getLedgerSessionEpoch(), deny }));
  useEffect(() => useWorkTabsStore.subscribe(state => { if (state.sessionScope !== scope.session || getLedgerSessionEpoch() !== scope.epoch) deny(); }), [scope, deny]);
  if (retired) return <Alert type="warning" title={t('会话或配置权限已变化，请重新进入。')} />;
  if (!organization.permissions.includes('ai:applications:read')) return null;
  return <ApplicationContent organization={organization} scope={scope} />;
}
function ApplicationContent({ organization, scope }: { organization: AdminOrganization; scope: IntegrationScope }) {
  const { t } = useLanguage(); const text = useIngestionText(); const [form] = Form.useForm<Settings>(); const [sampleForm] = Form.useForm<components['schemas']['TestAiApplicationDto']>();
  const [editor, setEditor] = useState<{ record?: Application }>(); const [publishing, setPublishing] = useState<Application>(); const [trial, setTrial] = useState<Application>();
  const [invocations, setInvocations] = useState<Application>();
  const [trialResult, setTrialResult] = useState<Trial>(); const [dirty, setDirty] = useState(false); const [showMutationError, setShowMutationError] = useState(false);
  const [page, setPage] = useState(1); const [pageSize, setPageSize] = useLedgerPageSize('ai-applications', organization.id); const [revision, setRevision] = useState(0);
  const [domain, setDomain] = useState<string>(); const [scene, setScene] = useState<string>();
  const [connections, setConnections] = useState<Connection[]>([]); const [connectionsLoading, setConnectionsLoading] = useState(false); const [connectionError, setConnectionError] = useState<unknown>();
  const [rules, setRules] = useState<Rule[]>([]); const [ruleSourceId, setRuleSourceId] = useState<string>();
  const [rulesLoading, setRulesLoading] = useState(false); const [rulesError, setRulesError] = useState<unknown>(); const [rulesRevision, setRulesRevision] = useState(0);
  const requests = useScopedIntegrationRequests(scope); const mutation = useIngestionMutation(scope); const requestLeave = useNavigationGuard();
  const list = useIngestionPage<components['schemas']['AiApplicationPageDto']>(scope, applicationsPath, page, pageSize, revision);
  const manage = organization.permissions.includes('ai:applications:manage'); const canPublish = organization.permissions.includes('ai:applications:publish'); const canTest = organization.permissions.includes('ai:applications:test'); const readConnections = organization.permissions.includes('ai:connections:read'); const locked = mutation.locked;
  const connectionId = Form.useWatch('connectionId', form); const outputMode = Form.useWatch(['output', 'mode'], form) ?? 'TEXT';
  const selectedConnection = connections.find(item => item.id === connectionId);
  const promptRef = useRef<ComponentRef<typeof Input.TextArea>>(null);
  const sourceRule = rules.find(rule => rule.id === ruleSourceId);
  const sourceVariables = sourceRule ? ruleVariables(sourceRule) : undefined;
  const variables = sourceVariables ?? editor?.record?.variables ?? [];
  const canReadRules = organization.permissions.includes('ingestion:read');
  const canReadInvocations = organization.type === 'INTERNAL' && invocationPermissions.every(permission => organization.permissions.includes(permission));
  useUnsavedChanges(dirty || mutation.unknown);
  useEffect(() => {
    if (!editor || !readConnections) return;
    let active = true; setConnectionsLoading(true); setConnectionError(undefined);
    void requests.read<Connection[]>('/api/v1/admin/ai-connections').then(items => {
      if (!active || !requests.current()) return;
      if (!Array.isArray(items) || items.some(item => item.organizationId !== organization.id)) { scope.deny(); return; }
      setConnections(items);
    }).catch(cause => { if (active && requests.current()) setConnectionError(cause); }).finally(() => { if (active && requests.current()) setConnectionsLoading(false); });
    return () => { active = false; };
  }, [editor, requests.read, requests.current, scope.deny, organization.id, readConnections]);
  useEffect(() => {
    if (!editor || !canReadRules) return;
    let active = true; setRulesLoading(true); setRulesError(undefined);
    void (async () => {
      const items: Rule[] = [];
      for (let page = 1; active && requests.current(); page += 1) {
        const result = await requests.read<components['schemas']['IngestionRulePageDto']>(`${ingestionPath}/rules`, { page: String(page), limit: '100' });
        if (!active || !requests.current()) return;
        if (!Array.isArray(result.items) || result.items.some(item => item.organizationId !== organization.id) || result.page !== page || result.limit !== 100 || !Number.isSafeInteger(result.total) || result.total < 0 || result.items.length === 0 && items.length < result.total) { scope.deny(); return; }
        items.push(...result.items);
        if (items.length >= result.total) break;
      }
      if (active && requests.current()) setRules(items.filter(item => item.target === 'PROCESS_DEFECT' && ruleVariables(item).length));
    })().catch(cause => { if (active && requests.current()) setRulesError(cause); }).finally(() => { if (active && requests.current()) setRulesLoading(false); });
    return () => { active = false; };
  }, [editor, organization.id, canReadRules, requests.read, requests.current, scope.deny, rulesRevision]);
  function reset() { setEditor(undefined); setPublishing(undefined); setTrial(undefined); setTrialResult(undefined); setInvocations(undefined); setDirty(false); setShowMutationError(false); }
  function close() { if (!locked) requestLeave(reset, true); }
  function refresh() { if (!locked) requestLeave(() => { reset(); setRevision(value => value + 1); }, true); }
  function open(record?: Application) {
    if (!manage || locked) return;
    requestLeave(() => {
      reset(); setRuleSourceId(undefined); setRules([]); form.setFieldsValue(record ?? { name: '', domain: 'PROCESS_QUALITY', scene: 'PROCESS_DEFECT_DESCRIPTION', enabled: true, connectionId: '', model: '', prompt: '', output: { mode: 'TEXT', field: 'description', target: 'description' }, fallback: 'DIRECT' }); setEditor({ record });
    }, true);
  }
  function save(values: Settings) {
    if (!manage || locked || !editor) return;
    setShowMutationError(true);
    const body: Settings = { name: values.name.trim(), domain: values.domain, scene: values.scene, enabled: values.enabled, variables, connectionId: values.connectionId, model: values.model.trim(), prompt: values.prompt.trim(), output: { mode: values.output.mode, field: values.output.mode === 'JSON' ? values.output.field.trim() : 'description', target: 'description' }, fallback: 'DIRECT' };
    void mutation.execute<Application>(editor.record ? { path: scoped(`/${editor.record.id}`), method: 'PATCH', body: { ...body, expectedVersion: editor.record.version } } : { path: scoped(), method: 'POST', body }, result => {
      if (result.organizationId !== organization.id) { scope.deny(); return; }
      reset(); setRevision(value => value + 1);
    });
  }
  function insertVariable(variable: string) {
    const prompt = String(form.getFieldValue('prompt') ?? '');
    const textarea = promptRef.current?.resizableTextArea?.textArea;
    const start = textarea?.selectionStart ?? prompt.length;
    const end = textarea?.selectionEnd ?? start;
    const insertion = `{{${variable}}}`;
    if (prompt.length - (end - start) + insertion.length > 4000) return;
    form.setFieldValue('prompt', `${prompt.slice(0, start)}${insertion}${prompt.slice(end)}`);
    setDirty(true);
    requestAnimationFrame(() => { textarea?.focus(); textarea?.setSelectionRange(start + insertion.length, start + insertion.length); });
  }
  function scoped(suffix = '') { return `${applicationsPath}${suffix}?organizationId=${encodeURIComponent(organization.id)}`; }
  function publish() {
    if (!publishing || !canPublish || locked) return;
    setShowMutationError(true);
    void mutation.execute<Application>({ path: scoped(`/${publishing.id}/publish`), method: 'POST', body: { expectedVersion: publishing.version } }, result => {
      if (result.organizationId !== organization.id || result.id !== publishing.id) { scope.deny(); return; }
      reset(); setRevision(value => value + 1);
    });
  }
  function runSamples(values: components['schemas']['TestAiApplicationDto']) {
    if (!trial || !canTest || locked) return;
    setShowMutationError(true);
    void mutation.execute<Trial>({ path: scoped(`/${trial.id}/test`), method: 'POST', body: { expectedVersion: trial.version, samples: trial.variables.map((variable, index) => ({ variable: variable.variable, value: values.samples[index]?.value ?? '' })) } }, result => {
      if (result.applicationId !== trial.id || result.version !== trial.version) { scope.deny(); return; }
      setTrialResult(result); setDirty(false);
    });
  }
  const feedback = <IngestionError error={showMutationError ? mutation.error : undefined} unknown={mutation.unknown} />;
  const retry = mutation.unknown ? <Button type="primary" disabled={mutation.busy} loading={mutation.busy} onClick={mutation.retry}>{t('重试原请求')}</Button> : null;
  return <Card>
    <Space wrap>
      <Select aria-label={t('业务板块')} style={{ minWidth: 150 }} disabled={locked} allowClear placeholder={t('全部板块')} value={domain} options={[{ value: 'PROCESS_QUALITY', label: t('制程质量') }]} onChange={value => requestLeave(() => { setDomain(value); setPage(1); })} />
      <Select aria-label={t('应用场景')} style={{ minWidth: 180 }} disabled={locked} allowClear placeholder={t('全部场景')} value={scene} options={[{ value: 'PROCESS_DEFECT_DESCRIPTION', label: t('不良描述整理') }]} onChange={value => requestLeave(() => { setScene(value); setPage(1); })} />
      <Button disabled={locked || list.loading} onClick={refresh}>{t('刷新')}</Button>{manage && readConnections && canReadRules ? <Button type="primary" disabled={locked} onClick={() => open()}>{t('新增应用')}</Button> : null}
    </Space>
    <IngestionError error={list.error} />{!editor && !publishing && !trial ? <>{feedback}{retry}</> : null}
    <LedgerTable<Application> ledgerId="ai-applications" organizationId={organization.id} requiredColumnKeys={['name', 'actions']} rowKey="id" loading={list.loading} dataSource={(list.data?.items ?? []).filter(item => (!domain || item.domain === domain) && (!scene || item.scene === scene))} scroll={{ x: 950 }} pagination={{ current: page, pageSize, total: list.data?.total ?? 0, disabled: locked, showSizeChanger: true, pageSizeOptions: [10, 20, 50, 100], onChange: (next, size) => requestLeave(() => { setPage(size === pageSize ? next : 1); setPageSize(size); }) }} columns={[
      { key: 'name', title: t('应用名称'), dataIndex: 'name' }, { key: 'domain', title: t('业务板块'), render: () => t('制程质量') }, { key: 'scene', title: t('应用场景'), render: () => t('不良描述整理') },
      { key: 'model', title: t('模型'), dataIndex: 'model' }, { key: 'enabled', title: t('状态'), render: (_, record) => t(record.enabled ? '启用' : '停用') },
      { key: 'version', title: t('草稿版本'), dataIndex: 'version' }, { key: 'publishedVersion', title: t('发布版本'), render: (_, record) => record.publishedVersion === null ? t('未发布') : `v${record.publishedVersion}` },
      { key: 'actions', title: t('操作'), render: (_, record) => manage || canPublish || canTest || canReadInvocations ? <Space wrap>
        {manage ? <Button disabled={locked} onClick={() => open(record)}>{t('编辑')}</Button> : null}
        {canPublish ? <Button disabled={locked || !record.enabled} onClick={() => requestLeave(() => { reset(); setPublishing(record); }, true)}>{t('发布版本')}</Button> : null}
        {canTest ? <Button disabled={locked} onClick={() => requestLeave(() => { reset(); sampleForm.setFieldsValue({ samples: record.variables.map(variable => ({ variable: variable.variable, value: '' })) }); setTrial(record); }, true)}>{t('样本试运行')}</Button> : null}
        {canReadInvocations ? <Button disabled={locked} onClick={() => requestLeave(() => { reset(); setInvocations(record); }, true)}>{text('调用记录', 'Call records')}</Button> : null}
      </Space> : t('只读') },
    ]} />
    {canReadInvocations && invocations ? <InvocationHistory key={invocations.id} scope={scope} application={invocations} close={() => setInvocations(undefined)} /> : null}
    <Modal open={!!editor} title={t('提示词应用')} width={820} footer={null} onCancel={close} closable={!locked} keyboard={!locked} mask={{ closable: !locked }} destroyOnHidden>
      {feedback}<IngestionError error={connectionError} />
      {connectionError ? <Button disabled={locked} onClick={() => setEditor(value => value ? { ...value } : value)}>{t('重试')}</Button> : null}
      <Form form={form} layout="vertical" disabled={locked} onValuesChange={() => setDirty(true)} onFinish={save}>
        <Form.Item name="name" label={t('应用名称')} rules={[{ required: true, whitespace: true }]}><Input maxLength={120} /></Form.Item>
        <div className="qms-ingestion-grid">
          <Form.Item name="domain" label={t('业务板块')} rules={[{ required: true }]}><Select options={[{ value: 'PROCESS_QUALITY', label: t('制程质量') }]} /></Form.Item>
          <Form.Item name="scene" label={t('应用场景')} rules={[{ required: true }]}><Select options={[{ value: 'PROCESS_DEFECT_DESCRIPTION', label: t('不良描述整理') }]} /></Form.Item>
        </div>
        {canReadRules ? <><IngestionError error={rulesError} />{rulesError ? <Button onClick={() => setRulesRevision(value => value + 1)}>{text('重试读取制程规则', 'Retry process rule load')}</Button> : null}
          <Form.Item label={text('变量来源规则', 'Variable source rule')}><Select aria-label={text('变量来源规则', 'Variable source rule')} loading={rulesLoading} showSearch optionFilterProp="label" allowClear value={ruleSourceId} onChange={value => { setRuleSourceId(value); setDirty(true); }} options={rules.map(rule => ({ value: rule.id, label: rule.name }))} /></Form.Item>
        </> : null}
        {variables.map(({ variable, label }, index) => <div className="qms-ingestion-description-row" key={variable}>
          <Form.Item label={t('变量名') + (index + 1)}><Input aria-label={t('变量名') + (index + 1)} readOnly value={variable} /></Form.Item>
          <Form.Item label={t('变量标签') + (index + 1)}><Input aria-label={t('变量标签') + (index + 1)} readOnly value={label} /></Form.Item>
          <Button onClick={() => insertVariable(variable)}>{text('插入', 'Insert')} {variable}</Button>
        </div>)}
        <div className="qms-ingestion-grid qms-ingestion-actions">
          <Form.Item name="connectionId" label={t('模型渠道')} rules={[{ required: true }]}><Select disabled={locked || !readConnections} loading={connectionsLoading} options={connections.map(connection => ({ value: connection.id, label: connection.name, disabled: !connection.enabled || !connection.hasKey }))} onChange={value => form.setFieldValue('model', connections.find(connection => connection.id === value)?.defaultModel)} /></Form.Item>
          <Form.Item name="model" label={t('模型')} dependencies={['connectionId', 'enabled']} rules={[{ required: true }, { validator: async (_, value: string) => { const retainedDisabledReference = !!editor?.record && form.getFieldValue('enabled') === false && editor.record.connectionId === form.getFieldValue('connectionId') && editor.record.model === value; if (value && selectedConnection && !selectedConnection.models.includes(value) && !retainedDisabledReference) throw new Error(t('请选择可用模型')); } }]}><Select disabled={locked || !readConnections} showSearch options={(selectedConnection?.models ?? []).map(value => ({ value, label: value }))} /></Form.Item>
        </div>
        <Form.Item name="prompt" label={t('提示词')} extra={t('使用{{变量名}}引用输入变量')} rules={[{ required: true, whitespace: true }, { validator: async (_, value?: string) => {
          if (!variables.length) throw new Error(text('请选择已配置变量的制程规则', 'Select a process rule with variables'));
          const missing = [...new Set([...(value ?? '').matchAll(/\{\{\s*([^{}]*?)\s*\}\}/g)].map(match => match[1]!.trim()).filter(name => !variables.some(item => item.variable === name)))];
          if (missing.length) throw new Error(text(`来源规则没有定义变量：${missing.join('、')}`, `Variables are missing from the source rule: ${missing.join(', ')}`));
        } }]}><Input.TextArea ref={promptRef} autoSize={{ minRows: 4, maxRows: 10 }} maxLength={4000} /></Form.Item>
        <div className="qms-ingestion-grid">
          <Form.Item name={['output', 'mode']} label={t('模型输出格式')} rules={[{ required: true }]}><Select options={[{ value: 'TEXT', label: t('纯文本') }, { value: 'JSON', label: t('JSON字段') }]} /></Form.Item>
          {outputMode === 'JSON' ? <Form.Item name={['output', 'field']} label={t('提取输出字段')} rules={[{ required: true, whitespace: true }]}><Input maxLength={100} /></Form.Item> : null}
          <Form.Item label={t('输出目标')}><Input readOnly value={t('不良描述')} /></Form.Item>
          <Form.Item label={t('失败处理')}><Input readOnly value={t('使用直接组合描述')} /></Form.Item>
        </div>
        <Form.Item name="enabled" label={t('启用应用')} valuePropName="checked"><Switch /></Form.Item>
        <div className="qms-dialog-actions">
          <Button disabled={locked} onClick={close}>{t('取消')}</Button>
          {mutation.unknown ? retry : <Button type="primary" htmlType="submit" loading={mutation.busy}>{t('保存草稿')}</Button>}
        </div>
      </Form>
    </Modal>
    <Modal open={!!publishing} title={t('发布应用版本')} onCancel={close} closable={!locked} keyboard={!locked} mask={{ closable: !locked }} destroyOnHidden footer={<Space wrap><Button disabled={locked} onClick={close}>{t('取消')}</Button>{mutation.unknown ? retry : <Button type="primary" loading={mutation.busy} onClick={publish}>{t('确认发布')}</Button>}</Space>}>
      {feedback}<p>{publishing?.name}</p><p>{t('既有入库规则仍使用原绑定版本。')}</p>
    </Modal>
    <Modal open={!!trial} title={t('样本试运行')} onCancel={close} closable={!locked} keyboard={!locked} mask={{ closable: !locked }} destroyOnHidden footer={<Space wrap><Button disabled={locked} onClick={close}>{t('关闭')}</Button>{retry}</Space>}>
      {feedback}<Form form={sampleForm} layout="vertical" disabled={locked} onValuesChange={() => { setDirty(true); setTrialResult(undefined); }} onFinish={runSamples}>
        {trial?.variables.map((variable, index) => <Form.Item key={variable.variable} name={['samples', index, 'value']} label={variable.label || variable.variable}><Input.TextArea autoSize={{ minRows: 1, maxRows: 5 }} maxLength={16000} /></Form.Item>)}
        {!mutation.unknown ? <Button type="primary" htmlType="submit" loading={mutation.busy}>{t('运行样本')}</Button> : null}
      </Form>
      {trialResult ? <section aria-label={t('样本结果')}><Tag color={trialResult.status === 'SUCCESS' ? 'success' : 'warning'}>{t(trialResult.status === 'SUCCESS' ? '试运行成功' : '试运行失败，请检查应用和渠道')}</Tag>{trialResult.text !== null ? <p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{trialResult.text}</p> : null}</section> : null}
    </Modal>
  </Card>;
}

function InvocationHistory({ scope, application, close }: { scope: IntegrationScope; application: Application; close: () => void }) {
  const { locale } = useLanguage();
  const text = useIngestionText();
  const [page, setPage] = useState(1);
  const [revision, setRevision] = useState(0);
  const limit = 20;
  const list = useIngestionPage<InvocationPage>(scope, `${applicationsPath}/${encodeURIComponent(application.id)}/invocations`, page, limit, revision);
  return <Modal open title={text('调用记录', 'Call records')} width={1120} onCancel={close} footer={<Button onClick={close}>{text('关闭', 'Close')}</Button>}>
    <Space wrap>
      <strong>{application.name}</strong>
      <Button disabled={list.loading} onClick={() => setRevision(value => value + 1)}>{list.error ? text('重试', 'Retry') : text('刷新', 'Refresh')}</Button>
    </Space>
    <IngestionError error={list.error} />
    <Table<Invocation> size="small" rowKey={record => `${record.source}:${record.id}`} loading={list.loading} dataSource={list.data?.items ?? []} scroll={{ x: 1140 }}
      locale={{ emptyText: list.loading || list.error ? '—' : text('暂无调用记录', 'No call records') }}
      pagination={{ current: page, pageSize: limit, total: Math.min(list.data?.total ?? 0, limit * 10000), showSizeChanger: false, onChange: setPage }} columns={[
        { title: text('记录时间', 'Recorded time'), key: 'recordedAt', render: (_, record) => new Date(record.recordedAt).toLocaleString(locale) },
        { title: text('来源', 'Source'), key: 'source', render: (_, record) => record.source === 'APPLICATION_TEST' ? text('样本试运行', 'Sample test') : text('实际运行任务', 'Runtime task') },
        { title: text('应用版本', 'Application version'), key: 'applicationVersion', render: (_, record) => record.applicationVersion === null ? '—' : record.source === 'APPLICATION_TEST' ? text(`草稿 v${record.applicationVersion}`, `Draft v${record.applicationVersion}`) : text(`发布 v${record.applicationVersion}`, `Published v${record.applicationVersion}`) },
        { title: text('渠道编号', 'Channel ID'), key: 'connectionId', width: 135, ellipsis: true, render: (_, record) => record.connectionId ? `${record.connectionId}${record.connectionVersion === null ? '' : ` / v${record.connectionVersion}`}` : '—' },
        { title: text('模型', 'Model'), key: 'model', width: 125, ellipsis: true, render: (_, record) => record.model ?? '—' },
        { title: text('输出模式', 'Output mode'), dataIndex: 'outputMode', render: (mode: components['schemas']['AiApplicationOutputDto']['mode'] | null) => mode ?? '—' },
        { title: text('状态', 'Status'), key: 'status', render: (_, record) => text(...invocationStatus[record.status]) },
        { title: text('当前尝试次数', 'Current attempts'), key: 'attempts', render: (_, record) => record.attempts ?? '—' },
        { title: text('错误码', 'Error code'), key: 'errorCode', width: 145, ellipsis: true, render: (_, record) => record.errorCode ?? '—' },
        { title: text('任务 / 追踪编号', 'Task / trace ID'), key: 'identifier', width: 160, ellipsis: true, render: (_, record) => record.taskId ?? record.traceId ?? '—' },
      ]} />
  </Modal>;
}
