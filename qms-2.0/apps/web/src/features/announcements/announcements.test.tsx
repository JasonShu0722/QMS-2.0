import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { apiRequest, csrfToken, ApiError } from '../../api/client';
import { AnnouncementsPage } from './AnnouncementsPage';

vi.mock('../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../api/client')>('../../api/client');
  return { ...actual, apiRequest: vi.fn(), csrfToken: vi.fn() };
});

beforeEach(() => {
  vi.mocked(apiRequest).mockReset();
  vi.mocked(csrfToken).mockReset();
  vi.mocked(csrfToken).mockResolvedValue('csrf-test');
});

it('reminds the recipient of an unread mandatory announcement and records explicit reading', async () => {
  let read = false;
  vi.mocked(apiRequest).mockImplementation(async (path) => {
    if (path === '/api/v1/announcements/mine') return { items: [{ id: 'announcement-1', title: '工艺变更', content: '请阅读本月工艺变更', importance: 'IMPORTANT', mustRead: true, status: 'PUBLISHED', readAt: read ? '2026-09-24T01:00:00Z' : null, publishedAt: '2026-09-24T00:00:00Z' }], unreadMustReadCount: read ? 0 : 1 } as never;
    if (String(path).startsWith('/api/v1/announcements/manage?')) throw new ApiError({ code: 'FEATURE_PERMISSION_DENIED', message: '无权执行此操作' }, 403);
    if (path === '/api/v1/announcements/announcement-1/read') { read = true; return { readAt: '2026-09-24T01:00:00Z' } as never; }
    throw new Error(String(path));
  });
  render(<AnnouncementsPage />);
  expect(await screen.findByText('1 条重要公告待阅读')).toBeVisible();
  expect(screen.getByText('请阅读本月工艺变更')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: '我已阅读' }));
  await waitFor(() => expect(vi.mocked(apiRequest)).toHaveBeenCalledWith('/api/v1/announcements/announcement-1/read', expect.objectContaining({ method: 'POST', headers: expect.objectContaining({ 'x-csrf-token': 'csrf-test' }) })));
  await waitFor(() => expect(screen.queryByText('1 条重要公告待阅读')).not.toBeInTheDocument());
  expect(screen.queryByRole('button', { name: '新建公告' })).not.toBeInTheDocument();
});

it('requests the next management page instead of silently stopping at the first page', async () => {
  vi.mocked(apiRequest).mockImplementation(async (path) => {
    if (path === '/api/v1/announcements/mine') return { items: [], unreadMustReadCount: 0 } as never;
    if (String(path).startsWith('/api/v1/announcements/manage?')) {
      const page = new URL(String(path), 'http://localhost').searchParams.get('page');
      return { items: [{ id: 'announcement-' + page, title: '第' + page + '页公告', content: '正文', status: 'DRAFT', recipientCount: 0, readCount: 0, version: 1, mustRead: false, recipientUserIds: [] }], total: 25, page: Number(page), pageSize: 20 } as never;
    }
    if (path === '/api/v1/announcements/audience-users') return { items: [], total: 0 } as never;
    throw new Error(String(path));
  });
  render(<AnnouncementsPage />);
  fireEvent.click(await screen.findByText('公告管理'));
  expect(await screen.findByText('第1页公告')).toBeVisible();
  fireEvent.click(screen.getByTitle('2'));
  expect(await screen.findByText('第2页公告')).toBeVisible();
  expect(vi.mocked(apiRequest)).toHaveBeenCalledWith('/api/v1/announcements/manage?page=2&pageSize=20', expect.any(Object));
});
