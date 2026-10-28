import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { components } from '@qms/contracts';
import { AdminPage } from './AdminPage';
import type { AdminOrganization } from './admin';
import { useWorkTabsStore } from '../../work-tabs/workTabsStore';

const organization: AdminOrganization = { id: 'org-a', code: 'A', name: '组织 A', type: 'INTERNAL', permissions: ['account:users:read', 'account:users:create'] };
type Context = components['schemas']['AdminOrganizationContextDto'];
const context = (id: string, platform: boolean): Context => ({ hasPlatformAdministrator: platform, homeOrganizationId: 'org-a', targetOrganizationId: id,
  accessKind: platform ? 'PLATFORM' : 'ORGANIZATION', targetOrganizationStatus: 'ACTIVE', targetConfigurationRequired: false,
  permissions: organization.permissions, authorizationSources: [] });
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const page = (organizations = [organization]) => <MemoryRouter><AdminPage organizations={organizations} /></MemoryRouter>;
const principal = 'INTERNAL:11111111-1111-4111-8111-111111111111:22222222-2222-4222-8222-222222222222';
beforeEach(() => { localStorage.clear(); useWorkTabsStore.getState().reset(); useWorkTabsStore.getState().bindSession(principal); });
afterEach(() => vi.unstubAllGlobals());

it('shows the actual platform identity and target scope without changing the actor home', async () => {
  const fetcher = vi.fn(async (path: string) => json(path.includes('/organizations/context?') ? context('org-a', true) : []));
  vi.stubGlobal('fetch', fetcher);
  render(page());
  expect(await screen.findByText('平台管理员：全部内部组织')).toBeVisible();
  expect(screen.getByText('当前管理目标：组织 A · A')).toBeVisible();
  expect(fetcher.mock.calls.some(([path]) => path === '/api/v1/admin/organizations/context?organizationId=org-a')).toBe(true);
});

it('distinguishes an ordinary organization administrator without claiming platform authority', async () => {
  vi.stubGlobal('fetch', vi.fn(async (path: string) => json(path.includes('/organizations/context?') ? context('org-a', false) : [])));
  render(page());
  expect(await screen.findByText('组织管理：当前授权范围')).toBeVisible();
  expect(screen.queryByText('平台管理员：全部内部组织')).not.toBeInTheDocument();
});

it('does not let a late old-scope context replace the newly selected organization', async () => {
  let finishA!: (response: Response) => void;
  vi.stubGlobal('fetch', vi.fn((path: string) => path.endsWith('organizationId=org-a') && path.includes('/organizations/context?')
    ? new Promise<Response>(resolve => { finishA = resolve; })
    : Promise.resolve(json(path.includes('/organizations/context?') ? context('org-b', false) : []))));
  render(page([organization, { ...organization, id: 'org-b', code: 'B', name: '组织 B' }]));
  await waitFor(() => expect(finishA).toBeTypeOf('function'));
  fireEvent.mouseDown(screen.getByRole('combobox', { name: '管理组织' }));
  fireEvent.click(await screen.findByText('组织 B · B', { selector: '.ant-select-item-option-content' }));
  expect(await screen.findByText('组织管理：当前授权范围')).toBeVisible();
  finishA(json(context('org-a', true)));
  await waitFor(() => expect(screen.queryByText('平台管理员：全部内部组织')).not.toBeInTheDocument());
  expect(screen.getByText('当前管理目标：组织 B · B')).toBeVisible();
});

it('clears management actions when the current identity context is denied', async () => {
  vi.stubGlobal('fetch', vi.fn(async (path: string) => path.includes('/organizations/context?')
    ? json({ code: 'FEATURE_PERMISSION_DENIED', message: 'Denied' }, 403) : json([])));
  render(page());
  expect(await screen.findByText('管理身份已失效，请刷新权限后重试')).toBeVisible();
  expect(screen.queryByRole('button', { name: '创建用户' })).not.toBeInTheDocument();
});

it('mounts the global pending configuration entry only after actual platform authority is confirmed', async () => {
  const org = { ...organization, permissions: [...organization.permissions, 'organization:reconfigure'] };
  vi.stubGlobal('fetch', vi.fn(async (path: string) => json(path.includes('/organizations/context?')
    ? { ...context('org-a', true), permissions: org.permissions }
    : path.includes('/admin/reconfiguration?') ? { items: [], total: 0, pageSize: 50, offset: 0 } : [])));
  render(page([org]));
  fireEvent.click(await screen.findByRole('tab', { name: '待配置' }));
  expect(await screen.findByRole('region', { name: '待配置管理' })).toBeVisible();
});

it('mounts the separate responsibility recovery view only under verified reconfiguration authority', async () => {
  const org = { ...organization, permissions: [...organization.permissions, 'organization:reconfigure'] };
  vi.stubGlobal('fetch', vi.fn(async (path: string) => json(path.includes('/organizations/context?')
    ? { ...context('org-a', true), permissions: org.permissions }
    : path.includes('/admin/problem-reconfiguration/') ? { items: [], nextOffset: null, pageSize: 20, offset: 0 } : [])));
  render(page([org]));
  fireEvent.click(await screen.findByRole('tab', { name: '问题责任恢复' }));
  expect(await screen.findByRole('region', { name: '问题责任恢复' })).toBeVisible();
});

it.each([401, 403])('unmounts sensitive management projections after a real user-row delete returns %s', async status => {
  const org = { ...organization, permissions: [...organization.permissions, 'account:users:delete'] };
  vi.stubGlobal('fetch', vi.fn(async (path: string, init?: RequestInit) => json(path.includes('/organizations/context?')
    ? { ...context('org-a', true), permissions: org.permissions }
    : path.endsWith('/csrf') ? { csrfToken: 'csrf' }
      : init?.method === 'DELETE' ? { code: 'FEATURE_PERMISSION_DENIED' }
        : [{ id: '33333333-3333-4333-8333-333333333333', organizationId: 'org-a', securityVersion: 3, username: 'sensitive-user', fullName: 'Sensitive Name', email: 'sensitive@example.test', accountType: 'INTERNAL', status: 'ACTIVE', mfaEnabled: false, organization: { id: 'org-a', code: 'A', name: '组织 A' } }], init?.method === 'DELETE' ? status : 200)));
  render(page([org]));
  const button = await screen.findByRole('button', { name: '永久删除用户' });
  await waitFor(() => expect(button).toBeEnabled());
  await userEvent.click(button);
  const dialog = await screen.findByRole('dialog');
  await waitFor(() => expect(dialog).toBeVisible());
  fireEvent.click(within(dialog).getByRole('button', { name: '确认永久删除' }));
  expect(await screen.findByText('管理身份已失效，请刷新权限后重试')).toBeVisible();
  expect(screen.queryByText('sensitive@example.test')).not.toBeInTheDocument();
  expect(screen.queryByRole('tab', { name: '用户' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '创建用户' })).not.toBeInTheDocument();
});

it.each([200, 403])('irreversibly retires a pending context after principal A-B-A even when the old response is %s', async status => {
  let finish!: (response: Response) => void;
  vi.stubGlobal('fetch', vi.fn((path: string) => path.includes('/organizations/context?')
    ? new Promise<Response>(resolve => { finish = resolve; }) : Promise.resolve(json([]))));
  render(page());
  await waitFor(() => expect(finish).toBeTypeOf('function'));
  act(() => { useWorkTabsStore.getState().bindSession('INTERNAL:other:organization'); useWorkTabsStore.getState().bindSession(principal); });
  await act(async () => { finish(json(status === 200 ? context('org-a', true) : { code: 'FEATURE_PERMISSION_DENIED' }, status)); });
  expect(screen.queryByText('平台管理员：全部内部组织')).not.toBeInTheDocument();
  expect(screen.queryByText('管理身份已失效，请刷新权限后重试')).not.toBeInTheDocument();
});

it('does not query or accept a management context while the principal is unbound', async () => {
  useWorkTabsStore.getState().reset();
  const fetcher = vi.fn(async (path: string) => json(path.includes('/organizations/context?') ? context('org-a', true) : []));
  vi.stubGlobal('fetch', fetcher);
  render(page());
  await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
  expect(fetcher.mock.calls.some(([path]) => path.includes('/organizations/context?'))).toBe(false);
  expect(screen.queryByText('平台管理员：全部内部组织')).not.toBeInTheDocument();
});

it('uses the current inactive-scope capability mask instead of stale directory business actions', async () => {
  const org = { ...organization, permissions: [...organization.permissions, 'organization:read', 'organization:manage', 'organization:force-delete'] };
  vi.stubGlobal('fetch', vi.fn(async (path: string) => json(path.includes('/organizations/context?')
    ? { ...context('org-a', true), targetOrganizationStatus: 'DISABLED', permissions: ['organization:read', 'organization:manage', 'organization:force-delete'] } : [])));
  render(page([org]));
  await screen.findByText('平台管理员：全部内部组织');
  await waitFor(() => expect(screen.queryByRole('tab', { name: '用户' })).not.toBeInTheDocument());
  expect(screen.queryByRole('button', { name: '创建用户' })).not.toBeInTheDocument();
  expect(screen.getByRole('tab', { name: '组织与岗位' })).toBeVisible();
});

it('mounts the global supplier lifecycle directory for a verified platform administrator', async () => {
  const org = { ...organization, permissions: [...organization.permissions, 'account:users:delete'] };
  vi.stubGlobal('fetch', vi.fn(async (path: string) => json(path.includes('/organizations/context?')
    ? { ...context('org-a', true), permissions: org.permissions }
    : path.includes('/admin/supplier-accounts?') ? { items: [], total: 0, pageSize: 20, offset: 0 } : [])));
  render(page([org]));
  fireEvent.click(await screen.findByRole('tab', { name: '供应商账号（全平台）' }));
  expect(await screen.findByRole('region', { name: '供应商账号（全平台）' })).toBeVisible();
});
