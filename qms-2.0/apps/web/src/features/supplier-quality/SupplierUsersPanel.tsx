import { Alert, Button, Form, Input, Modal, Popconfirm, Space, Table, Typography } from 'antd';
import type { components } from '@qms/contracts';
import { useLayoutEffect, useRef, useState } from 'react';
import { ApiError, apiRequest } from '../../api/client';
import { useLanguage } from '../../i18n/Language';
import { useNavigationGuard, useUnsavedChanges } from '../../layouts/UnsavedChanges';
import { useWorkTabsStore } from '../../work-tabs/workTabsStore';
import { UserForceDelete } from '../admin/UserForceDelete';
import { UserTemporaryPassword } from '../admin/UserTemporaryPassword';
import { createSupplierMutation, supplierApi, supplierError, type SupplierProfile } from './supplierQuality';

type Account = components['schemas']['SupplierAccountDto'];
type AccountPage = components['schemas']['SupplierAccountPageDto'];
type Create = components['schemas']['CreateSupplierAccountDto'];
type Created = components['schemas']['CreatedSupplierAccountDto'];
type Temporary = components['schemas']['TemporaryPasswordDto'];
type Props = { profile: SupplierProfile; organizationId?: string; organizationPermissions: string[]; onBound: () => void | Promise<void>; onClose: () => void; onDenied?: (cause: ApiError) => void };

export function SupplierUsersPanel(props: Props) {
  const session = useWorkTabsStore(state => state.sessionScope);
  return <UsersContent key={JSON.stringify([session, props.organizationId, props.profile.id, [...props.organizationPermissions].sort()])} {...props} session={session} />;
}

function UsersContent({ profile, organizationId, organizationPermissions, onBound, onClose, onDenied, session }: Props & { session?: string }) {
  const { t } = useLanguage();
  const [data, setData] = useState<AccountPage>();
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [bound, setBound] = useState(profile.supplierOrganizationId);
  const [error, setError] = useState<unknown>();
  const [selected, setSelected] = useState<Account>();
  const [temporary, setTemporary] = useState<Temporary>();
  const [passwordRevision, setPasswordRevision] = useState(0);
  const [form] = Form.useForm<Create>();
  const requestLeave = useNavigationGuard();
  const [invalidated, setInvalidated] = useState(false);
  const [denied, setDenied] = useState(false);
  const controller = useRef(new AbortController());
  const alive = useRef(true);
  const sequence = useRef(0);
  const pending = useRef(false);
  const createMutation = useRef(createSupplierMutation());
  const statusMutation = useRef(createSupplierMutation());
  const passwordMutation = useRef(createSupplierMutation());
  const base = `${supplierApi(false)}/profiles/${profile.id}/accounts`;
  const scoped = (path: string) => organizationId ? `${path}?organizationId=${encodeURIComponent(organizationId)}` : path;
  const scope = organizationId ? { organizationId } : {};
  const ownerWrite = organizationPermissions.includes('supplier-quality:profiles:write');
  const canCreate = !denied && !invalidated && ownerWrite && data?.canCreate === true;
  const canReset = !denied && !invalidated && ownerWrite && data?.canReset === true;
  const canStatus = !denied && !invalidated && ownerWrite && data?.canSetStatus === true;
  const locked = busy || passwordBusy;
  useUnsavedChanges(dirty || locked);

  function clearProjections() {
    sequence.current++; controller.current.abort();
    setData(undefined); setSelected(undefined); setTemporary(undefined); setBound(null);
    form.resetFields(); setDirty(false); setBusy(false); setPasswordBusy(false); setLoading(false);
    setPasswordRevision(value => value + 1);
  }
  function failed(cause: unknown) {
    if (!alive.current) return;
    setError(cause);
    if (cause instanceof ApiError && [401, 403].includes(cause.status ?? 0)) {
      clearProjections(); setDenied(true); onDenied?.(cause);
    }
  }

  async function refresh(clearPassword = true) {
    if (!alive.current || invalidated) return;
    if (controller.current.signal.aborted) controller.current = new AbortController();
    const request = ++sequence.current;
    setLoading(true);
    if (clearPassword) { setTemporary(undefined); setSelected(undefined); setPasswordRevision((value) => value + 1); }
    try {
      const result = await apiRequest<AccountPage>(scoped(base), { signal: controller.current.signal });
      if (alive.current && request === sequence.current) { setData(result); setBound(value => value ?? profile.supplierOrganizationId); setDenied(false); setError(undefined); }
    } catch (cause) { if (alive.current && request === sequence.current) { setData(undefined); failed(cause); } }
    finally { if (alive.current && request === sequence.current) setLoading(false); }
  }
  useLayoutEffect(() => {
    alive.current = true;
    const unsubscribe = useWorkTabsStore.subscribe(state => {
      if (!alive.current || state.sessionScope === session) return;
      alive.current = false; clearProjections(); setInvalidated(true);
    });
    void refresh();
    return () => { alive.current = false; sequence.current++; controller.current.abort(); unsubscribe(); };
  }, []);
  function close() {
    if (locked) return;
    requestLeave(onClose);
  }
  async function create(values: Create) {
    if (!alive.current || pending.current || locked || !canCreate) return;
    const signal = controller.current.signal;
    pending.current = true; setBusy(true); setError(undefined);
    try {
      const result = await createMutation.current<Created>(base, 'POST', { ...scope, username: values.username.trim(), email: values.email?.trim() || undefined, ...(!bound && values.supplierOrganizationId?.trim() ? { supplierOrganizationId: values.supplierOrganizationId.trim() } : {}) }, signal);
      if (!alive.current || signal.aborted) return;
      const { temporaryPassword, ...account } = result;
      setBound(account.organizationId); setSelected(account); setTemporary(temporaryPassword); setPasswordRevision((value) => value + 1);
      form.resetFields(); setDirty(false);
      await refresh(false);
      if (alive.current && !signal.aborted) await onBound();
    } catch (cause) { if (alive.current && !signal.aborted) failed(cause); }
    finally { pending.current = false; if (alive.current) setBusy(false); }
  }
  async function status(account: Account) {
    if (!alive.current || pending.current || locked || !canStatus) return;
    const signal = controller.current.signal;
    pending.current = true; setBusy(true); setError(undefined);
    try {
      await statusMutation.current<Account>(`${base}/${account.id}/status`, 'PUT', { ...scope, status: account.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE', expectedSecurityVersion: account.securityVersion }, signal);
      if (alive.current && !signal.aborted) await refresh();
    } catch (cause) { if (alive.current && !signal.aborted) failed(cause); }
    finally { pending.current = false; if (alive.current) setBusy(false); }
  }
  return <Modal open width={900} title={`${t('供应商用户账号')} · ${profile.displayName}`} footer={null} onCancel={close} keyboard={!locked} closable={!locked} mask={{ closable: false }}>

    <Typography.Paragraph>{t(bound ? '已开通协作' : '未开通协作')}{bound ? ` · ${bound}` : ''}</Typography.Paragraph>
    {error ? <Alert type="error" title={t(supplierError(error))} description={error instanceof ApiError && error.status === 409 ? t('当前填写内容已保留，请显式刷新账号后重试。') : undefined} /> : null}
    <Button disabled={locked || invalidated} loading={loading} onClick={() => void refresh()}>{t('刷新供应商账号')}</Button>
    {data ? <Table<Account> rowKey="id" size="small" loading={loading} dataSource={data.items} scroll={{ x: 600 }} pagination={{ pageSize: 10 }} columns={[
      { title: t('用户名'), dataIndex: 'username' }, { title: t('邮箱'), dataIndex: 'email' }, { title: t('状态'), dataIndex: 'status', render: (value: string) => t(value === 'ACTIVE' ? '启用' : '停用') },
      { title: t('操作'), render: (_, account) => <Space wrap>{canReset && account.status === 'ACTIVE' ? <Button disabled={locked} onClick={() => { setSelected(account); setTemporary(undefined); setPasswordRevision((value) => value + 1); }}>{t('临时密码')}</Button> : null}
        {canStatus ? <Popconfirm title={t(account.status === 'ACTIVE' ? '确认停用此账号并撤销会话？' : '确认启用此账号？')} okText={t('确认')} cancelText={t('取消')} onConfirm={() => status(account)}><Button danger={account.status === 'ACTIVE'} disabled={locked}>{t(account.status === 'ACTIVE' ? '停用账号' : '启用账号')}</Button></Popconfirm> : null}
        <UserForceDelete target={account} canDelete={!denied && !invalidated && ownerWrite && data?.canDelete === true} disabled={locked || loading} deletePath={scoped(`${base}/${account.id}`)} onDeleted={() => void refresh()} onRefresh={() => void refresh()} onDenied={failed} /></Space> },
    ]} /> : null}
    {canCreate ? <Form form={form} name={`supplier-account-${profile.id}`} layout="vertical" disabled={locked || loading} onValuesChange={() => setDirty(true)} onFinish={(values: Create) => void create(values)}>
      <Form.Item name="username" label={t('用户名')} rules={[{ required: true, whitespace: true }, { pattern: /^[a-zA-Z0-9._-]+$/, message: t('用户名只能包含英文字母、数字、点、下划线和连字符') }]}><Input maxLength={100} autoComplete="off" /></Form.Item>
      <Form.Item name="email" label={t('邮箱')} rules={[{ type: 'email', message: t('请输入有效邮箱') }]}><Input maxLength={254} /></Form.Item>
      {!bound ? <Form.Item name="supplierOrganizationId" label={t('已有受控供应商企业 UUID（选填）')} help={t('留空新建企业；填写已有企业需有其账号管理权限。')} rules={[{ pattern: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, message: t('请输入有效的企业 UUID') }]}><Input maxLength={36} /></Form.Item> : null}
      <Form.Item shouldUpdate>{() => <Button type="primary" loading={busy} disabled={locked || loading} htmlType="submit">{t(bound ? '新增供应商账号' : form.getFieldValue('supplierOrganizationId') ? '绑定受控企业并建账号' : '创建专属协作边界并建账号')}</Button>}</Form.Item>
    </Form> : null}
    {selected ? <SupplierPassword key={`${organizationId}:${profile.id}:${selected.id}:${passwordRevision}`} account={selected} organizationId={organizationId} base={base} signal={controller.current.signal} initialValue={temporary} allowed={canReset && selected.status === 'ACTIVE'} busyChanged={setPasswordBusy} resetMutation={passwordMutation.current} onDenied={failed} /> : null}
    <Button disabled={locked} onClick={close}>{t('关闭')}</Button>
  </Modal>;
}

function SupplierPassword({ account, organizationId, base, signal, initialValue, allowed, busyChanged, resetMutation, onDenied }: { account: Account; organizationId?: string; base: string; signal: AbortSignal; initialValue?: Temporary; allowed: boolean; busyChanged: (busy: boolean) => void; resetMutation: ReturnType<typeof createSupplierMutation>; onDenied: (cause: unknown) => void }) {
  const { t } = useLanguage();
  async function invoke(action: () => Promise<Temporary>) {
    try { return await action(); }
    catch (cause) { if (!signal.aborted && cause instanceof ApiError && [401, 403].includes(cause.status ?? 0)) onDenied(cause); throw cause; }
  }
  return <section aria-label={t('供应商临时密码')}><Typography.Title level={5}>{account.username}</Typography.Title><UserTemporaryPassword user={account} organizationId={organizationId ?? 'current'} initialValue={initialValue} canRead={allowed} canReset={allowed} busyChanged={busyChanged} domain={{
    read: () => invoke(() => apiRequest<Temporary>(`${base}/${account.id}/temporary-password${organizationId ? `?organizationId=${encodeURIComponent(organizationId)}` : ''}`, { signal })),
    reset: () => invoke(() => resetMutation<Temporary>(`${base}/${account.id}/temporary-password/reset`, 'POST', organizationId ? { organizationId } : {}, signal)),
  }} /></section>;
}
