import { useState } from 'react';
import { Alert, Select, Spin, Tabs, Typography } from 'antd';
import { allows, type AdminOrganization } from './admin';
import { UserAdministration } from './UserAdministration';
import { RoleAdministration } from './RoleAdministration';

export function AdminPage({ organizations, error }: { organizations: AdminOrganization[] | null; error?: string }) {
  const [selectedId, setSelectedId] = useState<string>();
  const organization = organizations?.find((entry) => entry.id === selectedId) ?? organizations?.find((entry) => entry.type === 'INTERNAL') ?? organizations?.[0];
  if (error) return <Alert type="error" title={error} showIcon />;
  if (!organizations) return <Spin tip="加载系统管理权限" />;
  if (!organization) return <Alert type="warning" title="无系统管理访问权限" showIcon />;
  const users = allows(organization, 'users:read') || allows(organization, 'users:manage');
  const roles = allows(organization, 'roles:read');
  return <section className="admin-page">
    <header className="admin-heading"><Typography.Title level={2}>系统管理</Typography.Title>
      <label>管理组织<Select aria-label="管理组织" value={organization.id} onChange={setSelectedId} options={organizations.map((entry) => ({ value: entry.id, label: `${entry.name} · ${entry.code}` }))} /></label>
    </header>
    <Tabs key={organization.id} items={[
      ...(users ? [{ key: 'users', label: '用户', children: <UserAdministration organization={organization} organizations={organizations} /> }] : []),
      ...(roles ? [{ key: 'roles', label: '角色', children: <RoleAdministration organization={organization} /> }, { key: 'matrix', label: '权限矩阵', children: <RoleAdministration organization={organization} matrix /> }] : []),
    ]} destroyOnHidden />
  </section>;
}
