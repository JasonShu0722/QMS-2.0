import { render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { apiRequest } from '../../api/client';
import { TaskStatisticsPage } from './TaskStatisticsPage';

vi.mock('../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../api/client')>('../../api/client');
  return { ...actual, apiRequest: vi.fn() };
});

beforeEach(() => vi.mocked(apiRequest).mockReset());

it('shows task status and ownership statistics', async () => {
  vi.mocked(apiRequest).mockResolvedValueOnce({ total: 8, pending: 3, inProgress: 4, overdue: 1, failed: 2, unclaimed: 2, mine: 3, dueToday: 1, dueThisWeek: 5 });
  render(<TaskStatisticsPage />);
  expect(await screen.findByText('进行中任务')).toBeVisible();
  expect(screen.getByText('已逾期')).toBeVisible();
  expect(screen.getByText('失败待恢复')).toBeVisible();
  expect(screen.getByText('今日到期任务：1 项。统计只包含当前可见且仍处于运行中的流程任务，失败待恢复单独计数。')).toBeVisible();
  expect(apiRequest).toHaveBeenCalledWith('/api/v1/tasks/statistics');
});

it('shows a recoverable failure state', async () => {
  vi.mocked(apiRequest).mockRejectedValueOnce(new Error('offline'));
  render(<TaskStatisticsPage />);
  expect(await screen.findByText('任务统计加载失败，请重试。')).toBeVisible();
});
