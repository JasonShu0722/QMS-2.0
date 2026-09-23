import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { SupplierWorkflowActions } from './SupplierWorkflowActions';
import type { SupplierProblem } from './supplierQuality';

const record = { id: '11111111-1111-4111-8111-111111111111', version: 4, stage: 'ISSUED', availableActions: ['VERIFY', 'RETURN', 'REJECT', 'REOPEN', 'CLOSE'] } as SupplierProblem;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
afterEach(() => vi.unstubAllGlobals());

it('renders only server-authorized actions and sends verification with the current content version', async () => {
  let submitted: unknown;
  const changed = vi.fn();
  vi.stubGlobal('fetch', vi.fn(async (path: string, init?: RequestInit) => {
    if (path.endsWith('/csrf')) return json({ csrfToken: 'csrf' });
    submitted = JSON.parse(String(init?.body));
    return json({ ...record, availableActions: ['CLOSE'] });
  }));
  render(<SupplierWorkflowActions record={{ ...record, availableActions: ['VERIFY'] }} changed={changed} reload={vi.fn()} />);
  expect(screen.getByRole('button', { name: '验证通过' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '关闭问题' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '验证通过' }));
  fireEvent.click(await screen.findByRole('button', { name: '确认执行' }));
  await waitFor(() => expect(submitted).toEqual({ action: 'VERIFY', expectedContentVersion: 4, accepted: true }));
  expect(changed).toHaveBeenCalledWith(expect.objectContaining({ availableActions: ['CLOSE'] }), '验证通过成功');
});

it('retains the same idempotency key on a 409 retry and offers an explicit reload', async () => {
  const keys: string[] = [];
  let attempts = 0;
  const reload = vi.fn();
  vi.stubGlobal('fetch', vi.fn(async (path: string, init?: RequestInit) => {
    if (path.endsWith('/csrf')) return json({ csrfToken: 'csrf' });
    keys.push(new Headers(init?.headers).get('Idempotency-Key')!);
    if (++attempts === 1) return json({ code: 'CONCURRENCY_CONFLICT', message: 'conflict' }, 409);
    return json({ ...record, availableActions: [] });
  }));
  render(<SupplierWorkflowActions record={{ ...record, availableActions: ['RETURN'] }} changed={vi.fn()} reload={reload} />);
  fireEvent.click(screen.getByRole('button', { name: '退回重提' }));
  fireEvent.click(await screen.findByRole('button', { name: '确认执行' }));
  expect(await screen.findByText(/内容已被其他人修改/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '重新加载' }));
  expect(reload).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole('button', { name: '退回重提' }));
  fireEvent.click(await screen.findByRole('button', { name: '确认执行' }));
  await waitFor(() => expect(keys).toHaveLength(2));
  expect(keys[0]).toBe(keys[1]);
});

it('shows independent verification denial without offering a forbidden close action', () => {
  render(<SupplierWorkflowActions record={{ ...record, availableActions: [], actionUnavailableReason: 'WORKFLOW_INDEPENDENT_VERIFICATION_REQUIRED' }} changed={vi.fn()} reload={vi.fn()} />);
  expect(screen.getByText('关闭需由另一名内部人员验证当前修订')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '关闭问题' })).not.toBeInTheDocument();
});
