import { act, fireEvent, render as testingRender, screen, waitFor, within } from '@testing-library/react';
import baseUserEvent, { PointerEventsCheckLevel } from '@testing-library/user-event';
import { ConfigProvider } from 'antd';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { UserAdministration } from './UserAdministration';
import type { AdminOrganization, AdminUser } from './admin';
import { useWorkTabsStore } from '../../work-tabs/workTabsStore';
const userEvent = baseUserEvent.setup({ pointerEventsCheck: PointerEventsCheckLevel.Never });
const render = (children: ReactNode) => testingRender(<ConfigProvider theme={{ token: { motion: false } }}>{children}</ConfigProvider>);

const organization: AdminOrganization = { id: 'org', name: 'Organization', code: 'O', type: 'INTERNAL', permissions: ['account:users:read', 'account:users:create', 'account:roles:read', 'account:roles:assign', 'organization:structure:read', 'organization:positions:assign'] };
const user: AdminUser = { id: 'u1', username: 'alice', fullName: null, phone: null, email: null, emailVerifiedAt: null, profileVersion: 1, accountType: 'INTERNAL', status: 'ACTIVE', mfaEnabled: false, organizationId: 'org', organization: { id: 'org', code: 'O', name: 'Organization' }, createdAt: '', updatedAt: '' };
const position = { id: 'p1', organizationId: 'org', departmentId: 'd1', categoryId: null, code: 'QA', name: 'Quality engineer', status: 'ACTIVE', version: 1 };
const department = { id: 'd1', organizationId: 'org', parentId: null, code: 'Q', name: 'Quality department', status: 'ACTIVE', version: 1 };
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
beforeEach(() => { useWorkTabsStore.getState().reset(); localStorage.clear(); document.documentElement.lang = 'zh-CN'; vi.stubEnv('NODE_ENV', 'development'); });
afterEach(() => { useWorkTabsStore.getState().reset(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

it('requires an authorization preview and atomically sends positions with the new internal account', async () => {
  const writes: { path: string; body: unknown }[] = [];
  vi.stubGlobal('fetch', vi.fn(async (path: string, init: RequestInit) => {
    if (path.endsWith('/csrf')) return json({ csrfToken: 'csrf' });
    if (path.includes('/departments?')) return json([department]);
    if (path.includes('/positions?')) return json([position]);
    if (path.endsWith('/position-authorization/preview')) return json({ authorizationBaseline: 'baseline-1', positions: [{ ...position, department, permissionCodes: [], mfaRequired: false, historicalSources: [], roleVersion: 1 }], effectivePermissionCodes: [], effectiveMfaRequired: false });
    if (init.method === 'POST') { writes.push({ path, body: JSON.parse(String(init.body)) }); return json(user); }
    return json([]);
  }));
  render(<UserAdministration organization={organization} organizations={[organization]} />);
  await userEvent.click(screen.getByRole('button', { name: '创建用户' }));
  const dialog = within(await screen.findByRole('dialog', { name: '创建用户' }));
  expect(dialog.getByRole('button', { name: '保存用户' })).toBeDisabled();
  fireEvent.change(dialog.getByLabelText('用户名'), { target: { value: 'alice' } });
  fireEvent.change(dialog.getByLabelText('初始密码'), { target: { value: 'Long-password-123!' } });
  await waitFor(() => expect(dialog.getByLabelText('任职岗位')).toBeEnabled());
  await userEvent.click(dialog.getByLabelText('任职岗位'));
  await userEvent.click(await screen.findByText('Quality engineer · QA'));
  fireEvent.click(dialog.getByRole('button', { name: '预览授权' }));
  expect(await dialog.findByText('该岗位未配置系统权限')).toBeVisible();
  fireEvent.click(dialog.getByRole('button', { name: '保存用户' }));
  await waitFor(() => expect(writes).toHaveLength(1));
  expect(writes[0]).toMatchObject({ path: '/api/v1/admin/users', body: { username: 'alice', positionIds: ['p1'], authorizationBaseline: 'baseline-1' } });
});

it('does not create an unassigned internal account when the administrator lacks structure or position authority', async () => {
  const writes: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (path: string, init: RequestInit) => {
    if (init.method && init.method !== 'GET') writes.push(path);
    return json([]);
  }));
  const restricted = { ...organization, permissions: ['account:users:read', 'account:users:create'] };
  render(<UserAdministration organization={restricted} organizations={[restricted]} />);
  await userEvent.click(screen.getByRole('button', { name: '创建用户' }));
  const dialog = within(await screen.findByRole('dialog', { name: '创建用户' }));
  await waitFor(() => expect(dialog.getByText('缺少岗位授权所需权限，无法创建内部账号')).toBeVisible());
  expect(dialog.getByRole('button', { name: '保存用户' })).toBeDisabled();
  expect(writes).toEqual([]);
});

it('keeps legacy and effective role sources read-only even for a role assignment administrator', async () => {
  const writes: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (path: string, init: RequestInit) => {
    if (init.method && init.method !== 'GET') writes.push(path);
    if (path.includes('/users/u1/roles')) return json({ userId: 'u1', organizationId: 'org', roles: [], effectiveRoles: [{ id: 'r1', name: 'Legacy', sources: [{ kind: 'DIRECT' }] }], permissions: [] });
    return json(path.includes('/admin/roles') ? [] : [user]);
  }));
  render(<UserAdministration organization={organization} organizations={[organization]} />);
  expect(screen.queryByRole('button', { name: '分配角色' })).not.toBeInTheDocument();
  await userEvent.click(await screen.findByRole('button', { name: '查看授权来源' }));
  const dialog = within(await screen.findByRole('dialog'));
  await waitFor(() => expect(dialog.getByText('Legacy')).toBeVisible());
  expect(dialog.queryByRole('combobox')).not.toBeInTheDocument();
  expect(dialog.queryByRole('button', { name: '保存角色分配' })).not.toBeInTheDocument();
  expect(writes).toEqual([]);
});

it('drops a late authorization preview after leaving the organization', async () => {
  let finish!: (value: Response) => void;
  vi.stubGlobal('fetch', vi.fn(async (path: string) => {
    if (path.endsWith('/csrf')) return json({ csrfToken: 'csrf' });
    if (path.includes('/departments?')) return json([department]);
    if (path.includes('/positions?')) return json([position]);
    if (path.endsWith('/position-authorization/preview')) return new Promise<Response>(resolve => { finish = resolve; });
    return json([]);
  }));
  const view = render(<UserAdministration organization={organization} organizations={[organization]} />);
  await userEvent.click(screen.getByRole('button', { name: '创建用户' }));
  const dialog = within(await screen.findByRole('dialog', { name: '创建用户' }));
  await waitFor(() => expect(dialog.getByLabelText('任职岗位')).toBeEnabled());
  await userEvent.click(dialog.getByLabelText('任职岗位'));
  await userEvent.click(await screen.findByText('Quality engineer · QA'));
  fireEvent.click(dialog.getByRole('button', { name: '预览授权' }));
  await waitFor(() => expect(finish).toBeDefined());
  const next = { ...organization, id: 'next' };
  view.rerender(<UserAdministration organization={next} organizations={[next]} />);
  await act(async () => finish(json({ authorizationBaseline: 'old', positions: [], effectivePermissionCodes: ['stale-permission'], effectiveMfaRequired: false })));
  expect(screen.queryByText('stale-permission')).not.toBeInTheDocument();
  expect(screen.queryByRole('dialog', { name: '创建用户' })).not.toBeInTheDocument();
});

it('keeps the account draft after an authorization conflict and requires a fresh preview before retrying', async () => {
  const writes: Record<string, unknown>[] = [];
  let previews = 0;
  vi.stubGlobal('fetch', vi.fn(async (path: string, init: RequestInit) => {
    if (path.endsWith('/csrf')) return json({ csrfToken: 'csrf' });
    if (path.includes('/departments?')) return json([department]);
    if (path.includes('/positions?')) return json([position]);
    if (path.endsWith('/position-authorization/preview')) { previews++; return json({ authorizationBaseline: `baseline-${previews}`, positions: [], effectivePermissionCodes: [], effectiveMfaRequired: false }); }
    if (path === '/api/v1/admin/users' && init.method === 'POST') {
      writes.push(JSON.parse(String(init.body)));
      return writes.length === 1 ? json({ code: 'CONCURRENCY_CONFLICT' }, 409) : json(user);
    }
    return json([]);
  }));
  render(<UserAdministration organization={organization} organizations={[organization]} />);
  await userEvent.click(screen.getByRole('button', { name: '创建用户' }));
  const dialog = within(await screen.findByRole('dialog', { name: '创建用户' }));
  fireEvent.change(dialog.getByLabelText('用户名'), { target: { value: 'alice' } });
  fireEvent.change(dialog.getByLabelText('初始密码'), { target: { value: 'Long-password-123!' } });
  await waitFor(() => expect(dialog.getByLabelText('任职岗位')).toBeEnabled());
  await userEvent.click(dialog.getByLabelText('任职岗位'));
  await userEvent.click(await screen.findByText('Quality engineer · QA'));
  fireEvent.click(dialog.getByRole('button', { name: '预览授权' }));
  await waitFor(() => expect(dialog.getByRole('button', { name: '保存用户' })).toBeEnabled());
  fireEvent.click(dialog.getByRole('button', { name: '保存用户' }));
  await dialog.findByText('记录已被其他用户更新，请刷新后重试');
  expect(dialog.getByLabelText('用户名')).toHaveValue('alice');
  expect(dialog.getByRole('button', { name: '保存用户' })).toBeDisabled();
  fireEvent.click(dialog.getByRole('button', { name: '预览授权' }));
  await waitFor(() => expect(dialog.getByRole('button', { name: '保存用户' })).toBeEnabled());
  fireEvent.click(dialog.getByRole('button', { name: '保存用户' }));
  await waitFor(() => expect(writes).toHaveLength(2));
  expect(writes[1]).toMatchObject({ username: 'alice', positionIds: ['p1'], authorizationBaseline: 'baseline-2' });
});

it.each([false, true])('shows historical appointments and saves only the effective transfer baseline (self=%s)', async self => {
  useWorkTabsStore.getState().bindSession(`INTERNAL:org:${self ? 'u1' : 'actor'}`);
  const extra = { ...position, id: 'p2', code: 'QE', name: 'Quality lead' };
  const old = { ...position, id: 'old', code: 'OLD', name: 'Former position' };
  const assignments = [
    { id: 'a1', organizationId: 'org', userId: 'u1', positionId: position.id, position, startedAt: '2020-01-01T00:00:00Z', endedAt: null },
    { id: 'a0', organizationId: 'org', userId: 'u1', positionId: old.id, position: old, startedAt: '2019-01-01T00:00:00Z', endedAt: '2020-01-01T00:00:00Z' },
  ];
  let write: unknown;
  let previewBody: unknown;
  let listReads = 0;
  vi.stubGlobal('fetch', vi.fn(async (path: string, init: RequestInit) => {
    if (path.endsWith('/csrf')) return json({ csrfToken: 'csrf' });
    if (path.endsWith('/position-authorization/preview')) { previewBody = JSON.parse(String(init.body)); return json({ authorizationBaseline: 'transfer-baseline', positions: [], effectivePermissionCodes: ['workbench:read'], effectiveMfaRequired: false, retainedSources: [] }); }
    if (path.includes('/users/u1/positions')) {
      if (init.method === 'PUT') { write = JSON.parse(String(init.body)); return json(assignments); }
      return json(assignments);
    }
    if (path.includes('/departments?')) return json([department]);
    if (path.includes('/positions?')) return json([position, extra, old]);
    if (path.includes('/users/u1/roles')) return json({ userId: 'u1', organizationId: 'org', roles: [], effectiveRoles: [], permissions: [] });
    listReads++;
    return json([user]);
  }));
  render(<MemoryRouter><Routes><Route path="/" element={<UserAdministration organization={organization} organizations={[organization]} />} /><Route path="/login" element={<p>Reauthenticate</p>} /></Routes></MemoryRouter>);
  const accountRow = (await screen.findByText('alice')).closest('tr')!;
  await userEvent.click(within(accountRow).getByRole('button', { name: /^调\s*岗$/ }));
  const dialog = within(await screen.findByRole('dialog', { name: 'alice · 用户任职' }));
  expect(await dialog.findByText('Former position')).toBeVisible();
  await waitFor(() => expect(dialog.getByLabelText('任职岗位')).toBeEnabled());
  await userEvent.click(dialog.getByLabelText('任职岗位'));
  await userEvent.click(await screen.findByText('Quality lead · QE'));
  fireEvent.click(dialog.getByRole('button', { name: '预览授权' }));
  await waitFor(() => expect(dialog.getByRole('button', { name: '保存任职' })).toBeEnabled());
  expect(previewBody).toEqual({ positionIds: ['p1', 'p2'], targetUserId: 'u1' });
  fireEvent.click(dialog.getByRole('button', { name: '保存任职' }));
  await waitFor(() => expect(write).toEqual({ positionIds: ['p1', 'p2'], expectedPositionIds: ['p1'], authorizationBaseline: 'transfer-baseline' }));
  if (self) {
    await waitFor(() => expect(useWorkTabsStore.getState().sessionScope).toBeUndefined());
    expect(screen.getByText('Reauthenticate')).toBeVisible();
    expect(listReads).toBe(1);
  } else expect(useWorkTabsStore.getState().sessionScope).toBe('INTERNAL:org:actor');
});
