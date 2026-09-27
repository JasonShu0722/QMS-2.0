// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, expect, it, vi } from 'vitest';
import { apiRequest } from '../api/client';
import { AnnouncementReminder } from './AnnouncementReminder';

vi.mock('../api/client', async () => {
  const actual = await vi.importActual<typeof import('../api/client')>('../api/client');
  return { ...actual, apiRequest: vi.fn() };
});

beforeEach(() => vi.mocked(apiRequest).mockReset());

it('shows the global mandatory-read count and refreshes after a reading receipt', async () => {
  vi.mocked(apiRequest)
    .mockResolvedValueOnce({ items: [], unreadMustReadCount: 2 } as never)
    .mockResolvedValueOnce({ items: [], unreadMustReadCount: 0 } as never);
  render(<MemoryRouter><AnnouncementReminder /></MemoryRouter>);
  expect(await screen.findByRole('link', { name: '2 条必读公告未读' })).toHaveAttribute('href', '/app/announcements');
  fireEvent(window, new Event('qms:announcement-read'));
  await waitFor(() => expect(screen.queryByRole('link', { name: '2 条必读公告未读' })).not.toBeInTheDocument());
  expect(vi.mocked(apiRequest)).toHaveBeenCalledTimes(2);
});
