import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Spin } from 'antd';
import { useLocation, useNavigate } from 'react-router-dom';
import type { components } from '@qms/contracts';
import { ApiError, apiRequest } from '../api/client';
import { getAdminOrganizations, type AdminOrganization } from '../features/admin/admin';
import { UserAdministration } from '../features/admin/UserAdministration';
import { UserForceDelete } from '../features/admin/UserForceDelete';
import { AdminSupplierAccounts } from '../features/admin/AdminSupplierAccounts';
import { OrganizationWorkspace } from '../features/governance/OrganizationWorkspace';
import { ComponentProjectAdministration } from '../features/governance/ComponentProjectAdministration';
import { ConfigurationAdministration } from '../features/governance/ConfigurationAdministration';
import { AuditAdministration } from '../features/governance/AuditAdministration';
import { OutboxAdministration } from '../features/governance/OutboxAdministration';
import { AdministrativeReconfiguration } from '../features/governance/AdministrativeReconfiguration';
import { AdministrativeProblemReconfiguration } from '../features/governance/AdministrativeProblemReconfiguration';
import { AdministrativeForceDeleteDialog } from '../features/governance/AdministrativeForceDeleteDialog';
import { organizationPath } from '../features/governance/governance';
import { SupplierProfilesPage } from '../features/supplier-quality/SupplierProfilesPage';
import { CustomerMasterSection } from '../features/customer-quality/CustomerMasterSection';
import { MaterialMasterPage } from '../features/material-master/MaterialMasterPage';
import { useLanguage } from '../i18n/Language';
import { useWorkTabsStore } from '../work-tabs/workTabsStore';
import { useConsoleContext } from './ConsoleLayout';
import { consoleRoute, type ConsoleContext } from './console-navigation';

type Management = components['schemas']['AdminOrganizationContextDto'];
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const lifecycle = new Set(['organization:force-delete', 'organization:departments:force-delete', 'account:users:delete', 'organization:reconfigure']);
const fixedHome = new Set(['reconfiguration', 'problem-reconfiguration', 'supplier-accounts']);
const required: Record<string, string[]> = {
  users: ['account:users:read', 'account:users:create'], organizations: ['organization:read', 'organization:structure:read', 'account:roles:read'],
  suppliers: ['supplier-quality:profiles:read', 'supplier-quality:profiles:write'], customers: ['customer-quality:complaints:read', 'customer-quality:complaints:write'],
  materials: ['material-master:read', 'material-master:write', 'material-master:import'], 'component-projects': ['component-project:read', 'component-project:manage'],
  configuration: ['configuration:read'], 'audit-log': ['audit:read'], outbox: ['outbox:read'], reconfiguration: ['organization:reconfigure'],
  'problem-reconfiguration': ['organization:reconfigure'], 'supplier-accounts': ['account:users:delete'],
};

function validLocation(search: string, section: string, context: ConsoleContext) {
  const query = new URLSearchParams(search);
  const keys = ['organizationId', 'section', 'userId', 'resourceType', 'resourceId'];
  if (/%(?![0-9a-f]{2})/i.test(search) || [...query.keys()].some(key => !keys.includes(key)) || keys.some(key => query.getAll(key).length > 1)) return false;
  const organizationId = query.get('organizationId');
  if (organizationId !== null && (!uuid.test(organizationId) || organizationId.toLowerCase() !== context.targetOrganization.id.toLowerCase())) return false;
  if (query.has('section') && query.get('section') !== section) return false;
  if (query.has('userId') && (section !== 'users' || !organizationId || !uuid.test(query.get('userId')!))) return false;
  if (query.has('resourceType') || query.has('resourceId')) {
    const type = query.get('resourceType') ?? ''; const id = query.get('resourceId') ?? '';
    if (section !== 'audit-log' || !organizationId || !type.trim() || type.length > 100 || !id.trim() || id.length > 128 || /[\u0000-\u001f\u007f]/.test(type + id)) return false;
  }
  return true;
}

export function ConsoleManagementPage() {
  const console = useConsoleContext();
  const location = useLocation();
  const session = useWorkTabsStore(state => state.sessionScope);
  const { t } = useLanguage();
  const [revision, setRevision] = useState(0);
  const route = consoleRoute(location.pathname, console.context);
  const section = location.pathname.split('/').at(-1)!;
  const module = route.module;
  const home = !!module && fixedHome.has(module.key);
  const source = home ? console.context.actor.homeOrganization : console.context.targetOrganization;
  if (route.status !== 'allowed' || !module || !required[section] || module.scope !== (home ? 'SESSION_HOME' : 'TARGET')
    || module.coverage !== (home ? 'PLATFORM' : 'ORGANIZATION') || module.organizationId !== source.id
    || session !== `INTERNAL:${console.context.actor.homeOrganization.id}:${console.context.actor.id}`) {
    return <Alert type="warning" showIcon role="alert" title={t('无权访问此管理模块')} />;
  }
  if (!validLocation(location.search, section, console.context)) return <Alert type="error" showIcon role="alert" title={t('管理定位无效：链接无效或与当前管理范围不匹配。')} />;
  const structure = [console.context.actor.homeOrganization, console.context.targetOrganization].map(organization => [organization.id, organization.type, organization.status, organization.configurationRequired]);
  // Cosmetic directory updates must not retire drafts; authorization structure still does.
  return <ManagementScope key={JSON.stringify([session, console.context.actor.id, structure, console.context.hasPlatformAdministrator, console.context.modules, location.pathname, location.search, revision])}
    context={console.context} sourceId={source.id} section={section} session={session} search={location.search}
    invalidate={console.invalidate} retry={() => setRevision(value => value + 1)}
    onDirectoryChange={() => { setRevision(value => value + 1); console.refresh(); }} />;
}

function ManagementScope({ context, sourceId, section, session, search, invalidate, retry, onDirectoryChange }: {
  context: ConsoleContext; sourceId: string; section: string; session: string; search: string;
  invalidate: () => void; retry: () => void; onDirectoryChange: () => void;
}) {
  const { t } = useLanguage();
  const location = useLocation();
  const navigate = useNavigate();
  const [result, setResult] = useState<{ organizations: AdminOrganization[]; management: Management; read: AbortController }>();
  const [error, setError] = useState<'denied' | 'network'>();
  const controller = useRef<AbortController | undefined>(undefined);
  const current = (read = result?.read) => !!read && controller.current === read && !read.signal.aborted && useWorkTabsStore.getState().sessionScope === session;
  function denied(cause: ApiError, read = result?.read) {
    if (!current(read) || (cause.status !== 401 && cause.status !== 403)) return;
    read?.abort(); setResult(undefined); setError('denied'); invalidate();
  }
  useEffect(() => {
    const read = new AbortController(); controller.current = read;
    const unsubscribe = useWorkTabsStore.subscribe(state => {
      // A batched A -> B -> A transition still retires this entire read generation.
      if (state.sessionScope !== session && controller.current === read && !read.signal.aborted) { read.abort(); setResult(undefined); setError('denied'); }
    });
    void Promise.all([getAdminOrganizations(), apiRequest<Management>(`/api/v1/admin/organizations/context?organizationId=${encodeURIComponent(sourceId)}`, { signal: read.signal })])
      .then(([organizations, management]) => {
        if (!current(read)) return;
        if (!Array.isArray(organizations) || organizations.some(entry => !entry || typeof entry.id !== 'string' || !Array.isArray(entry.permissions) || entry.permissions.some(code => typeof code !== 'string'))
          || organizations.filter(entry => entry.id === sourceId).length !== 1 || !management || management.targetOrganizationId !== sourceId
          || management.homeOrganizationId !== context.actor.homeOrganization.id || typeof management.hasPlatformAdministrator !== 'boolean'
          || !Array.isArray(management.permissions) || management.permissions.some(code => typeof code !== 'string')
          || !['ACTIVE', 'DISABLED'].includes(management.targetOrganizationStatus) || typeof management.targetConfigurationRequired !== 'boolean' || management.accessKind === 'NONE') {
          denied(new ApiError({ code: 'ORGANIZATION_SCOPE_DENIED', message: 'Invalid management scope' }, 403), read); return;
        }
        setError(undefined); setResult({ organizations, management, read });
      }).catch(cause => {
        if (!current(read)) return;
        if (cause instanceof ApiError && (cause.status === 401 || cause.status === 403)) denied(cause, read);
        else { setResult(undefined); setError('network'); }
      });
    return () => { read.abort(); unsubscribe(); };
  }, [sourceId, session]);

  if (error) return <div className="qms-console-state"><Alert showIcon role="alert" type="error" title={t(error === 'denied' ? '无权访问此管理模块，请重新验证管理权限。' : '无法读取管理目录，请重试。')} /><Button aria-label={t('重试')} onClick={retry}>{t('重试')}</Button></div>;
  if (!result) return <div className="qms-console-state" role="status" aria-label={t('核实管理身份')}><Spin /></div>;
  const { management } = result;
  const organizations = result.organizations.map(entry => {
    const metadata = context.organizations.find(organization => organization.id === entry.id);
    return metadata ? { ...entry, name: metadata.name, code: metadata.code } : entry;
  });
  const selected = organizations.find(entry => entry.id === sourceId)!;
  const organization: AdminOrganization = { ...selected, permissions: selected.permissions.filter(code =>
    (management.targetOrganizationStatus === 'ACTIVE' && !management.targetConfigurationRequired || management.permissions.includes(code))
    && (!lifecycle.has(code) || management.hasPlatformAdministrator && management.permissions.includes(code))) };
  const internalOnly = ['suppliers', 'materials', 'component-projects'].includes(section);
  if (internalOnly && organization.type !== 'INTERNAL' || !required[section]!.some(code => organization.permissions.includes(code))) return <Alert type="warning" showIcon role="alert" title={t('无权访问此管理模块')} />;
  const query = new URLSearchParams(search);
  const changed = () => { if (current()) onDirectoryChange(); };
  const completed = (onCompleted: () => void) => { if (current()) { onCompleted(); changed(); } };
  switch (section) {
    case 'users': return <UserAdministration organization={organization} organizations={organizations} targetUserId={query.get('userId')?.toLowerCase()} onDenied={denied} />;
    case 'organizations': return <OrganizationWorkspace organization={organization} organizations={organizations} onChanged={changed} onDenied={denied} onSelectOrganization={id => {
      if (!current() || id === sourceId || !context.organizations.some(entry => entry.id === id) || !organizations.some(entry => entry.id === id)) return;
      const next = new URLSearchParams(location.search); next.set('organizationId', id); navigate({ pathname: location.pathname, search: next.toString(), hash: location.hash });
    }} />;
    case 'suppliers': return <SupplierProfilesPage organizationId={organization.id} organizationPermissions={organization.permissions} onDenied={denied} />;
    case 'customers': return <CustomerMasterSection organizationId={organization.id} organizationPermissions={organization.permissions} />;
    case 'materials': return <MaterialMasterPage organizationId={organization.id} organizationPermissions={organization.permissions} />;
    case 'component-projects': return <ComponentProjectAdministration organization={organization} />;
    case 'configuration': return <ConfigurationAdministration organization={organization} />;
    case 'audit-log': return <AuditAdministration organization={organization} target={query.has('resourceId') ? { resourceType: query.get('resourceType')!, resourceId: query.get('resourceId')! } : undefined} />;
    case 'outbox': return <OutboxAdministration organization={organization} />;
    case 'reconfiguration': return <AdministrativeReconfiguration organization={organization} onChanged={changed} onDenied={denied} renderAdditionalActions={(item, onCompleted) => item.kind === 'USER'
      ? <UserForceDelete target={{ id: item.id, organizationId: item.originalOrganizationId, username: item.label, securityVersion: item.version }} canDelete={organization.permissions.includes('account:users:delete')} onRefresh={() => { if (current()) onCompleted(); }} onDenied={denied} onDeleted={() => completed(onCompleted)} />
      : (item.kind === 'ORGANIZATION' || item.kind === 'DEPARTMENT') && <AdministrativeForceDeleteDialog
        path={item.kind === 'ORGANIZATION' ? organizationPath(item.id, '/force-delete') : organizationPath(item.originalOrganizationId, `/departments/${encodeURIComponent(item.id)}/force-delete`)}
        kind={item.kind} target={{ id: item.id, name: item.label, code: '', version: item.version }} scopeKey={JSON.stringify([session, organization.id, [...organization.permissions].sort()])}
        allowed={organization.permissions.includes(item.kind === 'ORGANIZATION' ? 'organization:force-delete' : 'organization:departments:force-delete')} onDenied={denied} onDeleted={() => completed(onCompleted)} />} />;
    case 'problem-reconfiguration': return <AdministrativeProblemReconfiguration organization={organization} onChanged={changed} onDenied={denied} />;
    case 'supplier-accounts': return <AdminSupplierAccounts organization={organization} onDenied={denied} />;
    default: return null;
  }
}
