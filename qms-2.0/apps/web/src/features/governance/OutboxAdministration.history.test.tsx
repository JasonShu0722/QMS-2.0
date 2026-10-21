import { ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { AdminOrganization } from '../admin/admin';
import { OutboxAdministration } from './OutboxAdministration';

const organization: AdminOrganization = { id: 'org-a', code: 'A', name: '甲组织', type: 'INTERNAL', permissions: ['outbox:read'] };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
function deferred() {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>((finish) => { resolve = finish; });
  return { promise, resolve };
}
const attempts = (id: string) => ({ items: [{ id: `attempt-${id}`, attemptNumber: 1, outcome: `RECEIPT_${id}`, occurredAt: '2026-10-21T00:00:00Z' }] });
const view = (org = organization) => <ConfigProvider locale={zhCN} theme={{ token: { motion: false } }}><OutboxAdministration organization={org} /></ConfigProvider>;

beforeEach(() => localStorage.clear());
afterEach(() => vi.unstubAllGlobals());

function mountOutbox() {
  const first = deferred();
  const second = deferred();
  vi.stubGlobal('fetch', vi.fn(async (path: string) => {
    if (path.includes('/event-a/attempts?')) return first.promise;
    if (path.includes('/event-b/attempts?')) return second.promise;
    if (path.startsWith('/api/v1/outbox/failures?')) return json({ total: 2, items: ['a', 'b'].map((id) => ({ id: `event-${id}`, eventType: 'WORKFLOW_TASK_ASSIGNED', aggregateId: `resource-${id}`, attempts: 1, createdAt: '2026-10-21T00:00:00Z', reasonCode: 'OUTBOX_DELIVERY_FAILED' })) });
    throw new Error(`unexpected ${path}`);
  }));
  return { ...render(view()), first, second };
}

async function openHistory(user: ReturnType<typeof userEvent.setup>, id: string) {
  const resource = await screen.findByText(`resource-${id}`);
  await user.click(within(resource.closest('tr')!).getByRole('button', { name: '查看尝试' }));
  return screen.findByRole('dialog', { name: '通知尝试回执' });
}

it('does not reopen closed attempt history when its response arrives late', async () => {
  const user = userEvent.setup();
  const { first } = mountOutbox();
  const dialog = await openHistory(user, 'a');
  await user.click(within(dialog).getByRole('button', { name: '关闭' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

  await act(async () => { first.resolve(json(attempts('A'))); });
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(screen.queryByText('RECEIPT_A')).not.toBeInTheDocument();
}, 30000);

it.each(['success', 'error'] as const)('keeps event B receipts when the closed event A returns a late %s', async (result) => {
  const user = userEvent.setup();
  const { first, second } = mountOutbox();
  const firstDialog = await openHistory(user, 'a');
  await user.click(within(firstDialog).getByRole('button', { name: '关闭' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  const secondDialog = await openHistory(user, 'b');
  await act(async () => { second.resolve(json(attempts('B'))); });
  expect(await within(secondDialog).findByText('RECEIPT_B')).toBeVisible();

  await act(async () => { first.resolve(result === 'success' ? json(attempts('A')) : json({ code: 'FEATURE_PERMISSION_DENIED', traceId: 'stale-attempt-error' }, 403)); });
  expect(within(secondDialog).getByText('RECEIPT_B')).toBeVisible();
  expect(screen.queryByText('RECEIPT_A')).not.toBeInTheDocument();
  expect(screen.queryByText('stale-attempt-error')).not.toBeInTheDocument();
  expect(screen.getByText('resource-b')).toBeVisible();
}, 30000);

it('invalidates pending attempt history when the organization changes', async () => {
  const user = userEvent.setup();
  const { first, rerender } = mountOutbox();
  await openHistory(user, 'a');
  rerender(view({ ...organization, id: 'org-b', code: 'B', name: '乙组织' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

  await act(async () => { first.resolve(json(attempts('A'))); });
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(screen.queryByText('RECEIPT_A')).not.toBeInTheDocument();
}, 30000);
