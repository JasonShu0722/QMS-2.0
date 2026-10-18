import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { beforeEach, expect, it, vi } from 'vitest';
import { InternalLayout } from '../../layouts/InternalLayout';
import { ApiError, apiRequest } from '../../api/client';
import { getAdminOrganizations } from '../admin/admin';
import { useWorkTabsStore } from '../../work-tabs/workTabsStore';
import { LanguageProvider } from '../../i18n/Language';
import { getWorkflowVersion, getWorkflowOptions } from '../workflows/workflow-api';

vi.mock('../../api/client', async () => ({ ...await vi.importActual<typeof import('../../api/client')>('../../api/client'), apiRequest: vi.fn() }));
vi.mock('../admin/admin', async () => ({ ...await vi.importActual<typeof import('../admin/admin')>('../admin/admin'), getAdminOrganizations: vi.fn() }));
vi.mock('../announcements/AnnouncementsPage', () => ({ AnnouncementsPage: () => <div>Announcements</div> }));
vi.mock('../../layouts/AnnouncementReminder', () => ({ AnnouncementReminder: () => null }));
vi.mock('../workflows/workflow-api', async () => ({ ...await vi.importActual<typeof import('../workflows/workflow-api')>('../workflows/workflow-api'), getWorkflowVersion: vi.fn(), getWorkflowOptions: vi.fn() }));
vi.mock('../workflows/WorkflowCanvas', () => ({ WorkflowCanvas: () => null }));
const organizations = [{ id: 'org', name: '组织', code: 'org', type: 'INTERNAL', permissions: ['account:users:read'] }] as Awaited<ReturnType<typeof getAdminOrganizations>>;
function LocationProbe() { return <output aria-label="current path">{useLocation().pathname}</output>; }
function mount(path = '/app/announcements') { return render(<MemoryRouter initialEntries={[path]}><LanguageProvider><InternalLayout /><LocationProbe /></LanguageProvider></MemoryRouter>); }
async function expectCurrentWorkPage(title: string, allTabs = '全部标签') {
  const header = within(screen.getByRole('button', { name: allTabs }).closest('header')!);
  expect(header.getAllByRole('navigation')).toHaveLength(1);
  fireEvent.click(header.getByRole('button', { name: allTabs }));
  const drawer = within(await screen.findByRole('dialog'));
  expect(drawer.getByRole('button', { name: title })).toHaveAttribute('aria-current', 'page');
  fireEvent.click(drawer.getByRole('button', { name: /^(close|关闭)$/i }));
}
beforeEach(() => {
  vi.resetAllMocks(); localStorage.clear(); sessionStorage.clear(); useWorkTabsStore.getState().reset();
  vi.mocked(getAdminOrganizations).mockResolvedValue([]);
  vi.mocked(apiRequest).mockResolvedValue({ organizationId: 'org', permissions: [] });
});

it.each([[false, false], [true, false], [false, true], [true, true]])('filters workflow and platform independently: workflow=%s platform=%s', async (workflow, platform) => {
  vi.mocked(apiRequest).mockResolvedValue({ organizationId: 'org', permissions: workflow ? ['workflow:manage'] : [] });
  vi.mocked(getAdminOrganizations).mockResolvedValue(platform ? organizations : []);
  mount();
  const menu = within(screen.getByRole('navigation', { name: '系统服务 上下文菜单' }));
  await waitFor(() => expect(!!menu.queryByRole('link', { name: '流程设计' })).toBe(workflow));
  await waitFor(() => expect(!!menu.queryByRole('link', { name: '平台管理' })).toBe(platform));
  expect(menu.getByRole('link', { name: '公告' })).toHaveAttribute('href', '/app/announcements');
  expect(menu.getByRole('link', { name: '个人账号' })).toHaveAttribute('href', '/app/account');
  expect(screen.getByRole('link', { name: '系统服务' })).toHaveAttribute('href', '/app/announcements');
  fireEvent.click(screen.getByRole('button', { name: '打开导航' }));
  const mobile = within(screen.getByRole('dialog'));
  expect(!!mobile.queryByRole('link', { name: '流程设计' })).toBe(workflow);
  expect(!!mobile.queryByRole('link', { name: '平台管理' })).toBe(platform);
});

it('retains personal services and explicit errors when both permission queries fail', async () => {
  vi.mocked(apiRequest).mockRejectedValue(new Error('offline'));
  vi.mocked(getAdminOrganizations).mockRejectedValue(new Error('offline'));
  mount();
  expect(await screen.findByText(/管理权限加载失败/)).toBeVisible();
  expect(await screen.findByText(/流程权限加载失败/)).toBeVisible();
  const menu = within(screen.getByRole('navigation', { name: '系统服务 上下文菜单' }));
  expect(menu.getByRole('link', { name: '公告' })).toBeVisible();
  expect(menu.getByRole('link', { name: '个人账号' })).toBeVisible();
  expect(menu.queryByRole('link', { name: '流程设计' })).not.toBeInTheDocument();
  expect(menu.queryByRole('link', { name: '平台管理' })).not.toBeInTheDocument();
});

it.each(['workflow', 'platform'])('does not infer a grant from the other query when %s permission loading fails', async (failed) => {
  vi.mocked(apiRequest).mockResolvedValue({ organizationId: 'org', permissions: ['workflow:manage'] });
  vi.mocked(getAdminOrganizations).mockResolvedValue(organizations);
  if (failed === 'workflow') vi.mocked(apiRequest).mockRejectedValue(new Error('offline'));
  else vi.mocked(getAdminOrganizations).mockRejectedValue(new Error('offline'));
  mount();
  await screen.findByText(failed === 'workflow' ? /流程权限加载失败/ : /管理权限加载失败/);
  const menu = within(screen.getByRole('navigation', { name: '系统服务 上下文菜单' }));
  await waitFor(() => expect(!!menu.queryByRole('link', { name: '流程设计' })).toBe(failed !== 'workflow'));
  await waitFor(() => expect(!!menu.queryByRole('link', { name: '平台管理' })).toBe(failed !== 'platform'));
});

it('clears old grants on identity or organization change and ignores stale replies', async () => {
  let resolveOld!: (value: unknown) => void;
  vi.mocked(apiRequest).mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; }));
  vi.mocked(getAdminOrganizations).mockResolvedValueOnce(organizations);
  mount();
  await screen.findByRole('link', { name: '平台管理' });
  act(() => useWorkTabsStore.getState().bindSession('INTERNAL:new-org:new-user'));
  await waitFor(() => expect(apiRequest).toHaveBeenCalledTimes(2));
  await act(async () => resolveOld({ organizationId: 'org', permissions: ['workflow:manage'] }));
  expect(screen.queryByRole('link', { name: '流程设计' })).not.toBeInTheDocument();
  expect(screen.queryByRole('link', { name: '平台管理' })).not.toBeInTheDocument();
});

it('updates the selected menu, header and work tab when language changes', async () => {
  mount();
  fireEvent.click(screen.getByRole('radio', { name: 'EN' }));
  expect(screen.getByRole('navigation', { name: 'System services Context menu' })).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'All tabs' }));
  expect(await screen.findByRole('button', { name: 'Announcements' })).toBeVisible();
});

it('keeps workflow selection and the loaded object name in the shell without another detail request', async () => {
  const definitionId = '11111111-1111-4111-8111-111111111111';
  const versionId = '22222222-2222-4222-8222-222222222222';
  const path = `/app/workflow-designer/${definitionId}/${versionId}`;
  let resolveDirectory!: (value: Awaited<ReturnType<typeof getAdminOrganizations>>) => void;
  vi.mocked(getAdminOrganizations).mockImplementationOnce(() => new Promise(resolve => { resolveDirectory = resolve; }));
  vi.mocked(apiRequest).mockResolvedValue({ organizationId: 'org', permissions: ['workflow:manage'] });
  vi.mocked(getWorkflowVersion).mockResolvedValue({ id: definitionId, organizationId: 'org', description: null, code: 'QA', name: '来料 · 质量流程', revision: 1, version: { id: versionId, workflowDefinitionId: definitionId, publishedAt: null, publishedById: null, changeNote: null, status: 'DRAFT', version: 2, structureSnapshot: { nodes: [], transitions: [] } } });
  vi.mocked(getWorkflowOptions).mockResolvedValue({ roles: [], users: [], permissions: [] });
  mount(path);
  await screen.findByRole('heading', { name: '来料 · 质量流程' });
  const menu = within(screen.getByRole('navigation', { name: '系统服务 上下文菜单' }));
  expect(menu.getByRole('link', { name: '流程设计' })).toHaveAttribute('aria-current', 'page');
  expect(menu.queryByText('流程编辑')).not.toBeInTheDocument();
  await expectCurrentWorkPage('来料 · 质量流程 · 编辑');
  expect(useWorkTabsStore.getState().tabs.find(tab => tab.path === path)?.title).toBe('来料 · 质量流程 · 编辑');
  await act(async () => resolveDirectory([]));
  expect(useWorkTabsStore.getState().tabs.find(tab => tab.path === path)?.title).toBe('来料 · 质量流程 · 编辑');
  fireEvent.click(screen.getByRole('radio', { name: 'EN' }));
  await waitFor(() => expect(useWorkTabsStore.getState().tabs.find(tab => tab.path === path)?.title).toBe('来料 · 质量流程 · Edit'));
  expect(screen.getByRole('heading', { name: '来料 · 质量流程' })).toBeVisible();
  await expectCurrentWorkPage('来料 · 质量流程 · Edit', 'All tabs');
  expect(getWorkflowVersion).toHaveBeenCalledTimes(1);
});

it.each([[403, false], [404, false], [403, true], [404, true]])('keeps failed workflow %s as a closable current work page with prior pages=%s', async (status, priorPages) => {
  const path = '/app/workflow-designer/11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222';
  vi.mocked(getWorkflowVersion).mockRejectedValue(new ApiError({ code: status === 403 ? 'FEATURE_PERMISSION_DENIED' : 'WORKFLOW_NOT_FOUND', message: 'unsafe' }, status));
  vi.mocked(getWorkflowOptions).mockResolvedValue({ roles: [], users: [], permissions: [] });
  if (priorPages) {
    useWorkTabsStore.getState().openTab({ id: '/app/announcements', path: '/app/announcements', title: '旧公告' });
    useWorkTabsStore.getState().openTab({ id: '/app/account', path: '/app/account', title: '旧账号' });
  }
  mount(path);
  expect(useWorkTabsStore.getState().activeTabId).toBe(path);
  expect(useWorkTabsStore.getState().tabs.find(tab => tab.id === path)).toMatchObject({ path, title: '流程设计' });
  expect(await screen.findByText(status === 403 ? '无权执行此操作' : '请求被拒绝，请检查权限和填写内容后重试')).toBeVisible();
  if (priorPages) {
    fireEvent.click(screen.getByRole('button', { name: '关闭 旧账号' }));
    expect(screen.getByLabelText('current path')).toHaveTextContent(path);
    expect(useWorkTabsStore.getState().activeTabId).toBe(path);
  }
  fireEvent.click(screen.getByRole('button', { name: '全部标签' }));
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '关闭 流程设计' }));
  expect(screen.getByLabelText('current path')).toHaveTextContent(priorPages ? '/app/announcements' : '/app/workbench');
  expect(getWorkflowVersion).toHaveBeenCalledTimes(1);
});

it('does not translate an actual workflow name that matches a static English translation key', async () => {
  localStorage.setItem('qms:locale:v1', 'en-US');
  const definitionId = '11111111-1111-4111-8111-111111111111';
  const versionId = '22222222-2222-4222-8222-222222222222';
  const path = `/app/workflow-designer/${definitionId}/${versionId}`;
  vi.mocked(getWorkflowVersion).mockResolvedValue({ id: definitionId, organizationId: 'org', description: null, code: 'QA', name: '流程设计', revision: 1, version: { id: versionId, workflowDefinitionId: definitionId, publishedAt: null, publishedById: null, changeNote: null, status: 'DRAFT', version: 2, structureSnapshot: { nodes: [], transitions: [] } } });
  vi.mocked(getWorkflowOptions).mockResolvedValue({ roles: [], users: [], permissions: [] });
  mount(path);
  expect(await screen.findByRole('heading', { name: '流程设计' })).toBeVisible();
  expect(screen.getByRole('navigation', { name: 'Workflow hierarchy' })).toHaveTextContent('流程设计');
  expect(useWorkTabsStore.getState().tabs.find(tab => tab.id === path)?.title).toBe('流程设计 · Edit');
  await expectCurrentWorkPage('流程设计 · Edit', 'All tabs');
  expect(within(screen.getByRole('button', { name: 'All tabs' }).closest('header')!).queryByText('Workflow design')).not.toBeInTheDocument();
});
