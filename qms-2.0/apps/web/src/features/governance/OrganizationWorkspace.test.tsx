import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConfigProvider } from 'antd';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { components } from '@qms/contracts';
import { AdminPage } from '../admin/AdminPage';
import type { AdminOrganization } from '../admin/admin';
import { LanguageProvider } from '../../i18n/Language';
import { UnsavedChangesProvider } from '../../layouts/UnsavedChanges';
import { useWorkTabsStore } from '../../work-tabs/workTabsStore';
import { allStructurePages } from './governance';
import { StructureLifecycleActions } from './OrganizationAdministration';

const permissions = ['organization:read', 'organization:manage', 'organization:structure:read', 'organization:structure:manage', 'organization:positions:assign'];
const org: AdminOrganization = { id: 'org-a', code: 'A', name: '甲公司', type: 'INTERNAL', permissions };
const other: AdminOrganization = { ...org, id: 'org-b', code: 'B', name: '乙公司' };
const organization: components['schemas']['OrganizationDto'] = { ...org, parentId: null, status: 'ACTIVE', version: 3 };
const department: components['schemas']['DepartmentDto'] = { id: 'dep-a', organizationId: org.id, code: 'QA', name: '质量部', parentId: null, status: 'ACTIVE', version: 4 };
const child = { ...department, id: 'dep-child', name: '质量科', code: 'QC', parentId: department.id };
const sibling = { ...department, id: 'dep-b', name: '采购部', code: 'BUY' };
const position: components['schemas']['PositionDto'] = { id: 'pos-a', organizationId: org.id, departmentId: department.id, categoryId: null, code: 'QE', name: '质量工程师', status: 'ACTIVE', version: 1 };
const otherPosition = { ...position, id: 'pos-b', departmentId: sibling.id, code: 'BUY', name: '采购专员' };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

it.each([true, false])('shows actionable lifecycle details and only exposes an authorized target audit link (%s)', async canReadAudit => {
  vi.stubGlobal('fetch', vi.fn(async () => json({ deleteBlockers: ['存在非初始化授权或管理使用记录'], disableBlockers: [], deleteBlockerDetails: [{ code: 'NON_INITIALIZATION_GRANTS', count: 2, message: '请核对额外授权来源，不能自动删除。' }] })));
  render(<MemoryRouter><StructureLifecycleActions path="/api/v1/organizations/child" record={organization} auditOrganizationId={canReadAudit ? org.id : undefined} onChanged={vi.fn()} /></MemoryRouter>);
  await userEvent.click(screen.getByRole('button', { name: /^删\s*除$/ }));
  const dialog = within(await screen.findByRole('dialog'));
  await waitFor(() => expect(dialog.getByText('请核对额外授权来源，不能自动删除。 · 2')).toBeVisible());
  expect(dialog.getByRole('button', { name: '确认删除' })).toBeDisabled();
  if (canReadAudit) {
    expect(dialog.getByRole('link', { name: '定位此组织审计' })).toHaveAttribute('href', `/app/admin?organizationId=${org.id}&section=audit-log&resourceType=Organization&resourceId=${organization.id}`);
    expect(dialog.getByRole('link', { name: '查看组织管理审计' })).toHaveAttribute('href', `/app/admin?organizationId=${org.id}&section=audit-log`);
  } else expect(dialog.queryByRole('link')).not.toBeInTheDocument();
});

it('places management responsibilities inside the selected department workspace', async () => {
  stub();
  view([org]);
  await selectDepartment();
  fireEvent.click(await screen.findByRole('tab', { name: '管理职责' }));
  expect(await screen.findByRole('button', { name: '新增职责绑定' })).toBeVisible();
  expect(screen.getByRole('button', { name: '职责预览' })).toBeVisible();
}, 30000);
it('aborts management reads on leaving the tab and rejects a late preview', async () => {
  const { fetchMock } = stub();
  const original = fetchMock.getMockImplementation()!;
  let finishPreview!: (response: Response) => void;
  let signal: AbortSignal | null | undefined;
  fetchMock.mockImplementation((input, init) => String(input).includes('/management-responsibilities?')
    ? (signal = init?.signal, new Promise<Response>(resolve => { finishPreview = resolve; }))
    : original(input, init));
  view([org]); await selectDepartment();
  fireEvent.click(await screen.findByRole('tab', { name: '管理职责' }));
  fireEvent.click(await screen.findByRole('button', { name: '职责预览' }));
  await waitFor(() => expect(signal).toBeDefined());
  fireEvent.click(screen.getByRole('tab', { name: '基本信息' }));
  expect(signal?.aborted).toBe(true);
  const late: components['schemas']['ManagementResponsibilitiesDto'] = {
    organizationId: org.id, sectionDepartmentId: department.id, at: '2026-10-25T00:00:00.000Z',
    responsibilities: [], issues: [{ responsibility: 'SECTION_MANAGER', code: 'ASSIGNMENT_AMBIGUOUS' }],
  };
  await act(async () => finishPreview(json(late)));
  fireEvent.click(screen.getByRole('tab', { name: '管理职责' }));
  const previewButton = await screen.findByRole('button', { name: '职责预览' });
  await waitFor(() => expect(previewButton).toBeEnabled());
  expect(screen.queryByText('科室经理：存在多个有效任职候选')).not.toBeInTheDocument();
}, 30000);
function stub() {
  const requests: Array<[string, RequestInit | undefined]> = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input); requests.push([path, init]);
    if (path.endsWith('/csrf')) return json({ csrfToken: 'csrf' });
    if (path.endsWith('/lifecycle')) return json({ deleteBlockers: [], disableBlockers: [] });
    if (init?.method) return json({ id: 'saved', deleted: true });
    if (path.includes('/organizations/tree?')) return json([organization, { ...organization, ...other }]);
    if (path.includes('/org-a/departments?')) return json([department, child, sibling]);
    if (path.includes('/org-a/positions?')) return json([position, otherPosition]);
    if (path.includes('/users/') && path.includes('/positions')) return json([]);
    return json([]);
  });
  vi.stubGlobal('fetch', fetchMock);
  return { requests, fetchMock };
}
function Route() { return <output aria-label="route">{useLocation().pathname}</output>; }
function view(organizations = [org, other], onDirectoryChange?: () => void) {
  return render(scene(organizations, onDirectoryChange));
}
function scene(organizations = [org, other], onDirectoryChange?: () => void) { return <ConfigProvider theme={{ token: { motion: false } }}><MemoryRouter><LanguageProvider><UnsavedChangesProvider><AdminPage organizations={organizations} onDirectoryChange={onDirectoryChange} /><Route /></UnsavedChangesProvider></LanguageProvider></MemoryRouter></ConfigProvider>; }

it('treats reselecting the current department as a no-op instead of pretending to discard a draft', async () => {
  stub(); view(); await selectDepartment(); await userEvent.click(screen.getByRole('button', { name: /^编\s*辑$/ }));
  fireEvent.change(within(screen.getByRole('dialog')).getByLabelText('名称'), { target: { value: '保留草稿' } });
  await selectDepartment();
  expect(screen.queryByRole('dialog', { name: '当前草稿尚未保存，继续将放弃修改。' })).not.toBeInTheDocument();
  expect(within(screen.getByRole('dialog')).getByLabelText('名称')).toHaveValue('保留草稿');
}, 30000);

it('keeps the current draft when unrelated directory metadata changes without a scope change', async () => {
  stub(); const result = view(); await selectDepartment(); await userEvent.click(screen.getByRole('button', { name: /^编\s*辑$/ }));
  fireEvent.change(within(screen.getByRole('dialog')).getByLabelText('名称'), { target: { value: '保留草稿' } });
  result.rerender(scene([org, { ...other, name: '乙公司新名称' }]));
  expect(within(screen.getByRole('dialog')).getByLabelText('名称')).toHaveValue('保留草稿');
}, 30000);

it('refreshes the parent department directory from the workspace context panel and retains the selected node', async () => {
  const { fetchMock, requests } = stub(); const original = fetchMock.getMockImplementation()!;
  const directoryChanged = vi.fn();
  let updated = false;
  fetchMock.mockImplementation((input, init) => String(input).includes('/org-a/departments?') ? (requests.push([String(input), init]), Promise.resolve(json([{ ...department, code: updated ? 'QA-NEW' : department.code, version: updated ? 5 : 4 }, child, sibling]))) : original(input, init));
  view([org, other], directoryChanged); await selectDepartment(); updated = true;
  const before = requests.filter(([path]) => path.includes('/org-a/departments?')).length;
  const refreshButton = within(screen.getByRole('region', { name: '部门岗位' })).getByRole('button', { name: /^刷\s*新$/ });
  await waitFor(() => expect(refreshButton).toBeEnabled());
  await userEvent.click(refreshButton);
  await waitFor(() => expect(requests.filter(([path]) => path.includes('/org-a/departments?')).length).toBeGreaterThan(before));
  expect(directoryChanged).not.toHaveBeenCalled();
  expect(await within(await screen.findByLabelText('可读组织与部门')).findByLabelText('质量部 · 部门/科室')).toHaveAttribute('aria-pressed', 'true');
  await userEvent.click(within(screen.getByRole('region', { name: '部门岗位' })).getByRole('button', { name: /^编\s*辑$/ }));
  expect(within(screen.getByRole('dialog')).getByLabelText('代码')).toHaveValue('QA-NEW');
  await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /^保\s*存$/ }));
  await waitFor(() => expect(requests.some(([, init]) => init?.method === 'PATCH')).toBe(true));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(directoryChanged).not.toHaveBeenCalled();
  expect(await within(await screen.findByLabelText('可读组织与部门')).findByLabelText('质量部 · 部门/科室')).toHaveAttribute('aria-pressed', 'true');
}, 30000);

it.each([{ failure: 'transport', change: 'none' }, { failure: 'json', change: 'none' }, { failure: 'transport', change: 'session' }, { failure: 'transport', change: 'version' }, { failure: 'transport', change: 'path' }])('recovers an unknown DELETE $failure result without a GET, but never across a $change change', async ({ failure, change }) => {
  const requests: Array<[string, RequestInit | undefined]> = [];
  let deleted = false;
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input); requests.push([path, init]);
    if (path.endsWith('/csrf')) return json({ csrfToken: 'csrf' });
    if (path.endsWith('/lifecycle')) return deleted ? json({ code: 'STRUCTURE_NOT_FOUND' }, 404) : json({ deleteBlockers: [], disableBlockers: [] });
    if (init?.method === 'DELETE') {
      if (!deleted) { deleted = true; if (failure === 'transport') throw new TypeError('Failed to fetch'); else return new Response('{', { headers: { 'content-type': 'application/json' } }); }
      return json({ id: sibling.id, deleted: true });
    }
    return json([]);
  }));
  const changed = vi.fn();
  const lifecycle = (path = '/api/v1/organizations/org-a/departments/dep-b', version = sibling.version) => <MemoryRouter><LanguageProvider><UnsavedChangesProvider><StructureLifecycleActions path={path} record={{ ...sibling, version }} onChanged={changed} /></UnsavedChangesProvider></LanguageProvider></MemoryRouter>;
  const result = render(lifecycle());
  await userEvent.click(screen.getByRole('button', { name: /^删\s*除$/ }));
  const confirm = await screen.findByRole('button', { name: '确认删除' });
  await waitFor(() => expect(confirm).toBeEnabled()); await userEvent.click(confirm);
  const retry = await screen.findByRole('button', { name: '重试确认结果' });
  if (change === 'session') act(() => useWorkTabsStore.getState().bindSession('INTERNAL:org-b:new-user'));
  if (change === 'version') result.rerender(lifecycle(undefined, sibling.version + 1));
  if (change === 'path') result.rerender(lifecycle('/api/v1/organizations/org-b/departments/dep-b'));
  await userEvent.click(retry);
  if (change !== 'none') {
    expect(requests.filter(([, init]) => init?.method === 'DELETE')).toHaveLength(1);
    expect(changed).not.toHaveBeenCalled();
    return;
  }
  await waitFor(() => expect(changed).toHaveBeenCalledOnce());
  const deletes = requests.filter(([, init]) => init?.method === 'DELETE');
  expect(deletes).toHaveLength(2);
  expect(deletes[1][1]!.body).toBe(deletes[0][1]!.body);
  expect((deletes[1][1]!.headers as Record<string, string>)['Idempotency-Key']).toBe((deletes[0][1]!.headers as Record<string, string>)['Idempotency-Key']);
  expect(requests.filter(([path]) => path.endsWith('/lifecycle'))).toHaveLength(1);
}, 30000);

it('retains an unknown original DELETE through recovery CSRF 403 and unchanged-payload 409 until its cached receipt arrives', async () => {
  const requests: Array<[string, RequestInit | undefined]> = [];
  let csrfReads = 0; let deletes = 0;
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input); requests.push([path, init]);
    if (path.endsWith('/csrf')) return ++csrfReads === 2 ? json({ code: 'CSRF_INVALID' }, 403) : json({ csrfToken: 'csrf' });
    if (path.endsWith('/lifecycle')) return deletes ? json({ code: 'STRUCTURE_NOT_FOUND' }, 404) : json({ deleteBlockers: [], disableBlockers: [] });
    if (init?.method === 'DELETE') {
      deletes++;
      if (deletes === 1) throw new TypeError('Response lost after commit');
      if (deletes === 2) return json({ code: 'CONCURRENCY_CONFLICT' }, 409);
      return json({ id: sibling.id, deleted: true });
    }
    return json([]);
  }));
  const changed = vi.fn();
  render(<MemoryRouter><LanguageProvider><UnsavedChangesProvider><StructureLifecycleActions path="/api/v1/organizations/org-a/departments/dep-b" record={sibling} onChanged={changed} /></UnsavedChangesProvider></LanguageProvider></MemoryRouter>);
  await userEvent.click(screen.getByRole('button', { name: /^删\s*除$/ }));
  const confirm = await screen.findByRole('button', { name: '确认删除' });
  await waitFor(() => expect(confirm).toBeEnabled()); await userEvent.click(confirm);
  await userEvent.click(await screen.findByRole('button', { name: '重试确认结果' }));
  await screen.findByText('安全校验失败，请重试');
  await userEvent.click(screen.getByRole('button', { name: '重试确认结果' }));
  await waitFor(() => expect(deletes).toBe(2));
  await waitFor(() => expect(screen.getByRole('button', { name: '重试确认结果' })).toBeEnabled());
  await userEvent.click(screen.getByRole('button', { name: '重试确认结果' }));
  await waitFor(() => expect(changed).toHaveBeenCalledOnce());
  const replayed = requests.filter(([, init]) => init?.method === 'DELETE');
  expect(replayed).toHaveLength(3);
  for (const [path, init] of replayed) {
    expect(path).toBe('/api/v1/organizations/org-a/departments/dep-b');
    expect(init!.body).toBe(JSON.stringify({ expectedVersion: sibling.version }));
    expect((init!.headers as Record<string, string>)['Idempotency-Key']).toBe((replayed[0][1]!.headers as Record<string, string>)['Idempotency-Key']);
  }
  expect(requests.filter(([path]) => path.endsWith('/lifecycle'))).toHaveLength(1);
}, 30000);
async function selectDepartment(name = '质量部') {
  const navigation = await screen.findByLabelText('可读组织与部门');
  const button = await within(navigation).findByLabelText(`${name} · 部门/科室`);
  expect(button).toHaveRole('button');
  expect(button).toBeVisible();
  await userEvent.click(button);
}
beforeEach(() => { vi.stubEnv('NODE_ENV', 'development'); });
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); localStorage.clear(); useWorkTabsStore.getState().reset(); });

it('keeps organization basic information inside the same context tabs rather than above every panel', async () => {
  stub(); view();
  const basic = await screen.findByRole('tab', { name: '基本信息' });
  const details = screen.getByRole('region', { name: '组织基本信息' });
  expect(details.closest('[role="tabpanel"]')).toBe(basic.closest('.ant-tabs')?.querySelector('[role="tabpanel"]'));
  await userEvent.click(screen.getByRole('tab', { name: '岗位' }));
  expect(details).not.toBeVisible();
}, 30000);

it('reads all organization pages including item 101 while retaining the real scope query', async () => {
  const first = Array.from({ length: 100 }, (_, index) => ({ ...organization, id: `org-${index}` }));
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => json(String(input).endsWith('offset=0') ? first : [organization]));
  vi.stubGlobal('fetch', fetchMock);
  expect(await allStructurePages('/api/v1/organizations/tree?organizationId=org-a')).toHaveLength(101);
  expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual(['/api/v1/organizations/tree?organizationId=org-a&limit=100&offset=0', '/api/v1/organizations/tree?organizationId=org-a&limit=100&offset=100']);
});

it('fails explicitly instead of silently truncating a directory beyond its bounded page window', async () => {
  const fetchMock = vi.fn(async () => json(Array.from({ length: 100 }, () => department)));
  vi.stubGlobal('fetch', fetchMock);
  await expect(allStructurePages('/api/v1/organizations/org-a/departments')).rejects.toThrow('Structure exceeds supported page window');
  expect(fetchMock).toHaveBeenCalledTimes(101);
});

it('uses parentId for a real department tree and filters positions without inheriting organization permissions', async () => {
  stub(); view();
  const childNode = await screen.findByRole('button', { name: '质量科 · 部门/科室' });
  expect(childNode.closest('li')?.parentElement?.closest('li')).toContainElement(screen.getByRole('button', { name: '质量部 · 部门/科室' }));
  await selectDepartment();
  await userEvent.click(screen.getByRole('tab', { name: '岗位' }));
  expect(await screen.findByText('质量工程师')).toBeVisible();
  expect(screen.queryByText('采购专员')).not.toBeInTheDocument();
}, 30000);

it.each([{ permission: 'organization:read', hidden: '/departments?' }, { permission: 'organization:structure:read', hidden: '/organizations/tree?' }])('keeps readable sections with only $permission', async ({ permission, hidden }) => {
  const { requests } = stub(); view([{ ...org, permissions: [permission] }]);
  expect(await screen.findByRole('tab', { name: '组织与岗位' })).toBeVisible();
  await waitFor(() => expect(screen.queryByRole('progressbar')).not.toBeInTheDocument());
  expect(requests.some(([path]) => path.includes(hidden))).toBe(false);
  if (permission === 'organization:structure:read') await selectDepartment();
  else expect(await screen.findByText('无部门岗位读取权限')).toBeVisible();
}, 30000);

it('synchronizes selecting a different readable organization with the management scope', async () => {
  const { requests } = stub(); view();
  await userEvent.click(await screen.findByRole('button', { name: '乙公司 · 组织' }));
  expect(screen.getByRole('combobox', { name: '管理组织' }).closest('.ant-select')).toHaveTextContent('乙公司');
  await waitFor(() => expect(requests.some(([path]) => path.includes('/org-b/departments?'))).toBe(true));
  expect(screen.queryByRole('button', { name: '质量部 · 部门/科室' })).not.toBeInTheDocument();
}, 30000);

it('prefills new positions from the selected department', async () => {
  const { requests } = stub(); view(); await selectDepartment();
  await userEvent.click(screen.getByRole('tab', { name: '岗位' }));
  await userEvent.click(screen.getByRole('button', { name: '新增岗位' }));
  const dialog = screen.getByRole('dialog');
  expect(within(dialog).getByLabelText('部门').closest('.ant-select')).toHaveTextContent('质量部');
  await userEvent.type(within(dialog).getByLabelText('代码'), 'NEW');
  await userEvent.type(within(dialog).getByLabelText('名称'), '新岗位');
  await userEvent.click(within(dialog).getByRole('button', { name: /^保\s*存$/ }));
  await waitFor(() => expect(requests.some(([path, init]) => path.endsWith('/org-a/positions') && init?.method === 'POST')).toBe(true));
  expect(JSON.parse(requests.find(([path, init]) => path.endsWith('/positions') && init?.method === 'POST')![1]!.body as string)).toMatchObject({ departmentId: department.id, code: 'NEW' });
}, 30000);

it.each([{ kind: 'organization' }, { kind: 'department' }])('updates $kind code on the original ID and version without a direct status field', async ({ kind }) => {
  const { requests } = stub(); view();
  if (kind === 'department') await selectDepartment();
  await userEvent.click(await screen.findByRole('button', { name: /^编\s*辑$/ }));
  const dialog = screen.getByRole('dialog');
  expect(within(dialog).queryByLabelText('状态')).not.toBeInTheDocument();
  await userEvent.clear(within(dialog).getByLabelText('代码'));
  await userEvent.type(within(dialog).getByLabelText('代码'), 'CORRECTED');
  await userEvent.click(within(dialog).getByRole('button', { name: /^保\s*存$/ }));
  const path = kind === 'organization' ? '/api/v1/organizations/org-a' : '/api/v1/organizations/org-a/departments/dep-a';
  await waitFor(() => expect(requests.some(([url, init]) => url === path && init?.method === 'PATCH')).toBe(true));
  const body = JSON.parse(requests.find(([url, init]) => url === path && init?.method === 'PATCH')![1]!.body as string);
  expect(body).toMatchObject({ code: 'CORRECTED', expectedVersion: kind === 'organization' ? 3 : 4 });
  expect(body).not.toHaveProperty('status');
}, 30000);

it.each([{ action: '删除', field: 'deleteBlockers' }, { action: '停用', field: 'disableBlockers' }])('checks dependencies and blocks $action confirmation', async ({ action, field }) => {
  const { fetchMock, requests } = stub(); const original = fetchMock.getMockImplementation()!;
  fetchMock.mockImplementation((input, init) => String(input).endsWith('/lifecycle') ? Promise.resolve(json({ deleteBlockers: [], disableBlockers: [], [field]: ['存在有效任职'] })) : original(input, init));
  view(); await selectDepartment();
  await userEvent.click(screen.getByRole('button', { name: new RegExp(`^${action.split('').join('\\s*')}$`) }));
  const dialog = screen.getByRole('dialog');
  await waitFor(() => expect(within(dialog).getByText('存在有效任职')).toBeVisible());
  expect(within(dialog).getByRole('button', { name: `确认${action}` })).toBeDisabled();
  expect(requests.some(([, init]) => init?.method === 'DELETE' || init?.method === 'PATCH')).toBe(false);
}, 30000);

it('requires explicit confirmation and keeps context on a final delete conflict', async () => {
  const { fetchMock, requests } = stub(); const original = fetchMock.getMockImplementation()!;
  fetchMock.mockImplementation((input, init) => init?.method === 'DELETE' ? (requests.push([String(input), init]), Promise.resolve(json({ code: 'CONCURRENCY_CONFLICT', traceId: 'delete-trace' }, 409))) : original(input, init));
  view(); await selectDepartment(); await userEvent.click(screen.getByRole('button', { name: /^删\s*除$/ }));
  const dialog = screen.getByRole('dialog');
  const confirm = await within(dialog).findByRole('button', { name: '确认删除' });
  await waitFor(() => expect(confirm).toBeEnabled());
  expect(requests.some(([, init]) => init?.method === 'DELETE')).toBe(false);
  await userEvent.click(confirm);
  expect(await within(dialog).findByText('delete-trace')).toBeVisible();
  const deletion = requests.find(([, init]) => init?.method === 'DELETE')!;
  expect(deletion[0]).toBe('/api/v1/organizations/org-a/departments/dep-a');
  expect(JSON.parse(deletion[1]!.body as string)).toEqual({ expectedVersion: 4 });
  expect(screen.getByRole('button', { name: '质量部 · 部门/科室' })).toBeVisible();
}, 30000);

it.each([{ leave: 'node' }, { leave: 'close' }, { leave: 'refresh' }])('protects a dirty editor on $leave and preserves it when cancelled', async ({ leave }) => {
  stub(); view(); await selectDepartment(); await userEvent.click(screen.getByRole('button', { name: /^编\s*辑$/ }));
  await userEvent.type(within(screen.getByRole('dialog')).getByLabelText('名称'), '草稿');
  if (leave === 'node') await selectDepartment('采购部');
  if (leave === 'close') await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /^取\s*消$/ }));
  if (leave === 'refresh') await userEvent.click(screen.getByRole('button', { name: '刷新架构' }));
  const guard = await screen.findByRole('dialog', { name: '当前草稿尚未保存，继续将放弃修改。' });
  await userEvent.click(within(guard).getByRole('button', { name: '继续编辑' }));
  expect(within(screen.getByRole('dialog')).getByLabelText('名称')).toHaveValue('质量部草稿');
  const event = new Event('beforeunload', { cancelable: true });
  fireEvent(window, event); expect(event.defaultPrevented).toBe(true);
}, 30000);

it('ends the current session on a lifecycle 401 instead of keeping a stale delete action', async () => {
  const { fetchMock } = stub(); const original = fetchMock.getMockImplementation()!;
  fetchMock.mockImplementation((input, init) => String(input).endsWith('/lifecycle') ? Promise.resolve(json({ code: 'AUTH_SESSION_REQUIRED' }, 401)) : original(input, init));
  view(); await selectDepartment(); await userEvent.click(screen.getByRole('button', { name: /^删\s*除$/ }));
  await waitFor(() => expect(screen.getByLabelText('route')).toHaveTextContent('/login'));
  expect(screen.queryByRole('button', { name: '确认删除' })).not.toBeInTheDocument();
}, 30000);

it('ignores a late lifecycle response after changing scope', async () => {
  const { fetchMock } = stub(); const original = fetchMock.getMockImplementation()!;
  let resolve!: (response: Response) => void;
  fetchMock.mockImplementation((input, init) => String(input).endsWith('/lifecycle') ? new Promise<Response>(done => { resolve = done; }) : original(input, init));
  view(); await selectDepartment(); await userEvent.click(screen.getByRole('button', { name: /^删\s*除$/ }));
  await waitFor(() => expect(resolve).toBeTypeOf('function'));
  await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /^取\s*消$/ }));
  await userEvent.click(screen.getByRole('button', { name: '乙公司 · 组织' }));
  await act(async () => resolve(json({ deleteBlockers: ['旧组织依赖'], disableBlockers: [] })));
  expect(screen.queryByText('旧组织依赖')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '确认删除' })).not.toBeInTheDocument();
}, 30000);

it('does not let an old lifecycle 401 clear a newly bound session', async () => {
  const { fetchMock } = stub(); const original = fetchMock.getMockImplementation()!;
  let resolve!: (response: Response) => void;
  fetchMock.mockImplementation((input, init) => String(input).endsWith('/lifecycle') ? new Promise<Response>(done => { resolve = done; }) : original(input, init));
  view(); await selectDepartment(); await userEvent.click(screen.getByRole('button', { name: /^删\s*除$/ }));
  await waitFor(() => expect(resolve).toBeTypeOf('function'));
  act(() => useWorkTabsStore.getState().bindSession('INTERNAL:org-b:new-user'));
  await act(async () => resolve(json({ code: 'AUTH_SESSION_REQUIRED' }, 401)));
  expect(useWorkTabsStore.getState().sessionScope).toBe('INTERNAL:org-b:new-user');
  expect(screen.getByLabelText('route')).not.toHaveTextContent('/login');
}, 30000);
