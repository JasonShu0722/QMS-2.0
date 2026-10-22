import { act, render as renderUI, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import type { components } from '@qms/contracts';
import { LanguageProvider } from '../../i18n/Language';
import { StructureAdministration } from './StructureAdministration';
import type { AdminOrganization, AdminUser } from '../admin/admin';
import { useWorkTabsStore } from '../../work-tabs/workTabsStore';

const org: AdminOrganization = { id: 'org-a', code: 'A', name: '甲组织', type: 'INTERNAL', permissions: ['organization:structure:read', 'organization:positions:assign'] };
const department: components['schemas']['DepartmentDto'] = { id: 'dept-a', organizationId: org.id, parentId: null, code: 'QA', name: '质量部', status: 'ACTIVE', version: 1 };
const position: components['schemas']['PositionDto'] = { id: 'position-a', organizationId: org.id, departmentId: department.id, categoryId: null, code: 'QA', name: '质量工程师', status: 'ACTIVE', version: 1 };
const user: AdminUser = { id: 'user-a', username: 'zhangsan', email: 'zhangsan@example.test', fullName: null, phone: null, profileVersion: 1, emailVerifiedAt: null, accountType: 'INTERNAL', status: 'ACTIVE', mfaEnabled: false, organizationId: org.id, organization: { id: org.id, name: org.name, code: org.code }, createdAt: '2020-01-01T00:00:00Z', updatedAt: '2020-01-01T00:00:00Z' };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const render = (ui: ReactNode) => renderUI(ui, { wrapper: MemoryRouter });
function assignment(id: string, target: typeof position, startedAt = '2020-01-01T00:00:00Z', endedAt: string | null = null): components['schemas']['UserPositionDto'] {
  return { id, userId: user.id, organizationId: org.id, positionId: target.id, position: target, startedAt, endedAt };
}
const preview = (positionIds: string[], authorizationBaseline = 'preview-baseline'): components['schemas']['PositionAuthorizationPreviewDto'] => ({
  authorizationBaseline, positions: positionIds.map(id => ({ id, code: position.code, name: position.name, department: { id: department.id, code: department.code, name: department.name }, version: 1, roleVersion: 1, permissionCodes: [], mfaRequired: false, historicalSources: [] })), effectivePermissionCodes: [], effectiveMfaRequired: false, retainedSources: [],
});
function stub(entries: components['schemas']['UserPositionDto'][] = [], positions = [position], departments = [department]) {
  const requests: Array<[string, RequestInit | undefined]> = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input); requests.push([path, init]);
    if (path.includes('/admin/users?')) return json([user]);
    if (path.endsWith('/position-authorization/preview')) return json(preview(JSON.parse(init!.body as string).positionIds));
    if (path.includes('/users/') && path.includes('/positions')) return json(entries);
    if (path.endsWith('/departments?limit=100&offset=0')) return json(departments);
    if (path.endsWith('/positions?limit=100&offset=0')) return json(positions);
    if (path.endsWith('/csrf')) return json({ csrfToken: 'csrf' });
    return json([]);
  });
  vi.stubGlobal('fetch', fetchMock);
  return { requests, fetchMock };
}
async function openAssignments() { await userEvent.click(await screen.findByRole('tab', { name: '用户任职' })); }
afterEach(() => { vi.unstubAllGlobals(); localStorage.clear(); useWorkTabsStore.getState().reset(); });

it('uses identifiable scoped users only with users:read and retains the controlled ID path otherwise', async () => {
  const { requests } = stub();
  const result = render(<LanguageProvider><StructureAdministration organization={{ ...org, permissions: [...org.permissions, 'account:users:read'] }} /></LanguageProvider>);
  await openAssignments();
  const selector = await screen.findByRole('combobox', { name: '用户' });
  await userEvent.click(selector);
  await userEvent.click(await screen.findByText('zhangsan · zhangsan@example.test'));
  await userEvent.click(screen.getByRole('button', { name: '查看任职' }));
  await waitFor(() => expect(requests.some(([path]) => path.includes('/users/user-a/positions'))).toBe(true));
  result.unmount(); requests.length = 0;
  render(<LanguageProvider><StructureAdministration organization={org} /></LanguageProvider>);
  await openAssignments();
  expect(screen.getByRole('textbox', { name: '用户 ID' })).toBeInTheDocument();
  expect(requests.some(([path]) => path.includes('/admin/users'))).toBe(false);
});

it('uses temporal and enabled structure facts for both selection and the CAS baseline', async () => {
  const future = { ...position, id: 'future', name: '未来任职' };
  const ended = { ...position, id: 'ended', name: '已结束任职' };
  const disabled = { ...position, id: 'disabled', name: '停用岗位', status: 'DISABLED' as const };
  const disabledDepartment = { ...department, id: 'dept-disabled', status: 'DISABLED' as const };
  const blocked = { ...position, id: 'blocked', name: '停用部门岗位', departmentId: disabledDepartment.id };
  const entries = [assignment('active', position, undefined, '2099-01-01T00:00:00Z'), assignment('future', future, '2099-01-01T00:00:00Z'), assignment('ended', ended, undefined, '2021-01-01T00:00:00Z'), assignment('disabled', disabled), assignment('blocked', blocked)];
  const { requests } = stub(entries, [position, future, ended, disabled, blocked], [department, disabledDepartment]);
  render(<LanguageProvider><StructureAdministration organization={org} /></LanguageProvider>);
  await openAssignments();
  await userEvent.type(screen.getByRole('textbox', { name: '用户 ID' }), user.id);
  await userEvent.click(screen.getByRole('button', { name: '查看任职' }));
  const selector = await screen.findByRole('combobox', { name: '任职岗位' });
  const selected = selector.closest('.ant-select')!;
  expect(within(selected as HTMLElement).getByText(`${position.name} · ${position.code}`)).toBeInTheDocument();
  expect(within(selected as HTMLElement).queryByText(`${future.name} · ${future.code}`)).not.toBeInTheDocument();
  expect(within(selected as HTMLElement).queryByText(`${ended.name} · ${ended.code}`)).not.toBeInTheDocument();
  expect(within(selected as HTMLElement).queryByText(`${disabled.name} · ${disabled.code}`)).not.toBeInTheDocument();
  expect(within(selected as HTMLElement).queryByText(`${blocked.name} · ${blocked.code}`)).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: '保存任职' })).toBeDisabled();
  await userEvent.click(screen.getByRole('button', { name: '预览授权' }));
  await waitFor(() => expect(screen.getByRole('button', { name: '保存任职' })).toBeEnabled());
  await userEvent.click(screen.getByRole('button', { name: '保存任职' }));
  await waitFor(() => expect(requests.some(([, init]) => init?.method === 'PUT')).toBe(true));
  expect(JSON.parse(requests.find(([path]) => path.endsWith('/position-authorization/preview'))![1]!.body as string)).toEqual({ positionIds: [position.id], targetUserId: user.id });
  expect(JSON.parse(requests.find(([, init]) => init?.method === 'PUT')![1]!.body as string)).toEqual({ positionIds: [position.id], expectedPositionIds: [position.id], authorizationBaseline: 'preview-baseline' });
});

it('ignores appointment reads from the previous organization and clears the selected user', async () => {
  const { fetchMock } = stub();
  const original = fetchMock.getMockImplementation()!;
  let resolveRead: (response: Response) => void = () => {};
  fetchMock.mockImplementation((input, init) => String(input).includes('/users/user-a/positions')
    ? new Promise<Response>((resolve) => { resolveRead = resolve; }) : original(input, init));
  const result = render(<LanguageProvider><StructureAdministration organization={org} /></LanguageProvider>);
  await openAssignments();
  await userEvent.type(screen.getByRole('textbox', { name: '用户 ID' }), user.id);
  await userEvent.click(screen.getByRole('button', { name: '查看任职' }));
  result.rerender(<LanguageProvider><StructureAdministration organization={{ ...org, id: 'org-b' }} /></LanguageProvider>);
  resolveRead(json([assignment('old', position)]));
  await openAssignments();
  expect(screen.getByRole('textbox', { name: '用户 ID' })).toHaveValue('');
  expect(screen.queryByRole('button', { name: '保存任职' })).not.toBeInTheDocument();
});

it('follows all structure pages before determining the assignment baseline', async () => {
  const { fetchMock, requests } = stub([assignment('active', position)]);
  const original = fetchMock.getMockImplementation()!;
  const firstPage = Array.from({ length: 100 }, (_, index) => ({ ...department, id: `dept-${index}`, code: `D${index}`, name: `部门${index}` }));
  fetchMock.mockImplementation((input, init) => {
    const path = String(input);
    if (path.includes('/departments?')) { requests.push([path, init]); return Promise.resolve(json(path.endsWith('offset=0') ? firstPage : [department])); }
    return original(input, init);
  });
  render(<LanguageProvider><StructureAdministration organization={org} /></LanguageProvider>);
  await openAssignments();
  await userEvent.type(screen.getByRole('textbox', { name: '用户 ID' }), user.id);
  await userEvent.click(screen.getByRole('button', { name: '查看任职' }));
  const selector = await screen.findByRole('combobox', { name: '任职岗位' });
  expect(within(selector.closest('.ant-select') as HTMLElement).getByText(`${position.name} · ${position.code}`)).toBeInTheDocument();
  expect(requests.some(([path]) => path.endsWith('/departments?limit=100&offset=100'))).toBe(true);
});

it('preserves department creation and versioned editing alongside the new role entry', async () => {
  const { requests } = stub();
  render(<LanguageProvider><StructureAdministration organization={{ ...org, permissions: [...org.permissions, 'organization:structure:manage'] }} /></LanguageProvider>);
  await screen.findByText(department.name);
  await userEvent.click(screen.getByRole('button', { name: /新\s*建/ }));
  let dialog = await screen.findByRole('dialog');
  await userEvent.type(within(dialog).getByLabelText('代码'), 'QA2');
  await userEvent.type(within(dialog).getByLabelText('名称'), '质量二部');
  await userEvent.click(within(dialog).getByRole('button', { name: /保\s*存/ }));
  await waitFor(() => expect(requests.some(([, init]) => init?.method === 'POST')).toBe(true));
  const [createPath, create] = requests.find(([, init]) => init?.method === 'POST')!;
  expect(createPath).toBe('/api/v1/organizations/org-a/departments');
  expect(JSON.parse(create!.body as string)).toEqual({ code: 'QA2', name: '质量二部', parentId: null });
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  await userEvent.click(screen.getByRole('button', { name: /编\s*辑/ }));
  dialog = await screen.findByRole('dialog');
  await userEvent.clear(within(dialog).getByLabelText('名称'));
  await userEvent.type(within(dialog).getByLabelText('名称'), '更新质量部');
  await userEvent.click(within(dialog).getByRole('button', { name: /保\s*存/ }));
  await waitFor(() => expect(requests.some(([, init]) => init?.method === 'PATCH')).toBe(true));
  const [updatePath, update] = requests.find(([, init]) => init?.method === 'PATCH')!;
  expect(updatePath).toBe('/api/v1/organizations/org-a/departments/dept-a');
  expect(JSON.parse(update!.body as string)).toEqual({ name: '更新质量部', parentId: null, status: 'ACTIVE', expectedVersion: 1 });
}, 30000);

function RouteDestination() { return <output aria-label="route">{useLocation().pathname}</output>; }
function pendingCommittedRefresh() {
  const { fetchMock, requests } = stub([assignment('active', position)]);
  const original = fetchMock.getMockImplementation()!;
  let reads = 0;
  let resolveRefresh: (response: Response) => void = () => {};
  fetchMock.mockImplementation((input, init) => {
    if (String(input).includes('/users/user-a/positions')) {
      requests.push([String(input), init]);
      if (init?.method === 'PUT') return Promise.resolve(json([]));
      if (++reads === 1) return Promise.resolve(json([assignment('active', position)]));
      return new Promise<Response>((resolve) => { resolveRefresh = resolve; });
    }
    return original(input, init);
  });
  return { requests, refreshPending: () => reads === 2, resolveRefresh: (response: Response) => resolveRefresh(response) };
}
async function removeCurrentAssignment() {
  await openAssignments();
  await userEvent.type(screen.getByRole('textbox', { name: '用户 ID' }), user.id);
  await userEvent.click(screen.getByRole('button', { name: '查看任职' }));
  const selector = await screen.findByRole('combobox', { name: '任职岗位' });
  const selection = selector.closest('.ant-select') as HTMLElement;
  expect(within(selection).getByText(`${position.name} · ${position.code}`)).toBeInTheDocument();
  await userEvent.click(selector);
  await userEvent.keyboard('{Backspace}{Escape}');
  await waitFor(() => expect(within(selection).queryByText(`${position.name} · ${position.code}`)).not.toBeInTheDocument());
  expect(screen.getByRole('button', { name: '保存任职' })).toBeDisabled();
  await userEvent.click(screen.getByRole('button', { name: '预览授权' }));
  await waitFor(() => expect(screen.getByRole('button', { name: '保存任职' })).toBeEnabled());
  await userEvent.click(screen.getByRole('button', { name: '保存任职' }));
}

it('ends the current session after a committed appointment write refreshes with 401, without replaying PUT', async () => {
  const api = pendingCommittedRefresh();
  useWorkTabsStore.getState().bindSession('INTERNAL:org-a:user-a');
  useWorkTabsStore.getState().openTab({ id: 'private', path: '/app/account', title: 'Private' });
  render(<LanguageProvider><StructureAdministration organization={org} /><RouteDestination /></LanguageProvider>);
  await removeCurrentAssignment();
  await waitFor(() => expect(api.refreshPending()).toBe(true));
  await act(async () => { api.resolveRefresh(json({ code: 'AUTH_SESSION_REQUIRED' }, 401)); });
  await waitFor(() => expect(screen.getByLabelText('route')).toHaveTextContent('/login'));
  expect(useWorkTabsStore.getState().sessionScope).toBeUndefined();
  expect(useWorkTabsStore.getState().tabs).toEqual([]);
  expect(screen.queryByRole('button', { name: '保存任职' })).not.toBeInTheDocument();
  expect(api.requests.filter(([, init]) => init?.method === 'PUT')).toHaveLength(1);
}, 30000);

it.each(['organization', 'account'])('ignores a late appointment refresh 401 from an old %s context', async (changed) => {
  const api = pendingCommittedRefresh();
  useWorkTabsStore.getState().bindSession('INTERNAL:org-a:user-a');
  const result = render(<LanguageProvider><StructureAdministration organization={org} /><RouteDestination /></LanguageProvider>);
  await removeCurrentAssignment();
  await waitFor(() => expect(api.refreshPending()).toBe(true));
  const currentScope = changed === 'account' ? 'INTERNAL:org-a:next-user' : 'INTERNAL:org-a:user-a';
  act(() => {
    useWorkTabsStore.getState().bindSession(currentScope);
    useWorkTabsStore.getState().openTab({ id: 'current-context', path: '/app/account', title: '当前上下文' });
  });
  result.rerender(<LanguageProvider><StructureAdministration organization={{ ...org, id: changed === 'organization' ? 'org-b' : 'org-a' }} /><RouteDestination /></LanguageProvider>);
  await act(async () => { api.resolveRefresh(json({ code: 'AUTH_SESSION_REQUIRED' }, 401)); });
  expect(screen.getByLabelText('route')).toHaveTextContent(/^\/$/);
  expect(useWorkTabsStore.getState().sessionScope).toBe(currentScope);
  expect(useWorkTabsStore.getState().tabs.map(({ id }) => id)).toContain('current-context');
  expect(screen.queryByText('请先登录')).not.toBeInTheDocument();
  expect(api.requests.filter(([, init]) => init?.method === 'PUT')).toHaveLength(1);
}, 30000);

it('accepts the committed appointment baseline before a temporary refresh failure and blocks resubmission', async () => {
  const api = pendingCommittedRefresh();
  useWorkTabsStore.getState().bindSession('INTERNAL:org-a:administrator');
  render(<LanguageProvider><StructureAdministration organization={org} /><RouteDestination /></LanguageProvider>);
  await removeCurrentAssignment();
  await waitFor(() => expect(api.refreshPending()).toBe(true));
  await waitFor(() => expect(screen.queryByRole('cell', { name: position.name })).not.toBeInTheDocument());
  await act(async () => { api.resolveRefresh(json({ code: 'HTTP_503' }, 503)); });
  expect(await screen.findByText('任职已保存，但列表刷新失败。请重新加载任职后再编辑。')).toBeInTheDocument();
  const save = screen.getByRole('button', { name: '保存任职' });
  expect(save).toBeDisabled();
  expect(screen.getByRole('combobox', { name: '任职岗位' })).toBeDisabled();
  await userEvent.click(save);
  expect(api.requests.filter(([, init]) => init?.method === 'PUT')).toHaveLength(1);
  expect(screen.getByLabelText('route')).toHaveTextContent(/^\/$/);
  expect(useWorkTabsStore.getState().sessionScope).toBe('INTERNAL:org-a:administrator');
}, 30000);


it('reloads a concurrently changed appointment baseline without discarding the assignment draft', async () => {
  const concurrent = { ...position, id: 'position-b', code: 'QB', name: '并发新任职' };
  const { requests, fetchMock } = stub([assignment('active', position)], [position, concurrent]);
  const original = fetchMock.getMockImplementation()!;
  let previews = 0;
  let writes = 0;
  fetchMock.mockImplementation((input, init) => {
    if (String(input).endsWith('/position-authorization/preview')) {
      requests.push([String(input), init]);
      return Promise.resolve(json(preview(JSON.parse(init!.body as string).positionIds, `preview-${++previews}`)));
    }
    if (init?.method === 'PUT') { requests.push([String(input), init]); return Promise.resolve(++writes === 1 ? json({ code: 'CONCURRENCY_CONFLICT' }, 409) : json([])); }
    if (writes && String(input).includes('/users/user-a/positions')) {
      requests.push([String(input), init]);
      return Promise.resolve(json(writes === 1 ? [assignment('concurrent', concurrent)] : []));
    }
    return original(input, init);
  });
  render(<LanguageProvider><StructureAdministration organization={org} /></LanguageProvider>);
  await openAssignments();
  await userEvent.type(screen.getByRole('textbox', { name: '用户 ID' }), user.id);
  await userEvent.click(screen.getByRole('button', { name: '查看任职' }));
  const selector = await screen.findByRole('combobox', { name: '任职岗位' });
  const save = screen.getByRole('button', { name: '保存任职' });
  expect(save).toBeDisabled();
  await userEvent.click(screen.getByRole('button', { name: '预览授权' }));
  await waitFor(() => expect(save).toBeEnabled());
  await userEvent.click(selector);
  await userEvent.keyboard('{Backspace}{Escape}');
  expect(save).toBeDisabled();
  expect(screen.queryByRole('region', { name: '权限预览' })).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: '预览授权' }));
  await waitFor(() => expect(save).toBeEnabled());
  await userEvent.click(save);
  await waitFor(() => expect(requests.filter(([, init]) => init?.method === 'PUT')).toHaveLength(1));
  await waitFor(() => expect(save).toBeDisabled());
  expect(within(selector.closest('.ant-select') as HTMLElement).queryByText(`${position.name} · ${position.code}`)).not.toBeInTheDocument();
  expect(screen.queryByRole('region', { name: '权限预览' })).not.toBeInTheDocument();
  expect(JSON.parse(requests.find(([, init]) => init?.method === 'PUT')![1]!.body as string)).toEqual({ positionIds: [], expectedPositionIds: [position.id], authorizationBaseline: 'preview-2' });
  await userEvent.click(await screen.findByRole('button', { name: '读取最新任职基线' }));
  await screen.findByRole('cell', { name: concurrent.name });
  expect(within(selector.closest('.ant-select') as HTMLElement).queryByText(`${concurrent.name} · ${concurrent.code}`)).not.toBeInTheDocument();
  expect(save).toBeDisabled();
  await userEvent.click(screen.getByRole('button', { name: '预览授权' }));
  await waitFor(() => expect(save).toBeEnabled());
  expect(previews).toBe(3);
  await userEvent.click(save);
  await waitFor(() => expect(writes).toBe(2));
  expect(JSON.parse(requests.filter(([, init]) => init?.method === 'PUT')[1][1]!.body as string)).toEqual({ positionIds: [], expectedPositionIds: [concurrent.id], authorizationBaseline: 'preview-3' });
  await waitFor(() => expect(save).toBeDisabled());
  expect(screen.queryByRole('button', { name: '读取最新任职基线' })).not.toBeInTheDocument();
}, 30000);
