import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import userEvent from '@testing-library/user-event';
import { UserAdministration } from './UserAdministration';
import type { AdminOrganization, AdminUser } from './admin';
import { openUserManagement } from './user-management-test-helpers';

vi.mock('../../ui/ledger', () => ({ useLedgerPageSize: () => [20, vi.fn()], LedgerTable: ({ dataSource, columns }: { dataSource: AdminUser[]; columns: { key: string; render?: (value: undefined, user: AdminUser) => ReactNode }[] }) => <div>{dataSource.map(user => <div key={user.id}>{columns.find(column => column.key === 'actions')?.render?.(undefined, user)}</div>)}</div> }));
const organization: AdminOrganization = { id: 'org', code: 'O', name: 'Organization', type: 'INTERNAL', permissions: ['account:users:read', 'account:users:update', 'account:users:status', 'account:users:transfer'] };
const user: AdminUser = { id: 'u1', username: 'alice', fullName: 'Alice', phone: null, email: null, emailVerifiedAt: null, profileVersion: 3, securityVersion: 1, accountType: 'INTERNAL', status: 'ACTIVE', mfaEnabled: false, organizationId: 'org', organization: { id: 'org', code: 'O', name: 'Organization' }, createdAt: '', updatedAt: '' };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
beforeEach(() => { vi.stubEnv('NODE_ENV', 'development'); });
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
function server(firstStatus?: number) {
  const writes: { path: string; method: string; body: string; key: string }[] = [];
  vi.stubGlobal('fetch', vi.fn(async (path: string, init: RequestInit) => {
    if (path.endsWith('/csrf')) return json({ csrfToken: 'csrf' });
    if (init.method === 'PATCH') {
      writes.push({ path, method: init.method, body: String(init.body), key: (init.headers as Record<string, string>)['Idempotency-Key']! });
      if (writes.length === 1) { if (firstStatus) return json({ code: 'VALIDATION_FAILED' }, firstStatus); throw new TypeError('response lost'); }
      return json({ ...user, ...JSON.parse(String(init.body)), profileVersion: 4 });
    }
    return json([user]);
  }));
  return writes;
}

it('keeps a zero-draft status command through parent dismissal and retries its original path/body/key', async () => {
  const writes = server(); render(<UserAdministration organization={organization} organizations={[organization]} />);
  const manager = await openUserManagement('状态与删除');
  fireEvent.click(manager.getByRole('button', { name: /^停\s*用$/ }));
  await manager.findByText('请求失败，请重试');
  expect(manager.getByRole('tab', { name: '基本资料' })).toHaveAttribute('aria-disabled', 'true');
  expect(manager.queryByRole('button', { name: 'Close' })).not.toBeInTheDocument();
  const element = screen.getByLabelText('管理用户', { selector: '[role="dialog"]' });
  fireEvent.keyDown(element, { key: 'Escape', keyCode: 27 });
  expect(element).toBeInTheDocument();
  fireEvent.click(manager.getByRole('button', { name: '重试确认结果' }));
  await waitFor(() => expect(writes).toHaveLength(2));
  expect(writes[1]).toEqual(writes[0]);
  expect(JSON.parse(writes[1]!.body)).toEqual({ status: 'DISABLED' });
  await waitFor(() => expect(manager.getByRole('button', { name: /^启\s*用$/ })).toBeEnabled());
});

it('freezes an unknown profile command despite later form events and retries only its original body', async () => {
  const writes = server(); render(<UserAdministration organization={organization} organizations={[organization]} />);
  const manager = await openUserManagement(); const name = manager.getByLabelText('姓名');
  fireEvent.change(name, { target: { value: 'Original draft' } });
  fireEvent.click(manager.getByRole('button', { name: '保存用户' }));
  await manager.findByText('请求失败，请重试');
  expect(name).toBeDisabled();
  fireEvent.change(name, { target: { value: 'Changed draft' } });
  fireEvent.submit(name.closest('form')!);
  expect(writes).toHaveLength(1);
  fireEvent.click(manager.getByRole('button', { name: '重试确认结果' }));
  await screen.findByText('用户已保存');
  expect(writes[1]).toEqual(writes[0]);
  expect(JSON.parse(writes[1]!.body)).toEqual({ fullName: 'Original draft', expectedProfileVersion: 3 });
});

it('allows a new main command only after explicitly abandoning an unknown status request', async () => {
  const writes = server(); render(<UserAdministration organization={organization} organizations={[organization]} />);
  const manager = await openUserManagement('状态与删除');
  fireEvent.click(manager.getByRole('button', { name: /^停\s*用$/ }));
  await manager.findByText('请求失败，请重试');
  fireEvent.click(manager.getByRole('button', { name: '放弃修改' }));
  const guard = within(await screen.findByRole('dialog', { name: '放弃未确认的请求？' }));
  expect(writes).toHaveLength(1);
  fireEvent.click(guard.getByRole('button', { name: '放弃修改' }));
  fireEvent.click(manager.getByRole('tab', { name: '基本资料' }));
  fireEvent.change(manager.getByLabelText('姓名'), { target: { value: 'New draft' } });
  fireEvent.click(manager.getByRole('button', { name: '保存用户' }));
  await screen.findByText('用户已保存');
  expect(writes).toHaveLength(2);
  expect(writes[1]!.key).not.toBe(writes[0]!.key);
  expect(JSON.parse(writes[1]!.body)).toEqual({ fullName: 'New draft', expectedProfileVersion: 3 });
});

it('keeps a known validation rejection editable without treating it as an unknown command', async () => {
  const writes = server(400); render(<UserAdministration organization={organization} organizations={[organization]} />);
  const manager = await openUserManagement();
  fireEvent.change(manager.getByLabelText('姓名'), { target: { value: 'First draft' } });
  fireEvent.click(manager.getByRole('button', { name: '保存用户' }));
  await manager.findByText('请检查填写内容');
  expect(manager.getByLabelText('姓名')).toBeEnabled();
  expect(manager.queryByRole('button', { name: '重试确认结果' })).not.toBeInTheDocument();
  fireEvent.change(manager.getByLabelText('姓名'), { target: { value: 'Updated draft' } });
  fireEvent.click(manager.getByRole('button', { name: '保存用户' }));
  await screen.findByText('用户已保存');
  expect(JSON.parse(writes[1]!.body)).toEqual({ fullName: 'Updated draft', expectedProfileVersion: 3 });
  expect(writes[1]!.key).not.toBe(writes[0]!.key);
});

it('freezes the original organization transfer parameters until the same request is restored', async () => {
  const writes = server(); const other = { ...organization, id: 'other', name: 'Other organization' };
  render(<UserAdministration organization={organization} organizations={[organization, other]} />);
  const manager = await openUserManagement('任职与授权');
  const selector = manager.getByLabelText('主组织');
  await userEvent.click(selector);
  await userEvent.click(await screen.findByText('Other organization', { selector: '.ant-select-item-option-content' }));
  fireEvent.click(manager.getByRole('button', { name: '保存用户' }));
  await manager.findByText('请求失败，请重试');
  expect(selector).toBeDisabled();
  expect(manager.getByRole('tab', { name: '基本资料' })).toHaveAttribute('aria-disabled', 'true');
  fireEvent.click(manager.getByRole('button', { name: '重试确认结果' }));
  await screen.findByText('用户已保存');
  expect(writes[1]).toEqual(writes[0]);
  expect(JSON.parse(writes[1]!.body)).toEqual({ organizationId: 'other' });
});

it('keeps reset recovery inside the active reset dialog using the original code and key', async () => {
  const writes: { path: string; body: string; key: string }[] = [];
  vi.stubGlobal('fetch', vi.fn(async (path: string, init: RequestInit) => {
    if (path.endsWith('/csrf')) return json({ csrfToken: 'csrf' });
    if (path.includes('/password-reset')) {
      writes.push({ path, body: String(init.body), key: (init.headers as Record<string, string>)['Idempotency-Key']! });
      if (writes.length === 1) throw new TypeError('response lost');
      return json({ resetId: 'issued', expiresAt: '2027-01-01' });
    }
    return json([user]);
  }));
  const scoped = { ...organization, permissions: [...organization.permissions, 'account:users:reset'] };
  render(<UserAdministration organization={scoped} organizations={[scoped]} />);
  const manager = await openUserManagement('账号安全');
  fireEvent.click(manager.getByRole('button', { name: '签发重置凭证' }));
  const reset = within(await screen.findByLabelText('一次性重置凭证', { selector: '[role="dialog"]' }));
  fireEvent.click(reset.getByRole('button', { name: '确认签发' }));
  await reset.findByText('请求失败，请重试');
  expect(reset.queryByRole('button', { name: 'Close' })).not.toBeInTheDocument();
  fireEvent.click(reset.getByRole('button', { name: '重试确认结果' }));
  const credential = await reset.findByLabelText('一次性重置凭证', { selector: 'textarea' });
  expect(writes[1]).toEqual(writes[0]);
  expect(credential).toHaveValue(`issued.${JSON.parse(writes[0]!.body).temporaryCode}`);
});
