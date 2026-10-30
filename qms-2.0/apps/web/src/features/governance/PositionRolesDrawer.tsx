import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Drawer, Modal, Skeleton, Space, Switch, Table, Typography } from 'antd';
import { useNavigate } from 'react-router-dom';
import type { components } from '@qms/contracts';
import { ApiError, apiRequest, createAdminMutation } from '../../api/client';
import { useCompletedSessionNavigation, useNavigationBusy, useUnsavedChanges } from '../../layouts/UnsavedChanges';
import { useWorkTabsStore } from '../../work-tabs/workTabsStore';
import { scopePath, type AdminOrganization, type AdminRole, type PermissionCatalogGroup } from '../admin/admin';
import { GroupedPermissionSelector } from '../admin/GroupedPermissionSelector';
import { permissionSummary, RolePermissionDetails } from '../admin/RolePermissionDetails';
import { organizationPath, type Position } from './governance';
import { GovernanceFeedback } from './GovernanceFeedback';
import { AuthorizationSources, canReadAuthorizationSources, useAuthorizationLanguage } from './AuthorizationSources';

export function PositionRolesDrawer({ organization, position, canWrite, onClose, afterClose, onDenied }: {
  organization: AdminOrganization; position: Position; canWrite: boolean; onClose: () => void; afterClose: () => void; onDenied?: (error: ApiError) => void;
}) {
  const { t, locale } = useAuthorizationLanguage();
  const navigate = useNavigate();
  const completeSessionNavigation = useCompletedSessionNavigation();
  const [open, setOpen] = useState(true);
  const [configuration, setConfiguration] = useState<components['schemas']['PositionPermissionsDto']>();
  const [catalog, setCatalog] = useState<PermissionCatalogGroup[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [mfaRequired, setMfaRequired] = useState(false);
  const [details, setDetails] = useState<AdminRole>();
  const detailsTrigger = useRef<HTMLButtonElement>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [discard, setDiscard] = useState(false);
  const [error, setError] = useState<unknown>();
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const alive = useRef(false);
  const generation = useRef(0);
  const reading = useRef<AbortController | undefined>(undefined);
  const pending = useRef(false);
  const completed = useRef(false);
  const mutate = useRef(createAdminMutation());
  const path = organizationPath(organization.id, `/positions/${encodeURIComponent(position.id)}/permissions`);
  const grantable = catalog.filter(group => group.status !== 'planned').flatMap(group => group.modules.filter(module => module.status !== 'planned').flatMap(module => module.operations.filter(operation => operation.grantable).map(operation => operation.code)));
  const dirty = !!configuration && (mfaRequired !== configuration.mfaRequired || JSON.stringify([...selected].sort()) !== JSON.stringify([...configuration.permissionCodes].sort()));
  useUnsavedChanges(open && dirty);
  useNavigationBusy(busy);

  function endExpiredSession(cause: unknown) {
    if (!(cause instanceof ApiError) || cause.status !== 401) return false;
    completed.current = true; generation.current++; reading.current?.abort();
    setOpen(false); setDiscard(false); setConfiguration(undefined); setSelected([]); setBusy(false); setLoading(false);
    completeSessionNavigation(() => { useWorkTabsStore.getState().reset(); navigate('/login', { replace: true }); });
    return true;
  }

  async function load(preserveDraft = false) {
    if (pending.current || completed.current) return;
    const requestGeneration = ++generation.current;
    const session = useWorkTabsStore.getState().sessionScope;
    const current = () => alive.current && generation.current === requestGeneration && useWorkTabsStore.getState().sessionScope === session;
    reading.current?.abort();
    const controller = new AbortController();
    reading.current = controller;
    setLoading(true); setError(undefined);
    try {
      const [next, candidates] = await Promise.all([
        apiRequest<components['schemas']['PositionPermissionsDto']>(path, { signal: controller.signal }), apiRequest<PermissionCatalogGroup[]>(scopePath('permission-catalog', organization.id), { signal: controller.signal }),
      ]);
      if (!current()) return;
      setConfiguration(next); setCatalog(candidates); setConflict(false);
      if (!preserveDraft) { setSelected(next.permissionCodes); setMfaRequired(next.mfaRequired); }
      mutate.current = createAdminMutation();
    } catch (cause) { if (current() && !endExpiredSession(cause)) setError(cause); }
    finally { if (current()) setLoading(false); }
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
    const body: components['schemas']['UpdatePositionPermissionsDto'] = {
      permissionCodes: selected, expectedPermissionCodes: configuration.permissionCodes,
      mfaRequired, expectedMfaRequired: configuration.mfaRequired, expectedRoleVersion: configuration.roleVersion,
    };
    try {
      const result = await mutate.current<components['schemas']['PositionPermissionsDto']>(path, 'PUT', body);
      if (!alive.current || generation.current !== requestGeneration || useWorkTabsStore.getState().sessionScope !== sessionScope) return;
      if (result.selfSessionRevoked) {
        completed.current = true; setOpen(false);
        completeSessionNavigation(() => { useWorkTabsStore.getState().reset(); navigate('/login', { replace: true }); });
        return;
      }
      setConfiguration(result); setSelected(result.permissionCodes); setMfaRequired(result.mfaRequired);
    } catch (cause) {
      if (alive.current && generation.current === requestGeneration && useWorkTabsStore.getState().sessionScope === sessionScope) {
        if (endExpiredSession(cause)) return;
        setError(cause);
        if (cause instanceof ApiError && cause.status === 409) setConflict(true);
      }
    } finally { pending.current = false; if (alive.current && generation.current === requestGeneration) setBusy(false); }
  }
  function close() {
    if (pending.current || loading) return;
    if (dirty) setDiscard(true); else setOpen(false);
  }
  return <>
    <Drawer title={`${position.name} · ${t('岗位权限')}`} open={open} onClose={close} closable={!busy && !loading} keyboard={!busy && !loading} mask={{ closable: !busy && !loading }}
      styles={{ wrapper: { width: 'min(720px, 100vw)' }, body: { overflowX: 'auto' } }}
      afterOpenChange={(visible) => { if (!visible) { onClose(); afterClose(); } }} destroyOnHidden>
      <Space orientation="vertical" style={{ width: '100%' }}>
        {conflict ? <Alert type="warning" showIcon title={t('内容已被其他人修改。已保留当前填写内容，请重新加载后再保存。')} /> : <GovernanceFeedback error={error} />}
        <Alert type="info" showIcon title={t('岗位权限保存后，当前有效任职会自动生效。')} />
        {canReadAuthorizationSources(organization) && <Button disabled={busy || loading} onClick={() => setSourcesOpen(value => !value)}>{t(sourcesOpen ? '收起授权来源' : '查看授权来源')}</Button>}
        {sourcesOpen && open && <AuthorizationSources organization={organization} positionId={position.id} onDenied={cause => {
          completed.current = true; generation.current++; reading.current?.abort(); setSourcesOpen(false); setOpen(false); setDiscard(false); setConfiguration(undefined); setCatalog([]); setSelected([]); setDetails(undefined); setBusy(false); onDenied?.(cause);
        }} />}
        {loading ? <Skeleton active paragraph={{ rows: 3 }} /> : configuration && <>
          <span>{t('角色版本')}：{configuration.roleVersion}</span>
          <span>{t('当前有效任职人数')}：{configuration.effectiveAssigneeCount}</span>
          <Typography.Title level={4}>{t('岗位自有权限')}</Typography.Title>
          {canWrite && <Button disabled={busy || conflict || !grantable.length} onClick={() => setSelected([...new Set([...selected, ...grantable])])}>{t('选择全部可授予权限')}</Button>}
          {!selected.length && !configuration.legacyRoles.some((role) => role.permissions.length) && <Alert type="warning" showIcon title={t('该岗位未配置系统权限')} />}
          <GroupedPermissionSelector catalog={catalog} value={selected} onChange={setSelected} disabled={!canWrite || busy || conflict} />
          <Space><span>{t('要求 MFA')}</span><Switch aria-label={t('要求 MFA')} checked={mfaRequired} onChange={setMfaRequired} disabled={!canWrite || busy || conflict} /></Space>
          <Typography.Title level={4}>{t('历史兼容授权')}</Typography.Title>
          <Alert type="info" showIcon title={t('历史兼容授权仍然生效，取消岗位自有权限不会撤销历史来源。')} />
          <Table<AdminRole> rowKey="id" size="small" pagination={false} dataSource={configuration.legacyRoles} columns={[
            { title: t('名称'), dataIndex: 'name' },
            { title: t('权限'), render: (_, role) => { const summary = permissionSummary(role.permissions, catalog, locale); return <Space wrap><span>{t('权限')} {summary.count} {t('项')}{summary.modules.length ? ` · ${summary.modules.join(' · ')}` : ''}</span><Button type="link" size="small" aria-label={`${role.name} · ${t('详情')}`} onClick={(event) => { detailsTrigger.current = event.currentTarget as HTMLButtonElement; setDetails(role); }}>{t('详情')}</Button></Space>; } },
            { title: 'MFA', render: (_, role) => t(role.mfaRequired ? '要求 MFA' : '登录时不要求 MFA') },
          ]} />
          {canWrite && <Button autoInsertSpace={false} type="primary" loading={busy} disabled={busy || conflict} onClick={() => void save()}>{t('保存')}</Button>}
        </>}
        {!loading && !!error && <Button disabled={busy} onClick={() => void load(!!configuration)}>{t('重新加载岗位权限')}</Button>}
      </Space>
    </Drawer>
    <Modal title={t('放弃未保存的修改？')} open={discard} focusable={{ focusTriggerAfterClose: open }} onCancel={() => setDiscard(false)} onOk={() => { setDiscard(false); setOpen(false); }} okText={t('放弃修改并关闭')} cancelText={t('取消')}>
      {t('当前修改尚未保存。')}
    </Modal>
    <RolePermissionDetails open={!!details && open} role={details} catalog={catalog} onClose={() => setDetails(undefined)} afterClose={() => detailsTrigger.current?.focus()} />
  </>;
}
