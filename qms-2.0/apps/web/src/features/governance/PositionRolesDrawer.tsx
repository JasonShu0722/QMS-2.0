import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Drawer, Modal, Select, Skeleton, Space, Tag } from 'antd';
import { useNavigate } from 'react-router-dom';
import type { components } from '@qms/contracts';
import { ApiError, apiRequest, createAdminMutation } from '../../api/client';
import { useLanguage } from '../../i18n/Language';
import { useCompletedSessionNavigation, useNavigationBusy, useUnsavedChanges } from '../../layouts/UnsavedChanges';
import { useWorkTabsStore } from '../../work-tabs/workTabsStore';
import { scopePath, type AdminOrganization, type AdminRole } from '../admin/admin';
import { organizationPath, type Position, type PositionRoles } from './governance';
import { GovernanceFeedback } from './GovernanceFeedback';

export function PositionRolesDrawer({ organization, position, canWrite, onClose, afterClose }: {
  organization: AdminOrganization; position: Position; canWrite: boolean; onClose: () => void; afterClose: () => void;
}) {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const completeSessionNavigation = useCompletedSessionNavigation();
  const [open, setOpen] = useState(true);
  const [configuration, setConfiguration] = useState<PositionRoles>();
  const [roles, setRoles] = useState<AdminRole[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [discard, setDiscard] = useState(false);
  const [error, setError] = useState<unknown>();
  const alive = useRef(false);
  const generation = useRef(0);
  const reading = useRef<AbortController | undefined>(undefined);
  const pending = useRef(false);
  const completed = useRef(false);
  const mutate = useRef(createAdminMutation());
  const path = organizationPath(organization.id, `/positions/${encodeURIComponent(position.id)}/roles`);
  const dirty = !!configuration && JSON.stringify([...selected].sort()) !== JSON.stringify(configuration.roles.map(({ id }) => id).sort());
  useUnsavedChanges(open && dirty);
  useNavigationBusy(busy);

  async function load(preserveDraft = false) {
    if (pending.current) return;
    const requestGeneration = ++generation.current;
    reading.current?.abort();
    const controller = new AbortController();
    reading.current = controller;
    setLoading(true); setError(undefined);
    try {
      const [next, candidates] = await Promise.all([
        apiRequest<PositionRoles>(path, { signal: controller.signal }), apiRequest<AdminRole[]>(scopePath('roles', organization.id), { signal: controller.signal }),
      ]);
      if (!alive.current || generation.current !== requestGeneration) return;
      setConfiguration(next); setRoles(candidates); setConflict(false);
      if (!preserveDraft) setSelected(next.roles.map(({ id }) => id));
      mutate.current = createAdminMutation();
    } catch (cause) { if (alive.current && generation.current === requestGeneration) setError(cause); }
    finally { if (alive.current && generation.current === requestGeneration) setLoading(false); }
  }
  useEffect(() => {
    alive.current = true;
    void load();
    return () => { alive.current = false; generation.current += 1; reading.current?.abort(); };
  }, []);

  async function save() {
    if (!configuration || !canWrite || pending.current || completed.current || loading || conflict || !open) return;
    const requestGeneration = generation.current;
    const sessionScope = useWorkTabsStore.getState().sessionScope;
    pending.current = true; setBusy(true); setError(undefined);
    const body: components['schemas']['ReplacePositionRolesDto'] = { roleIds: selected, expectedRoleVersion: configuration.roleVersion };
    try {
      const result = await mutate.current<PositionRoles>(path, 'PUT', body);
      if (!alive.current || generation.current !== requestGeneration || useWorkTabsStore.getState().sessionScope !== sessionScope) return;
      if (result.selfSessionRevoked) {
        completed.current = true; setOpen(false);
        completeSessionNavigation(() => { useWorkTabsStore.getState().reset(); navigate('/login', { replace: true }); });
        return;
      }
      setConfiguration(result); setSelected(result.roles.map(({ id }) => id));
    } catch (cause) {
      if (alive.current && generation.current === requestGeneration && useWorkTabsStore.getState().sessionScope === sessionScope) {
        setError(cause);
        if (cause instanceof ApiError && cause.status === 409) setConflict(true);
      }
    } finally { pending.current = false; if (alive.current && generation.current === requestGeneration) setBusy(false); }
  }
  function close() {
    if (pending.current) return;
    if (dirty) setDiscard(true); else setOpen(false);
  }
  const candidates = roles.filter((role) => role.organizationId === organization.id && role.permissions.every(({ code }) => organization.permissions.includes(code)));
  const options = candidates.map((role) => ({ value: role.id, label: role.name }));
  return <>
    <Drawer title={`${position.name} · ${t('岗位角色')}`} open={open} onClose={close} closable={!busy && !loading} keyboard={!busy && !loading} mask={{ closable: !busy && !loading }}
      styles={{ wrapper: { width: 'min(480px, 100vw)' }, body: { overflowX: 'auto' } }}
      afterOpenChange={(visible) => { if (!visible) { onClose(); afterClose(); } }} destroyOnHidden>
      <Space orientation="vertical" style={{ width: '100%' }}>
        {conflict ? <Alert type="warning" showIcon title={t('内容已被其他人修改。已保留当前填写内容，请重新加载后再保存。')} /> : <GovernanceFeedback error={error} />}
        <Alert type="info" showIcon title={t('岗位角色保存后，当前有效任职会自动生效。')} />
        {loading ? <Skeleton active paragraph={{ rows: 3 }} /> : configuration && <>
          <span>{t('角色版本')}：{configuration.roleVersion}</span>
          <span>{t('当前有效任职人数')}：{configuration.effectiveAssigneeCount}</span>
          {canWrite ? <Select aria-label={t('岗位角色')} mode="multiple" value={selected} onChange={setSelected} options={options} labelRender={({ value, label }) => configuration.roles.find(({ id }) => id === value)?.name ?? label} disabled={busy || conflict} style={{ width: '100%' }} />
            : <Space wrap>{configuration.roles.length ? configuration.roles.map((role) => <Tag key={role.id}>{role.name}</Tag>) : t('暂无数据')}</Space>}
          {canWrite && <Button autoInsertSpace={false} type="primary" loading={busy} disabled={busy || conflict} onClick={() => void save()}>{t('保存')}</Button>}
        </>}
        {!loading && !!error && <Button disabled={busy} onClick={() => void load(!!configuration)}>{t('重新加载角色配置')}</Button>}
      </Space>
    </Drawer>
    <Modal title={t('放弃未保存的修改？')} open={discard} focusable={{ focusTriggerAfterClose: open }} onCancel={() => setDiscard(false)} onOk={() => { setDiscard(false); setOpen(false); }} okText={t('放弃修改并关闭')} cancelText={t('取消')}>
      {t('当前修改尚未保存。')}
    </Modal>
  </>;
}
