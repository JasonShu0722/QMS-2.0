import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { UserTemporaryPassword } from './UserTemporaryPassword';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
afterEach(() => vi.unstubAllGlobals());

it('retries the frozen temporary password body and key while blocking another password', async () => {
  const writes: { path: string; body: string; key: string }[] = [];
  vi.stubGlobal('fetch', vi.fn(async (path: string, init: RequestInit) => {
    if (path.endsWith('/csrf')) return json({ csrfToken: 'csrf' });
    writes.push({ path, body: String(init.body), key: (init.headers as Record<string, string>)['Idempotency-Key']! });
    if (writes.length === 1) throw new TypeError('response lost');
    return json({ userId: 'user', status: 'AVAILABLE', temporaryPassword: 'Original-secret-123' });
  }));
  render(<UserTemporaryPassword user={{ id: 'user', username: 'alice' }} organizationId="org" />);
  const supplied = screen.getByLabelText('管理员设定临时密码');
  fireEvent.change(supplied, { target: { value: 'Original-secret-123' } });
  fireEvent.click(screen.getByRole('button', { name: '直接重置临时密码' }));
  fireEvent.click(await screen.findByRole('button', { name: '确认重置' }));
  await screen.findByText('请求失败，请重试');
  expect(supplied).toBeDisabled();
  expect(screen.getByRole('button', { name: '直接重置临时密码' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: '重试确认结果' }));
  await screen.findByText('Original-secret-123');
  expect(writes).toHaveLength(2);
  expect(writes[1]).toEqual(writes[0]);
  expect(JSON.parse(writes[1]!.body)).toEqual({ temporaryPassword: 'Original-secret-123' });
  expect(supplied).toBeEnabled();
});

it('permits changing a temporary password after a known validation rejection', async () => {
  const writes: { body: string; key: string }[] = [];
  vi.stubGlobal('fetch', vi.fn(async (path: string, init: RequestInit) => {
    if (path.endsWith('/csrf')) return json({ csrfToken: 'csrf' });
    writes.push({ body: String(init.body), key: (init.headers as Record<string, string>)['Idempotency-Key']! });
    return writes.length === 1 ? json({ code: 'VALIDATION_FAILED' }, 400) : json({ userId: 'user', status: 'UNAVAILABLE' });
  }));
  render(<UserTemporaryPassword user={{ id: 'user', username: 'alice' }} organizationId="org" />);
  const supplied = screen.getByLabelText('管理员设定临时密码');
  fireEvent.change(supplied, { target: { value: 'Original-secret-123' } });
  fireEvent.click(screen.getByRole('button', { name: '直接重置临时密码' }));
  fireEvent.click(await screen.findByRole('button', { name: '确认重置' }));
  await screen.findByText('请检查填写内容');
  expect(supplied).toBeEnabled();
  fireEvent.change(supplied, { target: { value: 'Updated-secret-123' } });
  fireEvent.click(screen.getByRole('button', { name: '直接重置临时密码' }));
  fireEvent.click(await screen.findByRole('button', { name: '确认重置' }));
  await waitFor(() => expect(writes).toHaveLength(2));
  expect(JSON.parse(writes[1]!.body)).toEqual({ temporaryPassword: 'Updated-secret-123' });
  expect(writes[1]!.key).not.toBe(writes[0]!.key);
});

it('starts a new reset key only after explicit abandonment of the unknown request', async () => {
  const writes: { body: string; key: string }[] = [];
  vi.stubGlobal('fetch', vi.fn(async (path: string, init: RequestInit) => {
    if (path.endsWith('/csrf')) return json({ csrfToken: 'csrf' });
    writes.push({ body: String(init.body), key: (init.headers as Record<string, string>)['Idempotency-Key']! });
    if (writes.length === 1) throw new TypeError('response lost');
    return json({ userId: 'user', status: 'UNAVAILABLE' });
  }));
  render(<UserTemporaryPassword user={{ id: 'user', username: 'alice' }} organizationId="org" />);
  const supplied = screen.getByLabelText('管理员设定临时密码');
  fireEvent.change(supplied, { target: { value: 'Original-secret-123' } });
  fireEvent.click(screen.getByRole('button', { name: '直接重置临时密码' }));
  fireEvent.click(await screen.findByRole('button', { name: '确认重置' }));
  await screen.findByText('请求失败，请重试');
  fireEvent.click(screen.getByRole('button', { name: '放弃修改' }));
  await screen.findByText('原请求结果尚未确认，放弃后无法继续重试原请求。');
  expect(supplied).toBeDisabled();
  expect(writes).toHaveLength(1);
  const confirmations = screen.getAllByRole('button', { name: '放弃修改' });
  fireEvent.click(confirmations[confirmations.length - 1]!);
  await waitFor(() => expect(supplied).toBeEnabled());
  expect(supplied).toHaveValue('');
  fireEvent.change(supplied, { target: { value: 'Updated-secret-123' } });
  fireEvent.click(screen.getByRole('button', { name: '直接重置临时密码' }));
  fireEvent.click(await screen.findByRole('button', { name: '确认重置' }));
  await waitFor(() => expect(writes).toHaveLength(2));
  expect(JSON.parse(writes[1]!.body)).toEqual({ temporaryPassword: 'Updated-secret-123' });
  expect(writes[1]!.key).not.toBe(writes[0]!.key);
});

it('reuses the frozen domain reset callback without revealing a secret to a reset-only caller', async () => {
  const reset = vi.fn().mockRejectedValueOnce(new TypeError('response lost')).mockResolvedValue({ userId: 'user', status: 'AVAILABLE', temporaryPassword: 'private-domain-secret' });
  render(<UserTemporaryPassword user={{ id: 'user', username: 'alice' }} organizationId="org" canRead={false} domain={{ read: vi.fn(), reset }} />);
  fireEvent.click(screen.getByRole('button', { name: '直接重置临时密码' }));
  fireEvent.click(await screen.findByRole('button', { name: '确认重置' }));
  await screen.findByText('请求失败，请重试');
  expect(screen.getByRole('button', { name: '直接重置临时密码' })).toBeDisabled();
  expect(screen.queryByRole('button', { name: '放弃修改' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '重试确认结果' }));
  await waitFor(() => expect(reset).toHaveBeenCalledTimes(2));
  expect(screen.queryByText('private-domain-secret')).not.toBeInTheDocument();
});
