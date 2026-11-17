import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { UserAdministration } from './UserAdministration';
import type { AdminOrganization, AdminUser } from './admin';
import { openUserManagement } from './user-management-test-helpers';
import { useWorkTabsStore } from '../../work-tabs/workTabsStore';

vi.mock('./UserForceDelete', () => ({ UserForceDelete: ({ onPendingChanged }: { onPendingChanged?: (pending: boolean) => void }) => <button onClick={() => onPendingChanged?.(true)}>模拟未知删除</button> }));

const organization: AdminOrganization = { id: 'org', name: 'Organization', code: 'O', type: 'INTERNAL', permissions: ['account:users:read', 'account:users:delete'] };
const user: AdminUser = { id: 'u1', username: 'alice', fullName: null, phone: null, email: null, emailVerifiedAt: null, profileVersion: 3, securityVersion: 1, accountType: 'INTERNAL', status: 'ACTIVE', mfaEnabled: false, organizationId: 'org', organization: { id: 'org', code: 'O', name: 'Organization' }, createdAt: '', updatedAt: '' };
const json = (value: unknown) => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });
afterEach(() => { vi.unstubAllGlobals(); useWorkTabsStore.getState().reset(); });

it('keeps the command owner when an unknown delete is followed by a parent close', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => json([user])));
  render(<UserAdministration organization={organization} organizations={[organization]} />);
  const management = await openUserManagement('状态与删除');
  fireEvent.click(management.getByRole('button', { name: '模拟未知删除' }));
  expect(management.getByRole('tab', { name: '账号安全' })).toHaveAttribute('aria-disabled', 'true');
  const close = management.queryByRole('button', { name: 'Close' });
  if (close) fireEvent.click(close);
  expect(screen.getByRole('dialog', { name: '管理用户' })).toBeInTheDocument();
  expect(management.getByRole('button', { name: '模拟未知删除' })).toBeInTheDocument();
  await waitFor(() => expect(screen.getByRole('dialog', { name: '管理用户' })).toBeVisible());
});

it('irreversibly removes the old target after a batched principal A-B-A', async () => {
  const principal = 'INTERNAL:org:actor';
  useWorkTabsStore.getState().bindSession(principal);
  const target = { ...user, id: '11111111-1111-4111-8111-111111111111', email: 'private@example.test' };
  vi.stubGlobal('fetch', vi.fn(async (path: string) => json(path.includes(`/users/${target.id}?`) ? target : [])));
  render(<UserAdministration organization={organization} organizations={[organization]} targetUserId={target.id} />);
  expect(await screen.findByText('private@example.test')).toBeInTheDocument();
  act(() => { useWorkTabsStore.getState().bindSession('INTERNAL:org:other'); useWorkTabsStore.getState().bindSession(principal); });
  expect(screen.queryByText('private@example.test')).not.toBeInTheDocument();
  expect(screen.queryByRole('dialog', { name: '管理用户' })).not.toBeInTheDocument();
});
