import { StrictMode, useState, type ComponentProps } from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ConfigProvider } from 'antd';
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { components } from '@qms/contracts';
import { ApiError, apiRequest } from '../api/client';
import { getAdminOrganizations } from '../features/admin/admin';
import { ConfigurationAdministration } from '../features/governance/ConfigurationAdministration';
import { OrganizationWorkspace } from '../features/governance/OrganizationWorkspace';
import { UnsavedChangesProvider, useUnsavedChanges } from '../layouts/UnsavedChanges';
import { useWorkTabsStore } from '../work-tabs/workTabsStore';
import { ConsoleManagementPage } from './ConsoleManagementPage';
import type { ConsoleContext } from './console-navigation';

const mocks = vi.hoisted(() => ({ context: {} as ConsoleContext, refresh: vi.fn(), invalidate: vi.fn(), props: {} as Record<string, Record<string, unknown>> }));
vi.mock('./ConsoleLayout', () => ({ useConsoleContext: () => mocks }));
vi.mock('../features/admin/admin', async importOriginal => ({ ...await importOriginal<typeof import('../features/admin/admin')>(), getAdminOrganizations: vi.fn() }));
vi.mock('../api/client', async importOriginal => ({ ...await importOriginal<typeof import('../api/client')>(), apiRequest: vi.fn() }));
function page(name: string) {
  return function Component(props: Record<string, unknown>) {
    mocks.props[name] = props;
    const [dirty, setDirty] = useState(false);
    useUnsavedChanges(dirty);
    return <div data-testid={name}><button onClick={() => setDirty(true)}>edit {name}</button></div>;
  };
}
vi.mock('../features/admin/UserAdministration', () => ({ UserAdministration: page('users') }));
vi.mock('../features/governance/OrganizationWorkspace', () => ({ OrganizationWorkspace: vi.fn(page('organizations')) }));
vi.mock('../features/supplier-quality/SupplierProfilesPage', () => ({ SupplierProfilesPage: page('suppliers') }));
vi.mock('../features/customer-quality/CustomerMasterSection', () => ({ CustomerMasterSection: page('customers') }));
vi.mock('../features/material-master/MaterialMasterPage', () => ({ MaterialMasterPage: page('materials') }));
vi.mock('../features/governance/ComponentProjectAdministration', () => ({ ComponentProjectAdministration: page('component-projects') }));
vi.mock('../features/governance/ConfigurationAdministration', () => ({ ConfigurationAdministration: vi.fn(page('configuration')) }));
vi.mock('../features/governance/AuditAdministration', () => ({ AuditAdministration: page('audit-log') }));
vi.mock('../features/governance/OutboxAdministration', () => ({ OutboxAdministration: page('outbox') }));
vi.mock('../features/governance/AdministrativeReconfiguration', () => ({ AdministrativeReconfiguration: page('reconfiguration') }));
vi.mock('../features/governance/AdministrativeProblemReconfiguration', () => ({ AdministrativeProblemReconfiguration: page('problem-reconfiguration') }));
vi.mock('../features/admin/AdminSupplierAccounts', () => ({ AdminSupplierAccounts: page('supplier-accounts') }));
vi.mock('../features/admin/UserForceDelete', () => ({ UserForceDelete: page('user-delete') }));
vi.mock('../features/governance/AdministrativeForceDeleteDialog', () => ({ AdministrativeForceDeleteDialog: page('force-delete') }));
const workspaceActual = await vi.importActual<typeof import('../features/governance/OrganizationWorkspace')>('../features/governance/OrganizationWorkspace');

const homeId = '11111111-1111-4111-8111-111111111111';
const targetId = '22222222-2222-4222-8222-222222222222';
const userId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
type Organization = components['schemas']['AdminOrganizationDto'];
type Management = components['schemas']['AdminOrganizationContextDto'];
const home = { id: homeId, code: 'HOME', name: 'Home', type: 'INTERNAL', status: 'ACTIVE', configurationRequired: false } as const;
const target = { ...home, id: targetId, code: 'TARGET', name: 'Target' };
const permissions = ['account:users:read', 'account:users:create', 'account:users:delete', 'organization:read', 'organization:structure:read', 'organization:force-delete', 'organization:departments:force-delete', 'organization:reconfigure', 'supplier-quality:profiles:read', 'supplier-quality:profiles:write', 'customer-quality:complaints:read', 'customer-quality:complaints:write', 'material-master:read', 'material-master:write', 'component-project:read', 'component-project:manage', 'configuration:read', 'audit:read', 'outbox:read'];
const directory: Organization[] = [{ ...home, permissions: [...permissions] }, { ...target, permissions: [...permissions] }];
const fixed = ['reconfiguration', 'problem-reconfiguration', 'supplier-accounts'];
function context(): ConsoleContext {
  return { actor: { id: 'actor', accountType: 'INTERNAL', homeOrganization: home }, targetOrganization: target, organizations: [home, target], hasPlatformAdministrator: true,
    modules: (['users', 'organizations', 'master-data', 'configuration', 'audit', 'outbox', ...fixed] as ConsoleContext['modules'][number]['key'][]).map(key => ({ key, scope: fixed.includes(key) ? 'SESSION_HOME' : 'TARGET', coverage: fixed.includes(key) ? 'PLATFORM' : 'ORGANIZATION', organizationId: fixed.includes(key) ? homeId : targetId, permissions })) };
}
function management(id: string): Management { return { hasPlatformAdministrator: true, homeOrganizationId: homeId, targetOrganizationId: id, accessKind: 'PLATFORM', targetOrganizationStatus: 'ACTIVE', targetConfigurationRequired: false, permissions: [...permissions], authorizationSources: [] }; }
let navigate: ReturnType<typeof useNavigate>;
function Controls() { navigate = useNavigate(); const location = useLocation(); return <output aria-label="url">{location.pathname}{location.search}</output>; }
function view(path = '/console/users', strict = false) {
  const tree = () => {
    const content = <ConfigProvider theme={{ token: { motion: false } }}><MemoryRouter initialEntries={[path]}><UnsavedChangesProvider><Controls /><ConsoleManagementPage /></UnsavedChangesProvider></MemoryRouter></ConfigProvider>;
    return strict ? <StrictMode>{content}</StrictMode> : content;
  };
  const result = render(tree());
  return { ...result, revalidate: () => result.rerender(tree()) };
}
beforeEach(() => {
  vi.clearAllMocks(); mocks.props = {}; mocks.context = context();
  useWorkTabsStore.getState().bindSession(`INTERNAL:${homeId}:actor`);
  vi.mocked(getAdminOrganizations).mockResolvedValue(directory);
  vi.mocked(apiRequest).mockImplementation(async path => management(new URL(path, 'https://qms.test').searchParams.get('organizationId')!));
  vi.mocked(ConfigurationAdministration).mockImplementation(page('configuration'));
  vi.mocked(OrganizationWorkspace).mockImplementation(page('organizations'));
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

it('dispatches the real user component only after directory and matching management verification', async () => {
  let resolve!: (entries: Organization[]) => void;
  vi.mocked(getAdminOrganizations).mockReturnValueOnce(new Promise(done => { resolve = done; }));
  view(`/console/users?organizationId=${targetId}&section=users&userId=${userId}`);
  expect(screen.queryByTestId('users')).not.toBeInTheDocument();
  await act(async () => resolve(directory));
  await screen.findByTestId('users');
  expect(mocks.props.users).toMatchObject({ organization: { id: targetId, permissions }, organizations: directory, targetUserId: userId, onDenied: expect.any(Function) });
  expect(useWorkTabsStore.getState().tabs).toEqual([]);
});

it.each([
  ['organizations', 'organizations'], ['master-data/suppliers', 'suppliers'], ['master-data/customers', 'customers'], ['master-data/materials', 'materials'], ['master-data/component-projects', 'component-projects'], ['configuration', 'configuration'], ['audit-log', 'audit-log'], ['outbox', 'outbox'], ['reconfiguration', 'reconfiguration'], ['problem-reconfiguration', 'problem-reconfiguration'], ['supplier-accounts', 'supplier-accounts'],
])('routes %s to its standalone existing domain component', async (path, name) => {
  view(`/console/${path}?organizationId=${targetId}`);
  await screen.findByTestId(name);
  const id = fixed.includes(name) ? homeId : targetId;
  const props = mocks.props[name]!;
  expect<unknown>(props.organization ?? { id: props.organizationId, permissions: props.organizationPermissions }).toMatchObject({ id, permissions });
  expect(apiRequest).toHaveBeenCalledWith(expect.stringContaining(`organizationId=${id}`), expect.objectContaining({ signal: expect.any(AbortSignal) }));
  expect(Object.keys(mocks.props)).toEqual([name]);
});

it('keeps audit resource targeting exact', async () => {
  view(`/console/audit-log?organizationId=${targetId}&section=audit-log&resourceType=USER&resourceId=${userId}`);
  await screen.findByTestId('audit-log');
  expect(mocks.props['audit-log']).toMatchObject({ target: { resourceType: 'USER', resourceId: userId } });
});

it.each([
  `users?organizationId=${targetId}&userId=invalid`, `users?organizationId=${targetId}&userId=${userId}&userId=${userId}`, `users?organizationId=${targetId}&section=audit-log`,
  `users?organizationId=${targetId}&unexpected=true`, `users?organizationId=${targetId}&organizationId=${targetId}`, `users?organizationId=${homeId}`,
  `audit-log?organizationId=${targetId}&resourceType=USER`, `audit-log?organizationId=${targetId}&resourceType=%20&resourceId=x`, `audit-log?organizationId=${targetId}&userId=${userId}`,
  `configuration?organizationId=${targetId}&section=users`, `outbox?organizationId=bad`,
  `users?userId=${userId}`, 'audit-log?resourceType=USER&resourceId=x', `audit-log?organizationId=${targetId}&resourceType=USER&resourceId=%00`,
  `audit-log?organizationId=${targetId}&resourceType=USER&resourceId=${'x'.repeat(129)}`,
])('rejects invalid or mismatched location without falling back: %s', async path => {
  view(`/console/${path}`);
  expect(await screen.findByRole('alert')).toHaveTextContent('管理定位无效');
  expect(getAdminOrganizations).not.toHaveBeenCalled();
  expect(Object.keys(mocks.props)).toEqual([]);
});

it('does not read the admin directory for workflows, unknown routes or missing module capability', async () => {
  mocks.context.modules = [];
  view('/console/users');
  expect(await screen.findByRole('alert')).toHaveTextContent('无权访问');
  expect(getAdminOrganizations).not.toHaveBeenCalled();
});

it.each(['/console/workflows', '/console/unknown'])('leaves %s outside this management dispatcher', async path => {
  mocks.context.modules.push({ key: 'workflows', scope: 'SESSION_HOME', coverage: 'ORGANIZATION', organizationId: homeId, permissions: ['workflow:manage'] });
  view(path);
  expect(await screen.findByRole('alert')).toBeInTheDocument();
  expect(getAdminOrganizations).not.toHaveBeenCalled();
});

it('rejects a session-home module carrying the current target as its false authorization source', async () => {
  mocks.context.modules = mocks.context.modules.map(module => module.key === 'reconfiguration' ? { ...module, organizationId: targetId } : module);
  view('/console/reconfiguration');
  expect(await screen.findByRole('alert')).toHaveTextContent('无权访问');
  expect(getAdminOrganizations).not.toHaveBeenCalled();
});

it('never attaches target permissions to session-home pages', async () => {
  vi.mocked(getAdminOrganizations).mockResolvedValue([{ ...directory[0]!, permissions: ['organization:reconfigure'] }, directory[1]!]);
  view('/console/reconfiguration');
  await screen.findByTestId('reconfiguration');
  expect(mocks.props.reconfiguration).toMatchObject({ organization: { id: homeId, permissions: ['organization:reconfigure'] } });
});

it('fails closed when real management permissions were revoked', async () => {
  vi.mocked(apiRequest).mockResolvedValue(management(targetId));
  vi.mocked(getAdminOrganizations).mockResolvedValue([{ ...directory[1]!, permissions: [] }]);
  view();
  expect(await screen.findByRole('alert')).toHaveTextContent('无权访问');
  expect(screen.queryByTestId('users')).not.toBeInTheDocument();
});

it('retries directory network errors without falling back to the home organization', async () => {
  vi.mocked(getAdminOrganizations).mockRejectedValueOnce(new Error('offline'));
  view();
  fireEvent.click(await screen.findByRole('button', { name: '重试' }));
  await screen.findByTestId('users');
});

it.each(['target', 'home'])('rejects a management response whose %s scope does not match', async kind => {
  vi.mocked(apiRequest).mockResolvedValue({ ...management(targetId), ...(kind === 'target' ? { targetOrganizationId: homeId } : { homeOrganizationId: targetId }) });
  view();
  expect(await screen.findByRole('alert')).toHaveTextContent('无权访问');
  expect(screen.queryByTestId('users')).not.toBeInTheDocument();
});

it('retains real business maintenance permissions excluded from the management-context DTO', async () => {
  vi.mocked(apiRequest).mockResolvedValue({ ...management(targetId), permissions: ['organization:read'] });
  view('/console/master-data/materials');
  await screen.findByTestId('materials');
  expect(mocks.props.materials!.organizationPermissions).toContain('material-master:write');
});

it('restricts inactive targets to current management permissions', async () => {
  vi.mocked(apiRequest).mockResolvedValue({ ...management(targetId), targetOrganizationStatus: 'DISABLED', permissions: ['audit:read'] });
  view('/console/audit-log');
  await screen.findByTestId('audit-log');
  expect(mocks.props['audit-log']).toMatchObject({ organization: { permissions: ['audit:read'] } });
});

it('removes lifecycle actions without a freshly verified platform identity', async () => {
  vi.mocked(apiRequest).mockResolvedValue({ ...management(homeId), hasPlatformAdministrator: false });
  view('/console/reconfiguration');
  expect(await screen.findByRole('alert')).toHaveTextContent('无权访问');
  expect(screen.queryByTestId('reconfiguration')).not.toBeInTheDocument();
});

it('refreshes both real management context and organization directory after directory changes', async () => {
  view('/console/organizations'); await screen.findByTestId('organizations');
  act(() => (mocks.props.organizations!.onChanged as () => void)());
  await waitFor(() => expect(getAdminOrganizations).toHaveBeenCalledTimes(2));
  expect(mocks.refresh).toHaveBeenCalledOnce();
});

it.each([401, 403])('clears private children and invalidates console on child %s', async status => {
  view(); await screen.findByTestId('users');
  act(() => (mocks.props.users!.onDenied as (error: ApiError) => void)(new ApiError({ code: 'DENIED', message: 'denied' }, status)));
  expect(screen.queryByTestId('users')).not.toBeInTheDocument();
  expect(mocks.invalidate).toHaveBeenCalledOnce();
});

it('navigates from a dirty real Workspace appointment through exactly one guard owned by the Workspace', async () => {
  vi.mocked(OrganizationWorkspace).mockImplementation(workspaceActual.OrganizationWorkspace);
  const grants = ['organization:structure:read', 'organization:positions:assign'];
  vi.mocked(getAdminOrganizations).mockResolvedValue(directory.map(entry => ({ ...entry, permissions: grants })));
  const department: components['schemas']['DepartmentDto'] = { id: 'department-a', organizationId: targetId, parentId: null, code: 'QA', name: 'Quality', status: 'ACTIVE', version: 1 };
  const position: components['schemas']['PositionDto'] = { id: 'position-a', organizationId: targetId, departmentId: null, categoryId: null, code: 'QE', name: 'Engineer', status: 'ACTIVE', version: 1 };
  const assignment: components['schemas']['UserPositionDto'] = { id: 'assignment-a', userId, organizationId: targetId, positionId: position.id, position, startedAt: '2026-10-01T00:00:00Z', endedAt: null };
  vi.mocked(apiRequest).mockImplementation(async path => {
    if (path.includes('/organizations/context?')) return { ...management(targetId), permissions: grants };
    if (path.includes('/users/') && path.includes('/positions?')) return [assignment];
    if (path.includes('/departments?')) return [department];
    if (path.includes('/positions?')) return [position];
    throw new Error(`Unexpected workspace request ${path}`);
  });
  view('/console/organizations');
  fireEvent.click(await screen.findByRole('tab', { name: '用户任职' }));
  fireEvent.change(screen.getByLabelText('用户 ID'), { target: { value: userId } });
  const load = screen.getByText('查看任职').closest('button')!;
  await waitFor(() => expect(load).toBeEnabled());
  fireEvent.click(load);
  const selector = await screen.findByLabelText('任职岗位');
  selector.focus();
  fireEvent.keyDown(selector, { key: 'Backspace', code: 'Backspace', keyCode: 8, which: 8 });
  fireEvent.keyDown(selector, { key: 'Escape', code: 'Escape', keyCode: 27, which: 27 });
  const dirty = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(dirty);
  expect(dirty.defaultPrevented).toBe(true);
  const oldSelect = vi.mocked(OrganizationWorkspace).mock.calls.at(-1)![0].onSelectOrganization;
  fireEvent.click(screen.getByLabelText('Home · 组织'));
  fireEvent.click(await screen.findByText('继续编辑'));
  expect(screen.getByLabelText('url')).not.toHaveTextContent('organizationId');
  expect(selector).toBeInTheDocument();
  fireEvent.click(screen.getByLabelText('Home · 组织'));
  fireEvent.click(await screen.findByText('放弃修改'));
  await waitFor(() => expect(screen.getByLabelText('url')).toHaveTextContent(`organizationId=${homeId}`));
  expect(screen.queryByRole('dialog', { name: '当前草稿尚未保存，继续将放弃修改。' })).not.toBeInTheDocument();
  act(() => oldSelect(targetId));
  expect(screen.getByLabelText('url')).toHaveTextContent(`organizationId=${homeId}`);
  expect(useWorkTabsStore.getState().tabs).toEqual([]);
  expect(vi.mocked(apiRequest).mock.calls.every(([, init]) => !init?.method || init.method === 'GET')).toBe(true);
});

it('retains USER, ORGANIZATION and DEPARTMENT force-delete action props with real lifecycle permissions', async () => {
  view('/console/reconfiguration'); await screen.findByTestId('reconfiguration');
  type Props = ComponentProps<typeof import('../features/governance/AdministrativeReconfiguration').AdministrativeReconfiguration>;
  const actions = mocks.props.reconfiguration!.renderAdditionalActions as NonNullable<Props['renderAdditionalActions']>;
  const completed = vi.fn();
  type Item = components['schemas']['AdministrativeReconfigurationItemDto'];
  const item = { id: userId, originalOrganizationId: targetId, label: 'Record', version: 3 };
  const result = render(<>{actions({ ...item, kind: 'USER' } as Item, completed)}</>);
  expect(mocks.props['user-delete']).toMatchObject({ target: { id: userId, organizationId: targetId, username: 'Record', securityVersion: 3 }, canDelete: true });
  act(() => (mocks.props['user-delete']!.onDeleted as () => void)());
  expect(completed).toHaveBeenCalledOnce();
  result.rerender(<>{actions({ ...item, kind: 'ORGANIZATION' } as Item, completed)}</>);
  expect(mocks.props['force-delete']).toMatchObject({ kind: 'ORGANIZATION', path: `/api/v1/organizations/${userId}/force-delete`, allowed: true });
  result.rerender(<>{actions({ ...item, kind: 'DEPARTMENT' } as Item, completed)}</>);
  expect(mocks.props['force-delete']).toMatchObject({ kind: 'DEPARTMENT', path: `/api/v1/organizations/${targetId}/departments/${userId}/force-delete`, allowed: true });
});

it('does not revive a late directory response after batched A to B to A session changes', async () => {
  let resolve!: (entries: Organization[]) => void;
  vi.mocked(getAdminOrganizations).mockReturnValueOnce(new Promise(done => { resolve = done; }));
  view();
  act(() => { useWorkTabsStore.getState().bindSession(`INTERNAL:${homeId}:other`); useWorkTabsStore.getState().bindSession(`INTERNAL:${homeId}:actor`); });
  await act(async () => resolve(directory));
  expect(screen.queryByTestId('users')).not.toBeInTheDocument();
});

it('discards an old directory read across A to B to A route navigation', async () => {
  let resolve!: (entries: Organization[]) => void;
  vi.mocked(getAdminOrganizations).mockReturnValueOnce(new Promise(done => { resolve = done; }));
  view();
  act(() => navigate('/console/configuration'));
  await screen.findByTestId('configuration');
  act(() => navigate('/console/users'));
  await screen.findByTestId('users');
  await act(async () => resolve([{ ...directory[1]!, permissions: [] }]));
  expect(screen.getByTestId('users')).toBeInTheDocument();
  expect(mocks.props.users!.organization).toMatchObject({ id: targetId, permissions });
});

it('ignores stale callbacks after routing to a different management page', async () => {
  view(); await screen.findByTestId('users');
  const denied = mocks.props.users!.onDenied as (error: ApiError) => void;
  act(() => navigate('/console/configuration'));
  await screen.findByTestId('configuration');
  act(() => denied(new ApiError({ code: 'DENIED', message: 'denied' }, 403)));
  expect(screen.getByTestId('configuration')).toBeInTheDocument();
  expect(mocks.invalidate).not.toHaveBeenCalled();
});

it.each(['settings', 'portal'] as const)('preserves the real configuration %s draft and focused DOM across equivalent metadata revalidation', async kind => {
  if (kind === 'portal') vi.stubEnv('NODE_ENV', 'development');
  const actual = await vi.importActual<typeof import('../features/governance/ConfigurationAdministration')>('../features/governance/ConfigurationAdministration');
  vi.mocked(ConfigurationAdministration).mockImplementation(actual.ConfigurationAdministration);
  const grants = [...permissions, 'configuration:manage'];
  vi.mocked(getAdminOrganizations).mockResolvedValue(directory.map(entry => ({ ...entry, permissions: grants })));
  vi.mocked(apiRequest).mockImplementation(async path => {
    if (path.includes('/organizations/context?')) return { ...management(targetId), permissions: grants };
    if (path.includes('/settings?')) return { notificationLocale: 'zh-CN', exportRetentionMinutes: 60, version: 3 };
    if (path.includes('/notification-rules?')) return [{ kind: 'TASK_ASSIGNED', enabled: true, subjectTemplate: 'Saved subject', bodyTemplate: 'Saved body', version: 2 }];
    if (path.includes('/position-categories?')) return [];
    throw new Error(`Unexpected configuration request ${path}`);
  });
  const result = view('/console/configuration');
  const retention = await screen.findByLabelText('导出保留时间（分钟）');
  await waitFor(() => expect(retention).toHaveValue('60'));
  let input: HTMLElement = retention;
  if (kind === 'portal') {
    fireEvent.click(screen.getByRole('button', { name: /^编\s*辑$/ }));
    const dialog = await screen.findByRole('dialog', { name: '通知规则' });
    input = within(dialog).getByLabelText('通知标题');
    await waitFor(() => expect(input).toBeVisible());
  }
  fireEvent.change(input, { target: { value: kind === 'portal' ? 'Unsaved subject' : '120' } });
  input.focus();
  const dirty = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(dirty);
  expect(dirty.defaultPrevented).toBe(true);
  mocks.context = { ...mocks.context, targetOrganization: { ...mocks.context.targetOrganization, name: 'Renamed target', code: 'NEW' }, organizations: mocks.context.organizations.map(entry => ({ ...entry, name: `${entry.name} refreshed` })) };
  result.revalidate();
  await waitFor(() => expect(kind === 'portal' ? screen.getByLabelText('通知标题') : screen.getByLabelText('导出保留时间（分钟）')).toBe(input));
  expect(input).toHaveValue(kind === 'portal' ? 'Unsaved subject' : '120');
  expect(input).toHaveFocus();
  expect(getAdminOrganizations).toHaveBeenCalledTimes(1);
  expect(vi.mocked(apiRequest).mock.calls.every(([, init]) => !init?.method || init.method === 'GET')).toBe(true);
});

it('updates verified directory names and codes without synthesizing permissions or remounting equal capabilities', async () => {
  const result = view(); await screen.findByTestId('users');
  fireEvent.click(screen.getByText('edit users'));
  mocks.context = { ...mocks.context, organizations: mocks.context.organizations.map(entry => ({ ...entry, name: `${entry.name} renamed`, code: `${entry.code}-NEW` })) };
  result.revalidate();
  await waitFor(() => expect(mocks.props.users!.organizations).toEqual(directory.map(entry => ({ ...entry, name: `${entry.name} renamed`, code: `${entry.code}-NEW` }))));
  expect(getAdminOrganizations).toHaveBeenCalledTimes(1);
  const dirty = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(dirty);
  expect(dirty.defaultPrevented).toBe(true);
});

it.each(['status', 'configurationRequired', 'type', 'platform'] as const)('reverifies and clears the old generation when authorization structure %s changes despite equal modules', async field => {
  const result = view(); await screen.findByTestId('users');
  vi.mocked(getAdminOrganizations).mockReturnValueOnce(new Promise(() => {}));
  if (field === 'platform') mocks.context = { ...mocks.context, hasPlatformAdministrator: false };
  else mocks.context = { ...mocks.context, targetOrganization: { ...mocks.context.targetOrganization, ...(field === 'status' ? { status: 'DISABLED' as const } : field === 'type' ? { type: 'SUPPLIER' as const } : { configurationRequired: true }) } };
  result.revalidate();
  expect(screen.queryByTestId('users')).not.toBeInTheDocument();
  await waitFor(() => expect(getAdminOrganizations).toHaveBeenCalledTimes(2));
});

it('survives StrictMode cleanup with the real apiRequest abort rejection before the second read succeeds', async () => {
  const actual = await vi.importActual<typeof import('../api/client')>('../api/client');
  vi.mocked(apiRequest).mockImplementation(actual.apiRequest);
  const signals: AbortSignal[] = [];
  let finish!: (response: Response) => void;
  vi.stubGlobal('fetch', vi.fn((_path: RequestInfo | URL, init?: RequestInit) => {
    const signal = init!.signal as AbortSignal; signals.push(signal);
    return new Promise<Response>((resolve, reject) => {
      signal.addEventListener('abort', () => reject(new DOMException('Aborted read', 'AbortError')), { once: true });
      if (signals.length === 2) finish = resolve;
    });
  }));
  view('/console/users', true);
  await waitFor(() => expect(signals).toHaveLength(2));
  expect(signals[0]!.aborted).toBe(true);
  expect(signals[1]!.aborted).toBe(false);
  await act(async () => finish(new Response(JSON.stringify(management(targetId)), { headers: { 'content-type': 'application/json' } })));
  expect(await screen.findByTestId('users')).toBeInTheDocument();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(mocks.invalidate).not.toHaveBeenCalled();
});

it.each(['success', 'network', 401, 403] as const)('ignores an obsolete StrictMode %s result after the current read succeeds', async outcome => {
  let resolve!: (value: Management) => void;
  let reject!: (reason: unknown) => void;
  const old = new Promise<Management>((done, fail) => { resolve = done; reject = fail; });
  vi.mocked(getAdminOrganizations).mockResolvedValueOnce([{ ...directory[1]!, permissions: [] }]);
  vi.mocked(apiRequest).mockReturnValueOnce(old).mockResolvedValueOnce(management(targetId));
  view('/console/users', true);
  await screen.findByTestId('users');
  await act(async () => {
    if (outcome === 'success') resolve(management(targetId));
    else reject(outcome === 'network' ? new Error('Old offline result') : new ApiError({ code: 'DENIED', message: 'Old denied result' }, outcome));
  });
  expect(screen.getByTestId('users')).toBeInTheDocument();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(mocks.invalidate).not.toHaveBeenCalled();
});

it.each([
  ['success', 'network'], [401, 'network'], [403, 'network'], ['success', 'denied'], [401, 'denied'], [403, 'denied'],
] as const)('keeps the current StrictMode %s/%s failure independent of the obsolete read', async (oldOutcome, freshOutcome) => {
  let resolve!: (value: Management) => void;
  let reject!: (reason: unknown) => void;
  const old = new Promise<Management>((done, fail) => { resolve = done; reject = fail; });
  vi.mocked(apiRequest).mockReturnValueOnce(old).mockRejectedValueOnce(freshOutcome === 'network' ? new Error('Current offline result') : new ApiError({ code: 'DENIED', message: 'Current denied result' }, 403));
  view('/console/users', true);
  const message = freshOutcome === 'network' ? '无法读取管理目录' : '无权访问此管理模块';
  expect(await screen.findByRole('alert')).toHaveTextContent(message);
  await act(async () => {
    if (oldOutcome === 'success') resolve(management(targetId));
    else reject(new ApiError({ code: 'DENIED', message: 'Old denied result' }, oldOutcome));
  });
  expect(screen.getByRole('alert')).toHaveTextContent(message);
  expect(screen.queryByTestId('users')).not.toBeInTheDocument();
  expect(mocks.invalidate).toHaveBeenCalledTimes(freshOutcome === 'denied' ? 1 : 0);
});
