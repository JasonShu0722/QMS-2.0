import { useEffect, useRef, useState } from 'react';
import { useUnsavedChanges } from '../../layouts/UnsavedChanges';
import { useLanguage } from '../../i18n/Language';
import { Alert, Button, Modal, Select, Space, Spin, Typography } from 'antd';
import { ApiError, apiRequest, createAdminMutation, safeAccountError } from '../../api/client';
import { allows, permissionChanges, scopePath, type AdminOrganization, type AdminRole, type PermissionCatalogGroup } from './admin';
import { GroupedPermissionSelector } from './GroupedPermissionSelector';

export function PermissionMatrix({ organization, onDirtyChange, onBusyChange }: {
  organization: AdminOrganization;
  onDirtyChange?: (dirty: boolean) => void;
  onBusyChange?: (busy: boolean) => void;
}) {
  const { t } = useLanguage();
  const [roles, setRoles] = useState<AdminRole[]>([]);
  const [catalog, setCatalog] = useState<PermissionCatalogGroup[]>([]);
  const [selectedId, setSelectedId] = useState<string>();
  const selectedRoleId = useRef<string | undefined>(undefined);
  const [original, setOriginal] = useState<string[]>([]);
  const [draft, setDraft] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [traceId, setTraceId] = useState<string>();
  function setFailure(cause: unknown) { setError(safeAccountError(cause)); setTraceId(cause instanceof ApiError ? cause.traceId : undefined); }
  const errorDescription = traceId ? <span>{t('追踪标识')}: <code>{traceId}</code></span> : undefined;
  const [success, setSuccess] = useState<string>();
  const [revision, setRevision] = useState(0);
  const [pending, setPending] = useState<{ roleId: string } | { reload: true }>();
  const mutate = useRef(createAdminMutation());
  const alive = useRef(true);
  const scope = useRef(organization.id);
  scope.current = organization.id;
  const selectedRole = roles.find((role) => role.id === selectedId);
  const changes = permissionChanges(original, draft);
  useUnsavedChanges(changes > 0);
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
    }).catch((cause) => { if (current) setFailure(cause); }).finally(() => { if (current) setLoading(false); });
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
    } catch (cause) { if (alive.current && scope.current === organizationId) setFailure(cause); }
    finally { if (alive.current && scope.current === organizationId) setBusy(false); }
  }
  if (!canRead) return <Alert type="warning" title={t('无角色读取权限')} />;
  return <>
    {error && <Alert type="error" title={t(error)} description={errorDescription} showIcon />}
    {success && <Alert type="success" title={t(success)} showIcon />}
    <div className="admin-toolbar"><Space wrap>
      <Select aria-label={t('选择角色')} placeholder={t('选择角色')} value={selectedId} loading={loading} disabled={busy || loading} options={roles.map((role) => ({ value: role.id, label: `${role.name}${role.organizationId === null ? t('（全局只读）') : ''}` }))} onChange={(roleId) => { if (roleId !== selectedId) { if (changes) setPending({ roleId }); else switchRole(roleId); } }} />
      <Typography.Text>{t('已修改')} {changes} {t('项')}</Typography.Text>
      <Button type="primary" loading={busy} disabled={readOnly || loading || !changes} onClick={() => void save()}>{t('保存权限')}</Button>
      <Button disabled={busy || loading || !changes} onClick={() => { setDraft(original); setError(undefined); setSuccess(undefined); mutate.current = createAdminMutation(); }}>{t('重置修改')}</Button>
      <Button disabled={busy || loading} onClick={() => { if (changes) setPending({ reload: true }); else reload(); }}>{t('重新加载权限')}</Button>
    </Space></div>
    {readOnly && selectedRole && <Alert type="info" title={selectedRole.organizationId === null ? t('全局角色只读') : t('当前账号仅可查看角色权限')} />}
    {loading ? <Spin /> : <GroupedPermissionSelector catalog={catalog} value={draft} onChange={setDraft} disabled={readOnly || busy} />}
    <Modal title={t('放弃未保存的权限修改？')} open={!!pending} okText={t('放弃修改')} cancelText={t('继续编辑')} onCancel={() => setPending(undefined)} onOk={() => { if (pending && 'roleId' in pending) { switchRole(pending.roleId); setPending(undefined); } else reload(); }}>
      {t('当前草稿尚未保存，继续将放弃修改。')}
    </Modal>
  </>;
}
