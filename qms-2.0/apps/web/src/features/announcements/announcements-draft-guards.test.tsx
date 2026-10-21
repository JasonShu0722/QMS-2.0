import { ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import type { ReactNode } from 'react';
import { fireEvent, render as testingRender, screen, waitFor, within } from '@testing-library/react';
import baseUserEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { UnsavedChangesProvider } from '../../layouts/UnsavedChanges';
import { apiRequest, csrfToken } from '../../api/client';
import { AnnouncementsPage } from './AnnouncementsPage';

const render = (children: ReactNode) => testingRender(<ConfigProvider locale={zhCN} theme={{ token: { motion: false } }}>{children}</ConfigProvider>);

vi.mock('../../api/client', async () => ({ ...await vi.importActual('../../api/client'), apiRequest: vi.fn(), csrfToken: vi.fn() }));
beforeEach(() => {
  localStorage.clear(); // rc-component uses one shared test-id in test mode; keep dialog and Select IDs distinct.
  vi.stubEnv('NODE_ENV', 'development');
  vi.mocked(apiRequest).mockReset(); vi.mocked(csrfToken).mockReset().mockResolvedValue('csrf');
  vi.mocked(apiRequest).mockImplementation(async (path) => {
    if (path === '/api/v1/announcements/mine') return { items: [], unreadMustReadCount: 0 } as never;
    if (path.startsWith('/api/v1/announcements/manage?')) return { items: [{ id: 'announcement-a', title: '原公告标题', content: '原公告正文', status: 'DRAFT', importance: 'NORMAL', audience: 'ALL', recipientCount: 0, readCount: 0, version: 1, mustRead: false, recipientUserIds: [] }], total: 1, page: 1, pageSize: 20 } as never;
    if (path === '/api/v1/announcements/audience-users') return { items: [], total: 0 } as never;
    throw new Error(`unexpected ${path}`);
  });
});
afterEach(() => vi.unstubAllEnvs());

it.each(['cancel', 'close', 'escape'] as const)('guards announcement draft %s and preserves content until discard is confirmed', async (dismissal) => {
  const user = baseUserEvent.setup();
  render(<MemoryRouter><UnsavedChangesProvider><AnnouncementsPage /></UnsavedChangesProvider></MemoryRouter>);
  await user.click(await screen.findByRole('tab', { name: '公告管理' }));
  await user.click(screen.getByRole('button', { name: /^编\s*辑$/ }));
  const editor = screen.getByRole('dialog');
  fireEvent.change(within(editor).getByLabelText('正文'), { target: { value: '未保存公告正文' } });
  const dismiss = async () => {
    if (dismissal === 'escape') fireEvent.keyDown(editor, { key: 'Escape', code: 'Escape', keyCode: 27 });
    else await user.click(within(editor).getByRole('button', { name: dismissal === 'cancel' ? /^取\s*消$/ : '关闭' }));
  };
  await dismiss();
  await screen.findByText('当前草稿尚未保存，继续将放弃修改。');
  await user.click(screen.getByRole('button', { name: '继续编辑' }));
  await waitFor(() => expect(screen.queryByRole('dialog', { name: '当前草稿尚未保存，继续将放弃修改。' })).not.toBeInTheDocument());
  expect(within(editor).getByLabelText('正文')).toHaveValue('未保存公告正文');
  await dismiss();
  await user.click(await screen.findByRole('button', { name: /^放弃修改(?:并关闭)?$/ }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  await user.click(screen.getByRole('button', { name: /^编\s*辑$/ }));
  expect(screen.getByLabelText('正文')).toHaveValue('原公告正文');
  expect(vi.mocked(apiRequest).mock.calls.some(([, init]) => init?.method === 'PUT' || init?.method === 'POST')).toBe(false);
}, 30000);
