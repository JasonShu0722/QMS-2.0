import { transferableAbortController } from 'node:util';
import { StrictMode, type ReactNode } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Outlet, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { App } from './App';
import { internalDomains, internalNavigation } from './features/navigation/navigation';
import { useWorkTabsStore } from './work-tabs/workTabsStore';
import { WorkTabs } from './work-tabs/WorkTabs';
import { UnsavedChangesProvider } from './layouts/UnsavedChanges';

const mounts = vi.hoisted(() => ({ internal: vi.fn(), console: vi.fn() }));
vi.mock('./features/auth/ReauthenticationProvider', () => ({ ReauthenticationProvider: ({ children }: { children: ReactNode }) => children }));
vi.mock('./features/auth/LoginPage', () => ({ LoginPage: () => <LocationProbe label="login destination" /> }));
vi.mock('./features/auth/SecurityPage', () => ({ SecurityPage: () => <LocationProbe label="mfa destination" /> }));
vi.mock('./features/auth/RequiredPasswordChangePage', () => ({ RequiredPasswordChangePage: () => <LocationProbe label="password destination" /> }));
vi.mock('./features/auth/PasswordRecoveryPage', () => ({ PasswordRecoveryPage: () => null }));
vi.mock('./features/auth/ResetPasswordPage', () => ({ ResetPasswordPage: () => null }));
vi.mock('./layouts/InternalLayout', () => ({ InternalLayout: () => { mounts.internal(); return <UnsavedChangesProvider><LocationProbe label="business layout" /><WorkTabs /></UnsavedChangesProvider>; } }));
vi.mock('./layouts/SupplierLayout', () => ({ SupplierLayout: () => <LocationProbe label="supplier layout" /> }));
vi.mock('./console/ConsoleLayout', () => ({ useConsoleContext: () => ({ context: {
  actor: { id: userId, accountType: 'INTERNAL', homeOrganization: organization(homeId) },
  targetOrganization: organization(new URLSearchParams(window.location.search).get('organizationId') ?? homeId),
  organizations: [organization(homeId), organization(targetId)], hasPlatformAdministrator: false,
  modules: [{ key: 'workflows', scope: 'SESSION_HOME', coverage: 'ORGANIZATION', organizationId: homeId, permissions: ['workflow:manage'] }],
}, refresh: vi.fn(), invalidate: vi.fn() }), ConsoleLayout: ({ children }: { children?: ReactNode }) => {
  mounts.console();
  return <section aria-label="independent console layout">{children ?? <Outlet />}</section>;
} }));
vi.mock('./console/ConsoleManagementPage', () => ({ ConsoleManagementPage: () => <LocationProbe label="management page" /> }));
vi.mock('./console/ConsoleHome', () => ({ ConsoleHome: () => <LocationProbe label="management home" /> }));
vi.mock('./features/workflows/WorkflowListPage', () => ({ WorkflowListPage: () => <LocationProbe label="workflow list" /> }));
vi.mock('./features/workflows/WorkflowDesignerPage', () => ({ WorkflowDesignerPage: ({ definitionId, versionId }: { definitionId: string; versionId: string }) => <output aria-label="workflow version">{definitionId}/{versionId}</output> }));

const homeId = '2c7b3607-1d6d-4304-9a72-f595c8467d88';
const targetId = '10380115-6c51-4df7-b18b-fda11be1a976';
const userId = 'd21fb322-aa79-40f4-8cea-f7a0acbc969a';
const definitionId = '4063f927-a63d-45fc-86c6-abf667bbca10';
const versionId = 'ea328dcb-6492-4fb9-bdbb-c1759faad677';
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
function LocationProbe({ label }: { label: string }) {
  const location = useLocation();
  return <output aria-label={label}>{JSON.stringify({ path: location.pathname + location.search, state: location.state })}</output>;
}
function open(path: string) {
  window.history.replaceState({}, '', path);
  return render(<StrictMode><App /></StrictMode>);
}
function session(accountType = 'INTERNAL') {
  return { user: { id: userId, organizationId: homeId, accountType }, landingPath: accountType === 'INTERNAL' ? '/app/workbench' : '/supplier/inbox', securityState: 'AUTHENTICATED' };
}
function organization(id: string) { return { id, code: id, name: id, type: 'INTERNAL', status: 'ACTIVE', configurationRequired: false }; }
function targetQuery(section: string) { return new URLSearchParams({ organizationId: targetId, section }); }
function assertBusinessUntouched() {
  expect(mounts.internal).not.toHaveBeenCalled();
  expect(useWorkTabsStore.getState().tabs).toEqual([{ id: 'business', title: 'Business draft', path: '/app/problem-center' }]);
  expect(useWorkTabsStore.getState().activeTabId).toBe('business');
}

beforeEach(() => {
  localStorage.clear(); sessionStorage.clear();
  useWorkTabsStore.getState().reset();
  useWorkTabsStore.getState().bindSession(`INTERNAL:${homeId}:${userId}`);
  useWorkTabsStore.getState().openTab({ id: 'business', title: 'Business draft', path: '/app/problem-center' });
  vi.clearAllMocks();
  // React Router's native Request requires the Node AbortSignal under jsdom.
  vi.stubGlobal('AbortController', function () { return transferableAbortController(); });
  vi.stubGlobal('fetch', vi.fn<typeof fetch>(() => Promise.resolve(json(session()))));
});
afterEach(() => { vi.unstubAllGlobals(); window.history.replaceState({}, '', '/'); });

const managementPaths = [
  '/console/users', '/console/organizations', '/console/master-data/suppliers', '/console/master-data/customers',
  '/console/master-data/materials', '/console/master-data/component-projects', '/console/configuration', '/console/audit-log',
  '/console/outbox', '/console/reconfiguration', '/console/problem-reconfiguration', '/console/supplier-accounts',
];
it('registers the real management home index outside the business layout', async () => {
  open('/console');
  expect(await screen.findByLabelText('management home')).toHaveTextContent('/console');
  expect(screen.getByRole('region', { name: 'independent console layout' })).toBeVisible();
  assertBusinessUntouched();
});
it.each(managementPaths)('registers %s outside the business layout without touching work tabs', async path => {
  open(path);
  expect(await screen.findByLabelText('management page')).toHaveTextContent(path);
  expect(screen.getByRole('region', { name: 'independent console layout' })).toBeVisible();
  expect(screen.queryByRole('group', { name: /Language.*外观设置/ })).not.toBeInTheDocument();
  assertBusinessUntouched();
});

it('registers workflow list without requiring the old management directory', async () => {
  open('/console/workflows');
  expect(await screen.findByLabelText('workflow list')).toBeVisible();
  expect(fetch).toHaveBeenCalledWith('/api/v1/auth/session', expect.anything());
  expect(vi.mocked(fetch).mock.calls.every(([url]) => !String(url).includes('/admin/organizations'))).toBe(true);
  assertBusinessUntouched();
});

it('registers a workflow version in the independent console layout', async () => {
  open(`/console/workflows/${definitionId}/${versionId}`);
  expect(await screen.findByLabelText('workflow version')).toHaveTextContent(`${definitionId}/${versionId}`);
  expect(screen.getByRole('region', { name: 'independent console layout' })).toBeVisible();
  assertBusinessUntouched();
});

const sections = [
  ['users', '/console/users'], ['roles', '/console/organizations'], ['organizations', '/console/organizations'],
  ['configuration', '/console/configuration'], ['audit-log', '/console/audit-log'], ['failures', '/console/outbox'],
  ['reconfiguration', '/console/reconfiguration'], ['problem-reconfiguration', '/console/problem-reconfiguration'],
  ['supplier-accounts', '/console/supplier-accounts'], ['component-project', '/console/master-data/component-projects'],
  ['supplier-master', '/console/master-data/suppliers'], ['customer-master', '/console/master-data/customers'], ['material-master', '/console/master-data/materials'],
] as const;
it.each(sections)('redirects legacy %s to %s before mounting InternalLayout', async (section, destination) => {
  open(`/app/admin?${targetQuery(section)}`);
  expect(await screen.findByLabelText('management page')).toBeVisible();
  expect(window.location.pathname).toBe(destination);
  expect(new URLSearchParams(window.location.search).get('organizationId')).toBe(targetId);
  expect(new URLSearchParams(window.location.search).has('section')).toBe(false);
  assertBusinessUntouched();
});

it('keeps the exact user target rather than changing the selected organization or user', async () => {
  const query = targetQuery('users'); query.set('userId', userId.toUpperCase());
  open(`/app/admin?${query}`);
  await screen.findByLabelText('management page');
  expect(new URLSearchParams(window.location.search).get('userId')).toBe(userId.toUpperCase());
  expect(new URLSearchParams(window.location.search).get('organizationId')).toBe(targetId);
  assertBusinessUntouched();
});

it('keeps a complete audit resource locator unchanged', async () => {
  const query = targetQuery('audit-log'); query.set('resourceType', 'Organization'); query.set('resourceId', 'resource:42');
  open(`/app/admin?${query}`);
  await screen.findByLabelText('management page');
  expect(window.location.pathname).toBe('/console/audit-log');
  expect(Object.fromEntries(new URLSearchParams(window.location.search))).toEqual({ organizationId: targetId, resourceType: 'Organization', resourceId: 'resource:42' });
  assertBusinessUntouched();
});

it('redirects bare legacy administration to the console collection without guessing an organization', async () => {
  open('/app/admin');
  await waitFor(() => expect(window.location.pathname).toBe('/console'));
  expect(window.location.search).toBe('');
  assertBusinessUntouched();
});

it.each([
  ['/app/workflow-designer', '/console/workflows', 'workflow list'],
  [`/app/workflow-designer/${definitionId}/${versionId}`, `/console/workflows/${definitionId}/${versionId}`, 'workflow version'],
])('redirects %s before creating a business work tab', async (legacy, destination, label) => {
  open(`${legacy}?organizationId=${targetId}`);
  await screen.findByLabelText(label);
  expect(window.location.pathname).toBe(destination);
  expect(window.location.search).toBe(`?organizationId=${targetId}`);
  assertBusinessUntouched();
});

it('routes an existing legacy work-tab click through compatibility without creating a console work tab', async () => {
  const legacy = { id: 'legacy-workflow', title: 'Legacy workflow', path: `/app/workflow-designer/${definitionId}/${versionId}` };
  useWorkTabsStore.getState().openTab(legacy);
  open('/app/problem-center');
  await screen.findByLabelText('business layout');
  mounts.internal.mockClear();
  fireEvent.click(screen.getByRole('link', { name: legacy.title }));
  await screen.findByLabelText('workflow version');
  expect(window.location.pathname).toBe(`/console/workflows/${definitionId}/${versionId}`);
  expect(mounts.internal).not.toHaveBeenCalled();
  expect(useWorkTabsStore.getState().tabs).toEqual([{ id: 'business', title: 'Business draft', path: '/app/problem-center' }, legacy]);
  expect(useWorkTabsStore.getState().activeTabId).toBe(legacy.id);
});

const invalidAdminQueries = [
  `organizationId=${targetId}`, `section=users`, `organizationId=not-a-uuid&section=users`,
  `organizationId=${targetId}&section=unknown`, `organizationId=${targetId}&section=users&section=users`,
  `organizationId=${targetId}&organizationId=${homeId}&section=users`, `organizationId=${targetId}&section=users&userId=bad`,
  `organizationId=${targetId}&section=users&userId=${userId}&userId=${userId}`, `organizationId=${targetId}&section=users&roleId=${userId}`,
  `organizationId=${targetId}&section=users&resourceType=User&resourceId=${userId}`, `organizationId=${targetId}&section=audit-log&userId=${userId}`,
  `organizationId=${targetId}&section=roles&roleId=${userId}`, `organizationId=${targetId}&section=audit-log&resourceType=User`,
  `organizationId=${targetId}&section=audit-log&resourceId=${userId}`, `organizationId=${targetId}&section=audit-log&resourceType=&resourceId=id`,
  `organizationId=${targetId}&section=audit-log&resourceType=User&resourceId=`, `organizationId=${targetId}&section=audit-log&resourceType=${'x'.repeat(101)}&resourceId=id`,
  `organizationId=${targetId}&section=audit-log&resourceType=User&resourceId=${'x'.repeat(129)}`, `organizationId=${targetId}&section=audit-log&resourceType=User%00&resourceId=id`,
  `organizationId=${targetId}&section=audit-log&resourceType=User&resourceId=id%7F`, `organizationId=${targetId}&section=audit-log&resourceType=User&resourceId=id&resourceId=id`,
  `organizationId=${targetId}&section=audit-log&resourceType=User&resourceId=%ZZ`, `organizationId=${targetId}&section=users&unknown=value`,
];
it.each(invalidAdminQueries)('explicitly rejects invalid legacy admin targeting: %s', async query => {
  open(`/app/admin?${query}`);
  expect(await screen.findByRole('alert')).toHaveTextContent(/链接无效|定位失败/);
  expect(window.location.pathname).toBe('/app/admin');
  expect(mounts.console).not.toHaveBeenCalled();
  assertBusinessUntouched();
});

it.each([
  '/app/admin/unknown', '/app/admin#users', '/app/workflow-designer/not-a-uuid/not-a-uuid',
  `/app/workflow-designer/${definitionId}`, `/app/workflow-designer/${definitionId}/${versionId}/extra`,
  '/app/workflow-designer?organizationId=bad', `/app/workflow-designer?organizationId=${targetId}&organizationId=${homeId}`,
  '/app/workflow-designer?section=users', `/app/workflow-designer?organizationId=${targetId}#extra`,
])('does not silently open a different console object for %s', async path => {
  open(path);
  expect(await screen.findByRole('alert')).toHaveTextContent(/链接无效|定位失败/);
  expect(mounts.console).not.toHaveBeenCalled();
  assertBusinessUntouched();
});

it.each([
  `/console/audit-log?organizationId=${targetId}&resourceType=Organization&resourceId=${targetId}`,
  `/console/workflows/${definitionId}/${versionId}?organizationId=${targetId}`,
  `/app/admin?organizationId=${targetId}&section=users&userId=${userId}`,
  `/app/workflow-designer/${definitionId}/${versionId}?organizationId=${targetId}`,
])('preserves legal %s through the real unauthenticated guard', async path => {
  useWorkTabsStore.getState().reset();
  vi.stubGlobal('fetch', vi.fn<typeof fetch>(() => Promise.resolve(json({ code: 'AUTH_SESSION_REQUIRED' }, 401))));
  open(path);
  const destination = await screen.findByLabelText('login destination');
  expect(JSON.parse(destination.textContent!)).toEqual({ path: '/login', state: { returnTo: path } });
  expect(mounts.internal).not.toHaveBeenCalled();
  expect(mounts.console).not.toHaveBeenCalled();
});

it('preserves the console target through the real forced-password guard', async () => {
  useWorkTabsStore.getState().reset();
  const path = `/console/users?organizationId=${targetId}&userId=${userId}`;
  vi.stubGlobal('fetch', vi.fn<typeof fetch>(url => Promise.resolve(String(url) === '/api/v1/auth/session'
    ? json({ code: 'AUTH_SESSION_REQUIRED' }, 401) : json({ securityState: 'PASSWORD_CHANGE_REQUIRED' }))));
  open(path);
  expect(JSON.parse((await screen.findByLabelText('password destination')).textContent!)).toEqual({ path: '/change-password', state: { returnTo: path } });
  expect(mounts.console).not.toHaveBeenCalled();
});

it.each([
  `/app/admin?organizationId=${targetId}&section=users&userId=${userId}&unknown=value`,
  `/app/workflow-designer/${definitionId}/${versionId}?organizationId=${targetId}&unknown=value`,
  `/app/admin?organizationId=${targetId}&section=users&section=users`,
  `/app/admin?organizationId=${targetId}&section=audit-log&resourceType=User`,
])('drops the whole invalid legacy return target rather than sanitizing it into a different valid locator: %s', async path => {
  useWorkTabsStore.getState().reset();
  vi.stubGlobal('fetch', vi.fn<typeof fetch>(() => Promise.resolve(json({ code: 'AUTH_SESSION_REQUIRED' }, 401))));
  open(path);
  const destination = await screen.findByLabelText('login destination');
  expect(JSON.parse(destination.textContent!)).toEqual({ path: '/login', state: null });
  expect(mounts.internal).not.toHaveBeenCalled();
  expect(mounts.console).not.toHaveBeenCalled();
});

it.each([
  [`/app/admin?organizationId=${targetId}&section=users&userId=${userId}#extra`, false],
  [`/app/workflow-designer/${definitionId}/${versionId}?organizationId=${targetId}#extra`, false],
  [`/app/admin?organizationId=${targetId}&section=users&userId=${userId}#extra`, true],
  [`/app/workflow-designer/${definitionId}/${versionId}?organizationId=${targetId}#extra`, true],
] as const)('drops a fragment-bearing legacy target before authentication: %s forcedPassword=%s', async (path, forcedPassword) => {
  useWorkTabsStore.getState().reset();
  vi.stubGlobal('fetch', vi.fn<typeof fetch>(url => Promise.resolve(String(url) === '/api/v1/auth/session' || !forcedPassword
    ? json({ code: 'AUTH_SESSION_REQUIRED' }, 401) : json({ securityState: 'PASSWORD_CHANGE_REQUIRED' }))));
  open(path);
  const destination = await screen.findByLabelText(forcedPassword ? 'password destination' : 'login destination');
  expect(JSON.parse(destination.textContent!)).toEqual({ path: forcedPassword ? '/change-password' : '/login', state: null });
  expect(mounts.internal).not.toHaveBeenCalled();
  expect(mounts.console).not.toHaveBeenCalled();
  expect(screen.queryByLabelText('management page')).not.toBeInTheDocument();
  expect(screen.queryByLabelText('workflow version')).not.toBeInTheDocument();
});

it.each(['/console/users', '/app/admin', '/app/workflow-designer'])('rejects a supplier at %s before mounting either internal layout', async path => {
  useWorkTabsStore.getState().reset();
  vi.stubGlobal('fetch', vi.fn<typeof fetch>(() => Promise.resolve(json(session('SUPPLIER')))));
  open(path);
  expect(await screen.findByLabelText('supplier layout')).toHaveTextContent('/supplier/inbox');
  expect(mounts.internal).not.toHaveBeenCalled();
  expect(mounts.console).not.toHaveBeenCalled();
});

it('hides management and configuration design entries while retaining personal and task navigation', () => {
  const paths = internalNavigation.map(entry => entry.path);
  expect(paths).not.toContain('/app/admin');
  expect(paths).not.toContain('/app/workflow-designer');
  expect(paths).toContain('/app/account');
  expect(paths).toContain('/app/my-tasks');
  const domainPaths = internalDomains.flatMap(domain => domain.children.map(entry => entry.path));
  expect(domainPaths).not.toContain('/app/admin');
  expect(domainPaths).not.toContain('/app/workflow-designer');
});
