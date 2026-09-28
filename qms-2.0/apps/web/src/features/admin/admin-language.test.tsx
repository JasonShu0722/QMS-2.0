import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { LanguageProvider, LanguageSwitcher } from '../../i18n/Language';
import { GroupedPermissionSelector } from './GroupedPermissionSelector';
import { UserAdministration } from './UserAdministration';
import { RoleAdministration } from './RoleAdministration';
import { PermissionMatrix } from './PermissionMatrix';
import type { AdminOrganization, AdminRole, PermissionCatalogGroup } from './admin';

vi.setConfig({ testTimeout: 30000 });

const organization: AdminOrganization = { id: 'org-language', code: 'LANG', name: 'Customer supplied organization', type: 'INTERNAL', permissions: ['account:users:read', 'account:users:create', 'account:roles:read', 'account:roles:create', 'account:roles:update'] };
const role: AdminRole = { id: 'role-language', code: 'READER', name: 'Customer supplied role', organizationId: organization.id, mfaRequired: false, permissions: [] };
const catalog: PermissionCatalogGroup[] = [
  { key: 'system', name: '系统管理', status: 'active', modules: [{ key: 'users', name: '用户管理', status: 'active', operations: [{ code: 'account:users:read', name: '查看用户', enforcement: 'guarded', grantable: true }] }] },
  { key: 'supplier', name: '供应商质量', status: 'planned', modules: [{ key: 'supplier-1', name: '供应商管理', status: 'planned', operations: [] }] },
];
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
afterEach(() => { vi.unstubAllGlobals(); localStorage.clear(); });

it('translates and searches the registered permission catalog while preserving codes and planned state', async () => {
  render(<LanguageProvider><LanguageSwitcher /><GroupedPermissionSelector catalog={catalog} /></LanguageProvider>);
  expect(screen.getByRole('checkbox', { name: '用户管理 · 查看用户' })).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Language / 语言' }));
  await userEvent.click(screen.getByRole('menuitemradio', { name: 'English' }));
  expect(screen.getByRole('checkbox', { name: 'User management · View users' })).toBeInTheDocument();
  expect(screen.getByText('account:users:read')).toBeInTheDocument();
  expect(screen.getByText('Supplier management')).toBeInTheDocument();
  expect(screen.getByText('Planned')).toBeInTheDocument();
  await userEvent.type(screen.getByRole('textbox', { name: 'Search permissions' }), 'View users');
  expect(screen.getByRole('checkbox', { name: 'User management · View users' })).toBeInTheDocument();
  expect(screen.queryByText('Supplier management')).not.toBeInTheDocument();
  await userEvent.clear(screen.getByRole('textbox', { name: 'Search permissions' }));
  await userEvent.click(screen.getByRole('button', { name: 'Language / 语言' }));
  await userEvent.click(screen.getByRole('menuitemradio', { name: '简体中文' }));
  expect(screen.getByRole('checkbox', { name: '用户管理 · 查看用户' })).toBeInTheDocument();
});

it('switches existing user, role and matrix controls without translating customer data', async () => {
  vi.stubGlobal('fetch', vi.fn(async (path: string) => json(path.includes('permission-catalog') ? catalog : path.includes('/users?') ? [] : [role])));
  render(<LanguageProvider><LanguageSwitcher /><UserAdministration organization={organization} organizations={[organization]} /><RoleAdministration organization={organization} /><PermissionMatrix organization={organization} /></LanguageProvider>);
  await screen.findByRole('button', { name: '编辑角色' });
  await userEvent.click(screen.getByRole('button', { name: 'Language / 语言' }));
  await userEvent.click(screen.getByRole('menuitemradio', { name: 'English' }));
  expect(screen.getByRole('button', { name: 'Create user' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Create role' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Save permissions' })).toBeInTheDocument();
  expect(screen.getAllByText(role.name).length).toBeGreaterThan(0);
  await userEvent.click(screen.getByRole('button', { name: 'Language / 语言' }));
  await userEvent.click(screen.getByRole('menuitemradio', { name: '简体中文' }));
  expect(screen.getByRole('button', { name: '创建用户' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '保存权限' })).toBeInTheDocument();
});

it('shows a translated role security failure and trace inside its editor', async () => {
  localStorage.setItem('qms:locale:v1', 'en-US');
  vi.stubGlobal('fetch', vi.fn(async (path: string, init: RequestInit) => {
    if (path.endsWith('/csrf')) return json({ csrfToken: 'csrf' });
    if (init.method === 'PATCH') return json({ code: 'FEATURE_PERMISSION_DENIED', message: 'raw permission internals', fields: { secret: ['raw secret field'] }, traceId: 'trace-role-en' }, 403);
    return json(path.includes('permission-catalog') ? catalog : [role]);
  }));
  render(<LanguageProvider><RoleAdministration organization={organization} /></LanguageProvider>);
  await userEvent.click(await screen.findByRole('button', { name: 'Edit role' }));
  const dialog = screen.getByRole('dialog');
  await userEvent.clear(within(dialog).getByLabelText('Role name'));
  await userEvent.type(within(dialog).getByLabelText('Role name'), 'Changed role');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Save role' }));
  expect(await within(dialog).findByText('You do not have permission for this action.')).toBeInTheDocument();
  expect(within(dialog).getByText('trace-role-en')).toBeInTheDocument();
  expect(screen.queryByText(/raw permission internals|raw secret field/)).not.toBeInTheDocument();
  await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Save role' })).toBeEnabled());
});

it.each(['users', 'roles', 'matrix'])('shows safe translated %s loading failures with trace IDs', async (page) => {
  localStorage.setItem('qms:locale:v1', 'en-US');
  vi.stubGlobal('fetch', vi.fn(async () => json({ code: 'ORGANIZATION_SCOPE_DENIED', message: 'raw organization membership', traceId: 'trace-admin-load' }, 403)));
  render(<LanguageProvider>{page === 'users' ? <UserAdministration organization={organization} organizations={[organization]} /> : page === 'roles' ? <RoleAdministration organization={organization} /> : <PermissionMatrix organization={organization} />}</LanguageProvider>);
  expect(await screen.findByText('You do not have access to this organization.')).toBeInTheDocument();
  expect(screen.getByText('trace-admin-load')).toBeInTheDocument();
  expect(screen.queryByText('raw organization membership')).not.toBeInTheDocument();
});
