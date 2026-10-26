import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Descriptions, Form, Input, Modal, Select, Space, Spin, Tag } from 'antd';
import { useNavigate } from 'react-router-dom';
import type { components } from '@qms/contracts';
import { ApiError, apiRequest, createAdminMutation } from '../../api/client';
import type { AdminOrganization } from '../admin/admin';
import { organizationPath, type Organization } from './governance';
import { GovernanceFeedback } from './GovernanceFeedback';
import { useLanguage } from '../../i18n/Language';
import { useCompletedSessionNavigation, useNavigationBusy, useNavigationGuard, useUnsavedChanges } from '../../layouts/UnsavedChanges';
import { useWorkTabsStore } from '../../work-tabs/workTabsStore';

export function StructureLifecycleActions({ path, record, onChanged, auditOrganizationId }: {
  path: string; record: { id: string; name: string; code: string; version: number; status: 'ACTIVE' | 'DISABLED' }; onChanged: () => void; auditOrganizationId?: string;
}) {
  const { t } = useLanguage();
  const requestLeave = useNavigationGuard();
  const completeSessionNavigation = useCompletedSessionNavigation();
  const navigate = useNavigate();
  const [action, setAction] = useState<'delete' | 'disable' | 'enable'>();
  const [check, setCheck] = useState<components['schemas']['OrganizationLifecycleDto']>();
  const [error, setError] = useState<unknown>();
  const [checking, setChecking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [unknownDelete, setUnknownDelete] = useState(false);
  const generation = useRef(0);
  const alive = useRef(false);
  const reading = useRef<AbortController | undefined>(undefined);
  const pending = useRef(false);
  const mutate = useRef(createAdminMutation());
  const deletion = useRef<{ path: string; body: components['schemas']['DeleteStructureDto']; session: string | undefined } | undefined>(undefined);
  useNavigationBusy(busy);
  useEffect(() => { alive.current = true; return () => { alive.current = false; generation.current++; reading.current?.abort(); }; }, []);
  const label = action === 'delete' ? '删除' : action === 'disable' ? '停用' : '启用';
  const blockers = !check ? [] : action === 'delete' ? check.deleteBlockers : action === 'disable' ? check.disableBlockers : [];
  const details = !check ? [] : action === 'delete' ? check.deleteBlockerDetails : action === 'disable' ? check.disableBlockerDetails : [];
  function fail(cause: unknown) {
    if (cause instanceof ApiError && cause.status === 401) {
      setAction(undefined);
      completeSessionNavigation(() => { useWorkTabsStore.getState().reset(); navigate('/login', { replace: true }); });
    } else setError(cause);
  }
  async function inspect(next: 'delete' | 'disable' | 'enable') {
    const request = ++generation.current;
    const session = useWorkTabsStore.getState().sessionScope;
    const current = () => alive.current && generation.current === request && session === useWorkTabsStore.getState().sessionScope;
    reading.current?.abort(); reading.current = new AbortController();
    setAction(next); setCheck(undefined); setError(undefined); setChecking(true); setUnknownDelete(false); deletion.current = undefined;
    try {
      const result = await apiRequest<components['schemas']['OrganizationLifecycleDto']>(`${path}/lifecycle`, { signal: reading.current.signal });
      if (current()) setCheck(result);
    } catch (cause) { if (current()) fail(cause); }
    finally { if (current()) setChecking(false); }
  }
  async function confirm(recover = false) {
    if (!action || pending.current) return;
    const previous = deletion.current;
    if (recover && (!unknownDelete || !previous || previous.session !== useWorkTabsStore.getState().sessionScope || previous.path !== path || previous.body.expectedVersion !== record.version)) return;
    if (!recover && (!check || checking || error || blockers.length || unknownDelete)) return;
    const request = generation.current;
    const session = useWorkTabsStore.getState().sessionScope;
    const current = () => alive.current && generation.current === request && session === useWorkTabsStore.getState().sessionScope;
    pending.current = true; setBusy(true); setError(undefined);
    try {
      if (action === 'delete') {
        // A lost response must replay the same request, not require a now-deleted target to pass GET again.
        const attempt = deletion.current ?? { path, body: { expectedVersion: record.version }, session };
        deletion.current = attempt;
        const result = await mutate.current<components['schemas']['DeleteStructureResultDto']>(attempt.path, 'DELETE', attempt.body);
        if (!current()) return;
        if (!result.deleted || result.id !== record.id) throw new Error('Unexpected deletion result');
      } else await mutate.current(path, 'PATCH', { expectedVersion: record.version, status: action === 'disable' ? 'DISABLED' : 'ACTIVE' });
      if (current()) { setUnknownDelete(false); setAction(undefined); onChanged(); }
    } catch (cause) {
      if (current()) {
        const unauthorized = cause instanceof ApiError && cause.status === 401;
        const unknown = !unauthorized && action === 'delete' && (recover || !(cause instanceof ApiError) || !cause.status || cause.status >= 500 || cause.status === 408);
        setUnknownDelete(unknown);
        if (!unknown) setCheck(undefined);
        fail(cause);
      }
    }
    finally { pending.current = false; if (current()) setBusy(false); }
  }
  function close() { if (pending.current) return; generation.current++; reading.current?.abort(); setAction(undefined); setCheck(undefined); setError(undefined); setUnknownDelete(false); deletion.current = undefined; }
  return <>
    <Space wrap><Button disabled={busy} onClick={() => requestLeave(() => void inspect(record.status === 'ACTIVE' ? 'disable' : 'enable'))}>{t(record.status === 'ACTIVE' ? '停用' : '启用')}</Button><Button danger disabled={busy} onClick={() => requestLeave(() => void inspect('delete'))}>{t('删除')}</Button></Space>
    <Modal title={`${t(label)} · ${record.name} · ${record.code}`} open={!!action} onCancel={close} onOk={() => void confirm()} okText={t(`确认${label}`)} cancelText={t('取消')} confirmLoading={busy} okButtonProps={{ danger: action !== 'enable', disabled: checking || !check || !!error || blockers.length > 0 || busy || unknownDelete }} cancelButtonProps={{ disabled: busy }} closable={!busy} keyboard={!busy} mask={{ closable: !busy }}>
      <GovernanceFeedback error={error} />
      {checking ? <Spin /> : <>
        <Alert type={blockers.length ? 'warning' : 'info'} showIcon title={t(blockers.length ? '请先处理以下依赖' : '确认时服务端将重新检查依赖及版本，不会级联删除业务数据。')} />
        <ul>{blockers.map((blocker, index) => <li key={index}>{blocker}</li>)}</ul>
        {!!details?.length && <ul>{details.map(detail => <li key={detail.code}>{detail.message} · {detail.count}</li>)}</ul>}
        {check && auditOrganizationId && <Space wrap>
          <a href={`/app/admin?${new URLSearchParams({ organizationId: auditOrganizationId, section: 'audit-log' })}`}>{t('查看组织管理审计')}</a>
          <a href={`/app/admin?${new URLSearchParams({ organizationId: auditOrganizationId, section: 'audit-log', resourceType: 'Organization', resourceId: record.id })}`}>{t('定位此组织审计')}</a>
        </Space>}
        {unknownDelete ? <><Alert showIcon type="warning" title={t('删除结果尚未确认，将使用原请求重试，不会创建新的删除操作。')} /><Button disabled={busy} loading={busy} onClick={() => void confirm(true)}>{t('重试确认结果')}</Button></> : <Button disabled={busy} onClick={() => { if (action) void inspect(action); }}>{t('重新检查依赖')}</Button>}
      </>}
    </Modal>
  </>;
}

export function OrganizationAdministration({ organization, organizations, items, onChanged }: {
  organization: AdminOrganization; organizations: AdminOrganization[]; items: Organization[]; onChanged?: () => void;
}) {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const completeSessionNavigation = useCompletedSessionNavigation();
  const [error, setError] = useState<unknown>();
  const [editor, setEditor] = useState<{ mode: 'create' | 'edit'; target: Organization }>();
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const alive = useRef(false);
  const pending = useRef(false);
  const requestLeave = useNavigationGuard();
  useUnsavedChanges(!!editor && dirty);
  useNavigationBusy(saving);
  const [form] = Form.useForm();
  const [mutate] = useState(createAdminMutation);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const target = items.find(entry => entry.id === organization.id);
  const canManage = organization.permissions.includes('organization:manage');
  function edit(mode: 'create' | 'edit') {
    if (!target || !canManage) return;
    form.resetFields(); form.setFieldsValue(mode === 'edit' ? target : {}); setDirty(false); setError(undefined); setEditor({ target, mode });
  }
  async function save(values: { code: string; name: string; parentId?: string }) {
    if (!editor || pending.current || !canManage) return;
    const session = useWorkTabsStore.getState().sessionScope;
    const current = () => alive.current && session === useWorkTabsStore.getState().sessionScope;
    pending.current = true; setSaving(true); setError(undefined);
    try {
      if (editor.mode === 'create') await mutate(organizationPath(editor.target.id, '/children'), 'POST', { code: values.code, name: values.name });
      else {
        const body: components['schemas']['UpdateOrganizationDto'] = { expectedVersion: editor.target.version, code: values.code, name: values.name, ...(values.parentId && values.parentId !== editor.target.parentId ? { parentId: values.parentId, expectedParentId: editor.target.parentId } : {}) };
        await mutate(organizationPath(editor.target.id), 'PATCH', body);
      }
      if (current()) { setEditor(undefined); setDirty(false); form.resetFields(); onChanged?.(); }
    } catch (cause) {
      if (current()) {
        if (cause instanceof ApiError && cause.status === 401) {
          setEditor(undefined); setDirty(false);
          completeSessionNavigation(() => { useWorkTabsStore.getState().reset(); navigate('/login', { replace: true }); });
        } else setError(cause);
      }
    } finally { pending.current = false; if (current()) setSaving(false); }
  }
  return <section className="governance-panel" aria-label={t('组织基本信息')}>
    {!editor && <GovernanceFeedback error={error} />}
    {target ? <>
      <Descriptions title={target.name} size="small" column={1} items={[
        { key: 'code', label: t('代码'), children: target.code }, { key: 'name', label: t('名称'), children: target.name },
        { key: 'parent', label: t('父组织'), children: items.find(entry => entry.id === target.parentId)?.name ?? '—' },
        { key: 'status', label: t('状态'), children: <Tag color={target.status === 'ACTIVE' ? 'green' : undefined}>{t(target.status === 'ACTIVE' ? '启用' : '停用')}</Tag> },
      ]} />
      {canManage ? <Space wrap><Button disabled={saving} onClick={() => edit('edit')}>{t('编辑')}</Button>{target.status === 'ACTIVE' && <Button disabled={saving} onClick={() => edit('create')}>{t('新增子组织')}</Button>}<StructureLifecycleActions key={`${target.id}:${target.version}`} path={organizationPath(target.id)} record={target} auditOrganizationId={organization.permissions.includes('audit:read') ? organization.id : undefined} onChanged={() => onChanged?.()} /></Space> : t('只读')}
    </> : <Alert type="info" title={t('当前组织基本信息不可读')} />}
    <Modal title={t(editor?.mode === 'create' ? '新增子组织' : '编辑')} open={!!editor} okText={t('保存')} cancelText={t('取消')} confirmLoading={saving} cancelButtonProps={{ disabled: saving }} closable={!saving} keyboard={!saving} mask={{ closable: !saving }} onCancel={() => { if (pending.current) return; requestLeave(() => { setEditor(undefined); setDirty(false); form.resetFields(); }); }} onOk={() => form.submit()}>
      <GovernanceFeedback error={error} />
      <Form name="organization-editor" form={form} layout="vertical" onValuesChange={() => setDirty(true)} onFinish={save} disabled={saving}>
        <Form.Item label={t('代码')} name="code" rules={[{ required: true }, { pattern: /^[A-Za-z0-9][A-Za-z0-9._-]*$/ }]}><Input maxLength={64} /></Form.Item>
        <Form.Item label={t('名称')} name="name" rules={[{ required: true, whitespace: true }]}><Input maxLength={200} /></Form.Item>
        {editor?.mode === 'edit' && <Form.Item label={t('父组织')} name="parentId"><Select options={items.filter(entry => entry.id !== editor.target.id && entry.type === editor.target.type && entry.status === 'ACTIVE' && organizations.find(candidate => candidate.id === entry.id)?.permissions.includes('organization:manage')).map(entry => ({ value: entry.id, label: entry.name }))} /></Form.Item>}
      </Form>
    </Modal>
  </section>;
}
