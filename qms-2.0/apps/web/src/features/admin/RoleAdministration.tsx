import { useEffect, useRef, useState } from 'react';
import { useLanguage } from '../../i18n/Language';
import { Alert, Button, Form, Input, Modal, Space, Switch, Table, Tag } from 'antd';
import type { components } from '@qms/contracts';
import { ApiError, apiRequest, createAdminMutation, safeAccountError } from '../../api/client';
import { allows, permissionChanges, scopePath, type AdminOrganization, type AdminRole, type PermissionCatalogGroup } from './admin';
import { GroupedPermissionSelector } from './GroupedPermissionSelector';

type RoleForm = components['schemas']['CreateAdminRoleDto'];

export function RoleAdministration({ organization }: { organization: AdminOrganization }) {
  const { t } = useLanguage();
  const [roles, setRoles] = useState<AdminRole[]>([]);
  const [catalog, setCatalog] = useState<PermissionCatalogGroup[]>([]);
  const [revision, setRevision] = useState(0);
  const [directoryOpen, setDirectoryOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [traceId, setTraceId] = useState<string>();
  function setFailure(cause: unknown) { setError(safeAccountError(cause)); setTraceId(cause instanceof ApiError ? cause.traceId : undefined); }
  const errorDescription = traceId ? <span>{t('追踪标识')}: <code>{traceId}</code></span> : undefined;
  const [success, setSuccess] = useState<string>();
  const [editing, setEditing] = useState<{ mode: 'new' | 'edit' | 'copy'; role?: AdminRole }>();
  const editor = useRef(editing);
  editor.current = editing;
  const [form] = Form.useForm<RoleForm>();
  const mutate = useRef(createAdminMutation());
  const alive = useRef(true);
  const scope = useRef(organization.id);
  scope.current = organization.id;
  const canRead = allows(organization, 'roles:read');
  const canCreate = canRead && allows(organization, 'roles:create');
  const canUpdate = canRead && allows(organization, 'roles:update');
  const canDelete = canRead && allows(organization, 'roles:delete');
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    let current = true; setLoading(true); setError(undefined);
    if (!canRead) { setRoles([]); setCatalog([]); setLoading(false); return; }
    void Promise.all([apiRequest<AdminRole[]>(scopePath('roles', organization.id)), apiRequest<PermissionCatalogGroup[]>(scopePath('permission-catalog', organization.id))]).then(([nextRoles, nextCatalog]) => { if (current) { setRoles(nextRoles); setCatalog(nextCatalog); } }).catch((cause) => { if (current) setFailure(cause); }).finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [organization.id, revision, canRead]);
  useEffect(() => { setEditing(undefined); setSuccess(undefined); setBusy(false); mutate.current = createAdminMutation(); }, [organization.id]);
  async function perform(action: () => Promise<void>, message: string) {
    const organizationId = organization.id;
    setBusy(true); setError(undefined); setSuccess(undefined);
    try { await action(); if (alive.current && scope.current === organizationId) { setSuccess(message); setRevision((value) => value + 1); } }
    catch (cause) { if (alive.current && scope.current === organizationId) setFailure(cause); }
    finally { if (alive.current && scope.current === organizationId) setBusy(false); }
  }
  function edit(mode: 'new' | 'edit' | 'copy', role?: AdminRole) {
    mutate.current = createAdminMutation(); setEditing({ mode, role }); form.resetFields();
    form.setFieldsValue({ name: mode === 'edit' ? role?.name : '', code: mode === 'edit' ? role?.code : '', permissionCodes: role?.permissions.map((permission) => permission.code) ?? [], mfaRequired: role?.mfaRequired ?? false });
  }
  async function save(values: RoleForm) {
    if (busy || (editing?.mode === 'edit' ? !canUpdate : !canCreate)) return;
    const organizationId = organization.id;
    await perform(async () => {
      if (editing?.mode === 'new') await mutate.current<AdminRole>('/api/v1/admin/roles', 'POST', { code: values.code, name: values.name, permissionCodes: values.permissionCodes ?? [], organizationId: organization.id, mfaRequired: values.mfaRequired });
      else if (editing?.mode === 'copy') await mutate.current<AdminRole>(scopePath(`roles/${editing.role!.id}/copy`, organization.id), 'POST', { code: values.code, name: values.name });
      else if (editing?.role) {
        const patch: components['schemas']['UpdateAdminRoleDto'] = {};
        if (values.name !== editing.role.name) patch.name = values.name;
        if (values.mfaRequired !== editing.role.mfaRequired) { patch.mfaRequired = values.mfaRequired; patch.expectedMfaRequired = editing.role.mfaRequired; }
        const permissionCodes = values.permissionCodes ?? [];
        const originalCodes = editing.role.permissions.map((permission) => permission.code);
        if (permissionChanges(originalCodes, permissionCodes)) { patch.permissionCodes = permissionCodes; patch.expectedPermissionCodes = originalCodes; }
        if (Object.keys(patch).length) await mutate.current<AdminRole>(scopePath(`roles/${editing.role.id}`, organization.id), 'PATCH', patch);
      }
      if (alive.current && scope.current === organizationId) { setEditing(undefined); form.resetFields(); }
    }, '角色已保存');
  }
  async function reloadPermissions() {
    if (busy || editing?.mode !== 'edit' || !editing.role) return;
    const organizationId = organization.id;
    setBusy(true);
    try {
      const [nextRoles, nextCatalog] = await Promise.all([apiRequest<AdminRole[]>(scopePath('roles', organizationId)), apiRequest<PermissionCatalogGroup[]>(scopePath('permission-catalog', organizationId))]);
      if (!alive.current || scope.current !== organizationId || editor.current !== editing) return;
      setRoles(nextRoles); setCatalog(nextCatalog);
      const role = nextRoles.find((entry) => entry.id === editing.role!.id);
      if (!role) { setEditing(undefined); form.resetFields(); setError('角色已不存在，请重新选择'); setTraceId(undefined); return; }
      setEditing({ mode: 'edit', role }); form.setFieldsValue({ permissionCodes: role.permissions.map((permission) => permission.code), mfaRequired: role.mfaRequired });
      mutate.current = createAdminMutation(); setError(undefined);
    } catch (cause) { if (alive.current && scope.current === organizationId) setFailure(cause); }
    finally { if (alive.current && scope.current === organizationId) setBusy(false); }
  }
  return <>
    {error && !editing && <Alert type="error" title={t(error)} description={errorDescription} showIcon />}
    {success && <Alert type="success" title={t(success)} showIcon />}
      {canCreate && <div className="admin-toolbar"><Button type="primary" disabled={busy || loading} onClick={() => edit('new')}>{t('创建角色')}</Button></div>}
      <Table<AdminRole> rowKey="id" loading={loading} dataSource={roles} scroll={{ x: 750 }} columns={[
        { title: t('角色名称'), dataIndex: 'name' }, { title: t('角色代码'), dataIndex: 'code' },
        { title: t('范围'), render: (_, role) => role.organizationId === null ? <Tag>{t('全局只读')}</Tag> : organization.name },
        { title: t('权限'), render: (_, role) => <Space wrap>{role.permissions.map((permission) => <Tag key={permission.code}>{permission.code}</Tag>)}</Space> },
        { title: t('操作'), render: (_, role) => <Space>
          {canCreate && <Button size="small" disabled={busy} onClick={() => edit('copy', role)}>{t('复制模板')}</Button>}
          {role.organizationId !== null && <>{canUpdate && <Button size="small" disabled={busy} onClick={() => edit('edit', role)}>{t('编辑角色')}</Button>}
            {canDelete && <Button size="small" danger disabled={busy} onClick={() => void perform(async () => { await mutate.current<void>(scopePath(`roles/${role.id}`, organization.id), 'DELETE'); }, '角色已删除')}>{t('删除角色')}</Button>}</>}
        </Space> },
      ]} />
      <details className="permission-directory" onToggle={(event) => setDirectoryOpen(event.currentTarget.open)}><summary>{t('权限目录（只读）')}</summary>
        {directoryOpen && <GroupedPermissionSelector catalog={catalog} disabled />}
      </details>
    <Modal title={editing?.mode === 'copy' ? t('复制角色模板') : editing?.mode === 'new' ? t('创建角色') : t('编辑角色')} open={!!editing} onCancel={() => { setEditing(undefined); form.resetFields(); mutate.current = createAdminMutation(); }} footer={null} destroyOnHidden>
      {error && <Alert type="error" title={t(error)} description={errorDescription} showIcon />}
      {error && editing?.mode === 'edit' && <Button disabled={busy} onClick={() => void reloadPermissions()}>{t('重新加载并放弃权限修改')}</Button>}
      <Form name="admin-role-editor" form={form} layout="vertical" onFinish={save}>
        {editing?.mode !== 'edit' && <Form.Item name="code" label={t('角色代码')} rules={[{ required: true }, { pattern: /^[A-Za-z][A-Za-z0-9_-]*$/, message: t('以字母开头，仅支持字母、数字、下划线和连字符') }]}><Input /></Form.Item>}
        <Form.Item name="name" label={t('角色名称')} rules={[{ required: true, whitespace: true }]}><Input /></Form.Item>
        {editing?.mode !== 'copy' && <Form.Item name="mfaRequired" label="MFA" valuePropName="checked"><Switch disabled={busy} /></Form.Item>}
        {editing?.mode !== 'copy' && <Form.Item name="permissionCodes" label={t('角色权限')}><GroupedPermissionSelector catalog={catalog} disabled={busy} /></Form.Item>}
        <Button htmlType="submit" type="primary" loading={busy}>{t('保存角色')}</Button>
      </Form>
    </Modal>
  </>;
}
