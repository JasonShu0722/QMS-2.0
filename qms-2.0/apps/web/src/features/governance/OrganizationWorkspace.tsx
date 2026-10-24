import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Alert, Button, Empty, Spin, Typography } from 'antd';
import { useNavigate } from 'react-router-dom';
import { ApiError } from '../../api/client';
import type { AdminOrganization } from '../admin/admin';
import { useLanguage } from '../../i18n/Language';
import { useCompletedSessionNavigation, useNavigationGuard } from '../../layouts/UnsavedChanges';
import { useWorkTabsStore } from '../../work-tabs/workTabsStore';
import { allStructurePages, organizationPath, type Department, type Organization } from './governance';
import { GovernanceFeedback } from './GovernanceFeedback';
import { OrganizationAdministration } from './OrganizationAdministration';
import { StructureAdministration } from './StructureAdministration';
import './OrganizationWorkspace.css';

type Props = { organization: AdminOrganization; organizations: AdminOrganization[]; onSelectOrganization: (id: string) => void; onChanged?: () => void };
export function OrganizationWorkspace(props: Props) {
  const session = useWorkTabsStore(state => state.sessionScope);
  return <WorkspaceScope key={JSON.stringify([session, props.organization.id, [...props.organization.permissions].sort()])} {...props} />;
}

function WorkspaceScope({ organization, organizations, onSelectOrganization, onChanged }: Props) {
  const { t } = useLanguage();
  const requestLeave = useNavigationGuard();
  const completeSessionNavigation = useCompletedSessionNavigation();
  const navigate = useNavigate();
  const [departments, setDepartments] = useState<Department[]>([]);
  const [tree, setTree] = useState<Organization[]>([]);
  const [selectedId, setSelectedId] = useState<string>();
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [treeError, setTreeError] = useState<unknown>();
  const [structureError, setStructureError] = useState<unknown>();
  const mounted = useRef(false);
  const readOrganizations = organization.permissions.includes('organization:read');
  const readStructure = organization.permissions.includes('organization:structure:read');
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const session = useWorkTabsStore.getState().sessionScope;
    const current = () => active && useWorkTabsStore.getState().sessionScope === session;
    setLoading(true); setTreeError(undefined); setStructureError(undefined); setTree([]); setDepartments([]);
    function failure(cause: unknown, section: 'tree' | 'structure') {
      if (!current()) return;
      if (cause instanceof ApiError && cause.status === 401) {
        active = false;
        completeSessionNavigation(() => { useWorkTabsStore.getState().reset(); navigate('/login', { replace: true }); });
      } else if (section === 'tree') setTreeError(cause); else setStructureError(cause);
    }
    void Promise.all([
      readOrganizations ? allStructurePages<Organization>(`/api/v1/organizations/tree?organizationId=${encodeURIComponent(organization.id)}`, controller.signal)
        .then(result => { if (current()) setTree(result); }).catch(cause => failure(cause, 'tree')) : Promise.resolve(),
      readStructure ? allStructurePages<Department>(organizationPath(organization.id, '/departments'), controller.signal)
        .then(result => { if (current()) { const scoped = result.filter(entry => entry.organizationId === organization.id); setDepartments(scoped); setSelectedId(id => scoped.some(entry => entry.id === id) ? id : undefined); } }).catch(cause => failure(cause, 'structure')) : Promise.resolve(),
    ]).finally(() => { if (current()) setLoading(false); });
    return () => { active = false; controller.abort(); };
  }, [organization.id, readOrganizations, readStructure, revision, completeSessionNavigation, navigate]);

  const visibleOrganizations = organizations.filter(entry => entry.permissions.some(code => ['organization:read', 'organization:structure:read'].includes(code)));
  const visibleIds = new Set(visibleOrganizations.map(entry => entry.id));
  const parents = new Map(tree.filter(entry => visibleIds.has(entry.id)).map(entry => [entry.id, entry.parentId]));
  function departmentNodes(parentId: string | null, ancestors: string[] = []): ReactNode {
    return departments.filter(entry => (entry.parentId && departments.some(parent => parent.id === entry.parentId) ? entry.parentId : null) === parentId && !ancestors.includes(entry.id)).map(entry => <li key={entry.id}>
      <Button type="text" aria-label={`${entry.name} · ${t('部门/科室')}`} aria-pressed={selectedId === entry.id} onClick={() => { if (selectedId !== entry.id) requestLeave(() => setSelectedId(entry.id)); }}>{entry.name}<small>{entry.code}</small></Button>
      <ul>{departmentNodes(entry.id, [...ancestors, entry.id])}</ul>
    </li>);
  }
  function organizationNodes(parentId: string | null, ancestors: string[] = []): ReactNode {
    return visibleOrganizations.filter(entry => (parents.get(entry.id) && visibleIds.has(parents.get(entry.id)!) ? parents.get(entry.id) : null) === parentId && !ancestors.includes(entry.id)).map(entry => <li key={entry.id}>
      <Button type="text" aria-label={`${entry.name} · ${t('组织')}`} aria-pressed={entry.id === organization.id && !selectedId} onClick={() => { if (entry.id !== organization.id || selectedId) requestLeave(() => { if (entry.id === organization.id) setSelectedId(undefined); else onSelectOrganization(entry.id); }); }}>{entry.name}<small>{t('组织')} · {entry.code}</small></Button>
      {entry.id === organization.id && readStructure && <ul>{departmentNodes(null)}</ul>}
      <ul>{organizationNodes(entry.id, [...ancestors, entry.id])}</ul>
    </li>);
  }
  function refreshStructure() { if (mounted.current) setRevision(value => value + 1); }
  function changed() { if (mounted.current) { refreshStructure(); onChanged?.(); } }
  const organizationDetails = !selectedId && (readOrganizations
    ? <OrganizationAdministration organization={organization} organizations={organizations} items={tree} onChanged={changed} />
    : <Alert type="info" showIcon title={t('无组织基本信息读取权限')} />);
  return <section aria-label={t('组织与岗位')} className="organization-workspace">
    <aside className="organization-workspace-tree" aria-label={t('组织架构导航')}>
      <div className="governance-toolbar"><Typography.Text strong>{t('组织架构')}</Typography.Text><Button disabled={loading} onClick={() => requestLeave(() => setRevision(value => value + 1))}>{t('刷新架构')}</Button></div>
      <GovernanceFeedback error={treeError} retry={() => requestLeave(() => setRevision(value => value + 1))} />
      <GovernanceFeedback error={structureError} retry={() => requestLeave(() => setRevision(value => value + 1))} />
      {loading ? <Spin /> : <nav aria-label={t('可读组织与部门')}><ul>{organizationNodes(null)}</ul></nav>}
      {!readStructure && <Alert type="info" showIcon title={t('无部门岗位读取权限')} />}
    </aside>
    <div className="organization-workspace-context" key={`${revision}:${selectedId ?? ''}`}>
      {loading ? <Spin /> : <>
        {!readStructure && organizationDetails}
        {readStructure && !structureError && <StructureAdministration organization={organization} workspace={{ departments, departmentId: selectedId, organizationDetails, onRefresh: refreshStructure, onChanged: refreshStructure }} />}
        {!!structureError && organizationDetails}
        {!!structureError && <Empty description={t('部门岗位加载失败，请重试')} />}
      </>}
    </div>
  </section>;
}
