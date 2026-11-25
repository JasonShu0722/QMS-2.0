import { render as renderUI, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { StrictMode, type ReactNode } from 'react';
import baseUserEvent from '@testing-library/user-event';
import { ConfigProvider } from 'antd';
import { afterEach, expect, it, vi } from 'vitest';
import { LanguageProvider } from '../../i18n/Language';
import { StructureAdministration } from './StructureAdministration';
import { PositionRolesDrawer } from './PositionRolesDrawer';
import type { AdminOrganization, AdminRole, PermissionCatalogGroup } from '../admin/admin';
import type { components } from '@qms/contracts';
import { useWorkTabsStore } from '../../work-tabs/workTabsStore';
import { UnsavedChangesProvider } from '../../layouts/UnsavedChanges';
import { preferenceKey } from '../../ui/ledger/model';
import { ApiError, registerReauthentication } from '../../api/client';

vi.setConfig({ testTimeout: 30000 });

const userEvent = baseUserEvent.setup();

const position: components['schemas']['PositionDto'] = {
  id: 'position-a', organizationId: 'org-a', departmentId: 'department-a', categoryId: null,
  code: 'P-A', name: '质量工程师', status: 'ACTIVE', version: 2,
};
const roleA: AdminRole = { id: 'role-a', organizationId: 'org-a', code: 'QUALITY', name: '质量角色', mfaRequired: false, permissions: [] };
const catalog: PermissionCatalogGroup[] = [{ key: 'system', name: '系统管理', status: 'active', modules: [
  { key: 'position-test', name: '岗位测试权限', status: 'active', operations: [
    { code: 'workbench:read', name: '查看工作台', enforcement: 'guarded', grantable: true },
    { code: 'audit:read', name: '查看审计', enforcement: 'guarded', grantable: true },
    { code: 'account:users:reset', name: '重置用户', enforcement: 'guarded', grantable: false },
  ] },
] }];
const organization = (permissions: string[]): AdminOrganization => ({ id: 'org-a', code: 'A', name: '甲组织', type: 'INTERNAL', permissions });
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const roleDetails = (roles: AdminRole[] = [roleA]): components['schemas']['PositionPermissionsDto'] => ({
  positionId: position.id, roleVersion: 4, permissionCodes: ['workbench:read'], mfaRequired: false, legacyRoles: roles, effectiveAssigneeCount: 3, selfSessionRevoked: false,
});
const render = (ui: ReactNode) => renderUI(<ConfigProvider theme={{ token: { motion: false } }}>{ui}</ConfigProvider>, { wrapper: MemoryRouter });

function stubStructureApi(details = roleDetails(), permissions: PermissionCatalogGroup[] = catalog) {
  const requests: Array<[string, RequestInit | undefined]> = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input);
    requests.push([path, init]);
    if (path.endsWith('/departments?limit=100&offset=0')) return json([]);
    if (path.endsWith('/positions?limit=100&offset=0')) return json([position]);
    if (path.includes('/admin/permission-catalog?organizationId=org-a')) return json(permissions);
    if (path.endsWith('/positions/position-a/permissions')) {
      if (init?.method === 'PUT') return json(details);
      return json(details);
    }
    if (path.endsWith('/csrf')) return json({ csrfToken: 'csrf-token' });
    return json([]);
  });
  vi.stubGlobal('fetch', fetchMock);
  return { fetchMock, requests };
}

function view(permissions: string[], details = roleDetails()) {
  stubStructureApi(details);
  return render(<LanguageProvider><StructureAdministration organization={organization(permissions)} /></LanguageProvider>);
}

async function positionAction() {
  await userEvent.click(await screen.findByRole('tab', { name: '岗位' }));
  const positionCell = await screen.findByText(position.name, { selector: 'td' });
  return within(positionCell.closest('tr')!).findByRole('button', { name: '岗位权限' });
}

afterEach(() => { vi.unstubAllGlobals(); localStorage.clear(); useWorkTabsStore.getState().reset(); });

it('offers independent column settings for department and position ledgers', async () => {
  view(['organization:structure:read']);
  expect(await screen.findByRole('button', { name: '列设置' })).toBeVisible();
  await userEvent.click(screen.getByRole('tab', { name: '岗位' }));
  await screen.findByText('质量工程师');
  expect(screen.getAllByRole('button', { name: '列设置' }).length).toBeGreaterThanOrEqual(1);
});

it('defaults to compact position columns with room for names, departments and actions', async () => {
  view(['organization:structure:read', 'organization:structure:manage', 'account:roles:read']);
  const action = await positionAction();
  const table = within(action.closest('.position-structure-table')!);
  expect(table.getAllByRole('separator', { name: /^调整列宽/ }).map(handle => Number(handle.getAttribute('aria-valuenow'))))
    .toEqual([96, 184, 72, 156, 112, 200]);
  const row = within(action.closest('tr')!);
  expect(row.getAllByRole('button')).toEqual([row.getByRole('button', { name: /^编\s*辑$/ }), action, row.getByRole('button', { name: `删除岗位 · ${position.name}` })]);
});

it('confirms normal position deletion without issuing a force request and refreshes the list', async () => {
  let deleted = false;
  const path = '/api/v1/organizations/org-a/positions/position-a';
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith('/positions?limit=100&offset=0')) return json(deleted ? [] : [position]);
    if (url.endsWith('/csrf')) return json({ csrfToken: 'csrf-token' });
    if (url.endsWith(path) && init?.method === 'DELETE') { deleted = true; return json({ id: position.id, deleted: true }); }
    return json([]);
  });
  vi.stubGlobal('fetch', fetchMock);
  render(<LanguageProvider><StructureAdministration organization={organization(['organization:structure:read', 'organization:structure:manage', 'organization:positions:force-delete'])} /></LanguageProvider>);
  await userEvent.click(await screen.findByRole('tab', { name: '岗位' }));
  await userEvent.click(await screen.findByRole('button', { name: `删除岗位 · ${position.name}` }));
  expect(fetchMock.mock.calls.some(([url, init]) => String(url).includes('/force-delete') || init?.method === 'DELETE')).toBe(false);
  await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '确认删除' }));
  await waitFor(() => expect(screen.queryByText(position.name, { selector: 'td' })).not.toBeInTheDocument());
  expect(fetchMock.mock.calls.find(([url, init]) => String(url).endsWith(path) && init?.method === 'DELETE')?.[1]?.body).toBe(JSON.stringify({ expectedVersion: position.version }));
});

it('does not expose position deletion to a reader', async () => {
  view(['organization:structure:read']);
  await userEvent.click(await screen.findByRole('tab', { name: '岗位' }));
  await screen.findByText(position.name, { selector: 'td' });
  expect(screen.queryByRole('button', { name: `删除岗位 · ${position.name}` })).not.toBeInTheDocument();
});

it.each([false, true])('keeps ordinary delete explicitly retryable after reauthentication (cancelled: %s)', async cancelled => {
  const remove = vi.fn();
  const unregister = registerReauthentication(async () => {
    if (cancelled) throw new ApiError({ code: 'CLIENT_REAUTHENTICATION_CANCELLED', message: '' }, 400);
  });
  try {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/positions?limit=100&offset=0')) return json(remove.mock.calls.length === 2 ? [] : [position]);
      if (url.endsWith('/csrf')) return json({ csrfToken: 'csrf-token' });
      if (url.endsWith(`/positions/${position.id}`) && init?.method === 'DELETE') {
        remove(init);
        return remove.mock.calls.length === 1 ? json({ code: 'AUTH_REAUTHENTICATION_REQUIRED' }, 401) : json({ id: position.id, deleted: true });
      }
      return json([]);
    }));
    render(<LanguageProvider><StructureAdministration organization={organization(['organization:structure:read', 'organization:structure:manage'])} /></LanguageProvider>);
    await userEvent.click(await screen.findByRole('tab', { name: '岗位' }));
    await userEvent.click(await screen.findByRole('button', { name: `删除岗位 · ${position.name}` }));
    const dialog = within(screen.getByRole('dialog'));
    await userEvent.click(dialog.getByRole('button', { name: '确认删除' }));
    await dialog.findByText(cancelled ? /已取消身份验证/ : /身份验证已完成/);
    expect(remove).toHaveBeenCalledOnce();
    expect(dialog.getByRole('button', { name: '确认删除' })).toBeEnabled();
    await userEvent.click(dialog.getByRole('button', { name: '确认删除' }));
    await waitFor(() => expect(screen.queryByText(position.name, { selector: 'td' })).not.toBeInTheDocument());
  } finally { unregister(); }
});

it('previews force deletion after a reference conflict and confirms with that baseline', async () => {
  const path = '/api/v1/organizations/org-a/positions/position-a';
  const preview: components['schemas']['OrganizationForceDeletePreviewDto'] = {
    id: position.id, name: position.name, code: position.code, kind: 'POSITION', version: position.version, previewToken: 'a'.repeat(64),
    counts: { users: 2, positions: 1, assignments: 2, departments: 0, organizations: 0, managementBindings: 0, ministerScopes: 0 },
    retainedHistory: ['历史签章'], positionImpact: { users: [{ id: 'user-a', name: '甲', pendingConfiguration: true }, { id: 'user-b', name: '乙', pendingConfiguration: false }], assignments: [], responsibilities: [], configurations: [{ source: '制程8D', count: 1 }] },
  };
  const command = vi.fn();
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith('/positions?limit=100&offset=0')) return json(command.mock.calls.length ? [] : [position]);
    if (url.endsWith('/csrf')) return json({ csrfToken: 'csrf-token' });
    if (url.endsWith(path) && init?.method === 'DELETE') return json({ code: 'STRUCTURE_REFERENCE_INVALID' }, 409);
    if (url.endsWith(`${path}/force-delete`)) {
      if (init?.method === 'POST') { command(init); return json({ ...preview, deletedAt: new Date().toISOString(), effects: [] }, 201); }
      return json(preview);
    }
    return json([]);
  }));
  render(<LanguageProvider><StructureAdministration organization={organization(['organization:structure:read', 'organization:structure:manage', 'organization:positions:force-delete'])} /></LanguageProvider>);
  await userEvent.click(await screen.findByRole('tab', { name: '岗位' }));
  await userEvent.click(await screen.findByRole('button', { name: `删除岗位 · ${position.name}` }));
  const dialog = within(screen.getByRole('dialog'));
  await userEvent.click(dialog.getByRole('button', { name: '确认删除' }));
  await dialog.findByText(/岗位已被引用/);
  expect(command).not.toHaveBeenCalled();
  await userEvent.click(dialog.getByRole('button', { name: '查看强制删除影响' }));
  expect(await dialog.findByText('甲 · 进入待配置')).toBeVisible();
  expect(dialog.getByText('乙 · 保留其他任职')).toBeVisible();
  expect(dialog.getByText('制程8D：1')).toBeVisible();
  expect(command).not.toHaveBeenCalled();
  await userEvent.click(dialog.getByRole('button', { name: '确认强制删除' }));
  await waitFor(() => expect(command).toHaveBeenCalledOnce());
  expect(JSON.parse(command.mock.calls[0]![0].body)).toEqual({ expectedVersion: position.version, confirmed: true, previewToken: preview.previewToken });
});

it('keeps saved position column preferences until the user resets them', async () => {
  const sessionScope = 'INTERNAL:org-a:current';
  useWorkTabsStore.getState().bindSession(sessionScope);
  const key = preferenceKey({ sessionScope }, 'structure-positions:all', 'columns')!;
  const saved = JSON.stringify({ schema: 1, value: {
    order: ['code', 'departmentId', 'name', 'status', 'categoryId', 'actions'],
    visible: ['code', 'departmentId', 'name', 'status', 'actions'],
    widths: { departmentId: 260 }, fixed: { code: 'left' },
  } });
  localStorage.setItem(key, saved);
  view(['organization:structure:read', 'account:roles:read']);
  const action = await positionAction();
  const ledger = within(action.closest('.qms-ledger')!);
  expect(ledger.getAllByRole('columnheader').map(header => header.getAttribute('aria-label'))).toEqual(['代码', '部门', '名称', '状态', '操作']);
  expect(ledger.getByRole('separator', { name: '调整列宽 部门' })).toHaveAttribute('aria-valuenow', '260');
  expect(localStorage.getItem(key)).toBe(saved);

  await userEvent.click(ledger.getByRole('button', { name: '列设置' }));
  await userEvent.click(await screen.findByRole('button', { name: '恢复全部列' }));
  expect(ledger.getAllByRole('columnheader').map(header => header.getAttribute('aria-label'))).toEqual(['代码', '名称', '状态', '部门', '岗位类别', '操作']);
  expect(ledger.getByRole('separator', { name: '调整列宽 部门' })).toHaveAttribute('aria-valuenow', '156');
});

it('only exposes the position-permission entry when both read permissions are present', async () => {
  const complete = view(['organization:structure:read', 'account:roles:read']);
  expect(await positionAction()).toBeInTheDocument();
  complete.unmount();

  const missingRoles = view(['organization:structure:read']);
  await userEvent.click(await screen.findByRole('tab', { name: '岗位' }));
  expect(screen.queryByRole('button', { name: '岗位权限' })).not.toBeInTheDocument();
  missingRoles.unmount();
  view(['account:roles:read']);
  await userEvent.click(await screen.findByRole('tab', { name: '岗位' }));
  expect(screen.queryByRole('button', { name: '岗位权限' })).not.toBeInTheDocument();
});

it('loads the scoped permission catalog and shows read-only permission data without allowing writes', async () => {
  const { requests } = stubStructureApi();
  render(<LanguageProvider><StructureAdministration organization={organization(['organization:structure:read', 'account:roles:read'])} /></LanguageProvider>);
  await userEvent.click(await positionAction());

  const dialog = await screen.findByRole('dialog');
  expect(within(dialog).getByText('质量角色')).toBeInTheDocument();
  expect(within(dialog).getByText('角色版本：4')).toBeInTheDocument();
  expect(within(dialog).getByText('当前有效任职人数：3')).toBeInTheDocument();
  expect(within(dialog).getByRole('checkbox', { name: '岗位测试权限 · 查看工作台' })).toBeChecked();
  expect(within(dialog).getByRole('checkbox', { name: '岗位测试权限 · 查看工作台' })).toBeDisabled();
  expect(within(dialog).queryByRole('button', { name: '保存' })).not.toBeInTheDocument();
  expect(within(dialog).getByText('历史兼容授权')).toBeInTheDocument();
  expect(within(dialog).getByText('历史兼容授权仍然生效，取消岗位自有权限不会撤销历史来源。')).toBeInTheDocument();
  expect(within(dialog).queryByRole('combobox', { name: '岗位角色' })).not.toBeInTheDocument();
  expect(requests.some(([path]) => path === '/api/v1/organizations/org-a/positions/position-a/permissions')).toBe(true);
  expect(requests.some(([path]) => path === '/api/v1/admin/permission-catalog?organizationId=org-a')).toBe(true);
  expect(requests.some(([, init]) => init?.method === 'PUT')).toBe(false);
});

it.each([false, true])('shows the historical-source impact only when legacy roles exist: %s', async (hasLegacyRoles) => {
  view(['organization:structure:read', 'account:roles:read'], roleDetails(hasLegacyRoles ? [roleA] : []));
  await userEvent.click(await positionAction());
  const dialog = screen.getByRole('dialog');
  await within(dialog).findByText('角色版本：4');
  const impact = within(dialog).queryByText('历史兼容授权仍然生效，取消岗位自有权限不会撤销历史来源。');
  if (hasLegacyRoles) expect(impact).toBeInTheDocument();
  else expect(impact).not.toBeInTheDocument();
});

it('edits position-owned permissions and sends the CAS PUT with CSRF and idempotency', async () => {
  const { requests } = stubStructureApi(roleDetails([roleA]));
  render(<LanguageProvider><StructureAdministration organization={organization(['organization:structure:read', 'organization:structure:manage', 'account:roles:read', 'account:roles:update', 'account:roles:assign'])} /></LanguageProvider>);
  await userEvent.click(await positionAction());
  const dialog = await screen.findByRole('dialog');
  const selector = await within(dialog).findByRole('checkbox', { name: '岗位测试权限 · 查看审计' });
  expect(selector).toBeEnabled();
  await userEvent.click(selector);

  await userEvent.click(within(dialog).getByRole('button', { name: '保存' }));

  await waitFor(() => expect(requests.some(([, init]) => init?.method === 'PUT')).toBe(true));
  const [, init] = requests.find(([, value]) => value?.method === 'PUT')!;
  expect(init).toMatchObject({ method: 'PUT', headers: { 'x-csrf-token': 'csrf-token', 'Idempotency-Key': expect.any(String) }, body: JSON.stringify({ permissionCodes: ['workbench:read', 'audit:read'], expectedPermissionCodes: ['workbench:read'], mfaRequired: false, expectedMfaRequired: false, expectedRoleVersion: 4 }) });
}, 30000);

it('selects all and only real grantable catalog permissions without removing retained unknown permissions', async () => {
  const details = { ...roleDetails(), permissionCodes: ['legacy:unknown'] };
  const { requests } = stubStructureApi(details, [...catalog, { key: 'planned', name: '待接入', status: 'planned', modules: [{ key: 'planned', name: '未生效模块', status: 'planned', operations: [{ code: 'future:read', name: '未来权限', enforcement: 'reserved', grantable: true }] }] }]);
  render(<LanguageProvider><StructureAdministration organization={organization(writable)} /></LanguageProvider>);
  await userEvent.click(await positionAction());
  const dialog = screen.getByRole('dialog');
  await userEvent.click(await within(dialog).findByRole('button', { name: '选择全部可授予权限' }));
  expect(within(dialog).getByRole('checkbox', { name: '岗位测试权限 · 重置用户' })).not.toBeChecked();
  await userEvent.click(within(dialog).getByRole('button', { name: '保存' }));
  await waitFor(() => expect(requests.some(([, init]) => init?.method === 'PUT')).toBe(true));
  expect(JSON.parse(requests.find(([, init]) => init?.method === 'PUT')![1]!.body as string).permissionCodes).toEqual(['legacy:unknown', 'workbench:read', 'audit:read']);
}, 30000);

it('keeps the selected draft and asks for reload after a CAS conflict', async () => {
  const { requests } = stubStructureApi(roleDetails([roleA]));
  const fetchMock = vi.mocked(globalThis.fetch);
  let reads = 0;
  let writes = 0;
  fetchMock.mockImplementationOnce(async (input, init) => {
    const path = String(input);
    requests.push([path, init]);
    if (path.endsWith('/departments?limit=100&offset=0')) return json([]);
    if (path.endsWith('/positions?limit=100&offset=0')) return json([position]);
    return json([]);
  });
  fetchMock.mockImplementation(async (input, init) => {
    const path = String(input);
    requests.push([path, init]);
    if (path.endsWith('/departments?limit=100&offset=0')) return json([]);
    if (path.endsWith('/positions?limit=100&offset=0')) return json([position]);
    if (path.endsWith('/csrf')) return json({ csrfToken: 'csrf-token' });
    if (path.includes('/admin/permission-catalog?organizationId=org-a')) return json(catalog);
    if (path.endsWith('/positions/position-a/permissions') && init?.method === 'PUT') return ++writes === 1 ? json({ code: 'CONCURRENCY_CONFLICT' }, 409) : json({ ...roleDetails([roleA]), roleVersion: 6 });
    if (path.endsWith('/positions/position-a/permissions')) return json(++reads === 1 ? roleDetails() : { ...roleDetails(), roleVersion: 5, permissionCodes: ['audit:read'], mfaRequired: true });
    return json([]);
  });
  render(<LanguageProvider><StructureAdministration organization={organization(['organization:structure:read', 'organization:structure:manage', 'account:roles:read', 'account:roles:update', 'account:roles:assign'])} /></LanguageProvider>);
  await userEvent.click(await positionAction());
  const dialog = await screen.findByRole('dialog');
  await userEvent.click(await within(dialog).findByRole('checkbox', { name: '岗位测试权限 · 查看审计' }));

  await userEvent.click(within(dialog).getByRole('button', { name: '保存' }));

  expect(await within(dialog).findByText('内容已被其他人修改。已保留当前填写内容，请重新加载后再保存。')).toBeInTheDocument();
  expect(within(dialog).getByRole('checkbox', { name: '岗位测试权限 · 查看审计' })).toBeChecked();
  expect(within(dialog).getByRole('button', { name: '重新加载岗位权限' })).toBeInTheDocument();
  expect(within(dialog).getByRole('checkbox', { name: '岗位测试权限 · 查看审计' })).toBeChecked();
  expect(within(dialog).getByRole('button', { name: '保存' })).toBeDisabled();
  await userEvent.click(within(dialog).getByRole('button', { name: '重新加载岗位权限' }));
  expect(await within(dialog).findByText('角色版本：5')).toBeInTheDocument();
  expect(within(dialog).getByRole('checkbox', { name: '岗位测试权限 · 查看审计' })).toBeChecked();
  expect(within(dialog).getByRole('checkbox', { name: '岗位测试权限 · 查看工作台' })).toBeChecked();
  expect(within(dialog).getByRole('switch', { name: '要求 MFA' })).not.toBeChecked();
  expect(writes).toBe(1);
  await userEvent.click(within(dialog).getByRole('button', { name: '保存' }));
  expect(await within(dialog).findByText('角色版本：6')).toBeInTheDocument();
  const puts = requests.filter(([, init]) => init?.method === 'PUT');
  expect(JSON.parse(puts[1][1]!.body as string)).toEqual({ permissionCodes: ['workbench:read', 'audit:read'], expectedPermissionCodes: ['audit:read'], mfaRequired: false, expectedMfaRequired: true, expectedRoleVersion: 5 });
  expect((puts[0][1]!.headers as Record<string, string>)['Idempotency-Key']).not.toBe((puts[1][1]!.headers as Record<string, string>)['Idempotency-Key']);
}, 30000);

it('ignores a late permission response after switching organizations and clears the old panel', async () => {
  const pending: { resolve?: (value: Response) => void } = {};
  const fetchMock = vi.fn((input: RequestInfo | URL) => {
    const path = String(input);
    if (path.endsWith('/positions/position-a/permissions')) return new Promise<Response>((resolve) => { pending.resolve = resolve; });
    if (path.endsWith('/departments?limit=100&offset=0') || path.endsWith('/positions?limit=100&offset=0')) return Promise.resolve(json(path.includes('/positions?') ? [position] : []));
    if (path.includes('/admin/permission-catalog?organizationId=org-a')) return Promise.resolve(json(catalog));
    return Promise.resolve(json([]));
  });
  vi.stubGlobal('fetch', fetchMock);
  const result = render(<LanguageProvider><StructureAdministration organization={organization(['organization:structure:read', 'account:roles:read'])} /></LanguageProvider>);
  await userEvent.click(await positionAction());
  result.rerender(<LanguageProvider><StructureAdministration organization={organization(['organization:structure:read'])} /></LanguageProvider>);
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  pending.resolve?.(json(roleDetails()));
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(screen.queryByText('角色版本：4')).not.toBeInTheDocument();
});

it('keeps the position table locally scrollable and exposes row actions to the keyboard', async () => {
  view(['organization:structure:read', 'account:roles:read']);
  const action = await positionAction();
  expect(action.closest('.ant-table-wrapper')).toHaveClass('position-structure-table');
  action.focus();
  expect(action).toHaveFocus();
  await userEvent.keyboard('{Enter}');
  expect(await screen.findByRole('dialog')).toBeInTheDocument();
});

const writable = ['organization:structure:read', 'organization:structure:manage', 'account:roles:read', 'account:roles:update', 'account:roles:assign'];
function Destination() { return <output aria-label="route">{useLocation().pathname}</output>; }

it.each(['read', 'reload', 'save'])('ends the current session on an ordinary position permission %s 401, including dirty drafts', async (phase) => {
  const { fetchMock } = stubStructureApi(); const original = fetchMock.getMockImplementation()!;
  let unauthorizedRead = phase === 'read';
  fetchMock.mockImplementation((input, init) => {
    if (String(input).endsWith('/positions/position-a/permissions')) {
      if (init?.method === 'PUT') { if (phase === 'reload') { unauthorizedRead = true; return Promise.resolve(json({ code: 'HTTP_503' }, 503)); } return Promise.resolve(json({ code: 'AUTH_SESSION_REQUIRED' }, 401)); }
      if (unauthorizedRead) return Promise.resolve(json({ code: 'AUTH_SESSION_REQUIRED' }, 401));
    }
    return original(input, init);
  });
  useWorkTabsStore.getState().bindSession('INTERNAL:org-a:current');
  useWorkTabsStore.getState().openTab({ id: 'private', path: '/app/account', title: 'Private' });
  render(<LanguageProvider><UnsavedChangesProvider><PositionRolesDrawer organization={organization(writable)} position={position} canWrite onClose={vi.fn()} afterClose={vi.fn()} /><Destination /></UnsavedChangesProvider></LanguageProvider>);
  if (phase !== 'read') {
    await userEvent.click(await screen.findByRole('checkbox', { name: '岗位测试权限 · 查看审计' }));
    await userEvent.click(screen.getByRole('button', { name: '保存' }));
    if (phase === 'reload') await userEvent.click(await screen.findByRole('button', { name: '重新加载岗位权限' }));
  }
  await waitFor(() => expect(screen.getByLabelText('route')).toHaveTextContent('/login'));
  expect(useWorkTabsStore.getState().sessionScope).toBeUndefined();
  expect(useWorkTabsStore.getState().tabs).toEqual([]);
  expect(screen.queryByRole('button', { name: '保存' })).not.toBeInTheDocument();
}, 30000);

it('ignores an old position permission read 401 after a new session is bound', async () => {
  const { fetchMock } = stubStructureApi(); const original = fetchMock.getMockImplementation()!;
  let resolve!: (value: Response) => void;
  fetchMock.mockImplementation((input, init) => String(input).endsWith('/positions/position-a/permissions') ? new Promise<Response>(done => { resolve = done; }) : original(input, init));
  useWorkTabsStore.getState().bindSession('INTERNAL:org-a:old');
  render(<LanguageProvider><PositionRolesDrawer organization={organization(writable)} position={position} canWrite onClose={vi.fn()} afterClose={vi.fn()} /><Destination /></LanguageProvider>);
  await waitFor(() => expect(resolve).toBeTypeOf('function'));
  useWorkTabsStore.getState().bindSession('INTERNAL:org-b:new');
  resolve(json({ code: 'AUTH_SESSION_REQUIRED' }, 401));
  await new Promise(done => setTimeout(done, 0));
  expect(useWorkTabsStore.getState().sessionScope).toBe('INTERNAL:org-b:new');
  expect(screen.getByLabelText('route')).not.toHaveTextContent('/login');
}, 30000);

it.each(['organization', 'account'])('ignores a revoked-session save response from an old %s context', async (changed) => {
  const { fetchMock } = stubStructureApi();
  const original = fetchMock.getMockImplementation()!;
  let resolveSave: (response: Response) => void = () => {};
  fetchMock.mockImplementation((input, init) => init?.method === 'PUT' ? new Promise<Response>((resolve) => { resolveSave = resolve; }) : original(input, init));
  const result = render(<LanguageProvider><StructureAdministration organization={organization(writable)} /><Destination /></LanguageProvider>);
  const trigger = await positionAction();
  await userEvent.click(trigger);
  const drawer = screen.getByRole('dialog');
  await within(drawer).findByText('角色版本：4');
  const save = within(drawer).getByRole('button', { name: '保存' });
  await userEvent.click(save);
  await waitFor(() => expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'PUT')).toBe(true));
  useWorkTabsStore.getState().bindSession('INTERNAL:org-b:new-user');
  useWorkTabsStore.getState().openTab({ id: 'new', path: '/app/account', title: '新上下文' });
  result.rerender(<LanguageProvider><StructureAdministration organization={{ ...organization(writable), id: changed === 'organization' ? 'org-b' : 'org-a' }} /><Destination /></LanguageProvider>);
  resolveSave(json({ ...roleDetails(), selfSessionRevoked: true }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(screen.getByLabelText('route')).toHaveTextContent(/^\/$/);
  expect(useWorkTabsStore.getState().sessionScope).toBe('INTERNAL:org-b:new-user');
  expect(useWorkTabsStore.getState().tabs.map(({ id }) => id)).toContain('new');
});

it.each(['organization:structure:manage', 'account:roles:update', 'account:roles:assign'])('keeps position permissions read-only without %s', async (missing) => {
  const { requests } = stubStructureApi();
  render(<LanguageProvider><StructureAdministration organization={organization(writable.filter((permission) => permission !== missing))} /></LanguageProvider>);
  await userEvent.click(await positionAction());
  expect(await screen.findByText('角色版本：4')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '保存' })).not.toBeInTheDocument();
  expect(screen.queryByRole('combobox', { name: '岗位权限' })).not.toBeInTheDocument();
  expect(requests.some(([, init]) => init?.method === 'PUT')).toBe(false);
});

it('protects a busy save from close and duplicate submission, then returns focus after closing', async () => {
  const { fetchMock, requests } = stubStructureApi();
  const original = fetchMock.getMockImplementation()!;
  let resolveSave: (response: Response) => void = () => {};
  fetchMock.mockImplementation((input, init) => {
    if (init?.method === 'PUT') { requests.push([String(input), init]); return new Promise<Response>((resolve) => { resolveSave = resolve; }); }
    return original(input, init);
  });
  render(<LanguageProvider><StructureAdministration organization={organization(writable)} /></LanguageProvider>);
  const trigger = await positionAction();
  await userEvent.click(trigger);
  const drawer = screen.getByRole('dialog');
  await within(drawer).findByText('角色版本：4');
  const save = within(drawer).getByRole('button', { name: '保存' });
  await userEvent.dblClick(save);
  await waitFor(() => expect(requests.filter(([, init]) => init?.method === 'PUT')).toHaveLength(1));
  await userEvent.keyboard('{Escape}');
  expect(screen.getByRole('dialog')).toBeInTheDocument();
  expect(save).toBeDisabled();
  resolveSave(json(roleDetails()));
  await waitFor(() => expect(save).toBeEnabled());
  await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '关闭' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(trigger).toHaveFocus();
}, 30000);

it('ends the current session after a successful self revocation without replaying the committed write', async () => {
  const { fetchMock, requests } = stubStructureApi();
  const original = fetchMock.getMockImplementation()!;
  useWorkTabsStore.getState().bindSession('INTERNAL:org-a:current');
  useWorkTabsStore.getState().openTab({ id: 'private', path: '/app/account', title: 'Private' });
  fetchMock.mockImplementation((input, init) => {
    if (init?.method === 'PUT') { requests.push([String(input), init]); return Promise.resolve(json({ ...roleDetails(), selfSessionRevoked: true })); }
    return original(input, init);
  });
  render(<LanguageProvider><StructureAdministration organization={organization(writable)} /><Destination /></LanguageProvider>);
  await userEvent.click(await positionAction());
  const drawer = screen.getByRole('dialog');
  await within(drawer).findByText('角色版本：4');
  await userEvent.click(within(drawer).getByRole('button', { name: '保存' }));
  await waitFor(() => expect(screen.getByLabelText('route')).toHaveTextContent('/login'));
  expect(useWorkTabsStore.getState().tabs).toEqual([]);
  expect(useWorkTabsStore.getState().sessionScope).toBeUndefined();
  expect(requests.filter(([, init]) => init?.method === 'PUT')).toHaveLength(1);
  expect(screen.queryByRole('button', { name: '保存' })).not.toBeInTheDocument();
});

it('starts a fresh StrictMode load and ignores its older response when responses arrive in reverse order', async () => {
  const { fetchMock } = stubStructureApi();
  const original = fetchMock.getMockImplementation()!;
  const reads: Array<(response: Response) => void> = [];
  fetchMock.mockImplementation((input, init) => String(input).endsWith('/positions/position-a/permissions')
    ? new Promise<Response>((resolve) => reads.push(resolve)) : original(input, init));
  render(<StrictMode><LanguageProvider><StructureAdministration organization={organization(writable)} /></LanguageProvider></StrictMode>);
  await userEvent.click(await positionAction());
  await waitFor(() => expect(reads).toHaveLength(2));
  reads[1](json({ ...roleDetails([roleA]), roleVersion: 9 }));
  expect(await screen.findByText('角色版本：9')).toBeInTheDocument();
  reads[0](json(roleDetails([roleA])));
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(screen.getByText('角色版本：9')).toBeInTheDocument();
  expect(screen.queryByText('角色版本：4')).not.toBeInTheDocument();
});

it('shows ungrantable permissions disabled and keeps legacy sources read-only', async () => {
  const restricted: AdminRole = { ...roleA, permissions: [{ id: 'permission-secret', code: 'account:users:reset', name: '重置用户' }] };
  stubStructureApi(roleDetails([restricted]));
  render(<LanguageProvider><StructureAdministration organization={organization(writable)} /></LanguageProvider>);
  await userEvent.click(await positionAction());
  const dialog = await screen.findByRole('dialog');
  expect(await within(dialog).findByRole('checkbox', { name: '岗位测试权限 · 重置用户' })).toBeDisabled();
  expect(within(dialog).getByText('质量角色')).toBeInTheDocument();
  expect(within(dialog).getByText('历史兼容授权仍然生效，取消岗位自有权限不会撤销历史来源。')).toBeInTheDocument();
  expect(within(dialog).queryByRole('combobox', { name: '岗位角色' })).not.toBeInTheDocument();
});

it('includes MFA changes and the original MFA baseline in the permissions CAS', async () => {
  const { requests } = stubStructureApi();
  render(<LanguageProvider><StructureAdministration organization={organization(writable)} /></LanguageProvider>);
  await userEvent.click(await positionAction());
  const drawer = await screen.findByRole('dialog');
  await userEvent.click(await within(drawer).findByRole('switch', { name: '要求 MFA' }));
  await userEvent.click(within(drawer).getByRole('button', { name: '保存' }));
  await waitFor(() => expect(requests.some(([, init]) => init?.method === 'PUT')).toBe(true));
  expect(JSON.parse(requests.find(([, init]) => init?.method === 'PUT')![1]!.body as string)).toMatchObject({ mfaRequired: true, expectedMfaRequired: false, expectedPermissionCodes: ['workbench:read'] });
});

it('retains a dirty selection when close is cancelled and discards it only after explicit confirmation', async () => {
  const { requests } = stubStructureApi();
  render(<LanguageProvider><StructureAdministration organization={organization(writable)} /></LanguageProvider>);
  const trigger = await positionAction();
  await userEvent.click(trigger);
  const drawer = await screen.findByRole('dialog');
  await userEvent.click(await within(drawer).findByRole('checkbox', { name: '岗位测试权限 · 查看审计' }));

  await userEvent.click(within(drawer).getByRole('button', { name: '关闭' }));
  // AntD uses the same test title ID in both portals, so scope by the visible modal title.
  let confirmation = (await screen.findByText('放弃未保存的修改？')).closest('[role="dialog"]') as HTMLElement;
  await userEvent.click(within(confirmation).getByRole('button', { name: /取\s*消/ }));
  expect(within(drawer).getByRole('checkbox', { name: '岗位测试权限 · 查看审计' })).toBeChecked();
  await userEvent.click(within(drawer).getByRole('button', { name: '关闭' }));
  confirmation = (await screen.findByText('放弃未保存的修改？')).closest('[role="dialog"]') as HTMLElement;
  await userEvent.click(within(confirmation).getByRole('button', { name: '放弃修改并关闭' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  await waitFor(() => expect(trigger).toHaveFocus());
  expect(requests.some(([, init]) => init?.method === 'PUT')).toBe(false);
}, 30000);

it('retries a failed transport with the same idempotency key and retains the draft', async () => {
  const { fetchMock, requests } = stubStructureApi();
  const original = fetchMock.getMockImplementation()!;
  let writes = 0;
  fetchMock.mockImplementation((input, init) => {
    if (init?.method === 'PUT') {
      requests.push([String(input), init]);
      return Promise.resolve(++writes === 1 ? json({ code: 'HTTP_503' }, 503) : json({ ...roleDetails(), roleVersion: 5 }));
    }
    return original(input, init);
  });
  render(<LanguageProvider><StructureAdministration organization={organization(writable)} /></LanguageProvider>);
  await userEvent.click(await positionAction());
  const drawer = await screen.findByRole('dialog');
  await userEvent.click(await within(drawer).findByRole('button', { name: '保存' }));
  await within(drawer).findByRole('button', { name: '重新加载岗位权限' });
  expect(writes).toBe(1);
  await userEvent.click(within(drawer).getByRole('button', { name: '保存' }));
  expect(await screen.findByText('角色版本：5')).toBeInTheDocument();
  const puts = requests.filter(([, init]) => init?.method === 'PUT');
  expect(puts[1][1]!.body).toBe(puts[0][1]!.body);
  expect((puts[1][1]!.headers as Record<string, string>)['Idempotency-Key']).toBe((puts[0][1]!.headers as Record<string, string>)['Idempotency-Key']);
}, 30000);

it('uses the shared English position permission labels and keeps conflict recovery readable', async () => {
  localStorage.setItem('qms:locale:v1', 'en-US');
  const { fetchMock } = stubStructureApi();
  const original = fetchMock.getMockImplementation()!;
  fetchMock.mockImplementation((input, init) => init?.method === 'PUT'
    ? Promise.resolve(json({ code: 'CONCURRENCY_CONFLICT' }, 409)) : original(input, init));
  render(<LanguageProvider><StructureAdministration organization={organization(writable)} /></LanguageProvider>);
  await userEvent.click(await screen.findByRole('tab', { name: 'Position' }));
  const positionCell = await screen.findByText(position.name, { selector: 'td' });
  await userEvent.click(within(positionCell.closest('tr')!).getByRole('button', { name: 'Position permissions' }));
  const drawer = await screen.findByRole('dialog');
  expect(await within(drawer).findByText('Role version：4')).toBeInTheDocument();
  expect(within(drawer).getByText('Current assignees：3')).toBeInTheDocument();
  expect(within(drawer).getByRole('switch', { name: 'Require MFA' })).toBeEnabled();
  await userEvent.click(within(drawer).getByRole('button', { name: 'Save' }));
  expect(await within(drawer).findByText('Another user changed this configuration. Your draft is preserved. Reload before saving.')).toBeInTheDocument();
  expect(within(drawer).getByRole('button', { name: 'Reload position permissions' })).toBeInTheDocument();
  expect(within(drawer).queryByText('岗位权限保存后，当前有效任职会自动生效。')).not.toBeInTheDocument();
}, 30000);
