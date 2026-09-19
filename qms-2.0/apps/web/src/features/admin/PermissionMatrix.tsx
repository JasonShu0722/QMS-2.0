import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Modal, Select, Space, Spin, Typography } from 'antd';
import { apiRequest, createAdminMutation, safeAccountError } from '../../api/client';
import { allows, permissionChanges, scopePath, type AdminOrganization, type AdminRole, type PermissionCatalogGroup } from './admin';
import { GroupedPermissionSelector } from './GroupedPermissionSelector';

export function PermissionMatrix({ organization, onDirtyChange, onBusyChange }: {
  organization: AdminOrganization;
  onDirtyChange?: (dirty: boolean) => void;
  onBusyChange?: (busy: boolean) => void;
}) {
  const [roles, setRoles] = useState<AdminRole[]>([]);
  const [catalog, setCatalog] = useState<PermissionCatalogGroup[]>([]);
  const [selectedId, setSelectedId] = useState<string>();
  const selectedRoleId = useRef<string | undefined>(undefined);
  const [original, setOriginal] = useState<string[]>([]);
  const [draft, setDraft] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [success, setSuccess] = useState<string>();
  const [revision, setRevision] = useState(0);
  const [pending, setPending] = useState<{ roleId: string } | { reload: true }>();
  const mutate = useRef(createAdminMutation());
  const alive = useRef(true);
  const scope = useRef(organization.id);
  scope.current = organization.id;
  const selectedRole = roles.find((role) => role.id === selectedId);
  const changes = permissionChanges(original, draft);
  const canRead = allows(organization, 'roles:read');
  const readOnly = !canRead || !allows(organization, 'roles:update') || !selectedRole || selectedRole.organizationId === null;
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => { onDirtyChange?.(changes > 0); }, [changes, onDirtyChange]);
  useEffect(() => { onBusyChange?.(busy); }, [busy, onBusyChange]);
  useEffect(() => {
    if (!changes) return;
    const protect = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', protect);
    return () => window.removeEventListener('beforeunload', protect);
  }, [changes]);
  useEffect(() => {
    let current = true;
    setLoading(true); setError(undefined);
    if (!canRead) { setLoading(false); return; }
    void Promise.all([apiRequest<AdminRole[]>(scopePath('roles', organization.id)), apiRequest<PermissionCatalogGroup[]>(scopePath('permission-catalog', organization.id))]).then(([nextRoles, nextCatalog]) => {
      if (!current) return;
      setRoles(nextRoles); setCatalog(nextCatalog);
      const role = nextRoles.find((entry) => entry.id === selectedRoleId.current) ?? nextRoles[0];
      const codes = role?.permissions.map((permission) => permission.code) ?? [];
      selectedRoleId.current = role?.id;
      setSelectedId(role?.id); setOriginal(codes); setDraft(codes);
      mutate.current = createAdminMutation();
    }).catch((cause) => { if (current) setError(safeAccountError(cause)); }).finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [organization.id, revision, canRead]);
  function switchRole(roleId: string) {
    const codes = roles.find((role) => role.id === roleId)?.permissions.map((permission) => permission.code) ?? [];
    selectedRoleId.current = roleId;
    setSelectedId(roleId); setOriginal(codes); setDraft(codes); setError(undefined); setSuccess(undefined); mutate.current = createAdminMutation();
  }
  function reload() { setPending(undefined); setSuccess(undefined); setRevision((value) => value + 1); }
  async function save() {
    if (readOnly || busy || loading || !changes || !selectedRole) return;
    const organizationId = organization.id;
    setBusy(true); setError(undefined); setSuccess(undefined);
    try {
      const savedRole = await mutate.current<AdminRole>(scopePath(`roles/${selectedRole.id}`, organizationId), 'PATCH', { permissionCodes: draft, expectedPermissionCodes: original });
      if (alive.current && scope.current === organizationId) {
        setOriginal(draft); setRoles((current) => current.map((role) => role.id === selectedRole.id ? savedRole : role));
        setSuccess('权限已保存');
      }
    } catch (cause) { if (alive.current && scope.current === organizationId) setError(safeAccountError(cause)); }
    finally { if (alive.current && scope.current === organizationId) setBusy(false); }
  }
  if (!canRead) return <Alert type="warning" title="无角色读取权限" />;
  return <>
    {error && <Alert type="error" title={error} showIcon />}
    {success && <Alert type="success" title={success} showIcon />}
    <div className="admin-toolbar"><Space wrap>
      <Select aria-label="选择角色" placeholder="选择角色" value={selectedId} loading={loading} disabled={busy || loading} options={roles.map((role) => ({ value: role.id, label: `${role.name}${role.organizationId === null ? '（全局只读）' : ''}` }))} onChange={(roleId) => { if (roleId !== selectedId) { if (changes) setPending({ roleId }); else switchRole(roleId); } }} />
      <Typography.Text>已修改 {changes} 项</Typography.Text>
      <Button type="primary" loading={busy} disabled={readOnly || loading || !changes} onClick={() => void save()}>保存权限</Button>
      <Button disabled={busy || loading || !changes} onClick={() => { setDraft(original); setError(undefined); setSuccess(undefined); mutate.current = createAdminMutation(); }}>重置修改</Button>
      <Button disabled={busy || loading} onClick={() => { if (changes) setPending({ reload: true }); else reload(); }}>重新加载权限</Button>
    </Space></div>
    {readOnly && selectedRole && <Alert type="info" title={selectedRole.organizationId === null ? '全局角色只读' : '当前账号仅可查看角色权限'} />}
    {loading ? <Spin /> : <GroupedPermissionSelector catalog={catalog} value={draft} onChange={setDraft} disabled={readOnly || busy} />}
    <Modal title="放弃未保存的权限修改？" open={!!pending} okText="放弃修改" cancelText="继续编辑" onCancel={() => setPending(undefined)} onOk={() => { if (pending && 'roleId' in pending) { switchRole(pending.roleId); setPending(undefined); } else reload(); }}>
      当前草稿尚未保存，继续将放弃修改。
    </Modal>
  </>;
}
