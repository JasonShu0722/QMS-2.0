import { render, screen, waitFor } from '@testing-library/react';
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
  expect(await screen.findByText('旧密码和目标账号的现有会话将立即失效。')).toBeInTheDocument();
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
