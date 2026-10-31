import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { UserTemporaryPassword } from './UserTemporaryPassword';
import type { AdminUser } from './admin';

const user = { id: 'u', username: 'alice' } as AdminUser;
const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
afterEach(() => vi.unstubAllGlobals());

it('requires confirmation before revoking the target sessions with a direct temporary reset', async () => {
  const fetcher = vi.fn(async (path: string) => path.endsWith('/csrf') ? json({ csrfToken: 'csrf' }) : json({ userId: 'u', status: 'AVAILABLE', temporaryPassword: 'new-temporary-password' }));
  vi.stubGlobal('fetch', fetcher);
  render(<UserTemporaryPassword user={user} organizationId="org" />);
  await userEvent.click(screen.getByRole('button', { name: '直接重置临时密码' }));
  expect(await screen.findByText('旧密码和目标账号的现有会话将立即失效，首次登录需改密。')).toBeInTheDocument();
  expect(fetcher).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole('button', { name: '确认重置' }));
  expect(await screen.findByText('new-temporary-password')).toBeInTheDocument();
});

it('refreshes before copying rather than returning the earlier visible password', async () => {
  let count = 0;
  const clipboard = vi.fn(async () => {});
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: clipboard } });
  vi.stubGlobal('fetch', vi.fn(async (path: string) => path.endsWith('/csrf') ? json({ csrfToken: 'csrf' }) : json(++count === 1 ? { userId: 'u', status: 'AVAILABLE', temporaryPassword: 'visible-password' } : { userId: 'u', status: 'UNAVAILABLE' })));
  render(<UserTemporaryPassword user={user} organizationId="org" />);
  await userEvent.click(screen.getByRole('button', { name: '查询临时密码' }));
  expect(await screen.findByText('visible-password')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '下载有效临时密码' })).toBeEnabled();
  await userEvent.click(screen.getByRole('button', { name: '复制临时密码' }));
  await waitFor(() => expect(screen.queryByText('visible-password')).not.toBeInTheDocument());
  expect(clipboard).not.toHaveBeenCalled();
});

it('uses only domain callbacks and hides custom-password and read controls when not allowed', async () => {
  const reset = vi.fn(async () => ({ userId: 'u', status: 'AVAILABLE' as const, temporaryPassword: 'domain-password' }));
  const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
  render(<UserTemporaryPassword user={user} organizationId="org" domain={{ read: vi.fn(), reset }} canRead={false} canReset initialValue={{ userId: 'u', status: 'UNAVAILABLE' }} />);
  expect(screen.queryByRole('button', { name: '查询临时密码' })).not.toBeInTheDocument();
  expect(screen.queryByLabelText('管理员设定临时密码')).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: '直接重置临时密码' }));
  await userEvent.click(await screen.findByRole('button', { name: '确认重置' }));
  await waitFor(() => expect(reset).toHaveBeenCalledOnce());
  expect(screen.queryByText('domain-password')).not.toBeInTheDocument();
  expect(reset).toHaveBeenCalledOnce(); expect(fetcher).not.toHaveBeenCalled();
});

it.each(['read', 'reset'] as const)('clears visible secrets on permission loss and rejects late %s even after permission is restored', async (action) => {
  let resolve!: (value: { userId: string; status: 'AVAILABLE'; temporaryPassword: string }) => void;
  const pending = new Promise<{ userId: string; status: 'AVAILABLE'; temporaryPassword: string }>((done) => { resolve = done; });
  const domain = { read: vi.fn(() => pending), reset: vi.fn(() => pending) };
  const props = { user, organizationId: 'org', domain, initialValue: { userId: 'u', status: 'AVAILABLE' as const, temporaryPassword: 'visible-before-revoke' } };
  const view = render(<UserTemporaryPassword {...props} />);
  expect(screen.getByText('visible-before-revoke')).toBeInTheDocument();
  if (action === 'read') fireEvent.click(screen.getByRole('button', { name: '查询临时密码' }));
  else { fireEvent.click(screen.getByRole('button', { name: '直接重置临时密码' })); fireEvent.click(await screen.findByRole('button', { name: '确认重置' })); }
  await waitFor(() => expect(domain[action]).toHaveBeenCalledOnce());
  view.rerender(<UserTemporaryPassword {...props} canRead={false} canReset={false} />);
  expect(screen.queryByText('visible-before-revoke')).not.toBeInTheDocument();
  view.rerender(<UserTemporaryPassword {...props} canRead canReset />);
  await act(async () => { resolve({ userId: 'u', status: 'AVAILABLE', temporaryPassword: 'late-revoked-password' }); await pending; });
  expect(screen.queryByText('late-revoked-password')).not.toBeInTheDocument();
  expect(screen.queryByText('visible-before-revoke')).not.toBeInTheDocument();
});
