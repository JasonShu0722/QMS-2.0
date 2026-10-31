import { ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AnnouncementsPage } from './AnnouncementsPage';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
function deferred() {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>((finish) => { resolve = finish; });
  return { promise, resolve };
}
const receipts = (id: string) => [{ userId: `reader-${id}`, readAt: '2026-10-21T00:00:00Z', readTraceId: `receipt-${id}` }];

beforeEach(() => { localStorage.clear(); vi.stubEnv('NODE_ENV', 'development'); });
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

function mountAnnouncements() {
  const first = deferred();
  const second = deferred();
  vi.stubGlobal('fetch', vi.fn(async (path: string) => {
    if (path === '/api/v1/announcements/announcement-a/receipts') return first.promise;
    if (path === '/api/v1/announcements/announcement-b/receipts') return second.promise;
    if (path === '/api/v1/announcements/mine') return json({ items: [], unreadMustReadCount: 0 });
    if (path.startsWith('/api/v1/announcements/manage?')) return json({ items: ['a', 'b'].map((id) => ({ id: `announcement-${id}`, title: `公告${id.toUpperCase()}`, content: `正文${id.toUpperCase()}`, status: 'PUBLISHED', importance: 'NORMAL', audience: 'ALL', recipientCount: 1, readCount: 1, version: 1, mustRead: false, recipientUserIds: [] })), total: 2, page: 1, pageSize: 20 });
    if (path === '/api/v1/announcements/audience-users') return json({ items: [], total: 0 });
    throw new Error(`unexpected ${path}`);
  }));
  render(<ConfigProvider locale={zhCN} theme={{ token: { motion: false } }}><AnnouncementsPage /></ConfigProvider>);
  return { first, second };
}

async function openAudit(user: ReturnType<typeof userEvent.setup>, index: number) {
  await user.click(screen.getAllByRole('button', { name: '阅读审计' })[index]);
  return screen.findByRole('dialog', { name: '阅读审计' });
}

it('keeps the audit drawer closed when its pending receipt response arrives', async () => {
  const user = userEvent.setup();
  const { first } = mountAnnouncements();
  await user.click(await screen.findByRole('tab', { name: '公告管理' }));
  const drawer = await openAudit(user, 0);
  await user.click(within(drawer).getByRole('button', { name: '关闭' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

  await act(async () => { first.resolve(json(receipts('a'))); });
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(screen.queryByText('reader-a')).not.toBeInTheDocument();
}, 30000);

it.each(['success', 'error'] as const)('keeps announcement B audit receipts when the closed announcement A returns a late %s', async (result) => {
  const user = userEvent.setup();
  const { first, second } = mountAnnouncements();
  await user.click(await screen.findByRole('tab', { name: '公告管理' }));
  const firstDrawer = await openAudit(user, 0);
  await user.click(within(firstDrawer).getByRole('button', { name: '关闭' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  const secondDrawer = await openAudit(user, 1);
  await act(async () => { second.resolve(json(receipts('b'))); });
  expect(await within(secondDrawer).findByText('reader-b')).toBeVisible();
  expect(within(secondDrawer).getByText('receipt-b')).toBeVisible();

  await act(async () => { first.resolve(result === 'success' ? json(receipts('a')) : json({ code: 'FEATURE_PERMISSION_DENIED' }, 403)); });
  expect(within(secondDrawer).getByText('reader-b')).toBeVisible();
  expect(within(secondDrawer).getByText('receipt-b')).toBeVisible();
  expect(screen.queryByText('reader-a')).not.toBeInTheDocument();
  expect(screen.queryByText('receipt-a')).not.toBeInTheDocument();
  expect(within(secondDrawer).queryByText('无权执行此操作')).not.toBeInTheDocument();
}, 30000);
