import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import baseUserEvent, { PointerEventsCheckLevel } from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { UnsavedChangesProvider } from '../../layouts/UnsavedChanges';
import { UserAdministration } from './UserAdministration';
import type { AdminOrganization, AdminUser } from './admin';
const userEvent = baseUserEvent.setup({ pointerEventsCheck: PointerEventsCheckLevel.Never });
const organization: AdminOrganization = { id: 'org', name: 'Organization', code: 'O', type: 'INTERNAL', permissions: ['account:users:read', 'account:users:update', 'account:users:status', 'account:roles:read', 'account:roles:assign'] };
const user: AdminUser = { fullName: 'Alice', phone: '+1 123', emailVerifiedAt: null, profileVersion: 3, id: 'u1', username: 'alice', email: null, accountType: 'INTERNAL', status: 'ACTIVE', mfaEnabled: false, organizationId: 'org', organization: { id: 'org', code: 'O', name: 'Organization' }, createdAt: '', updatedAt: '' };
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
beforeEach(() => {
  localStorage.clear(); document.documentElement.lang = 'zh-CN';
  // rc-component otherwise assigns the same test-id to modal titles and Select controls.
  vi.stubEnv('NODE_ENV', 'development');
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
it('rebases only changed admin profile fields after a conflict without overwriting remote contacts', async () => {
  const writes: Record<string, unknown>[] = []; let conflict = true;
  const reads: { path: string; value: unknown }[] = [];
  const remote = { ...user, profileVersion: 5, fullName: 'Remote', phone: '+44 123 ext 8', email: 'remote@example.test' };
  let finish!: (value: Response) => void;
  vi.stubGlobal('fetch', vi.fn(async (path: string, init: RequestInit) => {
    if (path.endsWith('/csrf')) return json({ csrfToken: 'csrf' });
    if (init.method === 'PATCH') { writes.push(JSON.parse(String(init.body))); return conflict ? json({ code: 'CONCURRENCY_CONFLICT', message: 'conflict' }, 409) : json(user); }
    const value = path.includes('/users/u1?') ? remote : [user];
    reads.push({ path, value });
    if (path.includes('/users/u1?')) return new Promise<Response>(resolve => { finish = resolve; });
    return json(value);
  }));
  render(<UserAdministration organization={organization} organizations={[organization]} />);
  expect(await screen.findByText('Alice')).toBeVisible();
  const edit = screen.getByRole('button', { name: /^编\s*辑$/ });
  expect(edit).toBeEnabled();
  await userEvent.click(edit);
  const dialog = within(await screen.findByRole('dialog', { name: '编辑用户' }, { timeout: 5000 }));
  fireEvent.change(dialog.getByLabelText('姓名'), { target: { value: 'Draft' } });
  const save = dialog.getByRole('button', { name: '保存用户' });
  fireEvent.click(save);
  await dialog.findByText('记录已被其他用户更新，请刷新后重试');
  expect(dialog.getByLabelText('姓名')).toHaveValue('Draft');
  expect(dialog.getByRole('button', { name: '保存用户' })).toBeDisabled();
  fireEvent.click(dialog.getByRole('button', { name: '读取最新资料基线' }));
  await waitFor(() => expect(reads.some(read => read.path.includes('/users/u1?'))).toBe(true));
  expect(reads.find(read => read.path === '/api/v1/admin/users/u1?organizationId=org')?.value).toMatchObject({ id: user.id, organizationId: organization.id, profileVersion: 5 });
  expect(dialog.getByLabelText('姓名')).toBeDisabled();
  expect(dialog.getByLabelText('电话')).toBeDisabled();
  expect(dialog.getByLabelText('邮箱')).toBeDisabled();
  await act(async () => finish(json(remote)));
  await waitFor(() => { expect(save).toBeEnabled(); expect(save).not.toHaveClass('ant-btn-loading'); });
  expect(dialog.getByLabelText('姓名')).toHaveValue('Draft');
  expect(dialog.getByLabelText('电话')).toHaveValue(remote.phone);
  expect(dialog.getByLabelText('邮箱')).toHaveValue(remote.email);
  conflict = false;
  fireEvent.click(save);
  await screen.findByText('用户已保存');
  expect(writes).toEqual([{ fullName: 'Draft', expectedProfileVersion: 3 }, { fullName: 'Draft', expectedProfileVersion: 5 }]);
}, 30000);

it.each(['whitespace', 'matching remote'] as const)('normalizes admin rebase changes and dirty state for %s', async scenario => {
  const remote = { ...user, fullName: scenario === 'matching remote' ? 'Draft' : 'Remote', phone: '+44 999', profileVersion: 5 };
  vi.stubGlobal('fetch', vi.fn(async (path: string, init: RequestInit) => {
    if (path.endsWith('/csrf')) return json({ csrfToken: 'csrf' });
    if (init.method === 'PATCH') return json({ code: 'CONCURRENCY_CONFLICT', message: 'conflict' }, 409);
    return json(path.includes('/users/u1?') ? remote : [user]);
  }));
  render(<MemoryRouter><UnsavedChangesProvider><UserAdministration organization={organization} organizations={[organization]} /></UnsavedChangesProvider></MemoryRouter>);
  await userEvent.click(await screen.findByRole('button', { name: /^编\s*辑$/ }));
  const dialog = within(await screen.findByRole('dialog', { name: '编辑用户' }));
  fireEvent.change(dialog.getByLabelText('姓名'), { target: { value: ' Draft ' } });
  if (scenario === 'whitespace') fireEvent.change(dialog.getByLabelText('电话'), { target: { value: ` ${user.phone} ` } });
  fireEvent.click(dialog.getByRole('button', { name: '保存用户' }));
  await dialog.findByText('记录已被其他用户更新，请刷新后重试');
  fireEvent.click(dialog.getByRole('button', { name: '读取最新资料基线' }));
  await waitFor(() => expect(dialog.getByLabelText('姓名')).toBeEnabled());
  expect(dialog.getByLabelText('姓名')).toHaveValue(' Draft ');
  expect(dialog.getByLabelText('电话')).toHaveValue(remote.phone);
  const unload = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(unload);
  expect(unload.defaultPrevented).toBe(scenario !== 'matching remote');
}, 30000);

it.each(['save', 'reload'] as const)('blocks admin input and all modal dismissal while %s is pending', async operation => {
  let finish!: (value: Response) => void;
  let writes = 0; let reads = 0;
  vi.stubGlobal('fetch', vi.fn(async (path: string, init: RequestInit) => {
    if (path.endsWith('/csrf')) return json({ csrfToken: 'csrf' });
    if (init.method === 'PATCH') {
      writes += 1;
      if (operation === 'reload') return json({ code: 'CONCURRENCY_CONFLICT', message: 'conflict' }, 409);
      return new Promise<Response>(resolve => { finish = resolve; });
    }
    if (path.includes('/users/u1?')) { reads += 1; return new Promise<Response>(resolve => { finish = resolve; }); }
    return json([user]);
  }));
  render(<UserAdministration organization={organization} organizations={[organization]} />);
  await userEvent.click(await screen.findByRole('button', { name: /^编\s*辑$/ }));
  const element = await screen.findByRole('dialog', { name: '编辑用户' });
  const dialog = within(element);
  const name = dialog.getByLabelText('姓名');
  fireEvent.change(name, { target: { value: 'Draft' } });
  await userEvent.click(dialog.getByRole('button', { name: '保存用户' }));
  if (operation === 'reload') {
    await dialog.findByText('记录已被其他用户更新，请刷新后重试');
    const reload = dialog.getByRole('button', { name: '读取最新资料基线' });
    const close = dialog.getByRole('button', { name: 'Close' });
    act(() => { fireEvent.click(reload); fireEvent.click(reload); fireEvent.click(close); });
    await waitFor(() => expect(reads).toBe(1));
  } else {
    await waitFor(() => expect(writes).toBe(1));
    fireEvent.submit(name.closest('form')!);
  }
  expect(name).toBeDisabled();
  expect(dialog.getByLabelText('电话')).toBeDisabled();
  expect(dialog.getByLabelText('邮箱')).toBeDisabled();
  expect(dialog.getByLabelText('状态')).toBeDisabled();
  const close = dialog.queryByRole('button', { name: 'Close' });
  if (close) expect(close).toBeDisabled();
  await userEvent.type(name, 'late');
  expect(name).toHaveValue('Draft');
  await userEvent.keyboard('{Escape}');
  const mask = document.querySelector('.ant-modal-mask');
  expect(mask).toBeInTheDocument();
  fireEvent.click(mask!);
  expect(element).toBeVisible();
  expect(writes).toBe(1);
  await act(async () => finish(json({ ...user, fullName: 'Draft', profileVersion: 5 })));
  if (operation === 'save') await screen.findByText('用户已保存');
  else await waitFor(() => expect(name).toBeEnabled());
}, 30000);

it.each(['organization', 'permission'] as const)('drops a pending admin write after %s changes', async change => {
  let finish!: (value: Response) => void;
  let writes = 0;
  vi.stubGlobal('fetch', vi.fn(async (path: string, init: RequestInit) => {
    if (path.endsWith('/csrf')) return json({ csrfToken: 'csrf' });
    if (init.method === 'PATCH') { writes += 1; return new Promise<Response>(resolve => { finish = resolve; }); }
    return json(path.includes('organizationId=foreign') ? [] : [user]);
  }));
  const view = render(<UserAdministration organization={organization} organizations={[organization]} />);
  await userEvent.click(await screen.findByRole('button', { name: /^编\s*辑$/ }));
  const dialog = within(await screen.findByRole('dialog', { name: '编辑用户' }));
  fireEvent.change(dialog.getByLabelText('姓名'), { target: { value: 'Draft' } });
  fireEvent.click(dialog.getByRole('button', { name: '保存用户' }));
  await waitFor(() => expect(writes).toBe(1));
  const next = change === 'organization' ? { ...organization, id: 'foreign' } : { ...organization, permissions: [] };
  view.rerender(<UserAdministration organization={next} organizations={[next]} />);
  await act(async () => finish(json({ ...user, fullName: 'Late account name', profileVersion: 5 })));
  await waitFor(() => expect(screen.queryByRole('dialog', { name: '编辑用户' })).not.toBeInTheDocument());
  expect(screen.queryByText('用户已保存')).not.toBeInTheDocument();
  expect(screen.queryByText('Late account name')).not.toBeInTheDocument();
  expect(writes).toBe(1);
}, 30000);
it('shows effective sources but never promotes inherited roles into the direct assignment write', async () => {
  const direct = { id: 'r1', code: 'D', name: 'Direct role', organizationId: 'org', permissions: [], mfaRequired: false };
  const inherited = { ...direct, id: 'r2', name: 'Inherited role', sources: [{ kind: 'POSITION', positionId: 'p1' }] };
  let body: unknown;
  vi.stubGlobal('fetch', vi.fn(async (path: string, init: RequestInit) => {
    if (path.endsWith('/csrf')) return json({ csrfToken: 'csrf' });
    if (init.method === 'PUT') { body = JSON.parse(String(init.body)); return json({}); }
    if (path.includes('/users/u1/roles')) return json({ userId: 'u1', organizationId: 'org', roles: [direct], effectiveRoles: [{ ...direct, sources: [{ kind: 'DIRECT' }] }, inherited], permissions: [] });
    return json(path.includes('/admin/roles') ? [direct, inherited] : [user]);
  }));
  render(<UserAdministration organization={organization} organizations={[organization]} />);
  await userEvent.click(await screen.findByRole('button', { name: '分配角色' }));
  const dialog = within(await screen.findByRole('dialog'));
  await waitFor(() => expect(dialog.getByText('岗位继承 · p1')).toBeVisible());
  await userEvent.click(dialog.getByRole('button', { name: '保存角色分配' }));
  await waitFor(() => expect(body).toEqual({ roleIds: ['r1'] }));
});
