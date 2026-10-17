import { useEffect, useRef, useState } from 'react';
import { useLanguage } from '../../i18n/Language';
import { Alert, Button, Form, Input, Modal, Select, Space, Table, Tag, Typography } from 'antd';
import type { components } from '@qms/contracts';
import { ApiError, apiRequest, createAdminMutation, safeAccountError } from '../../api/client';
import { allows, randomResetCode, scopePath, type AdminOrganization, type AdminRole, type AdminUser, type UserRoles } from './admin';
import { UserBatchCreate } from './UserBatchCreate';
import { UserTemporaryPassword } from './UserTemporaryPassword';

type CreateUser = components['schemas']['CreateAdminUserDto'];
type UpdateUser = components['schemas']['UpdateAdminUserDto'];
type UserForm = CreateUser & Pick<AdminUser, 'status'>;
type ResetIssued = components['schemas']['PasswordResetIssuedDto'];

export function UserAdministration({ organization, organizations }: { organization: AdminOrganization; organizations: AdminOrganization[] }) {
  const { t, locale } = useLanguage();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<AdminUser['status']>();
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [traceId, setTraceId] = useState<string>();
  function setFailure(cause: unknown) { setError(safeAccountError(cause)); setTraceId(cause instanceof ApiError ? cause.traceId : undefined); }
  const errorDescription = traceId ? <span>{t('追踪标识')}: <code>{traceId}</code></span> : undefined;
  const [success, setSuccess] = useState<string>();
  const [editing, setEditing] = useState<AdminUser | 'new'>();
  const [assignment, setAssignment] = useState<{ user: AdminUser; roles: AdminRole[]; selected: string[]; global: AdminRole[] }>();
  const [reset, setReset] = useState<{ user: AdminUser; code: string; issued?: ResetIssued }>();
  const [temporary, setTemporary] = useState<AdminUser>();
  const [batch, setBatch] = useState(false);
  const [form] = Form.useForm<UserForm>();
  const mutate = useRef(createAdminMutation());
  const alive = useRef(true);
  const scope = useRef(organization.id);
  scope.current = organization.id;
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const canRead = allows(organization, 'users:read');
  const canCreate = allows(organization, 'users:create');
  const canUpdate = allows(organization, 'users:update');
  const canStatus = allows(organization, 'users:status');
  const canTransfer = allows(organization, 'users:transfer');
  const canReset = allows(organization, 'users:reset');
  const canReadRoles = canRead && allows(organization, 'roles:read');
  const canAssign = canReadRoles && allows(organization, 'roles:assign');
  useEffect(() => { setEditing(undefined); setAssignment(undefined); setReset(undefined); setTemporary(undefined); setBatch(false); setSuccess(undefined); setBusy(false); mutate.current = createAdminMutation(); }, [organization.id]);

  useEffect(() => {
    let current = true;
    if (!canRead) { setUsers([]); setLoading(false); return; }
    setLoading(true); setError(undefined); setUsers([]);
    const query = new URLSearchParams({ organizationId: organization.id, search, ...(status ? { status } : {}) });
    void apiRequest<AdminUser[]>(`/api/v1/admin/users?${query}`).then((result) => { if (current) setUsers(result); }).catch((cause) => { if (current) setFailure(cause); }).finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [organization.id, search, status, revision, canRead]);

  async function perform(action: () => Promise<void>, message: string) {
    const organizationId = organization.id;
    setBusy(true); setError(undefined); setSuccess(undefined);
    try { await action(); if (alive.current && scope.current === organizationId) { setSuccess(message); setRevision((value) => value + 1); } }
    catch (cause) { if (alive.current && scope.current === organizationId) setFailure(cause); }
    finally { if (alive.current && scope.current === organizationId) setBusy(false); }
  }

  function edit(user: AdminUser | 'new') {
    mutate.current = createAdminMutation(); setError(undefined); setEditing(user); form.resetFields();
    form.setFieldsValue(user === 'new' ? { organizationId: organization.id, accountType: organization.type } : { ...user, email: user.email ?? '' });
  }

  async function save(values: UserForm) {
    if (busy || (editing === 'new' && !canCreate)) return;
    const organizationId = organization.id;
    await perform(async () => {
      if (editing === 'new') {
        const body: CreateUser = { username: values.username, email: values.email || null, initialPassword: values.initialPassword, accountType: values.accountType, organizationId: values.organizationId };
        await mutate.current<AdminUser>('/api/v1/admin/users', 'POST', body);
      } else if (editing) {
        const body: UpdateUser = {};
        if (canUpdate && (values.email || null) !== (editing.email ?? null)) body.email = values.email || null;
        if (canStatus && values.status !== editing.status) body.status = values.status;
        if (canTransfer && values.accountType !== editing.accountType) body.accountType = values.accountType;
        if (canTransfer && values.organizationId !== editing.organizationId) body.organizationId = values.organizationId;
        if (Object.keys(body).length) await mutate.current<AdminUser>(scopePath(`users/${editing.id}`, organization.id), 'PATCH', body);
      }
      if (alive.current && scope.current === organizationId) { form.resetFields(); setEditing(undefined); }
    }, '用户已保存');
  }

  async function openRoles(user: AdminUser) {
    if (!canAssign || busy) return;
    const organizationId = organization.id;
    setError(undefined); setBusy(true);
    try {
      const [roles, assigned] = await Promise.all([apiRequest<AdminRole[]>(scopePath('roles', organization.id)), apiRequest<UserRoles>(scopePath(`users/${user.id}/roles`, organization.id))]);
      if (alive.current && scope.current === organizationId) { mutate.current = createAdminMutation(); setAssignment({ user, roles: roles.filter((role) => role.organizationId !== null), selected: assigned.roles.filter((role) => role.organizationId !== null).map((role) => role.id), global: assigned.roles.filter((role) => role.organizationId === null) }); }
    } catch (cause) { if (alive.current && scope.current === organizationId) setFailure(cause); }
    finally { if (alive.current && scope.current === organizationId) setBusy(false); }
  }

  const organizationOptions = organizations.filter((entry) => allows(entry, editing === 'new' ? 'users:create' : 'users:transfer')).map((entry) => ({ value: entry.id, label: entry.name }));
  return <>
    {error && !editing && !assignment && !reset && <Alert type="error" title={t(error)} description={errorDescription} showIcon />}
    {success && <Alert type="success" title={t(success)} showIcon />}
    <div className="admin-toolbar"><Space wrap>
      {canRead && <><Input.Search aria-label={t('搜索用户')} placeholder={t('用户名或邮箱')} allowClear onSearch={setSearch} />
        <Select aria-label={t('用户状态')} placeholder={t('全部状态')} allowClear value={status} onChange={setStatus} options={[{ value: 'ACTIVE', label: t('启用') }, { value: 'DISABLED', label: t('停用') }]} /></>}
      {canCreate && <Button type="primary" disabled={busy} onClick={() => edit('new')}>{t('创建用户')}</Button>}
      {canCreate && organization.type === 'INTERNAL' && <Button disabled={busy} onClick={() => setBatch(true)}>{t('批量创建账号')}</Button>}
    </Space></div>
    {canRead && <Table<AdminUser> rowKey="id" loading={loading} dataSource={users} scroll={{ x: 850 }} columns={[
      { title: t('用户名'), dataIndex: 'username' }, { title: t('邮箱'), dataIndex: 'email' },
      { title: t('账号类型'), render: (_, user) => user.accountType === 'INTERNAL' ? t('内部') : t('供应商') },
      { title: t('主组织'), render: (_, user) => user.organization.name },
      { title: t('状态'), render: (_, user) => <Tag color={user.status === 'ACTIVE' ? 'green' : 'default'}>{user.status === 'ACTIVE' ? t('启用') : t('停用')}</Tag> },
      { title: t('操作'), render: (_, user) => <Space wrap>
        {(canUpdate || canStatus || canTransfer) && <Button size="small" disabled={busy} onClick={() => edit(user)}>{t('编辑')}</Button>}
        {canStatus && <Button size="small" disabled={busy} onClick={() => void perform(async () => { await mutate.current<AdminUser>(scopePath(`users/${user.id}`, organization.id), 'PATCH', { status: user.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE' }); }, user.status === 'ACTIVE' ? '用户已停用' : '用户已启用')}>{user.status === 'ACTIVE' ? t('停用') : t('启用')}</Button>}
        {canReset && <Button size="small" disabled={busy} onClick={() => { mutate.current = createAdminMutation(); setReset({ user, code: randomResetCode() }); }}>{t('签发重置凭证')}</Button>}
        {canReset && <Button size="small" disabled={busy} onClick={() => setTemporary(user)}>{t('临时密码')}</Button>}
        {canAssign && <Button size="small" disabled={busy} onClick={() => void openRoles(user)}>{t('分配角色')}</Button>}
      </Space> },
    ]} />}
    <Modal title={t('批量创建账号')} open={batch && canCreate} onCancel={() => setBatch(false)} footer={null} destroyOnHidden width={950}>
      {batch && canCreate && <UserBatchCreate organizationId={organization.id} canReadPasswords={canReset} />}
    </Modal>
    <Modal title={temporary ? `${temporary.username} · ${t('临时密码')}` : t('临时密码')} open={!!temporary && canReset} onCancel={() => setTemporary(undefined)} footer={null} destroyOnHidden>
      {temporary && canReset && <UserTemporaryPassword key={`${organization.id}:${temporary.id}`} user={temporary} organizationId={organization.id} />}
    </Modal>
    <Modal title={editing === 'new' ? t('创建用户') : t('编辑用户')} open={!!editing} onCancel={() => { setEditing(undefined); form.resetFields(); mutate.current = createAdminMutation(); }} footer={null} destroyOnHidden>
      {error && <Alert type="error" title={t(error)} description={errorDescription} showIcon />}
      <Form name="admin-user-editor" form={form} layout="vertical" onFinish={save} autoComplete="off">
        {editing === 'new' && <Form.Item name="username" label={t('用户名')} rules={[{ required: true }, { pattern: /^[a-zA-Z0-9._-]+$/, message: t('仅支持字母、数字、点、下划线和连字符') }]}><Input /></Form.Item>}
        {(editing === 'new' || canUpdate) && <Form.Item name="email" label={t('邮箱')} rules={[{ type: 'email' }]}><Input /></Form.Item>}
        {editing === 'new' && <Form.Item name="initialPassword" label={t('初始密码')} rules={[{ required: true }, { min: 12, max: 256 }]}><Input.Password autoComplete="new-password" /></Form.Item>}
        {(editing === 'new' || canTransfer) && <><Form.Item name="accountType" label={t('账号类型')} rules={[{ required: true }]}><Select options={[{ value: 'INTERNAL', label: t('内部账号') }, { value: 'SUPPLIER', label: t('供应商账号') }]} /></Form.Item>
        <Form.Item name="organizationId" label={t('主组织')} rules={[{ required: true }]}><Select options={organizationOptions} /></Form.Item></>}
        {editing !== 'new' && canStatus && <Form.Item name="status" label={t('状态')}><Select options={[{ value: 'ACTIVE', label: t('启用') }, { value: 'DISABLED', label: t('停用') }]} /></Form.Item>}
        <Button htmlType="submit" type="primary" loading={busy}>{t('保存用户')}</Button>
      </Form>
    </Modal>
    <Modal title={assignment ? `${assignment.user.username} · ${t('组织角色')}` : t('组织角色')} open={!!assignment} onCancel={() => setAssignment(undefined)} footer={null} destroyOnHidden>
      {error && <Alert type="error" title={t(error)} description={errorDescription} showIcon />}
      {assignment && <Space orientation="vertical" className="admin-form-stack">
        <Select aria-label={t('组织角色')} mode="multiple" value={assignment.selected} disabled={!canAssign || busy || assignment.global.length > 0} options={assignment.roles.map((role) => ({ value: role.id, label: role.name }))} onChange={(selected) => setAssignment({ ...assignment, selected })} />
        {assignment.global.map((role) => <Tag key={role.id}>{role.name} · {t('全局只读')}</Tag>)}
        {canAssign && !assignment.global.length && <Button type="primary" loading={busy} onClick={() => void perform(async () => { const organizationId = organization.id; await mutate.current<UserRoles>(scopePath(`users/${assignment.user.id}/roles`, organizationId), 'PUT', { roleIds: assignment.selected }); if (alive.current && scope.current === organizationId) setAssignment(undefined); }, '角色分配已保存')}>{t('保存角色分配')}</Button>}
      </Space>}
    </Modal>
    <Modal title={t('一次性重置凭证')} open={!!reset} onCancel={() => { setReset(undefined); mutate.current = createAdminMutation(); }} footer={null} destroyOnHidden>
      {error && <Alert type="error" title={t(error)} description={errorDescription} showIcon />}
      {reset?.issued ? <Space orientation="vertical" className="admin-form-stack">
        <Typography.Paragraph>{t('请安全交给账号持有人，在重置密码页面兑换。关闭后不再显示。')}</Typography.Paragraph>
        <Input.TextArea aria-label={t('一次性重置凭证')} readOnly value={`${reset.issued.resetId}.${reset.code}`} />
        <Typography.Text>{t('有效期至')} {new Date(reset.issued.expiresAt).toLocaleString(locale)}</Typography.Text>
        <Button onClick={() => { setReset(undefined); mutate.current = createAdminMutation(); }}>{t('关闭并清除')}</Button>
      </Space> : reset && <Button type="primary" loading={busy} onClick={() => void perform(async () => { const organizationId = organization.id; const issued = await mutate.current<ResetIssued>(scopePath(`users/${reset.user.id}/password-reset`, organizationId), 'POST', { temporaryCode: reset.code }); if (alive.current && scope.current === organizationId) setReset((current) => current === reset ? { ...reset, issued } : current); }, '重置凭证已签发')}>{t('确认签发')}</Button>}
    </Modal>
  </>;
}
