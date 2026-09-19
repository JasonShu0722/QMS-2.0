import { useState } from 'react';
import { Alert, Modal, Select, Spin, Tabs, Typography } from 'antd';
import { allows, type AdminOrganization } from './admin';
import { UserAdministration } from './UserAdministration';
import { RoleAdministration } from './RoleAdministration';
import { PermissionMatrix } from './PermissionMatrix';

export function AdminPage({ organizations, error }: { organizations: AdminOrganization[] | null; error?: string }) {
  const [selectedId, setSelectedId] = useState<string>();
  const [matrixDirty, setMatrixDirty] = useState(false);
  const [matrixBusy, setMatrixBusy] = useState(false);
  const [pendingOrganization, setPendingOrganization] = useState<string>();
  const [activeTab, setActiveTab] = useState<string>();
  const organization = organizations?.find((entry) => entry.id === selectedId) ?? organizations?.find((entry) => entry.type === 'INTERNAL') ?? organizations?.[0];
  if (error) return <Alert type="error" title={error} showIcon />;
  if (!organizations) return <Spin tip="加载系统管理权限" />;
  if (!organization) return <Alert type="warning" title="无系统管理访问权限" showIcon />;
  const users = allows(organization, 'users:read') || allows(organization, 'users:create');
  const roles = allows(organization, 'roles:read');
  const activeTabAllowed = (activeTab === 'users' && users) || ((activeTab === 'roles' || activeTab === 'matrix') && roles);
  return <section className="admin-page">
    <header className="admin-heading"><Typography.Title level={2}>系统管理</Typography.Title>
      <label>管理组织<Select aria-label="管理组织" value={organization.id} disabled={matrixBusy} onChange={(id) => { if (id !== organization.id) { if (matrixDirty) setPendingOrganization(id); else setSelectedId(id); } }} options={organizations.map((entry) => ({ value: entry.id, label: `${entry.name} · ${entry.code}` }))} /></label>
    </header>
    <Tabs key={organization.id} activeKey={activeTabAllowed ? activeTab : users ? 'users' : 'roles'} onChange={setActiveTab} items={[
      ...(users ? [{ key: 'users', label: '用户', children: <UserAdministration organization={organization} organizations={organizations} /> }] : []),
      ...(roles ? [{ key: 'roles', label: '角色', children: <RoleAdministration organization={organization} /> }, { key: 'matrix', label: '权限矩阵', children: <PermissionMatrix organization={organization} onDirtyChange={setMatrixDirty} onBusyChange={setMatrixBusy} /> }] : []),
    ]} />
    <Modal title="放弃未保存的权限修改？" open={!!pendingOrganization} okText="放弃修改" cancelText="继续编辑" onCancel={() => setPendingOrganization(undefined)} onOk={() => { setMatrixDirty(false); setSelectedId(pendingOrganization); setPendingOrganization(undefined); }}>
      当前草稿尚未保存，切换组织将放弃修改。
    </Modal>
  </section>;
}
