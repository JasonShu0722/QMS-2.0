import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import { UserMfaPolicy } from './UserMfaPolicy';
import type { AdminUser } from './admin';

const user = { id: 'user', username: 'alice' } as AdminUser;
const policy = { userId: 'user', required: false, bound: true, override: null, roleRequired: false, securityVersion: 4 };
const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
afterEach(() => vi.unstubAllGlobals());

it('freezes the original MFA body and key until an unknown write is retried successfully', async () => {
  const writes: { path: string; body: string; key: string }[] = [];
  let reads = 0;
  vi.stubGlobal('fetch', vi.fn(async (path: string, init: RequestInit) => {
    if (path.endsWith('/csrf')) return json({ csrfToken: 'csrf' });
    if (init.method === 'PUT') {
      writes.push({ path, body: String(init.body), key: (init.headers as Record<string, string>)['Idempotency-Key']! });
      if (writes.length === 1) throw new TypeError('response lost');
      return json({ ...policy, required: true, securityVersion: 5 });
    }
    reads++; return json(policy);
  }));
  render(<MemoryRouter><UserMfaPolicy user={user} organizationId="org" canWrite onClose={vi.fn()} onSaved={vi.fn()} /></MemoryRouter>);
  const required = await screen.findByRole('switch', { name: '要求 MFA' });
  fireEvent.click(required);
  fireEvent.click(screen.getByRole('button', { name: '保存 MFA 设置' }));
  fireEvent.click(await screen.findByRole('button', { name: '确认保存' }));
  await screen.findByText('请求失败，请重试');
  expect(required).toBeDisabled();
  expect(screen.getByRole('button', { name: '重新加载 MFA 设置' })).toBeDisabled();
  fireEvent.click(required);
  expect(required).toBeChecked();
  expect(reads).toBe(1);
  fireEvent.click(screen.getByRole('button', { name: '重试确认结果' }));
  await waitFor(() => expect(writes).toHaveLength(2));
  expect(writes[1]).toEqual(writes[0]);
  expect(JSON.parse(writes[1]!.body)).toEqual({ required: true, expectedSecurityVersion: 4 });
  await waitFor(() => expect(required).toBeEnabled());
});

it('requires an explicit unknown-request abandonment before releasing the MFA owner', async () => {
  const close = vi.fn();
  vi.stubGlobal('fetch', vi.fn(async (path: string, init: RequestInit) => {
    if (path.endsWith('/csrf')) return json({ csrfToken: 'csrf' });
    if (init.method === 'PUT') throw new TypeError('response lost');
    return json(policy);
  }));
  render(<MemoryRouter><UserMfaPolicy user={user} organizationId="org" canWrite onClose={close} onSaved={vi.fn()} /></MemoryRouter>);
  fireEvent.click(await screen.findByRole('switch', { name: '要求 MFA' }));
  fireEvent.click(screen.getByRole('button', { name: '保存 MFA 设置' }));
  fireEvent.click(await screen.findByRole('button', { name: '确认保存' }));
  await screen.findByText('请求失败，请重试');
  fireEvent.click(within(screen.getByRole('dialog', { name: 'alice · MFA 设置' })).getByRole('button', { name: 'Close' }));
  const guard = within(await screen.findByRole('dialog', { name: '放弃未确认的请求？' }));
  expect(close).not.toHaveBeenCalled();
  expect(guard.getByText('原请求结果尚未确认，放弃后无法继续重试原请求。')).toBeInTheDocument();
  fireEvent.click(guard.getByRole('button', { name: '放弃修改并关闭' }));
  expect(close).toHaveBeenCalledOnce();
});
