import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ConfigProvider } from 'antd';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { components } from '@qms/contracts';
import { ApiError } from '../../api/client';
import { ConsoleManagementPage } from '../../console/ConsoleManagementPage';
import type { ConsoleContext } from '../../console/console-navigation';
import { UnsavedChangesProvider } from '../../layouts/UnsavedChanges';
import { useWorkTabsStore } from '../../work-tabs/workTabsStore';
import { UserAdministration } from '../admin/UserAdministration';
import { openUserManagement } from '../admin/user-management-test-helpers';
import type { AdminOrganization, AdminUser } from '../admin/admin';
import { StructureAdministration } from './StructureAdministration';

const consoleState = vi.hoisted(() => ({ context: {} as ConsoleContext, refresh: vi.fn(), invalidate: vi.fn() }));
vi.mock('../../console/ConsoleLayout', () => ({ useConsoleContext: () => consoleState }));
// The real structure owner must forward the callback; source clearing belongs to the drawer's own tests.
vi.mock('./PositionRolesDrawer', () => ({ PositionRolesDrawer: ({ onDenied }: { onDenied?: (error: ApiError) => void }) =>
  <button onClick={() => onDenied?.(new ApiError({ code: 'DENIED', message: 'denied' }, 403))}>deny drawer source</button> }));

const organizationId = '11111111-1111-4111-8111-111111111111';
const userId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const reads = ['account:roles:read', 'organization:structure:read', 'account:users:read'];
const organization: AdminOrganization = { id: organizationId, code: 'ORG', name: '组织', type: 'INTERNAL', permissions: reads };
const user: AdminUser = { id: userId, username: 'entry-user', fullName: null, phone: null, email: null, emailVerifiedAt: null, securityVersion: 1, profileVersion: 1, accountType: 'INTERNAL', status: 'ACTIVE', mfaEnabled: false, organizationId, organization: { id: organizationId, code: 'ORG', name: '组织' }, createdAt: '', updatedAt: '' };
const role: components['schemas']['LegacyAuthorizationRoleDto'] = { id: 'legacy', organizationId, code: 'OLD', name: '敏感来源角色', mfaRequired: true, permissionCodes: ['organization:read'], platformMarker: false };
const sources: components['schemas']['LegacyAuthorizationSourcesDto'] = {
  currentSources: { items: [{ kind: 'LEGACY_DIRECT', active: true, temporalState: 'CURRENT', organizationId, userId, positionId: null, assignmentId: null, startedAt: null, endedAt: null, role }], total: 21, offset: 0, pageSize: 20 },
  history: { items: [], total: 0, offset: 0, pageSize: 20 }, labels: { users: [], positions: [], organizations: [] },
};
const legacyRoles: components['schemas']['AdminUserRolesDto'] = { userId, organizationId, roles: [], effectiveRoles: [{ id: 'legacy', organizationId, code: 'OLD', name: '原只读角色', mfaRequired: false, permissions: [], sources: [{ kind: 'DIRECT' }] }], permissions: [] };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
function server(org = organization, account = user, override?: (path: string, init?: RequestInit) => Response | Promise<Response> | undefined) {
  const fetcher = vi.fn(async (path: string, init?: RequestInit): Promise<Response> => {
    const custom = override?.(path, init); if (custom) return custom;
    if (path.endsWith('/csrf')) return json({ csrfToken: 'csrf' });
    if (path.includes('/authorization-sources?')) return json(sources);
    if (path.includes(`/users/${userId}/roles?`)) return json(legacyRoles);
    if (path.includes(`/users/${userId}?`)) return json(account);
    if (path.startsWith('/api/v1/admin/users?')) return json([account]);
    if (path === '/api/v1/admin/organizations') return json([org]);
    if (path.startsWith('/api/v1/admin/organizations/context?')) return json({ hasPlatformAdministrator: false, homeOrganizationId: org.id, targetOrganizationId: org.id, accessKind: 'ORGANIZATION', targetOrganizationStatus: 'ACTIVE', targetConfigurationRequired: false, permissions: org.permissions, authorizationSources: [] });
    if (path.startsWith('/api/v1/admin/roles?')) return json([{ id: 'legacy', organizationId: org.id, code: 'OLD', name: '原只读角色', permissions: [], mfaRequired: false }]);
    return json([]);
  });
  vi.stubGlobal('fetch', fetcher); return fetcher;
}
function usersScene(org = organization, target = false, onDenied = vi.fn()) {
  return <ConfigProvider theme={{ token: { motion: false } }}><MemoryRouter><UnsavedChangesProvider><UserAdministration organization={org} organizations={[org]} targetUserId={target ? userId : undefined} onDenied={onDenied} /></UnsavedChangesProvider></MemoryRouter></ConfigProvider>;
}
const sourceCalls = (fetcher: ReturnType<typeof server>) => fetcher.mock.calls.filter(([path]) => path.includes('/authorization-sources?'));
const writeCalls = (fetcher: ReturnType<typeof server>) => fetcher.mock.calls.filter(([, init]) => init?.method && init.method !== 'GET');
function sourceButton(manager: ReturnType<typeof within>) {
  const button = manager.getByText('查看授权来源', { selector: 'button > span' }).closest('button')!;
  expect(button).toHaveAccessibleName('查看授权来源');
  return button;
}
async function sourceDialog() {
  const dialog = await screen.findByLabelText('entry-user · 授权来源', { selector: '[role="dialog"]' });
  await waitFor(() => expect(dialog).toBeVisible());
  return dialog;
}
beforeEach(() => { useWorkTabsStore.getState().reset(); useWorkTabsStore.getState().bindSession(`INTERNAL:${organizationId}:actor`); document.documentElement.lang = 'zh-CN'; vi.clearAllMocks(); });
afterEach(() => { vi.unstubAllGlobals(); useWorkTabsStore.getState().reset(); });

it.each([false, true])('opens the shared sources read model from the real internal user %s entry without old role reads or writes', async target => {
  const fetcher = server(); render(usersScene(organization, target));
  const entry = target ? within(await screen.findByRole('region', { name: '目标账号' })) : within((await screen.findByText('entry-user')).closest('tr')!);
  const manager = await openUserManagement('任职与授权', entry.getByText('管理用户', { selector: 'button > span' }).closest('button')!);
  fireEvent.click(sourceButton(manager));
  const element = await sourceDialog(); const dialog = within(element);
  await waitFor(() => expect(dialog.getByText(/敏感来源角色/)).toBeVisible()); expect(dialog.getByText('兼容直接授权')).toBeVisible();
  expect(sourceCalls(fetcher).map(([path]) => path)).toEqual([`/api/v1/organizations/${organizationId}/authorization-sources?userId=${userId}&pageSize=20&offset=0`]);
  expect(fetcher.mock.calls.some(([path]) => path.includes(`/users/${userId}/roles?`))).toBe(false);
  fireEvent.click(dialog.getByLabelText('Close', { selector: 'button' }));
  await waitFor(() => expect(element).not.toBeInTheDocument()); expect(writeCalls(fetcher)).toEqual([]);
});

it.each(['limited internal', 'supplier', 'supplier account'] as const)('retains the original legal read-only roles entry for %s rather than requiring the new source intersection', async kind => {
  const org: AdminOrganization = kind === 'supplier' ? { ...organization, type: 'SUPPLIER' } : { ...organization, permissions: ['account:users:read', 'account:roles:read'] };
  if (kind === 'supplier account') org.permissions = reads;
  const account: AdminUser = { ...user, accountType: kind === 'supplier account' ? 'SUPPLIER' : org.type };
  const fetcher = server(org, account); render(usersScene(org));
  const manager = await openUserManagement('任职与授权');
  fireEvent.click(sourceButton(manager));
  const dialog = within(await sourceDialog());
  await waitFor(() => expect(dialog.getByText('原只读角色')).toBeVisible()); expect(dialog.queryByRole('combobox')).not.toBeInTheDocument();
  expect(dialog.queryByRole('button', { name: '保存角色分配' })).not.toBeInTheDocument(); expect(sourceCalls(fetcher)).toEqual([]); expect(writeCalls(fetcher)).toEqual([]);
});

it.each([401, 403])('clears the real user source modal and sensitive parent content and bubbles a current %s', async status => {
  const denied = vi.fn(); server(organization, user, path => path.includes('/authorization-sources?') && path.endsWith('offset=20') ? json({ code: 'DENIED', message: 'denied' }, status) : undefined);
  render(usersScene(organization, false, denied)); const manager = await openUserManagement('任职与授权'); fireEvent.click(sourceButton(manager));
  const element = await sourceDialog(); const dialog = within(element);
  await dialog.findByText(/敏感来源角色/);
  const next = dialog.getByLabelText('当前来源下一页', { selector: 'button' });
  expect(next).toBeEnabled(); fireEvent.click(next);
  await waitFor(() => expect(denied).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ status })));
  await waitFor(() => expect(screen.queryByText(/敏感来源角色/)).not.toBeInTheDocument());
  expect(element).not.toBeInTheDocument();
  expect(screen.queryByText('entry-user')).not.toBeInTheDocument(); expect(screen.queryByText('entry-user · 授权来源')).not.toBeInTheDocument();
});

it.each(['organization', 'permissions', 'session'] as const)('retires a pending user source modal on %s change and ignores its late response', async change => {
  let resolve!: (value: Response) => void; let signal: AbortSignal | null | undefined;
  const fetcher = server(organization, user, (path, init) => path.includes('/authorization-sources?') ? (signal = init?.signal, new Promise<Response>(done => { resolve = done; })) : undefined);
  const view = render(usersScene());
  const row = within((await screen.findByText('entry-user')).closest('tr')!);
  const manager = await openUserManagement('任职与授权', row.getByText('管理用户', { selector: 'button > span' }).closest('button')!);
  fireEvent.click(sourceButton(manager));
  await waitFor(() => expect(sourceCalls(fetcher)).toHaveLength(1));
  if (change === 'session') act(() => useWorkTabsStore.getState().bindSession(`INTERNAL:${organizationId}:other`));
  else view.rerender(usersScene(change === 'organization' ? { ...organization, id: '22222222-2222-4222-8222-222222222222' } : { ...organization, permissions: ['account:users:read', 'account:roles:read'] }));
  await waitFor(() => expect(signal?.aborted).toBe(true)); await act(async () => resolve(json(sources)));
  expect(screen.queryByText(/敏感来源角色/)).not.toBeInTheDocument(); expect(screen.queryByRole('dialog', { name: 'entry-user · 授权来源' })).not.toBeInTheDocument();
});

it('does not use the new source modal to bypass an unsaved user editor', async () => {
  const org = { ...organization, permissions: [...reads, 'account:users:update'] }; const fetcher = server(org); render(usersScene(org));
  const editor = await openUserManagement(); const sourceTab = editor.getByText('任职与授权', { selector: '[role="tab"]' });
  const nameInput = editor.getByLabelText('姓名'); fireEvent.change(nameInput, { target: { value: '未保存姓名' } });
  fireEvent.click(sourceTab);
  const guardDialog = await screen.findByLabelText('当前草稿尚未保存，继续将放弃修改。', { selector: '[role="dialog"]' });
  const guard = within(guardDialog); await waitFor(() => expect(guardDialog).toBeVisible()); expect(sourceCalls(fetcher)).toEqual([]);
  fireEvent.click(guard.getByText('继续编辑', { selector: 'button > span' }).closest('button')!); expect(nameInput).toBeInTheDocument(); expect(nameInput).toHaveValue('未保存姓名'); expect(sourceCalls(fetcher)).toEqual([]);
  fireEvent.click(sourceTab);
  const discardElement = await screen.findByLabelText('当前草稿尚未保存，继续将放弃修改。', { selector: '[role="dialog"]' });
  await waitFor(() => expect(discardElement).toBeVisible());
  fireEvent.click(within(discardElement).getByText('放弃修改', { selector: 'button > span' }).closest('button')!);
  await waitFor(() => expect(sourceTab).toHaveAttribute('aria-selected', 'true'));
  expect(nameInput).not.toBeInTheDocument();
  fireEvent.click(sourceButton(editor));
  const element = await sourceDialog(); const dialog = within(element);
  await waitFor(() => expect(dialog.getByText(/敏感来源角色/)).toBeVisible());
  fireEvent.click(dialog.getByLabelText('Close', { selector: 'button' }));
  await waitFor(() => expect(element).not.toBeInTheDocument());
  const profileTab = editor.getByText('基本资料', { selector: '[role="tab"]' });
  fireEvent.click(profileTab);
  expect(profileTab).toHaveAttribute('aria-selected', 'true');
  const restoredName = editor.getByLabelText('姓名');
  expect(restoredName).toBeInTheDocument(); expect(restoredName).not.toBe(nameInput); expect(restoredName).toHaveValue(user.fullName ?? ''); expect(writeCalls(fetcher)).toEqual([]);
});

it('forwards a position source denial through the real structure owner to its management parent', async () => {
  const denied = vi.fn(); server(organization, user, path => path.includes('/positions?') ? json([{ id: 'position', organizationId, departmentId: null, categoryId: null, code: 'ADMIN', name: '直属岗', status: 'ACTIVE', version: 1 }]) : undefined);
  render(<ConfigProvider theme={{ token: { motion: false } }}><MemoryRouter><StructureAdministration organization={organization} onDenied={denied} workspace={{ departments: [], onRefresh: vi.fn(), onChanged: vi.fn() }} /></MemoryRouter></ConfigProvider>);
  fireEvent.click(screen.getByRole('tab', { name: '岗位' }));
  const row = within((await screen.findByText('直属岗')).closest('tr')!);
  fireEvent.click(row.getByRole('button', { name: '岗位权限' }));
  const denial = screen.getByText('deny drawer source', { selector: 'button' });
  expect(denial).toHaveAccessibleName('deny drawer source');
  fireEvent.click(denial);
  expect(denied).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ status: 403 }));
});

it.each([false, true])('permits the real console organizations dispatcher for %s full-source visibility without widening read permissions', async full => {
  const org = { ...organization, permissions: full ? reads : ['account:roles:read'] }; const fetcher = server(org);
  const metadata = { id: organizationId, code: 'ORG', name: '组织', type: 'INTERNAL', status: 'ACTIVE', configurationRequired: false } as const;
  consoleState.context = { actor: { id: 'actor', accountType: 'INTERNAL', homeOrganization: metadata }, organizations: [metadata], targetOrganization: metadata, hasPlatformAdministrator: false, modules: [{ key: 'organizations', scope: 'TARGET', coverage: 'ORGANIZATION', organizationId, permissions: org.permissions }] };
  render(<ConfigProvider theme={{ token: { motion: false } }}><MemoryRouter initialEntries={['/console/organizations']}><UnsavedChangesProvider><ConsoleManagementPage /></UnsavedChangesProvider></MemoryRouter></ConfigProvider>);
  if (full) expect(await screen.findByRole('heading', { name: '兼容授权迁移/清理' })).toBeVisible();
  else {
    expect(await screen.findByText('原只读角色')).toBeVisible(); fireEvent.click(screen.getByRole('button', { name: '原只读角色 · 详情' })); expect(await screen.findByRole('dialog')).toBeVisible();
    expect(fetcher.mock.calls.some(([path]) => /legacy-authorizations|authorization-sources|\/positions|\/departments/.test(path))).toBe(false);
  }
  expect(screen.queryByRole('button', { name: '创建角色' })).not.toBeInTheDocument(); expect(screen.queryByRole('button', { name: '删除角色' })).not.toBeInTheDocument(); expect(writeCalls(fetcher)).toEqual([]);
});
