import { fireEvent, render, screen, within, waitFor } from '@testing-library/react';
import baseUserEvent, { PointerEventsCheckLevel } from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { UserAdministration } from './UserAdministration';
import { RoleAdministration } from './RoleAdministration';
import type { AdminOrganization, AdminRole, AdminPermission, AdminUser, PermissionCatalogGroup } from './admin';
import { AdminPage } from './AdminPage';

const userEvent = baseUserEvent.setup({ pointerEventsCheck: PointerEventsCheckLevel.Never });

const organization: AdminOrganization = { id: 'org-a', code: 'a', name: 'Organization A', type: 'INTERNAL', permissions: ['account:users:read', 'account:users:create', 'account:users:update', 'account:users:status', 'account:users:transfer', 'account:users:reset', 'account:roles:read', 'account:roles:create', 'account:roles:update', 'account:roles:delete', 'account:roles:assign'] };
const user: AdminUser = { fullName: null, phone: null, profileVersion: 1, emailVerifiedAt: null, id: 'user', username: 'alice', email: 'alice@example.test', accountType: 'INTERNAL', status: 'ACTIVE', organizationId: organization.id, organization: { id: organization.id, name: organization.name, code: organization.code }, mfaEnabled: false, createdAt: '2026-09-18', updatedAt: '2026-09-18' };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
afterEach(() => vi.unstubAllGlobals());

it.each([200, 409])('keeps the user editor busy until saving with status %s settles before creating a new user', async (status) => {
  let resolveSave: ((response: Response) => void) | undefined;
  vi.stubGlobal('fetch', vi.fn().mockImplementation((path: string, init: RequestInit) => {
    if (path.endsWith('/csrf')) return Promise.resolve(json({ csrfToken: 'csrf' }));
    if (init.method === 'PATCH') return new Promise<Response>((resolve) => { resolveSave = resolve; });
    return Promise.resolve(json([user]));
  }));
  render(<UserAdministration organization={organization} organizations={[organization]} />);
  await userEvent.click(await screen.findByRole('button', { name: /^编\s*辑$/ }));
  await userEvent.clear(screen.getByLabelText('邮箱'));
  await userEvent.type(screen.getByLabelText('邮箱'), 'pending@example.test');
  await userEvent.click(screen.getByRole('button', { name: '保存用户' }));
  await waitFor(() => expect(resolveSave).toBeDefined());
  const editor = screen.getByRole('dialog');
  expect(within(editor).getByLabelText('邮箱')).toBeDisabled();
  expect(within(editor).getByLabelText('姓名')).toBeDisabled();
  expect(within(editor).getByLabelText('电话')).toBeDisabled();
  within(editor).getAllByRole('combobox').forEach(input => expect(input).toBeDisabled());
  expect(within(editor).queryByRole('button', { name: 'Close' })).not.toBeInTheDocument();
  fireEvent.keyDown(editor, { key: 'Escape', code: 'Escape', keyCode: 27 });
  const create = screen.getByRole('button', { name: '创建用户' });
  expect(create).toBeDisabled();
  await userEvent.click(create);
  expect(screen.getByRole('dialog')).toBe(editor);
  expect(screen.getByLabelText('邮箱')).toHaveValue('pending@example.test');
  resolveSave!(status === 200 ? json(user) : json({ code: 'ADMIN_USER_ORGANIZATION_IN_USE' }, status));
  if (status === 409) {
    await within(editor).findByText('该用户仍关联业务记录，无法变更主组织');
    expect(screen.getByRole('dialog')).toBe(editor);
    expect(within(editor).getByLabelText('邮箱')).toHaveValue('pending@example.test');
    expect(within(editor).getByLabelText('邮箱')).toBeEnabled();
    await userEvent.click(within(editor).getByRole('button', { name: 'Close' }));
  } else {
    expect(await screen.findByText('用户已保存')).toBeInTheDocument();
  }
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  await waitFor(() => expect(create).toBeEnabled());
  await userEvent.click(create);
  await userEvent.type(screen.getByLabelText('用户名'), 'next-user');
  expect(screen.getByLabelText('用户名')).toHaveValue('next-user');
}, 15_000);

it.each([200, 409])('blocks creating a role until a closed editor finishes saving with status %s', async (status) => {
  const role: AdminRole = { mfaRequired: false, id: 'role-a', code: 'READER', name: 'Reader Role', organizationId: organization.id, permissions: [] };
  let resolveSave: ((response: Response) => void) | undefined;
  vi.stubGlobal('fetch', vi.fn().mockImplementation((path: string, init: RequestInit) => {
    if (path.endsWith('/csrf')) return Promise.resolve(json({ csrfToken: 'csrf' }));
    if (init.method === 'PATCH') return new Promise<Response>((resolve) => { resolveSave = resolve; });
    return Promise.resolve(json(path.includes('/permission-catalog') ? [] : [role]));
  }));
  render(<RoleAdministration organization={organization} />);
  await userEvent.click(await screen.findByRole('button', { name: '编辑角色' }));
  await userEvent.clear(screen.getByLabelText('角色名称'));
  await userEvent.type(screen.getByLabelText('角色名称'), 'Pending Role');
  await userEvent.click(screen.getByRole('button', { name: '保存角色' }));
  await waitFor(() => expect(resolveSave).toBeDefined());
  await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Close' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  const create = screen.getByRole('button', { name: '创建角色' });
  expect(create).toBeDisabled();
  await userEvent.click(create);
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  resolveSave!(status === 200 ? json(role) : json({ code: 'CONFLICT' }, status));
  await waitFor(() => expect(create).toBeEnabled());
  await userEvent.click(create);
  await userEvent.type(screen.getByLabelText('角色名称'), 'Next Role');
  expect(screen.getByLabelText('角色名称')).toHaveValue('Next Role');
}, 15_000);

it('edits only changed user fields and keeps failed writes retryable with safe errors', async () => {
  const requests: RequestInit[] = [];
  let fail = true;
  vi.stubGlobal('fetch', vi.fn().mockImplementation((path: string, init: RequestInit) => {
    if (path.endsWith('/csrf')) return Promise.resolve(json({ csrfToken: 'csrf' }));
    if (init.method === 'PATCH') {
      requests.push(init);
      return Promise.resolve(fail ? json({ code: 'ADMIN_USER_ORGANIZATION_IN_USE', message: 'private backend detail' }, 409) : json(user));
    }
    return Promise.resolve(json([user]));
  }));
  render(<UserAdministration organization={organization} organizations={[organization]} />);
  await userEvent.click(await screen.findByRole('button', { name: /^编\s*辑$/ }));
  await userEvent.clear(screen.getByLabelText('邮箱'));
  await userEvent.type(screen.getByLabelText('邮箱'), 'updated@example.test');
  await userEvent.click(screen.getByRole('button', { name: '保存用户' }));
  expect(await within(screen.getByRole('dialog')).findByText('该用户仍关联业务记录，无法变更主组织')).toBeInTheDocument();
  expect(screen.queryByText('private backend detail')).not.toBeInTheDocument();
  expect(screen.getByLabelText('邮箱')).toHaveValue('updated@example.test');
  fail = false;
  await userEvent.click(screen.getByRole('button', { name: '保存用户' }));
  expect(await screen.findByText('用户已保存')).toBeInTheDocument();
  expect(requests.map((entry) => JSON.parse(String(entry.body)))).toEqual([{ email: 'updated@example.test', expectedProfileVersion: 1 }, { email: 'updated@example.test', expectedProfileVersion: 1 }]);
  expect((requests[0].headers as Record<string, string>)['Idempotency-Key']).toBe((requests[1].headers as Record<string, string>)['Idempotency-Key']);
}, 15_000);

it('retains issued reset only until closing and generates a new code for the next operation', async () => {
  const codes: string[] = [];
  vi.stubGlobal('fetch', vi.fn().mockImplementation((path: string, init: RequestInit) => {
    if (path.endsWith('/csrf')) return Promise.resolve(json({ csrfToken: 'csrf' }));
    if (path.includes('/password-reset')) { codes.push(JSON.parse(String(init.body)).temporaryCode); return Promise.resolve(json({ resetId: 'reset-id', expiresAt: '2026-09-19' }, 201)); }
    return Promise.resolve(json([user]));
  }));
  render(<UserAdministration organization={organization} organizations={[organization]} />);
  await userEvent.click(await screen.findByRole('button', { name: '签发重置凭证' }));
  await userEvent.click(screen.getByRole('button', { name: '确认签发' }));
  const credential = await screen.findByRole('textbox', { name: '一次性重置凭证' });
  expect((credential as HTMLTextAreaElement).value.startsWith('reset-id.')).toBe(true);
  expect(codes[0]).toMatch(/^[A-Za-z0-9_-]{43}$/);
  await userEvent.click(screen.getByRole('button', { name: '关闭并清除' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  await userEvent.click(screen.getByRole('button', { name: '签发重置凭证' }));
  expect(screen.queryByRole('textbox', { name: '一次性重置凭证' })).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: '确认签发' }));
  await screen.findByRole('textbox', { name: '一次性重置凭证' });
  expect(codes[0] === codes[1]).toBe(false);
}, 30_000);

it('shows global roles as read-only and exposes loading failures', async () => {
  vi.stubGlobal('fetch', vi.fn().mockImplementation((path: string) => Promise.resolve(json(path.includes('/permission-catalog') ? [] : [{ mfaRequired: false, id: 'global', code: 'GLOBAL', name: 'Global Role', organizationId: null, permissions: [] }]))));
  const rendered = render(<RoleAdministration organization={organization} />);
  const row = (await screen.findByText('Global Role')).closest('tr')!;
  expect(within(row).getByText('全局只读')).toBeInTheDocument();
  expect(within(row).getByRole('button', { name: /Global Role.*详情/ })).toBeInTheDocument();
  expect(within(row).queryByRole('button', { name: '编辑角色' })).not.toBeInTheDocument();
  expect(within(row).queryByRole('button', { name: '删除角色' })).not.toBeInTheDocument();
  rendered.unmount();
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('sensitive')));
  render(<RoleAdministration organization={organization} />);
  expect(await screen.findByText('请求失败，请重试')).toBeInTheDocument();
});

it('summarizes permissions and opens searchable read-only details from the keyboard', async () => {
  const role: AdminRole = { mfaRequired: false, id: 'role-details', code: 'READER', name: 'Reader Role', organizationId: organization.id, permissions: [
    { id: 'users-read', code: 'account:users:read', name: '查看用户' },
    { id: 'roles-delete', code: 'account:roles:delete', name: '删除角色' },
    { id: 'users-read-copy', code: 'account:users:read', name: '查看用户' },
    { id: 'legacy-read', code: 'legacy:read', name: 'Legacy read' },
  ] };
  const catalog: PermissionCatalogGroup[] = [{ key: 'system', name: '系统管理', status: 'active', modules: [
    { key: 'users', name: '用户管理', status: 'active', operations: [{ code: 'account:users:read', name: '查看用户', enforcement: 'guarded', grantable: true }] },
    { key: 'roles', name: '角色管理', status: 'active', operations: [{ code: 'account:roles:delete', name: '删除角色', enforcement: 'guarded', grantable: true }] },
  ] }];
  vi.stubGlobal('fetch', vi.fn().mockImplementation((path: string) => Promise.resolve(json(path.includes('/permission-catalog') ? catalog : [role]))));

  render(<RoleAdministration organization={organization} />);
  const row = (await screen.findByText(role.name)).closest('tr')!;
  expect(within(row).getByText(/3.*用户管理.*角色管理/)).toBeInTheDocument();
  const trigger = within(row).getByRole('button', { name: /Reader Role.*详情/ });
  trigger.focus();
  await userEvent.keyboard('{Enter}');

  const drawer = await screen.findByRole('dialog');
  expect(within(drawer).getByText('用户管理')).toBeInTheDocument();
  expect(within(drawer).getByText('角色管理')).toBeInTheDocument();
  expect(within(drawer).getByText('查看用户')).toBeInTheDocument();
  expect(within(drawer).getByText('删除角色')).toBeInTheDocument();
  expect(within(drawer).getByText('legacy:read')).toBeInTheDocument();
  expect(within(drawer).queryByRole('checkbox')).not.toBeInTheDocument();

  await userEvent.type(within(drawer).getByRole('textbox', { name: '搜索权限' }), '删除');
  expect(within(drawer).getByText('删除角色')).toBeInTheDocument();
  expect(within(drawer).queryByText('查看用户')).not.toBeInTheDocument();
  await userEvent.click(within(drawer).getByRole('button', { name: 'Close' }));
  await waitFor(() => expect(document.activeElement).toBe(trigger));
});

it('restores the permission details trigger after Escape when a mouse click leaves focus on another input', async () => {
  const role: AdminRole = { mfaRequired: false, id: 'role-focus', code: 'READER', name: 'Reader Role', organizationId: organization.id, permissions: [{ id: 'users-read', code: 'account:users:read', name: '查看用户' }] };
  vi.stubGlobal('fetch', vi.fn().mockImplementation((path: string) => Promise.resolve(json(path.includes('/permission-catalog') ? [] : [role]))));

  render(<><input aria-label="Previous focus" /><RoleAdministration organization={organization} /></>);
  const row = (await screen.findByText(role.name)).closest('tr')!;
  const trigger = within(row).getByRole('button', { name: /Reader Role.*详情/ });
  const previousInput = screen.getByRole('textbox', { name: 'Previous focus' });
  previousInput.focus();
  expect(document.activeElement).toBe(previousInput);
  // A mouse click can open the Drawer without moving focus to its trigger.
  fireEvent.click(trigger);

  const drawer = await screen.findByRole('dialog');
  const search = within(drawer).getByRole('textbox', { name: '搜索权限' });
  await userEvent.click(search);
  expect(document.activeElement).toBe(search);
  await userEvent.keyboard('{Escape}');

  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  await waitFor(() => expect(document.activeElement).toBe(trigger));
});

it('falls back to the controlled permission name and code when the catalog has no match', async () => {
  const permission: AdminPermission = { id: 'legacy-read', code: 'legacy:read', name: 'Legacy read' };
  const role: AdminRole = { mfaRequired: false, id: 'role-legacy', code: 'LEGACY', name: 'Legacy Role', organizationId: organization.id, permissions: [permission] };
  vi.stubGlobal('fetch', vi.fn().mockImplementation((path: string) => Promise.resolve(json(path.includes('/permission-catalog') ? [] : [role]))));

  render(<RoleAdministration organization={organization} />);
  const row = (await screen.findByText(role.name)).closest('tr')!;
  expect(within(row).getByText(/1.*Legacy read/)).toBeInTheDocument();
  await userEvent.click(within(row).getByRole('button', { name: /Legacy Role.*详情/ }));
  const drawer = await screen.findByRole('dialog');
  expect(within(drawer).getAllByText('Legacy read').length).toBeGreaterThan(0);
  expect(within(drawer).getByText(permission.code)).toBeInTheDocument();
});

it('clears permission details after organization or access changes and role deletion', async () => {
  const role: AdminRole = { mfaRequired: false, id: 'role-clear', code: 'READER', name: 'Reader Role', organizationId: organization.id, permissions: [{ id: 'users-read', code: 'account:users:read', name: '查看用户' }] };
  const catalog: PermissionCatalogGroup[] = [{ key: 'system', name: '系统管理', status: 'active', modules: [{ key: 'users', name: '用户管理', status: 'active', operations: [{ code: 'account:users:read', name: '查看用户', enforcement: 'guarded', grantable: true }] }] }];
  let roles: AdminRole[] = [role];
  vi.stubGlobal('fetch', vi.fn().mockImplementation((path: string, init: RequestInit) => {
    if (init.method === 'DELETE') { roles = []; return Promise.resolve(new Response(null, { status: 204 })); }
    return Promise.resolve(json(path.includes('/permission-catalog') ? catalog : roles));
  }));
  const other: AdminOrganization = { id: 'org-b', code: 'b', name: 'Organization B', type: 'SUPPLIER', permissions: ['account:roles:read'] };
  const view = render(<RoleAdministration organization={organization} />);
  const row = (await screen.findByText(role.name)).closest('tr')!;
  await userEvent.click(within(row).getByRole('button', { name: /Reader Role.*详情/ }));
  expect(await screen.findByRole('dialog')).toBeInTheDocument();
  view.rerender(<RoleAdministration organization={other} />);
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

  view.rerender(<RoleAdministration organization={{ ...organization, permissions: [] }} />);
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

  view.rerender(<RoleAdministration organization={organization} />);
  const deletedRow = (await screen.findByText(role.name)).closest('tr')!;
  await userEvent.click(within(deletedRow).getByRole('button', { name: /Reader Role.*详情/ }));
  expect(await screen.findByRole('dialog')).toBeInTheDocument();
  await userEvent.click(within(deletedRow).getByRole('button', { name: '删除角色' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(screen.queryByText(role.name)).not.toBeInTheDocument();
});

it('ignores late role and catalog responses after switching organizations', async () => {
  const role: AdminRole = { mfaRequired: false, id: 'role-late', code: 'READER', name: 'Late Role', organizationId: organization.id, permissions: [] };
  let resolveRoles: ((response: Response) => void) | undefined;
  let resolveCatalog: ((response: Response) => void) | undefined;
  const paths: string[] = [];
  vi.stubGlobal('fetch', vi.fn().mockImplementation((path: string) => {
    paths.push(path);
    if (path.includes('organizationId=org-a') && path.includes('/permission-catalog')) return new Promise<Response>((resolve) => { resolveCatalog = resolve; });
    if (path.includes('organizationId=org-a')) return new Promise<Response>((resolve) => { resolveRoles = resolve; });
    return Promise.resolve(json([]));
  }));
  const other: AdminOrganization = { id: 'org-b', code: 'b', name: 'Organization B', type: 'SUPPLIER', permissions: ['account:roles:read'] };
  const view = render(<RoleAdministration organization={organization} />);
  await waitFor(() => { expect(resolveRoles).toBeDefined(); expect(resolveCatalog).toBeDefined(); });
  view.rerender(<RoleAdministration organization={other} />);
  await waitFor(() => expect(paths.some((path) => path.includes('organizationId=org-b'))).toBe(true));
  resolveRoles!(json([role]));
  resolveCatalog!(json([]));
  await waitFor(() => expect(screen.queryByText(role.name)).not.toBeInTheDocument());
});

it('clears old roles, details, and permission catalog while the next organization loads', async () => {
  const role: AdminRole = { mfaRequired: false, id: 'role-isolated', code: 'READER', name: 'A Role', organizationId: organization.id, permissions: [] };
  const catalog: PermissionCatalogGroup[] = [{ key: 'system', name: 'A Catalog', status: 'active', modules: [{ key: 'a-module', name: 'A Module', status: 'active', operations: [] }] }];
  let rejectB: ((cause: Error) => void) | undefined;
  vi.stubGlobal('fetch', vi.fn().mockImplementation((path: string) => {
    if (path.includes('organizationId=org-b')) return new Promise<Response>((_, reject) => { rejectB = reject; });
    return Promise.resolve(json(path.includes('/permission-catalog') ? catalog : [role]));
  }));
  const other: AdminOrganization = { id: 'org-b', code: 'b', name: 'Organization B', type: 'SUPPLIER', permissions: ['account:roles:read'] };
  const view = render(<RoleAdministration organization={organization} />);
  const row = (await screen.findByText(role.name)).closest('tr')!;
  await userEvent.click(within(row).getByRole('button', { name: /A Role.*详情/ }));
  expect(await screen.findByRole('dialog')).toBeInTheDocument();
  await userEvent.click(screen.getByText('权限目录（只读）'));
  expect(screen.getByText('A Catalog')).toBeInTheDocument();

  view.rerender(<RoleAdministration organization={other} />);

  expect(screen.queryByText(role.name)).not.toBeInTheDocument();
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(screen.queryByText('A Catalog')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /A Role.*详情/ })).not.toBeInTheDocument();
  rejectB!(new Error('sensitive'));
  expect(await screen.findByText('请求失败，请重试')).toBeInTheDocument();
  expect(screen.queryByText(role.name)).not.toBeInTheDocument();
});

it.each([
  { action: 'rename', expected: [{ name: 'Renamed Role' }] },
  { action: 'unchanged', expected: [] },
  { action: 'remove permission', expected: [{ permissionCodes: ['account:roles:read'], expectedPermissionCodes: ['account:users:read', 'account:roles:read'] }] },
  { action: 'reorder permissions', expected: [] },
])('submits only changed role fields: $action', async ({ action, expected }) => {
  const role: AdminRole = { mfaRequired: false, id: 'role-a', code: 'READER', name: 'Reader Role', organizationId: organization.id, permissions: [{ id: 'users-read', code: 'account:users:read', name: 'Read users' }, { id: 'roles-read', code: 'account:roles:read', name: 'Read roles' }] };
  const requests: unknown[] = [];
  vi.stubGlobal('fetch', vi.fn().mockImplementation((path: string, init: RequestInit) => {
    if (path.endsWith('/csrf')) return Promise.resolve(json({ csrfToken: 'csrf' }));
    if (init.method === 'PATCH') { requests.push(JSON.parse(String(init.body))); return Promise.resolve(json(role)); }
    return Promise.resolve(json(path.includes('/permission-catalog') ? [{ key: 'system', name: '系统管理', status: 'active', modules: [{ key: 'accounts', name: '账号', status: 'active', operations: role.permissions.map((permission) => ({ code: permission.code, name: permission.name, enforcement: 'guarded', grantable: true })) }] }] : [role]));
  }));
  render(<RoleAdministration organization={organization} />);
  await userEvent.click(await screen.findByRole('button', { name: '编辑角色' }));
  if (action === 'rename') {
    await userEvent.clear(screen.getByLabelText('角色名称'));
    await userEvent.type(screen.getByLabelText('角色名称'), 'Renamed Role');
  }
  if (action === 'remove permission' || action === 'reorder permissions') {
    await userEvent.click(screen.getByRole('checkbox', { name: '账号 · Read users' }));
    if (action === 'reorder permissions') {
      await userEvent.click(screen.getByRole('checkbox', { name: '账号 · Read users' }));
      expect(screen.getByRole('checkbox', { name: '账号 · Read users' })).toBeChecked();
      expect(screen.getByRole('checkbox', { name: '账号 · Read roles' })).toBeChecked();
    }
  }
  await userEvent.click(screen.getByRole('button', { name: '保存角色' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(requests).toEqual(expected);
}, 15_000);

it.each(['account:users:read', 'account:roles:read'])('does not offer user role assignment without %s', async (missing) => {
  const fetch = vi.fn().mockResolvedValue(json([user]));
  vi.stubGlobal('fetch', fetch);
  render(<UserAdministration organization={{ ...organization, permissions: ['account:users:read', 'account:roles:read', 'account:roles:assign'].filter(permission => permission !== missing) }} organizations={[organization]} />);
  if (missing !== 'account:users:read') await screen.findByText('alice');
  expect(screen.queryByRole('button', { name: '分配角色' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '查看角色' })).not.toBeInTheDocument();
  expect(fetch.mock.calls.some(([path]) => String(path).includes('/roles'))).toBe(false);
});

it('never redisplays a credential when its pending issue dialog was closed', async () => {
  let resolveIssue: ((response: Response) => void) | undefined;
  vi.stubGlobal('fetch', vi.fn().mockImplementation((path: string) => {
    if (path.endsWith('/csrf')) return Promise.resolve(json({ csrfToken: 'csrf' }));
    if (path.includes('/password-reset')) return new Promise<Response>((resolve) => { resolveIssue = resolve; });
    return Promise.resolve(json([user]));
  }));
  render(<UserAdministration organization={organization} organizations={[organization]} />);
  await userEvent.click(await screen.findByRole('button', { name: '签发重置凭证' }));
  await userEvent.click(screen.getByRole('button', { name: '确认签发' }));
  await waitFor(() => expect(resolveIssue).toBeDefined());
  await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Close' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  resolveIssue!(json({ resetId: 'reset-id', expiresAt: '2026-09-19' }, 201));
  await screen.findByText('重置凭证已签发');
  expect(screen.queryByRole('textbox', { name: '一次性重置凭证' })).not.toBeInTheDocument();
}, 15_000);

it('switches permissions with organization and ignores the previous organization response', async () => {
  let resolveUsers: ((response: Response) => void) | undefined;
  vi.stubGlobal('fetch', vi.fn().mockImplementation((path: string) => path.includes('/users?') ? new Promise<Response>((resolve) => { resolveUsers = resolve; }) : Promise.resolve(json([]))));
  const other: AdminOrganization = { id: 'org-b', code: 'b', name: 'Organization B', type: 'SUPPLIER', permissions: ['account:roles:read'] };
  render(<AdminPage organizations={[organization, other]} />);
  await waitFor(() => expect(resolveUsers).toBeDefined());
  await userEvent.click(screen.getByRole('combobox', { name: '管理组织' }));
  await userEvent.click(screen.getByText('Organization B · b'));
  expect(await screen.findByRole('tab', { name: '角色' })).toBeInTheDocument();
  expect(screen.queryByRole('tab', { name: '用户' })).not.toBeInTheDocument();
  resolveUsers!(json([user]));
  await waitFor(() => expect(screen.queryByText('alice')).not.toBeInTheDocument());
  expect(screen.queryByRole('button', { name: '创建角色' })).not.toBeInTheDocument();
}, 15_000);

it('reloads the MFA form value and comparison baseline before retrying a role edit', async () => {
  let conflicted = false;
  const role: AdminRole = { mfaRequired: false, id: 'role-mfa', code: 'READER', name: 'Reader Role', organizationId: organization.id, permissions: [] };
  const writes: unknown[] = [];
  vi.stubGlobal('fetch', vi.fn(async (path: string, init: RequestInit) => {
    if (path.endsWith('/csrf')) return json({ csrfToken: 'csrf' });
    if (init.method === 'PATCH') {
      writes.push(JSON.parse(String(init.body)));
      if (!conflicted) { conflicted = true; return json({ code: 'CONCURRENCY_CONFLICT', message: 'private role details', traceId: 'trace-role-reload' }, 409); }
      return json({ ...role, mfaRequired: true });
    }
    return json(path.includes('/permission-catalog') ? [] : [{ ...role, mfaRequired: conflicted }]);
  }));
  render(<RoleAdministration organization={organization} />);
  fireEvent.click(await screen.findByRole('button', { name: '编辑角色' }));
  fireEvent.change(screen.getByLabelText('角色名称'), { target: { value: 'Renamed Role' } });
  fireEvent.click(screen.getByRole('button', { name: '保存角色' }));
  const dialog = screen.getByRole('dialog');
  expect(await within(dialog).findByText('trace-role-reload')).toBeInTheDocument();
  expect(within(dialog).queryByText('private role details')).not.toBeInTheDocument();
  fireEvent.click(within(dialog).getByRole('button', { name: '重新加载并放弃权限修改' }));
  await waitFor(() => expect(within(dialog).getByRole('switch', { name: 'MFA' })).toBeChecked());
  await waitFor(() => expect(within(dialog).getByRole('button', { name: '保存角色' })).toBeEnabled());
  fireEvent.click(within(dialog).getByRole('button', { name: '保存角色' }));
  await waitFor(() => expect(writes).toHaveLength(2));
  expect(writes[1]).toEqual({ name: 'Renamed Role' });
}, 15000);
