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

type Binding = components['schemas']['ManagementBindingDto'];
type Scope = components['schemas']['MinisterScopeDto'];
type Assignment = components['schemas']['ResponsibilityAssignmentDto'];
type Preview = components['schemas']['ManagementResponsibilitiesDto'];
const read = 'organization:structure:read';
const manage = 'organization:structure:manage';
const org: AdminOrganization = { id: 'org-a', name: '甲公司', code: 'A', type: 'INTERNAL', permissions: [read, manage] };
const department: Department = { id: 'dep-a', organizationId: org.id, code: 'QA', name: '质量部', parentId: null, status: 'ACTIVE', version: 1 };
const child: Department = { ...department, id: 'child', code: 'QC', name: '质量科', parentId: department.id };
const grandchild: Department = { ...child, id: 'grandchild', name: '试验组', parentId: child.id };
const sibling: Department = { ...department, id: 'sibling', name: '采购部' };
const disabled: Department = { ...child, id: 'disabled', name: '停用科', status: 'DISABLED' };
const position: Position = { id: 'pos-a', organizationId: org.id, departmentId: department.id, categoryId: null, code: 'M', name: '管理岗', status: 'ACTIVE', version: 1 };
const positions: Position[] = [position, { ...position, id: 'foreign', departmentId: sibling.id, name: '异部门岗' }, { ...position, id: 'inactive', status: 'DISABLED', name: '停用岗' }];
const departments = [department, child, grandchild, sibling, disabled, { ...child, id: 'under-disabled', parentId: disabled.id, name: '停用下级' }];
const audit = { createdBy: 'admin', updatedBy: 'admin', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' };
const binding: Binding = { ...audit, id: 'binding', organizationId: org.id, departmentId: department.id, responsibility: 'MINISTER', positionId: position.id, status: 'ACTIVE', version: 4 };
const assignment: Assignment = { assignmentId: 'appointment-1', userId: 'u1', username: 'one', fullName: '张一', positionId: position.id, positionName: position.name, positionVersion: 1, departmentId: department.id, startedAt: '2020-01-01T00:00:00.000Z', endedAt: null };
const second: Assignment = { ...assignment, assignmentId: 'appointment-2', userId: 'u2', username: 'two', fullName: '张二' };
const scope: Scope = { ...audit, id: 'scope', organizationId: org.id, departmentId: department.id, sectionDepartmentId: child.id, ministerAssignmentId: assignment.assignmentId, validFrom: '2026-01-01T00:00:00.123Z', validTo: '2027-01-01T00:00:00.456Z', status: 'ACTIVE', version: 7 };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
type Request = { path: string; init?: RequestInit };
function stub(options: { bindings?: Binding[]; scopes?: Scope[]; assignments?: Assignment[]; preview?: Preview; intercept?: (request: Request) => Response | Promise<Response> | undefined } = {}) {
  const requests: Request[] = [];
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = { path: String(input), init }; requests.push(request);
    const intercepted = options.intercept?.(request);
    if (intercepted) return intercepted;
    if (request.path.endsWith('/csrf')) return json({ csrfToken: 'csrf' });
    if (init?.method) return json({ id: 'saved' });
    if (request.path.includes('/management-bindings?')) return json(options.bindings ?? [binding]);
    if (request.path.includes('/minister-scopes?')) return json(options.scopes ?? []);
    if (request.path.includes('/responsibility-assignments?')) return json({ items: options.assignments ?? [assignment, second], total: options.assignments?.length ?? 2 });
    if (request.path.includes('/management-responsibilities?')) return json(options.preview ?? { organizationId: org.id, sectionDepartmentId: department.id, at: audit.createdAt, responsibilities: [], issues: [{ responsibility: 'MINISTER', code: 'SCOPE_MISSING' }] });
    throw new Error(`Unexpected request: ${request.path}`);
  }));
  return requests;
}
function Route() { return <output aria-label="route">{useLocation().pathname}</output>; }
function scene(organization = org, departmentId = department.id) {
  return <ConfigProvider theme={{ token: { motion: false } }}><MemoryRouter><LanguageProvider><UnsavedChangesProvider><DepartmentResponsibilities organization={organization} departmentId={departmentId} departments={departments} positions={positions} /><Route /></UnsavedChangesProvider></LanguageProvider></MemoryRouter></ConfigProvider>;
}
async function loaded() { await waitFor(() => expect(screen.getByRole('button', { name: '职责预览' })).toBeEnabled(), { timeout: 5000 }); }
async function select(label: string, text: string) {
  const field = within(screen.getByRole('dialog')).getByLabelText(label);
  fireEvent.mouseDown(field);
  await userEvent.click(await screen.findByRole('option', { name: text }));
}
async function openBinding() { await loaded(); await userEvent.click(screen.getByRole('button', { name: '新增职责绑定' })); }
async function openScope() { await loaded(); await userEvent.click(screen.getByRole('button', { name: '新增部长分管' })); await waitFor(() => expect(within(screen.getByRole('dialog')).getByLabelText('部长任职')).not.toHaveAttribute('aria-busy', 'true')); }
async function save() { await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /^保\s*存$/ })); }
const writes = (requests: Request[]) => requests.filter(item => item.init?.method && item.path.includes('/organizations/'));
beforeEach(() => { localStorage.clear(); sessionStorage.clear(); useWorkTabsStore.getState().bindSession('INTERNAL:org-a:admin'); });
afterEach(() => { vi.unstubAllGlobals(); useWorkTabsStore.getState().reset(); });

it('shows readonly bindings without any write entry, and permits preview', async () => {
  stub(); render(scene({ ...org, permissions: [read] })); await loaded();
  expect(screen.getByText('部长')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '新增职责绑定' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '新增部长分管' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /编辑/ })).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: '职责预览' }));
  expect(await screen.findByText(/未配置部长分管/)).toBeInTheDocument();
});

it('does not read or expose write entries without structure read permission', async () => {
  const requests = stub(); render(scene({ ...org, permissions: [manage] }));
  expect(screen.getByText('无组织职责读取权限')).toBeInTheDocument();
  expect(requests).toHaveLength(0);
});

it('creates an explicit manager binding using only active positions in the selected department', async () => {
  const requests = stub(); render(scene()); await openBinding();
  await select('管理职责', '科室经理');
  fireEvent.mouseDown(within(screen.getByRole('dialog')).getByLabelText('职责岗位'));
  expect(screen.queryByRole('option', { name: /异部门岗|停用岗/ })).not.toBeInTheDocument();
  await userEvent.click(await screen.findByRole('option', { name: '管理岗' })); await save();
  await waitFor(() => expect(writes(requests)).toHaveLength(1));
  expect(JSON.parse(writes(requests)[0].init!.body as string)).toEqual({ departmentId: department.id, responsibility: 'SECTION_MANAGER', positionId: position.id });
});

it('edits and restores a disabled binding with its expected version and explicit status', async () => {
  const requests = stub({ bindings: [{ ...binding, status: 'DISABLED' }] }); render(scene()); await loaded();
  await userEvent.click(screen.getByRole('button', { name: '编辑职责绑定 · 部长' }));
  await select('状态', '启用'); await save();
  await waitFor(() => expect(writes(requests)).toHaveLength(1));
  expect(writes(requests)[0].init!.method).toBe('PATCH');
  expect(JSON.parse(writes(requests)[0].init!.body as string)).toMatchObject({ expectedVersion: 4, status: 'ACTIVE' });
});

it('offers effective appointments of the minister binding, including two different ministers, and only active descendants', async () => {
  const requests = stub({ assignments: [assignment, second, { ...assignment, assignmentId: 'wrong', fullName: '异岗人', positionId: 'foreign' }, { ...assignment, assignmentId: 'expired', fullName: '过期人', endedAt: '2021-01-01T00:00:00Z' }] });
  render(scene()); await openScope();
  fireEvent.mouseDown(within(screen.getByRole('dialog')).getByLabelText('分管科室'));
  expect(await screen.findByRole('option', { name: '试验组' })).toBeInTheDocument();
  expect(screen.queryByRole('option', { name: /质量部|采购部|停用科|停用下级/ })).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('option', { name: '质量科' }));
  fireEvent.mouseDown(within(screen.getByRole('dialog')).getByLabelText('部长任职'));
  expect(await screen.findByRole('option', { name: '张一 (one) · 管理岗 / 质量部' })).toBeInTheDocument();
  expect(screen.queryByRole('option', { name: /异岗人|过期人/ })).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('option', { name: '张二 (two) · 管理岗 / 质量部' })); await save();
  await waitFor(() => expect(writes(requests)).toHaveLength(1));
  expect(JSON.parse(writes(requests)[0].init!.body as string)).toEqual({ departmentId: department.id, sectionDepartmentId: child.id, ministerAssignmentId: second.assignmentId });
});

it('keeps scope selections and the same body and idempotency identity after overlap 409', async () => {
  const requests = stub({ intercept: ({ init }) => init?.method === 'POST' ? json({ code: 'CONCURRENCY_CONFLICT' }, 409) : undefined });
  render(scene()); await openScope(); await select('分管科室', '质量科'); await select('部长任职', '张一 (one) · 管理岗 / 质量部'); await save();
  await screen.findByText(/分管时间重叠或配置版本冲突/); await save();
  await waitFor(() => expect(writes(requests)).toHaveLength(2));
  expect(writes(requests)[0].init!.body).toBe(writes(requests)[1].init!.body);
  expect(writes(requests)[0].init!.headers).toEqual(writes(requests)[1].init!.headers);
  expect(within(screen.getByRole('dialog')).getByText('张一 (one) · 管理岗 / 质量部')).toBeInTheDocument();
});

it('keeps original request frozen after an unknown result and retries without recalculating dates', async () => {
  let attempts = 0;
  const requests = stub({ intercept: ({ init }) => { if (init?.method === 'POST' && ++attempts === 1) return Promise.reject(new TypeError('lost receipt')); } });
  render(scene()); await openScope(); await select('分管科室', '质量科'); await select('部长任职', '张一 (one) · 管理岗 / 质量部'); await save();
  await userEvent.click(await screen.findByRole('button', { name: '重试原请求' }));
  await waitFor(() => expect(writes(requests)).toHaveLength(2));
  expect(writes(requests)[0].init!.body).toBe(writes(requests)[1].init!.body);
  expect(writes(requests)[0].init!.headers).toEqual(writes(requests)[1].init!.headers);
});

it('does not rewrite untouched ISO bounds when editing a scope', async () => {
  const requests = stub({ scopes: [scope] }); render(scene()); await loaded();
  await userEvent.click(screen.getByRole('button', { name: '编辑部长分管 · 质量科' }));
  await select('部长任职', '张二 (two) · 管理岗 / 质量部'); await save();
  await waitFor(() => expect(writes(requests)).toHaveLength(1));
  const body = JSON.parse(writes(requests)[0].init!.body as string);
  expect(body).toMatchObject({ expectedVersion: 7, ministerAssignmentId: second.assignmentId });
  expect(body).not.toHaveProperty('validFrom'); expect(body).not.toHaveProperty('validTo');
});

it('sends null only for explicitly unbounded scope end', async () => {
  const requests = stub(); render(scene()); await openScope(); await select('分管科室', '质量科'); await select('部长任职', '张一 (one) · 管理岗 / 质量部');
  await select('结束方式', '无结束时间'); await save();
  await waitFor(() => expect(writes(requests)).toHaveLength(1));
  expect(JSON.parse(writes(requests)[0].init!.body as string).validTo).toBeNull();
});

it('warns about a stale selected appointment without silently selecting a different minister', async () => {
  stub({ scopes: [scope], assignments: [second] }); render(scene()); await loaded();
  await userEvent.click(screen.getByRole('button', { name: '编辑部长分管 · 质量科' }));
  expect(await screen.findByText('已选任职失效，请重新选择。')).toBeInTheDocument();
  expect(within(screen.getByRole('dialog')).getByRole('button', { name: /^保\s*存$/ })).toBeDisabled();
});

it('preserves separate manager and minister rows for the same user and shows missing configuration as nonblocking', async () => {
  const source: Preview['responsibilities'][number] = { ...assignment, responsibility: 'SECTION_MANAGER', bindingId: 'manager', bindingVersion: 2, scopeId: null, scopeVersion: null, departmentVersion: 1, sectionDepartmentVersion: 1, organizationVersion: 1 };
  stub({ preview: { organizationId: org.id, sectionDepartmentId: department.id, at: audit.createdAt, responsibilities: [source, { ...source, responsibility: 'MINISTER', bindingId: binding.id, scopeId: scope.id, scopeVersion: scope.version }], issues: [{ responsibility: 'SECTION_MANAGER', code: 'ASSIGNMENT_AMBIGUOUS' }] } });
  render(scene()); await loaded(); await userEvent.click(screen.getByRole('button', { name: '职责预览' }));
  const preview = await screen.findByRole('region', { name: '职责预览结果' });
  expect(within(preview).getAllByText('张一')).toHaveLength(2);
  expect(within(preview).getByText(/存在多个有效任职候选/)).toBeInTheDocument();
  expect(within(preview).queryByText(/已审批|已跳过|流程已发布/)).not.toBeInTheDocument();
});

it('ignores late responses after selected department changes and aborts previous reads', async () => {
  let resolve!: (response: Response) => void;
  const requests = stub({ intercept: ({ path }) => path.includes('/management-bindings?departmentId=dep-a') ? new Promise<Response>(done => { resolve = done; }) : undefined });
  const view = render(scene()); await waitFor(() => expect(resolve).toBeDefined());
  view.rerender(scene(org, child.id)); await loaded();
  await act(async () => resolve(json([{ ...binding, id: 'late' }])));
  const first = requests.find(item => item.path.includes('/management-bindings?departmentId=dep-a'));
  expect(first?.init?.signal?.aborted).toBe(true);
  expect(screen.queryByText('管理岗')).not.toBeInTheDocument();
});

it('does not queue a close callback while saving, then keeps failed input until explicit discard', async () => {
  let reject!: (error: Error) => void;
  stub({ intercept: ({ init }) => init?.method === 'POST' ? new Promise<Response>((_done, fail) => { reject = fail; }) : undefined });
  render(scene()); await openBinding(); await select('管理职责', '科室经理'); await select('职责岗位', '管理岗'); await save();
  await waitFor(() => expect(reject).toBeDefined());
  expect(within(screen.getByRole('dialog')).getByRole('button', { name: /^取\s*消$/ })).toBeDisabled();
  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
  await act(async () => reject(new TypeError('offline')));
  await screen.findByRole('button', { name: '重试原请求' });
  expect(screen.queryByRole('dialog', { name: '当前草稿尚未保存，继续将放弃修改。' })).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: '放弃并刷新' }));
  await userEvent.click(await screen.findByRole('button', { name: '继续编辑' }));
  expect(within(screen.getByRole('dialog')).getByText('管理岗')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: '放弃并刷新' }));
  await userEvent.click(await screen.findByRole('button', { name: '放弃修改' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
});

it('cleans dirty editor and work tabs on 401 and navigates without a stale discard prompt', async () => {
  stub({ intercept: ({ init }) => init?.method === 'POST' ? json({ code: 'AUTH_SESSION_REQUIRED' }, 401) : undefined });
  render(scene()); await openBinding(); await select('管理职责', '科室经理'); await select('职责岗位', '管理岗'); await save();
  await waitFor(() => expect(screen.getByLabelText('route')).toHaveTextContent('/login'));
  expect(useWorkTabsStore.getState().sessionScope).toBeUndefined();
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

it('disables scope creation at leaf nodes without inventing departments', async () => {
  stub(); render(scene(org, grandchild.id)); await loaded();
  expect(screen.getByRole('button', { name: '新增部长分管' })).toBeDisabled();
  expect(screen.getByText(/请先维护有效下级科室/)).toBeInTheDocument();
});

it('shows the minister appointment name in readonly scope rows without opening an editor', async () => {
  stub({ scopes: [scope] }); render(scene({ ...org, permissions: [read] })); await loaded();
  expect(await screen.findByText('张一 (one) · 管理岗 / 质量部')).toBeInTheDocument();
});

it('loads appointment items using total and offset and keeps both minister appointments selectable', async () => {
  const requests = stub({ intercept: ({ path }) => {
    if (!path.includes('/responsibility-assignments?')) return;
    const offset = new URL(path, 'http://localhost').searchParams.get('offset');
    return json({ items: offset === '0' ? Array.from({ length: 100 }, (_, index) => ({ ...assignment, assignmentId: `appointment-${index + 10}`, fullName: `候选${index}` })) : [second], total: 101 });
  } });
  render(scene()); await openScope();
  await select('部长任职', '张二 (two) · 管理岗 / 质量部');
  expect(requests.some(item => item.path.includes('/responsibility-assignments?') && item.path.includes('offset=100'))).toBe(true);
});

it('drops editor data and late candidates when the session changes or read permission is revoked', async () => {
  let resolve!: (response: Response) => void;
  const requests = stub({ intercept: ({ path }) => path.includes('/responsibility-assignments?') ? new Promise<Response>(done => { resolve = done; }) : undefined });
  const view = render(scene()); await loaded(); await userEvent.click(screen.getByRole('button', { name: '新增部长分管' }));
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
  const requests = stub({ intercept: ({ init }) => init?.method === 'POST' ? json({ code: 'VALIDATION_FAILED' }, 422) : undefined });
  render(scene()); await openScope(); await select('分管科室', '质量科'); await select('部长任职', '张一 (one) · 管理岗 / 质量部');
  fireEvent.change(within(screen.getByRole('dialog')).getByLabelText('开始时间'), { target: { value: '2026-01-01T08:00:00' } }); await save();
  await screen.findByText('请检查有效期及任职范围，输入已保留。');
  expect(within(screen.getByRole('dialog')).getByLabelText('开始时间')).toHaveValue('2026-01-01T08:00');
  expect(JSON.parse(writes(requests)[0].init!.body as string)).not.toHaveProperty('validTo');
});

it('guards an unknown write receipt even when the editor submitted unchanged values', async () => {
  stub({ intercept: ({ init }) => init?.method === 'PATCH' ? Promise.reject(new TypeError('lost receipt')) : undefined });
  render(scene()); await loaded(); await userEvent.click(screen.getByRole('button', { name: '编辑职责绑定 · 部长' })); await save();
  await screen.findByRole('button', { name: '重试原请求' });
  const unload = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(unload); expect(unload.defaultPrevented).toBe(true);
  await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /^取\s*消$/ }));
  // rc-dialog uses the same mock title id for both dialogs in NODE_ENV=test.
  expect(await screen.findByText('当前草稿尚未保存，继续将放弃修改。')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: '继续编辑' }));
  expect(screen.getByRole('button', { name: '重试原请求' })).toBeInTheDocument();
});

it('review regression: ignores a preview response that arrives after refresh', async () => {
  let resolve!: (response: Response) => void;
  const requests = stub({ intercept: ({ path }) => path.includes('/management-responsibilities?') ? new Promise<Response>(done => { resolve = done; }) : undefined });
  render(scene()); await loaded(); await userEvent.click(screen.getByRole('button', { name: '职责预览' }));
  await waitFor(() => expect(resolve).toBeDefined());
  await userEvent.click(screen.getByRole('button', { name: /^刷\s*新$/ }));
  await waitFor(() => expect(requests.filter(item => item.path.includes('/management-bindings?'))).toHaveLength(2));
  await act(async () => resolve(json({ organizationId: org.id, sectionDepartmentId: department.id, at: audit.createdAt, responsibilities: [], issues: [] })));
  expect(screen.queryByRole('region', { name: '职责预览结果' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: '职责预览' })).toBeEnabled();
  expect(requests.find(item => item.path.includes('/management-responsibilities?'))?.init?.signal?.aborted).toBe(true);
});

it('review regression: ignores a preview response that arrives after a successful save', async () => {
  let resolve!: (response: Response) => void;
  const requests = stub({ intercept: ({ path }) => path.includes('/management-responsibilities?') ? new Promise<Response>(done => { resolve = done; }) : undefined });
  render(scene()); await loaded(); await userEvent.click(screen.getByRole('button', { name: '职责预览' }));
  await waitFor(() => expect(resolve).toBeDefined());
  await userEvent.click(screen.getByRole('button', { name: '新增职责绑定' })); await select('管理职责', '科室经理'); await select('职责岗位', '管理岗'); await save();
  await screen.findByText('已保存');
  await waitFor(() => expect(requests.filter(item => item.path.includes('/management-bindings?'))).toHaveLength(2));
  await act(async () => resolve(json({ organizationId: org.id, sectionDepartmentId: department.id, at: audit.createdAt, responsibilities: [], issues: [] })));
  expect(screen.queryByRole('region', { name: '职责预览结果' })).not.toBeInTheDocument();
  expect(requests.find(item => item.path.includes('/management-responsibilities?'))?.init?.signal?.aborted).toBe(true);
});

it('review regression: obsolete scope sources cannot overwrite or finish a newer preview', async () => {
  let resolveOld!: (response: Response) => void;
  let resolveNew!: (response: Response) => void;
  let sourceReads = 0;
  let previewReads = 0;
  const source: Preview['responsibilities'][number] = { ...assignment, responsibility: 'MINISTER', bindingId: binding.id, bindingVersion: binding.version, scopeId: scope.id, scopeVersion: scope.version, departmentVersion: 1, sectionDepartmentVersion: 1, organizationVersion: 1 };
  const requests = stub({ intercept: ({ path }) => {
    if (path.includes('/management-responsibilities?')) return json({ organizationId: org.id, sectionDepartmentId: department.id, at: ++previewReads === 1 ? audit.createdAt : '2026-02-01T00:00:00.000Z', responsibilities: [{ ...source, scopeVersion: previewReads === 1 ? scope.version : scope.version + 1 }], issues: [] });
    if (path.includes('/minister-scopes?')) {
      sourceReads++;
      if (sourceReads === 2) return new Promise<Response>(done => { resolveOld = done; });
      if (sourceReads === 4) return new Promise<Response>(done => { resolveNew = done; });
    }
  } });
  render(scene()); await loaded(); await userEvent.click(screen.getByRole('button', { name: '职责预览' }));
  await waitFor(() => expect(resolveOld).toBeDefined());
  await userEvent.click(screen.getByRole('button', { name: /^刷\s*新$/ })); await loaded();
  await userEvent.click(screen.getByRole('button', { name: '职责预览' }));
  await waitFor(() => expect(resolveNew).toBeDefined());
  await act(async () => resolveOld(json([scope])));
  expect(screen.getByRole('button', { name: /职责预览/ })).toBeDisabled();
  const result = screen.getByRole('region', { name: '职责预览结果' });
  await userEvent.click(within(result).getByRole('button', { name: '职责来源' }));
  expect(within(result).queryByText('分管来源版本已变化，请重新预览')).not.toBeInTheDocument();
  await act(async () => resolveNew(json([{ ...scope, version: scope.version + 1, validFrom: '2026-02-01T00:00:00.789Z' }])));
  await loaded();
  expect(within(result).getByText(/2026-02-01T00:00:00.789Z/)).toBeInTheDocument();
  expect(requests.filter(item => item.path.includes('/minister-scopes?'))[1].init?.signal?.aborted).toBe(true);
});

it('review regression: ignores an obsolete preview 401 after refresh instead of clearing the session', async () => {
  let resolve!: (response: Response) => void;
  const requests = stub({ intercept: ({ path }) => path.includes('/management-responsibilities?') ? new Promise<Response>(done => { resolve = done; }) : undefined });
  render(scene()); await loaded(); await userEvent.click(screen.getByRole('button', { name: '职责预览' }));
  await waitFor(() => expect(resolve).toBeDefined());
  await userEvent.click(screen.getByRole('button', { name: /^刷\s*新$/ }));
  await waitFor(() => expect(requests.filter(item => item.path.includes('/management-bindings?'))).toHaveLength(2));
  await act(async () => resolve(json({ code: 'AUTH_SESSION_REQUIRED' }, 401)));
  expect(screen.getByLabelText('route')).toHaveTextContent(/^\/$/);
  expect(useWorkTabsStore.getState().sessionScope).toBe('INTERNAL:org-a:admin');
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

it('review regression: distinguishes same-name minister options and selection by username while saving the appointment id', async () => {
  const first = { ...assignment, fullName: '同名部长', username: 'minister.one' };
  const other = { ...second, fullName: first.fullName, username: 'minister.two' };
  const requests = stub({ assignments: [first, other] });
  render(scene()); await openScope(); await select('分管科室', '质量科');
  fireEvent.mouseDown(within(screen.getByRole('dialog')).getByLabelText('部长任职'));
  expect(await screen.findByRole('option', { name: '同名部长 (minister.one) · 管理岗 / 质量部' })).toBeInTheDocument();
  await userEvent.click(screen.getByRole('option', { name: '同名部长 (minister.two) · 管理岗 / 质量部' }));
  expect(within(screen.getByRole('dialog')).getByLabelText('部长任职').closest('.ant-select')).toHaveTextContent('同名部长 (minister.two) · 管理岗 / 质量部');
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
  const view = render(scene()); await openBinding(); await select('管理职责', '科室经理'); await select('职责岗位', '管理岗'); await save();
  await waitFor(() => expect(releaseCsrf).toBeDefined());
  view.rerender(scene(org, child.id)); await loaded();
  await act(async () => releaseCsrf(json({ csrfToken: 'late-csrf' })));
  expect(writes(requests)).toHaveLength(0);
  expect(requests.find(item => item.path.endsWith('/csrf'))?.init?.signal?.aborted).toBe(true);
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(screen.getByLabelText('route')).toHaveTextContent(/^\/$/);
});
