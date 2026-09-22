import { useEffect, useState } from 'react';
import { Button, Form, Input, Modal, Select, Space, Table, Tabs } from 'antd';
import { apiRequest, createAdminMutation } from '../../api/client';
import type { AdminOrganization } from '../admin/admin';
import { configurationPath, organizationPath, type Department, type Position, type PositionCategory, type UserPosition } from './governance';
import { GovernanceFeedback } from './GovernanceFeedback';
import { useLanguage } from '../../i18n/Language';

async function allPages<Entry>(path: string) {
  const result: Entry[] = [];
  for (let offset = 0; offset <= 10000; offset += 100) {
    const page = await apiRequest<Entry[]>(`${path}?limit=100&offset=${offset}`);
    result.push(...page);
    if (page.length < 100) return result;
  }
  throw new Error('Structure exceeds supported page window');
}

export function StructureAdministration({ organization }: { organization: AdminOrganization }) {
  const { t, locale } = useLanguage();
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
  const [form] = Form.useForm();
  const [mutate] = useState(createAdminMutation);
  const manage = organization.permissions.includes('organization:structure:manage');
  const assign = organization.permissions.includes('organization:positions:assign');
  useEffect(() => {
    let active = true;
    setLoading(true); setError(undefined);
    void Promise.all([allPages<Department>(organizationPath(organization.id, '/departments')), allPages<Position>(organizationPath(organization.id, '/positions')), organization.permissions.includes('configuration:read') ? apiRequest<PositionCategory[]>(configurationPath(organization.id, 'position-categories')) : Promise.resolve([])]).then(([nextDepartments, nextPositions, nextCategories]) => { if (active) { setDepartments(nextDepartments); setPositions(nextPositions); setCategories(nextCategories); } }).catch((cause) => { if (active) setError(cause); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [organization.id, organization.permissions, revision]);
  function edit(kind: 'department' | 'position', record?: Department | Position) {
    form.resetFields(); form.setFieldsValue(record ?? { status: 'ACTIVE' }); setError(undefined); setEditor({ kind, record });
  }
  async function save(values: { code: string; name: string; parentId?: string; departmentId: string; categoryId?: string; status: 'ACTIVE' | 'DISABLED' }) {
    if (!editor) return;
    setSaving(true); setError(undefined);
    const base = organizationPath(organization.id, editor.kind === 'department' ? '/departments' : '/positions');
    const detail = editor.kind === 'department' ? { parentId: values.parentId ?? null } : { departmentId: values.departmentId, categoryId: values.categoryId ?? null };
    try {
      if (editor.record) await mutate(`${base}/${editor.record.id}`, 'PATCH', { name: values.name, ...detail, status: values.status, expectedVersion: editor.record.version });
      else await mutate(base, 'POST', { code: values.code, name: values.name, ...detail });
      setEditor(undefined); setRevision((value) => value + 1);
    } catch (cause) { setError(cause); } finally { setSaving(false); }
  }
  async function loadAssignments() {
    setSaving(true); setError(undefined); setLoadedUserId(undefined);
    try {
      const result = await allPages<UserPosition>(organizationPath(organization.id, `/users/${encodeURIComponent(userId.trim())}/positions`));
      setAssignments(result); setSelectedPositions(result.filter((entry) => !entry.endedAt).map((entry) => entry.positionId)); setLoadedUserId(userId.trim());
    } catch (cause) { setError(cause); } finally { setSaving(false); }
  }
  async function saveAssignments() {
    if (!loadedUserId) return;
    setSaving(true); setError(undefined);
    try {
      await mutate<UserPosition[]>(organizationPath(organization.id, `/users/${loadedUserId}/positions`), 'PUT', { positionIds: selectedPositions, expectedPositionIds: assignments.filter((entry) => !entry.endedAt).map((entry) => entry.positionId) });
      const result = await allPages<UserPosition>(organizationPath(organization.id, `/users/${loadedUserId}/positions`));
      setAssignments(result); setSelectedPositions(result.filter((entry) => !entry.endedAt).map((entry) => entry.positionId));
    } catch (cause) { setError(cause); } finally { setSaving(false); }
  }
  const commonColumns = [{ title: t('代码'), dataIndex: 'code' }, { title: t('名称'), dataIndex: 'name' }, { title: t('状态'), dataIndex: 'status', render: (value: string) => t(value === 'ACTIVE' ? '启用' : '停用') }];
  return <section className="governance-panel" aria-label={t('部门岗位')}>
    {!editor ? <GovernanceFeedback error={error} retry={() => setRevision((value) => value + 1)} /> : null}
    <Button disabled={saving || loading} onClick={() => setRevision((value) => value + 1)}>{t('刷新')}</Button>
    <Tabs items={[
      { key: 'departments', label: t('部门'), children: <><Space>{manage ? <Button disabled={saving} onClick={() => edit('department')}>{t('新建')}</Button> : null}</Space><Table<Department> rowKey="id" loading={loading} dataSource={departments} columns={[...commonColumns, { title: t('上级部门'), dataIndex: 'parentId', render: (id: string) => departments.find((entry) => entry.id === id)?.name ?? '—' }, { title: t('操作'), render: (_value, record) => manage ? <Button disabled={saving} onClick={() => edit('department', record)}>{t('编辑')}</Button> : t('只读') }]} /></> },
      { key: 'positions', label: t('岗位'), children: <><Space>{manage ? <Button disabled={saving} onClick={() => edit('position')}>{t('新建')}</Button> : null}</Space><Table<Position> rowKey="id" loading={loading} dataSource={positions} columns={[...commonColumns, { title: t('部门'), dataIndex: 'departmentId', render: (id: string) => departments.find((entry) => entry.id === id)?.name ?? id }, { title: t('岗位类别'), dataIndex: 'categoryId', render: (id: string) => categories.find((entry) => entry.id === id)?.name ?? id ?? '—' }, { title: t('操作'), render: (_value, record) => manage ? <Button disabled={saving} onClick={() => edit('position', record)}>{t('编辑')}</Button> : t('只读') }]} /></> },
      { key: 'assignments', label: t('用户任职'), children: <div className="governance-panel"><label>{t('用户')} ID<Input value={userId} onChange={(event) => { setUserId(event.target.value); setLoadedUserId(undefined); }} disabled={saving} /></label><Button disabled={saving || !userId.trim()} onClick={() => void loadAssignments()}>{t('查看任职')}</Button>{loadedUserId ? <><Select aria-label={t('岗位')} mode="multiple" value={selectedPositions} onChange={setSelectedPositions} disabled={!assign || saving} options={positions.map((entry) => ({ value: entry.id, label: entry.name, disabled: entry.status !== 'ACTIVE' || departments.find((department) => department.id === entry.departmentId)?.status !== 'ACTIVE' }))} />{assign ? <Button loading={saving} onClick={() => void saveAssignments()}>{t('保存任职')}</Button> : null}<Table rowKey="id" dataSource={assignments} columns={[{ title: t('岗位'), render: (_value, entry) => entry.position.name }, { title: t('开始时间'), dataIndex: 'startedAt', render: (value: string) => new Date(value).toLocaleString(locale) }, { title: t('结束时间'), dataIndex: 'endedAt', render: (value: string | null) => value ? new Date(value).toLocaleString(locale) : t('当前') }]} /></> : null}</div> },
    ]} />
    <Modal open={!!editor} title={t(editor?.kind === 'department' ? '部门' : '岗位')} onOk={() => form.submit()} onCancel={() => setEditor(undefined)} okText={t('保存')} cancelText={t('取消')} confirmLoading={saving} cancelButtonProps={{ disabled: saving }} closable={!saving} maskClosable={!saving}>
      <GovernanceFeedback error={error} /><Form name="organization-structure-editor" form={form} layout="vertical" onFinish={save} disabled={saving}>
        {!editor?.record ? <Form.Item name="code" label={t('代码')} rules={[{ required: true }, { pattern: /^[A-Za-z0-9][A-Za-z0-9._-]*$/ }]}><Input maxLength={64} /></Form.Item> : null}
        <Form.Item name="name" label={t('名称')} rules={[{ required: true, whitespace: true }]}><Input maxLength={200} /></Form.Item>
        {editor?.kind === 'department' ? <Form.Item name="parentId" label={t('上级部门')}><Select allowClear options={departments.filter((entry) => entry.status === 'ACTIVE' && entry.id !== editor.record?.id).map((entry) => ({ value: entry.id, label: entry.name }))} /></Form.Item> : <><Form.Item name="departmentId" label={t('部门')} rules={[{ required: true }]}><Select options={departments.filter((entry) => entry.status === 'ACTIVE').map((entry) => ({ value: entry.id, label: entry.name }))} /></Form.Item><Form.Item name="categoryId" label={t('岗位类别')}><Select allowClear options={categories.filter((entry) => entry.status === 'ACTIVE').map((entry) => ({ value: entry.id, label: entry.name }))} /></Form.Item></>}
        {editor?.record ? <Form.Item name="status" label={t('状态')}><Select options={['ACTIVE', 'DISABLED'].map((value) => ({ value, label: t(value === 'ACTIVE' ? '启用' : '停用') }))} /></Form.Item> : null}
      </Form>
    </Modal>
  </section>;
}
