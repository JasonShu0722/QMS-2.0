import { render as renderUI, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { StrictMode, type ReactNode } from 'react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { LanguageProvider } from '../../i18n/Language';
import { StructureAdministration } from './StructureAdministration';
import type { AdminOrganization, AdminRole } from '../admin/admin';
import type { components } from '@qms/contracts';
import { useWorkTabsStore } from '../../work-tabs/workTabsStore';

const position: components['schemas']['PositionDto'] = {
  id: 'position-a', organizationId: 'org-a', departmentId: 'department-a', categoryId: null,
  code: 'P-A', name: '质量工程师', status: 'ACTIVE', version: 2,
};
const roleA: AdminRole = { id: 'role-a', organizationId: 'org-a', code: 'QUALITY', name: '质量角色', mfaRequired: false, permissions: [] };
const roleB: AdminRole = { id: 'role-b', organizationId: 'org-a', code: 'AUDIT', name: '审核角色', mfaRequired: false, permissions: [] };
const globalRole: AdminRole = { id: 'role-global', organizationId: null, code: 'GLOBAL', name: '全局角色', mfaRequired: false, permissions: [] };
const otherRole: AdminRole = { id: 'role-other', organizationId: 'org-b', code: 'OTHER', name: '外组织角色', mfaRequired: false, permissions: [] };
const organization = (permissions: string[]): AdminOrganization => ({ id: 'org-a', code: 'A', name: '甲组织', type: 'INTERNAL', permissions });
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const roleDetails = (roles: AdminRole[] = [roleA]): components['schemas']['PositionRolesDto'] => ({
  positionId: position.id, roleVersion: 4, roles, effectiveAssigneeCount: 3, selfSessionRevoked: false,
});
const render = (ui: ReactNode) => renderUI(ui, { wrapper: MemoryRouter });

function stubStructureApi(details = roleDetails(), roles: AdminRole[] = [roleA, roleB, globalRole, otherRole]) {
  const requests: Array<[string, RequestInit | undefined]> = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input);
    requests.push([path, init]);
    if (path.endsWith('/departments?limit=100&offset=0')) return json([]);
    if (path.endsWith('/positions?limit=100&offset=0')) return json([position]);
    if (path.includes('/admin/roles?organizationId=org-a')) return json(roles);
    if (path.endsWith('/positions/position-a/roles')) {
      if (init?.method === 'PUT') return json(details);
      return json(details);
    }
    if (path.endsWith('/csrf')) return json({ csrfToken: 'csrf-token' });
    return json([]);
  });
  vi.stubGlobal('fetch', fetchMock);
  return { fetchMock, requests };
}

function view(permissions: string[], details = roleDetails()) {
  stubStructureApi(details);
  return render(<LanguageProvider><StructureAdministration organization={organization(permissions)} /></LanguageProvider>);
}

async function positionAction() {
  await userEvent.click(await screen.findByRole('tab', { name: '岗位' }));
  return screen.findByRole('button', { name: '岗位角色' });
}

afterEach(() => { vi.unstubAllGlobals(); localStorage.clear(); useWorkTabsStore.getState().reset(); });

it('only exposes the position-role entry when both read permissions are present', async () => {
  const complete = view(['organization:structure:read', 'account:roles:read']);
  expect(await positionAction()).toBeInTheDocument();
  complete.unmount();

  const missingRoles = view(['organization:structure:read']);
  await userEvent.click(await screen.findByRole('tab', { name: '岗位' }));
  expect(screen.queryByRole('button', { name: '岗位角色' })).not.toBeInTheDocument();
  missingRoles.unmount();
  view(['account:roles:read']);
  await userEvent.click(await screen.findByRole('tab', { name: '岗位' }));
  expect(screen.queryByRole('button', { name: '岗位角色' })).not.toBeInTheDocument();
});

it('loads scoped roles and shows the current version, effective assignees, and automatic activation note', async () => {
  const { requests } = stubStructureApi();
  render(<LanguageProvider><StructureAdministration organization={organization(['organization:structure:read', 'account:roles:read'])} /></LanguageProvider>);
  await userEvent.click(await positionAction());

  const dialog = await screen.findByRole('dialog');
  expect(within(dialog).getByText('质量角色')).toBeInTheDocument();
  expect(within(dialog).getByText('角色版本：4')).toBeInTheDocument();
  expect(within(dialog).getByText('当前有效任职人数：3')).toBeInTheDocument();
  expect(within(dialog).getByText('岗位角色保存后，当前有效任职会自动生效。')).toBeInTheDocument();
  expect(within(dialog).queryByText('全局角色')).not.toBeInTheDocument();
  expect(within(dialog).queryByText('外组织角色')).not.toBeInTheDocument();
  expect(requests.some(([path]) => path === '/api/v1/organizations/org-a/positions/position-a/roles')).toBe(true);
  expect(requests.some(([path]) => path === '/api/v1/admin/roles?organizationId=org-a')).toBe(true);
});

it('enables only the assignable organization roles and sends the CAS PUT with CSRF and idempotency', async () => {
  const { requests } = stubStructureApi(roleDetails([roleA]));
  render(<LanguageProvider><StructureAdministration organization={organization(['organization:structure:read', 'organization:structure:manage', 'account:roles:read', 'account:roles:assign'])} /></LanguageProvider>);
  await userEvent.click(await positionAction());
  const dialog = await screen.findByRole('dialog');
  const selector = within(dialog).getByRole('combobox', { name: '岗位角色' });
  expect(selector).toBeEnabled();
  await userEvent.click(selector);
  await userEvent.click(await screen.findByText('审核角色'));
  await userEvent.click(within(dialog).getByRole('button', { name: '保存' }));

  await waitFor(() => expect(requests.some(([, init]) => init?.method === 'PUT')).toBe(true));
  const [, init] = requests.find(([, value]) => value?.method === 'PUT')!;
  expect(init).toMatchObject({ method: 'PUT', headers: { 'x-csrf-token': 'csrf-token', 'Idempotency-Key': expect.any(String) }, body: JSON.stringify({ roleIds: ['role-a', 'role-b'], expectedRoleVersion: 4 }) });
});

it('keeps the selected draft and asks for reload after a CAS conflict', async () => {
  const { requests } = stubStructureApi(roleDetails([roleA]));
  const fetchMock = vi.mocked(globalThis.fetch);
  let reads = 0;
  let writes = 0;
  fetchMock.mockImplementationOnce(async (input, init) => {
    const path = String(input);
    requests.push([path, init]);
    if (path.endsWith('/departments?limit=100&offset=0')) return json([]);
    if (path.endsWith('/positions?limit=100&offset=0')) return json([position]);
    return json([]);
  });
  fetchMock.mockImplementation(async (input, init) => {
    const path = String(input);
    requests.push([path, init]);
    if (path.endsWith('/departments?limit=100&offset=0')) return json([]);
    if (path.endsWith('/positions?limit=100&offset=0')) return json([position]);
    if (path.endsWith('/csrf')) return json({ csrfToken: 'csrf-token' });
    if (path.includes('/admin/roles?organizationId=org-a')) return json([roleA, roleB]);
    if (path.endsWith('/positions/position-a/roles') && init?.method === 'PUT') return ++writes === 1 ? json({ code: 'CONCURRENCY_CONFLICT' }, 409) : json({ ...roleDetails([roleA, roleB]), roleVersion: 6 });
    if (path.endsWith('/positions/position-a/roles')) return json({ ...roleDetails([roleA]), roleVersion: ++reads === 1 ? 4 : 5 });
    return json([]);
  });
  render(<LanguageProvider><StructureAdministration organization={organization(['organization:structure:read', 'organization:structure:manage', 'account:roles:read', 'account:roles:assign'])} /></LanguageProvider>);
  await userEvent.click(await positionAction());
  const dialog = await screen.findByRole('dialog');
  await userEvent.click(within(dialog).getByRole('combobox', { name: '岗位角色' }));
  await userEvent.click(await screen.findByText('审核角色'));
  await userEvent.click(within(dialog).getByRole('button', { name: '保存' }));

  expect(await within(dialog).findByText('内容已被其他人修改。已保留当前填写内容，请重新加载后再保存。')).toBeInTheDocument();
  expect(within(dialog).getByRole('combobox', { name: '岗位角色' })).toHaveAttribute('aria-expanded', 'false');
  expect(within(dialog).getByRole('button', { name: '重新加载角色配置' })).toBeInTheDocument();
  expect(within(dialog).getByText('审核角色')).toBeInTheDocument();
  expect(within(dialog).getByRole('button', { name: '保存' })).toBeDisabled();
  await userEvent.click(within(dialog).getByRole('button', { name: '重新加载角色配置' }));
  expect(await within(dialog).findByText('角色版本：5')).toBeInTheDocument();
  expect(within(dialog).getByText('审核角色')).toBeInTheDocument();
  expect(writes).toBe(1);
  await userEvent.click(within(dialog).getByRole('button', { name: '保存' }));
  expect(await within(dialog).findByText('角色版本：6')).toBeInTheDocument();
  const puts = requests.filter(([, init]) => init?.method === 'PUT');
  expect(JSON.parse(puts[1][1]!.body as string)).toEqual({ roleIds: ['role-a', 'role-b'], expectedRoleVersion: 5 });
  expect((puts[0][1]!.headers as Record<string, string>)['Idempotency-Key']).not.toBe((puts[1][1]!.headers as Record<string, string>)['Idempotency-Key']);
}, 30000);

it('ignores a late role response after switching organizations and clears the old panel', async () => {
  const pending: { resolve?: (value: Response) => void } = {};
  const fetchMock = vi.fn((input: RequestInfo | URL) => {
    const path = String(input);
    if (path.endsWith('/positions/position-a/roles')) return new Promise<Response>((resolve) => { pending.resolve = resolve; });
    if (path.endsWith('/departments?limit=100&offset=0') || path.endsWith('/positions?limit=100&offset=0')) return Promise.resolve(json(path.includes('/positions?') ? [position] : []));
    if (path.includes('/admin/roles?organizationId=org-a')) return Promise.resolve(json([roleA]));
    return Promise.resolve(json([]));
  });
  vi.stubGlobal('fetch', fetchMock);
  const result = render(<LanguageProvider><StructureAdministration organization={organization(['organization:structure:read', 'account:roles:read'])} /></LanguageProvider>);
  await userEvent.click(await positionAction());
  result.rerender(<LanguageProvider><StructureAdministration organization={organization(['organization:structure:read'])} /></LanguageProvider>);
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  pending.resolve?.(json(roleDetails()));
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(screen.queryByText('角色版本：4')).not.toBeInTheDocument();
});

it('keeps the position table locally scrollable and exposes row actions to the keyboard', async () => {
  view(['organization:structure:read', 'account:roles:read']);
  const action = await positionAction();
  expect(action.closest('.ant-table-wrapper')).toHaveClass('position-structure-table');
  action.focus();
  expect(action).toHaveFocus();
  await userEvent.keyboard('{Enter}');
  expect(await screen.findByRole('dialog')).toBeInTheDocument();
});

const writable = ['organization:structure:read', 'organization:structure:manage', 'account:roles:read', 'account:roles:assign'];
function Destination() { return <output aria-label="route">{useLocation().pathname}</output>; }

it.each(['organization', 'account'])('ignores a revoked-session save response from an old %s context', async (changed) => {
  const { fetchMock } = stubStructureApi();
  const original = fetchMock.getMockImplementation()!;
  let resolveSave: (response: Response) => void = () => {};
  fetchMock.mockImplementation((input, init) => init?.method === 'PUT' ? new Promise<Response>((resolve) => { resolveSave = resolve; }) : original(input, init));
  const result = render(<LanguageProvider><StructureAdministration organization={organization(writable)} /><Destination /></LanguageProvider>);
  await userEvent.click(await positionAction());
  await userEvent.click(await screen.findByRole('button', { name: '保存' }));
  await waitFor(() => expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'PUT')).toBe(true));
  useWorkTabsStore.getState().bindSession('INTERNAL:org-b:new-user');
  useWorkTabsStore.getState().openTab({ id: 'new', path: '/app/account', title: '新上下文' });
  result.rerender(<LanguageProvider><StructureAdministration organization={{ ...organization(writable), id: changed === 'organization' ? 'org-b' : 'org-a' }} /><Destination /></LanguageProvider>);
  resolveSave(json({ ...roleDetails(), selfSessionRevoked: true }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(screen.getByLabelText('route')).toHaveTextContent(/^\/$/);
  expect(useWorkTabsStore.getState().sessionScope).toBe('INTERNAL:org-b:new-user');
  expect(useWorkTabsStore.getState().tabs.map(({ id }) => id)).toContain('new');
});

it.each(['organization:structure:manage', 'account:roles:assign'])('keeps roles read-only without %s', async (missing) => {
  const { requests } = stubStructureApi();
  render(<LanguageProvider><StructureAdministration organization={organization(writable.filter((permission) => permission !== missing))} /></LanguageProvider>);
  await userEvent.click(await positionAction());
  expect(await screen.findByText('角色版本：4')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '保存' })).not.toBeInTheDocument();
  expect(screen.queryByRole('combobox', { name: '岗位角色' })).not.toBeInTheDocument();
  expect(requests.some(([, init]) => init?.method === 'PUT')).toBe(false);
});

it('protects a busy save from close and duplicate submission, then returns focus after closing', async () => {
  const { fetchMock, requests } = stubStructureApi();
  const original = fetchMock.getMockImplementation()!;
  let resolveSave: (response: Response) => void = () => {};
  fetchMock.mockImplementation((input, init) => {
    if (init?.method === 'PUT') { requests.push([String(input), init]); return new Promise<Response>((resolve) => { resolveSave = resolve; }); }
    return original(input, init);
  });
  render(<LanguageProvider><StructureAdministration organization={organization(writable)} /></LanguageProvider>);
  const trigger = await positionAction();
  await userEvent.click(trigger);
  const save = await screen.findByRole('button', { name: '保存' });
  await userEvent.dblClick(save);
  await waitFor(() => expect(requests.filter(([, init]) => init?.method === 'PUT')).toHaveLength(1));
  await userEvent.keyboard('{Escape}');
  expect(screen.getByRole('dialog')).toBeInTheDocument();
  expect(save).toBeDisabled();
  resolveSave(json(roleDetails()));
  await waitFor(() => expect(save).toBeEnabled());
  await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '关闭' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(trigger).toHaveFocus();
});

it('ends the current session after a successful self revocation without replaying the committed write', async () => {
  const { fetchMock, requests } = stubStructureApi();
  const original = fetchMock.getMockImplementation()!;
  useWorkTabsStore.getState().bindSession('INTERNAL:org-a:current');
  useWorkTabsStore.getState().openTab({ id: 'private', path: '/app/account', title: 'Private' });
  fetchMock.mockImplementation((input, init) => {
    if (init?.method === 'PUT') { requests.push([String(input), init]); return Promise.resolve(json({ ...roleDetails(), selfSessionRevoked: true })); }
    return original(input, init);
  });
  render(<LanguageProvider><StructureAdministration organization={organization(writable)} /><Destination /></LanguageProvider>);
  await userEvent.click(await positionAction());
  await userEvent.click(await screen.findByRole('button', { name: '保存' }));
  await waitFor(() => expect(screen.getByLabelText('route')).toHaveTextContent('/login'));
  expect(useWorkTabsStore.getState().tabs).toEqual([]);
  expect(useWorkTabsStore.getState().sessionScope).toBeUndefined();
  expect(requests.filter(([, init]) => init?.method === 'PUT')).toHaveLength(1);
  expect(screen.queryByRole('button', { name: '保存' })).not.toBeInTheDocument();
});

it('starts a fresh StrictMode load and ignores its older response when responses arrive in reverse order', async () => {
  const { fetchMock } = stubStructureApi();
  const original = fetchMock.getMockImplementation()!;
  const reads: Array<(response: Response) => void> = [];
  fetchMock.mockImplementation((input, init) => String(input).endsWith('/positions/position-a/roles')
    ? new Promise<Response>((resolve) => reads.push(resolve)) : original(input, init));
  render(<StrictMode><LanguageProvider><StructureAdministration organization={organization(writable)} /></LanguageProvider></StrictMode>);
  await userEvent.click(await positionAction());
  await waitFor(() => expect(reads).toHaveLength(2));
  reads[1](json({ ...roleDetails([roleB]), roleVersion: 9 }));
  expect(await screen.findByText('角色版本：9')).toBeInTheDocument();
  reads[0](json(roleDetails([roleA])));
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(screen.getByText('角色版本：9')).toBeInTheDocument();
  expect(screen.queryByText('角色版本：4')).not.toBeInTheDocument();
});

it('filters ungrantable role candidates while allowing removal of a previously configured role', async () => {
  const restricted: AdminRole = { ...roleA, permissions: [{ id: 'permission-secret', code: 'account:users:reset', name: '重置用户' }] };
  const { requests } = stubStructureApi(roleDetails([restricted]), [restricted, roleB, globalRole, otherRole]);
  render(<LanguageProvider><StructureAdministration organization={organization(writable)} /></LanguageProvider>);
  await userEvent.click(await positionAction());
  const dialog = await screen.findByRole('dialog');
  await within(dialog).findByText(restricted.name);
  await userEvent.click(within(dialog).getByRole('combobox', { name: '岗位角色' }));
  await userEvent.keyboard('{Backspace}{Escape}');
  await userEvent.click(within(dialog).getByRole('combobox', { name: '岗位角色' }));
  expect(screen.queryByText(restricted.name)).not.toBeInTheDocument();
  expect(screen.queryByText(globalRole.name)).not.toBeInTheDocument();
  expect(screen.queryByText(otherRole.name)).not.toBeInTheDocument();
  await userEvent.click(within(dialog).getByRole('button', { name: '保存' }));
  await waitFor(() => expect(requests.some(([, init]) => init?.method === 'PUT')).toBe(true));
  expect(JSON.parse(requests.find(([, init]) => init?.method === 'PUT')![1]!.body as string).roleIds).toEqual([]);
});

it('retains a dirty selection when close is cancelled and discards it only after explicit confirmation', async () => {
  const { requests } = stubStructureApi();
  render(<LanguageProvider><StructureAdministration organization={organization(writable)} /></LanguageProvider>);
  const trigger = await positionAction();
  await userEvent.click(trigger);
  const drawer = await screen.findByRole('dialog');
  await userEvent.click(await within(drawer).findByRole('combobox', { name: '岗位角色' }));
  await userEvent.click(await screen.findByText('审核角色'));
  await userEvent.click(within(drawer).getByRole('button', { name: '关闭' }));
  // AntD uses the same test title ID in both portals, so scope by the visible modal title.
  let confirmation = (await screen.findByText('放弃未保存的修改？')).closest('[role="dialog"]') as HTMLElement;
  await userEvent.click(within(confirmation).getByRole('button', { name: /取\s*消/ }));
  expect(within(drawer).getByText('审核角色')).toBeInTheDocument();
  await userEvent.click(within(drawer).getByRole('button', { name: '关闭' }));
  confirmation = (await screen.findByText('放弃未保存的修改？')).closest('[role="dialog"]') as HTMLElement;
  await userEvent.click(within(confirmation).getByRole('button', { name: '放弃修改并关闭' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  await waitFor(() => expect(trigger).toHaveFocus());
  expect(requests.some(([, init]) => init?.method === 'PUT')).toBe(false);
}, 30000);

it('retries a failed transport with the same idempotency key and retains the draft', async () => {
  const { fetchMock, requests } = stubStructureApi();
  const original = fetchMock.getMockImplementation()!;
  let writes = 0;
  fetchMock.mockImplementation((input, init) => {
    if (init?.method === 'PUT') {
      requests.push([String(input), init]);
      return Promise.resolve(++writes === 1 ? json({ code: 'HTTP_503' }, 503) : json({ ...roleDetails(), roleVersion: 5 }));
    }
    return original(input, init);
  });
  render(<LanguageProvider><StructureAdministration organization={organization(writable)} /></LanguageProvider>);
  await userEvent.click(await positionAction());
  await userEvent.click(await screen.findByRole('button', { name: '保存' }));
  await screen.findByRole('button', { name: '重新加载角色配置' });
  expect(writes).toBe(1);
  await userEvent.click(screen.getByRole('button', { name: '保存' }));
  expect(await screen.findByText('角色版本：5')).toBeInTheDocument();
  const puts = requests.filter(([, init]) => init?.method === 'PUT');
  expect(puts[1][1]!.body).toBe(puts[0][1]!.body);
  expect((puts[1][1]!.headers as Record<string, string>)['Idempotency-Key']).toBe((puts[0][1]!.headers as Record<string, string>)['Idempotency-Key']);
}, 30000);

it('uses the shared English role labels and keeps conflict recovery readable', async () => {
  localStorage.setItem('qms:locale:v1', 'en-US');
  const { fetchMock } = stubStructureApi();
  const original = fetchMock.getMockImplementation()!;
  fetchMock.mockImplementation((input, init) => init?.method === 'PUT'
    ? Promise.resolve(json({ code: 'CONCURRENCY_CONFLICT' }, 409)) : original(input, init));
  render(<LanguageProvider><StructureAdministration organization={organization(writable)} /></LanguageProvider>);
  await userEvent.click(await screen.findByRole('tab', { name: 'Position' }));
  await userEvent.click(await screen.findByRole('button', { name: 'Position roles' }));
  const drawer = await screen.findByRole('dialog');
  expect(await within(drawer).findByText('Role version：4')).toBeInTheDocument();
  expect(within(drawer).getByText('Current assignees：3')).toBeInTheDocument();
  expect(within(drawer).getByText('Saved position roles apply automatically to current assignments.')).toBeInTheDocument();
  expect(within(drawer).getByRole('combobox', { name: 'Position roles' })).toBeEnabled();
  await userEvent.click(within(drawer).getByRole('button', { name: 'Save' }));
  expect(await within(drawer).findByText('Another user changed this configuration. Your draft is preserved. Reload before saving.')).toBeInTheDocument();
  expect(within(drawer).getByRole('button', { name: 'Reload role configuration' })).toBeInTheDocument();
  expect(within(drawer).queryByText('岗位角色保存后，当前有效任职会自动生效。')).not.toBeInTheDocument();
}, 30000);
