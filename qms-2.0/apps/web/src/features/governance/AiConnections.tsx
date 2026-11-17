import type { components } from '@qms/contracts';
import { Alert, Button, Card, Form, Input, Modal, Select, Space, Switch, Tag } from 'antd';
import { useEffect, useRef, useState } from 'react';
import { ApiError, apiRequest, createAdminMutation, safeAccountError } from '../../api/client';
import { useLanguage } from '../../i18n/Language';
import { useNavigationBusy, useNavigationGuard, useUnsavedChanges } from '../../layouts/UnsavedChanges';
import { LedgerTable, useLedgerPageSize } from '../../ui/ledger';
import { getLedgerSessionEpoch } from '../../ui/ledger/preferences';
import { useWorkTabsStore } from '../../work-tabs/workTabsStore';
import type { AdminOrganization } from '../admin/admin';

type Connection = components['schemas']['AiConnectionDto'];
type Create = components['schemas']['CreateAiConnectionDto'];
type Update = components['schemas']['UpdateAiConnectionDto'];
type TestResult = components['schemas']['AiConnectionTestDto'];
type Command = { path: string; method: 'POST' | 'PATCH'; body: Create | Update | components['schemas']['AiConnectionVersionDto']; kind: 'save' | 'clear' | 'test' };
const aiConnectionsPath = '/api/v1/admin/ai-connections';
const protocols = [
  { value: 'OPENAI_CHAT_COMPLETIONS', label: 'OpenAI Chat Completions' }, { value: 'OPENAI_RESPONSES', label: 'OpenAI Responses' },
  { value: 'ANTHROPIC_MESSAGES', label: 'Anthropic Messages' }, { value: 'GEMINI_GENERATE_CONTENT', label: 'Gemini Generate Content' },
];

export function AiConnections({ organization }: { organization: AdminOrganization }) {
  return <ConnectionContent key={`${organization.id}:${organization.permissions.join(',')}`} organization={organization} />;
}
function ConnectionContent({ organization }: { organization: AdminOrganization }) {
  const { t } = useLanguage(); const [form] = Form.useForm<Update>();
  const [items, setItems] = useState<Connection[]>([]); const [editor, setEditor] = useState<{ record?: Connection }>(); const [clearing, setClearing] = useState<Connection>();
  const [tests, setTests] = useState<Record<string, TestResult>>({});
  const [page, setPage] = useState(1); const [pageSize, setPageSize] = useLedgerPageSize('ai-connections', organization.id);
  const [revision, setRevision] = useState(0); const [loading, setLoading] = useState(true); const [busy, setBusy] = useState(false); const [unknown, setUnknown] = useState(false);
  const [error, setError] = useState<unknown>(); const [dirty, setDirty] = useState(false); const [retired, setRetired] = useState(false);
  const initialScope = useRef(useWorkTabsStore.getState().sessionScope); const initialEpoch = useRef(getLedgerSessionEpoch());
  const alive = useRef(true); const invalidated = useRef(false); const inFlight = useRef(false); const frozen = useRef<Command>(undefined);
  const controller = useRef<AbortController>(undefined); const [mutate] = useState(() => createAdminMutation({ replayAfterReauthentication: false }));
  const requestLeave = useNavigationGuard(); const manage = organization.permissions.includes('ai:connections:manage'); const credentials = organization.permissions.includes('ai:credentials:manage'); const test = organization.permissions.includes('ai:connections:test'); const locked = busy || unknown;
  const models = Form.useWatch('models', form) ?? [];
  useUnsavedChanges(dirty || unknown); useNavigationBusy(busy);
  const current = () => alive.current && !invalidated.current && useWorkTabsStore.getState().sessionScope === initialScope.current && getLedgerSessionEpoch() === initialEpoch.current;
  function retire() { invalidated.current = true; controller.current?.abort(); setRetired(true); setBusy(false); setItems([]); setTests({}); setEditor(undefined); setClearing(undefined); setDirty(false); setUnknown(false); frozen.current = undefined; form.resetFields(); }
  useEffect(() => {
    alive.current = true; controller.current = new AbortController();
    const unsubscribe = useWorkTabsStore.subscribe(() => { if (!current()) retire(); });
    return () => { alive.current = false; controller.current?.abort(); frozen.current = undefined; unsubscribe(); };
  }, []);
  useEffect(() => {
    if (!organization.permissions.includes('ai:connections:read') || !current()) return;
    let active = true; setLoading(true); setError(undefined);
    void apiRequest<Connection[]>(`${aiConnectionsPath}?organizationId=${encodeURIComponent(organization.id)}`, { signal: controller.current?.signal }).then(value => {
      if (!active || !current()) return;
      if (!Array.isArray(value) || value.some(item => item.organizationId !== organization.id)) { retire(); return; }
      setItems(value);
    }).catch(cause => { if (active && current()) { if (cause instanceof ApiError && [401, 403].includes(cause.status ?? 0)) retire(); else setError(cause); } }).finally(() => { if (active && current()) setLoading(false); });
    return () => { active = false; };
  }, [organization.id, revision]);
  async function execute(command?: Command) {
    if (inFlight.current || !current()) return;
    const attempt = frozen.current ?? command; if (!attempt) return;
    if (attempt.kind === 'clear' ? !credentials : attempt.kind === 'test' ? !test : !manage || 'apiKey' in attempt.body && !!attempt.body.apiKey && !credentials) return;
    frozen.current = attempt; inFlight.current = true; setBusy(true); setError(undefined);
    try {
      const result = await mutate<Connection | TestResult>(attempt.path, attempt.method, attempt.body, controller.current?.signal);
      if (!current()) return;
      if (attempt.kind === 'test') {
        if (!('connectionId' in result) || !items.some(item => item.id === result.connectionId)) { retire(); return; }
        setTests(previous => ({ ...previous, [result.connectionId]: result }));
      } else {
        if (!('organizationId' in result) || result.organizationId !== organization.id) { retire(); return; }
        setItems(previous => [...previous.filter(item => item.id !== result.id), result]);
        setTests(previous => { const next = { ...previous }; delete next[result.id]; return next; });
      }
      frozen.current = undefined; setUnknown(false); setDirty(false); setEditor(undefined); setClearing(undefined); form.resetFields();
    } catch (cause) {
      if (!current()) return;
      if (cause instanceof ApiError && cause.code !== 'AUTH_REAUTHENTICATION_REQUIRED' && [401, 403].includes(cause.status ?? 0)) { retire(); return; }
      const known = cause instanceof ApiError && (cause.code === 'CLIENT_REAUTHENTICATION_COMPLETED' || cause.status !== undefined && cause.status >= 400 && cause.status < 500 && ![408, 425].includes(cause.status));
      if (known) frozen.current = undefined;
      setUnknown(!known); setError(cause);
    } finally { inFlight.current = false; if (current()) setBusy(false); }
  }
  function scoped(suffix = '') { return `${aiConnectionsPath}${suffix}?organizationId=${encodeURIComponent(organization.id)}`; }
  function save(values: Update) {
    if (locked || !editor) return;
    const record = editor.record;
    const facts = { name: values.name.trim(), baseUrl: values.baseUrl.trim(), protocol: values.protocol ?? 'OPENAI_CHAT_COMPLETIONS', models: values.models.map(value => value.trim()), defaultModel: values.defaultModel.trim(), enabled: values.enabled };
    const key = values.apiKey ? { apiKey: values.apiKey } : {};
    void execute(record ? { path: scoped(`/${record.id}`), method: 'PATCH', body: { ...facts, ...key, expectedVersion: record.version }, kind: 'save' }
      : { path: scoped(), method: 'POST', body: { ...facts, apiKey: values.apiKey! }, kind: 'save' });
  }
  function close() { if (!locked) requestLeave(() => { setDirty(false); setEditor(undefined); setClearing(undefined); form.resetFields(); }, true); }
  const retry = unknown ? <Button type="primary" disabled={busy} loading={busy} onClick={() => void execute()}>{t('重试原请求')}</Button> : null;
  const feedback = error ? <Alert role="alert" type="error" title={unknown ? t('操作结果未知，请重试原请求。') : t(safeAccountError(error))} /> : null;
  if (retired) return <Alert type="warning" title={t('会话或配置权限已变化，请重新进入。')} />;
  if (!organization.permissions.includes('ai:connections:read')) return null;
  return <Card>
    <Space wrap><Button disabled={locked || loading} onClick={() => requestLeave(() => setRevision(value => value + 1))}>{t('刷新AI连接')}</Button>{manage && credentials ? <Button disabled={locked} onClick={() => { form.resetFields(); form.setFieldsValue({ enabled: false, models: [], protocol: 'OPENAI_CHAT_COMPLETIONS' }); setError(undefined); setEditor({}); }}>{t('新增AI连接')}</Button> : null}</Space>
    {!editor && !clearing ? <>{feedback}{retry}</> : null}
    <LedgerTable<Connection> ledgerId="ai-connections" organizationId={organization.id} requiredColumnKeys={['name', 'actions']} rowKey="id" loading={loading} dataSource={items} scroll={{ x: 800 }} pagination={{ current: page, pageSize, disabled: locked, showSizeChanger: true, pageSizeOptions: [10, 20, 50, 100], onChange: (next, size) => { setPage(size === pageSize ? next : 1); setPageSize(size); } }} columns={[
      { key: 'name', title: t('名称'), dataIndex: 'name' }, { key: 'baseUrl', title: t('服务API地址'), dataIndex: 'baseUrl' }, { key: 'models', title: t('模型'), render: (_, record) => record.models.join(' / ') },
      { key: 'protocol', title: t('渠道协议'), render: (_, record) => protocols.find(protocol => protocol.value === (record.protocol ?? 'OPENAI_CHAT_COMPLETIONS'))?.label ?? '—' },
      { key: 'enabled', title: t('状态'), dataIndex: 'enabled', render: value => t(value ? '启用' : '停用') }, { key: 'hasKey', title: t('密钥状态'), dataIndex: 'hasKey', render: value => t(value ? '已配置' : '未配置') },
      { key: 'test', title: t('连接测试'), render: (_, record) => tests[record.id] ? <Tag color={tests[record.id].status === 'SUCCESS' ? 'success' : 'warning'}>{t(tests[record.id].status === 'SUCCESS' ? '测试成功' : '测试失败，请检查配置')}</Tag> : '—' },
      { key: 'actions', title: t('操作'), render: (_, record) => manage || credentials || test ? <Space wrap>{manage ? <Button disabled={locked} onClick={() => { form.resetFields(); form.setFieldsValue({ name: record.name, baseUrl: record.baseUrl, protocol: record.protocol ?? 'OPENAI_CHAT_COMPLETIONS', models: record.models, defaultModel: record.defaultModel, enabled: record.enabled, apiKey: '' }); setError(undefined); setEditor({ record }); }}>{t('编辑')}</Button> : null}{test ? <Button disabled={locked || !record.hasKey || !record.enabled} onClick={() => void execute({ path: scoped(`/${record.id}/test`), method: 'POST', body: { expectedVersion: record.version }, kind: 'test' })}>{t('测试连接')}</Button> : null}{credentials ? <Button danger disabled={locked || !record.hasKey} onClick={() => { setError(undefined); setClearing(record); }}>{t('清除密钥')}</Button> : null}</Space> : t('只读') },
    ]} />
    <Modal open={!!editor} title={t('AI连接')} footer={null} onCancel={close} closable={!locked} keyboard={!locked} mask={{ closable: !locked }} destroyOnHidden>
      {feedback}<Form form={form} layout="vertical" disabled={locked} onValuesChange={() => setDirty(true)} onFinish={save}>
        <Form.Item name="name" label={t('连接名称')} rules={[{ required: true, whitespace: true }]}><Input maxLength={120} /></Form.Item>
        <Form.Item name="protocol" label={t('渠道协议')} rules={[{ required: true }]}><Select disabled={locked || !credentials} options={protocols} /></Form.Item>
        <Form.Item name="baseUrl" label={t('服务API地址')} rules={[{ required: true, whitespace: true }, { type: 'url', message: t('请填写有效的HTTPS地址') }, { validator: async (_, value: string) => { if (value && !value.startsWith('https://')) throw new Error(t('请填写有效的HTTPS地址')); } }]}><Input disabled={locked || !credentials} maxLength={500} autoComplete="off" /></Form.Item>
        <Form.Item name="models" label={t('可用模型')} rules={[{ required: true, type: 'array', min: 1, max: 30 }]}><Select mode="tags" tokenSeparators={[',', '\n']} onChange={value => { if (!value.includes(form.getFieldValue('defaultModel'))) form.setFieldValue('defaultModel', value[0]); }} /></Form.Item>
        <Form.Item name="defaultModel" label={t('默认模型')} dependencies={['models']} rules={[{ required: true }, { validator: async (_, value: string) => { if (value && !form.getFieldValue('models')?.includes(value)) throw new Error(t('请选择可用模型')); } }]}><Select options={models.map((value: string) => ({ value, label: value }))} /></Form.Item>
        {credentials ? <Form.Item name="apiKey" label={t('API密钥')} dependencies={['baseUrl', 'protocol']} extra={editor?.record?.hasKey ? t('留空保留已保存密钥') : undefined} rules={[{ validator: async (_, value: string) => { if (value) return; if (!editor?.record) throw new Error(t('请填写API密钥')); if (form.getFieldValue('baseUrl')?.trim() !== editor.record.baseUrl) throw new Error(t('更换服务地址时请填写新密钥')); if (form.getFieldValue('protocol') !== (editor.record.protocol ?? 'OPENAI_CHAT_COMPLETIONS')) throw new Error(t('更换渠道协议时请填写新密钥')); } }]}><Input.Password visibilityToggle={false} maxLength={4096} autoComplete="new-password" /></Form.Item> : null}
        <Form.Item name="enabled" label={t('启用连接')} valuePropName="checked"><Switch /></Form.Item>
        {!unknown ? <Button type="primary" htmlType="submit" loading={busy}>{t('保存')}</Button> : null}
      </Form>
      <Space className="qms-ingestion-actions"><Button disabled={locked} onClick={close}>{t('取消')}</Button>{retry}</Space>
    </Modal>
    <Modal open={!!clearing} title={t('清除AI密钥')} onCancel={close} closable={!locked} keyboard={!locked} mask={{ closable: !locked }} destroyOnHidden footer={<Space><Button disabled={locked} onClick={close}>{t('取消')}</Button>{unknown ? retry : <Button danger type="primary" loading={busy} onClick={() => { if (clearing) void execute({ path: scoped(`/${clearing.id}/clear-key`), method: 'POST', body: { expectedVersion: clearing.version }, kind: 'clear' }); }}>{t('确认清除')}</Button>}</Space>}>
      {feedback}<p>{clearing?.name}</p><p>{t('清除后连接将停用；再次使用需重新填写密钥。')}</p>
    </Modal>
  </Card>;
}
