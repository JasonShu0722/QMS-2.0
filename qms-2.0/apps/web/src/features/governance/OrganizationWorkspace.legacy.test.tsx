import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import type { components } from '@qms/contracts';
import type { AdminOrganization } from '../admin/admin';
import { OrganizationWorkspace } from './OrganizationWorkspace';
import { PositionRolesDrawer } from './PositionRolesDrawer';

const organization: AdminOrganization = { id: 'org', code: 'ORG', name: '组织', type: 'INTERNAL', permissions: ['account:roles:read'] };
const role: components['schemas']['AdminRoleDto'] = { id: 'legacy', code: 'OLD', name: '受限旧角色', organizationId: 'org', permissions: [], mfaRequired: true };
const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
afterEach(() => vi.unstubAllGlobals());

it('preserves roles-read-only definitions inside the organization root without reading structure, full sources, or commands', async () => {
  const fetcher = vi.fn(async (path: string) => json(path.includes('/admin/roles?') ? [role] : [])); vi.stubGlobal('fetch', fetcher);
  render(<MemoryRouter><OrganizationWorkspace organization={organization} organizations={[organization]} onSelectOrganization={vi.fn()} /></MemoryRouter>);
  expect(await screen.findByText('受限旧角色')).toBeVisible(); expect(screen.getByRole('button', { name: '组织 · 组织' })).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: '受限旧角色 · 详情' })); expect(await screen.findByRole('dialog')).toBeVisible();
  expect(screen.queryByRole('button', { name: '创建角色' })).not.toBeInTheDocument(); expect(screen.queryByRole('button', { name: '删除角色' })).not.toBeInTheDocument();
  expect(fetcher.mock.calls.some(([path]) => /legacy-authorizations|authorization-sources|\/positions|\/departments/.test(path))).toBe(false);
});

it('shows the controlled legacy entry at the organization root only for the full source-read permission intersection', async () => {
  const org = { ...organization, permissions: ['account:roles:read', 'organization:structure:read', 'account:users:read'] };
  const fetcher = vi.fn(async (path: string) => json(path.includes('/legacy-authorizations') ? [] : [])); vi.stubGlobal('fetch', fetcher);
  render(<MemoryRouter><OrganizationWorkspace organization={org} organizations={[org]} onSelectOrganization={vi.fn()} /></MemoryRouter>);
  expect(await screen.findByRole('heading', { name: '兼容授权迁移/清理' })).toBeVisible();
  await waitFor(() => expect(fetcher.mock.calls.some(([path]) => path === '/api/v1/organizations/org/legacy-authorizations')).toBe(true));
});

it('offers the same real read-only sources inside position details without requiring position-write permission', async () => {
  const org = { ...organization, permissions: ['account:roles:read', 'organization:structure:read', 'account:users:read'] };
  const fetcher = vi.fn(async (path: string) => json(path.includes('authorization-sources') ? { currentSources: { items: [], total: 0, offset: 0, pageSize: 20 }, history: { items: [], total: 0, offset: 0, pageSize: 20 }, labels: { users: [], positions: [], organizations: [] } } : path.endsWith('/permissions') ? { positionId: 'position', roleVersion: 1, permissionCodes: [], mfaRequired: false, legacyRoles: [], effectiveAssigneeCount: 0 } : [])); vi.stubGlobal('fetch', fetcher);
  render(<MemoryRouter><PositionRolesDrawer organization={org} position={{ id: 'position', organizationId: 'org', departmentId: null, categoryId: null, code: 'ADMIN', name: '直属岗', status: 'ACTIVE', version: 1 }} canWrite={false} onClose={vi.fn()} afterClose={vi.fn()} /></MemoryRouter>);
  fireEvent.click(await screen.findByRole('button', { name: '查看授权来源' }));
  expect(await screen.findByText('暂无授权来源')).toBeVisible();
  expect(fetcher.mock.calls.some(([path]) => path === '/api/v1/organizations/org/authorization-sources?positionId=position&pageSize=20&offset=0')).toBe(true);
  expect(screen.queryByRole('button', { name: '保存' })).not.toBeInTheDocument();
});
