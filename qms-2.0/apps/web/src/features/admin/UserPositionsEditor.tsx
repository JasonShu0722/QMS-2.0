import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Modal, Space, Table, Typography } from 'antd';
import { useNavigate } from 'react-router-dom';
import type { components } from '@qms/contracts';
import { ApiError, apiRequest, createAdminMutation, safeAccountError } from '../../api/client';
import { useLanguage } from '../../i18n/Language';
import { useCompletedSessionNavigation, useNavigationBusy, useNavigationGuard, useUnsavedChanges } from '../../layouts/UnsavedChanges';
import { useWorkTabsStore } from '../../work-tabs/workTabsStore';
import { organizationPath, type UserPosition } from '../governance/governance';
import { permissionChanges, scopePath, type AdminUser, type UserRoles } from './admin';
import { PositionSelector } from './PositionSelector';
import { loadPositionDirectory, positionPages, type AuthorizationPreview, type PositionDirectory } from './position-authorization';

export function UserPositionsEditor({ organizationId, user, onClose, onSaved, onSessionEnding }: { organizationId: string; user: AdminUser; onClose: () => void; onSaved: () => void; onSessionEnding: () => void }) {
  const { t, locale } = useLanguage();
  const navigate = useNavigate();
  const requestLeave = useNavigationGuard();
  const completeSessionNavigation = useCompletedSessionNavigation();
  const [directory, setDirectory] = useState<PositionDirectory>();
  const [assignments, setAssignments] = useState<UserPosition[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [expected, setExpected] = useState<string[]>([]);
  const [currentPermissions, setCurrentPermissions] = useState<string[]>([]);
  const [preview, setPreview] = useState<AuthorizationPreview>();
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [conflict, setConflict] = useState(false);
  const [error, setError] = useState<string>();
  const [revision, setRevision] = useState(0);
  const alive = useRef(false);
  const pending = useRef(false);
  const mutation = useRef(createAdminMutation());
  const draft = useRef<string[] | undefined>(undefined);
  const session = useWorkTabsStore(state => state.sessionScope);
  useNavigationBusy(busy || loading);
  useUnsavedChanges(permissionChanges(expected, selected) > 0);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    setLoading(true); setPreview(undefined); setError(undefined);
    void Promise.all([loadPositionDirectory(organizationId, controller.signal), positionPages<UserPosition>(organizationPath(organizationId, `/users/${encodeURIComponent(user.id)}/positions`), controller.signal), apiRequest<UserRoles>(scopePath(`users/${encodeURIComponent(user.id)}/roles`, organizationId), { signal: controller.signal })])
      .then(([nextDirectory, nextAssignments, authorization]) => {
        if (!active) return;
        const now = Date.now();
        const effective = [...new Set(nextAssignments.filter(assignment => new Date(assignment.startedAt).getTime() <= now && (!assignment.endedAt || new Date(assignment.endedAt).getTime() > now) && assignment.position.status === 'ACTIVE' && nextDirectory.departments.some(department => department.id === assignment.position.departmentId && department.status === 'ACTIVE')).map(assignment => assignment.positionId))];
        setDirectory(nextDirectory); setAssignments(nextAssignments); setExpected(effective); setSelected(draft.current ?? effective); setCurrentPermissions(authorization.permissions ?? []); draft.current = undefined; setConflict(false);
      }).catch(cause => { if (active) setError(safeAccountError(cause)); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; controller.abort(); };
  }, [organizationId, user.id, revision, session]);
  async function save() {
    if (pending.current || loading || conflict || !preview) return;
    pending.current = true; setBusy(true); setError(undefined);
    const sessionScope = useWorkTabsStore.getState().sessionScope;
    try {
      const body: components['schemas']['ReplaceUserPositionsWithPreviewDto'] = { positionIds: selected, expectedPositionIds: expected, authorizationBaseline: preview.authorizationBaseline };
      await mutation.current<UserPosition[]>(organizationPath(organizationId, `/users/${encodeURIComponent(user.id)}/positions`), 'PUT', body);
      if (!alive.current || useWorkTabsStore.getState().sessionScope !== sessionScope) return;
      if (sessionScope === `INTERNAL:${organizationId}:${user.id}`) {
        onSessionEnding();
        completeSessionNavigation(() => { useWorkTabsStore.getState().reset(); navigate('/login', { replace: true }); });
      } else onSaved();
    } catch (cause) {
      if (alive.current && useWorkTabsStore.getState().sessionScope === sessionScope) {
        setError(safeAccountError(cause));
        if (cause instanceof ApiError && cause.status === 409) { setPreview(undefined); setConflict(true); }
      }
    } finally { pending.current = false; if (alive.current) setBusy(false); }
  }
  const names = (ids: string[]) => ids.map(id => directory?.positions.find(position => position.id === id)?.name ?? id).join(', ') || t('无');
  return <Modal title={`${user.username} · ${t('用户任职')}`} open footer={null} width={760} destroyOnHidden keyboard={!busy && !loading} closable={!busy && !loading} mask={{ closable: !busy && !loading }} onCancel={() => { if (!pending.current && !loading) requestLeave(onClose); }}>
    <Space orientation="vertical" className="admin-form-stack">
      {error && <Alert type="error" showIcon title={t(error)} />}
      {(conflict || (!loading && !directory)) && <Button disabled={busy || loading} onClick={() => { draft.current = selected; mutation.current = createAdminMutation(); setRevision(value => value + 1); }}>{t('读取最新任职基线')}</Button>}
      {!loading && directory && <>
        <Typography.Paragraph>{t('新增任职')}：{names(selected.filter(id => !expected.includes(id)))}</Typography.Paragraph>
        <Typography.Paragraph>{t('撤销任职')}：{names(expected.filter(id => !selected.includes(id)))}</Typography.Paragraph>
        <PositionSelector organizationId={organizationId} targetUserId={user.id} directory={directory} value={selected} onChange={setSelected} preview={preview} onPreviewChange={setPreview} disabled={busy || conflict} allowEmpty />
        {preview && <>
          <Typography.Paragraph>{t('将获得的权限')}：{preview.effectivePermissionCodes.filter(code => !currentPermissions.includes(code)).join(', ') || t('无')}</Typography.Paragraph>
          <Typography.Paragraph>{t('将撤销的权限')}：{currentPermissions.filter(code => !preview.effectivePermissionCodes.includes(code)).join(', ') || t('无')}</Typography.Paragraph>
          <Typography.Paragraph>{t('仍保留的权限')}：{currentPermissions.filter(code => preview.effectivePermissionCodes.includes(code)).join(', ') || t('无')}</Typography.Paragraph>
        </>}
      </>}
      <Button type="primary" loading={busy} disabled={loading || conflict || !preview} onClick={() => void save()}>{t('保存任职')}</Button>
      <Typography.Text strong>{t('任职记录（含历史）')}</Typography.Text>
      <Table<UserPosition> size="small" rowKey="id" loading={loading} dataSource={assignments} scroll={{ x: 560 }} columns={[
        { title: t('岗位'), render: (_, assignment) => assignment.position.name },
        { title: t('开始时间'), render: (_, assignment) => new Date(assignment.startedAt).toLocaleString(locale) },
        { title: t('结束时间'), render: (_, assignment) => assignment.endedAt ? new Date(assignment.endedAt).toLocaleString(locale) : t('未结束') },
      ]} />
    </Space>
  </Modal>;
}
