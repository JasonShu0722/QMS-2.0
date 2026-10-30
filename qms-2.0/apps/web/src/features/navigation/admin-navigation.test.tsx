import { transferableAbortController } from 'node:util';
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { App } from '../../App';
import { ApiError, apiRequest, getSession } from '../../api/client';
import { getAdminOrganizations } from '../admin/admin';
import { useWorkTabsStore } from '../../work-tabs/workTabsStore';
import type { ConsoleContext } from '../../console/console-navigation';

vi.mock('../../api/client', async original => ({ ...await original<typeof import('../../api/client')>(), apiRequest: vi.fn(), getSession: vi.fn() }));
vi.mock('../admin/admin', async original => ({ ...await original<typeof import('../admin/admin')>(), getAdminOrganizations: vi.fn() }));
const id = '11111111-1111-4111-8111-111111111111';
const organization = { id, name: '测试组织', code: 'test', type: 'INTERNAL', status: 'ACTIVE', configurationRequired: false } as const;
function context(allowed: boolean): ConsoleContext {
  return { actor: { id: 'actor', accountType: 'INTERNAL', homeOrganization: organization }, targetOrganization: organization,
    organizations: [organization], hasPlatformAdministrator: false,
    modules: allowed ? [{ key: 'users', scope: 'TARGET', coverage: 'ORGANIZATION', organizationId: id, permissions: ['account:users:read'] }] : [] };
}
beforeEach(() => {
  vi.resetAllMocks(); localStorage.clear(); sessionStorage.clear(); useWorkTabsStore.getState().reset();
  vi.stubGlobal('AbortController', function () { return transferableAbortController(); });
  vi.mocked(getSession).mockResolvedValue({ accountType: 'INTERNAL', landingPath: '/app/workbench', userId: 'actor', organizationId: id });
  vi.mocked(getAdminOrganizations).mockResolvedValue([{ ...organization, permissions: ['account:users:read'] }]);
});
afterEach(() => { vi.unstubAllGlobals(); window.history.replaceState({}, '', '/'); });
function mount() { window.history.replaceState({}, '', `/app/admin?organizationId=${id}&section=users`); render(<App />); }

it('rejects an unauthorized legacy admin URL through the real console gate without exposing a placeholder or user data', async () => {
  vi.mocked(apiRequest).mockResolvedValue(context(false));
  mount();
  expect(await screen.findByText('无权访问此管理模块')).toBeVisible();
  expect(window.location.pathname).toBe('/console/users');
  expect(screen.queryByText(/基础入口已就绪|系统管理上下文/)).not.toBeInTheDocument();
  expect(screen.queryByRole('table')).not.toBeInTheDocument();
  expect(getAdminOrganizations).not.toHaveBeenCalled();
  expect(useWorkTabsStore.getState().tabs).toEqual([]);
});
it('opens the real read-only user list after legacy routing and matching console and management scope verification', async () => {
  vi.mocked(apiRequest).mockImplementation(async path => {
    if (path.startsWith('/api/v1/admin/console/context')) return context(true);
    if (path.startsWith('/api/v1/admin/organizations/context')) return { hasPlatformAdministrator: false, homeOrganizationId: id, targetOrganizationId: id, accessKind: 'ORGANIZATION', targetOrganizationStatus: 'ACTIVE', targetConfigurationRequired: false, permissions: ['account:users:read'], authorizationSources: [] };
    if (path.startsWith('/api/v1/admin/users?')) return [];
    throw new Error(`Unexpected request: ${path}`);
  });
  mount();
  expect(await screen.findByRole('table')).toBeVisible();
  expect(screen.getByRole('heading', { name: '用户与任职' })).toBeVisible();
  expect(screen.queryByRole('button', { name: '创建用户' })).not.toBeInTheDocument();
  expect(screen.queryByRole('tab', { name: /角色|历史授权/ })).not.toBeInTheDocument();
  expect(apiRequest).toHaveBeenCalledWith(expect.stringContaining(`/api/v1/admin/users?organizationId=${id}`));
  expect(useWorkTabsStore.getState().tabs).toEqual([]);
}, 15000);

it.each(['users', 'audit', 'workflow'] as const)('canonicalizes a legacy uppercase organization before the real console request and %s gate', async kind => {
  const canonicalId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const definitionId = '22222222-2222-4222-8222-222222222222';
  const versionId = '33333333-3333-4333-8333-333333333333';
  const target = { ...organization, id: canonicalId };
  const permissions = ['account:users:read', 'audit:read'];
  const verified: ConsoleContext = { ...context(true), actor: { id: 'actor', accountType: 'INTERNAL', homeOrganization: target },
    targetOrganization: target, organizations: [target], modules: [
      { key: 'users', scope: 'TARGET', coverage: 'ORGANIZATION', organizationId: canonicalId, permissions: ['account:users:read'] },
      { key: 'audit', scope: 'TARGET', coverage: 'ORGANIZATION', organizationId: canonicalId, permissions: ['audit:read'] },
      { key: 'workflows', scope: 'SESSION_HOME', coverage: 'ORGANIZATION', organizationId: canonicalId, permissions: ['workflow:manage'] },
    ] };
  vi.mocked(getSession).mockResolvedValue({ accountType: 'INTERNAL', landingPath: '/app/workbench', userId: 'actor', organizationId: canonicalId });
  vi.mocked(getAdminOrganizations).mockResolvedValue([{ ...target, permissions }]);
  vi.mocked(apiRequest).mockImplementation(async path => {
    if (path.startsWith('/api/v1/admin/console/context')) {
      if (new URL(path, 'https://qms.test').searchParams.get('organizationId') !== canonicalId) throw new ApiError({ code: 'ORGANIZATION_SCOPE_DENIED', message: '' }, 403);
      return verified;
    }
    if (path.startsWith('/api/v1/admin/organizations/context')) return { hasPlatformAdministrator: false, homeOrganizationId: canonicalId, targetOrganizationId: canonicalId, accessKind: 'ORGANIZATION', targetOrganizationStatus: 'ACTIVE', targetConfigurationRequired: false, permissions, authorizationSources: [] };
    if (path.startsWith('/api/v1/admin/users?')) return [];
    if (path.startsWith('/api/v1/admin/audit-events?')) return { items: [], total: 0, nextCursor: null };
    if (path === `/api/v1/workflows/${definitionId}/versions/${versionId}`) return { id: definitionId, organizationId: canonicalId, code: 'QA', name: '真实受控流程', description: null, revision: 1,
      version: { id: versionId, workflowDefinitionId: definitionId, version: 1, status: 'DRAFT', publishedAt: null, publishedById: null, changeNote: null, structureSnapshot: { nodes: [], transitions: [] } } };
    if (path.startsWith('/api/v1/workflows/options?')) return { roles: [], users: [], permissions: [] };
    throw new Error(`Unexpected request: ${path}`);
  });
  const legacy = kind === 'workflow' ? `/app/workflow-designer/${definitionId}/${versionId}?organizationId=${canonicalId.toUpperCase()}`
    : `/app/admin?organizationId=${canonicalId.toUpperCase()}&section=${kind === 'users' ? 'users' : 'audit-log'}${kind === 'audit' ? '&resourceType=Organization&resourceId=Exact%3AAbC' : ''}`;
  window.history.replaceState({}, '', legacy);
  render(<App />);
  await waitFor(() => expect(apiRequest).toHaveBeenCalledWith(`/api/v1/admin/console/context?organizationId=${canonicalId}`, expect.anything()));
  expect(new URLSearchParams(window.location.search).get('organizationId')).toBe(canonicalId);
  expect(await screen.findByLabelText('模块资源范围')).toHaveTextContent(organization.name);
  expect(screen.queryByText('管理访问已失效或无权限')).not.toBeInTheDocument();
  if (kind === 'workflow') expect(await screen.findByRole('heading', { name: '真实受控流程' })).toBeVisible();
  else expect(await screen.findByRole('table')).toBeVisible();
  if (kind === 'audit') {
    expect(new URLSearchParams(window.location.search).get('resourceType')).toBe('Organization');
    expect(new URLSearchParams(window.location.search).get('resourceId')).toBe('Exact:AbC');
  }
  expect(useWorkTabsStore.getState().tabs).toEqual([]);
});
