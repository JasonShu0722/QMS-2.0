import { useEffect, useState } from 'react';
import { useInRouterContext, useLocation, type Location } from 'react-router-dom';
import { Alert, Select, Spin, Tabs, Typography } from 'antd';
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
  const targeting = !targetConsumed && ['organizationId', 'section', 'userId'].some((key) => query.has(key));
  const organizationId = query.get('organizationId') ?? '';
  const userId = query.get('userId') ?? '';
  const validTarget = ['organizationId', 'section', 'userId'].every((key) => query.getAll(key).length === 1)
    && query.get('section') === 'users' && uuid.test(organizationId) && uuid.test(userId);
  const organization = targeting
    ? organizations?.find((entry) => entry.id.toLowerCase() === organizationId.toLowerCase())
    : organizations?.find((entry) => entry.id === selectedId) ?? organizations?.find((entry) => entry.type === 'INTERNAL') ?? organizations?.[0];
  const targetUserId = targeting && validTarget ? userId.toLowerCase() : undefined;
  function changeScope(action: () => void) {
    requestLeave(action);
  }

  useEffect(() => {
    if (location?.pathname !== acceptedLocation?.pathname || location?.search !== acceptedLocation?.search) {
      setSelectedId(undefined);
      setTargetConsumed(false);
      setActiveTab('users');
      setAcceptedLocation(location);
    }
  }, [location, acceptedLocation]);

  if (error) return <Alert type="error" title={t(error)} description={traceId ? <code>{traceId}</code> : undefined} role="alert" showIcon />;
  if (!organizations) return <Spin tip={t('加载系统管理权限')} />;
  if (targeting && (!validTarget || !organization || !allows(organization, 'users:read'))) return <Alert type="error" title={t('账号定位失败：链接无效或无权查看目标组织账号。')} role="alert" showIcon />;
  if (!organization) return <Alert type="warning" title={t('无系统管理访问权限')} showIcon />;
  const users = allows(organization, 'users:read') || allows(organization, 'users:create');
  const roles = allows(organization, 'roles:read');
  const customerMaster = organization.permissions.some((code) => ['customer-quality:complaints:read', 'customer-quality:complaints:write'].includes(code));
  const additionalTabs = [
    ...(organization.type === 'INTERNAL' && organization.permissions.some((code) => ['component-project:read', 'component-project:manage'].includes(code)) ? [{ key: 'component-project', label: t('组件项目映射'), children: <ComponentProjectAdministration organization={organization} /> }] : []),
    ...(organization.type === 'INTERNAL' && organization.permissions.some((code) => ['supplier-quality:profiles:read', 'supplier-quality:profiles:write'].includes(code)) ? [{ key: 'supplier-master', label: t('供应商清单'), children: <SupplierProfilesPage organizationId={organization.id} organizationPermissions={organization.permissions} /> }] : []),
    ...(customerMaster ? [{ key: 'customer-master', label: t('客户清单'), children: <CustomerMasterSection organizationId={organization.id} organizationPermissions={organization.permissions} /> }] : []),
    ...(organization.type === 'INTERNAL' && organization.permissions.some((code) => ['material-master:read', 'material-master:write', 'material-master:import'].includes(code)) ? [{ key: 'material-master', label: t('物料清单'), children: <MaterialMasterPage organizationId={organization.id} organizationPermissions={organization.permissions} /> }] : []),
    ...(organization.permissions.some((code) => ['organization:read', 'organization:structure:read'].includes(code)) ? [{ key: 'organizations', label: t('组织与岗位'), children: <OrganizationWorkspace organization={organization} organizations={organizations} onChanged={onDirectoryChange} onSelectOrganization={(id) => { setSelectedId(id); setTargetConsumed(true); }} /> }] : []),
    ...(organization.permissions.includes('configuration:read') ? [{ key: 'configuration', label: t('平台配置'), children: <ConfigurationAdministration organization={organization} /> }] : []),
    ...(organization.permissions.includes('audit:read') ? [{ key: 'audit-log', label: t('管理审计'), children: <AuditAdministration organization={organization} /> }] : []),
    ...(organization.permissions.includes('outbox:read') ? [{ key: 'failures', label: t('失败队列'), children: <OutboxAdministration organization={organization} /> }] : []),
  ];
  const activeTabAllowed = (activeTab === 'users' && users) || (activeTab === 'roles' && roles) || additionalTabs.some((entry) => entry.key === activeTab);
  return <section className="admin-page">
      <header className="admin-heading"><Typography.Title level={2}>{t('平台管理')}</Typography.Title>
      <label>{t('管理组织')}<Select aria-label={t('管理组织')} value={organization.id} onChange={(id) => { if (id !== organization.id) changeScope(() => { setSelectedId(id); setTargetConsumed(true); }); }} options={organizations.map((entry) => ({ value: entry.id, label: `${entry.name} · ${entry.code}` }))} /></label>
    </header>
    <Tabs destroyOnHidden key={`${organization.id}:${targetUserId ?? ''}`} activeKey={activeTabAllowed ? activeTab : users ? 'users' : roles ? 'roles' : additionalTabs[0]?.key} onChange={(key) => changeScope(() => setActiveTab(key))} items={[
      ...(users ? [{ key: 'users', label: t('用户'), children: <UserAdministration organization={organization} organizations={organizations} targetUserId={targetUserId} /> }] : []),
      ...(roles ? [{ key: 'roles', label: t('历史授权'), children: <RoleAdministration organization={organization} readOnly /> }] : []),
      ...additionalTabs,
    ]} />
  </section>;
}
