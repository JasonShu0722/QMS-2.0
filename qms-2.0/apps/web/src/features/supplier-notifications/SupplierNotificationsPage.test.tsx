import { afterEach, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { LanguageProvider } from '../../i18n/Language';
import { SupplierNotificationsPage } from './SupplierNotificationsPage';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const notice = {
  id: 'notice-one', problemId: 'problem-one', taskId: 'task-one', reportNumber: 'SQ-2609-001', nodeName: '供应商回复',
  kind: 'TASK_ASSIGNED', subject: '请回复供应商问题', body: 'SQ-2609-001：请提交整改回复', version: 1,
  readAt: null, createdAt: '2026-09-23T12:00:00.000Z',
};

function mount() {
  render(<LanguageProvider><MemoryRouter><SupplierNotificationsPage /></MemoryRouter></LanguageProvider>);
}

afterEach(() => { vi.unstubAllGlobals(); localStorage.clear(); });

it('loads only the supplier-scoped contract, links to the problem and sends the returned version on read', async () => {
  let read = false;
  const fetchMock = vi.fn(async (path: string, init?: RequestInit) => {
    if (path.endsWith('/csrf')) return json({ csrfToken: 'csrf-token' });
    if (path.endsWith('/read')) { read = true; return json({ ...notice, version: 2, readAt: '2026-09-23T12:01:00.000Z' }, 201); }
    return json({ items: [{ ...notice, ...(read ? { version: 2, readAt: '2026-09-23T12:01:00.000Z' } : {}) }], total: 1 });
  });
  vi.stubGlobal('fetch', fetchMock);
  mount();
  expect(await screen.findByRole('link', { name: '查看关联问题' })).toHaveAttribute('href', '/supplier/corrections/problems/problem-one');
  await userEvent.click(screen.getByRole('button', { name: '标为已读' }));
  expect(await screen.findByText('已读')).toBeInTheDocument();
  expect(fetchMock.mock.calls.filter(([path]) => path.startsWith('/api/v1/supplier-portal/notifications?'))).toHaveLength(2);
  expect(fetchMock.mock.calls.find(([path]) => path.endsWith('/read'))?.[1]).toMatchObject({
    method: 'POST', headers: { 'x-csrf-token': 'csrf-token' }, body: JSON.stringify({ expectedVersion: 1 }),
  });
  expect(fetchMock.mock.calls.some(([path]) => path.startsWith('/api/v1/tasks') || path.startsWith('/api/v1/notifications?'))).toBe(false);
});

it('shows an empty state and requests server pagination', async () => {
  const fetchMock = vi.fn(async (path: string) => json({ items: path.includes('offset=20') ? [notice] : [], total: 26 }));
  vi.stubGlobal('fetch', fetchMock);
  mount();
  expect(await screen.findByText('暂无通知')).toBeInTheDocument();
  await userEvent.click(screen.getByTitle('2'));
  expect(await screen.findByRole('link', { name: '查看关联问题' })).toBeInTheDocument();
  expect(fetchMock.mock.calls.some(([path]) => path === '/api/v1/supplier-portal/notifications?pageSize=20&offset=20')).toBe(true);
});

it('shows access failure and a retry without displaying server internals', async () => {
  let attempts = 0;
  const fetchMock = vi.fn(async () => {
    attempts++;
    return attempts === 1 ? json({ code: 'FEATURE_PERMISSION_DENIED', message: 'private database details', traceId: 'supplier-trace' }, 403)
      : json({ items: [notice], total: 1 });
  });
  vi.stubGlobal('fetch', fetchMock);
  mount();
  expect(await screen.findByText('supplier-trace')).toBeInTheDocument();
  expect(screen.queryByText(/private database/)).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: '刷新' }));
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  expect(await screen.findByRole('link', { name: '查看关联问题' })).toBeInTheDocument();
});
