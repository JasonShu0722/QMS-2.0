import { useEffect, useState } from 'react';
import { useInRouterContext, useLocation, type Location } from 'react-router-dom';
import { Alert, Button, Select, Spin, Tabs, Typography } from 'antd';
import { ApiError } from '../../api/client';
import { useAdminManagementContext } from './useAdminManagementContext';
import { AdministrativeReconfiguration } from '../governance/AdministrativeReconfiguration';
import { AdministrativeForceDeleteDialog } from '../governance/AdministrativeForceDeleteDialog';
import { organizationPath } from '../governance/governance';
import { AdministrativeProblemReconfiguration } from '../governance/AdministrativeProblemReconfiguration';
import { UserForceDelete } from './UserForceDelete';
import { AdminSupplierAccounts } from './AdminSupplierAccounts';
import { allows, type AdminOrganization } from './admin';
import { UserAdministration } from './UserAdministration';
import { RoleAdministration } from './RoleAdministration';
import { OrganizationWorkspace } from '../governance/OrganizationWorkspace';
import { ComponentProjectAdministration } from '../governance/ComponentProjectAdministration';
import { ConfigurationAdministration } from '../governance/ConfigurationAdministration';
import { AuditAdministration } from '../governance/AuditAdministration';
import { OutboxAdministration } from '../governance/OutboxAdministration';
import { useLanguage } from '../../i18n/Language';
import { CustomerMasterSection } from '../customer-quality/CustomerMasterSection';
import { MaterialMasterPage } from '../material-master/MaterialMasterPage';
import { SupplierProfilesPage } from '../supplier-quality/SupplierProfilesPage';
import { useNavigationGuard } from '../../layouts/UnsavedChanges';

type AdminPageProps = { organizations: AdminOrganization[] | null; error?: string; traceId?: string; onDirectoryChange?: () => void };
type AdminLocation = Pick<Location, 'pathname' | 'search' | 'hash'>;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const lifecyclePermissions = new Set(['organization:force-delete', 'organization:departments:force-delete', 'account:users:delete', 'organization:reconfigure']);

export function AdminPage(props: AdminPageProps) {
  return useInRouterContext() ? <RoutedAdminPage {...props} /> : <AdminPageContent {...props} />;
}

function RoutedAdminPage(props: AdminPageProps) {
  const location = useLocation();
  return <AdminPageContent {...props} location={location} />;
}

function AdminPageContent({ organizations, error, traceId, onDirectoryChange, location }: AdminPageProps & { location?: AdminLocation }) {
  const { t } = useLanguage();
  const requestLeave = useNavigationGuard();
  const [selectedId, setSelectedId] = useState<string>();
  const [activeTab, setActiveTab] = useState<string>();
  const [acceptedLocation, setAcceptedLocation] = useState(location);
  const [targetConsumed, setTargetConsumed] = useState(false);
  const query = new URLSearchParams(acceptedLocation?.search);
  const targetKeys = ['organizationId', 'section', 'userId', 'resourceType', 'resourceId'];
  const targeting = !targetConsumed && targetKeys.some((key) => query.has(key));
  const organizationId = query.get('organizationId') ?? '';
  const userId = query.get('userId') ?? '';
  const section = query.get('section');
  const auditTarget = section === 'audit-log';
  const resourceType = query.get('resourceType') ?? '';
  const resourceId = query.get('resourceId') ?? '';
  const resourceTargetValid = !query.has('resourceType') && !query.has('resourceId')
    || resourceType.trim().length > 0 && resourceType.length <= 100 && resourceId.trim().length > 0 && resourceId.length <= 128;
  const validTarget = query.getAll('organizationId').length === 1 && query.getAll('section').length === 1 && uuid.test(organizationId)
    && targetKeys.every(key => query.getAll(key).length <= 1) && [...query.keys()].every(key => targetKeys.includes(key))
    && (auditTarget ? !query.has('userId') && resourceTargetValid
      : section === 'users' && uuid.test(userId) && !query.has('resourceType') && !query.has('resourceId'));
  const selectedOrganization = targeting
    ? organizations?.find((entry) => entry.id.toLowerCase() === organizationId.toLowerCase())
    : organizations?.find((entry) => entry.id === selectedId) ?? organizations?.find((entry) => entry.type === 'INTERNAL') ?? organizations?.[0];
  const management = useAdminManagementContext(selectedOrganization?.id);
  const organization = selectedOrganization && { ...selectedOrganization, permissions: selectedOrganization.permissions.filter(code =>
    (!management.context || management.context.targetOrganizationStatus === 'ACTIVE' && !management.context.targetConfigurationRequired || management.context.permissions.includes(code))
    && (!lifecyclePermissions.has(code) || management.context?.hasPlatformAdministrator && management.context.permissions.includes(code))) };
  const managementDenied = management.error instanceof ApiError && (management.error.status === 401 || management.error.status === 403);
  const targetUserId = targeting && validTarget && !auditTarget ? userId.toLowerCase() : undefined;
  function changeScope(action: () => void) {
    requestLeave(action);
  }

  useEffect(() => {
    if (location?.pathname !== acceptedLocation?.pathname || location?.search !== acceptedLocation?.search) {
      setSelectedId(undefined);
      setTargetConsumed(false);
      setActiveTab(undefined);
      setAcceptedLocation(location);
    }
  }, [location, acceptedLocation]);

  if (error) return <Alert type="error" title={t(error)} description={traceId ? <code>{traceId}</code> : undefined} role="alert" showIcon />;
  if (!organizations) return <Spin tip={t('加载系统管理权限')} />;
  if (targeting && (!validTarget || !organization || !(auditTarget ? organization.permissions.includes('audit:read') : allows(organization, 'users:read')))) return <Alert type="error" title={t(auditTarget ? '审计定位失败：链接无效或无权查看目标组织审计。' : '账号定位失败：链接无效或无权查看目标组织账号。')} role="alert" showIcon />;
  if (!organization) return <Alert type="warning" title={t('无系统管理访问权限')} showIcon />;
  const users = allows(organization, 'users:read') || allows(organization, 'users:create');
  const roles = allows(organization, 'roles:read');
  const customerMaster = organization.permissions.some((code) => ['customer-quality:complaints:read', 'customer-quality:complaints:write'].includes(code));
  const additionalTabs = [
    ...(organization.type === 'INTERNAL' && organization.permissions.some((code) => ['component-project:read', 'component-project:manage'].includes(code)) ? [{ key: 'component-project', label: t('组件项目映射'), children: <ComponentProjectAdministration organization={organization} /> }] : []),
    ...(organization.type === 'INTERNAL' && organization.permissions.some((code) => ['supplier-quality:profiles:read', 'supplier-quality:profiles:write'].includes(code)) ? [{ key: 'supplier-master', label: t('供应商清单'), children: <SupplierProfilesPage organizationId={organization.id} organizationPermissions={organization.permissions} onDenied={management.invalidate} /> }] : []),
    ...(customerMaster ? [{ key: 'customer-master', label: t('客户清单'), children: <CustomerMasterSection organizationId={organization.id} organizationPermissions={organization.permissions} /> }] : []),
    ...(organization.type === 'INTERNAL' && organization.permissions.some((code) => ['material-master:read', 'material-master:write', 'material-master:import'].includes(code)) ? [{ key: 'material-master', label: t('物料清单'), children: <MaterialMasterPage organizationId={organization.id} organizationPermissions={organization.permissions} /> }] : []),
    ...(organization.permissions.some((code) => ['organization:read', 'organization:structure:read', 'account:roles:read'].includes(code)) ? [{ key: 'organizations', label: t('组织与岗位'), children: <OrganizationWorkspace organization={organization} organizations={organizations} onChanged={onDirectoryChange} onDenied={management.invalidate} onSelectOrganization={(id) => { setSelectedId(id); setTargetConsumed(true); }} /> }] : []),
    ...(organization.permissions.includes('configuration:read') ? [{ key: 'configuration', label: t('平台配置'), children: <ConfigurationAdministration organization={organization} /> }] : []),
    ...(organization.permissions.includes('audit:read') ? [{ key: 'audit-log', label: t('管理审计'), children: <AuditAdministration organization={organization} target={targeting && auditTarget && resourceId ? { resourceType, resourceId } : undefined} /> }] : []),
    ...(organization.permissions.includes('outbox:read') ? [{ key: 'failures', label: t('失败队列'), children: <OutboxAdministration organization={organization} /> }] : []),
    ...(organization.permissions.includes('organization:reconfigure') ? [{ key: 'reconfiguration', label: t('待配置'), children: <AdministrativeReconfiguration organization={organization}
      onChanged={onDirectoryChange} onDenied={management.invalidate} renderAdditionalActions={(item, onCompleted) => item.kind === 'USER' ? <UserForceDelete
        target={{ id: item.id, organizationId: item.originalOrganizationId, username: item.label, securityVersion: item.version }}
        canDelete={organization.permissions.includes('account:users:delete')} onRefresh={onCompleted} onDenied={management.invalidate}
        onDeleted={() => { onCompleted(); onDirectoryChange?.(); }} /> : (item.kind === 'ORGANIZATION' || item.kind === 'DEPARTMENT') && <AdministrativeForceDeleteDialog
        path={item.kind === 'ORGANIZATION' ? organizationPath(item.id, '/force-delete') : organizationPath(item.originalOrganizationId, `/departments/${encodeURIComponent(item.id)}/force-delete`)}
        kind={item.kind} target={{ id: item.id, name: item.label, code: '', version: item.version }}
        scopeKey={JSON.stringify([organization.id, [...organization.permissions].sort()])}
        allowed={organization.permissions.includes(item.kind === 'ORGANIZATION' ? 'organization:force-delete' : 'organization:departments:force-delete')}
        onDenied={management.invalidate} onDeleted={() => { onCompleted(); onDirectoryChange?.(); }} />} /> }] : []),
    ...(organization.permissions.includes('organization:reconfigure') ? [{ key: 'problem-reconfiguration', label: t('问题责任恢复'), children: <AdministrativeProblemReconfiguration
      organization={organization} onChanged={onDirectoryChange} onDenied={management.invalidate} /> }] : []),
    ...(organization.permissions.includes('account:users:delete') ? [{ key: 'supplier-accounts', label: t('供应商账号（全平台）'), children: <AdminSupplierAccounts
      organization={organization} onDenied={management.invalidate} /> }] : []),
  ];
  const activeTabAllowed = (activeTab === 'users' && users) || (activeTab === 'roles' && roles) || additionalTabs.some((entry) => entry.key === activeTab);
  return <section className="admin-page">
      <header className="admin-heading"><Typography.Title level={2}>{t('平台管理')}</Typography.Title>
      <label>{t('管理组织')}<Select aria-label={t('管理组织')} value={organization.id} onChange={(id) => { if (id !== organization.id) changeScope(() => { setSelectedId(id); setTargetConsumed(true); }); }} options={organizations.map((entry) => ({ value: entry.id, label: `${entry.name} · ${entry.code}` }))} /></label>
    </header>
    {management.loading ? <Spin tip={t('核实管理身份')} /> : management.context ? <Alert showIcon type="info"
      title={t(management.context.hasPlatformAdministrator ? '平台管理员：全部内部组织' : '组织管理：当前授权范围')}
      description={<>
        <div>{t('当前管理目标')}：{organization.name} · {organization.code}</div>
        {management.context.targetOrganizationStatus === 'DISABLED' && <div>{t('目标组织已停用，仅显示当前可用的治理功能。')}</div>}
      </>} />
      : <Alert showIcon type={managementDenied ? 'error' : 'warning'} title={t(managementDenied ? '管理身份已失效，请刷新权限后重试' : '管理身份暂未核实，强删与补配操作不可用')}
        action={<Button onClick={management.reload}>{t('重新核实')}</Button>} />}
    {!managementDenied && <Tabs destroyOnHidden key={`${organization.id}:${targetUserId ?? ''}`} activeKey={activeTabAllowed ? activeTab : targeting && validTarget ? section! : users ? 'users' : roles ? 'roles' : additionalTabs[0]?.key} onChange={(key) => changeScope(() => setActiveTab(key))} items={[
      ...(users ? [{ key: 'users', label: t('用户'), children: <UserAdministration organization={organization} organizations={organizations} targetUserId={targetUserId} onDenied={management.invalidate} /> }] : []),
      ...(roles ? [{ key: 'roles', label: t('历史授权'), children: <RoleAdministration organization={organization} readOnly /> }] : []),
      ...additionalTabs,
    ]} />}
  </section>;
}
