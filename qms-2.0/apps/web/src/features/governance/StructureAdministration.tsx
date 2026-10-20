import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Form, Input, Modal, Select, Space, Table, Tabs } from 'antd';
import { useNavigate } from 'react-router-dom';
import { ApiError, apiRequest, createAdminMutation } from '../../api/client';
import type { AdminOrganization, AdminUser } from '../admin/admin';
import { configurationPath, organizationPath, type Department, type Position, type PositionCategory, type UserPosition } from './governance';
import { GovernanceFeedback } from './GovernanceFeedback';
import { useLanguage } from '../../i18n/Language';
import { useCompletedSessionNavigation, useNavigationBusy, useNavigationGuard, useUnsavedChanges } from '../../layouts/UnsavedChanges';
import { PositionRolesDrawer } from './PositionRolesDrawer';
import { useWorkTabsStore } from '../../work-tabs/workTabsStore';

async function allPages<Entry>(path: string, signal?: AbortSignal) {
  const result: Entry[] = [];
  for (let offset = 0; offset <= 10000; offset += 100) {
    signal?.throwIfAborted();
    const page = await apiRequest<Entry[]>(`${path}?limit=100&offset=${offset}`, { signal });
    result.push(...page);
    if (page.length < 100) return result;
  }
  throw new Error('Structure exceeds supported page window');
}

export function StructureAdministration({ organization }: { organization: AdminOrganization }) {
  const sessionScope = useWorkTabsStore((state) => state.sessionScope);
  return <StructureScope key={JSON.stringify([sessionScope, organization.id, [...organization.permissions].sort()])} organization={organization} />;
}

function StructureScope({ organization }: { organization: AdminOrganization }) {
  const { t, locale } = useLanguage();
  const navigate = useNavigate();
  const completeSessionNavigation = useCompletedSessionNavigation();
  const [departments, setDepartments] = useState<Department[]>([]);
  const [positions, setPositions] = useState<Position[]>([]);
  const [categories, setCategories] = useState<PositionCategory[]>([]);
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>();
  const [editor, setEditor] = useState<{ kind: 'department' | 'position'; record?: Department | Position }>();
  const [saving, setSaving] = useState(false);
  const [userId, setUserId] = useState('');
  const [loadedUserId, setLoadedUserId] = useState<string>();
  const [assignments, setAssignments] = useState<UserPosition[]>([]);
  const [selectedPositions, setSelectedPositions] = useState<string[]>([]);
  const [expectedPositions, setExpectedPositions] = useState<string[]>([]);
  const [assignmentRefreshError, setAssignmentRefreshError] = useState<unknown>();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [userSearch, setUserSearch] = useState('');
  const [usersLoading, setUsersLoading] = useState(false);
  const [usersError, setUsersError] = useState<unknown>();
  const [rolePosition, setRolePosition] = useState<Position>();
  const roleTrigger = useRef<HTMLElement>(null);
  const alive = useRef(false);
  const pending = useRef(false);
  const assignmentGeneration = useRef(0);
  const sessionEnding = useRef(false);
  const lifetime = useRef<AbortController | undefined>(undefined);
  const requestLeave = useNavigationGuard();
  const [form] = Form.useForm();
  const [mutate] = useState(createAdminMutation);
  const manage = organization.permissions.includes('organization:structure:manage');
  const assign = organization.permissions.includes('organization:positions:assign');
  const readRoles = organization.permissions.includes('organization:structure:read') && organization.permissions.includes('account:roles:read');
  const writeRoles = readRoles && manage && organization.permissions.includes('account:roles:assign');
  const readUsers = organization.permissions.includes('account:users:read');
  useNavigationBusy(saving);
  useUnsavedChanges(!!loadedUserId && JSON.stringify([...selectedPositions].sort()) !== JSON.stringify([...expectedPositions].sort()));
  useEffect(() => {
    alive.current = true; lifetime.current = new AbortController();
    return () => { alive.current = false; assignmentGeneration.current += 1; lifetime.current?.abort(); };
  }, []);
  useEffect(() => {
    if (!readUsers) return;
    let active = true;
    const controller = new AbortController();
    setUsersLoading(true); setUsers([]); setUsersError(undefined);
    const query = new URLSearchParams({ organizationId: organization.id, search: userSearch });
    void apiRequest<AdminUser[]>(`/api/v1/admin/users?${query}`, { signal: controller.signal }).then((result) => {
      if (active) setUsers(result.filter((user) => user.organizationId === organization.id));
    }).catch((cause) => { if (active) setUsersError(cause); }).finally(() => { if (active) setUsersLoading(false); });
    return () => { active = false; controller.abort(); };
  }, [organization.id, readUsers, userSearch, revision]);
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    setLoading(true); setError(undefined);
    void Promise.all([allPages<Department>(organizationPath(organization.id, '/departments'), controller.signal), allPages<Position>(organizationPath(organization.id, '/positions'), controller.signal), organization.permissions.includes('configuration:read') ? apiRequest<PositionCategory[]>(configurationPath(organization.id, 'position-categories'), { signal: controller.signal }) : Promise.resolve([])]).then(([nextDepartments, nextPositions, nextCategories]) => { if (active) { setDepartments(nextDepartments); setPositions(nextPositions); setCategories(nextCategories); } }).catch((cause) => { if (active) setError(cause); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; controller.abort(); };
  }, [organization.id, organization.permissions, revision]);
  function edit(kind: 'department' | 'position', record?: Department | Position) {
    form.resetFields(); form.setFieldsValue(record ?? { status: 'ACTIVE' }); setError(undefined); setEditor({ kind, record });
  }
  async function save(values: { code: string; name: string; parentId?: string; departmentId: string; categoryId?: string; status: 'ACTIVE' | 'DISABLED' }) {
    if (!editor || !manage || pending.current) return;
    pending.current = true;
    setSaving(true); setError(undefined);
    const base = organizationPath(organization.id, editor.kind === 'department' ? '/departments' : '/positions');
    const detail = editor.kind === 'department' ? { parentId: values.parentId ?? null } : { departmentId: values.departmentId, categoryId: values.categoryId ?? null };
    try {
      if (editor.record) await mutate(`${base}/${editor.record.id}`, 'PATCH', { name: values.name, ...detail, status: values.status, expectedVersion: editor.record.version });
      else await mutate(base, 'POST', { code: values.code, name: values.name, ...detail });
      if (alive.current) { setEditor(undefined); setRevision((value) => value + 1); }
    } catch (cause) { if (alive.current) setError(cause); } finally { pending.current = false; if (alive.current) setSaving(false); }
  }
  function effectivePositions(entries: UserPosition[]) {
    const now = Date.now();
    return [...new Set(entries.filter((entry) => new Date(entry.startedAt).getTime() <= now && (!entry.endedAt || new Date(entry.endedAt).getTime() > now)
      && entry.position.status === 'ACTIVE' && positions.some((position) => position.id === entry.positionId && position.status === 'ACTIVE')
      && departments.some((department) => department.id === entry.position.departmentId && department.status === 'ACTIVE')).map((entry) => entry.positionId))];
  }
  function acceptAssignments(result: UserPosition[]) {
    setAssignments(result);
    const ids = effectivePositions(result);
    setSelectedPositions(ids); setExpectedPositions(ids);
  }
  function selectUser(id: string) {
    requestLeave(() => { setUserId(id); setLoadedUserId(undefined); setAssignments([]); setSelectedPositions([]); setExpectedPositions([]); setAssignmentRefreshError(undefined); });
  }
  async function loadAssignments() {
    if (pending.current || loading || !userId.trim() || sessionEnding.current) return;
    pending.current = true;
    setSaving(true); setError(undefined); setAssignmentRefreshError(undefined); setLoadedUserId(undefined);
    try {
      const result = await allPages<UserPosition>(organizationPath(organization.id, `/users/${encodeURIComponent(userId.trim())}/positions`), lifetime.current?.signal);
      if (alive.current) { acceptAssignments(result); setLoadedUserId(userId.trim()); }
    } catch (cause) { if (alive.current) setError(cause); } finally { pending.current = false; if (alive.current) setSaving(false); }
  }
  async function saveAssignments() {
    if (!loadedUserId || !assign || pending.current || loading || assignmentRefreshError || sessionEnding.current) return;
    const generation = ++assignmentGeneration.current;
    const sessionScope = useWorkTabsStore.getState().sessionScope;
    const current = () => alive.current && assignmentGeneration.current === generation && useWorkTabsStore.getState().sessionScope === sessionScope;
    pending.current = true;
    setSaving(true); setError(undefined);
    try {
      const saved = await mutate<UserPosition[]>(organizationPath(organization.id, `/users/${encodeURIComponent(loadedUserId)}/positions`), 'PUT', { positionIds: selectedPositions, expectedPositionIds: expectedPositions });
      if (!current()) return;
      acceptAssignments(saved);
      try {
        const result = await allPages<UserPosition>(organizationPath(organization.id, `/users/${encodeURIComponent(loadedUserId)}/positions`), lifetime.current?.signal);
        if (current()) acceptAssignments(result);
      } catch (cause) {
        if (!current()) return;
        if (cause instanceof ApiError && cause.status === 401) {
          sessionEnding.current = true; setLoadedUserId(undefined);
          completeSessionNavigation(() => { useWorkTabsStore.getState().reset(); navigate('/login', { replace: true }); });
        } else setAssignmentRefreshError(cause);
      }
    } catch (cause) { if (current()) setError(cause); } finally { pending.current = false; if (current()) setSaving(false); }
  }
  const commonColumns = [{ title: t('代码'), dataIndex: 'code' }, { title: t('名称'), dataIndex: 'name' }, { title: t('状态'), dataIndex: 'status', render: (value: string) => t(value === 'ACTIVE' ? '启用' : '停用') }];
  return <section className="governance-panel" aria-label={t('部门岗位')}>
    {!editor ? <GovernanceFeedback error={error} retry={() => setRevision((value) => value + 1)} /> : null}
    {!!assignmentRefreshError && <Alert type="warning" showIcon title={t('任职已保存，但列表刷新失败。请重新加载任职后再编辑。')} description={assignmentRefreshError instanceof ApiError && assignmentRefreshError.traceId ? <span>{t('追踪标识')}：<code>{assignmentRefreshError.traceId}</code></span> : undefined} />}
    <Button disabled={saving || loading} onClick={() => setRevision((value) => value + 1)}>{t('刷新')}</Button>
    <Tabs items={[
      { key: 'departments', label: t('部门'), children: <><Space>{manage ? <Button disabled={saving} onClick={() => edit('department')}>{t('新建')}</Button> : null}</Space><Table<Department> rowKey="id" loading={loading} dataSource={departments} columns={[...commonColumns, { title: t('上级部门'), dataIndex: 'parentId', render: (id: string) => departments.find((entry) => entry.id === id)?.name ?? '—' }, { title: t('操作'), render: (_value, record) => manage ? <Button disabled={saving} onClick={() => edit('department', record)}>{t('编辑')}</Button> : t('只读') }]} /></> },
      { key: 'positions', label: t('岗位'), children: <><Space>{manage ? <Button disabled={saving} onClick={() => edit('position')}>{t('新建')}</Button> : null}</Space><Table<Position> className="position-structure-table" scroll={{ x: 850 }} rowKey="id" loading={loading} dataSource={positions} columns={[...commonColumns, { title: t('部门'), dataIndex: 'departmentId', render: (id: string) => departments.find((entry) => entry.id === id)?.name ?? id }, { title: t('岗位类别'), dataIndex: 'categoryId', render: (id: string) => categories.find((entry) => entry.id === id)?.name ?? id ?? '—' }, { title: t('操作'), render: (_value, record) => <Space wrap>{manage ? <Button disabled={saving} onClick={() => edit('position', record)}>{t('编辑')}</Button> : t('只读')}{readRoles && <Button disabled={saving} onClick={(event) => { roleTrigger.current = event.currentTarget; setRolePosition(record); }}>{t('岗位角色')}</Button>}</Space> }]} /></> },
      { key: 'assignments', label: t('用户任职'), children: <div className="governance-panel"><GovernanceFeedback error={usersError} retry={() => setRevision((value) => value + 1)} />{readUsers ? <Select aria-label={t('用户')} showSearch={{ filterOption: false, onSearch: setUserSearch }} value={userId || undefined} onChange={selectUser} loading={usersLoading} disabled={saving} placeholder={t('用户')} options={users.map((user) => ({ value: user.id, label: `${user.username}${user.email ? ` · ${user.email}` : ''}`, disabled: user.status !== 'ACTIVE' }))} /> : <label>{t('用户')} ID<Input aria-label={`${t('用户')} ID`} value={userId} onChange={(event) => selectUser(event.target.value)} disabled={saving} /></label>}<Button disabled={saving || loading || !userId.trim()} onClick={() => requestLeave(() => void loadAssignments())}>{t('查看任职')}</Button>{loadedUserId ? <><Select aria-label={t('岗位')} mode="multiple" value={selectedPositions} onChange={setSelectedPositions} disabled={!assign || saving || loading || !!assignmentRefreshError} options={positions.map((entry) => ({ value: entry.id, label: entry.name, disabled: entry.status !== 'ACTIVE' || departments.find((department) => department.id === entry.departmentId)?.status !== 'ACTIVE' }))} />{assign ? <Button disabled={saving || loading || !!assignmentRefreshError} loading={saving} onClick={() => void saveAssignments()}>{t('保存任职')}</Button> : null}<Table scroll={{ x: 600 }} rowKey="id" dataSource={assignments} columns={[{ title: t('岗位'), render: (_value, entry) => entry.position.name }, { title: t('开始时间'), dataIndex: 'startedAt', render: (value: string) => new Date(value).toLocaleString(locale) }, { title: t('结束时间'), dataIndex: 'endedAt', render: (value: string | null) => value ? new Date(value).toLocaleString(locale) : t('当前') }]} /></> : null}</div> },
    ]} />
    {rolePosition && readRoles && <PositionRolesDrawer organization={organization} position={rolePosition} canWrite={writeRoles} onClose={() => setRolePosition(undefined)} afterClose={() => roleTrigger.current?.focus()} />}
    <Modal open={!!editor} title={t(editor?.kind === 'department' ? '部门' : '岗位')} onOk={() => form.submit()} onCancel={() => { if (!pending.current) setEditor(undefined); }} okText={t('保存')} cancelText={t('取消')} confirmLoading={saving} cancelButtonProps={{ disabled: saving }} closable={!saving} keyboard={!saving} mask={{ closable: !saving }}>
      <GovernanceFeedback error={error} /><Form name="organization-structure-editor" form={form} layout="vertical" onFinish={save} disabled={saving}>
        {!editor?.record ? <Form.Item name="code" label={t('代码')} rules={[{ required: true }, { pattern: /^[A-Za-z0-9][A-Za-z0-9._-]*$/ }]}><Input maxLength={64} /></Form.Item> : null}
        <Form.Item name="name" label={t('名称')} rules={[{ required: true, whitespace: true }]}><Input maxLength={200} /></Form.Item>
        {editor?.kind === 'department' ? <Form.Item name="parentId" label={t('上级部门')}><Select allowClear options={departments.filter((entry) => entry.status === 'ACTIVE' && entry.id !== editor.record?.id).map((entry) => ({ value: entry.id, label: entry.name }))} /></Form.Item> : <><Form.Item name="departmentId" label={t('部门')} rules={[{ required: true }]}><Select options={departments.filter((entry) => entry.status === 'ACTIVE').map((entry) => ({ value: entry.id, label: entry.name }))} /></Form.Item><Form.Item name="categoryId" label={t('岗位类别')}><Select allowClear options={categories.filter((entry) => entry.status === 'ACTIVE').map((entry) => ({ value: entry.id, label: entry.name }))} /></Form.Item></>}
        {editor?.record ? <Form.Item name="status" label={t('状态')}><Select options={['ACTIVE', 'DISABLED'].map((value) => ({ value, label: t(value === 'ACTIVE' ? '启用' : '停用') }))} /></Form.Item> : null}
      </Form>
    </Modal>
  </section>;
}
