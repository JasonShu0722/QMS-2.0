import { act, fireEvent, render as testingRender, screen, waitFor, within } from '@testing-library/react';
import { ConfigProvider } from 'antd';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { UserAdministration } from './UserAdministration';
import type { AdminOrganization, AdminUser } from './admin';
import { useWorkTabsStore } from '../../work-tabs/workTabsStore';
const render = (children: ReactNode) => testingRender(<ConfigProvider theme={{ token: { motion: false } }}>{children}</ConfigProvider>);

const organization: AdminOrganization = { id: 'org', name: 'Organization', code: 'O', type: 'INTERNAL', permissions: ['account:users:read', 'account:users:create', 'account:roles:read', 'account:roles:assign', 'organization:structure:read', 'organization:positions:assign'] };
const user: AdminUser = { securityVersion: 1, id: 'u1', username: 'alice', fullName: null, phone: null, email: null, emailVerifiedAt: null, profileVersion: 1, accountType: 'INTERNAL', status: 'ACTIVE', mfaEnabled: false, organizationId: 'org', organization: { id: 'org', code: 'O', name: 'Organization' }, createdAt: '', updatedAt: '' };
const position = { id: 'p1', organizationId: 'org', departmentId: 'd1', categoryId: null, code: 'QA', name: 'Quality engineer', status: 'ACTIVE', version: 1 };
const department = { id: 'd1', organizationId: 'org', parentId: null, code: 'Q', name: 'Quality department', status: 'ACTIVE', version: 1 };
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
beforeEach(() => { useWorkTabsStore.getState().reset(); localStorage.clear(); document.documentElement.lang = 'zh-CN'; vi.stubEnv('NODE_ENV', 'development'); });
afterEach(() => { useWorkTabsStore.getState().reset(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

async function openDialog(name: string) {
  const element = await screen.findByLabelText(name, { selector: '[role="dialog"]' });
  const wrapper = element.closest<HTMLElement>('.ant-modal-wrap')!;
  await waitFor(() => {
    expect(wrapper.style.display).not.toBe('none');
    expect(element.classList.contains('ant-zoom-appear')).toBe(false);
  }, { container: wrapper });
  expect(element).toBeVisible();
  return within(element);
}

async function openAppointments() {
  const row = (await screen.findByText(user.username, { selector: 'td' })).closest('tr')!;
  const manage = within(row).getByText('管理用户', { selector: 'button > span' }).closest('button')!;
  expect(manage).toHaveAccessibleName('管理用户');
  expect(manage).toBeVisible();
  await clickAndSettle(manage);
  const management = await openDialog('管理用户');
  const appointments = management.getByText('任职与授权', { selector: '[role="tab"]' });
  fireEvent.click(appointments);
  expect(appointments).toHaveAttribute('aria-selected', 'true');
  return management;
}

async function openTransfer() {
  const management = await openAppointments();
  const transfer = management.getByText(/^调\s*岗$/, { selector: 'button > span' }).closest('button')!;
  expect(transfer).toHaveAccessibleName(/^调\s*岗$/);
  expect(transfer).toBeVisible();
  await clickAndSettle(transfer);
  return openDialog('alice · 用户任职');
}

async function clickAndSettle(element: HTMLElement) {
  await act(async () => {
    fireEvent.click(element);
  });
}

async function choosePosition(dialog: ReturnType<typeof within>, label: string) {
  const input = dialog.getByLabelText('任职岗位', { selector: 'input[role="combobox"]' });
  await waitFor(() => expect(input).toBeEnabled(), { container: input });
  fireEvent.mouseDown(input);
  const listId = input.getAttribute('aria-controls');
  const list = document.getElementById(listId ?? '');
  const popup = list?.closest<HTMLElement>('.ant-select-dropdown');
  expect(popup).toBeInTheDocument();
  fireEvent.click(within(popup!).getByText(label, { selector: '.ant-select-item-option-content' }));
}

it('displays direct appointment summaries and retains both direct and departmental positions in a transfer', async () => {
  const direct = { ...position, id: 'direct', code: 'ADMIN', name: '组织管理员', departmentId: null };
  const assignments = [direct, position].map(item => ({ id: `a-${item.id}`, organizationId: 'org', userId: user.id, positionId: item.id, position: item, startedAt: '2020-01-01T00:00:00Z', endedAt: null }));
  const writes: unknown[] = [];
  vi.stubGlobal('fetch', vi.fn(async (path: string, init?: RequestInit) => {
    if (path.endsWith('/csrf')) return json({ csrfToken: 'csrf' });
    if (path.includes('/departments?')) return json([department]);
    if (path.includes('/organizations/org/positions?')) return json([direct, position]);
    if (path.endsWith('/position-authorization/preview')) return json({ authorizationBaseline: 'direct-transfer', positions: [], effectivePermissionCodes: ['problem-index:read'], effectiveMfaRequired: false });
    if (path.includes('/users/u1/positions')) { if (init?.method === 'PUT') writes.push(JSON.parse(String(init.body))); return json(assignments); }
    if (path.includes('/users/u1/roles')) return json({ userId: user.id, organizationId: 'org', roles: [], effectiveRoles: [], permissions: [] });
    return json([{ ...user, positions: [{ id: direct.id, code: direct.code, name: direct.name, department: null }] }]);
  }));
  await act(async () => {
    render(<MemoryRouter><UserAdministration organization={organization} organizations={[organization]} /></MemoryRouter>);
  });
  expect(await screen.findByText('组织直属 · 组织管理员')).toBeVisible();
  const dialog = await openTransfer();
  const save = dialog.getByText('保存任职', { selector: 'button > span' }).closest('button')!;
  expect(save).toHaveAccessibleName('保存任职');
  const preview = dialog.getByText('预览授权', { selector: 'button > span' }).closest('button')!;
  expect(save.parentElement).toBe(preview.parentElement);
  expect(save).toBeDisabled();
  await waitFor(() => expect(preview).toBeEnabled());
  await clickAndSettle(preview);
  expect(save).toBeEnabled();
  const details = dialog.getByText('权限明细').closest('details')!;
  expect(details.open).toBe(false);
  expect(within(details).getByText('problem-index:read', { selector: '.ant-tag' })).not.toBeVisible();
  fireEvent.click(within(details).getByText('权限明细', { selector: 'summary' }));
  expect(within(details).getByText('problem-index:read', { selector: '.ant-tag' })).toBeVisible();
  await clickAndSettle(save);
  expect(writes).toHaveLength(1);
  expect(writes[0]).toEqual({ positionIds: ['direct', 'p1'], expectedPositionIds: ['direct', 'p1'], authorizationBaseline: 'direct-transfer' });
});

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
  fireEvent.click(screen.getByText('创建用户', { selector: 'button > span' }).closest('button')!);
  const dialog = await openDialog('创建用户');
  const save = dialog.getByText('保存用户', { selector: 'button > span' }).closest('button')!;
  expect(save).toHaveAccessibleName('保存用户');
  expect(save).toBeDisabled();
  fireEvent.change(dialog.getByLabelText('用户名'), { target: { value: 'alice' } });
  fireEvent.change(dialog.getByLabelText('初始密码'), { target: { value: 'Long-password-123!' } });
  await choosePosition(dialog, 'Quality engineer · QA');
  fireEvent.click(dialog.getByText('预览授权', { selector: 'button > span' }).closest('button')!);
  expect(await dialog.findByText('该岗位未配置系统权限')).toBeVisible();
  fireEvent.click(save);
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
  fireEvent.click(screen.getByText('创建用户', { selector: 'button > span' }).closest('button')!);
  const dialog = await openDialog('创建用户');
  const alert = dialog.getByText('缺少岗位授权所需权限，无法创建内部账号');
  expect(alert.closest('[role="alert"]')).toBeVisible();
  expect(dialog.getByText('保存用户', { selector: 'button > span' }).closest('button')).toBeDisabled();
  expect(writes).toEqual([]);
});

it('keeps legacy and effective role sources read-only even for a role assignment administrator', async () => {
  const writes: string[] = [];
  const fetch = vi.fn(async (path: string, init: RequestInit) => {
    if (init.method && init.method !== 'GET') writes.push(path);
    if (path.includes('/users/u1/roles')) return json({ userId: 'u1', organizationId: 'org', roles: [], effectiveRoles: [{ id: 'r1', name: 'Legacy', sources: [{ kind: 'DIRECT' }] }], permissions: [] });
    return json(path.includes('/admin/roles') ? [] : [user]);
  });
  vi.stubGlobal('fetch', fetch);
  const limited = { ...organization, permissions: organization.permissions.filter(code => code !== 'organization:structure:read') };
  render(<UserAdministration organization={limited} organizations={[limited]} />);
  const management = await openAppointments();
  expect(management.queryByRole('button', { name: '分配角色' })).not.toBeInTheDocument();
  const sources = management.getByText('查看授权来源', { selector: 'button > span' }).closest('button')!;
  expect(sources).toHaveAccessibleName('查看授权来源');
  await clickAndSettle(sources);
  const dialog = await openDialog('alice · 授权来源');
  expect(dialog.getByText('Legacy')).toBeVisible();
  expect(dialog.getByText('历史直接分配（只读）')).toBeVisible();
  expect(fetch.mock.calls.map(([path]) => path)).toContain('/api/v1/admin/users/u1/roles?organizationId=org');
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
  fireEvent.click(screen.getByText('创建用户', { selector: 'button > span' }).closest('button')!);
  const dialog = within(await screen.findByLabelText('创建用户', { selector: '[role="dialog"]' }));
  await choosePosition(dialog, 'Quality engineer · QA');
  fireEvent.click(dialog.getByText('预览授权', { selector: 'button > span' }).closest('button')!);
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
  fireEvent.click(screen.getByText('创建用户', { selector: 'button > span' }).closest('button')!);
  const dialog = await openDialog('创建用户');
  fireEvent.change(dialog.getByLabelText('用户名'), { target: { value: 'alice' } });
  fireEvent.change(dialog.getByLabelText('初始密码'), { target: { value: 'Long-password-123!' } });
  await choosePosition(dialog, 'Quality engineer · QA');
  fireEvent.click(dialog.getByText('预览授权', { selector: 'button > span' }).closest('button')!);
  await dialog.findByLabelText('权限预览', { selector: 'section' });
  await waitFor(() => expect(dialog.getByText('保存用户', { selector: 'button > span' }).closest('button')).toBeEnabled());
  fireEvent.click(dialog.getByText('保存用户', { selector: 'button > span' }).closest('button')!);
  await dialog.findByText('记录已被其他用户更新，请刷新后重试');
  expect(dialog.getByLabelText('用户名')).toHaveValue('alice');
  expect(dialog.getByText('保存用户', { selector: 'button > span' }).closest('button')).toBeDisabled();
  fireEvent.click(dialog.getByText('预览授权', { selector: 'button > span' }).closest('button')!);
  await dialog.findByLabelText('权限预览', { selector: 'section' });
  await waitFor(() => expect(dialog.getByText('保存用户', { selector: 'button > span' }).closest('button')).toBeEnabled());
  fireEvent.click(dialog.getByText('保存用户', { selector: 'button > span' }).closest('button')!);
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
  await act(async () => {
    render(<MemoryRouter><Routes><Route path="/" element={<UserAdministration organization={organization} organizations={[organization]} />} /><Route path="/login" element={<p>Reauthenticate</p>} /></Routes></MemoryRouter>);
  });
  const dialog = await openTransfer();
  expect(dialog.getByText('Former position', { selector: 'td' })).toBeVisible();
  await choosePosition(dialog, 'Quality lead · QE');
  await clickAndSettle(dialog.getByText('预览授权', { selector: 'button > span' }).closest('button')!);
  expect(dialog.getByLabelText('权限预览', { selector: 'section' })).toBeInTheDocument();
  const save = dialog.getByText('保存任职', { selector: 'button > span' }).closest('button')!;
  expect(save).toBeEnabled();
  expect(previewBody).toEqual({ positionIds: ['p1', 'p2'], targetUserId: 'u1' });
  await clickAndSettle(save);
  expect(write).toEqual({ positionIds: ['p1', 'p2'], expectedPositionIds: ['p1'], authorizationBaseline: 'transfer-baseline' });
  if (self) {
    expect(useWorkTabsStore.getState().sessionScope).toBeUndefined();
    expect(screen.getByText('Reauthenticate')).toBeVisible();
    expect(listReads).toBe(1);
  } else expect(useWorkTabsStore.getState().sessionScope).toBe('INTERNAL:org:actor');
});
