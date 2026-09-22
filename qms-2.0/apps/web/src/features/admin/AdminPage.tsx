import { useState } from 'react';
import { Alert, Modal, Select, Spin, Tabs, Typography } from 'antd';
import { allows, type AdminOrganization } from './admin';
import { UserAdministration } from './UserAdministration';
import { RoleAdministration } from './RoleAdministration';
import { PermissionMatrix } from './PermissionMatrix';
import { OrganizationAdministration } from '../governance/OrganizationAdministration';
import { StructureAdministration } from '../governance/StructureAdministration';
import { ConfigurationAdministration } from '../governance/ConfigurationAdministration';
import { AuditAdministration } from '../governance/AuditAdministration';
import { OutboxAdministration } from '../governance/OutboxAdministration';
import { useLanguage } from '../../i18n/Language';

export function AdminPage({ organizations, error, traceId, onDirectoryChange }: { organizations: AdminOrganization[] | null; error?: string; traceId?: string; onDirectoryChange?: () => void }) {
  const { t } = useLanguage();
  const [selectedId, setSelectedId] = useState<string>();
  const [matrixDirty, setMatrixDirty] = useState(false);
  const [matrixBusy, setMatrixBusy] = useState(false);
  const [pendingOrganization, setPendingOrganization] = useState<string>();
  const [activeTab, setActiveTab] = useState<string>();
  const organization = organizations?.find((entry) => entry.id === selectedId) ?? organizations?.find((entry) => entry.type === 'INTERNAL') ?? organizations?.[0];
  if (error) return <Alert type="error" title={t(error)} description={traceId ? <code>{traceId}</code> : undefined} role="alert" showIcon />;
  if (!organizations) return <Spin tip={t('加载系统管理权限')} />;
  if (!organization) return <Alert type="warning" title={t('无系统管理访问权限')} showIcon />;
  const users = allows(organization, 'users:read') || allows(organization, 'users:create');
  const roles = allows(organization, 'roles:read');
  const additionalTabs = [
    ...(organization.permissions.includes('organization:read') ? [{ key: 'organizations', label: t('组织结构'), children: <OrganizationAdministration organization={organization} organizations={organizations} onChanged={onDirectoryChange} /> }] : []),
    ...(organization.permissions.includes('organization:structure:read') ? [{ key: 'structure', label: t('部门岗位'), children: <StructureAdministration organization={organization} /> }] : []),
    ...(organization.permissions.includes('configuration:read') ? [{ key: 'configuration', label: t('平台配置'), children: <ConfigurationAdministration organization={organization} /> }] : []),
    ...(organization.permissions.includes('audit:read') ? [{ key: 'audit-log', label: t('管理审计'), children: <AuditAdministration organization={organization} /> }] : []),
    ...(organization.permissions.includes('outbox:read') ? [{ key: 'failures', label: t('失败队列'), children: <OutboxAdministration organization={organization} /> }] : []),
  ];
  const activeTabAllowed = (activeTab === 'users' && users) || ((activeTab === 'roles' || activeTab === 'matrix') && roles) || additionalTabs.some((entry) => entry.key === activeTab);
  return <section className="admin-page">
    <header className="admin-heading"><Typography.Title level={2}>{t('系统管理')}</Typography.Title>
      <label>{t('管理组织')}<Select aria-label={t('管理组织')} value={organization.id} disabled={matrixBusy} onChange={(id) => { if (id !== organization.id) { if (matrixDirty) setPendingOrganization(id); else setSelectedId(id); } }} options={organizations.map((entry) => ({ value: entry.id, label: `${entry.name} · ${entry.code}` }))} /></label>
    </header>
    <Tabs key={organization.id} activeKey={activeTabAllowed ? activeTab : users ? 'users' : roles ? 'roles' : additionalTabs[0]?.key} onChange={setActiveTab} items={[
      ...(users ? [{ key: 'users', label: t('用户'), children: <UserAdministration organization={organization} organizations={organizations} /> }] : []),
      ...(roles ? [{ key: 'roles', label: t('角色'), children: <RoleAdministration organization={organization} /> }, { key: 'matrix', label: t('权限矩阵'), children: <PermissionMatrix organization={organization} onDirtyChange={setMatrixDirty} onBusyChange={setMatrixBusy} /> }] : []),
      ...additionalTabs,
    ]} />
    <Modal title={t('放弃未保存的权限修改？')} open={!!pendingOrganization} okText={t('放弃修改')} cancelText={t('继续编辑')} onCancel={() => setPendingOrganization(undefined)} onOk={() => { setMatrixDirty(false); setSelectedId(pendingOrganization); setPendingOrganization(undefined); }}>
      {t('当前草稿尚未保存，切换组织将放弃修改。')}
    </Modal>
  </section>;
}
