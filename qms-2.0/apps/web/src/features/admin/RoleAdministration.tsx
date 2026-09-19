import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Form, Input, Modal, Select, Space, Table, Tag } from 'antd';
import type { components } from '@qms/contracts';
import { apiRequest, createAdminMutation, safeAccountError } from '../../api/client';
import { allows, scopePath, type AdminOrganization, type AdminRole, type AdminPermission } from './admin';

type RoleForm = components['schemas']['CreateAdminRoleDto'];

export function RoleAdministration({ organization, matrix = false }: { organization: AdminOrganization; matrix?: boolean }) {
  const [roles, setRoles] = useState<AdminRole[]>([]);
  const [permissions, setPermissions] = useState<AdminPermission[]>([]);
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [success, setSuccess] = useState<string>();
  const [editing, setEditing] = useState<{ mode: 'new' | 'edit' | 'copy'; role?: AdminRole }>();
  const [form] = Form.useForm<RoleForm>();
  const mutate = useRef(createAdminMutation());
  const alive = useRef(true);
  const canManage = allows(organization, 'roles:manage');
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    let current = true; setLoading(true); setError(undefined);
    void Promise.all([apiRequest<AdminRole[]>(scopePath('roles', organization.id)), apiRequest<AdminPermission[]>(scopePath('permissions', organization.id))]).then(([nextRoles, nextPermissions]) => { if (current) { setRoles(nextRoles); setPermissions(nextPermissions); } }).catch((cause) => { if (current) setError(safeAccountError(cause)); }).finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [organization.id, revision]);
  async function perform(action: () => Promise<void>, message: string) {
    setBusy(true); setError(undefined); setSuccess(undefined);
    try { await action(); if (alive.current) { setSuccess(message); setRevision((value) => value + 1); } }
    catch (cause) { if (alive.current) setError(safeAccountError(cause)); }
    finally { if (alive.current) setBusy(false); }
  }
  function edit(mode: 'new' | 'edit' | 'copy', role?: AdminRole) {
    mutate.current = createAdminMutation(); setEditing({ mode, role }); form.resetFields();
    form.setFieldsValue({ name: mode === 'edit' ? role?.name : '', code: mode === 'edit' ? role?.code : '', permissionCodes: role?.permissions.map((permission) => permission.code) ?? [] });
  }
  async function save(values: RoleForm) {
    await perform(async () => {
      if (editing?.mode === 'new') await mutate.current<AdminRole>('/api/v1/admin/roles', 'POST', { code: values.code, name: values.name, permissionCodes: values.permissionCodes ?? [], organizationId: organization.id });
      else if (editing?.mode === 'copy') await mutate.current<AdminRole>(scopePath(`roles/${editing.role!.id}/copy`, organization.id), 'POST', { code: values.code, name: values.name });
      else if (editing?.role) {
        const patch: components['schemas']['UpdateAdminRoleDto'] = {};
        if (values.name !== editing.role.name) patch.name = values.name;
        const permissionCodes = new Set(values.permissionCodes ?? []);
        const originalCodes = new Set(editing.role.permissions.map((permission) => permission.code));
        if (permissionCodes.size !== originalCodes.size || [...permissionCodes].some((code) => !originalCodes.has(code))) patch.permissionCodes = [...permissionCodes];
        if (Object.keys(patch).length) await mutate.current<AdminRole>(scopePath(`roles/${editing.role.id}`, organization.id), 'PATCH', patch);
      }
      if (alive.current) { setEditing(undefined); form.resetFields(); }
    }, '角色已保存');
  }
  return <>
    {error && !editing && <Alert type="error" title={error} showIcon />}
    {success && <Alert type="success" title={success} showIcon />}
    {matrix ? <Table<AdminPermission> rowKey="code" loading={loading} dataSource={permissions} scroll={{ x: 'max-content' }} pagination={false} columns={[
      { title: '权限', fixed: 'left', render: (_, permission) => <>{permission.name}<br /><code>{permission.code}</code></> },
      ...roles.map((role) => ({ title: `${role.name}${role.organizationId === null ? '（全局）' : ''}`, key: role.id, render: (_: unknown, permission: AdminPermission) => role.permissions.some((entry) => entry.code === permission.code) ? '已授权' : '—' })),
    ]} /> : <>
      {canManage && <div className="admin-toolbar"><Button type="primary" disabled={busy} onClick={() => edit('new')}>创建角色</Button></div>}
      <Table<AdminRole> rowKey="id" loading={loading} dataSource={roles} scroll={{ x: 750 }} columns={[
        { title: '角色名称', dataIndex: 'name' }, { title: '角色代码', dataIndex: 'code' },
        { title: '范围', render: (_, role) => role.organizationId === null ? <Tag>全局只读</Tag> : organization.name },
        { title: '权限', render: (_, role) => <Space wrap>{role.permissions.map((permission) => <Tag key={permission.code}>{permission.code}</Tag>)}</Space> },
        { title: '操作', render: (_, role) => canManage && <Space>
          <Button size="small" disabled={busy} onClick={() => edit('copy', role)}>复制模板</Button>
          {role.organizationId !== null && <><Button size="small" disabled={busy} onClick={() => edit('edit', role)}>编辑角色</Button>
            <Button size="small" danger disabled={busy} onClick={() => void perform(async () => { await mutate.current<void>(scopePath(`roles/${role.id}`, organization.id), 'DELETE'); }, '角色已删除')}>删除角色</Button></>}
        </Space> },
      ]} />
      <details className="permission-directory"><summary>权限目录（只读）</summary>
        <Table<AdminPermission> rowKey="code" dataSource={permissions} columns={[{ title: '权限名称', dataIndex: 'name' }, { title: '权限代码', dataIndex: 'code' }]} />
      </details>
    </>}
    <Modal title={editing?.mode === 'copy' ? '复制角色模板' : editing?.mode === 'new' ? '创建角色' : '编辑角色'} open={!!editing} onCancel={() => { setEditing(undefined); form.resetFields(); mutate.current = createAdminMutation(); }} footer={null} destroyOnHidden>
      {error && <Alert type="error" title={error} showIcon />}
      <Form form={form} layout="vertical" onFinish={save}>
        {editing?.mode !== 'edit' && <Form.Item name="code" label="角色代码" rules={[{ required: true }, { pattern: /^[A-Za-z][A-Za-z0-9_-]*$/, message: '以字母开头，仅支持字母、数字、下划线和连字符' }]}><Input /></Form.Item>}
        <Form.Item name="name" label="角色名称" rules={[{ required: true, whitespace: true }]}><Input /></Form.Item>
        {editing?.mode !== 'copy' && <Form.Item name="permissionCodes" label="角色权限"><Select mode="multiple" options={permissions.map((permission) => ({ value: permission.code, label: `${permission.name} · ${permission.code}` }))} /></Form.Item>}
        <Button htmlType="submit" type="primary" loading={busy}>保存角色</Button>
      </Form>
    </Modal>
  </>;
}
