import { render, screen, waitFor } from '@testing-library/react';
import { ConfigProvider } from 'antd';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { apiRequest } from '../../api/client';
import { LanguageProvider } from '../../i18n/Language';
import { preferenceKey } from '../../ui/ledger/model';
import { useWorkTabsStore } from '../../work-tabs/workTabsStore';
import { ClosureTaskInbox } from './ClosureTaskInbox';
import { ProcessEightDTaskInbox } from './ProcessEightDTaskInbox';
import { SupplierEightDTaskInbox } from './SupplierEightDTaskInbox';

vi.mock('../../api/client', async original => ({ ...await original<typeof import('../../api/client')>(), apiRequest: vi.fn() }));

const sessionScope = 'INTERNAL:home:quality';
beforeEach(() => {
  localStorage.clear();
  useWorkTabsStore.getState().reset();
  useWorkTabsStore.getState().bindSession(sessionScope);
  vi.mocked(apiRequest).mockReset().mockResolvedValue({ items: [], total: 120, examined: 0, scannedCount: 0, nextCursor: null });
});
afterEach(() => { useWorkTabsStore.getState().reset(); localStorage.clear(); });

function seed(ledgerId: string, kind: 'pageSize' | 'columns', organizationId: string, value: unknown) {
  const key = preferenceKey({ sessionScope, organizationId, portal: 'business' }, ledgerId, kind)!;
  localStorage.setItem(key, JSON.stringify({ schema: 1, value }));
}
function mount(content: React.ReactNode) {
  return render(<ConfigProvider theme={{ token: { motion: false } }}><MemoryRouter initialEntries={['/app/my-tasks?organizationId=url-only-target']}><LanguageProvider>{content}</LanguageProvider></MemoryRouter></ConfigProvider>);
}
const inboxes = [
  { name: 'closure', content: <ClosureTaskInbox />, taskLedger: 'closure-duties', noticeLedger: 'closure-notifications', taskPath: '/api/v1/tasks/closure', noticePath: '/api/v1/notifications/closure' },
  { name: 'process', content: <ProcessEightDTaskInbox />, taskLedger: 'process-quality-eight-d-tasks', noticeLedger: 'process-quality-eight-d-notifications', taskPath: '/api/v1/process-quality/eight-d/tasks', noticePath: '/api/v1/process-quality/eight-d/notifications' },
];

it.each(inboxes)('quality scope keeps $name page sizes in the actor home when requests do not target the URL organization', async ({ content, taskLedger, noticeLedger, taskPath, noticePath }) => {
  for (const ledgerId of [taskLedger, noticeLedger]) {
    seed(ledgerId, 'pageSize', 'home', 50);
    seed(ledgerId, 'pageSize', 'url-only-target', 10);
  }
  mount(content);
  await waitFor(() => {
    for (const endpoint of [taskPath, noticePath]) {
      const request = vi.mocked(apiRequest).mock.calls.find(([path]) => path.startsWith(`${endpoint}?`));
      expect(request).toBeDefined();
      const query = new URL(request![0], 'https://qms.test').searchParams;
      expect(query.get('pageSize')).toBe('50');
      expect(query.has('organizationId')).toBe(false);
    }
  });
});

it.each(inboxes)('quality scope keeps $name columns in the same actor home as its real requests', async ({ content, taskLedger }) => {
  seed(taskLedger, 'columns', 'home', { widths: { reportNumber: 333 } });
  seed(taskLedger, 'columns', 'url-only-target', { widths: { reportNumber: 666 } });
  const view = mount(content);
  await waitFor(() => expect(view.container.querySelector('[role="separator"][aria-label="调整列宽 问题编号"]')).toHaveAttribute('aria-valuenow', '333'));
});

it.each([
  ['Task load batch size', '待办加载批次条数'],
  ['Notification load batch size', '通知加载批次条数'],
])('quality English exposes the %s accessible name', (english, chinese) => {
  localStorage.setItem('qms:locale:v1', 'en-US');
  mount(<SupplierEightDTaskInbox />);
  expect(screen.getByLabelText(english)).toHaveAttribute('role', 'combobox');
  expect(screen.queryByLabelText(chinese)).not.toBeInTheDocument();
});
