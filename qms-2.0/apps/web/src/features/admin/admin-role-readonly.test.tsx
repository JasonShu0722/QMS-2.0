import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { AdminPage } from './AdminPage';
import type { AdminOrganization, AdminRole } from './admin';

afterEach(() => vi.unstubAllGlobals());

it('exposes historical authorization as read-only and removes the independent permission matrix entry', async () => {
  const organization: AdminOrganization = { id: 'org-a', name: '组织', code: 'ORG', type: 'INTERNAL', permissions: ['account:roles:read', 'account:roles:create', 'account:roles:update', 'account:roles:delete'] };
  const role: AdminRole = { id: 'legacy', organizationId: organization.id, code: 'LEGACY', name: '旧授权', mfaRequired: false, permissions: [] };
  const fetchMock = vi.fn((path: string) => Promise.resolve(new Response(JSON.stringify(path.includes('permission-catalog') ? [] : [role]), { status: 200, headers: { 'content-type': 'application/json' } })));
  vi.stubGlobal('fetch', fetchMock);
  render(<AdminPage organizations={[organization]} />);
  await screen.findByText('旧授权');
  expect(screen.getByRole('tab', { name: '历史授权' })).toBeInTheDocument();
  expect(screen.queryByRole('tab', { name: '权限矩阵' })).not.toBeInTheDocument();
  for (const name of ['创建角色', '复制模板', '编辑角色', '删除角色']) expect(screen.queryByRole('button', { name })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '旧授权 · 详情' }));
  await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());
  expect(fetchMock.mock.calls.every(([, init]: unknown[]) => !init || !['POST', 'PUT', 'PATCH', 'DELETE'].includes((init as RequestInit).method ?? ''))).toBe(true);
});
