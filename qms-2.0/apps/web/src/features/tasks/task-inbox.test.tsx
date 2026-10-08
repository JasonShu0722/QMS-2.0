import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { MyTasksPage } from './MyTasksPage';
import { LanguageProvider, LanguageSwitcher } from '../../i18n/Language';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const task = { id: 'task-one', version: 3, instanceId: 'instance-one', fixedVersion: 'version-one', entryInstanceVersion: 1, nodeId: 'node-one', name: '验证问题', type: 'VERIFICATION', problemId: 'problem-one', reportNumber: 'ZXPR-QA-2609-001', dueAt: null, status: 'PENDING', claimedByUserId: null, claimedAt: null, canAct: true, canClaim: true, canRelease: false };
const notification = { id: 'notice-one', organizationId: 'organization-one', problemId: task.problemId, version: 5, taskId: task.id, instanceId: task.instanceId, fixedVersion: task.fixedVersion, nodeId: task.nodeId, nodeName: task.name, kind: 'TASK_REMINDER', subject: '时限提醒', body: '请检查待处理的问题', status: 'DELIVERED', readAt: null, createdAt: '2026-09-19T12:00:00.000Z' };

function mount() {
  return render(<LanguageProvider><MemoryRouter><LanguageSwitcher /><MyTasksPage /></MemoryRouter></LanguageProvider>);
}

afterEach(() => { vi.unstubAllGlobals(); localStorage.clear(); });

it('loads tasks and notifications independently and claims using only the returned version and CSRF', async () => {
  let claimed = false;
  const fetchMock = vi.fn(async (path: string, init?: RequestInit) => {
    if (path.endsWith('/csrf')) return json({ csrfToken: 'csrf-token' });
    if (path.includes('/claim')) { claimed = true; return json({ ...task, version: 4, claimedByUserId: 'current-user', canClaim: false, canRelease: true }); }
    if (path.startsWith('/api/v1/notifications')) return json({ items: [notification], total: 1 });
    return json({ items: [{ ...task, ...(claimed ? { version: 4, claimedByUserId: 'current-user', canClaim: false, canRelease: true } : {}) }], total: 1 });
  });
  vi.stubGlobal('fetch', fetchMock);
  mount();
  expect(await screen.findByText(task.reportNumber)).toBeInTheDocument();
  await waitFor(() => expect(fetchMock.mock.calls.some(([path]) => path.startsWith('/api/v1/notifications'))).toBe(true));
  await userEvent.click(screen.getByRole('button', { name: '领取' }));
  await screen.findByRole('button', { name: '释放' });
  const write = fetchMock.mock.calls.find(([path]) => path.endsWith('/claim'));
  expect(write?.[1]).toMatchObject({ method: 'POST', headers: { 'x-csrf-token': 'csrf-token' }, body: JSON.stringify({ expectedVersion: 3 }) });
  expect(fetchMock.mock.calls.some(([path]) => path.includes('/complete'))).toBe(false);
});

it('keeps another qualified owner visible without allowing claim or release', async () => {
  vi.stubGlobal('fetch', vi.fn(async (path: string) => json(path.startsWith('/api/v1/tasks')
    ? { items: [{ ...task, claimedByUserId: 'another-user', canAct: false, canClaim: false, canRelease: false }], total: 1 }
    : { items: [], total: 0 })));
  mount();
  expect(await screen.findByText(task.reportNumber)).toBeInTheDocument();
  expect(screen.getByText('已由其他人领取')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '释放' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '领取' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '重新领取' })).not.toBeInTheDocument();
});

it('refreshes a conflicting task without exposing server details or repeating the write', async () => {
  let attempts = 0;
  const fetchMock = vi.fn(async (path: string) => {
    if (path.endsWith('/csrf')) return json({ csrfToken: 'csrf' });
    if (path.endsWith('/claim')) { attempts++; return json({ code: 'CONCURRENCY_CONFLICT', message: 'private database details', traceId: 'task-trace' }, 409); }
    if (path.startsWith('/api/v1/notifications')) return json({ items: [], total: 0 });
    return json({ items: [{ ...task, ...(attempts ? { version: 4, claimedByUserId: 'other', canAct: false, canClaim: false } : {}) }], total: 1 });
  });
  vi.stubGlobal('fetch', fetchMock);
  mount();
  await userEvent.click(await screen.findByRole('button', { name: '领取' }));
  expect(await screen.findByText('task-trace')).toBeInTheDocument();
  expect(await screen.findByText('已由其他人领取')).toBeInTheDocument();
  expect(screen.queryByText(/private database/)).not.toBeInTheDocument();
  expect(attempts).toBe(1);
});

it('shows a task permission failure separately from the available notification list', async () => {
  vi.stubGlobal('fetch', vi.fn(async (path: string) => path.startsWith('/api/v1/tasks')
    ? json({ code: 'FEATURE_PERMISSION_DENIED', traceId: 'scope-trace' }, 403)
    : json({ items: [notification], total: 1 })));
  mount();
  expect(await screen.findByText('scope-trace')).toBeInTheDocument();
  expect(screen.queryByText('暂无待办')).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('tab', { name: '我的通知' }));
  expect(await screen.findByRole('link', { name: '查看关联实例' })).toHaveAttribute('href', '/app/problem-workspace/problem-one?organizationId=organization-one&instanceId=instance-one');
  expect(await screen.findByText(notification.body)).toBeInTheDocument();
});

it('marks a personal notification read with its version and shows the updated state', async () => {
  let read = false;
  const fetchMock = vi.fn(async (path: string, init?: RequestInit) => {
    if (path.endsWith('/csrf')) return json({ csrfToken: 'csrf' });
    if (path.endsWith('/read')) { read = true; return json({ ...notification, readAt: '2026-09-19T12:01:00Z', version: 6 }); }
    return json(path.startsWith('/api/v1/tasks') ? { items: [], total: 0 } : { items: [{ ...notification, readAt: read ? '2026-09-19T12:01:00Z' : null, version: read ? 6 : 5 }], total: 1 });
  });
  vi.stubGlobal('fetch', fetchMock);
  mount();
  await userEvent.click(screen.getByRole('tab', { name: '我的通知' }));
  await userEvent.click(await screen.findByRole('button', { name: '标为已读' }));
  expect(await screen.findByText('已读')).toBeInTheDocument();
  expect(fetchMock.mock.calls.find(([path]) => path.endsWith('/read'))?.[1]).toMatchObject({ method: 'POST', body: JSON.stringify({ expectedVersion: 5 }) });
});

it('uses server pagination and translates task controls without changing report content', async () => {
  const fetchMock = vi.fn(async (path: string) => json(path.startsWith('/api/v1/tasks') ? { items: [task], total: 30 } : { items: [], total: 0 }));
  vi.stubGlobal('fetch', fetchMock);
  mount();
  await screen.findByText(task.reportNumber);
  await userEvent.click(screen.getByTitle('2'));
  await waitFor(() => expect(fetchMock.mock.calls.some(([path]) => path.startsWith('/api/v1/tasks?') && path.includes('offset=25'))).toBe(true));
  await userEvent.click(screen.getByRole('button', { name: 'Language / 语言' }));
  await userEvent.click(screen.getByRole('menuitemradio', { name: 'English' }));
  const panel = screen.getByRole('tabpanel', { name: 'My tasks' });
  expect(within(panel).getByRole('button', { name: 'Claim' })).toBeInTheDocument();
  expect(screen.getByText(task.reportNumber)).toBeInTheDocument();
});

it('lists failed tasks and retries with the returned version', async () => {
  const failedTask = { ...task, status: 'FAILED', canClaim: false, canRelease: false, canRetry: true };
  const fetchMock = vi.fn(async (path: string, init?: RequestInit) => {
    if (path.endsWith('/csrf')) return json({ csrfToken: 'csrf-token' });
    if (path.endsWith('/retry')) return json({ ...failedTask, status: 'PENDING', version: 4, canRetry: false });
    if (path.startsWith('/api/v1/notifications')) return json({ items: [], total: 0 });
    return json({ items: [failedTask], total: 1 });
  });
  vi.stubGlobal('fetch', fetchMock);
  mount();
  await userEvent.selectOptions(await screen.findByLabelText('任务状态'), 'FAILED');
  expect((await screen.findAllByText('失败')).length).toBeGreaterThan(0);
  await userEvent.click(await screen.findByRole('button', { name: '失败重试' }));
  expect((await screen.findAllByText('待处理')).length).toBeGreaterThan(0);
  expect(fetchMock.mock.calls.find(([path]) => path.endsWith('/retry'))?.[1]).toMatchObject({ method: 'POST', body: JSON.stringify({ expectedVersion: 3 }) });
});
