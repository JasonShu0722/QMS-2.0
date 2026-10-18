import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { UserAdministration } from './UserAdministration';
import type { AdminOrganization } from './admin';

const organization: AdminOrganization = { id: '10000000-0000-4000-8000-000000000001', code: 'A', name: '组织 A', type: 'INTERNAL', permissions: ['account:users:read'] };
const targetUserId = '20000000-0000-4000-8000-000000000001';
const user = { id: targetUserId, username: 'target-alice', email: 'private@example.test', accountType: 'INTERNAL', status: 'DISABLED', organizationId: organization.id, organization: { id: organization.id, code: 'A', name: organization.name }, mfaEnabled: false, createdAt: '2026-10-18', updatedAt: '2026-10-18' };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
afterEach(() => vi.unstubAllGlobals());

it('loads the exact UUID detail even if the current directory page is empty', async () => {
  const fetch = vi.fn(async (path: string) => json(path.includes(`/users/${targetUserId}?`) ? user : []));
  vi.stubGlobal('fetch', fetch);
  render(<UserAdministration organization={organization} organizations={[organization]} targetUserId={targetUserId} />);
  const details = await screen.findByRole('region', { name: '目标账号' });
  expect(within(details).getByText('target-alice')).toBeVisible();
  expect(within(details).getByText('停用')).toBeVisible();
  expect(fetch.mock.calls.some(([path]) => path === `/api/v1/admin/users/${targetUserId}?organizationId=${organization.id}`)).toBe(true);
});

it.each([403, 404])('shows explicit target rejection for %s without selecting another account', async (status) => {
  vi.stubGlobal('fetch', vi.fn(async (path: string) => path.includes(`/users/${targetUserId}?`) ? json({ code: status === 403 ? 'FEATURE_PERMISSION_DENIED' : 'ADMIN_USER_NOT_FOUND', message: 'private raw error' }, status) : json([{ ...user, username: 'other-directory-user' }])));
  render(<UserAdministration organization={organization} organizations={[organization]} targetUserId={targetUserId} />);
  expect(await screen.findByText(status === 403 ? '无权查看目标账号' : '目标账号不存在或不在当前组织')).toBeVisible();
  expect(screen.queryByRole('region', { name: '目标账号' })).not.toBeInTheDocument();
  expect(screen.queryByText('private raw error')).not.toBeInTheDocument();
});

it.each(['not-a-uuid', '../users', ''])('rejects malformed target %j without issuing a detail request', async (invalid) => {
  const fetch = vi.fn(async (_path: string) => json([]));
  vi.stubGlobal('fetch', fetch);
  render(<UserAdministration organization={organization} organizations={[organization]} targetUserId={invalid} />);
  expect(await screen.findByText('目标账号标识无效')).toBeVisible();
  expect(screen.queryByRole('region', { name: '目标账号' })).not.toBeInTheDocument();
  expect(fetch.mock.calls.some(([path]) => String(path).includes('/users/'))).toBe(false);
});

it('rejects a mismatched detail response without displaying another account', async () => {
  vi.stubGlobal('fetch', vi.fn(async (path: string) => json(path.includes(`/users/${targetUserId}?`) ? { ...user, id: '20000000-0000-4000-8000-000000000002', username: 'wrong-user' } : [])));
  render(<UserAdministration organization={organization} organizations={[organization]} targetUserId={targetUserId} />);
  expect(await screen.findByText('目标账号不存在或不在当前组织')).toBeVisible();
  expect(screen.queryByText('wrong-user')).not.toBeInTheDocument();
});

it('clears details on permission loss and ignores a late detail response from the previous organization', async () => {
  let finish: (value: Response) => void = () => {};
  const fetch = vi.fn(async (path: string) => path.includes(`/users/${targetUserId}?`) ? new Promise<Response>((resolve) => { finish = resolve; }) : json([]));
  vi.stubGlobal('fetch', fetch);
  const view = render(<UserAdministration organization={organization} organizations={[organization]} targetUserId={targetUserId} />);
  expect(await screen.findByText('正在加载目标账号')).toBeVisible();
  view.rerender(<UserAdministration organization={{ ...organization, id: 'foreign', permissions: [] }} organizations={[]} targetUserId={targetUserId} />);
  await act(async () => finish(json(user)));
  expect(await screen.findByText('无权查看目标账号')).toBeVisible();
  expect(screen.queryByText('private@example.test')).not.toBeInTheDocument();
  expect(screen.queryByText('target-alice')).not.toBeInTheDocument();
  await waitFor(() => expect(fetch.mock.calls.filter(([path]) => path.includes('/users/'))).toHaveLength(1));
});
