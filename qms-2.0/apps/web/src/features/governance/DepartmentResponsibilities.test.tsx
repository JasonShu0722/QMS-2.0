import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConfigProvider } from 'antd';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { components } from '@qms/contracts';
import type { AdminOrganization } from '../admin/admin';
import { LanguageProvider } from '../../i18n/Language';
import { UnsavedChangesProvider } from '../../layouts/UnsavedChanges';
import { useWorkTabsStore } from '../../work-tabs/workTabsStore';
import { DepartmentResponsibilities } from './DepartmentResponsibilities';
import type { Department, Position } from './governance';

vi.setConfig({ testTimeout: 60000 });

type Scope = components['schemas']['MinisterScopeDto'];
type Assignment = components['schemas']['ResponsibilityAssignmentDto'];
const read = 'organization:structure:read';
const manage = 'organization:structure:manage';
const org: AdminOrganization = { id: 'org-a', name: '甲公司', code: 'A', type: 'INTERNAL', permissions: [read, manage] };
const workflowOrg = { ...org, permissions: [...org.permissions, 'workflow:manage'] };
const department: Department = { id: 'dep-a', organizationId: org.id, code: 'QA', name: '质量部', parentId: null, status: 'ACTIVE', version: 1 };
const child: Department = { ...department, id: 'child', code: 'QC', name: '质量科', parentId: department.id };
const grandchild: Department = { ...child, id: 'grandchild', name: '试验组', parentId: child.id };
const sibling: Department = { ...department, id: 'sibling', name: '采购部' };
const disabled: Department = { ...child, id: 'disabled', name: '停用科', status: 'DISABLED' };
const position: Position = { id: 'pos-a', organizationId: org.id, departmentId: department.id, categoryId: null, code: 'M', name: '管理岗', status: 'ACTIVE', version: 1 };
const positions: Position[] = [position, { ...position, id: 'foreign', departmentId: sibling.id, name: '异部门岗' }, { ...position, id: 'inactive', status: 'DISABLED', name: '停用岗' }];
const departments = [department, child, grandchild, sibling, disabled, { ...child, id: 'under-disabled', parentId: disabled.id, name: '停用下级' }];
const audit = { createdBy: 'admin', updatedBy: 'admin', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' };
const assignment: Assignment = { assignmentId: 'appointment-1', userId: 'u1', username: 'one', fullName: '张一', positionId: position.id, positionName: position.name, positionVersion: 1, departmentId: department.id, startedAt: '2020-01-01T00:00:00.000Z', endedAt: null };
const second: Assignment = { ...assignment, assignmentId: 'appointment-2', userId: 'u2', username: 'two', fullName: '张二' };
const scope: Scope = { ...audit, id: 'scope', organizationId: org.id, departmentId: department.id, sectionDepartmentId: child.id, ministerAssignmentId: assignment.assignmentId, validFrom: '2026-01-01T00:00:00.123Z', validTo: '2027-01-01T00:00:00.456Z', status: 'ACTIVE', version: 7, departmentLeadership: true };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
type Request = { path: string; init?: RequestInit };
function stub(options: { scopes?: Scope[]; assignments?: Assignment[]; leaders?: string[]; intercept?: (request: Request) => Response | Promise<Response> | undefined } = {}) {
  const requests: Request[] = [];
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = { path: String(input), init }; requests.push(request);
    const intercepted = options.intercept?.(request);
    if (intercepted) return intercepted;
    if (request.path.endsWith('/csrf')) return json({ csrfToken: 'csrf' });
    if (init?.method) return json({ id: 'saved' });
    if (request.path.endsWith('/responsible-appointments')) return json({ version: 0, assignmentIds: options.leaders ?? [], primaryAssignmentId: options.leaders?.[0] ?? null });
    if (request.path.includes('/minister-scopes?')) return json(options.scopes ?? []);
    if (request.path.includes('/responsibility-assignments?')) return json({ items: options.assignments ?? [assignment, second], total: options.assignments?.length ?? 2 });
    throw new Error(`Unexpected request: ${request.path}`);
  }));
  return requests;
}
function Route() { return <output aria-label="route">{useLocation().pathname}</output>; }
function scene(organization = org, departmentId = department.id) {
  return <ConfigProvider theme={{ token: { motion: false } }}><MemoryRouter><LanguageProvider><UnsavedChangesProvider><DepartmentResponsibilities organization={organization} departmentId={departmentId} departments={departments} positions={positions} /><Route /></UnsavedChangesProvider></LanguageProvider></MemoryRouter></ConfigProvider>;
}
async function loaded() { await waitFor(() => expect(screen.getByRole('button', { name: /^刷\s*新$/ })).toBeEnabled(), { timeout: 5000 }); }
async function select(label: string, text: string) {
  const field = within(screen.getByRole('dialog')).getByLabelText(label);
  await waitFor(() => expect(field).not.toHaveAttribute('aria-busy', 'true'));
  fireEvent.mouseDown(field);
  await userEvent.click(await screen.findByRole('option', { name: text }));
}
async function openLeaders() {
  const button = screen.getByRole('button', { name: '配置部门负责人' });
  await waitFor(() => expect(button).toBeEnabled());
  await userEvent.click(button);
}
async function openScope() {
  await loaded();
  const button = screen.getByRole('button', { name: '新增分管' });
  await waitFor(() => expect(button).toBeEnabled());
  await userEvent.click(button);
  await waitFor(() => expect(within(screen.getByRole('dialog')).getByLabelText('分管负责人')).not.toHaveAttribute('aria-busy', 'true'));
}
async function editScope() {
  const button = screen.getByRole('button', { name: '编辑分管 · 质量科' });
  await waitFor(() => expect(button).toBeEnabled());
  await userEvent.click(button);
}
async function save() { await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /^保\s*存$/ })); }
const writes = (requests: Request[]) => requests.filter(item => item.init?.method && item.path.includes('/organizations/'));
const configured = [assignment.assignmentId, second.assignmentId];
beforeEach(() => { localStorage.clear(); sessionStorage.clear(); useWorkTabsStore.getState().bindSession('INTERNAL:org-a:admin'); });
afterEach(() => { vi.unstubAllGlobals(); useWorkTabsStore.getState().reset(); });

it('offers current responsibility entries to workflow managers and ignores legacy coverage', async () => {
  const requests = stub({ scopes: [{ ...scope, departmentLeadership: false }] }); render(scene(workflowOrg)); await loaded();
  const main = within(await screen.findByRole('region', { name: '下级部门分管' }));
  expect(main.getByRole('button', { name: '新增分管' })).toBeDisabled();
  expect(main.queryByRole('button', { name: '编辑分管 · 质量科' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '其他流程职责（旧配置）' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '制程 8D 关闭审核预览' })).not.toBeInTheDocument();
  expect(requests.some(({ path }) => /management-bindings|management-responsibilities|closure-preview|closure-options/.test(path))).toBe(false);
});

it('uses only configured leads when creating a new coverage', async () => {
  const requests = stub({ intercept: ({ path, init }) => !init?.method && path.endsWith('/responsible-appointments')
    ? json({ version: 1, assignmentIds: [second.assignmentId], primaryAssignmentId: second.assignmentId }) : undefined });
  render(scene()); await loaded(); await userEvent.click(screen.getByRole('button', { name: '新增分管' }));
  await select('分管部门', '质量科'); await select('分管负责人', '张二 (two) · 管理岗 / 质量部');
  expect(screen.queryByRole('option', { name: /张一/ })).not.toBeInTheDocument();
  await save();
  await waitFor(() => expect(writes(requests)).toHaveLength(1));
  expect(JSON.parse(writes(requests)[0].init!.body as string)).toEqual({ departmentId: department.id, sectionDepartmentId: child.id, ministerAssignmentId: second.assignmentId, departmentLeadership: true });
});

it('shows readonly responsibilities without any write entry', async () => {
  stub(); render(scene({ ...org, permissions: [read] })); await loaded();
  expect(screen.getByRole('heading', { name: '本部门职责' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '配置部门负责人' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '新增分管' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /编辑/ })).not.toBeInTheDocument();
});

it('does not read or expose write entries without structure read permission', async () => {
  const requests = stub(); render(scene({ ...org, permissions: [manage] }));
  expect(screen.getByText('无组织职责读取权限')).toBeInTheDocument();
  expect(requests).toHaveLength(0);
});

it('selects one effective appointment as the automatic primary without a category', async () => {
  const requests = stub(); render(scene()); await loaded();
  await userEvent.click(screen.getByRole('button', { name: '配置部门负责人' }));
  expect(within(screen.getByRole('dialog')).queryByLabelText('管理职责')).not.toBeInTheDocument();
  await select('负责人', '张一 (one) · 管理岗 / 质量部');
  expect(screen.getByText('仅一位负责人，自动设为主负责人。')).toBeInTheDocument();
  await save();
  await waitFor(() => expect(writes(requests)).toHaveLength(1));
  expect(writes(requests)[0].path).toMatch(/\/departments\/dep-a\/responsible-appointments$/);
  expect(JSON.parse(writes(requests)[0].init!.body as string)).toEqual({ expectedVersion: 0, assignmentIds: [assignment.assignmentId] });
});

it('requires a primary selected from the configured leads and restricts candidates to the current department', async () => {
  const requests = stub({ assignments: [assignment, second, { ...assignment, assignmentId: 'wrong', fullName: '异部门人', departmentId: sibling.id }] });
  render(scene()); await openLeaders();
  await select('负责人', '张一 (one) · 管理岗 / 质量部');
  expect(screen.queryByRole('option', { name: /异部门人/ })).not.toBeInTheDocument();
  await select('负责人', '张二 (two) · 管理岗 / 质量部');
  await save();
  expect(await screen.findByText('请选择一位主负责人。')).toBeInTheDocument();
  expect(writes(requests)).toHaveLength(0);
  await select('主负责人', '张二 (two) · 管理岗 / 质量部'); await save();
  await waitFor(() => expect(writes(requests)).toHaveLength(1));
  expect(writes(requests)[0].init!.method).toBe('PUT');
  expect(JSON.parse(writes(requests)[0].init!.body as string)).toEqual({ expectedVersion: 0, assignmentIds: [assignment.assignmentId, second.assignmentId], primaryAssignmentId: second.assignmentId });
});

it('offers active appointed leads and only active descendants', async () => {
  const requests = stub({ leaders: [...configured, 'wrong', 'expired'], assignments: [assignment, second, { ...assignment, assignmentId: 'wrong', fullName: '异岗人', positionId: 'foreign' }, { ...assignment, assignmentId: 'expired', fullName: '过期人', endedAt: '2021-01-01T00:00:00Z' }] });
  render(scene()); await openScope();
  fireEvent.mouseDown(within(screen.getByRole('dialog')).getByLabelText('分管部门'));
  expect(await screen.findByRole('option', { name: '试验组' })).toBeInTheDocument();
  expect(screen.queryByRole('option', { name: /质量部|采购部|停用科|停用下级/ })).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('option', { name: '质量科' }));
  fireEvent.mouseDown(within(screen.getByRole('dialog')).getByLabelText('分管负责人'));
  expect(await screen.findByRole('option', { name: '张一 (one) · 管理岗 / 质量部' })).toBeInTheDocument();
  expect(screen.queryByRole('option', { name: /异岗人|过期人/ })).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('option', { name: '张二 (two) · 管理岗 / 质量部' })); await save();
  await waitFor(() => expect(writes(requests)).toHaveLength(1));
  expect(JSON.parse(writes(requests)[0].init!.body as string)).toEqual({ departmentId: department.id, sectionDepartmentId: child.id, ministerAssignmentId: second.assignmentId, departmentLeadership: true });
});

it('keeps scope selections and the same body and idempotency identity after overlap 409', async () => {
  const requests = stub({ leaders: configured, intercept: ({ init }) => init?.method === 'POST' ? json({ code: 'CONCURRENCY_CONFLICT' }, 409) : undefined });
  render(scene()); await openScope(); await select('分管部门', '质量科'); await select('分管负责人', '张一 (one) · 管理岗 / 质量部'); await save();
  await screen.findByText(/分管时间重叠或配置版本冲突/); await save();
  await waitFor(() => expect(writes(requests)).toHaveLength(2));
  expect(writes(requests)[0].init!.body).toBe(writes(requests)[1].init!.body);
  expect(writes(requests)[0].init!.headers).toEqual(writes(requests)[1].init!.headers);
  expect(within(screen.getByRole('dialog')).getByText('张一 (one) · 管理岗 / 质量部')).toBeInTheDocument();
});

it('keeps original request frozen after an unknown result and retries without recalculating dates', async () => {
  let attempts = 0;
  const requests = stub({ leaders: configured, intercept: ({ init }) => { if (init?.method === 'POST' && ++attempts === 1) return Promise.reject(new TypeError('lost receipt')); } });
  render(scene()); await openScope(); await select('分管部门', '质量科'); await select('分管负责人', '张一 (one) · 管理岗 / 质量部'); await save();
  await userEvent.click(await screen.findByRole('button', { name: '重试原请求' }));
  await waitFor(() => expect(writes(requests)).toHaveLength(2));
  expect(writes(requests)[0].init!.body).toBe(writes(requests)[1].init!.body);
  expect(writes(requests)[0].init!.headers).toEqual(writes(requests)[1].init!.headers);
});

it('does not rewrite untouched ISO bounds when editing a scope', async () => {
  const requests = stub({ scopes: [scope], leaders: configured }); render(scene()); await loaded();
  await editScope();
  await select('分管负责人', '张二 (two) · 管理岗 / 质量部'); await save();
  await waitFor(() => expect(writes(requests)).toHaveLength(1));
  const body = JSON.parse(writes(requests)[0].init!.body as string);
  expect(body).toMatchObject({ expectedVersion: 7, ministerAssignmentId: second.assignmentId });
  expect(body).not.toHaveProperty('validFrom'); expect(body).not.toHaveProperty('validTo');
});

it('sends null only for explicitly unbounded scope end', async () => {
  const requests = stub({ leaders: configured }); render(scene()); await openScope(); await select('分管部门', '质量科'); await select('分管负责人', '张一 (one) · 管理岗 / 质量部');
  await select('结束方式', '无结束时间'); await save();
  await waitFor(() => expect(writes(requests)).toHaveLength(1));
  expect(JSON.parse(writes(requests)[0].init!.body as string).validTo).toBeNull();
});

it('warns about a stale selected appointment without silently selecting a different minister', async () => {
  stub({ scopes: [scope], assignments: [second] }); render(scene()); await loaded();
  await editScope();
  expect(await screen.findByText('已选任职失效，请重新选择。')).toBeInTheDocument();
  expect(within(screen.getByRole('dialog')).getByRole('button', { name: /^保\s*存$/ })).toBeDisabled();
});

it('does not queue a close callback while saving, then keeps failed input until explicit discard', async () => {
  let reject!: (error: Error) => void;
  stub({ intercept: ({ init }) => init?.method === 'PUT' ? new Promise<Response>((_done, fail) => { reject = fail; }) : undefined });
  render(scene()); await openLeaders(); await select('负责人', '张一 (one) · 管理岗 / 质量部'); await save();
  await waitFor(() => expect(reject).toBeDefined());
  expect(within(screen.getByRole('dialog')).getByRole('button', { name: /^取\s*消$/ })).toBeDisabled();
  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
  await act(async () => reject(new TypeError('offline')));
  await screen.findByRole('button', { name: '重试原请求' });
  expect(screen.queryByRole('dialog', { name: '当前草稿尚未保存，继续将放弃修改。' })).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: '放弃并刷新' }));
  await userEvent.click(await screen.findByRole('button', { name: '继续编辑' }));
  expect(within(screen.getByRole('dialog')).getByLabelText('负责人').closest('.ant-select')).toHaveTextContent('张一 (one) · 管理岗 / 质量部');
  await userEvent.click(screen.getByRole('button', { name: '放弃并刷新' }));
  await userEvent.click(await screen.findByRole('button', { name: '放弃修改' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
});

it('cleans dirty editor and work tabs on 401 and navigates without a stale discard prompt', async () => {
  stub({ intercept: ({ init }) => init?.method === 'PUT' ? json({ code: 'AUTH_SESSION_REQUIRED' }, 401) : undefined });
  render(scene()); await openLeaders(); await select('负责人', '张一 (one) · 管理岗 / 质量部'); await save();
  await waitFor(() => expect(screen.getByLabelText('route')).toHaveTextContent('/login'));
  expect(useWorkTabsStore.getState().sessionScope).toBeUndefined();
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

it('hides the entire scope section and does not fetch scope records at leaf nodes', async () => {
  const requests = stub(); render(scene(org, grandchild.id)); await loaded();
  expect(screen.getByRole('heading', { name: '本部门职责' })).toBeInTheDocument();
  expect(screen.queryByRole('region', { name: '下级部门分管' })).not.toBeInTheDocument();
  expect(requests.some(item => item.path.includes('/minister-scopes?'))).toBe(false);
});

it('shows the minister appointment name in readonly scope rows without opening an editor', async () => {
  stub({ scopes: [scope] }); render(scene({ ...org, permissions: [read] })); await loaded();
  expect(await screen.findByText('张一 (one) · 管理岗 / 质量部')).toBeInTheDocument();
});

it('loads appointment items using total and offset and keeps both minister appointments selectable', async () => {
  const requests = stub({ leaders: configured, intercept: ({ path }) => {
    if (!path.includes('/responsibility-assignments?')) return;
    const offset = new URL(path, 'http://localhost').searchParams.get('offset');
    return json({ items: offset === '0' ? Array.from({ length: 100 }, (_, index) => ({ ...assignment, assignmentId: `appointment-${index + 10}`, fullName: `候选${index}` })) : [second], total: 101 });
  } });
  render(scene()); await openScope();
  await select('分管负责人', '张二 (two) · 管理岗 / 质量部');
  expect(requests.some(item => item.path.includes('/responsibility-assignments?') && item.path.includes('offset=100'))).toBe(true);
});

it('drops editor data and late candidates when the session changes or read permission is revoked', async () => {
  let resolve!: (response: Response) => void;
  const requests = stub({ intercept: ({ path }) => path.includes('/responsibility-assignments?') ? new Promise<Response>(done => { resolve = done; }) : undefined });
  const view = render(scene()); await openLeaders();
  await waitFor(() => expect(resolve).toBeDefined());
  act(() => useWorkTabsStore.getState().bindSession('INTERNAL:org-a:different-user'));
  view.rerender(scene({ ...org, permissions: [] }));
  await act(async () => resolve(json({ items: [assignment], total: 1 })));
  expect(screen.getByText('无组织职责读取权限')).toBeInTheDocument();
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(screen.queryByText('张一 (one) · 管理岗 / 质量部')).not.toBeInTheDocument();
  expect(requests.find(item => item.path.includes('/responsibility-assignments?'))?.init?.signal?.aborted).toBe(true);
});

it('retains corrected dates and appointment on 422 without inventing an unlimited end', async () => {
  const requests = stub({ leaders: configured, intercept: ({ init }) => init?.method === 'POST' ? json({ code: 'VALIDATION_FAILED' }, 422) : undefined });
  render(scene()); await openScope(); await select('分管部门', '质量科'); await select('分管负责人', '张一 (one) · 管理岗 / 质量部');
  fireEvent.change(within(screen.getByRole('dialog')).getByLabelText('开始时间'), { target: { value: '2026-01-01T08:00:00' } }); await save();
  await screen.findByText('请检查有效期及任职范围，输入已保留。');
  expect(within(screen.getByRole('dialog')).getByLabelText('开始时间')).toHaveValue('2026-01-01T08:00');
  expect(JSON.parse(writes(requests)[0].init!.body as string)).not.toHaveProperty('validTo');
});

it('guards an unknown write receipt even when the editor submitted unchanged values', async () => {
  stub({ intercept: ({ init }) => init?.method === 'PUT' ? Promise.reject(new TypeError('lost receipt')) : undefined });
  render(scene()); await openLeaders(); await waitFor(() => expect(within(screen.getByRole('dialog')).getByLabelText('负责人')).not.toHaveAttribute('aria-busy', 'true')); await save();
  await screen.findByRole('button', { name: '重试原请求' });
  const unload = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(unload); expect(unload.defaultPrevented).toBe(true);
  await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /^取\s*消$/ }));
  // rc-dialog uses the same mock title id for both dialogs in NODE_ENV=test.
  expect(await screen.findByText('当前草稿尚未保存，继续将放弃修改。')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: '继续编辑' }));
  expect(screen.getByRole('button', { name: '重试原请求' })).toBeInTheDocument();
});

it('review regression: distinguishes same-name minister options and selection by username while saving the appointment id', async () => {
  const first = { ...assignment, fullName: '同名部长', username: 'minister.one' };
  const other = { ...second, fullName: first.fullName, username: 'minister.two' };
  const requests = stub({ assignments: [first, other], leaders: configured });
  render(scene()); await openScope(); await select('分管部门', '质量科');
  fireEvent.mouseDown(within(screen.getByRole('dialog')).getByLabelText('分管负责人'));
  expect(await screen.findByRole('option', { name: '同名部长 (minister.one) · 管理岗 / 质量部' })).toBeInTheDocument();
  await userEvent.click(screen.getByRole('option', { name: '同名部长 (minister.two) · 管理岗 / 质量部' }));
  expect(within(screen.getByRole('dialog')).getByLabelText('分管负责人').closest('.ant-select')).toHaveTextContent('同名部长 (minister.two) · 管理岗 / 质量部');
  await save(); await waitFor(() => expect(writes(requests)).toHaveLength(1));
  expect(JSON.parse(writes(requests)[0].init!.body as string).ministerAssignmentId).toBe(other.assignmentId);
});

it('review regression: distinguishes same-name selected appointments in readonly scope rows', async () => {
  stub({ assignments: [{ ...assignment, fullName: '同名部长', username: 'minister.one' }, { ...second, fullName: '同名部长', username: 'minister.two' }], scopes: [scope, { ...scope, id: 'scope-two', sectionDepartmentId: grandchild.id, ministerAssignmentId: second.assignmentId }] });
  render(scene({ ...org, permissions: [read] })); await loaded();
  expect(await screen.findByText('同名部长 (minister.one) · 管理岗 / 质量部')).toBeInTheDocument();
  expect(screen.getByText('同名部长 (minister.two) · 管理岗 / 质量部')).toBeInTheDocument();
});

it('review regression: never dispatches an old scope write after delayed CSRF completes following a scope change', async () => {
  let releaseCsrf!: (response: Response) => void;
  const requests = stub({ intercept: ({ path }) => path.endsWith('/csrf') ? new Promise<Response>(done => { releaseCsrf = done; }) : undefined });
  const view = render(scene()); await openLeaders(); await select('负责人', '张一 (one) · 管理岗 / 质量部'); await save();
  await waitFor(() => expect(releaseCsrf).toBeDefined());
  view.rerender(scene(org, child.id)); await loaded();
  await act(async () => releaseCsrf(json({ csrfToken: 'late-csrf' })));
  expect(writes(requests)).toHaveLength(0);
  expect(requests.find(item => item.path.endsWith('/csrf'))?.init?.signal?.aborted).toBe(true);
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(screen.getByLabelText('route')).toHaveTextContent(/^\/$/);
});
