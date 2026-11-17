import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import userEvent from '@testing-library/user-event';
import { UnsavedChangesProvider } from '../../layouts/UnsavedChanges';
import { UserAdministration } from './UserAdministration';
import type { AdminOrganization, AdminUser } from './admin';

const organization: AdminOrganization = { id: 'org', name: 'Organization', code: 'O', type: 'INTERNAL', permissions: ['account:users:read', 'account:users:update', 'account:users:status', 'account:users:transfer', 'account:users:reset', 'account:users:delete'] };
const user: AdminUser = { id: 'u1', username: 'alice', fullName: 'Alice', phone: null, email: null, emailVerifiedAt: null, profileVersion: 3, securityVersion: 1, accountType: 'INTERNAL', status: 'ACTIVE', mfaEnabled: false, organizationId: 'org', organization: { id: 'org', code: 'O', name: 'Organization' }, createdAt: '', updatedAt: '' };
const json = (value: unknown) => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });
beforeEach(() => { localStorage.clear(); document.documentElement.lang = 'zh-CN'; vi.stubEnv('NODE_ENV', 'development'); });
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

it('consolidates each row into four tabs without reading secrets on opening or security selection', async () => {
  const reads: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (path: string) => { reads.push(path); return json([user]); }));
  render(<UserAdministration organization={organization} organizations={[organization]} />);
  const row = within((await screen.findByText('alice')).closest('tr')!);
  expect(row.getAllByRole('button')).toHaveLength(1);
  await userEvent.click(row.getByRole('button', { name: '管理用户' }));
  const dialog = within(await screen.findByRole('dialog', { name: '管理用户' }));
  expect(dialog.getAllByRole('tab').map(tab => tab.textContent)).toEqual(['基本资料', '任职与授权', '账号安全', '状态与删除']);
  await waitFor(() => expect(dialog.getByText('Alice')).toBeVisible());
  await userEvent.click(dialog.getByRole('tab', { name: '账号安全' }));
  expect(dialog.getByRole('button', { name: '临时密码' })).toBeVisible();
  expect(reads).toEqual(['/api/v1/admin/users?organizationId=org&search=']);
});

it('keeps profile saving separate from status', async () => {
  const writes: unknown[] = [];
  vi.stubGlobal('fetch', vi.fn(async (path: string, init: RequestInit) => {
    if (path.endsWith('/csrf')) return json({ csrfToken: 'csrf' });
    if (init.method === 'PATCH') { writes.push(JSON.parse(String(init.body))); return json({ ...user, fullName: 'Draft', profileVersion: 4 }); }
    return json([user]);
  }));
  render(<UserAdministration organization={organization} organizations={[organization]} />);
  const entry = (await screen.findByText('管理用户', { selector: 'button > span' })).closest('button')!;
  expect(entry).toHaveAccessibleName('管理用户');
  await userEvent.click(entry);
  const dialog = within(await screen.findByRole('dialog', { name: '管理用户' }));
  await waitFor(() => expect(dialog.getByLabelText('姓名')).toBeVisible());
  expect(dialog.queryByLabelText('状态')).not.toBeInTheDocument();
  fireEvent.change(dialog.getByLabelText('姓名'), { target: { value: 'Draft' } });
  await userEvent.click(dialog.getByRole('button', { name: '保存用户' }));
  await waitFor(() => expect(writes).toEqual([{ fullName: 'Draft', expectedProfileVersion: 3 }]));
});

it('keeps a dirty profile when a tab change is cancelled', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => json([user])));
  render(<MemoryRouter><UnsavedChangesProvider><UserAdministration organization={organization} organizations={[organization]} /></UnsavedChangesProvider></MemoryRouter>);
  const entry = (await screen.findByText('管理用户', { selector: 'button > span' })).closest('button')!;
  expect(entry).toHaveAccessibleName('管理用户');
  await userEvent.click(entry);
  const dialog = within(await screen.findByRole('dialog', { name: '管理用户' }));
  const name = dialog.getByLabelText('姓名');
  await waitFor(() => expect(name).toBeVisible());
  fireEvent.change(name, { target: { value: 'Draft' } });
  fireEvent.click(dialog.getByRole('tab', { name: '账号安全' }));
  const guard = within(await screen.findByRole('dialog', { name: '当前草稿尚未保存，继续将放弃修改。' }));
  fireEvent.click(guard.getByRole('button', { name: '继续编辑' }));
  expect(dialog.getByRole('tab', { name: '基本资料' })).toHaveAttribute('aria-selected', 'true');
  expect(dialog.getByLabelText('姓名')).toHaveValue('Draft');
});

it('lets a read-only user inspect the stable identity without mutation controls', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => json([user])));
  const readOnly = { ...organization, permissions: ['account:users:read'] };
  render(<UserAdministration organization={readOnly} organizations={[readOnly]} />);
  const entry = (await screen.findByText('管理用户', { selector: 'button > span' })).closest('button')!;
  expect(entry).toHaveAccessibleName('管理用户');
  await userEvent.click(entry);
  const dialog = within(await screen.findByRole('dialog', { name: '管理用户' }));
  await waitFor(() => expect(dialog.getByText('Alice')).toBeVisible());
  expect(dialog.queryByRole('button', { name: '保存用户' })).not.toBeInTheDocument();
  fireEvent.click(dialog.getByRole('tab', { name: '状态与删除' }));
  expect(dialog.queryByRole('button', { name: '永久删除用户' })).not.toBeInTheDocument();
  expect(dialog.queryByRole('button', { name: '停用' })).not.toBeInTheDocument();
});
