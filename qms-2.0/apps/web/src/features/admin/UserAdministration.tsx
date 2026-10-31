import { useCallback, useEffect, useRef, useState } from 'react';
import { useLanguage } from '../../i18n/Language';
import { Alert, Button, Descriptions, Form, Input, Modal, Select, Space, Tag, Typography } from 'antd';
import { LedgerTable, useLedgerPageSize } from '../../ui/ledger';
import type { components } from '@qms/contracts';
import { ApiError, apiRequest, createAdminMutation, getAdminUser, safeAccountError } from '../../api/client';
import { useNavigationBusy, useNavigationGuard, useUnsavedChanges } from '../../layouts/UnsavedChanges';
import { allows, randomResetCode, scopePath, type AdminOrganization, type AdminUser, type UserRoles } from './admin';
import { UserBatchCreate } from './UserBatchCreate';
import { UserTemporaryPassword } from './UserTemporaryPassword';
import { UserMfaPolicy } from './UserMfaPolicy';
import { useWorkTabsStore } from '../../work-tabs/workTabsStore';
import { accountAvatarEpoch } from '../account/account-avatar-state';
import { PositionSelector } from './PositionSelector';
import { UserPositionsEditor } from './UserPositionsEditor';
import { AuthorizationSources, canReadAuthorizationSources } from '../governance/AuthorizationSources';
import { UserForceDelete } from './UserForceDelete';
import { canPreviewPositions, type AuthorizationPreview } from './position-authorization';

type CreateUser = components['schemas']['CreateAdminUserDto'];
type UpdateUser = components['schemas']['UpdateAdminUserDto'];
type UserForm = CreateUser & Pick<AdminUser, 'status'>;
type ResetIssued = components['schemas']['PasswordResetIssuedDto'];

export function UserAdministration({ organization, organizations, targetUserId, onDenied }: { organization: AdminOrganization; organizations: AdminOrganization[]; targetUserId?: string; onDenied?: (error: ApiError) => void }) {
  const [pageSize, setPageSize] = useLedgerPageSize('admin-users', organization.id);
  const [page, setPage] = useState(1);
  const { t, locale } = useLanguage();
  const sessionScope = useWorkTabsStore(state => state.sessionScope);
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
  const [lifecycleDenied, setLifecycleDenied] = useState(false);
  const [editing, setEditing] = useState<AdminUser | 'new'>();
  const [assignment, setAssignment] = useState<{ user: AdminUser; authorization: UserRoles }>();
  const [sourceUser, setSourceUser] = useState<AdminUser>();
  const [positionUser, setPositionUser] = useState<AdminUser>();
  const [createPositions, setCreatePositions] = useState<string[]>([]);
  const [createPreview, setCreatePreview] = useState<AuthorizationPreview>();
  const [reset, setReset] = useState<{ user: AdminUser; code: string; issued?: ResetIssued }>();
  const [temporary, setTemporary] = useState<AdminUser>();
  const [mfa, setMfa] = useState<{ user: AdminUser; organizationId: string }>();
  const [batch, setBatch] = useState(false);
  const [batchBusy, setBatchBusy] = useState(false);
  const batchPending = useRef(false);
  const reportBatchBusy = useCallback((value: boolean) => { batchPending.current = value; setBatchBusy(value); }, []);
  const [form] = Form.useForm<UserForm>();
  const createOrganizationId = Form.useWatch('organizationId', form) ?? organization.id;
  const createAccountType = Form.useWatch('accountType', form) ?? organization.type;
  const createOrganization = organizations.find(entry => entry.id === createOrganizationId);
  const canAuthorizeCreation = !!createOrganization && canPreviewPositions(createOrganization);
  useEffect(() => { setCreatePreview(undefined); }, [canAuthorizeCreation]);
  const [dirty, setDirty] = useState(false);
  const [profileConflict, setProfileConflict] = useState(false);
  const actionLock = useRef(false);
  const sessionEnding = useRef(false);
  const scopeGeneration = useRef(0);
  useUnsavedChanges(!!editing && dirty);
  useNavigationBusy(busy);
  const requestLeave = useNavigationGuard();
  const [target, setTarget] = useState<{ organizationId: string; userId: string; user?: AdminUser; error?: string }>();
  const editor = useRef(editing);
  editor.current = editing;
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
  const canDelete = allows(organization, 'users:delete');
  const canReadRoles = canRead && allows(organization, 'roles:read');
  const canReadSources = canReadRoles && canReadAuthorizationSources(organization);
  const sourceScopeKey = JSON.stringify([sessionScope, organization.id, [...organization.permissions].sort()]);
  useEffect(() => { setSourceUser(undefined); }, [sourceScopeKey]);
  const canAssignPositions = canRead && canPreviewPositions(organization);
  useEffect(() => { setPage(1); scopeGeneration.current += 1; setLifecycleDenied(false); setProfileConflict(false); setEditing(undefined); setAssignment(undefined); setPositionUser(undefined); setCreatePositions([]); setCreatePreview(undefined); setReset(undefined); setTemporary(undefined); setMfa(undefined); setBatch(false); setSuccess(undefined); setBusy(false); setDirty(false); form.resetFields(); mutate.current = createAdminMutation(); }, [organization.id, canRead, canReadRoles, canAssignPositions, canCreate, sessionScope, form]);

  useEffect(() => {
    let current = true;
    setTarget(undefined);
    if (targetUserId === undefined || !canRead || sessionEnding.current) return;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(targetUserId)) {
      setTarget({ organizationId: organization.id, userId: targetUserId, error: '目标账号标识无效' });
      return;
    }
    function load() {
      if (!current) return;
      setEditing(undefined); setDirty(false); form.resetFields();
      setTarget({ organizationId: organization.id, userId: targetUserId! });
      void getAdminUser(organization.id, targetUserId!).then((user) => {
        if (current) setTarget(user.id === targetUserId && user.organizationId === organization.id
          ? { organizationId: organization.id, userId: targetUserId!, user }
          : { organizationId: organization.id, userId: targetUserId!, error: '目标账号不存在或不在当前组织' });
      }).catch((cause) => {
        if (current) setTarget({ organizationId: organization.id, userId: targetUserId!, error: cause instanceof ApiError && cause.status === 403 ? '无权查看目标账号' : cause instanceof ApiError && cause.status === 404 ? '目标账号不存在或不在当前组织' : safeAccountError(cause) });
      });
    }
    if (editor.current) requestLeave(load); else load();
    return () => { current = false; };
  }, [organization.id, targetUserId, canRead, revision, requestLeave, form, sessionScope]);

  useEffect(() => {
    let current = true;
    if (!canRead || sessionEnding.current) { setUsers([]); setLoading(false); return; }
    setLoading(true); setError(undefined); setUsers([]);
    const query = new URLSearchParams({ organizationId: organization.id, search, ...(status ? { status } : {}) });
    void apiRequest<AdminUser[]>(`/api/v1/admin/users?${query}`).then((result) => { if (current) setUsers(result); }).catch((cause) => { if (current) setFailure(cause); }).finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [organization.id, search, status, revision, canRead, sessionScope]);

  async function perform(action: () => Promise<void>, message: string) {
    const organizationId = organization.id;
    const operationGeneration = scopeGeneration.current;
    const operationEpoch = accountAvatarEpoch();
    if (actionLock.current) return;
    actionLock.current = true;
    setBusy(true); setError(undefined); setSuccess(undefined);
    try { await action(); if (alive.current && scope.current === organizationId && operationGeneration === scopeGeneration.current && operationEpoch === accountAvatarEpoch()) { setSuccess(message); setRevision((value) => value + 1); } }
    catch (cause) { if (alive.current && scope.current === organizationId && operationGeneration === scopeGeneration.current && operationEpoch === accountAvatarEpoch()) { setFailure(cause); if (editor.current === 'new' && cause instanceof ApiError && cause.status === 409) setCreatePreview(undefined); if (editor.current && editor.current !== 'new' && cause instanceof ApiError && cause.code === 'CONCURRENCY_CONFLICT') setProfileConflict(true); } }
    finally { actionLock.current = false; if (alive.current && scope.current === organizationId && operationGeneration === scopeGeneration.current && operationEpoch === accountAvatarEpoch()) setBusy(false); }
  }

  function edit(user: AdminUser | 'new') {
    mutate.current = createAdminMutation(); setError(undefined); setProfileConflict(false); setEditing(user); setDirty(false); setCreatePositions([]); setCreatePreview(undefined); form.resetFields();
    form.setFieldsValue(user === 'new' ? { organizationId: organization.id, accountType: organization.type } : { ...user, fullName: user.fullName ?? '', phone: user.phone ?? '', email: user.email ?? '' });
  }

  async function save(values: UserForm) {
    if (busy || actionLock.current || profileConflict || (editing === 'new' && (!canCreate || (values.accountType === 'INTERNAL' && (!canAuthorizeCreation || !createPositions.length || !createPreview))))) return;
    const organizationId = organization.id;
    const operationGeneration = scopeGeneration.current;
    const operationEpoch = accountAvatarEpoch();
    await perform(async () => {
      if (editing === 'new') {
        const body: CreateUser = { username: values.username, fullName: values.fullName?.trim() || null, phone: values.phone?.trim() || null, email: values.email || null, initialPassword: values.initialPassword, accountType: values.accountType, organizationId: values.organizationId, ...(values.accountType === 'INTERNAL' ? { positionIds: createPositions, authorizationBaseline: createPreview!.authorizationBaseline } : {}) };
        await mutate.current<AdminUser>('/api/v1/admin/users', 'POST', body);
      } else if (editing) {
        const body: UpdateUser = {};
        if (canUpdate) {
          for (const field of ['fullName', 'phone', 'email'] as const) {
            const value = values[field]?.trim() || null;
            if (value !== (editing[field] ?? null)) body[field] = value;
          }
          if ('fullName' in body || 'phone' in body || 'email' in body) body.expectedProfileVersion = editing.profileVersion;
        }
        if (canStatus && values.status !== editing.status) body.status = values.status;
        if (canTransfer && values.accountType !== editing.accountType) body.accountType = values.accountType;
        if (canTransfer && values.organizationId !== editing.organizationId) body.organizationId = values.organizationId;
        if (Object.keys(body).length) await mutate.current<AdminUser>(scopePath(`users/${editing.id}`, organization.id), 'PATCH', body);
      }
      if (alive.current && scope.current === organizationId && operationGeneration === scopeGeneration.current && operationEpoch === accountAvatarEpoch()) { form.resetFields(); setEditing(undefined); }
    }, '用户已保存');
  }

  async function openRoles(user: AdminUser) {
    if (!canReadRoles || busy || actionLock.current) return;
    if (user.accountType === 'INTERNAL' && canReadSources) {
      const generation = scopeGeneration.current;
      requestLeave(() => {
        if (!alive.current || generation !== scopeGeneration.current) return;
        setEditing(undefined); setDirty(false); form.resetFields(); setSourceUser(user);
      });
      return;
    }
    actionLock.current = true;
    const organizationId = organization.id;
    const operationGeneration = scopeGeneration.current;
    const operationEpoch = accountAvatarEpoch();
    setError(undefined); setBusy(true);
    try {
      const assigned = await apiRequest<UserRoles>(scopePath(`users/${user.id}/roles`, organization.id));
      if (alive.current && scope.current === organizationId && operationGeneration === scopeGeneration.current && operationEpoch === accountAvatarEpoch()) setAssignment({ user, authorization: assigned });
    } catch (cause) { if (alive.current && scope.current === organizationId && operationGeneration === scopeGeneration.current && operationEpoch === accountAvatarEpoch()) { setFailure(cause); if (editor.current && editor.current !== 'new' && cause instanceof ApiError && cause.code === 'CONCURRENCY_CONFLICT') setProfileConflict(true); } }
    finally { actionLock.current = false; if (alive.current && scope.current === organizationId && operationGeneration === scopeGeneration.current && operationEpoch === accountAvatarEpoch()) setBusy(false); }
  }

  async function reloadProfileBaseline() {
    if (!editing || editing === 'new' || busy || actionLock.current) return;
    const draft = form.getFieldsValue();
    const previous = editing;
    const userId = editing.id;
    const organizationId = organization.id;
    const operationEpoch = accountAvatarEpoch();
    const generation = scopeGeneration.current;
    setBusy(true); actionLock.current = true;
    try {
      const next = await getAdminUser(organizationId, userId);
      if (!alive.current || scope.current !== organizationId || operationEpoch !== accountAvatarEpoch() || generation !== scopeGeneration.current || next.id !== userId || next.organizationId !== organizationId || !editor.current || editor.current === 'new' || editor.current.id !== userId) return;
      const merged = { ...draft };
      for (const field of ['fullName', 'phone', 'email'] as const) {
        if ((draft[field]?.trim() || null) === (previous[field]?.trim() || null)) merged[field] = next[field] ?? '';
      }
      form.setFieldsValue(merged);
      setDirty((['fullName', 'phone', 'email'] as const).some(field => (merged[field]?.trim() || null) !== (next[field]?.trim() || null)) || (canStatus && merged.status !== previous.status) || (canTransfer && (merged.accountType !== previous.accountType || merged.organizationId !== previous.organizationId)));
      setEditing(previous => previous && previous !== 'new' ? { ...previous, fullName: next.fullName, phone: next.phone, email: next.email, profileVersion: next.profileVersion } : previous);
      setProfileConflict(false); setError(undefined); mutate.current = createAdminMutation();
    } catch (cause) { if (alive.current && generation === scopeGeneration.current) setFailure(cause); }
    finally { actionLock.current = false; if (alive.current && generation === scopeGeneration.current) setBusy(false); }
  }
  const organizationOptions = organizations.filter((entry) => allows(entry, editing === 'new' ? 'users:create' : 'users:transfer')).map((entry) => ({ value: entry.id, label: entry.name }));
  if (lifecycleDenied) return <Alert type="error" showIcon title={t('管理权限或会话已失效，已清除用户内容')} description={<>{error && t(error)}{errorDescription}</>} />;
  return <>
    {targetUserId !== undefined && (!canRead ? <Alert type="error" title={t('无权查看目标账号')} showIcon /> : target?.organizationId === organization.id && target.userId === targetUserId && target.error ? <Alert type="error" title={t(target.error)} showIcon /> : target?.organizationId === organization.id && target.userId === targetUserId && target.user ? <section aria-label={t('目标账号')}>
      <Typography.Title level={4}>{t('目标账号')}</Typography.Title>
      <Descriptions column={1} items={[{ key: 'username', label: t('用户名'), children: target.user.username }, { key: 'name', label: t('姓名'), children: target.user.fullName || t('未填写') }, { key: 'phone', label: t('电话'), children: target.user.phone || t('未填写') }, { key: 'email', label: t('邮箱'), children: target.user.email ?? '—' }, { key: 'type', label: t('账号类型'), children: target.user.accountType === 'INTERNAL' ? t('内部账号') : t('供应商账号') }, { key: 'organization', label: t('主组织'), children: target.user.organization.name }, { key: 'status', label: t('状态'), children: target.user.status === 'ACTIVE' ? t('启用') : t('停用') }]} />
      {(canUpdate || canStatus || canTransfer) && <Button disabled={busy} onClick={() => edit(target.user!)}>{t('编辑目标账号')}</Button>}
      {canAssignPositions && target.user.accountType === 'INTERNAL' && target.user.status === 'ACTIVE' && <Button disabled={busy} onClick={() => setPositionUser(target.user)}>{t('调岗')}</Button>}
      {canReadRoles && <Button disabled={busy} onClick={() => void openRoles(target.user!)}>{t('查看授权来源')}</Button>}
    </section> : <Typography.Text role="status">{t('正在加载目标账号')}</Typography.Text>)}
    {error && !editing && !assignment && !reset && <Alert type="error" title={t(error)} description={errorDescription} showIcon />}
    {success && <Alert type="success" title={t(success)} showIcon />}
    <div className="admin-toolbar"><Space wrap>
      {canRead && <><Input.Search aria-label={t('搜索用户')} placeholder={t('用户名或邮箱')} allowClear onSearch={setSearch} />
        <Select aria-label={t('用户状态')} placeholder={t('全部状态')} allowClear value={status} onChange={setStatus} options={[{ value: 'ACTIVE', label: t('启用') }, { value: 'DISABLED', label: t('停用') }]} /></>}
      {canCreate && <Button type="primary" disabled={busy} onClick={() => edit('new')}>{t('创建用户')}</Button>}
      {canCreate && organization.type === 'INTERNAL' && <Button disabled={busy} onClick={() => setBatch(true)}>{t('批量创建账号')}</Button>}
    </Space></div>
    {canRead && <LedgerTable<AdminUser> ledgerId="admin-users" organizationId={organization.id} requiredColumnKeys={['username', 'actions']} rowKey="id" loading={loading} dataSource={users} scroll={{ x: 850 }} pagination={{ current: page, pageSize, showSizeChanger: true, pageSizeOptions: [10, 20, 50, 100], disabled: busy || batchBusy, onChange: (nextPage, size) => requestLeave(() => { setPage(size === pageSize ? nextPage : 1); setPageSize(size); }) }} columns={[
      { key: 'username', title: t('用户名'), dataIndex: 'username' }, { key: 'fullName', title: t('姓名'), render: (_, user) => user.fullName || t('未填写') }, { key: 'phone', title: t('电话'), render: (_, user) => user.phone || t('未填写') }, { key: 'email', title: t('邮箱'), dataIndex: 'email' },
      { key: 'accountType', title: t('账号类型'), render: (_, user) => user.accountType === 'INTERNAL' ? t('内部') : t('供应商') },
      { key: 'organization', title: t('主组织'), render: (_, user) => user.organization.name },
      { key: 'positions', title: t('任职摘要'), render: (_, user) => user.positions?.length ? <>{user.positions.map(position => <div key={position.id}>{position.department?.name ?? t('组织直属')} · {position.name}</div>)}{(user.totalPositions ?? 0) > user.positions.length && <Typography.Text type="secondary">{t('更多任职请查看详情')}</Typography.Text>}</> : '—' },
      { key: 'status', title: t('状态'), render: (_, user) => <Tag color={user.status === 'ACTIVE' ? 'green' : 'default'}>{user.status === 'ACTIVE' ? t('启用') : t('停用')}</Tag> },
      { key: 'actions', title: t('操作'), render: (_, user) => <Space wrap>
        <Button size="small" disabled={busy} onClick={() => setMfa({ user, organizationId: organization.id })}>{t('MFA 设置')}</Button>
        {(canUpdate || canStatus || canTransfer) && <Button size="small" disabled={busy} onClick={() => edit(user)}>{t('编辑')}</Button>}
        {canStatus && <Button size="small" disabled={busy} onClick={() => void perform(async () => { await mutate.current<AdminUser>(scopePath(`users/${user.id}`, organization.id), 'PATCH', { status: user.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE' }); }, user.status === 'ACTIVE' ? '用户已停用' : '用户已启用')}>{user.status === 'ACTIVE' ? t('停用') : t('启用')}</Button>}
        {canReset && <Button size="small" disabled={busy} onClick={() => { mutate.current = createAdminMutation(); setReset({ user, code: randomResetCode() }); }}>{t('签发重置凭证')}</Button>}
        {canReset && <Button size="small" disabled={busy} onClick={() => setTemporary(user)}>{t('临时密码')}</Button>}
        {canAssignPositions && user.accountType === 'INTERNAL' && user.status === 'ACTIVE' && <Button size="small" disabled={busy} onClick={() => setPositionUser(user)}>{t('调岗')}</Button>}
        {canReadRoles && <Button size="small" disabled={busy} onClick={() => void openRoles(user)}>{t('查看授权来源')}</Button>}
        <UserForceDelete key={`${sessionScope}:${organization.id}:${user.id}`} target={user} canDelete={canDelete} disabled={busy || batchBusy} onDenied={cause => {
          setFailure(cause); setUsers([]); setTarget(undefined); setEditing(undefined); setAssignment(undefined); setPositionUser(undefined);
          setReset(undefined); setTemporary(undefined); setMfa(undefined); setBatch(false); setLifecycleDenied(true); onDenied?.(cause);
        }} onRefresh={() => setRevision(value => value + 1)} onDeleted={() => { setSuccess('用户已永久删除'); setRevision(value => value + 1); }} />
      </Space> },
    ]} />}
    {positionUser && canAssignPositions && <UserPositionsEditor key={`${sessionScope}:${organization.id}:${positionUser.id}`} organizationId={organization.id} user={positionUser} onClose={() => setPositionUser(undefined)} onSessionEnding={() => { sessionEnding.current = true; }} onSaved={() => { setPositionUser(undefined); setSuccess('任职已保存'); setRevision(value => value + 1); }} />}
    {mfa && canRead && mfa.organizationId === organization.id && <UserMfaPolicy key={`${organization.id}:${mfa.user.id}`} user={mfa.user} organizationId={organization.id} canWrite={canReset} onClose={() => setMfa(undefined)} onSaved={() => { setRevision((value) => value + 1); setSuccess('MFA 设置已保存'); }} />}
    <Modal title={t('批量创建账号')} open={batch && canCreate} closable={!batchBusy} keyboard={!batchBusy} mask={{ closable: !batchBusy }} onCancel={() => { if (batchPending.current) return; requestLeave(() => setBatch(false)); }} footer={null} destroyOnHidden width={950}>
      {batch && canCreate && <UserBatchCreate organizationId={organization.id} canReadPasswords={canReset} canAuthorize={canPreviewPositions(organization)} busyChanged={reportBatchBusy} />}
    </Modal>
    <Modal title={temporary ? `${temporary.username} · ${t('临时密码')}` : t('临时密码')} open={!!temporary && canReset} onCancel={() => setTemporary(undefined)} footer={null} destroyOnHidden>
      {temporary && canReset && <UserTemporaryPassword key={`${organization.id}:${temporary.id}`} user={temporary} organizationId={organization.id} />}
    </Modal>
    <Modal title={editing === 'new' ? t('创建用户') : t('编辑用户')} open={!!editing} keyboard={!busy && !actionLock.current} closable={!busy && !actionLock.current} mask={{ closable: !busy && !actionLock.current }} onCancel={() => { if (busy || actionLock.current) return; requestLeave(() => { setEditing(undefined); setDirty(false); form.resetFields(); mutate.current = createAdminMutation(); }); }} footer={null} destroyOnHidden>
      {error && <Alert type="error" title={t(error)} description={errorDescription} showIcon />}
      {profileConflict && <Button disabled={busy} onClick={() => void reloadProfileBaseline()}>{t('读取最新资料基线')}</Button>}
      <Form name="admin-user-editor" form={form} layout="vertical" disabled={busy || actionLock.current} onValuesChange={(changed) => { setDirty(true); if ('organizationId' in changed || 'accountType' in changed) { setCreatePositions([]); setCreatePreview(undefined); } }} onFinish={save} autoComplete="off">
        {editing === 'new' && <Form.Item name="username" label={t('用户名')} rules={[{ required: true }, { pattern: /^[a-zA-Z0-9._-]+$/, message: t('仅支持字母、数字、点、下划线和连字符') }]}><Input /></Form.Item>}
        {(editing === 'new' || canUpdate) && <><Form.Item name="fullName" label={t('姓名')} rules={[{ max: 100 }]}><Input /></Form.Item><Form.Item name="phone" label={t('电话')} rules={[{ max: 40 }]}><Input /></Form.Item></>}
        {(editing === 'new' || canUpdate) && <Form.Item name="email" label={t('邮箱')} rules={[{ type: 'email' }]}><Input /></Form.Item>}
        {editing === 'new' && <Form.Item name="initialPassword" label={t('初始密码')} rules={[{ required: true }, { min: 12, max: 256 }]}><Input.Password autoComplete="new-password" /></Form.Item>}
        {(editing === 'new' || canTransfer) && <><Form.Item name="accountType" label={t('账号类型')} rules={[{ required: true }]}><Select options={[{ value: 'INTERNAL', label: t('内部账号') }, { value: 'SUPPLIER', label: t('供应商账号') }]} /></Form.Item>
        <Form.Item name="organizationId" label={t('主组织')} rules={[{ required: true }]}><Select options={organizationOptions} /></Form.Item></>}
        {editing === 'new' && createAccountType === 'INTERNAL' && <Form.Item label={t('组织任职与权限')} required>
          {canAuthorizeCreation ? <PositionSelector key={createOrganizationId} organizationId={createOrganizationId} value={createPositions} onChange={selected => { setCreatePositions(selected); setDirty(true); }} preview={createPreview} onPreviewChange={setCreatePreview} disabled={busy} /> : <Alert showIcon type="warning" title={t('缺少岗位授权所需权限，无法创建内部账号')} />}
        </Form.Item>}
        {editing !== 'new' && canStatus && <Form.Item name="status" label={t('状态')}><Select options={[{ value: 'ACTIVE', label: t('启用') }, { value: 'DISABLED', label: t('停用') }]} /></Form.Item>}
        <div className="qms-dialog-actions" role="group" aria-label={editing === 'new' ? t('创建用户') : t('编辑用户')}><Button htmlType="submit" type="primary" disabled={profileConflict || (editing === 'new' && createAccountType === 'INTERNAL' && (!canAuthorizeCreation || !createPositions.length || !createPreview))} loading={busy}>{t('保存用户')}</Button></div>
      </Form>
    </Modal>
    <Modal title={sourceUser ? `${sourceUser.username} · ${t('授权来源')}` : t('授权来源')} open={!!sourceUser && canReadSources && sourceUser.accountType === 'INTERNAL' && sourceUser.organizationId === organization.id} onCancel={() => setSourceUser(undefined)} footer={null} destroyOnHidden>
      {sourceUser && canReadSources && sourceUser.accountType === 'INTERNAL' && sourceUser.organizationId === organization.id && <AuthorizationSources organization={organization} userId={sourceUser.id} onDenied={cause => {
        if (cause.status === 401) sessionEnding.current = true;
        setSourceUser(undefined); setEditing(undefined); setAssignment(undefined); setPositionUser(undefined); setTarget(undefined); setUsers([]); setLifecycleDenied(true); setFailure(cause); onDenied?.(cause);
      }} />}
    </Modal>
    <Modal title={assignment ? `${assignment.user.username} · ${t('授权来源')}` : t('授权来源')} open={!!assignment} closable={!busy} keyboard={!busy} mask={{ closable: !busy }} onCancel={() => { if (actionLock.current) return; setAssignment(undefined); }} footer={null} destroyOnHidden>
      {error && <Alert type="error" title={t(error)} description={errorDescription} showIcon />}
      {assignment && canReadRoles && <Space orientation="vertical" className="admin-form-stack">
        {assignment.authorization.effectiveRoles?.map(role => <div key={role.id}><Typography.Text strong>{role.name}</Typography.Text>{role.sources.map((source, index) => <p key={index}>{source.kind === 'DIRECT' ? t('历史直接分配（只读）') : `${t('岗位继承')} · ${source.positionId ?? t('未知岗位')}`}</p>)}</div>)}
        {assignment.authorization.roles.filter(role => role.organizationId === null).map(role => <Tag key={role.id}>{role.name} · {t('全局只读')}</Tag>)}
        <Typography.Paragraph>{t('有效权限')}：{assignment.authorization.permissions?.map(code => <Tag key={code}>{code}</Tag>)}</Typography.Paragraph>
      </Space>}
    </Modal>
    <Modal title={t('一次性重置凭证')} open={!!reset} onCancel={() => { setReset(undefined); mutate.current = createAdminMutation(); }} footer={null} destroyOnHidden>
      {error && <Alert type="error" title={t(error)} description={errorDescription} showIcon />}
      {reset?.issued ? <Space orientation="vertical" className="admin-form-stack">
        <Typography.Paragraph>{t('请安全交给账号持有人，在重置密码页面兑换。关闭后不再显示。')}</Typography.Paragraph>
        <Input.TextArea aria-label={t('一次性重置凭证')} readOnly value={`${reset.issued.resetId}.${reset.code}`} />
        <Typography.Text>{t('有效期至')} {new Date(reset.issued.expiresAt).toLocaleString(locale)}</Typography.Text>
        <Button onClick={() => { setReset(undefined); mutate.current = createAdminMutation(); }}>{t('关闭并清除')}</Button>
      </Space> : reset && <Button type="primary" loading={busy} onClick={() => void perform(async () => { const organizationId = organization.id;
    const operationGeneration = scopeGeneration.current;
    const operationEpoch = accountAvatarEpoch(); const issued = await mutate.current<ResetIssued>(scopePath(`users/${reset.user.id}/password-reset`, organizationId), 'POST', { temporaryCode: reset.code }); if (alive.current && scope.current === organizationId && operationGeneration === scopeGeneration.current && operationEpoch === accountAvatarEpoch()) setReset((current) => current === reset ? { ...reset, issued } : current); }, '重置凭证已签发')}>{t('确认签发')}</Button>}
    </Modal>
  </>;
}
