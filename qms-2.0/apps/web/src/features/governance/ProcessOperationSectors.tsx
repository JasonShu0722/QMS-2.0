import type { components } from '@qms/contracts';
import { Alert, Button, Card, Form, Input, Modal, Space, Switch } from 'antd';
import { useEffect, useRef, useState } from 'react';
import { ApiError, apiRequest, createAdminMutation } from '../../api/client';
import { useLanguage } from '../../i18n/Language';
import { useNavigationBusy, useNavigationGuard, useUnsavedChanges } from '../../layouts/UnsavedChanges';
import { LedgerTable, useLedgerPageSize } from '../../ui/ledger';
import { getLedgerSessionEpoch } from '../../ui/ledger/preferences';
import { useWorkTabsStore } from '../../work-tabs/workTabsStore';
import type { AdminOrganization } from '../admin/admin';
import { GovernanceFeedback } from './GovernanceFeedback';

type Sector = components['schemas']['ProcessOperationSectorDto'];
type Create = components['schemas']['ProcessOperationSectorInputDto'];
type Update = components['schemas']['UpdateProcessOperationSectorDto'];
type Command = { path: string; method: 'POST' | 'PUT' | 'DELETE'; body?: Create | Update };
const sectorPath = '/api/v1/process-quality/operation-sectors';
export function ProcessOperationSectors({ organization }: { organization: AdminOrganization }) {
  return <SectorContent key={`${organization.id}:${organization.permissions.join(',')}`} organization={organization} />;
}
function SectorContent({ organization }: { organization: AdminOrganization }) {
  const { t } = useLanguage(); const [form] = Form.useForm<Update>();
  const [items, setItems] = useState<Sector[]>([]); const [editor, setEditor] = useState<{ record?: Sector }>(); const [removing, setRemoving] = useState<Sector>();
  const [page, setPage] = useState(1); const [pageSize, setPageSize] = useLedgerPageSize('process-operation-sectors', organization.id);
  const [revision, setRevision] = useState(0); const [loading, setLoading] = useState(true); const [busy, setBusy] = useState(false); const [unknown, setUnknown] = useState(false);
  const [error, setError] = useState<unknown>(); const [dirty, setDirty] = useState(false); const [retired, setRetired] = useState(false);
  const initialScope = useRef(useWorkTabsStore.getState().sessionScope); const initialEpoch = useRef(getLedgerSessionEpoch());
  const alive = useRef(true); const invalidated = useRef(false); const inFlight = useRef(false); const frozen = useRef<Command>(undefined);
  const controller = useRef<AbortController>(undefined); const [mutate] = useState(() => createAdminMutation({ replayAfterReauthentication: false }));
  const requestLeave = useNavigationGuard(); const manage = organization.permissions.includes('process-quality:configuration:manage'); const locked = busy || unknown;
  useUnsavedChanges(dirty || unknown); useNavigationBusy(busy);
  const current = () => alive.current && !invalidated.current && useWorkTabsStore.getState().sessionScope === initialScope.current && getLedgerSessionEpoch() === initialEpoch.current;
  function retire() { invalidated.current = true; controller.current?.abort(); setRetired(true); setItems([]); setEditor(undefined); setRemoving(undefined); setDirty(false); setUnknown(false); frozen.current = undefined; }
  useEffect(() => {
    alive.current = true; controller.current = new AbortController();
    const unsubscribe = useWorkTabsStore.subscribe(() => { if (!current()) retire(); });
    return () => { alive.current = false; controller.current?.abort(); unsubscribe(); };
  }, []);
  useEffect(() => {
    if (!organization.permissions.includes('process-quality:configuration:read') || !current()) return;
    let active = true; setLoading(true); setError(undefined);
    void apiRequest<Sector[]>(`${sectorPath}?organizationId=${encodeURIComponent(organization.id)}`, { signal: controller.current?.signal }).then(value => {
      if (!active || !current()) return;
      if (!Array.isArray(value) || value.some(item => item.organizationId !== organization.id)) { retire(); return; }
      setItems(value);
    }).catch(cause => { if (active && current()) { if (cause instanceof ApiError && [401, 403].includes(cause.status ?? 0)) retire(); else setError(cause); } }).finally(() => { if (active && current()) setLoading(false); });
    return () => { active = false; };
  }, [organization.id, revision]);
  async function execute(command?: Command) {
    if (inFlight.current || !current() || !manage) return;
    const attempt = frozen.current ?? command; if (!attempt) return;
    frozen.current = attempt; inFlight.current = true; setBusy(true); setError(undefined);
    try {
      const result = await mutate<Sector | components['schemas']['DeletedProcessOperationSectorDto']>(attempt.path, attempt.method, attempt.body, controller.current?.signal);
      if (!current()) return;
      if (attempt.method === 'DELETE') setItems(previous => previous.filter(item => item.id !== result.id));
      else if ('organizationId' in result && result.organizationId === organization.id) setItems(previous => [...previous.filter(item => item.id !== result.id), result].sort((first, second) => first.operationName.localeCompare(second.operationName)));
      else { retire(); return; }
      frozen.current = undefined; setUnknown(false); setDirty(false); setEditor(undefined); setRemoving(undefined); form.resetFields();
    } catch (cause) {
      if (!current()) return;
      if (cause instanceof ApiError && cause.code !== 'AUTH_REAUTHENTICATION_REQUIRED' && [401, 403].includes(cause.status ?? 0)) { retire(); return; }
      const known = cause instanceof ApiError && (cause.code === 'CLIENT_REAUTHENTICATION_COMPLETED' || cause.status !== undefined && cause.status >= 400 && cause.status < 500 && ![408, 425].includes(cause.status));
      if (known) frozen.current = undefined;
      setUnknown(!known); setError(cause);
    } finally { inFlight.current = false; if (current()) setBusy(false); }
  }
  function save(values: Update) {
    if (locked) return;
    const facts: Create = { organizationId: organization.id, operationCode: values.operationCode?.trim() || null, operationName: values.operationName.trim(), sectorName: values.sectorName?.trim() || null };
    void execute(editor?.record ? { path: `${sectorPath}/${editor.record.id}?organizationId=${encodeURIComponent(organization.id)}`, method: 'PUT', body: { ...facts, active: values.active, expectedVersion: editor.record.version } } : { path: sectorPath, method: 'POST', body: facts });
  }
  function close() { if (!locked) requestLeave(() => { setDirty(false); setEditor(undefined); setRemoving(undefined); form.resetFields(); }, true); }
  if (retired) return <Alert type="warning" title={t('会话或配置权限已变化，请重新进入。')} />;
  if (!organization.permissions.includes('process-quality:configuration:read')) return null;
  const feedback = <><GovernanceFeedback error={error} />{unknown ? <Alert type="warning" title={t('操作结果未知，输入已保留，请重试原请求。')} /> : null}</>;
  return <Card title={t('工序主数据')}>
    <Space wrap><Button disabled={locked || loading} onClick={() => requestLeave(() => setRevision(value => value + 1))}>{t('刷新规则')}</Button>{manage ? <Button disabled={locked} onClick={() => { form.resetFields(); form.setFieldsValue({ active: true }); setError(undefined); setEditor({}); }}>{t('新建板块规则')}</Button> : null}</Space>
    {!editor && !removing ? feedback : null}
    <LedgerTable<Sector> ledgerId="process-operation-sectors" organizationId={organization.id} requiredColumnKeys={['operationName', 'actions']} rowKey="id" loading={loading} dataSource={items} scroll={{ x: 620 }} pagination={{ current: page, pageSize, disabled: locked, showSizeChanger: true, pageSizeOptions: [10, 20, 50, 100], onChange: (next, size) => { setPage(size === pageSize ? next : 1); setPageSize(size); } }} columns={[
      { key: 'operationCode', title: t('工序编码'), dataIndex: 'operationCode', ellipsis: true }, { key: 'operationName', title: t('工序名称'), dataIndex: 'operationName', ellipsis: true }, { key: 'sectorName', title: t('板块名称'), dataIndex: 'sectorName', ellipsis: true },
      { key: 'active', title: t('状态'), dataIndex: 'active', render: value => t(value ? '启用' : '停用') }, { key: 'version', title: t('版本'), dataIndex: 'version' },
      { key: 'actions', title: t('操作'), render: (_, record) => manage ? <Space wrap><Button disabled={locked} onClick={() => { form.setFieldsValue(record); setError(undefined); setEditor({ record }); }}>{t('编辑')}</Button><Button danger disabled={locked} onClick={() => { setError(undefined); setRemoving(record); }}>{t('删除')}</Button></Space> : t('只读') },
    ]} />
    <Modal open={!!editor} title={t('工序主数据')} footer={null} onCancel={close} closable={!locked} keyboard={!locked} mask={{ closable: !locked }} destroyOnHidden>
      {feedback}<Form form={form} layout="vertical" disabled={locked} onValuesChange={() => setDirty(true)} onFinish={save}>
        <Form.Item name="operationCode" label={t('工序编码')}><Input maxLength={100} readOnly={!!editor?.record?.operationCode} /></Form.Item>
        <Form.Item name="operationName" label={t('工序名称')} rules={[{ required: true, whitespace: true }]}><Input maxLength={200} /></Form.Item>
        <Form.Item name="sectorName" label={t('板块名称')} dependencies={['operationCode']} rules={[({ getFieldValue }) => ({ validator: async (_, value?: string) => {
          if (!getFieldValue('operationCode')?.trim() && !value?.trim()) throw new Error(t('未填写工序编码时，请填写板块名称。'));
        } })]}><Input maxLength={200} /></Form.Item>
        {editor?.record ? <Form.Item name="active" label={t('启用')} valuePropName="checked"><Switch /></Form.Item> : null}
        <Space><Button disabled={locked} onClick={close}>{t('取消')}</Button>{unknown ? <Button type="primary" disabled={busy} loading={busy} onClick={() => void execute()}>{t('重试原请求')}</Button> : <Button type="primary" htmlType="submit" loading={busy}>{t('保存')}</Button>}</Space>
      </Form>
    </Modal>
    <Modal open={!!removing} title={t('删除板块规则')} onCancel={close} closable={!locked} keyboard={!locked} mask={{ closable: !locked }} destroyOnHidden footer={<Space><Button disabled={locked} onClick={close}>{t('取消')}</Button><Button danger type="primary" loading={busy} onClick={() => { if (unknown) void execute(); else if (removing) void execute({ path: `${sectorPath}/${removing.id}?organizationId=${encodeURIComponent(organization.id)}&expectedVersion=${removing.version}`, method: 'DELETE' }); }}>{t(unknown ? '重试原请求' : '确认删除')}</Button></Space>}>
      {feedback}<p>{removing?.operationName} → {removing?.sectorName}</p>
    </Modal>
  </Card>;
}
