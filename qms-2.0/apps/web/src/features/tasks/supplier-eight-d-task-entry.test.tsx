import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { LanguageProvider } from '../../i18n/Language';
import { useWorkTabsStore } from '../../work-tabs/workTabsStore';
import { MyTasksPage } from './MyTasksPage';
import { SupplierNotificationsPage } from '../supplier-notifications/SupplierNotificationsPage';

beforeEach(() => { useWorkTabsStore.getState().reset(); useWorkTabsStore.getState().bindSession('INTERNAL:org:user'); });
afterEach(() => { vi.unstubAllGlobals(); useWorkTabsStore.getState().reset(); });
it.each([false, true])('mounts new endpoints only on the active supplier 8D tab (portal=%s) and preserves old notification tab', async portal => {
  if (portal) useWorkTabsStore.getState().bindSession('SUPPLIER:vendor:user');
  const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({ items: [], total: 0, examined: 0, scannedCount: 0, nextCursor: null }), { headers: { 'content-type': 'application/json' } }));
  vi.stubGlobal('fetch', fetchMock);
  render(<MemoryRouter><LanguageProvider>{portal ? <SupplierNotificationsPage /> : <MyTasksPage />}</LanguageProvider></MemoryRouter>);
  expect(fetchMock.mock.calls.some(args => String(args[0]).includes('/eight-d/'))).toBe(false);
  expect(fetchMock.mock.calls.some(args => String(args[0]).includes('/source-collaboration/'))).toBe(false);
  fireEvent.click(screen.getByRole('tab', { name: '供应商8D' }));
  expect(await screen.findByText('暂无供应商8D待办')).toBeVisible();
  const calls = vi.mocked(fetch).mock.calls.filter(([path]) => String(path).includes('/eight-d/'));
  expect(calls).toHaveLength(2);
  expect(calls.every(([path]) => String(path).startsWith(`/api/v1/${portal ? 'supplier-portal' : 'supplier-quality'}/eight-d/`))).toBe(true);
  const collaboration = vi.mocked(fetch).mock.calls.filter(([path]) => String(path).includes('/source-collaboration/'));
  expect(collaboration).toHaveLength(portal ? 0 : 1);
  if (portal) expect(screen.queryByRole('region', { name: 'SQE来源协作跟进' })).not.toBeInTheDocument();
  else expect(await screen.findByText('暂无SQE来源协作跟进')).toBeVisible();
  fireEvent.click(screen.getByRole('tab', { name: portal ? '原通知' : '我的通知' }));
  await waitFor(() => expect([...calls, ...collaboration].every(([, init]) => init?.signal?.aborted)).toBe(true));
  expect(screen.queryByRole('region', { name: '供应商8D正式待办' })).not.toBeInTheDocument();
  expect(screen.queryByRole('region', { name: 'SQE来源协作跟进' })).not.toBeInTheDocument();
  expect(await screen.findByText('暂无通知')).toBeVisible();
});

it('does not switch the legacy portal tab while its existing mark-read mutation is in flight', async () => {
  let complete!: (response: Response) => void;
  const response = (body: unknown) => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const path = String(input);
    if (path.endsWith('/csrf')) return response({ csrfToken: 'token' });
    if (path.endsWith('/read')) return new Promise<Response>(resolve => { complete = resolve; });
    return response({ items: [{ id: 'notice', problemId: 'problem', version: 1, subject: '原提醒', createdAt: '2026-10-28T08:00:00Z' }], total: 1 });
  }));
  render(<MemoryRouter><LanguageProvider><SupplierNotificationsPage /></LanguageProvider></MemoryRouter>);
  fireEvent.click(await screen.findByRole('button', { name: '标为已读' }));
  await waitFor(() => expect(complete).toBeTypeOf('function'));
  fireEvent.click(screen.getByRole('tab', { name: '供应商8D' }));
  expect(screen.getByRole('tab', { name: '原通知' })).toHaveAttribute('aria-selected', 'true');
  complete(response({}));
});
