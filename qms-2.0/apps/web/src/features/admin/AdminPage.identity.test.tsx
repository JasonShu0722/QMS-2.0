import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
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
  fireEvent.click(button);
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

type PendingItem = components['schemas']['AdministrativeReconfigurationItemDto'];
const forcePermissions = ['organization:force-delete', 'organization:departments:force-delete', 'account:users:delete'];
function pendingApi(kind: PendingItem['kind'], permissions = forcePermissions, platform = true, previewStatus = 200) {
  const org = { ...organization, permissions: ['organization:reconfigure', ...permissions] };
  const item: PendingItem = { kind, id: `pending-${kind.toLowerCase()}`, label: `Pending ${kind}`, originalOrganizationId: 'deleted-original', version: 7,
    reason: 'Original parent deleted', requiredConfiguration: kind === 'ORGANIZATION' ? ['parentId'] : ['targetOrganizationId'] };
  const path = kind === 'ORGANIZATION' ? `/api/v1/organizations/${item.id}/force-delete`
    : `/api/v1/organizations/${item.originalOrganizationId}/departments/${item.id}/force-delete`;
  const preview = { kind, id: item.id, name: 'Server target name', code: 'SERVER-CODE', version: 11, previewToken: 'pending-impact-token',
    counts: { users: 2, departments: 3, positions: 4, organizations: 1, assignments: 5, managementBindings: 6, ministerScopes: 7 }, retainedHistory: ['Original history retained'] };
  let deleted = false;
  const onDirectoryChange = vi.fn();
  const fetcher = vi.fn(async (url: string, init: RequestInit = {}) => {
    if (url.includes('/organizations/context?')) return json({ ...context('org-a', platform), permissions: org.permissions });
    if (url.endsWith('/csrf')) return json({ csrfToken: 'csrf' });
    if (url === path) {
      if (init.method === 'POST') { deleted = true; return json({ ...preview, deletedAt: '2026-10-29T00:00:00.000Z', effects: [] }); }
      return json(previewStatus === 200 ? preview : { code: 'FEATURE_PERMISSION_DENIED' }, previewStatus);
    }
    if (url === `/api/v1/admin/users/${item.id}?organizationId=${item.originalOrganizationId}` && init.method === 'DELETE') {
      deleted = true; return json({ userId: item.id, deleted: true, effects: [] });
    }
    if (url.includes('/admin/reconfiguration?')) {
      const items = !deleted && new URL(url, 'http://localhost').searchParams.get('kind') === kind ? [item] : [];
      return json({ items, total: items.length, pageSize: 20, offset: 0 });
    }
    if (url.includes('/organizations/tree?')) return json([]);
    throw new Error(`Unexpected pending request: ${init.method ?? 'GET'} ${url}`);
  });
  vi.stubGlobal('fetch', fetcher);
  return { org, item, path, preview, fetcher, onDirectoryChange };
}
async function pendingRow(kind: PendingItem['kind']) {
  await screen.findByRole('region', { name: '待配置管理' });
  if (kind !== 'ORGANIZATION') {
    fireEvent.mouseDown(screen.getByRole('combobox', { name: '对象类型' }));
    const label = { DEPARTMENT: '部门/科室', POSITION: '岗位', USER: '用户' }[kind];
    fireEvent.click(await screen.findByText(label, { selector: '.ant-select-item-option-content' }));
  }
  return within((await screen.findByText(`Pending ${kind}`)).closest('tr')!);
}

it.each(['ORGANIZATION', 'DEPARTMENT'] as const)('deletes a pending %s through the actual preview and one confirmation without reconfiguration', async kind => {
  const { org, item, path, preview, fetcher, onDirectoryChange } = pendingApi(kind,
    [kind === 'ORGANIZATION' ? 'organization:force-delete' : 'organization:departments:force-delete']);
  render(<MemoryRouter><AdminPage organizations={[org]} onDirectoryChange={onDirectoryChange} /></MemoryRouter>);
  const row = await pendingRow(kind);
  expect(row.getByText(item.originalOrganizationId)).toBeVisible();
  fireEvent.click(row.getByRole('button', { name: '强制删除' }));
  const dialog = within(await screen.findByRole('dialog'));
  await waitFor(() => expect(dialog.getByRole('button', { name: '确认强制删除' })).toBeEnabled());
  await waitFor(() => expect(dialog.getByText('强制删除 · Server target name · SERVER-CODE')).toBeVisible());
  expect(dialog.getByText('Original history retained')).toBeVisible();
  expect(dialog.queryByRole('textbox')).not.toBeInTheDocument();
  expect(fetcher.mock.calls.filter(([url]) => url === path)).toHaveLength(1);
  expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(0);
  fireEvent.click(dialog.getByRole('button', { name: '确认强制删除' }));
  await waitFor(() => expect(onDirectoryChange).toHaveBeenCalledOnce());
  await screen.findByText('暂无待配置对象');
  const writes = fetcher.mock.calls.filter(([, init]) => init?.method && init.method !== 'GET');
  expect(writes).toHaveLength(1);
  expect(writes[0]).toMatchObject([path, { method: 'POST', body: JSON.stringify({ expectedVersion: preview.version, confirmed: true, previewToken: preview.previewToken }),
    headers: { 'x-csrf-token': 'csrf', 'Idempotency-Key': expect.any(String) } }]);
  expect(fetcher.mock.calls.filter(([url]) => url.includes('/admin/reconfiguration?'))).toHaveLength(kind === 'ORGANIZATION' ? 2 : 3);
});

it.each([
  ['ORGANIZATION', []], ['ORGANIZATION', ['organization:departments:force-delete']],
  ['DEPARTMENT', []], ['DEPARTMENT', ['organization:force-delete']],
] as [PendingItem['kind'], string[]][])('does not grant pending %s deletion from unrelated capabilities %j', async (kind, permissions) => {
  const { org, fetcher } = pendingApi(kind, permissions);
  render(page([org]));
  const row = await pendingRow(kind);
  expect(row.getByRole('button', { name: `配置 · Pending ${kind}` })).toBeEnabled();
  expect(row.queryByRole('button', { name: '强制删除' })).not.toBeInTheDocument();
  expect(fetcher.mock.calls.some(([url]) => url.endsWith('/force-delete'))).toBe(false);
});

it.each(['unverified', 'no-marker'] as const)('does not expose pending lifecycle actions for an %s context', async authority => {
  const { org, fetcher } = pendingApi('ORGANIZATION', forcePermissions, false);
  if (authority === 'unverified') fetcher.mockImplementation(async () => json({ code: 'UNAVAILABLE' }, 503));
  render(page([org]));
  await screen.findByText(authority === 'unverified' ? '管理身份暂未核实，强删与补配操作不可用' : '组织管理：当前授权范围');
  expect(screen.queryByRole('tab', { name: '待配置' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '强制删除' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '永久删除用户' })).not.toBeInTheDocument();
});

it('keeps the existing pending USER permanent deletion with its original scope and security version', async () => {
  const { org, item, fetcher, onDirectoryChange } = pendingApi('USER');
  render(<MemoryRouter><AdminPage organizations={[org]} onDirectoryChange={onDirectoryChange} /></MemoryRouter>);
  const row = await pendingRow('USER');
  expect(row.queryByRole('button', { name: '强制删除' })).not.toBeInTheDocument();
  fireEvent.click(row.getByRole('button', { name: '永久删除用户' }));
  const dialog = within(await screen.findByRole('dialog'));
  fireEvent.click(dialog.getByRole('button', { name: '确认永久删除' }));
  await waitFor(() => expect(onDirectoryChange).toHaveBeenCalledOnce());
  await screen.findByText('暂无待配置对象');
  const writes = fetcher.mock.calls.filter(([, init]) => init?.method && init.method !== 'GET');
  expect(writes).toHaveLength(1);
  expect(writes[0]).toMatchObject([`/api/v1/admin/users/${item.id}?organizationId=${item.originalOrganizationId}`,
    { method: 'DELETE', body: JSON.stringify({ expectedSecurityVersion: item.version }) }]);
});

it('does not add deletion to pending POSITION even with all force permissions', async () => {
  const { org } = pendingApi('POSITION');
  render(page([org]));
  const row = await pendingRow('POSITION');
  expect(row.queryByRole('button', { name: '强制删除' })).not.toBeInTheDocument();
  expect(row.queryByRole('button', { name: '永久删除用户' })).not.toBeInTheDocument();
});

it.each([401, 403])('clears the parent pending projection after force preview denial %s', async status => {
  const { org } = pendingApi('ORGANIZATION', forcePermissions, true, status);
  render(page([org]));
  const row = await pendingRow('ORGANIZATION');
  fireEvent.click(row.getByRole('button', { name: '强制删除' }));
  await waitFor(() => expect(screen.queryByRole('region', { name: '待配置管理' })).not.toBeInTheDocument());
  if (status === 403) expect(await screen.findByText('管理身份已失效，请刷新权限后重试')).toBeVisible();
  else expect(useWorkTabsStore.getState().sessionScope).toBeUndefined();
  expect(screen.queryByText('Pending ORGANIZATION')).not.toBeInTheDocument();
});

it.each(['session', 'scope'] as const)('retires a pending force preview after a %s change without accepting its late response', async change => {
  const { org, path, preview, fetcher } = pendingApi('ORGANIZATION');
  const original = fetcher.getMockImplementation()!;
  let finish!: (response: Response) => void;
  let signal: AbortSignal | null | undefined;
  fetcher.mockImplementation((url, init) => {
    if (url === path) { signal = init?.signal; return new Promise<Response>(resolve => { finish = resolve; }); }
    if (url.includes('/organizations/context?organizationId=org-b')) return Promise.resolve(json({ ...context('org-b', true), permissions: org.permissions }));
    return original(url, init);
  });
  render(page([org, { ...org, id: 'org-b', name: '组织 B', code: 'B' }]));
  const row = await pendingRow('ORGANIZATION');
  fireEvent.click(row.getByRole('button', { name: '强制删除' }));
  await waitFor(() => expect(finish).toBeTypeOf('function'));
  await waitFor(() => expect(within(screen.getByRole('dialog')).getByText('强制删除 · Pending ORGANIZATION ·')).toBeVisible());
  if (change === 'session') {
    act(() => { useWorkTabsStore.getState().bindSession('INTERNAL:other:home'); useWorkTabsStore.getState().bindSession(principal); });
  } else {
    fireEvent.mouseDown(screen.getByRole('combobox', { name: '管理组织' }));
    fireEvent.click(await screen.findByText('组织 B · B', { selector: '.ant-select-item-option-content' }));
    await screen.findByText('当前管理目标：组织 B · B');
  }
  await act(async () => { finish(json(preview)); });
  expect(signal?.aborted).toBe(true);
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(fetcher.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
});
