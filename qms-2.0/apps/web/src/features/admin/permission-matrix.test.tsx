import { render, screen, within, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { ConfigProvider } from 'antd';
import baseUserEvent, { PointerEventsCheckLevel } from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import type { components } from '@qms/contracts';
import { AdminPage } from './AdminPage';
import { UserAdministration } from './UserAdministration';
import { RoleAdministration } from './RoleAdministration';
import { GroupedPermissionSelector } from './GroupedPermissionSelector';
import type { AdminOrganization, AdminRole, AdminUser } from './admin';

vi.setConfig({ testTimeout: 30_000 });

const interaction = baseUserEvent.setup({ pointerEventsCheck: PointerEventsCheckLevel.Never });
const organization: AdminOrganization = { id: 'org-a', code: 'a', name: '甲组织', type: 'INTERNAL', permissions: ['account:roles:read', 'account:roles:update'] };
const catalog: components['schemas']['PermissionCatalogGroupDto'][] = [
  { key: 'platform', name: '平台功能', status: 'active', modules: [{ key: 'workbench', name: '工作台', status: 'active', operations: [{ code: 'workbench:read', name: '查看', enforcement: 'reserved', grantable: true }] }] },
  { key: 'supplier', name: '供应商质量', status: 'planned', modules: [{ key: 'supplier-management', name: '供应商管理', status: 'planned', operations: [] }] },
  { key: 'system', name: '系统管理目录', status: 'active', modules: [{ key: 'users', name: '用户管理', status: 'active', operations: [
    { code: 'account:users:read', name: '查看', enforcement: 'guarded', grantable: true },
    { code: 'account:users:create', name: '新建', enforcement: 'guarded', grantable: true },
    { code: 'account:users:reset', name: '重置密码', enforcement: 'guarded', grantable: false },
  ] }] },
];
const originalCodes = ['workbench:read', 'account:users:reset'];
const roles: AdminRole[] = [
  { mfaRequired: false, id: 'role-a', code: 'FIRST', name: '第一角色', organizationId: organization.id, permissions: originalCodes.map((code) => ({ id: code, code, name: code })) },
  { mfaRequired: false, id: 'role-b', code: 'SECOND', name: '第二角色', organizationId: organization.id, permissions: [] },
  { mfaRequired: false, id: 'global', code: 'GLOBAL', name: '全局角色', organizationId: null, permissions: [] },
];
const account: AdminUser = { id: 'user', username: 'alice', email: 'alice@example.test', accountType: 'INTERNAL', status: 'ACTIVE', organizationId: organization.id, organization: { id: organization.id, name: organization.name, code: organization.code }, mfaEnabled: false, createdAt: '2026-09-18', updatedAt: '2026-09-18' };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
function server(patch?: (init: RequestInit) => Response | Promise<Response>) {
  const fetch = vi.fn((path: string, init: RequestInit) => {
    if (path.endsWith('/csrf')) return Promise.resolve(json({ csrfToken: 'csrf' }));
    if (init.method === 'PATCH' || init.method === 'POST') return Promise.resolve(patch?.(init) ?? json(roles[0]));
    return Promise.resolve(json(path.includes('/permission-catalog') ? catalog : path.includes('/users?') ? [account] : roles));
  });
  vi.stubGlobal('fetch', fetch);
  return fetch;
}
async function openMatrix(permissions = organization.permissions, extra: AdminOrganization[] = []) {
  render(<ConfigProvider theme={{ token: { motion: false } }}><AdminPage organizations={[{ ...organization, permissions }, ...extra]} /></ConfigProvider>);
  await interaction.click(screen.getByRole('tab', { name: '权限矩阵' }));
  await screen.findByRole('combobox', { name: '选择角色' });
  await screen.findByRole('checkbox', { name: '用户管理 · 查看' });
}
async function select(name: string, option: string) {
  await interaction.click(screen.getByRole('combobox', { name }));
  await interaction.click(screen.getByText(option, { selector: '.ant-select-item-option-content' }));
}
afterEach(() => vi.unstubAllGlobals());

function ControlledSelector({ initialCodes = originalCodes, onChange }: { initialCodes?: string[]; onChange: (codes: string[]) => void }) {
  const [codes, setCodes] = useState(initialCodes);
  return <GroupedPermissionSelector catalog={catalog} value={codes} onChange={(next) => { setCodes(next); onChange(next); }} />;
}

it('reflects module selection as unchecked, partial and all, then clears only grantable operations', async () => {
  const onChange = vi.fn();
  render(<ControlledSelector onChange={onChange} />);
  const module = screen.getByRole('checkbox', { name: '用户管理 · 可授予权限' });
  expect(module).not.toBeChecked();
  expect(module).not.toBePartiallyChecked();
  await interaction.click(screen.getByRole('checkbox', { name: '用户管理 · 查看' }));
  expect(module).toBePartiallyChecked();
  await interaction.click(module);
  expect(module).toBeChecked();
  expect(module).not.toBePartiallyChecked();
  expect(screen.getByRole('checkbox', { name: '用户管理 · 新建' })).toBeChecked();
  await interaction.click(module);
  expect(module).not.toBeChecked();
  expect(module).not.toBePartiallyChecked();
  expect(screen.getByRole('checkbox', { name: '用户管理 · 查看' })).not.toBeChecked();
  expect(screen.getByRole('checkbox', { name: '用户管理 · 新建' })).not.toBeChecked();
  expect(onChange).toHaveBeenLastCalledWith(originalCodes);
  expect(screen.getByRole('checkbox', { name: '用户管理 · 重置密码' })).toBeChecked();
  expect(screen.queryByRole('checkbox', { name: /供应商管理/ })).not.toBeInTheDocument();
});

it('limits module selection state and changes to visible grants and disables a module with no assignable match', async () => {
  const onChange = vi.fn();
  const initialCodes = [...originalCodes, 'account:users:read'];
  render(<ControlledSelector initialCodes={initialCodes} onChange={onChange} />);
  await select('板块筛选', '系统管理目录');
  const search = screen.getByRole('textbox', { name: '搜索权限' });
  await interaction.type(search, '新建');
  const module = screen.getByRole('checkbox', { name: '用户管理 · 可授予权限' });
  expect(module).not.toBeChecked();
  expect(module).not.toBePartiallyChecked();
  await interaction.click(module);
  expect(module).toBeChecked();
  expect(onChange).toHaveBeenLastCalledWith([...initialCodes, 'account:users:create']);
  await interaction.click(module);
  expect(module).not.toBeChecked();
  expect(onChange).toHaveBeenLastCalledWith(initialCodes);
  await interaction.clear(search);
  expect(module).toBePartiallyChecked();
  await interaction.type(search, '重置密码');
  expect(module).toBeDisabled();
  expect(module).not.toBeChecked();
  expect(module).not.toBePartiallyChecked();
  expect(screen.getByRole('checkbox', { name: '用户管理 · 重置密码' })).toBeChecked();
});

it('renders API groups, planned modules and reserved operations with disabled ungrantable permissions', async () => {
  server(); await openMatrix();
  expect(screen.getByRole('heading', { name: '平台功能' })).toBeVisible();
  expect(screen.getByRole('heading', { name: '供应商质量' })).toBeVisible();
  expect(screen.getByText('供应商管理')).toBeVisible();
  expect(screen.getAllByText('待接入').length).toBeGreaterThan(0);
  expect(screen.getByText('预留权限')).toBeVisible();
  expect(screen.getByRole('checkbox', { name: '用户管理 · 重置密码' })).toBeDisabled();
  expect(screen.queryByRole('checkbox', { name: /供应商管理/ })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: '保存权限' })).toBeDisabled();
});

it('limits module bulk selection to visible assignable operations and saves only codes plus baseline', async () => {
  const requests: unknown[] = []; server((init) => { requests.push(JSON.parse(String(init.body))); return json(roles[0]); });
  await openMatrix(); await select('板块筛选', '系统管理目录');
  await interaction.type(screen.getByRole('textbox', { name: '搜索权限' }), '新建');
  await interaction.click(screen.getByRole('button', { name: '用户管理 全选' }));
  expect(screen.getByText('已修改 1 项')).toBeVisible();
  await interaction.click(screen.getByRole('button', { name: '保存权限' }));
  await screen.findByText('权限已保存');
  expect(requests).toEqual([{ permissionCodes: [...originalCodes, 'account:users:create'], expectedPermissionCodes: originalCodes }]);
});

it('preserves hidden and disabled grants on module clear and resets the draft without writes', async () => {
  const fetch = server(); await openMatrix();
  await interaction.click(screen.getByRole('button', { name: '用户管理 全选' }));
  await interaction.click(screen.getByRole('button', { name: '用户管理 清空' }));
  expect(screen.getByRole('checkbox', { name: '用户管理 · 重置密码' })).toBeChecked();
  expect(screen.getByRole('checkbox', { name: '工作台 · 查看' })).toBeChecked();
  expect(screen.getByRole('button', { name: '保存权限' })).toBeDisabled();
  await interaction.click(screen.getByRole('checkbox', { name: '用户管理 · 查看' }));
  await interaction.click(screen.getByRole('button', { name: '重置修改' }));
  expect(screen.getByRole('checkbox', { name: '用户管理 · 查看' })).not.toBeChecked();
  expect(fetch.mock.calls.filter(([, init]) => init.method === 'PATCH')).toHaveLength(0);
});

it('keeps dirty drafts when switching away from and back to the matrix tab', async () => {
  server(); await openMatrix();
  await interaction.click(screen.getByRole('checkbox', { name: '用户管理 · 查看' }));
  await interaction.click(screen.getByRole('tab', { name: '角色' }));
  await interaction.click(screen.getByRole('tab', { name: '权限矩阵' }));
  expect(screen.getByRole('checkbox', { name: '用户管理 · 查看' })).toBeChecked();
});

it('keeps the role draft on cancellation and discards it only after confirmation', async () => {
  server(); await openMatrix();
  await interaction.click(screen.getByRole('checkbox', { name: '用户管理 · 查看' }));
  await select('选择角色', '第二角色');
  await waitFor(() => expect(within(screen.getByRole('dialog')).getByText('放弃未保存的权限修改？')).toBeVisible());
  await interaction.click(screen.getByRole('button', { name: '继续编辑' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(screen.getByRole('checkbox', { name: '用户管理 · 查看' })).toBeChecked();
  await select('选择角色', '第二角色');
  await interaction.click(screen.getByRole('button', { name: '放弃修改' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  await waitFor(() => expect(screen.getByRole('checkbox', { name: '工作台 · 查看' })).not.toBeChecked());
  expect(screen.getByRole('checkbox', { name: '用户管理 · 查看' })).not.toBeChecked();
});

it('keeps the organization draft on cancellation and discards it only after confirmation', async () => {
  server(); await openMatrix(organization.permissions, [{ ...organization, id: 'org-b', code: 'b', name: '乙组织' }]);
  await interaction.click(screen.getByRole('checkbox', { name: '用户管理 · 查看' }));
  await select('管理组织', '乙组织 · b');
  await waitFor(() => expect(within(screen.getByRole('dialog')).getByText('放弃未保存的权限修改？')).toBeVisible());
  await interaction.click(screen.getByRole('button', { name: '继续编辑' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(screen.getByRole('checkbox', { name: '用户管理 · 查看' })).toBeChecked();
  await select('管理组织', '乙组织 · b');
  await interaction.click(screen.getByRole('button', { name: '放弃修改' }));
  await waitFor(() => expect(screen.getByRole('checkbox', { name: '用户管理 · 查看' })).not.toBeChecked());
});

it.each([['account:roles:read'], ['account:roles:read', 'account:roles:create']])('keeps matrix read-only without update: %s', async (...permissions) => {
  server(); await openMatrix(permissions);
  expect(screen.getByRole('checkbox', { name: '用户管理 · 可授予权限' })).toBeDisabled();
  expect(screen.getByRole('checkbox', { name: '用户管理 · 查看' })).toBeDisabled();
  expect(screen.getByRole('button', { name: '用户管理 全选' })).toBeDisabled();
  expect(screen.getByRole('button', { name: '保存权限' })).toBeDisabled();
});

it('keeps global roles read-only even with role update permission', async () => {
  server(); await openMatrix(); await select('选择角色', '全局角色（全局只读）');
  expect(screen.getByRole('checkbox', { name: '用户管理 · 可授予权限' })).toBeDisabled();
  expect(screen.getByRole('checkbox', { name: '用户管理 · 查看' })).toBeDisabled();
});

it('retains conflicting draft and retry key until explicit reload', async () => {
  const requests: RequestInit[] = []; server((init) => { requests.push(init); return json({ code: 'CONCURRENCY_CONFLICT', message: 'private detail' }, 409); });
  await openMatrix(); await interaction.click(screen.getByRole('checkbox', { name: '用户管理 · 查看' }));
  await interaction.click(screen.getByRole('button', { name: '保存权限' }));
  expect(await screen.findByText('记录已被其他用户更新，请刷新后重试')).toBeVisible();
  expect(screen.queryByText('private detail')).not.toBeInTheDocument();
  expect(screen.getByRole('checkbox', { name: '用户管理 · 查看' })).toBeChecked();
  await interaction.click(screen.getByRole('button', { name: '保存权限' }));
  await waitFor(() => expect(requests).toHaveLength(2));
  expect((requests[0].headers as Record<string, string>)['Idempotency-Key']).toBe((requests[1].headers as Record<string, string>)['Idempotency-Key']);
  await waitFor(() => expect(screen.getByRole('button', { name: '重新加载权限' })).toBeEnabled());
  await interaction.click(screen.getByRole('button', { name: '重新加载权限' }));
  await interaction.click(screen.getByRole('button', { name: '放弃修改' }));
  await waitFor(() => expect(screen.getByRole('checkbox', { name: '用户管理 · 查看' })).not.toBeChecked());
});

it.each(['update', 'status', 'transfer', 'reset'])('exposes only the authorized user %s actions and fields', async (permission) => {
  server(); const scoped = { ...organization, permissions: ['account:users:read', `account:users:${permission}`] };
  render(<UserAdministration organization={scoped} organizations={[scoped]} />);
  await screen.findByText('alice');
  expect(screen.queryByRole('button', { name: '创建用户' })).not.toBeInTheDocument();
  expect(!!screen.queryByRole('button', { name: /^停\s*用$/ })).toBe(permission === 'status');
  expect(!!screen.queryByRole('button', { name: '签发重置凭证' })).toBe(permission === 'reset');
  if (permission !== 'reset') {
    await interaction.click(screen.getByRole('button', { name: /^编\s*辑$/ }));
    const dialog = within(screen.getByRole('dialog'));
    expect(!!dialog.queryByLabelText('邮箱')).toBe(permission === 'update');
    expect(!!dialog.queryByLabelText('状态')).toBe(permission === 'status');
    expect(!!dialog.queryByLabelText('主组织')).toBe(permission === 'transfer');
    expect(!!dialog.queryByLabelText('账号类型')).toBe(permission === 'transfer');
  }
});

it('allows creating users without granting read or issuing a user list request', async () => {
  const fetch = server(); render(<AdminPage organizations={[{ ...organization, permissions: ['account:users:create'] }]} />);
  expect(await screen.findByRole('button', { name: '创建用户' })).toBeEnabled();
  expect(screen.queryByRole('tab', { name: '角色' })).not.toBeInTheDocument();
  expect(fetch.mock.calls.some(([path]) => path.includes('/users?'))).toBe(false);
});

it.each(['create', 'update', 'delete'])('exposes only the authorized role %s action', async (permission) => {
  server(); render(<RoleAdministration organization={{ ...organization, permissions: ['account:roles:read', `account:roles:${permission}`] }} />);
  const row = (await screen.findByText('第一角色')).closest('tr')!;
  expect(!!screen.queryByRole('button', { name: '创建角色' })).toBe(permission === 'create');
  expect(!!within(row).queryByRole('button', { name: '复制模板' })).toBe(permission === 'create');
  expect(!!within(row).queryByRole('button', { name: '编辑角色' })).toBe(permission === 'update');
  expect(!!within(row).queryByRole('button', { name: '删除角色' })).toBe(permission === 'delete');
});

it('requires assign as well as both read permissions for assignment', async () => {
  server(); render(<UserAdministration organization={{ ...organization, permissions: ['account:users:read', 'account:roles:read', 'account:roles:update'] }} organizations={[organization]} />);
  await screen.findByText('alice');
  expect(screen.queryByRole('button', { name: '分配角色' })).not.toBeInTheDocument();
});

it('retains a role editor conflict draft and explicitly reloads its permission baseline', async () => {
  let role = roles[1];
  vi.stubGlobal('fetch', vi.fn((path: string, init: RequestInit) => {
    if (path.endsWith('/csrf')) return Promise.resolve(json({ csrfToken: 'csrf' }));
    if (init.method === 'PATCH') { role = { ...role, permissions: [{ id: 'created', code: 'account:users:create', name: '新建' }] }; return Promise.resolve(json({ code: 'CONCURRENCY_CONFLICT' }, 409)); }
    return Promise.resolve(json(path.includes('/permission-catalog') ? catalog : [role]));
  }));
  render(<RoleAdministration organization={organization} />);
  await interaction.click(await screen.findByRole('button', { name: '编辑角色' }));
  const dialog = within(screen.getByRole('dialog'));
  await interaction.click(dialog.getByRole('checkbox', { name: '用户管理 · 查看' }));
  await interaction.click(dialog.getByRole('button', { name: '保存角色' }));
  await dialog.findByText('记录已被其他用户更新，请刷新后重试');
  expect(dialog.getByRole('checkbox', { name: '用户管理 · 查看' })).toBeChecked();
  await interaction.click(dialog.getByRole('button', { name: '重新加载并放弃权限修改' }));
  await waitFor(() => expect(dialog.getByRole('checkbox', { name: '用户管理 · 新建' })).toBeChecked());
  expect(dialog.getByRole('checkbox', { name: '用户管理 · 查看' })).not.toBeChecked();
});

it.each(['new', 'copy'])('uses the grouped role form and the correct %s request fields', async (mode) => {
  const requests: unknown[] = []; server((init) => { requests.push(JSON.parse(String(init.body))); return json(roles[0]); });
  render(<RoleAdministration organization={{ ...organization, permissions: ['account:roles:read', 'account:roles:create'] }} />);
  await screen.findByText('第一角色');
  if (mode === 'new') await interaction.click(screen.getByRole('button', { name: '创建角色' }));
  else await interaction.click(within(screen.getByText('第一角色').closest('tr')!).getByRole('button', { name: '复制模板' }));
  const dialog = within(screen.getByRole('dialog'));
  await interaction.type(dialog.getByLabelText('角色代码'), 'NEW_ROLE');
  await interaction.type(dialog.getByLabelText('角色名称'), '新角色');
  if (mode === 'new') {
    expect(dialog.getByRole('checkbox', { name: '用户管理 · 重置密码' })).toBeDisabled();
    expect(dialog.getByText('供应商管理')).toBeVisible();
    await interaction.click(dialog.getByRole('checkbox', { name: '用户管理 · 查看' }));
  } else expect(dialog.queryByRole('checkbox')).not.toBeInTheDocument();
  await interaction.click(dialog.getByRole('button', { name: '保存角色' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(requests).toEqual([mode === 'new' ? { code: 'NEW_ROLE', name: '新角色', permissionCodes: ['account:users:read'], organizationId: organization.id, mfaRequired: false } : { code: 'NEW_ROLE', name: '新角色' }]);
});

it('does not infer role read permission from any write grant', async () => {
  const fetch = server();
  render(<RoleAdministration organization={{ ...organization, permissions: ['account:roles:create', 'account:roles:update', 'account:roles:delete', 'account:roles:assign'] }} />);
  expect(screen.queryByRole('button', { name: '创建角色' })).not.toBeInTheDocument();
  expect(fetch).not.toHaveBeenCalled();
});

it.each(['new', 'transfer'])('filters %s organization choices by the corresponding permission', async (mode) => {
  server();
  const scoped = { ...organization, permissions: ['account:users:read', 'account:users:create', 'account:users:transfer'] };
  render(<UserAdministration organization={scoped} organizations={[scoped, { ...organization, id: 'org-create', name: '仅创建组织', permissions: ['account:users:create'] }, { ...organization, id: 'org-transfer', name: '仅迁移组织', permissions: ['account:users:transfer'] }]} />);
  await screen.findByText('alice');
  await interaction.click(screen.getByRole('button', { name: mode === 'new' ? '创建用户' : /^编\s*辑$/ }));
  await interaction.click(within(screen.getByRole('dialog')).getByLabelText('主组织'));
  await waitFor(() => expect(screen.getByText(mode === 'new' ? '仅创建组织' : '仅迁移组织', { selector: '.ant-select-item-option-content' })).toBeVisible());
  expect(screen.queryByText(mode === 'new' ? '仅迁移组织' : '仅创建组织', { selector: '.ant-select-item-option-content' })).not.toBeInTheDocument();
});
