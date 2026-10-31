import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ConfigProvider } from 'antd';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { apiRequest } from '../../api/client';
import { LanguageProvider } from '../../i18n/Language';
import { UnsavedChangesProvider } from '../../layouts/UnsavedChanges';
import { useWorkTabsStore } from '../../work-tabs/workTabsStore';
import { MyTasksPage } from './MyTasksPage';
import { ClosureTaskInbox } from './ClosureTaskInbox';
import { ProcessEightDTaskInbox } from './ProcessEightDTaskInbox';
import { CustomerFaeTaskInbox } from './CustomerFaeTaskInbox';
import { SupplierEightDTaskInbox } from './SupplierEightDTaskInbox';
import { SupplierNotificationsPage } from '../supplier-notifications/SupplierNotificationsPage';
import { AnnouncementsPage } from '../announcements/AnnouncementsPage';
import { AuditManagementPage } from '../audit-management/AuditManagementPage';
import { AuditStandardsPage } from '../audit-standards/AuditStandardsPage';
import { CustomerLegacyQualityPage } from '../customer-quality/CustomerLegacyQualityPage';

vi.mock('../../api/client', async original => ({ ...await original<typeof import('../../api/client')>(), apiRequest: vi.fn() }));

beforeEach(() => {
  vi.stubEnv('NODE_ENV', 'development');
  localStorage.clear();
  useWorkTabsStore.getState().reset();
  useWorkTabsStore.getState().bindSession('INTERNAL:organization:remaining-lists');
  vi.mocked(apiRequest).mockReset().mockImplementation(async path => {
    if (path.endsWith('/my-permissions')) return { organizationId: 'organization', permissions: [] };
    if (path.endsWith('/complaints') || path.includes('/customers') || path.includes('/fae-tasks')) return [];
    if (path.endsWith('/mine')) return { items: [], unreadMustReadCount: 0 };
    const query = new URL(path, 'https://qms.test').searchParams;
    return { items: [], total: 120, page: Number(query.get('page') ?? 1), pageSize: Number(query.get('pageSize') ?? 20), examined: 0, scannedCount: 0, nextCursor: null };
  });
});
afterEach(() => { useWorkTabsStore.getState().reset(); localStorage.clear(); vi.unstubAllEnvs(); });

function mount(content: React.ReactNode) {
  return render(<ConfigProvider theme={{ token: { motion: false } }}><MemoryRouter><LanguageProvider><UnsavedChangesProvider>{content}</UnsavedChangesProvider></LanguageProvider></MemoryRouter></ConfigProvider>);
}
const requested = (prefix: string, size: number, position = 0) => vi.mocked(apiRequest).mock.calls.some(([path]) => {
  const url = new URL(path, 'https://qms.test');
  return url.pathname === prefix && url.searchParams.get('pageSize') === String(size)
    && Number(url.searchParams.get('offset') ?? Number(url.searchParams.get('page') ?? 1) - 1) === position;
});
async function chooseFifty(input: HTMLElement) {
  fireEvent.mouseDown(input);
  expect(input).toHaveAttribute('aria-expanded', 'true');
  const owner = document.getElementById(input.getAttribute('aria-controls')!);
  expect(owner).toHaveAttribute('role', 'listbox');
  const popup = owner!.closest('.ant-select-dropdown') as HTMLElement;
  const option = await within(popup).findByText('50 条/页', { selector: '.ant-select-item-option-content' });
  await waitFor(() => expect(option).toBeVisible());
  fireEvent.click(option);
}

it.each([
  ['tasks', <MyTasksPage />, '/api/v1/tasks'],
  ['supplier notifications', <SupplierNotificationsPage />, '/api/v1/supplier-portal/notifications'],
  ['closure duties', <ClosureTaskInbox />, '/api/v1/tasks/closure'],
  ['process duties', <ProcessEightDTaskInbox />, '/api/v1/process-quality/eight-d/tasks'],
  ['supplier cursor duties', <SupplierEightDTaskInbox />, '/api/v1/supplier-quality/eight-d/tasks'],
  ['audit imports', <AuditManagementPage />, '/api/v1/audit-management/imports'],
  ['audit catalog', <AuditStandardsPage />, '/api/v1/audit-standards/templates'],
])('remaining lists request the default twenty for %s', async (_, content, endpoint) => {
  mount(content);
  await waitFor(() => expect(requested(endpoint, 20)).toBe(true));
});

it('remaining lists change the audit catalog request size and reset its real page without remounting the editor', async () => {
  mount(<AuditStandardsPage />);
  const catalog = screen.getByRole('region', { name: '审核标准目录' });
  await waitFor(() => expect(within(catalog).getByTitle('2')).toBeVisible());
  fireEvent.click(within(catalog).getByTitle('2'));
  await waitFor(() => expect(requested('/api/v1/audit-standards/templates', 20, 1)).toBe(true));
  fireEvent.click(screen.getByRole('button', { name: '新建标准' }));
  const title = await screen.findByText('新建审核标准', { selector: '.ant-drawer-title' });
  const editor = title.closest('[role="dialog"]') as HTMLElement;
  const name = within(editor).getByLabelText('标准名称');
  const sizeInput = within(catalog.querySelector('.ant-pagination') as HTMLElement).getByRole('combobox');
  await chooseFifty(sizeInput);
  await waitFor(() => expect(requested('/api/v1/audit-standards/templates', 50)).toBe(true));
  expect(within(editor).getByLabelText('标准名称')).toBe(name);
});

it('remaining lists expose independent task and notice sizes with real offset resets', async () => {
  mount(<MyTasksPage />);
  await screen.findByTitle('2');
  fireEvent.click(screen.getByTitle('2'));
  await waitFor(() => expect(requested('/api/v1/tasks', 20, 20)).toBe(true));
  await chooseFifty(within(document.querySelector('.ant-pagination') as HTMLElement).getByRole('combobox'));
  await waitFor(() => expect(requested('/api/v1/tasks', 50)).toBe(true));
  expect(requested('/api/v1/notifications', 20)).toBe(true);
});

it('remaining lists expose real audit import pages and reset the request when size changes', async () => {
  mount(<AuditManagementPage />);
  await screen.findByTitle('2');
  fireEvent.click(screen.getByTitle('2'));
  await waitFor(() => expect(requested('/api/v1/audit-management/imports', 20, 1)).toBe(true));
  const section = screen.getByRole('region', { name: '审核导入行' });
  await chooseFifty(within(section.querySelector('.ant-pagination') as HTMLElement).getByRole('combobox'));
  await waitFor(() => expect(requested('/api/v1/audit-management/imports', 50)).toBe(true));
});

it('remaining lists keep supplier cursor and source scanning semantics while providing column controls', async () => {
  mount(<SupplierEightDTaskInbox />);
  const tasks = screen.getByRole('region', { name: '供应商8D正式待办' });
  const collaboration = screen.getByRole('region', { name: 'SQE来源协作跟进' });
  await waitFor(() => expect(tasks.querySelector('.qms-ledger__tools button')).toHaveAccessibleName('列设置'));
  expect(collaboration.querySelector('.qms-ledger__tools button')).toHaveAccessibleName('列设置');
  expect(within(tasks).queryByText(/总数/)).not.toBeInTheDocument();
  expect(within(collaboration).queryByText(/总数/)).not.toBeInTheDocument();
  expect(vi.mocked(apiRequest).mock.calls.some(([path]) => path.includes('scanLimit=25'))).toBe(true);
});

it('remaining lists paginate actual FAE arrays and keep the task entry required', async () => {
  vi.mocked(apiRequest).mockResolvedValue(Array.from({ length: 21 }, (_, index) => ({ kind: 'CUSTOMER_COMPLAINT_FAE', analysis: { id: `analysis-${index}`, complaintId: `complaint-${index}`, organizationId: 'organization', faeStatus: 'NOT_ANALYSED', completedOn: null } })));
  mount(<CustomerFaeTaskInbox />);
  await waitFor(() => expect(document.querySelectorAll('tbody a')).toHaveLength(20));
  expect(document.querySelector('.qms-ledger__tools button')).toHaveAccessibleName('列设置');
  fireEvent.click(screen.getByTitle('2'));
  expect(document.querySelectorAll('tbody a')).toHaveLength(1);
  expect(document.querySelector('tbody a')).toHaveAccessibleName('查看客诉并解析');
});

it('remaining lists paginate the actual legacy complaint array at twenty', async () => {
  const original = vi.mocked(apiRequest).getMockImplementation()!;
  vi.mocked(apiRequest).mockImplementation(async (path, init) => path.endsWith('/complaints')
    ? Array.from({ length: 21 }, (_, index) => ({ id: `complaint-${index}`, complaint_number: `LEGACY-${index}`, complaint_type: 'ZERO_KM', product_code: 'P', severity: 'LOW', status: 'OPEN', created_at: '2026-10-31T00:00:00Z' })) : original(path, init));
  mount(<CustomerLegacyQualityPage />);
  const first = (await screen.findByText('LEGACY-0', { selector: 'button span' })).closest('button')!;
  expect(first).toHaveAccessibleName('LEGACY-0');
  const ledger = first.closest('.qms-ledger') as HTMLElement;
  expect(within(ledger).queryByText('LEGACY-20', { selector: 'button span' })).not.toBeInTheDocument();
  const last = within(ledger).getByText('LEGACY-19', { selector: 'button span' }).closest('button')!;
  expect(last).toHaveAccessibleName('LEGACY-19');
  expect(last).toBeVisible();
  const settings = ledger.querySelector('.qms-ledger__tools button');
  expect(settings).toHaveAccessibleName('列设置');
  expect(settings).toBeVisible();
});

it('remaining lists expose real management announcement page sizes', async () => {
  mount(<AnnouncementsPage />);
  fireEvent.click(await screen.findByRole('tab', { name: '公告管理' }));
  await chooseFifty(screen.getByRole('combobox'));
  await waitFor(() => expect(requested('/api/v1/announcements/manage', 50)).toBe(true));
});
