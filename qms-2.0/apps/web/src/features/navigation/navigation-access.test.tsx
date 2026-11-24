import { transferableAbortController } from 'node:util';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { App } from '../../App';
import { InternalLayout } from '../../layouts/InternalLayout';
import { apiRequest, getSession } from '../../api/client';
import { getAdminOrganizations } from '../admin/admin';
import { useWorkTabsStore } from '../../work-tabs/workTabsStore';
import { LanguageProvider } from '../../i18n/Language';
import { ConsoleLayout } from '../../console/ConsoleLayout';
import type { ConsoleContext } from '../../console/console-navigation';

vi.mock('../../api/client', async original => ({ ...await original<typeof import('../../api/client')>(), apiRequest: vi.fn(), getSession: vi.fn() }));
vi.mock('../admin/admin', async original => ({ ...await original<typeof import('../admin/admin')>(), getAdminOrganizations: vi.fn() }));
vi.mock('../announcements/AnnouncementsPage', () => ({ AnnouncementsPage: () => <div>Announcements</div> }));
vi.mock('../../layouts/AnnouncementReminder', () => ({ AnnouncementReminder: () => null }));
const id = '11111111-1111-4111-8111-111111111111';
const definitionId = '22222222-2222-4222-8222-222222222222';
const versionId = '33333333-3333-4333-8333-333333333333';
const path = '/console/workflows';
const organization = { id, name: '组织', code: 'org', type: 'INTERNAL', status: 'ACTIVE', configurationRequired: false } as const;
function context(workflow = true, users = false, actor = 'actor'): ConsoleContext {
  const modules: ConsoleContext['modules'] = [];
  if (workflow) modules.push({ key: 'workflows', scope: 'SESSION_HOME', coverage: 'ORGANIZATION', organizationId: id, permissions: ['workflow:manage'] });
  if (users) modules.push({ key: 'users', scope: 'TARGET', coverage: 'ORGANIZATION', organizationId: id, permissions: ['account:users:read'] });
  return { actor: { id: actor, accountType: 'INTERNAL', homeOrganization: organization }, targetOrganization: organization, organizations: [organization], hasPlatformAdministrator: false, modules };
}
function LocationProbe() { return <output aria-label="current path">{useLocation().pathname}</output>; }
function mountBusiness() { return render(<MemoryRouter initialEntries={['/app/announcements']}><LanguageProvider><InternalLayout /><LocationProbe /></LanguageProvider></MemoryRouter>); }
function mountConsole(destination = path) { window.history.replaceState({}, '', destination); return render(<App />); }
function preserveBusiness() { useWorkTabsStore.getState().openTab({ id: 'business', path: '/app/announcements', title: '旧公告' }); return useWorkTabsStore.getState().tabs; }
beforeEach(() => {
  vi.resetAllMocks(); localStorage.clear(); sessionStorage.clear(); useWorkTabsStore.getState().reset();
  useWorkTabsStore.getState().bindSession(`INTERNAL:${id}:actor`);
  vi.stubGlobal('AbortController', function () { return transferableAbortController(); });
  vi.mocked(getSession).mockResolvedValue({ accountType: 'INTERNAL', landingPath: '/app/workbench', userId: 'actor', organizationId: id });
  vi.mocked(getAdminOrganizations).mockResolvedValue([]);
  vi.mocked(apiRequest).mockResolvedValue(context());
});
afterEach(() => { vi.unstubAllGlobals(); window.history.replaceState({}, '', '/'); });

it.each([[false, false], [true, false], [false, true], [true, true]])('keeps workflow and platform management outside business menus regardless of grants: workflow=%s platform=%s', async (workflow, platform) => {
  vi.mocked(apiRequest).mockResolvedValue(context(workflow, platform));
  vi.mocked(getAdminOrganizations).mockResolvedValue(platform ? [{ ...organization, permissions: ['account:users:read'] }] : []);
  mountBusiness();
  const menu = within(screen.getByRole('navigation', { name: '系统服务 上下文菜单' }));
  expect(menu.queryByRole('link', { name: '流程设计' })).not.toBeInTheDocument();
  expect(menu.queryByRole('link', { name: '平台管理' })).not.toBeInTheDocument();
  expect(menu.getByRole('link', { name: '公告' })).toHaveAttribute('href', '/app/announcements');
  expect(menu.getByRole('link', { name: '个人账号' })).toHaveAttribute('href', '/app/account');
  fireEvent.click(screen.getByRole('button', { name: '打开导航' }));
  const mobile = within(screen.getByRole('dialog'));
  expect(mobile.queryByRole('link', { name: '流程设计' })).not.toBeInTheDocument();
  expect(mobile.queryByRole('link', { name: '平台管理' })).not.toBeInTheDocument();
  expect(getAdminOrganizations).not.toHaveBeenCalled();
  expect(apiRequest).not.toHaveBeenCalled();
});

it('keeps console context read failure explicit and retryable without reading workflow data or losing business tabs', async () => {
  const tabs = preserveBusiness();
  vi.mocked(apiRequest).mockRejectedValueOnce(new Error('offline')).mockResolvedValue(context());
  mountConsole();
  expect(await screen.findByText('无法验证管理权限，请重试')).toBeVisible();
  expect(vi.mocked(apiRequest).mock.calls.every(([url]) => url.startsWith('/api/v1/admin/console/context'))).toBe(true);
  expect(useWorkTabsStore.getState().tabs).toEqual(tabs);
  fireEvent.click(screen.getByRole('button', { name: '重试' }));
  expect(await screen.findByRole('button', { name: '制程不合格台账' })).toBeVisible();
  expect(useWorkTabsStore.getState().tabs).toEqual(tabs);
});

it.each(['workflow', 'platform'])('does not infer missing %s access from the other module at the real console gate', async missing => {
  vi.mocked(apiRequest).mockResolvedValue(context(missing !== 'workflow', missing !== 'platform'));
  mountConsole(missing === 'workflow' ? path : '/console/users');
  expect(await screen.findByText('无权访问此管理模块')).toBeVisible();
  expect(vi.mocked(apiRequest).mock.calls.every(([url]) => url.startsWith('/api/v1/admin/console/context'))).toBe(true);
  expect(getAdminOrganizations).not.toHaveBeenCalled();
});

it('clears old console grants on identity change and ignores a late old response', async () => {
  let resolveOld!: (value: ConsoleContext) => void;
  vi.mocked(apiRequest).mockReturnValueOnce(new Promise(resolve => { resolveOld = resolve; })).mockResolvedValue(context(false, false, 'new-actor'));
  render(<MemoryRouter initialEntries={[path]}><ConsoleLayout><div>Sensitive workflow</div></ConsoleLayout></MemoryRouter>);
  act(() => useWorkTabsStore.getState().bindSession(`INTERNAL:${id}:new-actor`));
  expect(await screen.findByText('无权访问此管理模块')).toBeVisible();
  await act(async () => resolveOld(context()));
  expect(screen.queryByText('Sensitive workflow')).not.toBeInTheDocument();
  expect(screen.queryByLabelText('当前身份')).not.toBeInTheDocument();
});

it('updates the business menu, header and work tab when language changes', async () => {
  mountBusiness();
  fireEvent.click(screen.getByRole('radio', { name: 'EN' }));
  expect(screen.getByRole('navigation', { name: 'System services Context menu' })).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'All tabs' }));
  expect(await screen.findByRole('button', { name: 'Announcements' })).toBeVisible();
});

it.each([
  `/app/workflow-designer/${definitionId}/${versionId}`, `/console/workflows/${definitionId}/${versionId}`,
])('renders not found for %s without reading workflow data or changing work tabs', async retired => {
  const tabs = preserveBusiness();
  mountConsole(retired);
  expect(await screen.findByText('管理页面不存在')).toBeVisible();
  expect(window.location.pathname).toBe(retired);
  expect(useWorkTabsStore.getState().tabs).toEqual(tabs);
  expect(vi.mocked(apiRequest).mock.calls.every(([url]) => url.startsWith('/api/v1/admin/console/context'))).toBe(true);
});

it('opens the separate 8D maintenance route while preserving the panels’ configuration permission checks', async () => {
  vi.mocked(apiRequest).mockImplementation(async url => url.startsWith('/api/v1/admin/console/context')
    ? context() : { organizationId: id, permissions: ['workflow:manage'] });
  mountConsole('/console/eight-d-bindings');
  expect(await screen.findByText('当前会话无配置读取权限')).toBeVisible();
  expect(screen.getByText('当前会话无供应商配置读取权限')).toBeVisible();
  expect(screen.getByRole('link', { name: '8D 流程绑定' })).toHaveAttribute('aria-current', 'page');
  expect(screen.queryByRole('button', { name: '制程不合格台账' })).not.toBeInTheDocument();
  expect(vi.mocked(apiRequest).mock.calls.every(([url]) => url === '/api/v1/system/my-permissions' || url.startsWith('/api/v1/admin/console/context'))).toBe(true);
});
